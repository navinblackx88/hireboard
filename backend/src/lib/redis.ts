import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Redis is used for: response caching, refresh-token sessions, short-lived SSE tickets,
 * a per-user status cache, and pub/sub fan-out of real-time events across API instances.
 * Without REDIS_URL everything falls back to process memory (fine for one dev instance).
 */
export const redis: Redis | null = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }) : null;
redis?.on("error", (err) => logger.error({ err }, "redis error"));

const mem = new Map<string, { v: string; exp: number }>();
const memGet = (k: string) => {
  const hit = mem.get(k);
  if (!hit) return null;
  if (hit.exp < Date.now()) { mem.delete(k); return null; }
  return hit.v;
};

export const kv = {
  async get(key: string) { return redis ? redis.get(key) : memGet(key); },
  async set(key: string, value: string, ttlSeconds: number) {
    if (redis) await redis.set(key, value, "EX", ttlSeconds);
    else mem.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  },
  async del(...keys: string[]) {
    if (!keys.length) return;
    if (redis) await redis.del(...keys);
    else keys.forEach((k) => mem.delete(k));
  },
  /** Atomic read-and-delete (single-use tokens). */
  async take(key: string) {
    if (redis) return redis.getdel(key);
    const v = memGet(key); mem.delete(key); return v;
  },
  async incr(key: string) {
    if (redis) return redis.incr(key);
    const n = Number(memGet(key) ?? 0) + 1;
    mem.set(key, { v: String(n), exp: Number.MAX_SAFE_INTEGER });
    return n;
  },
  async getJSON<T>(key: string): Promise<T | undefined> {
    const raw = await this.get(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  },
  setJSON(key: string, value: unknown, ttl: number) { return this.set(key, JSON.stringify(value), ttl); },
  async wrap<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.getJSON<T>(key);
    if (hit !== undefined) return hit;
    const v = await fn();
    await this.setJSON(key, v, ttl);
    return v;
  },
};

/** Generation counters: bump once to invalidate every cached key in a scope. */
export const cacheVersion = async (scope: string) => (await kv.get(`ver:${scope}`)) ?? "0";
export const bumpVersion = (scope: string) => kv.incr(`ver:${scope}`);

// ─── Pub/sub ─────────────────────────────────────────────────────────────────
const local = new EventEmitter().setMaxListeners(0);
let subscriber: Redis | null = null;
const CHANNEL = "hireflow:events";

export async function publish(message: object) {
  const raw = JSON.stringify(message);
  if (redis) await redis.publish(CHANNEL, raw);
  else local.emit("message", raw);
}

export function onMessage(handler: (raw: string) => void) {
  if (redis && !subscriber) {
    subscriber = redis.duplicate();
    void subscriber.subscribe(CHANNEL);
    subscriber.on("message", (_ch, raw) => local.emit("message", raw));
  }
  local.on("message", handler);
  return () => local.off("message", handler);
}

export async function closeRedis() {
  subscriber?.disconnect();
  redis?.disconnect();
}
