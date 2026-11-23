import { useState } from "react";
import { Mail } from "lucide-react";
import { useEmailLog } from "@/hooks/api";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination } from "@/components/hire";
import { Page } from "@/components/Layout";
import { EmptyState, PageSpinner } from "@/components/common";

const ALL = "__all__";
const TEMPLATES: Record<string, string> = { application_status: "Status change", application_received: "Application received", new_applicant: "New applicant", job_approved: "Job approved", job_rejected: "Job rejected" };
const TONE = {
  sent: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  logged: "text-muted-foreground",
  failed: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  skipped: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
};

export default function AdminEmails() {
  const [template, setTemplate] = useState(""), [page, setPage] = useState(1);
  const { data, isLoading } = useEmailLog({ page, pageSize: 20, template: template || undefined });
  return (
    <Page title="Email log" subtitle="Every notification email. “Logged” means SMTP isn't configured; “skipped” means the user opted out."
      actions={
        <Select value={template || ALL} onValueChange={(v) => { setTemplate(v === ALL ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-52" aria-label="Type"><SelectValue /></SelectTrigger>
          <SelectContent align="end"><SelectItem value={ALL}>All emails</SelectItem>{Object.entries(TEMPLATES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      }>
      <Card className="gap-0 py-0">
        {isLoading ? <PageSpinner /> : !data?.items.length ? <div className="p-5"><EmptyState icon={<Mail />} title="No emails yet" /></div> : (
          <>
            <ul className="divide-y">
              {data.items.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <Badge variant="outline" className={`w-16 justify-center capitalize ${TONE[e.status]}`}>{e.status}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.subject}</span>
                    <span className="text-muted-foreground block truncate text-xs">to {e.to} · {TEMPLATES[e.template] ?? e.template}{e.error && ` · ${e.error}`}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">{fmtDate(e.createdAt, "d MMM, HH:mm")}</span>
                </li>
              ))}
            </ul>
            <div className="border-t px-4 py-3"><Pagination {...data} onPage={setPage} /></div>
          </>
        )}
      </Card>
    </Page>
  );
}
