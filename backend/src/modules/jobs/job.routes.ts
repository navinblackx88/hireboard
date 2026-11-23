import { Router, type Request } from "express";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  applications, employmentTypeEnum, experienceEnum, jobs, jobStatusEnum, users, workplaceEnum, type Job,
} from "../../db/schema.js";
import { authenticate, me, optionalAuth, requireRole, type AuthUser } from "../../lib/auth.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { bumpVersion, cacheVersion, kv } from "../../lib/redis.js";
import { body, csv, query, uuidParam } from "../../lib/validate.js";
import { emit } from "../../realtime/sse.js";
import { notify } from "../notifications/notify.js";

export const jobsRouter = Router();
export const employerRouter = Router();
export const adminJobsRouter = Router();

const PUBLIC_COLS = {
  id: jobs.id, title: jobs.title, company: jobs.company, description: jobs.description, requirements: jobs.requirements,
  skills: jobs.skills, location: jobs.location, workplace: jobs.workplace, employmentType: jobs.employmentType,
  experienceLevel: jobs.experienceLevel, salaryMin: jobs.salaryMin, salaryMax: jobs.salaryMax, currency: jobs.currency,
  publishedAt: jobs.publishedAt, closesAt: jobs.closesAt, employerId: jobs.employerId,
};
// NB: correlated subqueries name the outer table explicitly ("jobs"."id"): Drizzle omits
// table qualifiers in single-table selects, so ${jobs.id} would render as a bare "id".
// Live = published, not past its closing date, and posted by an employer who isn't suspended.
const employerActive = sql`exists (select 1 from users u where u.id = "jobs"."employer_id" and u.status = 'active')`;
const isOpen = and(eq(jobs.status, "published"), or(isNull(jobs.closesAt), sql`${jobs.closesAt} > now()`), employerActive);
export const invalidateJobCache = () => bumpVersion("jobs");

const pageQuery = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12) };
export const paged = <T>(items: T[], page: number, pageSize: number, total: number) => ({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

// ─── Public listing ──────────────────────────────────────────────────────────
const listQuery = z.object({
  ...pageQuery,
  q: z.string().trim().max(200).optional(),
  location: z.string().trim().max(120).optional(),
  type: csv(z.enum(employmentTypeEnum.enumValues)),
  workplace: csv(z.enum(workplaceEnum.enumValues)),
  experience: csv(z.enum(experienceEnum.enumValues)),
  salaryMin: z.coerce.number().int().min(0).optional(), // jobs that can pay at least this much
  salaryMax: z.coerce.number().int().min(0).optional(), // jobs whose floor is within budget
  postedWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  sort: z.enum(["newest", "salary_desc", "salary_asc", "relevance"]).default("newest"),
});

/**
 * Published, open jobs with filters and page-number pagination.
 * Result pages are cached in Redis for 60s; any job write bumps the version and invalidates them.
 */
jobsRouter.get("/", optionalAuth, async (req, res) => {
  const q = query(req, listQuery);
  const key = `jobs:list:${await cacheVersion("jobs")}:${JSON.stringify(q)}`;
  const page = await kv.wrap(key, 60, async () => {
    const ts = q.q ? sql`websearch_to_tsquery('english', ${q.q})` : null;
    const doc = sql`to_tsvector('english', ${jobs.title} || ' ' || ${jobs.company} || ' ' || ${jobs.description})`;
    const where = and(
      isOpen,
      q.q ? or(sql`${doc} @@ ${ts}`, ilike(jobs.title, `%${q.q}%`), sql`exists (select 1 from unnest(${jobs.skills}) s where s ilike ${q.q})`) : undefined,
      q.location ? ilike(jobs.location, `%${q.location}%`) : undefined,
      q.type?.length ? inArray(jobs.employmentType, q.type) : undefined,
      q.workplace?.length ? inArray(jobs.workplace, q.workplace) : undefined,
      q.experience?.length ? inArray(jobs.experienceLevel, q.experience) : undefined,
      q.salaryMin !== undefined ? sql`coalesce(${jobs.salaryMax}, ${jobs.salaryMin}) >= ${q.salaryMin}` : undefined,
      q.salaryMax !== undefined ? sql`coalesce(${jobs.salaryMin}, ${jobs.salaryMax}) <= ${q.salaryMax}` : undefined,
      q.postedWithinDays ? gte(jobs.publishedAt, new Date(Date.now() - q.postedWithinDays * 86400_000)) : undefined,
    );
    const order = q.sort === "salary_desc" ? [sql`${jobs.salaryMax} desc nulls last`, desc(jobs.publishedAt)]
      : q.sort === "salary_asc" ? [sql`${jobs.salaryMin} asc nulls last`, desc(jobs.publishedAt)]
      // Relevance weights title (A) over company (B) over description (C).
      : q.sort === "relevance" && ts ? [sql`ts_rank(setweight(to_tsvector('english', ${jobs.title}), 'A') || setweight(to_tsvector('english', ${jobs.company}), 'B') || setweight(to_tsvector('english', ${jobs.description}), 'C'), ${ts}) desc`, desc(jobs.publishedAt)]
      : [desc(jobs.publishedAt), desc(jobs.id)];
    const [[{ total }], items] = await Promise.all([
      db.select({ total: count() }).from(jobs).where(where),
      db.select({ ...PUBLIC_COLS, applicantCount: sql<number>`(select count(*)::int from applications a where a.job_id = "jobs"."id")` })
        .from(jobs).where(where).orderBy(...order).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paged(items.map((j) => ({ ...j, description: j.description.slice(0, 280) })), q.page, q.pageSize, total);
  });

  // Personalisation is layered on after the shared cache.
  const viewer = req.user;
  if (viewer?.role === "candidate" && page.items.length) {
    const applied = new Set((await db.select({ jobId: applications.jobId }).from(applications)
      .where(and(eq(applications.candidateId, viewer.id), inArray(applications.jobId, page.items.map((j) => j.id))))).map((r) => r.jobId));
    res.json({ ...page, items: page.items.map((j) => ({ ...j, hasApplied: applied.has(j.id) })) });
    return;
  }
  res.json(page);
});

/** Locations with open jobs, for the filter's suggestions. */
jobsRouter.get("/locations", async (_req, res) => {
  const items = await kv.wrap(`jobs:locations:${await cacheVersion("jobs")}`, 300, async () =>
    (await db.select({ location: jobs.location, n: count() }).from(jobs).where(isOpen).groupBy(jobs.location).orderBy(desc(count())).limit(30)));
  res.json({ items });
});

async function loadJob(id: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) throw notFound("Job");
  return job;
}
const canManage = (u: AuthUser | undefined, job: Job) => !!u && (u.role === "admin" || (u.role === "employer" && job.employerId === u.id));

jobsRouter.get("/:id", optionalAuth, async (req, res) => {
  const job = await loadJob(uuidParam(req, "id"));
  const manager = canManage(req.user, job);
  const [owner] = await db.select({ status: users.status }).from(users).where(eq(users.id, job.employerId));
  const visible = (job.status === "published" && owner?.status === "active") || manager;
  if (!visible) throw notFound("Job");
  let application: { id: string; status: string } | null = null;
  if (req.user?.role === "candidate") {
    [application] = await db.select({ id: applications.id, status: applications.status }).from(applications)
      .where(and(eq(applications.jobId, job.id), eq(applications.candidateId, req.user.id)));
  }
  const [{ applicantCount }] = await db.select({ applicantCount: count() }).from(applications).where(eq(applications.jobId, job.id));
  res.json({
    ...job,
    ...(manager ? {} : { rejectionReason: undefined, reviewedById: undefined }),
    isOpen: job.status === "published" && (!job.closesAt || job.closesAt > new Date()),
    applicantCount, myApplication: application ?? null, canManage: manager,
  });
});

// ─── Employer CRUD ───────────────────────────────────────────────────────────
const jobFields = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(30, "Describe the role in at least 30 characters").max(20_000),
  requirements: z.string().trim().max(10_000).nullable(),
  skills: z.array(z.string().trim().min(1).max(40)).max(25).transform((s) => [...new Set(s.map((x) => x.toLowerCase()))]),
  location: z.string().trim().min(1).max(120),
  workplace: z.enum(workplaceEnum.enumValues),
  employmentType: z.enum(employmentTypeEnum.enumValues),
  experienceLevel: z.enum(experienceEnum.enumValues),
  salaryMin: z.number().int().min(0).max(100_000_000).nullable(),
  salaryMax: z.number().int().min(0).max(100_000_000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  closesAt: z.coerce.date().nullable(),
});
const checkSalary = (v: { salaryMin?: number | null; salaryMax?: number | null }) => {
  if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) throw badRequest("Minimum salary can't exceed maximum salary");
};
// Edits to these fields on a live posting send it back to moderation.
const CONTENT_FIELDS = ["title", "description", "requirements", "skills", "salaryMin", "salaryMax", "location"] as const;

jobsRouter.post("/", authenticate, requireRole("employer"), async (req, res) => {
  const actor = me(req);
  const input = body(req, jobFields.partial().required({ title: true, description: true, location: true }).extend({ submit: z.boolean().default(true) }));
  checkSalary(input);
  if (input.closesAt && input.closesAt <= new Date()) throw badRequest("Closing date must be in the future");
  const [emp] = await db.select({ companyName: users.companyName }).from(users).where(eq(users.id, actor.id));
  const { submit, ...fields } = input;
  const [job] = await db.insert(jobs).values({
    ...fields, employerId: actor.id, company: emp.companyName ?? actor.name,
    status: submit ? "pending_review" : "draft", submittedAt: submit ? new Date() : null,
  }).returning();
  if (submit) await emit.toRole("admin", "job.submitted", { jobId: job.id, title: job.title, company: job.company });
  res.status(201).json(job);
});

jobsRouter.patch("/:id", authenticate, requireRole("employer", "admin"), async (req, res) => {
  const actor = me(req);
  const job = await loadJob(uuidParam(req, "id"));
  if (!canManage(actor, job)) throw notFound("Job");
  if (job.status === "closed") throw badRequest("Closed jobs can't be edited");
  const input = body(req, jobFields.partial());
  checkSalary({ salaryMin: input.salaryMin !== undefined ? input.salaryMin : job.salaryMin, salaryMax: input.salaryMax !== undefined ? input.salaryMax : job.salaryMax });
  const contentChanged = CONTENT_FIELDS.some((f) => f in input && JSON.stringify(input[f]) !== JSON.stringify(job[f]));
  const backToReview = actor.role === "employer" && job.status === "published" && contentChanged;
  const [updated] = await db.update(jobs).set({
    ...input, ...(backToReview ? { status: "pending_review" as const, submittedAt: new Date(), publishedAt: null } : {}),
  }).where(eq(jobs.id, job.id)).returning();
  await invalidateJobCache();
  if (backToReview) await emit.toRole("admin", "job.submitted", { jobId: job.id, title: updated.title, company: updated.company, resubmitted: true });
  res.json({ ...updated, requiresReview: backToReview });
});

jobsRouter.post("/:id/submit", authenticate, requireRole("employer"), async (req, res) => {
  const job = await loadJob(uuidParam(req, "id"));
  if (!canManage(me(req), job)) throw notFound("Job");
  if (job.status !== "draft" && job.status !== "rejected") throw badRequest(`A ${job.status.replace("_", " ")} job can't be submitted`);
  const [updated] = await db.update(jobs).set({ status: "pending_review", submittedAt: new Date(), rejectionReason: null }).where(eq(jobs.id, job.id)).returning();
  await emit.toRole("admin", "job.submitted", { jobId: job.id, title: job.title, company: job.company });
  res.json(updated);
});

jobsRouter.post("/:id/close", authenticate, requireRole("employer", "admin"), async (req, res) => {
  const job = await loadJob(uuidParam(req, "id"));
  if (!canManage(me(req), job)) throw notFound("Job");
  if (job.status !== "published") throw badRequest("Only published jobs can be closed");
  const [updated] = await db.update(jobs).set({ status: "closed" }).where(eq(jobs.id, job.id)).returning();
  await invalidateJobCache();
  await emit.toUser(job.employerId, "job.status_changed", { jobId: job.id, status: "closed" });
  res.json(updated);
});

jobsRouter.delete("/:id", authenticate, requireRole("employer", "admin"), async (req, res) => {
  const job = await loadJob(uuidParam(req, "id"));
  if (!canManage(me(req), job)) throw notFound("Job");
  const [{ n }] = await db.select({ n: count() }).from(applications).where(eq(applications.jobId, job.id));
  if (n > 0 && me(req).role !== "admin") throw conflict("This job has applicants. Close it instead of deleting it.");
  await db.delete(jobs).where(eq(jobs.id, job.id));
  await invalidateJobCache();
  res.status(204).end();
});

// ─── Employer: my jobs ───────────────────────────────────────────────────────
employerRouter.get("/jobs", async (req, res) => {
  const actor = me(req);
  const q = query(req, z.object({ ...pageQuery, status: csv(z.enum(jobStatusEnum.enumValues)) }));
  const where = and(eq(jobs.employerId, actor.id), q.status?.length ? inArray(jobs.status, q.status) : undefined);
  const [[{ total }], items] = await Promise.all([
    db.select({ total: count() }).from(jobs).where(where),
    db.select({
      job: jobs,
      applicants: sql<number>`(select count(*)::int from applications a where a.job_id = "jobs"."id")`,
      newApplicants: sql<number>`(select count(*)::int from applications a where a.job_id = "jobs"."id" and a.status = 'submitted')`,
      avgScore: sql<number | null>`(select round(avg(a.score))::int from applications a where a.job_id = "jobs"."id" and a.score is not null)`,
    }).from(jobs).where(where).orderBy(desc(jobs.updatedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  res.json(paged(items.map((r) => ({ ...r.job, applicants: r.applicants, newApplicants: r.newApplicants, avgScore: r.avgScore })), q.page, q.pageSize, total));
});

employerRouter.get("/stats", async (req, res) => {
  const actor = me(req);
  const mine = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.employerId, actor.id));
  const [[jobCounts], [appCounts]] = await Promise.all([
    db.select({
      total: count(), published: sql<number>`count(*) filter (where ${jobs.status} = 'published')::int`,
      pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending_review')::int`,
    }).from(jobs).where(eq(jobs.employerId, actor.id)),
    db.select({
      total: count(), new: sql<number>`count(*) filter (where ${applications.status} = 'submitted')::int`,
      interviewing: sql<number>`count(*) filter (where ${applications.status} = 'interview')::int`,
      avgScore: sql<number | null>`round(avg(${applications.score}))::int`,
    }).from(applications).where(inArray(applications.jobId, mine)),
  ]);
  res.json({ jobs: jobCounts, applications: appCounts });
});

// ─── Admin moderation ────────────────────────────────────────────────────────
adminJobsRouter.get("/", async (req, res) => {
  const q = query(req, z.object({ ...pageQuery, status: csv(z.enum(jobStatusEnum.enumValues)), q: z.string().trim().max(200).optional() }));
  const where = and(
    q.status?.length ? inArray(jobs.status, q.status) : undefined,
    q.q ? or(ilike(jobs.title, `%${q.q}%`), ilike(jobs.company, `%${q.q}%`)) : undefined,
  );
  const [[{ total }], items] = await Promise.all([
    db.select({ total: count() }).from(jobs).where(where),
    db.select({ job: jobs, employer: { id: users.id, name: users.name, email: users.email } }).from(jobs)
      .innerJoin(users, eq(users.id, jobs.employerId)).where(where)
      .orderBy(sql`case ${jobs.status} when 'pending_review' then 0 else 1 end`, asc(jobs.submittedAt), desc(jobs.createdAt))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  res.json(paged(items.map((r) => ({ ...r.job, employer: r.employer })), q.page, q.pageSize, total));
});

async function review(req: Request, approve: boolean) {
  const actor = me(req);
  const job = await loadJob(uuidParam(req, "id"));
  if (job.status !== "pending_review") throw badRequest(`Only jobs awaiting review can be ${approve ? "approved" : "rejected"} (this one is ${job.status.replace("_", " ")})`);
  const { reason } = body(req, approve ? z.object({ reason: z.string().optional() }) : z.object({ reason: z.string().trim().min(5, "Give the employer a reason (5+ characters)").max(2000) }));
  const [updated] = await db.update(jobs).set(approve
    ? { status: "published", publishedAt: job.publishedAt ?? new Date(), reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: null }
    : { status: "rejected", reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: reason }).where(eq(jobs.id, job.id)).returning();
  await invalidateJobCache();
  await emit.toUser(job.employerId, "job.status_changed", { jobId: job.id, status: updated.status, reason: updated.rejectionReason });
  notify.jobReviewed(updated, approve, reason);
  return updated;
}
adminJobsRouter.post("/:id/approve", async (req, res) => { res.json(await review(req, true)); });
adminJobsRouter.post("/:id/reject", async (req, res) => { res.json(await review(req, false)); });

