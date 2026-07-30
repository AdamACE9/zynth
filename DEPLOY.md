# Deploying Zynth

Zynth is two pieces with very different hosting needs:

| Piece | What it needs | Where it goes |
|---|---|---|
| **Frontend** (`client/`) | static file hosting | **Vercel** — perfect fit |
| **Backend** (`server/`) | long-lived WebSockets + a SQLite file on disk | **Render / Railway / Fly** — *not* Vercel |

> **Why not Vercel for the backend?** Vercel runs serverless functions: they are torn
> down between requests and the filesystem is read-only and ephemeral. Zynth's backend
> holds open Socket.io connections (the live graph, the Live
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

## 2. Backend → Render (free tier, ~5 min)

**These exact settings are verified — Render's auto-detection gets several of them
wrong, so set each one deliberately.**

1. **render.com → New → Web Service**.
2. **Source Code → "Public Git Repository"** tab (not "Git Provider") and paste
   `https://github.com/AdamACE9/zynth`. This skips granting Render OAuth access to
   your whole GitHub account. Click **Connect**.
3. Settings — the four Render gets wrong are marked ⚠:

   | Field | Value | Note |
   |---|---|---|
   | Name | `zynth-api` | |
   | Language | **Node** | ⚠ Render defaults to **Docker** |
   | Branch | `main` | |
   | **Root Directory** | **leave BLANK** | ⚠ Must build from the repo root, or npm can't resolve the `@zynth/shared` workspace |
   | Build Command | `npm install --include=dev` | ⚠ `--include=dev` is required: Render sets `NODE_ENV=production`, which would skip `tsx` (a devDependency the server starts with) |
   | Start Command | `npm run start --workspace @zynth/server` | ⚠ Run from root so workspaces resolve |
   | Instance Type | **Free** | ⚠ Render pre-selects **Starter ($7/mo)** |

4. Environment variables (see the table below), then **Deploy Web Service**.
3. Environment variables (paste these in Render's dashboard — never commit them):

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | your Google AI Studio key |
   | `GEMINI_MODEL` | `gemini-2.5-flash` |
   | `GROQ_API_KEY` | your Groq key (free-response grading) |
   | `GROQ_MODEL` | `llama-3.3-70b-versatile` |
   | `CLIENT_ORIGIN` | your Vercel URL, e.g. `https://zynth.vercel.app` — **required, or CORS blocks the frontend** |
   | `NODE_VERSION` | `22` — better-sqlite3 needs a matching prebuilt binary |
   | `DATABASE_PATH` | `/var/data/zynth.sqlite` if you attach a disk, else leave default |

   Without the two API keys the server still boots and serves the graph — it just runs
   in `STUB_MODE` with canned AI output, which is a safe fallback for a public URL.

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
