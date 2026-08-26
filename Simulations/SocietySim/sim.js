/* SocietySim — the simulation core.
 *
 * Pure logic. No DOM, no canvas, no timers, no rendering. Everything in here is
 * a function of (seed, params, tick count) and nothing else, so the same seed
 * and the same parameters replay the same society down to the last agent.
 *
 * Agent storage is struct-of-arrays over fixed-size typed arrays. The arrays
 * never grow: MAX_AGENTS slots are allocated once and recycled through a free
 * list, so a birth is a pop and a death is a push. That is what keeps 10,000
 * agents in cache and off the garbage collector.
 */
'use strict';

const SIM_VERSION = '0.1.0';

/* ----------------------------------------------------------- Dimensions --- */

const WORLD_W = 1600;
const WORLD_H = 1000;
const CELL = 10;                       // world units per land cell
const GW = (WORLD_W / CELL) | 0;       // 160
const GH = (WORLD_H / CELL) | 0;       // 100
const NCELL = GW * GH;                 // 16,000
const INV_CELL = 1 / CELL;
const XMAX = WORLD_W - 0.001;
const YMAX = WORLD_H - 0.001;

const MAX_AGENTS = 10000;
const TPY = 64;                        // ticks per year
const MAX_AGE = 120 * TPY;             // hazard table length; nobody gets here

/* Headings are integer indices into a trig table rather than radians. Turning
   becomes integer addition and the whole movement step is table lookups — no
   Math.cos in a loop that runs ten thousand times a tick. */
const DIRS = 1024;
const DMASK = DIRS - 1;
const COS = new Float32Array(DIRS);
const SIN = new Float32Array(DIRS);
for (let i = 0; i < DIRS; i++) {
    const a = (i / DIRS) * 6.283185307179586;
    COS[i] = Math.cos(a);
    SIN[i] = Math.sin(a);
}

const ROLES = ['Farmer'];
const ROLE_FARMER = 0;

/* ------------------------------------------------------------- Tunables --- */

const P = {
    seed: 20260826,
    startPop: 1500,

    /* Land. Standing crop in a cell relaxes toward that cell's fertility, which
       is its carrying capacity. Total food the world produces per tick, once
       grazing has flattened the crop, is regrow x (sum of fertility) — which is
       what actually sets the population ceiling. */
    regrow: 0.023,
    harvestMax: 0.075,     // what an average-metabolism farmer lifts per tick
    harvestFloor: 0.015,   // below this a cell is not worth stopping for

    /* Movement. Three probes ahead, steer toward the richest — the same sensor
       trick slime moulds are simulated with. It costs three array reads and
       makes the swarm find and crowd the fertile ground on its own. */
    speed: 2.3,
    workSpeed: 0.22,       // speed multiplier while working a cell
    senseDist: 17,
    senseSpread: 96,       // trig-table steps between probes (~34 degrees)
    turnStep: 44,          // steer authority per tick (~15 degrees)
    wanderStep: 26,        // random heading jitter per tick

    /* Metabolism, drawn at birth and inherited with drift. This is the only
       heritable trait so far, and it is under real selection — but not in one
       direction, because how much a farmer burns also sets how much they can
       lift (see hScale in tick). A big body outworks a small one on rich
       ground and starves beside it on poor ground, so the population settles
       on an interior optimum instead of racing to the cheapest possible body. */
    metMean: 0.022,
    metSigma: 0.22,
    metMutate: 0.055,
    metMin: 0.006,
    metMax: 0.070,

    /* Food is the perishable belly. Capital is the granary: surplus above
       storeAbove is set aside at a loss, and drawn back down when the belly
       runs low. Deferred consumption is the whole seed of an economy. */
    bellyMax: 4.0,
    storeAbove: 2.0,
    storeRate: 0.055,
    storeEff: 0.85,
    drawBelow: 0.9,
    drawRate: 0.07,

    /* Life. Reproduction is paid for out of capital, which is what makes stored
       wealth worth anything and puts the poor at a fertility disadvantage. */
    maturity: 15 * TPY,
    birthCapital: 3.2,
    birthFood: 1.6,
    birthEndow: 1.3,

    /* Gompertz mortality: flat until mortStart, then doubling every mortScale
       ticks. No per-agent lifespan array needed. */
    mortStart: 30 * TPY,
    mortBase: 2.0e-5,
    mortScale: 6 * TPY
};

/* ----------------------------------------------------------------- Land --- */

function smoothstep(t) { return t * t * (3 - 2 * t); }

function addOctave(out, s, fx, fy, amp) {
    const lw = fx + 1;
    const lat = new Float32Array(lw * (fy + 1));
    for (let i = 0; i < lat.length; i++) lat[i] = s.rand();

    const sx = fx / GW, sy = fy / GH;
    for (let gy = 0; gy < GH; gy++) {
        const v = gy * sy;
        let y0 = v | 0; if (y0 > fy - 1) y0 = fy - 1;
        const ty = smoothstep(v - y0);
        const r0 = y0 * lw, r1 = r0 + lw;
        for (let gx = 0; gx < GW; gx++) {
            const u = gx * sx;
            let x0 = u | 0; if (x0 > fx - 1) x0 = fx - 1;
            const tx = smoothstep(u - x0);
            const a = lat[r0 + x0], b = lat[r0 + x0 + 1];
            const c = lat[r1 + x0], d = lat[r1 + x0 + 1];
            const top = a + (b - a) * tx;
            const bot = c + (d - c) * tx;
            out[gy * GW + gx] += amp * (top + (bot - top) * ty);
        }
    }
}

function buildLand(fert, s) {
    const tmp = new Float32Array(NCELL);
    const octaves = [[4, 3], [8, 5], [16, 10], [32, 20]];
    let amp = 1, norm = 0;
    for (let o = 0; o < octaves.length; o++) {
        addOctave(tmp, s, octaves[o][0], octaves[o][1], amp);
        norm += amp;
        amp *= 0.5;
    }
    /* Rescaled hard so a good part of the map is genuinely barren. A world of
       uniformly middling soil gives an evenly smeared population and nothing to
       congregate around. */
    for (let c = 0; c < NCELL; c++) {
        let v = (tmp[c] / norm - 0.36) / 0.40;
        if (v < 0) v = 0; else if (v > 1) v = 1;
        fert[c] = smoothstep(v);
    }
}

/* ------------------------------------------------------------------ Sim --- */

const sim = {
    VERSION: SIM_VERSION,
    W: WORLD_W, H: WORLD_H,
    GW: GW, GH: GH, CELL: CELL, NCELL: NCELL,
    MAX_AGENTS: MAX_AGENTS,
    TPY: TPY,
    ROLES: ROLES,
    P: P,

    /* land */
    fert: new Float32Array(NCELL),
    crop: new Float32Array(NCELL),

    /* agents, struct-of-arrays */
    x: new Float32Array(MAX_AGENTS),
    y: new Float32Array(MAX_AGENTS),
    dir: new Int16Array(MAX_AGENTS),
    food: new Float32Array(MAX_AGENTS),
    capital: new Float32Array(MAX_AGENTS),
    met: new Float32Array(MAX_AGENTS),
    age: new Int32Array(MAX_AGENTS),
    role: new Uint8Array(MAX_AGENTS),
    alive: new Uint8Array(MAX_AGENTS),

    /* bookkeeping */
    tickCount: 0,
    pop: 0,
    totalBirths: 0,
    totalStarved: 0,
    totalAged: 0,
    births: 0,          // this tick
    starved: 0,
    aged: 0,
    denied: 0,          // births the slot cap refused
    capped: false,
    harvested: 0,
    cropTotal: 0,
    sumFood: 0,
    sumCapital: 0,
    sumMet: 0,

    /* mulberry32, held as a single integer so the hot loop can inline the
       recurrence instead of paying for a closure call twice per agent. Every
       draw in the simulation — land, founders, wander, mortality, birth —
       comes off this one stream, in slot order, so the run is reproducible. */
    _rs: 0,
    _seed: P.seed,

    _free: new Int32Array(MAX_AGENTS),
    _freeN: 0,
    _bq: new Int32Array(MAX_AGENTS),
    _bqN: 0,
    /* Gompertz hazard, precomputed per age in ticks. The curve depends on
       nothing but age, and evaluating Math.exp for every agent every tick cost
       more than the land update and the movement put together. */
    _hazard: new Float32Array(MAX_AGE),

    rand() {
        let a = (this._rs + 0x6D2B79F5) | 0;
        this._rs = a;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },

    /* Box-Muller, second variate discarded. Cold path only — births and
       founders — so the waste costs nothing and the draw count stays fixed. */
    gauss() {
        const u = 1 - this.rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * this.rand());
    },

    /* ------------------------------------------------------------ reset -- */

    reset(seed) {
        if (seed !== undefined) this._seed = seed | 0;
        this._rs = this._seed | 0;

        buildLand(this.fert, this);
        this.crop.set(this.fert);
        this._buildHazard();

        this.alive.fill(0);
        this.tickCount = 0;
        this.totalBirths = 0;
        this.totalStarved = 0;
        this.totalAged = 0;
        this.births = this.starved = this.aged = this.denied = 0;
        this.capped = false;
        this.harvested = 0;

        /* Free list holds every slot, high index first, so the first births
           come off the low end and the array stays packed early on. */
        this._freeN = 0;
        for (let i = MAX_AGENTS - 1; i >= 0; i--) this._free[this._freeN++] = i;

        const n = Math.min(P.startPop, MAX_AGENTS);
        for (let k = 0; k < n; k++) {
            const i = this._free[--this._freeN];
            /* Rejection-sample onto ground worth farming. A founder dropped in
               a desert is a fair outcome; a whole cohort of them is not. */
            let px = 0, py = 0;
            for (let t = 0; t < 12; t++) {
                px = this.rand() * XMAX;
                py = this.rand() * YMAX;
                if (this.fert[((py * INV_CELL) | 0) * GW + ((px * INV_CELL) | 0)] > 0.25) break;
            }
            this.x[i] = px;
            this.y[i] = py;
            this.dir[i] = (this.rand() * DIRS) | 0;
            this.food[i] = 1.4 + this.rand() * 1.4;
            this.capital[i] = this.rand() * 1.2;
            let m = P.metMean * Math.exp(this.gauss() * P.metSigma);
            if (m < P.metMin) m = P.metMin; else if (m > P.metMax) m = P.metMax;
            this.met[i] = m;
            /* Ages spread across the working span so the founders do not all
               reach the grave in the same decade. */
            this.age[i] = (this.rand() * 30 * TPY) | 0;
            this.role[i] = ROLE_FARMER;
            this.alive[i] = 1;
        }
        this.pop = n;
        this._recount();
        return this;
    },

    /* ------------------------------------------------------------- tick -- */

    tick() {
        const p = this.P;
        const fert = this.fert, crop = this.crop;
        const X = this.x, Y = this.y, D = this.dir;
        const F = this.food, C = this.capital, M = this.met, A = this.age;
        const AL = this.alive;
        const haz = this._hazard;

        /* --- the land regrows --- */
        const rg = p.regrow;
        let cropTotal = 0;
        for (let c = 0; c < NCELL; c++) {
            const v = crop[c] + rg * (fert[c] - crop[c]);
            crop[c] = v;
            cropTotal += v;
        }
        this.cropTotal = cropTotal;

        const sd = p.senseDist, spread = p.senseSpread;
        const turn = p.turnStep, wob = p.wanderStep;
        const spd = p.speed, wspd = p.speed * p.workSpeed;
        const hFloor = p.harvestFloor;
        /* What a farmer can lift scales with what they burn. This is the price
           of a cheap metabolism and the reason it does not simply fall forever. */
        const hScale = p.harvestMax / p.metMean;
        const above = p.storeAbove, sRate = p.storeRate, sEff = p.storeEff;
        const below = p.drawBelow, dRate = p.drawRate, belly = p.bellyMax;

        let pop = 0, sf = 0, sc = 0, sm = 0, harvested = 0;
        let starved = 0, aged = 0;
        this._bqN = 0;

        let rs = this._rs;      /* PRNG state, inlined below */

        for (let i = 0; i < MAX_AGENTS; i++) {
            if (AL[i] === 0) continue;

            let x = X[i], y = Y[i], d = D[i];

            /* --- look ahead: left, straight, right --- */
            const dl = (d - spread) & DMASK, dr = (d + spread) & DMASK;

            let px = x + COS[d] * sd, py = y + SIN[d] * sd;
            let cx = (px * INV_CELL) | 0, cy = (py * INV_CELL) | 0;
            if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
            if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
            const sC = crop[cy * GW + cx];

            px = x + COS[dl] * sd; py = y + SIN[dl] * sd;
            cx = (px * INV_CELL) | 0; cy = (py * INV_CELL) | 0;
            if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
            if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
            const sL = crop[cy * GW + cx];

            px = x + COS[dr] * sd; py = y + SIN[dr] * sd;
            cx = (px * INV_CELL) | 0; cy = (py * INV_CELL) | 0;
            if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
            if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
            const sR = crop[cy * GW + cx];

            if (sL > sC && sL >= sR) d = (d - turn) & DMASK;
            else if (sR > sC && sR > sL) d = (d + turn) & DMASK;

            /* mulberry32, inlined */
            rs = (rs + 0x6D2B79F5) | 0;
            let tw = Math.imul(rs ^ (rs >>> 15), 1 | rs);
            tw = (tw + Math.imul(tw ^ (tw >>> 7), 61 | tw)) ^ tw;
            const r1 = ((tw ^ (tw >>> 14)) >>> 0) / 4294967296;
            d = (d + (((r1 * 2 - 1) * wob) | 0)) & DMASK;

            /* --- work the ground underfoot --- */
            const ci = ((y * INV_CELL) | 0) * GW + ((x * INV_CELL) | 0);
            const standing = crop[ci];
            let speed = spd;
            if (standing > hFloor) {
                const lift = hScale * M[i];
                const take = standing < lift ? standing : lift;
                crop[ci] = standing - take;
                F[i] += take;
                harvested += take;
                speed = wspd;   /* a farmer working a rich cell lingers on it */
            }

            /* --- move, bouncing off the edges of the world --- */
            x += COS[d] * speed;
            y += SIN[d] * speed;
            if (x < 0) { x = 0; d = (512 - d) & DMASK; }
            else if (x > XMAX) { x = XMAX; d = (512 - d) & DMASK; }
            if (y < 0) { y = 0; d = (-d) & DMASK; }
            else if (y > YMAX) { y = YMAX; d = (-d) & DMASK; }
            X[i] = x; Y[i] = y; D[i] = d;

            /* --- eat, then bank or draw down --- */
            let f = F[i] - M[i];
            let cap = C[i];
            if (f > above) {
                let mv = f - above;
                if (mv > sRate) mv = sRate;
                f -= mv;
                cap += mv * sEff;
            } else if (f < below && cap > 0) {
                const mv = cap < dRate ? cap : dRate;
                cap -= mv;
                f += mv;
            }
            if (f > belly) f = belly;

            if (f <= 0) { this._kill(i); starved++; continue; }

            let age = A[i] + 1;
            if (age >= MAX_AGE) age = MAX_AGE - 1;
            const h = haz[age];
            if (h > 0) {
                rs = (rs + 0x6D2B79F5) | 0;
                let tm = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                tm = (tm + Math.imul(tm ^ (tm >>> 7), 61 | tm)) ^ tm;
                if (((tm ^ (tm >>> 14)) >>> 0) / 4294967296 < h) {
                    this._kill(i); aged++; continue;
                }
            }

            F[i] = f; C[i] = cap; A[i] = age;

            /* Births are queued, not spawned here: a child dropped into a slot
               above i would otherwise be updated again in the same tick. */
            if (age >= p.maturity && cap >= p.birthCapital && f >= p.birthFood) {
                this._bq[this._bqN++] = i;
            }

            pop++; sf += f; sc += cap; sm += M[i];
        }

        this._rs = rs;   /* hand the stream back before any cold-path draws */

        /* --- births --- */
        let born = 0, denied = 0;
        for (let k = 0; k < this._bqN; k++) {
            if (this._freeN === 0) { denied = this._bqN - k; break; }
            const par = this._bq[k];
            const j = this._free[--this._freeN];
            C[par] -= p.birthCapital;

            X[j] = X[par]; Y[j] = Y[par];
            D[j] = (this.rand() * DIRS) | 0;
            F[j] = p.birthEndow;
            C[j] = 0;
            let m = M[par] * Math.exp(this.gauss() * p.metMutate);
            if (m < p.metMin) m = p.metMin; else if (m > p.metMax) m = p.metMax;
            M[j] = m;
            A[j] = 0;
            this.role[j] = ROLE_FARMER;
            AL[j] = 1;

            born++; pop++; sf += F[j]; sm += m;
        }

        this.pop = pop;
        this.births = born;
        this.starved = starved;
        this.aged = aged;
        this.denied = denied;
        this.capped = denied > 0;
        this.harvested = harvested;
        this.sumFood = sf;
        this.sumCapital = sc;
        this.sumMet = sm;
        this.totalBirths += born;
        this.totalStarved += starved;
        this.totalAged += aged;
        this.tickCount++;
    },

    /* ----------------------------------------------------------- helpers -- */

    _kill(i) {
        this.alive[i] = 0;
        this._free[this._freeN++] = i;
    },

    _buildHazard() {
        const p = this.P, h = this._hazard;
        for (let a = 0; a < MAX_AGE; a++) {
            if (a <= p.mortStart) { h[a] = 0; continue; }
            const v = p.mortBase * Math.exp((a - p.mortStart) / p.mortScale);
            h[a] = v > 1 ? 1 : v;
        }
    },

    _recount() {
        let n = 0, sf = 0, sc = 0, sm = 0, ct = 0;
        for (let i = 0; i < MAX_AGENTS; i++) {
            if (this.alive[i] === 0) continue;
            n++; sf += this.food[i]; sc += this.capital[i]; sm += this.met[i];
        }
        for (let c = 0; c < NCELL; c++) ct += this.crop[c];
        this.pop = n; this.sumFood = sf; this.sumCapital = sc;
        this.sumMet = sm; this.cropTotal = ct;
    },

    year() { return this.tickCount / TPY; },

    /* What the land can support, in agents: total food produced per tick once
       grazing has flattened the standing crop, divided by what one mouth costs.
       An upper bound — farmers spend part of their day walking, and the granary
       loses a share of everything put through it. */
    carryingCapacity() {
        let sumFert = 0;
        for (let c = 0; c < NCELL; c++) sumFert += this.fert[c];
        const met = this.pop > 0 ? this.sumMet / this.pop : this.P.metMean;
        return (this.P.regrow * sumFert) / met;
    },

    /* Nearest living agent to a world point, or -1. */
    agentAt(wx, wy, radius) {
        const r2 = radius * radius;
        let best = -1, bestD = r2;
        for (let i = 0; i < MAX_AGENTS; i++) {
            if (this.alive[i] === 0) continue;
            const dx = this.x[i] - wx, dy = this.y[i] - wy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = i; }
        }
        return best;
    }
};
