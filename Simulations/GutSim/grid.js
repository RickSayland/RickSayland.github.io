// ============ GUTSIM — CELLULAR AUTOMATON ============
// A falling-sand grid: one element id per cell, updated bottom-up so a particle
// that falls lands in a row already visited this step. Everything the tract does
// to its contents is expressed as movement rules here; what the contents turn
// INTO lives in digestion.js.
//
// Four parallel arrays travel with the particle (type / tint / timer), and four
// belong to the LOCATION and never move (zone / flowDir / flowStr / arc). Keeping
// that split straight is what makes peristalsis work: the push is a property of
// the tube, not of whatever happens to be sitting in it.

const CELL = 4;    // screen pixels per cell
const GW = 280;
const GH = 200;

// Neighbour offsets, index 0 = straight down. Canvas y grows downward.
const DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const NO_DIR = 8;

// Peristalsis: bands of contraction travelling along the tube. WAVES is how many
// fit on the tract at once, PHASE_STEP how fast they march (arc is 0..255).
const WAVES = 6;
const PHASE_STEP = 3;

const SINE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    SINE[i] = Math.round((Math.sin((i / 256) * Math.PI * 2) * 0.5 + 0.5) * 255);
}

const grid = {
    w: GW,
    h: GH,
    type: null,
    tint: null,      // frozen 0-7 palette index per cell
    timer: null,     // digestion countdown, ticked only while conditions hold
    moved: null,     // per-step stamp, stops a particle moving twice
    zone: null,      // anatomy zone id (0 = solid tissue / outside)
    flowDir: null,   // 0-7 index into DIRS, or NO_DIR
    flowStr: null,   // 0-255 peristaltic push strength
    arc: null,       // 0-255 position along the tract, drives the wave phase
    tick: 0,
    phase: 0,

    init() {
        const n = this.w * this.h;
        this.type = new Uint8Array(n);
        this.tint = new Uint8Array(n);
        this.timer = new Uint8Array(n);
        this.moved = new Uint8Array(n);
        this.zone = new Uint8Array(n);
        this.flowDir = new Uint8Array(n).fill(NO_DIR);
        this.flowStr = new Uint8Array(n);
        this.arc = new Uint8Array(n);
    },

    idx(x, y) { return y * this.w + x; },

    inBounds(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; },

    // Place a particle, seeding the fields that belong to it rather than to the cell.
    spawn(i, id) {
        this.type[i] = id;
        this.tint[i] = (Math.random() * 8) | 0;
        const el = ELEMENTS[id];
        this.timer[i] = el.digest
            ? Math.min(255, Math.round(el.digest.time * (0.8 + Math.random() * 0.4)))
            : 0;
    },

    clear(i) {
        this.type[i] = EL.EMPTY;
        this.timer[i] = 0;
    },

    move(i, j) {
        this.type[j] = this.type[i];
        this.tint[j] = this.tint[i];
        this.timer[j] = this.timer[i];
        this.type[i] = EL.EMPTY;
        this.timer[i] = 0;
        this.moved[j] = 1;
    },

    swap(i, j) {
        let t = this.type[i]; this.type[i] = this.type[j]; this.type[j] = t;
        t = this.tint[i]; this.tint[i] = this.tint[j]; this.tint[j] = t;
        t = this.timer[i]; this.timer[i] = this.timer[j]; this.timer[j] = t;
        this.moved[i] = 1;
        this.moved[j] = 1;
    },

    // ---- Movement ----

    step() {
        this.moved.fill(0);
        this.phase = (this.phase + PHASE_STEP) & 255;

        // Scan direction alternates each step. A fixed direction makes piles lean.
        const flip = (this.tick & 1) === 1;

        for (let y = this.h - 1; y >= 0; y--) {
            const row = y * this.w;
            for (let k = 0; k < this.w; k++) {
                const x = flip ? this.w - 1 - k : k;
                const i = row + x;
                if (this.moved[i]) continue;
                const t = this.type[i];
                if (t === EL.EMPTY) continue;
                const el = ELEMENTS[t];
                if (el.form === FORM.TISSUE) continue;
                this.stepCell(x, y, i, el);
            }
        }
        this.tick++;
    },

    stepCell(x, y, i, el) {
        // Peristalsis gets first refusal. Without it nothing crosses a horizontal
        // run of intestine — gravity alone just piles everything at the bottom
        // of the tube and stops.
        const dir = this.flowDir[i];
        if (dir !== NO_DIR) {
            const str = this.flowStr[i];
            const wave = SINE[(this.arc[i] * WAVES - this.phase) & 255];
            if (Math.random() * 65025 < str * wave) {
                const d = DIRS[dir];
                if (this.tryMove(i, x, y, x + d[0], y + d[1], el) >= 0) return;
            }
        }

        if (el.form === FORM.LIQUID) this.stepLiquid(x, y, i, el);
        else if (el.form === FORM.GAS) this.stepGas(x, y, i, el);
        else this.stepPowder(x, y, i, el);
    },

    stepPowder(x, y, i, el) {
        if (this.tryMove(i, x, y, x, y + 1, el) >= 0) return;
        // `slip` is what lets a burger stay a burger for a second before it
        // slumps: chunks slide off a pile rarely, granules almost always.
        if (Math.random() > el.slip) return;
        const d = Math.random() < 0.5 ? 1 : -1;
        if (this.tryMove(i, x, y, x + d, y + 1, el) >= 0) return;
        this.tryMove(i, x, y, x - d, y + 1, el);
    },

    stepLiquid(x, y, i, el) {
        if (this.tryMove(i, x, y, x, y + 1, el) >= 0) return;
        const d = Math.random() < 0.5 ? 1 : -1;
        if (this.tryMove(i, x, y, x + d, y + 1, el) >= 0) return;
        if (this.tryMove(i, x, y, x - d, y + 1, el) >= 0) return;

        // Creep sideways one cell at a time rather than jumping `spread` cells,
        // so a liquid can never hop over a wall into the next lumen.
        let ci = i, cx = x;
        for (let n = 0; n < el.spread; n++) {
            const ni = this.tryMove(ci, cx, y, cx + d, y, el);
            if (ni < 0) break;
            ci = ni;
            cx += d;
        }
    },

    stepGas(x, y, i, el) {
        if (this.tryMove(i, x, y, x, y - 1, el) >= 0) return;
        const d = Math.random() < 0.5 ? 1 : -1;
        if (this.tryMove(i, x, y, x + d, y - 1, el) >= 0) return;
        if (this.tryMove(i, x, y, x - d, y - 1, el) >= 0) return;
        this.tryMove(i, x, y, x + d, y, el);
    },

    // Returns the new index on success, -1 if the move is blocked.
    tryMove(i, x, y, nx, ny, el) {
        if (nx < 0 || nx >= this.w || ny < 0 || ny >= this.h) return -1;
        const j = ny * this.w + nx;
        const t = this.type[j];

        if (t === EL.EMPTY) { this.move(i, j); return j; }

        const oel = ELEMENTS[t];
        if (oel.membrane) {
            return el.fine ? this.passThrough(i, x, y, nx, ny) : -1;
        }
        if (oel.form === FORM.TISSUE) return -1;
        if (this.moved[j]) return -1;

        // Density sorting is the whole reason fat floats on gastric acid and gas
        // bubbles up through it. The epsilon stops near-equal pairs churning.
        if (oel.density + 0.03 < el.density) { this.swap(i, j); return j; }
        return -1;
    },

    // A membrane is one cell thick, so crossing it means landing on the far side.
    passThrough(i, x, y, nx, ny) {
        const bx = nx + (nx - x), by = ny + (ny - y);
        if (!this.inBounds(bx, by)) return -1;
        const b = by * this.w + bx;
        if (this.type[b] !== EL.EMPTY) return -1;
        this.move(i, b);
        return b;
    },

    // ---- Queries ----

    countOf(id) {
        let n = 0;
        for (let i = 0; i < this.type.length; i++) if (this.type[i] === id) n++;
        return n;
    },

    // Wipe everything that is not part of the tract itself.
    flush() {
        for (let i = 0; i < this.type.length; i++) {
            const t = this.type[i];
            if (t !== EL.EMPTY && ELEMENTS[t].form !== FORM.TISSUE) this.clear(i);
        }
    }
};
