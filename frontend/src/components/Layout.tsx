import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, Monitor, Moon, Sun, UserCircle } from "lucide-react";
import { useMe } from "@/hooks/api";
import { useEventStream } from "@/hooks/useEventStream";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { setToastNavigator } from "@/stores/toast";
import { useTheme, type Theme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserAvatar } from "./common";

const NAV: Record<Role | "guest", { to: string; label: string; end?: boolean }[]> = {
  guest: [{ to: "/jobs", label: "Find jobs" }],
  candidate: [{ to: "/candidate", label: "Dashboard", end: true }, { to: "/jobs", label: "Find jobs" }, { to: "/candidate/applications", label: "Applications" }, { to: "/candidate/resumes", label: "Resumes" }],
  employer: [{ to: "/employer", label: "Dashboard", end: true }, { to: "/employer/jobs/new", label: "Post a job" }],
  admin: [{ to: "/admin", label: "Analytics", end: true }, { to: "/admin/jobs", label: "Job approvals" }, { to: "/admin/users", label: "Users" }, { to: "/admin/emails", label: "Email log" }, { to: "/jobs", label: "Job board" }],
};

export const homeFor = (role?: Role) => (role === "admin" ? "/admin" : role === "employer" ? "/employer" : role === "candidate" ? "/candidate" : "/jobs");

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    const { refreshToken, clear } = useAuth.getState();
    if (refreshToken) await api("/auth/logout", { body: { refreshToken } }).catch(() => undefined);
    clear(); qc.clear(); navigate("/login");
  };
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn("inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground");

export function AppLayout() {
  const { data: me } = useMe();
  const live = useEventStream(me?.role);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setToastNavigator(navigate), [navigate]);
  useEffect(() => setOpen(false), [location.pathname]);
  const links = NAV[me?.role ?? "guest"];

  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-background/90 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link to={homeFor(me?.role)} className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="size-8" />HireFlow
          </Link>
          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>{l.label}</NavLink>)}
          </nav>
          <div className="flex-1" />
          {me && (
            <Badge variant="outline" className={cn("hidden gap-1.5 sm:inline-flex", live ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} title={live ? "Live updates on" : "Connecting…"}>
              <span className={cn("size-2 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground/40")} />{live ? "Live" : "Offline"}
            </Badge>
          )}
          {me ? <UserMenu /> : (
            <div className="hidden items-center gap-2 sm:flex">
              <ThemeToggle />
              <Button variant="ghost" asChild><Link to="/login">Sign in</Link></Button>
              <Button asChild><Link to="/signup?role=employer">Post a job</Link></Button>
            </div>
          )}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><Menu className="size-5" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2"><img src="/favicon.svg" alt="" className="size-6" />HireFlow</SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4" aria-label="Mobile">
                {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>{l.label}</NavLink>)}
                {!me && <><Separator className="my-2" /><NavLink to="/login" className={navClass}>Sign in</NavLink><NavLink to="/signup" className={navClass}>Create account</NavLink></>}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="text-muted-foreground border-t py-6 text-center text-xs">HireFlow · AI scores are a screening aid; people make hiring decisions.</footer>
    </div>
  );
}

function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>
      {resolved === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 rounded-full" aria-label="Account menu"><UserAvatar user={{ id: me.id, name: me.name, avatarUrl: null }} size={34} /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{me.name}</p>
          <p className="text-muted-foreground truncate text-xs">{me.email}</p>
          <p className="text-primary mt-1 text-xs font-medium capitalize">{me.role}{me.companyName ? ` · ${me.companyName}` : ""}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/profile"><UserCircle />Profile & email alerts</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light"><Sun />Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon />Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor />System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Page({ title, subtitle, actions, children, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; back?: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {back && <div className="mb-3">{back}</div>}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="text-muted-foreground mt-1 text-sm">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
