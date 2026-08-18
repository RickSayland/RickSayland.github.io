// fish.ts — small background fish drifting across the water in loose schools.
// Each fish swims at its own speed and parallaxes with the camera by its depth,
// wrapping around the screen edges. Drawn as a simple body + wagging tail so they
// read as distant silhouettes behind the jellyfish.

import { ctx, view, world } from "./core.js";

interface Fish {
  x: number; // world x; wrapped at draw time
  y: number; // screen y band
  size: number;
  vx: number; // px/s, sign = swim direction
  depth: number; // parallax factor + fades/shrinks distant fish
  wigglePhase: number;
  hue: number;
}

const COUNT = 16;

function wrap(v: number, span: number): number {
  const r = v % span;
  return r < 0 ? r + span : r;
}

export const fishSystem = {
  fish: [] as Fish[],

  init(): void {
    this.fish = [];
    // A few loose schools: pick a band + direction, cluster several fish in it.
    let placed = 0;
    while (placed < COUNT) {
      const schoolSize = 2 + Math.floor(Math.random() * 4);
      const bandY = 80 + Math.random() * ((view.height || 800) * 0.55);
      const depth = 0.35 + Math.random() * 0.5;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const baseSpeed = (16 + Math.random() * 26) * dir;
      const hue = 185 + Math.random() * 40;

      for (let i = 0; i < schoolSize && placed < COUNT; i++, placed++) {
        this.fish.push({
          x: Math.random() * (view.width || 1000),
          y: bandY + (Math.random() - 0.5) * 40,
          size: 4 + depth * 6 + Math.random() * 3,
          vx: baseSpeed * (0.85 + Math.random() * 0.3),
          depth,
          wigglePhase: Math.random() * Math.PI * 2,
          hue,
        });
      }
    }
  },

  update(dt: number): void {
    for (const f of this.fish) {
      f.x += f.vx * dt;
    }
  },

  draw(time: number): void {
    const margin = 30;
    const span = view.width + margin * 2;
    for (const f of this.fish) {
      const sx = wrap(f.x - world.camX * f.depth + margin, span) - margin;
      const dir = f.vx >= 0 ? 1 : -1;
      const wig = Math.sin(time * 6 + f.wigglePhase);
      const alpha = 0.25 + f.depth * 0.4;

      ctx.save();
      ctx.translate(sx, f.y);
      ctx.scale(dir, 1);
      ctx.fillStyle = `hsla(${f.hue}, 40%, 52%, ${alpha})`;

      // Body.
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size, f.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tail — wags with the swim cycle.
      const t = wig * 0.35;
      ctx.beginPath();
      ctx.moveTo(-f.size * 0.85, 0);
      ctx.lineTo(-f.size * 1.5, -f.size * 0.5 + t * f.size);
      ctx.lineTo(-f.size * 1.5, f.size * 0.5 + t * f.size);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  },
};
