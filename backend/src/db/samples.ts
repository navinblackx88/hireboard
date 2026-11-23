/**
 * Loads the sample jobs, resumes and applications from /samples straight into the database, the same data that
 * samples/load-samples.mjs sends over the API. Runs once: if the sample employer already exists it does nothing,
 * so deleting sample jobs later won't bring them back.
 *
 * Runs automatically at container start when LOAD_SAMPLE_DATA=true (railway/start.sh, backend/Dockerfile).
 * By hand:  node dist/db/samples.js [--force]      (--force reloads anything that's missing)
 *
 * Applications are left "pending", so the scoring worker scores them with whichever provider is configured
 * (Claude, Gemini, OpenAI or the keyword scorer) as soon as the API starts.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "./index.js";
import { runMigrations } from "./migrate.js";
import { applicationEvents, applications, jobs, resumes, users } from "./schema.js";
import { extractText, RESUME_TYPES } from "../lib/extract.js";
import { storage } from "../lib/storage.js";
import { bumpVersion, closeRedis } from "../lib/redis.js";

type JobSpec = Omit<typeof jobs.$inferInsert, "employerId" | "company"> & { key: string };
type Candidate = { name: string; email: string; headline: string; location: string; resume: string; apply: { job: string }[] };

const here = path.dirname(fileURLToPath(import.meta.url));
/** /app/samples in the Docker image; <repo>/samples when run from source (backend/src/db or backend/dist/db). */
export const samplesDir = () => process.env.SAMPLES_DIR ?? path.resolve(here, "../../../samples");

export async function loadSamples({ force = false, log = console.log } = {}) {
  const dir = samplesDir();
  const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
  if (!fs.existsSync(path.join(dir, "jobs.json"))) throw new Error(`Sample data not found in ${dir} (set SAMPLES_DIR)`);
  const { employer, jobs: jobSpecs } = read<{ employer: { name: string; email: string; companyName: string }; jobs: JobSpec[] }>("jobs.json");
  const { candidates } = read<{ candidates: Candidate[] }>("applications.json");
  const password = process.env.SAMPLE_PASSWORD ?? "password123";

  const [existing] = await db.select().from(users).where(eq(users.email, employer.email));
  if (existing && !force) { log(`Sample data already loaded (${employer.email} exists); skipping.`); return { skipped: true, jobs: 0, applications: 0 }; }

  const hash = await bcrypt.hash(password, 10);
  const findOrCreateUser = async (v: Omit<typeof users.$inferInsert, "passwordHash">) => {
    const [u] = await db.select().from(users).where(eq(users.email, v.email));
    // Sample addresses are @example.com; keep notification emails off so nothing tries to send to them.
    return u ?? (await db.insert(users).values({ ...v, passwordHash: hash, emailNotifications: false }).returning())[0];
  };

  const emp = existing ?? await findOrCreateUser({ name: employer.name, email: employer.email, role: "employer", companyName: employer.companyName });
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);

  const jobIds: Record<string, string> = {};
  let jobsCreated = 0;
  for (const { key, ...spec } of jobSpecs) {
    const [found] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.employerId, emp.id), eq(jobs.title, spec.title)));
    if (found) { jobIds[key] = found.id; continue; }
    const now = new Date();
    const [j] = await db.insert(jobs).values({
      ...spec, skills: [...new Set((spec.skills ?? []).map((s) => s.toLowerCase()))],
      employerId: emp.id, company: employer.companyName,
      status: "published", submittedAt: now, publishedAt: now, reviewedAt: now, reviewedById: admin?.id ?? null,
    }).returning({ id: jobs.id });
    jobIds[key] = j.id; jobsCreated++;
  }

  let appsCreated = 0;
  for (const c of candidates) {
    const u = await findOrCreateUser({ name: c.name, email: c.email, role: "candidate", headline: c.headline, location: c.location });
    let [r] = await db.select().from(resumes).where(and(eq(resumes.candidateId, u.id), eq(resumes.filename, c.resume), isNull(resumes.deletedAt)));
    if (!r) {
      const buf = fs.readFileSync(path.join(dir, "resumes", c.resume));
      const { kind, text, pageCount } = await extractText(buf);
      const storageKey = `resumes/${u.id}/${crypto.randomUUID()}.${kind}`;
      await storage.put(storageKey, buf, RESUME_TYPES[kind]);
      [r] = await db.insert(resumes).values({
        candidateId: u.id, filename: c.resume, mimeType: RESUME_TYPES[kind], sizeBytes: buf.length, storageKey, extractedText: text, pageCount, isDefault: true,
      }).returning();
    }
    for (const a of c.apply) {
      const jobId = jobIds[a.job];
      if (!jobId) throw new Error(`applications.json: ${c.name} applies to unknown job key "${a.job}"`);
      const [dupe] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.jobId, jobId), eq(applications.candidateId, u.id)));
      if (dupe) continue;
      await db.transaction(async (tx) => {
        const [app] = await tx.insert(applications).values({
          jobId, candidateId: u.id, resumeId: r.id, coverLetter: `Hello — I'd like to be considered for this role. My resume is attached.\n\n${c.name}`,
        }).returning({ id: applications.id });
        await tx.insert(applicationEvents).values({ applicationId: app.id, toStatus: "submitted", actorId: u.id });
      });
      appsCreated++;
    }
  }
  await bumpVersion("jobs"); // public job-board caches
  log(`Sample data loaded: ${jobsCreated} jobs and ${appsCreated} applications from ${candidates.length} candidates. Sign in as ${employer.email} / ${password === "password123" ? "password123" : "(SAMPLE_PASSWORD)"}.`);
  return { skipped: false, jobs: jobsCreated, applications: appsCreated };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => loadSamples({ force: process.argv.includes("--force") }))
    .then(async () => { await pool.end(); await closeRedis(); process.exit(0); })
    .catch((e) => { console.error("Loading sample data failed:", e); process.exit(1); });
}
