# Submission copy — paste-ready

Everything below is written to be copied straight into the relevant form.
Adam submits; nothing here is auto-posted.

---

# 1. Prometheus July AI Challenge (Devpost)

**Deadline: July 31, 07:45 GST** (= July 30, 11:45pm EDT)
Requires: 2-minute demo video · public source repo · project description.

### Project name
`Zynth`

### Elevator pitch (one line)
> Most study apps show you content. Zynth shows you the truth about what you actually know — and rebuilds your plan around it, live.

### Repository
`https://github.com/AdamACE9/zynth`

---

### Inspiration

I kept noticing the same thing in myself and in everyone I study with: we spend hours
"studying" and come away with no honest idea whether we can actually *do* any of it. You
finish a chapter and it feels productive. Then the test asks one question sideways and the
whole thing falls apart.

The gap isn't content — there has never been more of it. The gap is that almost nothing
closes the loop between *"I studied this"* → *"I actually understand it now"* → *"here's
proof, and here's what's still broken."* EdTech either teaches or tests. Very little
**diagnoses continuously and re-plans continuously**.

So I built the thing I wanted: something that refuses to take my word for it.

### What it does

Zynth turns your syllabus into one living 3D knowledge graph. Every concept is a node, and
its colour is **evidence, not effort**:

- **Red** — untouched, or just failed a retest.
- **Amber** — you engaged with it. Zynth believes you understand it, but has no proof.
- **Green** — you passed a quiz on it. The only route to green.

That rule is the whole product, so it is enforced in the **database**, not the interface: a
single service is the only code path allowed to change a node's status, and a SQLite trigger
rejects any illegal transition — even a raw SQL `UPDATE` can't force a node green. Green also
decays: fail a retest and it drops back to amber. Mastery is a claim the graph keeps
re-checking.

Everything else reads and writes that one graph:

- **War Room** — five AI personas (an analogist, a purist, a real-world one, a skeptic, and a
  synthesiser) argue about a concept you're stuck on in a live group chat, streaming
  token-by-token. They answer *each other*, not you, and when they converge the node moves.
- **Autopsy Board** — paste your wrong answers and it finds the single misconception
  underneath all of them, then **draws new edges on your graph** between the concepts that
  keep failing together. It found "you drop the negative when the inner function is
  decreasing" across seven mistakes in three different topics.
- **Live Co-Pilot** — watches a quiz in progress and interrupts, unprompted, the moment a
  concept collapses, with a diagnosis rather than a red cross.
- **Study Plan + Ghost Path** — a prerequisite-respecting route to your goal that re-plans
  *itself* whenever your mastery changes, and draws planned-vs-actual progress GPS-style.
- Plus **Explain** (a tutor that already knows your mistake history), an **Exam Simulator**
  that shows its own reasoning, **Flashcard Forge** (grows the graph from a chapter), a
  **Debate Arena** with a real argument tree, and an **Office Hours Queue** batched by shared
  misconception.

No login. No account. Nothing to install.

### How I built it

React + Vite + TypeScript on the front, with the graph in **Three.js** via react-three-fiber
and a d3-force-3d layout that clusters subjects into constellations. Node + Express + **SQLite
(WAL)** on the back, with **Socket.io** pushing state changes so the graph is genuinely live
rather than a page you refresh.

**Google Gemini** runs every agent — the War Room personas, question generation, the Autopsy
clustering, the tutor, exam grading, planning. The "multi-agent" debate is one model with
five distinct system prompts, which is a standard pattern and does exactly what you'd want.
**Groq (Llama 3.3 70B)** grades free-response answers.

The hardest engineering wasn't any single feature — it was making one invariant impossible to
violate across ten modules that all touch the same graph.

### Challenges I ran into

**Making the Live Co-Pilot shut up.** An insight card that fires on every wrong answer is
noise, and noise trains you to ignore it. I designed and stress-tested the detection logic
against 17 adversarial scenarios *before* wiring it in — and the rules changed twice because
scenarios contradicted them. It now stays silent on a single wrong answer, on your first
three questions, on nodes you've never been taught (failing an untaught concept is expected,
not a collapse), on alternating right/wrong that just means guessing, and on rapid clicking
that means you've checked out. Gemini gets a second independent vote: if it can only call
something a careless slip, the card is dropped. Restraint was harder to build than detection.

**Trusting nothing.** Several times a subagent reported something worked and it hadn't. I
started demanding real output for every claim — and that's how I caught two navigation
deadlocks that silently broke the whole app, and a bug where Tailwind v4 was *silently
dropping* CSS classes so my headline rendered at 16px with overlapping lines.

**Knowing what not to build.** Vercel can't host this backend — no persistent WebSockets, no
filesystem — and finding that out late would have cost the deadline.

### Accomplishments I'm proud of

The status rule genuinely cannot be bypassed. I tested it adversarially: eight illegal
transitions plus a timestamp-replay attack, all rejected at the data layer.

And the Autopsy Board actually works. Feeding it real wrong answers and watching it name the
misconception underneath them — then wire the affected concepts together on the map — is the
moment the whole idea stopped being a diagram and started being a product.

### What I learned

That the interesting part of an AI product is usually the part where it *doesn't* speak. Any
model will generate an insight if you ask it to. Deciding when an insight is worth
interrupting someone for is the actual design work.

Also: verify everything. A confident report is not a working feature.

### What's next

Finishing the Curriculum Time-Machine, deploying it publicly, and putting it in front of
students at my school to see whether the red wall of an honest starting point is motivating
or discouraging. I suspect it's motivating — but that's a claim, and this whole project is
about not trusting those.

### Built with
`react` `typescript` `vite` `three.js` `react-three-fiber` `tailwindcss` `node.js` `express`
`sqlite` `socket.io` `google-gemini` `groq` `llama`

---

# 2. LinkedIn build-in-public post

> Tag **Decoding Data Science** and **DDS Business Circle**.
> Best posted with a screen recording or a still of the graph.

---

Four days ago I started building Zynth. Today it's a working product.

The idea came from something that annoys me about how I study: you can spend three hours on a
chapter, feel productive, and still have no honest idea whether you can actually do any of it.

Most study apps show you content. I wanted one that shows you the truth.

So Zynth turns your syllabus into one living 3D knowledge graph. Every concept is a node, and
the colour means one thing only — evidence.

🔴 Red — untouched.
🟠 Amber — you engaged with it, but there's no proof yet.
🟢 Green — you passed a quiz. The only way to get here.

And green decays. Fail a retest later and the node drops straight back to amber.

That rule was the hardest part to build properly. It's enforced in the database, not the
interface — a SQLite trigger rejects any illegal transition, so even raw SQL can't force a
concept green. I tested it adversarially with eight illegal transitions and a replay attack.
All rejected.

The feature I'm proudest of isn't the graph though. It's the Autopsy Board: you paste your
wrong answers, and it finds the single misconception underneath all of them, then draws new
connections on your map between the concepts that keep failing together. On my test data it
found one root cause behind seven mistakes across three different topics.

The thing that surprised me most: the hardest engineering wasn't making the AI talk. It was
making it shut up. The Live Co-Pilot watches you take a quiz and only interrupts when a
concept is genuinely collapsing — never on one wrong answer, never on a topic you've never
been taught, never when you're clearly just guessing. I stress-tested that logic against 17
scenarios before writing a line of it, and the rules changed twice because the scenarios
proved them wrong.

Any model will generate an insight if you ask. Deciding when an insight is worth interrupting
someone for turned out to be the actual design work.

Built solo in four days. React, Three.js, Node, SQLite, Socket.io, Gemini for the agents and
Groq for grading.

I'm 13. Still building.

Code: github.com/AdamACE9/zynth

#BuildInPublic #AI #EdTech #Gemini #StudentFounder

---

# 3. DDS Agentic AI Demo Challenge — Idea Brief

**Physical demo day: August 6, AstroLabs Dubai.**

**Product:** Zynth — a Student Learning OS built around one living 3D knowledge graph.

**One-line pitch:** Most study apps show you content. Zynth shows you the truth about what you
actually know — and rebuilds your plan around it, live.

**The problem:** Students study constantly, but nothing closes the loop between studying
something and having evidence you understand it. EdTech teaches or tests; almost nothing
diagnoses and re-plans continuously.

**How it's agentic:** Zynth isn't a chatbot with a syllabus attached. Multiple specialised
agents read from and write to a shared world-model (the graph):
- Five **War Room** personas debate a concept and converge, moving the node's state.
- An **Autopsy** agent clusters mistakes across sessions and *modifies the graph itself*,
  drawing new edges between correlated weaknesses.
- A **Planner** agent re-plans the study route autonomously whenever mastery changes — no
  prompt, no refresh button.
- A **Co-Pilot** agent decides, unprompted and under strict suppression rules, when a
  collapse is worth interrupting a student for.
The agents' actions have consequences in shared state; that's what makes it a system rather
than a demo.

**Live demo plan (~4 min):**
1. Open on the graph — a wall of red and amber. "This is an honest starting point."
2. Click a red node → **War Room** → five agents argue live → node turns amber.
3. **Quiz** that node → pass → it turns green. Point out this is the *only* route to green.
4. **Autopsy Board** → paste real mistakes → it names one root cause across three topics and
   draws new edges on the graph in real time.
5. Retest the green node and deliberately fail → it drops back to amber. "Mastery is a claim
   the graph keeps checking."

**Demo-day checklist:**
- Run the backend **locally** (no cold starts, no venue wifi dependency beyond the AI APIs).
- Warm up Gemini with one call before presenting — free tier is 15 req/min and a War Room is
  5 calls.
- `npm run seed` immediately before demoing for a clean 6/6/6 red/amber/green graph.
- Have the deployed URL as a backup, not the primary.
