# ONEKEY

A simple, cross-platform object identity and digital memory layer that lets anyone
scan, claim, record, and know the story of a physical thing.

MVP loop: **SCAN → CREATE → KNOW**

## Fraud-resistance model (the actual point of this MVP)

The identity of a `Thing` is anchored to one of:

1. **An existing serial / barcode / IMEI** (preferred, default path) — bound with a
   hard database-level `UNIQUE` constraint. Once a serial is claimed, it can never
   be claimed again, by anyone, ever. This is enforced at the Postgres level, not
   just in application code.
2. **A generated QR tag** (fallback, only offered when the object has no existing
   identifier) — combined with a required reference photo, perceptual-hashed
   (`imagehash`/pHash) at claim time. New claims are checked against all existing
   reference photo hashes; a high-similarity hit doesn't block the claim, it
   surfaces a soft warning to the claimant ("this looks like an item that's
   already registered — are you sure this is different?").

Nothing here claims to make fraud impossible. It makes the cheap, common attack
(peel a sticker, reprogram, silently re-claim) leave evidence and produce
detectable inconsistencies instead of a clean, silent swap.

## Structure

```
backend/    FastAPI + Postgres (Supabase-compatible). The API and the DB constraint
            that does the actual fraud-prevention work.
frontend/   Next.js app (PWA-ready). Scan/claim/view UI.
```

## Quickstart

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL (Supabase connection string works)
# apply supabase_schema.sql to your Postgres instance (Supabase SQL editor, or psql)
uvicorn app.main:app --reload
```

API docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

App at `http://localhost:3000`.

## Pushing this to your existing repo

This was scaffolded outside your GitHub repo (no push credentials available here).
To get it into `PrinceKeldon/onekey`:

```bash
cd onekey
git init
git remote add origin https://github.com/PrinceKeldon/onekey.git
git add .
git commit -m "Scaffold ONEKEY MVP: backend + frontend"
git branch -M main
git push -u origin main
```
