// ============ ATOM VIEWER — ORBITALS, SCENES, VOLUME BAKING ============
// Zero DOM. Owns `orbitals`.
//
// Sits between the solver and the renderer. The solver hands back radial
// functions R_nl(r); this file turns them into real orbitals
// ψ = R_nl(r)·Y_lm(θ, φ), decides what a selection draws and in what colour,
// and bakes the result into a 3-D texture the ray-marcher can sample.
//
// **The scene is built for molecules even though v1.0 only makes atoms.** A
// scene is a list of CENTRES (a nucleus at a position, with the solver job
// that owns its radial functions) and a list of ORBITALS, each of which is a
// list of TERMS {centre, shell, l, m, coef}. An atomic orbital is one term. A
// molecular orbital in v2.0 is the same object with a term per contributing
// atomic orbital on each nucleus (LCAO), and the general baker below already
// sums terms over centres, so the renderer never needs to know which it got.
// The atom-only fast path (everything spherical, tabulated in radius) is an
// optimisation chosen per bake, not an assumption built into the data.
//
// Three things here are load-bearing:
//
// - **Brightness is electrons per voxel AS DRAWN.** The "Shells" radial scale
//   squeezes the core outward so uranium's 1s (0.02 bohr) and 7s (5 bohr) are
//   both visible. Drawing |ψ|² through that map would show the core as a
//   blinding point; drawing |ψ|²·J, where J is the physical volume per display
//   volume, shows each shell in proportion to how many electrons it holds.
//   With the true scale J is a constant and this is just |ψ|².
// - **Surfaces enclose 90% of the probability, per orbital.** The threshold is
//   found by sorting |ψ|² over a spherical quadrature, not by picking a
//   fraction of the peak. The field baked for the surface is the largest of
//   |ψ_k|/√t_k over the drawn orbitals, so every orbital's own 90% surface is
//   the same isovalue (1) and one shader draws all of them.
// - **The total density of an atom is spherical.** A filled subshell sums to
//   a sphere (Unsöld's theorem), and the solver averages open ones the same
//   way, so "All electrons" is honestly a round cloud. The lobes are what you
//   see when you pull one subshell or one orbital out of it.

const orbitals = (() => {
    const L = 'spdf';

    // Real spherical harmonics (Condon–Shortley phase dropped, the chemist's
    // convention), as functions of a unit vector. Ordered m = −l … l.
    const HARM = [
        [{ name: 's', html: 's', f: () => 0.28209479177387814 }],
        [
            { name: 'py', html: 'p<sub>y</sub>', f: (x, y) => 0.4886025119029199 * y },
            { name: 'pz', html: 'p<sub>z</sub>', f: (x, y, z) => 0.4886025119029199 * z },
            { name: 'px', html: 'p<sub>x</sub>', f: x => 0.4886025119029199 * x },
        ],
        [
            { name: 'dxy', html: 'd<sub>xy</sub>', f: (x, y) => 1.0925484305920792 * x * y },
            { name: 'dyz', html: 'd<sub>yz</sub>', f: (x, y, z) => 1.0925484305920792 * y * z },
            { name: 'dz2', html: 'd<sub>z²</sub>', f: (x, y, z) => 0.31539156525252005 * (3 * z * z - 1) },
            { name: 'dxz', html: 'd<sub>xz</sub>', f: (x, y, z) => 1.0925484305920792 * x * z },
            { name: 'dx2y2', html: 'd<sub>x²−y²</sub>', f: (x, y) => 0.5462742152960396 * (x * x - y * y) },
        ],
        [
            { name: 'fy3x2y2', html: 'f<sub>y(3x²−y²)</sub>', f: (x, y) => 0.5900435899266435 * y * (3 * x * x - y * y) },
            { name: 'fxyz', html: 'f<sub>xyz</sub>', f: (x, y, z) => 2.890611442640554 * x * y * z },
            { name: 'fyz2', html: 'f<sub>yz²</sub>', f: (x, y, z) => 0.4570457994644658 * y * (5 * z * z - 1) },
            { name: 'fz3', html: 'f<sub>z³</sub>', f: (x, y, z) => 0.3731763325901154 * z * (5 * z * z - 3) },
            { name: 'fxz2', html: 'f<sub>xz²</sub>', f: (x, y, z) => 0.4570457994644658 * x * (5 * z * z - 1) },
            { name: 'fzx2y2', html: 'f<sub>z(x²−y²)</sub>', f: (x, y, z) => 1.445305721320277 * z * (x * x - y * y) },
            { name: 'fxx23y2', html: 'f<sub>x(x²−3y²)</sub>', f: (x, y) => 0.5900435899266435 * x * (x * x - 3 * y * y) },
        ],
    ];

    // Box order used for Hund's-rule filling and the diagram: the familiar
    // x, y, z for p; the conventional listing for d and f.
    const BOX_ORDER = [[0], [2, 0, 1], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5, 6]];

    // ---- Colours ----
    const SHELL_RGB = [[0.45, 0.72, 1.0], [1.0, 0.62, 0.32], [0.42, 0.95, 0.62], [0.86, 0.56, 1.0]];
    const M_RGB = [
        [[0.85, 0.9, 1.0]],
        [[0.4, 1.0, 0.5], [0.4, 0.6, 1.0], [1.0, 0.4, 0.35]],                                          // y, z, x
        [[1.0, 0.85, 0.3], [0.3, 0.92, 1.0], [0.45, 0.55, 1.0], [1.0, 0.42, 0.9], [1.0, 0.5, 0.3]],
        [[1.0, 0.4, 0.4], [1.0, 0.75, 0.3], [0.75, 1.0, 0.35], [0.35, 1.0, 0.7], [0.3, 0.8, 1.0], [0.55, 0.5, 1.0], [0.95, 0.45, 1.0]],
    ];
    const PHASE_POS = [1.0, 0.56, 0.22], PHASE_NEG = [0.24, 0.62, 1.0];

    function shellColor(sh) {
        const c = SHELL_RGB[sh.l];
        // Alternate brightness by n so neighbouring shells of one kind separate.
        const k = sh.n % 2 ? 1.0 : 0.72;
        return [c[0] * k, c[1] * k, c[2] * k];
    }
    const css = c => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

    // Hund's rule: one electron in each box, spin up, before any pairs.
    function boxes(sh) {
        const n = 2 * sh.l + 1;
        const up = Math.min(sh.occ, n), down = Math.max(0, sh.occ - n);
        return BOX_ORDER[sh.l].map((m, i) => ({ m, up: i < up, down: i < down, occ: (i < up) + (i < down) }));
    }

    // ---- Scene ----

    function atomScene(job) {
        const centres = [{ x: 0, y: 0, z: 0, Z: job.Z, job }];
        const list = [];
        job.shells.forEach((sh, si) => {
            for (const b of boxes(sh)) {
                list.push({
                    label: sh.n + L[sh.l] + (sh.l ? HARM[sh.l][b.m].name.slice(1) : ''),
                    html: sh.n + HARM[sh.l][b.m].html,
                    shell: si, m: b.m, occ: b.occ, energy: sh.e,
                    terms: [{ centre: 0, shell: si, l: sh.l, m: b.m, coef: 1 }],
                });
            }
        });
        return { centres, orbitals: list, job };
    }

    // Radius (bohr) inside which a shell holds `frac` of its probability.
    function enclosing(job, sh, frac) {
        const g = job.grid;
        let tot = 0;
        const F = new Float64Array(g.M);
        for (let i = 0; i < g.M; i++) { F[i] = g.r2[i] * sh.y[i] * sh.y[i] * g.h; tot += F[i]; }
        let acc = 0;
        for (let i = 0; i < g.M; i++) { acc += F[i]; if (acc >= frac * tot) return g.r[i]; }
        return g.r[g.M - 1];
    }

    // ---- Radial display maps ----
    // d ∈ [0, 1] across the box half-width. 'true': r = d·R. 'shells':
    // r = rs·sinh(d·K), linear in the core and logarithmic outside it.
    function makeMap(kind, R, rs) {
        if (kind === 'true') {
            return { kind, R, rOf: d => d * R, dOf: r => r / R, J: () => R * R * R };
        }
        const K = Math.asinh(R / rs);
        return {
            kind, R, rs, K,
            rOf: d => rs * Math.sinh(d * K),
            dOf: r => Math.asinh(r / rs) / K,
            J: d => {
                const dr = rs * K * Math.cosh(d * K);
                if (d < 1e-6) return dr * dr * dr;
                const r = rs * Math.sinh(d * K);
                return (r / d) * (r / d) * dr;
            },
        };
    }

    // ---- 90% thresholds ----

    const DIRS = (() => {
        const n = 600, out = new Float64Array(3 * n), ga = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            const z = 1 - (2 * i + 1) / n, rr = Math.sqrt(1 - z * z), phi = i * ga;
            out[3 * i] = rr * Math.cos(phi); out[3 * i + 1] = rr * Math.sin(phi); out[3 * i + 2] = z;
        }
        return out;
    })();

    // Value t such that the region where the (weighted) samples exceed t holds
    // `frac` of the total, by a log-spaced histogram.
    function thresholdOf(vals, wts, count, frac) {
        let vmax = 0, tot = 0;
        for (let i = 0; i < count; i++) { if (vals[i] > vmax) vmax = vals[i]; tot += vals[i] * wts[i]; }
        if (vmax <= 0) return 1;
        const B = 4096, lo = Math.log(vmax) - 40, span = 40;
        const hist = new Float64Array(B);
        for (let i = 0; i < count; i++) {
            if (vals[i] <= 0) continue;
            let b = Math.floor((Math.log(vals[i]) - lo) / span * B);
            if (b < 0) continue;
            if (b >= B) b = B - 1;
            hist[b] += vals[i] * wts[i];
        }
        let acc = 0;
        for (let b = B - 1; b >= 0; b--) {
            acc += hist[b];
            if (acc >= frac * tot) return Math.exp(lo + b / B * span);
        }
        return Math.exp(lo);
    }

    const thrCache = new WeakMap();
    // Threshold on R² (spherical, per electron), on (R·Y)² for one real
    // orbital, or (si = −1) on the atom's total density.
    function threshold(job, si, m) {
        let per = thrCache.get(job);
        if (!per) thrCache.set(job, per = new Map());
        const k = si * 16 + (m == null ? 15 : m);
        if (per.has(k)) return per.get(k);
        const sh = job.shells[si], g = job.grid;
        let t;
        if (si < 0) {
            // The whole atom: total density, per bohr³.
            const vals = new Float64Array(g.M), wts = new Float64Array(g.M);
            for (let i = 0; i < g.M; i++) {
                let d = 0;
                for (const x of job.shells) d += x.occ * x.y[i] * x.y[i] / g.r[i];
                vals[i] = d / (4 * Math.PI);
                wts[i] = 4 * Math.PI * g.r2[i] * g.r[i] * g.h;
            }
            t = thresholdOf(vals, wts, g.M, 0.9);
        } else if (m == null) {
            const vals = new Float64Array(g.M), wts = new Float64Array(g.M);
            for (let i = 0; i < g.M; i++) {
                const R = sh.y[i] / g.sq[i];
                vals[i] = R * R / (4 * Math.PI);
                wts[i] = 4 * Math.PI * g.r2[i] * g.r[i] * g.h;
            }
            t = thresholdOf(vals, wts, g.M, 0.9);
        } else {
            const stride = 3, nd = DIRS.length / 3;
            const nr = Math.ceil(g.M / stride);
            const vals = new Float64Array(nr * nd), wts = new Float64Array(nr * nd);
            const f = HARM[sh.l][m].f;
            const Y2 = new Float64Array(nd);
            for (let d = 0; d < nd; d++) { const y = f(DIRS[3 * d], DIRS[3 * d + 1], DIRS[3 * d + 2]); Y2[d] = y * y; }
            let c = 0;
            for (let i = 0; i < g.M; i += stride) {
                const R = sh.y[i] / g.sq[i], R2 = R * R;
                const w = g.r2[i] * g.r[i] * g.h * stride * 4 * Math.PI / nd;
                for (let d = 0; d < nd; d++) { vals[c] = R2 * Y2[d]; wts[c] = w; c++; }
            }
            t = thresholdOf(vals, wts, c, 0.9);
        }
        per.set(k, t);
        return t;
    }

    // ---- Selections ----
    // { kind: 'all' } | { kind: 'shell', shell } | { kind: 'orb', shell, m }

    // Which orbitals a selection draws, each with weight and colour.
    function layers(scene, sel) {
        const job = scene.job;
        if (sel.kind === 'all') {
            return job.shells.map((sh, si) => ({ si, m: null, w: sh.occ, rgb: shellColor(sh) }));
        }
        const sh = job.shells[sel.shell];
        if (!sh) return [];
        if (sel.kind === 'shell') {
            if (sh.l === 0) return [{ si: sel.shell, m: 0, w: sh.occ, rgb: M_RGB[0][0] }];
            return boxes(sh).map(b => ({ si: sel.shell, m: b.m, w: b.occ, ghost: b.occ === 0, rgb: M_RGB[sh.l][b.m] }));
        }
        return [{ si: sel.shell, m: sel.m, w: 1, phase: true }];
    }

    // Box half-width (bohr) that frames a selection.
    function extentFor(scene, sel) {
        const job = scene.job;
        if (!job.shells.length) return 1;
        if (sel.kind === 'all') {
            let R = 0;
            for (const sh of job.shells) R = Math.max(R, enclosing(job, sh, 0.995));
            return R * 1.04;
        }
        return enclosing(job, job.shells[sel.shell], 0.995) * 1.04;
    }

    // Core scale for the 'shells' map: half the 1s radius.
    function coreScale(job) {
        const s = job.shells.find(x => x.n === 1) || job.shells[0];
        return s ? 0.5 * scf.meanRadius(job, s) : 0.5;
    }

    // ---- Baking ----
    // Produces RGBA floats, G³ voxels, x fastest. Cloud: rgb = emission,
    // a = extinction. Surface: rgb = colour, a = field with the surface at 1.

    const TABLE_N = 2048;
    const D_MAX = Math.sqrt(3);

    function createBake(scene, sel, style, map, G) {
        const job = scene.job;
        const lay = layers(scene, sel);
        const data = new Float32Array(G * G * G * 4);
        // One nucleus at the origin: every real orbital is even or odd along
        // each axis, so one octant is computed and mirrored into the other
        // seven. A molecule (several centres) takes the general path.
        const mirror = scene.centres.length === 1 && G % 2 === 0;
        const bake = { G, data, z: mirror ? G / 2 : 0, done: false, style, sel, map, mirror, parity: null };
        if (!lay.length) { bake.done = true; return bake; }
        if (sel.kind === 'orb') {
            const f = HARM[job.shells[sel.shell].l][sel.m].f;
            const x = 0.31, y = 0.57, z = 0.76, v = f(x, y, z);
            bake.parity = [Math.sign(f(-x, y, z) * v), Math.sign(f(x, -y, z) * v), Math.sign(f(x, y, -z) * v)];
        }

        // Radial tables over display radius d.
        const dStep = D_MAX / (TABLE_N - 1);
        const shellsUsed = [...new Set(lay.map(x => x.si))];
        const Rtab = new Map();
        const Jtab = new Float64Array(TABLE_N);
        for (let j = 0; j < TABLE_N; j++) Jtab[j] = map.J(j * dStep);
        for (const si of shellsUsed) {
            const t = new Float64Array(TABLE_N), sh = job.shells[si];
            for (let j = 0; j < TABLE_N; j++) {
                const r = map.rOf(j * dStep);
                t[j] = r > scf.R_MAX ? 0 : scf.radialAt(job, sh, Math.max(r, 1e-12));
            }
            Rtab.set(si, t);
        }

        if (sel.kind === 'all') {
            // Everything is a function of radius alone: tabulate the voxel.
            // The surface is the total density's 90% surface; its colour, which
            // is what the cut face shows, is whichever subshell holds the most
            // electrons at that radius — so a cutaway reads as an onion.
            const tab = new Float32Array(TABLE_N * 4);
            const tTot = style === 'surface' ? threshold(job, -1, null) : 1;
            for (let j = 0; j < TABLE_N; j++) {
                let r = 0, g = 0, b = 0, a = 0, best = 0, bc = null, tot = 0;
                for (const L0 of lay) {
                    const R = Rtab.get(L0.si)[j];
                    const w = L0.w * R * R / (4 * Math.PI);
                    tot += w;
                    if (style === 'cloud') {
                        const wj = w * Jtab[j];
                        r += wj * L0.rgb[0]; g += wj * L0.rgb[1]; b += wj * L0.rgb[2]; a += wj;
                    } else if (w > best) { best = w; bc = L0.rgb; }
                }
                if (style === 'cloud') tab.set([r, g, b, a], 4 * j);
                else if (bc) tab.set([bc[0], bc[1], bc[2], Math.min(Math.sqrt(tot / tTot), 3)], 4 * j);
            }
            bake.kernel = (x, y, z, o) => {
                const d = Math.sqrt(x * x + y * y + z * z);
                const u = d / dStep, j = u | 0;
                if (j >= TABLE_N - 1) return;
                const f = u - j, k = 4 * j;
                for (let c = 0; c < 4; c++) data[o + c] = tab[k + c] * (1 - f) + tab[k + 4 + c] * f;
            };
        } else {
            const items = lay.map(L0 => ({
                R: Rtab.get(L0.si),
                f: HARM[job.shells[L0.si].l][L0.m].f,
                w: L0.ghost ? 0.12 : L0.w || 1,
                rgb: L0.rgb, phase: L0.phase, ghost: L0.ghost,
                t: style === 'surface' ? threshold(job, L0.si, L0.m) : 1,
            }));
            // Ghosts (empty boxes of an open subshell) show as faint cloud
            // only; a surface for an orbital nobody is in would mislead.
            const surf = items.filter(it => !it.ghost);
            bake.kernel = (x, y, z, o) => {
                const d = Math.sqrt(x * x + y * y + z * z);
                const u = d / dStep, j = u | 0;
                if (j >= TABLE_N - 1) return;
                const fr = u - j;
                const inv = d > 1e-9 ? 1 / d : 0;
                const ux = x * inv, uy = y * inv, uz = inv ? z * inv : 1;
                if (style === 'cloud') {
                    const J = Jtab[j] * (1 - fr) + Jtab[j + 1] * fr;
                    let r = 0, g = 0, b = 0, a = 0;
                    for (const it of items) {
                        const R = it.R[j] * (1 - fr) + it.R[j + 1] * fr;
                        const psi = R * it.f(ux, uy, uz);
                        const w = it.w * psi * psi * J;
                        const c = it.phase ? (psi >= 0 ? PHASE_POS : PHASE_NEG) : it.rgb;
                        r += w * c[0]; g += w * c[1]; b += w * c[2]; a += w;
                    }
                    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
                } else {
                    let best = 0, c = null;
                    for (const it of surf) {
                        const R = it.R[j] * (1 - fr) + it.R[j + 1] * fr;
                        const psi = R * it.f(ux, uy, uz);
                        const s = psi * psi / it.t;
                        if (s > best) { best = s; c = it.phase ? (psi >= 0 ? PHASE_POS : PHASE_NEG) : it.rgb; }
                    }
                    if (c) { data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = Math.min(Math.sqrt(best), 3); }
                }
            };
        }
        return bake;
    }

    // Fill slices until the budget (ms) is spent. On the last slice, a cloud
    // bake is tone-mapped in place.
    function stepBake(bake, budgetMs) {
        if (bake.done) return true;
        const t0 = performance.now();
        const { G, data } = bake;
        const s = 2 / G;
        const lo = bake.mirror ? G / 2 : 0;
        while (bake.z < G) {
            const z = -1 + (bake.z + 0.5) * s;
            for (let yi = lo; yi < G; yi++) {
                const y = -1 + (yi + 0.5) * s;
                let o = ((bake.z * G + yi) * G + lo) * 4;
                for (let xi = lo; xi < G; xi++, o += 4) bake.kernel(-1 + (xi + 0.5) * s, y, z, o);
            }
            bake.z++;
            if (performance.now() - t0 > budgetMs) break;
        }
        if (bake.z >= G) {
            // Tone mapping is per voxel and symmetric, so it runs on the
            // octant before the copy: an eighth of the pow() calls.
            if (bake.style === 'cloud') toneMap(bake);
            if (bake.mirror) mirrorOctant(bake);
            bake.done = true;
        }
        return bake.done;
    }

    // Copy the computed octant (all indices >= G/2) into the other seven.
    // A single orbital's phase colour flips across each plane it is odd in.
    function mirrorOctant(bake) {
        const { G, data, parity, style } = bake;
        const h = G / 2;
        const P = PHASE_POS, Q = PHASE_NEG;
        for (let z = 0; z < G; z++) {
            const sz = z < h ? G - 1 - z : z;
            for (let y = 0; y < G; y++) {
                const sy = y < h ? G - 1 - y : y;
                for (let x = 0; x < G; x++) {
                    if (x >= h && y >= h && z >= h) continue;
                    const sx = x < h ? G - 1 - x : x;
                    const o = ((z * G + y) * G + x) * 4, i = ((sz * G + sy) * G + sx) * 4;
                    const a = data[i + 3];
                    let flip = false;
                    if (parity) flip = ((x < h ? parity[0] : 1) * (y < h ? parity[1] : 1) * (z < h ? parity[2] : 1)) < 0;
                    if (flip && a > 0) {
                        // Which phase the source voxel carries: its red channel
                        // is the tell (positive is warm).
                        const pos = data[i] > data[i + 2];
                        const c = pos ? Q : P;
                        const k = style === 'cloud' ? a : 1;
                        data[o] = c[0] * k; data[o + 1] = c[1] * k; data[o + 2] = c[2] * k;
                    } else {
                        data[o] = data[i]; data[o + 1] = data[i + 1]; data[o + 2] = data[i + 2];
                    }
                    data[o + 3] = a;
                }
            }
        }
    }

    // Cloud values span decades: the whole atom's core is thousands of times
    // denser than its valence shell, so it is compressed with a square root.
    // A single orbital or subshell has no such range and keeps more contrast,
    // which is what makes its lobes read as lobes. Either way the 99th
    // percentile of occupied voxels lands at 1.
    function toneMap(bake) {
        const { data, G } = bake;
        const gamma = bake.sel.kind === 'all' ? 0.5 : 0.8;
        const lo = bake.mirror ? G / 2 : 0;
        // Voxel indices of the computed region (the octant when mirroring).
        const each = fn => {
            for (let z = lo; z < G; z++) for (let y = lo; y < G; y++) {
                let i = (z * G + y) * G + lo;
                for (let x = lo; x < G; x++, i++) fn(i);
            }
        };
        const count = (G - lo) ** 3;
        const buf = new Float32Array(Math.ceil(count / 3) + 1);
        let m = 0, c = 0;
        each(i => { if (c++ % 3 === 0 && data[4 * i + 3] > 0) buf[m++] = data[4 * i + 3]; });
        if (!m) return;
        const sample = buf.subarray(0, m).sort();
        const ref = sample[Math.floor(m * 0.99)] || sample[m - 1];
        each(i => {
            const a = data[4 * i + 3];
            if (a <= 0) { data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = data[4 * i + 3] = 0; return; }
            const A = Math.min(gamma === 0.5 ? Math.sqrt(a / ref) : Math.pow(a / ref, gamma), 6);
            const k = A / a;
            data[4 * i] *= k; data[4 * i + 1] *= k; data[4 * i + 2] *= k; data[4 * i + 3] = A;
        });
    }

    // Legend entries for a selection, for the overlay.
    function legend(scene, sel) {
        const job = scene.job;
        return layers(scene, sel).map(L0 => {
            const sh = job.shells[L0.si];
            if (L0.phase) return null;
            const name = L0.m == null ? sh.n + L[sh.l] : sh.n + HARM[sh.l][L0.m].html;
            return { html: name, color: css(L0.rgb), ghost: !!L0.ghost };
        }).filter(Boolean);
    }

    return {
        HARM, BOX_ORDER, L, atomScene, boxes, enclosing, makeMap, threshold, layers,
        extentFor, coreScale, createBake, stepBake, legend, shellColor, css,
        PHASE_POS, PHASE_NEG, M_RGB,
    };
})();
