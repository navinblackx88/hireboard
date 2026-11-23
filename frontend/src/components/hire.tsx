import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Check, ChevronLeft, ChevronRight, Clock, FileText, MapPin, UploadCloud, Wallet } from "lucide-react";
import { fmtDate, salary, timeAgo } from "@/lib/format";
import {
  APP_STATUS_LABEL, EMPLOYMENT_LABEL, JOB_STATUS_LABEL, PIPELINE, WORKPLACE_LABEL,
  type AppEvent, type ApplicationStatus, type JobStatus, type JobSummary, type Score,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppConfig } from "@/lib/config";

// ─── Status badges ───────────────────────────────────────────────────────────
const APP_TONE: Record<ApplicationStatus, string> = {
  submitted: "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  reviewing: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  shortlisted: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  interview: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  offered: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  hired: "border-transparent bg-emerald-600 text-white",
  rejected: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  withdrawn: "text-muted-foreground",
};
export const AppStatusBadge = ({ status }: { status: ApplicationStatus }) => <Badge variant="outline" className={APP_TONE[status]}>{APP_STATUS_LABEL[status]}</Badge>;

const JOB_TONE: Record<JobStatus, string> = {
  draft: "text-muted-foreground",
  pending_review: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  published: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  closed: "bg-muted text-muted-foreground",
};
export const JobStatusBadge = ({ status }: { status: JobStatus }) => <Badge variant="outline" className={JOB_TONE[status]}>{JOB_STATUS_LABEL[status]}</Badge>;

// ─── AI score ────────────────────────────────────────────────────────────────
export const scoreTone = (v: number) => (v >= 75
  ? "text-emerald-700 bg-emerald-500/10 ring-emerald-500/30 dark:text-emerald-300"
  : v >= 50 ? "text-amber-800 bg-amber-500/10 ring-amber-500/30 dark:text-amber-300"
  : "text-rose-700 bg-rose-500/10 ring-rose-500/30 dark:text-rose-300");

/** "anthropic:claude-sonnet-5-5" → "Claude (claude-sonnet-5-5)"; "openai:gpt-4.1-mini" → "OpenAI (gpt-4.1-mini)". */
export function providerLabel(p: string | null | undefined) {
  if (!p) return "AI";
  const [vendor, model] = p.split(":", 2);
  const name = vendor === "anthropic" ? "Claude" : vendor === "gemini" ? "Gemini" : vendor === "openai" ? "OpenAI" : vendor;
  return model ? `${name} (${model})` : name;
}

export function ScoreBadge({ score, size = "md" }: { score: Score; size?: "md" | "lg" }) {
  if (score.status === "pending" || score.status === "processing") {
    return <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs" title="AI scoring in progress"><Spinner className="size-3.5" />Scoring…</span>;
  }
  if (score.status === "failed" || score.value === null) return <span className="text-destructive text-xs" title={score.error ?? undefined}>Score failed</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={`AI match score ${score.value}`}
          className={cn("inline-flex items-center justify-center rounded-full font-semibold tabular-nums ring-1 ring-inset", scoreTone(score.value), size === "lg" ? "size-14 text-xl" : "size-10 text-sm")}>
          {score.value}
        </span>
      </TooltipTrigger>
      <TooltipContent>AI match score{score.provider === "heuristic" ? " (keyword match)" : ""}</TooltipContent>
    </Tooltip>
  );
}

export function ScoreReasoning({ score }: { score: Score }) {
  if (score.status !== "completed") return null;
  return (
    <div className="space-y-3 text-sm">
      {score.summary && <p className="text-foreground/90">{score.summary}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-emerald-800 uppercase dark:text-emerald-300">Strengths</p>
          {score.strengths.length ? <ul className="space-y-1">{score.strengths.map((s) => <li key={s} className="flex gap-1.5"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{s}</li>)}</ul> : <p className="text-muted-foreground">None identified</p>}
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300">Gaps</p>
          {score.gaps.length ? <ul className="space-y-1">{score.gaps.map((s) => <li key={s} className="flex gap-1.5"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-amber-500" />{s}</li>)}</ul> : <p className="text-muted-foreground">None identified</p>}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{score.provider === "heuristic" ? "Keyword match. Set GEMINI_API_KEY or ANTHROPIC_API_KEY on the server for AI scoring." : `Scored by ${providerLabel(score.provider)}`}{score.scoredAt && ` · ${timeAgo(score.scoredAt)}`}. Use it to prioritise reading, not to decide.</p>
    </div>
  );
}

// ─── Jobs ────────────────────────────────────────────────────────────────────
export function JobMeta({ job, className }: { job: Pick<JobSummary, "location" | "workplace" | "employmentType" | "salaryMin" | "salaryMax" | "currency">; className?: string }) {
  const pay = salary(job.salaryMin, job.salaryMax, job.currency);
  return (
    <div className={cn("text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm [&_svg]:size-4 [&_svg]:opacity-70", className)}>
      <span className="inline-flex items-center gap-1.5"><MapPin />{job.location.toLowerCase() === "remote" ? "Remote" : `${job.location} · ${WORKPLACE_LABEL[job.workplace]}`}</span>
      <span className="inline-flex items-center gap-1.5"><Briefcase />{EMPLOYMENT_LABEL[job.employmentType]}</span>
      {pay && <span className="inline-flex items-center gap-1.5"><Wallet />{pay}</span>}
    </div>
  );
}

export function JobCard({ job }: { job: JobSummary }) {
  return (
    <Link to={`/jobs/${job.id}`} className="group block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Card className="group-hover:border-primary/40 gap-0 py-5 transition group-hover:shadow-md">
        <CardHeader className="grid-cols-[auto_1fr] gap-x-3 px-5">
          <CompanyMark name={job.company} className="row-span-2" />
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="group-hover:text-primary leading-none font-semibold">{job.title}</h3>
            {job.hasApplied && <Badge variant="secondary" className="bg-primary/10 text-primary"><Check />Applied</Badge>}
          </div>
          <CardDescription>{job.company}</CardDescription>
        </CardHeader>
        <CardContent className="px-5 sm:pl-[4.75rem]">
          <JobMeta job={job} className="mt-3" />
          <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{job.description.split("\n")[0]}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {job.skills.slice(0, 5).map((s) => <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>)}
            <span className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs"><Clock className="size-3.5" />{timeAgo(job.publishedAt)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

const MARK = ["bg-teal-600", "bg-indigo-600", "bg-rose-600", "bg-amber-600", "bg-sky-600", "bg-violet-600"];
export function CompanyMark({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  const i = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % MARK.length;
  return <span style={{ width: size, height: size }} className={cn("flex shrink-0 items-center justify-center rounded-lg text-base font-bold text-white", MARK[i], className)}>{name.slice(0, 1).toUpperCase()}</span>;
}

// ─── Pagination ──────────────────────────────────────────────────────────────
export function Pagination({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  const pages = pageList(page, totalPages);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <span className="text-muted-foreground">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
        {pages.map((p, i) => p === "…" ? <span key={`e${i}`} className="text-muted-foreground px-1">…</span>
          : <Button key={p} size="icon-sm" variant={p === page ? "outline" : "ghost"} aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)}>{p}</Button>)}
        <Button size="icon-sm" variant="ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
      </div>
    </nav>
  );
}
function pageList(cur: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const s = [...new Set([1, total, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= total))].sort((a, b) => a - b);
  return s.flatMap((n, i) => (i && n - s[i - 1] > 1 ? ["…" as const, n] : [n]));
}

// ─── Drag-and-drop upload ────────────────────────────────────────────────────
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export function ResumeDropzone({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const maxMb = useAppConfig().data?.uploads.maxMb ?? 5;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) return setError("Choose a PDF or Word (.docx) file.");
    if (f.size > maxMb * 1024 * 1024) return setError(`That file is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB.`);
    setError(null);
    onFile(f);
  };
  return (
    <div>
      <div role="button" tabIndex={0} aria-label="Upload resume: drop a file or press to browse"
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
        className={cn("bg-card flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          over ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-accent/40")}>
        {busy ? <Spinner className="text-primary size-8" /> : <UploadCloud className={cn("size-9", over ? "text-primary" : "text-muted-foreground")} />}
        <p className="font-medium">{busy ? "Uploading and reading your resume…" : over ? "Drop to upload" : "Drag your resume here, or click to browse"}</p>
        <p className="text-muted-foreground text-sm">PDF or Word (.docx), up to {maxMb} MB</p>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      </div>
      {error && <p className="text-destructive mt-2 text-sm" role="alert">{error}</p>}
    </div>
  );
}

export const FileIcon = () => <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400"><FileText className="size-5" /></span>;

// ─── Status timeline ─────────────────────────────────────────────────────────
export function PipelineProgress({ status }: { status: ApplicationStatus }) {
  const ended = status === "rejected" || status === "withdrawn";
  const idx = PIPELINE.indexOf(status);
  return (
    <ol className="flex items-center gap-1" aria-label={`Status: ${APP_STATUS_LABEL[status]}`}>
      {PIPELINE.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1">
          <span className={cn("h-1.5 rounded-full", !ended && i <= idx ? "bg-primary" : "bg-muted")} />
          <span className={cn("hidden text-[11px] sm:block", i === idx && !ended ? "text-primary font-medium" : "text-muted-foreground")}>{APP_STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function Timeline({ events }: { events: AppEvent[] }) {
  return (
    <ol className="relative space-y-5 border-l pl-5">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="relative">
          <span className="border-background bg-primary ring-primary/30 absolute top-1 -left-[26px] size-3 rounded-full border-2 ring-1" />
          <div className="flex flex-wrap items-center gap-2">
            <AppStatusBadge status={e.toStatus} />
            <span className="text-muted-foreground text-xs">{fmtDate(e.createdAt, "d MMM yyyy, HH:mm")}</span>
            {e.actorName && <span className="text-muted-foreground text-xs">by {e.actorName}</span>}
          </div>
          {e.note && <p className="bg-muted mt-1.5 rounded-md px-3 py-2 text-sm">“{e.note}”</p>}
        </li>
      ))}
    </ol>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <Card className="gap-1.5 py-4">
      <CardHeader className="px-4"><CardDescription className="flex items-center gap-2 text-xs font-medium [&>svg]:size-4">{icon}{label}</CardDescription></CardHeader>
      <CardContent className="px-4">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}
