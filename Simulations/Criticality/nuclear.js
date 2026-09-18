// ============ CRITICALITY — NUCLEAR DATA ============
// Plain scripts, so load order is the <script> order in index.html:
// nuclear → elements → grid → neutrons → render → instruments → main.
// This file is data and closed-form physics only. No DOM, and nothing in here
// changes during a run except the cross-section tables, which are rebuilt when
// a material's temperature crosses a band. Owns `nuclear`.
//
// UNITS, fixed once and never mixed:
//   energy        eV
//   cross-section barns
//   number dens.  atoms per barn-cm, so Sigma[1/cm] = N * sigma[barn] exactly
//   length        cm — and ONE CELL IS ONE CENTIMETRE, which is what lets a
//                 heap of dust on screen have a real mass and a real critical
//                 size. Mean free path in uranium metal is ~2 cm, so a neutron
//                 crosses a couple of cells between collisions: the grid is
//                 resolving transport, not standing in for it.
//   time          s
//   temperature   K

const nuclear = {

    // ---- Nuclide table ----
    //
    // Cross sections are a deliberately thin parameterisation: a thermal value
    // that runs as 1/v, a fast plateau, and (for the fertile/absorbing ones) a
    // flat resonance shelf standing in for the resolved resonance region. That
    // is enough to get every behaviour this simulation is about — thermal
    // fission, fast fission thresholds, resonance capture, moderation — and
    // nothing here pretends to be an evaluated library.
    //
    //   sf/sc/ss_th   barns at 0.0253 eV
    //   sf/sc/ss_fast barns on the fast plateau
    //   fissThresh    eV, fast-fission threshold for the even-N nuclides
    //   resC          barns of capture across resLo..resHi (resonance shelf)
    //   ss_ec         eV, where scattering rolls off the thermal value
    //   inel          inelastic scattering: above thresh, sig barns, keeps frac
    //   n2n           (n,2n): above thresh, sig barns — beryllium MAKES neutrons
    //   spontN        spontaneous-fission neutrons per second per gram
    //   specAct       Bq per gram
    //   gammaK        ambient dose rate constant, uSv/h per GBq at 1 m
    NUC: [
        { key: 'U235', A: 235, M: 235.04,
          sf_th: 585, sf_fast: 1.25, sc_th: 99, sc_fast: 0.10,
          ss_th: 15, ss_fast: 4.6, ss_ec: 1e4,
          nu0: 2.43, nuSlope: 0.065, resC: 8, resLo: 4, resHi: 2e4,
          inel: { thresh: 1e5, sig: 1.8, frac: 0.45 },
          spontN: 3e-4, specAct: 8.0e4, gammaK: 15 },

        { key: 'U238', A: 238, M: 238.05,
          sf_th: 0, sf_fast: 0.55, fissThresh: 1.2e6,
          sc_th: 2.7, sc_fast: 0.07,
          ss_th: 9, ss_fast: 5.0, ss_ec: 1e4,
          nu0: 2.55, nuSlope: 0.08, resC: 34, resLo: 5, resHi: 2e4,
          inel: { thresh: 4.5e4, sig: 2.2, frac: 0.45 },
          spontN: 0.0136, specAct: 1.24e4, gammaK: 0.5 },

        { key: 'Pu239', A: 239, M: 239.05,
          sf_th: 748, sf_fast: 1.80, sc_th: 271, sc_fast: 0.05,
          ss_th: 8, ss_fast: 4.8, ss_ec: 1e4,
          nu0: 2.88, nuSlope: 0.14, resC: 10, resLo: 4, resHi: 2e4,
          inel: { thresh: 1e5, sig: 1.6, frac: 0.45 },
          spontN: 0.022, specAct: 2.30e9, gammaK: 0.05 },

        { key: 'Pu240', A: 240, M: 240.05,
          sf_th: 0.06, sf_fast: 1.60, fissThresh: 8e5,
          sc_th: 290, sc_fast: 0.10,
          ss_th: 8, ss_fast: 4.8, ss_ec: 1e4,
          nu0: 2.8, nuSlope: 0.1, resC: 60, resLo: 1, resHi: 2e4,
          inel: { thresh: 1e5, sig: 1.6, frac: 0.45 },
          // 1020 n/s/g is the whole reason a plutonium assembly needs no
          // starter: it is already emitting a third of a million neutrons a
          // second before anyone touches it.
          spontN: 1020, specAct: 8.40e9, gammaK: 0.05 },

        { key: 'H1', A: 1, M: 1.008,
          sf_th: 0, sf_fast: 0, sc_th: 0.332, sc_fast: 1e-5,
          ss_th: 20.5, ss_fast: 3.0, ss_ec: 3e4 },

        { key: 'O16', A: 16, M: 15.999,
          sf_th: 0, sf_fast: 0, sc_th: 1.9e-4, sc_fast: 1e-5,
          ss_th: 3.8, ss_fast: 1.8, ss_ec: 1e5 },

        { key: 'C12', A: 12, M: 12.011,
          sf_th: 0, sf_fast: 0, sc_th: 0.0035, sc_fast: 1e-5,
          ss_th: 4.75, ss_fast: 2.3, ss_ec: 1e5 },

        { key: 'Be9', A: 9, M: 9.012,
          sf_th: 0, sf_fast: 0, sc_th: 0.0076, sc_fast: 1e-5,
          ss_th: 6.1, ss_fast: 3.0, ss_ec: 1e5,
          n2n: { thresh: 1.85e6, sig: 0.5 } },

        { key: 'W184', A: 184, M: 183.84,
          sf_th: 0, sf_fast: 0, sc_th: 18.3, sc_fast: 0.10,
          ss_th: 5.0, ss_fast: 4.5, ss_ec: 1e5, resC: 25, resLo: 4, resHi: 2e4 },

        { key: 'Pb', A: 207, M: 207.2,
          sf_th: 0, sf_fast: 0, sc_th: 0.17, sc_fast: 0.002,
          ss_th: 11.2, ss_fast: 5.0, ss_ec: 1e5 },

        { key: 'B10', A: 10, M: 10.013,
          sf_th: 0, sf_fast: 0, sc_th: 3840, sc_fast: 0.30,
          ss_th: 2.1, ss_fast: 2.0, ss_ec: 1e5 },

        { key: 'Fe56', A: 56, M: 55.85,
          sf_th: 0, sf_fast: 0, sc_th: 2.56, sc_fast: 0.01,
          ss_th: 11.0, ss_fast: 3.0, ss_ec: 1e5, resC: 3, resLo: 1e3, resHi: 2e4 },

        { key: 'FP', A: 100, M: 100,       // lumped fission products
          sf_th: 0, sf_fast: 0, sc_th: 50, sc_fast: 0.05,
          ss_th: 6, ss_fast: 4.0, ss_ec: 1e5, resC: 20, resLo: 4, resHi: 2e4 }
    ],

    E_TH: 0.0253,           // eV, thermal energy at 293 K
    E_MIN: 1e-3,            // eV, table floor
    E_MAX: 2e7,             // eV, table ceiling
    NG: 140,                // table points, log spaced
    AVOGADRO: 0.6022,       // g/mol -> atoms per barn-cm, for rho/M * this
    MEV: 1.602e-13,         // J per MeV
    E_FISSION: 200,         // MeV released per fission (total)
    E_PROMPT: 180,          // MeV deposited promptly and locally
    KB_EV: 8.617e-5,        // eV per K

    idx: {},                // key -> index into NUC
    lnMin: 0, invStep: 0,

    init() {
        for (let i = 0; i < this.NUC.length; i++) {
            const n = this.NUC[i];
            this.idx[n.key] = i;
            // Elastic scattering off a nucleus of mass A leaves the neutron
            // somewhere in [alpha*E, E], uniformly. alpha is zero for hydrogen,
            // which is why one collision with a proton can thermalise a
            // neutron and why 200 collisions in uranium barely dent it.
            n.alpha = ((n.A - 1) / (n.A + 1)) ** 2;
            n.resC = n.resC || 0;
        }
        this.lnMin = Math.log(this.E_MIN);
        this.invStep = (this.NG - 1) / (Math.log(this.E_MAX) - this.lnMin);
    },

    // ---- Microscopic cross sections ----

    // Capture: 1/v up from thermal, then a steeper roll-off above 1 keV onto
    // the fast plateau, plus the resonance shelf. `shield` is resonance
    // self-shielding: fuel in lumps hides its own resonances from the flux, so
    // a lattice captures far less than the same atoms stirred into a solution.
    sigC(n, E, shield) {
        let s = n.sc_th * Math.sqrt(this.E_TH / E);
        if (E > 1e3) {
            const s1 = n.sc_th * Math.sqrt(this.E_TH / 1e3);
            s = Math.max(n.sc_fast, s1 * Math.pow(1e3 / E, 0.75));
        }
        if (n.resC && E > n.resLo && E < n.resHi) s += n.resC * shield;
        return s;
    },

    sigF(n, E) {
        if (n.fissThresh) {
            // Threshold fission ramps in over half a decade rather than
            // switching on, or a 1.2 MeV fission spectrum would see a step.
            if (E < n.fissThresh * 0.5) return 0;
            const r = Math.min(1, (E - n.fissThresh * 0.5) / n.fissThresh);
            return n.sf_fast * r * r;
        }
        if (n.sf_th === 0) return 0;
        return Math.max(n.sf_fast, n.sf_th * Math.sqrt(this.E_TH / E));
    },

    sigS(n, E) {
        return n.ss_fast + (n.ss_th - n.ss_fast) / (1 + E / n.ss_ec);
    },

    sigIn(n, E) {
        return (n.inel && E > n.inel.thresh) ? n.inel.sig : 0;
    },

    sigN2n(n, E) {
        return (n.n2n && E > n.n2n.thresh) ? n.n2n.sig : 0;
    },

    // Guarded, because it is called for every nuclide while tabulating and a
    // moderator has no nu at all. Without the guard nuSf came out NaN for
    // every material containing hydrogen.
    nu(n, E) {
        return n.nu0 ? n.nu0 + n.nuSlope * E * 1e-6 : 0;
    },

    // Fast elastic scattering off a heavy nucleus is forward peaked — the
    // nucleus is several neutron wavelengths across at MeV energies and the
    // scattering is diffractive, not isotropic in the centre of mass. Treating
    // it as isotropic keeps neutrons in the assembly that should have carried
    // on outward, and it was the whole of a stubborn 15% over-reactivity:
    // bare uranium came out critical at 40 kg against a published 52.
    //
    // THIS IS THE ONE CALIBRATED NUMBER IN THE SIMULATION. FWD is trimmed so
    // the bare metal spheres land on their published critical masses; the
    // reflected, moderated and solution cases then follow from transport
    // without anything else being touched.
    FWD: 0.62,

    forwardBias(n, E) {
        if (n.A < 40 || E < 5e4) return 0;
        const f = this.FWD * (E / 2e6) * (n.A / 238);
        return f > 0.6 ? 0.6 : f;
    },

    // ---- Per-material tables ----
    //
    // A collision has to know Sigma_t, then pick a reaction, then pick which
    // nuclide it happened on. Evaluating ten nuclides per collision costs more
    // than the whole rest of the tick, so every material carries tables on a
    // log-energy grid and a collision is one log, one lerp and a lookup.
    //
    // Only Sigma scales with density, so thermal expansion, compaction and
    // boiling are a scalar on a table that does not need rebuilding. The
    // tables are rebuilt only when temperature crosses a band, because
    // Doppler broadening changes the resonance shelf's shape, not its size.
    tabulate(comp, temp) {
        const NG = this.NG, nN = comp.length;
        const t = {
            St: new Float64Array(NG), Ss: new Float64Array(NG),
            Sf: new Float64Array(NG), Sa: new Float64Array(NG),
            nuSf: new Float64Array(NG),
            // cumulative scattering Sigma per nuclide, for picking the target
            cum: new Float64Array(NG * nN),
            nuc: comp.map(c => this.NUC[c.n]),
            nN, maj: 0
        };
        // Doppler: broadening does not change the resonance integral, it
        // widens the resonances so a self-shielded lump stops hiding behind
        // them. So heat pushes `shield` back toward 1 — and that is the whole
        // negative Doppler coefficient, with no coefficient written anywhere.
        const sh0 = comp.shield === undefined ? 1 : comp.shield;
        const shield = Math.min(1, sh0 + (1 - sh0) * 0.45 * (Math.sqrt(temp / 293) - 1));

        for (let g = 0; g < NG; g++) {
            const E = Math.exp(this.lnMin + g / this.invStep);
            let St = 0, Ss = 0, Sf = 0, Sa = 0, nuSf = 0;
            for (let i = 0; i < nN; i++) {
                const n = t.nuc[i], N = comp[i].N;
                const sc = this.sigC(n, E, shield) * N;
                const sf = this.sigF(n, E) * N;
                const ss = (this.sigS(n, E) + this.sigIn(n, E) + this.sigN2n(n, E)) * N;
                Sa += sc; Sf += sf; Ss += ss;
                nuSf += sf * this.nu(n, E);
                t.cum[g * nN + i] = Ss;
            }
            St = Ss + Sa + Sf;
            t.St[g] = St; t.Ss[g] = Ss; t.Sf[g] = Sf; t.Sa[g] = Sa; t.nuSf[g] = nuSf;
            if (St > t.maj) t.maj = St;
        }
        return t;
    },

    // Table lookup. Returns the grid index; callers lerp what they need.
    // Energies outside the table clamp, which is correct at both ends: below
    // the floor a neutron is thermal, above the ceiling it does not exist.
    group(E) {
        let g = (Math.log(E) - this.lnMin) * this.invStep;
        if (g < 0) g = 0; else if (g > this.NG - 1) g = this.NG - 1;
        return g;
    },

    lerp(arr, g) {
        const i = g | 0, f = g - i;
        return f === 0 ? arr[i] : arr[i] + (arr[i + 1] - arr[i]) * f;
    },

    // ---- Sampling ----

    // Prompt fission spectrum: a Maxwellian at 1.32 MeV, mean 1.98 MeV. The
    // three-uniform form is the standard exact sampler for it.
    sampleFission(rnd) {
        const T = 1.32e6;
        const c = Math.cos(Math.PI * 0.5 * rnd());
        return -T * (Math.log(1 - rnd() * 0.999999) + Math.log(1 - rnd() * 0.999999) * c * c);
    },

    // Elastic scatter in the lab frame: energy uniform in [alpha E, E].
    scatterE(nucOrA, E, rnd) {
        const a = nucOrA.alpha;
        return E * (a + (1 - a) * rnd());
    },

    // A neutron that would scatter below the thermal floor is instead drawn
    // from the moderator's own Maxwellian: it is in equilibrium with the
    // material, not sliding to zero. This is also what makes hot water a
    // worse moderator than cold water without anything saying so.
    thermalE(temp, rnd) {
        const kT = this.KB_EV * temp;
        // Maxwell energy distribution, mean 1.5kT.
        const c = Math.cos(Math.PI * 0.5 * rnd());
        return -kT * (Math.log(1 - rnd() * 0.999999) + Math.log(1 - rnd() * 0.999999) * c * c);
    },

    // cm/s. 1 MeV is 4.6% of light speed; thermal is 2.2 km/s. The ratio is
    // why a fast system's generation time is ten nanoseconds and a thermal
    // one's is a tenth of a millisecond.
    speed(E) { return 1.383e6 * Math.sqrt(E); },

    // ---- Fission-product decay ----
    //
    // The whole inventory as a bank of exponentials whose sum reproduces the
    // t^-1.2 decay law (the same trick the ANS standard uses with 23 terms).
    // One mechanism then covers both cases: a single burst decays as t^-1.2,
    // and a pile that ran for an hour carries the right built-up tail,
    // without the two ever being able to disagree.
    DECAY_GROUPS: (() => {
        const g = [];
        const lo = -9, hi = 0.3, n = 12;          // log10 lambda, 1/s
        const dln = (hi - lo) * Math.LN10 / (n - 1);
        for (let i = 0; i < n; i++) {
            const lam = Math.pow(10, lo + (hi - lo) * i / (n - 1));
            g.push({ lam, w: Math.pow(lam, 0.2) * dln });
        }
        // Normalise so the impulse response integrates to the decay energy per
        // fission: 13 MeV of beta and gamma, 6.5% of the 200 MeV total.
        let tot = 0;
        for (const x of g) tot += x.w;
        for (const x of g) x.w *= 13 / tot;
        return g;
    })(),

    // Named nuclides, for the inventory panel. Cumulative yields are per
    // fission of U-235; gammaK is uSv/h per GBq at 1 m.
    FISSION_PRODUCTS: [
        { key: 'I-131',   yield: 0.0288, halfLife: 6.93e5,  gammaK: 66,  note: 'thyroid' },
        { key: 'Xe-133',  yield: 0.0670, halfLife: 4.53e5,  gammaK: 13,  note: 'noble gas' },
        { key: 'Xe-135',  yield: 0.0660, halfLife: 3.29e4,  gammaK: 12,  note: 'neutron poison' },
        { key: 'Ba-140',  yield: 0.0621, halfLife: 1.10e6,  gammaK: 33,  note: 'La-140 daughter' },
        { key: 'Zr-95',   yield: 0.0650, halfLife: 5.53e6,  gammaK: 110, note: 'refractory' },
        { key: 'Mo-99',   yield: 0.0611, halfLife: 2.38e5,  gammaK: 15,  note: 'Tc-99m parent' },
        { key: 'Sr-90',   yield: 0.0578, halfLife: 9.09e8,  gammaK: 0.1, note: 'bone seeker' },
        { key: 'Cs-137',  yield: 0.0619, halfLife: 9.49e8,  gammaK: 92,  note: 'the long tail' },
        { key: 'Kr-85',   yield: 0.0029, halfLife: 3.39e8,  gammaK: 0.5, note: 'noble gas' }
    ],

    // ---- Dose ----
    //
    // Fluence to ambient dose equivalent. 400 pSv per neutron per cm^2 is the
    // ICRP figure around 1 MeV; prompt fission gammas roughly match the
    // neutron dose from a bare metal assembly, so they ride along as a factor
    // rather than being transported.
    SV_PER_NCM2: 4.0e-10,
    GAMMA_SHARE: 1.0,

    init_() { /* kept so a partial load is obvious */ }
};

nuclear.init();
