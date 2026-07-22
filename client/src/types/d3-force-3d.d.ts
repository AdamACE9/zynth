/**
 * d3-force-3d ships no type definitions. This ambient declaration makes every
 * named import (forceSimulation, forceManyBody, forceLink, forceX/Y/Z, ...)
 * resolve to `any`, which is sufficient for our layout use in
 * graph/useGraphLayout.ts. Do not add detailed types here — the goal is just
 * to unblock `tsc`, not to type the library.
 */
declare module 'd3-force-3d';
