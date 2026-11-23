import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { users, type User } from "../../db/schema.js";
import { authenticate, endSession, forgetAuthUser, me, rotateSession, signAccessToken, tokenPair } from "../../lib/auth.js";
import { badRequest, HttpError, unauthorized } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { body } from "../../lib/validate.js";

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: env.NODE_ENV === "test" ? 10_000 : 30, standardHeaders: "draft-8", legacyHeaders: false });

const email = z.email().max(320).transform((s) => s.trim().toLowerCase());
const password = z.string().min(8, "Password must be at least 8 characters").max(128);
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5Lr6X7S0VWuXg0n9g0k2Q3lFJz7WkXy";

export const toSelf = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
  companyName: u.companyName, companyWebsite: u.companyWebsite, headline: u.headline, location: u.location,
  emailNotifications: u.emailNotifications, createdAt: u.createdAt,
});

const findByEmail = async (e: string) => (await db.select().from(users).where(sql`lower(${users.email}) = ${e}`))[0];

authRouter.post("/signup", limiter, async (req, res) => {
  const input = body(req, z.object({
    name: z.string().trim().min(1).max(120), email, password,
    role: z.enum(["employer", "candidate"]), // admins are provisioned, never self-registered
    companyName: z.string().trim().min(1).max(160).optional(),
    headline: z.string().trim().max(200).optional(),
    location: z.string().trim().max(120).optional(),
  }).refine((v) => v.role !== "employer" || v.companyName, { path: ["companyName"], message: "Company name is required for employers" }));
  if (await findByEmail(input.email)) throw new HttpError(409, "email_taken", "An account with this email already exists");
  const [user] = await db.insert(users).values({
    name: input.name, email: input.email, role: input.role, passwordHash: await bcrypt.hash(input.password, 12),
    companyName: input.role === "employer" ? input.companyName : null,
    headline: input.role === "candidate" ? input.headline : null, location: input.location,
    lastLoginAt: new Date(),
  }).returning();
  res.status(201).json({ user: toSelf(user), ...(await tokenPair(user)) });
});

authRouter.post("/login", limiter, async (req, res) => {
  const input = body(req, z.object({ email, password: z.string().min(1) }));
  const user = await findByEmail(input.email);
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH); // constant-ish time
  if (!user || !ok) throw unauthorized("Invalid email or password");
  if (user.status === "suspended") throw new HttpError(403, "account_suspended", "This account has been suspended. Contact support.");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  res.json({ user: toSelf(user), ...(await tokenPair(user)) });
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = body(req, z.object({ refreshToken: z.string().min(1) }));
  const rotated = await rotateSession(refreshToken);
  const [user] = await db.select().from(users).where(eq(users.id, rotated.userId));
  if (!user || user.status === "suspended") { await endSession(rotated.refreshToken); throw unauthorized(); }
  res.json({ accessToken: signAccessToken(user), refreshToken: rotated.refreshToken, tokenType: "Bearer" });
});

authRouter.post("/logout", async (req, res) => {
  const { refreshToken } = body(req, z.object({ refreshToken: z.string().min(1) }));
  await endSession(refreshToken);
  res.status(204).end();
});

authRouter.get("/me", authenticate, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, me(req).id));
  res.json({ user: toSelf(user) });
});

authRouter.patch("/me", authenticate, async (req, res) => {
  const actor = me(req);
  const input = body(req, z.object({
    name: z.string().trim().min(1).max(120).optional(),
    companyName: z.string().trim().min(1).max(160).optional(),
    companyWebsite: z.url().max(300).nullable().optional(),
    headline: z.string().trim().max(200).nullable().optional(),
    location: z.string().trim().max(120).nullable().optional(),
    emailNotifications: z.boolean().optional(),
    currentPassword: z.string().optional(),
    newPassword: password.optional(),
  }));
  const [user] = await db.select().from(users).where(eq(users.id, actor.id));
  const { currentPassword, newPassword, ...profile } = input;
  const patch: Partial<User> = profile;
  if (actor.role !== "employer") { delete patch.companyName; delete patch.companyWebsite; }
  if (newPassword) {
    if (!(await bcrypt.compare(currentPassword ?? "", user.passwordHash))) throw badRequest("Current password is incorrect");
    patch.passwordHash = await bcrypt.hash(newPassword, 12);
  }
  const [updated] = await db.update(users).set(patch).where(eq(users.id, actor.id)).returning();
  await forgetAuthUser(actor.id);
  res.json({ user: toSelf(updated) });
});

/** Creates or promotes the ADMIN_EMAIL account on startup. Safe to run repeatedly. */
export async function ensureBootstrapAdmin() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  const addr = env.ADMIN_EMAIL.toLowerCase();
  const existing = await findByEmail(addr);
  if (existing) {
    if (existing.role !== "admin") await db.update(users).set({ role: "admin" }).where(eq(users.id, existing.id));
    return;
  }
  await db.insert(users).values({ email: addr, name: "Administrator", role: "admin", passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 12) });
  logger.info({ email: addr }, "bootstrap admin created");
}
