import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Hero3D, type SpotStatus } from './Hero3D';
import { MiniNode3D } from './MiniNode3D';
import { FanInDiagram, IconCopilot, IconExam, IconExplain, IconGraph, IconPlan, IconQuiz, MeterRing, RuleStateMachine } from './Diagrams';
import './site.css';

export interface LandingProps {
  /** Primary CTA — enters the product (onboarding first, or the graph if already onboarded). */
  onEnter: () => void;
  /** Secondary CTA — always replays the guided onboarding tour. */
  onStartTour: () => void;
}

const HUE: Record<SpotStatus, string> = {
  red: 'var(--status-red)',
  amber: 'var(--status-amber)',
  green: 'var(--status-green)',
};

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]';

/* ── atoms ─────────────────────────────────────────────────────────────── */

/** A wipe, deliberately not the stock fade-up. Reads like a line being drawn. */
function Ink({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Dot({ hue, size = 9 }: { hue: string; size?: number }) {
  return <span className="dot" style={{ width: size, height: size, background: hue, boxShadow: `0 0 10px ${hue}` }} />;
}

/** The app's own three-node constellation mark (see ui/TopBar.tsx) — reused
 * verbatim so the site's wordmark is pixel-identical to the app's. */
function ZynthMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M5.6 7.4 12 4.2l6.4 3.2M5.6 7.4v9.2L12 19.8l6.4-3.2V7.4" stroke="var(--accent-violet)" strokeOpacity="0.5" strokeWidth="1" />
      <circle cx="12" cy="4.2" r="2.1" fill="var(--accent-cyan)" />
      <circle cx="5.6" cy="16.6" r="1.7" fill="var(--accent-violet)" />
      <circle cx="18.4" cy="16.6" r="1.7" fill="var(--accent-violet)" fillOpacity="0.65" />
    </svg>
  );
}

/** Exhibit header: marginal accent-cyan numeral + rule, like a case file section. */
function Exhibit({ n, tag, title, lede }: { n: string; tag: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="exhibit">
      <div className="t-num pt-2">{n}</div>
      <div>
        <Ink>
          <div className="t-tag">{tag}</div>
          <h2 className="t-sect mt-5" style={{ maxWidth: '17ch' }}>
            {title}
          </h2>
          {lede && (
            <p className="t-lede mt-6" style={{ maxWidth: '54ch' }}>
              {lede}
            </p>
          )}
        </Ink>
      </div>
    </div>
  );
}

/* ── hero demo cycle ───────────────────────────────────────────────────── */

const CYCLE: { s: SpotStatus; hold: number; verdict: string }[] = [
  { s: 'red', hold: 2900, verdict: 'no evidence on file' },
  { s: 'amber', hold: 3200, verdict: 'engaged — claim unproven' },
  { s: 'green', hold: 4000, verdict: 'quiz passed — proven' },
];

/* ── page ──────────────────────────────────────────────────────────────── */

export function Landing({ onEnter, onStartTour }: LandingProps) {
  const [i, setI] = useState(0);
  const beat = CYCLE[i % CYCLE.length]!;
  const [openQ, setOpenQ] = useState<number | null>(0);

  useEffect(() => {
    const t = setTimeout(() => setI((n) => n + 1), beat.hold);
    return () => clearTimeout(t);
  }, [i, beat.hold]);

  return (
    <div className="zynth-site">
      {/* ── masthead ─────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40"
        style={{ background: 'rgba(4,5,10,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid var(--border-glass)' }}
      >
        <div className="sheet flex items-center justify-between" style={{ height: 62 }}>
          <a href="#top" className="flex items-center gap-2.5">
            <ZynthMark />
            <span className="text-wordmark" style={{ fontSize: 21 }}>
              Zynth
            </span>
          </a>
          <nav className="hidden items-center gap-8 md:flex">
            {[
              ['01 The rule', '#e01'],
              ['02 War Room', '#e02'],
              ['03 Autopsy', '#e03'],
              ['05 Questions', '#e05'],
            ].map(([l, h]) => (
              <a key={h} href={h} className={`t-tag ${FOCUS_RING}`} style={{ letterSpacing: '0.14em' }}>
                {l}
              </a>
            ))}
          </nav>
          <button onClick={onEnter} className={`cta ${FOCUS_RING}`} style={{ padding: '9px 16px' }}>
            Go to Zynth
          </button>
        </div>
      </header>

      <main id="top">
        {/* ── hero ───────────────────────────────────────────────────── */}
        <section className="hero sheet" style={{ paddingBlock: 'clamp(48px,7vw,88px) clamp(56px,7vw,96px)' }}>
          {/* animated corner wash — atmosphere only, see site.css .hero-wash */}
          <div className="hero-wash" aria-hidden />
          <div className="hero-content grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
            <div>
              <Ink>
                <div className="t-tag">Student Learning OS — est. 2026</div>
              </Ink>

              {/* Blur+translateY "settle" reveal — the hero-text keyframe both
                  references use (Chorus's heroFadeInUp; Anthropic's
                  opacity+transform scroll-ins), not a flat fade. */}
              <motion.h1
                className="t-hero mt-7"
                style={{ maxWidth: '13ch' }}
                initial={{ opacity: 0, y: 20, filter: 'blur(9px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
              >
                The truth about what you{' '}
                <span style={{ color: 'var(--accent-cyan)' }}>actually</span> know.
              </motion.h1>

              <motion.p
                className="t-lede mt-8"
                style={{ maxWidth: '48ch' }}
                initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                Zynth keeps a case file on every concept in your syllabus. Nothing counts as known until you have
                produced evidence for it — and a quiz is the only evidence it accepts.
              </motion.p>

              <motion.div
                className="mt-10 flex flex-wrap items-center gap-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.7, delay: 0.25 }}
              >
                <button onClick={onEnter} className={`cta ${FOCUS_RING}`} style={{ padding: '15px 26px' }}>
                  Go to Zynth
                </button>
                <button onClick={onStartTour} className={`cta-ghost ${FOCUS_RING}`} style={{ padding: '15px 22px' }}>
                  Take the tour
                </button>
              </motion.div>

              <Ink delay={0.35}>
                <p className="t-tag mt-7">No account · nothing installed · nothing leaves your device</p>
              </Ink>
            </div>

            {/* the live graph */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.1, delay: 0.15 }}>
              <div className="plate glass-panel">
                <Hero3D spotlight={beat.s} />
              </div>
              {/* figure caption — the live verdict on the highlighted node */}
              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Dot hue={HUE[beat.s]} />
                  <span className="mono" style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    Chain Rule
                  </span>
                  <motion.span
                    key={beat.s}
                    className="t-tag"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{ letterSpacing: '0.1em' }}
                  >
                    {beat.verdict}
                  </motion.span>
                </div>
                <span className="t-tag">Fig. 1 — mastery graph, live</span>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── evidence bar ───────────────────────────────────────────── */}
        <section style={{ borderTop: '1px solid var(--border-glass)', borderBottom: '1px solid var(--border-glass)' }}>
          <div className="sheet grid grid-cols-2 md:grid-cols-4">
            {[
              ['05', 'minds per debate'],
              ['70', 'per cent to prove it'],
              ['01', 'route to green'],
              ['00', 'accounts required'],
            ].map(([n, l], idx) => (
              <Ink key={l} delay={idx * 0.05}>
                <div
                  className="py-10"
                  style={{ borderLeft: idx === 0 ? 'none' : '1px solid var(--border-glass)', paddingLeft: idx === 0 ? 0 : 26 }}
                >
                  <div className="t-fig">{n}</div>
                  <div className="t-tag mt-3">{l}</div>
                </div>
              </Ink>
            ))}
          </div>
        </section>

        {/* ── 01 the rule ────────────────────────────────────────────── */}
        <section id="e01" className="band">
          <div className="sheet">
            <Exhibit
              n="01"
              tag="The standard of proof"
              title={
                <>
                  Green is a <span style={{ color: 'var(--accent-cyan)' }}>verdict</span>, not a mood.
                </>
              }
              lede="Most study apps mark a topic done the moment you look at it. Zynth treats that as hearsay. A concept has exactly three states, and only one of them means you can actually do it."
            />

            <div className="mt-14 grid gap-12 lg:grid-cols-[0.95fr_1.3fr] lg:gap-14 lg:items-start">
              {/* the diagram — an authored SVG state machine, not a screenshot */}
              <div>
                <div className="visual-frame" style={{ aspectRatio: '380 / 210', padding: 'clamp(14px,2vw,22px)' }}>
                  <RuleStateMachine />
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div style={{ width: 46, height: 46 }} aria-hidden>
                    <MiniNode3D />
                  </div>
                  <span className="t-tag">The same three states, live — not a diagram of the product, the product</span>
                </div>
              </div>

              <div>
                {[
                  { s: 'red' as const, k: 'Red', h: 'No evidence.', b: 'Where every concept starts, and where it returns after a failed retest. Re-reading the chapter nine times does not move it.' },
                  { s: 'amber' as const, k: 'Amber', h: 'Engaged. Unproven.', b: 'You took it to the War Room or sat with the tutor. Zynth records that you met the idea — not that you can use it.' },
                  { s: 'green' as const, k: 'Green', h: 'Proven.', b: 'You passed a quiz on it. The only route to green, and a reversible one: fail a retest later and the verdict is vacated.' },
                ].map((r, idx) => (
                  <Ink key={r.s} delay={idx * 0.07}>
                    <div
                      className="grid items-start gap-3 py-7 md:grid-cols-[112px_minmax(0,1fr)] md:gap-8"
                      style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border-glass)' }}
                    >
                      <div className="flex items-center gap-3">
                        <Dot hue={HUE[r.s]} size={11} />
                        <span className="t-tag" style={{ color: HUE[r.s], letterSpacing: '0.16em' }}>
                          {r.k}
                        </span>
                      </div>
                      <div>
                        <h3 className="t-sub">{r.h}</h3>
                        <p className="t-body mt-2">{r.b}</p>
                      </div>
                    </div>
                  </Ink>
                ))}
                <div className="hair" />
                <Ink delay={0.1}>
                  <p className="mono mt-8" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Enforced by a database trigger, not by the interface — an illegal transition is rejected at the
                    data layer even if something upstream asks for it.
                  </p>
                </Ink>
              </div>
            </div>
          </div>
        </section>

        {/* ── 02 war room ────────────────────────────────────────────── */}
        <section id="e02" className="band">
          <div className="sheet">
            <Exhibit
              n="02"
              tag="The War Room"
              title={<>Five minds. One stuck concept.</>}
              lede="Open a weak node and five AI personas argue it out in front of you — an analogy, a rigorous definition, a real-world use, and a skeptic trying to break all three. They answer each other, not you."
            />
            <Ink delay={0.1}>
              <div className="glass-panel showcase mt-14" style={{ padding: 'clamp(22px,3vw,38px)' }}>
                <div className="flex flex-wrap items-baseline justify-between gap-3 pb-6" style={{ borderBottom: '1px solid var(--border-glass)' }}>
                  <span className="t-tag">Transcript — Calculus / Chain Rule</span>
                  <span className="t-tag" style={{ color: 'var(--status-amber)' }}>
                    Verdict: engaged
                  </span>
                </div>
                <div className="mt-7 flex flex-col gap-6">
                  {[
                    ['Analogist', 'A', 'var(--accent-violet)', 'Ok so the chain rule is basically a recipe step — do it out of order and everything after it quietly breaks.'],
                    ['Purist', 'P', 'var(--accent-cyan)', "The Analogist's kitchen thing works, but it's more precise to say you're multiplying one rate of change by another."],
                    ['Real World', 'R', 'var(--accent-violet)', 'Fair point Purist — but this is exactly the step that bites people later in physics.'],
                    ['Skeptic', 'S', 'var(--accent-cyan)', 'Hang on. Does that still hold when the inner function is itself a composition?'],
                    ['Synthesis', 'Σ', 'var(--accent-cyan)', "Skeptic's right to push. Outer rate times inner rate, all the way down. That's the version to keep."],
                  ].map(([who, initial, hue, line], idx) => (
                    <motion.div
                      key={who}
                      className="grid gap-2 md:grid-cols-[152px_minmax(0,1fr)] md:gap-8"
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ duration: 0.4, delay: idx * 0.12 }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="avatar"
                          style={{ background: `color-mix(in srgb, ${hue} 16%, transparent)`, color: hue, borderColor: `color-mix(in srgb, ${hue} 45%, transparent)` }}
                        >
                          {initial}
                        </span>
                        <span className="t-tag">{who}</span>
                      </div>
                      <p style={{ fontSize: '1.0625rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>{line}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </Ink>
          </div>
        </section>

        {/* ── 03 autopsy ─────────────────────────────────────────────── */}
        <section id="e03" className="band">
          <div className="sheet">
            <Exhibit
              n="03"
              tag="The Autopsy Board"
              title={
                <>
                  The mistake <span style={{ color: 'var(--accent-cyan)' }}>behind</span> your mistakes.
                </>
              }
              lede="Paste the wrong answers from a past paper. Zynth reads across all of them at once, names the single misconception underneath, and then rewires your graph — drawing edges between the concepts that keep failing together."
            />
            <Ink delay={0.1}>
              <div className="glass-panel showcase mt-14" style={{ padding: 'clamp(22px,3vw,38px)' }}>
                <div className="flex flex-wrap items-start gap-6">
                  <MeterRing value={0.95} size={68} />
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="t-tag">Finding 01 — confidence 0.95</span>
                      <span className="t-tag">07 mistakes · 03 concepts</span>
                    </div>
                    <h3 className="display mt-4" style={{ fontSize: 'clamp(1.4rem,2.6vw,2.1rem)', lineHeight: 1.14 }}>
                      You drop the negative when the inner function is decreasing.
                    </h3>
                  </div>
                </div>
                <p className="t-body mt-6" style={{ maxWidth: '58ch' }}>
                  Seven separate wrong answers across three topics, one cause. Not carelessness — a rule you learned
                  with the sign attached to the wrong term.
                </p>

                <div className="mt-9 grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-center">
                  <div className="grid gap-px" style={{ background: 'var(--border-glass)' }}>
                    {[
                      ['Chain Rule', 'Implicit Differentiation'],
                      ['Implicit Differentiation', 'Related Rates'],
                      ['Chain Rule', 'Related Rates'],
                    ].map(([a, b]) => (
                      <div key={`${a}${b}`} className="flex flex-wrap items-center gap-3 py-4" style={{ background: 'var(--surface-glass-strong)' }}>
                        <span className="t-tag">edge drawn</span>
                        <span style={{ fontSize: '1.0625rem', color: 'var(--text-primary)' }}>{a}</span>
                        <span style={{ color: 'var(--status-amber)' }}>↔</span>
                        <span style={{ fontSize: '1.0625rem', color: 'var(--text-primary)' }}>{b}</span>
                      </div>
                    ))}
                  </div>
                  <div className="visual-frame" style={{ aspectRatio: '380 / 190', padding: 'clamp(12px,1.6vw,20px)' }}>
                    <FanInDiagram />
                  </div>
                </div>
              </div>
            </Ink>
          </div>
        </section>

        {/* ── 04 the system ──────────────────────────────────────────── */}
        <section id="e04" className="band">
          <div className="sheet">
            <Exhibit n="04" tag="The rest of the file" title={<>Every part writes to the same map.</>} />
            <div className="mt-14">
              {[
                ['Knowledge Graph', 'Your syllabus as one living 3D map. Click any node to see precisely what you can and cannot prove.', false, <IconGraph key="i" />, 'cyan'],
                ['Quiz', 'Questions generated for the exact concept in front of you, graded on the spot. The only route to green.', false, <IconQuiz key="i" />, 'violet'],
                ['Explain', 'A one-to-one tutor that already holds your file — this concept, your mistakes, your trend. You never brief it first.', false, <IconExplain key="i" />, 'cyan'],
                ['Live Co-Pilot', 'Watches a quiz in progress and interrupts the moment a concept collapses, with a diagnosis rather than a red cross.', true, <IconCopilot key="i" />, 'violet'],
                ['Study Plan', 'A route across the graph toward your goal that re-plans itself every time the evidence changes.', true, <IconPlan key="i" />, 'cyan'],
                ['Exam Simulator', 'A timed past paper where the agent shows its own reasoning, then maps every lost mark back to a node.', true, <IconExam key="i" />, 'violet'],
              ].map(([t, b, soon, icon, tint], idx) => (
                <Ink key={t as string} delay={idx * 0.05}>
                  <div
                    className={`row tint-${tint as string} grid gap-4 py-7 md:grid-cols-[40px_minmax(0,1fr)_minmax(0,1.6fr)] md:gap-10 md:items-start`}
                    style={{ opacity: soon ? 0.72 : 1 }}
                  >
                    <div className="icon-tile">{icon}</div>
                    <h3 className="t-sub">{t as string}</h3>
                    <div>
                      <p className="t-body">{b as string}</p>
                      {soon ? <span className="t-tag mt-2 inline-block">In progress</span> : null}
                    </div>
                  </div>
                </Ink>
              ))}
              <div className="hair" />
            </div>

            {/* one full mockup, screenshot-framed exactly like the reference
                sites frame product imagery: fixed radius, hairline border,
                soft shadow, generous surrounding whitespace. */}
            <Ink delay={0.1}>
              <div className="visual-frame mt-14" style={{ padding: 'clamp(20px,2.6vw,32px)' }}>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-5" style={{ borderBottom: '1px solid var(--border-glass)' }}>
                  <span className="t-tag">Quiz — Implicit Differentiation</span>
                  <span className="t-tag" style={{ color: 'var(--status-green)' }}>
                    4 / 5 — passed
                  </span>
                </div>
                <div className="mt-5 flex flex-col gap-3.5">
                  {[
                    ['Differentiate x²y = 4 implicitly for dy/dx.', 'green'],
                    ['Which term here needs the product rule?', 'green'],
                    ['Solve for dy/dx after differentiating.', 'red'],
                    ['State the value of dy/dx at (2, 1).', 'green'],
                    ['Explain why the chain rule applies to y².', 'green'],
                  ].map(([q, s], i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Dot hue={HUE[s as SpotStatus]} size={8} />
                      <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Ink>
          </div>
        </section>

        {/* ── 05 questions ───────────────────────────────────────────── */}
        <section id="e05" className="band">
          <div className="sheet grid gap-12 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-20">
            <div>
              <div className="t-num">05</div>
              <h2 className="t-sect mt-5">Questions.</h2>
            </div>
            <div>
              {[
                ['Do I need an account?', 'No. No login, no signup, nothing to install. Open it and the graph is there.'],
                ['Why can only a quiz turn a node green?', 'Because everything else measures exposure. Reading, watching, even a genuinely good tutoring session prove you met the idea — not that you can use it under pressure. The quiz is the only step that produces evidence, so it is the only step that earns the verdict.'],
                ['Can a proven concept go back?', 'Yes, and that is the point. Retest a green node, fail it, and it drops to amber immediately. Mastery is a claim the graph keeps re-checking.'],
                ['Which models run it?', 'Google Gemini runs the War Room debates, question generation, the Autopsy clustering and the tutor. Groq grades written answers.'],
                ['Who built this?', 'Adam Ahmed, solo, at thirteen — as a hackathon build. The whole thing is open source.'],
              ].map(([q, a], idx) => {
                const open = openQ === idx;
                return (
                  <div key={q}>
                    <button className={`q ${FOCUS_RING}`} onClick={() => setOpenQ(open ? null : idx)} aria-expanded={open}>
                      <span className="display" style={{ fontSize: 'clamp(1.15rem,2vw,1.4rem)', lineHeight: 1.2 }}>
                        {q}
                      </span>
                      <span className="t-tag" style={{ paddingTop: 6, color: open ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                        {open ? '−' : '+'}
                      </span>
                    </button>
                    <motion.div
                      initial={false}
                      animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <p className="t-body" style={{ paddingBottom: 26, maxWidth: '62ch' }}>
                        {a}
                      </p>
                    </motion.div>
                  </div>
                );
              })}
              <div className="hair" />
            </div>
          </div>
        </section>

        {/* ── closing ────────────────────────────────────────────────── */}
        <section className="band">
          <div className="sheet text-center">
            <Ink>
              <h2 className="t-sect" style={{ maxWidth: '16ch', marginInline: 'auto' }}>
                Stop guessing what you know.
              </h2>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <button onClick={onEnter} className={`cta ${FOCUS_RING}`} style={{ padding: '16px 30px' }}>
                  Go to Zynth
                </button>
                <button onClick={onStartTour} className={`cta-ghost ${FOCUS_RING}`} style={{ padding: '16px 24px' }}>
                  Take the tour
                </button>
              </div>
              <p className="t-tag mt-7">No account · nothing installed</p>
            </Ink>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid var(--border-glass)' }}>
        <div className="sheet flex flex-col gap-5 py-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ZynthMark size={18} />
              <span className="text-wordmark" style={{ fontSize: 19 }}>
                Zynth
              </span>
            </div>
            <p className="t-body mt-3" style={{ maxWidth: '44ch' }}>
              A Student Learning OS built on one living knowledge graph. Gemini for the agents, Groq for grading.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/AdamACE9/zynth" target="_blank" rel="noreferrer noopener" className={`t-tag ${FOCUS_RING}`}>
              GitHub ↗
            </a>
            <button onClick={onEnter} className={`t-tag ${FOCUS_RING}`}>
              Go to Zynth
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
