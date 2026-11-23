import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";
import { authenticate, requireRole } from "./lib/auth.js";
import { redis } from "./lib/redis.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { spa } from "./lib/spa.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { applicationRouter, jobApplicationsRouter } from "./modules/applications/application.routes.js";
import { publicFilesRouter } from "./modules/applications/files.js";
import { resumeRouter } from "./modules/applications/resume.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { adminJobsRouter, employerRouter, jobsRouter } from "./modules/jobs/job.routes.js";
import { scoringRouter } from "./modules/scoring/scoring.routes.js";
import { eventsRouter } from "./realtime/sse.js";
import { configRouter } from "./realtime/routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const openapiPath = path.resolve(here, "../openapi.yaml");

/** /api/v1 route table, kept as data so a test can check it against the OpenAPI spec. */
export const mounts: [string, Router, ...express.RequestHandler[]][] = [
  ["/auth", authRouter],
  ["/events", eventsRouter],
  ["/config", configRouter],
  ["/files", publicFilesRouter],
  ["/jobs", jobsRouter],
  ["/jobs/:id/applications", jobApplicationsRouter, authenticate],
  ["/employer", employerRouter, authenticate, requireRole("employer")],
  ["/resumes", resumeRouter, authenticate, requireRole("candidate")],
  ["/applications", applicationRouter, authenticate],
  ["/scoring", scoringRouter, authenticate, requireRole("employer", "admin")],
  ["/admin/jobs", adminJobsRouter, authenticate, requireRole("admin")],
  ["/admin", adminRouter, authenticate, requireRole("admin")],
];

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  // Single-service deploys: the API also serves the React app (before helmet's API-oriented CSP).
  if (env.STATIC_DIR) app.use(spa(env.STATIC_DIR));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  // Compression would buffer the SSE stream, so skip it there.
  app.use(compression({ filter: (req, res) => !req.path.startsWith("/api/v1/events") && compression.filter(req, res) }));
  app.use(express.json({ limit: "1mb" }));
  if (env.NODE_ENV !== "test") app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get(["/health", "/api/health"], async (_req, res) => {
    const checks: Record<string, boolean | string> = { db: false, redis: redis ? false : "disabled" };
    try { await pool.query("select 1"); checks.db = true; } catch { /* reported */ }
    if (redis) try { checks.redis = (await redis.ping()) === "PONG"; } catch { /* reported */ }
    res.status(checks.db && checks.redis !== false ? 200 : 503).json({ status: checks.db ? "ok" : "degraded", checks });
  });

  const spec = YAML.parse(fs.readFileSync(openapiPath, "utf8"));
  app.get("/api/openapi.json", (_req, res) => res.json(spec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "HireFlow API" }));

  const v1 = Router();
  for (const [mount, router, ...guards] of mounts) v1.use(mount, ...guards, router);
  app.use("/api/v1", v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
