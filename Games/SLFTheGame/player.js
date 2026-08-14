// ============ PLAYER SYSTEM ============
import { simulationSpeed, gameState } from './core.js?v=0.5.0';
import { mapSystem } from './map.js?v=0.5.0';
import { shockwaveSystem } from './shockwave.js?v=0.5.0';
import { weatherSystem } from './weather.js?v=0.5.0';
import { projectileSystem } from './projectile.js?v=0.5.0';
import { SpriteSheet } from './sprite.js?v=0.5.0';

// Selectable characters. Each atlas is baked from a labeled content/*.png sheet
// by tools/bakeAtlas.py (bg keyed out, frames trimmed + baseline-aligned) and
// shares the row layout: 0 Idle, 1-4 Walk, 5 Attack, 6 Hurt, 7 Death. Frame
// sizes differ per sheet, so each SpriteSheet carries its own.
export const CHARACTERS = [
    {
        key: 'rex',
        name: 'Rex',
        blurb: 'Warrior',
        color: '#5fd23a', // accent used for projectiles / minimap / HUD
        sheet: new SpriteSheet({ src: 'content/player_atlas.png?v=0.5.0', frameW: 145, frameH: 136, pad: 6, walkFrameMs: 130 })
    },
    {
        key: 'vex',
        name: 'Vex',
        blurb: 'Mage',
        color: '#a64dff',
        sheet: new SpriteSheet({ src: 'content/player2_atlas.png?v=0.5.0', frameW: 140, frameH: 120, pad: 6, walkFrameMs: 130 })
    }
];

export const player = {
    x: 400,
    y: 300,
    width: 30,
    height: 30,
    speed: 150, // pixels per second
    color: '#5fd23a', // accent color; set from the chosen character on Play
    name: 'Hero', // replaced with the character's name at character select
    direction: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    isMoving: false,

    // ---- sprite animation ----
    character: CHARACTERS[0],   // selected character; swapped by setCharacter()
    spriteHeight: 68,           // on-screen height (px) of a full atlas frame
    animState: 'idle',         // 'idle' | 'walk' | 'attack' | 'hurt' | 'dead'
    animTime: 0,               // ms accumulator driving the walk cycle
    attackTimer: 0,            // ms remaining on the attack pose
    hurtTimer: 0,              // ms remaining on the hurt pose/flash
    deathTimer: 0,             // ms remaining before respawn while dead
    attackDuration: 280,
    hurtDuration: 260,
    deathDuration: 1200,

    health: 100,
    maxHealth: 100,

    magic: 100,
    maxMagic: 100,
    magicRegenRate: 8,
    shockwaveCost: 20,
    shootCost: 5,

    shootCooldown: 0,
    shootCooldownMax: 400,
    shockwaveCooldown: 0,
    shockwaveCooldownMax: 5000,

    update(deltaTime) {
        const scaled = deltaTime * simulationSpeed;
        if (this.shootCooldown > 0) this.shootCooldown = Math.max(0, this.shootCooldown - scaled);
        if (this.shockwaveCooldown > 0) this.shockwaveCooldown = Math.max(0, this.shockwaveCooldown - scaled);

        // Animation timers advance on the same simulation clock as everything else
        this.animTime += scaled;
        if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - scaled);
        if (this.hurtTimer > 0) this.hurtTimer = Math.max(0, this.hurtTimer - scaled);

        // While dead the player is frozen; the death pose holds until respawn
        if (this.animState === 'dead') {
            this.isMoving = false;
            this.deathTimer -= scaled;
            if (this.deathTimer <= 0) this.respawn();
            return;
        }

        if (this.direction.x !== 0 || this.direction.y !== 0) {
            this.facing.x = this.direction.x;
            this.facing.y = this.direction.y;
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

        // Resolve which animation to show (priority: hurt > attack > walk > idle)
        if (this.hurtTimer > 0) this.animState = 'hurt';
        else if (this.attackTimer > 0) this.animState = 'attack';
        else if (this.isMoving) this.animState = 'walk';
        else this.animState = 'idle';
    },

    // Swap the active character sprite (called from the character-select screen)
    setCharacter(key) {
        const found = CHARACTERS.find(c => c.key === key);
        if (found) {
            this.character = found;
            this.name = found.name;
            this.color = found.color;
        }
    },

    // Sprite sheet row for the current animation state
    animRow() {
        switch (this.animState) {
            case 'walk': return this.character.sheet.walkRow(this.animTime); // rows 1-4
            case 'attack': return 5;
            case 'hurt': return 6;
            case 'dead': return 7;
            default: return 0; // idle
        }
    },

    // Applies incoming damage and triggers the matching animation. Enemies call
    // this instead of poking health directly so the hurt/death poses fire.
    takeDamage(amount) {
        if (this.animState === 'dead') return;
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0) {
            this.animState = 'dead';
            this.deathTimer = this.deathDuration;
            this.isMoving = false;
        } else {
            this.hurtTimer = this.hurtDuration;
        }
    },

    // Full-heal and reposition after the death animation finishes
    respawn() {
        this.health = this.maxHealth;
        this.magic = this.maxMagic;
        const spawn = mapSystem.findSpawnPoint(this.x, this.y);
        this.x = spawn.x;
        this.y = spawn.y;
        this.animState = 'idle';
        this.deathTimer = 0;
        this.hurtTimer = 0;
        this.attackTimer = 0;
    },

    render(ctx) {
        const sheet = this.character.sheet;
        const scale = this.spriteHeight / sheet.frameH;
        const col = sheet.facingColumn(this.facing.x, this.facing.y);
        const row = this.animRow();
        // Feet baseline sits at the bottom of the collision box
        const feetY = this.y + this.height / 2;
        // Blink while hurt so a hit reads even when the pose is subtle
        const blink = this.hurtTimer > 0 && Math.floor(this.hurtTimer / 80) % 2 === 0;

        const drawn = sheet.draw(ctx, col, row, this.x, feetY, scale, blink ? 0.45 : 1);
        if (!drawn) {
            // Fallback marker until the atlas image has loaded
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
        }
    },

    // True only if all four corners (plus center) of the hitbox at (x,y) land
    // on walkable tiles. Used to gate movement against walls.
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
        if (this.animState === 'dead') return;
        if (this.shockwaveCooldown > 0 || this.magic < this.shockwaveCost) return;
        this.magic -= this.shockwaveCost;
        this.shockwaveCooldown = this.shockwaveCooldownMax;
        this.attackTimer = this.attackDuration;
        shockwaveSystem.spawn(this.x, this.y);
    },

    castProjectile() {
        if (this.animState === 'dead') return;
        if (this.shootCooldown > 0 || this.magic < this.shootCost) return;
        this.magic -= this.shootCost;
        this.shootCooldown = this.shootCooldownMax;
        this.attackTimer = this.attackDuration;
        projectileSystem.spawn(this.x, this.y, this.facing.x, this.facing.y);
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
        const cdY = magicY + barHeight + 10;
        const panelHeight = (cdY + 22) - panelY;

        ctx.fillStyle = 'rgba(10, 10, 10, 0.75)';
        ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

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

        const halfW = barWidth / 2 - 2;
        const shootPct = this.shootCooldown / this.shootCooldownMax;
        const aoePct = this.shockwaveCooldown / this.shockwaveCooldownMax;

        this.drawStatBar(ctx, innerX, cdY, halfW, 12,
            1 - shootPct, 1, this.color, '#1a1a1a', shootPct > 0 ? (this.shootCooldown / 1000).toFixed(1) + 's' : 'Shot');
        this.drawStatBar(ctx, innerX + halfW + 4, cdY, halfW, 12,
            1 - aoePct, 1, '#78c8ff', '#1a1a1a', aoePct > 0 ? (this.shockwaveCooldown / 1000).toFixed(1) + 's' : 'AOE');
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
export const input = {
    keys: {},
    touchDir: { x: 0, y: 0 },

    init() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            this.updateDirection();

            if (e.code === 'Space' && !e.repeat && gameState === 'playing') {
                e.preventDefault();
                player.castProjectile();
            }
            if ((e.code === 'KeyE') && !e.repeat && gameState === 'playing') {
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
            if (gameState === 'playing') player.castProjectile();
        });

        const aoeBtn = document.getElementById('aoeBtn');
        if (aoeBtn) {
            aoeBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (gameState === 'playing') player.castShockwave();
            });
        }
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
