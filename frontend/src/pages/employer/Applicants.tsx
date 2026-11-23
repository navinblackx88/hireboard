import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Download, Lock, Pencil, RefreshCw, Sparkles, Users } from "lucide-react";
import { openFile, useApplicants, useApplication, useApplicationMutations, useJob, useJobMutations, useScoringConfig } from "@/hooks/api";
import { fmtDate, timeAgo } from "@/lib/format";
import { APP_STATUS_LABEL, type ApplicationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AppStatusBadge, JobStatusBadge, Pagination, ScoreBadge, ScoreReasoning, Timeline, providerLabel } from "@/components/hire";
import { Page } from "@/components/Layout";
import { EmptyState, ErrorState, Field, PageSpinner, UserAvatar, confirmAction } from "@/components/common";

const TABS: { value: string; label: string; statuses?: ApplicationStatus[] }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New", statuses: ["submitted"] },
  { value: "review", label: "In review", statuses: ["reviewing", "shortlisted"] },
  { value: "interview", label: "Interviewing", statuses: ["interview", "offered"] },
  { value: "hired", label: "Hired", statuses: ["hired"] },
  { value: "closed", label: "Rejected / withdrawn", statuses: ["rejected", "withdrawn"] },
];
const ANY = "__any__";

/** Applicants for one job, ranked by AI match score, with a detail drawer to review and move them. */
export default function Applicants() {
  const { id = "" } = useParams();
  const job = useJob(id);
  const jm = useJobMutations();
  const am = useApplicationMutations();
  const scoring = useScoringConfig();
  const ai = scoring.data && scoring.data.provider !== "heuristic" ? providerLabel(`${scoring.data.provider}:${scoring.data.model ?? ""}`) : null;
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "all";
  const page = Number(params.get("page") ?? 1);
  const minScore = params.get("minScore") ?? "";
  const sort = params.get("sort") ?? "score";
  const open = params.get("app");
  const set = (patch: Record<string, string>) => setParams((p) => { for (const [k, v] of Object.entries(patch)) v && v !== ANY ? p.set(k, v) : p.delete(k); if (!("page" in patch) && !("app" in patch)) p.delete("page"); return p; });
  const statuses = TABS.find((t) => t.value === tab)?.statuses;
  const list = useApplicants(id, { page, pageSize: 15, status: statuses?.join(","), minScore: minScore || undefined, sort });
  const counts = list.data?.counts ?? {};
  const count = (s?: ApplicationStatus[]) => (s ?? (Object.keys(counts) as ApplicationStatus[])).reduce((n, k) => n + (counts[k] ?? 0), 0);

  if (job.isLoading) return <PageSpinner />;
  if (job.error || !job.data) return <div className="p-6"><ErrorState error={job.error} /></div>;
  const j = job.data;

  return (
    <Page back={<Button variant="ghost" size="sm" className="text-muted-foreground -ml-2" asChild><Link to="/employer"><ArrowLeft />All jobs</Link></Button>}
      title={j.title}
      subtitle={<span className="flex flex-wrap items-center gap-2"><JobStatusBadge status={j.status} />{j.location} · posted {j.publishedAt ? fmtDate(j.publishedAt) : "—"}</span>}
      actions={<>
        {ai && (j.applicantCount ?? 0) > 0 && (
          <Button variant="outline" disabled={am.rescoreJob.isPending} onClick={async () => (await confirmAction({
            title: "Re-score applicants with AI?",
            description: `Applicants scored by keyword match (or whose scoring failed) will be re-scored by ${ai}. This uses your AI provider's API credits.`,
            confirmLabel: "Re-score",
          })) && am.rescoreJob.mutate({ jobId: j.id, scope: "keyword" })}>
            {am.rescoreJob.isPending ? <Spinner /> : <Sparkles />}Re-score with AI
          </Button>
        )}
        <Button variant="outline" asChild><Link to={`/jobs/${j.id}`}>View posting</Link></Button>
        {j.status !== "closed" && <Button variant="outline" asChild><Link to={`/employer/jobs/${j.id}/edit`}><Pencil />Edit</Link></Button>}
        {j.status === "published" && (
          <Button variant="outline" onClick={async () => (await confirmAction({ title: "Close this job to new applicants?", description: "It comes off the job board; people who already applied stay in your pipeline.", confirmLabel: "Close job" })) && jm.close.mutate(j.id)}>
            <Lock />Close
          </Button>
        )}
      </>}>
      {j.status === "pending_review" && (
        <Alert className="mb-4 border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"><AlertTriangle />
          <AlertDescription className="text-current">This job is awaiting approval. It'll appear on the job board once an admin approves it.</AlertDescription>
        </Alert>
      )}
      {j.status === "rejected" && (
        <Alert variant="destructive" className="mb-4"><AlertTriangle />
          <AlertDescription><p><b>Changes needed:</b> {j.rejectionReason} <Link className="font-medium underline" to={`/employer/jobs/${j.id}/edit`}>Edit and resubmit</Link></p></AlertDescription>
        </Alert>
      )}

      <Card className="gap-0 py-0">
        <div className="overflow-x-auto border-b p-3">
          <Tabs value={tab} onValueChange={(v) => set({ tab: v })}>
            <TabsList>
              {TABS.map((t) => <TabsTrigger key={t.value} value={t.value} className="px-3">{t.label}<Badge variant="secondary" className="h-4 px-1.5">{count(t.statuses)}</Badge></TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-b px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground font-normal">Min. score</Label>
            <Select value={minScore || ANY} onValueChange={(v) => set({ minScore: v })}>
              <SelectTrigger size="sm" aria-label="Minimum score"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={ANY}>Any</SelectItem>{[50, 60, 70, 80].map((n) => <SelectItem key={n} value={String(n)}>{n}+</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground font-normal">Sort</Label>
            <Select value={sort} onValueChange={(v) => set({ sort: v })}>
              <SelectTrigger size="sm" aria-label="Sort"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="score">Best match</SelectItem><SelectItem value="newest">Newest</SelectItem><SelectItem value="oldest">Oldest</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        {list.isLoading ? <PageSpinner /> : !list.data?.items.length
          ? <div className="p-5"><EmptyState icon={<Users />} title="No applicants here yet" body={j.status === "published" ? "New applicants appear here instantly, scored for fit within seconds." : undefined} /></div>
          : (
            <>
              <ul className="divide-y">
                {list.data.items.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => set({ app: a.id })} className={cn("hover:bg-accent/50 flex w-full items-center gap-4 px-4 py-3.5 text-left", open === a.id && "bg-primary/5")}>
                      <ScoreBadge score={a.score} />
                      <UserAvatar user={{ id: a.candidate.id, name: a.candidate.name, avatarUrl: null }} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.candidate.name}</span>
                        <span className="text-muted-foreground block truncate text-sm">{a.candidate.headline ?? a.candidate.email}{a.candidate.location && ` · ${a.candidate.location}`}</span>
                        {a.score.summary && <span className="text-muted-foreground mt-0.5 hidden truncate text-xs md:block">{a.score.summary}</span>}
                      </span>
                      <span className="hidden text-right sm:block"><AppStatusBadge status={a.status} /><span className="text-muted-foreground mt-1 block text-xs">{timeAgo(a.createdAt)}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t px-4 py-3"><Pagination {...list.data} onPage={(p) => set({ page: String(p) })} /></div>
            </>
          )}
      </Card>
      <ApplicantSheet id={open} onClose={() => set({ app: "" })} />
    </Page>
  );
}

function ApplicantSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b py-3.5">
          <SheetTitle>Applicant</SheetTitle>
          <SheetDescription className="sr-only">AI match, resume, cover letter and status history</SheetDescription>
        </SheetHeader>
        {id && <ApplicantDetail key={id} id={id} />}
      </SheetContent>
    </Sheet>
  );
}

function ApplicantDetail({ id }: { id: string }) {
  const { data: a, isLoading } = useApplication(id);
  const m = useApplicationMutations();
  const [next, setNext] = useState<ApplicationStatus | null>(null);
  const [note, setNote] = useState("");
  if (isLoading || !a) return <PageSpinner />;

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <div className="flex items-start gap-4 px-5 py-5">
        {a.score && <ScoreBadge score={a.score} size="lg" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{a.candidate.name}</h2>
          <p className="text-muted-foreground text-sm">{a.candidate.headline}</p>
          <p className="text-muted-foreground text-sm"><a className="hover:underline" href={`mailto:${a.candidate.email}`}>{a.candidate.email}</a>{a.candidate.location && ` · ${a.candidate.location}`}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2"><AppStatusBadge status={a.status} /><span className="text-muted-foreground text-xs">Applied {fmtDate(a.createdAt, "d MMM, HH:mm")}</span></div>
        </div>
        <Button size="sm" variant="outline" onClick={() => openFile(`/applications/${a.id}/resume`)}><Download />Resume</Button>
      </div>

      {a.allowedTransitions.length > 0 && (
        <Card className="mx-5 mb-5 gap-3 p-4 shadow-none">
          <p className="text-sm font-medium">Move to</p>
          <div className="flex flex-wrap gap-2">
            {a.allowedTransitions.map((s) => (
              <Button key={s} size="sm" aria-pressed={next === s}
                variant={next === s ? (s === "rejected" ? "destructive" : "default") : s === "rejected" ? "ghost" : "outline"}
                className={cn(s === "rejected" && next !== s && "text-destructive hover:bg-destructive/10 hover:text-destructive")}
                onClick={() => setNext(next === s ? null : s)}>{APP_STATUS_LABEL[s]}</Button>
            ))}
          </div>
          {next && (
            <div className="grid gap-2">
              <Field label="Message to the candidate (optional, included in their email)" htmlFor="note">
                <Textarea id="note" className="min-h-20" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder={next === "interview" ? "We'd love to set up a call next week…" : next === "rejected" ? "Thank you for applying…" : ""} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setNext(null); setNote(""); }}>Cancel</Button>
                <Button size="sm" variant={next === "rejected" ? "destructive" : "default"} disabled={m.setStatus.isPending}
                  onClick={async () => { await m.setStatus.mutateAsync({ id: a.id, status: next, note: note || undefined }); setNext(null); setNote(""); }}>
                  {m.setStatus.isPending && <Spinner />}Move to {APP_STATUS_LABEL[next]} & notify
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Separator />
      <Tabs defaultValue="match" className="px-5 pt-4 pb-10">
        <TabsList>
          <TabsTrigger value="match" className="px-3">AI match</TabsTrigger>
          <TabsTrigger value="resume" className="px-3">Resume & letter</TabsTrigger>
          <TabsTrigger value="history" className="px-3">History</TabsTrigger>
        </TabsList>
        <TabsContent value="match" className="space-y-4 pt-3">
          {a.score && (a.score.status === "completed" ? <ScoreReasoning score={a.score} /> : a.score.status === "failed"
            ? <Alert variant="destructive"><AlertTriangle /><AlertDescription>Scoring failed: {a.score.error}</AlertDescription></Alert>
            : <p className="text-muted-foreground text-sm">Scoring in progress. This updates automatically.</p>)}
          <Button size="sm" variant="ghost" disabled={m.rescore.isPending} onClick={() => m.rescore.mutate(a.id)}>{m.rescore.isPending ? <Spinner /> : <RefreshCw />}Re-score</Button>
        </TabsContent>
        <TabsContent value="resume" className="space-y-4 pt-3">
          {a.coverLetter && <div><h3 className="mb-1 text-sm font-semibold">Cover letter</h3><p className="bg-muted rounded-md p-3 text-sm whitespace-pre-line">{a.coverLetter}</p></div>}
          <div>
            <h3 className="mb-1 text-sm font-semibold">{a.resume.filename}</h3>
            <ScrollArea className="bg-muted h-[50vh] rounded-md border"><pre className="p-3 font-sans text-sm whitespace-pre-wrap">{a.resume.extractedText}</pre></ScrollArea>
          </div>
        </TabsContent>
        <TabsContent value="history" className="pt-3"><Timeline events={a.events} /></TabsContent>
      </Tabs>
    </div>
  );
}
