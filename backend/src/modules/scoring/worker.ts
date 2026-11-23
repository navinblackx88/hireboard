import { eq, inArray, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { applications, jobs, resumes, type Application } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { emit } from "../../realtime/sse.js";
import { scoreMatch } from "./scorer.js";

/**
 * Scoring queue on Postgres: rows with score_status = 'pending' are claimed with
 * FOR UPDATE SKIP LOCKED, so any number of API instances can run workers safely.
 * A claim holds a 2-minute lease; crashed workers' rows become claimable again.
 * Failures retry with linear backoff up to SCORING_MAX_ATTEMPTS, then become 'failed'.
 */
async function claim(limit = 4): Promise<Application[]> {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    update applications a set score_status = 'processing', score_attempts = a.score_attempts + 1,
      score_locked_until = now() + interval '2 minutes'
    where a.id in (
      select id from applications
      where (score_status = 'pending' and (score_locked_until is null or score_locked_until <= now()))
         or (score_status = 'processing' and score_locked_until <= now())
      order by created_at
      for update skip locked
      limit ${limit})
    returning a.id`);
  if (!rows.length) return [];
  return db.select().from(applications).where(inArray(applications.id, rows.map((r) => r.id as string)));
}

async function scoreOne(app: Application) {
  const [ctx] = await db.select({ job: jobs, resumeText: resumes.extractedText }).from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId)).innerJoin(resumes, eq(resumes.id, applications.resumeId))
    .where(eq(applications.id, app.id));
  if (!ctx) return;
  try {
    const r = await scoreMatch({
      jobTitle: ctx.job.title, company: ctx.job.company, description: ctx.job.description, requirements: ctx.job.requirements,
      skills: ctx.job.skills, experienceLevel: ctx.job.experienceLevel, resumeText: ctx.resumeText,
    });
    await db.update(applications).set({
      scoreStatus: "completed", score: r.score, scoreSummary: r.summary, scoreStrengths: r.strengths, scoreGaps: r.gaps,
      scoreProvider: r.provider, scoredAt: new Date(), scoreError: null, scoreLockedUntil: null,
    }).where(eq(applications.id, app.id));
    await emit.toUser(ctx.job.employerId, "application.scored", { applicationId: app.id, jobId: ctx.job.id, score: r.score, scoreStatus: "completed" });
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? "Unknown error";
    const final = app.scoreAttempts >= env.SCORING_MAX_ATTEMPTS;
    logger.warn({ err: message, applicationId: app.id, attempt: app.scoreAttempts, final }, "scoring failed");
    await db.update(applications).set(final
      ? { scoreStatus: "failed", scoreError: message, scoreLockedUntil: null }
      : { scoreStatus: "pending", scoreError: message, scoreLockedUntil: new Date(Date.now() + app.scoreAttempts * 10_000) })
      .where(eq(applications.id, app.id));
    if (final) await emit.toUser(ctx.job.employerId, "application.scored", { applicationId: app.id, jobId: ctx.job.id, score: null, scoreStatus: "failed" });
  }
}

/** Processes one batch. Returns how many applications were attempted. */
export async function drainScoringQueue(limit = 4) {
  const batch = await claim(limit);
  await Promise.all(batch.map(scoreOne));
  return batch.length;
}

export function startScoringWorker() {
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { while (!stopped && (await drainScoringQueue()) > 0) { /* keep draining */ } }
    catch (err) { logger.error({ err }, "scoring worker error"); }
    finally { running = false; }
  };
  const timer = setInterval(tick, env.SCORING_POLL_MS);
  timer.unref();
  return { kick: () => void tick(), stop: () => { stopped = true; clearInterval(timer); } };
}

/** Drains the queue in bounded batches. Returns how many were attempted. */
export async function drainAll(maxBatches = 25) {
  let n = 0;
  for (let i = 0; i < maxBatches; i++) {
    const done = await drainScoringQueue();
    if (!done) break;
    n += done;
  }
  return n;
}

let worker: ReturnType<typeof startScoringWorker> | null = null;
export const setWorker = (w: typeof worker) => { worker = w; };
/** Called after a new application so scoring starts immediately rather than on the next poll. */
export const kickScoring = () => worker?.kick();
