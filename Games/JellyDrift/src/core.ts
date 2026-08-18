// core.ts — dependency-free base of the module graph.
// Owns the canvas, drawing context, viewport metrics, and shared world state
// that every other system imports. Keep this file free of imports from other
// game systems so it stays the root of the graph.

export const GAME_VERSION = "0.2.0";

export const canvas = document.getElementById("game") as HTMLCanvasElement;
export const ctx = canvas.getContext("2d")!;

/** Live CSS-pixel size of the viewport plus the device-pixel-ratio in use. */
export const view = { width: 0, height: 0, dpr: 1 };

/**
 * Resize the backing store to match the window at the current DPR, then scale
 * the context so all drawing can happen in CSS pixels. Also syncs `world.height`
 * since the playable column is exactly one screen tall.
 */
export function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  view.width = w;
  view.height = h;
  view.dpr = dpr;
  world.height = h;
}

/**
 * The sidescroller world. It extends far to the right; the camera (`camX`)
 * follows the jellyfish. Height tracks the viewport so the jelly can reach the
 * seabed and the surface on any screen.
 */
export const world = {
  width: 6000,
  height: 0,
  camX: 0,
};
