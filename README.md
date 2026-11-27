# RavPaper Tutor

AI-powered academic dissertation intelligence platform: upload dissertations and other submissions, run multi-agent AI analysis, and rehearse your defense.

## Features

- Document upload with server-side text extraction (PDF, DOCX, TXT, Markdown; 20 MB max)
- Six analysis engines: source similarity (compares against documents in your organization only), rubric alignment, statistics, literature review, anthropomorphism, formatting
- Durable background analysis jobs with retries, crash recovery and cancellation
- Defense simulation with AI-generated questions
- Session-based authentication: 15-minute in-memory access tokens, rotating httpOnly refresh cookies, revocable sessions, rate-limited auth endpoints
- Fixed-catalog review credits via Stripe with signed, idempotent webhook fulfillment
- Audit logging, dark/light theme

## Tech stack

| Layer    | Technology                                   |
|----------|----------------------------------------------|
| Frontend | React, TypeScript, Vite, Tailwind, shadcn/ui |
| Backend  | Express.js, TypeScript                       |
| Database | PostgreSQL + Drizzle ORM                     |
| AI       | OpenAI-compatible API (`gpt-5-mini`)                         |
| Billing  | Stripe                                       |

## Getting started

Prerequisites: Node.js 20+, PostgreSQL 14+, an OpenAI-compatible API key.

```bash
git clone https://github.com/RavDev-Technologies-LLC/RavPaper-Tutor.git
cd RavPaper-Tutor
npm install
cp .env.example .env      # then fill in the values
npm run db:migrate        # apply versioned migrations
npm run dev               # http://localhost:5000 (API, client and analysis worker)
```

`npm run dev` does not load `.env` automatically. Export the variables in your shell (e.g. `set -a; source .env; set +a`) or use your platform's secrets manager. On Replit, set them in the Secrets panel; the AI integration variables are provided automatically.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SESSION_SECRET` | yes | Access-token signing secret, at least 32 characters |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | yes | OpenAI (or compatible) API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | yes | OpenAI API base URL |
| `PORT` | no | Server port (default `5000`) |
| `APP_BASE_URL` | for billing | Public origin used for Checkout redirects (HTTPS, or localhost in development) |
| `STRIPE_ACCOUNT_ID` | for billing | Pinned Stripe account (`acct_...`); requests from any other account are refused |
| `STRIPE_MODE` | for billing | `test` or `live`; must match the secret key prefix |
| `STRIPE_CREDIT_PRICES` | for billing | Allowlist `price_id:prod_id:credits,...` printed by `npx tsx server/seedProducts.ts` |
| `STRIPE_WEBHOOK_SECRET` | outside Replit | Webhook signing secret (`whsec_...`); on Replit the managed webhook secret is used |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | outside Replit | Stripe keys when the Replit connector is not available |
| `STRIPE_LIVE_CHARGING_ENABLED` | no | Must be `true` for `STRIPE_MODE=live` |
| `STRIPE_DEV_PROVISION` | no | `true` to create Stripe sync schema and webhook in development |
| `TRUST_PROXY` | no | Proxy hops for client IPs (default `1` in production, `loopback` otherwise) |
| `COOKIE_SECURE` | no | Force `Secure` refresh cookies outside production |
| `ANALYSIS_WORKER` | no | `off` to disable the in-process worker (then run `npm run worker`) |
| `ANALYSIS_CONCURRENCY` | no | Jobs per worker process (default `2`) |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the dev server (API + Vite client) on port 5000 |
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the production build |
| `npm run check` | TypeScript type check |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests against PostgreSQL (`TEST_DATABASE_URL`, wiped) |
| `npm run test:e2e` | Playwright smoke test (`E2E_DATABASE_URL`; run `npm run build` first) |
| `npm run db:migrate` | Apply migrations (`-- --status` to inspect, `-- --baseline` once for databases created with `db:push`) |
| `npm run worker` | Standalone analysis worker |
| `npm run check:hygiene` | Repository hygiene checks |

## Upgrading an existing database

Databases created before versioned migrations were introduced (with `npm run db:push`) need a
one-time baseline. Take a backup first, then:

```bash
npm run db:migrate -- --status
npm run db:migrate -- --baseline
npm run db:migrate
```

The integrity migration backfills derivable tenant ids and stops, rolling back completely, if it
finds rows it cannot fix (for example users without a tenant). It prints the counts; fix those
rows and run it again. Production refuses to start while migrations are pending.

After deploying this release every user signs in once more: earlier refresh tokens stored in the
browser are discarded.

## Project structure

```
client/   React frontend (Vite)
server/   Express API, auth, AI analysis engines
shared/   Shared types and Drizzle schema
docs/     Governance, data lifecycle and audit register
migrations/  Versioned SQL migrations
e2e/      Playwright browser tests
tests/    Automated tests
script/   Build and maintenance scripts
```

## Roles

`student`, `doctoral_candidate`, `chair`, `committee_member`, `program_admin`, `security_admin`, `super_admin`

## API overview

- **Auth**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me`. Refresh and logout use the `rp_rt` cookie and require the header `x-ravpaper-client: web`.
- **Documents**: `GET /api/documents`, `POST /api/documents/upload` (multipart: `file`, `title`, `submissionType`), `GET/DELETE /api/documents/:id`
- **Analysis**: `POST /api/analysis/run/:documentId` (returns `202` with `jobId`), `GET /api/analysis/jobs/:id`, `POST /api/analysis/jobs/:id/cancel`, `GET /api/analysis/results/:documentId`
- **Billing**: `GET /api/stripe/products`, `POST /api/stripe/checkout`, `POST /api/stripe/verify-session`, `POST /api/stripe/webhook`
- **Defense**: `POST /api/analysis/defense/:documentId`, `POST /api/analysis/defense/:sessionId/answer`
- **Admin**: `GET /api/admin/users`, `PATCH /api/admin/users/:id/role`, `GET /api/admin/audit-logs`, `GET /api/admin/stats`

## License

MIT
