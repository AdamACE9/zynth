# Zynth end card (Remotion)

An 8-second 1920×1080 end card for the demo video. Rendered output lands in `out/`.

```bash
cd video
npm install          # once
npm run studio       # live editor at localhost:3000
npm run render       # -> out/endcard.mp4
npm run still        # -> out/endcard.png (single frame)
```

This project sits **outside** the root `package.json` workspaces on purpose — Remotion pulls
in a headless Chromium and an ffmpeg build, and none of that should ever be near the app's
install or deploy.

## What's on screen

A constellation on the left with one hero node cycling **red → amber → green** across the
card, its edges picking up the colour as it goes. On the right: the wordmark in the app's
cyan→violet gradient, the tagline, the rule itself as three labelled swatches, and the two
URLs.

The colour cycle is the point. It's the product's whole thesis playing once, silently, on
the last frame a judge sees — engagement earns amber, proof earns green, and there's no way
to skip the middle.

Everything is lifted from the real product so the card looks like the last frame of the app
rather than a title slide made afterwards: nebula washes and film grain from
`client/src/index.css`, the wordmark gradient from `.text-wordmark`, node core + 2.7× halo
geometry from `graph/NodeMesh.tsx`, and entrance motion (travel 24px, unblur 6px, settle,
never bounce) from the app's motion tokens.

## Adding background music

**The card currently renders silent.** I can't generate audio, so this part is on you.

1. Get a track. It must be **licensed for use** — hackathon submissions get published, and
   a copyright claim on your demo video is a genuinely bad day. Free options with clear
   terms: [Pixabay Music](https://pixabay.com/music/), [Uppbeat](https://uppbeat.io/),
   [Free Music Archive](https://freemusicarchive.org/) (check each track's licence),
   or YouTube's Audio Library if you're uploading there.
2. Something ambient and slow. The card is 8 seconds of held text — anything with a beat
   will fight it. Look for "ambient", "cinematic underscore", "minimal".
3. Save it as `video/public/music.mp3`.
4. In `src/theme.ts`, set `HAS_MUSIC = true`.
5. `npm run render`.

The volume envelope is already written: it fades in over ~0.7s, holds at 22%, and fades out
over the last second so the track can't get cut off mid-note. Adjust the `0.22` in
`EndCard.tsx` if it's fighting your voiceover.

`HAS_MUSIC` defaults to `false` because Remotion's `staticFile()` throws at render time if
the file is missing — so a missing track gives you a silent card rather than a failed render.

## Editing it

| Change | Where |
|---|---|
| Colours | `src/theme.ts` — copied verbatim from `client/src/index.css` |
| Length (currently 240 frames @ 30fps) | `VIDEO.durationInFrames` in `src/theme.ts` |
| Text, layout, entrance timing | `src/EndCard.tsx` |
| Node positions, edges, colour-cycle timing | `src/Constellation.tsx` (`heroColor()`) |

If you change the duration, check `heroColor()` in `Constellation.tsx` — its transition
frames are hardcoded, so a much shorter card would cut off before the node reaches green.

## Transparent version

`npm run render-transparent` gives a ProRes 4444 `.mov` with alpha, if you'd rather composite
the card over a final graph shot than cut to it.
