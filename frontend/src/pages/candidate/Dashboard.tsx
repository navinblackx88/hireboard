import { Link } from "react-router-dom";
import { ArrowRight, FileText, Inbox, Send, Sparkles, Trophy } from "lucide-react";
import { useJobs, useMe, useMyApplications, useResumeMutations, useResumes } from "@/hooks/api";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppStatusBadge, JobCard, PipelineProgress, ResumeDropzone, StatCard } from "@/components/hire";
import { Page } from "@/components/Layout";
import { EmptyState, PageSpinner } from "@/components/common";

export default function CandidateDashboard() {
  const { data: me } = useMe();
  const apps = useMyApplications({ page: 1, pageSize: 5 });
  const resumes = useResumes();
  const { upload } = useResumeMutations();
  const latest = useJobs({ page: 1, pageSize: 4 });
  const c = apps.data?.counts ?? {};
  const active = (c.submitted ?? 0) + (c.reviewing ?? 0) + (c.shortlisted ?? 0) + (c.interview ?? 0) + (c.offered ?? 0);

  return (
    <Page title={`Hi ${me?.name.split(" ")[0] ?? "there"}`} subtitle="Track your applications and find new roles."
      actions={<Button asChild><Link to="/jobs">Browse jobs<ArrowRight /></Link></Button>}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Send />} label="Applications" value={apps.data?.total ?? "—"} />
        <StatCard icon={<Inbox />} label="In progress" value={active} />
        <StatCard icon={<Sparkles />} label="Interviews" value={c.interview ?? 0} />
        <StatCard icon={<Trophy />} label="Offers" value={(c.offered ?? 0) + (c.hired ?? 0)} />
      </div>

      {!resumes.isLoading && !resumes.data?.length && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Upload your resume to start applying</CardTitle><CardDescription>We'll read it once and reuse it for every application.</CardDescription></CardHeader>
          <CardContent><ResumeDropzone busy={upload.isPending} onFile={(f) => upload.mutate(f)} /></CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="gap-0 pb-0">
          <CardHeader className="border-b [.border-b]:pb-4">
            <CardTitle>Recent applications</CardTitle>
            <CardAction><Button variant="link" size="sm" className="h-auto p-0" asChild><Link to="/candidate/applications">View all</Link></Button></CardAction>
          </CardHeader>
          {apps.isLoading ? <PageSpinner /> : !apps.data?.items.length
            ? <div className="p-5"><EmptyState icon={<Send />} title="No applications yet" body="When you apply, you'll follow each one here in real time." action={<Button asChild><Link to="/jobs">Find jobs</Link></Button>} /></div>
            : (
              <ul className="divide-y">
                {apps.data.items.map((a) => (
                  <li key={a.id}>
                    <Link to={`/candidate/applications/${a.id}`} className="hover:bg-accent/50 block px-6 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0"><p className="truncate font-medium">{a.job.title}</p><p className="text-muted-foreground text-sm">{a.job.company} · updated {timeAgo(a.updatedAt)}</p></div>
                        <AppStatusBadge status={a.status} />
                      </div>
                      <div className="mt-3"><PipelineProgress status={a.status} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <aside className="space-y-4">
          <Card className="gap-3">
            <CardHeader><CardTitle>Your resumes</CardTitle></CardHeader>
            <CardContent>
              {resumes.data?.map((r) => (
                <p key={r.id} className="flex items-center gap-2 py-1 text-sm">
                  <FileText className="text-muted-foreground size-4" /><span className="truncate">{r.filename}</span>
                  {r.isDefault && <Badge variant="secondary" className="bg-primary/10 text-primary ml-auto">Default</Badge>}
                </p>
              ))}
              <Button variant="link" className="mt-1 h-auto p-0" asChild><Link to="/candidate/resumes">Manage resumes</Link></Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Newest jobs</h2>
          <Button variant="link" size="sm" className="h-auto p-0" asChild><Link to="/jobs">See all</Link></Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">{latest.data?.items.map((j) => <JobCard key={j.id} job={j} />)}</div>
      </section>
    </Page>
  );
}
