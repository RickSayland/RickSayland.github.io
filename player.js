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
    direction: { x: 0, y: 0 },
    isMoving: false,

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
    }
};

// ============ INPUT HANDLER ============
const input = {
    keys: {},

    init() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            this.handleInput();
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
