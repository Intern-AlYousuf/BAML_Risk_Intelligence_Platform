# Deployment Guide — BAML Risk Intelligence Platform

## Architecture Overview

| Layer    | Technology          | Platform |
|----------|---------------------|----------|
| Frontend | Next.js 14 (App Router, TypeScript) | Vercel |
| Backend  | FastAPI (Python 3.12), Uvicorn      | Render  |
| Database | PostgreSQL (optional, for future use) | Render Managed DB / Railway |

---

## Frontend — Vercel Deployment

### Prerequisites
- Vercel account (free tier is sufficient)
- Git repository connected to Vercel

### Steps

1. **Import the repository** in the Vercel dashboard.  
   Set the **Root Directory** to `frontend`.

2. **Framework preset**: Next.js (auto-detected).

3. **Build & Output Settings** (auto-detected from `package.json`):
   - Build Command: `next build`
   - Output Directory: `.next`
   - Install Command: `npm install`

4. **Environment Variables** — add in the Vercel dashboard under *Settings → Environment Variables*:

   | Variable                  | Value                                      | Notes                          |
   |---------------------------|--------------------------------------------|--------------------------------|
   | `NEXT_PUBLIC_API_URL`     | `https://your-backend.onrender.com`        | Backend URL from Render        |
   | `NEXT_PUBLIC_API_TIMEOUT_MS` | `30000`                                 | Optional, defaults to 30s      |
   | `NEXT_PUBLIC_APP_ENV`     | `production`                               |                                |
   | `NEXT_PUBLIC_APP_VERSION` | `1.0.0`                                    |                                |
   | `BACKEND_URL`             | `https://your-backend.onrender.com`        | Used by Next.js rewrites proxy |

5. **Deploy** — push to your main branch or click *Deploy* in the Vercel dashboard.

6. **Custom Domain** (optional) — add under *Settings → Domains*.

### Vercel Rewrite Proxy Note

`frontend/next.config.ts` is configured with a `rewrites()` rule that proxies `/api/*` to the backend.
In production on Vercel, set `BACKEND_URL` to your Render backend URL so server-side rewrites work correctly.
Client-side hooks (`useFxForecast`, `useSofrForecast`) use `NEXT_PUBLIC_API_URL` directly for browser fetches.

---

## Backend — Render Deployment

### Prerequisites
- Render account
- Git repository connected to Render

### Steps

1. **Create a new Web Service** in the Render dashboard.  
   Connect your repository and set the **Root Directory** to `backend`.

2. **Runtime**: Python 3.12

3. **Build Command**:
   ```
   pip install -r requirements.txt
   ```

4. **Start Command**:
   ```
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
   Render injects `$PORT` automatically — do not hardcode it.

5. **Environment Variables** — add in the Render dashboard under *Environment*:

   | Variable                  | Value                                              | Required |
   |---------------------------|----------------------------------------------------|----------|
   | `APP_ENV`                 | `production`                                       | Yes      |
   | `DEBUG`                   | `false`                                            | Yes      |
   | `SECRET_KEY`              | `<random 64-char hex string>`                      | Yes      |
   | `FRED_API_KEY`            | `<your FRED API key>`                              | Yes (SOFR forecasting) |
   | `ALLOWED_ORIGINS`         | `https://your-frontend.vercel.app`                 | Yes      |
   | `ALLOWED_HOSTS`           | `your-backend.onrender.com`                        | Yes (production) |
   | `LOG_JSON`                | `true`                                             | Recommended |
   | `LOG_LEVEL`               | `INFO`                                             |          |
   | `DATABASE_URL`            | `postgresql://...` (if using a DB)                | Optional |
   | `ENABLE_MONTE_CARLO`      | `true`                                             | For MC simulation |
   | `ENABLE_ML_FORECASTING`   | `false`                                            |          |
   | `BCRYPT_ROUNDS`           | `13`                                               | Production minimum |

   **Generate SECRET_KEY**:
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

6. **Health Check** — configure Render's health check to:
   - Path: `/health`
   - Expected status: `200`

7. **Deploy** — push to main branch or click *Deploy* in the Render dashboard.

---

## Required Environment Variables Summary

### Frontend (`frontend/.env.example` → Vercel)

```
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
NEXT_PUBLIC_API_TIMEOUT_MS=30000
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_APP_VERSION=1.0.0
BACKEND_URL=https://your-backend.onrender.com
```

### Backend (`backend/.env.example` → Render)

```
APP_ENV=production
DEBUG=false
HOST=0.0.0.0
PORT=8000                        # Render injects this automatically
SECRET_KEY=<generated>
FRED_API_KEY=<your key>
ALLOWED_ORIGINS=https://your-frontend.vercel.app
ALLOWED_HOSTS=your-backend.onrender.com
LOG_JSON=true
LOG_LEVEL=INFO
BCRYPT_ROUNDS=13
```

---

## Build & Start Commands Reference

| Layer    | Command                                                                    |
|----------|----------------------------------------------------------------------------|
| Frontend build  | `npm run build` (runs `next build`)                               |
| Frontend start  | `npm start` (runs `next start`)                                   |
| Backend install | `pip install -r requirements.txt`                                 |
| Backend start   | `uvicorn app.main:app --host 0.0.0.0 --port $PORT`               |

---

## CORS Configuration

The backend reads `ALLOWED_ORIGINS` as a comma-separated list. In production, set it to **exactly** your Vercel frontend URL (no trailing slash, no wildcard):

```
ALLOWED_ORIGINS=https://baml-risk.vercel.app
```

To allow multiple origins (e.g. preview deployments):
```
ALLOWED_ORIGINS=https://baml-risk.vercel.app,https://baml-risk-git-main-yourteam.vercel.app
```

---

## Health Check Endpoints

| Endpoint                  | Description                                        |
|---------------------------|----------------------------------------------------|
| `GET /health`             | Root liveness check — returns `{"status":"ok","timestamp":"..."}` |
| `GET /api/v1/health/live` | Liveness probe (process alive)                     |
| `GET /api/v1/health/ready`| Readiness probe (all dependencies reachable)       |

---

## Common Troubleshooting

### Frontend shows "Forecast unavailable" on Vercel

- Verify `NEXT_PUBLIC_API_URL` is set in Vercel → Settings → Environment Variables.
- The variable must be set **before** the build — Vercel bakes `NEXT_PUBLIC_*` variables at build time.
- Redeploy after setting the variable.

### Backend CORS errors in browser console

- Ensure `ALLOWED_ORIGINS` on Render includes your exact Vercel frontend URL.
- No trailing slash: `https://your-app.vercel.app` not `https://your-app.vercel.app/`.
- After updating, redeploy the backend service.

### Render backend returns 502 / crashes on startup

- Check Render logs for `SECRET_KEY` or `ALLOWED_HOSTS` validation errors.
- `APP_ENV=production` enforces that `SECRET_KEY` is not the placeholder default.
- Set `ALLOWED_HOSTS` to `your-backend.onrender.com` (not `*`) for production.

### SOFR / FX forecast returns 503

- `FRED_API_KEY` is missing or invalid. Register at https://fred.stlouisfed.org/docs/api/api_key.html.
- Verify the key works: `curl "https://api.stlouisfed.org/fred/series?series_id=SOFR&api_key=YOUR_KEY&file_type=json"`

### Port binding errors on Render

- Do not hardcode `--port 8000` in the Start Command. Use `--port $PORT` — Render assigns the port dynamically.

### Next.js build fails on Vercel

- Ensure `BACKEND_URL` is set as a build-time environment variable on Vercel (not just runtime).
- The `next.config.ts` `rewrites()` function reads `BACKEND_URL` at server startup — it does not need to be `NEXT_PUBLIC_*`.
