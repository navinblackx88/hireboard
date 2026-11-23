import { Router, type Request } from "express";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  applicationEvents, applications, applicationStatusEnum, jobs, resumes, users, type Application, type ApplicationStatus,
} from "../../db/schema.js";
import { me, requireRole } from "../../lib/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { body, csv, query, uuidParam } from "../../lib/validate.js";
import { emit } from "../../realtime/sse.js";
import { paged } from "../jobs/job.routes.js";
import { notify } from "../notifications/notify.js";
import { aiEnabled } from "../scoring/scorer.js";
import { kickScoring } from "../scoring/worker.js";
import { downloadUrl } from "./files.js";

export const jobApplicationsRouter = Router({ mergeParams: true });
export const applicationRouter = Router();

const status = z.enum(applicationStatusEnum.enumValues);
const pageQuery = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };

/** Allowed employer moves. Candidates can only withdraw. hired/rejected/withdrawn are final. */
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  submitted: ["reviewing", "shortlisted", "rejected"],
  reviewing: ["shortlisted", "interview", "rejected"],
  shortlisted: ["reviewing", "interview", "rejected"],
  interview: ["shortlisted", "offered", "rejected"],
  offered: ["hired", "rejected"],
  hired: [], rejected: [], withdrawn: [],
};
const WITHDRAWABLE: ApplicationStatus[] = ["submitted", "reviewing", "shortlisted", "interview", "offered"];

const scoreView = (a: Application) => ({
  status: a.scoreStatus, value: a.score, summary: a.scoreSummary, strengths: a.scoreStrengths ?? [], gaps: a.scoreGaps ?? [],
  provider: a.scoreProvider, scoredAt: a.scoredAt, error: a.scoreStatus === "failed" ? a.scoreError : null,
});

// ─── Candidate: apply ────────────────────────────────────────────────────────
jobApplicationsRouter.post("/", requireRole("candidate"), async (req, res) => {
  const actor = me(req);
  const jobId = uuidParam(req, "id");
  const input = body(req, z.object({ resumeId: z.uuid().optional(), coverLetter: z.string().trim().max(5000).optional() }));
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || job.status !== "published") throw notFound("Job");
  if (job.closesAt && job.closesAt <= new Date()) throw badRequest("Applications for this job have closed");

  const [resume] = await db.select().from(resumes).where(and(
    eq(resumes.candidateId, actor.id), isNull(resumes.deletedAt),
    input.resumeId ? eq(resumes.id, input.resumeId) : eq(resumes.isDefault, true),
  ));
  if (!resume) throw badRequest(input.resumeId ? "Resume not found" : "Upload a resume before applying");

  const [existing] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.jobId, jobId), eq(applications.candidateId, actor.id)));
  if (existing) throw conflict("You've already applied to this job");

  const app = await db.transaction(async (tx) => {
    const [a] = await tx.insert(applications).values({ jobId, candidateId: actor.id, resumeId: resume.id, coverLetter: input.coverLetter }).returning();
    await tx.insert(applicationEvents).values({ applicationId: a.id, toStatus: "submitted", actorId: actor.id });
    return a;
  });
  kickScoring();
  await emit.toUser(job.employerId, "application.created", { applicationId: app.id, jobId, candidateName: actor.name, jobTitle: job.title });
  notify.applicationReceived(job, actor, app.id);
  res.status(201).json({ id: app.id, jobId, status: app.status, createdAt: app.createdAt });
});

// ─── Employer: applicants for a job ──────────────────────────────────────────
/**
 * Re-queue a job's applications for scoring. Default scope "keyword" re-scores those the keyword scorer
 * handled (or that failed) — e.g. after OPENAI_API_KEY is added; "all" re-scores every active application.
 */
jobApplicationsRouter.post("/rescore", requireRole("employer", "admin"), async (req, res) => {
  const actor = me(req);
  const jobId = uuidParam(req, "id");
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || (actor.role === "employer" && job.employerId !== actor.id)) throw notFound("Job");
  const { scope } = body(req, z.object({ scope: z.enum(["keyword", "all"]).default("keyword") }));
  if (scope === "keyword" && !aiEnabled()) throw badRequest("AI scoring isn't configured: set OPENAI_API_KEY on the server first");
  const which = scope === "keyword"
    ? or(eq(applications.scoreProvider, "heuristic"), eq(applications.scoreStatus, "failed"))
    : sql`true`;
  const rows = await db.update(applications)
    .set({ scoreStatus: "pending", scoreAttempts: 0, scoreError: null, scoreLockedUntil: null })
    .where(and(eq(applications.jobId, jobId), sql`${applications.status} <> 'withdrawn'`, sql`${applications.scoreStatus} <> 'processing'`, which))
    .returning({ id: applications.id });
  if (rows.length) kickScoring();
  res.status(202).json({ queued: rows.length });
});

jobApplicationsRouter.get("/", requireRole("employer", "admin"), async (req, res) => {
  const actor = me(req);
  const jobId = uuidParam(req, "id");
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || (actor.role === "employer" && job.employerId !== actor.id)) throw notFound("Job");
  const q = query(req, z.object({
    ...pageQuery, status: csv(status), minScore: z.coerce.number().int().min(0).max(100).optional(),
    q: z.string().trim().max(120).optional(), sort: z.enum(["score", "newest", "oldest"]).default("score"),
  }));
  const where = and(
    eq(applications.jobId, jobId),
    q.status?.length ? inArray(applications.status, q.status) : undefined,
    q.minScore !== undefined ? gte(applications.score, q.minScore) : undefined,
    q.q ? or(ilike(users.name, `%${q.q}%`), ilike(users.email, `%${q.q}%`)) : undefined,
  );
  const order = q.sort === "score" ? [sql`${applications.score} desc nulls last`, asc(applications.createdAt)]
    : q.sort === "newest" ? [desc(applications.createdAt)] : [asc(applications.createdAt)];
  const [[{ total }], rows, byStatus] = await Promise.all([
    db.select({ total: count() }).from(applications).innerJoin(users, eq(users.id, applications.candidateId)).where(where),
    db.select({ a: applications, candidate: { id: users.id, name: users.name, email: users.email, headline: users.headline, location: users.location }, resume: { id: resumes.id, filename: resumes.filename } })
      .from(applications).innerJoin(users, eq(users.id, applications.candidateId)).innerJoin(resumes, eq(resumes.id, applications.resumeId))
      .where(where).orderBy(...order).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ status: applications.status, n: count() }).from(applications).where(eq(applications.jobId, jobId)).groupBy(applications.status),
  ]);
  res.json({
    ...paged(rows.map((r) => ({
      id: r.a.id, status: r.a.status, coverLetter: r.a.coverLetter, createdAt: r.a.createdAt, updatedAt: r.a.updatedAt,
      candidate: r.candidate, resume: r.resume, score: scoreView(r.a),
    })), q.page, q.pageSize, total),
    counts: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
  });
});

// ─── Candidate: my applications ──────────────────────────────────────────────
applicationRouter.get("/me", requireRole("candidate"), async (req, res) => {
  const actor = me(req);
  const q = query(req, z.object({ ...pageQuery, status: csv(status) }));
  const where = and(eq(applications.candidateId, actor.id), q.status?.length ? inArray(applications.status, q.status) : undefined);
  const [[{ total }], rows, byStatus] = await Promise.all([
    db.select({ total: count() }).from(applications).where(where),
    db.select({
      id: applications.id, status: applications.status, createdAt: applications.createdAt, updatedAt: applications.updatedAt,
      job: { id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location, workplace: jobs.workplace, employmentType: jobs.employmentType, status: jobs.status },
    }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).where(where).orderBy(desc(applications.updatedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ status: applications.status, n: count() }).from(applications).where(eq(applications.candidateId, actor.id)).groupBy(applications.status),
  ]);
  res.json({ ...paged(rows, q.page, q.pageSize, total), counts: Object.fromEntries(byStatus.map((s) => [s.status, s.n])) });
});

async function loadForActor(req: Request) {
  const actor = me(req);
  const [row] = await db.select({ a: applications, job: jobs }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).where(eq(applications.id, uuidParam(req, "id")));
  if (!row) throw notFound("Application");
  const isCandidate = actor.role === "candidate" && row.a.candidateId === actor.id;
  const isEmployer = actor.role === "employer" && row.job.employerId === actor.id;
  if (!isCandidate && !isEmployer && actor.role !== "admin") throw notFound("Application");
  return { ...row, actor, isCandidate };
}

/**
 * Detail with status timeline. Candidates don't see AI scores: scores are a screening aid
 * for employers, and hiding them keeps candidates from gaming the model.
 */
applicationRouter.get("/:id", async (req, res) => {
  const { a, job, isCandidate } = await loadForActor(req);
  const [events, [candidate], [resume]] = await Promise.all([
    db.select({ id: applicationEvents.id, fromStatus: applicationEvents.fromStatus, toStatus: applicationEvents.toStatus, note: applicationEvents.note, createdAt: applicationEvents.createdAt, actorName: users.name })
      .from(applicationEvents).leftJoin(users, eq(users.id, applicationEvents.actorId)).where(eq(applicationEvents.applicationId, a.id)).orderBy(asc(applicationEvents.createdAt)),
    db.select({ id: users.id, name: users.name, email: users.email, headline: users.headline, location: users.location }).from(users).where(eq(users.id, a.candidateId)),
    db.select({ id: resumes.id, filename: resumes.filename, sizeBytes: resumes.sizeBytes, extractedText: resumes.extractedText }).from(resumes).where(eq(resumes.id, a.resumeId)),
  ]);
  res.json({
    id: a.id, status: a.status, coverLetter: a.coverLetter, createdAt: a.createdAt, updatedAt: a.updatedAt,
    job: { id: job.id, title: job.title, company: job.company, location: job.location, workplace: job.workplace, employmentType: job.employmentType, status: job.status },
    candidate, resume: isCandidate ? { id: resume.id, filename: resume.filename, sizeBytes: resume.sizeBytes } : resume,
    events: events.map((e) => (isCandidate ? { ...e, actorName: undefined } : e)),
    score: isCandidate ? undefined : scoreView(a),
    allowedTransitions: isCandidate ? (WITHDRAWABLE.includes(a.status) ? ["withdrawn"] : []) : TRANSITIONS[a.status],
  });
});

applicationRouter.patch("/:id/status", requireRole("employer", "admin"), async (req, res) => {
  const { a, job, actor } = await loadForActor(req);
  const input = body(req, z.object({ status, note: z.string().trim().max(2000).optional() }));
  if (!TRANSITIONS[a.status].includes(input.status)) {
    throw badRequest(`Can't move an application from ${a.status} to ${input.status}. Allowed: ${TRANSITIONS[a.status].join(", ") || "none (final state)"}`);
  }
  const updated = await changeStatus(a, input.status, actor.id, input.note);
  notify.statusChanged(job, a.candidateId, a.id, input.status, input.note);
  res.json(updated);
});

applicationRouter.post("/:id/withdraw", requireRole("candidate"), async (req, res) => {
  const { a, actor, isCandidate } = await loadForActor(req);
  if (!isCandidate) throw forbidden();
  if (!WITHDRAWABLE.includes(a.status)) throw badRequest(`An application that is ${a.status} can't be withdrawn`);
  res.json(await changeStatus(a, "withdrawn", actor.id));
});

async function changeStatus(a: Application, to: ApplicationStatus, actorId: string, note?: string) {
  const [updated] = await db.transaction(async (tx) => {
    // Guard against a concurrent change: only update if the status is still what we validated against.
    const rows = await tx.update(applications).set({ status: to }).where(and(eq(applications.id, a.id), eq(applications.status, a.status))).returning();
    if (!rows.length) throw conflict("This application was just updated by someone else. Refresh and try again.");
    await tx.insert(applicationEvents).values({ applicationId: a.id, fromStatus: a.status, toStatus: to, actorId, note });
    return rows;
  });
  const [job] = await db.select({ employerId: jobs.employerId, title: jobs.title }).from(jobs).where(eq(jobs.id, a.jobId));
  const payload = { applicationId: a.id, jobId: a.jobId, jobTitle: job.title, from: a.status, to, note: note ?? null, at: updated.updatedAt };
  await Promise.all([emit.toUser(a.candidateId, "application.status_changed", payload), emit.toUser(job.employerId, "application.status_changed", payload)]);
  return { id: updated.id, status: updated.status, updatedAt: updated.updatedAt };
}

applicationRouter.post("/:id/rescore", requireRole("employer", "admin"), async (req, res) => {
  const { a } = await loadForActor(req);
  await db.update(applications).set({ scoreStatus: "pending", scoreAttempts: 0, scoreError: null, scoreLockedUntil: null }).where(eq(applications.id, a.id));
  kickScoring();
  res.status(202).json({ id: a.id, scoreStatus: "pending" });
});

applicationRouter.get("/:id/resume", async (req, res) => {
  const { a } = await loadForActor(req);
  const [r] = await db.select().from(resumes).where(eq(resumes.id, a.resumeId));
  res.json({ url: await downloadUrl(r), filename: r.filename, expiresInSeconds: 300 });
});
