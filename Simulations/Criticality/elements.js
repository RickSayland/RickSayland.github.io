// ============ CRITICALITY — MATERIAL REGISTRY ============
// One element id per cell, GutSim style. Every element carries two unrelated
// sets of properties and both matter: how it behaves as sand (phase, bulk
// density, melting point) and what it is made of (nuclide composition, from
// which the cross-section tables, the spontaneous-fission rate, the specific
// activity and the gamma field all fall out).
//
// A CELL IS ONE CENTIMETRE, so a cell of dust is a real gram count and a
// checkerboard of fuel and water is a real 1 cm lattice. Nothing in here
// parameterises heterogeneity: a lump of dust is optically thick at a
// resonance peak, delta tracking puts the collision at its surface, and
// resonance self-shielding therefore comes out of the transport instead of
// out of a fudge factor. That is the whole reason a solution and a lattice of
// the same atoms behave differently here.
//
// Powder densities are BULK — packing fraction is already in them, which is
// why a heap of uranium dust needs several times the mass of the solid sphere
// to reach criticality. Critical mass scales roughly as 1/density squared.

const elements = {

    list: [],            // index -> element
    byKey: {},

    // Bands the cross-section tables are rebuilt on. Doppler broadening is a
    // sqrt(T) effect, so bands get wider as it gets hotter.
    TEMP_BANDS: [293, 400, 600, 900, 1400, 2200, 3600, 6000],

    def(e) {
        e.id = this.list.length;
        this.list.push(e);
        this.byKey[e.key] = e;
        return e;
    },

    init() {
        const N = nuclear.idx;

        // ---- helpers ----
        // atoms: relative atom counts per formula unit. Number densities come
        // out in atoms per barn-cm so Sigma = N * sigma with no conversions.
        const compFromAtoms = (atoms, bulk, mMolOverride) => {
            let mMol = 0;
            for (const k in atoms) mMol += atoms[k] * nuclear.NUC[N[k]].M;
            if (mMolOverride) mMol = mMolOverride;
            const nMol = bulk / mMol * nuclear.AVOGADRO;
            const comp = [];
            for (const k in atoms) comp.push({ n: N[k], N: atoms[k] * nMol, key: k });
            comp.mMol = mMol;
            return comp;
        };

        const compFromN = (Ns) => {
            const comp = [];
            for (const k in Ns) comp.push({ n: N[k], N: Ns[k], key: k });
            return comp;
        };

        // ---- the registry ----
        // phase:  gas | powder | liquid | solid
        // bulk:   g/cm3 as placed (powders are bulk, not theoretical density)
        // heat:   J/(g K)
        // melt/boil: K, with the element each one turns into
        // expand: linear thermal expansion, 1/K. Mass per cell is the
        //         conserved quantity and density is derived from it, so a
        //         heated cell genuinely thins out even though the grid cannot
        //         let it swell. At 500 K of rise that is under a percent of
        //         radius — below a pixel, and it is what quenches a burst.
        const E = [
            { key: 'AIR', name: 'Air', phase: 'gas', bulk: 0.0012, heat: 1.0,
              color: [11, 13, 20], empty: true },

            { key: 'STEAM', name: 'Steam', phase: 'gas', bulk: 0.006, heat: 2.0,
              atoms: { H1: 2, O16: 1 }, color: [120, 132, 150], alpha: 0.5,
              condense: { below: 372, to: 'WATER' } },

            { key: 'VAPOR', name: 'Fuel vapour', phase: 'gas', bulk: 0.04, heat: 0.15,
              atoms: { U235: 0.5, U238: 0.5 }, color: [150, 120, 190], alpha: 0.6 },

            // ---- fissile ----
            { key: 'HEU_DUST', name: 'HEU dust (93%)', phase: 'powder', bulk: 10.5, heat: 0.116,
              atoms: { U235: 0.93, U238: 0.07 }, expand: 13.9e-6,
              melt: 1405, meltTo: 'HEU_MELT', dissolves: 'URANYL',
              color: [92, 96, 88], grain: 12, group: 'fissile',
              blurb: 'Highly enriched uranium powder. Bulk density is half the solid, so it needs several times the sphere’s mass.' },

            { key: 'HEU_METAL', name: 'HEU metal', phase: 'solid', bulk: 19.1, heat: 0.116,
              atoms: { U235: 0.93, U238: 0.07 }, expand: 13.9e-6,
              melt: 1405, meltTo: 'HEU_MELT',
              color: [132, 136, 128], grain: 5, group: 'fissile',
              blurb: 'Solid metal. A bare sphere goes critical near 8.7 cm radius — about 52 kg.' },

            { key: 'HEU_MELT', name: 'Molten uranium', phase: 'liquid', bulk: 17.9, heat: 0.16,
              atoms: { U235: 0.93, U238: 0.07 },
              freeze: { below: 1400, to: 'HEU_METAL' }, boil: 4404, boilTo: 'VAPOR',
              color: [220, 130, 60], grain: 14, glow: true },

            { key: 'PU_DUST', name: 'Pu dust (WG)', phase: 'powder', bulk: 10.5, heat: 0.13,
              atoms: { Pu239: 0.94, Pu240: 0.06 }, expand: 46e-6,
              melt: 913, meltTo: 'PU_MELT', dissolves: 'PU_SOL',
              color: [104, 92, 84], grain: 12, group: 'fissile',
              blurb: 'Weapons-grade plutonium powder. 6% Pu-240 makes it its own neutron source — no starter needed.' },

            { key: 'PU_METAL', name: 'Pu metal', phase: 'solid', bulk: 19.86, heat: 0.13,
              atoms: { Pu239: 0.94, Pu240: 0.06 }, expand: 46e-6,
              melt: 913, meltTo: 'PU_MELT',
              color: [146, 132, 118], grain: 5, group: 'fissile',
              blurb: 'Bare sphere critical near 5.2 cm radius, about 10 kg. With a good reflector, half that.' },

            { key: 'PU_MELT', name: 'Molten plutonium', phase: 'liquid', bulk: 16.6, heat: 0.17,
              atoms: { Pu239: 0.94, Pu240: 0.06 },
              freeze: { below: 900, to: 'PU_METAL' }, boil: 3505, boilTo: 'VAPOR',
              color: [230, 140, 70], grain: 14, glow: true },

            { key: 'NATU_DUST', name: 'Natural U dust', phase: 'powder', bulk: 10.5, heat: 0.116,
              atoms: { U235: 0.0072, U238: 0.9928 }, expand: 13.9e-6,
              melt: 1405, meltTo: 'HEU_MELT',
              color: [96, 92, 74], grain: 12, group: 'fissile',
              blurb: 'Yellowcake-grade. 0.7% U-235: no pile of it, of any size or shape, will ever go critical dry.' },

            { key: 'NATU_METAL', name: 'Natural U lump', phase: 'solid', bulk: 19.1, heat: 0.116,
              atoms: { U235: 0.0072, U238: 0.9928 }, expand: 13.9e-6,
              melt: 1405, meltTo: 'HEU_MELT',
              color: [112, 106, 84], grain: 5, group: 'fissile',
              blurb: 'Unenriched metal. Useless on its own at any size; in lumps, in enough graphite, it was the first reactor.' },

            { key: 'DU_DUST', name: 'Depleted U dust', phase: 'powder', bulk: 10.5, heat: 0.116,
              atoms: { U235: 0.002, U238: 0.998 }, expand: 13.9e-6,
              melt: 1405, meltTo: 'HEU_MELT',
              color: [84, 82, 72], grain: 12, group: 'reflector',
              blurb: 'Fertile, not fissile. Dense enough to be an excellent tamper, and it fast-fissions a little.' },

            { key: 'DU_METAL', name: 'Depleted U plate', phase: 'solid', bulk: 19.1, heat: 0.116,
              atoms: { U235: 0.002, U238: 0.998 }, expand: 13.9e-6,
              melt: 1405, meltTo: 'HEU_MELT',
              color: [110, 108, 96], grain: 5, group: 'reflector' },

            // ---- reflectors and moderators ----
            { key: 'BE_DUST', name: 'Beryllium dust', phase: 'powder', bulk: 1.05, heat: 1.82,
              atoms: { Be9: 1 }, melt: 1560, color: [150, 152, 140], grain: 14, group: 'reflector' },

            { key: 'BE_BLOCK', name: 'Beryllium block', phase: 'solid', bulk: 1.85, heat: 1.82,
              atoms: { Be9: 1 }, melt: 1560, color: [178, 182, 172], grain: 6, group: 'reflector',
              blurb: 'Scatters neutrons back and multiplies them above 1.85 MeV. The 1946 accident used two hemispheres of it.' },

            { key: 'GR_DUST', name: 'Graphite dust', phase: 'powder', bulk: 1.0, heat: 0.71,
              atoms: { C12: 1 }, color: [46, 46, 50], grain: 10, group: 'moderator' },

            { key: 'GR_BLOCK', name: 'Graphite block', phase: 'solid', bulk: 1.7, heat: 0.71,
              atoms: { C12: 1 }, color: [62, 62, 68], grain: 5, group: 'moderator',
              blurb: 'Slows neutrons over ~100 collisions and absorbs almost none of them. CP-1 was 45,000 blocks of it.' },

            { key: 'WC_DUST', name: 'Tungsten carbide dust', phase: 'powder', bulk: 8.5, heat: 0.2,
              atoms: { W184: 1, C12: 1 }, color: [78, 72, 68], grain: 10, group: 'reflector' },

            { key: 'WC_BRICK', name: 'Tungsten carbide brick', phase: 'solid', bulk: 15.6, heat: 0.2,
              atoms: { W184: 1, C12: 1 }, color: [96, 88, 82], grain: 5, group: 'reflector',
              blurb: 'Dense, heavy-element reflector. A stack of these bricks caused the 1945 accident.' },

            { key: 'WATER', name: 'Water', phase: 'liquid', bulk: 1.0, heat: 4.18,
              atoms: { H1: 2, O16: 1 }, boil: 373, boilTo: 'STEAM',
              color: [58, 96, 150], grain: 10, alpha: 0.82, group: 'moderator',
              blurb: 'The best moderator per centimetre there is, a fine reflector, and the most common way a safe pile of fuel stops being safe.' },

            // ---- absorbers and shielding ----
            { key: 'B4C_DUST', name: 'Boron carbide dust', phase: 'powder', bulk: 1.5, heat: 0.95,
              atoms: { B10: 3.18, C12: 1 }, mMol: 55.25,
              color: [58, 52, 70], grain: 12, group: 'absorber',
              blurb: 'Boron-10 eats thermal neutrons at 3,840 barns. This is the off switch.' },

            { key: 'PB_DUST', name: 'Lead dust', phase: 'powder', bulk: 6.5, heat: 0.128,
              atoms: { Pb: 1 }, melt: 600, color: [78, 82, 92], grain: 10, group: 'shield' },

            { key: 'PB_BRICK', name: 'Lead brick', phase: 'solid', bulk: 11.34, heat: 0.128,
              atoms: { Pb: 1 }, melt: 600, color: [104, 110, 124], grain: 5, group: 'shield',
              blurb: 'Stops gammas and does almost nothing to neutrons — the mistake that shielding gets wrong most often.' },

            { key: 'STEEL', name: 'Steel wall', phase: 'solid', bulk: 7.8, heat: 0.49,
              atoms: { Fe56: 1 }, melt: 1700, color: [96, 100, 108], grain: 5, group: 'structure',
              blurb: 'Holds things in. Also a middling reflector, which is why tank geometry is a criticality control.' },

            // ---- solutions: the same atoms, stirred ----
            { key: 'URANYL', name: 'Uranyl nitrate (20%)', phase: 'liquid', bulk: 1.55, heat: 3.5,
              N: { U235: 2.05e-4, U238: 8.10e-4, H1: 0.0568, O16: 0.0350 },
              boil: 373, boilTo: 'HEU_DUST',
              color: [150, 168, 60], grain: 12, alpha: 0.85, group: 'liquid',
              blurb: 'Fuel dissolved in its own moderator at H/U ≈ 56. A few litres of this in the wrong vessel is the classic accident.' },

            { key: 'PU_SOL', name: 'Plutonium nitrate', phase: 'liquid', bulk: 1.5, heat: 3.5,
              N: { Pu239: 5.4e-4, Pu240: 3.4e-5, H1: 0.0580, O16: 0.0355 },
              boil: 373, boilTo: 'PU_DUST',
              color: [130, 120, 170], grain: 12, alpha: 0.85, group: 'liquid' },

            // ---- decay-only sources, for the radioactivity half ----
            { key: 'FP_DUST', name: 'Fission debris', phase: 'powder', bulk: 8.0, heat: 0.3,
              atoms: { FP: 1 }, color: [120, 84, 58], grain: 12, group: 'source',
              fpPerGram: 2.6e18,   // fissions' worth of inventory per gram, one year cooled
              fpAge: 3.15e7,
              blurb: 'What is left after fission. No chain reaction in it at all, and the most dangerous thing on the bench.' },

            { key: 'CO60_DUST', name: 'Cobalt-60 dust', phase: 'powder', bulk: 4.4, heat: 0.42,
              atoms: { Fe56: 1 }, color: [126, 96, 120], grain: 12, group: 'source',
              specActOverride: 4.19e13, gammaKOverride: 351, decayMeV: 2.82,
              blurb: 'A pure gamma source — no fission, no criticality. One gram reads 15 Sv/h at a metre.' },

            { key: 'CS137_DUST', name: 'Caesium-137 dust', phase: 'powder', bulk: 4.0, heat: 0.24,
              atoms: { Fe56: 1 }, color: [120, 112, 92], grain: 12, group: 'source',
              specActOverride: 3.2e12, gammaKOverride: 92, decayMeV: 1.17,
              blurb: 'Thirty-year half-life, penetrating gamma. The reason a fission accident’s contamination outlives everyone involved.' }
        ];

        for (const e of E) {
            e.comp = e.N ? compFromN(e.N) : compFromAtoms(e.atoms || {}, e.bulk, e.mMol);
            e.massG = e.bulk;                       // grams in a 1 cm cell
            e.phaseSolid = e.phase === 'solid';
            e.phasePowder = e.phase === 'powder';
            e.phaseLiquid = e.phase === 'liquid';
            e.phaseGas = e.phase === 'gas';
            e.expand = e.expand || 0;
            e.alpha = e.alpha === undefined ? 1 : e.alpha;

            // Weight fractions, then everything radiological per cell.
            let mTot = 0;
            for (const c of e.comp) mTot += c.N * nuclear.NUC[c.n].M;
            e.spontN = 0; e.activity = 0; e.gammaField = 0; e.decayW = 0;
            e.fissileN = 0;
            for (const c of e.comp) {
                const nuc = nuclear.NUC[c.n];
                const grams = mTot > 0 ? e.massG * (c.N * nuc.M) / mTot : 0;
                e.spontN += grams * (nuc.spontN || 0);
                const bq = grams * (nuc.specAct || 0);
                e.activity += bq;
                e.gammaField += bq * 1e-9 * (nuc.gammaK || 0);   // uSv/h at 1 m
                if (nuc.sf_th > 1 || nuc.fissThresh) {
                    e.fissileN += c.N;
                    e.heavyG = (e.heavyG || 0) + grams;              // all actinide
                    if (nuc.sf_th > 1) e.fissG = (e.fissG || 0) + grams;   // fissile only
                }
            }
            // Mass of actinide, not of the stuff it is dissolved in. A tank of
            // uranyl nitrate weighs far more than the uranium in it, and it is
            // the uranium that the limit is written against.
            e.heavyFrac = (e.heavyG || 0) / e.massG;
            // Enrichment, so a depleted-uranium tamper is not reported as
            // fissile material. It is a hundred kilos of uranium and none of
            // it is the point.
            e.enrich = e.heavyG > 0 ? (e.fissG || 0) / e.heavyG : 0;
            if (e.specActOverride) {
                e.activity = e.massG * e.specActOverride;
                e.gammaField = e.activity * 1e-9 * (e.gammaKOverride || 0);
            }
            // Self-heating from its own decay. Plutonium comes out at 1.9 mW
            // per gram, which is why a pit is warm to the touch.
            const meanMeV = e.decayMeV || 5.1;
            e.decayW = e.activity * meanMeV * nuclear.MEV;

            this.def(e);
        }

        this.AIR = this.byKey.AIR.id;
        this.tabulateAll();
    },

    // One table per element per temperature band. Density changes are a scalar
    // on the table, so this runs at boot and never again.
    tabulateAll() {
        for (const e of this.list) {
            e.tables = this.TEMP_BANDS.map(T => nuclear.tabulate(e.comp, T));
            e.maj = 0;
            for (const t of e.tables) if (t.maj > e.maj) e.maj = t.maj;
        }
        // The delta-tracking majorant has to bound every material the neutron
        // could possibly meet, at any energy, at any temperature. One number
        // for the whole world: sample a flight from it, and accept a real
        // collision with probability Sigma_t/maj.
        this.majorant = 0;
        for (const e of this.list) if (e.maj > this.majorant) this.majorant = e.maj;
    },

    band(temp) {
        const b = this.TEMP_BANDS;
        for (let i = b.length - 1; i > 0; i--) if (temp >= b[i]) return i;
        return 0;
    },

    // Groups, for the palette. Order is the order they appear on screen.
    GROUPS: [
        { key: 'fissile',   name: 'Fissile' },
        { key: 'reflector', name: 'Reflector / tamper' },
        { key: 'moderator', name: 'Moderator' },
        { key: 'absorber',  name: 'Absorber' },
        { key: 'shield',    name: 'Shielding' },
        { key: 'structure', name: 'Structure' },
        { key: 'liquid',    name: 'Solutions' },
        { key: 'source',    name: 'Decay sources' }
    ]
};

elements.init();
