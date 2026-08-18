// enemy.ts — predator fish. They wander the reef, chase the jellyfish when it
// comes within detection range, and deal contact damage on a per-enemy cooldown.
// They take damage from the electric zap (queried from zapSystem each frame) and
// play a brief death animation before respawning offscreen to keep the world
// populated. Drawn in the jelly's plane (no parallax) as procedural silhouettes.
import { ctx, view, world } from "./core.js";
import { jelly } from "./jellyfish.js";
import { zapSystem, ATTACK_REACH, ZAP_DAMAGE } from "./zap.js";
const COUNT = 5;
const MAX_HP = 40;
const DETECT_RADIUS = 280; // starts chasing within this distance
const WANDER_SPEED = 70;
const CHASE_SPEED = 150;
const CONTACT_DAMAGE = 14;
const CONTACT_COOLDOWN = 0.8; // seconds between bites on the player
const DEATH_TIME = 0.5; // death animation length
function spawnEnemy(nearCam) {
    // Place either randomly across the world (initial) or just off the right edge
    // of the current view (respawn), so fresh enemies drift into frame.
    const x = nearCam
        ? world.camX + view.width + 120 + Math.random() * 300
        : 400 + Math.random() * (world.width - 800);
    return {
        x: Math.min(x, world.width - 60),
        y: 80 + Math.random() * Math.max(120, world.height - 200),
        vx: 0,
        vy: 0,
        hp: MAX_HP,
        size: 20 + Math.random() * 8,
        facing: Math.random() < 0.5 ? -1 : 1,
        wobble: Math.random() * Math.PI * 2,
        wanderAngle: Math.random() * Math.PI * 2,
        wanderCd: 1 + Math.random() * 2,
        contactCd: 0,
        lastZapId: 0,
        hurt: 0,
        dead: false,
        deathT: 0,
    };
}
export const enemySystem = {
    enemies: [],
    init() {
        this.enemies = [];
        for (let i = 0; i < COUNT; i++)
            this.enemies.push(spawnEnemy(false));
    },
    update(dt) {
        for (const e of this.enemies) {
            e.hurt = Math.max(0, e.hurt - dt);
            if (e.dead) {
                e.deathT += dt;
                e.vx *= 0.9;
                e.vy *= 0.9;
                e.x += e.vx * dt;
                e.y += e.vy * dt;
                continue;
            }
            // --- AI: chase the jelly if near, otherwise wander ---
            const dx = jelly.x - e.x;
            const dy = jelly.y - e.y;
            const dist = Math.hypot(dx, dy);
            if (dist < DETECT_RADIUS) {
                const inv = 1 / (dist || 1);
                e.vx += dx * inv * CHASE_SPEED * dt * 3;
                e.vy += dy * inv * CHASE_SPEED * dt * 3;
                clampSpeed(e, CHASE_SPEED);
            }
            else {
                e.wanderCd -= dt;
                if (e.wanderCd <= 0) {
                    e.wanderAngle = (Math.random() - 0.5) * 0.9 + (e.vx >= 0 ? 0 : Math.PI);
                    e.wanderCd = 1.5 + Math.random() * 2.5;
                }
                e.vx += Math.cos(e.wanderAngle) * WANDER_SPEED * dt * 2;
                e.vy += Math.sin(e.wanderAngle) * WANDER_SPEED * dt * 2;
                clampSpeed(e, WANDER_SPEED);
            }
            // Gentle vertical bob.
            e.wobble += dt * 2;
            e.y += Math.sin(e.wobble) * 8 * dt;
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            // Bounds: stay in the world column, off the seabed and surface.
            e.x = Math.max(40, Math.min(world.width - 40, e.x));
            e.y = Math.max(60, Math.min(world.height - 40, e.y));
            if (Math.abs(e.vx) > 3)
                e.facing = e.vx >= 0 ? 1 : -1;
            // --- Electric zap damage ---
            for (const z of zapSystem.zaps) {
                if (z.id === e.lastZapId)
                    continue;
                if (Math.hypot(z.x - e.x, z.y - e.y) < ATTACK_REACH + e.size) {
                    e.lastZapId = z.id;
                    e.hp -= ZAP_DAMAGE;
                    e.hurt = 0.18;
                    // Small knockback away from the jelly.
                    const kdx = e.x - z.x;
                    const kdy = e.y - z.y;
                    const kd = Math.hypot(kdx, kdy) || 1;
                    e.vx += (kdx / kd) * 120;
                    e.vy += (kdy / kd) * 120;
                    if (e.hp <= 0) {
                        e.dead = true;
                        e.deathT = 0;
                    }
                }
            }
            // --- Contact damage to the player ---
            e.contactCd = Math.max(0, e.contactCd - dt);
            if (!e.dead && e.contactCd <= 0 && dist < e.size + jelly.radius) {
                jelly.takeDamage(CONTACT_DAMAGE, e.x, e.y);
                e.contactCd = CONTACT_COOLDOWN;
            }
        }
        // Retire finished death animations and refill from offscreen.
        const before = this.enemies.length;
        this.enemies = this.enemies.filter((e) => !(e.dead && e.deathT >= DEATH_TIME));
        for (let i = this.enemies.length; i < before; i++)
            this.enemies.push(spawnEnemy(true));
    },
    draw(time) {
        for (const e of this.enemies) {
            const sx = e.x - world.camX;
            const sy = e.y;
            if (sx < -80 || sx > view.width + 80)
                continue;
            drawEnemy(sx, sy, e, time);
        }
    },
};
function clampSpeed(e, max) {
    const s = Math.hypot(e.vx, e.vy);
    if (s > max) {
        e.vx = (e.vx / s) * max;
        e.vy = (e.vy / s) * max;
    }
}
function drawEnemy(sx, sy, e, time) {
    const s = e.size;
    const dead = e.dead;
    const fade = dead ? 1 - e.deathT / DEATH_TIME : 1;
    const scale = dead ? 1 + e.deathT * 1.2 : 1;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(e.facing * scale, scale);
    ctx.globalAlpha = fade;
    const tailWag = Math.sin(time * 9 + e.wobble) * 0.4;
    // Body — a dark angular predator.
    const bodyGrad = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
    bodyGrad.addColorStop(0, "#2a4a52");
    bodyGrad.addColorStop(1, "#0e2126");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(s, 0); // snout
    ctx.quadraticCurveTo(s * 0.3, -s * 0.7, -s * 0.5, -s * 0.35);
    ctx.lineTo(-s * 0.9, 0);
    ctx.lineTo(-s * 0.5, s * 0.35);
    ctx.quadraticCurveTo(s * 0.3, s * 0.7, s, 0);
    ctx.closePath();
    ctx.fill();
    // Dorsal fin.
    ctx.fillStyle = "#0e2126";
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.5);
    ctx.lineTo(-s * 0.4, -s * 0.95);
    ctx.lineTo(-s * 0.55, -s * 0.4);
    ctx.closePath();
    ctx.fill();
    // Tail — wags.
    ctx.save();
    ctx.translate(-s * 0.85, 0);
    ctx.rotate(tailWag);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-s * 0.6, -s * 0.5);
    ctx.lineTo(-s * 0.45, 0);
    ctx.lineTo(-s * 0.6, s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Jaw with teeth.
    ctx.strokeStyle = "#e8f2f0";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#e8f2f0";
    const mouthOpen = Math.hypot(jelly.x - e.x, jelly.y - e.y) < DETECT_RADIUS ? s * 0.16 : s * 0.05;
    for (let i = 0; i < 3; i++) {
        const tx = s * 0.75 - i * s * 0.2;
        ctx.beginPath();
        ctx.moveTo(tx, mouthOpen);
        ctx.lineTo(tx - 2.5, mouthOpen + 5);
        ctx.lineTo(tx + 2.5, mouthOpen + 5);
        ctx.closePath();
        ctx.fill();
    }
    // Eye — glows red when hunting.
    const hunting = Math.hypot(jelly.x - e.x, jelly.y - e.y) < DETECT_RADIUS;
    ctx.fillStyle = hunting ? "#ff5a4a" : "#d8c04a";
    ctx.beginPath();
    ctx.arc(s * 0.45, -s * 0.12, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
    // Hurt flash.
    if (e.hurt > 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(180, 230, 255, ${e.hurt * 3})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, s, s * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
    // Health bar above a wounded (but living) enemy — drawn unflipped in screen space.
    if (!dead && e.hp < MAX_HP) {
        const bw = 34;
        const bx = sx - bw / 2;
        const by = sy - e.size - 12;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
        ctx.fillStyle = "#ff5a4a";
        ctx.fillRect(bx, by, bw * Math.max(0, e.hp / MAX_HP), 3);
    }
}
//# sourceMappingURL=enemy.js.map