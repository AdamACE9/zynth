# TASKBRIEFING.md — Zynth Build

**Read this fully before writing any code.** This is the single source of truth for what we're
building, why every decision was made, and how it should work. If something here conflicts with a
passing chat message, this file wins unless Adam explicitly says otherwise.

---

## 0. The one-paragraph version

Zynth is a Student Learning OS built around one living, 3D knowledge graph of a student's mastery
across their syllabus. Every module — quizzes, multi-persona AI debates, mistake analysis,
autonomous planning — reads from and writes to that same graph. It's being built solo by a
13-year-old founder (Adam), dual-submitted to two hackathons, compressed into a 4-day build.
Nothing here is a toy
exercise: this is a real submission with a real deadline and a real physical demo day. Build
like it.

---

## 1. Context: why this project exists

Adam is dual-submitting this to two hackathons:

1. **DDS Agentic AI Demo Challenge** (Decoding Data Science) — solo build, "build in public,"
   physical demo day **August 6, 2026 at AstroLabs, Dubai**. Judged loosely but rewards a working
   agentic prototype and a strong live demo.
2. **Prometheus July AI Challenge** (Devpost) — deadline **July 31, 2026 @ 7:45am GST**. Must be an
   **educational tool**. Judged on four equal-weighted criteria (25 points each):
   - **Educational Impact** — does it genuinely help people learn, teach, or understand a concept
     better?
   - **Creative Use of AI/ML** — is AI core to the functionality, not an afterthought?
   - **Technical Execution** — is it functional, stable, intuitive, well-built?
   - **The Pitch & Demo** — does a 2-minute video clearly explain the why and how?

Both hackathons reward a **real, working, demoable product** over a large pile of half-finished
features. Keep that tension in mind constantly: ambition is good, but a broken demo scores zero
on half the rubric no matter how clever the architecture was.

**Timeline note:** there are **6 real days** left before both deadlines. The original 8-day plan has
been compressed into **4 merged build days** (each covering roughly two of the original days'
scope), leaving 2 days of genuine buffer — see Section 6 for exactly how that buffer should be
used. This compression happened because the build didn't start on the original Day 0 as planned;
don't let that repeat — every remaining day matters even more now, since the buffer is real but
thin. If a day's scope slips, the very next thing to do is cut Tier 2 polish, never cut Tier 1
correctness.

---

## 2. What Zynth actually is

### The core mechanic

Every student has one **Knowledge Graph**: a 3D map of every concept in their syllabus, rendered
as glowing nodes connected by edges. Node color reflects **evidence-based mastery**, not exposure:

- **Red** — untouched or failed retest. Default state.
- **Amber** — the student has engaged with the concept (via War Room or Explain) and the system
  believes they understand it, but it is **not yet proven**.
- **Green** — the student has **passed a quiz** on this node. This is the only way to reach green.

This two-step rule is load-bearing and must be enforced in the data layer, not just the UI:

```
red   --[engaged_at set via War Room or Explain]-->  amber
amber --[QuizSession.passed === true]-->              green
green --[QuizSession.passed === false, on retest]-->  amber   (can drop back down)
```

A node can always be **redone** — a green node is not "finished forever," it's "currently proven,"
and retesting it is both a legitimate student action and a gamification hook (see Section 4).

### The graph is the nav layer, not the entire app

Important: the graph is **not** a literal single-surface app where quizzes happen inside a
floating node bubble. The graph is the **home screen and navigation spine** — you click a node,
and *from there* you go to a proper full-screen experience (Quiz screen, War Room screen, Explain
chat, Exam Simulator). The graph itself stays visually alive throughout (colors, edges, pulses)
but does not try to cram every UI need into itself. Don't over-engineer graph-embedded UI for
things that need real screen space.

### Two entry points from a weak (red/amber) node

1. **War Room** (the flashy, demo-centerpiece feature) — multiple AI personas debate/explain the
   concept live from different angles (analogy, rigorous/mathematical, real-world example, a
   skeptic poking holes), converge to one clean synthesis, and the node visibly moves red→amber
   with an understated "case closed" resolution beat (not confetti — see Section 4).
2. **Explain** (the fallback, NOT the star) — a plain one-on-one AI tutor chat. Critically, this
   is **context-aware**: it already knows this node, the student's mistake history on it, and their
   mastery trend. The whole point is the student never has to re-explain their situation the way
   they would pasting a question into a generic chatbot. This is the safety net for when the flashy
   feature doesn't land for a given student — it should feel calmer and more utilitarian than War
   Room, by design.

### The ten modules

**Tier 1 — full polish, these are the demo stars. Budget real design time here.**

1. **Knowledge Graph** — the home/nav layer described above. Three.js render, live Socket.io-driven
   state, click-to-expand interactions, constellation clustering.
2. **War Room** — multi-persona live debate on a weak node (described above).
3. **Quiz screen** — full-page, proper UI. Generates questions tied to specific node(s), grades
   pass/fail, is the *only* trigger for amber→green.
4. **Autopsy Board** — upload homework/past tests → an agent extracts and clusters recurring
   mistake patterns across time (e.g. "you consistently fail related-rates problems specifically
   when the rate is decreasing") and **draws new edges on the graph** connecting correlated
   weaknesses. This is one of the strongest, most differentiated features — give it real care.
5. **Live Co-Pilot** — during a quiz, a real-time mastery heatmap updates question-by-question, and
   the system injects an **unprompted** insight card the moment it detects a concept collapsing
   (not just "wrong answer" — a diagnosis of *why*, e.g. "this isn't an arithmetic slip, you don't
   understand why we flip the inequality sign").
6. **Study-Plan Board** — reads the whole graph, builds a visual roadmap toward a stated goal (e.g.
   "ace the Physics mock in 3 weeks"), and **silently re-plans itself** each day as mastery changes,
   without the student re-prompting it. Manifests visually as the "Ghost Path" (Section 4).
7. **Exam Simulator** — a timed, simulated past-paper attempt. Shows the agent's own reasoning live
   per question, self-grades, produces a weak-topic report tied back to specific graph nodes.

**Tier 2 — real logic, minimal/shared UI, brief cameo in the demo video. Reuse Tier 1's component
library and visual language instead of inventing bespoke screens.**

8. **Curriculum Time-Machine** — a GPS-style timeline against the syllabus that reroutes
   automatically if the student falls behind.
9. **Flashcard Forge** — point it at a textbook chapter/PDF/lecture notes; an agent autonomously
   extracts concepts (adding new nodes to the graph if missing) and generates spaced-repetition
   flashcards tagged to each node.
10. **Debate Arena** — for essay-based subjects, the student argues a position against an AI
    opponent; a visual argument-tree shows how points connect/counter, scored at the end.
11. **Office Hours Queue** — a shared, triaged question queue, batched by topic overlap, answered
    with visual worked solutions rather than chat text.

### The pitch thesis (use this framing in all copy, demo scripts, and submission text)

> "Most study apps show you content. Zynth shows you the truth about what you actually know — and
> rebuilds your plan around it, live."

The honest insight behind this: students study constantly, but almost nothing closes the loop
between "I studied X" → "I actually understand X now" → "here's proof, and here's what's still
broken." Most EdTech either teaches (content-first) or tests (quiz-first) but very few *diagnose*
continuously and *replan* continuously. That gap is Zynth's whole reason for existing. Keep this
thesis in mind when making any ambiguous product decision — if a feature doesn't serve "diagnose →
replan, continuously," question whether it belongs.

### Naming note

Product name is **Zynth**. It was chosen specifically because it's an invented word with zero
collisions in EdTech (search-verified) — Cortex, Synapse, Nexus, Aether, Meridian, Waypoint, and
similar real-word names are all heavily saturated by existing competing apps. Don't drift back
toward any of those in copy, code identifiers, or the pitch. Kept fully separate from Adam's other
product, ScoolBot, for now — no cross-references in the pitch.

---

## 3. Gamification (in scope, all four — build them, they're cheap)

All four mechanics are **diegetic** — they grow directly out of data the graph already has, not
generic bolted-on points/levels/currency (which we are deliberately avoiding — see rationale
below). Each one should be derivable from existing schema fields with no new tables:

1. **Mastery Streak** — a small flame icon on any node that has stayed green through repeated
   retests without dropping back to amber. Derived from `retest_count` + a check that `status` has
   stayed `"green"` across those retests. A proxy for *durable* understanding, not login habit.
2. **Constellation completion** — when every node in a related cluster (same subject/tag grouping,
   or connected via `related_topic` edges) reaches green, the whole cluster visually "locks in" —
   a one-time glow-pulse / edge-solidify animation. Purely derived state, checked on any node
   status change within that cluster.
3. **Ghost Path race** — the Study-Plan Board's glowing route across the graph shows the student's
   **actual** progress against their **planned** progress (GPS-ETA style: ahead of / behind
   schedule). Compare `PlanPath.node_sequence[]` position against real `Node.status` progress along
   that same sequence.
4. **War Room resolution beat** — an understated "case closed" visual moment when the debating
   agents converge and the node flips red→amber (agent avatars visibly settle, the debate thread
   resolves) — not confetti, not an XP popup, just a clean sense of closure.

**Explicitly out of scope, don't add these even if it seems like an easy win:** XP points,
levels, leaderboards, avatars/currency, streak-for-streak's-sake login counters. These are generic
mechanics that don't derive from Zynth's specific architecture, and several existing competitor
apps already do exactly this — it doesn't differentiate us and actively risks reading as padding
rather than substance to judges scoring Creative Use of AI/ML.

---

## 4. Tech stack

**Frontend**
- React + Vite
- **Three.js** via `react-three-fiber` — the graph render. This is the single most important
  rendering decision in the whole app; get it looking genuinely high-tech and modern, this is
  what sells the whole concept in the demo video.
- Framer Motion — node color-shift animations, panel transitions, the resolution/completion beats
- Tailwind CSS
- Dedicated full-page screens for Quiz and Exam Simulator (NOT graph-embedded)

**Backend**
- Node.js + Express (or Fastify)
- SQLite (WAL mode) — simplest reliable option for a 4-day solo build
- Socket.io — pushes live graph state changes to the frontend in real time (this is what makes
  Live Co-Pilot and War Room feel alive instead of "click, wait, reload")

**Runtime AI layer — single API key constraint**

Adam has one Gemini API key and limited credits. **Every live, in-app agent call at runtime uses
Gemini 3.5 Flash and nothing else** — Diagnosis, all War Room personas, Autopsy clustering, Exam
grading, Explain chat, Study-Plan replanning, Flashcard extraction. This is a deliberate, locked
decision — do not introduce a second runtime provider without Adam explicitly changing this.

War Room's multiple "agents" are implemented as the same model with different system prompts/
personas — this is a completely legitimate and common multi-agent pattern, not a shortcut to be
embarrassed about.

**Build tool**

This build is being done with **Claude Code (Sonnet 5) as the sole build tool** — no multi-agent
coordination layer, no other build-time model. Sonnet is responsible for both the core logic
*and* the UI/visual design layer. When building UI, be deliberate and specific about visual
direction rather than defaulting to generic component styling — reference the frontend-design
guidance available in this environment, and treat the graph's visual quality as seriously as the
backend logic, since it's the centerpiece of the whole demo.

**Deployment**
- Vercel for frontend
- Railway or Render for backend (Vercel serverless doesn't hold persistent WebSocket connections
  well, and live graph updates depend on those)

---

## 5. Data model

```
Node (Concept)
├─ id
├─ label                    // e.g. "Implicit Differentiation"
├─ subject
├─ status                   // "red" | "amber" | "green"
├─ mastery_score            // 0-100, derived display value
├─ engaged_at               // timestamp of first War Room/Explain interaction (red→amber trigger)
├─ last_quiz_passed_at      // timestamp of the quiz that earned green (amber→green trigger)
├─ last_quiz_result         // pass/fail + score
├─ retest_count             // how many times student has redone this node
├─ history[]                // {timestamp, status} log for trend view / streak calculation

Edge (Relationship between concepts)
├─ id
├─ source_node_id
├─ target_node_id
├─ relationship_type        // "prerequisite" | "correlated_error" | "related_topic"
├─ strength                 // 0-1 confidence
├─ discovered_by            // which agent created it, e.g. "autopsy_agent"

MistakeRecord
├─ id
├─ node_id
├─ source                   // "uploaded_homework" | "quiz" | "exam_sim"
├─ raw_excerpt
├─ error_type               // "concept_gap" | "careless_slip" | "prerequisite_gap"
├─ created_at

QuizSession
├─ id
├─ node_ids[]                // concepts under test
├─ questions[]                // generated questions + answers given
├─ score
├─ passed                     // boolean — the ONLY trigger for amber→green
├─ created_at

WarRoomSession
├─ id
├─ node_id
├─ transcript[]               // {agent_persona, message} — replayable debate log
├─ outcome                    // "understood" | "still_confused"
├─ created_at

ExplainSession                // the fallback 1:1 tutor chat
├─ id
├─ node_id
├─ messages[]                  // {role, content}
├─ created_at

ExamSimSession
├─ id
├─ source_paper
├─ questions[]
├─ live_reasoning_log[]         // agent's shown reasoning per question, for the demo
├─ node_results[]               // per-concept score breakdown
├─ created_at

PlanPath
├─ id
├─ goal
├─ node_sequence[]
├─ current_position
├─ last_replanned_at
├─ replanned_because            // what mastery change triggered a reroute

AgentConfig                     // persona definitions, not per-user data
├─ name                         // "diagnosis" | "war_room_analogist" | "war_room_skeptic" |
│                                //  "war_room_purist" | "autopsy" | "planner" | "exam_grader"
├─ system_prompt
├─ model                        // always "gemini-3.5-flash"
```

**The one rule to never violate:** `Node.status` changes ONLY via the two triggers described in
Section 2 (`engaged_at` being set → amber; `QuizSession.passed` → green or amber). Do not add any
other code path that silently mutates `status`. If a new feature seems to need a third way to
change mastery, stop and flag it before implementing — this is a deliberate design constraint,
not an oversight to "fix."

---

## 6. The 4-day build plan (compressed from 8 — 6 days remain, no buffer)

Each original day-pair has been merged into one day. This is a genuinely tight compression, not a
free lunch — the only way this works is if Day 1's foundation is rock solid, since every day after
it is now carrying roughly double the original scope. If something slips, cut Tier 2 polish first,
always — never let Tier 1 correctness slip to protect a schedule.

| Day | Focus (merged from original Days) | Notes |
|---|---|---|
| **1** | Foundation + The Graph — full data model, agent orchestrator skeleton, Socket.io wiring, AND Three.js graph render with node color states, click-to-expand, constellation clustering visual | This day now carries the highest risk in the whole plan: if the graph isn't solid by end of Day 1, every later day (which assumes "plug into the graph") gets harder. Don't let scaffolding gold-plating eat into graph time — get *both* done, even roughly, before polishing either. |
| **2** | War Room + Quiz screen, AND Autopsy Board + Explain fallback | Quiz pass/fail logic must be bulletproof (only path to green). Autopsy's clustering logic is a key differentiator — don't shortcut it just because the day is crowded; if anything gets a lighter pass today, let it be Explain's chat polish, not Autopsy's diagnosis quality. |
| **3** | Live Co-Pilot + Study-Plan Board + Ghost Path, AND Exam Simulator + Mastery Streak | Two Tier-1 pairs in one day — prioritize the replanning/insight-card trigger logic and the exam's live-reasoning display over visual polish; these are the "hard logic, not hard UI" days, which helps given the compression. |
| **4** | All four Tier 2 modules, AND integration/full run-through/bug triage/demo video/submission to both DDS and Prometheus/LinkedIn build-in-public post | The single most packed day of the whole build. Tier 2 modules must genuinely reuse Tier 1's component library — zero bespoke UI time available today. Budget real time at the end of the day for the demo video and both submissions; a working app that never gets submitted or filmed scores zero regardless of quality. |

**Given six real remaining days against four planned days, there are two "spare" days.** Use them
as follows, in this priority order:
1. First, as buffer absorbed into whichever day actually overruns (very likely Day 1 or Day 4).
2. If a day finishes on time, pull forward review/polish time rather than starting the next day's
   scope early — a properly tested Tier 1 module is worth more than a half-started Tier 2 module.
3. Only if everything is genuinely ahead of schedule, use remaining time for the 2 big + 3 small
   surprise features described in Section 7 — these are explicitly lower priority than finishing
   the core plan solidly.

---

## 7. Creative flexibility — you're encouraged to surprise Adam

Everything above is the spec, not a cage. You have real creative license to notice things that
should change and to add features Adam didn't ask for — that's encouraged, not just tolerated.
Two things make this safe to do well:

**What's fixed vs. what's yours to shape:**
- **Fixed (don't change without flagging it first):** the `Node.status` transition rule, the
  single-runtime-API-key constraint, the Tier 1/Tier 2 split, the pitch thesis ("diagnose → replan,
  continuously"), the naming (Zynth). These are load-bearing — the whole product falls apart or
  the pitch gets muddled if these quietly drift mid-build.
- **Yours to shape:** literally everything else — module UX details, how a screen is laid out, what
  a War Room persona sounds like, what an insight card says, how the graph feels to interact with,
  whether a Tier 2 module's "minimal UI" plan actually deserves a bit more care once you're in it.
  If something in this doc turns out to be a worse idea once you're actually building it, say so
  and propose the better version — don't silently follow a spec you can tell is wrong.

**Surprise features — actively wanted, not just allowed:**

Add **2 big/massive surprise features** and **3 small surprise features** somewhere across the
build — things Adam didn't ask for that you think make Zynth better. Calibrate size honestly:

- A **big** surprise feature is something with its own real logic and UI surface — roughly the
  weight of an eleventh module, not a tweak to an existing one. It should still serve the pitch
  thesis (diagnose → replan, continuously) and should still be something you can actually finish
  well in the time available — a big feature that's half-built by Day 8 is worse than not
  attempting it, so size it to what's realistically finishable alongside everything else in
  Section 6.
- A **small** surprise feature is a nice detail bolted onto something that already exists — an
  extra bit of polish, a small interaction, a detail in a card or transition that wasn't
  specified but makes the thing feel more considered.

When you add one, say so explicitly in your own build notes/commits rather than quietly folding it
in — Adam should be able to tell, at a glance, what was in the original spec versus what you
decided to add on your own initiative. That's part of what makes this fun for him to discover, and
part of what makes it easy to cut a surprise feature later if it's not landing, without touching
the core spec underneath it.

If a surprise feature idea would require changing one of the fixed items above (the mastery rule,
the API key constraint, the tiering, the thesis, the name) — that's no longer a surprise feature,
that's a scope change, and it needs to be flagged and reasoned through explicitly rather than just
built.

---

## 8. Final reminders

- The single-API-key runtime constraint (Gemini 3.5 Flash only, at runtime) is locked. Don't
  introduce a second runtime provider without Adam changing this explicitly.
- The `Node.status` transition rule (Section 5) is locked. Don't add silent third paths to change
  mastery state.
- Tier 1 modules get real design time; Tier 2 modules reuse Tier 1's component library. Don't
  invent bespoke UI for Tier 2 — that's exactly the time sink the tiering strategy exists to avoid.
- If timeline pressure forces a cut, cut Tier 2 polish first, never Tier 1 correctness.
- This is a real submission with a real physical demo day. Build accordingly.

Good luck. Ship something real.
