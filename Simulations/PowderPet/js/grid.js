// grid.js -- the environment: a falling-sand cellular automaton.
//
// One material id per cell. Four arrays travel with a grain when it moves
// (material, temperature, colour noise, lifetime); `flag` belongs to the
// location and only records that something already moved into it this tick.
//
// The update visits rows bottom-to-top so a falling grain is never moved
// twice in one tick, and alternates the horizontal scan direction every tick
// so liquids do not drift to one side.

import { CFG } from './config.js';
import {
    MAT, STATE, MAT_COUNT, M_NONE, M_STATE, M_DENSITY, M_LIFE_MIN, M_LIFE_SPAN, M_LIFE_TO,
    M_UPDATE, M_DECAY_P, PALETTE,
} from './materials.js';

export const W = CFG.GRID.W;
export const H = CFG.GRID.H;
export const N = W * H;
const AMBIENT = CFG.GRID.AMBIENT;
const { POWDER, LIQUID, GAS } = STATE;

export const mat = new Uint8Array(N);
export const temp = new Float32Array(N).fill(AMBIENT);
export const noise = new Uint8Array(N);
export const life = new Uint16Array(N);
export const flag = new Uint8Array(N);
// per-material cell counts from the last step (hygiene reads WASTE from here)
export const census = new Int32Array(MAT_COUNT);

export const state = { tick: 0, emitScale: 1 };

// ---- a fast PRNG for the automaton ------------------------------------------
// xorshift32. The world is not meant to be reproducible, only cheap; anything
// that must be deterministic (a body from a genome) uses its own seeded
// generator in genome.js.
let rs = ((Date.now() ^ 0x9e3779b9) >>> 0) || 1;
export function rnd() {
    rs ^= rs << 13; rs >>>= 0;
    rs ^= rs >>> 17;
    rs ^= rs << 5; rs >>>= 0;
    return rs / 4294967296;
}
export function reseed(s) { rs = (s >>> 0) || 1; }

// ---- cell edits ----------------------------------------------------------------
function initLife(i, m) {
    life[i] = M_LIFE_TO[m] !== M_NONE ? M_LIFE_MIN[m] + ((rnd() * M_LIFE_SPAN[m]) | 0) : 0;
}

// Put a fresh grain of `m` in cell i. Temperature is left alone: it belongs
// to whatever heat was already there.
export function setCell(i, m) {
    mat[i] = m;
    noise[i] = (rnd() * 256) | 0;
    initLife(i, m);
}

// Change what a grain IS without it becoming a new grain (boiling, condensing,
// transmuting): keeps its shade.
export function morph(i, m) {
    mat[i] = m;
    initLife(i, m);
}

export function swap(i, j) {
    const m = mat[i]; mat[i] = mat[j]; mat[j] = m;
    const t = temp[i]; temp[i] = temp[j]; temp[j] = t;
    const n = noise[i]; noise[i] = noise[j]; noise[j] = n;
    const l = life[i]; life[i] = life[j]; life[j] = l;
}

export function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

// the API handed to material update functions and to the decay hook
const api = { mat, temp, noise, life, W, H, N, setCell, morph, rnd };

let decayHook = null;
export function setDecayHook(fn) { decayHook = fn; }

// ---- movement ------------------------------------------------------------------
// Density-based swapping: a grain may move into an empty cell, or change
// places with a liquid or gas lighter than itself. That one rule is what
// makes sand sink through water, blood settle under it, and steam bubble up.
function canEnter(m, j) {
    const t = mat[j];
    if (t === 0) return true;
    const ts = M_STATE[t];
    return (ts === LIQUID || ts === GAS) && M_DENSITY[m] > M_DENSITY[t];
}

function moveTo(i, j, mark) {
    swap(i, j);
    flag[j] = mark;
    return j;
}

function stepPowder(i, x, y, m, mark) {
    if (y + 1 >= H) return i;
    const below = i + W;
    if (canEnter(m, below)) return moveTo(i, below, mark);
    const d = rnd() < 0.5 ? -1 : 1;
    if (x + d >= 0 && x + d < W && canEnter(m, below + d)) return moveTo(i, below + d, mark);
    if (x - d >= 0 && x - d < W && canEnter(m, below - d)) return moveTo(i, below - d, mark);
    return i;
}

function stepLiquid(i, x, y, m, mark) {
    if (y + 1 < H) {
        const below = i + W;
        if (canEnter(m, below)) return moveTo(i, below, mark);
        const d = rnd() < 0.5 ? -1 : 1;
        if (x + d >= 0 && x + d < W && canEnter(m, below + d)) return moveTo(i, below + d, mark);
        if (x - d >= 0 && x - d < W && canEnter(m, below - d)) return moveTo(i, below - d, mark);
    }
    // Nowhere to fall: run sideways as far as there is open space, up to
    // LIQUID_SPREAD cells. Without the run a liquid levels one cell a tick
    // and a poured stream stands up like a column of sand.
    const d = rnd() < 0.5 ? -1 : 1;
    for (let pass = 0; pass < 2; pass++) {
        const dir = pass === 0 ? d : -d;
        let j = i, n = 0;
        while (n < CFG.GRID.LIQUID_SPREAD) {
            const nx = x + dir * (n + 1);
            if (nx < 0 || nx >= W || mat[j + dir] !== 0) break;
            j += dir; n++;
        }
        if (n > 0) return moveTo(i, j, mark);
    }
    return i;
}

function stepGas(i, x, y, m, mark) {
    const r = rnd();
    if (y > 0) {
        const up = i - W;
        if (mat[up] === 0 && r < 0.8) return moveTo(i, up, mark);
        const d = r < 0.5 ? -1 : 1;
        if (x + d >= 0 && x + d < W && mat[up + d] === 0) return moveTo(i, up + d, mark);
        if (x - d >= 0 && x - d < W && mat[up - d] === 0) return moveTo(i, up - d, mark);
    }
    const d = r < 0.5 ? -1 : 1;
    if (x + d >= 0 && x + d < W && mat[i + d] === 0) return moveTo(i, i + d, mark);
    return i;
}

// ---- one tick ------------------------------------------------------------------
export function step() {
    state.tick++;
    // The moved-this-tick flags are cleared every tick. A flag that outlives
    // its tick is not harmless: with a two-value mark, a grain that had ever
    // moved was skipped on every second tick for the rest of its life, and
    // everything ran at half speed -- falling, spoiling and radioactive
    // decay alike -- with nothing on screen to say so.
    flag.fill(0);
    const mark = 1;
    const ltr = (state.tick & 1) === 0;
    const emitScale = state.emitScale;
    census.fill(0);

    for (let y = H - 1; y >= 0; y--) {
        const row = y * W;
        for (let k = 0; k < W; k++) {
            const x = ltr ? k : W - 1 - k;
            let i = row + x;
            const m = mat[i];
            if (m === 0) continue;
            if (flag[i] === mark) continue;       // already moved here this tick
            census[m]++;

            const st = M_STATE[m];
            if (st === POWDER) i = stepPowder(i, x, y, m, mark);
            else if (st === LIQUID) i = stepLiquid(i, x, y, m, mark);
            else if (st === GAS) i = stepGas(i, x, y, m, mark);

            // ageing: food spoils, meat rots, blood dries
            if (M_LIFE_TO[m] !== M_NONE) {
                if (life[i] > 0) life[i]--;
                else { setCell(i, M_LIFE_TO[m]); continue; }
            }

            // radioactive decay. emitScale is the global throttle: when the
            // energy-particle pool is nearly full every source in the tank
            // is turned down together rather than frames being dropped.
            const dp = M_DECAY_P[m];
            if (dp > 0 && decayHook !== null && rnd() < dp * emitScale) {
                decayHook(i, m);
                if (mat[i] !== m) continue;
            }

            const up = M_UPDATE[m];
            if (up !== null) up(api, i);
        }
    }
    drain();
}

// The drain. Water in a sand tank sits ON the sand, never under it, so a
// drain that only looked at the bottom row would never see any. Instead a
// few random columns are sampled each tick: walk up from the floor through
// whatever powder is lying there, and if the first thing above the bed is
// water, let a cell of it seep away. A puddle drains slowly; a flood drains
// in proportion to how wide it is.
function drain() {
    const tries = CFG.GRID.DRAIN_TRIES, chance = CFG.GRID.DRAIN_CHANCE;
    for (let t = 0; t < tries; t++) {
        const x = 1 + ((rnd() * (W - 2)) | 0);
        for (let y = H - 2; y > 0; y--) {
            const i = y * W + x;
            const m = mat[i];
            if (m === MAT.WATER) {
                if (rnd() < chance) setCell(i, 0);
                break;
            }
            if (M_STATE[m] !== POWDER) break;
        }
    }
}

// ---- world generation ----------------------------------------------------------
export function initWorld() {
    mat.fill(0);
    temp.fill(AMBIENT);
    life.fill(0);
    flag.fill(0);
    state.tick = 0;
    for (let i = 0; i < N; i++) noise[i] = (rnd() * 256) | 0;
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    for (let x = 0; x < W; x++) {
        const u = x / W;
        const hgt = CFG.GRID.TERRAIN_BASE +
            CFG.GRID.TERRAIN_AMP * (0.6 * Math.sin(u * 6.28 * 1.3 + p1) +
                0.3 * Math.sin(u * 6.28 * 2.9 + p2) + 0.1 * Math.sin(u * 6.28 * 7.1 + p3));
        const top = H - 1 - Math.round(hgt);
        for (let y = top; y < H - 1; y++) mat[y * W + x] = MAT.SAND;
    }
    wallBorder();
}

// The tank: floor and two side walls. The top is open, which is also how
// radiation escapes.
export function wallBorder() {
    for (let x = 0; x < W; x++) mat[(H - 1) * W + x] = MAT.WALL;
    for (let y = 0; y < H; y++) { mat[y * W] = MAT.WALL; mat[y * W + W - 1] = MAT.WALL; }
}

// Height of the first non-empty cell in a column, scanning down from `y0`.
export function surfaceY(x, y0) {
    x = x < 1 ? 1 : x > W - 2 ? W - 2 : x | 0;
    for (let y = Math.max(0, y0 | 0); y < H; y++) {
        const m = mat[y * W + x];
        if (m !== 0 && M_STATE[m] !== GAS) return y;
    }
    return H - 1;
}

// Sandbox brush. Never touches the tank border, the living body or an egg.
export function paint(cx, cy, r, m, sparse) {
    const r2 = r * r + 0.5;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const x = cx + dx, y = cy + dy;
            if (x < 1 || y < 0 || x >= W - 1 || y >= H - 1) continue;
            const i = y * W + x;
            const cur = mat[i];
            if (cur === MAT.BODY || cur === MAT.SHELL) continue;
            if (m === 0) { if (cur !== 0) { setCell(i, 0); temp[i] = AMBIENT; } continue; }
            if (cur !== 0) continue;
            if (sparse && rnd() > sparse) continue;
            setCell(i, m);
            temp[i] = AMBIENT;
        }
    }
}

// ---- rendering -----------------------------------------------------------------
// One pass into a Uint32 view of an ImageData buffer (little-endian ABGR).
// Hot cells have a blackbody-ish ramp added on top: deep red, orange, yellow,
// then white.
const GLOW_N = 64;
const glowR = new Uint8Array(GLOW_N), glowG = new Uint8Array(GLOW_N), glowB = new Uint8Array(GLOW_N);
for (let k = 0; k < GLOW_N; k++) {
    const u = k / (GLOW_N - 1);
    glowR[k] = Math.round(255 * Math.min(1, u * 2.4));
    glowG[k] = Math.round(255 * Math.max(0, Math.min(1, (u - 0.25) * 1.7)));
    glowB[k] = Math.round(255 * Math.max(0, Math.min(1, (u - 0.62) * 2.6)));
}
const bgRow = new Uint32Array(H);
for (let y = 0; y < H; y++) {
    const u = y / (H - 1);
    const r = Math.round(8 + 10 * u), g = Math.round(10 + 13 * u), b = Math.round(20 + 16 * u);
    bgRow[y] = (255 << 24) | (b << 16) | (g << 8) | r;
}

export function render(buf) {
    const T0 = CFG.GRID.GLOW_T0, inv = (GLOW_N - 1) / (CFG.GRID.GLOW_T1 - CFG.GRID.GLOW_T0);
    for (let y = 0; y < H; y++) {
        const row = y * W, bg = bgRow[y];
        for (let x = 0; x < W; x++) {
            const i = row + x;
            const m = mat[i];
            let c = m === 0 ? bg : PALETTE[(m << 3) | (noise[i] & 7)];
            const t = temp[i];
            if (t > T0) {
                let k = ((t - T0) * inv) | 0;
                if (k > GLOW_N - 1) k = GLOW_N - 1;
                let r = (c & 255) + glowR[k]; if (r > 255) r = 255;
                let g = ((c >> 8) & 255) + glowG[k]; if (g > 255) g = 255;
                let b = ((c >> 16) & 255) + glowB[k]; if (b > 255) b = 255;
                c = (255 << 24) | (b << 16) | (g << 8) | r;
            }
            buf[i] = c;
        }
    }
}
