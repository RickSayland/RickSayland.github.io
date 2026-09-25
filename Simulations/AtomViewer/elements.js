// ============ ATOM VIEWER — PERIODIC TABLE & ELECTRON CONFIGURATIONS ============
// Zero DOM. Owns `ELEMENTS`, `SUBSHELL_LETTERS` and `configs`.
//
// A configuration here is a list of subshells { n, l, occ }. Three rules
// produce every one of them:
//
// - **Neutral atoms fill in Madelung order** (n + l, then n), except for the
//   twenty elements whose measured ground state breaks it: Cr and Cu take a
//   4s electron into 3d, Pd empties 5s entirely, La–Gd and Ac–Cm put an
//   electron in d instead of f, and Lr puts its last one in 7p. Those are
//   listed outright rather than derived — they are measurements, not rules.
// - **Cations do not simply run the filling order backwards.** Iron fills 4s
//   before 3d but ionises from 4s first (Fe²⁺ is [Ar]3d⁶), because once the
//   charge is up the 3d shell drops below 4s. The rule used here groups ns/np
//   with (n−1)d and (n−2)f, strips the highest group first, and within a
//   group takes p, then s, then d, then f. That gives Fe²⁺, Cu⁺, Sn²⁺, Ce³⁺,
//   Gd³⁺, U³⁺ and Pb⁴⁺ right. It is a chemist's rule, not an energy
//   calculation, and for highly stripped heavy ions (where the ordering heads
//   towards hydrogen's) it will pick the wrong shell to empty.
// - **Anions add to the first unfilled subshell in Madelung order.**

const SUBSHELL_LETTERS = 'spdfghi';

const ELEMENTS = (() => {
    const raw = `H Hydrogen|He Helium|Li Lithium|Be Beryllium|B Boron|C Carbon|N Nitrogen|O Oxygen|F Fluorine|Ne Neon|
Na Sodium|Mg Magnesium|Al Aluminium|Si Silicon|P Phosphorus|S Sulfur|Cl Chlorine|Ar Argon|K Potassium|Ca Calcium|
Sc Scandium|Ti Titanium|V Vanadium|Cr Chromium|Mn Manganese|Fe Iron|Co Cobalt|Ni Nickel|Cu Copper|Zn Zinc|
Ga Gallium|Ge Germanium|As Arsenic|Se Selenium|Br Bromine|Kr Krypton|Rb Rubidium|Sr Strontium|Y Yttrium|Zr Zirconium|
Nb Niobium|Mo Molybdenum|Tc Technetium|Ru Ruthenium|Rh Rhodium|Pd Palladium|Ag Silver|Cd Cadmium|In Indium|Sn Tin|
Sb Antimony|Te Tellurium|I Iodine|Xe Xenon|Cs Caesium|Ba Barium|La Lanthanum|Ce Cerium|Pr Praseodymium|Nd Neodymium|
Pm Promethium|Sm Samarium|Eu Europium|Gd Gadolinium|Tb Terbium|Dy Dysprosium|Ho Holmium|Er Erbium|Tm Thulium|Yb Ytterbium|
Lu Lutetium|Hf Hafnium|Ta Tantalum|W Tungsten|Re Rhenium|Os Osmium|Ir Iridium|Pt Platinum|Au Gold|Hg Mercury|
Tl Thallium|Pb Lead|Bi Bismuth|Po Polonium|At Astatine|Rn Radon|Fr Francium|Ra Radium|Ac Actinium|Th Thorium|
Pa Protactinium|U Uranium|Np Neptunium|Pu Plutonium|Am Americium|Cm Curium|Bk Berkelium|Cf Californium|Es Einsteinium|Fm Fermium|
Md Mendelevium|No Nobelium|Lr Lawrencium|Rf Rutherfordium|Db Dubnium|Sg Seaborgium|Bh Bohrium|Hs Hassium|Mt Meitnerium|Ds Darmstadtium|
Rg Roentgenium|Cn Copernicium|Nh Nihonium|Fl Flerovium|Mc Moscovium|Lv Livermorium|Ts Tennessine|Og Oganesson`;
    const list = [null];
    for (const item of raw.split('|')) {
        const [sym, name] = item.trim().split(' ');
        list.push({ Z: list.length, sym, name });
    }

    const cat = {};
    const put = (c, zs) => zs.forEach(z => { cat[z] = c; });
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    put('nonmetal', [1, 6, 7, 8, 15, 16, 34]);
    put('noble', [2, 10, 18, 36, 54, 86, 118]);
    put('alkali', [3, 11, 19, 37, 55, 87]);
    put('alkaline', [4, 12, 20, 38, 56, 88]);
    put('metalloid', [5, 14, 32, 33, 51, 52]);
    put('halogen', [9, 17, 35, 53, 85, 117]);
    put('post', [13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116]);
    put('transition', [...range(21, 30), ...range(39, 48), ...range(72, 80), ...range(104, 112)]);
    put('lanthanide', range(57, 71));
    put('actinide', range(89, 103));

    // Electron affinities in eV (measured). null = not reliably measured;
    // a value <= 0 means the anion is not bound at all.
    const EA = {
        1: 0.754, 2: -1, 3: 0.618, 4: -1, 5: 0.280, 6: 1.262, 7: -0.07, 8: 1.461, 9: 3.401, 10: -1,
        11: 0.548, 12: -1, 13: 0.433, 14: 1.390, 15: 0.747, 16: 2.077, 17: 3.613, 18: -1, 19: 0.501, 20: 0.025,
        21: 0.188, 22: 0.076, 23: 0.528, 24: 0.676, 25: -1, 26: 0.153, 27: 0.662, 28: 1.156, 29: 1.236, 30: -1,
        31: 0.30, 32: 1.233, 33: 0.805, 34: 2.021, 35: 3.364, 36: -1, 37: 0.486, 38: 0.052, 39: 0.307, 40: 0.433,
        41: 0.917, 42: 0.747, 43: 0.55, 44: 1.046, 45: 1.143, 46: 0.562, 47: 1.304, 48: -1, 49: 0.384, 50: 1.112,
        51: 1.046, 52: 1.971, 53: 3.059, 54: -1, 55: 0.472, 56: 0.145, 57: 0.558, 58: 0.63, 69: 1.029, 70: -1,
        72: 0.178, 73: 0.323, 74: 0.816, 76: 1.078, 77: 1.564, 78: 2.125, 79: 2.309, 80: -1,
        81: 0.32, 82: 0.357, 83: 0.942, 85: 2.416, 86: -1, 90: 0.608,
    };

    for (let z = 1; z < list.length; z++) {
        list[z].category = cat[z] || 'unknown';
        list[z].ea = z in EA ? EA[z] : null;
    }
    return list;
})();

const configs = (() => {
    // Madelung order up to 8s — far enough for any anion of oganesson.
    const ORDER = [];
    for (let s = 1; s <= 9; s++) {
        for (let n = Math.ceil(s / 2); n <= s; n++) {
            const l = s - n;
            if (l < n && l <= 3) ORDER.push([n, l]);
        }
    }
    ORDER.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[0] - b[0]);
    const cap = l => 2 * (2 * l + 1);

    // Measured exceptions: the valence part that replaces Madelung's.
    const EXCEPTIONS = {
        24: '3d5 4s1', 29: '3d10 4s1',
        41: '4d4 5s1', 42: '4d5 5s1', 44: '4d7 5s1', 45: '4d8 5s1', 46: '4d10 5s0', 47: '4d10 5s1',
        57: '4f0 5d1 6s2', 58: '4f1 5d1 6s2', 64: '4f7 5d1 6s2', 78: '4f14 5d9 6s1', 79: '4f14 5d10 6s1',
        89: '5f0 6d1 7s2', 90: '5f0 6d2 7s2', 91: '5f2 6d1 7s2', 92: '5f3 6d1 7s2', 93: '5f4 6d1 7s2',
        96: '5f7 6d1 7s2', 103: '5f14 6d0 7s2 7p1',
    };

    const key = (n, l) => n * 10 + l;

    function madelung(N) {
        const occ = new Map();
        let left = N;
        for (const [n, l] of ORDER) {
            if (left <= 0) break;
            const k = Math.min(cap(l), left);
            occ.set(key(n, l), k);
            left -= k;
        }
        return occ;
    }

    function neutral(Z) {
        const occ = madelung(Z);
        const ex = EXCEPTIONS[Z];
        if (ex) {
            let moved = 0;
            for (const tok of ex.split(' ')) {
                const n = +tok[0], l = SUBSHELL_LETTERS.indexOf(tok[1]), k = +tok.slice(2);
                moved += k - (occ.get(key(n, l)) || 0);
                occ.set(key(n, l), k);
            }
            // Every exception conserves the electron count; anything else is a typo above.
            if (moved !== 0) throw new Error('configuration exception for Z=' + Z + ' does not conserve electrons');
        }
        return occ;
    }

    // Removal priority for cations: higher group first, then p > s > d > f.
    const RANK = [1, 0, 2, 3];
    function removalOrder(occ) {
        const shells = [...occ.keys()].filter(k => occ.get(k) > 0).map(k => [Math.floor(k / 10), k % 10]);
        shells.sort((a, b) => {
            const ga = a[0] + Math.max(0, a[1] - 1), gb = b[0] + Math.max(0, b[1] - 1);
            return gb - ga || RANK[a[1]] - RANK[b[1]];
        });
        return shells;
    }

    // The configuration of an atom with nuclear charge Z carrying N electrons.
    // Returns subshells sorted by (n, l), zero occupancies dropped.
    function build(Z, N) {
        const occ = neutral(Z);
        if (N < Z) {
            let remove = Z - N;
            while (remove > 0) {
                const [n, l] = removalOrder(occ)[0];
                const k = key(n, l);
                const take = Math.min(remove, occ.get(k));
                occ.set(k, occ.get(k) - take);
                remove -= take;
            }
        } else if (N > Z) {
            let add = N - Z;
            for (const [n, l] of ORDER) {
                if (add <= 0) break;
                const k = key(n, l), have = occ.get(k) || 0;
                const put = Math.min(cap(l) - have, add);
                if (put > 0) { occ.set(k, have + put); add -= put; }
            }
        }
        const out = [];
        for (const [k, v] of occ) if (v > 0) out.push({ n: Math.floor(k / 10), l: k % 10, occ: v });
        out.sort((a, b) => a.n - b.n || a.l - b.l);
        return out;
    }

    const NOBLE = [2, 10, 18, 36, 54, 86, 118];

    // "[Ar] 3d⁶ 4s²" — the noble-gas core is used only when the shells really
    // are that core's, so a stripped ion prints in full.
    function describe(shells, fmtSup) {
        const sup = fmtSup || (k => String(k));
        const label = s => s.n + SUBSHELL_LETTERS[s.l];
        if (!shells.length) return '(none)';
        let core = null, coreSet = null;
        const N = shells.reduce((s, x) => s + x.occ, 0);
        for (let i = NOBLE.length - 1; i >= 0; i--) {
            const Zc = NOBLE[i];
            if (Zc >= N) continue;
            const c = build(Zc, Zc);
            if (c.every(cs => shells.some(s => s.n === cs.n && s.l === cs.l && s.occ === cs.occ))) {
                core = Zc; coreSet = c; break;
            }
        }
        const parts = [];
        if (core) parts.push('[' + ELEMENTS[core].sym + ']');
        // Printed in order of n, then l — NIST's convention ([Xe] 4f¹⁴ 5d¹⁰ 6s¹).
        const rest = shells.filter(s => !coreSet || !coreSet.some(c => c.n === s.n && c.l === s.l));
        rest.sort((a, b) => a.n - b.n || a.l - b.l);
        for (const s of rest) parts.push(label(s) + sup(s.occ));
        return parts.join(' ');
    }

    return { build, neutral: Z => build(Z, Z), describe, cap };
})();
