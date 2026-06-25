// ============ SHOCKWAVE (ABILITY) SYSTEM ============
const shockwaveSystem = {
    ripples: [],
    damage: 30, // HP dealt to an enemy caught in the ring

    spawn(x, y) {
        this.ripples.push({
            x,
            y,
            radius: 0,
            maxRadius: 180,
            expandSpeed: 260, // px/sec
            life: 1, // 1 = freshly spawned, 0 = fully faded
            hitEnemies: new Set() // enemies already damaged by this ripple
        });
    },

    update(deltaTime) {
        const scaledDelta = deltaTime * simulationSpeed;

        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const ripple = this.ripples[i];
            ripple.radius += ripple.expandSpeed * (scaledDelta / 1000);
            ripple.life = 1 - (ripple.radius / ripple.maxRadius);

            // Anything the leading edge has swept past takes damage once
            for (const enemy of enemySystem.enemies) {
                if (ripple.hitEnemies.has(enemy)) {
                    continue;
                }
                const dx = enemy.x - ripple.x;
                const dy = enemy.y - ripple.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= ripple.radius) {
                    enemy.health = Math.max(0, enemy.health - this.damage);
                    ripple.hitEnemies.add(enemy);
                }
            }

            if (ripple.radius >= ripple.maxRadius) {
                this.ripples.splice(i, 1);
            }
        }
    },

    render(ctx) {
        for (const ripple of this.ripples) {
            const alpha = Math.max(0, ripple.life);

            // Outer ring
            ctx.strokeStyle = `rgba(120, 200, 255, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
            ctx.stroke();

            // Softer inner glow, slightly thicker and fainter
            ctx.strokeStyle = `rgba(200, 230, 255, ${alpha * 0.5})`;
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
};
