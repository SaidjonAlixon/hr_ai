# Vercel deployment — HR PROFI / VAKSINA HR

## 1. Database
Use hosted Postgres (Neon, Supabase, or Vercel Postgres).

```bash
# Locally / in CI after setting DATABASE_URL
pnpm run db:push
# Then seed if needed: node scripts/src/seed.mjs
```

## 2. Vercel project
1. Import this Git repo in [Vercel](https://vercel.com/new).
2. Framework Preset: **Other** (vercel.json sets it).
3. Root Directory: leave empty (monorepo root).
4. Env vars (Production + Preview):

| Name | Required | Notes |
|------|----------|--------|
| `DATABASE_URL` | yes | `?sslmode=require` for Neon/Supabase |
| `SESSION_SECRET` | recommended | random string |
| `CRON_SECRET` | recommended | Vercel Cron Bearer token |

5. Deploy.

## 3. Local check of Vercel build
```bash
pnpm install
pnpm run build:vercel
```

Frontend output: `public` (repo root)
  
API bundle: `artifacts/api-server/dist/vercel.mjs` (served via `api/index.mjs`)

## 4. How it works
- Static SPA from Vite
- `/api/*` → Express on a Vercel Function (`api/index.mjs`)
- Cron every 10 minutes → `/api/jobs/vacancy-reminders`  
  (Vercel Hobby: max 1 cron/day — change `crons.schedule` in `vercel.json` if needed)
