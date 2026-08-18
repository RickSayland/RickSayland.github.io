// pineapple.ts — a generic pineapple dwelling resting on the seabed: a playful
// "pineapple under the sea" landmark. Placed at a fixed world position and drawn
// at the near reef's parallax so it sits among the foreground coral. Purely
// decorative — a crosshatched golden pineapple with leafy top, a round door, and
// two porthole windows.
import { ctx, view, world } from "./core.js";
const WORLD_X = 1500; // where it sits in the world
const PARALLAX = 1.0; // matches the near reef layer
const W = 120;
const H = 185;
export const pineappleSystem = {
    draw(time) {
        const sx = WORLD_X - world.camX * PARALLAX;
        if (sx < -160 || sx > view.width + 160)
            return;
        const baseY = view.height + 26; // sink slightly into the seabed
        const cy = baseY - H * 0.45; // body center
        const ry = H * 0.55;
        const rx = W / 2;
        // --- Body fill ---
        const grad = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
        grad.addColorStop(0, "#c8891f");
        grad.addColorStop(0.5, "#f2b53c");
        grad.addColorStop(1, "#b9781a");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(sx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // --- Crosshatch texture (clipped to the body) ---
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(sx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.strokeStyle = "rgba(120, 74, 12, 0.5)";
        ctx.lineWidth = 2;
        const step = 20;
        for (let d = -H; d < H; d += step) {
            ctx.beginPath();
            ctx.moveTo(sx - rx, cy + d);
            ctx.lineTo(sx + rx, cy + d - ry);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(sx - rx, cy + d);
            ctx.lineTo(sx + rx, cy + d + ry);
            ctx.stroke();
        }
        // Soft top highlight for roundness.
        const hi = ctx.createRadialGradient(sx - rx * 0.3, cy - ry * 0.4, 4, sx, cy, rx * 1.4);
        hi.addColorStop(0, "rgba(255, 240, 200, 0.35)");
        hi.addColorStop(1, "rgba(255, 240, 200, 0)");
        ctx.fillStyle = hi;
        ctx.fillRect(sx - rx, cy - ry, rx * 2, ry * 2);
        ctx.restore();
        // --- Leafy crown ---
        const topY = cy - ry;
        const leaves = 7;
        for (let i = 0; i < leaves; i++) {
            const t = i / (leaves - 1) - 0.5; // -0.5 .. 0.5
            const sway = Math.sin(time * 1.2 + i) * 4;
            const tipX = sx + t * W * 0.7 + sway;
            const tipY = topY - 44 - (1 - Math.abs(t)) * 26; // center leaves taller
            const lg = ctx.createLinearGradient(sx, topY, tipX, tipY);
            lg.addColorStop(0, "#2f7d3a");
            lg.addColorStop(1, "#57b25a");
            ctx.fillStyle = lg;
            ctx.beginPath();
            ctx.moveTo(sx - 10, topY + 4);
            ctx.quadraticCurveTo(sx + t * 24, tipY + 12, tipX, tipY);
            ctx.quadraticCurveTo(sx + t * 24 + 6, tipY + 14, sx + 10, topY + 4);
            ctx.closePath();
            ctx.fill();
        }
        // --- Door ---
        const doorY = baseY - 4;
        const doorW = 26;
        const doorH = 44;
        ctx.fillStyle = "#6b3d12";
        ctx.beginPath();
        ctx.moveTo(sx - doorW / 2, doorY);
        ctx.lineTo(sx - doorW / 2, doorY - doorH + doorW / 2);
        ctx.arc(sx, doorY - doorH + doorW / 2, doorW / 2, Math.PI, 0);
        ctx.lineTo(sx + doorW / 2, doorY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#f2d79a";
        ctx.beginPath();
        ctx.arc(sx + doorW * 0.28, doorY - doorH * 0.4, 2.4, 0, Math.PI * 2); // knob
        ctx.fill();
        // --- Porthole windows ---
        for (const wx of [sx - W * 0.26, sx + W * 0.26]) {
            const wy = cy - ry * 0.15;
            ctx.fillStyle = "#7fd6e6";
            ctx.beginPath();
            ctx.arc(wx, wy, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#6b3d12";
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(wx - 11, wy);
            ctx.lineTo(wx + 11, wy);
            ctx.moveTo(wx, wy - 11);
            ctx.lineTo(wx, wy + 11);
            ctx.stroke();
        }
    },
};
//# sourceMappingURL=pineapple.js.map