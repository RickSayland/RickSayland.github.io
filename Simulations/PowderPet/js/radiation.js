// radiation.js -- the energy-particle layer.
//
// Alphas, betas, gammas and neutrons are NOT stored in the grid. They are
// continuous particles in a struct-of-arrays pool, ray-marched through the
// cells every tick, and everything nuclear in the toy is a consequence of
// what happens to them on the way: shielding, moderation, activation,
// fission, dose.
//
// Nothing here knows what a critical mass is. A chain reaction happens when
// the neutrons one fission makes go on to cause more than one further
// fission before they leak out of the top of the tank or are captured, and
// whether they do is decided cell by cell by the geometry you built.

import { CFG, RT, COL } from './config.js';
import { W, H, mat, temp, state as gridState, morph, rnd, setDecayHook } from './grid.js';
import {
    MAT, M_NONE, M_MU, M_GABS, M_BABS, M_NF_FIS, M_NF_ABS, M_NF_THERM, M_NT_FIS, M_NT_ABS,
    M_ACT_P, M_ACT_TO, M_FIS_NU3, M_FIS_SPENT, M_FIS_TO,
    M_DECAY_TRANSMUTE, M_DECAY_TO, M_DECAY_HEAT, M_DECAY_EMIT,
} from './materials.js';

const R = CFG.RAD;
export const CAP = R.CAP;

// ---- the pool --------------------------------------------------------------
export const px = new Float32Array(CAP);
export const py = new Float32Array(CAP);
export const ux = new Float32Array(CAP);      // unit direction
export const uy = new Float32Array(CAP);
export const type = new Uint8Array(CAP);
export const thermal = new Uint8Array(CAP);   // neutrons only
export const energy = new Float32Array(CAP);
export const tau = new Float32Array(CAP);     // optical depth left before the next interaction
export const life = new Int16Array(CAP);

export const pool = {
    count: 0,
    byType: new Int32Array(4),
    fissions: 0,          // this tick
    fissionRate: 0,       // smoothed, per second
    born: 0,
};

// ---- dose-rate field ---------------------------------------------------------
// A coarse flux tally: every particle adds its (weighted) energy to the block
// it ends the tick in, and the field decays exponentially. The AI reads it
// to find out which way is "less", and the debug overlay draws it.
export const FC = R.FIELD_CELL;
export const FW = Math.ceil(W / FC);
export const FH = Math.ceil(H / FC);
export const field = new Float32Array(FW * FH);

export function fieldAt(x, y) {
    const fx = (x / FC) | 0, fy = (y / FC) | 0;
    if (fx < 0 || fy < 0 || fx >= FW || fy >= FH) return 0;
    return field[fy * FW + fx];
}

// mean of a 3x3 block of field cells: one sample is far too noisy to steer by
export function fieldNear(x, y) {
    const fx = (x / FC) | 0, fy = (y / FC) | 0;
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
        const yy = fy + dy; if (yy < 0 || yy >= FH) continue;
        for (let dx = -1; dx <= 1; dx++) {
            const xx = fx + dx; if (xx < 0 || xx >= FW) continue;
            s += field[yy * FW + xx]; n++;
        }
    }
    return n ? s / n : 0;
}

// ---- hooks ---------------------------------------------------------------------
// coupling.js registers this: called for every interaction inside a BODY cell
// with the energy actually deposited there.
let bodyHit = null;
export function setBodyHitHandler(fn) { bodyHit = fn; }

// ---- spawning ------------------------------------------------------------------
// Free-path sampling. In a uniform medium the distance to the next
// interaction is exponentially distributed, s = -ln(U) / mu (Beer-Lambert).
// The medium here changes every cell, so instead of a distance each particle
// carries the dimensionless optical depth it has left, tau = -ln(U), and the
// march spends it at mu per cell of path. In a uniform medium that is the
// same thing; across a boundary it is still exact.
function freshTau() {
    let u = rnd();
    if (u < 1e-12) u = 1e-12;
    return -Math.log(u);
}

export function spawn(x, y, t, e, isThermal, dirX, dirY) {
    if (pool.count >= CAP) return -1;
    const p = pool.count++;
    px[p] = x; py[p] = y;
    if (dirX === undefined) {
        const a = rnd() * 6.283185307;
        ux[p] = Math.cos(a); uy[p] = Math.sin(a);
    } else { ux[p] = dirX; uy[p] = dirY; }
    type[p] = t;
    thermal[p] = isThermal ? 1 : 0;
    energy[p] = e;
    tau[p] = freshTau();
    life[p] = R.LIFE_TICKS[t];
    pool.born++;
    return p;
}

export function clear() {
    pool.count = 0;
    field.fill(0);
    pool.byType.fill(0);
}

function scatter(p) {
    const a = rnd() * 6.283185307;
    ux[p] = Math.cos(a); uy[p] = Math.sin(a);
    tau[p] = freshTau();
}

// ---- decay ---------------------------------------------------------------------
// Called by the grid for a cell whose per-tick decay roll came up. Emission
// starts from a random point inside the cell, so a grain buried in a heap
// mostly irradiates the heap (self-shielding) and only the surface of a pile
// of an alpha emitter is dangerous to stand next to.
function onDecay(i, m) {
    const x = i % W, y = (i / W) | 0;
    const emit = M_DECAY_EMIT[m];
    for (let k = 0; k < emit.length; k++) {
        const e = emit[k];
        for (let c = 0; c < e[2]; c++) {
            if (e[1] < 1 && rnd() > e[1]) continue;
            spawn(x + rnd(), y + rnd(), e[0], R.ENERGY[e[0]], false);
        }
    }
    temp[i] += M_DECAY_HEAT[m];
    const to = M_DECAY_TO[m];
    if (to !== M_NONE && rnd() < M_DECAY_TRANSMUTE[m]) morph(i, to);
}
setDecayHook(onDecay);

// Emit one decay's worth of particles from an arbitrary point: used for
// contamination carried on or inside the creature. Returns the alpha energy
// emitted, which the caller deposits directly (an alpha born in tissue never
// leaves it).
export function emitFrom(x, y, m, skipAlpha) {
    const emit = M_DECAY_EMIT[m];
    let alphaE = 0;
    if (!emit) return 0;
    for (let k = 0; k < emit.length; k++) {
        const e = emit[k];
        for (let c = 0; c < e[2]; c++) {
            if (e[1] < 1 && rnd() > e[1]) continue;
            if (e[0] === RT.ALPHA && skipAlpha) { alphaE += R.ENERGY[RT.ALPHA]; continue; }
            spawn(x, y, e[0], R.ENERGY[e[0]], false);
        }
    }
    return alphaE;
}

// ---- interactions --------------------------------------------------------------
function fission(i, m, x, y) {
    pool.fissions++;
    temp[i] += R.FISSION_HEAT;
    const scale = gridState.emitScale;
    const nu = rnd() < M_FIS_NU3[m] ? 3 : 2;
    for (let k = 0; k < nu; k++) {
        if (rnd() < scale) spawn(x, y, RT.NEUTRON, R.ENERGY[RT.NEUTRON], false);
    }
    if (rnd() < R.FISSION_GAMMA * scale) spawn(x, y, RT.GAMMA, R.ENERGY[RT.GAMMA], false);
    // burn-up: the fuel cell is eventually just fission products
    if (rnd() < M_FIS_SPENT[m]) morph(i, M_FIS_TO[m]);
}

function captureNeutron(i, m) {
    temp[i] += R.HEAT_PER_E * 0.5;
    // activation: sand and water become weakly radioactive
    const to = M_ACT_TO[m];
    if (to !== M_NONE && rnd() < M_ACT_P[m]) morph(i, to);
}

// Returns 0 if the particle is gone, 1 if it carries on (scattered).
function interact(p, i, m, col, x, y) {
    const e = energy[p];
    const inBody = m === MAT.BODY;
    let dep = 0, alive = 1;

    if (col === COL.ALPHA) {
        dep = e; alive = 0;
    } else if (col === COL.BETA) {
        if (rnd() < M_BABS[m]) { dep = e; alive = 0; }
        else {
            dep = e * (1 - R.SCATTER_KEEP_BETA);
            energy[p] = e - dep;
            if (energy[p] < 0.12) { dep = e; alive = 0; }
        }
    } else if (col === COL.GAMMA) {
        if (rnd() < M_GABS[m]) { dep = e; alive = 0; }             // photoelectric
        else {
            dep = e * (1 - R.SCATTER_KEEP_GAMMA);                  // Compton
            energy[p] = e - dep;
            if (energy[p] < R.GAMMA_CUTOFF) { dep = e; alive = 0; }
        }
    } else if (col === COL.NFAST) {
        const u = rnd(), f = M_NF_FIS[m];
        if (u < f) { fission(i, m, x, y); return 0; }
        if (u < f + M_NF_ABS[m]) { captureNeutron(i, m); dep = e; alive = 0; }
        else if (rnd() < M_NF_THERM[m]) {
            // elastic scatter off a light nucleus: most of the energy goes
            // into the recoil, and the neutron comes out slow
            dep = e - R.E_THERMAL;
            thermal[p] = 1;
            energy[p] = R.E_THERMAL;
        } else dep = e * 0.08;
    } else {
        const u = rnd(), f = M_NT_FIS[m];
        if (u < f) { fission(i, m, x, y); return 0; }
        if (u < f + M_NT_ABS[m]) { captureNeutron(i, m); dep = e; alive = 0; }
    }

    if (inBody) {
        if (bodyHit !== null && dep > 0) bodyHit(i, x, y, col, dep);
    } else if (dep > 0) {
        temp[i] += dep * R.HEAT_PER_E * (alive ? 0.5 : 1);
    }
    if (alive) scatter(p);
    return alive;
}

// ---- transport -----------------------------------------------------------------
// DDA ray-march (Amanatides & Woo). The particle is walked cell boundary to
// cell boundary along its direction, so a gamma moving six cells a tick still
// visits every cell on the way and cannot tunnel through a one-cell wall.
// In each cell it spends mu * (path length in that cell) of its optical
// depth; the cell where the depth runs out is where it interacts.
function advance(p) {
    let x = px[p], y = py[p];
    const t = type[p];
    let col = t === RT.NEUTRON ? (thermal[p] ? COL.NTHERM : COL.NFAST) : t;
    let remain = R.SPEED[col];
    let guard = 0;

    while (remain > 1e-5) {
        if (++guard > 10) break;
        const dx = ux[p], dy = uy[p];
        let cx = Math.floor(x), cy = Math.floor(y);
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
        const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
        const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e30;
        const tdy = dy !== 0 ? Math.abs(1 / dy) : 1e30;
        let tmx = dx !== 0 ? (dx > 0 ? cx + 1 - x : x - cx) * tdx : 1e30;
        let tmy = dy !== 0 ? (dy > 0 ? cy + 1 - y : y - cy) * tdy : 1e30;
        let trav = 0;
        let hit = false;

        for (;;) {
            const i = cy * W + cx;
            const m = mat[i];
            let tNext = tmx < tmy ? tmx : tmy;
            let last = false;
            if (tNext >= remain) { tNext = remain; last = true; }
            const mu = M_MU[m * 5 + col];
            if (mu > 0) {
                const left = tau[p] - mu * (tNext - trav);
                if (left <= 0) {
                    const d = trav + tau[p] / mu;
                    x += dx * d; y += dy * d;
                    remain -= d;
                    if (interact(p, i, m, col, x, y) === 0) return false;
                    // a neutron that just thermalised finishes the tick at
                    // its new, slower speed
                    const nc = t === RT.NEUTRON ? (thermal[p] ? COL.NTHERM : COL.NFAST) : t;
                    if (nc !== col) { remain *= R.SPEED[nc] / R.SPEED[col]; col = nc; }
                    hit = true;
                    break;
                }
                tau[p] = left;
            }
            trav = tNext;
            if (last) { x += dx * remain; y += dy * remain; remain = 0; break; }
            if (tmx < tmy) { cx += sx; tmx += tdx; } else { cy += sy; tmy += tdy; }
            if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;   // left the tank
        }
        if (!hit) break;
    }
    px[p] = x; py[p] = y;
    return true;
}

export function step() {
    // Pool throttle. Above THROTTLE_AT of capacity every emitter in the tank
    // (decay and fission alike) is scaled down linearly, reaching zero at a
    // full pool. A supercritical pile therefore plateaus at a power the
    // frame budget can afford instead of dropping frames.
    const fill = pool.count / CAP;
    gridState.emitScale = fill <= R.THROTTLE_AT ? 1 : Math.max(0, (1 - fill) / (1 - R.THROTTLE_AT));

    const fd = R.FIELD_DECAY;
    for (let k = 0; k < field.length; k++) field[k] *= fd;

    pool.byType.fill(0);
    let p = 0;
    while (p < pool.count) {
        let alive = --life[p] > 0;
        if (alive) alive = advance(p);
        if (!alive) {
            // swap-remove: the last particle takes this slot and is processed next
            const q = --pool.count;
            if (p !== q) {
                px[p] = px[q]; py[p] = py[q]; ux[p] = ux[q]; uy[p] = uy[q];
                type[p] = type[q]; thermal[p] = thermal[q]; energy[p] = energy[q];
                tau[p] = tau[q]; life[p] = life[q];
            }
            continue;
        }
        const t = type[p];
        pool.byType[t]++;
        const fx = (px[p] / FC) | 0, fy = (py[p] / FC) | 0;
        if (fx >= 0 && fy >= 0 && fx < FW && fy < FH) {
            const col = t === RT.NEUTRON ? (thermal[p] ? COL.NTHERM : COL.NFAST) : t;
            field[fy * FW + fx] += energy[p] * R.FIELD_WEIGHT[col];
        }
        p++;
    }
    pool.fissionRate += (pool.fissions * CFG.SIM.HZ - pool.fissionRate) * 0.1;
    pool.fissions = 0;
}

// ---- rendering -----------------------------------------------------------------
// Additive glowing pixels over the finished grid image.
const colR = new Uint8Array(5), colG = new Uint8Array(5), colB = new Uint8Array(5);
for (let c = 0; c < 5; c++) { colR[c] = R.COLOR[c][0]; colG[c] = R.COLOR[c][1]; colB[c] = R.COLOR[c][2]; }

function addPixel(buf, i, r, g, b) {
    const c = buf[i];
    let nr = (c & 255) + r; if (nr > 255) nr = 255;
    let ng = ((c >> 8) & 255) + g; if (ng > 255) ng = 255;
    let nb = ((c >> 16) & 255) + b; if (nb > 255) nb = 255;
    buf[i] = (255 << 24) | (nb << 16) | (ng << 8) | nr;
}

export function render(buf) {
    for (let p = 0; p < pool.count; p++) {
        const x = px[p] | 0, y = py[p] | 0;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = type[p];
        const col = t === RT.NEUTRON ? (thermal[p] ? COL.NTHERM : COL.NFAST) : t;
        addPixel(buf, y * W + x, colR[col], colG[col], colB[col]);
        // a short tail one cell back along the track
        const tx = (px[p] - ux[p]) | 0, ty = (py[p] - uy[p]) | 0;
        if (tx >= 0 && ty >= 0 && tx < W && ty < H && (tx !== x || ty !== y)) {
            addPixel(buf, ty * W + tx, colR[col] >> 2, colG[col] >> 2, colB[col] >> 2);
        }
    }
}

// ---- persistence ---------------------------------------------------------------
export function serialize() {
    const n = pool.count;
    return {
        n,
        x: Array.from(px.subarray(0, n), (v) => Math.round(v * 100) / 100),
        y: Array.from(py.subarray(0, n), (v) => Math.round(v * 100) / 100),
        a: Array.from({ length: n }, (_, p) => Math.round(Math.atan2(uy[p], ux[p]) * 1000) / 1000),
        t: Array.from(type.subarray(0, n)),
        th: Array.from(thermal.subarray(0, n)),
        e: Array.from(energy.subarray(0, n), (v) => Math.round(v * 100) / 100),
        l: Array.from(life.subarray(0, n)),
    };
}

export function deserialize(d) {
    clear();
    if (!d || !d.n) return;
    const n = Math.min(d.n, CAP);
    for (let p = 0; p < n; p++) {
        px[p] = d.x[p]; py[p] = d.y[p];
        ux[p] = Math.cos(d.a[p]); uy[p] = Math.sin(d.a[p]);
        type[p] = d.t[p]; thermal[p] = d.th[p]; energy[p] = d.e[p]; life[p] = d.l[p];
        tau[p] = freshTau();
    }
    pool.count = n;
}
