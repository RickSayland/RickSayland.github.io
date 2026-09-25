// ============ ATOM VIEWER — NUCLEI ============
// Zero DOM. Owns `nucleus`.
//
// Whether a given number of protons and neutrons makes a nucleus is answered
// in two tiers, and the page always says which one it used:
//
// 1. **The chart.** nuclides.js holds every ground state anyone has observed
//    (IAEA / ENSDF / AME2020). If the combination is there, its half-life,
//    decay modes, abundance and binding energy are measurements.
// 2. **The liquid drop, anchored.** Anything absent has never been made. The
//    Bethe–Weizsäcker formula is poor on its own for light nuclei, so it is
//    used only for DIFFERENCES: each element's curve is shifted to agree with
//    the last measured isotope on that side of the valley, and separation
//    energies and Q-values then come from the formula's slope, not its level.
//    Hydrogen-11 comes out with its last neutron unbound by ~9 MeV, which is
//    the right answer for the right reason.
//
// Two things here are load-bearing:
//
// - **"Unbound" is not the same as "short-lived".** A nucleus that loses a
//   neutron in 10^-22 s never really existed as a nucleus — a neutron crosses
//   it in about that long — while one that beta-decays in a millisecond is a
//   perfectly good nucleus that happens not to last. Anything under a
//   picosecond is classed as a resonance, whatever its decay mode.
// - **Half-life estimates for unobserved nuclides are orders of magnitude.**
//   Beta rates use Sargent's f with a typical allowed log ft of 5, alpha rates
//   the Viola–Seaborg systematics. Both are exponentially sensitive to a Q
//   value the liquid drop only knows to an MeV or two, and the page labels
//   them as estimates.

const nucleus = (() => {
    const table = new Map();
    const byZ = [];                  // per Z: sorted list of observed N
    const key = (Z, N) => Z * 1000 + N;

    for (const line of NUCLIDE_ROWS.split('\n')) {
        if (!line) continue;
        const f = line.split('|');
        const Z = +f[0], N = +f[1];
        const modes = f[4] ? f[4].split(' ').map(t => {
            const [m, p] = t.split(':');
            return { mode: m, pct: p === '?' ? null : +p };
        }) : [];
        const rec = {
            Z, N, A: Z + N,
            stable: f[2] === 'S',
            hl: f[2] === 'S' ? Infinity : (f[2] === '' ? null : +f[2]),
            limit: f[3],
            modes,
            abund: f[5] === '' ? null : +f[5],
            be: f[6] === '' ? null : +f[6] / 1000,          // MeV per nucleon
            jp: f[7],
            radius: f[8] === '' ? null : +f[8],             // rms charge radius, fm
            extrapolated: f[9] === '1',
            year: f[10] ? +f[10] : null,
        };
        table.set(key(Z, N), rec);
        (byZ[Z] = byZ[Z] || []).push(N);
    }
    for (const list of byZ) if (list) list.sort((a, b) => a - b);

    const lookup = (Z, N) => table.get(key(Z, N)) || null;

    // Most abundant isotope, else the longest-lived one.
    function defaultN(Z) {
        let best = null, bestA = -1, bestHl = -1;
        for (const N of byZ[Z] || []) {
            const r = lookup(Z, N);
            if (r.abund != null && r.abund > bestA) { best = N; bestA = r.abund; }
        }
        if (best != null) return best;
        for (const N of byZ[Z] || []) {
            const r = lookup(Z, N);
            if (r.hl != null && r.hl > bestHl) { best = N; bestHl = r.hl; }
        }
        return best != null ? best : Math.round(Z * 1.5);
    }

    // ---- Binding energies ----

    function semf(Z, N) {
        const A = Z + N;
        if (A <= 0 || Z < 0 || N < 0) return 0;
        if (A === 1) return 0;
        const aV = 15.75, aS = 17.8, aC = 0.711, aA = 23.7, aP = 11.18;
        let B = aV * A - aS * Math.pow(A, 2 / 3) - aC * Z * (Z - 1) / Math.cbrt(A) - aA * (N - Z) * (N - Z) / A;
        if (Z % 2 === 0 && N % 2 === 0) B += aP / Math.sqrt(A);
        else if (Z % 2 === 1 && N % 2 === 1) B -= aP / Math.sqrt(A);
        return B;
    }

    // Total binding energy in MeV: measured where there is a measurement,
    // otherwise the liquid drop shifted onto the nearest measured isotope.
    function binding(Z, N) {
        if (Z < 0 || N < 0) return -Infinity;
        if (Z + N === 0) return 0;
        const r = lookup(Z, N);
        if (r && r.be != null) return r.be * r.A;
        const list = byZ[Z];
        if (!list || !list.length) return semf(Z, N);
        // Nearest measured isotope of the same element.
        let anchor = null, dist = Infinity;
        for (const n of list) {
            const rr = lookup(Z, n);
            if (rr.be == null) continue;
            const d = Math.abs(n - N);
            if (d < dist) { dist = d; anchor = rr; }
        }
        if (!anchor) return semf(Z, N);
        return semf(Z, N) + (anchor.be * anchor.A - semf(Z, anchor.N));
    }

    const M_N_MINUS_H = 0.782347;       // m_n − m(¹H), MeV
    const B_ALPHA = 28.2957;

    function separation(Z, N) {
        const B = binding(Z, N);
        return {
            Sn: N > 0 ? B - binding(Z, N - 1) : Infinity,
            S2n: N > 1 ? B - binding(Z, N - 2) : Infinity,
            Sp: Z > 0 ? B - binding(Z - 1, N) : Infinity,
            S2p: Z > 1 ? B - binding(Z - 2, N) : Infinity,
        };
    }

    function qValues(Z, N) {
        const B = binding(Z, N);
        return {
            betaMinus: N > 0 ? M_N_MINUS_H + binding(Z + 1, N - 1) - B : -Infinity,
            ec: Z > 0 ? -M_N_MINUS_H + binding(Z - 1, N + 1) - B : -Infinity,
            alpha: Z > 2 && N > 2 ? binding(Z - 2, N - 2) + B_ALPHA - B : -Infinity,
        };
    }

    // Sargent's integral for an allowed beta spectrum, Coulomb correction
    // ignored. W0 is the total endpoint energy in electron masses.
    function sargent(W0) {
        if (W0 <= 1) return 0;
        const p = Math.sqrt(W0 * W0 - 1);
        return p * (2 * W0 ** 4 - 9 * W0 ** 2 - 8) / 30 + W0 * Math.log(W0 + p) / 4;
    }

    function estimateHalfLife(Z, N) {
        const q = qValues(Z, N);
        const out = [];
        const ME = 0.51099895;
        if (q.betaMinus > 0) {
            out.push({ mode: 'B-', t: 1e5 / sargent(1 + q.betaMinus / ME), q: q.betaMinus });
        }
        if (q.ec > 0) {
            const qp = q.ec - 2 * ME;
            let f = qp > 0 ? sargent(1 + qp / ME) : 0;
            // K-capture: 2π(αZ)³ q², in the same units as Sargent's f.
            const aZ = Z / 137.036;
            f += 2 * Math.PI * aZ ** 3 * (q.ec / ME) ** 2;
            out.push({ mode: qp > 0 ? 'EC+B+' : 'EC', t: 1e5 / f, q: q.ec });
        }
        if (q.alpha > 0.5) {
            // Viola–Seaborg with Sobiczewski, Patyk & Ćwiok's (1989) constants;
            // Z is the parent's. The odd-nucleon hindrance is their average.
            let h = 0;
            if (Z % 2 && N % 2) h = 1.114; else if (Z % 2) h = 0.772; else if (N % 2) h = 1.066;
            const lg = (1.66175 * Z - 8.5166) / Math.sqrt(q.alpha) - 0.20228 * Z - 33.9069 + h;
            out.push({ mode: 'A', t: Math.pow(10, lg), q: q.alpha });
        }
        out.sort((a, b) => a.t - b.t);
        return out;
    }

    // ---- Decay modes ----

    const MODE_TEXT = {
        'B-': 'beta-minus decay',
        'B-N': 'beta decay, then a neutron',
        'B-2N': 'beta decay, then two neutrons',
        'B-A': 'beta decay, then an alpha',
        '2B-': 'double beta decay',
        'B+': 'positron emission',
        'EC': 'electron capture',
        'EC+B+': 'electron capture / positron emission',
        '2EC': 'double electron capture',
        '2B+': 'double positron emission',
        'ECP': 'electron capture, then a proton',
        'B+P': 'positron emission, then a proton',
        'ECSF': 'electron capture, then fission',
        'A': 'alpha decay',
        'SF': 'spontaneous fission',
        'N': 'neutron emission',
        '2N': 'two-neutron emission',
        'P': 'proton emission',
        '2P': 'two-proton emission',
        'IT': 'isomeric transition',
    };
    const modeText = m => MODE_TEXT[m] || m;

    // Daughter of a decay mode, as [dZ, dN]. Fission has no single daughter.
    const DAUGHTER = {
        'B-': [1, -1], 'B-N': [1, -2], 'B-2N': [1, -3], 'B-A': [-1, -3], '2B-': [2, -2],
        'B+': [-1, 1], 'EC': [-1, 1], 'EC+B+': [-1, 1], '2EC': [-2, 2], '2B+': [-2, 2],
        'ECP': [-2, 1], 'B+P': [-2, 1],
        'A': [-2, -2], 'N': [0, -1], '2N': [0, -2], 'P': [-1, 0], '2P': [-2, 0],
    };

    function primaryMode(rec) {
        if (!rec.modes.length) return null;
        let best = rec.modes[0];
        for (const m of rec.modes) if ((m.pct ?? 100) > (best.pct ?? 100)) best = m;
        return best.mode;
    }

    const PARTICLE = new Set(['N', '2N', 'P', '2P']);
    const RESONANCE_S = 1e-12;

    // ---- Verdict ----
    // kind: 'stable' | 'radioactive' | 'unbound' | 'predicted' | 'observed'
    function verdict(Z, N) {
        const A = Z + N;
        const rec = lookup(Z, N);
        const list = byZ[Z] || [];
        const context = {
            lightest: list.length ? list[0] + Z : null,
            heaviest: list.length ? list[list.length - 1] + Z : null,
            stableCount: list.filter(n => lookup(Z, n).stable).length,
        };
        const base = { Z, N, A, rec, context, source: rec ? 'data' : 'model' };

        if (rec) {
            let mode = primaryMode(rec);
            // Some resonances (H-6, H-7) are listed with a width but no decay
            // mode. They fall apart by shedding whatever is least bound — H-7
            // holds its last neutron but not its last pair.
            if (!mode && !rec.stable && (rec.hl == null || rec.hl < RESONANCE_S)) {
                const s = separation(Z, N);
                const opts = [['N', s.Sn], ['2N', s.S2n], ['P', s.Sp], ['2P', s.S2p]].filter(o => o[1] < 0);
                if (opts.length) mode = opts.sort((a, b) => a[1] - b[1])[0][0];
            }
            if (rec.stable) return { ...base, kind: 'stable', hl: Infinity };
            if (rec.hl != null && rec.hl < RESONANCE_S) {
                return { ...base, kind: 'unbound', hl: rec.hl, mode, daughter: DAUGHTER[mode] || null };
            }
            if (rec.hl == null) {
                if (mode && PARTICLE.has(mode)) return { ...base, kind: 'unbound', hl: null, mode, daughter: DAUGHTER[mode] || null };
                return { ...base, kind: 'observed', hl: null, mode, daughter: mode ? DAUGHTER[mode] || null : null };
            }
            return { ...base, kind: 'radioactive', hl: rec.hl, mode, daughter: DAUGHTER[mode] || null };
        }

        // Never observed: ask the anchored liquid drop.
        const s = separation(Z, N);
        if (N > 0 && (s.Sn < 0 || (N % 2 === 0 && s.S2n < 0))) {
            return { ...base, kind: 'unbound', side: 'neutron', sep: s, hl: 1e-21,
                     mode: s.Sn < 0 ? 'N' : '2N', daughter: s.Sn < 0 ? DAUGHTER.N : DAUGHTER['2N'] };
        }
        if (Z > 1 && (s.Sp < 0 || (Z % 2 === 0 && s.S2p < 0))) {
            return { ...base, kind: 'unbound', side: 'proton', sep: s, hl: 1e-21,
                     mode: s.Sp < 0 ? 'P' : '2P', daughter: s.Sp < 0 ? DAUGHTER.P : DAUGHTER['2P'] };
        }
        const est = estimateHalfLife(Z, N);
        const first = est[0] || null;
        return { ...base, kind: 'predicted', sep: s, estimates: est,
                 hl: first ? first.t : Infinity, mode: first ? first.mode : null,
                 daughter: first ? DAUGHTER[first.mode] : null };
    }

    // ---- Shape ----

    const MAGIC = [2, 8, 20, 28, 50, 82, 126, 184];
    const valence = x => Math.min(...MAGIC.map(m => Math.abs(x - m)));

    // Quadrupole deformation, estimated from how far both nucleon counts are
    // from closed shells (Casten's N_p·N_n scheme). Doubly magic nuclei come
    // out spherical; mid-shell rare earths and actinides reach ~0.3. It is a
    // heuristic for drawing, not a calculation.
    function deformation(Z, N) {
        const A = Z + N;
        if (A < 6) return 0;
        const pn = valence(Z) * valence(N);
        return 0.3 * (1 - Math.exp(-pn / (2 * Math.pow(A, 2 / 3))));
    }

    // Equivalent sharp-surface radius, fm: measured rms charge radius × √(5/3)
    // where there is one, else 1.2·A^(1/3).
    function radius(Z, N) {
        const rec = lookup(Z, N);
        const A = Z + N;
        if (rec && rec.radius && A > 1) return rec.radius * Math.sqrt(5 / 3);
        return A <= 1 ? 0.84 : 1.2 * Math.cbrt(A);
    }

    function mulberry32(a) {
        return () => {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // Nucleons as touching balls inside the nuclear radius: random start,
    // then relaxed so no two overlap and none leave the (possibly prolate)
    // surface. Deterministic per (Z, N). Positions in fm.
    function packing(Z, N) {
        const A = Z + N;
        const rand = mulberry32(key(Z, N) * 2654435761);
        const R = radius(Z, N);
        const beta = deformation(Z, N);
        const c = 1 + 0.63 * beta, a = 1 - 0.315 * beta;
        const vol = Math.cbrt(a * a * c);
        const ax = a / vol, az = c / vol;
        // Ball size that fills the nucleus at a little under random close
        // packing, so the balls nearly touch.
        const rn = A === 1 ? 0.84 : Math.max(0.55, R * Math.cbrt(0.5 / A));
        const inner = Math.max(0, R - rn);
        const pos = new Float32Array(3 * A);
        for (let i = 0; i < A; i++) {
            let x, y, z;
            do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; } while (x * x + y * y + z * z > 1);
            pos[3 * i] = x * inner * ax; pos[3 * i + 1] = y * inner * ax; pos[3 * i + 2] = z * inner * az;
        }
        const d = 2 * rn * 0.98, d2 = d * d;
        const iters = A > 150 ? 90 : 160;
        for (let it = 0; it < iters; it++) {
            for (let i = 0; i < A; i++) {
                const ix = 3 * i;
                for (let j = i + 1; j < A; j++) {
                    const jx = 3 * j;
                    const dx = pos[jx] - pos[ix], dy = pos[jx + 1] - pos[ix + 1], dz = pos[jx + 2] - pos[ix + 2];
                    const q = dx * dx + dy * dy + dz * dz;
                    if (q >= d2) continue;
                    const dist = Math.sqrt(q) || 1e-3;
                    const push = 0.5 * (d - dist) / dist;
                    pos[ix] -= dx * push; pos[ix + 1] -= dy * push; pos[ix + 2] -= dz * push;
                    pos[jx] += dx * push; pos[jx + 1] += dy * push; pos[jx + 2] += dz * push;
                }
            }
            // A gentle squeeze keeps the pile dense and a soft surface keeps it
            // round, but overlap wins: the last quarter of the passes only
            // separate, so a few-body nucleus bulges rather than interpenetrates.
            if (it > iters * 0.75 || inner <= 0) continue;
            for (let i = 0; i < A; i++) {
                const ix = 3 * i;
                pos[ix] *= 0.995; pos[ix + 1] *= 0.995; pos[ix + 2] *= 0.995;
                const s = Math.sqrt((pos[ix] / ax) ** 2 + (pos[ix + 1] / ax) ** 2 + (pos[ix + 2] / az) ** 2) / inner;
                if (s > 1) { const k = 1 - 0.5 * (1 - 1 / s); pos[ix] *= k; pos[ix + 1] *= k; pos[ix + 2] *= k; }
            }
        }
        // Which balls are protons: a seeded shuffle.
        const type = new Uint8Array(A);
        for (let i = 0; i < Z; i++) type[i] = 1;
        for (let i = A - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = type[i]; type[i] = type[j]; type[j] = t;
        }
        return { pos, type, R, rn, beta, A };
    }

    // ---- Formatting ----

    function fmtTime(s) {
        if (s == null) return 'unknown';
        if (s === Infinity) return 'stable';
        const YEAR = 31556952;
        if (s < 1e-9) {
            const e = Math.floor(Math.log10(s));
            return (s / 10 ** e).toFixed(1) + ' × 10' + sup(e) + ' s';
        }
        if (s < 1e-6) return (s * 1e9).toPrecision(3) + ' ns';
        if (s < 1e-3) return (s * 1e6).toPrecision(3) + ' µs';
        if (s < 1) return (s * 1e3).toPrecision(3) + ' ms';
        if (s < 120) return s.toPrecision(3) + ' s';
        if (s < 7200) return (s / 60).toPrecision(3) + ' min';
        if (s < 172800) return (s / 3600).toPrecision(3) + ' h';
        if (s < YEAR * 2) return (s / 86400).toPrecision(3) + ' days';
        const y = s / YEAR;
        if (y < 100) return y.toPrecision(3) + ' years';
        if (y < 1e4) return Math.round(y).toLocaleString('en-US') + ' years';
        if (y < 1e6) return (y / 1e3).toPrecision(3) + ' thousand years';
        if (y < 1e9) return (y / 1e6).toPrecision(3) + ' million years';
        if (y < 1e12) return (y / 1e9).toPrecision(3) + ' billion years';
        const e = Math.floor(Math.log10(y));
        return (y / 10 ** e).toFixed(1) + ' × 10' + sup(e) + ' years';
    }

    const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺' };
    function sup(n) { return String(n).split('').map(c => SUP[c] || c).join(''); }

    return {
        lookup, defaultN, binding, separation, qValues, verdict, estimateHalfLife,
        packing, radius, deformation, modeText, primaryMode, fmtTime, sup,
        observed: Z => byZ[Z] || [], table, MAGIC,
    };
})();
