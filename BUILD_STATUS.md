# ONEKEY Build Status

**Status date:** 2026-09-18

## Summary

The ONEKEY MVP scaffold is present in the local repository and published on
`main`. The Next.js frontend runs successfully at `http://localhost:3000`.

## Completed

- Repository initialized and synchronized with `origin/main`.
- Frontend dependencies installed.
- TypeScript tooling pinned to versions compatible with Next.js 14.
- Next.js development server started successfully.
- Local frontend endpoint returned HTTP 200.
- Next.js production build completed successfully, including type checking and
  static page generation.
- Supabase/Postgres connection configuration is present in the local backend
  environment file.
- Supabase schema is available at `backend/supabase_schema.sql`.

## In Progress / Not Verified

- The Supabase schema has not been verified as applied to the remote database.
- The FastAPI backend has not yet been started or health-checked against
  Supabase.
- Authentication, media storage, and production CORS restrictions remain MVP
  follow-up work.
- The frontend currently has generated and local dependency changes that are
  not yet committed: `frontend/package.json`, `frontend/package-lock.json`,
  `frontend/tsconfig.json`, and `frontend/next-env.d.ts`.

## Run Locally

Frontend:

```bash
npm --prefix frontend run dev
```

Backend:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The backend health endpoint is `http://localhost:8000/health`.

## Next Recommended Step

Apply `backend/supabase_schema.sql` in the Supabase SQL Editor, then start the
FastAPI backend and verify `/health` plus one database-backed API request.