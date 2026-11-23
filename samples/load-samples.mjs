#!/usr/bin/env node
/**
 * Loads the sample jobs and "forwards" the sample resumes to them as applications, through HireFlow's public API.
 * Safe to run more than once: existing accounts, jobs, resumes and applications are reused, not duplicated.
 *
 *   node samples/load-samples.mjs                                  # local Docker demo (http://localhost:8080)
 *   node samples/load-samples.mjs --url https://your-app.up.railway.app --admin-email you@x.com --admin-password '…'
 *
 * Options (or environment variables):
 *   --url              HIREFLOW_URL        default http://localhost:8080
 *   --admin-email      ADMIN_EMAIL         default admin@hireflow.dev   (approves the sample jobs)
 *   --admin-password   ADMIN_PASSWORD      default password123
 *   --password         SAMPLE_PASSWORD     password for the sample employer and candidates, default password123
 *
 * Needs Node 18+ (built-in fetch). No npm install required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = (args.url ?? process.env.HIREFLOW_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const ADMIN = { email: args["admin-email"] ?? process.env.ADMIN_EMAIL ?? "admin@hireflow.dev", password: args["admin-password"] ?? process.env.ADMIN_PASSWORD ?? "password123" };
const PASSWORD = args.password ?? process.env.SAMPLE_PASSWORD ?? "password123";

const { employer, jobs } = JSON.parse(fs.readFileSync(path.join(here, "jobs.json"), "utf8"));
const { candidates } = JSON.parse(fs.readFileSync(path.join(here, "applications.json"), "utf8"));
const MIME = { ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

class ApiError extends Error { constructor(status, body, where) { super(`${where}: HTTP ${status} ${body?.error?.message ?? ""}`.trim()); this.status = status; this.body = body; } }

async function api(method, p, { token, json, form } = {}) {
  const res = await fetch(`${BASE}/api/v1${p}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(json) : form,
  }).catch((e) => { throw new Error(`Can't reach ${BASE} (${e.cause?.code ?? e.message}). Is HireFlow running, and is --url right?`); });
  const text = await res.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : null;
  if (res.status === 429) throw new Error("Rate limited by HireFlow (sign-ins are capped per 15 minutes). Wait 15 minutes and run again; finished steps are skipped.");
  if (!res.ok) throw new ApiError(res.status, body, `${method} ${p}`);
  return body;
}

/** Signs in, or creates the account if it doesn't exist yet. */
async function loginOrSignup(profile) {
  try {
    return { ...(await api("POST", "/auth/login", { json: { email: profile.email, password: profile.password } })), created: false };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    if (!profile.role) throw new Error(`Couldn't sign in as ${profile.email}: check the email and password.`);
    try {
      return { ...(await api("POST", "/auth/signup", { json: profile })), created: true };
    } catch (s) {
      if (s instanceof ApiError && s.status === 409) throw new Error(`${profile.email} already exists with a different password. Pass that password with --password.`);
      throw s;
    }
  }
}

const log = (...m) => console.log(...m);
const tick = (s) => `  ✓ ${s}`;

async function main() {
  log(`HireFlow samples → ${BASE}\n`);
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.checks?.db) throw new Error(`${BASE}/health didn't report a healthy database. Check the URL and that the app is up.`);

  // 1. Admin (approves jobs) and the sample employer
  const admin = await loginOrSignup(ADMIN);
  if (admin.user.role !== "admin") throw new Error(`${ADMIN.email} isn't an admin account.`);
  log(tick(`signed in as admin ${ADMIN.email}`));
  const emp = await loginOrSignup({ ...employer, password: PASSWORD, role: "employer" });
  log(tick(`${emp.created ? "created" : "signed in as"} employer ${employer.email} (${employer.companyName})`));

  // 2. Jobs: create, submit and approve, reusing any that already exist by title
  const existing = [];
  for (let page = 1; ; page++) {
    const r = await api("GET", `/employer/jobs?pageSize=50&page=${page}`, { token: emp.accessToken });
    existing.push(...(r.items ?? []));
    if (page >= (r.totalPages ?? 1)) break;
  }
  const jobIds = {};
  for (const j of jobs) {
    const { key, ...fields } = j;
    let job = existing.find((e) => e.title === j.title);
    if (!job) job = await api("POST", "/jobs", { token: emp.accessToken, json: { ...fields, submit: true } });
    if (job.status === "pending_review") job = await api("POST", `/admin/jobs/${job.id}/approve`, { token: admin.accessToken, json: {} });
    jobIds[key] = job.id;
    log(tick(`job "${j.title}" — ${job.status}`));
  }

  // 3. Candidates: sign up, upload their resume, and apply ("forward" the resume) to their jobs
  const counts = Object.fromEntries(jobs.map((j) => [j.key, 0]));
  for (const c of candidates) {
    const s = await loginOrSignup({ name: c.name, email: c.email, password: PASSWORD, role: "candidate", headline: c.headline, location: c.location });
    const mine = (await api("GET", "/resumes", { token: s.accessToken })).items ?? [];
    let resume = mine.find((r) => r.filename === c.resume);
    if (!resume) {
      const file = path.join(here, "resumes", c.resume);
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(file)], { type: MIME[path.extname(file)] }), c.resume);
      resume = await api("POST", "/resumes", { token: s.accessToken, form });
    }
    const sent = [];
    for (const a of c.apply) {
      const jobId = jobIds[a.job];
      try {
        await api("POST", `/jobs/${jobId}/applications`, { token: s.accessToken, json: { resumeId: resume.id, coverLetter: `Hello — I'd like to be considered for this role. My resume is attached.\n\n${c.name}` } });
        sent.push(a.job);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e; // 409 = already applied
        sent.push(`${a.job} (already)`);
      }
      counts[a.job]++;
    }
    log(tick(`${c.name}: ${c.resume} → ${sent.join(", ")}`));
  }

  // 4. Summary
  log("\nApplications per job:");
  for (const j of jobs) log(`  ${String(counts[j.key]).padStart(2)}  ${j.title}`);
  log(`
Done. Sign in at ${BASE} as ${employer.email} / ${PASSWORD === "password123" ? "password123" : "(your --password)"} to review applicants.
Scores appear within a few seconds as the scoring queue works through them.
Expected fit for each resume: samples/applications.json. Every sample candidate uses the same password.`);
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
