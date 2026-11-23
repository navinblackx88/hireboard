import crypto from "node:crypto";
import { Router, type Response } from "express";
import { forbidden, unauthorized } from "../lib/errors.js";
import { authenticate, loadAuthUser, me } from "../lib/auth.js";
import { kv, onMessage, publish } from "../lib/redis.js";
import type { Role } from "../db/schema.js";

/**
 * Server-Sent Events. EventSource can't send an Authorization header, so the client first
 * POSTs /events/ticket (authenticated) for a single-use, 60-second ticket, then opens
 * GET /events?ticket=…. Events are published through Redis so every instance can deliver
 * them to its own connections.
 *
 * Event names: application.created, application.status_changed, application.scored,
 *              job.status_changed, job.submitted
 */
export type EventName = "application.created" | "application.status_changed" | "application.scored" | "job.status_changed" | "job.submitted";
type Envelope = { to: { userId?: string; role?: Role }; event: EventName; data: unknown; id: string };

const clients = new Map<Response, { userId: string; role: Role }>();
let unsubscribe: (() => void) | null = null;

function deliver(raw: string) {
  const msg = JSON.parse(raw) as Envelope;
  for (const [res, who] of clients) {
    if ((msg.to.userId && msg.to.userId === who.userId) || (msg.to.role && msg.to.role === who.role)) {
      res.write(`id: ${msg.id}\nevent: ${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`);
    }
  }
}

/** Delivers over SSE; with REDIS_URL set, events fan out to every API instance via Redis pub/sub. */
export const emit = {
  toUser: async (userId: string, event: EventName, data: unknown) => {
    await publish({ to: { userId }, event, data, id: crypto.randomUUID() });
  },
  toRole: async (role: Role, event: EventName, data: unknown) => {
    await publish({ to: { role }, event, data, id: crypto.randomUUID() });
  },
};

export const eventsRouter = Router();

eventsRouter.post("/ticket", authenticate, async (req, res) => {
  const ticket = crypto.randomBytes(24).toString("base64url");
  await kv.set(`sse:${ticket}`, me(req).id, 60);
  res.status(201).json({ ticket, expiresInSeconds: 60 });
});

eventsRouter.get("/", async (req, res) => {
  const userId = await kv.take(`sse:${String(req.query.ticket ?? "")}`);
  if (!userId) throw unauthorized("Missing or expired event-stream ticket");
  const user = await loadAuthUser(userId);
  if (!user || user.status !== "active") throw forbidden();

  unsubscribe ??= onMessage(deliver);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx)
  });
  res.write(`retry: 3000\nevent: ready\ndata: {"userId":"${user.id}"}\n\n`);
  clients.set(res, { userId: user.id, role: user.role });

  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});

export const connectedClients = () => clients.size;
export function closeAllStreams() {
  for (const res of clients.keys()) res.end();
  clients.clear();
  unsubscribe?.();
  unsubscribe = null;
}
