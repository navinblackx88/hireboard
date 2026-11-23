import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { emailLog } from "../db/schema.js";
import { logger } from "./logger.js";

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type Email = {
  to: string; userId?: string; template: string; subject: string;
  heading: string; lines: string[]; cta?: { label: string; path: string }; meta?: Record<string, unknown>;
};

/** Sends (or, without SMTP, records) an email. Every attempt lands in email_log for auditing. */
export async function sendEmail(e: Email) {
  const url = e.cta ? `${env.APP_URL}${e.cta.path}` : env.APP_URL;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a">
    <div style="font-weight:700;color:#0f766e;font-size:18px;margin-bottom:16px">HireFlow</div>
    <h1 style="font-size:20px;margin:0 0 12px">${esc(e.heading)}</h1>
    ${e.lines.map((l) => `<p style="font-size:15px;line-height:1.5;margin:0 0 10px">${esc(l)}</p>`).join("")}
    ${e.cta ? `<p style="margin:20px 0"><a href="${url}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${esc(e.cta.label)}</a></p>` : ""}
    <p style="font-size:12px;color:#64748b;margin-top:24px">You can turn off email alerts in your HireFlow profile.</p></div>`;
  const text = [e.heading, "", ...e.lines, "", e.cta ? `${e.cta.label}: ${url}` : ""].join("\n");

  let status = "logged", error: string | undefined;
  if (transport) {
    try { await transport.sendMail({ from: env.EMAIL_FROM, to: e.to, subject: e.subject, text, html }); status = "sent"; }
    catch (err) { status = "failed"; error = (err as Error).message; logger.error({ err, to: e.to }, "email failed"); }
  } else logger.debug({ to: e.to, subject: e.subject }, "email logged (SMTP_HOST not set)");

  await db.insert(emailLog).values({ userId: e.userId, to: e.to, subject: e.subject, template: e.template, status, error, meta: e.meta ?? {} });
  return status;
}

export async function logSkippedEmail(e: Pick<Email, "to" | "userId" | "template" | "subject">) {
  await db.insert(emailLog).values({ ...e, status: "skipped", meta: { reason: "user opted out" } });
}
