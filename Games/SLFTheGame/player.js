// ============ PLAYER SYSTEM ============

// Darkens (factor < 1) or lightens (factor > 1) a hex color. Used to derive
// the direction-indicator shade from whatever body color was picked at
// character select, so any chosen color still has a matching accent.
function shadeColor(hex, factor) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((num >> 16) & 0xff) * factor)));
    const g = Math.max(0, Math.min(255, Math.round(((num >> 8) & 0xff) * factor)));
    const b = Math.max(0, Math.min(255, Math.round((num & 0xff) * factor)));
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

const player = {
    x: 400,
    y: 300,
    width: 30,
    height: 30,
    speed: 150, // pixels per second
    color: '#00ff00',
    name: 'Hero', // placeholder until character select asks for a name
    direction: { x: 0, y: 0 },
    isMoving: false,

    health: 100,
    maxHealth: 100,

    magic: 100,
    maxMagic: 100,
    magicRegenRate: 8, // MP per second, passive regen
    shockwaveCost: 20, // MP spent per cast

    update(deltaTime) {
        // Apply movement based on direction
        if (this.direction.x !== 0 || this.direction.y !== 0) {
            const distance = this.speed * (deltaTime / 1000) * simulationSpeed;
            
            // Calculate new position
            let newX = this.x + this.direction.x * distance;
            let newY = this.y + this.direction.y * distance;
            
            // Check collision with a buffer for smooth walls
            const collisionBuffer = this.width / 2;
            
            // Check multiple points around the player for collision
            const corners = [
                { x: newX - collisionBuffer, y: newY - collisionBuffer },
                { x: newX + collisionBuffer, y: newY - collisionBuffer },
                { x: newX - collisionBuffer, y: newY + collisionBuffer },
                { x: newX + collisionBuffer, y: newY + collisionBuffer },
                { x: newX, y: newY }
            ];
            
            let canMove = true;
            for (let corner of corners) {
                if (!mapSystem.isWalkable(corner.x, corner.y)) {
                    canMove = false;
                    break;
                }
            }
            
            if (canMove) {
                this.x = newX;
                this.y = newY;
                this.isMoving = true;
            } else {
                this.isMoving = false;
            }
        } else {
            this.isMoving = false;
        }

        // Magic regenerates passively, capped at max
        if (this.magic < this.maxMagic) {
            this.magic = Math.min(
                this.maxMagic,
                this.magic + this.magicRegenRate * (deltaTime / 1000) * simulationSpeed
            );
        }
    },

    render(ctx) {
        // Draw player as a rectangle with a direction indicator
        ctx.fillStyle = this.color;
        ctx.fillRect(
            this.x - this.width / 2,
            this.y - this.height / 2,
            this.width,
            this.height
        );

        // Draw direction indicator (circle at top of sprite)
        ctx.fillStyle = shadeColor(this.color, 0.7);
        const indicatorX = this.x + this.direction.x * 15;
        const indicatorY = this.y + this.direction.y * 15;
        ctx.beginPath();
        ctx.arc(indicatorX, indicatorY, 5, 0, Math.PI * 2);
        ctx.fill();

        // Draw a simple face
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(this.x - 8, this.y - 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(this.x + 8, this.y - 8, 3, 0, Math.PI * 2);
        ctx.fill();
    },

    // Spends MP to release an expanding shockwave centered on the player.
    // Does nothing if there isn't enough magic.
    castShockwave() {
        if (this.magic < this.shockwaveCost) {
            return;
        }
        this.magic -= this.shockwaveCost;
        shockwaveSystem.spawn(this.x, this.y);
    },

    // Draws the HP/MP HUD panel in screen space (top-left corner).
    renderStatsBar(ctx) {
        const panelX = 15;
        const panelY = 15;
        const panelWidth = 192;
        const innerX = panelX + 6;
        const barWidth = 180;
        const barHeight = 16;
        const nameY = panelY + 20;
        const healthY = panelY + 30;
        const magicY = healthY + barHeight + 8;
        const panelHeight = (magicY + barHeight + 10) - panelY;

        // Panel backdrop
        ctx.fillStyle = 'rgba(10, 10, 10, 0.75)';
        ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

        // Character name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(this.name, innerX, nameY);

        this.drawStatBar(
            ctx, innerX, healthY, barWidth, barHeight,
            this.health, this.maxHealth, '#e02d2d', '#4a1414',
            `HP ${Math.round(this.health)}/${this.maxHealth}`
        );

        this.drawStatBar(
            ctx, innerX, magicY, barWidth, barHeight,
            this.magic, this.maxMagic, '#3a8de0', '#142a4a',
            `MP ${Math.round(this.magic)}/${this.maxMagic}`
        );
    },

    // Generic filled/empty bar with a centered label, used for both HP and MP
    drawStatBar(ctx, x, y, width, height, value, maxValue, fillColor, emptyColor, label) {
        const pct = maxValue > 0 ? Math.max(0, Math.min(1, value / maxValue)) : 0;

        ctx.fillStyle = emptyColor;
        ctx.fillRect(x, y, width, height);

        ctx.fillStyle = fillColor;
        ctx.fillRect(x, y, width * pct, height);

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + width / 2, y + height / 2 + 1);

        // Reset so later draw calls (other UI text) get the defaults they expect
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
};

// ============ INPUT HANDLER ============
const input = {
    keys: {},

    init() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            this.handleInput();

            if (e.code === 'Space' && !e.repeat && gameState === 'playing') {
                e.preventDefault(); // stop the page from scrolling
                player.castShockwave();
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
            this.handleInput();
        });
    },

    handleInput() {
        // Reset direction
        player.direction.x = 0;
        player.direction.y = 0;

        // Check arrow keys and WASD
        if (this.keys['arrowup'] || this.keys['w']) {
            player.direction.y = -1;
        }
        if (this.keys['arrowdown'] || this.keys['s']) {
            player.direction.y = 1;
        }
        if (this.keys['arrowleft'] || this.keys['a']) {
            player.direction.x = -1;
        }
        if (this.keys['arrowright'] || this.keys['d']) {
            player.direction.x = 1;
        }

        // Normalize diagonal movement
        if (player.direction.x !== 0 && player.direction.y !== 0) {
            const length = Math.sqrt(
                player.direction.x * player.direction.x +
                player.direction.y * player.direction.y
            );
            player.direction.x /= length;
            player.direction.y /= length;
        }
    }
};
