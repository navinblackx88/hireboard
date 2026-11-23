import { useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Clock, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useAnalytics } from "@/hooks/api";
import { APP_STATUS_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryBars, DailyBars } from "@/components/Charts";
import { scoreTone, StatCard } from "@/components/hire";
import { Page } from "@/components/Layout";
import { ErrorState, PageSpinner } from "@/components/common";

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="gap-3"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

export default function AdminAnalytics() {
  const [days, setDays] = useState("30");
  const { data, isLoading, error, refetch, isFetching } = useAnalytics(Number(days));
  if (isLoading) return <PageSpinner />;
  if (error || !data) return <div className="p-6"><ErrorState error={error} retry={refetch} /></div>;
  const t = data.totals;
  const users = (t.users.candidate ?? 0) + (t.users.employer ?? 0) + (t.users.admin ?? 0);
  const apps = Object.values(t.applications).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <Page title="Platform analytics" subtitle="Updated every minute."
      actions={
        <Tabs value={days} onValueChange={setDays} aria-label="Range">
          <TabsList>{["7", "30", "90"].map((d) => <TabsTrigger key={d} value={d} className="px-3">{d} days</TabsTrigger>)}</TabsList>
        </Tabs>
      }>
      <div className={cn("transition-opacity", isFetching && "opacity-70")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard icon={<Users />} label="Users" value={users} hint={`${t.users.candidate ?? 0} candidates · ${t.users.employer ?? 0} employers`} />
          <StatCard icon={<Briefcase />} label="Live jobs" value={t.jobs.published ?? 0} hint={`${t.jobs.closed ?? 0} closed · ${t.jobs.draft ?? 0} draft${(t.jobs.draft ?? 0) === 1 ? "" : "s"}`} />
          <StatCard icon={<ShieldCheck />} label="Awaiting approval" value={t.pendingReview} hint={t.pendingReview ? undefined : "Queue is clear"} />
          <StatCard icon={<Sparkles />} label="Avg match score" value={t.avgScore ?? "—"} hint={`${t.scoredApplications} of ${apps} applications scored`} />
          <StatCard icon={<Clock />} label="Avg review time" value={t.avgReviewHours != null ? `${t.avgReviewHours} h` : "—"} hint="Submission → decision" />
        </div>
        {t.pendingReview > 0 && (
          <Alert className="mt-4 flex flex-wrap items-center justify-between gap-3 border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
            <AlertDescription className="col-start-1 text-current"><span><b>{t.pendingReview}</b> job posting{t.pendingReview > 1 ? "s are" : " is"} waiting for review.</span></AlertDescription>
            <Button size="sm" asChild><Link to="/admin/jobs">Review now</Link></Button>
          </Alert>
        )}
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <ChartCard title="Applications per day"><DailyBars data={data.applicationsPerDay} label="Applications" /></ChartCard>
          <ChartCard title="Sign-ups per day"><DailyBars data={data.signupsPerDay} label="Sign-ups" /></ChartCard>
          <ChartCard title="Hiring funnel">
            <CategoryBars horizontal label="Applications" caption="Applications that reached each stage or beyond (all time)" data={data.funnel.map((f) => ({ name: APP_STATUS_LABEL[f.stage], n: f.n }))} />
          </ChartCard>
          <ChartCard title="AI match score distribution">
            <CategoryBars label="Applications" caption="Number of scored applications in each score band" data={data.scoreDistribution.map((b) => ({ name: b.label, n: b.n }))} />
          </ChartCard>
        </div>
        <Card className="mt-5 gap-0 pb-0">
          <CardHeader className="border-b [.border-b]:pb-4"><CardTitle>Most-applied jobs</CardTitle><CardDescription>Last {days} days</CardDescription></CardHeader>
          {data.topJobs.length ? (
            <Table>
              <TableHeader><TableRow><TableHead className="pl-6">Job</TableHead><TableHead className="text-right">Applicants</TableHead><TableHead className="pr-6 text-right">Avg score</TableHead></TableRow></TableHeader>
              <TableBody>{data.topJobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="pl-6"><Link to={`/jobs/${j.id}`} className="hover:text-primary font-medium">{j.title}</Link><span className="text-muted-foreground"> · {j.company}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{j.applicants}</TableCell>
                  <TableCell className="pr-6 text-right">{j.avgScore != null && <Badge variant="outline" className={cn("rounded-full border-0 font-semibold ring-1 ring-inset", scoreTone(j.avgScore))}>{j.avgScore}</Badge>}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          ) : <p className="text-muted-foreground p-6 text-center text-sm">No applications in this period.</p>}
        </Card>
      </div>
    </Page>
  );
}
