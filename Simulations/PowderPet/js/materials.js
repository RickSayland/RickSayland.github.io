// materials.js -- the material table.
//
// Everything a material does is a row in TABLE. A new material is one more
// row, plus an `update` function only if it reacts with its neighbours; the
// automaton, the heat field, the radiation transport, the save file and the
// sandbox palette all read the same row and need no other edit.
//
// A row has three unrelated groups of properties and all three matter:
//   how it behaves as sand   state, density, life
//   how it carries heat      cond, cool
//   what radiation does      mu (per cell, per radiation column), branching
//                            ratios, and for the unstable ones a decay scheme

import { CFG, RT } from './config.js';

export const STATE = Object.freeze({ EMPTY: 0, SOLID: 1, POWDER: 2, LIQUID: 3, GAS: 4 });
const { EMPTY, SOLID, POWDER, LIQUID, GAS } = STATE;

const SEC = CFG.SIM.HZ;     // ticks per second, for lifetimes written in seconds

// ---- reactions -------------------------------------------------------------
// An update function receives the grid API and the index of its own cell,
// AFTER that cell has moved for the tick. It may change its own cell and its
// four neighbours.

function updWater(g, i) {
    if (g.temp[i] > CFG.GRID.BOIL) { g.morph(i, MAT.STEAM); return; }
    // Slow evaporation from an open surface. With the drain this is what
    // stops a tank that is watered every few minutes from filling up.
    if (i >= g.W && g.mat[i - g.W] === 0 && g.rnd() < CFG.GRID.EVAP_CHANCE) g.setCell(i, 0);
}

function updActWater(g, i) {
    if (g.temp[i] > CFG.GRID.BOIL) g.morph(i, MAT.STEAM);
}

function updSteam(g, i) {
    if (g.temp[i] < CFG.GRID.CONDENSE && g.rnd() < 0.15) g.morph(i, MAT.WATER);
}

function updWaste(g, i) {
    // dissolves in water: any wet neighbour is enough
    const W = g.W, m = g.mat;
    if (m[i - 1] === MAT.WATER || m[i + 1] === MAT.WATER ||
        m[i - W] === MAT.WATER || m[i + W] === MAT.WATER) {
        if (g.rnd() < CFG.GRID.WASTE_DISSOLVE) g.setCell(i, 0);
    }
}

// ---- the table ---------------------------------------------------------------
// mu: [alpha, beta, gamma, fast neutron, thermal neutron], per cell of path.
// gAbs / bAbs: chance a gamma / beta interaction is an absorption rather than
//              a scatter.
// nFast / nTherm: branching for a neutron interaction. `fis` + `abs` are
//              probabilities; the remainder is an elastic scatter, and for a
//              fast neutron `therm` is the chance that scatter thermalises it.
// act:         { p, to } -- chance an ABSORBED neutron activates the cell.
// fission:     { nu3, spent, to } -- nu3 is the chance of three neutrons
//              rather than two; `spent` the chance the cell burns out.
// decay:       { half, emit: [[type, chance, count]], heat, transmute, to,
//                neutron } -- `half` is the gameplay half-life of one decay
//              EVENT in seconds; each event has `transmute` chance of turning
//              the cell into `to`. So the cell itself has an effective
//              half-life of half / transmute, which is what a save file
//              fast-forwards with.
// life:        { min, max, to } in seconds: the cell ages into `to`.

const ORGANIC_MU = [3.0, 0.7, 0.035, 0.20, 0.30];
const ORGANIC_NF = { abs: 0.01, therm: 0.35 };
const ORGANIC_NT = { abs: 0.02 };

const TABLE = [
    {
        name: 'EMPTY', label: 'Erase', state: EMPTY, density: 0, cond: 0.09, cool: 0.03,
        color: [9, 11, 19], vary: 0,
        mu: [0.30, 0.02, 0.0004, 0.0004, 0.001], gAbs: 0.2, bAbs: 0.5,
        nFast: { abs: 0, therm: 0.02 }, nTherm: { abs: 0 },
    },
    {
        name: 'WALL', label: 'Wall', state: SOLID, density: 99, cond: 0.05, cool: 0.002,
        color: [72, 78, 96], vary: 9, tab: 'basic',
        mu: [4.0, 1.2, 0.10, 0.06, 0.10], gAbs: 0.45, bAbs: 0.8,
        nFast: { abs: 0.02, therm: 0.06 }, nTherm: { abs: 0.03 },
    },
    {
        name: 'SAND', label: 'Sand', state: POWDER, density: 1.6, cond: 0.10, cool: 0.0008,
        color: [201, 174, 116], vary: 16, tab: 'basic',
        mu: [3.5, 0.9, 0.05, 0.05, 0.09], gAbs: 0.4, bAbs: 0.75,
        nFast: { abs: 0.02, therm: 0.08 }, nTherm: { abs: 0.04 },
        act: { p: 0.5, to: 'ACT_SAND' },
    },
    {
        name: 'WATER', label: 'Water', state: LIQUID, density: 1.0, cond: 0.2, cool: 0.0012,
        color: [52, 110, 214], vary: 10, tab: 'basic',
        // Hydrogen: a neutron loses most of its energy in a couple of
        // collisions, so water is the moderator. It also captures a little.
        mu: [3.0, 0.7, 0.03, 0.30, 0.45], gAbs: 0.35, bAbs: 0.7,
        nFast: { abs: 0.003, therm: 0.45 }, nTherm: { abs: 0.0035 },
        act: { p: 0.5, to: 'ACT_WATER' },
        update: updWater,
    },
    {
        name: 'STEAM', label: 'Steam', state: GAS, density: 0.001, cond: 0.08, cool: 0.004,
        color: [176, 190, 214], vary: 14, tab: 'basic',
        mu: [0.5, 0.03, 0.001, 0.012, 0.018], gAbs: 0.3, bAbs: 0.6,
        nFast: { abs: 0.004, therm: 0.45 }, nTherm: { abs: 0.012 },
        update: updSteam,
    },
    {
        name: 'FOOD', label: 'Food', state: POWDER, density: 1.2, cond: 0.08, cool: 0.001,
        color: [236, 150, 62], vary: 22, tab: 'basic',
        mu: ORGANIC_MU, gAbs: 0.35, bAbs: 0.7, nFast: ORGANIC_NF, nTherm: ORGANIC_NT,
        life: { min: 120, max: 200, to: 'WASTE' },
    },
    {
        name: 'WASTE', label: 'Waste', state: POWDER, density: 1.3, cond: 0.08, cool: 0.001,
        color: [104, 78, 46], vary: 14, tab: 'basic',
        mu: ORGANIC_MU, gAbs: 0.35, bAbs: 0.7, nFast: ORGANIC_NF, nTherm: ORGANIC_NT,
        update: updWaste,
    },
    {
        // The egg. Static while it is an egg; hatching swaps every cell for
        // SHELL_BITS, which is the same stuff as a powder.
        name: 'SHELL', label: 'Shell', state: SOLID, density: 90, cond: 0.06, cool: 0.001,
        color: [232, 224, 202], vary: 8,
        mu: [4.0, 1.0, 0.05, 0.05, 0.08], gAbs: 0.4, bAbs: 0.75,
        nFast: { abs: 0.02, therm: 0.06 }, nTherm: { abs: 0.05 },
    },
    {
        name: 'SHELL_BITS', label: 'Shell bits', state: POWDER, density: 1.4, cond: 0.06, cool: 0.001,
        color: [224, 214, 188], vary: 14, tab: 'tissue',
        mu: [4.0, 1.0, 0.05, 0.05, 0.08], gAbs: 0.4, bAbs: 0.75,
        nFast: { abs: 0.02, therm: 0.06 }, nTherm: { abs: 0.05 },
        life: { min: 25, max: 70, to: 'EMPTY' },      // crumbles to dust
    },
    {
        name: 'MEAT', label: 'Meat', state: POWDER, density: 1.25, cond: 0.1, cool: 0.001,
        color: [196, 84, 92], vary: 20, tab: 'tissue',
        mu: ORGANIC_MU, gAbs: 0.35, bAbs: 0.7, nFast: ORGANIC_NF, nTherm: ORGANIC_NT,
        life: { min: 70, max: 150, to: 'WASTE' },
    },
    {
        name: 'BLOOD', label: 'Blood', state: LIQUID, density: 1.05, cond: 0.18, cool: 0.0012,
        color: [156, 18, 30], vary: 16, tab: 'tissue',
        mu: ORGANIC_MU, gAbs: 0.35, bAbs: 0.7, nFast: ORGANIC_NF, nTherm: ORGANIC_NT,
        life: { min: 45, max: 95, to: 'WASTE' },
    },
    {
        // Never decays. Whatever dies in the tank leaves a skeleton in the
        // sand for every later generation to walk over.
        name: 'BONE', label: 'Bone', state: POWDER, density: 1.9, cond: 0.08, cool: 0.001,
        color: [228, 222, 200], vary: 12, tab: 'tissue',
        mu: [4.0, 1.0, 0.06, 0.08, 0.12], gAbs: 0.4, bAbs: 0.75,
        nFast: { abs: 0.02, therm: 0.1 }, nTherm: { abs: 0.04 },
    },
    {
        name: 'RADIUM', label: 'Radium', state: POWDER, density: 2.4, cond: 0.12, cool: 0.0008,
        color: [170, 226, 176], vary: 18, tab: 'nuclear', hot: true,
        mu: [2.6, 1.5, 0.25, 0.03, 0.04], gAbs: 0.6, bAbs: 0.8,
        nFast: { abs: 0.02, therm: 0.01 }, nTherm: { abs: 0.05 },
        decay: {
            half: 5, heat: 0.6, transmute: 0.004, to: 'LEAD',
            emit: [[RT.ALPHA, 1.0, 1], [RT.GAMMA, 0.55, 1]],
        },
    },
    {
        name: 'POLONIUM', label: 'Polonium', state: POWDER, density: 2.6, cond: 0.12, cool: 0.0008,
        color: [150, 186, 220], vary: 18, tab: 'nuclear', hot: true,
        mu: [2.6, 1.5, 0.25, 0.03, 0.04], gAbs: 0.6, bAbs: 0.8,
        nFast: { abs: 0.02, therm: 0.01 }, nTherm: { abs: 0.05 },
        decay: {
            half: 0.8, heat: 2.2, transmute: 0.01, to: 'LEAD',
            emit: [[RT.ALPHA, 1.0, 2]],
        },
    },
    {
        // Fissile, but only usefully so for THERMAL neutrons: a fast neutron
        // in uranium is far likelier to be captured than to cause a fission,
        // so a dry heap of any size stays subcritical and the same heap under
        // water does not.
        name: 'URANIUM', label: 'Uranium', state: POWDER, density: 3.0, cond: 0.14, cool: 0.0008,
        color: [92, 112, 74], vary: 16, tab: 'nuclear', hot: true,
        mu: [2.8, 2.0, 0.40, 0.14, 0.90], gAbs: 0.7, bAbs: 0.85,
        nFast: { fis: 0.03, abs: 0.07, therm: 0 }, nTherm: { fis: 0.80, abs: 0.14 },
        fission: { nu3: 0.62, spent: 0.01, to: 'SPENT_FUEL' },
        decay: {
            half: 25, heat: 0.1, transmute: 0, to: null,
            emit: [[RT.ALPHA, 0.6, 1], [RT.NEUTRON, 0.03, 1]],
        },
    },
    {
        // Fissions readily on fast neutrons too, so it needs no moderator and
        // has a bare critical size.
        name: 'PLUTONIUM', label: 'Plutonium', state: POWDER, density: 3.2, cond: 0.14, cool: 0.0008,
        color: [124, 104, 118], vary: 16, tab: 'nuclear', hot: true,
        mu: [2.8, 2.0, 0.40, 0.26, 1.0], gAbs: 0.7, bAbs: 0.85,
        nFast: { fis: 0.22, abs: 0.05, therm: 0 }, nTherm: { fis: 0.80, abs: 0.15 },
        fission: { nu3: 0.9, spent: 0.012, to: 'SPENT_FUEL' },
        decay: {
            half: 10, heat: 0.4, transmute: 0, to: null,
            emit: [[RT.ALPHA, 1.0, 1], [RT.NEUTRON, 0.07, 1]],
        },
    },
    {
        // Fission products: not fissile, a thermal neutron poison, and by far
        // the most intensely radioactive thing in the tank.
        name: 'SPENT_FUEL', label: 'Spent fuel', state: POWDER, density: 2.9, cond: 0.14, cool: 0.0008,
        color: [70, 50, 56], vary: 14, tab: 'nuclear', hot: true,
        mu: [2.8, 2.0, 0.40, 0.10, 0.50], gAbs: 0.7, bAbs: 0.85,
        nFast: { abs: 0.15, therm: 0 }, nTherm: { abs: 0.6 },
        decay: {
            half: 1.2, heat: 1.5, transmute: 0.003, to: 'SAND',
            emit: [[RT.BETA, 1.0, 1], [RT.GAMMA, 0.9, 1]],
        },
    },
    {
        name: 'LEAD', label: 'Lead', state: POWDER, density: 3.6, cond: 0.16, cool: 0.0008,
        color: [98, 104, 122], vary: 10, tab: 'nuclear',
        // Dense, so it stops gammas and betas. Heavy nuclei barely slow a
        // neutron, so it is a poor neutron shield.
        mu: [4.0, 3.0, 0.60, 0.03, 0.03], gAbs: 0.85, bAbs: 0.95,
        nFast: { abs: 0.01, therm: 0.01 }, nTherm: { abs: 0.02 },
    },
    {
        name: 'ABSORBER', label: 'Absorber', state: SOLID, density: 95, cond: 0.1, cool: 0.001,
        color: [38, 130, 120], vary: 8, tab: 'nuclear',
        // A control rod: paint it in to shut a pile down, erase it to pull it.
        mu: [4.0, 1.0, 0.06, 0.25, 1.6], gAbs: 0.4, bAbs: 0.75,
        nFast: { abs: 0.5, therm: 0.1 }, nTherm: { abs: 0.98 },
    },
    {
        name: 'ACT_SAND', label: 'Activated sand', state: POWDER, density: 1.6, cond: 0.10, cool: 0.0008,
        color: [214, 188, 104], vary: 16, hot: true,
        mu: [3.5, 0.9, 0.05, 0.05, 0.09], gAbs: 0.4, bAbs: 0.75,
        nFast: { abs: 0.02, therm: 0.08 }, nTherm: { abs: 0.07 },
        decay: {
            half: 6, heat: 0.05, transmute: 0.05, to: 'SAND',
            emit: [[RT.BETA, 0.7, 1], [RT.GAMMA, 0.5, 1]],
        },
    },
    {
        name: 'ACT_WATER', label: 'Activated water', state: LIQUID, density: 1.0, cond: 0.2, cool: 0.0012,
        color: [70, 150, 214], vary: 12, hot: true,
        mu: [3.0, 0.7, 0.03, 0.30, 0.45], gAbs: 0.35, bAbs: 0.7,
        nFast: { abs: 0.004, therm: 0.45 }, nTherm: { abs: 0.012 },
        decay: {
            half: 4, heat: 0.05, transmute: 0.1, to: 'WATER',
            emit: [[RT.GAMMA, 1.0, 1]],
        },
        update: updActWater,
    },
    {
        // Reserved: cells the living animal currently occupies. Solid to the
        // automaton, transparent to the creature's own collision, and what
        // the radiation transport sees as tissue.
        name: 'BODY', label: 'Body', state: SOLID, density: 98, cond: 0, cool: 0,
        color: [200, 120, 150], vary: 0,
        mu: [3.0, 0.45, 0.03, 0.20, 0.30], gAbs: 0.4, bAbs: 0.8,
        nFast: { abs: 0.03, therm: 0.35 }, nTherm: { abs: 0.06 },
    },
];

// ---- compiled form -----------------------------------------------------------
// The hot loops never touch the objects above. Everything is flattened into
// typed arrays indexed by material id.

export const MAT_COUNT = TABLE.length;
export const MAT = {};
export const MAT_NAMES = [];
export const MAT_LABELS = [];
for (let i = 0; i < MAT_COUNT; i++) {
    MAT[TABLE[i].name] = i;
    MAT_NAMES.push(TABLE[i].name);
    MAT_LABELS.push(TABLE[i].label || TABLE[i].name);
}
Object.freeze(MAT);

const NONE = 255;
export const M_NONE = NONE;

export const M_STATE = new Uint8Array(MAT_COUNT);
export const M_DENSITY = new Float32Array(MAT_COUNT);
export const M_COND = new Float32Array(MAT_COUNT);
export const M_COOL = new Float32Array(MAT_COUNT);
export const M_MU = new Float32Array(MAT_COUNT * 5);
export const M_GABS = new Float32Array(MAT_COUNT);
export const M_BABS = new Float32Array(MAT_COUNT);
export const M_NF_FIS = new Float32Array(MAT_COUNT);
export const M_NF_ABS = new Float32Array(MAT_COUNT);
export const M_NF_THERM = new Float32Array(MAT_COUNT);
export const M_NT_FIS = new Float32Array(MAT_COUNT);
export const M_NT_ABS = new Float32Array(MAT_COUNT);
export const M_ACT_P = new Float32Array(MAT_COUNT);
export const M_ACT_TO = new Uint8Array(MAT_COUNT).fill(NONE);
export const M_FIS_NU3 = new Float32Array(MAT_COUNT);
export const M_FIS_SPENT = new Float32Array(MAT_COUNT);
export const M_FIS_TO = new Uint8Array(MAT_COUNT).fill(NONE);
export const M_DECAY_P = new Float32Array(MAT_COUNT);      // per tick
export const M_DECAY_HALF = new Float32Array(MAT_COUNT);   // seconds, per event
export const M_DECAY_TRANSMUTE = new Float32Array(MAT_COUNT);
export const M_DECAY_TO = new Uint8Array(MAT_COUNT).fill(NONE);
export const M_DECAY_HEAT = new Float32Array(MAT_COUNT);
export const M_DECAY_EMIT = new Array(MAT_COUNT).fill(null);   // [[type, chance, count], ...]
export const M_LIFE_MIN = new Uint16Array(MAT_COUNT);      // ticks
export const M_LIFE_SPAN = new Uint16Array(MAT_COUNT);
export const M_LIFE_TO = new Uint8Array(MAT_COUNT).fill(NONE);
export const M_UPDATE = new Array(MAT_COUNT).fill(null);
export const M_HOT = new Uint8Array(MAT_COUNT);            // radioactive powder: sticks, is swallowed
export const M_SOLID_TO_BODY = new Uint8Array(MAT_COUNT);  // the soft body collides with it
export const M_DISPLACEABLE = new Uint8Array(MAT_COUNT);   // the rasteriser may push it aside
export const M_BASE_RGB = new Uint8Array(MAT_COUNT * 3);
export const PALETTE = new Uint32Array(MAT_COUNT * 8);     // 8 noise shades each, ABGR

const clampLife = (s) => Math.max(1, Math.min(65535, Math.round(s * SEC)));

for (let i = 0; i < MAT_COUNT; i++) {
    const t = TABLE[i];
    M_STATE[i] = t.state;
    M_DENSITY[i] = t.density;
    M_COND[i] = t.cond;
    M_COOL[i] = t.cool;
    for (let c = 0; c < 5; c++) M_MU[i * 5 + c] = t.mu[c];
    M_GABS[i] = t.gAbs;
    M_BABS[i] = t.bAbs;
    M_NF_FIS[i] = t.nFast.fis || 0;
    M_NF_ABS[i] = t.nFast.abs || 0;
    M_NF_THERM[i] = t.nFast.therm || 0;
    M_NT_FIS[i] = t.nTherm.fis || 0;
    M_NT_ABS[i] = t.nTherm.abs || 0;
    if (t.act) { M_ACT_P[i] = t.act.p; M_ACT_TO[i] = MAT[t.act.to]; }
    if (t.fission) {
        M_FIS_NU3[i] = t.fission.nu3;
        M_FIS_SPENT[i] = t.fission.spent;
        M_FIS_TO[i] = MAT[t.fission.to];
    }
    if (t.decay) {
        // Radioactive decay is memoryless, so the chance of an event in one
        // tick of length dt is p = 1 - 2^(-dt / T_half).
        M_DECAY_HALF[i] = t.decay.half;
        M_DECAY_P[i] = 1 - Math.pow(2, -(1 / SEC) / t.decay.half);
        M_DECAY_TRANSMUTE[i] = t.decay.transmute;
        M_DECAY_TO[i] = t.decay.to ? MAT[t.decay.to] : NONE;
        M_DECAY_HEAT[i] = t.decay.heat;
        M_DECAY_EMIT[i] = t.decay.emit;
    }
    if (t.life) {
        M_LIFE_MIN[i] = clampLife(t.life.min);
        M_LIFE_SPAN[i] = Math.max(1, clampLife(t.life.max) - clampLife(t.life.min));
        M_LIFE_TO[i] = MAT[t.life.to];
    }
    M_UPDATE[i] = t.update || null;
    M_HOT[i] = t.hot && t.state === POWDER ? 1 : 0;
    M_SOLID_TO_BODY[i] = (t.state === SOLID || t.state === POWDER) && t.name !== 'BODY' ? 1 : 0;
    M_DISPLACEABLE[i] = (t.state === POWDER || t.state === LIQUID || t.state === GAS) ? 1 : 0;
    M_BASE_RGB[i * 3] = t.color[0]; M_BASE_RGB[i * 3 + 1] = t.color[1]; M_BASE_RGB[i * 3 + 2] = t.color[2];
    for (let s = 0; s < 8; s++) {
        const k = t.vary * ((s / 7) * 2 - 1);
        const r = Math.max(0, Math.min(255, Math.round(t.color[0] + k)));
        const g = Math.max(0, Math.min(255, Math.round(t.color[1] + k)));
        const b = Math.max(0, Math.min(255, Math.round(t.color[2] + k * 0.8)));
        PALETTE[i * 8 + s] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
}

// The effective half-life of a CELL (not of one decay event): each event
// transmutes with chance c, events arrive at rate ln2 / T, so the cell
// survives a time t with probability 2^(-t c / T). Infinity if it never
// transmutes.
export function cellHalfLife(m) {
    if (M_DECAY_TO[m] === NONE || M_DECAY_TRANSMUTE[m] <= 0) return Infinity;
    return M_DECAY_HALF[m] / M_DECAY_TRANSMUTE[m];
}

// Sandbox palette, grouped the way the picker tabs show it.
export const PALETTE_TABS = { basic: [MAT.EMPTY], nuclear: [], tissue: [] };
for (let i = 0; i < MAT_COUNT; i++) {
    const tab = TABLE[i].tab;
    if (tab) PALETTE_TABS[tab].push(i);
}

export function rgbCss(m) {
    return `rgb(${M_BASE_RGB[m * 3]},${M_BASE_RGB[m * 3 + 1]},${M_BASE_RGB[m * 3 + 2]})`;
}
