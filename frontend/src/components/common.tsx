import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { AlertTriangle, CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

// ─── Loading / empty / error ────────────────────────────────────────────────
export const PageSpinner = () => <div className="flex h-64 items-center justify-center"><Spinner className="text-muted-foreground size-6" /></div>;

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Empty className={cn("border", className)}>
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        {body && <EmptyDescription>{body}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>
        <p>{error instanceof Error ? error.message : "Please try again."}</p>
        {retry && <Button size="sm" variant="outline" className="mt-2" onClick={retry}>Try again</Button>}
      </AlertDescription>
    </Alert>
  );
}

/** Calls onVisible when the sentinel scrolls into view: drives infinite scroll. */
export function InfiniteSentinel({ onVisible, active, loading }: { onVisible: () => void; active: boolean; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    if (!active || !ref.current) return;
    const io = new IntersectionObserver((es) => es[0]?.isIntersecting && cb.current(), { rootMargin: "300px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [active]);
  return <div ref={ref} className="flex h-10 items-center justify-center">{loading && <Spinner className="text-muted-foreground" />}</div>;
}

// ─── Form helpers ───────────────────────────────────────────────────────────
export function Field({ label, htmlFor, children, hint, className }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** shadcn date picker (Popover + Calendar). Value/onChange use "yyyy-MM-dd" strings, like <input type="date">. */
export function DatePicker({ value, onChange, disabled, placeholder = "Pick a date", id, className, variant = "outline", clearable = true }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; id?: string; className?: string;
  variant?: "outline" | "ghost"; clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("flex items-center gap-1", className)}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant={variant} disabled={disabled} data-empty={!date}
            className={cn("data-[empty=true]:text-muted-foreground min-w-0 flex-1 justify-start font-normal", variant === "ghost" && "px-2")}>
            <CalendarIcon />{date ? format(date, "d MMM yyyy") : placeholder}
          </Button>
        </PopoverTrigger>
        {clearable && date && !disabled && (
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Clear date" onClick={() => onChange("")}><X /></Button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} defaultMonth={date}
          onSelect={(d) => { onChange(d ? format(d, "yyyy-MM-dd") : ""); setOpen(false); }} />
      </PopoverContent>
    </Popover>
  );
}

// ─── Confirm dialog (replaces window.confirm) ───────────────────────────────
type ConfirmOpts = { title: string; description?: ReactNode; confirmLabel?: string; destructive?: boolean };
type ConfirmState = { opts: (ConfirmOpts & { resolve: (ok: boolean) => void }) | null };
const useConfirmStore = create<ConfirmState>(() => ({ opts: null }));

/** `if (await confirmAction({ title: "Delete?" })) …`. Rendered by <ConfirmHost/> as a shadcn AlertDialog. */
export const confirmAction = (opts: ConfirmOpts) =>
  new Promise<boolean>((resolve) => useConfirmStore.setState({ opts: { ...opts, resolve } }));

export function ConfirmHost() {
  const opts = useConfirmStore((s) => s.opts);
  const close = (ok: boolean) => { opts?.resolve(ok); useConfirmStore.setState({ opts: null }); };
  return (
    <AlertDialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={cn(opts?.destructive && buttonVariants({ variant: "destructive" }))} onClick={() => close(true)}>
            {opts?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Avatars ────────────────────────────────────────────────────────────────
const PALETTE = ["bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-pink-500", "bg-teal-500", "bg-indigo-500"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export function UserAvatar({ user, size = 28, ring, className }: { user: Pick<User, "id" | "name" | "avatarUrl">; size?: number; ring?: boolean; className?: string }) {
  return (
    <Avatar title={user.name} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }} className={cn(ring && "ring-background ring-2", className)}>
      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} referrerPolicy="no-referrer" />}
      <AvatarFallback className={cn("font-semibold text-white", PALETTE[hash(user.id) % PALETTE.length])}>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
}

export function AvatarStack({ users, max = 3, size = 24 }: { users: Pick<User, "id" | "name" | "avatarUrl">[]; max?: number; size?: number }) {
  if (!users.length) return null;
  return (
    <div className="flex -space-x-1.5">
      {users.slice(0, max).map((u) => <UserAvatar key={u.id} user={u} size={size} ring />)}
      {users.length > max && (
        <span style={{ width: size, height: size }} className="bg-muted text-muted-foreground ring-background inline-flex items-center justify-center rounded-full text-[10px] font-semibold ring-2">
          +{users.length - max}
        </span>
      )}
    </div>
  );
}

/** Destructive action gated on typing a phrase (replaces window.prompt). */
export function TypeToConfirm({ trigger, title, description, phrase, confirmLabel, onConfirm }: {
  trigger: ReactNode; title: string; description: ReactNode; phrase: string; confirmLabel: string; onConfirm: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <span onClick={() => setOpen(true)} className="contents">{trigger}</span>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="type-to-confirm" className="font-normal">Type <b className="font-mono">{phrase}</b> to confirm</Label>
          <input id="type-to-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={typed !== phrase || busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); setOpen(false); } finally { setBusy(false); } }}>
            {busy && <Spinner />}{confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
