import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont as loadGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadMono } from '@remotion/google-fonts/IBMPlexMono';
import { COLORS, HAS_MUSIC, VIDEO } from './theme';
import { Constellation } from './Constellation';

/**
 * The Zynth end card.
 *
 * Everything here is lifted from the product: the nebula washes and film grain
 * from client/src/index.css body styling, the cyan→violet wordmark gradient from
 * .text-wordmark, the node/halo geometry from graph/NodeMesh.tsx, and the
 * entrance language (travel and settle, never bounce) from the app's motion
 * tokens. The card should look like the last frame of the product rather than a
 * title slide someone made afterwards.
 */

// loadFont() must actually be CALLED — importing `fontFamily` on its own returns
// the family name without ever registering the @font-face, so every frame
// silently rendered in the serif fallback. It also hooks Remotion's
// delayRender, so the renderer waits for the font instead of racing it.
const { fontFamily: grotesk } = loadGrotesk();
const { fontFamily: mono } = loadMono();

/** Film grain, identical to body::before in index.css. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  /** Entrances use a critically-damped spring — settles, never overshoots. */
  const enter = (delay: number) =>
    spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.6 } });

  // The whole card fades in, holds, and fades out. The tail matters: cutting to
  // black hard at the end of a submission video looks like the file truncated.
  const cardOpacity = interpolate(
    frame,
    [0, 14, durationInFrames - 22, durationInFrames - 2],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const wordmark = enter(10);
  const tagline = enter(26);
  const rule = enter(44);
  const links = enter(60);

  /** opacity + 24px travel + 6px unblur — the app's one entrance recipe. */
  const rise = (t: number) => ({
    opacity: t,
    transform: `translateY(${(1 - t) * 24}px)`,
    filter: `blur(${(1 - t) * 6}px)`,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgVoid }}>
      {HAS_MUSIC && (
        // Fades out over the final second so the track never gets cut off
        // mid-note when the card ends.
        <Audio
          src={staticFile('music.mp3')}
          volume={(f) =>
            interpolate(f, [0, 20, durationInFrames - 30, durationInFrames], [0, 0.22, 0.22, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
          }
        />
      )}

      {/* Nebula washes — the app's body background, same three radials. */}
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 18% 12%, ${COLORS.nebulaIndigo}, transparent 60%),
            radial-gradient(ellipse 70% 55% at 88% 82%, ${COLORS.nebulaCyan}, transparent 62%),
            radial-gradient(ellipse 90% 70% at 55% 100%, ${COLORS.nebulaMagenta}, transparent 65%),
            radial-gradient(ellipse 100% 100% at 50% 50%, ${COLORS.bgDeep} 0%, ${COLORS.bgVoid} 70%, #010104 100%)
          `,
        }}
      />

      {/* Grain, to break up gradient banding exactly as the app does. */}
      <AbsoluteFill
        style={{ backgroundImage: GRAIN, opacity: 0.035, mixBlendMode: 'overlay' }}
      />

      {/* Vignette — frames the composition, same recipe as #root::after. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse 70% 70% at 50% 50%, transparent 55%, rgba(2,2,6,0.5) 100%)',
        }}
      />

      <AbsoluteFill
        style={{
          opacity: cardOpacity,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 110,
        }}
      >
        <Constellation opacity={enter(4)} />

        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 900 }}>
          <div
            style={{
              ...rise(wordmark),
              fontFamily: grotesk,
              fontSize: 148,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1,
              backgroundImage: `linear-gradient(92deg, ${COLORS.accentCyan}, ${COLORS.accentViolet})`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              // The app's wordmark carries this glow; without it the gradient
              // reads flat against the near-black background.
              filter: `drop-shadow(0 0 42px rgba(155,123,255,0.35)) blur(${(1 - wordmark) * 6}px)`,
            }}
          >
            Zynth
          </div>

          <div
            style={{
              ...rise(tagline),
              marginTop: 22,
              fontFamily: grotesk,
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.28,
              letterSpacing: '-0.01em',
              color: COLORS.textPrimary,
            }}
          >
            The truth about what you actually know.
          </div>

          {/* The rule itself, in the product's own colours. */}
          <div
            style={{
              ...rise(rule),
              marginTop: 34,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              fontFamily: mono,
              fontSize: 23,
              letterSpacing: '0.06em',
            }}
          >
            <Swatch color={COLORS.red} label="UNTOUCHED" />
            <Arrow />
            <Swatch color={COLORS.amber} label="ENGAGED" />
            <Arrow />
            <Swatch color={COLORS.green} label="PROVEN" />
          </div>

          <div
            style={{
              ...rise(links),
              marginTop: 48,
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              fontFamily: mono,
              fontSize: 25,
              letterSpacing: '0.04em',
              color: COLORS.textSecondary,
            }}
          >
            <span style={{ color: COLORS.accentCyan }}>zynth-delta.vercel.app</span>
            <span style={{ color: COLORS.textMuted }}>·</span>
            <span>github.com/AdamACE9/zynth</span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span
      style={{
        width: 15,
        height: 15,
        borderRadius: 999,
        backgroundColor: color,
        boxShadow: `0 0 16px ${color}, 0 0 3px ${color}`,
      }}
    />
    <span style={{ color: COLORS.textSecondary }}>{label}</span>
  </span>
);

const Arrow: React.FC = () => (
  <span style={{ color: COLORS.textMuted, fontSize: 21 }}>→</span>
);

export const END_CARD_DURATION = VIDEO.durationInFrames;
