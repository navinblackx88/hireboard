import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileText, Users } from "lucide-react";
import { useApplicationMutations, useJob, useMe, useResumeMutations, useResumes } from "@/hooks/api";
import { bytes, fmtDate, timeAgo } from "@/lib/format";
import { EXPERIENCE_LABEL, type JobDetail } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AppStatusBadge, CompanyMark, JobMeta, JobStatusBadge, ResumeDropzone } from "@/components/hire";
import { ErrorState, Field, PageSpinner } from "@/components/common";

export default function JobDetailPage() {
  const { id } = useParams();
  const { data: job, isLoading, error, refetch } = useJob(id);
  if (isLoading) return <PageSpinner />;
  if (error || !job) return <div className="mx-auto max-w-3xl p-6"><ErrorState error={error ?? new Error("Job not found")} retry={refetch} /></div>;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Button variant="ghost" size="sm" className="text-muted-foreground mb-4 -ml-2" asChild><Link to="/jobs"><ArrowLeft />All jobs</Link></Button>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="py-6 sm:py-7">
          <CardHeader className="grid-cols-[auto_1fr] gap-x-4 sm:px-7">
            <CompanyMark name={job.company} size={56} className="row-span-3" />
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">{job.title}</h1>
            <CardDescription className="text-base">{job.company}</CardDescription>
            <div>
              <JobMeta job={job} className="mt-2" />
              <p className="text-muted-foreground mt-2 text-sm">{EXPERIENCE_LABEL[job.experienceLevel]} · Posted {job.publishedAt ? timeAgo(job.publishedAt) : "—"}{job.closesAt && ` · Closes ${fmtDate(job.closesAt)}`}</p>
            </div>
          </CardHeader>
          <CardContent className="sm:px-7">
            {job.skills.length > 0 && <div className="flex flex-wrap gap-1.5">{job.skills.map((s) => <Badge key={s} variant="secondary" className="bg-primary/10 text-primary text-sm font-normal">{s}</Badge>)}</div>}
            <Separator className="my-6" />
            <h2 className="mb-2 font-semibold">About the role</h2>
            <div className="text-foreground/90 space-y-3 text-[15px] leading-relaxed whitespace-pre-line">{job.description}</div>
            {job.requirements && <>
              <h2 className="mt-7 mb-2 font-semibold">What you'll need</h2>
              <ul className="text-foreground/90 list-disc space-y-1 pl-5 text-[15px]">{job.requirements.split("\n").filter(Boolean).map((r) => <li key={r}>{r.replace(/^[-•*]\s*/, "")}</li>)}</ul>
            </>}
          </CardContent>
        </Card>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start"><ApplyPanel job={job} /></aside>
      </div>
    </div>
  );
}

function Panel({ title, action, children, footer }: { title: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex items-center justify-between"><CardTitle>{title}</CardTitle>{action}</CardHeader>
      {children && <CardContent className="grid gap-3 text-sm">{children}</CardContent>}
      {footer && <CardFooter className="flex-col gap-2">{footer}</CardFooter>}
    </Card>
  );
}

function ApplyPanel({ job }: { job: JobDetail }) {
  const { data: me } = useMe();
  const isCandidate = me?.role === "candidate";
  const resumes = useResumes(isCandidate && !job.myApplication);
  const { upload } = useResumeMutations();
  const { apply } = useApplicationMutations();
  const [resumeId, setResumeId] = useState<string>("");
  const [cover, setCover] = useState("");
  const chosen = resumeId || resumes.data?.find((r) => r.isDefault)?.id || "";

  if (job.canManage) {
    return (
      <Panel title="Your posting" action={<JobStatusBadge status={job.status} />}
        footer={<>
          <Button className="w-full" asChild><Link to={`/employer/jobs/${job.id}`}>Review applicants</Link></Button>
          <Button variant="outline" className="w-full" asChild><Link to={`/employer/jobs/${job.id}/edit`}>Edit job</Link></Button>
        </>}>
        {job.status === "rejected" && job.rejectionReason && <Alert variant="destructive"><AlertDescription>Reviewer: {job.rejectionReason}</AlertDescription></Alert>}
        <p className="text-muted-foreground flex items-center gap-2"><Users className="size-4" />{job.applicantCount} applicant{job.applicantCount === 1 ? "" : "s"}</p>
      </Panel>
    );
  }
  if (!job.isOpen) return <Panel title="Applications closed"><p className="text-muted-foreground">This job is no longer accepting applications.</p></Panel>;
  if (!me) {
    return (
      <Panel title="Interested?" footer={<>
        <Button className="w-full" asChild><Link to={`/signup?next=/jobs/${job.id}`}>Create account to apply</Link></Button>
        <Button variant="outline" className="w-full" asChild><Link to={`/login?next=/jobs/${job.id}`}>I have an account</Link></Button>
      </>}>
        <p className="text-muted-foreground">Create a free account to apply with your resume and track your application.</p>
      </Panel>
    );
  }
  if (!isCandidate) return <Panel title="Applications"><p className="text-muted-foreground">Sign in with a candidate account to apply.</p></Panel>;
  if (job.myApplication) {
    return (
      <Panel title={<span className="text-primary flex items-center gap-2"><CheckCircle2 className="size-5" />You've applied</span>}
        footer={<Button variant="outline" className="w-full" asChild><Link to={`/candidate/applications/${job.myApplication.id}`}>Track application</Link></Button>}>
        <div className="text-muted-foreground flex items-center gap-2">Status: <AppStatusBadge status={job.myApplication.status} /></div>
      </Panel>
    );
  }
  return (
    <Card className="gap-4">
      <CardHeader><CardTitle>Apply for this job</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {resumes.isLoading ? <PageSpinner /> : !resumes.data?.length ? (
          <>
            <p className="text-muted-foreground text-sm">Upload a resume to apply. We'll keep it for future applications too.</p>
            <ResumeDropzone busy={upload.isPending} onFile={(f) => upload.mutate(f)} />
          </>
        ) : (
          <>
            <div className="grid gap-2">
              <Label>Resume</Label>
              <RadioGroup value={chosen} onValueChange={setResumeId} className="gap-2" aria-label="Resume">
                {resumes.data.map((r) => (
                  <Label key={r.id} htmlFor={`resume-${r.id}`} className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex cursor-pointer items-center gap-3 rounded-md border p-2.5 font-normal">
                    <RadioGroupItem id={`resume-${r.id}`} value={r.id} />
                    <FileText className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.filename}</span><span className="text-muted-foreground text-xs">{bytes(r.sizeBytes)}{r.isDefault && " · default"}</span></span>
                  </Label>
                ))}
              </RadioGroup>
              <Link to="/candidate/resumes" className="text-primary text-xs hover:underline">Manage resumes</Link>
            </div>
            <Field label="Cover letter (optional)" htmlFor="cover">
              <Textarea id="cover" className="min-h-28" maxLength={5000} value={cover} onChange={(e) => setCover(e.target.value)} placeholder={`Why are you a good fit for ${job.title}?`} />
            </Field>
            <Button className="w-full" disabled={!chosen || apply.isPending} onClick={() => apply.mutate({ jobId: job.id, resumeId: chosen, coverLetter: cover || undefined })}>
              {apply.isPending && <Spinner />}Submit application
            </Button>
            <p className="text-muted-foreground text-xs">Your resume is shared with {job.company} and scored for fit to help them review applications.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
