export type Role = "admin" | "employer" | "candidate";
export type JobStatus = "draft" | "pending_review" | "published" | "rejected" | "closed";
export type ApplicationStatus = "submitted" | "reviewing" | "shortlisted" | "interview" | "offered" | "hired" | "rejected" | "withdrawn";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship" | "temporary";
export type Workplace = "onsite" | "hybrid" | "remote";
export type Experience = "entry" | "mid" | "senior" | "lead";

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary" };
export const WORKPLACE_LABEL: Record<Workplace, string> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" };
export const EXPERIENCE_LABEL: Record<Experience, string> = { entry: "Entry level", mid: "Mid level", senior: "Senior", lead: "Lead / Principal" };
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { draft: "Draft", pending_review: "In review", published: "Live", rejected: "Changes needed", closed: "Closed" };
export const APP_STATUS_LABEL: Record<ApplicationStatus, string> = {
  submitted: "Submitted", reviewing: "Under review", shortlisted: "Shortlisted", interview: "Interview",
  offered: "Offer", hired: "Hired", rejected: "Not selected", withdrawn: "Withdrawn",
};
export const PIPELINE: ApplicationStatus[] = ["submitted", "reviewing", "shortlisted", "interview", "offered", "hired"];

export interface Me {
  id: string; email: string; name: string; role: Role; status: "active" | "suspended";
  companyName: string | null; companyWebsite: string | null; headline: string | null; location: string | null;
  emailNotifications: boolean; createdAt: string;
}
export interface Paged<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

export interface JobInput {
  title: string; description: string; requirements: string | null; skills: string[]; location: string;
  workplace: Workplace; employmentType: EmploymentType; experienceLevel: Experience;
  salaryMin: number | null; salaryMax: number | null; currency: string; closesAt: string | null;
}
export interface JobSummary extends Omit<JobInput, "requirements" | "closesAt"> {
  id: string; company: string; publishedAt: string; closesAt: string | null; applicantCount: number; hasApplied?: boolean;
}
export interface Job extends JobInput {
  id: string; employerId: string; company: string; status: JobStatus; rejectionReason: string | null;
  submittedAt: string | null; reviewedAt: string | null; publishedAt: string | null; createdAt: string; updatedAt: string;
}
export interface JobDetail extends Job { isOpen: boolean; applicantCount: number; canManage: boolean; myApplication: { id: string; status: ApplicationStatus } | null }
export interface EmployerJob extends Job { applicants: number; newApplicants: number; avgScore: number | null }
export interface AdminJob extends Job { employer: { id: string; name: string; email: string } }

export interface Resume { id: string; filename: string; mimeType: string; sizeBytes: number; pageCount: number | null; isDefault: boolean; textPreview: string; textLength: number; createdAt: string }

export interface Score { status: "pending" | "processing" | "completed" | "failed"; value: number | null; summary: string | null; strengths: string[]; gaps: string[]; provider: string | null; scoredAt: string | null; error: string | null }
export interface CandidateRef { id: string; name: string; email: string; headline: string | null; location: string | null }
export interface Applicant { id: string; status: ApplicationStatus; coverLetter: string | null; candidate: CandidateRef; resume: { id: string; filename: string }; score: Score; createdAt: string; updatedAt: string }
export interface JobRef { id: string; title: string; company: string; location: string; workplace: Workplace; employmentType: EmploymentType; status: JobStatus }
export interface MyApplication { id: string; status: ApplicationStatus; job: JobRef; createdAt: string; updatedAt: string }
export interface AppEvent { id: string; fromStatus: ApplicationStatus | null; toStatus: ApplicationStatus; note: string | null; actorName?: string | null; createdAt: string }
export interface ApplicationDetail {
  id: string; status: ApplicationStatus; coverLetter: string | null; job: JobRef; candidate: CandidateRef;
  resume: { id: string; filename: string; sizeBytes: number; extractedText?: string }; score?: Score; events: AppEvent[];
  allowedTransitions: ApplicationStatus[]; createdAt: string; updatedAt: string;
}

export interface AdminUser { id: string; name: string; email: string; role: Role; status: "active" | "suspended"; companyName: string | null; jobCount: number; applicationCount: number; createdAt: string; lastLoginAt: string | null }
export interface Analytics {
  range: { days: number; since: string };
  totals: { users: Partial<Record<Role, number>>; jobs: Partial<Record<JobStatus, number>>; applications: Partial<Record<ApplicationStatus, number>>; pendingReview: number; avgScore: number | null; scoredApplications: number; avgReviewHours: number | null };
  applicationsPerDay: { day: string; n: number }[];
  signupsPerDay: { day: string; n: number }[];
  scoreDistribution: { label: string; n: number }[];
  funnel: { stage: ApplicationStatus; n: number }[];
  topJobs: { id: string; title: string; company: string; applicants: number; avgScore: number | null }[];
}
export interface EmailLogEntry { id: string; to: string; subject: string; template: string; status: "sent" | "logged" | "failed" | "skipped"; error: string | null; createdAt: string }

/** Kept for ui.tsx Avatar compatibility. */
export interface User { id: string; name: string; avatarUrl: string | null }
