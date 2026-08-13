// ============ PROJECTILE SYSTEM ============
const projectileSystem = {
    projectiles: [],
    damage: 20,
    speed: 400,
    maxRange: 500,

    spawn(x, y, dirX, dirY) {
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len === 0) return;
        this.projectiles.push({
            x,
            y,
            startX: x,
            startY: y,
            dx: dirX / len,
            dy: dirY / len,
            hitEnemy: false
        });
    },

    update(deltaTime) {
        const dist = this.speed * (deltaTime / 1000) * simulationSpeed;

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.x += p.dx * dist;
            p.y += p.dy * dist;

            const traveled = Math.sqrt(
                (p.x - p.startX) ** 2 + (p.y - p.startY) ** 2
            );

            if (traveled >= this.maxRange || !mapSystem.isWalkable(p.x, p.y)) {
                this.projectiles.splice(i, 1);
                continue;
            }

            for (const enemy of enemySystem.enemies) {
                const dx = enemy.x - p.x;
                const dy = enemy.y - p.y;
                if (Math.abs(dx) < enemy.width / 2 + 6 &&
                    Math.abs(dy) < enemy.height / 2 + 6) {
                    enemy.health = Math.max(0, enemy.health - this.damage);
                    this.projectiles.splice(i, 1);
                    break;
                }
            }
        }
    },

    render(ctx) {
        for (const p of this.projectiles) {
            ctx.fillStyle = player.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }
};
