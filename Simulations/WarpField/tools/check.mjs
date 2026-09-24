// Headless harness. Loads the plain browser scripts into one vm context and
// checks the things this simulation is not allowed to get wrong: that the
// Einstein engine reproduces Alcubierre's closed-form energy density, that a
// shell of ordinary matter passes every energy condition while every shift-
// only drive fails the null one, that the optics reduce to the right limits,
// and that the ephemeris puts the planets where they are.
// Run: node tools/check.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console, performance, Math });
for (const f of ['metrics.js', 'einstein.js', 'optics.js', 'space.js', 'ship.js']) {
    const path = new URL('../' + f, import.meta.url);
    if (!fs.existsSync(path)) continue;
    vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: f });
}
// Top-level `const` in a script lands in the context's lexical scope, which
// the other scripts can see but the context OBJECT cannot. Ask for them.
const W = vm.runInContext(`({
    PHYS, FAMILIES, buildMetric, alcubierreRho, alcubierreEnergyCode, qiWallLimit, topHat,
    einstein,
    optics: typeof optics !== 'undefined' ? optics : null,
    space: typeof space !== 'undefined' ? space : null,
    ship: typeof ship !== 'undefined' ? ship : null
})`, ctx);
const { PHYS, buildMetric, einstein } = W;
if (W.space) W.space.init();

let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!ok) failures++;
}
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const fmt = x => x.toExponential(3);

function analyse(metric) {
    einstein.start(metric);
    while (!einstein.done) einstein.work(1e9);
    return einstein.totals;
}

// ---- 1. The engine against Alcubierre's eq. 19, point by point ----
{
    const m = buildMetric('alcubierre', { R: 100, D: 20 }, 0.8, 0);
    let worst = 0;
    for (const [x, y] of [[0.3, 0.95], [0, 1.02], [-0.5, 0.8], [0.9, 0.3], [0.2, 1.1]]) {
        const h = 2e-3 * einstein.scale(m, Math.hypot(x, y));
        einstein.curvature(m, x, y, 0, h);
        const got = einstein._s.Tt[0];
        const want = W.alcubierreRho(x, y, 0, m.v, m.s);
        worst = Math.max(worst, Math.abs(got - want) / Math.abs(W.alcubierreRho(0, 1, 0, m.v, m.s)));
    }
    check('Eulerian ρ matches Alcubierre eq. 19', worst < 1e-5, 'worst error ' + fmt(worst) + ' of peak');

    // York time: contraction ahead, expansion behind (Alcubierre fig. 1).
    const h = 2e-3 * einstein.scale(m, 1);
    const ahead = einstein.curvature(m, 0.7, 0.7, 0, h).york;
    const behind = einstein.curvature(m, -0.7, 0.7, 0, h).york;
    const s = m.s, r = Math.hypot(0.7, 0.7);
    const want = m.v * (0.7 / r) * ((Math.tanh(s * (r + 1 + 1e-6)) - Math.tanh(s * (r + 1e-6 - 1))) -
        (Math.tanh(s * (r + 1 - 1e-6)) - Math.tanh(s * (r - 1e-6 - 1)))) / (2 * Math.tanh(s)) / 2e-6;
    check('York time: front contracts, rear expands', ahead < 0 && behind > 0 && rel(ahead, want) < 1e-4,
        `θ_front ${fmt(ahead)} (expected ${fmt(want)}), θ_rear ${fmt(behind)}`);
}

// ---- 2. Total energy: grid integral against the 1-D closed form ----
{
    for (const [R, D, v] of [[100, 20, 1], [100, 2, 1], [50, 1, 3]]) {
        const m = buildMetric('alcubierre', { R, D }, v, 0);
        const t = analyse(m);
        const want = W.alcubierreEnergyCode(v, m.s);
        check(`Alcubierre total energy R=${R} Δ=${D} v=${v}`, rel(t.Enet, want) < 0.01,
            `grid ${fmt(t.Enet)}, closed form ${fmt(want)} (code units)`);
    }
    // Pfenning & Ford: a wall at the quantum-inequality limit, R = 100 m,
    // v = 1. Their piecewise-linear wall gives 6.2e62 kg; the tanh wall is
    // the same order (2/3 of the linear-wall integral at equal Δ).
    const v = 1, R = 100, D = W.qiWallLimit(v);
    const Ecode = W.alcubierreEnergyCode(v, 2 * R / D);
    const kg = Math.abs(Ecode) * R * PHYS.C2G;
    check('Pfenning–Ford QI-limited wall is ~1e62 kg', kg > 1e62 && kg < 2e63, fmt(kg) + ' kg');
}

// ---- 3. Energy conditions ----
{
    const verdict = t => ['nec', 'wec', 'sec', 'dec'].map(k => `${k}:${t.pass[k] ? 'ok' : 'VIOL'}`).join(' ');

    const alc = analyse(buildMetric('alcubierre', { R: 100, D: 10 }, 0.5, 0));
    check('Alcubierre violates NEC and WEC', !alc.pass.nec && !alc.pass.wec, verdict(alc));

    const nat = analyse(buildMetric('natario', { R: 100, D: 10 }, 0.5, 0));
    check('Natário violates NEC', !nat.pass.nec, verdict(nat));
    // Zero expansion is Natário's defining property.
    const f = einstein.f;
    let ymax = 0;
    for (let i = 0; i < f.york.length; i++) ymax = Math.max(ymax, Math.abs(f.york[i]));
    const mA = buildMetric('alcubierre', { R: 100, D: 10 }, 0.5, 0);
    const yA = Math.abs(einstein.curvature(mA, 0.7, 0.7, 0, 2e-3 * einstein.scale(mA, 1)).york);
    check('Natário has zero expansion', ymax < 1e-4 * yA, `max |θ| ${fmt(ymax)} vs Alcubierre ${fmt(yA)}`);

    const pot = analyse(buildMetric('potential', { R: 100, D: 10 }, 0.5, 0));
    check('Irrotational shift: positive Eulerian energy somewhere', pot.Epos > 0 && pot.rhoMax > 0,
        `E+ ${fmt(pot.Epos)}  E− ${fmt(pot.Eneg)}`);
    check('Irrotational shift: net Eulerian energy integrates to zero',
        Math.abs(pot.Enet) < 0.02 * pot.Epos, `net ${fmt(pot.Enet)} vs parts ±${fmt(pot.Epos)}`);
    check('Irrotational shift still violates NEC', !pot.pass.nec, verdict(pot));

    const sh = analyse(buildMetric('shell', { M: 4.49e27, R1: 10, R2: 20 }, 0, 0));
    check('Matter shell satisfies every energy condition', sh.pass.nec && sh.pass.wec && sh.pass.sec && sh.pass.dec,
        verdict(sh) + `  (tol ${fmt(sh.tol)})`);
    // ρ from the engine should integrate to the shell's mass (to O(M/R)
    // corrections: this is proper volume, not the Schwarzschild mass).
    const Mcode = 4.49e27 / PHYS.C2G / 20;
    check('Shell energy ~ its mass', sh.Enet > 0.8 * Mcode && sh.Enet < 1.6 * Mcode,
        `∫ρ dV = ${fmt(sh.Enet)}, M = ${fmt(Mcode)}`);

    const ws = analyse(buildMetric('warpshell', { M: 4.49e27, R1: 10, R2: 20, bw: 0.02 }, 0, 0));
    check('Warp shell (β_w = 0.02) satisfies every energy condition', ws.pass.nec && ws.pass.wec && ws.pass.dec,
        verdict(ws) + `  worst NEC ${fmt(ws.worst.nec)} tol ${fmt(ws.tol)}`);
    const ws2 = analyse(buildMetric('warpshell', { M: 4.49e27, R1: 10, R2: 20, bw: 0.4 }, 0, 0));
    check('Warp shell with a large shift breaks', !ws2.pass.nec || !ws2.pass.dec || !ws2.pass.wec, verdict(ws2));
}

if (W.optics) {
    const { optics } = W;
    // ---- 4. Optics ----
    const run = (key, v, D) => {
        optics.request({ key, params: { R: 100, D }, v });
        let guard = 0;
        while (optics.building && guard++ < 1e6) optics.work(1e9);
        return optics.table;
    };
    const tabA = run('alcubierre', 0.3, 1);
    const i0 = 0, iN = tabA.n - 1;
    check('Head-on blueshift is 1 + v (no time dilation)', rel(tabA.D[i0], 1.3) < 0.01,
        `D(0°) = ${tabA.D[i0].toFixed(4)}`);
    check('Straight back redshift is 1 − v', rel(tabA.D[iN], 0.7) < 0.01, `D(180°) = ${tabA.D[iN].toFixed(4)}`);
    const tabS = run('alcubierre', 2.5, 5);
    check('Superluminal: the view straight back goes dark', !tabS.ok[tabS.n - 1] && tabS.ok[0],
        `ok(0°)=${tabS.ok[0]} ok(180°)=${tabS.ok[tabS.n - 1]}`);
}

if (W.space) {
    const { space } = W;
    // ---- 5. Ephemeris ----
    const t = space.jdToSec(2451545.0);     // J2000
    const e = space.bodyPos('earth', t), s = space.bodyPos('sun', t);
    const dE = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]) / PHYS.AU;
    check('Earth sits ~1 AU from the Sun', Math.abs(dE - 0.983) < 0.01, dE.toFixed(4) + ' AU (perihelion season)');
    const mo = space.bodyPos('moon', t);
    const dM = Math.hypot(mo[0] - e[0], mo[1] - e[1], mo[2] - e[2]) / 1e3;
    check('Moon 356–407 thousand km from Earth', dM > 356000 && dM < 407000, Math.round(dM) + ' km');
    // Seen from α Centauri, the Sun lies in Cassiopeia.
    const ac = space.stars.find(x => x.name === 'α Centauri A');
    const dir = [-ac.pos[0], -ac.pos[1], -ac.pos[2]];
    const eq = space.eclToEq(dir);
    const ra = (Math.atan2(eq[1], eq[0]) * 180 / Math.PI + 360) % 360;
    const dec = Math.asin(eq[2] / Math.hypot(...eq)) * 180 / Math.PI;
    check('From α Cen the Sun is in Cassiopeia', ra > 0 && ra < 60 && dec > 50 && dec < 70,
        `RA ${ra.toFixed(1)}°, Dec ${dec.toFixed(1)}°`);
}


if (W.ship && W.space) {
    const { ship, space } = W;
    // ---- 6. Flight: committed legs stop on the mark at any time step ----
    const fly = (drive, target, cruise, dtSim) => {
        const t0 = space.jdToSec(2461000.5);
        ship.init(t0);
        ship.events.length = 0;
        ship.setDrive(drive);
        ship.interlock = true;
        ship.mode = 'auto';
        ship.target = target;
        ship.cruise = cruise;
        ship.setField(true);
        ship.engage();
        let n = 0, locked = false, maxB = 0;
        while (ship.engaged && n++ < 200000) {
            ship.helm(0.05);
            ship.advance(dtSim);
            if (ship.helmLocked()) locked = true;
            maxB = Math.max(maxB, ship.beta);
        }
        const g = ship.targetGeom();
        return { miss: g.dist - g.body.standoff, locked, maxB, steps: n, log: ship.events.map(e => e.text) };
    };
    const a = fly({ kind: 'shift', R: 100, M: 0, clockRate: 1 }, 'mars', 10, 7);
    check('10 c leg to Mars stops on its mark', Math.abs(a.miss) < 1e5 && a.locked && a.maxB > 9.9,
        `miss ${a.miss.toFixed(0)} m, peak ${a.maxB.toFixed(2)} c, helm locked en route: ${a.locked}`);
    const b = fly({ kind: 'shift', R: 100, M: 0, clockRate: 1 }, 'star:α Centauri A', 1e4, 500);
    check('10⁴ c leg to α Centauri stops on its mark', Math.abs(b.miss) < 1e6,
        `miss ${fmtKm(b.miss)}, ${b.steps} frames`);
    const c = fly({ kind: 'shell', R: 20, M: 4.49e27, clockRate: 0.8 }, 'moon', 0.01, 60);
    check('Shell under 1 g thrust reaches the Moon, never superluminal', Math.abs(c.miss) < 1e6 && c.maxB < 1,
        `miss ${c.miss.toFixed(0)} m, peak ${(c.maxB * PHYS.c / 1e3).toFixed(0)} km/s, ship clock ${(ship.tau / 3600).toFixed(2)} h`);
}

function fmtKm(m) { return (m / 1e3).toFixed(1) + ' km'; }
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
