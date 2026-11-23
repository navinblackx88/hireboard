import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Info, X } from "lucide-react";
import { useJob, useJobMutations } from "@/hooks/api";
import { toast } from "@/stores/toast";
import { EMPLOYMENT_LABEL, EXPERIENCE_LABEL, WORKPLACE_LABEL, type EmploymentType, type Experience, type JobInput, type Workplace } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { JobStatusBadge } from "@/components/hire";
import { Page } from "@/components/Layout";
import { DatePicker, Field, PageSpinner } from "@/components/common";

const blank = { title: "", description: "", requirements: "", skills: [] as string[], location: "", workplace: "onsite" as Workplace, employmentType: "full_time" as EmploymentType, experienceLevel: "mid" as Experience, salaryMin: "", salaryMax: "", currency: "INR", closesAt: "" };

function EnumSelect<T extends string>({ label, value, onChange, labels }: { label: string; value: T; onChange: (v: T) => void; labels: Record<T, string> }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>{(Object.entries(labels) as [T, string][]).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

export default function JobEditor() {
  const { id } = useParams();
  const existing = useJob(id);
  const m = useJobMutations();
  const navigate = useNavigate();
  const [f, setF] = useState(blank);
  const [skill, setSkill] = useState("");
  useEffect(() => {
    const j = existing.data;
    if (j) setF({ title: j.title, description: j.description, requirements: j.requirements ?? "", skills: j.skills, location: j.location, workplace: j.workplace, employmentType: j.employmentType, experienceLevel: j.experienceLevel, salaryMin: j.salaryMin?.toString() ?? "", salaryMax: j.salaryMax?.toString() ?? "", currency: j.currency, closesAt: j.closesAt?.slice(0, 10) ?? "" });
  }, [existing.data]);
  if (id && existing.isLoading) return <PageSpinner />;

  const payload = (): Partial<JobInput> => ({
    title: f.title.trim(), description: f.description.trim(), requirements: f.requirements.trim() || null, skills: f.skills, location: f.location.trim(),
    workplace: f.workplace, employmentType: f.employmentType, experienceLevel: f.experienceLevel, currency: f.currency,
    salaryMin: f.salaryMin ? Number(f.salaryMin) : null, salaryMax: f.salaryMax ? Number(f.salaryMax) : null,
    closesAt: f.closesAt ? new Date(`${f.closesAt}T23:59:00`).toISOString() : null,
  });
  const save = async (submit: boolean) => {
    if (id) {
      const r = await m.update.mutateAsync({ id, ...payload() });
      if (submit && (r.status === "draft" || r.status === "rejected")) await m.submit.mutateAsync(id);
      else toast.success(r.requiresReview ? "Saved and sent for re-review" : "Saved", r.requiresReview ? "Content changes to live jobs are re-checked before going live again." : undefined);
      navigate(`/employer/jobs/${id}`);
    } else {
      const j = await m.create.mutateAsync({ ...payload(), submit });
      toast.success(submit ? "Submitted for review" : "Draft saved", submit ? "We'll email you when it's approved." : undefined);
      navigate(`/employer/jobs/${j.id}`);
    }
  };
  const addSkill = () => { const s = skill.trim().toLowerCase(); if (s && !f.skills.includes(s) && f.skills.length < 25) setF({ ...f, skills: [...f.skills, s] }); setSkill(""); };
  const onSkillKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSkill(); } else if (e.key === "Backspace" && !skill) setF({ ...f, skills: f.skills.slice(0, -1) }); };
  const salaryInvalid = f.salaryMin && f.salaryMax && Number(f.salaryMin) > Number(f.salaryMax);
  const busy = m.create.isPending || m.update.isPending || m.submit.isPending;
  const live = existing.data?.status === "published";

  return (
    <Page back={<Button variant="ghost" size="sm" className="text-muted-foreground -ml-2" asChild><Link to={id ? `/employer/jobs/${id}` : "/employer"}><ArrowLeft />Back</Link></Button>}
      title={id ? "Edit job" : "Post a job"} subtitle={existing.data && <JobStatusBadge status={existing.data.status} />}>
      <form className="grid gap-6 lg:grid-cols-[1fr_20rem]" onSubmit={(e: FormEvent) => { e.preventDefault(); void save(true); }}>
        <Card>
          <CardContent className="grid gap-5">
            {existing.data?.status === "rejected" && existing.data.rejectionReason && <Alert variant="destructive"><AlertDescription><p><b>Reviewer feedback:</b> {existing.data.rejectionReason}</p></AlertDescription></Alert>}
            {live && (
              <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"><Info />
                <AlertDescription className="text-current">This job is live. Changing its title, description, requirements, skills, salary or location sends it back for review.</AlertDescription>
              </Alert>
            )}
            <Field label="Job title" htmlFor="jt"><Input id="jt" required minLength={3} maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Senior Backend Engineer" /></Field>
            <Field label="Description" htmlFor="jd" hint="What the role is, the team, and why someone would want it. At least 30 characters.">
              <Textarea id="jd" className="min-h-48" required minLength={30} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <Field label="Requirements" htmlFor="jr" hint="One per line. These, and the skills below, are what the AI matches resumes against.">
              <Textarea id="jr" className="min-h-32" value={f.requirements} onChange={(e) => setF({ ...f, requirements: e.target.value })} placeholder={"5+ years with TypeScript\nPostgreSQL in production"} />
            </Field>
            <div className="grid gap-2">
              <Label htmlFor="skill-input">Key skills</Label>
              <div className="border-input focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 shadow-xs focus-within:ring-[3px]">
                {f.skills.map((s) => (
                  <Badge key={s} variant="secondary" className="bg-primary/10 text-primary gap-1 pr-1 text-sm font-normal">
                    {s}<button type="button" aria-label={`Remove ${s}`} className="hover:bg-primary/20 rounded-sm" onClick={() => setF({ ...f, skills: f.skills.filter((x) => x !== s) })}><X className="size-3" /></button>
                  </Badge>
                ))}
                <input id="skill-input" className="placeholder:text-muted-foreground min-w-32 flex-1 bg-transparent text-sm outline-none" value={skill} onChange={(e) => setSkill(e.target.value)} onKeyDown={onSkillKey} onBlur={addSkill}
                  placeholder={f.skills.length ? "" : "Type a skill, press Enter"} aria-label="Add skill" />
              </div>
            </div>
          </CardContent>
        </Card>
        <aside className="space-y-4">
          <Card>
            <CardContent className="grid gap-4">
              <Field label="Location" htmlFor="jl"><Input id="jl" required value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Bengaluru, India" /></Field>
              <EnumSelect label="Workplace" value={f.workplace} onChange={(workplace) => setF({ ...f, workplace })} labels={WORKPLACE_LABEL} />
              <EnumSelect label="Job type" value={f.employmentType} onChange={(employmentType) => setF({ ...f, employmentType })} labels={EMPLOYMENT_LABEL} />
              <EnumSelect label="Experience" value={f.experienceLevel} onChange={(experienceLevel) => setF({ ...f, experienceLevel })} labels={EXPERIENCE_LABEL} />
              <div className="grid gap-2">
                <Label>Annual salary (optional)</Label>
                <div className="grid grid-cols-[5.5rem_1fr_1fr] gap-2">
                  <Select value={f.currency} onValueChange={(currency) => setF({ ...f, currency })}>
                    <SelectTrigger className="w-full" aria-label="Currency"><SelectValue /></SelectTrigger>
                    <SelectContent>{["INR", "USD", "EUR", "GBP"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0} placeholder="Min" aria-label="Minimum salary" aria-invalid={!!salaryInvalid} value={f.salaryMin} onChange={(e) => setF({ ...f, salaryMin: e.target.value })} />
                  <Input type="number" min={0} placeholder="Max" aria-label="Maximum salary" aria-invalid={!!salaryInvalid} value={f.salaryMax} onChange={(e) => setF({ ...f, salaryMax: e.target.value })} />
                </div>
                {salaryInvalid && <p className="text-destructive text-xs">Minimum can't be more than maximum.</p>}
                <p className="text-muted-foreground text-xs">Jobs with a salary range get more applicants.</p>
              </div>
              <Field label="Closing date (optional)"><DatePicker value={f.closesAt} onChange={(closesAt) => setF({ ...f, closesAt })} placeholder="No closing date" /></Field>
            </CardContent>
          </Card>
          <Card className="gap-3">
            <CardContent className="grid gap-2">
              <Button type="submit" className="w-full" disabled={busy || !!salaryInvalid}>{busy && <Spinner />}{id ? (live ? "Save changes" : existing.data?.status === "pending_review" ? "Save" : "Save & submit for review") : "Submit for review"}</Button>
              {(!id || existing.data?.status === "draft") && <Button type="button" variant="outline" className="w-full" disabled={busy || !!salaryInvalid} onClick={() => void save(false)}>Save as draft</Button>}
            </CardContent>
            <CardFooter><p className="text-muted-foreground text-xs">Every posting is reviewed by our team before it goes live.</p></CardFooter>
          </Card>
        </aside>
      </form>
    </Page>
  );
}
