import "dotenv/config";
import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

// On Railway the app and API share one origin; default the URLs from the service's generated public domain.
const publicHost = process.env.RAILWAY_PUBLIC_DOMAIN;
const defaultOrigin = publicHost ? `https://${publicHost}` : undefined;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default(defaultOrigin ?? "http://localhost:5173"), // frontend origin (CORS + links in emails)
  API_URL: z.string().default(defaultOrigin ?? "http://localhost:4000"),

  DATABASE_URL: z.string().default("postgres://hf:hf@localhost:5432/hireflow"),
  REDIS_URL: z.string().optional(), // unset → in-memory cache/sessions/pub-sub (single instance only)

  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TTL_DAYS: z.coerce.number().default(14),

  // Bootstraps the first admin on startup (idempotent). Admins can't sign up through the API.
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(), // unset → built-in heuristic scorer (clearly labelled)
  OPENAI_BASE_URL: z.string().optional(), // Azure/OpenAI-compatible gateways, or a mock in tests
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(45_000),
  SCORING_MAX_ATTEMPTS: z.coerce.number().default(3),
  SCORING_POLL_MS: z.coerce.number().default(2_000),

  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  LOCAL_UPLOAD_DIR: z.string().default("./uploads"),
  STATIC_DIR: z.string().optional(), // built frontend to serve from the API (single-service deploys, e.g. Railway)
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(), // MinIO, or https://storage.googleapis.com for GCS
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  MAX_RESUME_MB: z.coerce.number().default(5),

  DB_POOL_MAX: z.coerce.number().default(20),

  SMTP_HOST: z.string().optional(), // unset → emails are recorded and logged, not sent
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default("HireFlow <no-reply@hireflow.local>"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", z.treeifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;
if (env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL in production (Railway: service → Variables → DATABASE_URL=${{Postgres.DATABASE_URL}})");
}
if (env.NODE_ENV === "production" && env.JWT_ACCESS_SECRET.startsWith("dev-")) throw new Error("Set JWT_ACCESS_SECRET in production (Railway: service → Variables). Generate one with: openssl rand -base64 48");

