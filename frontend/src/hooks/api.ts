import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { configQuery } from "../lib/config";
import type {
  AdminJob, AdminUser, Analytics, Applicant, ApplicationDetail, ApplicationStatus, EmailLogEntry, EmployerJob, Job, JobDetail,
  JobInput, JobSummary, Me, MyApplication, Paged, Resume, Role,
} from "../lib/types";
import { useAuth } from "../stores/auth";
import { toast } from "../stores/toast";

const fail = (title: string) => (e: unknown) => toast.error(title, errorMessage(e));
type Q = Record<string, string | number | undefined>;

// ─── Session ─────────────────────────────────────────────────────────────────
export const useMe = () => {
  const token = useAuth((s) => s.accessToken);
  return useQuery({ queryKey: ["me"], queryFn: () => api<{ user: Me }>("/auth/me").then((r) => r.user), enabled: !!token, staleTime: 60_000 });
};

// ─── Jobs ────────────────────────────────────────────────────────────────────
export const useJobs = (q: Q) => useQuery({ queryKey: ["jobs", q], queryFn: () => api<Paged<JobSummary>>("/jobs", { query: q }), placeholderData: keepPreviousData });
export const useLocations = () => useQuery({ queryKey: ["locations"], queryFn: () => api<{ items: { location: string; n: number }[] }>("/jobs/locations").then((r) => r.items), staleTime: 300_000 });
export const useJob = (id?: string) => useQuery({ queryKey: ["job", id], queryFn: () => api<JobDetail>(`/jobs/${id}`), enabled: !!id });

export function useJobMutations() {
  const qc = useQueryClient();
  const refresh = (id?: string) => { qc.invalidateQueries({ queryKey: ["employerJobs"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["employerStats"] }); if (id) qc.invalidateQueries({ queryKey: ["job", id] }); };
  return {
    create: useMutation({ mutationFn: (b: Partial<JobInput> & { submit: boolean }) => api<Job>("/jobs", { body: b }), onSuccess: (j) => refresh(j.id), onError: fail("Couldn't save the job") }),
    update: useMutation({ mutationFn: ({ id, ...b }: Partial<JobInput> & { id: string }) => api<Job & { requiresReview: boolean }>(`/jobs/${id}`, { method: "PATCH", body: b }), onSuccess: (j) => refresh(j.id), onError: fail("Couldn't save the job") }),
    submit: useMutation({ mutationFn: (id: string) => api<Job>(`/jobs/${id}/submit`, { method: "POST" }), onSuccess: (j) => { refresh(j.id); toast.success("Submitted for review", "An admin will review it shortly."); }, onError: fail("Couldn't submit") }),
    close: useMutation({ mutationFn: (id: string) => api<Job>(`/jobs/${id}/close`, { method: "POST" }), onSuccess: (j) => { refresh(j.id); toast.success("Job closed to new applicants"); }, onError: fail("Couldn't close the job") }),
    remove: useMutation({ mutationFn: (id: string) => api(`/jobs/${id}`, { method: "DELETE" }), onSuccess: () => refresh(), onError: fail("Couldn't delete the job") }),
  };
}

// ─── Employer ────────────────────────────────────────────────────────────────
export const useEmployerJobs = (q: Q) => useQuery({ queryKey: ["employerJobs", q], queryFn: () => api<Paged<EmployerJob>>("/employer/jobs", { query: q }), placeholderData: keepPreviousData });
export const useEmployerStats = () => useQuery({ queryKey: ["employerStats"], queryFn: () => api<{ jobs: { total: number; published: number; pending: number }; applications: { total: number; new: number; interviewing: number; avgScore: number | null } }>("/employer/stats") });
export const useApplicants = (jobId: string, q: Q) => useQuery({
  queryKey: ["applicants", jobId, q], queryFn: () => api<Paged<Applicant> & { counts: Partial<Record<ApplicationStatus, number>> }>(`/jobs/${jobId}/applications`, { query: q }), placeholderData: keepPreviousData,
});

// ─── Applications ────────────────────────────────────────────────────────────
export const useMyApplications = (q: Q) => useQuery({ queryKey: ["myApplications", q], queryFn: () => api<Paged<MyApplication> & { counts: Partial<Record<ApplicationStatus, number>> }>("/applications/me", { query: q }), placeholderData: keepPreviousData });
export const useApplication = (id?: string | null) => useQuery({ queryKey: ["application", id], queryFn: () => api<ApplicationDetail>(`/applications/${id}`), enabled: !!id });

export function useApplicationMutations() {
  const qc = useQueryClient();
  const refresh = (id?: string) => { qc.invalidateQueries({ queryKey: ["applicants"] }); qc.invalidateQueries({ queryKey: ["myApplications"] }); qc.invalidateQueries({ queryKey: ["employerStats"] }); qc.invalidateQueries({ queryKey: ["employerJobs"] }); if (id) qc.invalidateQueries({ queryKey: ["application", id] }); };
  return {
    apply: useMutation({
      mutationFn: ({ jobId, ...b }: { jobId: string; resumeId?: string; coverLetter?: string }) => api<{ id: string }>(`/jobs/${jobId}/applications`, { body: b }),
      onSuccess: (_r, v) => { refresh(); qc.invalidateQueries({ queryKey: ["job", v.jobId] }); qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Application sent", "You'll get an email when its status changes."); },
      onError: fail("Couldn't apply"),
    }),
    setStatus: useMutation({ mutationFn: ({ id, ...b }: { id: string; status: ApplicationStatus; note?: string }) => api(`/applications/${id}/status`, { method: "PATCH", body: b }), onSuccess: (_r, v) => refresh(v.id), onError: fail("Couldn't update the status") }),
    withdraw: useMutation({ mutationFn: (id: string) => api(`/applications/${id}/withdraw`, { method: "POST" }), onSuccess: (_r, id) => { refresh(id); toast.success("Application withdrawn"); }, onError: fail("Couldn't withdraw") }),
    rescore: useMutation({ mutationFn: (id: string) => api(`/applications/${id}/rescore`, { method: "POST" }), onSuccess: (_r, id) => { refresh(id); toast.info("Re-scoring started"); }, onError: fail("Couldn't re-score") }),
  };
}

export async function openFile(path: string) {
  try { const { url } = await api<{ url: string }>(path); window.open(url, "_blank", "noopener"); }
  catch (e) { toast.error("Couldn't open the file", errorMessage(e)); }
}

// ─── Resumes ─────────────────────────────────────────────────────────────────
export const useResumes = (enabled = true) => useQuery({ queryKey: ["resumes"], queryFn: () => api<{ items: Resume[] }>("/resumes").then((r) => r.items), enabled });
export function useResumeMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["resumes"] });
  return {
    upload: useMutation({
      mutationFn: async (file: File) => {
        const cfg = await qc.fetchQuery(configQuery);
        if (file.size > cfg.uploads.maxMb * 1024 * 1024) throw new Error(`Resumes can be up to ${cfg.uploads.maxMb} MB`);
        const f = new FormData(); f.append("file", file);
        return api<Resume>("/resumes", { form: f });
      }, onSuccess: (r) => { refresh(); toast.success("Resume uploaded", `${r.filename} · ${r.textLength.toLocaleString()} characters extracted`); }, onError: fail("Upload failed") }),
    makeDefault: useMutation({ mutationFn: (id: string) => api(`/resumes/${id}/default`, { method: "POST" }), onSuccess: refresh, onError: fail("Couldn't update") }),
    remove: useMutation({ mutationFn: (id: string) => api(`/resumes/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: fail("Couldn't delete") }),
  };
}

// ─── Admin ───────────────────────────────────────────────────────────────────
export const useAnalytics = (days: number) => useQuery({ queryKey: ["analytics", days], queryFn: () => api<Analytics>("/admin/analytics", { query: { days } }), placeholderData: keepPreviousData });
export const useAdminJobs = (q: Q) => useQuery({ queryKey: ["adminJobs", q], queryFn: () => api<Paged<AdminJob>>("/admin/jobs", { query: q }), placeholderData: keepPreviousData });
export const useAdminUsers = (q: Q) => useQuery({ queryKey: ["adminUsers", q], queryFn: () => api<Paged<AdminUser>>("/admin/users", { query: q }), placeholderData: keepPreviousData });
export const useEmailLog = (q: Q) => useQuery({ queryKey: ["emails", q], queryFn: () => api<Paged<EmailLogEntry>>("/admin/emails", { query: q }), placeholderData: keepPreviousData });

export function useAdminMutations() {
  const qc = useQueryClient();
  const refreshJobs = () => { qc.invalidateQueries({ queryKey: ["adminJobs"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); };
  return {
    approve: useMutation({ mutationFn: (id: string) => api<Job>(`/admin/jobs/${id}/approve`, { method: "POST" }), onSuccess: (j) => { refreshJobs(); toast.success(`“${j.title}” is live`); }, onError: fail("Couldn't approve") }),
    reject: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api<Job>(`/admin/jobs/${id}/reject`, { body: { reason } }), onSuccess: (j) => { refreshJobs(); toast.success(`“${j.title}” sent back`, "The employer has been emailed your reason."); }, onError: fail("Couldn't reject") }),
    updateUser: useMutation({ mutationFn: ({ id, ...b }: { id: string; role?: Role; status?: "active" | "suspended" }) => api(`/admin/users/${id}`, { method: "PATCH", body: b }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["adminUsers"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); }, onError: fail("Couldn't update the user") }),
  };
}
