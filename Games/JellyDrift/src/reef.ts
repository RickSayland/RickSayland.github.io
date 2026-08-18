// reef.ts — a multi-layer parallax coral reef backdrop. Each layer scrolls at a
// fraction of the camera speed (far layers slower) to fake depth. Corals and
// kelp are generated once from a seeded PRNG so the reef is stable across frames
// and reloads, then drawn bottom-anchored to the seabed each frame.

import { ctx, view, world } from "./core.js";

/** Deterministic PRNG (mulberry32) so the reef looks the same every load. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type CoralKind = "branch" | "fan" | "tube";

interface Coral {
  x: number; // world-space x within the layer
  kind: CoralKind;
  h: number; // height in px
  w: number; // half-width in px
  hue: number;
  sat: number;
  light: number;
  seed: number; // per-coral randomness for branch drawing
}

interface Kelp {
  x: number;
  h: number;
  phase: number; // sway offset so strands don't move in lockstep
}

interface Layer {
  parallax: number; // 0 = static, 1 = moves with camera
  alpha: number;
  baseDrop: number; // px the seabed sits below the viewport bottom
  corals: Coral[];
  kelp: Kelp[];
}

/** Palette + density per depth band, ordered far → near. */
const LAYER_SPECS = [
  {
    parallax: 0.12,
    alpha: 0.45,
    baseDrop: 4,
    spacing: 150,
    hueRange: [200, 225] as const,
    sat: 32,
    light: 26,
    hMin: 120,
    hMax: 240,
    kelpEvery: 0,
  },
  {
    parallax: 0.5,
    alpha: 0.7,
    baseDrop: 10,
    spacing: 130,
    hueRange: [170, 300] as const,
    sat: 45,
    light: 34,
    hMin: 90,
    hMax: 180,
    kelpEvery: 3,
  },
  {
    parallax: 1.0,
    alpha: 0.92,
    baseDrop: 26,
    spacing: 190,
    hueRange: [198, 212] as const,
    sat: 48,
    light: 15,
    hMin: 140,
    hMax: 250,
    kelpEvery: 2,
  },
];

const KINDS: CoralKind[] = ["branch", "fan", "tube"];

export const reefSystem = {
  layers: [] as Layer[],

  /** Generate every layer's corals + kelp across the whole world width. */
  init(): void {
    this.layers = LAYER_SPECS.map((spec, li) => {
      const rand = mulberry32(1337 + li * 977);
      const corals: Coral[] = [];
      const kelp: Kelp[] = [];

      for (let x = 0, i = 0; x < world.width; i++) {
        const jitter = (rand() - 0.5) * spec.spacing * 0.6;
        corals.push({
          x: x + jitter,
          kind: KINDS[Math.floor(rand() * KINDS.length)]!,
          h: spec.hMin + rand() * (spec.hMax - spec.hMin),
          w: 22 + rand() * 30,
          hue: spec.hueRange[0] + rand() * (spec.hueRange[1] - spec.hueRange[0]),
          sat: spec.sat + rand() * 10,
          light: spec.light + rand() * 8,
          seed: Math.floor(rand() * 1e9),
        });

        if (spec.kelpEvery > 0 && i % spec.kelpEvery === 0) {
          kelp.push({
            x: x + spec.spacing * 0.5,
            h: 120 + rand() * 160,
            phase: rand() * Math.PI * 2,
          });
        }
        x += spec.spacing;
      }

      return {
        parallax: spec.parallax,
        alpha: spec.alpha,
        baseDrop: spec.baseDrop,
        corals,
        kelp,
      };
    });
  },

  /** Draw all layers, far → near. `time` (seconds) drives kelp sway. */
  draw(time: number): void {
    for (const layer of this.layers) {
      const offset = world.camX * layer.parallax;
      const baseY = view.height + layer.baseDrop;
      ctx.globalAlpha = layer.alpha;

      // Kelp sits behind the corals of its layer.
      for (const k of layer.kelp) {
        const sx = k.x - offset;
        if (sx < -40 || sx > view.width + 40) continue;
        drawKelp(sx, baseY, k.h, time + k.phase);
      }

      for (const c of layer.corals) {
        const sx = c.x - offset;
        if (sx < -80 || sx > view.width + 80) continue;
        drawCoral(sx, baseY, c);
      }
    }
    ctx.globalAlpha = 1;
  },
};

function drawCoral(x: number, baseY: number, c: Coral): void {
  const fill = `hsl(${c.hue}, ${c.sat}%, ${c.light}%)`;
  if (c.kind === "branch") drawBranchCoral(x, baseY, c, fill);
  else if (c.kind === "fan") drawFanCoral(x, baseY, c, fill);
  else drawTubeCoral(x, baseY, c, fill);
}

/** Recursive branching coral drawn as tapering strokes. */
function drawBranchCoral(x: number, baseY: number, c: Coral, fill: string): void {
  const rand = mulberry32(c.seed);
  ctx.strokeStyle = fill;
  ctx.lineCap = "round";

  const branch = (bx: number, by: number, angle: number, len: number, width: number): void => {
    if (len < 8 || width < 1) return;
    const ex = bx + Math.cos(angle) * len;
    const ey = by + Math.sin(angle) * len;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const spread = 0.5 + rand() * 0.4;
    branch(ex, ey, angle - spread, len * 0.72, width * 0.68);
    branch(ex, ey, angle + spread, len * 0.72, width * 0.68);
    if (rand() > 0.5) branch(ex, ey, angle + (rand() - 0.5) * 0.3, len * 0.8, width * 0.7);
  };

  branch(x, baseY, -Math.PI / 2, c.h * 0.45, Math.max(3, c.w * 0.28));
}

/** Sea fan — a filled half-disc with radial ribs. */
function drawFanCoral(x: number, baseY: number, c: Coral, fill: string): void {
  const r = c.h * 0.5;
  ctx.save();
  ctx.translate(x, baseY);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, -r * 0.7, r, Math.PI * 0.9, Math.PI * 2.1);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = `hsl(${c.hue}, ${c.sat}%, ${Math.min(70, c.light + 14)}%)`;
  ctx.lineWidth = 1.5;
  for (let a = Math.PI * 0.95; a <= Math.PI * 2.05; a += 0.28) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.95, -r * 0.7 + Math.sin(a) * r * 0.95);
    ctx.stroke();
  }
  ctx.restore();
}

/** A cluster of rounded vertical tubes of varying height. */
function drawTubeCoral(x: number, baseY: number, c: Coral, fill: string): void {
  const rand = mulberry32(c.seed);
  const tubes = 3 + Math.floor(rand() * 3);
  ctx.fillStyle = fill;
  for (let i = 0; i < tubes; i++) {
    const tx = x + (i - (tubes - 1) / 2) * (c.w / tubes) * 1.6;
    const th = c.h * (0.55 + rand() * 0.45);
    const tw = 6 + rand() * 6;
    ctx.beginPath();
    ctx.moveTo(tx - tw, baseY);
    ctx.lineTo(tx - tw, baseY - th + tw);
    ctx.arc(tx, baseY - th + tw, tw, Math.PI, 0);
    ctx.lineTo(tx + tw, baseY);
    ctx.closePath();
    ctx.fill();
  }
}

/** A swaying kelp strand: a wavy vertical ribbon. */
function drawKelp(x: number, baseY: number, h: number, t: number): void {
  ctx.strokeStyle = "hsl(140, 40%, 22%)";
  ctx.lineCap = "round";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  const segments = 6;
  for (let i = 1; i <= segments; i++) {
    const f = i / segments;
    const y = baseY - h * f;
    const sway = Math.sin(t * 1.4 + f * 3) * 14 * f;
    ctx.lineTo(x + sway, y);
  }
  ctx.stroke();
}
