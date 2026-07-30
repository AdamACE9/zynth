/**
 * Generates the end card's backing track as a WAV, sample by sample.
 *
 * Written as a script rather than an ffmpeg filter chain because a pop
 * arrangement needs per-hit control — kick envelopes, a clap's noise decay, an
 * arpeggio that follows the chord — and expressing that as fifty chained
 * `adelay`/`amix` filters is unreadable and unfixable at 1am.
 *
 * The whole point is the GRID. 120 BPM, 4/4, so a beat is 0.5s and a bar is 2s,
 * and a 4-second card is exactly two bars. The composition's own beats sit on
 * that same grid (see index.html), which is what makes "cut to the beat" true
 * rather than approximately true.
 *
 * Two bars, two chords: Am then C. At four seconds there is no room for a
 * four-chord loop, and there does not need to be — the only harmonic event that
 * matters is the turn from minor to major, and it lands on the bar 2 downbeat
 * at 2.0s, which is exactly where the hero node turns green. The track resolves
 * at the same instant the product proves something.
 *
 *   node tools/make-music.mjs   ->  assets/endcard-music.wav
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const SR = 44100;
const BPM = 120;
const BEAT = 60 / BPM;          // 0.5s
const BAR = BEAT * 4;           // 2.0s
const DUR = 4.0;                // two bars
const N = Math.floor(SR * DUR);

const L = new Float64Array(N);
const R = new Float64Array(N);

/** Deterministic noise — no Math.random, so every render is identical. */
let seed = 12345;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 0xffffffff) * 2 - 1;
};

const add = (i, l, r) => {
  if (i < 0 || i >= N) return;
  L[i] += l;
  R[i] += r;
};

/** Equal-temperament note -> Hz. A4 = 440. */
const note = (n) => 440 * Math.pow(2, (n - 69) / 12);
const A2 = 45, C3 = 48, E3 = 52, F2 = 41, A3 = 57, C4 = 60, E4 = 64,
      F3 = 53, G2 = 43, G3 = 55, B3 = 59, D4 = 62, G4 = 67, F4 = 65;

/**
 * Am - F - C - G, one per bar. `bright` rises across the loop and drives the
 * arpeggio's filter opening, so the track visibly opens up into bar 3.
 */
const CHORDS = [
  { root: A2, tones: [A3, C4, E4], bright: 0.55 }, // bar 1 — Am, under red -> amber
  { root: C3, tones: [C4, E4, G4], bright: 1.00 }, // bar 2 — C,  GREEN lands here
];

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

/** Kick: pitch envelope from 110Hz down to 45Hz. That sweep is the "thump". */
function kick(t0, gain = 1) {
  const len = Math.floor(SR * 0.28);
  const i0 = Math.floor(t0 * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const f = 45 + (110 - 45) * Math.exp(-p * 14);
    phase += (2 * Math.PI * f) / SR;
    const env = Math.exp(-p * 5.5) * (1 - Math.exp(-p * 260));
    const s = Math.sin(phase) * env * 0.95 * gain;
    add(i0 + i, s, s);
  }
}

/** Clap: three tight noise bursts, band-limited, slightly stereo-spread. */
function clap(t0, gain = 1) {
  const i0 = Math.floor(t0 * SR);
  const bursts = [0, 0.011, 0.023];
  for (let b = 0; b < bursts.length; b++) {
    const off = Math.floor(bursts[b] * SR);
    const len = Math.floor(SR * (b === 2 ? 0.16 : 0.045));
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const p = i / len;
      const raw = noise();
      lp += (raw - lp) * 0.55;            // simple 1-pole, tames the fizz
      const env = Math.exp(-p * (b === 2 ? 11 : 26));
      const s = (raw - lp) * env * 0.34 * gain;
      add(i0 + off + i, s * 0.88, s);      // a touch wider on the right
    }
  }
}

/** Closed hat: very short high-passed noise. */
function hat(t0, gain = 1) {
  const i0 = Math.floor(t0 * SR);
  const len = Math.floor(SR * 0.045);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const raw = noise();
    lp += (raw - lp) * 0.72;
    const env = Math.exp(-p * 34);
    const s = (raw - lp) * env * 0.16 * gain;
    add(i0 + i, s, s * 0.9);
  }
}

/** Bass: soft-clipped sine, so it reads on laptop speakers as well as headphones. */
function bass(t0, dur, midi, gain = 1) {
  const i0 = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const f = note(midi);
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.min(1, p * 90) * Math.exp(-p * 2.2);
    const ph = (2 * Math.PI * f * i) / SR;
    const s = Math.tanh(Math.sin(ph) * 1.9) * env * 0.30 * gain;
    add(i0 + i, s, s);
  }
}

/** Pluck: two detuned saws through a decaying lowpass — the arpeggio voice. */
function pluck(t0, dur, midi, gain = 1, bright = 1) {
  const i0 = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const f = note(midi);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const saw = (x) => 2 * (x - Math.floor(x + 0.5));
    const a = saw((f * i) / SR);
    const b = saw((f * 1.006 * i) / SR); // detune for width
    const env = Math.min(1, p * 130) * Math.exp(-p * 4.2);
    // Filter closes as the note decays; `bright` opens it per chord.
    const cut = 0.10 + 0.34 * bright * Math.exp(-p * 2.6);
    lp += ((a + b) * 0.5 - lp) * cut;
    const s = lp * env * 0.22 * gain;
    add(i0 + i, s * 0.95, s);
  }
}

/** Pad: stacked sines holding the chord under everything. */
function pad(t0, dur, midis, gain = 1) {
  const i0 = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  for (const m of midis) {
    const f = note(m);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      const env = Math.min(1, p * 12) * Math.min(1, (1 - p) * 12);
      const ph = (2 * Math.PI * f * i) / SR;
      const s = Math.sin(ph) * env * 0.055 * gain;
      add(i0 + i, s, s);
    }
  }
}

// ---------------------------------------------------------------------------
// Arrangement — four bars on the grid
// ---------------------------------------------------------------------------

for (let bar = 0; bar < 2; bar++) {
  const t = bar * BAR;
  const ch = CHORDS[bar];

  // Over two bars there is no room to start sparse — the groove has to be
  // there from the downbeat. The lift into bar 2 comes from the arpeggio and
  // the crash entering, not from the drums arriving late.
  const full = true;
  const arp = bar >= 1;

  pad(t, BAR, ch.tones, bar === 0 ? 0.7 : 1);

  // Four-on-the-floor. Bar 1 gets beats 1 and 3 only.
  for (let b = 0; b < 4; b++) {
    if (!full && b % 2 === 1) continue;
    kick(t + b * BEAT, b === 0 ? 1 : 0.9);
  }

  // Backbeat on 2 and 4.
  if (full) {
    clap(t + BEAT, 1);
    clap(t + 3 * BEAT, 1);
  }

  // Eighth-note hats, accented on the downbeat of each beat.
  for (let e = 0; e < 8; e++) {
    if (!full && e % 2 === 1) continue;
    hat(t + e * (BEAT / 2), e % 2 === 0 ? 1 : 0.62);
  }

  // Bass: root on 1, again on the "and" of 3 — the standard pop push.
  bass(t, BEAT * 1.6, ch.root, full ? 1 : 0.8);
  if (full) bass(t + 2.5 * BEAT, BEAT * 1.2, ch.root, 0.85);

  // Arpeggio: eighth notes climbing the chord. Enters on bar 2 with the major
  // chord, so the resolve arrives with new movement on top of it.
  if (arp) {
    const seq = [0, 1, 2, 1, 0, 1, 2, 1];
    for (let e = 0; e < 8; e++) {
      pluck(t + e * (BEAT / 2), BEAT * 0.55, ch.tones[seq[e]], 1, ch.bright);
    }
  }
}

// A single crash-ish swell into bar 2 — the green moment gets an accent.
(() => {
  const i0 = Math.floor((BAR - 0.18) * SR);
  const len = Math.floor(SR * 0.9);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const raw = noise();
    lp += (raw - lp) * 0.80;
    const env = (p < 0.06 ? p / 0.06 : Math.exp(-(p - 0.06) * 5.5)) * 0.13;
    const s = (raw - lp) * env;
    add(i0 + i, s, s * 0.92);
  }
})();

// ---------------------------------------------------------------------------
// Master: soft-knee limiting, then top and tail
// ---------------------------------------------------------------------------

for (let i = 0; i < N; i++) {
  const t = i / SR;
  // Short fade in, and a fade out over the last 0.8s so the track lands with
  // the card rather than being chopped.
  const fin = Math.min(1, t / 0.12);
  const fout = t > DUR - 0.7 ? Math.max(0, (DUR - t) / 0.7) : 1;
  const g = fin * fout;
  L[i] = Math.tanh(L[i] * 1.15) * g;
  R[i] = Math.tanh(R[i] * 1.15) * g;
}

// Normalise to -1.0 dBFS peak. Loudness is then set by ffmpeg's loudnorm.
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const norm = peak > 0 ? 0.891 / peak : 1;

// ---------------------------------------------------------------------------
// 16-bit stereo WAV
// ---------------------------------------------------------------------------

const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 4, 40);

for (let i = 0; i < N; i++) {
  const l = Math.max(-1, Math.min(1, L[i] * norm));
  const r = Math.max(-1, Math.min(1, R[i] * norm));
  buf.writeInt16LE((l * 32767) | 0, 44 + i * 4);
  buf.writeInt16LE((r * 32767) | 0, 44 + i * 4 + 2);
}

mkdirSync('assets', { recursive: true });
writeFileSync('assets/endcard-music.wav', buf);
console.log(`wrote assets/endcard-music.wav — ${DUR}s, ${BPM} BPM, 2 bars (Am -> C)`);
console.log(`grid: bar downbeats at 0.0s / 2.0s; green lands on bar 2 with the major chord`);
