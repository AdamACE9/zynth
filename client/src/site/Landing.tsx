import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Hero3D, type SpotStatus } from './Hero3D';
import './site.css';

export interface LandingProps {
  /** Primary CTA — enters the product (onboarding first, or the graph if already onboarded). */
  onEnter: () => void;
  /** Secondary CTA — always replays the guided onboarding tour. */
  onStartTour: () => void;
}

/* ── tokens ───────────────────────────────────────────────────────────────── */

const STATUS: Record<SpotStatus, string> = { red: '#ff3b5c', amber: '#ffb020', green: '#28e0a0' };
const INK = '#f4f6ff';
const INK_2 = 'rgba(240,243,253,0.78)';
const INK_3 = 'rgba(240,243,253,0.55)';

/* ── atoms ────────────────────────────────────────────────────────────────── */

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Pip({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      className="pip"
      style={{ width: size, height: size, background: color, boxShadow: `0 0 10px ${color}, 0 0 3px ${color}` }}
    />
  );
}

/** Numbered section header — the signature lifted from the reference sites. */
function Chapter({ index, eyebrow, title, lede }: { index: string; eyebrow: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <Reveal>
      <div className="flex items-baseline gap-4">
        <span className="t-index">[{index}]</span>
        <span className="t-eyebrow">{eyebrow}</span>
      </div>
      <h2 className="display t-sect mt-6" style={{ color: INK }}>
        {title}
      </h2>
      {lede && (
        <p className="t-lede mt-6 max-w-2xl" style={{ color: INK_2 }}>
          {lede}
        </p>
      )}
    </Reveal>
  );
}

/* ── hero cycle ───────────────────────────────────────────────────────────── */

const CYCLE: { s: SpotStatus; hold: number; label: string }[] = [
  { s: 'red', hold: 2800, label: 'untouched — no evidence yet' },
  { s: 'amber', hold: 3200, label: 'debated in the War Room — still unproven' },
  { s: 'green', hold: 4000, label: 'quiz passed — proven' },
];

/* ── page ─────────────────────────────────────────────────────────────────── */

export function Landing({ onEnter, onStartTour }: LandingProps) {
  const [i, setI] = useState(0);
  const beat = CYCLE[i % CYCLE.length]!;

  useEffect(() => {
    const t = setTimeout(() => setI((n) => n + 1), beat.hold);
    return () => clearTimeout(t);
  }, [i, beat.hold]);

  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="zynth-site">
      {/* ─── nav ─────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(5,6,9,0.7)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="shell flex items-center justify-between" style={{ height: 66 }}>
          <a href="#top" className="display" style={{ fontSize: 21, letterSpacing: '-0.03em', color: INK }}>
            Zynth
          </a>
          <nav className="hidden items-center gap-9 md:flex">
            {[
              ['The rule', '#rule'],
              ['War Room', '#warroom'],
              ['Autopsy', '#autopsy'],
              ['FAQ', '#faq'],
            ].map(([l, h]) => (
              <a key={h} href={h} className="t-body transition-colors duration-150" style={{ color: INK_3 }}>
                {l}
              </a>
            ))}
          </nav>
          <button onClick={onEnter} className="cta cta-solid" style={{ padding: '9px 18px', fontSize: 14 }}>
            Open Zynth
          </button>
        </div>
      </header>

      <main id="top">
        {/* ─── hero ──────────────────────────────────────────────────────── */}
        <section className="hero">
          <div className="hero-canvas">
            <Hero3D spotlight={beat.s} />
          </div>
          <div className="hero-scrim" />

          <div className="hero-content shell w-full" style={{ paddingBlock: '120px 96px' }}>
            <motion.p
              className="t-eyebrow"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              Student Learning OS
            </motion.p>

            <motion.h1
              className="display t-hero mt-7"
              style={{ color: INK, maxWidth: '15ch' }}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              Find out what you <span className="ink-grad">actually</span> know.
            </motion.h1>

            <motion.p
              className="t-lede mt-8"
              style={{ color: INK_2, maxWidth: '46ch' }}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              Your whole syllabus becomes one living graph. Engage a concept and it turns amber. Prove it with a quiz
              and it turns green. <em style={{ color: INK, fontStyle: 'italic' }}>Nothing else counts.</em>
            </motion.p>

            {/* live caption — sits in flow under the copy, never over the canvas */}
            <motion.div
              className="mt-9 inline-flex items-center gap-3 rounded-full"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', padding: '9px 16px' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <Pip color={STATUS[beat.s]} />
              <span className="t-body" style={{ color: INK, fontWeight: 500 }}>
                Chain Rule
              </span>
              <motion.span key={beat.s} className="t-body" style={{ color: INK_3 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {beat.label}
              </motion.span>
            </motion.div>

            <motion.div
              className="mt-10 flex flex-wrap items-center gap-3"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.36 }}
            >
              <button onClick={onEnter} className="cta cta-solid" style={{ padding: '15px 28px', fontSize: 16 }}>
                Open Zynth <span aria-hidden>→</span>
              </button>
              <button onClick={onStartTour} className="cta cta-ghost" style={{ padding: '15px 24px', fontSize: 16 }}>
                Take the 60-second tour
              </button>
            </motion.div>

            <motion.p
              className="mt-6 t-body"
              style={{ color: INK_3 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.46 }}
            >
              No login. No account. Nothing to install.
            </motion.p>
          </div>

          <div className="scroll-cue absolute inset-x-0 bottom-7 z-10 flex justify-center" aria-hidden>
            <span className="t-eyebrow">scroll</span>
          </div>
        </section>

        {/* ─── stats ─────────────────────────────────────────────────────── */}
        <section style={{ borderBlock: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="shell grid grid-cols-2 gap-y-10 py-14 md:grid-cols-4">
            {[
              ['5', 'AI minds per debate'],
              ['70%', 'to prove a concept'],
              ['1', 'way to reach green'],
              ['0', 'logins, ever'],
            ].map(([n, l], idx) => (
              <Reveal key={l} delay={idx * 0.06}>
                <div>
                  <div className="display t-stat" style={{ color: INK }}>
                    {n}
                  </div>
                  <div className="t-body mt-2" style={{ color: INK_3 }}>
                    {l}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ─── [01] the rule ─────────────────────────────────────────────── */}
        <section id="rule" className="band">
          <div className="shell">
            <Chapter
              index="01"
              eyebrow="The one rule"
              title={
                <>
                  Green has to be <span className="ink-grad">earned</span>.
                </>
              }
              lede={
                <>
                  Most apps mark a topic complete the moment you look at it. Zynth refuses. Here, colour is{' '}
                  <em style={{ color: INK, fontStyle: 'italic' }}>evidence</em> — not effort, not hours, not good intentions.
                </>
              }
            />

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                { s: 'red' as const, n: 'Red', h: 'Untouched, or just failed.', b: 'Where every concept starts. Re-reading the chapter nine times does not move it one pixel.' },
                { s: 'amber' as const, n: 'Amber', h: 'Engaged, not proven.', b: 'You worked it in the War Room or with the tutor. Zynth thinks you understand it — but it has no evidence yet.' },
                { s: 'green' as const, n: 'Green', h: 'Proven.', b: 'You passed a quiz. The only door to green — and it stays honest: fail a retest later and it drops back to amber.' },
              ].map((c, idx) => (
                <Reveal key={c.s} delay={idx * 0.09}>
                  <div className="card h-full" style={{ padding: 30 }}>
                    <div className="flex items-center gap-2.5">
                      <Pip color={STATUS[c.s]} size={10} />
                      <span className="t-eyebrow" style={{ color: STATUS[c.s], letterSpacing: '0.2em' }}>
                        {c.n}
                      </span>
                    </div>
                    <h3 className="display t-card mt-6" style={{ color: INK }}>
                      {c.h}
                    </h3>
                    <p className="t-body mt-3" style={{ color: INK_2 }}>
                      {c.b}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.12}>
              <div
                className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', padding: '20px 26px' }}
              >
                <span className="t-body" style={{ color: INK_3 }}>
                  Enforced in the database, not the interface:
                </span>
                <span className="display t-body flex flex-wrap items-center gap-2.5" style={{ color: INK }}>
                  <Pip color={STATUS.red} size={8} /> red
                  <span style={{ color: INK_3 }}>— engage →</span>
                  <Pip color={STATUS.amber} size={8} /> amber
                  <span style={{ color: INK_3 }}>— pass a quiz →</span>
                  <Pip color={STATUS.green} size={8} /> green
                </span>
              </div>
            </Reveal>
          </div>
        </section>

        <hr className="rule-line shell" />

        {/* ─── [02] war room ─────────────────────────────────────────────── */}
        <section id="warroom" className="band">
          <div className="shell grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
            <div>
              <Chapter
                index="02"
                eyebrow="War Room"
                title={<>Five minds. One stuck concept.</>}
                lede="Open a weak node and five AI personas argue about it in a live group chat — an analogy, a rigorous definition, a real-world use, and a skeptic trying to break all of it. They talk to each other, not at you."
              />
              <Reveal delay={0.1}>
                <p className="t-body mt-8" style={{ color: INK_3 }}>
                  When they converge, the node moves red → amber. Understanding, logged as evidence.
                </p>
              </Reveal>
            </div>

            <Reveal delay={0.12}>
              <div className="card" style={{ padding: 24 }}>
                <div className="flex items-center justify-between gap-3 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div>
                    <div className="t-eyebrow">Calculus</div>
                    <div className="display t-card mt-1.5" style={{ color: INK }}>
                      Chain Rule
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center gap-2 rounded-full"
                    style={{ background: 'rgba(255,176,32,0.1)', border: '1px solid rgba(255,176,32,0.3)', color: STATUS.amber, padding: '6px 12px', fontSize: 12, fontWeight: 600 }}
                  >
                    <Pip color={STATUS.amber} size={6} /> Case closed
                  </span>
                </div>

                <div className="mt-5 flex flex-col gap-3.5">
                  {[
                    { w: 'Analogist', e: '🧩', c: '#52e5e8', m: 'Ok so the chain rule is basically a recipe step — do it out of order and everything after it quietly breaks.' },
                    { w: 'Purist', e: '📐', c: '#9b7bff', m: "The Analogist's kitchen thing works, but it's more precise to say you're multiplying one rate of change by another." },
                    { w: 'Real World', e: '🌍', c: '#f2b84b', m: 'Fair point Purist — but this is exactly the step that bites people later in physics.' },
                    { w: 'Skeptic', e: '🔍', c: '#ff6b81', m: 'Hang on. Does that still hold when the inner function is itself a composition?' },
                    { w: 'Synthesis', e: '✨', c: '#e8ecff', m: "Skeptic's right to push. Outer rate times inner rate, all the way down. That's the version to keep." },
                  ].map((b, idx) => (
                    <motion.div
                      key={b.w}
                      className="flex items-start gap-3"
                      initial={{ opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ duration: 0.45, delay: idx * 0.13 }}
                    >
                      <span
                        className="flex shrink-0 items-center justify-center rounded-full"
                        style={{ width: 32, height: 32, fontSize: 14, background: `${b.c}1f`, border: `1px solid ${b.c}3d` }}
                        aria-hidden
                      >
                        {b.e}
                      </span>
                      <div className="bubble min-w-0" style={{ background: `${b.c}0f`, borderColor: `${b.c}26` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: b.c }}>{b.w}</div>
                        <p className="t-body mt-1" style={{ color: INK_2 }}>
                          {b.m}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <hr className="rule-line shell" />

        {/* ─── [03] autopsy ──────────────────────────────────────────────── */}
        <section id="autopsy" className="band">
          <div className="shell grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
            <Reveal className="order-2 lg:order-1" delay={0.1}>
              <div className="card" style={{ padding: 30 }}>
                <div className="t-eyebrow">Pattern found · 95% confidence</div>
                <h3 className="display t-card mt-4" style={{ color: '#f5a524' }}>
                  Sign errors when differentiating
                </h3>
                <p className="t-body mt-4" style={{ color: INK_2 }}>
                  Seven separate wrong answers across three different topics. One root cause underneath all of them —
                  you drop the negative when the inner function is decreasing.
                </p>
                <div className="mt-6 flex flex-col gap-2.5">
                  {[
                    ['Chain Rule', 'Implicit Differentiation'],
                    ['Implicit Differentiation', 'Related Rates'],
                    ['Chain Rule', 'Related Rates'],
                  ].map(([a, b]) => (
                    <div
                      key={`${a}-${b}`}
                      className="flex flex-wrap items-center gap-2 rounded-xl"
                      style={{ background: 'rgba(245,165,36,0.07)', border: '1px solid rgba(245,165,36,0.2)', padding: '10px 14px' }}
                    >
                      <span className="t-body" style={{ color: INK_3 }}>
                        connected
                      </span>
                      <span className="t-body" style={{ color: INK, fontWeight: 500 }}>
                        {a}
                      </span>
                      <span style={{ color: '#f5a524' }}>↔</span>
                      <span className="t-body" style={{ color: INK, fontWeight: 500 }}>
                        {b}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            <div className="order-1 lg:order-2">
              <Chapter
                index="03"
                eyebrow="Autopsy Board"
                title={
                  <>
                    It finds the mistake <span className="ink-grad">behind</span> your mistakes.
                  </>
                }
                lede="Paste your wrong answers from homework or a past paper. Zynth reads across all of them at once, names the single misconception underneath, and then rewires your graph — drawing new edges between the concepts that keep failing together."
              />
              <Reveal delay={0.1}>
                <p className="t-body mt-8" style={{ color: INK_3 }}>
                  Those connections appear on your map instantly. You never had to notice the pattern yourself.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <hr className="rule-line shell" />

        {/* ─── [04] the rest ─────────────────────────────────────────────── */}
        <section className="band">
          <div className="shell">
            <Chapter
              index="04"
              eyebrow="The rest of the system"
              title={<>Every part writes to the same map.</>}
              lede="There's no separate quiz app and no separate notes app. Each module reads from the graph and writes straight back to it."
            />
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { i: '🌌', t: 'Knowledge Graph', b: 'Your syllabus as one living 3D map. Click any node to see exactly what you can and cannot prove.', c: '#52e5e8' },
                { i: '🎯', t: 'Quiz', b: 'Questions generated for the exact concept you are on, graded instantly. The only path to a green node.', c: '#28e0a0' },
                { i: '💬', t: 'Explain', b: 'A calm one-to-one tutor that already knows this concept, your mistakes and your trend. You never explain yourself first.', c: '#7bb7ff' },
                { i: '📡', t: 'Live Co-Pilot', b: 'Watches you take a quiz and interrupts the moment a concept collapses — with a diagnosis, not just a red cross.', c: '#9b7bff', soon: true },
                { i: '🧭', t: 'Study Plan', b: 'A route across the graph toward your goal that silently re-plans itself every time your mastery changes.', c: '#f5a524', soon: true },
                { i: '⏱️', t: 'Exam Simulator', b: 'A timed past paper where the agent shows its own reasoning, then maps every lost mark back to a node.', c: '#ff6b81', soon: true },
              ].map((m, idx) => (
                <Reveal key={m.t} delay={idx * 0.06}>
                  <div className="card h-full" style={{ padding: 28, opacity: m.soon ? 0.72 : 1 }}>
                    <div className="flex items-center justify-between">
                      <span
                        className="flex items-center justify-center rounded-xl"
                        style={{ width: 42, height: 42, fontSize: 19, background: `${m.c}17`, border: `1px solid ${m.c}30` }}
                        aria-hidden
                      >
                        {m.i}
                      </span>
                      {m.soon && (
                        <span className="t-eyebrow" style={{ letterSpacing: '0.18em' }}>
                          Soon
                        </span>
                      )}
                    </div>
                    <h3 className="display t-card mt-5" style={{ color: INK }}>
                      {m.t}
                    </h3>
                    <p className="t-body mt-3" style={{ color: INK_2 }}>
                      {m.b}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <hr className="rule-line shell" />

        {/* ─── [05] faq ──────────────────────────────────────────────────── */}
        <section id="faq" className="band">
          <div className="shell grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
            <Chapter index="05" eyebrow="Questions" title={<>The obvious ones.</>} />
            <div>
              {[
                ['Do I need an account?', 'No. There is no login, no signup and nothing to install. Open it and your graph is there.'],
                ['Why can only a quiz turn a node green?', 'Because everything else measures exposure, not understanding. Reading, watching and even a great tutoring session prove that you met the idea — not that you can use it. The quiz is the only thing that produces evidence, so it is the only thing that earns green.'],
                ['Can a green concept go back to amber?', 'Yes, and that is the point. Retest a proven node and fail it and it drops straight back to amber. Mastery is a claim your graph keeps checking.'],
                ['Which AI is behind it?', 'Google Gemini runs the War Room debates, the quiz generation, the Autopsy clustering and the tutor. Groq grades the written answers.'],
                ['Who built this?', 'Adam Ahmed, solo — a 13-year-old founder — as a hackathon build. The whole thing is open source on GitHub.'],
              ].map(([q, a], idx) => {
                const open = openFaq === idx;
                return (
                  <Reveal key={q} delay={idx * 0.05}>
                    <div className="faq-item">
                      <button className="faq-q" onClick={() => setOpenFaq(open ? null : idx)} aria-expanded={open}>
                        <span className="display t-card" style={{ color: open ? INK : INK_2 }}>
                          {q}
                        </span>
                        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.2 }} style={{ color: INK_3, fontSize: 22, lineHeight: 1 }} aria-hidden>
                          +
                        </motion.span>
                      </button>
                      <motion.div
                        initial={false}
                        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        style={{ overflow: 'hidden' }}
                      >
                        <p className="t-body" style={{ color: INK_2, paddingBottom: 24, maxWidth: '60ch' }}>
                          {a}
                        </p>
                      </motion.div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── closing ───────────────────────────────────────────────────── */}
        <section className="band" style={{ paddingTop: 0 }}>
          <div className="shell">
            <Reveal>
              <div
                className="relative overflow-hidden rounded-3xl text-center"
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'linear-gradient(180deg, rgba(82,229,232,0.09), rgba(155,123,255,0.05) 60%, rgba(255,255,255,0.02))',
                  padding: 'clamp(56px, 8vw, 104px) 24px',
                }}
              >
                <h2 className="display t-sect" style={{ color: INK, maxWidth: '18ch', marginInline: 'auto' }}>
                  Stop guessing what you know.
                </h2>
                <p className="t-lede mt-6" style={{ color: INK_2, maxWidth: '44ch', marginInline: 'auto' }}>
                  A minute to set up. The map is yours from the first click.
                </p>
                <div className="mt-10 flex flex-wrap justify-center gap-3">
                  <button onClick={onEnter} className="cta cta-solid" style={{ padding: '16px 32px', fontSize: 16 }}>
                    Open Zynth <span aria-hidden>→</span>
                  </button>
                  <button onClick={onStartTour} className="cta cta-ghost" style={{ padding: '16px 26px', fontSize: 16 }}>
                    Take the tour first
                  </button>
                </div>
                <p className="t-body mt-7" style={{ color: INK_3 }}>
                  No login. No account. Nothing to install.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ─── footer ──────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="shell flex flex-col gap-6 py-12 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="display" style={{ fontSize: 21, letterSpacing: '-0.03em', color: INK }}>
              Zynth
            </div>
            <p className="t-body mt-3" style={{ color: INK_3, maxWidth: '46ch' }}>
              A Student Learning OS built around one living knowledge graph. Built solo by Adam Ahmed. Gemini for the
              agents, Groq for grading.
            </p>
          </div>
          <div className="flex items-center gap-7">
            <a href="https://github.com/AdamACE9/zynth" target="_blank" rel="noreferrer noopener" className="t-body" style={{ color: INK_3 }}>
              GitHub ↗
            </a>
            <button onClick={onEnter} className="t-body" style={{ color: INK_3 }}>
              Open the app
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
