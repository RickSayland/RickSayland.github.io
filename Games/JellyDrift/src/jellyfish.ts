// jellyfish.ts — the player. Buoyancy-driven "pulse" propulsion, a contracting
// bell animation, and swaying tentacles, all drawn procedurally on the canvas.

import { ctx, view, world } from "./core.js";
import { input } from "./input.js";

const GRAVITY = 26; // px/s^2, gentle downward sink
const STEER = 220; // px/s^2 of directional thrust while holding a direction
const PULSE_IMPULSE = { x: 150, y: -320 }; // burst applied on a pulse
const PULSE_COOLDOWN = 0.65; // seconds between pulses
const DRAG = 0.92; // velocity retention (per 1/60s), water resistance

export const jelly = {
  x: 220,
  y: 300,
  vx: 0,
  vy: 0,
  bellPhase: 0, // drives bell contraction + tentacle sway
  pulseCooldown: 0,
  hue: 190,

  update(dt: number): void {
    // Directional steering (a slow drift the player nudges).
    if (input.left) this.vx -= STEER * dt;
    if (input.right) this.vx += STEER * dt;
    if (input.up) this.vy -= STEER * dt;
    if (input.down) this.vy += STEER * dt;

    // Pulse: a rhythmic burst of propulsion on a cooldown.
    this.pulseCooldown -= dt;
    if (input.pulse && this.pulseCooldown <= 0) {
      this.vx += PULSE_IMPULSE.x;
      this.vy += PULSE_IMPULSE.y;
      this.pulseCooldown = PULSE_COOLDOWN;
      this.bellPhase = Math.PI; // snap to the contracted part of the cycle
    }

    // Integrate with gravity + frame-rate-independent drag.
    this.vy += GRAVITY * dt;
    const dragFactor = Math.pow(DRAG, dt * 60);
    this.vx *= dragFactor;
    this.vy *= dragFactor;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Keep inside the world column.
    this.x = Math.max(40, Math.min(world.width - 40, this.x));
    this.y = Math.max(48, Math.min(world.height - 40, this.y));

    // Bell breathes continuously; a pulse just resets its phase.
    this.bellPhase += dt * 3.2;

    // Camera eases to keep the jelly ~35% from the left edge.
    const targetCam = this.x - view.width * 0.35;
    world.camX += (targetCam - world.camX) * Math.min(1, dt * 3);
    world.camX = Math.max(0, Math.min(world.width - view.width, world.camX));
  },

  draw(): void {
    const sx = this.x - world.camX;
    const sy = this.y;

    // Bell contraction: 0 = relaxed (wide), 1 = contracted (tall/narrow).
    const contract = Math.sin(this.bellPhase) * 0.5 + 0.5;
    const bellW = 52 - contract * 12;
    const bellH = 36 + contract * 14;

    ctx.save();
    ctx.translate(sx, sy);

    // Tentacles — quadratic curves that sway out of phase with the bell.
    ctx.strokeStyle = `hsla(${this.hue}, 70%, 72%, 0.55)`;
    ctx.lineWidth = 2;
    const tentacles = 7;
    for (let i = 0; i < tentacles; i++) {
      const t = i / (tentacles - 1);
      const rootX = (t - 0.5) * bellW * 0.75;
      const sway = Math.sin(this.bellPhase * 1.6 + i * 0.9) * 7;
      ctx.beginPath();
      ctx.moveTo(rootX, bellH * 0.35);
      ctx.quadraticCurveTo(
        rootX + sway,
        bellH * 0.35 + 26,
        rootX + sway * 1.6,
        bellH * 0.35 + 52,
      );
      ctx.stroke();
    }

    // Bell — a translucent dome with a radial glow.
    const glow = ctx.createRadialGradient(0, -bellH * 0.25, 3, 0, 0, bellW);
    glow.addColorStop(0, `hsla(${this.hue}, 85%, 85%, 0.95)`);
    glow.addColorStop(1, `hsla(${this.hue}, 70%, 55%, 0.25)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, bellW / 2, bellH / 2, 0, Math.PI, Math.PI * 2, false);
    // Scalloped underside of the bell.
    ctx.quadraticCurveTo(bellW * 0.28, bellH * 0.28, 0, bellH * 0.16);
    ctx.quadraticCurveTo(-bellW * 0.28, bellH * 0.28, -bellW / 2, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  },
};
