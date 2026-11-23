/**
 * Demo data. Every account's password is: password123
 *   admin@hireflow.dev (admin) · nina@northwind.dev, leo@lumenhealth.dev (employers)
 *   asha@example.dev, ravi@example.dev, meera@example.dev, karan@example.dev, zoe@example.dev (candidates)
 * Run: npm run db:seed [-- --force]
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool } from "./index.js";
import { runMigrations } from "./migrate.js";
import { applicationEvents, applications, jobs, resumes, users, type ApplicationStatus } from "./schema.js";
import { makeDocx, makePdf } from "./fake-resumes.js";
import { extractText, RESUME_TYPES } from "../lib/extract.js";
import { storage } from "../lib/storage.js";
import { scoreHeuristically } from "../modules/scoring/scorer.js";
import { closeRedis } from "../lib/redis.js";

const DAY = 86400_000;
const ago = (d: number, h = 0) => new Date(Date.now() - d * DAY - h * 3600_000);

async function main() {
  await runMigrations();
  const { rows: [{ n }] } = await pool.query("select count(*)::int as n from users");
  if (n > 0) {
    if (!process.argv.includes("--force")) { console.log("Database has users; skipping (use --force to wipe and reseed)."); return; }
    const tables = (await pool.query(`select tablename from pg_tables where schemaname='public'`)).rows.map((r) => `"${r.tablename}"`);
    await pool.query(`truncate ${tables.join(",")} cascade`);
  }
  const hash = await bcrypt.hash("password123", 10);
  const mk = (v: Partial<typeof users.$inferInsert> & { name: string; email: string; role: "admin" | "employer" | "candidate" }, days: number) =>
    db.insert(users).values({ passwordHash: hash, emailNotifications: false, createdAt: ago(days), lastLoginAt: ago(Math.max(0, days - 3)), ...v }).returning().then((r) => r[0]);

  const admin = await mk({ name: "Priya Admin", email: "admin@hireflow.dev", role: "admin" }, 60);
  const nina = await mk({ name: "Nina Patel", email: "nina@northwind.dev", role: "employer", companyName: "Northwind Labs", companyWebsite: "https://northwind.example" }, 45);
  const leo = await mk({ name: "Leo Fischer", email: "leo@lumenhealth.dev", role: "employer", companyName: "Lumen Health", companyWebsite: "https://lumen.example" }, 38);

  type C = { name: string; email: string; headline: string; location: string; skills: string[]; years: number; title: string; days: number; docx?: boolean };
  const people: C[] = [
    { name: "Asha Verma", email: "asha@example.dev", headline: "Senior backend engineer · payments", location: "Bengaluru", skills: ["typescript", "node.js", "postgresql", "aws", "kafka", "docker"], years: 7, title: "Senior Software Engineer", days: 28 },
    { name: "Ravi Kumar", email: "ravi@example.dev", headline: "Full-stack developer", location: "Pune", skills: ["react", "typescript", "node.js", "graphql", "tailwind"], years: 4, title: "Software Engineer", days: 25, docx: true },
    { name: "Meera Iyer", email: "meera@example.dev", headline: "Data analyst turning data into decisions", location: "Mumbai", skills: ["sql", "python", "tableau", "excel", "statistics"], years: 2, title: "Data Analyst", days: 20 },
    { name: "Karan Shah", email: "karan@example.dev", headline: "Platform & SRE", location: "Remote", skills: ["kubernetes", "terraform", "aws", "go", "prometheus"], years: 6, title: "Site Reliability Engineer", days: 17 },
    { name: "Zoe Martin", email: "zoe@example.dev", headline: "Product designer", location: "Remote", skills: ["figma", "user research", "design systems", "prototyping"], years: 5, title: "Product Designer", days: 12, docx: true },
  ];
  const cands = [];
  for (const p of people) {
    const u = await mk({ name: p.name, email: p.email, role: "candidate", headline: p.headline, location: p.location }, p.days);
    const lines = [
      p.name, `${p.title} · ${p.location} · ${p.email}`,
      `Summary: ${p.headline}. ${p.years} years of experience shipping production work in fast-moving teams.`,
      `Skills: ${p.skills.join(", ")}`, "Experience",
      `Brightline — ${p.title} (${2025 - Math.min(p.years, 3)}–present): Led ${p.skills[0]} and ${p.skills[1]} work across three product squads; mentored two engineers.`,
      `Copperleaf — ${p.title.replace("Senior ", "")} (${2025 - p.years}–${2025 - Math.min(p.years, 3)}): Built features with ${p.skills.slice(2).join(", ")}.`,
      "Education: B.Tech / B.Des, 2017",
    ];
    const buf = p.docx ? await makeDocx(lines) : await makePdf(lines);
    const { kind, text, pageCount } = await extractText(buf);
    const key = `resumes/${u.id}/${crypto.randomUUID()}.${kind}`;
    await storage.put(key, buf, RESUME_TYPES[kind]);
    const [r] = await db.insert(resumes).values({
      candidateId: u.id, filename: `${p.name.replace(" ", "_")}_Resume.${kind}`, mimeType: RESUME_TYPES[kind], sizeBytes: buf.length,
      storageKey: key, extractedText: text, pageCount, isDefault: true, createdAt: ago(p.days - 1),
    }).returning();
    cands.push({ user: u, resume: r, ...p });
  }

  type J = Omit<typeof jobs.$inferInsert, "employerId" | "company"> & { by: typeof nina; days: number };
  const desc = (what: string) => `${what}\n\nYou'll work in a small, senior team with real ownership: from design docs to production. We value clear writing, pragmatic decisions and kindness.\n\nWhat we offer: flexible hours, learning budget, health cover for you and your family.`;
  const J = (v: J) => v;
  const jobSpecs: J[] = [
    J({ by: nina, days: 26, title: "Senior Backend Engineer, Payments", location: "Bengaluru, India", workplace: "hybrid", employmentType: "full_time", experienceLevel: "senior", salaryMin: 3_200_000, salaryMax: 4_800_000, currency: "INR", skills: ["typescript", "node.js", "postgresql", "aws", "kafka"], description: desc("Design and scale the event-driven services behind our payments platform, processing millions of transactions a day."), requirements: "5+ years building backend systems in TypeScript or Go\nDeep PostgreSQL experience\nAWS in production; Kafka a plus" }),
    J({ by: nina, days: 22, title: "Full-Stack Engineer (React + Node)", location: "Pune, India", workplace: "hybrid", employmentType: "full_time", experienceLevel: "mid", salaryMin: 1_800_000, salaryMax: 2_800_000, currency: "INR", skills: ["react", "typescript", "node.js", "graphql"], description: desc("Own features end to end across our customer dashboard and the APIs behind it."), requirements: "3+ years with React and TypeScript\nComfortable writing Node.js APIs\nGraphQL experience is a plus" }),
    J({ by: nina, days: 18, title: "Site Reliability Engineer", location: "Remote, India", workplace: "remote", employmentType: "full_time", experienceLevel: "senior", salaryMin: 3_000_000, salaryMax: 4_200_000, currency: "INR", skills: ["kubernetes", "terraform", "aws", "prometheus"], description: desc("Keep our platform fast and reliable: own Kubernetes, observability and incident response."), requirements: "Kubernetes and Terraform in production\nStrong Linux and networking fundamentals\nOn-call experience" }),
    J({ by: nina, days: 15, title: "Frontend Engineer, Design Systems", location: "Bengaluru, India", workplace: "onsite", employmentType: "full_time", experienceLevel: "mid", salaryMin: 2_000_000, salaryMax: 3_000_000, currency: "INR", skills: ["react", "typescript", "tailwind", "accessibility"], description: desc("Build and maintain our component library used by six product teams."), requirements: "Strong React and CSS skills\nAccessibility know-how (WCAG)\nAn eye for detail" }),
    J({ by: nina, days: 10, title: "Engineering Intern (Summer)", location: "Bengaluru, India", workplace: "onsite", employmentType: "internship", experienceLevel: "entry", salaryMin: 480_000, salaryMax: 600_000, currency: "INR", skills: ["javascript", "python", "git"], description: desc("A 12-week internship pairing with senior engineers on real product work."), requirements: "Currently studying CS or similar\nSome JavaScript or Python" }),
    J({ by: nina, days: 7, title: "Contract DevOps Engineer (6 months)", location: "Remote", workplace: "remote", employmentType: "contract", experienceLevel: "senior", salaryMin: 2_400_000, salaryMax: 3_000_000, currency: "INR", skills: ["aws", "terraform", "ci/cd", "docker"], description: desc("Migrate our CI/CD to GitHub Actions and codify infrastructure in Terraform."), requirements: "Terraform and AWS\nCI/CD pipeline design" }),
    J({ by: leo, days: 24, title: "Data Analyst, Clinical Operations", location: "Mumbai, India", workplace: "hybrid", employmentType: "full_time", experienceLevel: "entry", salaryMin: 900_000, salaryMax: 1_400_000, currency: "INR", skills: ["sql", "python", "tableau", "statistics"], description: desc("Turn clinic operations data into dashboards and insights that improve patient wait times."), requirements: "SQL fluency\nPython or R for analysis\nDashboarding (Tableau/Looker)" }),
    J({ by: leo, days: 20, title: "Senior Product Designer", location: "Remote", workplace: "remote", employmentType: "full_time", experienceLevel: "senior", salaryMin: 2_800_000, salaryMax: 3_800_000, currency: "INR", skills: ["figma", "user research", "design systems", "prototyping"], description: desc("Lead design for our patient app, from research through polished UI."), requirements: "5+ years product design\nPortfolio of shipped mobile work\nResearch skills" }),
    J({ by: leo, days: 14, title: "Part-time UX Researcher", location: "Delhi, India", workplace: "hybrid", employmentType: "part_time", experienceLevel: "mid", salaryMin: 700_000, salaryMax: 1_000_000, currency: "INR", skills: ["user research", "interviewing", "synthesis"], description: desc("Run interviews and usability studies with patients and clinicians, 20 hours a week."), requirements: "Experience planning and running studies\nClear synthesis and storytelling" }),
    J({ by: leo, days: 9, title: "Machine Learning Engineer", location: "Bengaluru, India", workplace: "hybrid", employmentType: "full_time", experienceLevel: "lead", salaryMin: 4_500_000, salaryMax: 6_500_000, currency: "INR", skills: ["python", "pytorch", "mlops", "aws"], description: desc("Lead our triage-model work, from data pipelines to safe deployment."), requirements: "Shipped ML models to production\nPython and PyTorch\nMLOps" }),
    J({ by: leo, days: 5, title: "Temporary Data Entry Specialist", location: "Mumbai, India", workplace: "onsite", employmentType: "temporary", experienceLevel: "entry", salaryMin: 300_000, salaryMax: 360_000, currency: "INR", skills: ["excel", "attention to detail"], description: desc("Help digitise 20 years of clinic records over a three-month project."), requirements: "Fast, accurate typing\nExcel basics" }),
    J({ by: leo, days: 3, title: "Backend Engineer (Go)", location: "Hyderabad, India", workplace: "onsite", employmentType: "full_time", experienceLevel: "mid", salaryMin: null, salaryMax: null, currency: "INR", skills: ["go", "postgresql", "grpc"], description: desc("Build the scheduling service that books 50k appointments a day."), requirements: "Go in production\nPostgreSQL\ngRPC" }),
  ];
  const jobRows = [];
  for (const { by, days, ...spec } of jobSpecs) {
    const [j] = await db.insert(jobs).values({ ...spec, employerId: by.id, company: by.companyName!, status: "published", submittedAt: ago(days, 6), reviewedAt: ago(days, 2), reviewedById: admin.id, publishedAt: ago(days), createdAt: ago(days, 7) }).returning();
    jobRows.push(j);
  }
  // Moderation queue and other states
  await db.insert(jobs).values([
    { employerId: nina.id, company: "Northwind Labs", title: "Staff Engineer, Platform", location: "Bengaluru, India", workplace: "hybrid", employmentType: "full_time", experienceLevel: "lead", salaryMin: 6_000_000, salaryMax: 8_000_000, currency: "INR", skills: ["distributed systems", "go", "kubernetes"], description: desc("Set technical direction for our platform group."), status: "pending_review", submittedAt: ago(0, 5), createdAt: ago(0, 6) },
    { employerId: leo.id, company: "Lumen Health", title: "Marketing Associate", location: "Delhi, India", workplace: "onsite", employmentType: "full_time", experienceLevel: "entry", salaryMin: 600_000, salaryMax: 800_000, currency: "INR", skills: ["content", "social media"], description: desc("Grow our patient community through content and campaigns."), status: "pending_review", submittedAt: ago(1, 2), createdAt: ago(1, 3) },
    { employerId: leo.id, company: "Lumen Health", title: "Earn ₹50,000/day from home!!!", location: "Anywhere", workplace: "remote", employmentType: "part_time", experienceLevel: "entry", currency: "INR", skills: [], description: desc("No experience needed. Pay a registration fee to start."), status: "rejected", rejectionReason: "Postings that ask candidates to pay fees aren't allowed.", submittedAt: ago(4), reviewedAt: ago(3), reviewedById: admin.id, createdAt: ago(4, 1) },
    { employerId: nina.id, company: "Northwind Labs", title: "Engineering Manager (draft)", location: "Bengaluru, India", workplace: "hybrid", employmentType: "full_time", experienceLevel: "lead", currency: "INR", skills: ["leadership"], description: desc("Lead a team of eight engineers."), status: "draft", createdAt: ago(2) },
  ]);

  // Applications: who applied where, and how far they got.
  const plan: [number, number, ApplicationStatus[], number][] = [
    // [candidate, job, status path after submitted, days ago]
    [0, 0, ["reviewing", "shortlisted", "interview"], 20], [1, 0, ["reviewing", "rejected"], 19], [3, 0, ["reviewing"], 14],
    [1, 1, ["shortlisted", "interview", "offered"], 18], [0, 1, ["reviewing"], 16],
    [3, 2, ["shortlisted", "interview", "offered", "hired"], 16], [0, 2, ["rejected"], 15],
    [1, 3, [], 12], [4, 3, ["reviewing"], 11],
    [2, 6, ["shortlisted", "interview"], 21], [0, 6, ["rejected"], 20],
    [4, 7, ["shortlisted"], 17], [4, 8, ["interview"], 12], [2, 8, [], 10],
    [2, 9, [], 8], [3, 9, ["reviewing"], 7], [0, 9, [], 6],
    [3, 5, [], 5], [0, 5, [], 4], [2, 10, [], 3], [1, 4, [], 2], [2, 4, [], 1], [3, 11, [], 0],
  ];
  for (const [ci, ji, path, days] of plan) {
    const c = cands[ci], j = jobRows[ji];
    const s = scoreHeuristically({ jobTitle: j.title, description: j.description, requirements: j.requirements, skills: j.skills, resumeText: c.resume.extractedText });
    const at = ago(days, 3);
    const final = path.at(-1) ?? "submitted";
    const [a] = await db.insert(applications).values({
      jobId: j.id, candidateId: c.user.id, resumeId: c.resume.id, status: final, createdAt: at, updatedAt: ago(Math.max(0, days - path.length), 1),
      coverLetter: `Hi ${j.company} team, I'm excited about the ${j.title} role. My background in ${c.skills.slice(0, 2).join(" and ")} lines up well with what you're building.`,
      scoreStatus: "completed", score: s.score, scoreSummary: s.summary, scoreStrengths: s.strengths, scoreGaps: s.gaps, scoreProvider: s.provider, scoredAt: new Date(at.getTime() + 20_000),
    }).returning();
    const notes: Partial<Record<ApplicationStatus, string>> = { interview: "We'd love to schedule a 45-minute technical conversation next week.", offered: "We're thrilled to extend an offer. Details are in your inbox.", rejected: "Thanks for your time. We're moving forward with candidates whose experience is closer to the role." };
    let prev: ApplicationStatus = "submitted";
    await db.insert(applicationEvents).values({ applicationId: a.id, toStatus: "submitted", actorId: c.user.id, createdAt: at });
    for (const [i, st] of path.entries()) {
      await db.insert(applicationEvents).values({ applicationId: a.id, fromStatus: prev, toStatus: st, actorId: j.employerId, note: notes[st], createdAt: ago(Math.max(0, days - i - 1), 1) });
      prev = st;
    }
  }
  // Every demo user gets email, so the whole flow shows up in the local inbox (Mailpit).
  await db.update(users).set({ emailNotifications: true });
  console.log("Seeded HireFlow. Sign in with admin@hireflow.dev, nina@northwind.dev or asha@example.dev (password: password123).");
}

// Close every connection and exit explicitly, so `seed && start` sequences continue.
main().then(async () => { await pool.end(); await closeRedis(); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
