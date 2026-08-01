# Zynth — live demo run sheet (DDS, AstroLabs)

**Not the video script.** A live demo is different: you are talking to people who can
interrupt, the network can die, and nothing is edited. This is built to survive that.

---

## 1. Pre-flight — do this 5 minutes before you present

```bash
npm run dev
```

Then, in the browser console on `localhost:5173`:

```js
localStorage.clear()
```

Check, in order:

- [ ] `localhost:5173` loads the **marketing site** (not the app)
- [ ] Top-right badge says **Live** in cyan, and does *not* say "Stub data"
- [ ] Workspace tab reads **"Physics, Computer Science +2"**
- [ ] **Classical Mechanics** is RED · **Boolean Logic** is GREEN
- [ ] Browser at 100% zoom, bookmarks bar hidden, notifications off
- [ ] Laptop on **mains power**, sleep disabled

**Open one Intuition screen and close it before you start.** The first model call of a
session is the slowest one; do not let the audience watch it.

---

## 2. The run — 4 to 5 minutes

Prepared state: **Classical Mechanics is red** (your live run) and **Boolean Logic is
green** (your closer). Don't improvise onto a different node — these two are warmed and
verified.

### Beat 1 — the map (~30s)

Open the app. Let the graph rotate once before you say anything.

> "This is my syllabus. Every node is a concept. The colour isn't progress — it's
> evidence."

Rotate slowly. Point at red, amber, green.

### Beat 2 — the rule (~30s) ← **the most important thing you say all demo**

> "Red means untouched. I could read that chapter nine times and it stays red, because
> reading isn't proof.
>
> Amber means I've engaged with it. Green means one thing only: I passed a quiz.
>
> There is no way to skip from red to green. That rule isn't in the interface — it's
> enforced in the database."

Pause after that last line. It is the single sentence that separates you from every
other submission.

### Beat 3 — Intuition (~60s)

Click **Classical Mechanics** → **Intuition**.

It builds Newton's Second Law: a **Mass** slider, force on one axis, acceleration on the
other.

> "First I get a feel for it. One thing to drag."

Drag the slider end to end. **Say nothing for two seconds** — let them watch it move.

> "Then it makes me commit before it tells me anything."

Click *test me*. The question is **"If we double the mass, how does the acceleration
change for a given force?"**

**Pick the wrong answer on purpose.** Your prediction draws against reality.

> "That's my guess against what actually happens. I can see exactly where my thinking
> was wrong — not just that it was."

Node goes **red → amber**.

### Beat 4 — Explain (~40s)

> "Intuition is a feel, and a feel isn't knowledge. So the tutor teaches it properly."

Let the lesson land. Don't type anything.

> "And it's scoped by the same objective the quiz is built from. Everything the quiz can
> ask was taught right here."

### Beat 5 — Quiz, earning green (~60s)

> "The only way to earn green is a quiz, generated for this exact concept."

Answer them (they're on force, mass and acceleration — the thing you just learned).
Submit. Cut back to the graph so they watch it **turn green on the map**.

### Beat 6 — the closer (~40s) ← **never cut this**

Click **Boolean Logic** (green) → **Quiz** → answer wrong deliberately → submit.

> "Last thing. I'm going to retest a concept it says I've proven — and get it wrong."

It drops **green → amber**.

> "It just withdrew a claim it made about me. Mastery isn't a badge you keep. It's a
> claim the graph keeps re-checking."

Stop there. Don't add anything after it.

---

## 3. If something breaks

| What happens | What you do |
|---|---|
| Questions say **`[stub]`** | Gemini is unreachable. Say: *"That's the offline fallback — it degrades instead of crashing."* Then carry on; the state machine still works. |
| A screen hangs | Esc back to the graph. The graph is always safe. |
| Graph goes black | Reload the tab. State is in SQLite, nothing is lost. |
| Venue wifi dies | Everything runs locally **except the model calls**. The graph, the rule, and every transition still work. Demo those. |
| Node won't turn green | Check the score hit 70. If it says amber, that's the rule working — say so. |

**Never apologise for the fallback.** A product that degrades visibly instead of
crashing is an engineering answer, and saying so out loud turns a stumble into a point.

---

## 4. Questions you will get, and the honest answer

**"How is this different from Khan Academy / Quizlet / ChatGPT?"**
> Those teach or test. Neither tracks whether it landed. Zynth's colour is evidence, and
> the graph re-plans itself when the evidence changes.

**"Couldn't a student just cheat the quiz?"**
> They could pass one quiz. But green decays — a failed retest drops it back to amber. It
> isn't a trophy, it's a claim that keeps getting re-checked.

**"Did AI write this?"**
> I built it with AI assistance in four days, and I made every architectural decision. Ask
> me about the state machine — it's enforced in a SQLite trigger *and* a single service,
> deliberately redundant, so even a raw SQL UPDATE can't skip red to green.

**"Is it deployed?"**
> Yes — zynth-delta.vercel.app. I'm demoing locally because the free hosting tier has an
> ephemeral filesystem, so real workspaces don't survive a restart. That's a hosting
> limitation, not a product one.

**"What's next?"**
> Handwritten notes: photograph your own notes, the tutor reads and annotates them next to
> yours. The graph already has the structure to hang them on.

**If you don't know something: say so.** "I don't know, but here's how I'd find out" reads
as competence at any age. Bluffing is the only wrong answer.

---

## 5. What you have, if anyone asks to see more

- **Deployed:** zynth-delta.vercel.app · **Code:** github.com/AdamACE9/zynth
- **Deck:** `deck/zynth-deck.pdf` (10 slides)
- **Intro / outro cards:** `video-endcard/renders/`
- **Full write-up:** `OVERVIEW.md` — every feature, what it does, why

---

## 6. The one thing to remember

You are thirteen and you built a working multi-agent product in four days. The demo does
not need to be flawless — it needs to be **honest and clear**. The rule is the idea. Lead
with it, close on green decaying, and let the graph do the rest.
