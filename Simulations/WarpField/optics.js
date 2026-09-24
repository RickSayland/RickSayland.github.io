// ============ WARP FIELD ENGINEERING — THE VIEW FROM THE BRIDGE ============
// Null geodesics through the bubble. Zero DOM.
//
// For the shift-only drives (unit lapse, flat slices) a photon's energy in the
// bubble frame is conserved, H = |p| − N·p, and Hamilton's equations are
//     dx/dt = p̂ − N,        dp_i/dt = p_j ∂_i N^j.
// Tracing a ray backward from the cabin until it leaves the wall gives the
// direction the light really came from (in the frame of the stars, since the
// Eulerian observers out there are at rest in it) and the frequency ratio,
// D = |p_cabin| / |p_outside|. Every drive here is symmetric about its axis
// of motion, so the whole sky reduces to one table: observed angle from the
// bow → true angle and Doppler factor. 161 rays; rebuilt a few per frame
// when the speed changes and swapped in whole when complete.
//
// What falls out of it, with nothing put in by hand: head-on light is blue-
// shifted by exactly 1 + v and the tail by 1 − v — no γ anywhere, because
// the cabin is in free fall and its clocks keep coordinate time. Past light
// speed, rays arriving from astern trace back to the rear horizon and never
// leave it: that part of the sky goes black.
//
// Shells get the analytic answer instead — they are ordinary massive objects
// moving below c, so the view is special-relativistic aberration and Doppler,
// times the blueshift of light falling into the shell's potential well.
// Lensing by the shell itself is left out.

// Walls thinner than R/50 are traced as R/50. The map converges on the thin-
// wall limit long before that — a 10 m wall and a Planck-length one give the
// same sky to a fraction of a degree — and every halving of the wall doubles
// the steps a ray spends crossing it.
const OPTIC_WALL_FLOOR = 0.02;

const optics = {
    N: 161,
    table: null,
    building: false,
    sig: '',
    jobSig: '',
    job: null,
    version: 0,

    identity() {
        return { n: 0, identity: true, sig: 'id' };
    },

    request(spec) {
        const fam = FAMILIES[spec.key];
        const v = spec.v || 0;
        if (v < 5e-4) {
            if (this.sig !== 'id') { this.table = this.identity(); this.sig = 'id'; this.building = false; this.version++; }
            return;
        }
        const vq = Math.round(Math.log(v) * 250);        // 0.4% steps in v
        const sig = spec.key + '|' + JSON.stringify(spec.params) + '|' + vq;
        if (sig === this.sig || (this.building && sig === this.jobSig)) return;

        if (fam.kind === 'shell') {
            this.table = this.shellTable(v, spec.clockRate || 1);
            this.sig = sig;
            this.building = false;
            this.version++;
            return;
        }
        const metric = buildMetric(spec.key, spec.params, Math.exp(vq / 250), OPTIC_WALL_FLOOR);
        const n = this.N;
        this.job = {
            metric, i: 0, n,
            thO: new Float64Array(n), psi: new Float64Array(n),
            D: new Float64Array(n), ok: new Uint8Array(n)
        };
        this.jobSig = sig;
        this.building = true;
        if (!this.table) this.table = this.identity();
    },

    work(budgetMs) {
        if (!this.building) return;
        const t0 = performance.now();
        const J = this.job;
        while (J.i < J.n) {
            const th = Math.PI * J.i / (J.n - 1);
            const res = this.trace(J.metric, th);
            J.thO[J.i] = th;
            J.ok[J.i] = res.ok ? 1 : 0;
            J.psi[J.i] = res.psi;
            J.D[J.i] = res.D;
            J.i++;
            if (performance.now() - t0 > budgetMs) break;
        }
        if (J.i >= J.n) {
            this.table = this.finalize(J);
            this.sig = this.jobSig;
            this.building = false;
            this.job = null;
            this.version++;
        }
    },

    // ---- One ray ----

    _N: new Float64Array(2),
    _J: new Float64Array(4),

    // Forward-time derivatives in the bubble frame, in the plane z = 0.
    rhs(m, X, Y, pX, pY, out) {
        const N = this._N, J = this._J;
        m.shiftJac(X, Y, N, J);
        const dxNx = J[0], dxNy = J[1], dyNx = J[2], dyNy = J[3];
        const pn = Math.sqrt(pX * pX + pY * pY);
        out[0] = pX / pn - N[0];
        out[1] = pY / pn - N[1];
        out[2] = pX * dxNx + pY * dxNy;
        out[3] = pX * dyNx + pY * dyNy;
        out[4] = Math.abs(dxNx) + Math.abs(dxNy) + Math.abs(dyNx) + Math.abs(dyNy);
    },

    // Trace backward in time from the cabin, looking along angle thO from
    // the bow. The arriving photon travels the opposite way, so p starts as
    // −(look direction) with unit frequency.
    trace(m, thO) {
        let X = 0, Y = 0, pX = -Math.cos(thO), pY = -Math.sin(thO);
        const k1 = new Float64Array(5), k2 = new Float64Array(5), k3 = new Float64Array(5), k4 = new Float64Array(5);
        let tau = 0;
        for (let step = 0; step < 8000; step++) {
            const r = Math.sqrt(X * X + Y * Y);
            this.rhs(m, X, Y, pX, pY, k1);
            // Backward time: every derivative flips sign.
            const vx = -k1[0], vy = -k1[1];
            const speed = Math.sqrt(vx * vx + vy * vy) + 1e-12;
            if (r > m.rOptic && X * vx + Y * vy > 0) {
                const pn = Math.sqrt(pX * pX + pY * pY);
                return { ok: true, psi: Math.atan2(-pY, -pX), D: 1 / pn };
            }
            const lam = einstein.scale(m, r);
            let h = Math.min(0.6 * lam / speed, 0.15 / (k1[4] + 1e-9), 0.5);
            // RK4 on the backward system.
            this.rhs(m, X - 0.5 * h * k1[0], Y - 0.5 * h * k1[1], pX - 0.5 * h * k1[2], pY - 0.5 * h * k1[3], k2);
            this.rhs(m, X - 0.5 * h * k2[0], Y - 0.5 * h * k2[1], pX - 0.5 * h * k2[2], pY - 0.5 * h * k2[3], k3);
            this.rhs(m, X - h * k3[0], Y - h * k3[1], pX - h * k3[2], pY - h * k3[3], k4);
            X -= h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
            Y -= h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
            pX -= h * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6;
            pY -= h * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]) / 6;
            tau += h;
            // A ray that has been blueshifted ten-thousandfold on the way back
            // is sitting on a horizon: what reaches the cabin along it is
            // redshifted below anything the renderer can show.
            if (pX * pX + pY * pY > 1e8 || tau > 400) break;
        }
        return { ok: false, psi: 0, D: 0 };
    },

    finalize(J) {
        const n = J.n;
        const psi = J.psi;
        // Unwrap ψ along each run of good rays so segments interpolate across
        // the ±π seam instead of the long way round.
        for (let i = 1; i < n; i++) {
            if (!J.ok[i] || !J.ok[i - 1]) continue;
            while (psi[i] - psi[i - 1] > Math.PI) psi[i] -= 2 * Math.PI;
            while (psi[i] - psi[i - 1] < -Math.PI) psi[i] += 2 * Math.PI;
        }
        const t = { n, identity: false, thO: J.thO, psi, D: J.D, ok: J.ok };
        this.index(t);
        return t;
    },

    shellTable(v, clockRate) {
        const n = this.N;
        const g = 1 / Math.sqrt(1 - v * v);
        const thO = new Float64Array(n), psi = new Float64Array(n), D = new Float64Array(n), ok = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const th = Math.PI * i / (n - 1);
            const c = Math.cos(th);
            thO[i] = th;
            psi[i] = Math.acos(Math.max(-1, Math.min(1, (c - v) / (1 - v * c))));
            D[i] = 1 / (g * (1 - v * c)) / clockRate;
            ok[i] = 1;
        }
        const t = { n, identity: false, thO, psi, D, ok };
        this.index(t);
        return t;
    },

    // Segment index over ψ ∈ [−3π, 3π], so a star's true angle finds the
    // handful of table segments that can image it without a scan.
    BINS: 720,
    index(t) {
        const bins = Array.from({ length: this.BINS }, () => []);
        const lo = -3 * Math.PI, span = 6 * Math.PI;
        for (let i = 0; i < t.n - 1; i++) {
            if (!t.ok[i] || !t.ok[i + 1]) continue;
            const a = t.psi[i], b = t.psi[i + 1];
            // A jump this large is a discontinuity in the map (the edge of a
            // dark region, typically), not a stretch of sky to smear across.
            if (Math.abs(b - a) > 0.5) continue;
            const b0 = Math.max(0, Math.floor((Math.min(a, b) - lo) / span * this.BINS));
            const b1 = Math.min(this.BINS - 1, Math.floor((Math.max(a, b) - lo) / span * this.BINS));
            for (let k = b0; k <= b1; k++) bins[k].push(i);
        }
        t.bins = bins;
    },

    // Every image of a source at polar angle theta (from the bow) calls
    // fn(thetaObserved, flipped, D, mu). `flipped` means the image lies on
    // the opposite side of the axis from the source; mu is the solid-angle
    // magnification dΩ_obs/dΩ_src.
    images(theta, fn) {
        const t = this.table;
        if (!t || t.identity) { fn(theta, false, 1, 1); return; }
        const lo = -3 * Math.PI, span = 6 * Math.PI;
        const sT = Math.max(Math.sin(theta), 1e-4);
        for (let sgn = 1; sgn >= -1; sgn -= 2) {
            if (sgn < 0 && (theta < 1e-6 || theta > Math.PI - 1e-6)) break;
            for (let k = -1; k <= 1; k++) {
                const q = sgn * theta + 2 * Math.PI * k;
                if (q < lo || q >= lo + span) continue;
                const list = t.bins[Math.floor((q - lo) / span * this.BINS)];
                for (let j = 0; j < list.length; j++) {
                    const i = list[j];
                    const a = t.psi[i], b = t.psi[i + 1];
                    if ((q - a) * (q - b) > 0) continue;
                    const f = b === a ? 0 : (q - a) / (b - a);
                    const tho = t.thO[i] + f * (t.thO[i + 1] - t.thO[i]);
                    const D = t.D[i] + f * (t.D[i + 1] - t.D[i]);
                    const dth = Math.abs((t.thO[i + 1] - t.thO[i]) / (b - a || 1e-9));
                    const mu = Math.min(50, Math.max(Math.sin(tho), 1e-4) / sT * dth);
                    fn(tho, sgn < 0, D, mu);
                }
            }
        }
    }
};
