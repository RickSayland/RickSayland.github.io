// save.js -- persistence. localStorage only; there is no server.
//
// One versioned JSON blob holds the whole tank: the grid (run-length
// encoded), the temperature field, the energy particles in flight, the full
// state of the animal down to per-particle dose, the dormant egg, and a
// timestamp. A blob written by a different SAVE_VERSION is discarded rather
// than migrated.
//
// Loading is not just reading back. The tab may have been closed for a
// weekend, so the time since the timestamp is fast-forwarded -- analytically
// wherever that is possible, rather than by running the simulation.

import { CFG, SAVE_VERSION, VERSION, STAGE } from './config.js';
import { W, H, N, mat, temp, noise, life, state as gridState, setCell, morph, rnd, wallBorder } from './grid.js';
import { MAT, MAT_COUNT, M_NONE, M_LIFE_TO, M_DECAY_TO, cellHalfLife } from './materials.js';
import * as rad from './radiation.js';
import * as heat from './heat.js';
import { Creature, Egg } from './creature.js';
import { sourceHalfLife } from './coupling.js';

const S = CFG.SAVE;
const AMBIENT = CFG.GRID.AMBIENT;
const TEMP_BIAS = 4000;

const store = (() => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
})();

// ---- encoding ------------------------------------------------------------------
function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
function fromB64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

// Run-length encoding. A tank is mostly long runs of nothing and of sand, so
// 30,000 cells usually come down to a few hundred (value, run) pairs.
function rle8(src) {
    const out = [];
    for (let i = 0; i < src.length;) {
        const v = src[i];
        let n = 1;
        while (i + n < src.length && src[i + n] === v && n < 255) n++;
        out.push(v, n);
        i += n;
    }
    return toB64(Uint8Array.from(out));
}
function unrle8(str, dst) {
    const b = fromB64(str);
    let o = 0;
    for (let i = 0; i + 1 < b.length; i += 2) {
        const v = b[i];
        for (let n = b[i + 1]; n > 0 && o < dst.length; n--) dst[o++] = v;
    }
    return o === dst.length;
}
function rle16(src, quant) {
    const out = [];
    for (let i = 0; i < src.length;) {
        const v = quant ? quant(src[i]) : src[i];
        let n = 1;
        while (i + n < src.length && (quant ? quant(src[i + n]) : src[i + n]) === v && n < 65535) n++;
        out.push(v & 255, v >> 8, n & 255, n >> 8);
        i += n;
    }
    return toB64(Uint8Array.from(out));
}
function unrle16(str, dst, dequant) {
    const b = fromB64(str);
    let o = 0;
    for (let i = 0; i + 3 < b.length; i += 4) {
        const v = b[i] | (b[i + 1] << 8);
        const val = dequant ? dequant(v) : v;
        for (let n = b[i + 2] | (b[i + 3] << 8); n > 0 && o < dst.length; n--) dst[o++] = val;
    }
    return o === dst.length;
}
const quantT = (t) => Math.max(0, Math.min(65535, Math.round((t - AMBIENT) / S.TEMP_STEP) + TEMP_BIAS));
const dequantT = (q) => AMBIENT + (q - TEMP_BIAS) * S.TEMP_STEP;

// ---- save ----------------------------------------------------------------------
export function serializeWorld(world) {
    const c = world.creature;
    const half = sourceHalfLife();
    return {
        v: SAVE_VERSION, app: VERSION, time: Date.now(),
        w: W, h: H, tick: gridState.tick,
        mat: rle8(mat),
        temp: rle16(temp, quantT),
        life: rle16(life),
        rad: rad.serialize(),
        creature: c && !c.dead ? c.serialize() : null,
        egg: world.egg ? world.egg.serialize() : null,
        lights: world.lights,
        generation: world.generation,
        srcHalf: Number.isFinite(half) ? half : null,
    };
}

export function saveWorld(world) {
    if (!store) return false;
    try {
        store.setItem(S.KEY, JSON.stringify(serializeWorld(world)));
        return true;
    } catch (e) {
        return false;       // quota, private mode: the toy carries on unsaved
    }
}

export function loadSave() {
    if (!store) return null;
    try {
        const raw = store.getItem(S.KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        // versioned: anything this build did not write is discarded
        if (!d || d.v !== SAVE_VERSION || d.w !== W || d.h !== H) { store.removeItem(S.KEY); return null; }
        return d;
    } catch (e) { return null; }
}

export function clearSave() { if (store) { try { store.removeItem(S.KEY); } catch (e) { /* nothing to do */ } } }

// ---- restore -------------------------------------------------------------------
// Returns the number of seconds that were fast-forwarded, or -1 if the blob
// could not be used.
export function restoreWorld(d, world, now = Date.now()) {
    try {
        if (!unrle8(d.mat, mat)) return -1;
        if (!unrle16(d.temp, temp, dequantT)) return -1;
        if (!unrle16(d.life, life)) return -1;
    } catch (e) { return -1; }
    for (let i = 0; i < N; i++) {
        noise[i] = (rnd() * 256) | 0;
        // The body and the eggshell are redrawn from their owners on the
        // first tick; what was saved of them is only their footprint.
        if (mat[i] === MAT.BODY || mat[i] === MAT.SHELL || mat[i] >= MAT_COUNT) { mat[i] = 0; life[i] = 0; }
    }
    wallBorder();
    gridState.tick = d.tick || 0;
    rad.deserialize(d.rad);
    world.lights = d.lights !== false;
    world.generation = d.generation || 1;
    world.creature = d.creature ? Creature.deserialize(d.creature) : null;
    world.egg = d.egg ? Egg.deserialize(d.egg) : null;
    world.ball = null;

    const elapsed = Math.max(0, (now - (d.time || now)) / 1000);
    if (elapsed > 2) fastForward(world, elapsed, d);
    return elapsed;
}

// Catch the tank up on `t` seconds without simulating them.
export function fastForward(world, t, d) {
    const ticks = t * CFG.SIM.HZ;
    // -- the grid
    for (let i = 0; i < N; i++) {
        const m = mat[i];
        if (m === 0) continue;
        // Radioactive cells decay analytically. A cell with half-life T
        // survives a time t with probability 2^(-t/T); the rest become
        // their daughter. (T here is the half-life of the CELL, which is the
        // event half-life divided by the chance each event transmutes.)
        const half = cellHalfLife(m);
        if (Number.isFinite(half) && rnd() > Math.pow(2, -t / half)) { morph(i, M_DECAY_TO[m]); continue; }
        // things that age: food spoils, meat rots, blood dries
        if (M_LIFE_TO[m] !== M_NONE) {
            if (life[i] <= ticks) setCell(i, M_LIFE_TO[m]);
            else life[i] -= ticks;
        }
    }
    heat.relax(t);
    if (t > 3) rad.clear();

    // -- the animal
    const c = world.creature;
    if (c && !c.dead && c.stage !== STAGE.EGG) {
        const ST = CFG.STATS, F = ST.OFFLINE_FLOOR, s = c.stats;
        // Stats decay at their usual rates but never past a floor: nothing
        // that only happened while the tab was closed is allowed to kill.
        const decay = (v, rate, floor) => Math.max(Math.min(v, floor), v - rate * t);
        s.hunger = decay(s.hunger, ST.HUNGER_RATE * c.phen.metabolism, F.hunger);
        s.happiness = decay(s.happiness, ST.HAPPY_RATE, F.happiness);
        if (c.sleeping || !world.lights) s.energy = Math.min(100, s.energy + ST.ENERGY_SLEEP * t);
        else s.energy = decay(s.energy, ST.ENERGY_RATE, F.energy);
        // (health is left alone: it only ever falls because something is
        // wrong, and nothing that only went wrong offline is allowed to count)
        c.age = Math.min(c.phen.lifespan * 0.999, c.age + Math.min(t, ST.OFFLINE_AGE_CAP));
        c.eggCooldown = Math.max(0, c.eggCooldown - t);
        c.medicineCooldown = Math.max(0, c.medicineCooldown - t);
        c.healBoost = 0;

        // Dose. The animal was sitting in whatever field it was in when the
        // tab closed, and that field has been dying away with the sources
        // that made it: dose += rate * integral_0^t 2^(-u/T) du
        //                     = rate * (T / ln 2) * (1 - 2^(-t/T)).
        // The exposure counted is capped, on the grounds that a living
        // animal would have walked off.
        const rate = d && typeof d.creature?.doseRate === 'number' ? d.creature.doseRate : c.doseRate;
        if (rate > 1e-4) {
            const te = Math.min(t, CFG.DOSE.OFFLINE_CAP);
            const T = d && d.srcHalf ? d.srcHalf : Infinity;
            const integral = Number.isFinite(T) ? (T / Math.LN2) * (1 - Math.pow(2, -te / T)) : te;
            const add = rate * integral;
            const b = c.body;
            for (let i = 0; i < b.n; i++) if (b.on[i]) b.dose[i] += add;
            c.doseRate = Number.isFinite(T) ? rate * Math.pow(2, -t / T) : rate;
        }
        // tissue relaxes to its own comfort temperature rather than staying
        // wherever it was a day ago
        if (t > 30) { const b = c.body; for (let i = 0; i < b.n; i++) b.temp[i] = c.phen.comfort; }
        c.measure();
    }
    // An incubating egg keeps incubating, but stops just short: hatching is
    // worth being there for.
    const e = world.egg;
    if (e && e.incubating) e.progress = Math.min(0.97, e.progress + t / CFG.EGG.INCUBATE);
}

// ---- lineage and preferences -----------------------------------------------------
export function loadLineage() {
    if (!store) return [];
    try {
        const d = JSON.parse(store.getItem(S.LINEAGE_KEY) || '[]');
        return Array.isArray(d) ? d : [];
    } catch (e) { return []; }
}
export function saveLineage(list) {
    if (!store) return;
    try { store.setItem(S.LINEAGE_KEY, JSON.stringify(list.slice(-CFG.GENETICS.LINEAGE_MAX))); } catch (e) { /* unsaved */ }
}
export function loadPrefs() {
    if (!store) return {};
    try { return JSON.parse(store.getItem(S.PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
}
export function savePrefs(p) {
    if (!store) return;
    try { store.setItem(S.PREFS_KEY, JSON.stringify(p)); } catch (e) { /* unsaved */ }
}
