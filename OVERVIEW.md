# Zynth — Full Product Overview

> Most study apps show you content.
> Zynth shows you **the truth about what you actually know** — and rebuilds your plan around it, live.

A **Student Learning OS** built around one living 3D knowledge graph of your mastery.
Built solo, in four days, by [Adam Ahmed](https://github.com/AdamACE9) — 13.

**Live:** https://zynth-delta.vercel.app · **Repo:** https://github.com/AdamACE9/zynth

---

## Table of contents

1. [The one-paragraph version](#1-the-one-paragraph-version)
2. [The problem](#2-the-problem)
3. [The insight: colour is evidence](#3-the-insight-colour-is-evidence)
4. [The core mechanic](#4-the-core-mechanic)
5. [What using Zynth actually feels like](#5-what-using-zynth-actually-feels-like)
6. [The modules](#6-the-modules)
7. [How AI is used — and where it deliberately isn't](#7-how-ai-is-used--and-where-it-deliberately-isnt)
8. [Architecture](#8-architecture)
9. [Design principles](#9-design-principles)
10. [Honest status](#10-honest-status)
11. [Running it](#11-running-it)

---

## 1. The one-paragraph version

Zynth turns your syllabus into a single 3D knowledge graph where every concept is a
node, and the node's colour reflects **evidence** of mastery rather than exposure to
material. Red means untouched. Amber means you engaged with it and the system *believes*
you understand it — but has no proof. Green means you **passed a quiz**, and that is the
only route there. Every other module in the product — the interactive visuals, mistake
autopsies, exam simulation, autonomous planning — reads from and writes to that same
graph. The graph is not a visualisation bolted onto a study app; it is the app's state.

---

## 2. The problem

Students study constantly. Almost nothing closes the loop between three very different
claims:

| Claim | What it actually proves |
|---|---|
| *"I studied X"* | You were exposed to X. Nothing more. |
| *"I understand X"* | You feel fluent. Feelings are famously unreliable here. |
| *"Here is proof I understand X"* | Something external tested you and you passed. |

The gap between the first two is where students lose entire terms. You re-read a chapter
nine times, each pass feels smoother than the last, and the smoothness gets mistaken for
understanding. This is a well-documented failure mode — fluency of processing feels
identical to knowledge from the inside, and it is why highlighting and re-reading are
among the least effective study strategies ever measured.

**EdTech mostly doesn't help, because it splits down the middle:**

- **Content-first tools** (video platforms, note apps, AI tutors) *teach*. They will
  happily explain a concept for the tenth time. They have no idea whether it landed, and
  they have no memory of your last nine attempts.
- **Quiz-first tools** (flashcards, test banks, spaced repetition) *test*. They tell you
  a score. They don't diagnose *why* you got it wrong, and they don't restructure what
  you do tomorrow.

Very little **diagnoses continuously and re-plans continuously.** That gap is Zynth's
entire reason for existing.

### The three failures Zynth attacks directly

1. **Exposure masquerading as mastery.** The dominant failure. Solved by making colour
   mean evidence, and by making the rule un-cheatable at the database level.
2. **Mistakes treated as isolated events.** You get a question wrong, see a red cross,
   move on. The *pattern* across forty mistakes — the single misconception generating all
   of them — is invisible. The Autopsy Board exists for exactly this.
3. **Plans that go stale the day they're written.** A revision timetable written on Monday
   assumes Monday's mastery. By Thursday it's fiction. Zynth's Study Plan re-plans itself
   whenever the graph changes, without being asked.

---

## 3. The insight: colour is evidence

Every concept is a node. Its colour is a **claim about proof**, not about effort.

| | State | Meaning |
|---|---|---|
| 🔴 | **Red** | Untouched, or just failed a retest. Re-reading the chapter nine times does not move it. |
| 🟠 | **Amber** | You *engaged* — Intuition or the tutor. Zynth believes you understand it, but has **no evidence**. |
| 🟢 | **Green** | You **passed a quiz**. The only route to green. |

Amber is the important one, and it's the state most products don't have. It's the honest
name for *"you've done the work but nobody has checked."* Most apps would call that done
and give you a tick. Zynth calls it unproven and leaves it amber, which is uncomfortable
on purpose — an amber graph is a truthful graph.

**Green is not permanent.** A proven node that fails a retest drops straight back to
amber. Mastery isn't a badge you collect; it's a claim the graph keeps re-checking.

---

## 4. The core mechanic

```
red   --[engaged_at set via Intuition or Explain]-->  amber
amber --[quiz passed, score >= 70]-------------->    green
green --[failed retest]-------------------------->   amber
```

Three legal transitions. Everything else is illegal — most importantly **there is no
red → green edge.** You cannot skip the engagement step, and you cannot reach green
without being tested.

### Why this is enforced twice

The rule is the product. If it can be bypassed, the colours are decoration and the whole
thesis collapses. So it's enforced at two independent layers:

**1. A single write path.** [`statusService.ts`](server/src/services/statusService.ts) is
the only code in the entire codebase permitted to change `Node.status`. It exposes exactly
two intent-shaped functions — `engageNode()` and `applyQuizResult()` — rather than a
general-purpose setter. There is deliberately no `setStatus()` to misuse.

**2. A database trigger.** A SQLite `BEFORE UPDATE` trigger (`nodes_status_guard` in
[`schema.sql`](server/src/db/schema.sql)) `RAISE(ABORT)`s any illegal transition. Even a
raw `UPDATE nodes SET status='green'` against a red node — issued from a SQL console,
bypassing the entire application — is rejected by the storage engine.

This was verified adversarially: **8 illegal transitions plus a timestamp-replay attack
were all rejected; every legal transition passed.** Re-verified end-to-end against the
live API after the most recent UI overhaul — including the specific case of a red node
answering 100% correctly, which correctly leaves it red.

> The distinction that matters: this isn't validation, it's an **invariant**. Validation
> is something the UI does and a determined user routes around. An invariant is a property
> the data cannot violate regardless of what code runs.

---

## 5. What using Zynth actually feels like

A short narrative, because the module list below doesn't convey the loop.

**You open it.** No login, no account, nothing to install. You pick your subjects — up to
13 — and Zynth generates a graph of the actual concepts in them, with real prerequisite
chains. Everything is red. That is the honest starting position, and it looks confronting,
which is the point.

**You click a red node** — say, *Related Rates*. You get a real screen, not a bubble
floating over the graph, and a three-step loop:

**Step 1 — Intuition.** You get one thing to drag and one question to answer. Move the
slider and the relationship reshapes in front of you. Then it asks you to predict what
happens next — and you have to commit before anything is revealed. Get it wrong and your
predicted curve is drawn against reality, so you see exactly where your model of the
concept diverged from how it actually behaves.

**Step 2 — Explain.** Intuition is deliberately tiny, and intuition is not knowledge. So
the tutor teaches properly before you're tested: what the concept is, the mechanism with a
worked example in real numbers, the specific mistake people make here, and how to check
yourself. It already holds your file — this node, your mistake history, your trend — so you
never brief it first. Crucially it is scoped by the *same objective the quiz is generated
from*, which is what makes "everything the quiz can ask was taught here" true by
construction rather than by luck. Then you can ask it anything.

Committing to that prediction is what moves the node **red → amber**. Zynth now believes
you understand it. It does not yet believe you can prove it, and it says so.

**Step 3 — Quiz.** The only route to green, and it can only ask about the objective you
were just taught. MCQs graded exactly; free-response graded by a *different* model from the
one that wrote the question, so the grader isn't marking its own homework. Score ≥ 70 and
the node settles into green — one glow, no confetti.

That ordering is the whole design. Intuition gives you a feel for the shape of the thing,
Explain gives you the content, and the Quiz is the only step allowed to change what the
graph claims about you.

**Mid-quiz, something interrupts you.** Not a red cross — a card that says the equivalent
of *"this isn't an arithmetic slip. You don't understand why the inequality sign flips."*
That's the Live Co-Pilot, and it stays silent far more often than it speaks (see below).

**Later, you paste in a term's worth of wrong answers.** The Autopsy Board finds the single
misconception underneath all of them and then does something no other study tool does: it
**draws new edges on your graph** between concepts that keep failing together. Your map
changes shape because of how you specifically fail.

**Your study plan quietly rewrites itself.** You never asked it to. Mastery changed, so
the route changed.

---

## 6. The modules

### Tier 1 — the core loop

#### Knowledge Graph
Your syllabus as one living 3D map, rendered with react-three-fiber. Concepts cluster into
constellations by subject via a d3-force-3d layout. Emissive materials with
`toneMapped={false}` plus a bloom pass give nodes real glow rather than a flat coloured
circle. State arrives over WebSockets, so a status change anywhere in the product
propagates to the graph without a refresh. The camera derives its resting distance from
the actual laid-out node positions — so a 2-subject graph and a 13-subject graph are both
framed correctly.

Two things make it hold up at 13 subjects rather than 2. **It is one connected map, not a
field of islands** — subject generation only wires prerequisites *within* a subject, which
left a real 13-subject graph as 11 disconnected components. A pass now proposes genuinely
meaningful cross-subject links (Calculus/Limits → Newton's Laws, Trigonometry →
Geometry/Angles) and draws them as `related_topic`, never `prerequisite` — inventing a
prerequisite would silently reorder your study plan on a guess. And **the ring is ordered by
affinity**, so subjects that share edges sit next to each other; alphabetical ordering put
Calculus and Physics on opposite sides and every link between them cut straight across the
middle of the map.

The graph is the **navigation spine**, not a container for every UI. You click a node and
go to a proper full-screen experience.

#### Intuition
The understanding step, and the demo centrepiece. Gemini designs a visual per concept —
either a set of plotted curves or an ordered process — with exactly **one** parameter the
student can drag. Then it asks for a prediction, and the student must commit before
anything is revealed. A wrong guess is drawn against reality so the divergence is visible
rather than described.

Deliberately a **constrained grammar** rather than generated markup: two visual kinds and
one slider. A model asked for arbitrary SVG eventually emits something unrenderable, and a
blank panel mid-demo is worse than a plainer visual. Every field is validated and clamped
on arrival, and generation failure falls back to a deterministic spec — the screen cannot
fail to render.

Expressions are evaluated by a real parser, never `eval()`: these strings arrive from a
model at runtime, so `constructor(2)` has to be a parse error rather than a function call.
The parser lives in `shared/`, which lets the server validate a spec by compiling every
expression in it using the exact code the client renders with.

The screen opens with two or three sentences saying what the concept *is* and what the
graph is showing, then the axes and each line are labelled in plain language. That teaching
block exists because the first version didn't have it, and it was a genuine failure: a
student meeting "overfitting" for the first time got two anonymous lines and a slider, and
learned nothing. Manipulation teaches, but only once you know what you're manipulating. It
is capped by *sentence count* so it can't grow back into the wall of prose it replaced.
Moves the node **red → amber**.

*This replaced a five-persona AI debate. That module produced 600–1200 words of streamed
prose to reach the same amber state as one click of Explain — a student could read the
textbook faster, and it was the only part of the product that lectured instead of
diagnosing.*

#### Quiz
Full-screen, questions generated for the exact node(s) you're on. MCQ graded
deterministically; free-response graded by Groq (Llama 3.3 70B) as an independent second
model. **The only path to green.** Pass threshold: 70.

#### Autopsy Board
Paste in wrong answers from homework or past papers. An agent extracts and clusters
recurring mistake patterns across time — the output is a *misconception*, not a tally.
Something like *"you consistently fail related-rates problems specifically when the rate
is decreasing."*

Then the differentiating move: it **writes `correlated_error` edges back onto the graph**
between the concepts that keep failing together. The graph's topology changes based on
your personal failure modes. No other study tool restructures its own map this way.

#### Explain
**Step 2 of the loop, and where the actual teaching happens.** It opens with a full lesson
rather than waiting to be asked — what the concept is, the mechanism with a worked example,
the misconception people hit, and a self-check — then takes questions. Already knows the
node, your mistakes on it and your trend, so you never restate your situation.

It is scoped by the same objective the Quiz is generated from. That shared objective is the
contract that stops the loop being unfair: Intuition builds the intuition, Explain teaches
the content, and only then does the Quiz examine it.

#### Live Co-Pilot
Watches a quiz in progress. Maintains a live mastery heatmap and injects an **unprompted**
insight card the moment a concept genuinely collapses — with a diagnosis of *why*.

**Its restraint is the feature.** An insight card that fires on every wrong answer is
noise, and noise is worse than silence. The detection logic was designed and stress-tested
against **17 adversarial scenarios before being wired in**.

It stays **silent** on:
- a single wrong answer
- the first 3 questions (no baseline yet)
- red / unengaged nodes — failing a concept you were never taught is expected, not a collapse
- alternating right/wrong (that's guessing, not a misconception)
- a harshly-graded free-response near-miss
- rapid-fire clicking (disengagement isn't a misconception)
- anything beyond 2 cards per session

It **fires** on:
- two wrongs on one *engaged* node sharing a misconception
- a *proven* green node collapsing
- wrongs spanning nodes joined by an Autopsy-discovered `correlated_error` edge

And then Gemini gets a second, independent vote: if it answers "careless slip" or scores
its own confidence under 0.6, **the card is dropped.**

#### Study Plan + Ghost Path
Reads the whole graph and builds a prerequisite-respecting route toward a stated goal
("ace the Physics mock in 3 weeks") using a Kahn's-algorithm topological sort — so it can
never tell you to study a concept before its prerequisites.

It **silently re-plans itself** whenever mastery changes, subscribing to status changes
directly rather than polling. You don't re-prompt it.

The **Ghost Path** renders planned-versus-actual progress across the graph, GPS-style —
where you should be by now, and where you actually are.

#### Exam Simulator
A timed past-paper attempt where the agent streams **its own reasoning live** per
question, self-grades, and maps every lost mark back to specific graph nodes.

### Tier 2 — real logic, shared UI

#### Flashcard Forge
Point it at a chapter. It extracts the concepts, **creates graph nodes for any you've
never seen** — so the graph grows as your syllabus does — and mints SM-2 spaced-repetition
cards.

#### Debate Arena
Argue a motion against an AI opponent. A real argument *tree* shows what counters what,
scored against a rubric. Tests whether you can defend a position, not recall it.

#### Office Hours Queue
A triaged question queue **batched by shared misconception** — thirty students asking the
same thing underneath different wording get one answer with a visual worked solution.

#### Mastery Streak
A flame on nodes that have stayed green *through retests*. Not a login counter — a measure
of durable understanding. It can only be earned by re-proving something.

#### Curriculum Time-Machine
Your schedule against the syllabus — where you are versus where the term expects you to be.

---

## 7. How AI is used — and where it deliberately isn't

**Google Gemini** (2.5 Flash) runs every agent: designing the Intuition visuals, quiz
generation, Autopsy clustering, the tutor, exam grading, planning. **Groq (Llama 3.3 70B)**
grades free-response answers — deliberately a *different* model from the one that wrote the
question, so the grader isn't marking its own homework.

Note what Gemini produces for Intuition: not an explanation, but a **specification** — a
parameterised visual plus a prediction designed to catch a specific misconception. The
rendering is entirely deterministic code.

### Where AI is deliberately kept out

This matters as much as where it's used:

- **Status transitions are not AI-decided.** No model can promote a node to green. That's
  a deterministic function of a quiz score and the state machine. If an LLM could move
  nodes, the colours would be vibes.
- **MCQ grading is exact string comparison,** not model judgement. There is no reason to
  ask a model something a `===` can answer, and every reason not to.
- **Prerequisite ordering is a topological sort,** not a prompt. Kahn's algorithm cannot
  hallucinate a dependency.
- **The Co-Pilot's trigger conditions are hand-written rules.** The model only gets a veto
  — it can suppress a card, never summon one.

The pattern throughout: **AI generates and diagnoses; deterministic code decides.**

### Graceful degradation

Without a `GEMINI_API_KEY`, everything still runs — agent output falls back to clearly
labelled stub text, and the UI shows a "Stub data" badge rather than pretending. The app
never hard-fails during a demo, and never silently fakes intelligence.

---

## 8. Architecture

A TypeScript monorepo, three npm workspaces:

```
zynth/
├─ shared/   @zynth/shared — the data model + status state machine (single source of truth)
├─ server/   Express + SQLite + Socket.io + the agent orchestrator
└─ client/   the 3D graph, the rooms, and the marketing site
```

**`shared/`** holds the types, `LEGAL_TRANSITIONS`, `isLegalStatusTransition()`,
`QUIZ_PASS_THRESHOLD`, the mastery-score computation, and the socket event contracts. Both
other workspaces import from it, so the client and server cannot drift on what a legal
transition is — the rule is defined once.

**`server/`** — Node + Express, **SQLite in WAL mode** via better-sqlite3 (synchronous,
which removes a whole category of race conditions around status writes), **Socket.io** for
realtime. Every table carries a `student_id` foreign key.

**`client/`** — React 18 · Vite · TypeScript · Tailwind v4 · `motion` · **Three.js** via
react-three-fiber + drei + postprocessing · d3-force-3d.

### Realtime

Socket.io events include `node:updated`, `node:status_changed`, `node:created`,
`edge:created`, `graph:snapshot`, `autopsy:progress`,
`copilot:heatmap`, `copilot:insight`, `plan:updated`, `exam:reasoning`.

Status changes are broadcast through an explicit listener registry on `statusService` —
subscribers register via `onStatusChanged()`. That's how the Study Plan re-plans itself
without polling. Listener callbacks are wrapped so a throwing subscriber can never corrupt
a status write.

### Workspaces (multiple graphs)

Multiple graphs are exposed as tabs, scoped by reusing the existing `student_id` column
rather than adding a schema layer. Each workspace is an independent graph with its own
nodes, edges, and history; switching tabs re-keys the graph stage.

---

## 9. Design principles

A few decisions worth stating, because they were deliberate rather than accidental:

- **Colour means one thing.** Red / amber / green are used for mastery and *nothing else*,
  anywhere in the product — including the marketing site, where they're the only colours
  on the page. Connection status, for example, reads cyan, never green, because a live
  socket is not a proven concept.
- **No confetti.** When a node is proven, the beat is a single glow settling. This is a
  diagnostic instrument; it shouldn't behave like a slot machine. Nothing bounces,
  overshoots, or celebrates.
- **Green decays.** Covered above, but it's a design position as much as a mechanic:
  the product is willing to take something away from you.
- **Gamification is diegetic.** The streak, constellation completion, and Ghost Path all
  fall out of data the graph already has. No XP, no levels, no leaderboards, no currency.
- **The site and the app are one object.** The marketing page renders the graph using the
  app's own constants — same emissive intensity, same halo geometry, `STATUS_COLORS`
  imported from `@zynth/shared` rather than re-typed. Clicking through has no seam.
- **Motion is one language.** A single set of easing curves and durations, defined once as
  CSS tokens and mirrored for the animation library. Entrances travel 24px and unblur 6px.
  Nothing travels further.

---

## 10. Honest status

Built for two hackathons: the **DDS Agentic AI Demo Challenge** (physical demo day,
AstroLabs Dubai) and the **Prometheus July AI Challenge** (Devpost).

| Tier | Modules | State |
|---|---|---|
| **Tier 1** | Graph, Intuition, Quiz, Autopsy, Explain, Co-Pilot, Study Plan, Exam Sim | Complete, verified end-to-end |
| **Tier 2** | Flashcard Forge, Debate Arena, Office Hours | Functional |
| — | Curriculum Time-Machine | In progress |

**What's genuinely verified**, not just believed:

- The status state machine, re-tested against the live API after every major change — all
  three legal transitions pass, illegal ones are rejected at the DB layer, and a red node
  scoring 100% correctly stays red.
- Intuition → Quiz coherence, on a fully generated (not fallback) pair: the objective
  *"predict how changes in the constant of integration affect the graph of an
  antiderivative"* produced four questions all on that objective, one of which tested
  transfer rather than restating it.
- The expression evaluator that renders Intuition's visuals, against 66 cases including
  operator precedence, right-associative `^`, and injection attempts. Model-authored maths
  strings are untrusted input, so this is a security boundary, not a maths utility.
- Workspace creation from selected subjects generates a real graph with all nodes red.
- Graph connectivity: a real 13-subject graph went from 11 disconnected islands to one
  traversable map.
- Typecheck clean across all three workspaces; client builds clean.
- No secrets in git history (full-history sweep).

**Known sharp edges**, stated plainly:

- `POST /api/workspaces` doesn't auto-activate the workspace it creates. Onboarding calls
  `activateWorkspace` explicitly, so it isn't user-facing — but it's a trap for future code.
- Every model call degrades to clearly-labelled stub content rather than failing. One retry
  sits in front of that fallback, but a long enough network outage will still surface
  placeholder text rather than an error — deliberate, since a demo that degrades beats a
  demo that crashes.
- The Intuition expression grammar has no randomness, so genuinely noisy data is
  approximated with a sum of sines. Honest, but not the same thing.
- Cold `vite dev` start takes ~2 minutes when `node_modules` sits inside a cloud-synced
  folder. Not a code issue; worth knowing before a live demo so a slow boot isn't mistaken
  for a crash.

---

## 11. Running it

```bash
npm install
cp server/.env.example server/.env    # add GEMINI_API_KEY (and GROQ_API_KEY)
npm run dev
```

Open **http://localhost:5173**. Backend on `:3001`.

The graph auto-seeds on first boot — 18 Calculus + Physics concepts with real prerequisite
chains, a cross-subject link, sample mistakes for the Autopsy Board, and all three colours
present. **No login, no account, nothing to install.**

| Command | |
|---|---|
| `npm run dev` | backend + frontend together |
| `npm run seed` | reset the sample graph to a clean state |
| `npm run typecheck` | typecheck all three workspaces |

Deploying? See **[DEPLOY.md](DEPLOY.md)** — and note the backend needs a host with
persistent WebSockets and a real filesystem (Render), *not* Vercel serverless.

---

<div align="center">

**Zynth** · built by Adam Ahmed · [github.com/AdamACE9/zynth](https://github.com/AdamACE9/zynth)

</div>
