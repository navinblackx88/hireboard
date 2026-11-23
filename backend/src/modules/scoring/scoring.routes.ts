import { Router } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { me } from "../../lib/auth.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { body } from "../../lib/validate.js";
import { aiEnabled, scoreMatch } from "./scorer.js";

export const scoringRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === "test" ? 10_000 : 20, standardHeaders: "draft-8", legacyHeaders: false });

scoringRouter.get("/config", (_req, res) => {
  res.json({ provider: aiEnabled() ? "openai" : "heuristic", model: aiEnabled() ? env.OPENAI_MODEL : null });
});

/**
 * Synchronous match: resume text + a job (by id, or an ad-hoc description) → score and reasoning.
 * Applications are scored automatically in the background; this is for previews and tooling.
 */
scoringRouter.post("/match", limiter, async (req, res) => {
  const actor = me(req);
  const input = body(req, z.object({
    resumeText: z.string().trim().min(50, "Resume text is too short to score").max(50_000),
    jobId: z.uuid().optional(),
    jobTitle: z.string().trim().max(160).optional(),
    jobDescription: z.string().trim().min(30).max(20_000).optional(),
    skills: z.array(z.string().max(40)).max(25).optional(),
  }).refine((v) => v.jobId || (v.jobTitle && v.jobDescription), { message: "Provide jobId, or jobTitle and jobDescription" }));

  let job: { title: string; company?: string; description: string; requirements?: string | null; skills?: string[]; experienceLevel?: string };
  if (input.jobId) {
    const [j] = await db.select().from(jobs).where(eq(jobs.id, input.jobId));
    if (!j || (actor.role === "employer" && j.employerId !== actor.id)) throw notFound("Job");
    job = { ...j };
  } else job = { title: input.jobTitle!, description: input.jobDescription!, skills: input.skills };

  try {
    const r = await scoreMatch({ jobTitle: job.title, company: job.company, description: job.description, requirements: job.requirements, skills: job.skills, experienceLevel: job.experienceLevel, resumeText: input.resumeText });
    res.json(r);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "scoring_unavailable", `The AI scoring service failed: ${(e as Error).message}`);
  }
});

