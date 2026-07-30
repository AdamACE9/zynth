# Zynth — 2-minute demo video

**Target: 1:55–2:00.** Prometheus scores "The Pitch & Demo" at 25%, equal weight with
Educational Impact, Creative Use of AI, and Technical Execution. This script is built to
hit all four, not just the last one.

---

## 1. What this video has to prove

Four criteria, 25 points each. Every beat below is chosen because it scores on at least
one — if a beat doesn't map to a column here, it doesn't belong in a 2-minute cut.

| Beat | Educational Impact | Creative AI | Technical | Pitch |
|---|---|---|---|---|
| The colour rule (evidence, not progress) | ●●● | | ●● | ●●● |
| Intuition — generated interactive visual | ●● | ●●● | ●● | ●● |
| Explain — teaches the exact quiz scope | ●●● | ●● | ● | |
| Quiz — the only route to green | ●● | ● | ●●● | ● |
| Autopsy — rewires the graph | ●●● | ●●● | ●● | ●● |
| Green decays on a failed retest | ●●● | | ●● | ●●● |

**The single most valuable ten seconds is the retest failure at the end.** Every other
submission shows their product succeeding. Yours shows it withdrawing a claim about the
user. Protect that beat above all others.

## 2. Feature priority

You have twelve modules and 120 seconds. This is the ranking — build the cut top-down and
stop when you run out of time.

**Tier 1 — must be on screen, the product is incoherent without them**
1. **The 3D graph + colour rule.** The thesis. Everything else is evidence for it.
2. **The three-step loop** — Intuition → Explain → Quiz. Show all three or the loop looks
   like a quiz app with a graph bolted on.
3. **Green decays.** The credibility moment.

**Tier 2 — the differentiators, include if the cut allows**
4. **Autopsy Board.** The strongest "nobody else does this": it changes the *topology* of
   your map based on how you personally fail.
5. **Live Co-Pilot.** An unprompted mid-quiz diagnosis. Powerful, but it's deliberately hard
   to trigger, so don't gamble a take on it — capture it separately.

**Tier 3 — name them, don't demo them.** One sentence over a graph shot is enough:
Study Plan + Ghost Path, Exam Simulator, Flashcard Forge, Debate Arena, Office Hours,
Mastery Streak, Curriculum Time-Machine.

**Do not** try to show Tier 3 in the 2-minute cut. Ten screen transitions reads as ten
half-features; one map you keep returning to reads as one product.

## 3. The rule that makes the video work

**The graph never leaves the screen.** Every room opens *over* it and you close back to it.
That single choice is the difference between "a pile of AI demos" and "a system".

## 4. Before you hit record

```bash
npm run dev
```

1. **Warm up Gemini.** Open one Intuition screen and close it. A cold first call mid-take
   will stall you, and the free tier is 15 req/min.
2. **Run the backend locally.** Never depend on venue wifi or a Render cold start.
3. `localStorage.clear()` in the console so you land on the marketing site fresh.
4. Browser at **1920×1080**, zoom 100%, bookmarks bar hidden, other tabs closed.
5. **Do 2–3 takes of the Intuition beat.** The visual is generated fresh each run — you want
   a take where the slider's effect on the curve is unmistakable at a glance.
6. Have the **Autopsy sample mistakes** ready to load so you're not typing on camera.

---

## 5. The script

> **Bold** = on-screen action. Plain = voiceover. Times are cumulative.

### 0:00–0:10 · The hook

**Open on the 3D graph, slowly rotating. Don't touch anything for two seconds.**

> Most study apps show you content. Zynth shows you the truth about what you actually know.

**Slow drag to rotate. Red, amber and green nodes are the shot.**

> Every node is a concept in my syllabus. The colour isn't progress — it's evidence.

### 0:10–0:24 · The one rule

**Click a red node. The panel slides in.**

> Red means untouched. I could read that chapter nine times and it stays red, because
> reading isn't proof.

> Amber means I've engaged with it. Green means one thing only — I passed a quiz.

**Beat. Don't rush this line.**

> There is no way to skip from red to green. That rule isn't in the interface, it's enforced
> in the database.

*This is the idea the whole product rests on. If a judge remembers one sentence, make it
this one.*

### 0:24–0:46 · Step 1, Intuition

**Click Intuition on the red node.**

> When I'm stuck I don't get an essay. First I get a feel for the shape of the thing.

**Let the explanation and labelled axes land for a beat, then drag the slider end to end.
Say nothing for two seconds — let them watch it move.**

> Gemini designed this visual for this specific concept — one thing to drag, and the
> relationship reshapes in front of me.

**Click "test me". Pick the WRONG answer deliberately.**

> Then it makes me commit before it tells me anything.

**Your dashed prediction draws against the real curve.**

> That's my guess against reality. I can see exactly where my thinking diverged — not just
> that it was wrong.

### 0:46–1:02 · Step 2, Explain

**Explain opens. It's already written a full lesson — don't type anything yet.**

> Intuition is a feel, and a feel isn't knowledge. So the tutor teaches it properly —
> what it is, the mechanism, a worked example, and the mistake people actually make here.

**Scroll once. Point at the context chip quoting the user's own recorded mistake.**

> It already has my file — this concept, my mistakes on it, my trend. I never have to
> explain my situation to it.

> And it's scoped by the same objective the quiz is built from. Everything the quiz can ask
> was taught right here.

**The node goes red → amber.**

> So the node moves to amber. Engaged — but nothing proven yet.

### 1:02–1:20 · Step 3, Quiz — earning green

**Click Quiz. Cut the generation wait in the edit.**

> The only way to earn green is a quiz, generated for this exact concept.

**Answer. Submit. Score lands.**

> Seventy to pass —

**Cut to the graph so the node turns green inside the constellation.**

> — and the node turns green on the map. Nothing else in the product can do that.

### 1:20–1:40 · Autopsy — the differentiator

**Top bar → Autopsy → Load sample mistakes → Analyze.**

> Here's the part I'm proudest of. I paste in everything I got wrong.

**Let the diagnosis card land.**

> It reads across all of them at once. It doesn't say "you're bad at related rates". It says
> I drop the negative when the inner function is decreasing.

> One misconception, behind seven mistakes, across three different topics.

**Close to the graph — the new edges are drawn between those nodes.**

> Then it rewires the map — connecting the concepts that keep failing together. My graph
> changes shape because of how *I* fail.

### 1:40–1:52 · Green decays — the closer

**Click the green node → Quiz → answer wrong deliberately → submit.**

> One last thing. I'm going to retest that green concept, and get it wrong.

**The node drops green → amber on the graph.**

> It drops straight back to amber. Zynth just withdrew a claim it made about me.

> Mastery isn't a badge you keep. It's a claim the graph keeps checking.

### 1:52–2:00 · Close

**Pull back to the whole graph, slowly rotating.**

> Twelve modules, one map. Every one of them reads from it and writes back to it.

> Built solo in four days. I'm thirteen.

**End card: `Zynth` · `zynth-delta.vercel.app` · `github.com/AdamACE9/zynth`**

---

## 6. If you're over time

Cut in this order. **Never cut the closer.**

1. Trim the Quiz beat to ~12s — the pass moment alone carries it.
2. Trim Explain to the lesson landing + the "same objective as the quiz" line. Drop the scroll.
3. Trim the Intuition slider to one clean end-to-end pass.
4. Drop the Autopsy edge-rewiring shot (keep the diagnosis).

If you have to lose a whole beat, lose **Autopsy** before **Explain** — Autopsy is the more
impressive feature, but without Explain the loop looks like a quiz app and the "we actually
teach" claim goes unproven.

## 7. Capture separately for the DDS live demo

Not in the 2-minute cut — too slow or too unreliable to gamble a take on:

- **Live Co-Pilot** interrupting mid-quiz with an unprompted diagnosis
- **Study Plan** rerouting itself the instant a node's status changes
- **Exam Simulator** streaming its own reasoning per question
- **Workspace tabs** — several independent graphs side by side

## 8. Worth a line in the Devpost description

Built on initiative, beyond the original spec:

- The **landing site** renders a real WebGL knowledge graph using the app's own constants —
  a node cycles red→amber→green in the first three seconds.
- **Onboarding** makes you drive a demo node through the whole state machine yourself before
  you ever reach the app.
- **Intuition** aims its prediction at the misconception your own recorded mistakes reveal,
  and renders model output through a **real expression parser rather than `eval`** — the
  visual is generated, but the maths is verified before it draws.
- The graph **connects itself into one traversable map**, then orders subjects by affinity so
  related ones sit together.
- Every model call **degrades to labelled stub text** rather than failing, with a retry in
  front of it. The demo cannot hard-crash on a bad network.
