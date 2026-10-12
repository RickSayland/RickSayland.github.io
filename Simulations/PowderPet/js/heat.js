// heat.js -- the temperature field.
//
// Explicit diffusion on the cell grid, written as pairwise exchange rather
// than a Laplacian stencil: each cell trades heat with its right and lower
// neighbour,
//
//     q = k_ij (T_j - T_i),   T_i += q,   T_j -= q
//
// which conserves energy exactly, needs no second buffer, and cannot
// overshoot for k_ij <= 0.5. k_ij is the SMALLER of the two materials'
// conductivities, so an insulator insulates no matter what it is touching.
//
// On top of that every cell relaxes toward ambient at its material's own
// cooling rate. Air cools fast (it stands in for convection the grid does
// not simulate); a buried grain cools almost not at all, which is why a heap
// of polonium gets hot in the middle.

import { CFG } from './config.js';
import { M_COND, M_COOL } from './materials.js';
import { W, H, N, mat, temp, state } from './grid.js';

const AMBIENT = CFG.GRID.AMBIENT;

export function step() {
    // Sweeping in place has a slight directional bias, so the sweep runs
    // forwards on even ticks and backwards on odd ones and the bias cancels.
    if ((state.tick & 1) === 0) {
        for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) exchange(row + x, x, y);
        }
    } else {
        for (let y = H - 1; y >= 0; y--) {
            const row = y * W;
            for (let x = W - 1; x >= 0; x--) exchange(row + x, x, y);
        }
    }
}

function exchange(i, x, y) {
    const m = mat[i];
    const ki = M_COND[m];
    let t = temp[i];
    if (x + 1 < W) {
        const j = i + 1;
        const kj = M_COND[mat[j]];
        const q = (temp[j] - t) * (ki < kj ? ki : kj);
        t += q; temp[j] -= q;
    }
    if (y + 1 < H) {
        const j = i + W;
        const kj = M_COND[mat[j]];
        const q = (temp[j] - t) * (ki < kj ? ki : kj);
        t += q; temp[j] -= q;
    }
    temp[i] = t + (AMBIENT - t) * M_COOL[m];
}

export function addHeat(i, dT) {
    if (i >= 0 && i < N) temp[i] += dT;
}

// Relax the whole field toward ambient as if `seconds` had passed with
// nothing heating it. Used when a save is fast-forwarded.
export function relax(seconds) {
    const ticks = seconds * CFG.SIM.HZ;
    for (let i = 0; i < N; i++) {
        const c = M_COOL[mat[i]];
        const keep = c > 0 ? Math.pow(1 - c, ticks) : Math.exp(-seconds / 600);
        temp[i] = AMBIENT + (temp[i] - AMBIENT) * keep;
    }
}

// Mean temperature of a small block, for the creature's sense of warmth.
export function sample(cx, cy, r) {
    let sum = 0, n = 0;
    for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = cx - r; x <= cx + r; x++) {
            if (x < 0 || x >= W) continue;
            sum += temp[y * W + x]; n++;
        }
    }
    return n ? sum / n : AMBIENT;
}
