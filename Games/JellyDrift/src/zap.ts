// zap.ts — the jellyfish's electric sting. Each pulse emits a burst of jagged
// lightning bolts radiating from the bell plus an expanding shock ring. Bolts
// crackle (re-jitter a few times over their short life) and glow additively.
//
// Attack-shaped for the future: a live zap exposes its center + reach so an
// enemy system can test whether it was caught in the discharge. `damage` and
// `ATTACK_REACH` are the knobs for that.

import { ctx, world } from "./core.js";

const ATTACK_REACH = 120; // px — how far the sting reaches
const LIFE = 0.24; // seconds a zap stays on screen
const BOLTS = 8; // lightning arcs per zap
export const ZAP_DAMAGE = 18; // per discharge (for enemies, later)

interface Bolt {
  angle: number;
  reach: number;
  seed: number;
}

interface Zap {
  x: number; // world-space origin
  y: number;
  hue: number;
  age: number;
  bolts: Bolt[];
}

/** Cheap deterministic hash → [0,1). */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export const zapSystem = {
  zaps: [] as Zap[],

  /** Fire a discharge centered on (x, y) in world space. */
  emit(x: number, y: number, hue: number): void {
    const bolts: Bolt[] = [];
    for (let i = 0; i < BOLTS; i++) {
      bolts.push({
        angle: (i / BOLTS) * Math.PI * 2 + hash(i + x) * 0.5,
        reach: ATTACK_REACH * (0.6 + hash(i * 3.7 + y) * 0.4),
        seed: hash(i * 7.1 + x * 0.3) * 1000,
      });
    }
    this.zaps.push({ x, y, hue: hue + 10, age: 0, bolts });
  },

  update(dt: number): void {
    for (const z of this.zaps) z.age += dt;
    this.zaps = this.zaps.filter((z) => z.age < LIFE);
  },

  draw(time: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Re-jitter a handful of times over the life so bolts crackle.
    const flicker = Math.floor(time * 40);

    for (const z of this.zaps) {
      const sx = z.x - world.camX;
      const sy = z.y;
      const fade = 1 - z.age / LIFE;

      // Expanding shock ring.
      const ringR = 14 + (z.age / LIFE) * ATTACK_REACH * 0.9;
      ctx.strokeStyle = `hsla(${z.hue}, 100%, 78%, ${fade * 0.35})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // Central flash.
      const flash = ctx.createRadialGradient(sx, sy, 0, sx, sy, 26);
      flash.addColorStop(0, `rgba(235, 250, 255, ${fade * 0.7})`);
      flash.addColorStop(1, "rgba(235, 250, 255, 0)");
      ctx.fillStyle = flash;
      ctx.fillRect(sx - 26, sy - 26, 52, 52);

      // Lightning bolts.
      for (const b of z.bolts) {
        drawBolt(sx, sy, b, z.hue, fade, flicker);
      }
    }

    ctx.restore();
  },
};

/** One jagged bolt: a soft colored glow pass under a bright white core. */
function drawBolt(ox: number, oy: number, b: Bolt, hue: number, fade: number, flicker: number): void {
  const segments = 6;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const along = t * b.reach;
    // Perpendicular jitter, largest mid-bolt, zero at the ends.
    const taper = Math.sin(t * Math.PI);
    const j = (hash(b.seed + i * 5.3 + flicker) - 0.5) * 26 * taper;
    const px = ox + Math.cos(b.angle) * along + Math.cos(b.angle + Math.PI / 2) * j;
    const py = oy + Math.sin(b.angle) * along + Math.sin(b.angle + Math.PI / 2) * j;
    pts.push([px, py]);
  }

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
    ctx.stroke();
  };

  // Glow.
  ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${fade * 0.4})`;
  ctx.lineWidth = 5;
  trace();

  // Bright core.
  ctx.strokeStyle = `rgba(232, 250, 255, ${fade})`;
  ctx.lineWidth = 1.6;
  trace();

  // Occasional fork off the middle.
  if (hash(b.seed + flicker * 1.7) > 0.6) {
    const mid = pts[3]!;
    const fa = b.angle + (hash(b.seed + 2.2) - 0.5) * 1.6;
    const flen = b.reach * 0.3;
    ctx.strokeStyle = `rgba(232, 250, 255, ${fade * 0.8})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(mid[0], mid[1]);
    ctx.lineTo(mid[0] + Math.cos(fa) * flen, mid[1] + Math.sin(fa) * flen);
    ctx.stroke();
  }
}
