import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date());

export const roleEnum = pgEnum("user_role", ["admin", "employer", "candidate"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);
export const jobStatusEnum = pgEnum("job_status", ["draft", "pending_review", "published", "rejected", "closed"]);
export const employmentTypeEnum = pgEnum("employment_type", ["full_time", "part_time", "contract", "internship", "temporary"]);
export const workplaceEnum = pgEnum("workplace_type", ["onsite", "hybrid", "remote"]);
export const experienceEnum = pgEnum("experience_level", ["entry", "mid", "senior", "lead"]);
export const applicationStatusEnum = pgEnum("application_status", ["submitted", "reviewing", "shortlisted", "interview", "offered", "hired", "rejected", "withdrawn"]);
export const scoreStatusEnum = pgEnum("score_status", ["pending", "processing", "completed", "failed"]);

export type Role = (typeof roleEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type ApplicationStatus = (typeof applicationStatusEnum.enumValues)[number];

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: id(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  role: roleEnum("role").notNull(),
  status: userStatusEnum("status").notNull().default("active"),
  // employer profile
  companyName: varchar("company_name", { length: 160 }),
  companyWebsite: varchar("company_website", { length: 300 }),
  // candidate profile
  headline: varchar("headline", { length: 200 }),
  location: varchar("location", { length: 120 }),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), index("users_role_idx").on(t.role, t.status)]);

// ─── Jobs ────────────────────────────────────────────────────────────────────
export const jobs = pgTable("jobs", {
  id: id(),
  employerId: uuid("employer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  company: varchar("company", { length: 160 }).notNull(),
  description: text("description").notNull(),
  requirements: text("requirements"),
  skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
  location: varchar("location", { length: 120 }).notNull(),
  workplace: workplaceEnum("workplace").notNull().default("onsite"),
  employmentType: employmentTypeEnum("employment_type").notNull().default("full_time"),
  experienceLevel: experienceEnum("experience_level").notNull().default("mid"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  status: jobStatusEnum("status").notNull().default("draft"),
  rejectionReason: text("rejection_reason"),
  reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: ts("reviewed_at"),
  submittedAt: ts("submitted_at"),
  publishedAt: ts("published_at"),
  closesAt: ts("closes_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("jobs_status_published_idx").on(t.status, t.publishedAt),
  index("jobs_employer_idx").on(t.employerId),
  index("jobs_search_idx").using("gin", sql`to_tsvector('english', ${t.title} || ' ' || ${t.company} || ' ' || ${t.description})`),
  check("jobs_salary_range", sql`${t.salaryMin} is null or ${t.salaryMax} is null or ${t.salaryMin} <= ${t.salaryMax}`),
]);

// ─── Resumes ─────────────────────────────────────────────────────────────────
export const resumes = pgTable("resumes", {
  id: id(),
  candidateId: uuid("candidate_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  extractedText: text("extracted_text").notNull(),
  pageCount: integer("page_count"),
  isDefault: boolean("is_default").notNull().default(false),
  deletedAt: ts("deleted_at"), // soft delete: applications keep pointing at the file they were sent with
  createdAt: createdAt(),
}, (t) => [index("resumes_candidate_idx").on(t.candidateId)]);

// ─── Applications ────────────────────────────────────────────────────────────
export const applications = pgTable("applications", {
  id: id(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resumeId: uuid("resume_id").notNull().references(() => resumes.id),
  coverLetter: text("cover_letter"),
  status: applicationStatusEnum("status").notNull().default("submitted"),
  // AI match score (also the work queue for the scoring worker)
  scoreStatus: scoreStatusEnum("score_status").notNull().default("pending"),
  score: integer("score"),
  scoreSummary: text("score_summary"),
  scoreStrengths: text("score_strengths").array(),
  scoreGaps: text("score_gaps").array(),
  scoreProvider: varchar("score_provider", { length: 60 }), // "openai:<model>" or "heuristic"
  scoreAttempts: integer("score_attempts").notNull().default(0),
  scoreError: text("score_error"),
  scoredAt: ts("scored_at"),
  scoreLockedUntil: ts("score_locked_until"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("applications_job_candidate_uq").on(t.jobId, t.candidateId),
  index("applications_job_idx").on(t.jobId, t.score),
  index("applications_candidate_idx").on(t.candidateId, t.createdAt),
  index("applications_score_queue_idx").on(t.scoreStatus, t.scoreLockedUntil),
  check("applications_score_range", sql`${t.score} is null or (${t.score} between 0 and 100)`),
]);

export const applicationEvents = pgTable("application_events", {
  id: id(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  fromStatus: applicationStatusEnum("from_status"),
  toStatus: applicationStatusEnum("to_status").notNull(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"), // visible to the candidate
  createdAt: createdAt(),
}, (t) => [index("app_events_app_idx").on(t.applicationId, t.createdAt)]);

// ─── Email log (what the Notification Service sent) ──────────────────────────
export const emailLog = pgTable("email_log", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  to: varchar("to", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 300 }).notNull(),
  template: varchar("template", { length: 60 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(), // sent | logged | failed | skipped
  error: text("error"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("email_log_user_idx").on(t.userId, t.createdAt)]);

export type User = typeof users.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type Application = typeof applications.$inferSelect;
