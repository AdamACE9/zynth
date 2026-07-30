<div align="center">

# Zynth

### Most study apps show you content. Zynth shows you the truth about what you actually know — and rebuilds your plan around it, live.

A **Student Learning OS** built around one living 3D knowledge graph of your mastery.

*Built solo, in four days, by [Adam Ahmed](https://github.com/AdamACE9) — 13.*

</div>

---

## The problem

Students study constantly, but almost nothing closes the loop between
*"I studied X"* → *"I actually understand X now"* → *"here's proof, and here's what's still broken."*

EdTech either **teaches** (content-first) or **tests** (quiz-first). Very little **diagnoses
continuously and re-plans continuously.** That gap is Zynth's entire reason for existing.

## The core idea: colour is evidence

Every concept in your syllabus is a node in one 3D graph. Its colour reflects
**evidence-based mastery, not exposure**:

| | State | Meaning |
|---|---|---|
| 🔴 | **Red** | Untouched, or just failed a retest. Re-reading the chapter nine times does not move it. |
| 🟠 | **Amber** | You *engaged* with it — Intuition or the tutor. Zynth believes you understand it, but has **no evidence**. |
| 🟢 | **Green** | You **passed a quiz**. The only route to green. |

```
red   --[engaged_at set via Intuition or Explain]-->  amber   (then Explain teaches)
amber --[quiz passed, score >= 70]-->                green
green --[failed retest]-->                           amber
```

**This rule is enforced in the database, not the interface.** A single service
([`statusService.ts`](server/src/services/statusService.ts)) is the only code path allowed
to change `Node.status`, and a SQLite `BEFORE UPDATE` trigger
([`schema.sql`](server/src/db/schema.sql)) `RAISE(ABORT)`s any illegal transition — so even a
raw `UPDATE nodes SET status='green'` on a red node is rejected at the data layer.

Verified adversarially: 8 illegal transitions plus a timestamp-replay attack were all
rejected; every legal one passed.

## What's inside

| Module | What it does |
|---|---|
| **Knowledge Graph** | Your syllabus as one living 3D map (react-three-fiber), clustered into constellations by subject, updating live over WebSockets. |
| **Intuition** | One slider, one visual, one prediction you have to commit to before the answer is shown. Gemini designs the visual per concept; a real expression parser renders it. About forty words of reading. Moves the node red→amber. |
| **Quiz** | Questions generated for the exact concept you're on. MCQ graded exactly, free-response graded by Groq. **The only path to green.** |
| **Autopsy Board** | Paste your wrong answers. It finds the single misconception underneath *all* of them and **draws new edges on your graph** between the concepts that keep failing together. |
| **Explain** | **Step 2 — where the teaching happens.** Opens with a full lesson (mechanism, worked example, the specific misconception, a self-check) instead of waiting to be asked, then takes questions. Already holds your file. Scoped by the same objective the Quiz is generated from, so nothing on the quiz went untaught. |
| **Live Co-Pilot** | Watches a quiz in progress and interrupts, unprompted, the moment a concept collapses — with a *diagnosis*, not a red cross. Deliberately hard to trigger (see below). |
| **Study Plan + Ghost Path** | A prerequisite-respecting route toward your goal that **re-plans itself** whenever mastery changes. The Ghost Path draws planned-vs-actual progress across the graph, GPS-style. |
| **Exam Simulator** | A timed paper where the agent shows its own reasoning live, then maps every lost mark back to a specific node. |
| **Flashcard Forge** | Point it at a chapter; it extracts concepts, **creates graph nodes for ones you've never seen**, and mints SM-2 spaced-repetition cards. |
| **Debate Arena** | Argue a motion against an AI opponent; a real argument *tree* shows what counters what. Scored on a rubric. |
| **Office Hours Queue** | A triaged question queue **batched by shared misconception**, answered once with a visual worked solution. |
| **Mastery Streak** | A flame on nodes that have stayed green *through retests* — durable understanding, not a login counter. |

### The Live Co-Pilot's restraint is the feature

An insight card that fires on every wrong answer is noise. The detection logic was
designed and stress-tested against 17 adversarial scenarios *before* being wired in, and
it **stays silent** on: a single wrong answer · the first 3 questions (no baseline) ·
red/unengaged nodes (failing an untaught concept is expected, not a collapse) ·
alternating right/wrong (guessing) · a harshly-graded free-response near-miss ·
rapid-fire clicking (disengagement isn't a misconception). Max 2 cards per session.

It **fires** on things that actually mean something: two wrongs on one engaged node sharing
a misconception, a *proven* green node collapsing, or wrongs spanning nodes joined by an
Autopsy-discovered `correlated_error` edge. Gemini then gets a second, independent vote —
if it answers "careless slip" or scores itself under 0.6, the card is dropped.

## Tech stack

**Frontend** — React 18 · Vite · TypeScript · Tailwind v4 · `motion` ·
**Three.js** via react-three-fiber + drei + postprocessing · d3-force-3d (constellation layout)

**Backend** — Node.js · Express · **SQLite (WAL)** via better-sqlite3 · **Socket.io**

**AI** — **Google Gemini** runs every agent (Intuition visual design, quiz generation,
Autopsy clustering, the tutor, exam grading, planning). **Groq (Llama 3.3 70B)** grades
free-response answers — deliberately a different model from the one that wrote the
question, so the grader isn't marking its own homework.

Gemini never decides a node's colour. It designs and diagnoses; the state machine decides.

```
zynth/
├─ shared/   @zynth/shared — the data model + status state machine (single source of truth)
├─ server/   Express + SQLite + Socket.io + the agent orchestrator
└─ client/   the 3D graph, the rooms, and the marketing site
```

## Run it locally

```bash
npm install
cp server/.env.example server/.env    # add GEMINI_API_KEY (and GROQ_API_KEY)
npm run dev
```

Open **http://localhost:5173**. Backend on `:3001`.

The graph auto-seeds on first boot — 18 Calculus + Physics concepts with real prerequisite
chains, a cross-subject link, sample mistakes for the Autopsy Board, and all three colours
present. **No login, no account, nothing to install.**

Without a `GEMINI_API_KEY` everything still runs — agent output falls back to clearly
labelled stub text, so the app never hard-fails during a demo.

| Command | |
|---|---|
| `npm run dev` | backend + frontend together |
| `npm run seed` | reset the demo graph to a clean state |
| `npm run typecheck` | typecheck all three workspaces |

Deploying? See **[DEPLOY.md](DEPLOY.md)** — and note the backend needs a host with
persistent WebSockets and a real filesystem (Render), *not* Vercel serverless.

## Design notes

A few decisions worth calling out, because they were deliberate rather than accidental:

- **Colour means one thing.** Red/amber/green are used for mastery and nothing else,
  anywhere in the product — including the marketing site, where they're the only colours
  on the page.
- **No confetti.** When a node is proven, the beat is a single glow settling. The product
  is a diagnostic instrument; it shouldn't behave like a slot machine.
- **Green decays.** A proven node that fails a retest drops straight back to amber.
  Mastery is a claim the graph keeps re-checking.
- **Gamification is diegetic.** The streak, constellation completion and Ghost Path all
  fall out of data the graph already has. No XP, no levels, no leaderboards.

## Status

Built for two hackathons: the **DDS Agentic AI Demo Challenge** (physical demo day,
AstroLabs Dubai) and the **Prometheus July AI Challenge**.

Tier 1 (graph, Intuition, Quiz, Autopsy, Explain, Co-Pilot, Study Plan, Exam Sim) is
complete and verified end-to-end. Tier 2 (Flashcard Forge, Debate Arena, Office Hours) is
functional. Curriculum Time-Machine is in progress.

---

<div align="center">

**Zynth** · built by Adam Ahmed · [github.com/AdamACE9/zynth](https://github.com/AdamACE9/zynth)

</div>
