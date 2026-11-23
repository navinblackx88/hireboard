import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, type ApplicationStatus, type Job } from "../../db/schema.js";
import { logSkippedEmail, sendEmail, type Email } from "../../lib/mailer.js";

/**
 * Notification Service: email alerts. Called after the triggering write commits and never
 * awaited by the request path's critical section, so a slow SMTP server can't slow the API.
 */
export const STATUS_COPY: Record<ApplicationStatus, { label: string; line: string }> = {
  submitted: { label: "Submitted", line: "Your application has been received." },
  reviewing: { label: "Under review", line: "The hiring team has started reviewing your application." },
  shortlisted: { label: "Shortlisted", line: "Good news: you've been shortlisted." },
  interview: { label: "Interview", line: "The hiring team would like to interview you. Expect them to be in touch about scheduling." },
  offered: { label: "Offer", line: "Congratulations, you've received an offer!" },
  hired: { label: "Hired", line: "Congratulations on your new role!" },
  rejected: { label: "Not selected", line: "The team has decided not to move forward with your application this time." },
  withdrawn: { label: "Withdrawn", line: "You withdrew this application." },
};

async function toUser(userId: string, e: Omit<Email, "to" | "userId">) {
  const [u] = await db.select({ email: users.email, opted: users.emailNotifications }).from(users).where(eq(users.id, userId));
  if (!u) return;
  if (!u.opted) return logSkippedEmail({ to: u.email, userId, template: e.template, subject: e.subject });
  return sendEmail({ ...e, to: u.email, userId });
}

const fire = (p: Promise<unknown>) => void p.catch(() => undefined);

export const notify = {
  applicationReceived(job: Job, candidate: { id: string; name: string }, applicationId: string) {
    fire(toUser(candidate.id, {
      template: "application_received", subject: `Application received: ${job.title} at ${job.company}`,
      heading: "We've got your application", lines: [`Your application for ${job.title} at ${job.company} was submitted.`, "You'll get an email whenever its status changes."],
      cta: { label: "Track your application", path: `/candidate/applications/${applicationId}` }, meta: { applicationId, jobId: job.id },
    }));
    fire(toUser(job.employerId, {
      template: "new_applicant", subject: `New applicant for ${job.title}: ${candidate.name}`,
      heading: "New applicant", lines: [`${candidate.name} applied for ${job.title}.`, "Their AI match score will be ready in a moment."],
      cta: { label: "Review applicants", path: `/employer/jobs/${job.id}` }, meta: { applicationId, jobId: job.id },
    }));
  },

  statusChanged(job: Job, candidateId: string, applicationId: string, to: ApplicationStatus, note?: string | null) {
    const copy = STATUS_COPY[to];
    fire(toUser(candidateId, {
      template: "application_status", subject: `${job.title} at ${job.company}: ${copy.label}`,
      heading: `Application update: ${copy.label}`,
      lines: [`${job.title} at ${job.company}`, copy.line, ...(note ? [`Message from the team: “${note}”`] : [])],
      cta: { label: "View application", path: `/candidate/applications/${applicationId}` }, meta: { applicationId, jobId: job.id, status: to },
    }));
  },

  jobReviewed(job: Job, approved: boolean, reason?: string | null) {
    fire(toUser(job.employerId, approved
      ? { template: "job_approved", subject: `Your job “${job.title}” is live`, heading: "Job approved", lines: [`“${job.title}” has been approved and is now visible to candidates.`], cta: { label: "View job", path: `/employer/jobs/${job.id}` }, meta: { jobId: job.id } }
      : { template: "job_rejected", subject: `Changes needed: “${job.title}”`, heading: "Job not approved", lines: [`“${job.title}” wasn't approved.`, ...(reason ? [`Reason: ${reason}`] : []), "Edit the posting and resubmit it for review."], cta: { label: "Edit job", path: `/employer/jobs/${job.id}/edit` }, meta: { jobId: job.id } }));
  },
};
