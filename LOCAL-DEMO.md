# HireFlow: local MVP demo (Docker only, no cloud)

One command brings up the whole product on a laptop. It needs no cloud account, no API keys and no internet access once the images are built.

```bash
docker compose up --build        # first build takes ~2–3 min
open http://localhost:8080
```

| Who | Email | Password |
|---|---|---|
| Admin (moderates jobs and users) | `admin@hireflow.dev` | `password123` |
| Employer (Northwind Labs) | `nina@northwind.dev` | `password123` |
| Candidate | `asha@example.dev` | `password123` |

| URL | What |
|---|---|
| http://localhost:8080 | App (and API, same origin) |
| http://localhost:8080/api/docs | Swagger UI (OpenAPI 3.0.3) |
| http://localhost:8025 | Mailpit: every notification email lands here |

---

## 1. Architecture

```
                         Browser  ──  http://localhost:8080
                            │
              ┌─────────────▼──────────────┐
              │  web  (nginx 1.27)         │  single origin: no CORS, no URLs baked per host
              │  /            → React SPA  │
              │  /api/v1/events → SSE      │  proxy_buffering off · 1 h read timeout
              │  /api/, /health → api:4000 │  10 MB body limit (5 MB resumes)
              └─────────────┬──────────────┘
                            │ internal network
              ┌─────────────▼──────────────┐        ┌──────────────────┐
              │  api  (Node 22, Express)   │──SMTP─▶│ mailpit          │ :8025 UI
              │  • REST + OpenAPI          │        └──────────────────┘
              │  • SSE hub (in-process)    │
              │  • scoring worker          │        ┌──────────────────┐
              │    (Postgres-backed queue) │──SQL──▶│ postgres 16      │ volume: pgdata
              │  • resume parse (pdf.js,   │        └──────────────────┘
              │    mammoth)                │
              │  • local file storage      │──────▶ volume: uploads (resumes)
              └────────────────────────────┘
```

| Container | Image | Role | Exposed |
|---|---|---|---|
| `web` | built from `frontend/Dockerfile` (nginx) | Serves the SPA; reverse-proxies API and SSE | **8080** |
| `api` | built from `backend/Dockerfile` (node:22-alpine, non-root) | Business logic, auth, SSE, scoring worker, file storage | internal only |
| `postgres` | postgres:16-alpine | System of record and the scoring job queue | internal only |
| `mailpit` | axllent/mailpit | Captures outbound email | **8025** |

Only two ports are published. The database is reachable only from inside the Compose network.

### Request flows

- **Apply:** candidate uploads a PDF or DOCX. The API parses the text, stores the file on the `uploads` volume, creates the application and enqueues a scoring job in Postgres. It then publishes a `new_applicant` event (employer toast) and sends email to Mailpit.
- **Score:** the in-process worker claims the job (`FOR UPDATE SKIP LOCKED`), scores the resume against the job, writes score, strengths and gaps, and pushes `score_updated` over SSE. The applicant list updates without a refresh.
- **Pipeline move:** employer drags the applicant to *Shortlisted*. The candidate's open tab gets `application_status` over SSE in about 150 ms, plus an email.
- **Moderation:** employers submit jobs as *pending review*. The admin approves, and the job goes live on the public board.

## 2. Design decisions (and why)

| Decision | Rationale | Production equivalent |
|---|---|---|
| **No Redis** in the demo | One API instance means SSE fan-out and rate limits can stay in memory. The app detects `REDIS_URL` unset and falls back automatically. | Add Redis with `REDIS_URL`. Pub/sub then fans events out across N API replicas. |
| **Postgres as the job queue** | Durable retries without another broker. Jobs survive restarts, and `SKIP LOCKED` makes multiple workers safe. | Same, or move to a dedicated queue at high volume. |
| **Offline keyword scorer** by default | Demo works with no keys and no internet, and is deterministic. | Set `GEMINI_API_KEY` (free) or `ANTHROPIC_API_KEY` and AI scores resumes (OpenAI is also supported); failed calls are retried by the queue. |
| **Local volume storage** for resumes | Removes the object-store dependency. Downloads are short-lived signed URLs served by the API, so the access model is the same. | `STORAGE_DRIVER=s3` (S3, R2, GCS). No code change. |
| **nginx single origin** | No CORS. The frontend is built with `VITE_API_URL=""`, so the same image works on any host. SSE gets an unbuffered location. | Same pattern behind a load balancer or CDN. |
| **Mailpit** | Real SMTP path exercised end to end; nothing leaves the machine. | Any SMTP provider via `SMTP_*`. |
| **Migrations + bootstrap admin on boot**, optional seed | `docker compose up` is the only step. The seed is idempotent and skips if users exist. | Same; set `SEED_DEMO_DATA=false`. |
| **Multi-stage, non-root images** with root-lockfile `npm ci -w` | Reproducible builds from one lockfile; the runtime image has prod dependencies only. | Same images go to any registry or orchestrator. |

## 3. Demo script (about 10 minutes)

Use two browser windows (one normal, one private) so two users are signed in at once.

1. **Public board** (no login): open http://localhost:8080/jobs. Search "engineer", filter by workplace, open a job.
2. **Candidate applies.** Sign in as **asha@example.dev** and apply to *Senior Backend Engineer, Payments* with a PDF resume (drag and drop). Point out the parsed preview: pages and characters read.
3. **Employer sees it live.** In the other window, sign in as **nina@northwind.dev** and open that job. A *new applicant* toast appears, and the match score fills in within seconds, with strengths and gaps.
4. **Move the pipeline.** Drag Asha to *Shortlisted*. Asha's window updates instantly (SSE), with no refresh.
5. **Email.** Open http://localhost:8025 to see the application confirmation and status-change emails.
6. **Moderation.** Sign in as **admin@hireflow.dev**, open *Jobs*, and approve *Staff Engineer, Platform* (pending review). It now appears on the public board. Show the user list and the analytics page.
7. **API.** Open http://localhost:8080/api/docs and run `GET /api/v1/jobs` from Swagger.
8. **Resilience (optional).** Run `docker compose restart api`. The browsers reconnect the event stream on their own and nothing is lost.

## 4. Operations

```bash
docker compose up --build -d          # start in background
docker compose ps                     # health of each service
docker compose logs -f api            # API + worker logs
docker compose restart api            # restart just the API
docker compose down                   # stop (keeps data)
docker compose down -v                # stop and wipe DB + resumes (fresh demo next start)
docker compose exec api node dist/db/seed.js --force   # reseed without wiping volumes
docker compose exec postgres psql -U hf hireflow       # SQL shell
```

Optional settings (put them in a `.env` file next to `docker-compose.yml`, or export them):

| Variable | Default | Effect |
|---|---|---|
| `GEMINI_API_KEY` | empty | Enables AI scoring with Gemini; free key from aistudio.google.com (needs internet) |
| `ANTHROPIC_API_KEY` | empty | Enables AI scoring with Claude; used instead of Gemini when both are set (needs internet) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | `claude-haiku-5-5` is cheaper and faster |
| `SEED_DEMO_DATA` | `true` | `false` = empty install with the admin only |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin@hireflow.dev / password123 | Bootstrap admin |
| `JWT_ACCESS_SECRET` | demo value | Change it for anything beyond a local demo |

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Port 8080 or 8025 in use | Change the left side of `ports:` in `docker-compose.yml` (e.g. `"9090:80"`), then also set `APP_URL`/`API_URL` for `api` to the new URL. |
| Login fails with demo users | Data volume predates the seed. Run `docker compose down -v && docker compose up -d`. |
| Scores stay "pending" | `docker compose logs api` should show "scoring heuristic". The worker starts with the API, so check the API is healthy. |
| Live updates don't arrive | Make sure you use http://localhost:8080. The SSE location in `frontend/nginx.conf` must keep `proxy_buffering off`. |
| Build fails at `npm ci` | Build from the repo root (Compose does this already). The root `package-lock.json` is the only lockfile. |

## 6. Path from MVP to production

1. Add **Redis** (`REDIS_URL`) and run 2+ `api` replicas behind the proxy. SSE and rate limits become cluster-wide.
2. Switch storage to **S3-compatible** (`STORAGE_DRIVER=s3`) and Postgres to a managed instance with backups.
3. Set `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`) for AI scoring, and a real SMTP provider.
4. Put TLS in front, using nginx or a load balancer.

To host it in the cloud, deploy the same codebase to Railway; see `DEPLOY-RAILWAY.md`.
