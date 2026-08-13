// ============ ENEMY SYSTEM ============

// Centered-rectangle overlap test, used for player <-> enemy contact.
// Matches how both are actually drawn (fillRect from the center out).
function rectsOverlap(a, b) {
    return Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
           Math.abs(a.y - b.y) < (a.height + b.height) / 2;
}

const enemySystem = {
    enemies: [],
    touchDamage: 8, // HP drained from the player per contact tick
    touchCooldownDuration: 600, // ms between contact hits, per enemy

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
            wanderTimer: 0,
            wanderInterval: this.randomWanderInterval(),
            health: 60,
            maxHealth: 60,
            touchCooldown: 0 // ms remaining before this enemy can hit the player again
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

    update(deltaTime) {
        // Drop anything a shockwave finished off this frame before we
        // wander, collide, or render it
        this.enemies = this.enemies.filter(enemy => enemy.health > 0);

        for (const enemy of this.enemies) {
            enemy.wanderTimer += deltaTime * simulationSpeed;
            if (enemy.wanderTimer >= enemy.wanderInterval) {
                this.pickNewDirection(enemy);
            }

            if (enemy.touchCooldown > 0) {
                enemy.touchCooldown -= deltaTime * simulationSpeed;
            }

            // Contact damage: drains player HP on a per-enemy cooldown so
            // standing in an enemy doesn't melt your health in one frame
            if (enemy.touchCooldown <= 0 && rectsOverlap(player, enemy)) {
                player.health = Math.max(0, player.health - this.touchDamage);
                enemy.touchCooldown = this.touchCooldownDuration;
            }

            if (enemy.direction.x === 0 && enemy.direction.y === 0) {
                continue;
            }

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
    },

    render(ctx) {
        for (const enemy of this.enemies) {
            // Small health bar floating above the enemy's head
            const barWidth = enemy.width;
            const barHeight = 4;
            const barX = enemy.x - barWidth / 2;
            const barY = enemy.y - enemy.height / 2 - 10;
            const pct = Math.max(0, enemy.health / enemy.maxHealth);

            ctx.fillStyle = '#3a1414';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            ctx.fillStyle = '#e02d2d';
            ctx.fillRect(barX, barY, barWidth * pct, barHeight);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, barY, barWidth, barHeight);

            ctx.fillStyle = '#cc2222';
            ctx.fillRect(
                enemy.x - enemy.width / 2,
                enemy.y - enemy.height / 2,
                enemy.width,
                enemy.height
            );

            // Simple eyes so it's readable as a creature, not just a block
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(enemy.x - 7, enemy.y - 6, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(enemy.x + 7, enemy.y - 6, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }
};
