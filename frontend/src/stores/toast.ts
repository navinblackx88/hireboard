import { toast as sonner } from "sonner";

/** Navigation for toast actions, registered by the app shell (keeps toasts callable outside React). */
let navigateTo: (href: string) => void = (href) => window.location.assign(href);
export const setToastNavigator = (fn: (href: string) => void) => { navigateTo = fn; };
const open = (href?: string) => (href ? { label: "View", onClick: () => navigateTo(href) } : undefined);

/** Thin wrapper over shadcn's Sonner toaster; the call signature predates it, so hooks stay unchanged. */
export const toast = {
  info: (title: string, body?: string, href?: string) => sonner(title, { description: body, action: open(href) }),
  success: (title: string, body?: string, href?: string) => sonner.success(title, { description: body, action: open(href) }),
  error: (title: string, body?: string) => sonner.error(title, { description: body, duration: 6500 }),
};
