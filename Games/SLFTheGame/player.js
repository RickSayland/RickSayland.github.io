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
            const distance = this.speed * weatherSystem.getSpeedModifier() * (deltaTime / 1000) * simulationSpeed;
            
            const buf = this.width / 2;
            const newX = this.x + this.direction.x * distance;
            const newY = this.y + this.direction.y * distance;

            if (this.canMoveTo(newX, newY, buf)) {
                this.x = newX;
                this.y = newY;
                this.isMoving = true;
            } else {
                const slideX = this.x + Math.sign(this.direction.x) * distance;
                const slideY = this.y + Math.sign(this.direction.y) * distance;
                const slidX = this.direction.x !== 0 && this.canMoveTo(slideX, this.y, buf);
                const slidY = this.direction.y !== 0 && this.canMoveTo(this.x, slideY, buf);
                if (slidX) { this.x = slideX; this.isMoving = true; }
                else if (slidY) { this.y = slideY; this.isMoving = true; }
                else { this.isMoving = false; }
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
    touchDir: { x: 0, y: 0 },

    init() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            this.updateDirection();

            if (e.code === 'Space' && !e.repeat && gameState === 'playing') {
                e.preventDefault();
                player.castShockwave();
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
            this.updateDirection();
        });

        this.initTouch();
    },

    initTouch() {
        const zone = document.getElementById('joystickZone');
        const knob = document.getElementById('joystickKnob');
        const actionBtn = document.getElementById('actionBtn');
        if (!zone) return;

        const baseRadius = 70;
        const knobRadius = 25;
        let activeTouch = null;

        zone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            activeTouch = touch.identifier;
            this.handleJoystickMove(touch, zone, knob, baseRadius, knobRadius);
        });

        zone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                if (touch.identifier === activeTouch) {
                    this.handleJoystickMove(touch, zone, knob, baseRadius, knobRadius);
                }
            }
        });

        const endTouch = (e) => {
            for (const touch of e.changedTouches) {
                if (touch.identifier === activeTouch) {
                    activeTouch = null;
                    this.touchDir.x = 0;
                    this.touchDir.y = 0;
                    knob.style.left = (baseRadius - knobRadius) + 'px';
                    knob.style.top = (baseRadius - knobRadius) + 'px';
                    this.updateDirection();
                }
            }
        };
        zone.addEventListener('touchend', endTouch);
        zone.addEventListener('touchcancel', endTouch);

        actionBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (gameState === 'playing') player.castShockwave();
        });
    },

    handleJoystickMove(touch, zone, knob, baseRadius, knobRadius) {
        const rect = zone.getBoundingClientRect();
        const cx = rect.left + baseRadius;
        const cy = rect.top + baseRadius;
        let dx = touch.clientX - cx;
        let dy = touch.clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = baseRadius - knobRadius;

        if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
        }

        knob.style.left = (baseRadius - knobRadius + dx) + 'px';
        knob.style.top = (baseRadius - knobRadius + dy) + 'px';

        const deadzone = 8;
        if (dist < deadzone) {
            this.touchDir.x = 0;
            this.touchDir.y = 0;
        } else {
            this.touchDir.x = dx / maxDist;
            this.touchDir.y = dy / maxDist;
        }
        this.updateDirection();
    },

    updateDirection() {
        player.direction.x = 0;
        player.direction.y = 0;

        if (this.keys['arrowup'] || this.keys['w']) player.direction.y = -1;
        if (this.keys['arrowdown'] || this.keys['s']) player.direction.y = 1;
        if (this.keys['arrowleft'] || this.keys['a']) player.direction.x = -1;
        if (this.keys['arrowright'] || this.keys['d']) player.direction.x = 1;

        if (player.direction.x === 0 && player.direction.y === 0) {
            player.direction.x = this.touchDir.x;
            player.direction.y = this.touchDir.y;
        }

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
