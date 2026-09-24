// ============ WARP FIELD ENGINEERING — METRIC FAMILIES ============
// Plain scripts, so load order is the <script> order in index.html:
// metrics → einstein → optics → space → ship → bench → bridge → navmap →
// console → main. Only main.js boots.
//
// A drive is a spacetime metric and nothing else. Each family supplies g_μν
// at a point — stationary, in the frame that travels with the bubble, in code
// units where one unit of length is `L` metres and G = c = 1 — and einstein.js
// works out what matter that geometry needs. No family carries a hand-written
// energy density. The only closed form in here, Alcubierre's, exists to check
// the engine against (tools/check.mjs), never to replace it.

const PHYS = {
    c: 299792458,
    G: 6.67430e-11,
    hbar: 1.054571817e-34,
    kB: 1.380649e-23,
    lP: 1.616255e-35,
    AU: 1.495978707e11,
    LY: 9.4607304725808e15,
    PC: 3.0856775814914e16,
    M_SUN: 1.98847e30,
    M_JUP: 1.89813e27,
    M_EARTH: 5.9722e24,
    M_GALAXY: 3.0e42,        // Milky Way, dark halo included (~1.5e12 M_sun)
    M_UNIVERSE: 1.5e53,      // ordinary matter in the observable universe
    L_SUN: 3.828e26,
    m_p: 1.67262192e-27,
    g0: 9.80665
};
PHYS.C4G = PHYS.c ** 4 / PHYS.G;      // N: geometric curvature → J/m^3 (× 1/m^2)
PHYS.C2G = PHYS.c ** 2 / PHYS.G;      // kg/m: metres of geometric mass → kg

// Casimir cavity at the smallest plate gaps anyone has measured the force
// across (~100 nm). The most negative energy density a laboratory has
// demonstrated, and so the natural yardstick for what a wall asks for.
const CASIMIR_GAP = 100e-9;
const CASIMIR_RHO = Math.PI ** 2 * PHYS.hbar * PHYS.c / (720 * CASIMIR_GAP ** 4);

// The payload every drive has to carry: a crew module 12 m long. Anything
// that puts curvature across it is a wall running through the ship.
const PAYLOAD_HALF = 6;

function sech2(u) {
    const a = Math.abs(u);
    if (a > 350) return 0;
    const e = Math.exp(-2 * a);
    return 4 * e / ((1 + e) * (1 + e));
}

// Alcubierre's top hat in code units (bubble radius = 1): 1 inside, 0 outside,
// with a wall whose thickness is 2/s. Pfenning & Ford's Δ is that same 2/σ.
function topHat(r, s) {
    return (Math.tanh(s * (r + 1)) - Math.tanh(s * (r - 1))) / (2 * Math.tanh(s));
}
function topHatD(r, s) {
    return s * (sech2(s * (r + 1)) - sech2(s * (r - 1))) / (2 * Math.tanh(s));
}
function topHatDD(r, s) {
    const a = s * (r + 1), b = s * (r - 1);
    return s * s * (-2 * sech2(a) * Math.tanh(a) + 2 * sech2(b) * Math.tanh(b)) / (2 * Math.tanh(s));
}

// A C∞ step, 0 below x = 0 and 1 above x = 1. It has to be infinitely smooth,
// not merely C2: the tables below are read through quintic Hermite
// interpolation, and a kink in any derivative of the density up to the
// fourth shows up as a thin film of negative energy at the edge of the shell
// — a violation the geometry does not have. A quintic smoothstep did exactly
// that at the part-in-10^4 level.
function smoothStep(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const a = Math.exp(-1 / x), b = Math.exp(-1 / (1 - x));
    return a / (a + b);
}
function smoothStepD(x) {
    if (x <= 0 || x >= 1) return 0;
    const a = Math.exp(-1 / x), b = Math.exp(-1 / (1 - x));
    const s = a + b;
    return a * b * (1 / (x * x) + 1 / ((1 - x) * (1 - x))) / (s * s);
}

// ---- The spherically symmetric part of a matter shell ----
//
// Density is uniform between r1 and r2 with smoothstep edges. The radial
// pressure is taken to be zero everywhere — the shell holds itself up with
// hoop stress, like a dome — which makes the lapse
//     a' = m / (r (r − 2m))
// and the tangential stress  p_t = ρ r a' / 2.  Every energy condition then
// holds by inspection as long as m/(r − 2m) stays under 2, and the engine is
// left to confirm it rather than being trusted to discover it.
//
// Tables are sampled with value, first and second derivative, and read back
// through quintic Hermite interpolation so the metric stays C2 between nodes.
function RadialShell(M, r1, r2, w) {
    const n = 3000;
    const rOut = r2 + w;
    const dr = rOut / n;
    const rho = r => smoothStep((r - r1) / w + 0.5) * smoothStep((r2 - r) / w + 0.5);
    const rhoD = r => (smoothStepD((r - r1) / w + 0.5) * smoothStep((r2 - r) / w + 0.5)
                     - smoothStep((r - r1) / w + 0.5) * smoothStepD((r2 - r) / w + 0.5)) / w;

    const m = new Float64Array(n + 1), m1 = new Float64Array(n + 1), m2 = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
        const r = i * dr;
        m1[i] = 4 * Math.PI * r * r * rho(r);
        m2[i] = 8 * Math.PI * r * rho(r) + 4 * Math.PI * r * r * rhoD(r);
        if (i > 0) {
            const rm = r - dr / 2;
            m[i] = m[i - 1] + dr / 6 * (m1[i - 1] + 4 * 4 * Math.PI * rm * rm * rho(rm) + m1[i]);
        }
    }
    const k = M / m[n];
    for (let i = 0; i <= n; i++) { m[i] *= k; m1[i] *= k; m2[i] *= k; }

    this.n = n; this.dr = dr; this.rOut = rOut; this.M = M;
    this.m = m; this.m1 = m1; this.m2 = m2;

    let compact = 0;
    const a = new Float64Array(n + 1), a1 = new Float64Array(n + 1), a2 = new Float64Array(n + 1);
    const lapseD = (r, mm, mm1) => {
        if (r < 1e-12 || mm <= 0) return [0, 0];
        const D = r * r - 2 * mm * r;
        const Dd = 2 * r - 2 * mm - 2 * mm1 * r;
        return [mm / D, (mm1 * D - mm * Dd) / (D * D)];
    };
    for (let i = 0; i <= n; i++) {
        const r = i * dr;
        if (r > 0) compact = Math.max(compact, 2 * m[i] / r);
        const d = lapseD(r, m[i], m1[i]);
        a1[i] = d[0]; a2[i] = d[1];
    }
    this.compactness = compact;
    a[n] = 0.5 * Math.log(1 - 2 * M / rOut);
    for (let i = n; i > 0; i--) {
        const rm = (i - 0.5) * dr;
        const mm = this._interp(m, m1, m2, rm);
        const mm1 = this._interp(m1, m2, null, rm);
        const am = lapseD(rm, mm, mm1)[0];
        a[i - 1] = a[i] - dr / 6 * (a1[i - 1] + 4 * am + a1[i]);
    }
    this.a = a; this.a1 = a1; this.a2 = a2;
}

// Quintic Hermite through (y, y', y''). Passing y2 = null drops to cubic
// Hermite, which is all the midpoint lookups during construction need.
RadialShell.prototype._interp = function (y, y1, y2, r) {
    const dr = this.dr;
    let i = Math.floor(r / dr);
    if (i < 0) i = 0;
    if (i >= this.n) i = this.n - 1;
    const t = r / dr - i, h = dr;
    const t2 = t * t, t3 = t2 * t, t4 = t3 * t, t5 = t4 * t;
    if (!y2) {
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        return h00 * y[i] + h10 * h * y1[i] + h01 * y[i + 1] + h11 * h * y1[i + 1];
    }
    const H0 = 1 - 10 * t3 + 15 * t4 - 6 * t5, H1 = t - 6 * t3 + 8 * t4 - 3 * t5;
    const H2 = 0.5 * t2 - 1.5 * t3 + 1.5 * t4 - 0.5 * t5, H3 = 10 * t3 - 15 * t4 + 6 * t5;
    const H4 = -4 * t3 + 7 * t4 - 3 * t5, H5 = 0.5 * t3 - t4 + 0.5 * t5;
    return y[i] * H0 + h * y1[i] * H1 + h * h * y2[i] * H2
         + y[i + 1] * H3 + h * y1[i + 1] * H4 + h * h * y2[i + 1] * H5;
};

// m(r) and a(r). Outside the matter both are exact Schwarzschild.
RadialShell.prototype.at = function (r, out) {
    if (r >= this.rOut) {
        out[0] = this.M;
        out[1] = 0.5 * Math.log(1 - 2 * this.M / r);
        return;
    }
    out[0] = this._interp(this.m, this.m1, this.m2, r);
    out[1] = this._interp(this.a, this.a1, this.a2, r);
};

// Fuchs et al. (2024): the shift switches off across the shell through
//   S = 1 − 1/(exp(D (1/(r − b) + 1/(r − a))) + 1)
// which is C∞ and flat at both ends — its gradient sits where the matter is.
function fuchsSwitch(r, a, b) {
    if (r <= a) return 1;
    if (r >= b) return 0;
    const e = (b - a) * (1 / (r - b) + 1 / (r - a));
    if (e > 700) return 1;
    if (e < -700) return 0;
    return 1 - 1 / (Math.exp(e) + 1);
}

// ---- Families ----
//
// Parameter specs drive both the workshop sliders and the flight console's
// knobs. `log` sliders run in decades; `unit` picks the formatter.

const FAMILIES = {
    alcubierre: {
        name: 'Alcubierre',
        authors: 'M. Alcubierre',
        year: 1994,
        ref: 'https://arxiv.org/abs/gr-qc/0009013',
        refLabel: 'gr-qc/0009013',
        kind: 'shift',
        blurb: 'Space contracts ahead of the bubble and expands behind it; the ship inside sits in ' +
               'flat space and never moves locally. Any speed is allowed — the price is negative ' +
               'energy in a ring around the wall, measured by every observer.',
        params: [
            { key: 'R', label: 'Bubble radius', min: 5, max: 2000, log: true, unit: 'm', def: 100 },
            { key: 'D', label: 'Wall thickness', min: 1e-35, max: 500, log: true, unit: 'm', def: 10 }
        ]
    },
    natario: {
        name: 'Natário',
        authors: 'J. Natário',
        year: 2002,
        ref: 'https://arxiv.org/abs/gr-qc/0110086',
        refLabel: 'gr-qc/0110086',
        kind: 'shift',
        blurb: 'The same trip with zero expansion: space is not squeezed ahead and stretched behind, ' +
               'it slides around the ship like fluid round a sphere. Proof that the famous ' +
               'contraction and expansion are not what makes a warp drive work.',
        params: [
            { key: 'R', label: 'Bubble radius', min: 5, max: 2000, log: true, unit: 'm', def: 100 },
            { key: 'D', label: 'Wall thickness', min: 1e-35, max: 500, log: true, unit: 'm', def: 10 }
        ]
    },
    potential: {
        name: 'Irrotational shift',
        authors: 'class used by Fell & Heisenberg',
        year: 2021,
        ref: 'https://arxiv.org/abs/2104.06488',
        refLabel: '2104.06488',
        kind: 'shift',
        blurb: 'A shift that is the gradient of a potential, the class Fell & Heisenberg searched for ' +
               'positive energy. This is the simplest member, not their configuration: the Eulerian ' +
               'energy is positive in places — and still integrates to exactly zero.',
        params: [
            { key: 'R', label: 'Bubble radius', min: 5, max: 2000, log: true, unit: 'm', def: 100 },
            { key: 'D', label: 'Wall thickness', min: 1e-35, max: 500, log: true, unit: 'm', def: 10 }
        ]
    },
    shell: {
        name: 'Matter shell',
        authors: 'A. Bobrick & G. Martire',
        year: 2021,
        ref: 'https://arxiv.org/abs/2102.06824',
        refLabel: '2102.06824',
        kind: 'shell',
        blurb: 'Every warp drive is a shell of material moving inertially. Make that material ordinary ' +
               'and the energy is positive everywhere — but the drive is subluminal, has to be pushed ' +
               'like any other mass, and its only trick is that clocks inside run slow.',
        params: [
            { key: 'M', label: 'Shell mass', min: 1e24, max: 2e28, log: true, unit: 'kg', def: 4.49e27 },
            { key: 'R1', label: 'Inner radius', min: 2, max: 400, log: true, unit: 'm', def: 10 },
            { key: 'R2', label: 'Outer radius', min: 4, max: 800, log: true, unit: 'm', def: 20 }
        ]
    },
    warpshell: {
        name: 'Warp shell',
        authors: 'J. Fuchs et al.',
        year: 2024,
        ref: 'https://arxiv.org/abs/2405.02709',
        refLabel: '2405.02709',
        kind: 'shell',
        blurb: 'Bobrick & Martire\'s shell with an Alcubierre-like shift laid inside it. The shell\'s ' +
               'mass pays for the shift\'s momentum flux, so every energy condition holds — up to a ' +
               'limit the authors left open. Push the shift until the shell cannot pay.',
        params: [
            { key: 'M', label: 'Shell mass', min: 1e24, max: 2e28, log: true, unit: 'kg', def: 4.49e27 },
            { key: 'R1', label: 'Inner radius', min: 2, max: 400, log: true, unit: 'm', def: 10 },
            { key: 'R2', label: 'Outer radius', min: 4, max: 800, log: true, unit: 'm', def: 20 },
            { key: 'bw', label: 'Interior shift', min: 0, max: 0.5, log: false, unit: 'c', def: 0.02 }
        ]
    }
};

const FAMILY_ORDER = ['alcubierre', 'natario', 'potential', 'shell', 'warpshell'];

// Clamp a parameter set into a buildable geometry. The rules live here and
// nowhere else, so the sliders and the knobs cannot disagree about them.
function sanitizeParams(key, p) {
    const q = Object.assign({}, p);
    if (FAMILIES[key].kind === 'shift') {
        q.D = Math.min(q.D, q.R);
    } else {
        q.R1 = Math.max(2, q.R1);
        q.R2 = Math.max(q.R2, q.R1 * 1.25);
        // A shell squeezed inside 1.25× its own Schwarzschild radius cannot
        // be held up by any stress that respects the dominant energy
        // condition — cap the mass rather than build a black hole.
        const Mgeo = q.M / PHYS.C2G;
        const cap = 0.4 * q.R2 / 2;
        if (Mgeo > cap) q.M = cap * PHYS.C2G;
    }
    return q;
}

// Build a metric instance. `v` is the bubble velocity (units of c) for the
// shift families; shells are analysed in their own rest frame, which is
// where Fuchs et al. evaluate theirs. `wallFloor` is the thinnest wall, in
// units of R, the caller is able to resolve — the engine and the ray tracer
// clamp to it and extrapolate rather than take a step smaller than a
// double can see.
function buildMetric(key, params, v, wallFloor) {
    const fam = FAMILIES[key];
    const p = sanitizeParams(key, params);
    if (fam.kind === 'shift') return buildShiftMetric(key, p, v, wallFloor || 0);
    return buildShellMetric(key, p);
}

function buildShiftMetric(key, p, v, wallFloor) {
    const L = p.R;
    const wTrue = p.D / p.R;                 // wall thickness in bubble radii
    const w = Math.max(wTrue, wallFloor);
    const s = 2 / w;

    // shift(x, y, z, N) is the whole metric. shiftJac(x, y, N, J) is the same
    // field and its in-plane Jacobian J = [∂xNx, ∂xNy, ∂yNx, ∂yNy] at z = 0,
    // written out by hand for the ray tracer, which evaluates it a few
    // million times per table — finite-differencing it cost 5× the time.
    let shift, shiftJac;
    if (key === 'alcubierre') {
        // ds² = −dt² + (dξ + v(1 − f) dt)² + dy² + dz², ξ = x − v t
        shift = (x, y, z, N) => {
            const r = Math.sqrt(x * x + y * y + z * z);
            N[0] = v * (1 - topHat(r, s)); N[1] = 0; N[2] = 0;
        };
        shiftJac = (x, y, N, J) => {
            const r = Math.sqrt(x * x + y * y);
            N[0] = v * (1 - topHat(r, s)); N[1] = 0;
            if (r < 1e-9) { J[0] = J[1] = J[2] = J[3] = 0; return; }
            const q = -v * topHatD(r, s) / r;
            J[0] = q * x; J[1] = 0; J[2] = q * y; J[3] = 0;
        };
    } else if (key === 'natario') {
        // Stokes stream function Ψ = ½ v f(r) r² sin²θ: uniform flow inside,
        // nothing outside, divergence-free everywhere.
        shift = (x, y, z, N) => {
            const r = Math.sqrt(x * x + y * y + z * z);
            const f = topHat(r, s);
            if (r < 1e-12) { N[0] = v * (1 - f); N[1] = 0; N[2] = 0; return; }
            const fd = topHatD(r, s);
            const rho2 = y * y + z * z;
            N[0] = v * (1 - f - fd * rho2 / (2 * r));
            N[1] = 0.5 * v * fd * x * y / r;
            N[2] = 0.5 * v * fd * x * z / r;
        };
        // With g = f'/(2r):  Nx = v(1 − f − g y²),  Ny = v g x y.
        shiftJac = (x, y, N, J) => {
            const r = Math.sqrt(x * x + y * y);
            const f = topHat(r, s);
            if (r < 1e-9) { N[0] = v * (1 - f); N[1] = 0; J[0] = J[1] = J[2] = J[3] = 0; return; }
            const fd = topHatD(r, s), fdd = topHatDD(r, s);
            const g = fd / (2 * r), gd = (fdd * r - fd) / (2 * r * r);
            N[0] = v * (1 - f - g * y * y);
            N[1] = v * g * x * y;
            J[0] = -v * (fd * x / r + gd * (x / r) * y * y);
            J[1] = v * (gd * (x / r) * x * y + g * y);
            J[2] = -v * (fd * y / r + gd * (y / r) * y * y + 2 * g * y);
            J[3] = v * (gd * (y / r) * x * y + g * x);
        };
    } else {
        // N = v x̂ − v ∇(x f): curl-free, so the flow is a potential flow.
        shift = (x, y, z, N) => {
            const r = Math.sqrt(x * x + y * y + z * z);
            const f = topHat(r, s);
            if (r < 1e-12) { N[0] = v * (1 - f); N[1] = 0; N[2] = 0; return; }
            const q = x * topHatD(r, s) / r;
            N[0] = v * (1 - f - q * x);
            N[1] = -v * q * y;
            N[2] = -v * q * z;
        };
        // With k = f'/r:  Nx = v(1 − f − k x²),  Ny = −v k x y.
        shiftJac = (x, y, N, J) => {
            const r = Math.sqrt(x * x + y * y);
            const f = topHat(r, s);
            if (r < 1e-9) { N[0] = v * (1 - f); N[1] = 0; J[0] = J[1] = J[2] = J[3] = 0; return; }
            const fd = topHatD(r, s), fdd = topHatDD(r, s);
            const k = fd / r, kd = (fdd * r - fd) / (r * r);
            N[0] = v * (1 - f - k * x * x);
            N[1] = -v * k * x * y;
            J[0] = -v * (fd * x / r + kd * (x / r) * x * x + 2 * k * x);
            J[1] = -v * (kd * (x / r) * x * y + k * y);
            J[2] = -v * (fd * y / r + kd * (y / r) * x * x);
            J[3] = -v * (kd * (y / r) * x * y + k * x);
        };
    }

    const Ns = new Float64Array(3);
    const g = (x, y, z, o) => {
        shift(x, y, z, Ns);
        const a = Ns[0], b = Ns[1], c = Ns[2];
        o[0] = -1 + a * a + b * b + c * c;
        o[1] = a; o[2] = b; o[3] = c;
        o[4] = 1; o[5] = 0; o[6] = 0; o[7] = 1; o[8] = 0; o[9] = 1;
    };

    // Radius inside which the geometry is flat to one part in a thousand:
    // the room the payload actually has.
    let lo = 0, hi = 1;
    for (let i = 0; i < 80; i++) {
        const mid = 0.5 * (lo + hi);
        if (1 - topHat(mid, s) < 1e-3) lo = mid; else hi = mid;
    }

    return {
        key, family: FAMILIES[key], params: p, kind: 'shift', flat: true,
        L, v, s, w, wTrue, clamped: w > wTrue,
        g, shift, shiftJac,
        features: [{ r: 1, w }],
        rmax: Math.max(2, 1 + 12 * w),
        rOptic: 1 + 10 * w,
        flatRadius: lo * L,
        clockRate: 1,
        M: 0,
        subluminal: false
    };
}

function buildShellMetric(key, p) {
    const L = p.R2;
    const r1 = p.R1 / L, r2 = 1;
    const width = r2 - r1;
    const w = 0.2 * width;                 // density edge smoothing
    const Mc = p.M / PHYS.C2G / L;         // geometric mass in code units
    const table = new RadialShell(Mc, r1, r2, w);
    const bw = key === 'warpshell' ? p.bw : 0;
    // The shift ramps down across the whole shell, as in the paper. Its
    // curvature is what the matter has to pay for, and the bill goes as one
    // over the ramp width squared: squeezing the ramp into the middle 70% of
    // the shell took the null condition from satisfied at β_w = 0.01 to
    // violated by 0.67 ρ at 0.02. The width is the design, not a detail.
    const sa = r1, sb = r2;

    const ma = new Float64Array(2);
    const g = (x, y, z, o) => {
        const r = Math.sqrt(x * x + y * y + z * z);
        table.at(r, ma);
        const m = ma[0];
        o[0] = -Math.exp(2 * ma[1]);
        const A = r > 1e-12 && m > 0 ? 2 * m / (r - 2 * m) / (r * r) : 0;
        o[4] = 1 + A * x * x; o[5] = A * x * y; o[6] = A * x * z;
        o[7] = 1 + A * y * y; o[8] = A * y * z; o[9] = 1 + A * z * z;
        // Fuchs et al.: only g_01 is modified, g_01 → −S(r) β_warp.
        o[1] = bw ? -bw * fuchsSwitch(r, sa, sb) : 0;
        o[2] = 0; o[3] = 0;
    };

    const tmp = new Float64Array(2);
    table.at(0, tmp);
    return {
        key, family: FAMILIES[key], params: p, kind: 'shell', flat: false,
        L, v: 0, bw, w, wTrue: w, clamped: false,
        g, shift: null, table,
        features: [{ r: r1, w }, { r: r2, w }, { r: 0.5 * (sa + sb), w: 0.25 * (sb - sa) }],
        rmax: 1.6,
        rOptic: 1.6,
        flatRadius: Math.max(0, r1 - w / 2) * L,
        clockRate: Math.exp(tmp[1]),
        M: p.M,
        compactness: table.compactness,
        subluminal: true
    };
}

// ---- Closed forms, for checking and for walls too thin to grid ----
//
// Alcubierre's Eulerian energy density (his eq. 19), code units:
//     ρ = −(1/32π) v² (ϱ²/r²) f'(r)²
// and its volume integral  E = −(v²/12) ∫ r² f'² dr,  done in the wall
// coordinate u = s(r − 1) so a Planck-thin wall integrates as easily as a
// fat one.
function alcubierreRho(x, y, z, v, s) {
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r < 1e-12) return 0;
    const fd = topHatD(r, s);
    return -(v * v / (32 * Math.PI)) * ((y * y + z * z) / (r * r)) * fd * fd;
}

function alcubierreEnergyCode(v, s) {
    const lo = -Math.min(s, 40), hi = 40, n = 4000;
    const h = (hi - lo) / n;
    const th = Math.tanh(s);
    let sum = 0;
    for (let i = 0; i <= n; i++) {
        const u = lo + i * h;
        const g = (sech2(u + 2 * s) - sech2(u)) / (2 * th);
        const q = 1 + u / s;
        const val = q * q * g * g;
        sum += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * val;
    }
    const I = s * sum * h / 3;               // ∫ r² f'² dr in units of R
    return -(v * v / 12) * I;
}

// Pfenning & Ford (1997): a quantum inequality caps the wall at ~10² v ℓ_P.
function qiWallLimit(v) {
    return 1e2 * Math.max(v, 1e-12) * PHYS.lP;
}
