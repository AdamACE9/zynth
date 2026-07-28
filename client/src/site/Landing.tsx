import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Convergence } from './Convergence';
import './site.css';

/* three.js + r3f + postprocessing is by far the heaviest thing on this page,
   and statically importing it put the whole bundle on the critical path: the
   headline could not paint until WebGL had parsed, which measured as ~2.9s of
   pure render delay against LCP. Splitting it out lets the copy paint straight
   away and the constellation fade in behind it a beat later. */
const Constellation = lazy(() =>
  import('./Constellation').then((m) => ({ default: m.Constellation })),
);
const ProofOrb = lazy(() => import('./Orbs').then((m) => ({ default: m.ProofOrb })));
const PersonaRing = lazy(() => import('./Orbs').then((m) => ({ default: m.PersonaRing })));

export interface LandingProps {
  /** "Go to Zynth" — straight to the graph, or through setup on a first visit. */
  onEnter: () => void;
  /** Forces the full first-run tour, regardless of whether a graph exists. */
  onStartTour: () => void;
}

const GITHUB = 'https://github.com/AdamACE9/zynth';

/* ===========================================================================
   Reveal — one IntersectionObserver for the whole page.
   Elements opt in with data-reveal and flip to data-reveal="in" once, on first
   intersection. Nothing re-animates on the way back up: a page that re-plays
   itself while you scroll upward reads as broken, not alive.
   ======================================================================== */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    if (!scope) return;

    const targets = Array.from(scope.querySelectorAll<HTMLElement>('[data-reveal]'));
    const show = (el: Element) => el.setAttribute('data-reveal', 'in');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach(show);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          show(e.target);
          io.unobserve(e.target);
        }
      },
      // Fire slightly before the element is fully on screen, so the motion is
      // finishing as it settles into view rather than starting there.
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    targets.forEach((el) => io.observe(el));

    /* Failsafe.
       Every revealable element starts at opacity 0, so if the observer never
       delivers a callback the page is simply blank — an unacceptable failure
       mode for the front door. IntersectionObserver does NOT compute
       intersections while the document is hidden, which is the common real
       case: a middle-click / "open in new tab" / restored session loads the
       whole page in the background.

       So we also sweep manually off geometry, which layout gives us even when
       hidden, and re-sweep when the tab is first shown. Both paths are
       idempotent and the observer still owns everything below the fold. */
    const sweep = () => {
      const h = window.innerHeight || document.documentElement.clientHeight;
      for (const el of targets) {
        if (el.getAttribute('data-reveal') === 'in') continue;
        const r = el.getBoundingClientRect();
        if (r.top < h && r.bottom > 0) {
          show(el);
          io.unobserve(el);
        }
      }
    };

    // Deliberately NOT requestAnimationFrame: rAF is paused while the document
    // is hidden, which is the exact case this exists to cover. Sweep once now
    // off current layout, then again shortly after in case webfonts or the
    // canvas shift things.
    sweep();
    const settle = window.setTimeout(sweep, 260);

    const onVisible = () => {
      if (!document.hidden) sweep();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(settle);
      document.removeEventListener('visibilitychange', onVisible);
      io.disconnect();
    };
  }, []);

  return root;
}

/** Nav goes glass once the hero starts leaving. */
function useStuck() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const on = () => setStuck(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return stuck;
}

/** Section heading with its mono number, hung off the page spine. */
function Head({ n, kicker, children }: { n: string; kicker: string; children: React.ReactNode }) {
  return (
    <div className="head">
      <div className="head-num" data-reveal>
        <span className="mono">{n}</span>
        <i />
        <span className="mono">{kicker}</span>
      </div>
      <h2 className="t-sect" data-reveal style={{ ['--d' as string]: '60ms' }}>
        {children}
      </h2>
    </div>
  );
}

/** Bento card that lights in its own accent under the cursor. */
function Card({
  title,
  body,
  glow,
  span,
  icon,
}: {
  title: string;
  body: string;
  glow: string;
  span?: boolean;
  icon: React.ReactNode;
}) {
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, []);

  return (
    <div
      className={`card${span ? ' wide' : ''}`}
      style={{ ['--glow' as string]: glow }}
      onMouseMove={onMove}
      data-reveal
    >
      <div className="card-i">{icon}</div>
      <h3>{title}</h3>
      <p className="duo">{body}</p>
    </div>
  );
}

/** Small stroked icon — one 24-grid, 1.6 weight, round caps. */
function Glyph({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const FAQS: [string, string][] = [
  ['Do I need an account?', 'No. No login, no signup, nothing to install. Open it and the graph is there.'],
  [
    'Why can only a quiz turn a node green?',
    'Because everything else measures exposure. Reading, watching, even a genuinely good tutoring session prove you met the idea — not that you can use it under pressure. The quiz is the only step that produces evidence, so it is the only step that earns the verdict.',
  ],
  [
    'Can a proven concept go back?',
    'Yes, and that is the point. Retest a green node, fail it, and it drops to amber immediately. Mastery is a claim the graph keeps re-checking.',
  ],
  [
    'Which models run it?',
    'Google Gemini runs the War Room debates, question generation, the Autopsy clustering and the tutor. Groq grades written answers.',
  ],
  ['Who built this?', 'Adam Ahmed, solo, at thirteen — as a hackathon build. The whole thing is open source.'],
];

const TURNS: [string, string][] = [
  ['The Analogist', 'Ok so the chain rule is basically a recipe step — do it out of order and everything after it quietly breaks.'],
  ['The Purist', 'Useful, but imprecise. The derivative of a composition is the outer derivative evaluated at the inner function, times the inner derivative.'],
  ['Real World', 'Fair point Purist — but this is exactly the step that bites people later in physics.'],
  ['The Skeptic', 'Hang on. Does that still hold when the inner function is itself a composition?'],
  ['Synthesis', 'It does, and that is the version to keep: peel one layer at a time, and never drop the inner derivative.'],
];

const MODULES: {
  title: string;
  body: string;
  glow: string;
  span?: boolean;
  d: string;
}[] = [
  {
    title: 'Knowledge Graph', glow: 'var(--cyan)', span: true,
    body: 'Your syllabus as one living 3D map. Click any node to see precisely what you can and cannot prove.',
    d: 'M12 3v6m0 6v6M5 8l7 4 7-4M5 16l7-4 7 4',
  },
  {
    title: 'Quiz', glow: 'var(--green)', span: true,
    body: 'Questions generated for the exact concept in front of you, graded on the spot. The only route to green.',
    d: 'M4 12l5 5L20 6',
  },
  {
    title: 'Explain', glow: 'var(--violet)',
    body: 'A one-to-one tutor that already holds your file — this concept, your mistakes, your trend. You never brief it first.',
    d: 'M4 5h16v11H8l-4 4V5z',
  },
  {
    title: 'Live Co-Pilot', glow: 'var(--amber)',
    body: 'Watches a quiz in progress and interrupts the moment a concept collapses, with a diagnosis rather than a red cross.',
    d: 'M12 3l2.4 6.2L21 11l-6.6 1.8L12 19l-2.4-6.2L3 11l6.6-1.8z',
  },
  {
    title: 'Study Plan', glow: 'var(--cyan)',
    body: 'A route across the graph toward your goal that re-plans itself every time the evidence changes.',
    d: 'M4 18L10 6l4 8 6-6',
  },
  {
    title: 'Exam Simulator', glow: 'var(--red)', span: true,
    body: 'A timed past paper where the agent shows its own reasoning, then maps every lost mark back to a node.',
    d: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: 'Autopsy Board', glow: 'var(--violet)', span: true,
    body: 'Reads every wrong answer at once, names the one misconception underneath, and draws the edges that were missing.',
    d: 'M6 4v7a6 6 0 0012 0V4M9 20h6',
  },
];

const STATES: [string, string, string][] = [
  ['red', 'Red', 'Untouched, or just failed a retest. Re-reading the chapter nine times does not move it.'],
  ['amber', 'Amber', 'Engaged. Unproven. You took it to the War Room or sat with the tutor. Zynth records that you met the idea — not that you can use it.'],
  ['green', 'Green', 'Proven. You passed a quiz on it at seventy per cent or better. This is the only route here.'],
];

export function Landing({ onEnter, onStartTour }: LandingProps) {
  const root = useReveal();
  const stuck = useStuck();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="site" ref={root}>
      {/* ---- atmosphere -------------------------------------------------- */}
      <div className="site-streaks" aria-hidden="true" />
      <div className="site-grain" aria-hidden="true" />
      <div className="site-vignette" aria-hidden="true" />

      <div className="site-content">
        {/* ---- nav ------------------------------------------------------- */}
        <header className="nav" data-stuck={stuck}>
          <div className="wrap">
            <div className="nav-inner">
              <button
                className="wordmark focus-ring"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                <span className="dot dot-green" />
                Zynth
              </button>
              <nav className="nav-links">
                <a href="#rule">The rule</a>
                <a href="#warroom">War Room</a>
                <a href="#autopsy">Autopsy</a>
                <a href="#modules">Modules</a>
                <a href="#faq">FAQ</a>
              </nav>
              <button className="cta focus-ring" onClick={onEnter} style={{ padding: '10px 18px' }}>
                Go to Zynth
              </button>
            </div>
          </div>
        </header>

        {/* ---- hero ------------------------------------------------------ */}
        <section className="hero">
          <Suspense fallback={null}>
            <Constellation className="hero-canvas" />
          </Suspense>
          <div className="wrap">
            <div className="hero-copy">
              <div>
                <span className="chip" data-reveal>
                  <span className="dot dot-green" />
                  Student Learning OS
                </span>

                <h1 className="t-hero" style={{ marginTop: 26 }} data-reveal>
                  Know what you
                  <br />
                  <span className="mark mark-green">actually</span> know.
                </h1>

                <p className="t-lede" style={{ marginTop: 28 }} data-reveal>
                  Zynth keeps a case file on every concept in your syllabus. Nothing counts as known
                  until you have produced evidence for it — and a quiz is the only evidence it
                  accepts.
                </p>

                <div style={{ marginTop: 34, display: 'flex', flexWrap: 'wrap', gap: 12 }} data-reveal>
                  <button className="cta focus-ring" onClick={onEnter}>Go to Zynth</button>
                  <button className="cta-ghost focus-ring" onClick={onStartTour}>Take the tour</button>
                </div>

                <p className="mono" style={{ marginTop: 20 }} data-reveal>
                  No account · nothing installed · nothing leaves your device
                </p>
              </div>
            </div>

            <div className="hero-stats" style={{ marginTop: 96 }} data-reveal>
              {[
                ['05', 'minds per debate'],
                ['70', 'per cent to prove it'],
                ['01', 'route to green'],
                ['00', 'accounts required'],
              ].map(([n, l]) => (
                <div className="hero-stat" key={l}>
                  <b>{n}</b>
                  <span className="mono">{l}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---- 01 the rule ----------------------------------------------- */}
        <section className="band" id="rule">
          <div className="spine" />
          <div className="wrap">
            <Head n="01" kicker="The standard of proof">
              Green is a <span className="mark mark-green">verdict</span>, not a mood.
            </Head>

            <p className="t-body" style={{ marginTop: 26 }} data-reveal>
              Most study apps mark a topic done the moment you look at it. Zynth treats that as
              hearsay. A concept has exactly three states, and only one of them means you can
              actually do it.
            </p>

            <div className="states" style={{ marginTop: 56 }}>
              {STATES.map(([k, title, body], i) => (
                <div className={`state state-${k}`} key={k} data-reveal style={{ ['--d' as string]: `${i * 90}ms` }}>
                  <span className={`dot dot-${k}`} />
                  <h3>{title}</h3>
                  <p className="duo" style={{ marginTop: 10 }}>{body}</p>
                </div>
              ))}
            </div>

            <div className="ladder" style={{ marginTop: 20 }} data-reveal>
              <div className="ladder-row">
                <span className="dot dot-red" /> red <span className="arrow">→</span>
                <span className="dot dot-amber" /> amber
                <em>engaged via War Room or Explain</em>
              </div>
              <div className="ladder-row">
                <span className="dot dot-amber" /> amber <span className="arrow">→</span>
                <span className="dot dot-green" /> green
                <em>quiz passed, score ≥ 70</em>
              </div>
              <div className="ladder-row">
                <span className="dot dot-green" /> green <span className="arrow">→</span>
                <span className="dot dot-amber" /> amber
                <em>failed retest — decays</em>
              </div>
            </div>

            {/* The rule, made testable. Reading a state machine is one thing;
                driving one is another — and it enforces the real transitions,
                including green decaying on a failed retest. */}
            <div style={{ marginTop: 20 }} data-reveal>
              <Suspense fallback={null}>
                <ProofOrb />
              </Suspense>
            </div>

            <p className="duo" style={{ marginTop: 22, maxWidth: '62ch' }} data-reveal>
              <b>Enforced by a database trigger, not by the interface.</b> An illegal transition is
              rejected at the data layer even if something upstream asks for it.
            </p>
          </div>
        </section>

        {/* ---- 02 war room ------------------------------------------------ */}
        <section className="band" id="warroom">
          <div className="spine" />
          <div className="wrap">
            <Head n="02" kicker="The War Room">Five minds. One stuck concept.</Head>

            <p className="t-body" style={{ marginTop: 26 }} data-reveal>
              Open a weak node and five AI personas argue it out in front of you — an analogy, a
              rigorous definition, a real-world use, and a skeptic trying to break all three. They
              answer each other, not you.
            </p>

            <div style={{ marginTop: 20 }} data-reveal>
              <Suspense fallback={null}>
                <PersonaRing />
              </Suspense>
            </div>

            <div
              className="panel panel-flush"
              style={{ marginTop: 56, padding: '30px clamp(22px, 4vw, 38px) 34px' }}
              data-reveal
            >
              <div
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline',
                  justifyContent: 'space-between', paddingBottom: 26,
                  borderBottom: '1px solid var(--s-line)',
                }}
              >
                <span className="mono">Transcript — Calculus / Chain Rule</span>
                <span className="chip"><span className="dot dot-amber" />Verdict: engaged</span>
              </div>

              <div className="turns" style={{ marginTop: 28 }}>
                {TURNS.map(([who, text], i) => (
                  <div className="turn" key={who} data-reveal style={{ ['--d' as string]: `${i * 110}ms` }}>
                    <div className="turn-who"><i />{who}</div>
                    <div className="turn-text">
                      {text}
                      {i === TURNS.length - 1 && <span className="caret" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="duo" style={{ marginTop: 22, maxWidth: '62ch' }} data-reveal>
              <b>A debate moves the node to amber, never to green.</b> Watching four experts agree is
              still not evidence that you can do it.
            </p>
          </div>
        </section>

        {/* ---- 03 autopsy -------------------------------------------------- */}
        <section className="band" id="autopsy">
          <div className="spine" />
          <div className="wrap">
            <Head n="03" kicker="The Autopsy Board">
              The mistake behind your <span className="mark mark-red">mistakes</span>.
            </Head>

            <p className="t-body" style={{ marginTop: 26 }} data-reveal>
              Paste the wrong answers from a past paper. Zynth reads across all of them at once,
              names the single misconception underneath, and then rewires your graph — drawing edges
              between the concepts that keep failing together.
            </p>

            <div
              className="panel panel-flush"
              style={{ marginTop: 56, padding: 'clamp(24px, 4vw, 40px)' }}
              data-reveal
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span className="mono">Finding 01 — confidence 0.95</span>
                <span className="mono">07 mistakes · 03 concepts</span>
              </div>

              <div style={{ marginTop: 26 }}>
                <Convergence />
              </div>

              <p className="t-sub" style={{ marginTop: 30, color: 'var(--amber)' }} data-reveal>
                “You drop the negative when the inner function is decreasing.”
              </p>
              <p className="t-body" style={{ marginTop: 14 }} data-reveal>
                Seven separate wrong answers across three topics, one cause. Not carelessness — a
                rule you learned with the sign attached to the wrong term.
              </p>

              <div style={{ marginTop: 26, display: 'flex', flexWrap: 'wrap', gap: 10 }} data-reveal>
                {['Chain Rule', 'Implicit Differentiation', 'Related Rates'].map((n) => (
                  <span className="chip" key={n}>{n}</span>
                ))}
                <span className="chip" style={{ color: 'var(--amber)' }}>+ edge drawn</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- 04 modules -------------------------------------------------- */}
        <section className="band" id="modules">
          <div className="spine" />
          <div className="wrap">
            <Head n="04" kicker="One graph, many rooms">Every part writes to the same map.</Head>

            <div className="bento" style={{ marginTop: 56 }}>
              {MODULES.map((m) => (
                <Card
                  key={m.title}
                  title={m.title}
                  body={m.body}
                  glow={m.glow}
                  span={m.span}
                  icon={<Glyph d={m.d} />}
                />
              ))}
            </div>
          </div>
        </section>

        {/* ---- 05 faq ------------------------------------------------------ */}
        <section className="band" id="faq">
          <div className="spine" />
          <div className="wrap">
            <Head n="05" kicker="Questions">Reasonable doubts.</Head>

            <div style={{ marginTop: 48 }}>
              {FAQS.map(([q, a], i) => (
                <div className="faq-item" key={q} data-open={open === i} data-reveal>
                  <button
                    className="faq-q focus-ring"
                    onClick={() => setOpen(open === i ? null : i)}
                    aria-expanded={open === i}
                  >
                    {q}
                    <span className="faq-sign" aria-hidden="true" />
                  </button>
                  <div className="faq-a">
                    <div><p>{a}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---- outro — the hero's graph returns ---------------------------- */}
        <section className="outro">
          <Suspense fallback={null}>
            <Constellation className="outro-canvas" interactive={false} />
          </Suspense>
          <div className="wrap">
            <h2 className="t-sect" data-reveal>Stop guessing what you know.</h2>
            <p className="t-lede" style={{ margin: '22px auto 0' }} data-reveal>
              A Student Learning OS built on one living knowledge graph. Gemini for the agents, Groq
              for grading.
            </p>
            <div
              style={{ marginTop: 36, display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}
              data-reveal
            >
              <button className="cta focus-ring" onClick={onEnter} style={{ padding: '16px 30px' }}>
                Go to Zynth
              </button>
              <button className="cta-ghost focus-ring" onClick={onStartTour} style={{ padding: '16px 24px' }}>
                Take the tour
              </button>
            </div>
            <p className="mono" style={{ marginTop: 20 }} data-reveal>No account · nothing installed</p>
          </div>
        </section>

        {/* ---- footer ------------------------------------------------------ */}
        <footer className="foot">
          <div className="wrap">
            <div className="foot-grid">
              <div className="foot-col">
                <div className="wordmark" style={{ cursor: 'default' }}>
                  <span className="dot dot-green" />
                  Zynth
                </div>
                <p className="duo" style={{ marginTop: 14, maxWidth: '34ch' }}>
                  Most study apps show you content. Zynth shows you the truth about what you actually
                  know.
                </p>
              </div>

              <div className="foot-col">
                <h4>Product</h4>
                <ul>
                  <li><a href="#rule">The rule</a></li>
                  <li><a href="#warroom">War Room</a></li>
                  <li><a href="#autopsy">Autopsy Board</a></li>
                  <li><a href="#modules">Modules</a></li>
                </ul>
              </div>

              <div className="foot-col">
                <h4>Start</h4>
                <ul>
                  <li><button onClick={onEnter}>Go to Zynth</button></li>
                  <li><button onClick={onStartTour}>Take the tour</button></li>
                  <li><a href="#faq">FAQ</a></li>
                </ul>
              </div>

              <div className="foot-col">
                <h4>Built with</h4>
                <ul>
                  <li><span className="duo">Gemini — agents</span></li>
                  <li><span className="duo">Groq — grading</span></li>
                  <li>
                    <a href={GITHUB} target="_blank" rel="noreferrer noopener" className="link-q">
                      GitHub ↗
                    </a>
                  </li>
                </ul>
              </div>
            </div>

            <div
              style={{
                marginTop: 52, paddingTop: 24, borderTop: '1px solid var(--s-line)',
                display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between',
              }}
            >
              <span className="mono">Built solo by Adam Ahmed · 13</span>
              <span className="mono">Colour is evidence</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
