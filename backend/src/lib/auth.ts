import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { users, type Role } from "../db/schema.js";
import { forbidden, HttpError, unauthorized } from "./errors.js";
import { kv, redis } from "./redis.js";

export type AuthUser = { id: string; email: string; name: string; role: Role; status: "active" | "suspended" };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = () => crypto.randomBytes(48).toString("base64url");

// ─── Access tokens (JWT) ─────────────────────────────────────────────────────
export const signAccessToken = (u: { id: string; role: Role }) =>
  jwt.sign({ role: u.role }, env.JWT_ACCESS_SECRET, { subject: u.id, expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"] });

export function verifyAccessToken(token: string) {
  try { return String((jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload).sub); }
  catch { throw unauthorized("Invalid or expired access token"); }
}

// ─── Refresh sessions (Redis) ────────────────────────────────────────────────
// Opaque tokens; Redis stores only sha256(token) → userId. Every refresh rotates the token.
const SESSION_TTL = () => env.REFRESH_TTL_DAYS * 86400;
const userSessionsKey = (uid: string) => `usess:${uid}`;

export async function createSession(userId: string) {
  const token = randomToken();
  const h = sha256(token);
  await kv.set(`sess:${h}`, userId, SESSION_TTL());
  if (redis) { await redis.sadd(userSessionsKey(userId), h); await redis.expire(userSessionsKey(userId), SESSION_TTL()); }
  return token;
}

export async function rotateSession(token: string) {
  const h = sha256(token);
  const userId = await kv.take(`sess:${h}`);
  if (!userId) throw unauthorized("Invalid or expired refresh token");
  if (redis) await redis.srem(userSessionsKey(userId), h);
  return { userId, refreshToken: await createSession(userId) };
}

export async function endSession(token: string) {
  const h = sha256(token);
  const userId = await kv.take(`sess:${h}`);
  if (userId && redis) await redis.srem(userSessionsKey(userId), h);
}

/** Sign a user out everywhere (used when suspending). */
export async function endAllSessions(userId: string) {
  if (!redis) return;
  const hashes = await redis.smembers(userSessionsKey(userId));
  if (hashes.length) await redis.del(...hashes.map((h) => `sess:${h}`));
  await redis.del(userSessionsKey(userId));
}

export const tokenPair = async (u: { id: string; role: Role }) => ({
  accessToken: signAccessToken(u), refreshToken: await createSession(u.id), tokenType: "Bearer" as const,
});

// ─── Request authentication ──────────────────────────────────────────────────
/** Role and status come from the DB (cached 60s), not the JWT, so suspensions and role changes apply quickly. */
export async function loadAuthUser(id: string): Promise<AuthUser | null> {
  return kv.wrap(`authuser:${id}`, 60, async () => {
    const [u] = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status }).from(users).where(eq(users.id, id));
    return u ?? null;
  });
}
export const forgetAuthUser = (id: string) => kv.del(`authuser:${id}`);

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) throw unauthorized();
  const user = await loadAuthUser(verifyAccessToken(h.slice(7)));
  if (!user) throw unauthorized("Account no longer exists");
  if (user.status === "suspended") throw new HttpError(403, "account_suspended", "This account has been suspended");
  req.user = user;
  next();
}

/** Accepts the token if present; never rejects (public endpoints that personalise). */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) {
    try {
      const u = await loadAuthUser(verifyAccessToken(h.slice(7)));
      if (u?.status === "active") req.user = u;
    } catch { /* anonymous */ }
  }
  next();
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw unauthorized();
  if (!roles.includes(req.user.role)) throw forbidden(`This action requires the ${roles.join(" or ")} role`);
  next();
};

export const me = (req: Request) => {
  if (!req.user) throw unauthorized();
  return req.user;
};
