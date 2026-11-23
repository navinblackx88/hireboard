import { Router } from "express";
import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { applications, emailLog, jobs, roleEnum, userStatusEnum, users } from "../../db/schema.js";
import { endAllSessions, forgetAuthUser, me } from "../../lib/auth.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { kv } from "../../lib/redis.js";
import { body, query, uuidParam } from "../../lib/validate.js";
import { invalidateJobCache, paged } from "../jobs/job.routes.js";

export const adminRouter = Router();

// ─── Users ───────────────────────────────────────────────────────────────────
adminRouter.get("/users", async (req, res) => {
  const q = query(req, z.object({
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(), role: z.enum(roleEnum.enumValues).optional(), status: z.enum(userStatusEnum.enumValues).optional(),
  }));
  const where = and(
    q.q ? or(ilike(users.name, `%${q.q}%`), ilike(users.email, `%${q.q}%`), ilike(users.companyName, `%${q.q}%`)) : undefined,
    q.role ? eq(users.role, q.role) : undefined, q.status ? eq(users.status, q.status) : undefined,
  );
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(users).where(where),
    db.select({
      id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, companyName: users.companyName,
      createdAt: users.createdAt, lastLoginAt: users.lastLoginAt,
      jobCount: sql<number>`(select count(*)::int from jobs j where j.employer_id = "users"."id")`,
      applicationCount: sql<number>`(select count(*)::int from applications a where a.candidate_id = "users"."id")`,
    }).from(users).where(where).orderBy(desc(users.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  res.json(paged(rows, q.page, q.pageSize, total));
});

adminRouter.patch("/users/:id", async (req, res) => {
  const actor = me(req);
  const id = uuidParam(req, "id");
  if (id === actor.id) throw badRequest("You can't change your own role or status");
  const input = body(req, z.object({ role: z.enum(roleEnum.enumValues).optional(), status: z.enum(userStatusEnum.enumValues).optional() })
    .refine((v) => v.role || v.status, { message: "Provide role or status" }));
  const [u] = await db.update(users).set(input).where(eq(users.id, id)).returning();
  if (!u) throw notFound("User");
  await forgetAuthUser(id); // takes effect on the user's next request
  if (input.status === "suspended") await endAllSessions(id);
  // Suspending hides an employer's postings from search; reactivating restores them.
  if (input.status && u.role === "employer") await invalidateJobCache();
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status });
});

adminRouter.get("/emails", async (req, res) => {
  const q = query(req, z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), template: z.string().max(60).optional() }));
  const where = q.template ? eq(emailLog.template, q.template) : undefined;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(emailLog).where(where),
    db.select().from(emailLog).where(where).orderBy(desc(emailLog.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);
  res.json(paged(rows, q.page, q.pageSize, total));
});

// ─── Analytics ───────────────────────────────────────────────────────────────
/** Platform analytics for the admin dashboard. Cached in Redis for 60 seconds. */
adminRouter.get("/analytics", async (req, res) => {
  const { days } = query(req, z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }));
  res.json(await kv.wrap(`admin:analytics:${days}`, 60, () => buildAnalytics(days)));
});

async function buildAnalytics(days: number) {
  const since = new Date(Date.now() - (days - 1) * 86400_000);
  since.setUTCHours(0, 0, 0, 0);
  const series = (table: "applications" | "users" | "jobs", col = "created_at") => db.execute<{ day: string; n: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(c.n, 0)::int as n
    from generate_series(${since}::date, current_date, interval '1 day') d(day)
    left join (select date_trunc('day', ${sql.raw(col)}) as day, count(*) as n from ${sql.raw(table)} where ${sql.raw(col)} >= ${since} group by 1) c on c.day = d.day
    order by d.day`);

  const [usersByRole, jobsByStatus, appsByStatus, appSeries, signupSeries, scoreBuckets, topJobs, [avg], [review]] = await Promise.all([
    db.select({ key: users.role, n: count() }).from(users).groupBy(users.role),
    db.select({ key: jobs.status, n: count() }).from(jobs).groupBy(jobs.status),
    db.select({ key: applications.status, n: count() }).from(applications).groupBy(applications.status),
    series("applications"),
    series("users"),
    db.execute<{ bucket: number; n: number }>(sql`
      select least(floor(score / 20), 4)::int as bucket, count(*)::int as n from applications where score is not null group by 1 order by 1`),
    db.select({ id: jobs.id, title: jobs.title, company: jobs.company, applicants: count(applications.id), avgScore: sql<number | null>`round(avg(${applications.score}))::int` })
      .from(jobs).innerJoin(applications, eq(applications.jobId, jobs.id)).where(gte(applications.createdAt, since))
      .groupBy(jobs.id).orderBy(desc(count(applications.id))).limit(5),
    db.select({ avgScore: sql<number | null>`round(avg(${applications.score}), 1)::float`, scored: sql<number>`count(${applications.score})::int` }).from(applications),
    db.select({ hours: sql<number | null>`round(extract(epoch from avg(${jobs.reviewedAt} - ${jobs.submittedAt})) / 3600, 1)::float` }).from(jobs).where(sql`${jobs.reviewedAt} is not null and ${jobs.submittedAt} is not null`),
  ]);
  const toMap = (rows: { key: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.n]));
  const buckets = ["0–19", "20–39", "40–59", "60–79", "80–100"].map((label, i) => ({ label, n: scoreBuckets.rows.find((b) => b.bucket === i)?.n ?? 0 }));
  const apps = toMap(appsByStatus);
  const funnelOrder = ["submitted", "reviewing", "shortlisted", "interview", "offered", "hired"] as const;
  // Funnel counts everyone who reached a stage or beyond.
  const reached = funnelOrder.map((s, i) => ({ stage: s, n: funnelOrder.slice(i).reduce((sum, k) => sum + (apps[k] ?? 0), 0) + (i === 0 ? (apps.rejected ?? 0) + (apps.withdrawn ?? 0) : 0) }));
  return {
    range: { days, since: since.toISOString() },
    totals: {
      users: toMap(usersByRole), jobs: toMap(jobsByStatus), applications: apps,
      pendingReview: toMap(jobsByStatus).pending_review ?? 0,
      avgScore: avg.avgScore, scoredApplications: avg.scored, avgReviewHours: review.hours,
    },
    applicationsPerDay: appSeries.rows,
    signupsPerDay: signupSeries.rows,
    scoreDistribution: buckets,
    funnel: reached,
    topJobs,
  };
}
