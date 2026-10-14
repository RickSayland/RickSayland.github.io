// ============ THERMALIZE — NUCLEAR DATA ============
// Plain scripts, so load order is the <script> order in index.html:
// nuclides → materials → grid → neutrons → render → inspector → main.
// This file is data and closed-form physics only. No DOM. Owns `nuc`.
//
// WHAT IS MEASURED AND WHAT IS MODELLED. The two are kept apart on purpose.
//
//   MEASURED  `sb` and `sa` are the bound scattering cross section and the
//             absorption cross section for 2200 m/s neutrons, straight out of
//             Sears, Neutron News 3(3), 1992 — the table NIST publishes at
//             ncnr.nist.gov/resources/n-lengths. Thermal fission (`sf`) is the
//             fissile share of that absorption. These numbers are pinned: the
//             curve below is built so that it passes through them exactly, and
//             tools/check.mjs asserts that it still does.
//
//   MODELLED  everything about how a cross section moves away from thermal:
//             the 1/v law, a handful of the famous low-lying resonances as
//             single-level Breit-Wigner peaks, a power law standing in for the
//             unresolved region, and a fast-neutron value at 2 MeV. That is
//             the right SHAPE and the right order of magnitude, and it is not
//             an evaluated library. The page says so.
//
// UNITS, fixed once and never mixed: energy eV, cross section barns, length cm.

const nuc = {

    E_TH: 0.0253,           // eV, the 2200 m/s neutron
    KT: 0.0253,             // eV, room temperature — the bench does not heat up yet
    E_CUT: 0.127,           // eV, 5 kT: below this a scattered neutron is in equilibrium

    // The energy grid: a hundred bins a decade from 0.1 meV to 20 MeV. Bins are
    // AVERAGED, not sampled (see tabulate), because a resonance 25 meV wide
    // sitting at 6.67 eV is a sixth the width of a bin and point sampling
    // would either miss it or report its peak for the whole bin.
    LOG_MIN: -4,
    PER_DEC: 100,
    NG: 1132,
    SUB: 16,

    // ---- Species ----
    //
    //   sb     bound scattering cross section, b            (Sears)
    //   sa     absorption at 2200 m/s, b                    (Sears)
    //   sf     thermal fission, b — part of sa
    //   nu     neutrons per thermal fission
    //   e2     elastic cross section at 2 MeV, b            (model)
    //   roll,p where and how sharply elastic rolls off toward e2
    //   epi    elastic plateau above the thermal resonance, if it differs
    //   res    [E0 eV, total width eV, capture peak b, fission peak b]
    //   fit    scale the resonances to carry the WHOLE thermal value — for the
    //          absorbers whose thermal cross section is one resonance's tail
    //   cu     unresolved-region capture at 10 keV, b
    //   ff     fast-fission plateau for a fissile nuclide, b
    //   fth    [threshold eV, plateau b] for a nuclide that only fissions fast
    //   inel   [threshold eV, plateau b]
    //   n2n    [threshold eV, plateau b]
    //   rx     the capture reaction, for the readout
    //   ej     what leaves: 'g' gamma (default), 'a' alpha, 'p' proton
    //   spent  what the atom is afterwards, when burn-up is switched on
    //   mix    [[species, atom fraction], …] — a natural element, drawn as one
    //          averaged atom whose isotopes are picked by share at a collision
    SPECIES: [
        { key: 'H1', sym: 'H', name: 'hydrogen', A: 1.008, sb: 82.02, sa: 0.3326,
          roll: 2e5, p: 0.8, einf: 0, rx: '¹H + n → ²H + γ', spent: 'H2' },
        { key: 'H2', sym: 'D', name: 'deuterium', A: 2.014, sb: 7.64, sa: 0.000519,
          e2: 2.6, roll: 1e6, rx: '²H + n → ³H + γ', spent: 'H3' },
        { key: 'H3', sym: 'T', name: 'tritium', A: 3.016, sb: 3.03, sa: 0, e2: 2.0 },
        { key: 'He3', sym: '³He', name: 'helium-3', A: 3.016, sb: 6.0, sa: 5333, e2: 2.3,
          rx: '³He + n → ³H + p', ej: 'p', spent: 'H3' },
        { key: 'Li6', sym: '⁶Li', name: 'lithium-6', A: 6.015, sb: 0.97, sa: 940, e2: 1.6,
          rx: '⁶Li + n → ³H + α', ej: 'a', spent: 'H3' },
        { key: 'Li7', sym: '⁷Li', name: 'lithium-7', A: 7.016, sb: 1.40, sa: 0.0454, e2: 1.6,
          rx: '⁷Li + n → ⁸Li + γ' },
        { key: 'Be9', sym: 'Be', name: 'beryllium', A: 9.012, sb: 7.63, sa: 0.0076, e2: 2.0,
          n2n: [1.85e6, 0.55], rx: '⁹Be + n → ¹⁰Be + γ' },
        { key: 'B10', sym: '¹⁰B', name: 'boron-10', A: 10.013, sb: 3.1, sa: 3835, e2: 1.7,
          rx: '¹⁰B + n → ⁷Li + α', ej: 'a', spent: 'Li7' },
        { key: 'B11', sym: '¹¹B', name: 'boron-11', A: 11.009, sb: 5.77, sa: 0.0055, e2: 1.7,
          rx: '¹¹B + n → ¹²B + γ' },
        { key: 'C', sym: 'C', name: 'carbon', A: 12.011, sb: 5.551, sa: 0.0035, e2: 1.7,
          inel: [4.8e6, 0.3], rx: '¹²C + n → ¹³C + γ' },
        { key: 'O', sym: 'O', name: 'oxygen', A: 15.999, sb: 4.232, sa: 0.00019, e2: 1.6,
          rx: '¹⁶O + n → ¹⁷O + γ' },
        { key: 'Na', sym: 'Na', name: 'sodium', A: 22.990, sb: 3.28, sa: 0.53, e2: 2.6,
          inel: [4.6e5, 0.6], rx: '²³Na + n → ²⁴Na + γ' },
        { key: 'Al', sym: 'Al', name: 'aluminium', A: 26.982, sb: 1.503, sa: 0.231, e2: 2.6,
          inel: [8.7e5, 0.5], rx: '²⁷Al + n → ²⁸Al + γ' },
        { key: 'Si', sym: 'Si', name: 'silicon', A: 28.086, sb: 2.167, sa: 0.171, e2: 2.5,
          inel: [1.8e6, 0.4], rx: '²⁸Si + n → ²⁹Si + γ' },
        { key: 'Fe', sym: 'Fe', name: 'iron', A: 55.845, sb: 11.62, sa: 2.56, e2: 2.3,
          inel: [8.6e5, 1.0], cu: 0.01, rx: '⁵⁶Fe + n → ⁵⁷Fe + γ' },
        { key: 'Zr', sym: 'Zr', name: 'zirconium', A: 91.224, sb: 6.46, sa: 0.185, e2: 4.2,
          inel: [9.2e5, 1.0], cu: 0.02, rx: '⁹⁰Zr + n → ⁹¹Zr + γ' },
        { key: 'Ag', sym: 'Ag', name: 'silver', A: 107.868, sb: 4.99, sa: 63.3, e2: 4.4,
          inel: [3e5, 1.6], cu: 0.9, res: [[5.19, 0.149, 14400, 0]],
          rx: '¹⁰⁹Ag + n → ¹¹⁰Ag + γ' },
        // Cadmium's 2520 b is one resonance in one isotope: Cd-113, 12% of the
        // metal, at 0.178 eV. Above it the cross section does not ease off as
        // 1/v, it falls off a cliff — the cadmium cutoff.
        { key: 'Cd', sym: 'Cd', name: 'cadmium', A: 112.411, sb: 6.5, sa: 2520, e2: 4.4,
          inel: [3e5, 1.6], cu: 0.35, res: [[0.178, 0.113, 1, 0]], fit: true,
          rx: '¹¹³Cd + n → ¹¹⁴Cd + γ', spent: 'Cd114' },
        { key: 'Cd114', sym: 'Cd', name: 'cadmium-114', A: 113.903, sb: 7.1, sa: 0.34, e2: 4.4 },
        { key: 'In', sym: 'In', name: 'indium', A: 114.818, sb: 2.62, sa: 193.8, e2: 4.4,
          inel: [3e5, 1.6], cu: 0.8, res: [[1.457, 0.075, 37000, 0]],
          rx: '¹¹⁵In + n → ¹¹⁶In + γ', spent: 'Sn' },
        { key: 'Sn', sym: 'Sn', name: 'tin', A: 118.710, sb: 4.892, sa: 0.626, e2: 4.5, cu: 0.1 },
        // Not in Sears: 2.65 million barns is the usual quoted value, and the
        // largest thermal cross section of any nuclide.
        { key: 'Xe135', sym: 'Xe', name: 'xenon-135', A: 134.907, sb: 4.3, sa: 2.65e6, e2: 4.5,
          res: [[0.0842, 0.12, 1, 0]], fit: true,
          rx: '¹³⁵Xe + n → ¹³⁶Xe + γ', spent: 'Xe136' },
        { key: 'Xe136', sym: 'Xe', name: 'xenon-136', A: 135.907, sb: 4.3, sa: 0.26, e2: 4.5 },
        { key: 'Gd', sym: 'Gd', name: 'gadolinium', A: 157.25, sb: 180, sa: 49700, e2: 5.0,
          epi: 8, inel: [2e5, 2.0], cu: 1.5, res: [[0.030, 0.107, 1, 0]], fit: true,
          rx: '¹⁵⁷Gd + n → ¹⁵⁸Gd + γ', spent: 'Gd158' },
        { key: 'Gd158', sym: 'Gd', name: 'gadolinium-158', A: 157.924, sb: 10, sa: 2.2, e2: 5.0 },
        // Hafnium captures into another absorbing hafnium, which is why a
        // control rod made of it lasts: nothing here marks it spent.
        { key: 'Hf', sym: 'Hf', name: 'hafnium', A: 178.49, sb: 10.2, sa: 104.1, e2: 5.0,
          inel: [1e5, 2.2], cu: 0.6,
          res: [[1.098, 0.068, 5300, 0], [2.388, 0.069, 11850, 0], [7.78, 0.105, 23000, 0]],
          rx: '¹⁷⁷Hf + n → ¹⁷⁸Hf + γ' },
        { key: 'Au', sym: 'Au', name: 'gold', A: 196.967, sb: 7.75, sa: 98.65, e2: 5.0,
          inel: [2e5, 2.0], cu: 1.1, res: [[4.906, 0.139, 32700, 0]],
          rx: '¹⁹⁷Au + n → ¹⁹⁸Au + γ', spent: 'Hg198' },
        { key: 'Hg198', sym: 'Hg', name: 'mercury-198', A: 197.967, sb: 10, sa: 2.0, e2: 5.0 },
        { key: 'Hg', sym: 'Hg', name: 'mercury', A: 200.59, sb: 26.8, sa: 372.3, e2: 5.0,
          inel: [2e5, 1.8], cu: 0.3, rx: '¹⁹⁹Hg + n → ²⁰⁰Hg + γ' },
        { key: 'Pb', sym: 'Pb', name: 'lead', A: 207.2, sb: 11.118, sa: 0.171, e2: 5.3,
          inel: [8e5, 0.7], rx: '²⁰⁷Pb + n → ²⁰⁸Pb + γ' },
        { key: 'U235', sym: '²³⁵U', name: 'uranium-235', A: 235.044, sb: 14.0, sa: 680.9,
          sf: 583.0, nu: 2.43, ff: 1.25, e2: 4.3, inel: [5e4, 1.9], cu: 1.0,
          res: [[0.29, 0.135, 28, 79], [1.14, 0.155, 29, 84], [6.39, 0.05, 880, 220],
                [8.78, 0.14, 364, 909], [12.39, 0.065, 1295, 810], [19.3, 0.10, 865, 1297],
                [35.19, 0.14, 265, 660]],
          rx: '²³⁵U + n → ²³⁶U + γ', spent: 'U236' },
        { key: 'U236', sym: 'U', name: 'uranium-236', A: 236.046, sb: 9.0, sa: 5.1, e2: 4.4,
          inel: [5e4, 2.2], cu: 0.7 },
        // Four resonances carry most of U-238's appetite for neutrons that are
        // neither fast nor slow. A reactor has to get its neutrons past them.
        { key: 'U238', sym: '²³⁸U', name: 'uranium-238', A: 238.051, sb: 8.871, sa: 2.68,
          nu: 2.6, fth: [1.2e6, 0.55], e2: 4.5, inel: [4.5e4, 2.6], cu: 0.75,
          res: [[6.67, 0.0245, 22570, 0], [20.87, 0.0332, 26930, 0],
                [36.68, 0.057, 17230, 0], [66.03, 0.048, 9950, 0]],
          rx: '²³⁸U + n → ²³⁹U → ²³⁹Pu', spent: 'Pu239' },
        { key: 'Pu239', sym: 'Pu', name: 'plutonium-239', A: 239.052, sb: 7.7, sa: 1017.3,
          sf: 747.4, nu: 2.88, ff: 1.9, e2: 4.4, inel: [5e4, 1.5], cu: 1.0,
          res: [[0.296, 0.10, 2000, 3300]],
          rx: '²³⁹Pu + n → ²⁴⁰Pu + γ', spent: 'Pu240' },
        { key: 'Pu240', sym: 'Pu', name: 'plutonium-240', A: 240.054, sb: 1.54, sa: 289.6,
          nu: 2.9, fth: [6e5, 1.5], e2: 4.4, inel: [5e4, 1.5], cu: 0.8,
          res: [[1.056, 0.0323, 165000, 0]], rx: '²⁴⁰Pu + n → ²⁴¹Pu + γ' },
        { key: 'FP', sym: 'fp', name: 'fission products', A: 117, sb: 6, sa: 50, e2: 4.0, cu: 0.3 },
        { key: 'Cf', sym: 'Cf', name: 'californium-252', A: 252.08, sb: 11, sa: 20.4, e2: 4.5 },

        { key: 'B', sym: 'B', name: 'boron', mix: [['B10', 0.20], ['B11', 0.80]] },
        { key: 'Li', sym: 'Li', name: 'lithium', mix: [['Li6', 0.075], ['Li7', 0.925]] },
        { key: 'U', sym: 'U', name: 'uranium', mix: [['U235', 0.0072], ['U238', 0.9928]] },
        { key: 'LEU', sym: 'U', name: 'uranium', mix: [['U235', 0.04], ['U238', 0.96]] }
    ],

    sp: [null],             // index -> species; 0 is "no species"
    idx: {},                // key -> index
    el: [null], inel: [null], n2n: [null], cap: [null], fis: [null], tot: [null],

    init() {
        for (const s of this.SPECIES) {
            s.idx = this.sp.length;
            this.sp.push(s);
            this.idx[s.key] = s.idx;
        }
        for (const s of this.SPECIES) if (!s.mix) this.derive(s);
        for (const s of this.SPECIES) {
            s.spentIdx = s.spent ? this.idx[s.spent] : 0;
            if (s.mix) {
                s.mix = s.mix.map(([k, f]) => ({ sp: this.sp[this.idx[k]], f }));
                s.A = 0;
                for (const c of s.mix) s.A += c.f * c.sp.A;
            }
        }
        for (const s of this.SPECIES) if (!s.mix) this.tabulate(s);
        for (const s of this.SPECIES) if (s.mix) this.tabulateMix(s);
    },

    // Turn the table row into the constants the closed forms read. This is
    // where the thermal values get pinned: whatever the resonances contribute
    // at 0.0253 eV is subtracted, and only the remainder is carried as 1/v.
    derive(s) {
        const r = s.A / (s.A + 1);
        s.free = s.sb * r * r;              // free-atom scattering: bound * (A/(A+1))^2
        s.sf = s.sf || 0;
        s.sc = s.sa - s.sf;                 // capture alone
        s.res = s.res || [];
        s.roll = s.roll || 3e5;
        s.p = s.p || 1;
        s.epiV = s.epi === undefined ? s.free : s.epi;
        if (s.einf === undefined) {
            const x = Math.pow(2e6 / s.roll, s.p);
            s.einf = Math.max(0, (s.e2 * (1 + x) - s.epiV) / x);
        }
        if (s.fit) {
            // One resonance explains the whole thermal value: solve its peak.
            let unit = 0;
            for (const q of s.res) unit += q[2] * this.bw(this.E_TH, q[0], q[1]);
            const k = s.sc / unit;
            for (const q of s.res) q[2] *= k;
            s.c1v = 0; s.f1v = s.sf;
        } else {
            let ct = 0, ft = 0;
            for (const q of s.res) {
                const b = this.bw(this.E_TH, q[0], q[1]);
                ct += q[2] * b; ft += q[3] * b;
            }
            // A set of peaks that overshoots the measured thermal value is
            // wrong, not the measurement: scale the peaks down to fit under it.
            if (ct > 0.95 * s.sc && ct > 0) { const k = 0.95 * s.sc / ct; for (const q of s.res) q[2] *= k; ct *= k; }
            if (ft > 0.95 * s.sf && ft > 0) { const k = 0.95 * s.sf / ft; for (const q of s.res) q[3] *= k; ft *= k; }
            s.c1v = s.sc - ct; s.f1v = s.sf - ft;
        }
    },

    // ---- Closed forms ----

    // Single-level Breit-Wigner with its 1/v factor, normalised to 1 at E0.
    // The 1/v factor is what makes a resonance's low-energy tail look like a
    // 1/v cross section, and is why indium's 194 b at thermal is nothing but
    // the tail of a peak sitting at 1.46 eV.
    bw(E, E0, G) {
        const h = G * G / 4, d = E - E0;
        return Math.sqrt(E0 / E) * h / (d * d + h);
    },

    sw(E, Eu) { return E * E / (E * E + Eu * Eu); },

    capture(s, E) {
        let v = s.c1v * Math.sqrt(this.E_TH / E);
        for (const q of s.res) v += q[2] * this.bw(E, q[0], q[1]);
        if (s.cu) v += s.cu * Math.pow(E / 1e4, -0.6) * this.sw(E, 80);
        return v;
    },

    fission(s, E) {
        let v = s.f1v * Math.sqrt(this.E_TH / E);
        for (const q of s.res) v += q[3] * this.bw(E, q[0], q[1]);
        if (s.ff) v += s.ff * (1 + Math.sqrt(3e4 / E)) * this.sw(E, 50);
        if (s.fth) {
            // Threshold fission ramps in rather than switching on, or a
            // fission spectrum centred near the threshold would see a step.
            const t = (E - 0.6 * s.fth[0]) / (0.8 * s.fth[0]);
            if (t > 0) v += s.fth[1] * (t >= 1 ? 1 : t * t * (3 - 2 * t));
        }
        return v;
    },

    // A neutron near thermal energy is not hitting a nucleus at rest: the
    // target is moving about as fast as it is, and the closing speed is what
    // counts. This is the free-gas factor, and it is why SCATTERING rises as a
    // neutron slows too, not only absorption. It is 1 by a few eV.
    freeGas(A, E) {
        const a2 = A * E / this.KT;
        if (a2 > 30) return 1;
        const a = Math.sqrt(a2);
        return (1 + 0.5 / a2) * this.erf(a) + Math.exp(-a2) / (a * 1.7724539);
    },

    erf(x) {
        const t = 1 / (1 + 0.3275911 * x);
        const y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
        return 1 - y * Math.exp(-x * x);
    },

    elastic(s, E) {
        let v = s.einf + (s.epiV - s.einf) / (1 + Math.pow(E / s.roll, s.p));
        if (s.epi !== undefined && s.res.length) {
            // Scattering peaks with the resonance as well; shape it the same.
            const q = s.res[0], h = q[1] * q[1] / 4;
            const L = E0 => h / ((E0 - q[0]) * (E0 - q[0]) + h);
            v += (s.free - s.epiV) * L(E) / L(this.E_TH);
        }
        return v * this.freeGas(s.A, E);
    },

    inelastic(s, E) { return s.inel && E > s.inel[0] ? s.inel[1] * (1 - s.inel[0] / E) : 0; },
    n2nXs(s, E) { return s.n2n && E > s.n2n[0] ? s.n2n[1] * (1 - s.n2n[0] / E) : 0; },

    nuAt(s, E) { return (s.nu || 2.5) + 0.13 * E * 1e-6; },

    // ---- Tables ----

    energyOf(g) { return Math.pow(10, this.LOG_MIN + (g + 0.5) / this.PER_DEC); },

    tabulate(s) {
        const NG = this.NG, SUB = this.SUB;
        const el = new Float32Array(NG), inel = new Float32Array(NG), n2n = new Float32Array(NG);
        const cap = new Float32Array(NG), fis = new Float32Array(NG), tot = new Float32Array(NG);
        for (let g = 0; g < NG; g++) {
            const Ec = this.energyOf(g);
            let c = 0, f = 0;
            for (let k = 0; k < SUB; k++) {
                const E = Math.pow(10, this.LOG_MIN + (g + (k + 0.5) / SUB) / this.PER_DEC);
                c += this.capture(s, E); f += this.fission(s, E);
            }
            cap[g] = c / SUB; fis[g] = f / SUB;
            el[g] = this.elastic(s, Ec);
            inel[g] = this.inelastic(s, Ec);
            n2n[g] = this.n2nXs(s, Ec);
            tot[g] = el[g] + inel[g] + n2n[g] + cap[g] + fis[g];
        }
        const i = s.idx;
        this.el[i] = el; this.inel[i] = inel; this.n2n[i] = n2n;
        this.cap[i] = cap; this.fis[i] = fis; this.tot[i] = tot;
    },

    tabulateMix(s) {
        const NG = this.NG, i = s.idx;
        for (const name of ['el', 'inel', 'n2n', 'cap', 'fis', 'tot']) {
            const out = new Float32Array(NG);
            for (const c of s.mix) {
                const src = this[name][c.sp.idx];
                for (let g = 0; g < NG; g++) out[g] += c.f * src[g];
            }
            this[name][i] = out;
        }
    },

    // Bin for an energy. Outside the table it clamps, which is right at both
    // ends: below the floor a neutron is cold, above the ceiling there are none.
    group(E) {
        const g = ((Math.log10(E) - this.LOG_MIN) * this.PER_DEC) | 0;
        return g < 0 ? 0 : g >= this.NG ? this.NG - 1 : g;
    },

    // ---- Sampling ----

    // Prompt fission spectrum: a Maxwellian at 1.32 MeV, mean 1.98 MeV. The
    // three-uniform form is the standard exact sampler for it.
    sampleFission(rnd) {
        const c = Math.cos(1.5707963 * rnd());
        return -1.32e6 * (Math.log(1 - rnd() * 0.999999) + Math.log(1 - rnd() * 0.999999) * c * c);
    },

    // A thermalised neutron is drawn from the moderator's own distribution —
    // it is in equilibrium with the material, not sliding toward zero. This is
    // the flux-weighted Maxwellian, mean 2 kT, so thermal neutrons hover around
    // 0.05 eV and are scattered UP as often as down.
    sampleThermal(rnd) {
        const E = -this.KT * Math.log((1 - rnd() * 0.999999) * (1 - rnd() * 0.999999));
        return E < 2e-4 ? 2e-4 : E;
    },

    // ---- Readouts ----

    kms(E) { return 13.83 * Math.sqrt(E); },       // true speed, km/s

    fmtE(E) {
        if (!(E > 0)) return '—';
        if (E < 1) return E.toFixed(3) + ' eV';
        if (E < 1e3) return E.toPrecision(3) + ' eV';
        if (E < 1e6) return (E / 1e3).toPrecision(3) + ' keV';
        return (E / 1e6).toPrecision(3) + ' MeV';
    },

    fmtKms(E) {
        const v = this.kms(E);
        return (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + ' km/s';
    },

    fmtLen(cm) {
        if (!isFinite(cm)) return '∞';
        if (cm >= 100) return (cm / 100).toPrecision(3) + ' m';
        if (cm >= 1) return cm.toPrecision(3) + ' cm';
        if (cm >= 0.1) return (cm * 10).toPrecision(2) + ' mm';
        if (cm >= 1e-4) return Math.round(cm * 1e4) + ' µm';
        return (cm * 1e4).toPrecision(2) + ' µm';
    }
};

nuc.init();
