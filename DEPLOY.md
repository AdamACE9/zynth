# Deploying Zynth

Zynth is two pieces with very different hosting needs:

| Piece | What it needs | Where it goes |
|---|---|---|
| **Frontend** (`client/`) | static file hosting | **Vercel** — perfect fit |
| **Backend** (`server/`) | long-lived WebSockets + a SQLite file on disk | **Render / Railway / Fly** — *not* Vercel |

> **Why not Vercel for the backend?** Vercel runs serverless functions: they are torn
> down between requests and the filesystem is read-only and ephemeral. Zynth's backend
> holds open Socket.io connections (the live graph, War Room token streaming, the Live
> Co-Pilot heatmap) and writes to a SQLite file. Neither survives on Vercel. This is
> called out in TASKBRIEFING §4 as well.

---

## 1. Frontend → Vercel (~4 clicks)

The repo already contains `vercel.json` with the correct monorepo build settings, so
this needs no CLI and no local build.

1. Go to **vercel.com → Add New → Project**.
2. **Import** `AdamACE9/zynth` from GitHub.
3. Leave the **Root Directory** as the repo root (`./`) — `vercel.json` already points the
   build at the `client` workspace and outputs to `client/dist`.
4. Add one Environment Variable, then **Deploy**:

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | your deployed backend URL, e.g. `https://zynth-api.onrender.com` |

   Leave it unset to ship a frontend-only demo: the app still renders the full site,
   onboarding and 3D graph using its built-in fallback data, it just won't have live AI.

Every push to `main` redeploys automatically after this.

## 2. Backend → Render (free tier, ~10 min)

1. **render.com → New → Web Service**, connect the same GitHub repo.
2. Settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free is fine for judging (it sleeps after ~15 min idle and takes
     ~50 s to wake — **wake it before a live demo**).
3. Environment variables (paste these in Render's dashboard — never commit them):

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | your Google AI Studio key |
   | `GEMINI_MODEL` | `gemini-2.5-flash` |
   | `GROQ_API_KEY` | your Groq key (free-response grading) |
   | `GROQ_MODEL` | `llama-3.3-70b-versatile` |
   | `CLIENT_ORIGIN` | your Vercel URL, e.g. `https://zynth.vercel.app` |
   | `DATABASE_PATH` | `/var/data/zynth.sqlite` if you attach a disk, else leave default |

4. **Persistent data (optional).** Render's free tier has an ephemeral filesystem, so the
   SQLite DB resets on each restart — which is arguably *good* for judging, since every
   restart gives a clean, known-good demo graph. For durable data, attach a **Disk**
   mounted at `/var/data` and set `DATABASE_PATH` as above.

5. Copy the Render URL back into Vercel as `VITE_API_BASE` and redeploy the frontend.

## 3. Local (what the physical demo runs on)

```bash
npm install
cp server/.env.example server/.env   # add GEMINI_API_KEY (+ GROQ_API_KEY)
npm run dev
```

Backend on `:3001`, frontend on `:5173`. This is the most reliable setup for the
AstroLabs demo — no cold starts, no network dependency beyond the AI APIs.
