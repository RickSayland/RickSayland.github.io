// ============ WARP FIELD ENGINEERING — THE EINSTEIN ENGINE ============
// Metric in, matter out. Zero DOM.
//
// Given any stationary metric g_μν(x, y, z), this computes the Einstein
// tensor by finite differences — Christoffels, their derivatives, Ricci — and
// reads the stress-energy the geometry demands off T = G / 8π. Then it asks
// every observer it can think of what they would measure. This is the job
// Warp Factory (Helmerich et al. 2024) does for the research papers, and it
// is why nothing in metrics.js states an energy density: a new drive is a new
// metric function, and the verdict on it comes from the same code as the
// verdict on Alcubierre's.
//
// Two things here are load-bearing:
//
// - **Eulerian energy is not the energy condition.** Every positive-energy
//   warp claim so far has been a claim about the observers who ride the time
//   slices (Eulerian). The weak energy condition is a statement about ALL
//   timelike observers, and Santiago, Schuster & Visser (2021) showed a
//   generic shift-only warp drive fails the null condition for somebody. So
//   the Eulerian density is reported, but the verdict samples 48 directions ×
//   4 speeds per point and only passes a condition nobody violates.
// - **The grid is refined on the walls, not uniform.** A 10 m wall on a
//   100 m bubble is one pixel of a uniform grid and the engine would step
//   straight over the only place anything happens. Each family declares its
//   features and the radial nodes pile up across them.

const SYM = [0, 1, 2, 3, 1, 4, 5, 6, 2, 5, 7, 8, 3, 6, 8, 9];

// Unit vectors spread evenly over the sphere: the observers' directions.
const EC_DIRS = (() => {
    const n = 48, out = new Float64Array(n * 3);
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = 1 - 2 * (i + 0.5) / n;
        const rr = Math.sqrt(1 - y * y);
        out[i * 3] = Math.cos(ga * i) * rr;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = Math.sin(ga * i) * rr;
    }
    return out;
})();
const EC_SPEEDS = [0, 0.5, 0.9, 0.99];

function invert4(m, out) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    const id = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
    return det;
}

const einstein = {
    NTH: 36,
    metric: null,
    grid: null,
    f: null,
    idx: 0,
    total: 0,
    done: true,
    version: 0,
    totals: null,

    // Scratch, allocated once: the hot path must not allocate.
    _s: {
        c0: new Float64Array(10),
        cp: [0, 1, 2].map(() => new Float64Array(10)),
        cm: [0, 1, 2].map(() => new Float64Array(10)),
        cq: Array.from({ length: 12 }, () => new Float64Array(10)),
        dg: new Float64Array(40), ddg: new Float64Array(160),
        gf: new Float64Array(16), gi: new Float64Array(16), dgi: new Float64Array(64),
        tmp: new Float64Array(16),
        C: new Float64Array(64), Gm: new Float64Array(64),
        dC: new Float64Array(256), dGm: new Float64Array(256),
        Ric: new Float64Array(16), T: new Float64Array(16),
        e: new Float64Array(16), Tt: new Float64Array(16),
        out: {}
    },

    // ---- The curvature at one point ----
    //
    // Fills s.T (coordinate basis) and s.Tt (Eulerian orthonormal frame), and
    // returns the Eulerian expansion (York time) and lapse through s.out.
    curvature(metric, x, y, z, h) {
        const s = this._s, g = metric.g;
        const c0 = s.c0, cp = s.cp, cm = s.cm, cq = s.cq, dg = s.dg, ddg = s.ddg;
        const P = [x, y, z];

        g(x, y, z, c0);
        for (let a = 0; a < 3; a++) {
            P[a] += h; g(P[0], P[1], P[2], cp[a]);
            P[a] -= 2 * h; g(P[0], P[1], P[2], cm[a]);
            P[a] += h;
        }
        const pairs = [0, 1, 0, 2, 1, 2];
        for (let k = 0; k < 3; k++) {
            const a = pairs[k * 2], b = pairs[k * 2 + 1];
            for (let q = 0; q < 4; q++) {
                const sa = q < 2 ? h : -h, sb = q % 2 === 0 ? h : -h;
                P[a] += sa; P[b] += sb;
                g(P[0], P[1], P[2], cq[k * 4 + q]);
                P[a] -= sa; P[b] -= sb;
            }
        }

        dg.fill(0); ddg.fill(0);
        const ih2 = 1 / (h * h);
        for (let a = 0; a < 3; a++) {
            const A = a + 1;
            for (let k = 0; k < 10; k++) {
                dg[A * 10 + k] = (cp[a][k] - cm[a][k]) / (2 * h);
                ddg[(A * 4 + A) * 10 + k] = (cp[a][k] - 2 * c0[k] + cm[a][k]) * ih2;
            }
        }
        for (let k = 0; k < 3; k++) {
            const A = pairs[k * 2] + 1, B = pairs[k * 2 + 1] + 1;
            const pp = cq[k * 4], pm = cq[k * 4 + 1], mp = cq[k * 4 + 2], mm = cq[k * 4 + 3];
            for (let i = 0; i < 10; i++) {
                const v = (pp[i] - pm[i] - mp[i] + mm[i]) * 0.25 * ih2;
                ddg[(A * 4 + B) * 10 + i] = v;
                ddg[(B * 4 + A) * 10 + i] = v;
            }
        }

        const gf = s.gf, gi = s.gi, dgi = s.dgi, tmp = s.tmp;
        for (let i = 0; i < 16; i++) gf[i] = c0[SYM[i]];
        invert4(gf, gi);

        dgi.fill(0);
        for (let A = 1; A < 4; A++) {
            for (let l = 0; l < 4; l++) {
                for (let q = 0; q < 4; q++) {
                    let acc = 0;
                    for (let k = 0; k < 4; k++) acc += gi[l * 4 + k] * dg[A * 10 + SYM[k * 4 + q]];
                    tmp[l * 4 + q] = acc;
                }
            }
            for (let l = 0; l < 4; l++) {
                for (let q = 0; q < 4; q++) {
                    let acc = 0;
                    for (let k = 0; k < 4; k++) acc += tmp[l * 4 + k] * gi[k * 4 + q];
                    dgi[A * 16 + l * 4 + q] = -acc;
                }
            }
        }

        // Christoffels of the first kind, then raised.
        const C = s.C, Gm = s.Gm, dC = s.dC, dGm = s.dGm;
        for (let a = 0; a < 4; a++) {
            for (let m = 0; m < 4; m++) {
                for (let n = m; n < 4; n++) {
                    const v = 0.5 * (dg[m * 10 + SYM[a * 4 + n]] + dg[n * 10 + SYM[a * 4 + m]]
                                   - dg[a * 10 + SYM[m * 4 + n]]);
                    C[a * 16 + m * 4 + n] = v; C[a * 16 + n * 4 + m] = v;
                }
            }
        }
        for (let l = 0; l < 4; l++) {
            for (let mn = 0; mn < 16; mn++) {
                let acc = 0;
                for (let a = 0; a < 4; a++) acc += gi[l * 4 + a] * C[a * 16 + mn];
                Gm[l * 16 + mn] = acc;
            }
        }
        dC.fill(0);
        for (let A = 1; A < 4; A++) {
            for (let a = 0; a < 4; a++) {
                for (let m = 0; m < 4; m++) {
                    for (let n = m; n < 4; n++) {
                        const v = 0.5 * (ddg[(A * 4 + m) * 10 + SYM[a * 4 + n]]
                                       + ddg[(A * 4 + n) * 10 + SYM[a * 4 + m]]
                                       - ddg[(A * 4 + a) * 10 + SYM[m * 4 + n]]);
                        dC[A * 64 + a * 16 + m * 4 + n] = v;
                        dC[A * 64 + a * 16 + n * 4 + m] = v;
                    }
                }
            }
        }
        dGm.fill(0);
        for (let A = 1; A < 4; A++) {
            for (let l = 0; l < 4; l++) {
                for (let mn = 0; mn < 16; mn++) {
                    let acc = 0;
                    for (let a = 0; a < 4; a++) {
                        acc += dgi[A * 16 + l * 4 + a] * C[a * 16 + mn] + gi[l * 4 + a] * dC[A * 64 + a * 16 + mn];
                    }
                    dGm[A * 64 + l * 16 + mn] = acc;
                }
            }
        }

        // Ricci: R_mn = ∂_l Γ^l_mn − ∂_n Γ^l_lm + Γ^l_ls Γ^s_mn − Γ^l_ns Γ^s_lm.
        // ∂_t vanishes, which is what "stationary in the bubble's frame" buys.
        const Ric = s.Ric;
        for (let m = 0; m < 4; m++) {
            for (let n = 0; n < 4; n++) {
                let r = 0;
                for (let l = 1; l < 4; l++) r += dGm[l * 64 + l * 16 + m * 4 + n];
                if (n > 0) for (let l = 0; l < 4; l++) r -= dGm[n * 64 + l * 16 + l * 4 + m];
                for (let l = 0; l < 4; l++) {
                    for (let q = 0; q < 4; q++) {
                        r += Gm[l * 16 + l * 4 + q] * Gm[q * 16 + m * 4 + n]
                           - Gm[l * 16 + n * 4 + q] * Gm[q * 16 + l * 4 + m];
                    }
                }
                Ric[m * 4 + n] = r;
            }
        }
        let Rs = 0;
        for (let m = 0; m < 4; m++) {
            for (let n = 0; n < 4; n++) {
                if (n > m) {
                    const avg = 0.5 * (Ric[m * 4 + n] + Ric[n * 4 + m]);
                    Ric[m * 4 + n] = avg; Ric[n * 4 + m] = avg;
                }
            }
        }
        for (let i = 0; i < 16; i++) Rs += gi[i] * Ric[i];
        const T = s.T, k8 = 1 / (8 * Math.PI);
        for (let i = 0; i < 16; i++) T[i] = (Ric[i] - 0.5 * gf[i] * Rs) * k8;

        // Eulerian observer: the unit normal to the slice, n^μ = −α g^{μ0},
        // i.e. (1, −N^i)/α with α and N read off g^{μν}.
        const g00i = gi[0];
        const alpha = 1 / Math.sqrt(-g00i);
        const e = s.e;
        e[0] = 1 / alpha;
        for (let i = 1; i < 4; i++) e[i] = -alpha * gi[i];
        // Spatial triad by Gram–Schmidt against γ_ij (vectors (0, v) are
        // automatically orthogonal to n).
        const gam = (u, w) => {
            let acc = 0;
            for (let i = 1; i < 4; i++) for (let j = 1; j < 4; j++) acc += gf[i * 4 + j] * u[i] * w[j];
            return acc;
        };
        const t1 = [0, 1, 0, 0], t2 = [0, 0, 1, 0], t3 = [0, 0, 0, 1];
        let nn = Math.sqrt(gam(t1, t1));
        for (let i = 0; i < 4; i++) t1[i] /= nn;
        let d = gam(t2, t1);
        for (let i = 0; i < 4; i++) t2[i] -= d * t1[i];
        nn = Math.sqrt(gam(t2, t2));
        for (let i = 0; i < 4; i++) t2[i] /= nn;
        d = gam(t3, t1);
        for (let i = 0; i < 4; i++) t3[i] -= d * t1[i];
        d = gam(t3, t2);
        for (let i = 0; i < 4; i++) t3[i] -= d * t2[i];
        nn = Math.sqrt(gam(t3, t3));
        for (let i = 0; i < 4; i++) t3[i] /= nn;
        for (let i = 0; i < 4; i++) { e[4 + i] = t1[i]; e[8 + i] = t2[i]; e[12 + i] = t3[i]; }

        const Tt = s.Tt;
        for (let a = 0; a < 4; a++) {
            for (let b = a; b < 4; b++) {
                let acc = 0;
                for (let m = 0; m < 4; m++) {
                    const ea = e[a * 4 + m];
                    if (ea === 0) continue;
                    for (let n = 0; n < 4; n++) acc += ea * e[b * 4 + n] * T[m * 4 + n];
                }
                Tt[a * 4 + b] = acc; Tt[b * 4 + a] = acc;
            }
        }

        // York time: the expansion of the Eulerian congruence, ∇_μ n^μ.
        // Written through g^{μν} so it needs nothing the engine lacks:
        // n^i = −g^{0i}/√(−g^{00}), and ∂_i ln√−g = Γ^μ_μi.
        const sq = Math.sqrt(-g00i);
        let york = 0;
        for (let i = 1; i < 4; i++) {
            const dni = -(dgi[i * 16 + i] / sq + gi[i] * 0.5 * dgi[i * 16] / (sq * sq * sq));
            let tr = 0;
            for (let m = 0; m < 4; m++) tr += Gm[m * 16 + m * 4 + i];
            york += dni + (-gi[i] / sq) * tr;
        }

        let sqrtGam = gf[5] * (gf[10] * gf[15] - gf[11] * gf[14])
                    - gf[6] * (gf[9] * gf[15] - gf[11] * gf[13])
                    + gf[7] * (gf[9] * gf[14] - gf[10] * gf[13]);
        sqrtGam = Math.sqrt(Math.max(sqrtGam, 0));

        // Shift speed in units of the local speed of light, and the rate a
        // clock at rest in the bubble frame ticks against coordinate time.
        let shiftSpeed = 0;
        {
            const N1 = -gi[1] / g00i, N2 = -gi[2] / g00i, N3 = -gi[3] / g00i;
            const Nv = [0, N1, N2, N3];
            shiftSpeed = Math.sqrt(Math.max(0, gam(Nv, Nv))) / alpha;
        }
        const o = s.out;
        o.york = york; o.alpha = alpha; o.sqrtGam = sqrtGam;
        o.clock = Math.sqrt(Math.max(0, -c0[0]));
        o.shiftSpeed = shiftSpeed;
        return o;
    },

    // Energy conditions in the Eulerian orthonormal frame. Every value is
    // normalised by the observer's γ² (or γ for the dominant condition) so
    // its SIGN is the verdict and its size stays comparable to ρ.
    conditions(Tt, out) {
        const T00 = Tt[0];
        const trace = -T00 + Tt[5] + Tt[10] + Tt[15];
        let nec = Infinity, wec = Infinity, sec = Infinity, dec = Infinity;
        for (let k = 0; k < EC_DIRS.length; k += 3) {
            const n1 = EC_DIRS[k], n2 = EC_DIRS[k + 1], n3 = EC_DIRS[k + 2];
            const q1 = Tt[1] * n1 + Tt[2] * n2 + Tt[3] * n3;
            const Tn1 = Tt[5] * n1 + Tt[6] * n2 + Tt[7] * n3;
            const Tn2 = Tt[9] * n1 + Tt[10] * n2 + Tt[11] * n3;
            const Tn3 = Tt[13] * n1 + Tt[14] * n2 + Tt[15] * n3;
            const q2 = Tn1 * n1 + Tn2 * n2 + Tn3 * n3;
            const vN = T00 + 2 * q1 + q2;
            if (vN < nec) nec = vN;
            for (let j = 0; j < EC_SPEEDS.length; j++) {
                const v = EC_SPEEDS[j];
                const g2 = 1 / (1 - v * v);
                const w = T00 + 2 * v * q1 + v * v * q2;
                if (w < wec) wec = w;
                const sv = w + 0.5 * trace / g2;
                if (sv < sec) sec = sv;
                const F0 = T00 + v * q1;
                const F1 = Tt[4] + v * Tn1, F2 = Tt[8] + v * Tn2, F3 = Tt[12] + v * Tn3;
                const dv = F0 - Math.sqrt(F1 * F1 + F2 * F2 + F3 * F3);
                if (dv < dec) dec = dv;
            }
        }
        out.nec = nec; out.wec = wec; out.sec = sec; out.dec = dec;
        return out;
    },

    // ---- The grid ----

    // Radial nodes are equally spaced in a stretched coordinate ξ with
    // dr/dξ = c·λ(r). Because λ is smooth, the trapezoid rule in ξ keeps the
    // spectral accuracy it has on a uniform grid. Merging a uniform grid with
    // a dense patch on the wall looked equivalent and was not: the kink in
    // node spacing cost second-order accuracy, and the irrotational drive —
    // whose Eulerian energy integrates to exactly zero — came out 4% off.
    start(metric) {
        this.metric = metric;
        const rmax = metric.rmax;
        const c = 0.2;
        const lam = r => c * this.scale(metric, r);
        const r = [], wt = [];
        let x = 0;
        for (let guard = 0; guard < 4000; guard++) {
            const k1 = lam(x), k2 = lam(x + 0.5 * k1), k3 = lam(x + 0.5 * k2), k4 = lam(x + k3);
            x += (k1 + 2 * k2 + 2 * k3 + k4) / 6;
            r.push(x);
            wt.push(lam(x));
            if (x >= rmax) break;
        }
        const nr = r.length, nth = this.NTH;
        const th = new Float64Array(nth);
        for (let j = 0; j < nth; j++) th[j] = (j + 0.5) * Math.PI / nth;
        this.grid = { r: Float64Array.from(r), wt: Float64Array.from(wt), th, nr, nth };
        const n = nr * nth;
        const mk = () => new Float64Array(n);
        this.f = {
            rho: mk(), nec: mk(), wec: mk(), sec: mk(), dec: mk(),
            york: mk(), jx: mk(), jy: mk(), clock: mk(), shift: mk(), vol: mk(),
            tmax: mk()
        };
        this.idx = 0;
        this.total = n;
        this.done = false;
        this.totals = null;
        this.version++;
    },

    // The length over which the geometry changes near r: the feature width
    // on a wall, growing smoothly with distance from it. The finite-
    // difference step is a small fraction of this, and so is node spacing.
    scale(metric, r) {
        let inv = 1 / (0.08 * metric.rmax);
        for (const f of metric.features) {
            const d = 0.3 * (r - f.r);
            inv += 1 / Math.sqrt(f.w * f.w + d * d);
        }
        return 1 / inv;
    },

    work(budgetMs) {
        if (this.done || !this.metric) return;
        const t0 = performance.now();
        const { r, th, nth } = this.grid;
        const F = this.f, m = this.metric, s = this._s, ec = {};
        while (this.idx < this.total) {
            const i = this.idx;
            const ir = Math.floor(i / nth), jt = i % nth;
            const rr = r[ir], t = th[jt];
            const h = 2e-3 * this.scale(m, rr);
            const o = this.curvature(m, rr * Math.cos(t), rr * Math.sin(t), 0, h);
            const Tt = s.Tt;
            this.conditions(Tt, ec);
            F.rho[i] = Tt[0];
            F.nec[i] = ec.nec; F.wec[i] = ec.wec; F.sec[i] = ec.sec; F.dec[i] = ec.dec;
            F.jx[i] = -Tt[1]; F.jy[i] = -Tt[2];
            F.york[i] = o.york; F.clock[i] = o.clock; F.shift[i] = o.shiftSpeed;
            F.vol[i] = o.sqrtGam;
            let tm = 0;
            for (let k = 0; k < 16; k++) tm = Math.max(tm, Math.abs(Tt[k]));
            F.tmax[i] = tm;
            this.idx++;
            if ((this.idx & 15) === 0 && performance.now() - t0 > budgetMs) break;
        }
        if (this.idx >= this.total) this.finish();
    },

    progress() { return this.total ? this.idx / this.total : 0; },

    // Integrate over the slice and pass judgement. Tolerance is relative to
    // the largest stress anywhere on the grid: finite differences of a
    // smooth metric are good to roughly a part in 10^7, and a "violation"
    // smaller than that is the arithmetic, not the matter.
    finish() {
        const { r, wt, th, nr, nth } = this.grid;
        const F = this.f, m = this.metric;
        let tscale = 0;
        for (let i = 0; i < this.total; i++) tscale = Math.max(tscale, F.tmax[i]);
        const tol = 1e-5 * tscale;

        const dth = Math.PI / nth;
        let Epos = 0, Eneg = 0, Vtot = 0;
        const bad = { nec: 0, wec: 0, sec: 0, dec: 0 };
        const worst = { nec: 0, wec: 0, sec: 0, dec: 0 };
        let rhoMin = 0, rhoMax = 0, maxShift = 0, matterVol = 0;
        for (let ir = 0; ir < nr; ir++) {
            const dr = wt[ir];
            for (let jt = 0; jt < nth; jt++) {
                const i = ir * nth + jt;
                const dV = 2 * Math.PI * r[ir] * r[ir] * Math.sin(th[jt]) * dr * dth * F.vol[i];
                const rho = F.rho[i];
                if (rho > 0) Epos += rho * dV; else Eneg += rho * dV;
                if (rho < rhoMin) rhoMin = rho;
                if (rho > rhoMax) rhoMax = rho;
                if (F.shift[i] > maxShift) maxShift = F.shift[i];
                Vtot += dV;
                // Only the curved region can violate anything; outside it
                // every margin is round-off.
                if (F.tmax[i] <= tol) continue;
                matterVol += dV;
                for (const k of ['nec', 'wec', 'sec', 'dec']) {
                    const v = F[k][i];
                    if (v < -tol) {
                        bad[k] += dV;
                        if (v < worst[k]) worst[k] = v;
                    }
                }
            }
        }

        // Walls thinner than the grid can resolve were built at the floor
        // thickness. A thin wall's energy goes as 1/Δ at fixed radius, so the
        // totals are carried down to the real wall by that law.
        const extrap = m.clamped ? m.w / m.wTrue : 1;
        this.totals = {
            Epos: Epos * extrap, Eneg: Eneg * extrap, Enet: (Epos + Eneg) * extrap,
            rhoMin: rhoMin * extrap * extrap, rhoMax: rhoMax * extrap * extrap,
            extrap, tol, tscale,
            matterVol: Math.max(matterVol, 1e-30),
            bad, worst, maxShift,
            pass: {
                nec: bad.nec === 0, wec: bad.wec === 0, sec: bad.sec === 0, dec: bad.dec === 0
            }
        };
        this.done = true;
        this.version++;
    },

    // Bilinear read of a field at (r, θ) — θ folded into [0, π] because
    // every family here is symmetric about its axis of motion.
    sample(field, rr, t) {
        const { r, th, nr, nth } = this.grid;
        const F = this.f[field];
        if (t < 0) t = -t;
        if (t > Math.PI) t = 2 * Math.PI - t;
        if (rr <= r[0]) rr = r[0];
        if (rr >= r[nr - 1]) return F[(nr - 1) * nth + Math.min(nth - 1, Math.max(0, Math.round(t / Math.PI * nth - 0.5)))];
        let lo = 0, hi = nr - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (r[mid] > rr) hi = mid; else lo = mid;
        }
        const fr = (rr - r[lo]) / (r[hi] - r[lo]);
        let tj = t / Math.PI * nth - 0.5;
        if (tj < 0) tj = 0;
        if (tj > nth - 1) tj = nth - 1;
        const j0 = Math.floor(tj), j1 = Math.min(nth - 1, j0 + 1), ft = tj - j0;
        const a = F[lo * nth + j0] * (1 - ft) + F[lo * nth + j1] * ft;
        const b = F[hi * nth + j0] * (1 - ft) + F[hi * nth + j1] * ft;
        return a * (1 - fr) + b * fr;
    }
};
