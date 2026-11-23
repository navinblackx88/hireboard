import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Building2, UserRound } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { homeFor } from "@/components/Layout";
import { Field } from "@/components/common";

type AuthRes = { user: Me; accessToken: string; refreshToken: string };

function Shell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="bg-muted flex min-h-full items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Link to="/jobs" className="flex items-center justify-center gap-2 text-lg font-semibold tracking-tight"><img src="/favicon.svg" alt="" className="size-9" />HireFlow</Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {footer && <p className="text-muted-foreground text-center text-sm">{footer}</p>}
      </div>
    </div>
  );
}

const FormError = ({ children }: { children: ReactNode }) => <Alert variant="destructive"><AlertCircle /><AlertDescription>{children}</AlertDescription></Alert>;
const TextLink = ({ to, children }: { to: string; children: ReactNode }) => <Link className="text-primary font-medium underline-offset-4 hover:underline" to={to}>{children}</Link>;

function useFinish() {
  const setTokens = useAuth((s) => s.setTokens);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (r: AuthRes) => {
    qc.clear();
    qc.setQueryData(["me"], r.user);
    setTokens(r.accessToken, r.refreshToken);
    navigate(params.get("next") || homeFor(r.user.role), { replace: true });
  };
}

export function Login() {
  const finish = useFinish();
  const token = useAuth((s) => s.accessToken);
  const [f, setF] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (token) return <Navigate to="/" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { finish(await api<AuthRes>("/auth/login", { body: f })); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Welcome back" subtitle="Sign in to continue" footer={<>New to HireFlow? <TextLink to={`/signup${window.location.search}`}>Create an account</TextLink></>}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner />}Sign in</Button>
      </form>
    </Shell>
  );
}

export function Signup() {
  const finish = useFinish();
  const [params] = useSearchParams();
  const [role, setRole] = useState<"candidate" | "employer">(params.get("role") === "employer" ? "employer" : "candidate");
  const [f, setF] = useState({ name: "", email: "", password: "", companyName: "", headline: "", location: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    const body = { name: f.name, email: f.email, password: f.password, role, location: f.location || undefined,
      ...(role === "employer" ? { companyName: f.companyName } : { headline: f.headline || undefined }) };
    try { finish(await api<AuthRes>("/auth/signup", { body })); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const options = [
    { value: "candidate", icon: <UserRound />, title: "I'm looking for work", body: "Upload a resume and apply" },
    { value: "employer", icon: <Building2 />, title: "I'm hiring", body: "Post jobs and review applicants" },
  ] as const;
  return (
    <Shell title="Create your account" footer={<>Already have an account? <TextLink to="/login">Sign in</TextLink></>}>
      <RadioGroup value={role} onValueChange={(v) => setRole(v as typeof role)} className="mb-5 grid-cols-2" aria-label="Account type">
        {options.map((o) => (
          <Label key={o.value} htmlFor={`role-${o.value}`}
            className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 hover:bg-accent/50 flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 font-normal transition">
            <div className="flex w-full items-center justify-between">
              <span className="text-muted-foreground [&>svg]:size-5">{o.icon}</span>
              <RadioGroupItem id={`role-${o.value}`} value={o.value} />
            </div>
            <span className="text-sm font-medium">{o.title}</span>
            <span className="text-muted-foreground text-xs">{o.body}</span>
          </Label>
        ))}
      </RadioGroup>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Full name" htmlFor="name"><Input id="name" required autoComplete="name" value={f.name} onChange={set("name")} /></Field>
        {role === "employer"
          ? <Field label="Company name" htmlFor="company"><Input id="company" required autoComplete="organization" value={f.companyName} onChange={set("companyName")} /></Field>
          : <Field label="Headline (optional)" htmlFor="headline"><Input id="headline" placeholder="e.g. Backend engineer, 5 years" value={f.headline} onChange={set("headline")} /></Field>}
        <Field label={role === "employer" ? "Work email" : "Email"} htmlFor="email"><Input id="email" type="email" required autoComplete="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters"><Input id="password" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner />}{role === "employer" ? "Create employer account" : "Create account"}</Button>
      </form>
    </Shell>
  );
}
