import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/api";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/stores/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Page } from "@/components/Layout";
import { Field, PageSpinner } from "@/components/common";

export default function Profile() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", companyName: "", companyWebsite: "", headline: "", location: "", emailNotifications: true });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (me) setF({ name: me.name, companyName: me.companyName ?? "", companyWebsite: me.companyWebsite ?? "", headline: me.headline ?? "", location: me.location ?? "", emailNotifications: me.emailNotifications }); }, [me]);
  if (!me) return <PageSpinner />;

  const save = async (body: object, kind: string, ok: string) => {
    setBusy(kind);
    try { await api("/auth/me", { method: "PATCH", body }); await qc.invalidateQueries({ queryKey: ["me"] }); toast.success(ok); if (kind === "pw") setPw({ currentPassword: "", newPassword: "" }); }
    catch (e) { toast.error("Couldn't save", errorMessage(e)); } finally { setBusy(null); }
  };
  const profile = me.role === "employer"
    ? { name: f.name, companyName: f.companyName, companyWebsite: f.companyWebsite || null, location: f.location || null, emailNotifications: f.emailNotifications }
    : { name: f.name, headline: f.headline || null, location: f.location || null, emailNotifications: f.emailNotifications };

  return (
    <Page title="Profile & email alerts">
      <div className="max-w-2xl space-y-5">
        <Card>
          <form className="contents" onSubmit={(e: FormEvent) => { e.preventDefault(); void save(profile, "profile", "Profile saved"); }}>
            <CardHeader><CardTitle>Profile</CardTitle><CardDescription>{me.email} · <span className="capitalize">{me.role}</span></CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Name" htmlFor="p-name"><Input id="p-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              {me.role === "employer" && <>
                <Field label="Company name" htmlFor="p-co" hint="Shown on every job you post."><Input id="p-co" required value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} /></Field>
                <Field label="Company website" htmlFor="p-web"><Input id="p-web" type="url" placeholder="https://" value={f.companyWebsite} onChange={(e) => setF({ ...f, companyWebsite: e.target.value })} /></Field>
              </>}
              {me.role === "candidate" && <Field label="Headline" htmlFor="p-head" hint="Employers see this next to your name."><Input id="p-head" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} /></Field>}
              <Field label="Location" htmlFor="p-loc"><Input id="p-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-1">
                  <Label htmlFor="p-alerts">Email alerts</Label>
                  <p className="text-muted-foreground text-xs">{me.role === "candidate" ? "Get an email whenever one of your applications changes status." : me.role === "employer" ? "Get an email for new applicants and when your jobs are approved or need changes." : "Admin notifications."}</p>
                </div>
                <Switch id="p-alerts" checked={f.emailNotifications} onCheckedChange={(emailNotifications) => setF({ ...f, emailNotifications })} />
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t"><Button type="submit" disabled={busy === "profile"}>{busy === "profile" && <Spinner />}Save</Button></CardFooter>
          </form>
        </Card>
        <Card>
          <form className="contents" onSubmit={(e: FormEvent) => { e.preventDefault(); void save(pw, "pw", "Password updated"); }}>
            <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Current password" htmlFor="pw-cur"><Input id="pw-cur" type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
              <Field label="New password" htmlFor="pw-new" hint="At least 8 characters"><Input id="pw-new" type="password" required minLength={8} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            </CardContent>
            <CardFooter className="justify-end border-t"><Button type="submit" disabled={busy === "pw"}>{busy === "pw" && <Spinner />}Update password</Button></CardFooter>
          </form>
        </Card>
      </div>
    </Page>
  );
}
