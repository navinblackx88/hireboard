import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, API_URL } from "../lib/api";
import { APP_STATUS_LABEL, type ApplicationStatus, type Role } from "../lib/types";
import { useAuth } from "../stores/auth";
import { toast } from "../stores/toast";
import { useMe } from "./api";

type StatusEvt = { applicationId: string; jobId: string; jobTitle: string; from: ApplicationStatus; to: ApplicationStatus; note: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handlers = Record<string, (d: any) => void>;

/** What each server event does to the React Query cache (plus toasts). */
function eventHandlers(qc: QueryClient, role: Role): Handlers {
  return {
    "application.status_changed": (d: StatusEvt) => {
      qc.invalidateQueries({ queryKey: ["application", d.applicationId] });
      qc.invalidateQueries({ queryKey: ["myApplications"] });
      qc.invalidateQueries({ queryKey: ["applicants", d.jobId] });
      if (role === "candidate") toast.info(`${d.jobTitle}: ${APP_STATUS_LABEL[d.to]}`, d.note ?? `Your application moved from ${APP_STATUS_LABEL[d.from]} to ${APP_STATUS_LABEL[d.to]}.`, `/candidate/applications/${d.applicationId}`);
    },
    "application.created": (d: { jobId: string; candidateName: string; jobTitle: string }) => {
      qc.invalidateQueries({ queryKey: ["applicants", d.jobId] });
      qc.invalidateQueries({ queryKey: ["employerJobs"] });
      qc.invalidateQueries({ queryKey: ["employerStats"] });
      toast.info(`New applicant: ${d.candidateName}`, d.jobTitle, `/employer/jobs/${d.jobId}`);
    },
    "application.scored": (d: { applicationId: string; jobId: string }) => {
      qc.invalidateQueries({ queryKey: ["applicants", d.jobId] });
      qc.invalidateQueries({ queryKey: ["application", d.applicationId] });
      qc.invalidateQueries({ queryKey: ["employerJobs"] });
    },
    "job.status_changed": (d: { jobId: string; status: string; reason?: string }) => {
      qc.invalidateQueries({ queryKey: ["employerJobs"] });
      qc.invalidateQueries({ queryKey: ["job", d.jobId] });
      qc.invalidateQueries({ queryKey: ["employerStats"] });
      if (d.status === "published") toast.success("Your job is live", "An admin approved it.", `/employer/jobs/${d.jobId}`);
      if (d.status === "rejected") toast.error("Changes needed on your job", d.reason ?? undefined);
    },
    "job.submitted": (d: { title: string; company: string }) => {
      qc.invalidateQueries({ queryKey: ["adminJobs"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
      toast.info("New job awaiting review", `${d.title} · ${d.company}`, "/admin/jobs");
    },
  };
}

/**
 * Server-Sent Events: exchanges the access token for a one-time ticket (EventSource can't send
 * headers), opens the stream and reconnects with backoff, fetching a fresh ticket each time.
 */
function connectSse(handlers: Handlers, setLive: (v: boolean) => void) {
  let es: EventSource | null = null;
  let stopped = false, retry = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    try {
      const { ticket } = await api<{ ticket: string }>("/events/ticket", { method: "POST" });
      if (stopped) return;
      es = new EventSource(`${API_URL}/api/v1/events?ticket=${encodeURIComponent(ticket)}`);
      es.addEventListener("ready", () => { retry = 0; setLive(true); });
      es.onerror = () => {
        setLive(false);
        es?.close();
        if (!stopped) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
      for (const [event, h] of Object.entries(handlers)) es.addEventListener(event, (e) => h(JSON.parse((e as MessageEvent).data)));
    } catch {
      if (!stopped) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
    }
  };
  void connect();
  return () => { stopped = true; clearTimeout(timer); es?.close(); setLive(false); };
}

/** Live updates for the signed-in user over Server-Sent Events. */
export function useEventStream(role: Role | undefined) {
  const qc = useQueryClient();
  const token = useAuth((s) => s.accessToken);
  const userId = useMe().data?.id;
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!token || !role || !userId) return;
    return connectSse(eventHandlers(qc, role), setLive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!token, role, userId, qc]);

  return live;
}
