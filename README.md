# RavPaper Tutor

AI-powered academic dissertation intelligence platform: upload dissertations and other submissions, run multi-agent AI analysis, and rehearse your defense.

## Features

- Document upload and management (10 submission types)
- Six AI analysis engines: plagiarism, rubric alignment, statistics, literature review, anthropomorphism, formatting
- Defense simulation with AI-generated questions
- JWT authentication (15-minute access / 7-day refresh tokens) with role-based access control
- Audit logging, dark/light theme

## Tech stack

| Layer    | Technology                                   |
|----------|----------------------------------------------|
| Frontend | React, TypeScript, Vite, Tailwind, shadcn/ui |
| Backend  | Express.js, TypeScript                       |
| Database | PostgreSQL + Drizzle ORM                     |
| AI       | OpenAI `gpt-4o-mini`                         |
| Billing  | Stripe                                       |

## Getting started

Prerequisites: Node.js 20+, PostgreSQL 14+, an OpenAI-compatible API key.

```bash
git clone https://github.com/RavDev-Technologies-LLC/RavPaper-Tutor.git
cd RavPaper-Tutor
npm install
cp .env.example .env      # then fill in the values
npm run db:push           # create the database schema
npm run dev               # http://localhost:5000
```

`npm run dev` does not load `.env` automatically. Export the variables in your shell (e.g. `set -a; source .env; set +a`) or use your platform's secrets manager. On Replit, set them in the Secrets panel; the AI integration variables are provided automatically.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SESSION_SECRET` | yes | Secret used to sign JWTs/sessions |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | yes | OpenAI (or compatible) API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | yes | OpenAI API base URL |
| `PORT` | no | Server port (default `5000`) |
| `APP_BASE_URL` | no | Public URL of the app |
| `STRIPE_DEV_PROVISION`, `STRIPE_LIVE_CHARGING_ENABLED` | no | Stripe billing toggles |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the dev server (API + Vite client) on port 5000 |
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the production build |
| `npm run check` | TypeScript type check |
| `npm test` | Run tests in `tests/` |
| `npm run db:push` | Push the Drizzle schema to the database |
| `npm run check:hygiene` | Repository hygiene checks |

## Project structure

```
client/   React frontend (Vite)
server/   Express API, auth, AI analysis engines
shared/   Shared types and Drizzle schema
docs/     Documentation
tests/    Automated tests
script/   Build and maintenance scripts
```

## Roles

`student`, `doctoral_candidate`, `chair`, `committee_member`, `program_admin`, `security_admin`, `super_admin`

## API overview

- **Auth**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me`
- **Documents**: `GET/POST /api/documents`, `GET/DELETE /api/documents/:id`
- **Analysis**: `POST /api/analysis/run/:documentId`, `GET /api/analysis/results/:documentId`
- **Defense**: `POST /api/analysis/defense/:documentId`, `POST /api/analysis/defense/:sessionId/answer`
- **Admin**: `GET /api/admin/users`, `PATCH /api/admin/users/:id/role`, `GET /api/admin/audit-logs`, `GET /api/admin/stats`

## License

MIT
