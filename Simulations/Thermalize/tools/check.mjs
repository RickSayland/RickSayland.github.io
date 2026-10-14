// Headless harness. Loads the plain browser scripts into one vm context and
// checks the things that would otherwise break without anything on screen
// saying so: that the measured thermal values survive the curve fitting, that
// the lattice really does give the mean free path the cross section implies,
// that moderators take the textbook number of collisions, and that a run
// repeats from its seed. Run: node tools/check.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console });
for (const f of ['nuclides.js', 'materials.js', 'grid.js', 'neutrons.js']) {
    vm.runInContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
}
// Top-level `const` in a script lands in the context's lexical scope, which
// the other scripts can see but the context OBJECT cannot. Ask for them.
const { nuc, materials, grid, neutrons, rng } =
    vm.runInContext('({ nuc, materials, grid, neutrons, rng })', ctx);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) pass++; else fail++;
    console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);
const S = k => nuc.sp[nuc.idx[k]];
const M = k => materials.byKey[k];

function world(seed) {
    grid.clear(); neutrons.reset(); rng.seed(seed || 0xC0FFEE);
}
function fill(key) { grid.rect(0, 0, grid.W - 1, grid.H - 1, M(key).id); }

// ---- 1. The measured values are still the measured values ----
console.log('thermal cross sections (Sears 1992, 2200 m/s)');
for (const s of nuc.SPECIES) {
    if (s.mix) continue;
    const a = nuc.capture(s, nuc.E_TH) + nuc.fission(s, nuc.E_TH);
    if (!near(a, s.sa, 1e-4) && s.sa > 0) ok(s.key + ' absorption pinned', false, a + ' vs ' + s.sa);
}
ok('every species passes through its thermal absorption', fail === 0);
const abs = (k, E) => { const s = S(k), g = nuc.group(E); return nuc.cap[s.idx][g] + nuc.fis[s.idx][g]; };
const spot = [['H1', 0.3326], ['B10', 3835], ['B', 767], ['Li', 70.5], ['Cd', 2520], ['Gd', 49700],
              ['In', 193.8], ['Au', 98.65], ['Hg', 372.3], ['Xe135', 2.65e6], ['U235', 680.9],
              ['U238', 2.68], ['Pu239', 1017.3], ['U', 7.57]];
for (const [k, v] of spot) ok(k + ' table at thermal', near(abs(k, nuc.E_TH), v, 0.02), abs(k, nuc.E_TH).toPrecision(5) + ' vs ' + v);
ok('U-235 thermal fission 583 b', near(nuc.fission(S('U235'), nuc.E_TH), 583, 1e-6));
ok('Pu-239 thermal fission 747 b', near(nuc.fission(S('Pu239'), nuc.E_TH), 747.4, 1e-6));

// ---- 2. The shape away from thermal ----
console.log('energy dependence');
ok('hydrogen free-atom scattering 20.5 b at 1 eV', near(nuc.elastic(S('H1'), 1), 20.5, 0.04), nuc.elastic(S('H1'), 1).toFixed(2));
ok('hydrogen scattering ~2.9 b at 2 MeV', near(nuc.elastic(S('H1'), 2e6), 2.85, 0.08), nuc.elastic(S('H1'), 2e6).toFixed(2));
ok('hydrogen scattering rises below thermal (free gas)', nuc.elastic(S('H1'), 0.0253) > 26 && nuc.elastic(S('H1'), 0.0253) < 36, nuc.elastic(S('H1'), 0.0253).toFixed(1));
ok('boron-10 is 1/v: a hundredfold in energy is a tenth', near(nuc.capture(S('B10'), 2.53), 383.5, 0.01), nuc.capture(S('B10'), 2.53).toFixed(1));
ok('cadmium peaks near 7,900 b at 0.178 eV', near(nuc.capture(S('Cd'), 0.178), 7890, 0.03), nuc.capture(S('Cd'), 0.178).toFixed(0));
ok('cadmium cutoff: under 30 b by 1 eV', nuc.capture(S('Cd'), 1) < 30, nuc.capture(S('Cd'), 1).toFixed(1));
ok('gadolinium is gone by 1 eV', nuc.capture(S('Gd'), 1) < 80, nuc.capture(S('Gd'), 1).toFixed(1));
{
    // The 6.67 eV resonance must survive binning with its integral intact.
    const s = S('U238'), i = s.idx, du = Math.LN10 / nuc.PER_DEC;
    let ri = 0, peak = 0;
    for (let g = nuc.group(5.5); g <= nuc.group(8); g++) { ri += nuc.cap[i][g] * du; peak = Math.max(peak, nuc.cap[i][g]); }
    ok('U-238 6.67 eV resonance resolved in the table', peak > 1500, 'peak ' + peak.toFixed(0) + ' b');
    ok('U-238 6.67 eV resonance integral ~130 b', near(ri, 131, 0.12), ri.toFixed(1));
}
ok('U-238 does not fission at thermal', nuc.fission(S('U238'), 0.0253) === 0);
ok('U-238 fast fission ~0.55 b at 3 MeV', near(nuc.fission(S('U238'), 3e6), 0.55, 0.05));
ok('U-235 fast fission 1.2-1.7 b at 1 MeV', nuc.fission(S('U235'), 1e6) > 1.2 && nuc.fission(S('U235'), 1e6) < 1.7, nuc.fission(S('U235'), 1e6).toFixed(2));
let finite = true;
for (let i = 1; i < nuc.sp.length; i++) for (let g = 0; g < nuc.NG; g++) if (!(nuc.tot[i][g] > 0) || !isFinite(nuc.tot[i][g])) finite = false;
ok('every table is finite and positive', finite);

// ---- 3. Materials ----
console.log('materials');
let named = true;
for (const m of materials.DEFS) for (let s = 0; s < m.ns; s++) if (!m.slotSp[s]) named = false;
for (const s of nuc.SPECIES) if (s.spent && !nuc.idx[s.spent]) named = false;
ok('every slot and every product names a species that exists', named);
const sig = {};
materials.sigma(M('CD'), nuc.group(nuc.E_TH), sig);
ok('cadmium macroscopic absorption ~117 /cm', near(sig.cap, 117, 0.04), sig.cap.toFixed(1));
materials.sigma(M('GRAPHITE'), nuc.group(1), sig);
ok('graphite mean free path ~2.5 cm at 1 eV', near(1 / sig.tot, 2.47, 0.04), (1 / sig.tot).toFixed(2));
materials.sigma(M('WATER'), nuc.group(2e6), sig);
ok('water mean free path ~4 cm at 2 MeV', near(1 / sig.tot, 4.1, 0.1), (1 / sig.tot).toFixed(2));

// ---- 4. The lattice gives the mean free path the cross section implies ----
console.log('transport');
// Every flight between two collisions, measured in mean free paths: distance
// times the macroscopic cross section at that flight's energy. The average is
// exactly 1 if the lattice is doing what the cross section says. The trail
// holds an arrival and a departure vertex per collision, so flights are the
// odd-indexed segments; the first is skipped because it starts where the
// neutron was fired from, not at a nucleus.
function opticalGap(key, E, n, maxCol) {
    world(7); fill(key); neutrons.burn = false;
    const m = M(key);
    let sum = 0, cnt = 0;
    for (let k = 0; k < n; k++) {
        neutrons.fire(80, 50, rng.next() * 6.2831853, E, true);
        let it = 0;
        while (neutrons.f.alive && neutrons.f.col < maxCol && it++ < 20000) neutrons.step(0.01);
        const t = neutrons.trail;
        for (let j = 3; j * 3 + 2 < t.length; j += 2) {
            materials.sigma(m, nuc.group(t[3 * j + 2]), sig);
            sum += Math.hypot(t[3 * j] - t[3 * j - 3], t[3 * j + 1] - t[3 * j - 2]) * sig.tot; cnt++;
        }
        neutrons.n = 0; neutrons.fIdx = -1;
    }
    neutrons.burn = true;
    return sum / cnt;
}
for (const [key, E] of [['WATER', 0.05], ['WATER', 2e6], ['POLY', 0.05], ['HEAVY', 0.05], ['GRAPHITE', 100],
                        ['GRDUST', 100], ['SAND', 100], ['BE', 1], ['FE', 0.05], ['PB', 1e4], ['U238', 1e4]]) {
    const got = opticalGap(key, E, 200, 30);
    ok(key + ' free path from ' + nuc.fmtE(E) + ' is one mean free path', near(got, 1, 0.06), got.toFixed(3));
}

// ---- 5. Moderators take the textbook number of collisions ----
function collisionsTo(key, Estop, n) {
    world(11); fill(key);
    let sum = 0, cnt = 0;
    for (let k = 0; k < n; k++) {
        neutrons.fire(80, 50, rng.next() * 6.2831853, 2e6, true);
        let it = 0;
        while (neutrons.f.alive && neutrons.f.E > Estop && it++ < 60000) neutrons.step(0.02);
        if (neutrons.f.alive && neutrons.f.E <= Estop) { sum += neutrons.f.col; cnt++; }
        neutrons.n = 0; neutrons.fIdx = -1;
    }
    return { mean: sum / cnt, kept: cnt / n };
}
{
    const w = collisionsTo('WATER', 1, 400), d = collisionsTo('HEAVY', 1, 300), c = collisionsTo('GRAPHITE', 1, 200);
    ok('water: ~16 collisions from 2 MeV to 1 eV', w.mean > 13 && w.mean < 21, w.mean.toFixed(1));
    ok('heavy water: ~29', d.mean > 24 && d.mean < 40, d.mean.toFixed(1));
    ok('graphite: ~92', c.mean > 80 && c.mean < 106, c.mean.toFixed(1));
    ok('ordering: water < heavy water < graphite', w.mean < d.mean && d.mean < c.mean);
}

// ---- 6. Absorbers are black to slow neutrons and open to fast ones ----
function through(key, thick, E, n) {
    world(23); neutrons.burn = false;
    grid.rect(80, 0, 80 + thick - 1, grid.H - 1, M(key).id);
    let out = 0;
    for (let k = 0; k < n; k++) {
        neutrons.fire(70, 30 + rng.next() * 40, 0, E, false);
        let it = 0;
        while (neutrons.n > 0 && neutrons.x[0] < 80 + thick + 1 && neutrons.x[0] > 60 && it++ < 4000) neutrons.step(0.02);
        if (neutrons.n > 0 && neutrons.x[0] >= 80 + thick + 1) out++;
        neutrons.n = 0;
    }
    neutrons.burn = true;
    return out / n;
}
{
    const bs = through('BORON', 3, 0.0253, 800), bf = through('BORON', 3, 2e6, 800);
    ok('3 cm of boron stops thermal neutrons', bs < 0.01, (bs * 100).toFixed(1) + '% through');
    ok('3 cm of boron passes most fast neutrons', bf > 0.45, (bf * 100).toFixed(0) + '% through');
    const cs = through('CD', 1, 0.05, 800), ce = through('CD', 1, 2, 800);
    ok('1 cm of cadmium is black at 0.05 eV', cs < 0.01, (cs * 100).toFixed(1) + '% through');
    ok('1 cm of cadmium is open at 2 eV', ce > 0.5, (ce * 100).toFixed(0) + '% through');
    const xs = through('XE135', 2, 0.0253, 600);
    ok('2 cm of xenon-135 GAS stops thermal neutrons', xs < 0.02, (xs * 100).toFixed(1) + '% through');
}

// ---- 7. Burn-up and fission ----
console.log('reactions');
{
    world(31); neutrons.burn = true;
    grid.rect(80, 30, 84, 70, M('BORON').id);
    for (let k = 0; k < 200; k++) neutrons.fire(70, 35 + rng.next() * 30, 0, 0.0253, false);
    for (let it = 0; it < 600 && neutrons.n; it++) neutrons.step(0.02);
    let used = 0;
    for (let c = 0; c < grid.type.length; c++) if (grid.ovr[c * 3]) used++;
    ok('captures use atoms up when burn-up is on', used > 150 && used <= 200, used + ' atoms');
    ok('a used boron atom is lithium-7', grid.ovr[grid.ovr.findIndex(v => v)] === nuc.idx.Li7);

    world(31); neutrons.burn = false;
    grid.rect(80, 30, 84, 70, M('BORON').id);
    for (let k = 0; k < 200; k++) neutrons.fire(70, 35 + rng.next() * 30, 0, 0.0253, false);
    for (let it = 0; it < 600 && neutrons.n; it++) neutrons.step(0.02);
    ok('and leave them alone when it is off', !grid.ovr.some(v => v));
    neutrons.burn = true;
}
{
    world(41);
    grid.rect(60, 30, 100, 70, M('U235').id);
    neutrons.fire(80, 50, 0.3, 0.0253, true);
    let peak = 0;
    for (let it = 0; it < 400; it++) { neutrons.step(0.02); peak = Math.max(peak, neutrons.n); }
    const t = neutrons.tally;
    ok('a block of U-235 runs away from one neutron', t.fissions > 50, t.fissions + ' fissions');
    ok('about 2.5 neutrons per fission', (t.born + t.dropped) / t.fissions > 2.3 && (t.born + t.dropped) / t.fissions < 2.8, ((t.born + t.dropped) / t.fissions).toFixed(2));
    ok('the pool never exceeds its cap', peak <= neutrons.MAX, 'peak ' + peak);

    world(43); neutrons.burn = false;
    grid.rect(60, 30, 100, 70, M('U238').id);
    for (let k = 0; k < 30; k++) neutrons.fire(80, 50, rng.next() * 6.28, 0.0253, false);
    for (let it = 0; it < 3000 && neutrons.n; it++) neutrons.step(0.02);
    ok('U-238 does not fission on thermal neutrons', neutrons.tally.fissions === 0 && neutrons.n === 0, neutrons.tally.fissions + ' fissions');

    // With burn-up on, a capture leaves plutonium behind, and plutonium does.
    world(43); neutrons.burn = true;
    grid.rect(60, 30, 100, 70, M('U238').id);
    for (let k = 0; k < 30; k++) neutrons.fire(80, 50, rng.next() * 6.28, 0.0253, false);
    for (let it = 0; it < 3000 && neutrons.n; it++) neutrons.step(0.02);
    let pu = 0;
    for (let c = 0; c < grid.type.length; c++) if (grid.ovr[c * 3] === nuc.idx.Pu239) pu++;
    ok('U-238 that captures a neutron is bred into plutonium', pu > 0, pu + ' atoms');
}

// ---- 8. Determinism ----
console.log('determinism and sand');
function run(seed) {
    world(seed);
    grid.rect(40, 60, 120, 99, M('WATER').id);
    grid.rect(78, 60, 82, 99, M('BORON').id);
    grid.paint(60, 20, 6, M('SAND').id, true);
    let h = 0;
    for (let it = 0; it < 300; it++) {
        if (it % 5 === 0) neutrons.fire(42, 80, 0, 2e6, false);
        grid.step(); neutrons.step(1 / 60);
    }
    for (let c = 0; c < grid.type.length; c++) h = (Math.imul(h, 31) + grid.type[c] * 7 + grid.ovr[c * 3] + grid.seed[c]) | 0;
    for (let i = 0; i < neutrons.n; i++) h = (Math.imul(h, 31) + Math.round(neutrons.x[i] * 1e6) + Math.round(neutrons.E[i])) | 0;
    return h + ':' + neutrons.tally.absorbed + ':' + neutrons.tally.leaked;
}
{
    const a = run(99), b = run(99), c = run(100);
    ok('same seed, same run', a === b, a);
    ok('different seed, different run', a !== c);
}

// ---- 9. The sand ----
{
    world(5);
    grid.set(80, 10, M('SAND').id);
    let steps = 0;
    while (grid.get(80, 99) === 0 && steps < 500) { grid.step(); steps++; }
    ok('a grain falls one cell every step, all the way', steps === 89, steps + ' steps for 89 cells');

    world(5);
    grid.rect(60, 99, 100, 99, M('FE').id);
    grid.rect(60, 80, 60, 99, M('FE').id); grid.rect(100, 80, 100, 99, M('FE').id);
    grid.rect(75, 60, 85, 90, M('WATER').id);
    const before = grid.count();
    for (let it = 0; it < 1500; it++) grid.step();
    let top = 99, bottom = 0;
    for (let x = 61; x < 100; x++) {
        let y = 0; while (y < 99 && grid.get(x, y) !== M('WATER').id) y++;
        top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    ok('water finds its level', bottom - top <= 2, 'surface spans ' + (bottom - top) + ' cells');
    ok('nothing is created or destroyed', grid.count() === before);

    world(5);
    grid.rect(70, 99, 90, 99, M('FE').id);
    grid.rect(70, 70, 70, 99, M('FE').id); grid.rect(90, 70, 90, 99, M('FE').id);
    grid.rect(71, 90, 89, 98, M('WATER').id);
    grid.rect(76, 75, 84, 80, M('HG').id);
    for (let it = 0; it < 1200; it++) grid.step();
    let hgBelow = true;
    for (let x = 71; x < 90; x++) {
        let seenWater = false;
        for (let y = 98; y >= 70; y--) {
            const t = grid.get(x, y);
            if (t === M('WATER').id) seenWater = true;
            if (t === M('HG').id && seenWater) hgBelow = false;
        }
    }
    ok('mercury sinks under water', hgBelow);

    world(5);
    grid.set(80, 50, M('HE3').id); grid.set(90, 50, M('XE135').id);
    for (let it = 0; it < 600; it++) grid.step();
    let heY = -1, xeY = -1;
    for (let c = 0; c < grid.type.length; c++) {
        if (grid.type[c] === M('HE3').id) heY = (c / grid.W) | 0;
        if (grid.type[c] === M('XE135').id) xeY = (c / grid.W) | 0;
    }
    ok('helium rises, xenon pools', heY < 10 && xeY > 90, 'He row ' + heY + ', Xe row ' + xeY);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
