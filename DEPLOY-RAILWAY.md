# Deploying HireFlow to Railway

HireFlow runs on Railway as **one service** plus Railway's managed **PostgreSQL**. The container serves the React app and the API on the same domain, so there's no CORS setup. Server-Sent Events, background jobs and file storage all work exactly as in the local Docker demo, because Railway keeps the process running. Redis and an S3 bucket are optional, only needed to run more than one instance.

```
Browser ── https://<app>.up.railway.app ──▶  hireflow service  (Dockerfile, one process, $PORT)
                                              ├─ React app (static, from the image)
                                              ├─ REST API + /api/docs + Server-Sent Events
                                              ├─ background jobs (in-process)
                                              ├─ resumes ──▶ Volume  /data
                                              └─ SQL ──────────▶ Railway PostgreSQL
```

The repo already contains everything Railway reads:

| File | Purpose |
|---|---|
| `railway.json` | Build with `Dockerfile`, health check on `/health`, restart on failure |
| `Dockerfile` | Builds API + frontend into one Debian-slim image; runs as the unprivileged `node` user |
| `railway/start.sh` | Makes the volume writable, seeds demo data once (optional), starts the API (migrations run on start) |

## 1. Create the project

1. Push this folder to its own GitHub repository. (If it's part of a larger repo, set the service's **Root Directory** to this folder.)
2. In Railway: **New Project → Deploy from GitHub repo** and pick the repo. Railway finds `railway.json` and builds the `Dockerfile`. The first deploy will fail until steps 2–4 are done, which is expected.
3. In the same project: **+ Create → Database → PostgreSQL**.

## 2. Variables

Open the hireflow service → **Variables** and add:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Type exactly this; Railway links it to the database over the private network |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` | Signs access tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your admin login | Created on first start; **change the password from the default** |
| `SEED_DEMO_DATA` | `true` | Optional: creates demo users and data on first start (skipped once users exist). Omit for an empty install |
| `LOAD_SAMPLE_DATA` | (on by default) | Sample jobs and resumes from `samples/` load on the first deploy. Set `false` to skip (see "Sample data" below) |

You don't need to set storage variables: the image defaults to `STORAGE_DRIVER=local` with `LOCAL_UPLOAD_DIR=/data/uploads` (the volume from step 3). Railway provides `PORT` and the app listens on it.

## 3. Volume (persistent resumes)

Right-click the hireflow service (or **⌘K → Volume**) → **Attach volume**, mount path **`/data`**. Without a volume, uploaded resumes are lost on every redeploy.

## 4. Public domain

Service → **Settings → Networking → Generate Domain**. If Railway asks for a port, use the one it detects (the app listens on `$PORT`). `APP_URL` and `API_URL` default to this domain automatically (`RAILWAY_PUBLIC_DOMAIN`), so email links and CORS are correct.

Using a **custom domain**? Set `APP_URL` and `API_URL` to `https://your-domain` as well.

Railway redeploys after variable changes. Open the domain and sign in with `admin@hireflow.dev` (admin), `nina@northwind.dev` (employer), `asha@example.dev` (candidate), password `password123` (when `SEED_DEMO_DATA=true`). **Change these passwords, or deploy without demo data, before sharing the URL.**

## Sample data (loaded automatically)

On the **first deploy**, the app loads `samples/` by itself: 6 published jobs from the fictional employer Lumora Technologies, and 18 applications from 12 sample resumes (PDF and Word). It happens at container start, after migrations and before the API comes up, and the scoring worker scores the applications straight away. Look for this line in the Deploy Logs:

```
Sample data loaded: 6 jobs and 18 applications from 12 candidates. Sign in as talent@lumora.example.com / password123.
```

Later deploys print `Sample data already loaded … skipping`, so nothing is duplicated, and sample jobs you delete stay deleted.

- To **skip** it, set `LOAD_SAMPLE_DATA=false` before the first deploy.
- To **remove** sample data later, delete the sample jobs, or start over on a fresh database.
- The sample accounts' password is `password123`; set `SAMPLE_PASSWORD` before the first deploy to change it.

This runs in the app container rather than as a Railway pre-deploy command, because pre-deploy commands run without the volume mounted and the resume files need to be stored on it. See `samples/README.md` for which resume should fit which job.

## Optional

| Variable | Enables |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Real email (Resend, Postmark, SES, Brevo…). Without SMTP, emails are recorded (admin → Emails) and logged instead of sent. |
| `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`, default `gemini-3.8-flash`) | Free AI resume scoring with Gemini; get a key at **aistudio.google.com → Get API key**. Free tiers are rate-limited, and the provider may use free-tier data, so check its terms before scoring real candidates |
| `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`) | AI resume scoring with Claude; without an AI key the built-in keyword scorer is used. Then use **Re-score with AI** on a job to upgrade existing scores |
| `OPENAI_API_KEY` (+ `OPENAI_MODEL`) | Alternative AI provider, used only when no Anthropic key is set (or with `SCORING_PROVIDER=openai`) |

## Operations

| Task | How |
|---|---|
| Logs | Service → **Deployments → View logs** (or `railway logs`) |
| Reseed from scratch | `railway ssh` into the service, then `node dist/db/seed.js --force` (wipes and reseeds) |
| SQL shell | Postgres service → **Data**, or `railway connect Postgres` |
| Backups | Postgres service → **Backups**; the volume has its own backups under the volume's settings |
| Health | `GET /health` reports database and Redis status; Railway uses it to gate each deploy |

## Scaling beyond one instance

The volume ties the service to **one replica**, which is plenty for an MVP. To run several:

1. Add **Redis** (**+ Create → Database → Redis**) and set `REDIS_URL=${{Redis.REDIS_URL}}`. Live updates and rate limits then work across instances.
2. Move files to an S3-compatible bucket: set `STORAGE_DRIVER=s3` plus the `S3_*` variables (see `.env.example`) and detach the volume.
3. Raise `numReplicas` in `railway.json`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Set JWT_… in production` | Add the JWT variables from step 2 |
| `ECONNREFUSED` / `getaddrinfo` for the database | `DATABASE_URL` missing or not `${{Postgres.DATABASE_URL}}` |
| `getaddrinfo ENOTFOUND postgres.railway.internal` | The image is Debian-based to avoid Railway's Alpine DNS issue, and the app retries the database for about 60 s at startup. If it persists, check that Postgres is in the same project and environment, and that `DATABASE_URL` is a reference to it |
| Health check times out on first deploy | Check the logs. Migrations and the seed run before the server listens; the timeout is 180 s |
| `EACCES` writing uploads | Volume not mounted at `/data`, or `LOCAL_UPLOAD_DIR` overridden |
| Login works but links in emails point to the wrong host | Custom domain: set `APP_URL` / `API_URL` |
| 401 on everything after changing JWT secrets | Expected: everyone has to sign in again |
