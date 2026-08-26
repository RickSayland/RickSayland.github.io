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
 *
 * v0.2 adds property. Cells can be owned; owners are Lords; farmers working an
 * owned cell hand over a share of what they lift. See "The bargain" below.
 */
'use strict';

const SIM_VERSION = '0.2.0';

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
const MAX_ESTATES = 384;
const TPY = 64;                        // ticks per year
const MAX_AGE = 120 * TPY;             // hazard table length; nobody gets here

/* Headings are integer indices into a trig table rather than radians. Turning
   becomes integer addition and the whole movement step is table lookups — no
   Math.cos in a loop that runs ten thousand times a tick. */
const DIRS = 1024;
const DMASK = DIRS - 1;
const DIR_PER_RAD = DIRS / 6.283185307179586;
const COS = new Float32Array(DIRS);
const SIN = new Float32Array(DIRS);
for (let i = 0; i < DIRS; i++) {
    const a = (i / DIRS) * 6.283185307179586;
    COS[i] = Math.cos(a);
    SIN[i] = Math.sin(a);
}

const ROLES = ['Farmer', 'Lord', 'Soldier'];
const ROLE_FARMER = 0;
const ROLE_LORD = 1;
const ROLE_SOLDIER = 2;

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

    /* Movement. Three probes ahead, steer toward the best — the same sensor
       trick slime moulds are simulated with. It costs six array reads and makes
       the swarm find and crowd the good ground on its own. */
    speed: 2.3,
    workSpeed: 0.22,       // speed multiplier while working a cell
    senseDist: 17,
    senseSpread: 96,       // trig-table steps between probes (~34 degrees)
    turnStep: 44,          // steer authority per tick (~15 degrees)
    wanderStep: 26,        // random heading jitter per tick

    /* Gregariousness. The probe scores a cell as crop + social x neighbours, so
       this is priced in crop: a grazed cell holds about 0.07, so social = 0.006
       means ten neighbours are worth roughly one cell's worth of food. Company
       is genuinely valuable to nobody here — it is a taste, and it costs, since
       a crowd eats the ground out from under itself. Turn it up and watch them
       clump hard enough to starve. */
    social: 0.006,

    /* Metabolism, drawn at birth and inherited with drift. This is the only
       heritable trait so far, and it is under real selection — but not in one
       direction, because how much a farmer burns also sets how much they can
       lift (see hScale in tick). A big body outworks a small one on rich
       ground and starves beside it on poor ground. */
    metMean: 0.022,
    metSigma: 0.22,
    metMutate: 0.055,
    /* metMin is a basal rate, not a knob to taste: a body cannot run on
       nothing. It is also what stops the population ceiling running away —
       capacity is production divided by metabolism, so a trait that only ever
       got cheaper would push the ceiling up without bound until the agent
       array, rather than the land, became the limit. */
    metMin: 0.012,
    metMax: 0.050,

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
       wealth worth anything and puts the poor at a fertility disadvantage.
       birthGap is load-bearing once anybody gets rich: without it a lord
       drawing half a unit of rent per tick buys a child every six ticks and
       floods the world inside a generation. */
    maturity: 15 * TPY,
    birthCapital: 3.2,
    birthFood: 1.6,
    birthEndow: 1.3,
    birthGap: 2 * TPY,

    /* Gompertz mortality: flat until mortStart, then doubling every mortScale
       ticks. No per-agent lifespan array needed. */
    mortStart: 30 * TPY,
    mortBase: 2.0e-5,
    mortScale: 6 * TPY,

    /* ---- Property (v0.2) ----
     *
     * The bargain. A lord's cells regrow (1 + improve) times faster — drainage,
     * irrigation, a granary, whatever you like — and a farmer working them
     * hands over rentShare of every load. Improvement is real: the land does
     * produce more. Whether a tenant is better off than a free farmer depends
     * on whether improve beats rentShare *after* the crowd that the richer
     * ground attracts has eaten its share, and that is not a question the
     * parameters answer on their own — it is what the run is for.
     *
     * Nothing tells a farmer to seek out a manor. The existing three-probe
     * sensor sees more crop on improved ground and walks toward it. Tenancy is
     * emergent; so are the borders, which sit where the crowding cancels the
     * improvement out.
     */
    claimMin: 8.0,         // capital a farmer must hold to enclose at all
    claimCost: 3.0,        // what enclosure costs. The gap is a working reserve:
                           // charge a new lord the lot and the first upkeep bill
                           // bankrupts him before a single rent is collected.
    claimFert: 0.30,       // won't enclose ground not worth owning
    claimRadius: 50,       // world units
    maxRadius: 110,
    seatGap: 92,           // minimum spacing between manors
    expandCost: 28,
    expandStep: 8,
    rentShare: 0.30,
    improve: 0.9,
    upkeep: 0.0015,        // capital per owned cell per tick
    lordSpeed: 0.5,
    seatHold: 18,          // a lord mills about within this of the manor
    lordLuxury: 2.5,       // a lord burns this multiple of their metabolism
    /* Wealth bleeds proportionally: station has to be maintained, and without
       it a solvent lord's capital grows without bound and the wealth panel
       becomes a graph of one number. Equilibrium is net income / lordDecay. */
    lordDecay: 0.0025,

    /* ---- Armies (v0.2) ----
     *
     * A title on its own collects nothing. Rent actually taken is rentShare x
     * enforcement, and enforcement is what the garrison can cover:
     *
     *     enforce = min(1, enforceBase + soldiers / (tenants x perTenant))
     *
     * enforceBase is deference — the share that comes in through custom, with
     * nobody standing over it. It is small, and it is also what lets a brand
     * new manor earn anything at all before it can afford a single soldier.
     *
     * Soldiers are recruited from the poorest grown farmer standing on the
     * estate, which is who takes a shilling in every century. They do not farm.
     * The wage is set just above what a body costs to run, so enlisting beats
     * subsistence — that is the whole reason anyone accepts — but it does not
     * make a soldier rich. An estate that cannot make payroll is marked broke
     * and its garrison walks, which is how a lord loses his grip in one season.
     *
     * The garrison also caps how much ground a lord can hold: you cannot
     * enforce a border you cannot walk. */
    enforceBase: 0.35,
    perTenant: 0.05,       // soldiers needed per tenant working the land
    /* What the lord pays and what the soldier receives are deliberately
       different numbers. The gap is arms, mounts and provisions: burned, not
       transferred. Keeping them equal makes one of two things impossible —
       either an army costs the lord too little to ever constrain him, or the
       wage is high enough that the garrison becomes the richest class in the
       country. Split, a company is genuinely expensive to keep and a soldier
       still only earns a living. */
    soldierCost: 0.10,     // capital per soldier per tick, out of the lord
    soldierWage: 0.022,    // capital per soldier per tick, into the soldier
    recruitBonus: 1.0,     // signing payment
    radiusPerSoldier: 6,   // ground a single soldier lets you hold
    soldierSpeed: 0.85,
    lordReserve: 2.5       // kept back before taking on another mouth
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
    MAX_ESTATES: MAX_ESTATES,
    TPY: TPY,
    ROLES: ROLES,
    P: P,

    /* land */
    fert: new Float32Array(NCELL),
    crop: new Float32Array(NCELL),
    owner: new Int16Array(NCELL),        // estate id, or -1

    /* Neighbour counts, double-buffered: the sensor reads last tick's field
       while this tick's is being written. One tick stale is invisible and it
       saves a whole extra pass over the population. */
    densR: new Int32Array(NCELL),
    densW: new Int32Array(NCELL),

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
    lastBirth: new Int32Array(MAX_AGENTS),
    estateOf: new Int16Array(MAX_AGENTS),   // if a Lord, which estate; else -1

    /* estates, struct-of-arrays. Cells store an estate id rather than an agent
       slot on purpose: slots are recycled, and a newborn dropped into a dead
       lord's slot would otherwise inherit a county. */
    eAlive: new Uint8Array(MAX_ESTATES),
    eLord: new Int32Array(MAX_ESTATES),
    eSeatX: new Float32Array(MAX_ESTATES),
    eSeatY: new Float32Array(MAX_ESTATES),
    eRadius: new Float32Array(MAX_ESTATES),
    eCells: new Int32Array(MAX_ESTATES),
    eRent: new Float32Array(MAX_ESTATES),      // accruing this tick
    eRentLast: new Float32Array(MAX_ESTATES),  // settled last tick
    eTenants: new Int32Array(MAX_ESTATES),
    eTenantsLast: new Int32Array(MAX_ESTATES),
    eBorn: new Int32Array(MAX_ESTATES),        // tick the manor was founded
    eSoldiers: new Int32Array(MAX_ESTATES),    // counted fresh each tick
    eGarrison: new Int32Array(MAX_ESTATES),    // last settled count
    eEnforce: new Float32Array(MAX_ESTATES),   // 0..1, applied to next tick's rent
    eBroke: new Uint8Array(MAX_ESTATES),       // in arrears
    /* Men still owed their discharge. A lord who misses payroll sheds only as
       many as the shortfall requires, one per soldier reached in slot order.
       Losing the whole company over a single bad season made the garrison
       oscillate — hire to strength, miss payroll, lose everyone, collect
       nothing, rehire — and that limit cycle is an artefact of the rule, not
       anything about armies. */
    eShed: new Int32Array(MAX_ESTATES),
    /* Best recruit seen this tick, filled opportunistically as farmers walk
       over owned ground. Free: the estate is owner[cell], so spotting a
       candidate is an array read inside a loop already running. */
    eCand: new Int32Array(MAX_ESTATES),
    eCandCap: new Float32Array(MAX_ESTATES),

    /* bookkeeping */
    tickCount: 0,
    pop: 0,
    lords: 0,
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
    /* property */
    estateCount: 0,
    ownedCells: 0,
    tenantCount: 0,
    rentFlow: 0,
    enclosures: 0,
    successions: 0,
    dissolutions: 0,
    soldiers: 0,
    garrisonTotal: 0,
    wageFlow: 0,
    recruits: 0,
    desertions: 0,
    meanEnforce: 0,

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
    _cq: new Int32Array(256),
    _cqN: 0,
    _eFree: new Int32Array(MAX_ESTATES),
    _eFreeN: 0,
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

        this.owner.fill(-1);
        this.densR.fill(0);
        this.densW.fill(0);
        this.alive.fill(0);
        this.estateOf.fill(-1);
        this.eAlive.fill(0);
        this.eCells.fill(0);
        this.eRent.fill(0);
        this.eRentLast.fill(0);
        this.eTenants.fill(0);
        this.eTenantsLast.fill(0);
        this.eSoldiers.fill(0);
        this.eGarrison.fill(0);
        this.eEnforce.fill(0);
        this.eBroke.fill(0);
        this.eShed.fill(0);
        this.eCand.fill(-1);
        this.eCandCap.fill(0);

        this.tickCount = 0;
        this.totalBirths = 0;
        this.totalStarved = 0;
        this.totalAged = 0;
        this.births = this.starved = this.aged = this.denied = 0;
        this.capped = false;
        this.harvested = 0;
        this.lords = 0;
        this.estateCount = this.ownedCells = this.tenantCount = 0;
        this.rentFlow = 0;
        this.enclosures = this.successions = this.dissolutions = 0;
        this.soldiers = 0;
        this.garrisonTotal = 0;
        this.wageFlow = 0;
        this.recruits = this.desertions = 0;
        this.meanEnforce = 0;

        this._eFreeN = 0;
        for (let e = MAX_ESTATES - 1; e >= 0; e--) this._eFree[this._eFreeN++] = e;

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
            this.estateOf[i] = -1;
            this.lastBirth[i] = -P.birthGap;
            this.alive[i] = 1;
        }
        this.pop = n;
        this._recount();
        return this;
    },

    /* ------------------------------------------------------------- tick -- */

    tick() {
        const p = this.P;
        const fert = this.fert, crop = this.crop, own = this.owner;
        const X = this.x, Y = this.y, D = this.dir;
        const F = this.food, C = this.capital, M = this.met, A = this.age;
        const AL = this.alive, RO = this.role, EST = this.estateOf;
        const haz = this._hazard;
        const densR = this.densR, densW = this.densW;
        const eRent = this.eRent, eTenants = this.eTenants, eLord = this.eLord;
        const eSeatX = this.eSeatX, eSeatY = this.eSeatY;
        const eAlive = this.eAlive, eShed = this.eShed, eEnforce = this.eEnforce;
        const eSoldiers = this.eSoldiers, eRadius = this.eRadius;
        const eCand = this.eCand, eCandCap = this.eCandCap;

        /* --- the land regrows, faster where somebody has improved it --- */
        const rg = p.regrow;
        const rgOwned = rg * (1 + p.improve);
        let cropTotal = 0;
        for (let c = 0; c < NCELL; c++) {
            const rate = own[c] >= 0 ? rgOwned : rg;
            const v = crop[c] + rate * (fert[c] - crop[c]);
            crop[c] = v;
            cropTotal += v;
            densW[c] = 0;
        }
        this.cropTotal = cropTotal;

        const sd = p.senseDist, spread = p.senseSpread;
        const turn = p.turnStep, wob = p.wanderStep;
        const spd = p.speed, wspd = p.speed * p.workSpeed, lspd = p.speed * p.lordSpeed;
        const hFloor = p.harvestFloor;
        /* What a farmer can lift scales with what they burn. This is the price
           of a cheap metabolism and the reason it does not simply fall forever. */
        const hScale = p.harvestMax / p.metMean;
        const socialW = p.social;
        const rentShare = p.rentShare;
        const above = p.storeAbove, sRate = p.storeRate, sEff = p.storeEff;
        const below = p.drawBelow, dRate = p.drawRate, belly = p.bellyMax;
        const lux = p.lordLuxury;
        const hold2 = p.seatHold * p.seatHold;
        const claimFert = p.claimFert;
        const maturity = p.maturity, birthGap = p.birthGap;
        const now = this.tickCount;

        const claimMin = p.claimMin;
        const lspdS = p.speed * p.soldierSpeed;
        const wage = p.soldierWage;
        let desertions = 0;

        let pop = 0, lords = 0, soldiers = 0, sf = 0, sc = 0, sm = 0, harvested = 0;
        let starved = 0, aged = 0;
        this._bqN = 0;
        this._cqN = 0;
        for (let e = 0; e < MAX_ESTATES; e++) { eCand[e] = -1; eCandCap[e] = 1e30; }

        let rs = this._rs;      /* PRNG state, inlined below */

        for (let i = 0; i < MAX_AGENTS; i++) {
            if (AL[i] === 0) continue;

            let x = X[i], y = Y[i], d = D[i];

            /* An estate that folded, or one that missed payroll, no longer has
               anybody in its service. Both cases land here as the same check. */
            let ro = RO[i];
            if (ro !== ROLE_FARMER) {
                const e = EST[i];
                let quit = false;
                if (e < 0 || eAlive[e] === 0) quit = true;
                else if (ro === ROLE_SOLDIER && eShed[e] > 0) { eShed[e]--; quit = true; }
                if (quit) {
                    if (ro === ROLE_SOLDIER) desertions++;
                    ro = ROLE_FARMER;
                    RO[i] = ROLE_FARMER;
                    EST[i] = -1;
                }
            }
            const isLord = ro === ROLE_LORD;
            const isSoldier = ro === ROLE_SOLDIER;
            let speed;

            if (isSoldier) {
                /* Patrol: keep inside the domain, otherwise drift. A garrison
                   is a presence spread over ground, not a formation. */
                const e = EST[i];
                const dx = eSeatX[e] - x, dy = eSeatY[e] - y;
                const patrol = eRadius[e] * 0.8;
                if (dx * dx + dy * dy > patrol * patrol) {
                    const want = ((Math.atan2(dy, dx) * DIR_PER_RAD) | 0) & DMASK;
                    let diff = (want - d) & DMASK;
                    if (diff > 512) diff -= DIRS;
                    if (diff > turn) diff = turn; else if (diff < -turn) diff = -turn;
                    d = (d + diff) & DMASK;
                }
                speed = lspdS;
                eSoldiers[e]++;
                /* Paid here, on the agent's own side of the ledger; the lord is
                   debited wage x troops in _settleEstates off the same count,
                   so the two halves cannot drift apart. */
                C[i] += wage;

                rs = (rs + 0x6D2B79F5) | 0;
                let ts = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                ts = (ts + Math.imul(ts ^ (ts >>> 7), 61 | ts)) ^ ts;
                const rsv = ((ts ^ (ts >>> 14)) >>> 0) / 4294967296;
                d = (d + (((rsv * 2 - 1) * wob) | 0)) & DMASK;

            } else if (isLord) {
                /* A lord does not forage. They keep to the manor and live on
                   rent, which is exactly why an estate with no tenants kills
                   its owner. */
                const e = EST[i];
                if (e >= 0) {
                    const dx = eSeatX[e] - x, dy = eSeatY[e] - y;
                    if (dx * dx + dy * dy > hold2) {
                        const want = ((Math.atan2(dy, dx) * DIR_PER_RAD) | 0) & DMASK;
                        let diff = (want - d) & DMASK;
                        if (diff > 512) diff -= DIRS;
                        if (diff > turn) diff = turn; else if (diff < -turn) diff = -turn;
                        d = (d + diff) & DMASK;
                    }
                }
                speed = lspd;

                rs = (rs + 0x6D2B79F5) | 0;
                let tl = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                tl = (tl + Math.imul(tl ^ (tl >>> 7), 61 | tl)) ^ tl;
                const rl = ((tl ^ (tl >>> 14)) >>> 0) / 4294967296;
                d = (d + (((rl * 2 - 1) * wob) | 0)) & DMASK;

            } else {
                /* --- look ahead: left, straight, right. The score is food plus
                   a taste for company; neither term alone produces a village. */
                const dl = (d - spread) & DMASK, dr = (d + spread) & DMASK;

                let px = x + COS[d] * sd, py = y + SIN[d] * sd;
                let cx = (px * INV_CELL) | 0, cy = (py * INV_CELL) | 0;
                if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
                if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
                let q = cy * GW + cx;
                const sC = crop[q] + socialW * densR[q];

                px = x + COS[dl] * sd; py = y + SIN[dl] * sd;
                cx = (px * INV_CELL) | 0; cy = (py * INV_CELL) | 0;
                if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
                if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
                q = cy * GW + cx;
                const sL = crop[q] + socialW * densR[q];

                px = x + COS[dr] * sd; py = y + SIN[dr] * sd;
                cx = (px * INV_CELL) | 0; cy = (py * INV_CELL) | 0;
                if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
                if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
                q = cy * GW + cx;
                const sR = crop[q] + socialW * densR[q];

                if (sL > sC && sL >= sR) d = (d - turn) & DMASK;
                else if (sR > sC && sR > sL) d = (d + turn) & DMASK;

                /* mulberry32, inlined */
                rs = (rs + 0x6D2B79F5) | 0;
                let tw = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                tw = (tw + Math.imul(tw ^ (tw >>> 7), 61 | tw)) ^ tw;
                const r1 = ((tw ^ (tw >>> 14)) >>> 0) / 4294967296;
                d = (d + (((r1 * 2 - 1) * wob) | 0)) & DMASK;

                /* --- work the ground underfoot, and pay the landlord --- */
                const ci = ((y * INV_CELL) | 0) * GW + ((x * INV_CELL) | 0);
                const standing = crop[ci];
                speed = spd;
                if (standing > hFloor) {
                    const lift = hScale * M[i];
                    const take = standing < lift ? standing : lift;
                    crop[ci] = standing - take;
                    harvested += take;
                    const o = own[ci];
                    if (o >= 0) {
                        /* Only what the garrison can actually collect. */
                        const rent = take * rentShare * eEnforce[o];
                        eRent[o] += rent;         /* credited after the loop */
                        eTenants[o]++;
                        F[i] += take - rent;
                    } else {
                        F[i] += take;
                    }
                    speed = wspd;   /* a farmer working a rich cell lingers */
                }

                const oc = own[ci];
                if (oc >= 0) {
                    /* Spotted while walking the lord's ground: the poorest
                       grown man on the estate is who takes the shilling. */
                    if (A[i] >= maturity && C[i] < eCandCap[oc]) {
                        eCandCap[oc] = C[i];
                        eCand[oc] = i;
                    }
                } else if (C[i] >= claimMin && A[i] >= maturity &&
                           fert[ci] > claimFert && this._cqN < 256) {
                    /* --- enclosure. Queued, because taking land changes the
                       field every later agent this tick is walking over. --- */
                    this._cq[this._cqN++] = i;
                }
            }

            /* --- move, bouncing off the edges of the world --- */
            x += COS[d] * speed;
            y += SIN[d] * speed;
            if (x < 0) { x = 0; d = (512 - d) & DMASK; }
            else if (x > XMAX) { x = XMAX; d = (512 - d) & DMASK; }
            if (y < 0) { y = 0; d = (-d) & DMASK; }
            else if (y > YMAX) { y = YMAX; d = (-d) & DMASK; }
            X[i] = x; Y[i] = y; D[i] = d;

            densW[((y * INV_CELL) | 0) * GW + ((x * INV_CELL) | 0)]++;

            /* --- eat, then bank or draw down --- */
            let f = F[i] - (isLord ? M[i] * lux : M[i]);
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
            if (age >= maturity && cap >= p.birthCapital && f >= p.birthFood &&
                now - this.lastBirth[i] >= birthGap) {
                this._bq[this._bqN++] = i;
            }

            pop++; sf += f; sc += cap; sm += M[i];
            if (isLord) lords++; else if (isSoldier) soldiers++;
        }

        this._rs = rs;   /* hand the stream back before any cold-path draws */

        /* Order matters from here. Enclosure first, so a new manor is on the
           map before rents settle. Estates next, so a dead lord's succession is
           resolved while his slot still reads as dead — births recycle slots,
           and a newborn must never wake up owning a county. */
        this._enclose();
        this._settleEstates();

        /* --- births --- */
        let born = 0, denied = 0;
        for (let k = 0; k < this._bqN; k++) {
            if (this._freeN === 0) { denied = this._bqN - k; break; }
            const par = this._bq[k];
            if (C[par] < p.birthCapital) continue;   /* spent it enclosing */
            const j = this._free[--this._freeN];
            C[par] -= p.birthCapital;
            this.lastBirth[par] = now;

            X[j] = X[par]; Y[j] = Y[par];
            D[j] = (this.rand() * DIRS) | 0;
            F[j] = p.birthEndow;
            C[j] = 0;
            let m = M[par] * Math.exp(this.gauss() * p.metMutate);
            if (m < p.metMin) m = p.metMin; else if (m > p.metMax) m = p.metMax;
            M[j] = m;
            A[j] = 0;
            RO[j] = ROLE_FARMER;      /* nobody is born a lord */
            EST[j] = -1;
            this.lastBirth[j] = now;
            AL[j] = 1;

            born++; pop++; sf += F[j]; sm += m;
        }

        /* swap the neighbour field: what was written is what the sensor reads */
        this.densR = densW;
        this.densW = densR;

        this.pop = pop;
        this.lords = lords;
        this.soldiers = soldiers;
        this.desertions += desertions;
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

    /* ------------------------------------------------------- property --- */

    _enclose() {
        const p = this.P, gap2 = p.seatGap * p.seatGap;
        for (let k = 0; k < this._cqN; k++) {
            if (this._eFreeN === 0) break;
            const i = this._cq[k];
            if (this.alive[i] === 0 || this.role[i] !== ROLE_FARMER) continue;
            if (this.capital[i] < p.claimMin) continue;
            const px = this.x[i], py = this.y[i];
            const ci = ((py * INV_CELL) | 0) * GW + ((px * INV_CELL) | 0);
            if (this.owner[ci] >= 0) continue;    /* claimed since queueing */

            let clear = true;
            for (let e = 0; e < MAX_ESTATES; e++) {
                if (this.eAlive[e] === 0) continue;
                const dx = this.eSeatX[e] - px, dy = this.eSeatY[e] - py;
                if (dx * dx + dy * dy < gap2) { clear = false; break; }
            }
            if (!clear) continue;

            const e = this._eFree[--this._eFreeN];
            this.eAlive[e] = 1;
            this.eLord[e] = i;
            this.eSeatX[e] = px;
            this.eSeatY[e] = py;
            this.eRadius[e] = p.claimRadius;
            this.eCells[e] = 0;
            this.eRent[e] = 0;
            this.eRentLast[e] = 0;
            this.eTenants[e] = 0;
            this.eTenantsLast[e] = 0;
            this.eBorn[e] = this.tickCount;
            this.eSoldiers[e] = 0;
            this.eGarrison[e] = 0;
            this.eBroke[e] = 0;
            this.eShed[e] = 0;
            /* Deference only, until he can afford a man. */
            this.eEnforce[e] = p.enforceBase;

            this.capital[i] -= p.claimCost;
            this.role[i] = ROLE_LORD;
            this.estateOf[i] = e;
            this._stamp(e);
            this.enclosures++;
        }
    },

    /* Claim every unowned cell whose centre falls inside the domain. Cells are
       never released except on dissolution, so the running count only grows. */
    _stamp(e) {
        const sx = this.eSeatX[e], sy = this.eSeatY[e], r = this.eRadius[e];
        const r2 = r * r, own = this.owner;
        let x0 = ((sx - r) * INV_CELL) | 0, x1 = ((sx + r) * INV_CELL) | 0;
        let y0 = ((sy - r) * INV_CELL) | 0, y1 = ((sy + r) * INV_CELL) | 0;
        if (x0 < 0) x0 = 0; if (x1 >= GW) x1 = GW - 1;
        if (y0 < 0) y0 = 0; if (y1 >= GH) y1 = GH - 1;
        let added = 0;
        for (let cy = y0; cy <= y1; cy++) {
            const dy = (cy + 0.5) * CELL - sy;
            const dy2 = dy * dy;
            const row = cy * GW;
            for (let cx = x0; cx <= x1; cx++) {
                const dx = (cx + 0.5) * CELL - sx;
                if (dx * dx + dy2 > r2) continue;
                const c = row + cx;
                if (own[c] < 0) { own[c] = e; added++; }
            }
        }
        this.eCells[e] += added;
    },

    _settleEstates() {
        const p = this.P, C = this.capital, AL = this.alive;
        let dissolved = false;
        let count = 0, cells = 0, tenants = 0, rent = 0, wages = 0;
        let garrison = 0, enforceSum = 0;

        for (let e = 0; e < MAX_ESTATES; e++) {
            if (this.eAlive[e] === 0) continue;

            let lord = this.eLord[e];
            if (AL[lord] === 0) {
                lord = this._succeed(e);
                if (lord < 0) { this._dissolve(e); dissolved = true; continue; }
            }

            const troops = this.eSoldiers[e];
            const tn = this.eTenants[e];
            const income = this.eRent[e];
            const payroll = p.soldierCost * troops;

            C[lord] += income - p.upkeep * this.eCells[e] - payroll;
            C[lord] -= C[lord] * p.lordDecay;      /* the cost of station */

            this.eRentLast[e] = income;
            this.eTenantsLast[e] = tn;
            this.eGarrison[e] = troops;
            rent += income;
            wages += payroll;
            tenants += tn;
            garrison += troops;
            this.eRent[e] = 0;
            this.eTenants[e] = 0;
            this.eSoldiers[e] = 0;

            /* Payroll missed. The garrison walks at the top of next tick, and
               with it goes the enforcement that was collecting the rent — a
               lord in arrears unravels in a season, not a generation. */
            if (C[lord] < 0) {
                const short = -C[lord];
                C[lord] = 0;
                if (troops > 0) {
                    let shed = Math.ceil(short / p.soldierCost);
                    if (shed > troops) shed = troops;
                    this.eShed[e] = shed;
                    this.eBroke[e] = 1;
                } else {
                    /* No army left to shed and still short: the manor folds and
                       the land returns to the commons. This is the only thing
                       stopping the map ending up quietly owned end to end. */
                    this._dissolve(e);
                    dissolved = true;
                    continue;
                }
            } else {
                this.eBroke[e] = 0;
            }

            /* What the garrison can hold, applied to next tick's collections. */
            const want = tn * p.perTenant;
            let enf = p.enforceBase + (want > 0 ? troops / want : 1);
            if (enf > 1) enf = 1;
            this.eEnforce[e] = enf;
            enforceSum += enf;

            /* Pay a signing bonus and take on the poorest man on the ground. */
            if (this.eBroke[e] === 0 && troops < Math.ceil(want) &&
                C[lord] >= p.lordReserve + p.recruitBonus) {
                const cand = this.eCand[e];
                if (cand >= 0 && AL[cand] === 1 && this.role[cand] === ROLE_FARMER) {
                    C[lord] -= p.recruitBonus;
                    C[cand] += p.recruitBonus;
                    this.role[cand] = ROLE_SOLDIER;
                    this.estateOf[cand] = e;
                    this.recruits++;
                }
            }

            /* A border is only as wide as the men who can walk it. */
            const allowed = Math.min(p.maxRadius,
                p.claimRadius + troops * p.radiusPerSoldier);
            if (this.eBroke[e] === 0 && C[lord] >= p.expandCost + p.lordReserve &&
                this.eRadius[e] < allowed) {
                C[lord] -= p.expandCost;
                const r = this.eRadius[e] + p.expandStep;
                this.eRadius[e] = r > allowed ? allowed : r;
                this._stamp(e);
            }

            count++;
            cells += this.eCells[e];
        }

        if (dissolved) {
            const own = this.owner, eAlive = this.eAlive;
            for (let c = 0; c < NCELL; c++) {
                const o = own[c];
                if (o >= 0 && eAlive[o] === 0) own[c] = -1;
            }
        }

        this.estateCount = count;
        this.ownedCells = cells;
        this.tenantCount = tenants;
        this.rentFlow = rent;
        this.wageFlow = wages;
        this.garrisonTotal = garrison;
        this.meanEnforce = count > 0 ? enforceSum / count : 0;
    },

    /* The wealthiest grown commoner standing on the estate takes it over. Not
       an heir — there is no lineage in the model yet — but it keeps a manor
       alive across its owner's death, which is what lets an estate outlast a
       person and start behaving like an institution. */
    _succeed(e) {
        const sx = this.eSeatX[e], sy = this.eSeatY[e];
        const r = this.eRadius[e], r2 = r * r;
        const maturity = this.P.maturity;
        let best = -1, bestCap = -1;
        for (let i = 0; i < MAX_AGENTS; i++) {
            if (this.alive[i] === 0 || this.role[i] !== ROLE_FARMER) continue;
            if (this.age[i] < maturity) continue;
            const dx = this.x[i] - sx, dy = this.y[i] - sy;
            if (dx * dx + dy * dy > r2) continue;
            if (this.capital[i] > bestCap) { bestCap = this.capital[i]; best = i; }
        }
        if (best < 0) return -1;
        this.role[best] = ROLE_LORD;
        this.estateOf[best] = e;
        this.eLord[e] = best;
        this.successions++;
        return best;
    },

    _dissolve(e) {
        const lord = this.eLord[e];
        if (lord >= 0 && this.alive[lord] === 1 && this.estateOf[lord] === e) {
            this.role[lord] = ROLE_FARMER;
            this.estateOf[lord] = -1;
        }
        this.eAlive[e] = 0;
        this.eCells[e] = 0;
        this.eRent[e] = 0;
        this.eTenants[e] = 0;
        this.eSoldiers[e] = 0;
        this.eShed[e] = 0;
        this._eFree[this._eFreeN++] = e;
        this.dissolutions++;
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
        let n = 0, lords = 0, soldiers = 0, sf = 0, sc = 0, sm = 0, ct = 0;
        for (let i = 0; i < MAX_AGENTS; i++) {
            if (this.alive[i] === 0) continue;
            n++; sf += this.food[i]; sc += this.capital[i]; sm += this.met[i];
            if (this.role[i] === ROLE_LORD) lords++;
            else if (this.role[i] === ROLE_SOLDIER) soldiers++;
        }
        for (let c = 0; c < NCELL; c++) ct += this.crop[c];
        this.pop = n; this.lords = lords; this.soldiers = soldiers;
        this.sumFood = sf; this.sumCapital = sc; this.sumMet = sm;
        this.cropTotal = ct;
    },

    year() { return this.tickCount / TPY; },

    /* What the land can support, in agents: total food produced per tick once
       grazing has flattened the standing crop, divided by what one mouth costs.
       Improved ground counts for more, so enclosure genuinely raises the
       ceiling — the question the run answers is who gets the difference. */
    carryingCapacity() {
        const p = this.P, own = this.owner, fert = this.fert;
        const rgOwned = p.regrow * (1 + p.improve);
        let prod = 0;
        for (let c = 0; c < NCELL; c++) {
            prod += (own[c] >= 0 ? rgOwned : p.regrow) * fert[c];
        }
        const met = this.pop > 0 ? this.sumMet / this.pop : p.metMean;
        return prod / met;
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
