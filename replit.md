# RavPaper Tutor - AI-Powered Academic Dissertation Intelligence Platform

## Overview
RavPaper Tutor is a full-stack enterprise SaaS application for AI-powered academic document review and analysis. It features multi-agent AI analysis, JWT authentication with RBAC, and a comprehensive analysis engine suite.

## Tech Stack
- Frontend: React + TypeScript + Tailwind CSS + shadcn/ui
- Backend: Express.js + TypeScript
- Database: PostgreSQL with Drizzle ORM
- AI: OpenAI via Replit AI Integrations (gpt-4o-mini)
- Auth: JWT with bcryptjs password hashing

## Architecture
- `client/` - React frontend (Vite)
- `server/` - Express backend
- `shared/` - Shared types and schema
- JWT auth with 15-minute access tokens and 7-day refresh tokens
- 7 user roles: student, doctoral_candidate, chair, committee_member, program_admin, security_admin, super_admin

## Key Features
- Document upload and management (10 submission types)
- 6 AI analysis engines: plagiarism, rubric alignment, statistics, literature review, anthropomorphism, formatting
- Defense simulation with AI-generated questions
- Role-based access control
- Audit logging
- Dark/light theme

## API Endpoints
- Auth: POST /api/auth/register, POST /api/auth/login, POST /api/auth/refresh, GET /api/auth/me
- Documents: GET/POST /api/documents, GET/DELETE /api/documents/:id
- Analysis: POST /api/analysis/run/:documentId, GET /api/analysis/results/:documentId
- Defense: POST /api/analysis/defense/:documentId, POST /api/analysis/defense/:sessionId/answer
- Admin: GET /api/admin/users, PATCH /api/admin/users/:id/role, GET /api/admin/audit-logs, GET /api/admin/stats

## Running
npm run dev - starts the application on port 5000
