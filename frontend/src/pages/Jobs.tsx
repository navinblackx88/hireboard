import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useJobs, useLocations } from "@/hooks/api";
import { EMPLOYMENT_LABEL, EXPERIENCE_LABEL, WORKPLACE_LABEL, type EmploymentType, type Experience, type Workplace } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { JobCard, Pagination } from "@/components/hire";
import { EmptyState, ErrorState } from "@/components/common";

const ANY = "__any__";
const SALARY_PRESETS = [[ANY, "Any"], ["500000", "₹5 L+"], ["1000000", "₹10 L+"], ["2000000", "₹20 L+"], ["3000000", "₹30 L+"], ["5000000", "₹50 L+"]] as const;
const POSTED = [[ANY, "Any time"], ["1", "Past 24 hours"], ["7", "Past week"], ["30", "Past month"]] as const;

/** Public job board. Every filter lives in the URL, so searches can be shared and survive reloads. */
export default function JobsPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const list = (k: string) => get(k).split(",").filter(Boolean);
  const set = (patch: Record<string, string | string[]>) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) { const s = Array.isArray(v) ? v.join(",") : v; if (s && s !== ANY) p.set(k, s); else p.delete(k); }
    if (!("page" in patch)) p.delete("page");
    return p;
  });
  const toggle = (k: string, v: string) => set({ [k]: list(k).includes(v) ? list(k).filter((x) => x !== v) : [...list(k), v] });

  const [q, setQ] = useState(get("q"));
  const [loc, setLoc] = useState(get("location"));
  useEffect(() => { const t = setTimeout(() => { if (q !== get("q") || loc !== get("location")) set({ q, location: loc }); }, 350); return () => clearTimeout(t); }, [q, loc]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = {
    page: get("page") || 1, pageSize: 10, q: get("q") || undefined, location: get("location") || undefined,
    type: get("type") || undefined, workplace: get("workplace") || undefined, experience: get("experience") || undefined,
    salaryMin: get("salaryMin") || undefined, postedWithinDays: get("posted") || undefined, sort: get("sort") || (get("q") ? "relevance" : "newest"),
  };
  const { data, isLoading, error, refetch, isFetching } = useJobs(query);
  const { data: locations = [] } = useLocations();
  const activeCount = ["type", "workplace", "experience", "salaryMin", "posted"].reduce((n, k) => n + (get(k) ? list(k).length || 1 : 0), 0);

  const CheckGroup = <T extends string>({ k, legend, labels }: { k: string; legend: string; labels: Record<T, string> }) => (
    <fieldset className="grid gap-2.5">
      <legend className="mb-2.5 text-sm font-medium">{legend}</legend>
      {(Object.keys(labels) as T[]).map((v) => (
        <div key={v} className="flex items-center gap-2.5">
          <Checkbox id={`${k}-${v}`} checked={list(k).includes(v)} onCheckedChange={() => toggle(k, v)} />
          <Label htmlFor={`${k}-${v}`} className="text-muted-foreground hover:text-foreground font-normal">{labels[v]}</Label>
        </div>
      ))}
    </fieldset>
  );
  const filters = (
    <div className="grid gap-5">
      <CheckGroup<EmploymentType> k="type" legend="Job type" labels={EMPLOYMENT_LABEL} />
      <Separator />
      <CheckGroup<Workplace> k="workplace" legend="Workplace" labels={WORKPLACE_LABEL} />
      <Separator />
      <CheckGroup<Experience> k="experience" legend="Experience" labels={EXPERIENCE_LABEL} />
      <Separator />
      <div className="grid gap-2">
        <Label>Minimum salary</Label>
        <Select value={get("salaryMin") || ANY} onValueChange={(salaryMin) => set({ salaryMin })}>
          <SelectTrigger className="w-full" aria-label="Minimum salary"><SelectValue /></SelectTrigger>
          <SelectContent>{SALARY_PRESETS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Date posted</Label>
        <Select value={get("posted") || ANY} onValueChange={(posted) => set({ posted })}>
          <SelectTrigger className="w-full" aria-label="Date posted"><SelectValue /></SelectTrigger>
          <SelectContent>{POSTED.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {activeCount > 0 && <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => set({ type: "", workplace: "", experience: "", salaryMin: "", posted: "" })}><X />Clear filters</Button>}
    </div>
  );

  return (
    <div>
      <section className="from-primary/10 to-background border-b bg-gradient-to-b">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Find your next role</h1>
          <p className="text-muted-foreground mt-1">Every listing is reviewed by our team before it goes live.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_16rem_auto] lg:grid-cols-[1fr_16rem]">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-3.5 left-3 size-4" />
              <Input className="bg-background h-11 pl-9" aria-label="Keywords" placeholder="Job title, skill or company" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <Input className="bg-background h-11" aria-label="Location" list="locations" placeholder="City or “Remote”" value={loc} onChange={(e) => setLoc(e.target.value)} />
              <datalist id="locations">{locations.map((l) => <option key={l.location} value={l.location.split(",")[0]} />)}</datalist>
            </div>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="bg-background h-11 lg:hidden"><SlidersHorizontal />Filters{activeCount > 0 && <Badge className="h-5 px-1.5">{activeCount}</Badge>}</Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 overflow-y-auto">
                <SheetHeader><SheetTitle>Filters</SheetTitle><SheetDescription>Results update as you choose.</SheetDescription></SheetHeader>
                <div className="px-4 pb-6">{filters}</div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">
          <Card className="sticky top-24 py-5"><CardContent className="px-5">{filters}</CardContent></Card>
        </aside>
        <section aria-live="polite">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">{data ? <><b className="text-foreground">{data.total}</b> job{data.total === 1 ? "" : "s"}</> : " "}</p>
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground font-normal">Sort</Label>
              <Select value={query.sort} onValueChange={(sort) => set({ sort })}>
                <SelectTrigger size="sm" aria-label="Sort"><SelectValue /></SelectTrigger>
                <SelectContent align="end">
                  {get("q") && <SelectItem value="relevance">Most relevant</SelectItem>}
                  <SelectItem value="newest">Newest</SelectItem><SelectItem value="salary_desc">Highest salary</SelectItem><SelectItem value="salary_asc">Lowest salary</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isLoading ? <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
            : error ? <ErrorState error={error} retry={refetch} /> : !data?.items.length
            ? <EmptyState icon={<Search />} title="No jobs match those filters" body="Try fewer filters or a broader keyword." />
            : (
              <div className={cn("space-y-3 transition-opacity", isFetching && "opacity-60")}>
                {data.items.map((j) => <JobCard key={j.id} job={j} />)}
                <div className="pt-3"><Pagination {...data} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0, behavior: "smooth" }); }} /></div>
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
