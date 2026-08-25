// ============ GEODYNAMO — THE FIELD SOLVER ============
// Plain scripts, so load order is the <script> order in index.html:
// field → render → instruments → main. Nothing here touches the DOM and
// nothing self-boots; main.js calls dynamo.init() before the first frame.
//
// THE MODEL — axisymmetric mean-field dynamo in a spherical shell.
//
// A dynamo cannot be two-dimensional. Cowling's theorem forbids an axisymmetric
// field from being maintained by an axisymmetric flow, so simply stirring a
// meridional slice and hoping a field appears is guaranteed to fail — the field
// always decays. Mean-field theory is the standard way out: split every quantity
// into an axisymmetric mean and a small-scale turbulent part, and the turbulence
// survives the average as two terms. Helical convection twisting field lines into
// loops that add up (the ALPHA-effect), and differential rotation shearing
// poloidal field into azimuthal field (the OMEGA-effect). Both live in
// coefficients here, so what is solved is genuinely 2-D while the dynamo action
// it represents is not.
//
// The mean field is B = curl(A e_phi) + B e_phi — a poloidal part carried by the
// vector potential A (this is the part that leaks out of the core and points
// compasses) and a toroidal part B (which does not leave the core at all, and is
// the stronger of the two by a wide margin). Non-dimensionalised on the core
// radius and the magnetic diffusion time:
//
//     dA/dt = Ca * alpha * B                         + D2 A
//     dB/dt = Co * s * (Bpol . grad Omega)           + D2 B
//                    + Ca * [curl(alpha * Bpol)]_phi
//
// with D2 = laplacian - 1/(r sin(theta))^2, the operator for a phi-component.
// Drop the Omega term and this is an ALPHA-SQUARED dynamo — the regime Earth is
// believed to sit in, which produces a steady dipole that reverses only when
// something knocks it. Make the Omega term dominant and it is an ALPHA-OMEGA
// dynamo, which oscillates on its own and reverses like a metronome — the Sun.
// Both are reachable from the shear slider, and they look nothing alike.

// ---- The only dimensional constants in the model ----
const R_CORE   = 3.48e6;                     // m, core-mantle boundary
const R_EARTH  = 6.371e6;                    // m
const ETA      = 2.0;                        // m^2/s, magnetic diffusivity
const TAU_DIFF = R_CORE * R_CORE / ETA;      // s, the time unit
const KYR_PER_T = TAU_DIFF / 3.1557e10;      // ~192 kyr per unit time
const R_SURF   = R_EARTH / R_CORE;           // 1.831 core radii to the surface

// The single calibration constant, and the only number in the model chosen to
// match an observation. Alpha-quenching pins the saturated field amplitude at
// order 1 in model units, so one constant converts the whole solution to tesla.
// The physically motivated scale is the Elsasser field sqrt(2 Omega rho mu0 eta)
// ~ 2 mT, the strength at which the Lorentz force balances the Coriolis force in
// the core. 1.2 mT is that scale trimmed so the default settings land on Earth's
// observed 8e22 A m^2. Everything else the panel reports — microtesla at the
// surface, inclination, the toroidal field in the core — is then derived from it
// and the r^-3 falloff out to the surface, not fitted separately.
const B_EQ = 1.2e-3;                         // T

const LMAX = 10;                             // harmonics kept in the vacuum match

const dynamo = {
    // ---- Grid ----
    // 40 x 52 is generous for a mean field: the solution lives in the first
    // handful of harmonics, and the cost is set by the timestep, not the cells.
    NR: 40,
    NTH: 52,
    R_IN: 0.35,                              // inner-core boundary, 1220/3480

    // ---- Control inputs, written by main.js from the sliders ----
    // Shear is small but NOT zero at the Earth setting, and that is the whole
    // reason the field reverses. A pure alpha-squared dynamo has two stable
    // polarities and sits in one of them forever; add just enough differential
    // rotation to bring it near the threshold where the solution wants to
    // oscillate, and turbulent fluctuations knock it across at random intervals.
    // Turn shear to zero and the dipole locks — a world of endless superchron.
    p: {
        vigour: 1.0,        // convective vigour      -> Ca
        rotation: 1.0,      // rotation rate          -> Ca, via helicity
        shear: 0.18,        // differential rotation  -> Co
        turbulence: 1.0     // amplitude of alpha fluctuations
    },

    // Reference scales. CA_REF is set so that vigour = rotation = 1 sits about
    // 2.4x above the critical dynamo number measured for this geometry (~11).
    CA_REF: 26,
    CO_REF: 450,

    // Correlation time of the alpha fluctuations, in diffusion units — about
    // 50 kyr. It has to be LONGER than the dipole's own response time (1/11 of
    // a diffusion unit, ~17 kyr) or nothing happens: brief noise averages out
    // over the time the dipole takes to notice it, and the field just breathes
    // in amplitude instead of ever turning over.
    TAU_N: 0.26,
    G_AMP: 0.30,            // gain on the overall-amplitude fluctuation
    G_SYM: 0.80,            // gain on the parity-breaking fluctuation

    // ---- State ----
    t: 0,                   // model time, diffusion units
    A: null, B: null,       // poloidal potential, toroidal field
    An: null, Bn: null,     // scratch for the new step
    br: null, bth: null,    // cell-centred poloidal components
    al: null,               // alpha, including quenching
    ghost: null,            // vacuum continuation of A one cell above the CMB
    gauss: null,            // a_l at r = 1, the exterior harmonic coefficients
    nAmp: 0, nSym: 0,       // the two alpha fluctuation processes
    seed: 1,

    init() {
        const NR = this.NR, NTH = this.NTH, N = NR * NTH;
        this.N = N;
        this.dr = (1 - this.R_IN) / (NR - 1);
        this.dth = Math.PI / NTH;

        this.A = new Float64Array(N);
        this.B = new Float64Array(N);
        this.An = new Float64Array(N);
        this.Bn = new Float64Array(N);
        this.br = new Float64Array(N);
        this.bth = new Float64Array(N);
        this.al = new Float64Array(N);
        this.ghost = new Float64Array(NTH);
        this.gauss = new Float64Array(LMAX + 1);

        this.buildGeometry();
        this.buildLegendre();
        this.reset();
    },

    // ---- Geometry ----
    // Radii sit ON the boundaries (r[0] = R_IN, r[NR-1] = 1) because both are
    // where boundary conditions are applied. Colatitudes sit at CELL CENTRES,
    // half a step off the axis, which is the whole reason this scheme has no
    // pole problem: sin(theta) is never zero, so the 1/(r sin theta)^2 term in
    // D2 is never infinite, and the conservative theta-flux vanishes on its own
    // at the axis because sin(0) = 0 multiplies it away.
    buildGeometry() {
        const NR = this.NR, NTH = this.NTH, dr = this.dr, dth = this.dth;

        this.r = new Float64Array(NR);
        this.sn = new Float64Array(NTH);
        this.cs = new Float64Array(NTH);
        for (let i = 0; i < NR; i++) this.r[i] = this.R_IN + i * dr;
        for (let j = 0; j < NTH; j++) {
            const th = (j + 0.5) * dth;
            this.sn[j] = Math.sin(th);
            this.cs[j] = Math.cos(th);
        }

        const N = this.N;
        this.cRp = new Float64Array(N);   // diffusion stencil, outward face
        this.cRm = new Float64Array(N);   // inward face
        this.cTp = new Float64Array(N);   // face toward the south pole
        this.cTm = new Float64Array(N);   // face toward the north pole
        this.cAx = new Float64Array(N);   // the 1/(r sin theta)^2 term
        this.aGeo = new Float64Array(N);  // alpha shape, antisymmetric (cos theta)
        this.aSym = new Float64Array(N);  // alpha shape, symmetric  (sin^2 theta)
        this.shear = new Float64Array(N); // r sin(theta) dOmega/ds

        const shellSpan = 1 - this.R_IN;
        for (let j = 0; j < NTH; j++) {
            const th = (j + 0.5) * dth;
            const sp = Math.sin(th + dth / 2);          // 0 at the south pole
            const sm = Math.sin(th - dth / 2);          // 0 at the north pole
            for (let i = 0; i < NR; i++) {
                const k = j * NR + i;
                const r = this.r[i], r2 = r * r;
                const rp = r + dr / 2, rm = r - dr / 2;
                this.cRp[k] = rp * rp / (r2 * dr * dr);
                this.cRm[k] = rm * rm / (r2 * dr * dr);
                this.cTp[k] = sp / (r2 * this.sn[j] * dth * dth);
                this.cTm[k] = sm / (r2 * this.sn[j] * dth * dth);
                this.cAx[k] = 1 / (r2 * this.sn[j] * this.sn[j]);

                // Alpha is strongest mid-shell and vanishes at both boundaries,
                // where the flow does. Its sign follows cos(theta): rising fluid
                // is twisted one way north of the equator and the other way
                // south, which is why the two hemispheres build a field that
                // adds rather than cancels.
                const f = Math.sin(Math.PI * (r - this.R_IN) / shellSpan);
                this.aGeo[k] = f * this.cs[j];
                this.aSym[k] = f * this.sn[j] * this.sn[j];

                // Differential rotation is a function of CYLINDRICAL radius, not
                // spherical: a rapidly rotating fluid is stiff along the rotation
                // axis (Taylor-Proudman), so zonal flow varies across cylinders.
                const s = r * this.sn[j];
                const dOm = -0.5 * Math.PI * Math.sin(Math.PI * Math.min(s, 1));
                this.shear[k] = s * dOm;
            }
        }
    },

    // Associated Legendre P_l^1 (for A and B_theta) and P_l (for B_r), sampled
    // on the theta grid. Used twice: to match A to a vacuum field at the
    // core-mantle boundary, and to read the Gauss coefficients an observatory
    // would measure. Both fall out of the same projection.
    buildLegendre() {
        const NTH = this.NTH, dth = this.dth;
        this.S = [];   // P_l^1(cos theta), Condon-Shortley sign dropped
        this.P = [];   // P_l(cos theta)
        this.norm = new Float64Array(LMAX + 1);

        for (let l = 0; l <= LMAX; l++) {
            this.S.push(new Float64Array(NTH));
            this.P.push(new Float64Array(NTH));
        }
        for (let j = 0; j < NTH; j++) {
            const x = this.cs[j], sq = this.sn[j];
            this.S[0][j] = 0;
            this.S[1][j] = sq;
            this.P[0][j] = 1;
            this.P[1][j] = x;
            for (let l = 2; l <= LMAX; l++) {
                this.S[l][j] = ((2 * l - 1) * x * this.S[l - 1][j] - l * this.S[l - 2][j]) / (l - 1);
                this.P[l][j] = ((2 * l - 1) * x * this.P[l - 1][j] - (l - 1) * this.P[l - 2][j]) / l;
            }
        }
        // Norms by quadrature on the same grid the projection uses, so the
        // round trip through the basis is exact rather than nearly exact.
        for (let l = 1; l <= LMAX; l++) {
            let s = 0;
            for (let j = 0; j < NTH; j++) s += this.S[l][j] * this.S[l][j] * this.sn[j] * dth;
            this.norm[l] = s;
        }
    },

    // ---- Seeding ----

    reset() {
        const NR = this.NR, NTH = this.NTH;
        this.A.fill(0); this.B.fill(0);
        this.t = 0; this.nAmp = 0; this.nSym = 0;
        this.seed = 1;

        // A weak, slightly lopsided dipolar seed. The dynamo does not care what
        // it starts from — if it is supercritical the fastest-growing mode takes
        // over within a diffusion time, and if it is not, all of this decays.
        const span = 1 - this.R_IN;
        for (let j = 0; j < NTH; j++) {
            for (let i = 0; i < NR; i++) {
                const f = Math.sin(Math.PI * (this.r[i] - this.R_IN) / span);
                this.A[j * NR + i] = 2e-3 * f * this.sn[j] * (1 + 0.15 * this.cs[j]);
            }
        }
        this.computePoloidal();
        this.project();
    },

    // Deterministic noise, so a run is reproducible and a "kick" is a real
    // perturbation rather than an artefact of Math.random being reseeded.
    rand() {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        return this.seed / 4294967296;
    },

    gaussian() {
        const u = Math.max(this.rand(), 1e-12), v = this.rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },

    // ---- Diagnostics from the exterior field ----

    // Project A at the core-mantle boundary onto P_l^1. Outside the core the
    // mantle carries no current, so each harmonic must continue as r^-(l+1) —
    // that single fact supplies both the boundary condition the solver needs
    // (the ghost value above the CMB) and every number the panel displays.
    project() {
        const NR = this.NR, NTH = this.NTH, dth = this.dth;
        const base = (NR - 1) * 1;
        const g = this.gauss;
        g.fill(0);

        for (let l = 1; l <= LMAX; l++) {
            let s = 0;
            for (let j = 0; j < NTH; j++) {
                s += this.A[j * NR + NR - 1] * this.S[l][j] * this.sn[j] * dth;
            }
            g[l] = s / this.norm[l];
        }

        // Ghost point one radial step outside the CMB. Anything the truncated
        // basis missed is carried up with the l = LMAX falloff instead of being
        // reflected back into the shell.
        const rg = 1 + this.dr;
        const fall = [];
        for (let l = 0; l <= LMAX; l++) fall.push(Math.pow(rg, -(l + 1)));
        for (let j = 0; j < NTH; j++) {
            let rec = 0, ext = 0;
            for (let l = 1; l <= LMAX; l++) {
                rec += g[l] * this.S[l][j];
                ext += g[l] * this.S[l][j] * fall[l];
            }
            const resid = this.A[j * NR + NR - 1] - rec;
            this.ghost[j] = ext + resid * fall[LMAX];
        }
        void base;
    },

    // Field at a point outside the core, in model units. r is in core radii.
    // B_r = sum l(l+1) a_l r^-(l+2) P_l,  B_theta = sum l a_l r^-(l+2) P_l^1.
    exterior(r, colat) {
        const x = Math.cos(colat), sq = Math.sin(colat);
        let P0 = 1, P1 = x, S0 = 0, S1 = sq;
        let bR = 0, bT = 0;
        for (let l = 1; l <= LMAX; l++) {
            if (l > 1) {
                const P2 = ((2 * l - 1) * x * P1 - (l - 1) * P0) / l;
                const S2 = ((2 * l - 1) * x * S1 - l * S0) / (l - 1);
                P0 = P1; P1 = P2; S0 = S1; S1 = S2;
            }
            const f = this.gauss[l] * Math.pow(r, -(l + 2));
            bR += l * (l + 1) * f * P1;
            bT += l * f * S1;
        }
        return { br: bR, bth: bT };
    },

    // What a magnetic observatory at this latitude would record. Sign convention
    // is the geophysical one: X points north, Z points down, and NORMAL polarity
    // (today's) means the field dives into the ground in the northern hemisphere.
    station(latDeg) {
        const colat = (90 - latDeg) * Math.PI / 180;
        const e = this.exterior(R_SURF, colat);
        const X = -e.bth * B_EQ * 1e6;       // microtesla, north
        const Z = -e.br * B_EQ * 1e6;        // microtesla, down
        const H = Math.abs(X);
        const F = Math.hypot(X, Z);
        const inc = Math.atan2(Z, H) * 180 / Math.PI;

        // Virtual geomagnetic pole — the pole position a palaeomagnetist would
        // infer from this one site assuming the field were a perfect dipole. It
        // is the standard way a reversal is recorded, and it wanders off the
        // rotation axis exactly when the field stops being dipolar.
        const dec = X >= 0 ? 0 : Math.PI;
        const magLat = Math.atan(Math.tan(inc * Math.PI / 180) / 2);
        const p = Math.PI / 2 - magLat;
        const ls = latDeg * Math.PI / 180;
        const vgp = Math.asin(
            Math.max(-1, Math.min(1, Math.sin(ls) * Math.cos(p) + Math.cos(ls) * Math.sin(p) * Math.cos(dec)))
        ) * 180 / Math.PI;

        return { X, Z, F, inc, vgp };
    },

    // Axial dipole in 10^22 A m^2, positive for normal (present-day) polarity.
    // m = 4 pi a^3 g10 / mu0, with g10 read off the l = 1 coefficient continued
    // out to the Earth's surface.
    dipoleMoment() {
        const g10 = -this.gauss[1] * Math.pow(R_SURF, -3) * B_EQ;   // tesla
        return 4 * Math.PI * Math.pow(R_EARTH, 3) * g10 / (4e-7 * Math.PI) / 1e22;
    },

    // Fraction of the surface field energy that is NOT the axial dipole. Near
    // zero on a healthy dynamo; it is what climbs during a reversal, when the
    // dipole collapses and the higher harmonics are all that is left.
    nonDipole() {
        let d = 0, tot = 0;
        for (let l = 1; l <= LMAX; l++) {
            const e = (l + 1) * this.gauss[l] * this.gauss[l] * Math.pow(R_SURF, -(2 * l + 4));
            tot += e;
            if (l === 1) d = e;
        }
        return tot > 0 ? 1 - d / tot : 0;
    },

    // Peak toroidal field, in millitesla. Never measured directly — it does not
    // leave the core — but in this class of model it dwarfs the dipole.
    peakToroidal() {
        let m = 0;
        for (let k = 0; k < this.N; k++) { const v = Math.abs(this.B[k]); if (v > m) m = v; }
        return m * B_EQ * 1e3;
    },

    // ---- Derived control values ----

    // Rotation and convection are NOT interchangeable knobs that happen to
    // multiply. Convection with no rotation has no preferred handedness, so its
    // twists cancel and alpha is zero; rotation with no convection has nothing
    // to twist. Alpha needs both, and saturates once the Coriolis force already
    // dominates, which is why turning rotation up past Earth's buys little.
    Ca() {
        const rot = this.p.rotation;
        const helical = Math.SQRT2 * rot / Math.sqrt(1 + rot * rot);
        return this.CA_REF * this.p.vigour * helical * (1 + this.nAmp);
    },

    Co() {
        return this.CO_REF * this.p.shear;
    },

    // Dynamo number: the ratio of field generation to ohmic decay. Below the
    // critical value the field cannot pay its own diffusion bill and dies.
    dynamoNumber() {
        const ca = Math.abs(this.CA_REF * this.p.vigour * Math.SQRT2 * this.p.rotation /
                            Math.sqrt(1 + this.p.rotation * this.p.rotation));
        const co = Math.abs(this.Co());
        return co > 0 ? Math.sqrt(ca * co * 0.5) : ca;
    },

    critical() {
        return this.Co() > 0 ? Math.sqrt(11 * this.CO_REF * this.p.shear * 0.5) * 0.62 : 11;
    },

    // ---- The step ----

    // Cell-centred poloidal components, plus the vacuum ghost they need at the
    // top. Near the axis A is odd and A sin(theta) is even, so the reflection
    // used for the theta derivative is on the PRODUCT, not on A.
    computePoloidal() {
        const NR = this.NR, NTH = this.NTH, dr = this.dr, dth = this.dth;
        const A = this.A, r = this.r, sn = this.sn;
        this.project();
        const rg = 1 + dr;

        for (let j = 0; j < NTH; j++) {
            const row = j * NR;
            const asC = sn[j];
            for (let i = 0; i < NR; i++) {
                const k = row + i;

                // d(A sin theta)/d theta, reflected at both poles
                const cN = j > 0 ? A[k - NR] * sn[j - 1] : A[k] * asC;
                const cS = j < NTH - 1 ? A[k + NR] * sn[j + 1] : A[k] * asC;
                this.br[k] = (cS - cN) / (2 * dth * r[i] * sn[j]);

                // -d(r A)/dr / r, one-sided at both boundaries
                let e, w, h;
                if (i === 0) { e = r[1] * A[k + 1]; w = r[0] * A[k]; h = dr; }
                else if (i === NR - 1) { e = rg * this.ghost[j]; w = r[i - 1] * A[k - 1]; h = 2 * dr; }
                else { e = r[i + 1] * A[k + 1]; w = r[i - 1] * A[k - 1]; h = 2 * dr; }
                this.bth[k] = -(e - w) / (h * r[i]);
            }
        }
    },

    step(dt) {
        const NR = this.NR, NTH = this.NTH, dr = this.dr, dth = this.dth;
        const A = this.A, B = this.B, An = this.An, Bn = this.Bn;
        const br = this.br, bth = this.bth, al = this.al, r = this.r;
        const sn = this.sn, cs = this.cs;

        // Ornstein-Uhlenbeck fluctuations in alpha. Two of them, and they do
        // different jobs. nAmp modulates the whole dynamo up and down. nSym adds
        // a component that is SYMMETRIC about the equator to an alpha that is
        // otherwise antisymmetric — and that is the one that matters, because
        // symmetric alpha is what couples the dipole family to the quadrupole
        // family. Without it the dipole is parity-locked and can weaken forever
        // without ever reversing.
        const sg = this.p.turbulence;
        const tau = this.TAU_N;
        const kick = Math.sqrt(2 * dt / tau);
        this.nAmp += -this.nAmp * dt / tau + this.G_AMP * sg * kick * this.gaussian();
        this.nSym += -this.nSym * dt / tau + this.G_SYM * sg * kick * this.gaussian();

        this.computePoloidal();

        const ca = this.Ca(), co = this.Co(), eps = this.nSym;

        // Alpha, with quenching. The dynamo has no linear saturation of its own —
        // an unquenched supercritical dynamo grows exponentially forever. The
        // field pushes back on the flow that makes it, so alpha is cut once the
        // field reaches equipartition, and THAT is what sets the amplitude of
        // everything the panel reports.
        for (let k = 0; k < this.N; k++) {
            const b2 = B[k] * B[k] + br[k] * br[k] + bth[k] * bth[k];
            al[k] = (this.aGeo[k] + eps * this.aSym[k]) / (1 + b2);
        }

        for (let j = 0; j < NTH; j++) {
            const row = j * NR;
            const rowN = row - NR, rowS = row + NR;
            for (let i = 0; i < NR; i++) {
                const k = row + i;
                const cRp = this.cRp[k], cRm = this.cRm[k];
                const cTp = this.cTp[k], cTm = this.cTm[k];
                const dsum = cRp + cRm + cTp + cTm;

                // Only the 1/(r sin theta)^2 term is taken implicitly, and only
                // because it is diagonal and blows up at the cells nearest the
                // axis. Taking the whole diagonal implicitly is tempting — it is
                // unconditionally stable — but it divides every rate in the
                // problem by (1 + dt * dsum), which at this resolution slowed
                // free decay from 11 to 4.3. A dynamo that runs at 40% speed
                // still looks right; it just quietly reports the wrong epoch.
                const iax = 1 / (1 + dt * this.cAx[k]);

                // ---- Poloidal potential ----
                // Pinned to zero at the inner-core boundary (the idealisation of
                // a perfectly conducting inner core, which excludes radial
                // field) and matched to a vacuum field at the top.
                if (i === 0) { An[k] = 0; }
                else {
                    const aE = i === NR - 1 ? this.ghost[j] : A[k + 1];
                    const aN = j > 0 ? A[rowN + i] : 0;
                    const aS = j < NTH - 1 ? A[rowS + i] : 0;
                    const lap = cRp * aE + cRm * A[k - 1] + cTp * aS + cTm * aN - dsum * A[k];
                    const src = ca * al[k] * B[k];
                    An[k] = (A[k] + dt * (lap + src)) * iax;
                }

                // ---- Toroidal field ----
                // Zero at both radial boundaries: the inner core excludes it and
                // the insulating mantle cannot carry the current that would
                // sustain it. Every field line of B closes inside the core.
                if (i === 0 || i === NR - 1) { Bn[k] = 0; continue; }

                const bE = B[k + 1], bW = B[k - 1];
                const bN = j > 0 ? B[rowN + i] : 0;
                const bS = j < NTH - 1 ? B[rowS + i] : 0;
                const lapB = cRp * bE + cRm * bW + cTp * bS + cTm * bN - dsum * B[k];

                // Omega-effect: poloidal field dragged out into azimuth by the
                // shear. One derivative of Omega, no derivatives of B.
                const srcO = co * this.shear[k] * (br[k] * sn[j] + bth[k] * cs[j]);

                // Alpha-effect on the poloidal field, [curl(alpha Bpol)]_phi.
                // This is the term that makes an alpha-squared dynamo possible
                // with no shear at all. alpha B_r is even about the axis, so the
                // theta derivative reflects rather than wrapping.
                const gE = al[k + 1] * bth[k + 1], gW = al[k - 1] * bth[k - 1];
                const hN = j > 0 ? al[rowN + i] * br[rowN + i] : al[k] * br[k];
                const hS = j < NTH - 1 ? al[rowS + i] * br[rowS + i] : al[k] * br[k];
                const srcA = ca * ((r[i + 1] * gE - r[i - 1] * gW) / (2 * dr) -
                                   (hS - hN) / (2 * dth)) / r[i];

                Bn[k] = (B[k] + dt * (lapB + srcO + srcA)) * iax;
            }
        }

        this.A.set(An);
        this.B.set(Bn);
        this.t += dt;
    },

    // The step is set by the tightest diffusion stencil, which is the cell
    // nearest the axis at the inner-core boundary — smallest in both directions
    // at once. dt = 6.5e-5 is about 0.38 of the explicit limit there. The guard
    // is the same idea as a fixed substep with a ceiling: a backgrounded tab
    // comes back to a long dt and must not try to integrate all of it at once.
    advance(modelDt) {
        const DT = 6.5e-5;
        let left = modelDt;
        let guard = 0;
        while (left > 1e-12 && guard++ < 400) {
            const h = Math.min(DT, left);
            this.step(h);
            left -= h;
        }
        this.project();
    },

    // A deliberate shove — an excursion in the turbulent field big enough to
    // knock the dipole off balance. Handy for provoking a reversal instead of
    // waiting for one.
    kick() {
        this.nSym += (this.rand() > 0.5 ? 1 : -1) * 1.6;
        this.nAmp -= 0.5;
    }
};

if (typeof module !== 'undefined') module.exports = { dynamo, KYR_PER_T, B_EQ, R_SURF };
