// ============ ENEMY SYSTEM ============
import { simulationSpeed } from './core.js?v=0.5.0';
import { mapSystem } from './map.js?v=0.5.0';
import { player } from './player.js?v=0.5.0';
import { weatherSystem } from './weather.js?v=0.5.0';
import { SpriteSheet } from './sprite.js?v=0.5.0';

// content/enemy_atlas.png is baked from the labeled content/enemy.png sheet by
// tools/bakeAtlas.py — same 8-direction / 8-row layout as the player sheet.
const ENEMY_SPRITE = new SpriteSheet({
    src: 'content/enemy_atlas.png?v=0.5.0',
    frameW: 145,
    frameH: 146,
    pad: 6,
    walkFrameMs: 150
});

// Centered-rectangle overlap test, used for player <-> enemy contact.
// Matches how both are actually drawn (fillRect from the center out).
export function rectsOverlap(a, b) {
    return Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
           Math.abs(a.y - b.y) < (a.height + b.height) / 2;
}

export const enemySystem = {
    enemies: [],
    touchDamage: 8, // HP drained from the player per contact tick
    touchCooldownDuration: 600, // ms between contact hits, per enemy

    // sprite animation tuning
    spriteHeight: 66,    // on-screen height (px) of a full atlas frame
    hurtDuration: 200,
    attackDuration: 300,
    deathDuration: 700,

    init(count = 3) {
        this.enemies = [];
        const spread = 12 * mapSystem.tileSize;

        for (let i = 0; i < count; i++) {
            const offsetX = (Math.random() - 0.5) * 2 * spread;
            const offsetY = (Math.random() - 0.5) * 2 * spread;
            const spawn = mapSystem.findSpawnPoint(
                player.x + offsetX,
                player.y + offsetY
            );
            this.enemies.push(this.createEnemy(spawn.x, spawn.y));
        }
    },

    createEnemy(x, y) {
        return {
            x,
            y,
            width: 28,
            height: 28,
            speed: 60, // px/s - slower than the player's 150
            direction: { x: 0, y: 0 },
            facing: { x: 0, y: 1 }, // sprite faces down until it starts wandering
            wanderTimer: 0,
            wanderInterval: this.randomWanderInterval(),
            health: 60,
            maxHealth: 60,
            touchCooldown: 0, // ms remaining before this enemy can hit the player again

            // animation state (mirrors the player's state machine)
            animState: 'idle', // 'idle' | 'walk' | 'attack' | 'hurt' | 'dead'
            animTime: 0,
            attackTimer: 0,
            hurtTimer: 0,
            deathTimer: 0
        };
    },

    randomWanderInterval() {
        return 1000 + Math.random() * 1500; // 1-2.5s between direction changes
    },

    canMoveTo(x, y, buf) {
        const points = [
            { x: x - buf, y: y - buf },
            { x: x + buf, y: y - buf },
            { x: x - buf, y: y + buf },
            { x: x + buf, y: y + buf },
            { x: x, y: y }
        ];
        for (const p of points) {
            if (!mapSystem.isWalkable(p.x, p.y)) return false;
        }
        return true;
    },

    pickNewDirection(enemy) {
        // Occasionally pause instead of always moving
        if (Math.random() < 0.25) {
            enemy.direction.x = 0;
            enemy.direction.y = 0;
        } else {
            const angle = Math.random() * Math.PI * 2;
            enemy.direction.x = Math.cos(angle);
            enemy.direction.y = Math.sin(angle);
        }
        enemy.wanderTimer = 0;
        enemy.wanderInterval = this.randomWanderInterval();
    },

    // Applies damage from the player's abilities, triggering the hurt/death
    // animations. Projectiles and shockwaves call this instead of poking health.
    damageEnemy(enemy, amount) {
        if (enemy.animState === 'dead') return;
        enemy.health = Math.max(0, enemy.health - amount);
        if (enemy.health <= 0) {
            enemy.animState = 'dead';
            enemy.deathTimer = this.deathDuration;
            enemy.direction.x = 0;
            enemy.direction.y = 0;
        } else {
            enemy.hurtTimer = this.hurtDuration;
        }
    },

    update(deltaTime) {
        const scaled = deltaTime * simulationSpeed;

        // Despawn corpses once their death animation has fully played out
        this.enemies = this.enemies.filter(e => !(e.animState === 'dead' && e.deathTimer <= 0));

        for (const enemy of this.enemies) {
            // Animation timers
            enemy.animTime += scaled;
            if (enemy.attackTimer > 0) enemy.attackTimer = Math.max(0, enemy.attackTimer - scaled);
            if (enemy.hurtTimer > 0) enemy.hurtTimer = Math.max(0, enemy.hurtTimer - scaled);

            // Dead enemies hold the death pose and neither move nor deal damage
            if (enemy.animState === 'dead') {
                enemy.deathTimer -= scaled;
                continue;
            }

            enemy.wanderTimer += scaled;
            if (enemy.wanderTimer >= enemy.wanderInterval) {
                this.pickNewDirection(enemy);
            }

            if (enemy.touchCooldown > 0) {
                enemy.touchCooldown -= scaled;
            }

            // Contact damage: drains player HP on a per-enemy cooldown and plays
            // the enemy's attack pose
            if (enemy.touchCooldown <= 0 && rectsOverlap(player, enemy)) {
                player.takeDamage(this.touchDamage);
                enemy.touchCooldown = this.touchCooldownDuration;
                enemy.attackTimer = this.attackDuration;
            }

            const moving = enemy.direction.x !== 0 || enemy.direction.y !== 0;
            if (moving) {
                enemy.facing.x = enemy.direction.x;
                enemy.facing.y = enemy.direction.y;

                const distance = enemy.speed * weatherSystem.getSpeedModifier() * (deltaTime / 1000) * simulationSpeed;
                const newX = enemy.x + enemy.direction.x * distance;
                const newY = enemy.y + enemy.direction.y * distance;
                const buf = enemy.width / 2;

                if (this.canMoveTo(newX, newY, buf)) {
                    enemy.x = newX;
                    enemy.y = newY;
                } else {
                    const slideX = enemy.x + Math.sign(enemy.direction.x) * distance;
                    const slideY = enemy.y + Math.sign(enemy.direction.y) * distance;
                    if (enemy.direction.x !== 0 && this.canMoveTo(slideX, enemy.y, buf)) {
                        enemy.x = slideX;
                    } else if (enemy.direction.y !== 0 && this.canMoveTo(enemy.x, slideY, buf)) {
                        enemy.y = slideY;
                    } else {
                        this.pickNewDirection(enemy);
                    }
                }
            }

            // Resolve which animation to show (death is handled above)
            if (enemy.hurtTimer > 0) enemy.animState = 'hurt';
            else if (enemy.attackTimer > 0) enemy.animState = 'attack';
            else if (moving) enemy.animState = 'walk';
            else enemy.animState = 'idle';
        }
    },

    // Sprite sheet row for an enemy's current animation state
    animRow(enemy) {
        switch (enemy.animState) {
            case 'walk': return ENEMY_SPRITE.walkRow(enemy.animTime); // rows 1-4
            case 'attack': return 5;
            case 'hurt': return 6;
            case 'dead': return 7;
            default: return 0; // idle
        }
    },

    render(ctx) {
        const scale = this.spriteHeight / ENEMY_SPRITE.frameH;

        for (const enemy of this.enemies) {
            const feetY = enemy.y + enemy.height / 2;
            const col = ENEMY_SPRITE.facingColumn(enemy.facing.x, enemy.facing.y);
            const row = this.animRow(enemy);
            const blink = enemy.hurtTimer > 0 && Math.floor(enemy.hurtTimer / 70) % 2 === 0;

            const drawn = ENEMY_SPRITE.draw(ctx, col, row, enemy.x, feetY, scale, blink ? 0.5 : 1);
            if (!drawn) {
                // Fallback block until the atlas image has loaded
                ctx.fillStyle = '#cc2222';
                ctx.fillRect(enemy.x - enemy.width / 2, enemy.y - enemy.height / 2, enemy.width, enemy.height);
            }

            // Health bar floating above the head (living enemies only)
            if (enemy.animState !== 'dead') {
                const barWidth = enemy.width;
                const barHeight = 4;
                const barX = enemy.x - barWidth / 2;
                const spriteTop = feetY - (ENEMY_SPRITE.frameH - ENEMY_SPRITE.pad) * scale;
                const barY = spriteTop - 6;
                const pct = Math.max(0, enemy.health / enemy.maxHealth);

                ctx.fillStyle = '#3a1414';
                ctx.fillRect(barX, barY, barWidth, barHeight);
                ctx.fillStyle = '#e02d2d';
                ctx.fillRect(barX, barY, barWidth * pct, barHeight);
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                ctx.strokeRect(barX, barY, barWidth, barHeight);
            }
        }
    }
};
