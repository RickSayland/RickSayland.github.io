// Headless harness. Loads the plain browser scripts into one vm context and
// checks what this page is not allowed to get wrong: that the Kohn–Sham
// solver reproduces NIST's LDA reference atoms (total energies and every
// orbital eigenvalue), that one electron is solved exactly, that the
// configuration rules produce the measured ground states and the right ions,
// and that the nuclear verdicts agree with the chart.
// Run: node tools/check.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console, performance, Math });
for (const f of ['elements.js', 'nuclides.js', 'nucleus.js', 'scf.js', 'orbitals.js']) {
    const path = new URL('../' + f, import.meta.url);
    if (!fs.existsSync(path)) continue;
    vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: f });
}
// Top-level `const` in a script lands in the context's lexical scope, which
// the other scripts can see but the context OBJECT cannot. Ask for them.
const W = vm.runInContext(`({
    ELEMENTS, configs, scf,
    nucleus: typeof nucleus !== 'undefined' ? nucleus : null,
    orbitals: typeof orbitals !== 'undefined' ? orbitals : null,
})`, ctx);
const { configs, scf, ELEMENTS } = W;

let failures = 0;
function check(name, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!ok) failures++;
}
const L = 'spdf';

// ---- 1. One electron, no interaction: exact hydrogenic levels ----
{
    let worst = 0;
    for (const Z of [1, 26, 92]) {
        // Only states that fit well inside R_MAX: hydrogen's 6s reaches past it.
        for (const [n, l] of [[1, 0], [2, 0], [2, 1], [3, 2], [4, 3], [6, 0]]) {
            if (n * n / Z > 20) continue;
            const job = scf.run(scf.create(Z, [{ n, l, occ: 1 }]));
            const e = job.shells[0].e;
            worst = Math.max(worst, Math.abs(e / (-Z * Z / (2 * n * n)) - 1));
        }
    }
    check('hydrogen-like levels are −Z²/2n²', worst < 1e-8, 'worst relative error ' + worst.toExponential(2));
}

// ---- 2. NIST atomic reference data, LDA column ----
// Kotochigova, Levine, Shirley, Stiles & Clark, NIST Atomic Reference Data for
// Electronic Structure Calculations (math.nist.gov/DFTdata). Non-relativistic,
// spherical, VWN correlation.
const NIST = {
    1: [-0.445671, { '1s': -0.233471 }],
    2: [-2.834836, { '1s': -0.570425 }],
    3: [-7.335195, { '1s': -1.878564, '2s': -0.105540 }],
    6: [-37.425749, { '1s': -9.947718, '2s': -0.500866, '2p': -0.199186 }],
    8: [-74.473077, { '1s': -18.758245, '2s': -0.871362, '2p': -0.338381 }],
    10: [-128.233481, { '1s': -30.305855, '2s': -1.322809, '2p': -0.498034 }],
    11: [-161.440060, { '1s': -37.719975, '2s': -2.063401, '2p': -1.060636, '3s': -0.103415 }],
    18: [-525.946195, { '1s': -113.800134, '2s': -10.794172, '2p': -8.443439, '3s': -0.883384, '3p': -0.382330 }],
    26: [-1261.093056, { '1s': -254.225505, '2p': -25.551766, '3p': -2.187523, '3d': -0.295049, '4s': -0.197978 }],
    36: [-2750.147940, { '1s': -509.982989, '3d': -3.074109, '4s': -0.820574, '4p': -0.346340 }],
    54: [-7228.856107, { '1s': -1208.688993, '4d': -2.286666, '5s': -0.672086, '5p': -0.309835 }],
    79: [-17860.790943, { '1s': -2683.508245, '4f': -3.486824, '5d': -0.304738, '6s': -0.162334 }],
    92: [-25658.417889, { '1s': -3689.355141, '5f': -0.366543, '6d': -0.143190, '7s': -0.130948 }],
};
const solved = {};
for (const [zs, [etot, levels]] of Object.entries(NIST)) {
    const Z = +zs;
    const t0 = performance.now();
    const job = scf.run(scf.create(Z, configs.neutral(Z), { exact1: false }));
    const ms = performance.now() - t0;
    solved[Z] = job;
    let worst = 0, where = '';
    for (const [lab, want] of Object.entries(levels)) {
        const sh = job.shells.find(s => s.n + L[s.l] === lab);
        const d = Math.abs(sh.e - want);
        if (d > worst) { worst = d; where = lab; }
    }
    const dE = Math.abs(job.Etot - etot);
    check(`${ELEMENTS[Z].sym.padEnd(2)} LDA matches NIST`,
        !job.failed && dE < 2e-5 * Math.max(1, Math.abs(etot) / 100) && worst < 2e-5 * Math.max(1, Math.abs(levels['1s']) / 100),
        `Etot ${job.Etot.toFixed(6)} (Δ ${dE.toExponential(1)}), worst level ${where} Δ ${worst.toExponential(1)}, ${job.iter} iters, ${ms.toFixed(0)} ms`);
}

// ---- 3. Ionisation energy by ΔSCF ----
{
    const ion = Z => scf.run(scf.create(Z, configs.build(Z, Z - 1), { exact1: false })).Etot;
    const neNIST = -127.400068, naNIST = -161.250340;
    check('Ne⁺ matches NIST', Math.abs(ion(10) - neNIST) < 3e-5, (ion(10) - neNIST).toExponential(1));
    check('Na⁺ matches NIST', Math.abs(ion(11) - naNIST) < 3e-5, (ion(11) - naNIST).toExponential(1));
}

// ---- 4. Configurations ----
{
    const d = (Z, N) => configs.describe(configs.build(Z, N));
    const cases = [
        [26, 26, '[Ar] 3d6 4s2'], [26, 24, '[Ar] 3d6'], [26, 23, '[Ar] 3d5'],
        [24, 24, '[Ar] 3d5 4s1'], [29, 28, '[Ar] 3d10'], [46, 46, '[Kr] 4d10'],
        [58, 55, '[Xe] 4f1'], [64, 61, '[Xe] 4f7'], [92, 89, '[Rn] 5f3'],
        [50, 48, '[Kr] 4d10 5s2'], [82, 78, '[Xe] 4f14 5d10'], [8, 10, '[He] 2s2 2p6'],
        [17, 18, '[Ne] 3s2 3p6'], [1, 2, '1s2'], [103, 103, '[Rn] 5f14 7s2 7p1'],
    ];
    for (const [Z, N, want] of cases) {
        const got = d(Z, N);
        check(`config ${ELEMENTS[Z].sym} (${N} e) = ${want}`, got === want, got === want ? '' : 'got ' + got);
    }
    let bad = [];
    for (let Z = 1; Z <= 118; Z++) {
        const n = configs.neutral(Z).reduce((s, x) => s + x.occ, 0);
        if (n !== Z) bad.push(Z);
    }
    check('every neutral configuration holds Z electrons', bad.length === 0, bad.join(','));
}

// ---- 5. Every neutral atom converges ----
{
    const slow = [], failed = [];
    let worstMs = 0;
    for (let Z = 1; Z <= 118; Z++) {
        const t0 = performance.now();
        const job = scf.run(scf.create(Z, configs.neutral(Z)));
        const ms = performance.now() - t0;
        worstMs = Math.max(worstMs, ms);
        if (job.failed) failed.push(ELEMENTS[Z].sym + ':' + job.failed.reason);
        if (job.iter > 150) slow.push(ELEMENTS[Z].sym + ':' + job.iter);
    }
    check('all 118 neutral atoms converge', failed.length === 0, failed.join(' ') + (slow.length ? '  slow: ' + slow.join(' ') : '') + `  worst ${worstMs.toFixed(0)} ms`);
}

// ---- 6. Anions ----
{
    const res = {};
    for (const [Z, N, opts] of [[9, 10, { latter: true }], [17, 18, { latter: true }], [1, 2, { latter: true }],
                                [8, 10, { latter: true, watson: { q: 2, R: 2.6 } }]]) {
        const job = scf.run(scf.create(Z, configs.build(Z, N), opts));
        res[ELEMENTS[Z].sym + (N - Z)] = job.failed ? 'FAIL ' + job.failed.reason : job.shells[job.shells.length - 1].e.toFixed(4);
    }
    const ok = Object.values(res).every(v => !String(v).startsWith('FAIL') && +v < 0);
    check('anions bind their extra electrons', ok, JSON.stringify(res));
}

// ---- 7. Orbitals ----
if (W.orbitals) {
    const orb = W.orbitals;
    // Real harmonics: orthonormal, and each l sums to (2l+1)/4π in every
    // direction (Unsöld) — the reason a filled subshell is round.
    const nd = 4000, ga = Math.PI * (3 - Math.sqrt(5));
    let worstOrtho = 0, worstUnsold = 0;
    for (let l = 0; l <= 3; l++) {
        const H = orb.HARM[l];
        const G = H.map(() => H.map(() => 0));
        for (let i = 0; i < nd; i++) {
            const z = 1 - (2 * i + 1) / nd, r = Math.sqrt(1 - z * z), ph = i * ga;
            const x = r * Math.cos(ph), y = r * Math.sin(ph);
            const v = H.map(h => h.f(x, y, z));
            const sum = v.reduce((s, a) => s + a * a, 0);
            worstUnsold = Math.max(worstUnsold, Math.abs(sum * 4 * Math.PI / (2 * l + 1) - 1));
            for (let a = 0; a < v.length; a++) for (let b = 0; b < v.length; b++) G[a][b] += v[a] * v[b] * 4 * Math.PI / nd;
        }
        for (let a = 0; a < H.length; a++) for (let b = 0; b < H.length; b++) worstOrtho = Math.max(worstOrtho, Math.abs(G[a][b] - (a === b ? 1 : 0)));
    }
    check('real harmonics are orthonormal', worstOrtho < 2e-3, 'worst ' + worstOrtho.toExponential(1));
    check("Unsöld: each full subshell is spherical", worstUnsold < 1e-9, 'worst ' + worstUnsold.toExponential(1));

    // Hydrogen 1s: 90% of the electron lies inside r = 2.6612 a0 exactly.
    const h = scf.run(scf.create(1, [{ n: 1, l: 0, occ: 1 }]));
    const want = Math.exp(-2 * 2.66116) / Math.PI;
    const tS = orb.threshold(h, 0, null), tM = orb.threshold(h, 0, 0);
    check('90% surface of hydrogen 1s', Math.abs(tS / want - 1) < 0.01 && Math.abs(tM / want - 1) < 0.01,
        `spherical ${(tS / want).toFixed(4)}, per-orbital ${(tM / want).toFixed(4)} of exact`);

    // Octant mirroring reproduces a full bake, phase flips included.
    const fe = solved[26];
    const scene = orb.atomScene(fe);
    const d = fe.shells.findIndex(x => x.n === 3 && x.l === 2);
    let worstMirror = 0;
    for (const [sel, style] of [[{ kind: 'orb', shell: d, m: 3 }, 'surface'], [{ kind: 'shell', shell: d }, 'surface'],
                                [{ kind: 'orb', shell: 2, m: 2 }, 'surface'], [{ kind: 'all' }, 'surface']]) {
        const map = orb.makeMap('true', orb.extentFor(scene, sel), orb.coreScale(fe));
        const a = orb.createBake(scene, sel, style, map, 32);
        const b = orb.createBake(scene, sel, style, map, 32);
        b.mirror = false; b.z = 0;
        orb.stepBake(a, 1e9); orb.stepBake(b, 1e9);
        for (let i = 0; i < a.data.length; i++) worstMirror = Math.max(worstMirror, Math.abs(a.data[i] - b.data[i]));
    }
    check('mirrored bake matches a full bake', worstMirror < 1e-5, 'worst voxel difference ' + worstMirror.toExponential(1));
}

// ---- 8. Nuclei ----
if (W.nucleus) {
    const nu = W.nucleus;
    const v = (Z, N) => nu.verdict(Z, N);
    const cases = [
        [1, 0, 'stable'], [1, 1, 'stable'], [1, 2, 'radioactive'], [1, 3, 'unbound'], [1, 10, 'unbound'],
        [2, 3, 'unbound'], [4, 4, 'unbound'], [6, 8, 'radioactive'], [26, 30, 'stable'], [82, 126, 'stable'],
        [92, 146, 'radioactive'], [118, 176, 'radioactive'], [26, 14, 'unbound'], [50, 150, 'unbound'],
    ];
    for (const [Z, N, want] of cases) {
        const got = v(Z, N);
        check(`${ELEMENTS[Z].sym}-${Z + N} is ${want}`, got.kind === want,
            `${got.kind} (${got.source}${got.mode ? ', ' + got.mode : ''}${got.hl != null ? ', ' + nu.fmtTime(got.hl) : ''})`);
    }
    check('H-11 fails on the neutron side, by the model', v(1, 10).source === 'model' && v(1, 10).side === 'neutron',
        'Sn = ' + v(1, 10).sep.Sn.toFixed(1) + ' MeV');
    const t3 = v(1, 2).hl / 31556952;
    check('tritium half-life 12.32 y', Math.abs(t3 - 12.32) < 0.05, t3.toFixed(2) + ' y');
    check('default isotopes H-1, C-12, Fe-56, U-238', nu.defaultN(1) === 0 && nu.defaultN(6) === 6 && nu.defaultN(26) === 30 && nu.defaultN(92) === 146);
    // Viola–Seaborg on measured masses, against the measured U-238 half-life.
    const ua = nu.estimateHalfLife(92, 146).find(e => e.mode === 'A');
    const ratio = ua.t / (4.468e9 * 31556952);
    check('alpha systematics give U-238 within ×3', ratio > 1 / 3 && ratio < 3, 'Qα ' + ua.q.toFixed(3) + ' MeV, ratio ' + ratio.toFixed(2));
    // An unseen neutron-rich tin: bound, short-lived, beta-minus.
    const sn = v(50, 92);
    check('Sn-142 predicted bound, beta-minus', sn.kind === 'predicted' && sn.mode === 'B-', sn.kind + ' ' + sn.mode + ' ' + nu.fmtTime(sn.hl));
    // Packing: no two nucleons overlap by more than a few percent.
    for (const [Z, N] of [[2, 2], [26, 30], [92, 146]]) {
        const p = nu.packing(Z, N);
        let worst = 1e9;
        for (let i = 0; i < p.A; i++) for (let j = i + 1; j < p.A; j++) {
            const d = Math.hypot(p.pos[3 * i] - p.pos[3 * j], p.pos[3 * i + 1] - p.pos[3 * j + 1], p.pos[3 * i + 2] - p.pos[3 * j + 2]);
            worst = Math.min(worst, d / (2 * p.rn));
        }
        check(`${ELEMENTS[Z].sym}-${Z + N} packs without overlap`, worst > 0.85, 'closest pair at ' + worst.toFixed(2) + ' diameters, β2 ' + p.beta.toFixed(2));
    }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
