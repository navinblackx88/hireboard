import { format, formatDistanceToNowStrict } from "date-fns";

export const fmtDate = (d: string | Date | null | undefined, f = "d MMM yyyy") => (d ? format(new Date(d), f) : "—");
export const timeAgo = (d: string | Date) => `${formatDistanceToNowStrict(new Date(d))} ago`;
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const compact = (n: number, currency: string) => {
  if (currency === "INR") {
    if (n >= 10_000_000) return `${+(n / 10_000_000).toFixed(1)} Cr`;
    if (n >= 100_000) return `${+(n / 100_000).toFixed(1)} L`;
  }
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(0)}k`;
  return String(n);
};
const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

/** "₹32 L – 48 L / yr" (Indian lakh/crore for INR), "$120k – 150k / yr" otherwise. */
export function salary(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return null;
  const s = SYMBOL[currency] ?? `${currency} `;
  if (min != null && max != null) return `${s}${compact(min, currency)} – ${compact(max, currency)} / yr`;
  return min != null ? `From ${s}${compact(min, currency)} / yr` : `Up to ${s}${compact(max!, currency)} / yr`;
}
