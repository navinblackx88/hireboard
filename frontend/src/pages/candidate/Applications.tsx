import { Link, useSearchParams } from "react-router-dom";
import { Inbox } from "lucide-react";
import { useMyApplications } from "@/hooks/api";
import { fmtDate, timeAgo } from "@/lib/format";
import { EMPLOYMENT_LABEL, WORKPLACE_LABEL } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppStatusBadge, CompanyMark, Pagination, PipelineProgress } from "@/components/hire";
import { Page } from "@/components/Layout";
import { EmptyState, ErrorState, PageSpinner } from "@/components/common";

const VIEWS = { active: "submitted,reviewing,shortlisted,interview,offered", closed: "hired,rejected,withdrawn", all: "" } as const;

export default function MyApplications() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as keyof typeof VIEWS) || "active";
  const page = Number(params.get("page") || 1);
  const { data, isLoading, error, refetch } = useMyApplications({ page, pageSize: 10, status: VIEWS[view] || undefined });
  const c = data?.counts ?? {};
  const n = (s: string) => s.split(",").reduce((t, k) => t + (c[k as keyof typeof c] ?? 0), 0);

  return (
    <Page title="My applications" subtitle="Status updates arrive here live, and by email.">
      <Tabs value={view} onValueChange={(v) => setParams({ view: v })}>
        <TabsList>
          <TabsTrigger value="active" className="px-3">In progress<Badge variant="secondary" className="h-4 px-1.5">{n(VIEWS.active)}</Badge></TabsTrigger>
          <TabsTrigger value="closed" className="px-3">Closed<Badge variant="secondary" className="h-4 px-1.5">{n(VIEWS.closed)}</Badge></TabsTrigger>
          <TabsTrigger value="all" className="px-3">All</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-4">
        {isLoading ? <PageSpinner /> : error ? <ErrorState error={error} retry={refetch} /> : !data?.items.length ? <EmptyState icon={<Inbox />} title="Nothing here" body="Applications you send will appear here." /> : (
          <div className="space-y-3">
            {data.items.map((a) => (
              <Link key={a.id} to={`/candidate/applications/${a.id}`} className="group block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <Card className="group-hover:border-primary/40 py-5 transition">
                  <CardContent className="px-5">
                    <div className="flex flex-wrap items-start gap-3">
                      <CompanyMark name={a.job.company} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{a.job.title}</p>
                        <p className="text-muted-foreground text-sm">{a.job.company} · {a.job.location} · {WORKPLACE_LABEL[a.job.workplace]} · {EMPLOYMENT_LABEL[a.job.employmentType]}</p>
                      </div>
                      <div className="text-right"><AppStatusBadge status={a.status} /><p className="text-muted-foreground mt-1 text-xs">Applied {fmtDate(a.createdAt, "d MMM")} · updated {timeAgo(a.updatedAt)}</p></div>
                    </div>
                    <div className="mt-4"><PipelineProgress status={a.status} /></div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            <Pagination {...data} onPage={(p) => setParams({ view, page: String(p) })} />
          </div>
        )}
      </div>
    </Page>
  );
}
