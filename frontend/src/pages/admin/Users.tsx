import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useAdminMutations, useAdminUsers, useMe } from "@/hooks/api";
import { fmtDate, timeAgo } from "@/lib/format";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/hire";
import { Page } from "@/components/Layout";
import { PageSpinner, UserAvatar, confirmAction } from "@/components/common";

const ALL = "__all__";
const ROLE_LABEL: Record<Role, string> = { candidate: "Candidate", employer: "Employer", admin: "Admin" };

export default function AdminUsers() {
  const { data: me } = useMe();
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  const [role, setRole] = useState(""), [status, setStatus] = useState(""), [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const { data, isLoading, isFetching } = useAdminUsers({ page, pageSize: 15, q: debounced || undefined, role: role || undefined, status: status || undefined });
  const { updateUser } = useAdminMutations();

  return (
    <Page title="Users" subtitle={data ? `${data.total} user${data.total === 1 ? "" : "s"}` : undefined}>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
          <Input className="pl-8" placeholder="Name, email or company" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        </div>
        <Select value={role || ALL} onValueChange={(v) => { setRole(v === ALL ? "" : v); setPage(1); }}>
          <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All roles</SelectItem><SelectItem value="candidate">Candidates</SelectItem><SelectItem value="employer">Employers</SelectItem><SelectItem value="admin">Admins</SelectItem></SelectContent>
        </Select>
        <Select value={status || ALL} onValueChange={(v) => { setStatus(v === ALL ? "" : v); setPage(1); }}>
          <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Any status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem></SelectContent>
        </Select>
      </div>
      <Card className={cn("gap-0 py-0 transition-opacity", isFetching && "opacity-70")}>
        {isLoading ? <PageSpinner /> : (
          <>
            <Table>
              <TableHeader>
                <TableRow><TableHead className="pl-4">User</TableHead><TableHead>Role</TableHead><TableHead className="hidden md:table-cell">Activity</TableHead><TableHead className="hidden lg:table-cell">Joined</TableHead><TableHead className="pr-4 text-right">Access</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <TableRow key={u.id} className={cn(u.status === "suspended" && "bg-destructive/5")}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <UserAvatar user={{ id: u.id, name: u.name, avatarUrl: null }} size={32} />
                          <div className="min-w-0"><p className="truncate font-medium">{u.name}{self && <span className="text-muted-foreground font-normal"> (you)</span>}</p><p className="text-muted-foreground truncate text-xs">{u.email}{u.companyName && ` · ${u.companyName}`}</p></div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select value={u.role} disabled={self}
                          onValueChange={async (v) => (await confirmAction({ title: `Change ${u.name}'s role to ${ROLE_LABEL[v as Role]}?`, description: "Their permissions change on their next request.", confirmLabel: "Change role" })) && updateUser.mutate({ id: u.id, role: v as Role })}>
                          <SelectTrigger size="sm" className="w-32" aria-label={`Role for ${u.name}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell">
                        {u.role === "employer" ? `${u.jobCount} jobs` : u.role === "candidate" ? `${u.applicationCount} applications` : "—"}
                        <p className="text-xs">{u.lastLoginAt ? `Last seen ${timeAgo(u.lastLoginAt)}` : "Never signed in"}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden lg:table-cell">{fmtDate(u.createdAt)}</TableCell>
                      <TableCell className="pr-4 text-right">
                        {u.status === "suspended" && <Badge variant="destructive" className="mr-2">Suspended</Badge>}
                        {!self && (u.status === "active"
                          ? <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={async () => (await confirmAction({ title: `Suspend ${u.name}?`, description: `They'll be signed out everywhere${u.role === "employer" ? " and their jobs will be hidden" : ""}.`, confirmLabel: "Suspend", destructive: true })) && updateUser.mutate({ id: u.id, status: "suspended" })}>Suspend</Button>
                          : <Button size="sm" variant="outline" onClick={() => updateUser.mutate({ id: u.id, status: "active" })}>Reactivate</Button>)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {data && <div className="border-t px-4 py-3"><Pagination {...data} onPage={setPage} /></div>}
          </>
        )}
      </Card>
    </Page>
  );
}
