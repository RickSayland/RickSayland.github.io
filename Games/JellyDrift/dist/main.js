// main.ts — entry/orchestrator. Boots the canvas, wires input, and runs the
// requestAnimationFrame loop: update → clear → background → entities → HUD.
import { ctx, view, world, resizeCanvas, GAME_VERSION } from "./core.js";
import { initInput } from "./input.js";
import { jelly } from "./jellyfish.js";
import { reefSystem } from "./reef.js";
import { lightRaySystem } from "./lightrays.js";
import { fishSystem } from "./fish.js";
import { bubbleSystem } from "./bubbles.js";
import { pineappleSystem } from "./pineapple.js";
import { zapSystem } from "./zap.js";
import { enemySystem } from "./enemy.js";
let last = 0;
/** Player health bar, top-left. */
function drawHUD() {
    const x = 14;
    const y = 14;
    const w = 190;
    const h = 16;
    const frac = Math.max(0, jelly.hp / jelly.maxHp);
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = `hsl(${frac * 120}, 75%, 48%)`;
    ctx.fillRect(x, y, w * frac, h);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "11px monospace";
    ctx.fillText(`HP ${Math.max(0, Math.ceil(jelly.hp))}/${jelly.maxHp}`, x + 6, y + 12);
}
/** Vertical ocean gradient — the deepest background layer. */
function drawOcean() {
    const g = ctx.createLinearGradient(0, 0, 0, view.height);
    g.addColorStop(0, "#0a3a5c");
    g.addColorStop(1, "#04121f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.width, view.height);
}
/** A slow parallax field of drifting light motes, drawn over the reef. */
function drawMotes() {
    ctx.fillStyle = "rgba(140, 210, 255, 0.07)";
    const spacing = 150;
    const parallax = world.camX * 0.3;
    for (let x = -(parallax % spacing); x < view.width + spacing; x += spacing) {
        for (let y = 50; y < view.height; y += spacing) {
            const wobble = Math.sin((x + world.camX) * 0.01 + y) * 10;
            ctx.beginPath();
            ctx.arc(x, y + wobble, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000) || 0;
    last = now;
    const time = now / 1000;
    jelly.update(dt);
    fishSystem.update(dt);
    bubbleSystem.update(dt);
    zapSystem.update(dt);
    enemySystem.update(dt);
    ctx.clearRect(0, 0, view.width, view.height);
    drawOcean();
    lightRaySystem.draw(time);
    reefSystem.draw(time);
    pineappleSystem.draw(time);
    fishSystem.draw(time);
    bubbleSystem.draw(time);
    drawMotes();
    enemySystem.draw(time);
    jelly.draw();
    zapSystem.draw(time);
    drawHUD();
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.font = "12px monospace";
    ctx.fillText(`JellyDrift v${GAME_VERSION}  —  WASD/arrows to steer, Space to zap`, 12, view.height - 12);
    requestAnimationFrame(frame);
}
function boot() {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    reefSystem.init();
    lightRaySystem.init();
    fishSystem.init();
    bubbleSystem.init();
    enemySystem.init();
    initInput();
    requestAnimationFrame((t) => {
        last = t;
        frame(t);
    });
}
boot();
//# sourceMappingURL=main.js.map