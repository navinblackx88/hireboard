import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { redis } from "../src/lib/redis.js";
import { ensureBootstrapAdmin } from "../src/modules/auth/auth.routes.js";
import { closeAllStreams } from "../src/realtime/sse.js";

export type Ctx = { server: http.Server; url: string; api: ReturnType<typeof request> };

export async function startServer(): Promise<Ctx> {
  await runMigrations();
  const tables = (await pool.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => `"${r.tablename}"`);
  await pool.query(`truncate ${tables.join(", ")} cascade`);
  await redis?.flushdb();
  await ensureBootstrapAdmin();
  const server = http.createServer(createApp());
  await new Promise<void>((r) => server.listen(0, r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, api: request(server) };
}
export async function stopServer(ctx: Ctx) {
  closeAllStreams();
  await new Promise((r) => ctx.server.close(r));
}

export type U = { id: string; email: string; token: string; refresh: string; name: string };
let n = 0;
export async function signup(ctx: Ctx, name: string, role: "candidate" | "employer", extra: object = {}): Promise<U> {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${++n}@example.com`;
  const res = await ctx.api.post("/api/v1/auth/signup").send({ name, email, password: "password123", role, ...(role === "employer" ? { companyName: `${name} Inc` } : {}), ...extra });
  if (res.status !== 201) throw new Error(`signup ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email, token: res.body.accessToken, refresh: res.body.refreshToken, name };
}
export async function login(ctx: Ctx, email: string, password: string): Promise<U> {
  const res = await ctx.api.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email, token: res.body.accessToken, refresh: res.body.refreshToken, name: res.body.user.name };
}

export const as = (ctx: Ctx, u: U | null) => {
  const auth = <T extends request.Test>(t: T) => (u ? t.set("Authorization", `Bearer ${u.token}`) : t);
  const p = (path: string) => `/api/v1${path}`;
  return {
    get: (path: string) => auth(ctx.api.get(p(path))),
    post: (path: string, body?: object) => auth(ctx.api.post(p(path))).send(body ?? {}),
    patch: (path: string, body?: object) => auth(ctx.api.patch(p(path))).send(body ?? {}),
    delete: (path: string) => auth(ctx.api.delete(p(path))),
    upload: (path: string) => auth(ctx.api.post(p(path))),
  };
};

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await wait(50);
  }
}

/** Minimal SSE client: collects events from GET /events?ticket=… */
export async function openStream(ctx: Ctx, u: U) {
  const { body } = await as(ctx, u).post("/events/ticket");
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const req = http.get(`${ctx.url}/api/v1/events?ticket=${body.ticket}`);
  const res = await new Promise<http.IncomingMessage>((r) => req.on("response", r));
  let buf = "";
  res.setEncoding("utf8");
  res.on("data", (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
    }
  });
  await until(async () => events.some((e) => e.event === "ready"));
  return { status: res.statusCode, events, ticket: body.ticket as string, close: () => req.destroy() };
}
