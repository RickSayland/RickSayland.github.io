// ============ ATOM VIEWER — RADIAL KOHN–SHAM SOLVER ============
// Zero DOM. Owns `scf`.
//
// Every orbital the page draws comes from here, and nothing about any of them
// is fitted: an atom is solved as a self-consistent field. Guess a potential,
// solve the radial Schrödinger equation for every occupied (n, l) in it, build
// the electron density those orbitals make, rebuild the potential from that
// density (nucleus + Hartree + exchange-correlation), mix, repeat until the
// potential reproduces itself. This is the local density approximation with
// the Vosko–Wilk–Nusair correlation, non-relativistic and spherically
// averaged: exactly the "LDA" column of NIST's atomic reference data, which
// tools/check.mjs compares against.
//
// Units are Hartree atomic units throughout: lengths in bohr (a0 = 52.918 pm),
// energies in hartree (27.211 eV).
//
// Things in here that are load-bearing:
//
// - **The grid is logarithmic and the equation is transformed to suit it.**
//   With x = ln r and u(r) = r^(1/2) y(x), the radial equation becomes
//   y'' = [2r²(V − E) + (l + ½)²] y, which has no first-derivative term, so
//   Numerov applies directly. A uniform grid cannot hold a 1s orbital of
//   uranium (size ~0.01 bohr) and a 7s one (~5 bohr) at the same time.
// - **Eigenvalues come from matching, not from bisection alone.** Node counting
//   brackets the right state; then outward and inward solutions are matched at
//   the classical turning point and the derivative mismatch gives the energy
//   correction directly. At convergence that mismatch vanishes exactly when the
//   joined function satisfies the Numerov recurrence at the joint, so the
//   finite-difference derivative costs no accuracy.
// - **The inward integration starts where the solution is ~e^-45 small, not at
//   the edge of the grid.** A uranium 1s decays like e^-(77 r); integrating it
//   inward from 100 bohr overflows a double long before it reaches the atom.
// - **Cumulative integrals are fourth-order.** The Hartree potential is built
//   from running integrals of the density, and a trapezoid rule on this grid
//   leaves the neon total energy wrong in the third decimal.
// - **One electron is solved exactly.** With a single electron there is no
//   electron-electron interaction at all, and the LDA's self-interaction error
//   would otherwise make hydrogen's 1s level −6.35 eV instead of −13.6 eV.
// - **Anions need the Latter tail.** In the LDA an extra electron sees the
//   neutral atom's potential die off exponentially while its own Hartree
//   repulsion falls only as 1/r, so the outermost electron of F⁻ is unbound.
//   Latter's correction floors the potential at −(Z − N + 1)/r, which is the
//   charge the last electron really sees. It is applied to anions only, so
//   neutral atoms and cations stay comparable with the NIST tables.
// - **Dianions need a Watson sphere.** No atom holds two extra electrons in
//   isolation; O²⁻ exists only in a crystal whose surrounding cations hold it.
//   A shell of charge +q at radius R_W is the standard stand-in for that
//   lattice, and it is what lets the page draw an oxide ion at all.

const scf = (() => {
    const X_MIN = -8;        // r_min = e^-8 / Z
    const R_MAX = 120;       // bohr; far past any ground-state orbital, including anions'
    const H = 0.0075;        // log-grid step
    const HA_EV = 27.211386245988;

    // ---- Grid ----

    function makeGrid(Z) {
        const zs = Math.max(Z, 1);
        let M = Math.ceil((Math.log(R_MAX * zs) - X_MIN) / H) + 1;
        if (M % 2 === 0) M++;                   // odd count for composite Simpson
        const r = new Float64Array(M), r2 = new Float64Array(M), sq = new Float64Array(M);
        for (let i = 0; i < M; i++) {
            r[i] = Math.exp(X_MIN + i * H) / zs;
            r2[i] = r[i] * r[i];
            sq[i] = Math.sqrt(r[i]);
        }
        return { Z, M, h: H, x0: X_MIN - Math.log(zs), r, r2, sq,
                 g: new Float64Array(M), tmp: new Float64Array(M), tmp2: new Float64Array(M) };
    }

    // Composite Simpson over the whole grid (M is odd), of F(x) dx.
    function integrate(grid, F) {
        const M = grid.M;
        let s = F[0] + F[M - 1];
        for (let i = 1; i < M - 1; i++) s += (i & 1 ? 4 : 2) * F[i];
        return s * grid.h / 3;
    }

    // Running integral C[i] = ∫_{x0}^{x_i} F dx, fourth order: each interval
    // is the integral of the cubic through its four nearest points.
    function cumulative(grid, F, C) {
        const M = grid.M, h24 = grid.h / 24;
        C[0] = 0;
        C[1] = h24 * (9 * F[0] + 19 * F[1] - 5 * F[2] + F[3]);
        for (let i = 1; i < M - 2; i++) {
            C[i + 1] = C[i] + h24 * (-F[i - 1] + 13 * F[i] + 13 * F[i + 1] - F[i + 2]);
        }
        C[M - 1] = C[M - 2] + h24 * (F[M - 4] - 5 * F[M - 3] + 19 * F[M - 2] + 9 * F[M - 1]);
    }

    // ---- Exchange-correlation: Slater exchange + VWN correlation, unpolarized ----

    const VWN_A = 0.0310907, VWN_X0 = -0.10498, VWN_B = 3.72744, VWN_C = 12.9352;
    const VWN_Q = Math.sqrt(4 * VWN_C - VWN_B * VWN_B);
    const VWN_X0X = VWN_X0 * VWN_X0 + VWN_B * VWN_X0 + VWN_C;
    const CX = -0.75 * Math.cbrt(3 / Math.PI);

    // Returns eps_xc; writes v_xc into xcOut[0].
    const xcOut = [0];
    function xc(rho) {
        if (rho < 1e-30) { xcOut[0] = 0; return 0; }
        const r13 = Math.cbrt(rho);
        const ex = CX * r13;
        const vx = (4 / 3) * ex;
        const rs = Math.cbrt(3 / (4 * Math.PI * rho));
        const x = Math.sqrt(rs);
        const X = x * x + VWN_B * x + VWN_C;
        const tx = 2 * x + VWN_B;
        const at = Math.atan(VWN_Q / tx);
        const k = VWN_B * VWN_X0 / VWN_X0X;
        const ec = VWN_A * (Math.log(x * x / X) + 2 * VWN_B / VWN_Q * at
            - k * (Math.log((x - VWN_X0) * (x - VWN_X0) / X) + 2 * (VWN_B + 2 * VWN_X0) / VWN_Q * at));
        const d = tx * tx + VWN_Q * VWN_Q;
        const dec = VWN_A * (2 / x - tx / X - 4 * VWN_B / d
            - k * (2 / (x - VWN_X0) - tx / X - 4 * (VWN_B + 2 * VWN_X0) / d));
        xcOut[0] = vx + ec - x * dec / 6;
        return ex + ec;
    }

    // ---- One radial eigenproblem ----

    // Solves for the (n, l) state in potential V. Writes the normalised y(x)
    // into y (u = sqrt(r)·y, ∫u² dr = 1). Returns the eigenvalue, or NaN when
    // no such bound state fits on the grid.
    function solveRadial(grid, V, Z, n, l, eGuess, y) {
        const { M, h, r, r2 } = grid;
        const g = grid.g;
        const h12 = h * h / 12;
        const L2 = (l + 0.5) * (l + 0.5);
        const want = n - l - 1;

        let elo = Infinity;
        for (let i = 0; i < M; i++) {
            const v = V[i] + L2 / (2 * r2[i]);
            if (v < elo) elo = v;
        }
        let ehi = V[M - 1] + L2 / (2 * r2[M - 1]);
        if (!(elo < ehi)) return NaN;
        let e = (eGuess > elo && eGuess < ehi) ? eGuess : 0.5 * (elo + ehi);

        for (let iter = 0; iter < 300; iter++) {
            if (ehi - elo < 1e-14 * Math.max(1, Math.abs(e))) break;

            for (let i = 0; i < M; i++) g[i] = 1 - h12 * (2 * r2[i] * (V[i] - e) + L2);

            // Outermost classical turning point: last index still in the
            // allowed region (g > 1 ⇔ 2r²(V−E) + (l+½)² < 0).
            let icl = -1;
            for (let i = M - 3; i >= 2; i--) if (g[i] > 1) { icl = i; break; }
            if (icl < 0) { elo = e; e = 0.5 * (elo + ehi); continue; }
            if (icl >= M - 12) { ehi = e; e = 0.5 * (elo + ehi); continue; }

            // Outward from the origin, where u ~ r^(l+1)(1 − Zr/(l+1)).
            for (let i = 0; i < 2; i++) {
                y[i] = Math.pow(r[i], l + 0.5) * (1 - Z * r[i] / (l + 1));
            }
            let nodes = 0;
            for (let i = 1; i <= icl; i++) {
                y[i + 1] = ((12 - 10 * g[i]) * y[i] - g[i - 1] * y[i - 1]) / g[i + 1];
                if (y[i] * y[i - 1] < 0) nodes++;
            }
            if (nodes !== want) {
                if (nodes > want) ehi = e; else elo = e;
                e = 0.5 * (elo + ehi);
                continue;
            }
            const yM = y[icl - 1], yC = y[icl], yP = y[icl + 1];

            // Inward, from where the tail has decayed by ~e^45.
            let imax = M - 1, s = 0;
            for (let i = icl + 1; i < M; i++) {
                const k2 = 2 * (V[i] - e) + L2 / r2[i];
                if (k2 > 0) s += Math.sqrt(k2) * r[i] * h;
                if (s > 45) { imax = i; break; }
            }
            if (imax < icl + 3) imax = Math.min(M - 1, icl + 3);
            for (let i = imax + 1; i < M; i++) y[i] = 0;
            y[imax] = 1e-20;
            y[imax - 1] = (12 - 10 * g[imax]) * y[imax] / g[imax - 1];
            for (let i = imax - 1; i >= icl; i--) {
                y[i - 1] = ((12 - 10 * g[i]) * y[i] - g[i + 1] * y[i + 1]) / g[i - 1];
            }
            const scale = yC / y[icl];
            for (let i = icl - 1; i <= imax; i++) y[i] *= scale;
            const dIn = (y[icl + 1] - y[icl - 1]) / (2 * h);
            y[icl - 1] = yM; y[icl] = yC;
            const dOut = (yP - yM) / (2 * h);

            const F = grid.tmp;
            for (let i = 0; i < M; i++) F[i] = r2[i] * y[i] * y[i];
            const norm = integrate(grid, F);
            const de = yC * (dOut - dIn) / (2 * norm);

            if (de > 0) elo = e; else ehi = e;
            if (Math.abs(de) < 1e-12 * Math.max(1, Math.abs(e))) {
                const k = 1 / Math.sqrt(norm);
                for (let i = 0; i < M; i++) y[i] *= k;
                return e + de;
            }
            const next = e + de;
            e = (next > elo && next < ehi) ? next : 0.5 * (elo + ehi);
        }
        return NaN;
    }

    // Thomas–Fermi screening, Latter's fit: a starting potential good enough
    // that the first iteration already has every shell in the right place.
    function thomasFermi(grid, Z, N, V) {
        const b = 0.885341 * Math.pow(Z, -1 / 3);
        const floor = Math.max(Z - N + 1, 0.1);
        for (let i = 0; i < grid.M; i++) {
            const x = grid.r[i] / b, sx = Math.sqrt(x);
            const phi = 1 / (1 + sx * (0.02747 - x * (0.1486 - 0.007298 * x)) + x * (1.243 + x * (0.2302 + 0.006944 * x)));
            V[i] = -Math.max(Z * phi, floor) / grid.r[i];
        }
    }

    // ---- The self-consistent field ----

    // shells: [{ n, l, occ }]. opts: { exact1: true (default) solves one
    // electron without interaction; latter: tail correction; watson: {q, R} }.
    function create(Z, shells, opts = {}) {
        const N = shells.reduce((s, sh) => s + sh.occ, 0);
        const grid = makeGrid(Z);
        const M = grid.M;
        const job = {
            Z, N, grid, opts,
            shells: shells.map(s => ({ n: s.n, l: s.l, occ: s.occ, e: NaN, y: new Float64Array(M) })),
            V: new Float64Array(M), Vout: new Float64Array(M),
            prevW: null, prevF: null,
            rho: new Float64Array(M),        // radial density per bohr: Σ occ·u²
            VH: new Float64Array(M), vxc: new Float64Array(M), exc: new Float64Array(M),
            iter: 0, err: Infinity, done: false, failed: null,
            Etot: NaN,
            beta: 0.35,
            interacting: N > 1 || opts.exact1 === false,
        };
        if (job.interacting) thomasFermi(grid, Z, N, job.V);
        else for (let i = 0; i < M; i++) job.V[i] = -Z / grid.r[i];
        // Rough hydrogenic guesses; the bracket search does the rest.
        for (const sh of job.shells) sh.e = -0.5 * Math.pow(Math.max(1, Z - 2 * (sh.n - 1) * (sh.n - 1)) / sh.n, 2);
        return job;
    }

    function buildPotential(job) {
        const { grid, Z, N, opts } = job;
        const { M, r, r2 } = grid;
        const rho = job.rho, VH = job.VH, Vout = job.Vout;

        rho.fill(0);
        for (const sh of job.shells) {
            const y = sh.y, occ = sh.occ;
            for (let i = 0; i < M; i++) rho[i] += occ * r[i] * y[i] * y[i];
        }

        // Hartree: V_H(r) = Q(r)/r + ∫_r^∞ ρ/r' dr'. In x: dr = r dx.
        const F = grid.tmp, C = grid.tmp2;
        for (let i = 0; i < M; i++) F[i] = rho[i] * r[i];
        cumulative(grid, F, C);
        const q0 = rho[0] * r[0] / 3;            // ∫_0^{r0}, density ~ r² there
        for (let i = 0; i < M; i++) VH[i] = (q0 + C[i]) / r[i];
        for (let i = 0; i < M; i++) F[i] = rho[i];
        cumulative(grid, F, C);
        const tot = C[M - 1];
        for (let i = 0; i < M; i++) VH[i] += tot - C[i];

        for (let i = 0; i < M; i++) {
            const dens = rho[i] / (4 * Math.PI * r2[i]);
            job.exc[i] = xc(dens);
            job.vxc[i] = xcOut[0];
            Vout[i] = -Z / r[i] + VH[i] + job.vxc[i];
        }

        if (opts.watson) {
            const { q, R } = opts.watson;
            for (let i = 0; i < M; i++) Vout[i] -= q / Math.max(r[i], R);
        }
        if (opts.latter) {
            const zt = Z + (opts.watson ? opts.watson.q : 0) - N + 1;
            for (let i = 0; i < M; i++) {
                const t = -zt / r[i];
                if (t < Vout[i]) Vout[i] = t;
            }
        }
    }

    // Kohn–Sham total energy in its variational form: the kinetic energy is
    // taken from the eigenvalues in the potential the orbitals were solved in,
    // everything else from the density they produce.
    function totalEnergy(job) {
        const { grid } = job;
        const { M, r } = grid;
        if (!job.interacting) return job.shells.reduce((s, sh) => s + sh.occ * sh.e, 0);
        const F = grid.tmp;
        let band = 0;
        for (const sh of job.shells) band += sh.occ * sh.e;
        for (let i = 0; i < M; i++) {
            const rho = job.rho[i];
            F[i] = rho * r[i] * (-job.V[i] - job.Z / r[i] + 0.5 * job.VH[i] + job.exc[i]);
        }
        return band + integrate(grid, F);
    }

    // One SCF iteration. Sets job.done when converged, job.failed on trouble.
    function iterate(job) {
        if (job.done) return;
        const { grid, Z } = job;
        const M = grid.M;

        // A shell can drop out of a potential that is still far from
        // self-consistent: the lanthanides' 4f sits in a double well and
        // swings between the inner and outer one for the first few
        // iterations. Keep its last orbital, take smaller steps, and only
        // call it unbound if it stays unbound.
        let missed = false;
        for (const sh of job.shells) {
            const e = solveRadial(grid, job.V, Z, sh.n, sh.l, sh.e, sh.y);
            if (Number.isNaN(e)) {
                if (sh.solved && (sh.misses = (sh.misses || 0) + 1) < 8) { missed = true; continue; }
                job.failed = { reason: 'unbound', shell: sh };
                job.done = true;
                return;
            }
            sh.e = e;
            sh.solved = true;
            sh.misses = 0;
        }
        if (missed) {
            job.beta = Math.max(0.05, job.beta * 0.5);
            job.prevF = job.prevW = null;
        }

        if (!job.interacting) {
            buildPotential(job);
            job.Etot = totalEnergy(job);
            job.err = 0;
            job.done = true;
            return;
        }

        buildPotential(job);
        job.Etot = totalEnergy(job);

        // Anderson mixing on W = r·V, which stays finite at the origin.
        const r = grid.r;
        const W = new Float64Array(M), Fr = new Float64Array(M);
        let err = 0;
        for (let i = 0; i < M; i++) {
            W[i] = r[i] * job.V[i];
            Fr[i] = r[i] * (job.Vout[i] - job.V[i]);
            if (Math.abs(Fr[i]) > err) err = Math.abs(Fr[i]);
        }
        job.err = err;
        job.iter++;

        let theta = 0;
        if (job.prevF) {
            let num = 0, den = 0;
            for (let i = 0; i < M; i++) {
                const d = Fr[i] - job.prevF[i];
                num += Fr[i] * d;
                den += d * d;
            }
            if (den > 0) theta = Math.max(-2, Math.min(2, num / den));
        }
        const beta = job.beta;
        const nextV = job.V;
        for (let i = 0; i < M; i++) {
            let w = W[i], f = Fr[i];
            if (job.prevF) {
                w -= theta * (W[i] - job.prevW[i]);
                f -= theta * (Fr[i] - job.prevF[i]);
            }
            nextV[i] = (w + beta * f) / r[i];
        }
        job.prevW = W;
        job.prevF = Fr;

        if (err < 2e-7 && !missed) job.done = true;
        else if (job.iter > 400) { job.failed = { reason: 'no convergence' }; job.done = true; }
    }

    // Iterate until done or the time budget (ms) runs out.
    function work(job, budgetMs) {
        const t0 = performance.now();
        while (!job.done && performance.now() - t0 < budgetMs) iterate(job);
        return job.done;
    }

    function run(job) {
        while (!job.done) iterate(job);
        return job;
    }

    // ---- Reading results ----

    // R(r) = u/r = y / sqrt(r) for one shell, by linear interpolation in ln r.
    function radialAt(job, sh, rr) {
        const g = job.grid;
        const t = (Math.log(rr) - g.x0) / g.h;
        if (t <= 0) return sh.y[0] / g.sq[0];
        const i = Math.floor(t);
        if (i >= g.M - 1) return 0;
        const f = t - i;
        return (sh.y[i] * (1 - f) + sh.y[i + 1] * f) / Math.sqrt(rr);
    }

    // Expectation of r for one shell: ∫ r u² dr.
    function meanRadius(job, sh) {
        const g = job.grid, F = g.tmp;
        for (let i = 0; i < g.M; i++) F[i] = g.r2[i] * g.r[i] * sh.y[i] * sh.y[i];
        return integrate(g, F);
    }

    // Electron density at the nucleus (bohr^-3), from the s shells.
    function densityAtNucleus(job) {
        const g = job.grid;
        let d = 0;
        for (const sh of job.shells) {
            if (sh.l !== 0) continue;
            const R0 = sh.y[0] / g.sq[0];
            d += sh.occ * R0 * R0 / (4 * Math.PI);
        }
        return d;
    }

    return { create, iterate, work, run, radialAt, meanRadius, densityAtNucleus,
             solveRadial, makeGrid, HA_EV, R_MAX };
})();
