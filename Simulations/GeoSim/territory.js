// ============ GEOPOLITICS SIMULATOR — TERRITORY ============
// Ownership lives on a lat/lon grid laid over the land mask. Nations expand
// outward from their capital, cell by cell, and stop where they run out of
// land or meet someone else's border.

const GRID_W = 240;                  // 1.5 degrees per cell
const GRID_H = 120;
const CELL_LON = 360 / GRID_W;
const CELL_LAT = 180 / GRID_H;

// ~11 cells/sec per nation, so a continent takes a couple of minutes to fill
// and the map as a whole takes several. Expansion is meant to be watched, not
// waited out.
const TICK_MS = 180;
const CLAIM_PER_TICK = 2;            // cells each nation claims per tick

const EARTH_R = 6371;                // km
const PEOPLE_PER_KM2 = 25;           // capacity at peak habitability
const POP_GROWTH = 0.006;            // fraction of the gap closed per tick
const INCOME_PER_MILLION = 8;        // § per tick per million people

// Cheap stand-in for habitability: falls off toward the poles, so grabbing
// tundra is worth far less than grabbing temperate land.
function habitability(lat) {
    return Math.max(0.05, Math.pow(Math.cos(lat * DEG), 1.2));
}

// Binary min-heap keyed by distance from the capital, so a nation always
// claims its nearest reachable land next and grows as a rough disc.
class MinHeap {
    constructor() { this.keys = []; this.vals = []; }
    get size() { return this.vals.length; }

    push(key, val) {
        const ks = this.keys, vs = this.vals;
        ks.push(key); vs.push(val);
        let i = vs.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (ks[p] <= ks[i]) break;
            const tk = ks[p]; ks[p] = ks[i]; ks[i] = tk;
            const tv = vs[p]; vs[p] = vs[i]; vs[i] = tv;
            i = p;
        }
    }

    pop() {
        const ks = this.keys, vs = this.vals;
        const top = vs[0];
        const lk = ks.pop(), lv = vs.pop();
        if (vs.length) {
            ks[0] = lk; vs[0] = lv;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 2 - 1;
                let s = i;
                if (l < vs.length && ks[l] < ks[s]) s = l;
                if (r < vs.length && ks[r] < ks[s]) s = r;
                if (s === i) break;
                const tk = ks[s]; ks[s] = ks[i]; ks[i] = tk;
                const tv = vs[s]; vs[s] = vs[i]; vs[i] = tv;
                i = s;
            }
        }
        return top;
    }
}

const territory = {
    owner: null,        // 0 = unclaimed, else nation id (index + 1)
    landCell: null,
    actors: [],
    timer: null,
    turn: 0,

    init() {
        const n = GRID_W * GRID_H;
        this.owner = new Uint8Array(n);
        this.landCell = new Uint8Array(n);

        // Cell centres drive growth; cell corners drive rendering.
        this.cx3 = new Float32Array(n * 3);
        this.rowArea = new Float64Array(GRID_H);
        this.rowHab = new Float64Array(GRID_H);

        for (let row = 0; row < GRID_H; row++) {
            const lat = 90 - (row + 0.5) * CELL_LAT;
            const latTop = (90 - row * CELL_LAT) * DEG;
            const latBot = (90 - (row + 1) * CELL_LAT) * DEG;
            this.rowArea[row] = EARTH_R * EARTH_R * (CELL_LON * DEG) *
                                (Math.sin(latTop) - Math.sin(latBot));
            this.rowHab[row] = habitability(lat);

            const phi = lat * DEG, cp = Math.cos(phi), sp = Math.sin(phi);
            for (let col = 0; col < GRID_W; col++) {
                const lon = -180 + (col + 0.5) * CELL_LON;
                const lam = lon * DEG;
                const i = row * GRID_W + col;
                this.cx3[i * 3]     = cp * Math.sin(lam);
                this.cx3[i * 3 + 1] = cp * Math.cos(lam);
                this.cx3[i * 3 + 2] = sp;
                this.landCell[i] = globe.isLand(lat, lon) ? 1 : 0;
            }
        }

        const cn = (GRID_W + 1) * (GRID_H + 1);
        this.kx = new Float32Array(cn);
        this.ky = new Float32Array(cn);
        this.kz = new Float32Array(cn);
        for (let row = 0; row <= GRID_H; row++) {
            const phi = (90 - row * CELL_LAT) * DEG;
            const cp = Math.cos(phi), sp = Math.sin(phi);
            for (let col = 0; col <= GRID_W; col++) {
                const lam = (-180 + col * CELL_LON) * DEG;
                const k = row * (GRID_W + 1) + col;
                this.kx[k] = cp * Math.sin(lam);
                this.ky[k] = cp * Math.cos(lam);
                this.kz[k] = sp;
            }
        }

        this.nbuf = new Int32Array(4);
        this.frontRow = new Uint8Array(GRID_W);
        this.byId = [];
        globe.landOverlay = ctx => this.render(ctx);
    },

    cellAt(lat, lon) {
        let row = Math.floor((90 - lat) / CELL_LAT);
        if (row < 0) row = 0; else if (row >= GRID_H) row = GRID_H - 1;
        const col = ((Math.floor((lon + 180) / CELL_LON) % GRID_W) + GRID_W) % GRID_W;
        return row * GRID_W + col;
    },

    neighbours(i) {
        const row = (i / GRID_W) | 0, col = i % GRID_W;
        const out = this.nbuf;
        let n = 0;
        out[n++] = row * GRID_W + ((col + 1) % GRID_W);
        out[n++] = row * GRID_W + ((col - 1 + GRID_W) % GRID_W);
        if (row > 0)           out[n++] = (row - 1) * GRID_W + col;
        if (row < GRID_H - 1)  out[n++] = (row + 1) * GRID_W + col;
        return n;
    },

    // ---- Growth ----

    activate(nation, id) {
        const seed = this.cellAt(nation.site.lat, nation.site.lon);
        const actor = {
            nation, id,
            heap: new MinHeap(),
            cells: 0,
            area: 0,
            capacity: 0,
            population: 0,
            income: 0,
            vx: 0, vy: 0, vz: 0,
            runs: [],       // reused each frame: row, colStart, colEnd triples
            edges: []       // reused each frame: corner index pairs
        };
        const v = this.cx3;
        actor.vx = v[seed * 3];
        actor.vy = v[seed * 3 + 1];
        actor.vz = v[seed * 3 + 2];

        // A capital can sit on a cell the coarse grid calls water (a narrow
        // peninsula, a small island). Seed it anyway so the nation is never
        // stillborn, and let growth spread from there.
        this.landCell[seed] = 1;
        actor.heap.push(0, seed);

        this.actors.push(actor);
        this.byId[id] = actor;
        nation.stats = actor;
        if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    },

    key(actor, cell) {
        const i = cell * 3, v = this.cx3;
        // Larger dot product means closer, so negate to get a min-heap key.
        return -(v[i] * actor.vx + v[i + 1] * actor.vy + v[i + 2] * actor.vz);
    },

    tick() {
        let grew = false;
        const n = this.actors.length;

        // Rotate who moves first so no nation systematically wins border races.
        for (let k = 0; k < n; k++) {
            const actor = this.actors[(this.turn + k) % n];
            let claimed = 0;
            while (claimed < CLAIM_PER_TICK && actor.heap.size) {
                const cell = actor.heap.pop();
                // Cells can be queued more than once, and a rival may have
                // taken this one first.
                if (this.owner[cell] !== 0 || !this.landCell[cell]) continue;

                this.owner[cell] = actor.id;
                actor.cells++;
                const row = (cell / GRID_W) | 0;
                actor.area += this.rowArea[row];
                actor.capacity += this.rowArea[row] * this.rowHab[row] * PEOPLE_PER_KM2;
                claimed++;

                const cnt = this.neighbours(cell);
                for (let j = 0; j < cnt; j++) {
                    const nb = this.nbuf[j];
                    if (this.owner[nb] === 0 && this.landCell[nb]) {
                        actor.heap.push(this.key(actor, nb), nb);
                    }
                }
            }
            if (claimed) grew = true;
        }
        this.turn++;

        // Population chases the land's capacity rather than snapping to it, so
        // freshly taken ground takes a while to be worth anything.
        for (const a of this.actors) {
            a.population += (a.capacity - a.population) * POP_GROWTH;
            a.income = a.population / 1e6 * INCOME_PER_MILLION;
        }

        if (grew) globe.dirty = true;
        if (typeof nations !== 'undefined') nations.updateStats();
        if (typeof budget !== 'undefined') budget.updateEconomy();
    },

    // ---- Rendering ----

    render(ctx) {
        if (!this.actors.length) return;
        const f = globe.frame;
        const cx = globe.cx, cy = globe.cy, R = globe.radius;
        const W1 = GRID_W + 1;
        const owner = this.owner, front = this.frontRow;

        // Pulled just inside the horizon so a cell straddling it cannot fold
        // over; at this angle the inset is a fraction of a pixel.
        const MARGIN = 0.03;

        for (const a of this.actors) { a.runs.length = 0; a.edges.length = 0; }

        // One pass over the grid for every nation at once, bucketing spans and
        // border edges by owner. Scanning per nation instead would re-read the
        // whole grid ten times a frame.
        for (let row = 0; row < GRID_H; row++) {
            const base = row * GRID_W, top = row * W1, bot = (row + 1) * W1;

            for (let col = 0; col < GRID_W; col++) {
                const j = (base + col) * 3;
                const z = this.cx3[j + 1] * f.cosRLon + this.cx3[j] * f.sinRLon;
                front[col] = this.cx3[j + 2] * f.sinRLat + z * f.cosRLat > MARGIN ? 1 : 0;
            }

            let col = 0;
            while (col < GRID_W) {
                const o = owner[base + col];
                if (!o || !front[col]) { col++; continue; }
                let end = col;
                while (end < GRID_W && owner[base + end] === o && front[end]) end++;
                const a = this.byId[o];
                if (a) a.runs.push(row, col, end);
                col = end;
            }

            for (let c = 0; c < GRID_W; c++) {
                const i = base + c, o = owner[i];
                if (!o || !front[c]) continue;
                const a = this.byId[o];
                if (!a) continue;
                if (owner[base + ((c + 1) % GRID_W)] !== o) a.edges.push(top + c + 1, bot + c + 1);
                if (owner[base + ((c - 1 + GRID_W) % GRID_W)] !== o) a.edges.push(top + c, bot + c);
                if (row === 0 || owner[i - GRID_W] !== o) a.edges.push(top + c, top + c + 1);
                if (row === GRID_H - 1 || owner[i + GRID_W] !== o) a.edges.push(bot + c, bot + c + 1);
            }
        }

        // Corner projection, inlined per use to avoid a call per vertex.
        const kx = this.kx, ky = this.ky, kz = this.kz;

        for (const a of this.actors) {
            const runs = a.runs;
            if (!runs.length) continue;

            // Runs of adjacent cells share their edge vertices, keeping the
            // vertex count near the territory's perimeter, not its area.
            ctx.beginPath();
            for (let k = 0; k < runs.length; k += 3) {
                const row = runs[k], c0 = runs[k + 1], c1 = runs[k + 2];
                const top = row * W1, bot = (row + 1) * W1;
                for (let c = c0; c <= c1; c++) {
                    const m = top + c;
                    const x = kx[m] * f.cosRLon - ky[m] * f.sinRLon;
                    const z = ky[m] * f.cosRLon + kx[m] * f.sinRLon;
                    const sx = cx + x * R;
                    const sy = cy - (kz[m] * f.cosRLat - z * f.sinRLat) * R;
                    c === c0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
                }
                for (let c = c1; c >= c0; c--) {
                    const m = bot + c;
                    const x = kx[m] * f.cosRLon - ky[m] * f.sinRLon;
                    const z = ky[m] * f.cosRLon + kx[m] * f.sinRLon;
                    ctx.lineTo(cx + x * R, cy - (kz[m] * f.cosRLat - z * f.sinRLat) * R);
                }
                ctx.closePath();
            }
            ctx.fillStyle = a.nation.color;
            ctx.globalAlpha = 0.4;
            ctx.fill();

            const edges = a.edges;
            ctx.beginPath();
            for (let k = 0; k < edges.length; k += 2) {
                for (let e = 0; e < 2; e++) {
                    const m = edges[k + e];
                    const x = kx[m] * f.cosRLon - ky[m] * f.sinRLon;
                    const z = ky[m] * f.cosRLon + kx[m] * f.sinRLon;
                    const sx = cx + x * R;
                    const sy = cy - (kz[m] * f.cosRLat - z * f.sinRLat) * R;
                    e ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
                }
            }
            ctx.strokeStyle = a.nation.color;
            ctx.globalAlpha = 0.9;
            ctx.lineWidth = 1.1;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
};
