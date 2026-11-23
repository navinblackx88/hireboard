import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { openFile, useApplication, useApplicationMutations } from "@/hooks/api";
import { bytes, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AppStatusBadge, CompanyMark, PipelineProgress, Timeline } from "@/components/hire";
import { Page } from "@/components/Layout";
import { ErrorState, PageSpinner, confirmAction } from "@/components/common";

export default function ApplicationPage() {
  const { id } = useParams();
  const { data: a, isLoading, error, refetch } = useApplication(id);
  const { withdraw } = useApplicationMutations();
  if (isLoading) return <PageSpinner />;
  if (error || !a) return <div className="p-6"><ErrorState error={error} retry={refetch} /></div>;
  return (
    <Page back={<Button variant="ghost" size="sm" className="text-muted-foreground -ml-2" asChild><Link to="/candidate/applications"><ArrowLeft />My applications</Link></Button>}
      title={<span className="flex items-center gap-3"><CompanyMark name={a.job.company} size={40} />{a.job.title}</span>}
      subtitle={<>{a.job.company} · applied {fmtDate(a.createdAt)} · <Link to={`/jobs/${a.job.id}`} className="text-primary hover:underline">View job</Link></>}
      actions={a.allowedTransitions.includes("withdrawn") && (
        <Button variant="outline" disabled={withdraw.isPending}
          onClick={async () => (await confirmAction({ title: "Withdraw this application?", description: "The employer is told you've withdrawn. You can't undo this.", confirmLabel: "Withdraw", destructive: true })) && withdraw.mutate(a.id)}>
          {withdraw.isPending && <Spinner />}Withdraw
        </Button>
      )}>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader><CardTitle>Status</CardTitle><CardAction><AppStatusBadge status={a.status} /></CardAction></CardHeader>
          <CardContent>
            <PipelineProgress status={a.status} />
            <h3 className="text-muted-foreground mt-8 mb-4 text-sm font-semibold">History</h3>
            <Timeline events={a.events} />
          </CardContent>
        </Card>
        <aside className="space-y-4">
          <Card className="gap-3">
            <CardHeader><CardTitle className="text-sm">Resume sent</CardTitle></CardHeader>
            <CardContent>
              <button onClick={() => openFile(`/applications/${a.id}/resume`)} className="hover:bg-accent/50 flex w-full items-center gap-3 rounded-md border p-3 text-left">
                <FileText className="size-5 text-rose-500" />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{a.resume.filename}</span><span className="text-muted-foreground text-xs">{bytes(a.resume.sizeBytes)}</span></span>
              </button>
            </CardContent>
          </Card>
          {a.coverLetter && (
            <Card className="gap-3">
              <CardHeader><CardTitle className="text-sm">Cover letter</CardTitle></CardHeader>
              <CardContent><p className="text-foreground/90 text-sm whitespace-pre-line">{a.coverLetter}</p></CardContent>
            </Card>
          )}
        </aside>
      </div>
    </Page>
  );
}
