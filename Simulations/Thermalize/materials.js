// ============ THERMALIZE — MATERIAL REGISTRY ============
// One material id per cell. A CELL IS ONE CENTIMETRE and holds exactly one
// drawn formula unit: an atom of iron, a molecule of water. That drawn atom
// stands for the ~10^22 real ones in a cubic centimetre, and the whole
// simulation hangs on the one rule that makes the stand-in honest:
//
//     a nucleus is drawn as a disc whose WIDTH is N * sigma * (1 cm)^2
//
// with N the real number density. A straight line crossing a field of such
// discs meets them at a rate of N * sigma per centimetre — which is the
// macroscopic cross section. So the mean free path is not a number anywhere in
// here. It is what the lattice you are looking at does to a ray, and when the
// discs grow because the neutron slowed down, it is shorter.
//
// Every material carries two unrelated sets of properties and both matter:
// how it behaves as sand (phase, density) and what it is made of (the slots).

const materials = {

    list: [null],           // id -> material; 0 is empty bench
    byKey: {},
    phase: null,            // id -> 0 solid, 1 powder, 2 liquid, 3 gas
    dens: null,             // id -> g/cm3, for what sinks through what
    rise: null,             // id -> -1 a gas that rises, +1 one that pools
    emit: null,             // id -> neutrons per second per cell

    AVOGADRO: 0.6022,       // rho/M * this -> formula units per barn-cm
    AIR: 0.0012,

    GROUPS: [
        { key: 'moderator', name: 'Moderators' },
        { key: 'absorber', name: 'Absorbers' },
        { key: 'structure', name: 'Structure and shielding' },
        { key: 'fuel', name: 'Fuel' },
        { key: 'source', name: 'Sources' }
    ],

    // slots: the nuclei drawn in the cell, each [species, real atoms it stands
    // for per formula unit]. layout says where they sit:
    //   atom  one nucleus                tri  bent, like H-O-H
    //   lin   three in a line, O-Si-O    ch2  a chain link, H above and below
    DEFS: [
        { key: 'WATER', name: 'Water', formula: 'H₂O', group: 'moderator', phase: 'liquid',
          rho: 1.00, M: 18.015, slots: [['O', 1], ['H1', 1], ['H1', 1]], layout: 'tri',
          color: [52, 104, 170],
          blurb: 'Hydrogen weighs the same as a neutron, so one square hit can take everything. About 18 collisions from 2 MeV to thermal — and it eats a few neutrons itself.' },
        { key: 'HEAVY', name: 'Heavy water', formula: 'D₂O', group: 'moderator', phase: 'liquid',
          rho: 1.105, M: 20.028, slots: [['O', 1], ['H2', 1], ['H2', 1]], layout: 'tri',
          color: [84, 84, 176],
          blurb: 'Deuterium is twice the mass, so it takes more collisions, but it captures 600 times less than hydrogen. Slower to moderate, almost free of losses.' },
        { key: 'POLY', name: 'Polyethylene', formula: 'CH₂', group: 'moderator', phase: 'solid',
          rho: 0.94, M: 14.027, slots: [['C', 1], ['H1', 1], ['H1', 1]], layout: 'ch2',
          color: [150, 160, 172],
          blurb: 'Solid hydrogen, near enough. More hydrogen per centimetre than water, and it stays where you put it.' },
        { key: 'GRAPHITE', name: 'Graphite', formula: 'C', group: 'moderator', phase: 'solid',
          rho: 1.70, M: 12.011, slots: [['C', 1]], color: [74, 76, 86],
          blurb: 'Carbon takes at most 28% of a neutron’s energy per hit, so it needs over a hundred of them — and a lot of room. It absorbs almost nothing.' },
        { key: 'GRDUST', name: 'Graphite dust', formula: 'C', group: 'moderator', phase: 'powder',
          rho: 1.00, M: 12.011, slots: [['C', 1]], color: [56, 58, 66],
          blurb: 'The same carbon, loosely packed. Fewer atoms per centimetre, so the same collisions take more distance.' },
        { key: 'BE', name: 'Beryllium', formula: 'Be', group: 'moderator', phase: 'solid',
          rho: 1.85, M: 9.012, slots: [['Be9', 1]], color: [146, 166, 150],
          blurb: 'Light, dense in atoms, and above 1.85 MeV a hit can knock a second neutron loose.' },

        { key: 'BORON', name: 'Boron', formula: 'B', group: 'absorber', phase: 'solid',
          rho: 2.34, M: 10.81, slots: [['B', 1]], color: [128, 92, 60],
          blurb: 'The textbook 1/v absorber: 767 barns at thermal, falling smoothly as the square root of energy. A fast neutron barely notices it.' },
        { key: 'BPOWDER', name: 'Boron powder', formula: 'B', group: 'absorber', phase: 'powder',
          rho: 1.40, M: 10.81, slots: [['B', 1]], color: [112, 82, 58],
          blurb: 'Pours into the gaps. Each capture ends in an alpha particle and lithium, not a gamma ray.' },
        { key: 'B10', name: 'Boron-10 powder', formula: '¹⁰B', group: 'absorber', phase: 'powder',
          rho: 1.30, M: 10.013, slots: [['B10', 1]], color: [150, 84, 50],
          blurb: 'Natural boron is only a fifth boron-10, and that fifth does all the absorbing: 3,835 barns.' },
        { key: 'CD', name: 'Cadmium', formula: 'Cd', group: 'absorber', phase: 'solid',
          rho: 8.65, M: 112.411, slots: [['Cd', 1]], color: [150, 164, 186],
          blurb: 'Black below about half an electron-volt, nearly clear above it. Not 1/v at all — one resonance at 0.178 eV does the whole job.' },
        { key: 'GD', name: 'Gadolinium', formula: 'Gd', group: 'absorber', phase: 'solid',
          rho: 7.90, M: 157.25, slots: [['Gd', 1]], color: [176, 174, 150],
          blurb: 'The largest thermal cross section of any stable element: 49,700 barns. It is all gone by 1 eV.' },
        { key: 'HF', name: 'Hafnium', formula: 'Hf', group: 'absorber', phase: 'solid',
          rho: 13.31, M: 178.49, slots: [['Hf', 1]], color: [140, 150, 164],
          blurb: 'A stack of resonances just above thermal, and capturing a neutron leaves another absorbing hafnium. It does not get used up.' },
        { key: 'IN', name: 'Indium', formula: 'In', group: 'absorber', phase: 'solid',
          rho: 7.31, M: 114.818, slots: [['In', 1]], color: [164, 164, 196],
          blurb: 'One enormous resonance at 1.46 eV. Indium foil is how you count neutrons of exactly that energy.' },
        { key: 'AG', name: 'Silver', formula: 'Ag', group: 'absorber', phase: 'solid',
          rho: 10.49, M: 107.868, slots: [['Ag', 1]], color: [192, 198, 204],
          blurb: 'A modest thermal absorber with a strong resonance at 5.2 eV.' },
        { key: 'AU', name: 'Gold', formula: 'Au', group: 'absorber', phase: 'solid',
          rho: 19.30, M: 196.967, slots: [['Au', 1]], color: [214, 176, 58],
          blurb: 'The standard activation foil. Its 4.9 eV resonance peaks above 30,000 barns.' },
        { key: 'LI', name: 'Lithium', formula: 'Li', group: 'absorber', phase: 'solid',
          rho: 0.534, M: 6.94, slots: [['Li', 1]], color: [176, 178, 190],
          blurb: 'The lithium-6 in it absorbs a neutron and splits into tritium and an alpha. No gamma ray at all.' },
        { key: 'HG', name: 'Mercury', formula: 'Hg', group: 'absorber', phase: 'liquid',
          rho: 13.53, M: 200.59, slots: [['Hg', 1]], color: [166, 172, 184],
          blurb: 'A liquid metal that absorbs: 372 barns. Heavy enough that water floats on it.' },
        { key: 'HE3', name: 'Helium-3', formula: '³He', group: 'absorber', phase: 'gas',
          rho: 1.25e-4, M: 3.016, slots: [['He3', 1]], color: [96, 140, 160],
          blurb: 'A gas with 5,333 barns. Thin as it is, a tube of it is the classic neutron detector.' },
        { key: 'XE135', name: 'Xenon-135', formula: '¹³⁵Xe', group: 'absorber', phase: 'gas',
          rho: 5.6e-3, M: 134.907, slots: [['Xe135', 1]], color: [156, 96, 178],
          blurb: 'A fission product with 2.65 million barns — a gas at atmospheric pressure that stops thermal neutrons like a wall.' },

        { key: 'AL', name: 'Aluminium', formula: 'Al', group: 'structure', phase: 'solid',
          rho: 2.70, M: 26.982, slots: [['Al', 1]], color: [168, 176, 186],
          blurb: 'Nearly invisible to neutrons at every energy. Good for holding things without getting in the way.' },
        { key: 'FE', name: 'Iron', formula: 'Fe', group: 'structure', phase: 'solid',
          rho: 7.87, M: 55.845, slots: [['Fe', 1]], color: [124, 112, 106],
          blurb: 'Scatters well and slows fast neutrons by inelastic collisions above 0.86 MeV. Too heavy to finish the job.' },
        { key: 'ZR', name: 'Zirconium', formula: 'Zr', group: 'structure', phase: 'solid',
          rho: 6.52, M: 91.224, slots: [['Zr', 1]], color: [152, 152, 142],
          blurb: 'Fuel cladding, chosen because 0.185 barns is about as close to not being there as a metal gets.' },
        { key: 'PB', name: 'Lead', formula: 'Pb', group: 'structure', phase: 'solid',
          rho: 11.34, M: 207.2, slots: [['Pb', 1]], color: [98, 104, 120],
          blurb: 'Stops gamma rays. Against neutrons it is a wall of billiard balls 207 times too heavy to take any energy.' },
        { key: 'SAND', name: 'Sand', formula: 'SiO₂', group: 'structure', phase: 'powder',
          rho: 1.50, M: 60.084, slots: [['Si', 1], ['O', 1], ['O', 1]], layout: 'lin',
          color: [204, 184, 132],
          blurb: 'Ordinary sand. A mediocre moderator and a poor absorber, which makes it a fair picture of concrete.' },
        { key: 'NA', name: 'Sodium (molten)', formula: 'Na', group: 'structure', phase: 'liquid',
          rho: 0.93, M: 22.990, slots: [['Na', 1]], color: [206, 194, 160],
          blurb: 'The coolant of a fast reactor, picked because it carries heat without slowing the neutrons down.' },

        { key: 'U', name: 'Uranium (natural)', formula: 'U', group: 'fuel', phase: 'solid',
          rho: 19.05, M: 238.03, slots: [['U', 1]], color: [112, 132, 96],
          blurb: 'One atom in 139 is uranium-235. The other 138 capture neutrons on the way down without fissioning.' },
        { key: 'LEU', name: 'Uranium (4%)', formula: 'U', group: 'fuel', phase: 'solid',
          rho: 19.05, M: 237.93, slots: [['LEU', 1]], color: [128, 154, 96],
          blurb: 'Reactor-grade enrichment. Only worth anything if the neutrons reach it slow.' },
        { key: 'U235', name: 'Uranium-235', formula: '²³⁵U', group: 'fuel', phase: 'solid',
          rho: 19.05, M: 235.044, slots: [['U235', 1]], color: [156, 196, 92],
          blurb: 'Fissions at any energy: 583 barns thermal, about 1.2 fast. Each fission releases two or three fast neutrons.' },
        { key: 'U238', name: 'Uranium-238', formula: '²³⁸U', group: 'fuel', phase: 'solid',
          rho: 19.05, M: 238.051, slots: [['U238', 1]], color: [100, 112, 96],
          blurb: 'Fissions only above about a million electron-volts. Below that it captures, and the capture ends as plutonium.' },
        { key: 'PU', name: 'Plutonium-239', formula: '²³⁹Pu', group: 'fuel', phase: 'solid',
          rho: 19.80, M: 239.052, slots: [['Pu239', 1]], color: [196, 124, 92],
          blurb: 'More neutrons per fission than uranium, and a resonance at 0.3 eV that makes it greedier just above thermal.' },

        { key: 'CF', name: 'Californium-252', formula: '²⁵²Cf', group: 'source', phase: 'solid',
          rho: 15.1, M: 252.08, slots: [['Cf', 1]], color: [236, 232, 120], emitRate: 1.5,
          blurb: 'Fissions on its own. A grain of it is a steady source of fast neutrons going every which way.' }
    ],

    init() {
        const n = this.DEFS.length + 1;
        this.phase = new Uint8Array(n);
        this.dens = new Float32Array(n);
        this.rise = new Int8Array(n);
        this.emit = new Float32Array(n);
        const PH = { solid: 0, powder: 1, liquid: 2, gas: 3 };

        for (const m of this.DEFS) {
            m.id = this.list.length;
            this.list.push(m);
            this.byKey[m.key] = m;

            m.ns = m.slots.length;
            m.Nfu = m.rho / m.M * this.AVOGADRO;        // formula units per barn-cm
            m.slotSp = new Uint8Array(m.ns);
            // w is the whole of the disc rule: radius = w * sigma, in cells.
            m.w = new Float64Array(m.ns);
            m.mult = new Float64Array(m.ns);
            for (let s = 0; s < m.ns; s++) {
                m.slotSp[s] = nuc.idx[m.slots[s][0]];
                m.mult[s] = m.slots[s][1];
                m.w[s] = m.Nfu * m.mult[s] / 2;
            }
            m.layout = m.layout || 'atom';
            m.crystal = m.phase === 'solid';
            m.bonded = m.ns > 1;
            // Formula units a straight centimetre passes, for the "atoms
            // passed" counter: the cube root of the number in a cubic one.
            m.perCm = Math.cbrt(m.Nfu * 1e24);

            this.phase[m.id] = PH[m.phase];
            this.dens[m.id] = m.rho;
            this.rise[m.id] = m.rho < this.AIR ? -1 : 1;
            this.emit[m.id] = m.emitRate || 0;
            m.css = 'rgb(' + m.color.join(',') + ')';
            m.bg = 'rgba(' + m.color.join(',') + ',0.16)';

            this.buildOffsets(m);
        }
    },

    // Where each nucleus sits inside its cell, for 16 variants a cell picks
    // from. A crystal uses the row's parity to stagger alternate rows by half
    // a cell, which turns a square grid into something close-packed; a powder,
    // a liquid or a gas uses the grain's own seed, which travels with it. The
    // jitter is drawn from a private generator so the table is the same every
    // load whatever else has consumed random numbers.
    buildOffsets(m) {
        const off = new Float32Array(16 * m.ns * 2);
        let s = 0x2545f491 ^ (m.id * 2654435761);
        const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) - 0.5; };
        const jit = m.phase === 'solid' ? 0.06 : m.phase === 'powder' ? 0.34 : m.phase === 'liquid' ? 0.24 : 0.7;
        for (let v = 0; v < 16; v++) {
            let cx = r() * jit, cy = r() * jit;
            let th = v / 16 * 6.2831853 + r() * 0.3;
            if (m.crystal) { cx += (v & 8) ? 0.25 : -0.25; th = 1.5707963; }
            for (let k = 0; k < m.ns; k++) {
                let ox = cx, oy = cy;
                if (k > 0) {
                    let a;
                    if (m.layout === 'tri') a = th + (k === 1 ? -0.91 : 0.91);
                    else a = th + (k === 1 ? 0 : 3.1415927);
                    const R = m.layout === 'ch2' ? 0.28 : 0.30;
                    ox += Math.cos(a) * R; oy += Math.sin(a) * R;
                }
                off[(v * m.ns + k) * 2] = ox;
                off[(v * m.ns + k) * 2 + 1] = oy;
            }
        }
        m.off = off;
    },

    // Macroscopic cross sections of a pristine cell at energy bin g, 1/cm.
    sigma(m, g, out) {
        let t = 0, c = 0, f = 0;
        for (let s = 0; s < m.ns; s++) {
            const i = m.slotSp[s], k = 2 * m.w[s];
            t += k * nuc.tot[i][g]; c += k * nuc.cap[i][g]; f += k * nuc.fis[i][g];
        }
        out.tot = t; out.cap = c; out.fis = f;
        return out;
    }
};

materials.init();
