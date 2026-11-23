import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useAdminJobs, useAdminMutations } from "@/hooks/api";
import { fmtDate, timeAgo } from "@/lib/format";
import { EXPERIENCE_LABEL, type AdminJob } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { JobMeta, JobStatusBadge, Pagination } from "@/components/hire";
import { Page } from "@/components/Layout";
import { EmptyState, Field, PageSpinner } from "@/components/common";

const VIEWS = { queue: "pending_review", live: "published", rejected: "rejected", all: "" } as const;
const REASONS = ["Missing salary information", "Description is too vague", "Looks like a scam or asks candidates for payment", "Duplicate posting", "Discriminatory requirements"];

export default function AdminJobs() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as keyof typeof VIEWS) || "queue";
  const page = Number(params.get("page") ?? 1);
  const [q, setQ] = useState("");
  const { data, isLoading } = useAdminJobs({ page, pageSize: 10, status: VIEWS[view] || undefined, q: q || undefined });
  const m = useAdminMutations();
  const [rejecting, setRejecting] = useState<AdminJob | null>(null);
  const [reason, setReason] = useState("");

  return (
    <Page title="Job approvals" subtitle="Every posting is checked before candidates can see it.">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setParams({ view: v })}>
          <TabsList>{[["queue", "Awaiting review"], ["live", "Live"], ["rejected", "Rejected"], ["all", "All"]].map(([v, l]) => <TabsTrigger key={v} value={v} className="px-3">{l}</TabsTrigger>)}</TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
          <Input className="pl-8" placeholder="Title or company" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
        </div>
      </div>
      {isLoading ? <PageSpinner /> : !data?.items.length
        ? <EmptyState icon={<Check />} title={view === "queue" ? "Nothing to review" : "No jobs"} body={view === "queue" ? "New postings show up here instantly." : undefined} />
        : (
          <div className="space-y-3">
            {data.items.map((j) => (
              <Collapsible key={j.id} asChild>
                <article><Card className="gap-0 py-0">
                  <div className="flex flex-wrap items-start gap-3 p-4">
                    <CollapsibleTrigger className="group min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{j.title}</h2><JobStatusBadge status={j.status} />
                        <ChevronDown className="text-muted-foreground size-4 transition group-data-[state=open]:rotate-180" />
                      </div>
                      <p className="text-muted-foreground text-sm">{j.company} · posted by {j.employer.name} ({j.employer.email})</p>
                      <JobMeta job={j} className="mt-1.5" />
                      <p className="text-muted-foreground mt-1 text-xs">{j.submittedAt ? `Submitted ${timeAgo(j.submittedAt)}` : `Created ${fmtDate(j.createdAt)}`}{j.reviewedAt && ` · reviewed ${fmtDate(j.reviewedAt)}`}</p>
                      {j.rejectionReason && <p className="text-destructive mt-1 text-sm">Reason: {j.rejectionReason}</p>}
                    </CollapsibleTrigger>
                    {j.status === "pending_review" && (
                      <div className="flex gap-2">
                        <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => { setRejecting(j); setReason(""); }}><X />Reject</Button>
                        <Button disabled={m.approve.isPending && m.approve.variables === j.id} onClick={() => m.approve.mutate(j.id)}>
                          {m.approve.isPending && m.approve.variables === j.id ? <Spinner /> : <Check />}Approve
                        </Button>
                      </div>
                    )}
                  </div>
                  <CollapsibleContent className="space-y-3 border-t px-4 py-4 text-sm">
                    <p className="text-muted-foreground">{EXPERIENCE_LABEL[j.experienceLevel]} · skills: {j.skills.join(", ") || "none"}</p>
                    <p className="text-foreground/90 whitespace-pre-line">{j.description}</p>
                    {j.requirements && <div><p className="font-medium">Requirements</p><p className="text-foreground/90 whitespace-pre-line">{j.requirements}</p></div>}
                  </CollapsibleContent>
                </Card></article>
              </Collapsible>
            ))}
            <Pagination {...data} onPage={(p) => setParams({ view, page: String(p) })} />
          </div>
        )}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject “{rejecting?.title}”</DialogTitle>
            <DialogDescription>The employer sees this reason and can edit and resubmit.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => <Badge key={r} asChild variant="outline" className="hover:bg-accent cursor-pointer rounded-full px-2.5 py-1 font-normal"><button type="button" onClick={() => setReason(r)}>{r}</button></Badge>)}
          </div>
          <Field label="Reason" htmlFor="reject-reason"><Textarea id="reject-reason" className="min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={reason.trim().length < 5 || m.reject.isPending}
              onClick={async () => { await m.reject.mutateAsync({ id: rejecting!.id, reason: reason.trim() }); setRejecting(null); }}>
              {m.reject.isPending && <Spinner />}Reject & email employer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
