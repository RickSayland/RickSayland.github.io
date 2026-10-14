// ============ OPENSTREETRPG — INPUT ============
// Keyboard and wheel, reduced to an intent the game reads each frame: a
// movement axis, whether Shift is held, and queued zoom steps. Owns `input`.

const input = {

    DIRS: {
        KeyW: 'up', ArrowUp: 'up',
        KeyS: 'down', ArrowDown: 'down',
        KeyA: 'left', ArrowLeft: 'left',
        KeyD: 'right', ArrowRight: 'right'
    },
    WHEEL_STEP: 80,         // pixel-mode wheel delta per zoom level

    held: new Set(),        // e.code of every key currently down
    zoomSteps: 0,           // +1 per zoom-in request, consumed by main.js
    wheelAcc: 0,

    init() {
        addEventListener('keydown', e => this.key(e, true));
        addEventListener('keyup', e => this.key(e, false));
        // A key released while the window is unfocused never sends keyup, and
        // the player would walk on forever.
        addEventListener('blur', () => this.held.clear());
        canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
        canvas.addEventListener('pointerdown', () => document.activeElement && document.activeElement.blur());
    },

    typing(e) {
        const t = e.target;
        return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    },

    key(e, down) {
        // Releases always count, even into the search box, or a key held while
        // clicking into it would stay down.
        if (!down) { this.held.delete(e.code); return; }
        if (this.typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;

        if (this.DIRS[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
            this.held.add(e.code);
            e.preventDefault();
        } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
            this.zoomSteps++;
            e.preventDefault();
        } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
            this.zoomSteps--;
            e.preventDefault();
        } else if (e.key === '/' || e.code === 'Enter') {
            hud.focusSearch();
            e.preventDefault();
        }
    },

    wheel(e) {
        e.preventDefault();
        // Line-mode wheels (Firefox) report ~3 per notch; trackpads report many
        // small pixel deltas. Accumulate both into whole zoom levels.
        this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        while (this.wheelAcc >= this.WHEEL_STEP) { this.zoomSteps--; this.wheelAcc -= this.WHEEL_STEP; }
        while (this.wheelAcc <= -this.WHEEL_STEP) { this.zoomSteps++; this.wheelAcc += this.WHEEL_STEP; }
    },

    // Unit-length movement intent; diagonals are normalised so they are not
    // 41% faster than straight lines.
    axis() {
        const on = { up: 0, down: 0, left: 0, right: 0 };
        for (const code of this.held) if (this.DIRS[code]) on[this.DIRS[code]] = 1;
        let x = on.right - on.left, y = on.down - on.up;
        if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
        return { x, y };
    },

    running() { return this.held.has('ShiftLeft') || this.held.has('ShiftRight'); }
};
