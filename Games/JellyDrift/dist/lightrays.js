// lightrays.ts — god rays: soft shafts of light slanting down from the surface.
// Drawn additively over the ocean gradient (behind the reef) so the water column
// reads as lit from above. Cheap: a handful of gradient-filled parallelograms
// that sway over time and drift very slightly with the camera.
import { ctx, view, world } from "./core.js";
const SLANT = 0.32; // horizontal drift per unit height (~18° from vertical)
export const lightRaySystem = {
    rays: [],
    init() {
        const count = 6;
        this.rays = [];
        for (let i = 0; i < count; i++) {
            this.rays.push({
                baseX: (i / count) * 1000 + Math.random() * 120,
                wTop: 26 + Math.random() * 26,
                wBottom: 70 + Math.random() * 80,
                alpha: 0.05 + Math.random() * 0.05,
                speed: 0.15 + Math.random() * 0.25,
                phase: Math.random() * Math.PI * 2,
            });
        }
    },
    draw(time) {
        const span = view.width + 300;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const ray of this.rays) {
            const sway = Math.sin(time * ray.speed + ray.phase) * 34;
            let xTop = (ray.baseX - world.camX * 0.06 + sway) % span;
            if (xTop < 0)
                xTop += span;
            xTop -= 150;
            const xBottom = xTop + view.height * SLANT;
            const grad = ctx.createLinearGradient(0, 0, 0, view.height);
            grad.addColorStop(0, `rgba(150, 220, 255, ${ray.alpha})`);
            grad.addColorStop(0.7, `rgba(150, 220, 255, ${ray.alpha * 0.3})`);
            grad.addColorStop(1, "rgba(150, 220, 255, 0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(xTop - ray.wTop, 0);
            ctx.lineTo(xTop + ray.wTop, 0);
            ctx.lineTo(xBottom + ray.wBottom, view.height);
            ctx.lineTo(xBottom - ray.wBottom, view.height);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    },
};
//# sourceMappingURL=lightrays.js.map