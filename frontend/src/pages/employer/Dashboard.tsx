import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, Clock, Plus, Sparkles, Users } from "lucide-react";
import { useEmployerJobs, useEmployerStats, useMe } from "@/hooks/api";
import { timeAgo } from "@/lib/format";
import { EMPLOYMENT_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JobStatusBadge, Pagination, scoreTone, StatCard } from "@/components/hire";
import { Page } from "@/components/Layout";
import { EmptyState, ErrorState, PageSpinner } from "@/components/common";

const VIEWS = { all: "", live: "published", review: "pending_review,rejected", drafts: "draft", closed: "closed" } as const;

export default function EmployerDashboard() {
  const { data: me } = useMe();
  const stats = useEmployerStats();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as keyof typeof VIEWS) || "all";
  const page = Number(params.get("page") || 1);
  const jobs = useEmployerJobs({ page, pageSize: 10, status: VIEWS[view] || undefined });
  const navigate = useNavigate();
  const s = stats.data;

  return (
    <Page title={me?.companyName ?? "Your company"} subtitle="Your postings, applicants and AI match scores."
      actions={<Button asChild><Link to="/employer/jobs/new"><Plus />Post a job</Link></Button>}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Briefcase />} label="Live jobs" value={s?.jobs.published ?? "—"} hint={s?.jobs.pending ? `${s.jobs.pending} awaiting approval` : undefined} />
        <StatCard icon={<Users />} label="Applicants" value={s?.applications.total ?? "—"} />
        <StatCard icon={<Clock />} label="New, not yet reviewed" value={s?.applications.new ?? "—"} />
        <StatCard icon={<Sparkles />} label="Average match score" value={s?.applications.avgScore ?? "—"} />
      </div>

      <Card className="mt-6 gap-0 py-0">
        <div className="overflow-x-auto border-b p-3">
          <Tabs value={view} onValueChange={(v) => setParams({ view: v })}>
            <TabsList>
              {[["all", "All"], ["live", "Live"], ["review", "In review"], ["drafts", "Drafts"], ["closed", "Closed"]].map(([v, l]) => <TabsTrigger key={v} value={v} className="px-3">{l}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        {jobs.isLoading ? <PageSpinner /> : jobs.error ? <div className="p-4"><ErrorState error={jobs.error} /></div> : !jobs.data?.items.length
          ? <div className="p-5"><EmptyState icon={<Briefcase />} title="No jobs here" body="Post a job; our team reviews it, usually within a day." action={<Button asChild><Link to="/employer/jobs/new">Post a job</Link></Button>} /></div>
          : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Job</TableHead><TableHead>Status</TableHead>
                    <TableHead className="text-right">Applicants</TableHead><TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Avg score</TableHead><TableHead className="hidden pr-4 sm:table-cell">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.data.items.map((j) => (
                    <TableRow key={j.id} className="cursor-pointer" onClick={() => navigate(`/employer/jobs/${j.id}`)}>
                      <TableCell className="pl-4 whitespace-normal">
                        <Link to={`/employer/jobs/${j.id}`} className="hover:text-primary font-medium" onClick={(e) => e.stopPropagation()}>{j.title}</Link>
                        <p className="text-muted-foreground text-xs">{j.location} · {EMPLOYMENT_LABEL[j.employmentType]}</p>
                        {j.status === "rejected" && j.rejectionReason && <p className="text-destructive mt-1 text-xs">Reviewer: {j.rejectionReason}</p>}
                      </TableCell>
                      <TableCell><JobStatusBadge status={j.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{j.applicants}</TableCell>
                      <TableCell className="text-right tabular-nums">{j.newApplicants > 0 ? <Badge className="rounded-full">{j.newApplicants}</Badge> : "0"}</TableCell>
                      <TableCell className="text-right">{j.avgScore != null ? <Badge variant="outline" className={cn("rounded-full border-0 font-semibold ring-1 ring-inset", scoreTone(j.avgScore))}>{j.avgScore}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-muted-foreground hidden pr-4 sm:table-cell">{timeAgo(j.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t px-4 py-3"><Pagination {...jobs.data} onPage={(p) => setParams({ view, page: String(p) })} /></div>
            </>
          )}
      </Card>
    </Page>
  );
}
