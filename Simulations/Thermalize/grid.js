// ============ THERMALIZE — THE BENCH ============
// The falling-sand half. A W x H grid of 1 cm cells, updated bottom-up with an
// alternating scan direction. Zero DOM. Owns `grid` and the shared `rng`.
//
// Three arrays travel with a grain when it moves:
//   type   which material
//   seed   which of the material's 16 nucleus arrangements this grain uses —
//          a water molecule's orientation, a sand grain's offset
//   ovr    three bytes, one per nucleus slot: 0, or the species that nucleus
//          has BECOME after capturing a neutron. This is how a boron atom
//          stays lithium after it has been used up, wherever the grain goes.

// One seeded stream for the whole simulation, consumed in a fixed order, so a
// run repeats exactly. The check harness depends on that.
const rng = {
    s: 0x1234abcd,
    seed(n) { this.s = n >>> 0; },
    next() {
        this.s = (this.s + 0x6D2B79F5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
};

const grid = {

    W: 160,
    H: 100,
    type: null,
    seed: null,
    ovr: null,
    moved: null,
    tick: 0,
    FLOW: 3,                // cells a liquid may run sideways in one step
    SLIP: 0.55,             // chance a grain takes an open diagonal: the angle of repose

    init() {
        const n = this.W * this.H;
        this.type = new Uint8Array(n);
        this.seed = new Uint8Array(n);
        this.ovr = new Uint8Array(n * 3);
        this.moved = new Uint8Array(n);
    },

    clear() {
        this.type.fill(0); this.seed.fill(0); this.ovr.fill(0);
        this.tick = 0;
    },

    // Floors its coordinates. A caller looping from a non-integer bound would
    // otherwise index a typed array with a fraction, which is not an error —
    // it silently writes nowhere.
    set(x, y, id) {
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
        const c = y * this.W + x;
        this.type[c] = id;
        this.seed[c] = (rng.next() * 256) | 0;
        this.ovr[c * 3] = 0; this.ovr[c * 3 + 1] = 0; this.ovr[c * 3 + 2] = 0;
    },

    get(x, y) {
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) return 0;
        return this.type[y * this.W + x];
    },

    // A filled disc. `replace` false only fills empty cells, which is what a
    // brush wants: painting water over a wall should not eat the wall.
    paint(cx, cy, r, id, replace) {
        const r2 = r * r;
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (dx * dx + dy * dy > r2) continue;
                if (id !== 0 && !replace && this.get(x, y) !== 0) continue;
                this.set(x, y, id);
            }
        }
    },

    rect(x0, y0, x1, y1, id) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, id);
    },

    // ---- Movement ----

    move(c, t) {
        const o = this.ovr, a = c * 3, b = t * 3;
        this.type[t] = this.type[c]; this.seed[t] = this.seed[c];
        o[b] = o[a]; o[b + 1] = o[a + 1]; o[b + 2] = o[a + 2];
        this.type[c] = 0; o[a] = 0; o[a + 1] = 0; o[a + 2] = 0;
        this.moved[t] = 1;
    },

    swap(c, t) {
        const o = this.ovr, a = c * 3, b = t * 3;
        let k = this.type[t]; this.type[t] = this.type[c]; this.type[c] = k;
        k = this.seed[t]; this.seed[t] = this.seed[c]; this.seed[c] = k;
        for (let i = 0; i < 3; i++) { k = o[b + i]; o[b + i] = o[a + i]; o[a + i] = k; }
        this.moved[t] = 1; this.moved[c] = 1;
    },

    // Into an empty cell, or down through a lighter fluid.
    sink(c, t, m) {
        const tm = this.type[t];
        if (tm === 0) { this.move(c, t); return true; }
        if (this.moved[t]) return false;
        if (materials.phase[tm] >= 2 && materials.dens[tm] < materials.dens[m]) { this.swap(c, t); return true; }
        return false;
    },

    // A diagonal needs the cell beside the grain to be open too, or powder
    // leaks through the corner where two wall cells meet.
    diag(x, c, d, m) {
        const nx = x + d;
        if (nx < 0 || nx >= this.W) return false;
        const side = this.type[c + d];
        if (side !== 0 && materials.phase[side] < 2) return false;
        return this.sink(c, c + this.W + d, m);
    },

    step() {
        this.tick++;
        const W = this.W, H = this.H, type = this.type, moved = this.moved;
        const ph = materials.phase;
        // Cleared EVERY tick. A mark that is only ever set makes a grain that
        // has once moved skip every second tick from then on, and nothing on
        // screen says so.
        moved.fill(0);
        const ltr = (this.tick & 1) === 0;

        for (let y = H - 1; y >= 0; y--) {
            for (let k = 0; k < W; k++) {
                const x = ltr ? k : W - 1 - k;
                const c = y * W + x;
                const m = type[c];
                if (m === 0 || moved[c]) continue;
                const p = ph[m];
                if (p === 0) continue;
                if (p === 3) { this.gas(x, y, c, m); continue; }

                const floor = y === H - 1;
                if (!floor && this.sink(c, c + W, m)) continue;
                const d = rng.next() < 0.5 ? -1 : 1;

                if (p === 1) {
                    // Powder: sometimes takes the diagonal, sometimes sits.
                    // Always taking it runs a heap out flat.
                    if (!floor && rng.next() < this.SLIP) {
                        if (this.diag(x, c, d, m)) continue;
                        this.diag(x, c, -d, m);
                    }
                    continue;
                }

                // Liquid: diagonals, then run sideways until something stops it.
                if (!floor && (this.diag(x, c, d, m) || this.diag(x, c, -d, m))) continue;
                let at = c, ax = x, ran = false;
                for (let i = 0; i < this.FLOW; i++) {
                    const nx = ax + d;
                    if (nx < 0 || nx >= W || type[at + d] !== 0) break;
                    this.move(at, at + d); at += d; ax = nx; ran = true;
                }
                // A molecule that is going nowhere still tumbles.
                if (!ran && rng.next() < 0.02) this.seed[c] = (rng.next() * 256) | 0;
            }
        }
    },

    gas(x, y, c, m) {
        const W = this.W, H = this.H, type = this.type;
        const up = materials.rise[m];               // -1 rises, +1 pools on the floor
        const r = rng.next();
        let nx = x, ny = y;
        if (r < 0.45) ny += up;
        else if (r < 0.80) nx += rng.next() < 0.5 ? -1 : 1;
        else if (r < 0.92) { ny += up; nx += rng.next() < 0.5 ? -1 : 1; }
        else { this.seed[c] = (rng.next() * 256) | 0; return; }
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) return;
        const t = ny * W + nx, tm = type[t];
        if (tm === 0) { this.move(c, t); return; }
        // A light gas bubbles up through a liquid.
        if (up < 0 && ny < y && !this.moved[t] && materials.phase[tm] === 2) this.swap(c, t);
    },

    count() {
        let n = 0;
        for (let i = 0; i < this.type.length; i++) if (this.type[i]) n++;
        return n;
    }
};

grid.init();
