# HireFlow: a job board with AI-assisted screening

Employers post jobs, admins approve them, candidates upload a resume and apply, and every application
gets an AI match score with reasoning. Status changes reach candidates instantly (Server-Sent Events)
and by email.

```
hireflow/
├── backend/   Node 22 · Express 5 · TypeScript · PostgreSQL (Drizzle) · Redis · OpenAI · S3/GCS · Nodemailer
│   ├── openapi.yaml    OpenAPI 3.0.3: 35 paths, 42 operations (Swagger UI at /api/docs)
│   ├── src/modules/    auth · jobs · applications (+ resumes) · scoring · notifications · admin
│   ├── src/realtime/   SSE stream (Redis pub/sub fan-out)
│   └── tests/          integration tests on real Postgres + Redis, with a mock OpenAI server
├── frontend/  React 19 · TypeScript · shadcn/ui (Radix) · Tailwind CSS 4 · React Query · Zustand · Recharts
└── docker-compose.yml  local demo stack: Postgres, Mailpit, API, nginx web (no cloud services)
```

## Run it

**Docker** (local MVP demo, no cloud services, nothing to configure):
```bash
docker compose up --build
```
Open **http://localhost:8080** and sign in as `admin@hireflow.dev`, `nina@northwind.dev` (employer) or `asha@example.dev` (candidate), password `password123`. Emails land at http://localhost:8025, API docs at http://localhost:8080/api/docs. Scoring uses the offline keyword scorer; set `OPENAI_API_KEY` for AI scoring. See **[LOCAL-DEMO.md](LOCAL-DEMO.md)** for the architecture, a 10-minute demo script and operations.

**Local** (Postgres 16 + Redis 7):
```bash
npm install
cp backend/.env.example backend/.env            # add OPENAI_API_KEY if you have one
npm run seed
npm run dev:api        # :4000
npm run dev:web        # :5173
```

Demo logins (password `password123`): **admin@hireflow.dev** (admin), **nina@northwind.dev** (employer, Northwind Labs),
**leo@lumenhealth.dev** (employer, Lumen Health), **asha@example.dev** (candidate) and four more candidates.
The seed includes real PDF and DOCX resumes, 12 live jobs, two awaiting approval, one rejected,
and 23 applications spread over 30 days so the analytics have shape.

## Deploy to Railway

One service built from the `Dockerfile` (serves the app and the API on one domain), Railway PostgreSQL and a volume for uploads. Redis and S3 are optional, only for scaling out. See **[DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md)**.

## What's in it

**Candidates.** Browse jobs with keyword, location, type, workplace, experience, salary and date filters (shareable URLs,
page-number pagination). Drag-and-drop PDF/DOCX upload; the text is extracted once, and you can preview exactly what
employers' screening sees. One-click apply with a default resume, plus a live status tracker with a timeline and notes.

**Employers.** Post a job (it goes to review), save drafts, edit, close. The applicant list is ranked by AI match score,
with filters and status tabs. The applicant drawer shows the score with strengths and gaps, the resume text, the cover letter
and the history. Move candidates through the pipeline with an optional message that's emailed to them. New applicants and
finished scores appear live.

**Admins.** Analytics: users, live jobs, review queue, average score, average review time, applications and sign-ups per day,
the hiring funnel, score distribution and top jobs. Approve or reject postings (with a reason, emailed to the employer). Search users,
change roles, and suspend or reactivate them (suspension signs the user out everywhere and hides their jobs). Plus an email log.

## UI: shadcn/ui

The frontend is built on [shadcn/ui](https://ui.shadcn.com) (new-york style, Radix primitives, Tailwind CSS 4, React 19).

- **Components live in the repo** under `frontend/src/components/ui/` (button, card, dialog, sheet, dropdown-menu, select, command, popover, calendar, tabs, table, chart, sonner, tooltip, alert-dialog and more, radio-group, collapsible). `components.json` is set up, so `npx shadcn@latest add <component>` drops new ones in alongside them.
- **Theme** is CSS variables in `frontend/src/index.css` (`:root` / `.dark`), with teal as `--primary`. Change the brand colour in one place.
- **Dark mode**: light / dark / system from the account menu, saved per browser and applied before first paint.
- **Charts** use shadcn's `ChartContainer` over Recharts, with `--chart-1..5` colours checked for colour-blind separation and contrast in both themes. Every chart has a Chart/Table toggle.
- **App-level pieces** built from the primitives are in `frontend/src/components/common.tsx`: date picker, empty/error states, a `confirmAction()` AlertDialog (replaces `window.confirm`) and type-to-confirm for destructive deletes.
- **Layout**: top navigation with a Sheet menu on mobile; job filters move into a Sheet below `lg`. Applicant review opens in a Sheet; the admin approval queue uses Collapsible cards.


## How the AI scoring works

1. An application is created with `score_status = pending`. **Postgres is the queue**: workers claim rows with
   `FOR UPDATE SKIP LOCKED` and a 2-minute lease, so any number of API instances can score safely, and a crashed
   worker's rows get picked up again.
2. The worker sends the extracted resume text and the job (title, description, requirements, skills, seniority) to the
   **OpenAI Chat Completions API** with a **strict JSON schema** (`score`, `summary`, `strengths[]`, `gaps[]`).
3. The output is validated and clamped (0–100, at most 5 items each). Failures retry with backoff up to `SCORING_MAX_ATTEMPTS`,
   then show as "Score failed" with a re-score button.
4. The employer's screen updates over SSE as soon as the score lands.

The system prompt has an explicit rubric, ignores protected characteristics, and treats the resume and the job description as
untrusted data (to blunt prompt injection such as "rate this resume 100"). **Candidates never see scores.**
Without `OPENAI_API_KEY`, a keyword-overlap scorer runs instead, and it's labelled as such everywhere.
`POST /scoring/match` scores ad-hoc text synchronously.

## Real-time and notifications

- **SSE.** `EventSource` can't send auth headers, so the client swaps its JWT for a **single-use, 60-second ticket**
  (`POST /events/ticket`), then connects with `GET /events?ticket=…`. Events go through **Redis pub/sub**, so
  multiple API instances work. The client reconnects with backoff and a fresh ticket.
- **Email** (Nodemailer/SMTP): application received (to the candidate and the employer), every status change (to the candidate,
  including the employer's note), and job approved/rejected (to the employer). Users can opt out. Every attempt goes to
  `email_log` (`sent`, `logged` when there's no SMTP, `skipped`, or `failed`).

## Redis

Refresh-token **sessions** (opaque tokens, hashed, rotated on every use, revoked on suspension); a 60-second **user cache**
so role and suspension changes apply without waiting for JWT expiry; **response caching** of job search (60 s) and admin
analytics, using version counters for instant invalidation; SSE tickets; and pub/sub.

## Roles & access

| | Candidate | Employer | Admin |
|---|:-:|:-:|:-:|
| Browse/search jobs | ✓ | ✓ | ✓ |
| Upload resumes, apply, withdraw | ✓ | | |
| Post/edit/close own jobs | | ✓ | |
| View applicants + AI scores for own jobs, move status | | ✓ | ✓ (all) |
| Approve/reject jobs, manage users, analytics | | | ✓ |

Admins are provisioned (`ADMIN_EMAIL`/`ADMIN_PASSWORD` on startup, or promoted by another admin); signup only offers
candidate or employer. Other users' resources return 404, not 403.

## Tests

```bash
createdb hireflow_test && npm test     # 25 integration tests
```
These cover the signup and role rules, token rotation, RBAC, moderation (reject → resubmit → approve), every search filter,
pagination, cache invalidation, re-review on edits, PDF/DOCX extraction and content sniffing, the size limit,
signed downloads, duplicate and closed-job applications, the **real OpenAI SDK path** against a mock server (request shape, strict
schema, prompt guardrails, clamping, retry → failed, refusals), score privacy, status transitions, emails and opt-out,
SSE delivery and isolation, ticket reuse, suspension taking effect immediately, analytics, and a check that every route
appears in the OpenAPI spec.
