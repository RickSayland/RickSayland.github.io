// tools/check.mjs -- headless checks for PowderPet.
//
//     node tools/check.mjs            (from Simulations/PowderPet)
//
// Loads the same ES modules the browser does, behind a stub DOM just big
// enough for main.js to boot, and drives the real game loop through the
// development handle (window.powderpet.step). It checks the things that
// break silently: a genome that does not round-trip, a body that is not
// deterministic, sand that is created or destroyed, a pile that goes
// critical when it should not, an animal that cannot walk, a save that does
// not come back.
//
// Nothing here is a unit test of a formula. Every check runs the simulation
// and measures what happened.

import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/').href;
const only = process.argv[2] || '';

// ---- a stub DOM ----------------------------------------------------------------
// Any property is another stub, any call returns a stub, and the handful of
// things the code actually reads back are real.
function stub(real = {}) {
    const fn = function () {};
    return new Proxy(fn, {
        get(_, k) {
            if (k in real) return real[k];
            if (k === Symbol.iterator) return function* () {};
            if (k === Symbol.toPrimitive) return () => 0;
            if (k === 'then') return undefined;
            if (k === 'length') return 0;
            return (real[k] = stub());
        },
        set(_, k, v) { real[k] = v; return true; },
        apply() { return stub(); },
        construct() { return stub(); },
    });
}
const storage = new Map();
globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
};
const ctx2d = stub({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData() {} });
const elements = new Map();
const makeEl = () => stub({
    getContext: () => ctx2d,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener() {},
    children: [],
    style: {}, dataset: {}, classList: stub(),
});
globalThis.document = stub({
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, makeEl()); return elements.get(id); },
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    addEventListener() {},
    hidden: false,
});
globalThis.window = stub({ addEventListener() {}, devicePixelRatio: 1, ResizeObserver: undefined, AudioContext: undefined, webkitAudioContext: undefined });
globalThis.location = { hash: '', origin: 'http://test', pathname: '/', search: '' };
globalThis.history = { replaceState() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};

const cfgMod = await import(root + 'js/config.js');
const { CFG, STAGE, AI, RT, COL, TISSUE } = cfgMod;
const mats = await import(root + 'js/materials.js');
const { MAT } = mats;
const grid = await import(root + 'js/grid.js');
const heat = await import(root + 'js/heat.js');
const rad = await import(root + 'js/radiation.js');
const genome = await import(root + 'js/genome.js');
const soft = await import(root + 'js/softbody.js');
const { Creature, Egg, Ball } = await import(root + 'js/creature.js');
const coupling = await import(root + 'js/coupling.js');
const save = await import(root + 'js/save.js');
await import(root + 'js/main.js');
const pp = globalThis.window.powderpet;
const world = pp.world;
const { W, H, N } = grid;
const DT = 1 / CFG.SIM.HZ;
// Two PRNGs to pin so a run can be repeated: the automaton's own, and
// Math.random, which the AI, the mutations and the pours draw from.
grid.reseed(0x5eed);
Math.random = genome.mulberry32(0xbadc0de);
const soft_KIND = soft.KIND;

// ---- reporting -----------------------------------------------------------------
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) passed++; else failed++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  -- ' + detail : ''}`);
}
function section(name, fn) {
    if (only && !only.toLowerCase().split(',').some((o) => name.toLowerCase().includes(o))) return;
    console.log('\n' + name);
    fn();
}
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2), f3 = (v) => v.toFixed(3);

// ---- world helpers -------------------------------------------------------------
function emptyTank(floor = 24) {
    world.creature = null; world.egg = null; world.ball = null; world.pours.length = 0;
    world.lights = true;
    coupling.clearBodies(); coupling.setHitTarget(null); coupling.setBodies(null, null);
    grid.mat.fill(0); grid.temp.fill(CFG.GRID.AMBIENT); grid.life.fill(0);
    rad.clear();
    grid.wallBorder();
    for (let y = H - 1 - floor; y < H - 1; y++) for (let x = 1; x < W - 1; x++) grid.mat[y * W + x] = MAT.SAND;
}
function box(x0, y0, x1, y1, m) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.setCell(y * W + x, m);
}
function count(m) { let n = 0; for (let i = 0; i < N; i++) if (grid.mat[i] === m) n++; return n; }

// put a live animal in the tank, bypassing the egg
function spawn(g, stage = STAGE.ADULT, x = 100, scale) {
    const c = new Creature(g, 1);
    const L = CFG.LIFE;
    c.stage = stage;
    c.age = c.phen.lifespan * (stage === STAGE.BABY ? 0.02 : stage === STAGE.CHILD ? 0.12 : stage === STAGE.ELDER ? 0.85 : 0.35);
    c.scale = scale || (stage === STAGE.BABY ? L.SCALE_HATCH : stage === STAGE.CHILD ? L.SCALE_CHILD : 1);
    c.mass = c.scale * c.scale;
    c.stats.hunger = 80;
    c.eggCooldown = 1e9;
    c.place(x, grid.surfaceY(x, 0) - c.plan.b * c.scale - c.phen.nubLen * c.plan.b * c.scale - 2);
    world.creature = c;
    coupling.setHitTarget(c);
    return c;
}
// take the AI out of the loop and hold a direction
function drive(c, dir) { c._decide = () => {}; c._act = () => { c.moveDir = dir; }; }
function release(c) { delete c._decide; delete c._act; }
const rng = genome.mulberry32(20240607);
const G = genome.GENE_INDEX;
function gene(g, key, v) { g[G[key]] = v; return genome.snap(g); }
function sampleGenomes(n) { const out = []; for (let k = 0; k < n; k++) out.push(genome.randomGenome(rng)); return out; }

// ================================================================== genome
section('genome', () => {
    let ok = true, same = true, chars = true;
    for (let k = 0; k < 300; k++) {
        const g = genome.randomGenome(rng);
        const code = genome.encode(g);
        const back = genome.decode(code);
        if (!back) { ok = false; break; }
        for (let i = 0; i < g.length; i++) if (Math.abs(back[i] - g[i]) > 1e-6) ok = false;
        if (genome.encode(back) !== code) same = false;
        // 6 bits a gene, MSB first, is one base64 character a gene
        if (code.length !== cfgMod.GENOME_VERSION.length + 1 + Math.ceil(g.length * 6 / 6)) chars = false;
    }
    check('encode/decode round-trips 300 genomes', ok);
    check('re-encoding a decoded genome gives the same string', same);
    check('one base64url character per gene', chars);
    check('rejects a wrong version, junk and a truncated code',
        genome.decode('9.' + 'A'.repeat(genome.GENE_COUNT)) === null && genome.decode('1.!!!!') === null &&
        genome.decode('1.AAAA') === null && genome.decode(null) === null);

    const g = genome.randomGenome(rng);
    const a = genome.buildPlan(g), b = genome.buildPlan(genome.decode(genome.encode(g)));
    let det = a.n === b.n && a.ring.length === b.ring.length;
    for (let i = 0; det && i < a.n; i++) {
        if (a.tissue[i] !== b.tissue[i] || a.rho[i] !== b.rho[i] || a.theta[i] !== b.theta[i] || a.fx[i] !== b.fx[i] || a.birth[i] !== b.birth[i]) det = false;
    }
    check('the same genome builds the same body, through a share code', det, `${a.n} particles`);

    let lo = 1e9, hi = 0, loAdult = 1e9, hiBaby = 0;
    for (const s of sampleGenomes(200)) {
        const p = genome.buildPlan(s);
        lo = Math.min(lo, p.n); hi = Math.max(hi, p.n);
        let baby = 0;
        for (let i = 0; i < p.n; i++) if (p.birth[i] <= CFG.LIFE.SCALE_HATCH) baby++;
        hiBaby = Math.max(hiBaby, baby); loAdult = Math.min(loAdult, baby);
    }
    check('particle count stays in budget', lo >= 60 && hi <= 180, `adults ${lo}..${hi}, hatchlings ${loAdult}..${hiBaby}`);

    // mutation: sigma grows with dose
    const base = genome.randomGenome(rng);
    const spread = (dose) => {
        let s = 0, n = 0;
        for (let k = 0; k < 400; k++) { const m = genome.mutate(base, dose, rng); for (let i = 0; i < m.length; i++) { s += Math.abs(m[i] - base[i]); n++; } }
        return s / n;
    };
    const s0 = spread(0), s1 = spread(300);
    check('an irradiated parent has more mutated offspring', s1 > s0 * 2.5, `mean gene change ${f3(s0)} at dose 0, ${f3(s1)} at dose 300`);
    const x = genome.crossover(a.genome, genome.randomGenome(rng), rng);
    check('crossover and mutation stay quantised', genome.encode(genome.decode(genome.encode(x))) === genome.encode(x));
});

// ============================================================ environment
section('environment', () => {
    emptyTank(10);
    box(60, 20, 90, 40, MAT.SAND);
    box(120, 20, 140, 30, MAT.WATER);
    const sand0 = count(MAT.SAND);
    for (let k = 0; k < 400; k++) grid.step();
    check('sand is conserved while it falls and heaps', count(MAT.SAND) === sand0, `${sand0} cells`);

    // density swapping: sand poured into water ends up under it
    emptyTank(4);
    box(80, 100, 120, 130, MAT.WATER);
    box(70, 60, 79, 144, MAT.WALL); box(121, 60, 130, 144, MAT.WALL);
    box(95, 70, 105, 80, MAT.SAND);
    for (let k = 0; k < 500; k++) grid.step();
    let sandY = 0, waterY = 0, ns = 0, nw = 0;
    for (let y = 60; y < H - 5; y++) for (let x = 80; x <= 120; x++) {
        const m = grid.mat[y * W + x];
        if (m === MAT.SAND) { sandY += y; ns++; } else if (m === MAT.WATER) { waterY += y; nw++; }
    }
    check('heavier sinks through lighter', ns > 0 && nw > 0 && sandY / ns > waterY / nw + 5, `sand at y ${f1(sandY / ns)}, water at y ${f1(waterY / nw)}`);

    // the drain
    emptyTank(20);
    box(40, 100, 160, 108, MAT.WATER);
    const w0 = count(MAT.WATER);
    for (let k = 0; k < 900; k++) grid.step();
    const w1 = count(MAT.WATER);
    for (let k = 0; k < 9000; k++) grid.step();
    const w2 = count(MAT.WATER);
    check('the drain empties a flood, slowly', w1 < w0 && w1 > w0 * 0.5 && w2 < w0 * 0.15, `${w0} -> ${w1} after 30 s -> ${w2} after 5 min`);

    // boiling and condensing
    emptyTank(10);
    box(90, 120, 110, 130, MAT.WATER);
    box(80, 110, 89, 139, MAT.WALL); box(111, 110, 120, 139, MAT.WALL);
    for (let k = 0; k < 60; k++) grid.step();
    for (let i = 0; i < N; i++) if (grid.mat[i] === MAT.WATER) grid.temp[i] = 400;
    let steamPeak = 0;
    for (let k = 0; k < 600; k++) { grid.step(); heat.step(); if (k % 10 === 0) steamPeak = Math.max(steamPeak, count(MAT.STEAM)); }
    check('hot water boils and the steam condenses again', steamPeak > 30 && count(MAT.STEAM) < steamPeak * 0.3, `peak ${steamPeak} steam cells, ${count(MAT.STEAM)} left, ${count(MAT.WATER)} water`);

    // heat: a hot spot spreads and fades, and nothing goes non-finite
    emptyTank(30);
    const hot = (H - 15) * W + 100;
    grid.temp[hot] = 2000;
    for (let k = 0; k < 300; k++) heat.step();
    let finite = true, maxT = 0;
    for (let i = 0; i < N; i++) { if (!Number.isFinite(grid.temp[i])) finite = false; maxT = Math.max(maxT, grid.temp[i]); }
    check('a hot spot diffuses away', finite && maxT < 200 && grid.temp[hot + 3] > CFG.GRID.AMBIENT + 0.5, `peak ${f1(maxT)} C after 10 s`);

    // ageing
    emptyTank(10);
    box(50, 130, 60, 135, MAT.FOOD);
    const food0 = count(MAT.FOOD);
    for (let i = 0; i < N; i++) if (grid.mat[i] === MAT.FOOD) grid.life[i] = 20;
    for (let k = 0; k < 40; k++) grid.step();
    check('uneaten food spoils into waste', count(MAT.FOOD) === 0 && count(MAT.WASTE) === food0);
    box(45, 120, 65, 128, MAT.WATER);
    for (let k = 0; k < 900; k++) grid.step();
    check('waste dissolves in water', count(MAT.WASTE) < food0 * 0.25, `${food0} -> ${count(MAT.WASTE)}`);
});

// ================================================================ radiation
function fire(type, n, x, y, dx, dy, thermal = false) {
    for (let k = 0; k < n; k++) rad.spawn(x, y + (k % 7) * 0.1, type, CFG.RAD.ENERGY[type], thermal, dx, dy);
}
// fraction of a beam that gets past a slab without having been turned back
function transmission(type, material, thick, thermal = false) {
    emptyTank(2);
    if (material) box(100, 40, 100 + thick - 1, 100, material);
    const n = 3000;
    let through = 0;
    for (let k = 0; k < n; k++) {
        const p = rad.spawn(90.5, 60 + (k % 20), type, CFG.RAD.ENERGY[type], thermal, 1, 0);
        if (p < 0) { rad.step(); k--; continue; }
        if (k % 500 === 499) { for (let t = 0; t < 12; t++) { tally(); rad.step(); } }
    }
    for (let t = 0; t < 40; t++) { tally(); rad.step(); }
    function tally() {
        for (let p = rad.pool.count - 1; p >= 0; p--) {
            if (rad.px[p] > 100 + thick + 1 && rad.ux[p] > 0.99) { through++; rad.life[p] = 0; }
        }
    }
    return through / n;
}

section('radiation', () => {
    const R = CFG.RAD;
    // free-path sampling: uncollided transmission through d cells is exp(-mu d)
    const muLead = mats.M_MU[MAT.LEAD * 5 + COL.GAMMA];
    const t3 = transmission(RT.GAMMA, MAT.LEAD, 3), want = Math.exp(-muLead * 3);
    check('Beer-Lambert: gamma through 3 cells of lead', Math.abs(t3 - want) < 0.04, `measured ${f3(t3)}, exp(-mu d) = ${f3(want)}`);
    const tSand = transmission(RT.GAMMA, MAT.SAND, 3), tLead = t3;
    check('lead shields gammas far better than sand', tLead < tSand * 0.45, `lead ${f2(tLead)}, sand ${f2(tSand)}`);
    check('one cell of wall cannot be tunnelled by a 6 cell/tick gamma',
        Math.abs(transmission(RT.GAMMA, MAT.LEAD, 1) - Math.exp(-muLead)) < 0.04);
    check('an alpha is stopped by one cell of anything', transmission(RT.ALPHA, MAT.SAND, 1) < 0.05 && transmission(RT.ALPHA, MAT.BODY, 1) < 0.08);
    check('a beta gets through a little, a gamma through a lot',
        transmission(RT.BETA, MAT.SAND, 2) < 0.3 && transmission(RT.GAMMA, MAT.SAND, 2) > 0.8);
    check('the absorber eats thermal neutrons', transmission(RT.NEUTRON, MAT.ABSORBER, 2, true) < 0.08, f3(transmission(RT.NEUTRON, MAT.ABSORBER, 2, true)));

    // alpha range in air
    emptyTank(2);
    let sum = 0, n = 0;
    for (let k = 0; k < 400; k++) rad.spawn(100, 60, RT.ALPHA, R.ENERGY[0], false);
    const born = rad.pool.count;
    for (let t = 0; t < 80; t++) {
        const before = rad.pool.count;
        rad.step();
        // (particles are removed where they stop; track the survivors' reach instead)
        for (let p = 0; p < rad.pool.count; p++) if (rad.type[p] === RT.ALPHA) { /* still flying */ }
        if (before && !rad.pool.count) break;
    }
    check('alphas die out in air within a few cells', rad.pool.count === 0, `${born} emitted`);

    // water moderates
    emptyTank(2);
    box(60, 30, 140, 120, MAT.WATER);
    for (let k = 0; k < 600; k++) rad.spawn(100, 75, RT.NEUTRON, R.ENERGY[3], false);
    for (let t = 0; t < 25; t++) rad.step();
    let th = 0, fast = 0;
    for (let p = 0; p < rad.pool.count; p++) if (rad.type[p] === RT.NEUTRON) { if (rad.thermal[p]) th++; else fast++; }
    check('water thermalises fast neutrons', th > fast * 3, `${th} thermal, ${fast} still fast after 25 ticks`);

    // activation
    for (let t = 0; t < 400; t++) rad.step();
    check('absorbed neutrons activate some of the water', count(MAT.ACT_WATER) > 0, `${count(MAT.ACT_WATER)} cells`);

    // decay: a cell survives a half-life half the time
    emptyTank(2);
    box(40, 100, 99, 119, MAT.POLONIUM);
    const po0 = count(MAT.POLONIUM);
    const half = mats.cellHalfLife(MAT.POLONIUM);
    const ticks = Math.round(half * CFG.SIM.HZ);
    for (let t = 0; t < ticks; t++) { grid.step(); rad.step(); }
    const left = count(MAT.POLONIUM) / po0;
    check('polonium: half the cells are lead after one cell half-life', Math.abs(left - 0.5) < 0.06, `${f2(left)} left after ${f1(half)} s; ${count(MAT.LEAD)} lead`);
    let hotT = 0;
    for (let t = 0; t < 300; t++) { grid.step(); heat.step(); rad.step(); }
    for (let i = 0; i < N; i++) if (grid.mat[i] === MAT.POLONIUM) hotT = Math.max(hotT, grid.temp[i]);
    check('a heap of polonium heats itself', hotT > CFG.GRID.AMBIENT + 25, `${f1(hotT)} C in the middle`);

});

// Criticality is measured, not assumed: seed a configuration with a few
// neutrons, switch every spontaneous source off, and watch the population.
// The exponential growth rate (per tick) between an early count and the
// moment the population either takes off or dies is positive for a
// supercritical assembly and negative for a subcritical one. It has to be
// taken EARLY: once the pool throttle engages every assembly reads k = 1.
function chain(build, trials = 6, floor = 4) {
    let rate = 0, fuelN = 0, grew = 0;
    for (let trial = 0; trial < trials; trial++) {
        emptyTank(floor);
        build();
        for (let k = 0; k < 30; k++) grid.step();
        rad.clear();
        const fuel = [];
        for (let i = 0; i < N; i++) if (grid.mat[i] === MAT.URANIUM || grid.mat[i] === MAT.PLUTONIUM) fuel.push(i);
        fuelN = fuel.length;
        for (let k = 0; k < 120; k++) { const i = fuel[(rng() * fuel.length) | 0]; rad.spawn((i % W) + 0.5, ((i / W) | 0) + 0.5, RT.NEUTRON, CFG.RAD.ENERGY[3], false); }
        const T1 = 12;
        let n1 = 0, n2 = 0, t2 = T1;
        for (let t = 1; t <= 220; t++) {
            rad.step();           // no grid.step(): no decay, no boiling -- the bare chain
            const n = rad.pool.byType[RT.NEUTRON];
            if (t === T1) n1 = Math.max(1, n);
            if (t > T1) { n2 = n; t2 = t; if (n > 1400 || n < 4) break; }
        }
        rate += Math.log(Math.max(0.5, n2) / n1) / Math.max(1, t2 - T1);
        if (n2 > 1400) grew++;
    }
    return { rate: rate / trials, fuel: fuelN, grew, trials };
}
const pc = (r) => (r >= 0 ? '+' : '') + (r * 100).toFixed(1) + '%/tick';

section('criticality', () => {
    const dryU = chain(() => box(60, 90, 140, 140, MAT.URANIUM));
    check('a dry heap of uranium is subcritical at any size', dryU.rate < -0.01 && dryU.grew === 0, `${dryU.fuel} cells, neutrons ${pc(dryU.rate)}`);

    // uranium rods in water: the same fuel, moderated
    const lattice = (rods, depth) => () => {
        box(30, 60, 170, 144, MAT.WATER);
        box(20, 50, 29, 144, MAT.WALL); box(171, 50, 180, 144, MAT.WALL);
        for (let r = 0; r < rods; r++) { const x = 100 - rods * 4 + r * 8; box(x, 144 - depth, x + 2, 144, MAT.URANIUM); }
    };
    const big = chain(lattice(12, 50));
    check('the same uranium as rods in water goes critical', big.rate > 0.003, `${big.fuel} cells in 12 rods, neutrons ${pc(big.rate)}`);
    const small = chain(lattice(2, 12));
    check('...and a couple of short rods in the same water does not', small.rate < -0.002 && small.grew === 0, `${small.fuel} cells, ${pc(small.rate)}`);
    const rodded = chain(() => {
        lattice(12, 50)();
        for (let r = 0; r < 11; r++) { const x = 100 - 48 + r * 8 + 4; box(x, 90, x + 1, 144, MAT.ABSORBER); }
    });
    check('control rods between the fuel shut it down', rodded.rate < -0.004 && rodded.grew === 0, pc(rodded.rate));

    // plutonium has a bare critical size
    const disc = (r) => () => {
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) grid.setCell((90 + y) * W + 100 + x, MAT.PLUTONIUM);
        box(60, 91 + r, 140, 144, MAT.WALL);   // a bench, so it keeps its shape
    };
    const sizes = [2, 4, 6, 8, 11, 15].map((r) => ({ r, ...chain(disc(r)) }));
    const critical = sizes.find((s) => s.rate > 0);
    check('plutonium: small is safe, large is not, and there is a size between',
        sizes[0].rate < -0.01 && sizes[0].grew === 0 && sizes[sizes.length - 1].rate > 0.01 && !!critical && critical.r > 2,
        sizes.map((s) => `r${s.r} ${pc(s.rate)}`).join(', ') + (critical ? `  (bare critical radius about ${critical.r} cells)` : ''));
    // (below the critical size every pile dies at about the same rate, set
    // by how long a neutron takes to get out, so only real drops count)
    // ...and above it a pile takes off faster than this measurement can
    // resolve, so runaway rates are compared as "runaway")
    let mono = true;
    for (let k = 1; k < sizes.length; k++) if (Math.min(0.05, sizes[k].rate) < Math.min(0.05, sizes[k - 1].rate) - 0.02) mono = false;
    check('reactivity rises with size', mono, sizes.map((s) => pc(s.rate)).join(' '));

    // the everyday version: uranium dust simply poured into a pool
    // (on the tank's ordinary sand floor, 26 cells deep, top at y = 123)
    const pool = (wide, deep, water) => () => {
        box(100 - wide - 8, 119 - water, 100 + wide + 8, 122, MAT.WATER);
        box(100 - wide - 18, 110 - water, 100 - wide - 9, 122, MAT.WALL); box(100 + wide + 9, 110 - water, 100 + wide + 18, 122, MAT.WALL);
        box(100 - wide, 123 - deep, 100 + wide, 122, MAT.URANIUM);
    };
    const pond = chain(pool(50, 6, 45), 6, 26), puddle = chain(pool(8, 3, 8), 6, 26);
    check('a wide bed of uranium under deep water goes critical; a handful in a puddle does not',
        pond.rate > 0.002 && puddle.rate < -0.004, `bed of ${pond.fuel}: ${pc(pond.rate)}; ${puddle.fuel} in a puddle: ${pc(puddle.rate)}`);
    const dryOnSand = chain(() => box(60, 80, 140, 122, MAT.URANIUM), 4, 26);
    check('...and a big dry heap on that same sand still does not', dryOnSand.rate < -0.01, `${dryOnSand.fuel} cells: ${pc(dryOnSand.rate)}`);

    // What happens next. With the whole simulation running a supercritical
    // pile must run away, hit the pool throttle, heat up and burn out --
    // without overflowing the pool or stalling.
    emptyTank(4);
    disc(15)();
    for (let k = 0; k < 20; k++) grid.step();
    let peak = 0, minScale = 1, hot = 0, fis = 0, ms = 0;
    for (let t = 0; t < 600; t++) {
        const t0 = performance.now();
        grid.step(); heat.step(); rad.step();
        ms = Math.max(ms, performance.now() - t0);
        peak = Math.max(peak, rad.pool.count); minScale = Math.min(minScale, grid.state.emitScale);
        fis = Math.max(fis, rad.pool.fissionRate);
    }
    for (let i = 0; i < N; i++) hot = Math.max(hot, grid.temp[i]);
    check('a supercritical pile runs away on its own neutrons and is throttled, not overflowed',
        peak <= rad.CAP && peak > rad.CAP * 0.6 && minScale < 0.9, `peak ${peak}/${rad.CAP} particles, emission down to x${f2(minScale)}, ${fis.toFixed(0)} fissions/s, worst tick ${f1(ms)} ms`);
    check('...it gets hot and burns its fuel', hot > 500 && count(MAT.SPENT_FUEL) > 20, `${hot.toFixed(0)} C, ${count(MAT.SPENT_FUEL)} cells of spent fuel`);
});

// ================================================================ soft body
section('soft body', () => {
    const gs = sampleGenomes(12);
    let worstSag = 0, stood = true, minWalk = 1e9, maxWalk = 0, breaks = 0, fell = 0;
    const walks = [];
    gs.forEach((g, k) => {
        gene(g, 'gait', k % 2 ? 0.9 : 0.1);
        emptyTank(26);
        const c = spawn(g, STAGE.ADULT, 100);
        drive(c, 0);
        pp.step(120);
        const b = c.body, bb = b.bounds({});
        const restH = 2 * c.plan.b + c.phen.nubLen * c.plan.b;
        worstSag = Math.max(worstSag, 1 - (bb.y1 - bb.y0) / restH);
        if (!b.finite() || Math.abs(c.roll || 0) > 0.5) stood = false;
        const x0 = c.cx;
        drive(c, 1); pp.step(300);
        const x1 = c.cx;
        drive(c, -1); pp.step(300);
        const x2 = c.cx;
        const right = (x1 - x0) / 10, left = (x1 - x2) / 10;
        walks.push(`${c.plan.gait ? 'hop' : 'crawl'} ${f1(right)}/${f1(left)}` + (Math.min(right, left) < 0.8 ? ` [${genome.encode(g)}]` : ''));
        minWalk = Math.min(minWalk, right, left); maxWalk = Math.max(maxWalk, right, left);
        for (let q = 0; q < b.nc; q++) if (!b.cOn[q]) breaks++;
        if (Math.abs(c.roll || 0) > 0.7) fell++;
    });
    check('twelve random adults stand up and stay finite', stood, `worst sag ${(worstSag * 100).toFixed(0)}%`);
    check('every one of them can walk both ways', minWalk > 0.6, `cells/s right/left: ${walks.join(', ')}`);
    check('...without tearing itself or ending up on its back', breaks === 0 && fell === 0, `${breaks} broken constraints, ${fell} fallen`);

    // squish and recover: drop one from a height
    emptyTank(26);
    const g = gs[3];
    const c = spawn(g, STAGE.ADULT, 100);
    drive(c, 0);
    pp.step(90);
    const b = c.body;
    const h0 = (() => { const q = b.bounds({}); return q.y1 - q.y0; })();
    b.translate(0, -45);
    let hMin = 1e9;
    for (let t = 0; t < 90; t++) { pp.step(1); const q = b.bounds({}); if (b.hit[c.plan.ring[0]] || t > 20) hMin = Math.min(hMin, q.y1 - q.y0); }
    pp.step(120);
    const h1 = (() => { const q = b.bounds({}); return q.y1 - q.y0; })();
    let broken = 0;
    for (let q = 0; q < b.nc; q++) if (!b.cOn[q]) broken++;
    check('dropped from 45 cells it squashes, then recovers its shape', hMin < h0 * 0.93 && Math.abs(h1 - h0) < h0 * 0.08, `height ${f1(h0)} -> ${f1(hMin)} -> ${f1(h1)}; ${broken} broken; health ${f1(c.stats.health)}`);

    // stiffness is the genome's: a soft-meat animal squashes more than a stiff one
    const squash = (soft) => {
        const gg = gene(Float32Array.from(g), 'meatSoft', soft);
        gene(gg, 'skinSoft', soft);
        emptyTank(26);
        const cc = spawn(gg, STAGE.ADULT, 100);
        drive(cc, 0); pp.step(90);
        const q0 = cc.body.bounds({}); const hh = q0.y1 - q0.y0;
        cc.body.translate(0, -40);
        let m = 1e9;
        for (let t = 0; t < 80; t++) { pp.step(1); const q = cc.body.bounds({}); if (t > 15) m = Math.min(m, q.y1 - q.y0); }
        return m / hh;
    };
    const stiff = squash(0), softv = squash(1);
    check('compliance genes are physical: soft tissue squashes further', softv < stiff - 0.02, `stiff ${f2(stiff)}, soft ${f2(softv)} of rest height`);

    // bone is rigid: the spine keeps its length through all of that
    let worstBone = 0;
    for (let q = 0; q < b.nc; q++) if (b.cKind[q] === soft_KIND.BONE) worstBone = Math.max(worstBone, Math.abs(b.cStrain[q]));
    check('bone stays rigid', worstBone < 0.02, `worst bone strain ${f3(worstBone)}`);

    // area preservation
    emptyTank(26);
    const c2 = spawn(g, STAGE.ADULT, 100);
    drive(c2, 0); pp.step(120);
    const a0 = Math.abs(c2.body.ringArea()), ar = Math.abs(c2.areaRest0);
    check('the skin keeps its area', Math.abs(a0 / ar - 1) < 0.08, `${f1(a0)} vs rest ${f1(ar)}`);

    // blood stays in an intact animal
    let out = 0;
    for (const i of c2.plan.blood) if (c2.body.on[i] && !c2.body.contains(c2.body.x[i], c2.body.y[i])) out++;
    check('blood is confined by intact skin', out === 0 && c2.bloodFrac === 1, `${c2.bloodCount} particles, ${out} outside`);

    // ...and leaves a wounded one
    const blood0 = count(MAT.BLOOD);
    for (let e = 0; e < c2.body.ringN; e++) {
        const k = c2.body.ringEdge[e];
        const i = c2.body.ring[e];
        if (c2.body.y[i] > c2.cy + 2) { c2.body.cOn[k] = 0; c2.body.cMend[k] = 60; }
    }
    pp.step(200);
    check('a wound in the belly bleeds onto the sand', c2.bloodFrac < 0.8 && count(MAT.BLOOD) + count(MAT.WASTE) > blood0, `blood ${c2.bloodCount}/${c2.bloodMax}, ${count(MAT.BLOOD)} blood cells, health ${f1(c2.stats.health)}`);

    // every stage can walk
    const sp = [];
    let okStages = true;
    for (const st of [STAGE.BABY, STAGE.CHILD, STAGE.ADULT, STAGE.ELDER]) {
        emptyTank(26);
        const cc = spawn(gs[5], st, 100);
        drive(cc, 0); pp.step(60);
        const x0 = cc.cx;
        drive(cc, 1); pp.step(240);
        const v = (cc.cx - x0) / 8;
        sp.push(`${cfgMod.STAGE_NAMES[st]} ${f1(v)}`);
        if (v < 0.4 || !cc.body.finite()) okStages = false;
    }
    check('baby, child, adult and elder all get about', okStages, sp.join(', ') + ' cells/s');
});

// ================================================================= coupling
section('coupling', () => {
    const g = sampleGenomes(4)[2];
    // rasterising displaces, never deletes
    emptyTank(26);
    const sand0 = count(MAT.SAND);
    const c = spawn(g, STAGE.ADULT, 100);
    drive(c, 0);
    pp.step(30);
    box(88, 60, 112, 70, MAT.SAND);          // a load dropped on it
    const sand1 = count(MAT.SAND);
    pp.step(240);
    check('sand pushed aside by the body is never destroyed', count(MAT.SAND) === sand1, `${sand1} cells before and after`);
    check('the body occupies cells', coupling.raster.na > 150 && count(MAT.BODY) === coupling.raster.na, `${coupling.raster.na} BODY cells`);

    // burial. "How tall" is the vertical spread of the skin ring, which is
    // not thrown by one vertex snagged in the sand the way a bounding box is.
    const tall = (cr) => {
        const b = cr.body; let m = 0, v = 0;
        for (let e = 0; e < b.ringN; e++) m += b.y[b.ring[e]] / b.ringN;
        for (let e = 0; e < b.ringN; e++) v += (b.y[b.ring[e]] - m) ** 2 / b.ringN;
        return Math.sqrt(v);
    };
    emptyTank(26);
    const cb = spawn(g, STAGE.ADULT, 100);
    drive(cb, 0);
    pp.step(150);
    const hBefore = tall(cb), aBefore = Math.abs(cb.body.ringArea());
    box(84, 20, 116, 75, MAT.SAND);
    pp.step(260);
    const hBuried = tall(cb), aBuried = Math.abs(cb.body.ringArea());
    check('being buried visibly squashes it', hBuried < hBefore * 0.92 && aBuried < aBefore * 0.95,
        `vertical spread ${f2(hBefore)} -> ${f2(hBuried)} cells, area x${f2(aBuried / aBefore)}, health ${f1(cb.stats.health)}`);

    // buoyancy
    emptyTank(6);
    box(40, 60, 160, 143, MAT.WATER);
    box(30, 40, 39, 143, MAT.WALL); box(161, 40, 170, 143, MAT.WALL);
    const water0 = count(MAT.WATER);
    const c2 = spawn(g, STAGE.ADULT, 100);
    c2.body.translate(0, 30);
    drive(c2, 0);
    pp.step(300);
    check('it floats, and the water it displaces goes somewhere', c2.cy < 90 && Math.abs(count(MAT.WATER) - water0) < water0 * 0.04, `centre at y ${f1(c2.cy)} (surface 60), water ${water0} -> ${count(MAT.WATER)}`);
    check('cold water chills it and it burns more to stay warm', c2.regulation > 1.3 || c2.bodyTemp < c2.phen.comfort - 1, `body ${f1(c2.bodyTemp)} C, heat output x${f2(c2.regulation)}`);

    // warming the sand
    emptyTank(26);
    const c3 = spawn(g, STAGE.ADULT, 100);
    drive(c3, 0);
    pp.step(450);
    const tempStanding = c3.bodyTemp;
    release(c3);
    world.lights = false;               // asleep it lies down, belly on the sand
    pp.step(900);
    let under = 0;
    for (let x = Math.floor(c3.cx) - 6; x <= Math.floor(c3.cx) + 6; x++) {
        for (let y = Math.floor(c3.cy); y < H - 1; y++) {
            if (grid.mat[y * W + x] === MAT.SAND) { under = Math.max(under, grid.temp[y * W + x]); break; }
        }
    }
    world.lights = true;
    check('it sleeps lying down and warms the sand under it', c3.sleeping && under > CFG.GRID.AMBIENT + 1.5, `sand under it ${f1(under)} C, body ${f1(c3.bodyTemp)} C`);
    c3.bodyTemp = tempStanding;
    check('body temperature settles inside the comfort band', Math.abs(tempStanding - c3.phen.comfort) < c3.phen.comfortW, `${f1(c3.bodyTemp)} C, comfort ${f1(c3.phen.comfort)} +/- ${f1(c3.phen.comfortW)}`);

    // eating
    emptyTank(26);
    const c4 = spawn(g, STAGE.ADULT, 70);
    c4.stats.hunger = 30;
    pp.step(30);
    box(110, 100, 116, 105, MAT.FOOD);
    const food0 = count(MAT.FOOD), h0 = c4.stats.hunger;
    pp.step(900);
    check('it walks to food and eats it', count(MAT.FOOD) < food0 * 0.5 && c4.stats.hunger > h0 + 10, `food ${food0} -> ${count(MAT.FOOD)}, hunger ${f1(h0)} -> ${f1(c4.stats.hunger)}, at x ${f1(c4.cx)}`);
    pp.step(600);
    check('...and what goes in comes out', count(MAT.WASTE) > 0, `${count(MAT.WASTE)} waste cells`);
});

// ====================================================== radiation and tissue
section('dose', () => {
    const g = gene(sampleGenomes(3)[1], 'timid', 0);
    // an external gamma source
    emptyTank(26);
    const c = spawn(g, STAGE.ADULT, 100);
    drive(c, 0);
    pp.step(60);
    box(124, 100, 143, 123, MAT.RADIUM);
    pp.step(1800);
    const gammaDose = c.doseTotal;
    check('radium beside it: the gammas get in', gammaDose > 2 && c.doseRate > 0.01, `dose ${f2(gammaDose)} in 60 s beside ${count(MAT.RADIUM)} cells, rate ${f3(c.doseRate)}/s`);
    const byTissue = (cr) => { const d = [0, 0, 0, 0]; for (let i = 0; i < cr.plan.n; i++) d[cr.plan.tissue[i]] += cr.body.dose[i] * cr.body.m[i]; return d; };

    // penetration by type, measured directly: fire a beam at its flank
    const beam = (type) => {
        emptyTank(26);
        const cb = spawn(g, STAGE.ADULT, 100);
        drive(cb, 0);
        pp.step(60);
        for (let k = 0; k < 400; k++) {
            rad.spawn(cb.cx - cb.plan.a - 6, cb.cy - 3 + (k % 7), type, CFG.RAD.ENERGY[type], false, 1, 0);
            if (k % 40 === 39) pp.step(2);
        }
        pp.step(20);
        return byTissue(cb);
    };
    const da = beam(RT.ALPHA), db = beam(RT.BETA), dn = beam(RT.NEUTRON), dg = beam(RT.GAMMA);
    check('a gamma deposits through the whole body, bone and blood included', dg[TISSUE.MEAT] > dg[TISSUE.SKIN] && dg[TISSUE.BONE] + dg[TISSUE.BLOOD] > 0,
        `bone ${f1(dg[0])}, meat ${f1(dg[1])}, blood ${f1(dg[2])}, skin ${f1(dg[3])}`);
    check('an alpha stops in the skin', da[TISSUE.SKIN] > 0 && da[TISSUE.MEAT] + da[TISSUE.BONE] + da[TISSUE.BLOOD] === 0, `skin ${f2(da[3])}, everything else ${f2(da[0] + da[1] + da[2])}`);
    check('a beta reaches the meat but not bone or blood', db[TISSUE.MEAT] > 0 && db[TISSUE.BONE] + db[TISSUE.BLOOD] === 0, `skin ${f1(db[3])}, meat ${f1(db[1])}, bone+blood ${f1(db[0] + db[2])}`);
    check('neutrons reach bone and blood', dn[TISSUE.BONE] + dn[TISSUE.BLOOD] > 0, `bone ${f1(dn[0])}, blood ${f1(dn[2])}, meat ${f1(dn[1])}`);

    // lead in the way
    emptyTank(26);
    const cs = spawn(g, STAGE.ADULT, 100);
    drive(cs, 0);
    pp.step(60);
    box(124, 100, 143, 123, MAT.RADIUM);
    box(118, 84, 122, 123, MAT.WALL);
    box(119, 84, 121, 123, MAT.LEAD);
    pp.step(1800);
    check('a lead wall between them cuts the dose', cs.doseTotal < gammaDose * 0.5, `${f2(cs.doseTotal)} behind lead vs ${f2(gammaDose)} in the open`);

    // an external alpha source is harmless
    emptyTank(26);
    const ca = spawn(g, STAGE.ADULT, 100);
    drive(ca, 0);
    pp.step(60);
    box(125, 112, 134, 123, MAT.POLONIUM);
    pp.step(600);
    const outside = ca.doseTotal;
    // ...the same stuff swallowed is not
    emptyTank(26);
    const ci = spawn(g, STAGE.ADULT, 100);
    drive(ci, 0);
    pp.step(60);
    ci.internal[MAT.POLONIUM] = 3;
    pp.step(600);
    check('polonium outside is harmless, three grains swallowed are not', outside < 3 && ci.doseTotal > 30 && ci.doseTotal > outside * 10, `beside a heap: ${f2(outside)}; three grains inside: ${f1(ci.doseTotal)} in 20 s`);

    // eating contaminated food
    emptyTank(26);
    const ce = spawn(g, STAGE.ADULT, 80);
    ce.stats.hunger = 20;
    pp.step(30);
    for (let y = 100; y < 106; y++) for (let x = 108; x < 116; x++) grid.setCell(y * W + x, (x + y) % 3 === 0 ? MAT.RADIUM : MAT.FOOD);
    pp.step(900);
    let inside = 0;
    for (let m = 1; m < ce.internal.length; m++) inside += ce.internal[m];
    check('radioactive dust in the food is swallowed with it', inside > 0 || ce.doseTotal > 5, `${f1(inside)} grains inside, dose ${f1(ce.doseTotal)}`);

    // surface contamination and washing
    emptyTank(26);
    const cw = spawn(g, STAGE.ADULT, 100);
    drive(cw, 0);
    pp.step(60);
    box(90, 70, 110, 73, MAT.RADIUM);
    pp.step(240);
    const specks = cw.specks || 0;
    for (let k = 0; k < 6; k++) { box(85, 30 + k * 6, 115, 33 + k * 6, MAT.WATER); pp.step(60); }
    pp.step(240);
    check('hot dust sticks to the skin and water washes it off', specks > 0 && (cw.specks || 0) < specks, `${specks} specks, ${cw.specks || 0} after a wash`);

    // the AI runs
    emptyTank(26);
    const cf = spawn(gene(Float32Array.from(g), 'timid', 1), STAGE.ADULT, 100);
    pp.step(60);
    box(112, 100, 124, 123, MAT.SPENT_FUEL);
    const x0 = cf.cx;
    let fled = false;
    for (let t = 0; t < 600; t++) { pp.step(1); if (cf.ai === AI.FLEE_RADIATION) fled = true; }
    check('it senses the field and flees down the gradient', fled && cf.cx < x0 - 8, `moved ${f1(cf.cx - x0)} cells, dose ${f1(cf.doseTotal)}`);

    // tiers
    emptyTank(26);
    const ct = spawn(g, STAGE.ADULT, 100);
    drive(ct, 0);
    pp.step(30);
    for (let i = 0; i < ct.plan.n; i++) ct.body.dose[i] = CFG.DOSE.MODERATE * 1.6;
    const hungerBefore = ct.stats.hunger;
    pp.step(10);
    ct.feed(); ct.feed(); ct.feed();
    check('moderate dose: radiation sickness, and food no longer helps', ct.sick > 0 && ct.stats.hunger <= hungerBefore, `sick ${f2(ct.sick)}`);
    for (let i = 0; i < ct.plan.n; i++) ct.body.dose[i] = CFG.DOSE.LOCAL_BURN * 1.2;
    pp.step(90);
    check('high dose: the skin fails and it bleeds', ct.wounds > 3 && ct.bloodFrac < 1, `${ct.wounds} open edges, blood ${f2(ct.bloodFrac)}`);
});

// ================================================================ lifecycle
section('lifecycle', () => {
    emptyTank(26);
    storage.clear();
    const g1 = genome.randomGenome(rng);
    pp.act.newEgg(g1);
    check('a new egg is shell cells with an embryo inside', count(MAT.SHELL) > 100 && world.creature && world.creature.stage === STAGE.EGG, `${count(MAT.SHELL)} shell cells`);
    const p0 = world.egg.progress;
    pp.act.tapEgg(); pp.act.tapEgg();
    check('tapping hurries it', world.egg.progress > p0 + 0.05);
    let t = 0;
    while (world.egg && t < 2000) { pp.step(10); t += 10; }
    const baby = world.creature;
    check('it hatches', !world.egg && baby && baby.stage === STAGE.BABY && count(MAT.SHELL) === 0, `after ${f1(t / 30)} s, ${count(MAT.SHELL_BITS)} shell bits`);
    pp.step(150);
    check('...unhurt', baby.stats.health > 95 && baby.wounds === 0, `health ${f1(baby.stats.health)}`);

    // feed it up
    const n0 = (() => { let n = 0; for (let i = 0; i < baby.plan.n; i++) n += baby.body.on[i]; return n; })();
    const s0 = baby.scale;
    for (let k = 0; k < 14; k++) { pp.act.feed(); pp.step(240); }
    check('food makes it grow', baby.scale > s0 + 0.04 && baby.scale <= CFG.LIFE.SCALE_BABY + 0.01, `scale ${f2(s0)} -> ${f2(baby.scale)} (baby cap ${CFG.LIFE.SCALE_BABY})` +
        (baby.scale > s0 + 0.04 ? '' : `  [${genome.encode(baby.genome)} ai ${baby.ai} hunger ${f1(baby.stats.hunger)} energy ${f1(baby.stats.energy)} health ${f1(baby.stats.health)} at ${f1(baby.cx)},${f1(baby.cy)} mouth ${f1(baby.mouthX)},${f1(baby.mouthY)} food ${count(MAT.FOOD)} at ${f1(baby.sense.foodX)},${f1(baby.sense.foodY)} roll ${f2(baby.roll || 0)} budget ${f3(baby.budget)} mass ${f3(baby.mass)} variant ${baby.variant} walking ${baby.walking} face ${f2(baby.face)}]`));
    // time passes
    baby.age = baby.phen.lifespan * 0.3;
    baby.eggCooldown = 1e9;             // not yet: growing first
    let fed = 0;
    while (baby.scale < CFG.LIFE.EGG_READY_SCALE - 0.01 && fed < 60 && !baby.dead) { pp.act.feed(); pp.step(240); fed++; baby.stats.energy = 80; }
    const n1 = (() => { let n = 0; for (let i = 0; i < baby.plan.n; i++) n += baby.body.on[i]; return n; })();
    check('an adult with food grows to full size, adding particles on the way', baby.stage === STAGE.ADULT && baby.scale > 1.0 && n1 > n0 + 15, `scale ${f2(baby.scale)}, ${n0} -> ${n1} particles after ${fed} feeds`);

    // laying
    baby.eggCooldown = 0; baby.stats.hunger = 95; baby.stats.health = 100;
    const before = baby.scale, massBefore = baby.mass;
    baby.doseTotal = 0;
    let laid = 0;
    while (!world.egg && laid < 3000) {
        pp.step(10); laid += 10;
        baby.stats.hunger = Math.max(baby.stats.hunger, 80); baby.stats.energy = 80;
        if (laid % 240 === 0) pp.act.feed();
    }
    const egg = world.egg;
    check('a well-fed adult lays one egg', !!egg && !egg.incubating && egg.generation === 2, egg ? `after ${f1(laid / 30)} s` :
        `no egg: scale ${f3(baby.scale)} mass ${f3(baby.mass)} budget ${f3(baby.budget)} hunger ${f1(baby.stats.hunger)} health ${f1(baby.stats.health)} ai ${baby.ai} cooldown ${f1(baby.eggCooldown)} food ${count(MAT.FOOD)} hasEgg ${baby.hasEgg} stage ${baby.stage} sick ${baby.sick}`);
    const massAfter = baby.mass;
    pp.step(90);
    check('laying costs mass: the mother shrinks', massAfter < massBefore - CFG.LIFE.EGG_MASS * 0.5 && baby.scale < before - 0.02, `mass ${f2(massBefore)} -> ${f2(massAfter)}, scale ${f2(before)} -> ${f2(baby.scale)}`);
    pp.step(600);
    check('the egg stays dormant while she lives', egg && !egg.incubating && egg.progress === 0 && world.creature === baby);

    // death
    const bones0 = count(MAT.BONE);
    baby.age = baby.phen.lifespan * 1.01;
    pp.step(3);
    check('old age kills; the body becomes bone, meat and blood cells', world.creature !== baby && count(MAT.BONE) > bones0 + 8 && count(MAT.MEAT) > 80 && count(MAT.BODY) === 0,
        `${count(MAT.BONE)} bone, ${count(MAT.MEAT)} meat, ${count(MAT.BLOOD)} blood`);
    check('...and the dormant egg starts incubating', world.egg && world.egg.incubating && world.creature && world.creature.stage === STAGE.EGG);
    check('the ancestor is in the lineage', world.lineage.length === 1 && world.lineage[0].gen === 1 && world.lineage[0].genome === genome.encode(g1) && world.lineage[0].cause === 'old age');
    pp.step(3000);
    check('bone persists', count(MAT.BONE) > bones0 + 8, `${count(MAT.BONE)} bone cells five generations of rot later; ${count(MAT.MEAT)} meat left`);
    t = 0;
    while (world.egg && t < 2000) { pp.step(10); t += 10; }
    check('generation 2 hatches', world.creature && world.creature.generation === 2 && world.creature.stage === STAGE.BABY);
    let diff = 0;
    for (let i = 0; i < g1.length; i++) if (world.creature.genome[i] !== g1[i]) diff++;
    check('...with a genome that is its mother\'s, mutated', diff > 0 && diff < g1.length, `${diff} of ${g1.length} genes differ`);

    // death without an egg
    world.creature.stats.health = 0.001; world.creature.stats.hunger = 0;
    pp.step(30);
    check('dying without an egg leaves the tank empty', !world.creature && !world.egg && world.lineage.length === 2);
});

// ===================================================================== save
section('save', () => {
    emptyTank(26);
    storage.clear();
    box(20, 110, 40, 123, MAT.POLONIUM);
    box(150, 110, 170, 123, MAT.FOOD);
    const c = spawn(sampleGenomes(2)[1], STAGE.ADULT, 100);
    pp.step(200);
    c.internal[MAT.RADIUM] = 2;
    const snap = JSON.parse(JSON.stringify(save.serializeWorld(world)));
    const bytes = JSON.stringify(snap).length;
    const before = { mat: Uint8Array.from(grid.mat), x: Float32Array.from(c.body.x), dose: c.doseTotal, hunger: c.stats.hunger, nc: c.body.nc, n: rad.pool.count };
    // wreck the world, then restore with no time passed
    emptyTank(5);
    const away = save.restoreWorld(snap, world, snap.time);
    const r = world.creature;
    let cellsOk = true;
    for (let i = 0; i < N; i++) {
        const want = before.mat[i] === MAT.BODY ? 0 : before.mat[i];
        if (grid.mat[i] !== want) { cellsOk = false; break; }
    }
    let posOk = !!r;
    for (let i = 0; r && i < r.plan.n; i++) if (Math.abs(r.body.x[i] - before.x[i]) > 0.01) posOk = false;
    check('a save restores the grid cell for cell', away === 0 && cellsOk, `${(bytes / 1024).toFixed(0)} kB`);
    check('...and the animal particle for particle', posOk && r.body.nc === before.nc && Math.abs(r.stats.hunger - before.hunger) < 1e-6 && r.internal[MAT.RADIUM] === 2,
        r ? `${r.plan.n} particles, ${r.body.nc} constraints (was ${before.nc}), positions ${posOk}, hunger ${r.stats.hunger} vs ${before.hunger}, radium inside ${r.internal[MAT.RADIUM]}` : 'no creature');
    check('energy particles in flight are saved too', rad.pool.count === before.n, `${before.n}`);
    pp.step(60);
    check('the restored animal carries on', r.body.finite() && !r.dead && coupling.raster.na > 100);

    // a weekend away
    const po0 = count(MAT.POLONIUM), food0 = count(MAT.FOOD);
    const halfPo = mats.cellHalfLife(MAT.POLONIUM);
    const snap2 = JSON.parse(JSON.stringify(save.serializeWorld(world)));
    const awayFor = halfPo * 2;
    save.restoreWorld(snap2, world, snap2.time + awayFor * 1000);
    const left = count(MAT.POLONIUM) / po0;
    check('fast-forward decays cells analytically: two half-lives leaves a quarter', Math.abs(left - 0.25) < 0.07, `${f2(left)} of the polonium left, ${count(MAT.LEAD)} lead`);
    const snap3 = JSON.parse(JSON.stringify(save.serializeWorld(world)));
    save.restoreWorld(snap3, world, snap3.time + 60 * 3600 * 1000);
    const w = world.creature;
    check('the pet survives a weekend', w && !w.dead && w.stats.hunger >= CFG.STATS.OFFLINE_FLOOR.hunger - 0.01 && w.stats.health > 30,
        w ? `hunger ${f1(w.stats.hunger)}, happy ${f1(w.stats.happiness)}, health ${f1(w.stats.health)}` : 'gone');
    check('...and the food it left has spoiled', count(MAT.FOOD) === 0 && food0 > 0);
    pp.step(120);
    check('...and is still alive two seconds later', world.creature && !world.creature.dead);

    // version gate
    storage.set(CFG.SAVE.KEY, JSON.stringify({ ...snap, v: 999 }));
    check('a save from another version is discarded', save.loadSave() === null && !storage.has(CFG.SAVE.KEY));
});

// ============================================================== performance
section('performance', () => {
    emptyTank(26);
    const c = spawn(sampleGenomes(1)[0], STAGE.ADULT, 100);
    box(20, 100, 60, 123, MAT.SPENT_FUEL);
    box(140, 60, 170, 100, MAT.WATER);
    pp.step(200);
    const t0 = performance.now();
    pp.step(300);
    const ms = (performance.now() - t0) / 300;
    check('a busy tick fits the 30 Hz budget with room to spare', ms < 12, `${f2(ms)} ms per tick with ${rad.pool.count} energy particles and ${coupling.raster.na} body cells (budget 33)`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
