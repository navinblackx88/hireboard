import http from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { pool } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";
import { closeRedis, redis } from "./lib/redis.js";
import { ensureBootstrapAdmin } from "./modules/auth/auth.routes.js";
import { aiEnabled } from "./modules/scoring/scorer.js";
import { setWorker, startScoringWorker } from "./modules/scoring/worker.js";
import { closeAllStreams } from "./realtime/sse.js";

await runMigrations();
await ensureBootstrapAdmin();
const server = http.createServer(createApp());
const worker = startScoringWorker();
setWorker(worker);

server.listen(env.PORT, () => {
  logger.info(`API ${env.API_URL} · docs ${env.API_URL}/api/docs · redis ${redis ? "on" : "off"} · scoring ${aiEnabled() ? `OpenAI (${env.OPENAI_MODEL})` : "heuristic (set OPENAI_API_KEY for AI scoring)"}`);
});

async function shutdown(sig: string) {
  logger.info(`${sig}: shutting down`);
  worker.stop();
  closeAllStreams();
  server.close();
  await pool.end();
  await closeRedis();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
