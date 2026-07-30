# Zynth — 2-minute demo video

**Target: 1:55–2:00.** Prometheus judges "The Pitch & Demo" as 25% of the score.

## The rule that makes this video work

**The graph never leaves the screen.** Every room opens *over* it, and you close back
to it. Ten separate screen transitions reads as ten features; one map you keep returning
to reads as one system. That's the whole difference between "a pile of AI demos" and
"a product."

## Before you hit record

```bash
npm run seed          # clean 6 red / 6 amber / 6 green graph
npm run dev           # backend :3001 + frontend :5173
```

1. **Warm up Gemini** — open one Intuition screen and close it. Free tier is 15 req/min and
   a cold first call mid-take will stall you. (Intuition is a single call, not five.)
2. Browser at **1920×1080**, zoom 100%, **hide bookmarks bar**, close other tabs.
3. `localStorage.clear()` in the console so you get the landing page fresh.
4. Record **backend running locally** — never depend on venue wifi or a Render cold start.
5. Do 2–3 takes of the Intuition beat specifically; the generated visual varies each run and
   you want one where the slider's effect on the curve is unmistakable at a glance.

---

## The script

> **Bold** = on-screen action. Plain = voiceover. Times are cumulative.

---

### 0:00–0:12 · The hook

**Open on the 3D graph, slowly rotating. Don't click anything. Let it breathe for 2 seconds.**

> Most study apps show you content.
>
> Zynth shows you the truth about what you actually know.

**Slow drag to rotate the graph. The red, amber and green nodes are the shot.**

> This is my Calculus and Physics syllabus. Every node is a concept — and the colour
> isn't progress. It's evidence.

---

### 0:12–0:28 · The one rule

**Click a red node. The panel slides in.**

> Red means untouched. I could have read this chapter nine times — it stays red, because
> reading isn't proof.

**Hover the amber legend, then the green.**

> Amber means I've engaged with it, but nothing's been proven yet.
>
> Green means one thing only: I passed a quiz. And it's the only way to get there.

*(Do not rush this. It's the idea the entire product is built on.)*

---

### 0:28–0:52 · Intuition — the AI beat

**With the red node still selected, click Intuition.**

> When I'm stuck, I don't get an essay. I get one thing to move.

**Drag the slider slowly, end to end. Say nothing for two seconds — let them watch the
curve reshape.**

> Gemini designed this visual for this specific concept. One parameter, and the
> relationship moves in front of me.

**Click "test me". The visual freezes and the question appears.**

> Then it makes me commit. Before it tells me anything.

**Pick the WRONG answer deliberately.**

**Your violet dashed curve draws in against the cyan one.**

> That's my prediction against what actually happens. I can see exactly where I was
> wrong — not just that I was.

**The node goes red → amber. Close back to the graph.**

> So the node moves to amber. I've engaged with it. But Zynth still has no evidence —
> so it won't give me green.

---

### 0:52–1:12 · Quiz — earning green

**Click the same node → Quiz. Cut the generation wait in the edit.**

> The only way to earn that is a quiz — generated for this exact concept.

**Answer. Submit. Score lands, node turns green.**

> Seventy percent to pass. And the moment it passes —

**Cut back to the graph so the green node is visible in the constellation.**

> — the node turns green on the map. That's the only path there. Nothing else in the
> product can do it.

---

### 1:12–1:34 · Autopsy — the differentiator

**Top bar → Autopsy. Click "Load sample mistakes". Hit Analyze.**

> Then there's the part I'm proudest of. I paste in the questions I got wrong.

**Let the diagnosis card land.**

> Zynth reads across all of them at once — and it doesn't say "you're bad at related
> rates". It says: you drop the negative when the inner function is decreasing.
>
> One misconception, behind seven mistakes, across three different topics.

**Close to the graph — the new edges are now drawn between those nodes.**

> And then it rewires the map, connecting the concepts that keep failing together.

---

### 1:34–1:50 · Green decays — the closer

**Click the green node → Quiz → deliberately answer wrong → submit.**

> One last thing. I'm going to retest that green concept — and get it wrong.

**The node drops green → amber on the graph.**

> It drops straight back to amber. Zynth just withdrew a claim it made about me.
>
> Mastery isn't a badge you keep. It's a claim the graph keeps checking.

---

### 1:50–2:00 · Close

**Pull back to the whole graph, slowly rotating.**

> Every part of Zynth writes to this one map. Diagnose, then re-plan — continuously.
>
> Built solo, in four days. I'm thirteen.

**End card: `Zynth` · `github.com/AdamACE9/zynth`**

---

## If you're over time

Cut in this order — **never** cut the closer:
1. Trim the Quiz beat (0:52–1:12) to ~12s; the pass moment is enough.
2. Drop the legend hover at 0:12–0:28.
3. Trim the slider drag to one clean pass end-to-end.

The retest-failure ending (1:34) is the single most convincing thing in the video —
every other submission shows their product succeeding. Yours shows it telling the
truth. Protect it.

## Also worth capturing (for the DDS demo, not the 2-min cut)

- **Live Co-Pilot** interrupting mid-quiz with an unprompted diagnosis
- **Study Plan** rerouting itself the instant a node's status changes
- **Exam Simulator** streaming its own reasoning per question

## Surprise features to call out

Not in the original spec — added on initiative. Worth a line in the Devpost description:
- The **landing site**'s hero is a real WebGL knowledge graph rendered as a technical
  drawing, with a node cycling red→amber→green live — the product's core rule playing
  in the first three seconds.
- **Onboarding** has an interactive demo node you drive through the whole state machine
  yourself before you ever reach the app.
- **Live/Demo connection badge** in the top bar — shows judges the socket is genuinely live.
- **Quiz score ring** and the **Explain context chip** that quotes your actual recorded
  mistake back to you before you type anything.
- **Intuition** aims its prediction at the misconception your *own* recorded mistakes reveal,
  and renders the model's output through a real expression parser rather than `eval` — the
  visual is generated, but the maths is verified before it ever draws.
