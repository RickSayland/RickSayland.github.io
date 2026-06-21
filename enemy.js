// ============ ENEMY SYSTEM ============
const enemySystem = {
    enemies: [],

    init(count = 1) {
        this.enemies = [];
        const mapPixelWidth = mapSystem.mapWidth * mapSystem.tileSize;
        const mapPixelHeight = mapSystem.mapHeight * mapSystem.tileSize;

        for (let i = 0; i < count; i++) {
            // Pick a random spot on the map, then snap it to the nearest
            // walkable tile (same helper the player uses to spawn).
            const spawn = mapSystem.findSpawnPoint(
                Math.random() * mapPixelWidth,
                Math.random() * mapPixelHeight
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
            wanderInterval: this.randomWanderInterval()
        };
    },

    randomWanderInterval() {
        return 1000 + Math.random() * 1500; // 1-2.5s between direction changes
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
        for (const enemy of this.enemies) {
            enemy.wanderTimer += deltaTime * simulationSpeed;
            if (enemy.wanderTimer >= enemy.wanderInterval) {
                this.pickNewDirection(enemy);
            }

            if (enemy.direction.x === 0 && enemy.direction.y === 0) {
                continue;
            }

            const distance = enemy.speed * (deltaTime / 1000) * simulationSpeed;
            const newX = enemy.x + enemy.direction.x * distance;
            const newY = enemy.y + enemy.direction.y * distance;

            // Same multi-corner collision check as player.update()
            const collisionBuffer = enemy.width / 2;
            const corners = [
                { x: newX - collisionBuffer, y: newY - collisionBuffer },
                { x: newX + collisionBuffer, y: newY - collisionBuffer },
                { x: newX - collisionBuffer, y: newY + collisionBuffer },
                { x: newX + collisionBuffer, y: newY + collisionBuffer },
                { x: newX, y: newY }
            ];

            let canMove = true;
            for (const corner of corners) {
                if (!mapSystem.isWalkable(corner.x, corner.y)) {
                    canMove = false;
                    break;
                }
            }

            if (canMove) {
                enemy.x = newX;
                enemy.y = newY;
            } else {
                // Walked into water/trees/rock - pick a new direction now
                // instead of waiting out the rest of the timer
                this.pickNewDirection(enemy);
            }
        }
    },

    render(ctx) {
        for (const enemy of this.enemies) {
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
