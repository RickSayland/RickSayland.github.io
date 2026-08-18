// bubbles.ts — a pool of rising bubbles at varied depths. Each bubble drifts up,
// wobbles sideways, and respawns at the bottom when it clears the surface. Depth
// drives size, opacity, and how much it parallaxes with the camera.
import { ctx, view, world } from "./core.js";
const COUNT = 70;
function wrap(v, span) {
    const r = v % span;
    return r < 0 ? r + span : r;
}
export const bubbleSystem = {
    bubbles: [],
    init() {
        this.bubbles = [];
        for (let i = 0; i < COUNT; i++) {
            const depth = 0.3 + Math.random() * 0.6;
            this.bubbles.push({
                x: Math.random() * (view.width || 1000),
                y: Math.random() * (view.height || 800),
                r: 1.5 + depth * 4 + Math.random() * 2,
                speed: 18 + depth * 46,
                drift: 6 + Math.random() * 14,
                phase: Math.random() * Math.PI * 2,
                depth,
            });
        }
    },
    update(dt) {
        for (const b of this.bubbles) {
            b.y -= b.speed * dt;
            if (b.y < -10) {
                b.y = view.height + 10;
                b.x = Math.random() * view.width;
            }
        }
    },
    draw(time) {
        const span = view.width + 40;
        for (const b of this.bubbles) {
            const wobble = Math.sin(time * 1.5 + b.phase) * b.drift;
            const sx = wrap(b.x - world.camX * b.depth + wobble + 20, span) - 20;
            const alpha = 0.1 + b.depth * 0.28;
            ctx.strokeStyle = `rgba(200, 235, 255, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(sx, b.y, b.r, 0, Math.PI * 2);
            ctx.stroke();
            // Little specular highlight.
            ctx.fillStyle = `rgba(230, 248, 255, ${alpha * 0.9})`;
            ctx.beginPath();
            ctx.arc(sx - b.r * 0.3, b.y - b.r * 0.3, Math.max(0.6, b.r * 0.28), 0, Math.PI * 2);
            ctx.fill();
        }
    },
};
//# sourceMappingURL=bubbles.js.map