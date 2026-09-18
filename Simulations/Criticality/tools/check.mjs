// Headless harness. Loads the plain browser scripts into one vm context and
// measures the things the simulation is not allowed to get wrong: the bare
// critical masses, what a reflector saves, and that a heap of powder is worse
// than the same metal. Run: node tools/check.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console });
for (const f of ['nuclear.js', 'elements.js', 'grid.js', 'neutrons.js']) {
    vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
}
// Top-level `const` in a script lands in the context's lexical scope, which
// the other scripts can see but the context OBJECT cannot. Ask for them.
const { nuclear, elements, grid, neutrons } =
    vm.runInContext('({ nuclear, elements, grid, neutrons })', ctx);

const CX = 120, CY = 70;

function clearWorld() {
    grid.clear(0x12345);
    neutrons.reset();
    neutrons.rs = 99991;
}

function disc(cx, cy, r, key) {
    const id = elements.byKey[key].id;
    const r2 = r * r;
    for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
        for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            if (dx * dx + dy * dy <= r2) grid.set(x, y, id);
        }
    }
}

function ring(cx, cy, r0, r1, key) {
    const id = elements.byKey[key].id;
    for (let y = Math.floor(cy - r1) - 1; y <= cy + r1 + 1; y++) {
        for (let x = Math.floor(cx - r1) - 1; x <= cx + r1 + 1; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > r0 && d <= r1) grid.set(x, y, id);
        }
    }
}

// k by power iteration, which is what the browser's meter is measuring the
// noisy source-driven version of. One generation per step: MAX_PASS = 1 makes
// every live particle run to death and leaves the daughters for the next
// step, and a step of 10^9 seconds means nothing is still in flight.
function measureK(burn = 30, cycles = 70, bank = 420) {
    neutrons.MAX_PASS = 1;
    neutrons.MAX_EVENTS = 6000;       // a thermal neutron scatters thousands of times
    neutrons.TARGET = bank;
    neutrons.EVENT_BUDGET = 1e9;
    neutrons.renormalize = true;
    // No source during a power iteration. Spontaneous fission over a step of
    // 10^9 seconds is 10^10 neutrons of source, which swamps the bank and
    // makes the estimate useless even though it stays unbiased.
    neutrons.extra = 0;
    neutrons.srcList = []; neutrons.srcCum = []; neutrons.srcTotal = 0;
    neutrons.srcVersion = grid.mapVersion;

    // Seed the first generation anywhere in the fuel; power iteration finds
    // the real shape within a few cycles.
    const fuel = [];
    for (let c = 0; c < grid.n; c++) {
        const e = elements.list[grid.type[c]];
        if (e.enrich > 0.005 && grid.dens(c) > 0.1) fuel.push(c);
    }
    if (!fuel.length) return { k: 0, ell: 0 };
    grid.updateDepth();
    for (let i = 0; i < bank; i++) {
        const c = fuel[(neutrons.rand() * fuel.length) | 0];
        neutrons.add((c % grid.W) + neutrons.rand(), ((c / grid.W) | 0) + neutrons.rand(),
                     (neutrons.rand() * 2 - 1) * grid.own[c],
                     nuclear.sampleFission(() => neutrons.rand()), 1, 0);
    }

    let prod = 0, loss = 0, lifeW = 0, lifeT = 0;
    for (let s = 0; s < burn + cycles; s++) {
        grid.temp.fill(293);
        neutrons.beginFrame();
        neutrons.step(1e9);
        neutrons.srcVersion = grid.mapVersion; neutrons.srcTotal = 0;
        const T = neutrons.t;
        if (s >= burn) {
            prod += T.prod; loss += T.abs + T.leak;
            lifeT += T.life; lifeW += T.pop;
        }
        if (neutrons.n === 0) break;
    }
    neutrons.MAX_PASS = 80;
    neutrons.MAX_EVENTS = 40;
    neutrons.renormalize = false;
    return { k: loss > 0 ? prod / loss : 0, ell: lifeW > 0 ? lifeT / lifeW : 0, n: neutrons.n };
}

function fissileMass() {
    const s = grid.survey();
    return s.fissileG / 1000;   // kg
}

function crit(build, lo, hi, label) {
    // Bisect on the size parameter until k crosses 1.
    let kLo, kHi;
    for (let it = 0; it < 7; it++) {
        const mid = (lo + hi) / 2;
        clearWorld();
        build(mid);
        const m = measureK();
        if (m.k < 1) { lo = mid; kLo = m.k; } else { hi = mid; kHi = m.k; }
    }
    const r = (lo + hi) / 2;
    clearWorld();
    build(r);
    const m = measureK(30, 160);
    console.log(`${label.padEnd(34)} r=${r.toFixed(2)} cm  mass=${fissileMass().toFixed(2)} kg  k=${m.k.toFixed(3)}  l=${(m.ell * 1e9).toFixed(1)} ns`);
    return { r, mass: fissileMass(), k: m.k, ell: m.ell };
}

console.log('Criticality harness. Published figures in brackets.
');

console.log('--- bare metal spheres (published: HEU 52 kg / 8.7 cm, Pu 10 kg / 5.2 cm) ---');
crit(r => disc(CX, CY, r, 'HEU_METAL'), 3, 22, 'HEU metal, bare');
crit(r => disc(CX, CY, r, 'PU_METAL'), 2, 16, 'Pu metal, bare');

console.log('\n--- reflected (published: Pu + thick Be ~ 5 kg, HEU + water ~ 22 kg) ---');
crit(r => { disc(CX, CY, r, 'PU_METAL'); ring(CX, CY, r, r + 3, 'BE_BLOCK'); }, 2, 16, 'Pu metal + 3 cm beryllium');
crit(r => { disc(CX, CY, r, 'PU_METAL'); ring(CX, CY, r, r + 9, 'BE_BLOCK'); }, 1.5, 16, 'Pu metal + 9 cm beryllium');
crit(r => { disc(CX, CY, r, 'HEU_METAL'); ring(CX, CY, r, r + 15, 'WATER'); }, 3, 22, 'HEU metal + 15 cm water');
crit(r => { disc(CX, CY, r, 'HEU_METAL'); ring(CX, CY, r, r + 10, 'DU_METAL'); }, 3, 22, 'HEU metal + 10 cm DU tamper');

console.log('\n--- powder: half the density, so several times the mass ---');
crit(r => disc(CX, CY, r, 'HEU_DUST'), 4, 40, 'HEU dust, bare');
crit(r => disc(CX, CY, r, 'PU_DUST'), 3, 34, 'Pu dust, bare');

console.log('\n--- solution (published: ~800 g U-235 in a reflected tank) ---');
crit(r => disc(CX, CY, r, 'URANYL'), 8, 46, 'Uranyl nitrate, bare');
crit(r => { disc(CX, CY, r, 'URANYL'); ring(CX, CY, r, r + 20, 'WATER'); }, 8, 46, 'Uranyl nitrate + water reflector');

console.log('\n--- the negative results that must stay negative ---');
for (const [key, r] of [['NATU_DUST', 40], ['DU_DUST', 40]]) {
    clearWorld(); disc(CX, CY, r, key);
    const m = measureK(25, 90);
    console.log(`${(key + ' r=' + r).padEnd(34)} k=${m.k.toFixed(3)}  mass=${fissileMass().toFixed(1)} kg`);
}
clearWorld();
disc(CX, CY, 30, 'NATU_DUST');
for (let y = CY - 30; y <= CY + 30; y += 2) for (let x = CX - 30; x <= CX + 30; x++) {
    const dx = x + .5 - CX, dy = y + .5 - CY;
    if (dx * dx + dy * dy <= 900) grid.set(x, y, elements.byKey.WATER.id);
}
console.log(`${'natural U + water lattice'.padEnd(34)} k=${measureK(25, 110).k.toFixed(3)}`);

console.log('\n--- geometry: the same mass, spread out ---');
clearWorld();
disc(CX, CY, 9, 'HEU_METAL');
const sphereMass = fissileMass(), kSphere = measureK(25, 110).k;
clearWorld();
for (let x = 0; x < 236; x++) for (let y = CY; y < CY + 3; y++) grid.set(x, y, elements.byKey.HEU_METAL.id);
const slabMass = fissileMass(), kSlab = measureK(25, 110).k;
console.log(`sphere r=9: ${sphereMass.toFixed(1)} kg -> k=${kSphere.toFixed(3)}`);
console.log(`slab 236x3: ${slabMass.toFixed(1)} kg -> k=${kSlab.toFixed(3)}`);
