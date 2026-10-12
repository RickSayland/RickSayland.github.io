// coupling.js -- everything that crosses between the grid and a soft body.
//
// The sand is discrete cells; the animal is continuous particles. They do not
// share a representation, so every way they affect each other is an explicit
// rule in this file:
//
//   body -> grid   rasterize    the skin polygon is stamped into the grid as
//                               BODY cells, and what was there is pushed aside
//                  heat         the skin warms what it touches
//                  bleed, excrete, corpse, egg
//   grid -> body   collide      skin is projected out of solid cells, with friction
//                  load         powder lying on the animal weighs on it
//                  buoyancy     water lifts and drags it
//                  eat, contaminate, radiation hits, senses

import { CFG, TISSUE, STAGE, AI, RT, COL } from './config.js';
import { W, H, N, mat, temp, noise, life, census, setCell, rnd, surfaceY } from './grid.js';
import {
    MAT, STATE, M_STATE, M_SOLID_TO_BODY, M_DISPLACEABLE, M_DENSITY, M_HOT, M_NONE,
    M_DECAY_P, M_DECAY_TRANSMUTE, M_DECAY_TO, MAT_COUNT,
} from './materials.js';
import * as rad from './radiation.js';
import { pushOut } from './softbody.js';
import { sample as heatSample } from './heat.js';

const C = CFG.COUPLING, TH = CFG.THERMO, D = CFG.DOSE;
const { BONE, MEAT, BLOOD, SKIN } = TISSUE;
const OWNER_CREATURE = 1, OWNER_BALL = 2;
const AMBIENT = CFG.GRID.AMBIENT;

// cells currently stamped as BODY, per owner
export const raster = {
    a: new Int32Array(8192), na: 0,     // the creature
    b: new Int32Array(512), nb: 0,      // the ball
};

// the two soft bodies that can collide with each other
let bodyA = null, bodyB = null, ballTouch = false;
export function setBodies(a, b) { bodyA = a; bodyB = b; }
export function ballWasTouched() { const t = ballTouch; ballTouch = false; return t; }

// ---- rasterize -----------------------------------------------------------------
// Each tick the old BODY cells are cleared and the skin polygon is scanline-
// filled as BODY. Anything loose that the polygon now covers is not deleted:
// it is moved to the nearest empty cell by a breadth-first search outward
// from where it was, which is as close to "pushed aside" as a grid can get.
// Matter is conserved, so an animal wading into a pool raises the water.
const mask = new Uint32Array(N);
let maskStamp = 0;
const pending = new Int32Array(8192);
const xs = new Float32Array(64);
const bfsQ = new Int32Array(C.BFS_LIMIT + 8);
const bfsSeen = new Uint32Array(N);
let bfsStamp = 0;

export function clearBodies() {
    for (let k = 0; k < raster.na; k++) { const i = raster.a[k]; if (mat[i] === MAT.BODY) { mat[i] = 0; life[i] = 0; } }
    for (let k = 0; k < raster.nb; k++) { const i = raster.b[k]; if (mat[i] === MAT.BODY) { mat[i] = 0; life[i] = 0; } }
    raster.na = 0; raster.nb = 0;
}

// Outward BFS from `src` to the nearest EMPTY cell that is not about to be
// claimed by the polygon being filled. The search may pass through anything
// loose (and through the body itself) but never through a wall, so sand
// cannot be squeezed out of a sealed box. Up is tried first: an animal
// pressing into a dune lifts the sand rather than tunnelling it away.
function displace(src) {
    bfsStamp++;
    let head = 0, tail = 0;
    bfsQ[tail++] = src; bfsSeen[src] = bfsStamp;
    const flip = (bfsStamp & 1) === 0;
    while (head < tail) {
        const c = bfsQ[head++];
        const x = c % W;
        for (let d = 0; d < 4; d++) {
            let j;
            if (d === 0) j = c - W;
            else if (d === 1) { if (flip ? x === 0 : x === W - 1) continue; j = flip ? c - 1 : c + 1; }
            else if (d === 2) { if (flip ? x === W - 1 : x === 0) continue; j = flip ? c + 1 : c - 1; }
            else j = c + W;
            if (j < 0 || j >= N || bfsSeen[j] === bfsStamp) continue;
            bfsSeen[j] = bfsStamp;
            const m = mat[j];
            if (m === 0) {
                if (mask[j] === maskStamp) { if (tail < C.BFS_LIMIT) bfsQ[tail++] = j; continue; }
                mat[j] = mat[src]; temp[j] = temp[src]; noise[j] = noise[src]; life[j] = life[src];
                mat[src] = 0; life[src] = 0;
                return true;
            }
            if (M_STATE[m] === STATE.SOLID && m !== MAT.BODY) continue;
            if (tail < C.BFS_LIMIT) bfsQ[tail++] = j;
        }
    }
    return false;
}

function fillPolygon(body, out, owner, T) {
    const { x, y, ring } = body;
    const rn = body.ringN;
    if (rn < 3) return 0;
    let y0 = 1e9, y1 = -1e9;
    for (let e = 0; e < rn; e++) { const v = y[ring[e]]; if (v < y0) y0 = v; if (v > y1) y1 = v; }
    const Y0 = Math.max(0, Math.floor(y0)), Y1 = Math.min(H - 2, Math.ceil(y1));
    maskStamp++;
    let np = 0;
    for (let Y = Y0; Y <= Y1; Y++) {
        const yc = Y + 0.5;
        let nx = 0;
        // crossings of this row's centre line with the polygon edges
        for (let e = 0; e < rn && nx < 64; e++) {
            const i = ring[e], j = ring[e + 1 === rn ? 0 : e + 1];
            const ya = y[i], yb = y[j];
            if ((ya > yc) !== (yb > yc)) xs[nx++] = x[i] + (yc - ya) / (yb - ya) * (x[j] - x[i]);
        }
        for (let a = 1; a < nx; a++) {          // insertion sort: nx is tiny
            const v = xs[a]; let q = a - 1;
            while (q >= 0 && xs[q] > v) { xs[q + 1] = xs[q]; q--; }
            xs[q + 1] = v;
        }
        // even-odd fill: a cell is inside if its centre is between a pair
        for (let a = 0; a + 1 < nx; a += 2) {
            let xa = Math.ceil(xs[a] - 0.5), xb = Math.floor(xs[a + 1] - 0.5);
            if (xa < 1) xa = 1; if (xb > W - 2) xb = W - 2;
            for (let X = xa; X <= xb && np < pending.length; X++) {
                const idx = Y * W + X;
                mask[idx] = maskStamp; pending[np++] = idx;
            }
        }
    }
    let n = 0;
    for (let k = 0; k < np && n < out.length; k++) {
        const idx = pending[k];
        const m = mat[idx];
        if (m !== 0) {
            if (!M_DISPLACEABLE[m]) continue;         // wall, shell, another body: stays
            if (!displace(idx)) continue;             // nowhere to go: the grain stays embedded
        }
        mat[idx] = MAT.BODY; life[idx] = owner; temp[idx] = T;
        out[n++] = idx;
    }
    return n;
}

export function rasterize(creature, ball) {
    clearBodies();
    // (a creature that died this tick is still stamped, once: that footprint
    // is what corpse() turns into tissue)
    if (creature && !creature.body.womb) {
        raster.na = fillPolygon(creature.body, raster.a, OWNER_CREATURE, creature.bodyTemp);
    }
    if (ball) raster.nb = fillPolygon(ball.body, raster.b, OWNER_BALL, AMBIENT);
}

// ---- collision -----------------------------------------------------------------
// Called from inside the solver, once per substep. A particle that ends up
// in a solid cell is projected out along a surface normal and then has
// friction applied.
//
// The normal comes from the occupancy gradient: sum, over a 5x5 window of
// cells, the offset to every solid cell, and negate. That points from where
// the solid is toward where it is not, and unlike the face of a single cell
// it turns smoothly along a staircase of sand, which is what stops a foot
// catching on every grain. (3x3 works but is jittery on slopes.)
function solidAt(cx, cy) {
    if (cx < 0 || cx >= W || cy >= H) return true;
    if (cy < 0) return false;
    return M_SOLID_TO_BODY[mat[cy * W + cx]] === 1;
}

// how many loose cells are stacked directly above (cx, cy)
function cover(cx, cy, limit) {
    let n = 0;
    for (let y = cy; y >= 0 && n <= limit; y--) {
        const m = mat[y * W + cx];
        if (M_STATE[m] === STATE.POWDER) n++;
        else if (m !== MAT.BODY) break;
    }
    return n;
}

export function collide(body, h) {
    if (body.womb) { collideWomb(body); return; }
    const { x, y, px, py, on, tissue, fric, hit } = body;
    const n = body.n;
    const R = C.NORMAL_R;
    for (let i = 0; i < n; i++) {
        if (!on[i] || tissue[i] === BLOOD) continue;
        let X = x[i], Y = y[i];
        // the glass
        if (X < 1.05) X = 1.05; else if (X > W - 1.05) X = W - 1.05;
        if (Y > H - 1.05) Y = H - 1.05; else if (Y < -40) Y = -40;
        let cx = X | 0, cy = Math.floor(Y);
        if (!solidAt(cx, cy)) { x[i] = X; y[i] = Y; continue; }

        let gx = 0, gy = 0;
        for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
                if (solidAt(cx + dx, cy + dy)) { gx -= dx; gy -= dy; }
            }
        }
        let nl = Math.sqrt(gx * gx + gy * gy);
        if (nl < 0.75) {
            // buried: no usable gradient, so head for the middle of the body
            gx = body.cx - X; gy = body.cy - Y;
            nl = Math.sqrt(gx * gx + gy * gy);
            if (nl < 1e-4) { gx = 0; gy = -1; nl = 1; }
        }
        const nx = gx / nl, ny = gy / nl;

        // Loose powder is not always an obstacle. Ground is: a surface whose
        // normal points up carries the animal, however thin. But a grain
        // with only a little powder over it that is beside or above the
        // particle -- a heap in the way, food poured on its back -- yields.
        // The particle is slowed, not stopped, and the rasteriser then
        // lifts the grain out of the way, so the animal wades into a pile
        // and shrugs off a dusting, while the load rule supplies the weight.
        // Without this one grain on its back is an immovable ceiling and a
        // heap of food is a wall with the food inside it.
        if (ny > C.PLOW_NORMAL && M_STATE[mat[cy * W + cx]] === STATE.POWDER && cover(cx, cy, C.LOAD_LIFT) <= C.LOAD_LIFT) {
            x[i] = px[i] + (X - px[i]) * C.PLOW_KEEP;
            y[i] = py[i] + (Y - py[i]) * C.PLOW_KEEP;
            continue;
        }

        // walk out along the normal, cell boundary by cell boundary
        let depth = 0;
        for (let k = 0; k < 6; k++) {
            const tx = nx > 1e-6 ? (cx + 1 - X) / nx : nx < -1e-6 ? (cx - X) / nx : 1e9;
            const ty = ny > 1e-6 ? (cy + 1 - Y) / ny : ny < -1e-6 ? (cy - Y) / ny : 1e9;
            const t = (tx < ty ? tx : ty) + 1e-3;
            X += nx * t; Y += ny * t; depth += t;
            cx = Math.floor(X); cy = Math.floor(Y);
            if (!solidAt(cx, cy)) break;
        }

        // Coulomb friction, at position level. The motion this substep is
        // split into normal and tangential parts; the tangential part is
        // reduced by at most mu * depth. depth is how far the particle had
        // to be pushed out, which is proportional to the normal force the
        // constraints were pressing it in with -- so a foot carrying the
        // animal's weight grips harder than one barely touching.
        const dxp = X - px[i], dyp = Y - py[i];
        const vn = dxp * nx + dyp * ny;
        const tx = dxp - vn * nx, ty = dyp - vn * ny;
        const tl = Math.sqrt(tx * tx + ty * ty);
        if (tl > 1e-9) {
            const maxF = fric[i] * depth;
            const f = tl <= maxF ? 1 : maxF / tl;
            X -= tx * f; Y -= ty * f;
        }
        x[i] = X; y[i] = Y;
        hit[i] = 1;
    }

    // soft body against soft body
    if (bodyA && bodyB) {
        const other = body === bodyA ? bodyB : body === bodyB ? bodyA : null;
        if (other && !other.womb) {
            const t1 = pushOut(body, other), t2 = pushOut(other, body);
            if (t1 || t2) ballTouch = true;
        }
    }
}

// Inside the egg there is no grid, just a round wall.
function collideWomb(body) {
    const { x, y, on } = body;
    const w = body.womb;
    for (let i = 0; i < body.n; i++) {
        if (!on[i]) continue;
        const dx = x[i] - w.x, dy = y[i] - w.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > w.r * w.r) {
            const d = Math.sqrt(d2);
            x[i] = w.x + dx / d * w.r; y[i] = w.y + dy / d * w.r;
        }
    }
}

// ---- skin pass: load, buoyancy, heat ------------------------------------------
// Once per tick, for every skin particle: look at the cell just outside it.
//   * water there      -> buoyancy (an upward acceleration) and drag
//   * powder above it  -> a downward force in proportion to how much is
//                         stacked up, so being buried visibly flattens the
//                         animal
//   * anything there   -> heat exchange, and the cell gets the other side of
//                         it: the animal warms the sand it is sitting on
function outward(body, e, out) {
    const { x, y, ring } = body;
    const rn = body.ringN;
    const a = ring[e === 0 ? rn - 1 : e - 1], b = ring[e + 1 === rn ? 0 : e + 1];
    // half the vector between the neighbours, turned a quarter turn: the
    // same vector as the area gradient, which points outward for A > 0
    let nx = y[b] - y[a], ny = x[a] - x[b];
    if (body.area < 0) { nx = -nx; ny = -ny; }
    const l = Math.sqrt(nx * nx + ny * ny) || 1;
    out.x = nx / l; out.y = ny / l;
}
const nrm = { x: 0, y: 0 };

export function skinPass(creature, dt) {
    const body = creature.body;
    const { x, y, ax, ay, drag, m, ring } = body;
    const n = body.n, rn = body.ringN;
    body.area = body.ringArea();
    const g = body.gravity;
    const lift = (creature.totalMass || 100) / rn;
    let wet = 0;
    for (let e = 0; e < rn; e++) {
        const i = ring[e];
        if (!body.on[i]) continue;
        outward(body, e, nrm);
        const sx = Math.floor(x[i] + nrm.x * 0.9), sy = Math.floor(y[i] + nrm.y * 0.9);
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const ci = sy * W + sx;
        const cm = mat[ci];
        const st = M_STATE[cm];

        if (st === STATE.LIQUID) {
            // Buoyancy is the weight of water displaced, and the only part
            // of the animal that knows it is in water is its skin, so the
            // lift for the whole body is shared out over the skin particles
            // that are wet: all of them wet carries BUOYANCY x its weight.
            ay[i] -= g * C.BUOYANCY * lift / m[i];
            drag[i] = C.WATER_DRAG;
            wet++;
        }
        // overburden: only skin that faces upward carries any
        if (nrm.y < -0.25) {
            // (a gap of a cell or two is looked through: sand follows the
            // animal down one cell a tick, so there is usually daylight
            // between them, and a load that only counted on contact would
            // be applied on alternate ticks)
            let load = 0, gap = 0;
            const cx0 = Math.floor(x[i]);
            for (let k = 0, yy = Math.floor(y[i]) - 1; k < C.LOAD_SCAN && yy >= 0; k++, yy--) {
                const mm = mat[yy * W + cx0];
                if (mm === MAT.BODY) continue;
                if (M_STATE[mm] !== STATE.POWDER) {
                    if (mm === 0 && load === 0 && gap < 2) { gap++; continue; }
                    break;
                }
                load += M_DENSITY[mm];
            }
            if (load > 0) ay[i] += C.LOAD_FORCE * load / m[i];
        }
        // heat through the skin
        if (cm !== MAT.BODY) {
            const k = st === STATE.LIQUID ? TH.SKIN_WATER : (st === STATE.EMPTY || st === STATE.GAS) ? TH.SKIN_AIR : TH.SKIN_SOLID;
            const flow = (temp[ci] - body.temp[i]) * Math.min(0.5, k * dt);
            body.temp[i] += flow;
            temp[ci] -= flow * TH.GRID_SHARE;
        }
    }
    creature.wet = wet;
}

export function ballForces(ball) {
    const body = ball.body;
    for (let i = 0; i < body.n; i++) {
        const cx = Math.floor(body.x[i]), cy = Math.floor(body.y[i]);
        body.ay[i] = 0; body.drag[i] = 0;
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        if (M_STATE[mat[cy * W + cx]] === STATE.LIQUID) { body.ay[i] = -body.gravity * 1.6; body.drag[i] = C.WATER_DRAG; }
    }
}

// ---- eating --------------------------------------------------------------------
// FOOD cells within reach of the mouth are removed from the grid and become
// hunger and growth budget. Radioactive dust lying in the food goes down
// with it and becomes an internal source.
export function eat(creature) {
    if (creature.sleeping || (creature.ai !== AI.EAT && creature.ai !== AI.SEEK_FOOD)) return;
    const mx = creature.mouthX, my = creature.mouthY;
    const reach = CFG.AI.EAT_REACH, r = Math.ceil(reach);
    const cx = Math.floor(mx), cy = Math.floor(my);
    let bites = 0;
    for (let dy = -r; dy <= r && bites < 1; dy++) {
        for (let dx = -r; dx <= r && bites < 1; dx++) {
            const X = cx + dx, Y = cy + dy;
            if (X < 1 || Y < 0 || X >= W - 1 || Y >= H - 1) continue;
            if (dx * dx + dy * dy > reach * reach) continue;
            const i = Y * W + X;
            if (mat[i] !== MAT.FOOD) continue;
            setCell(i, 0);
            creature.feed();
            bites++;
        }
    }
    if (!bites) return;
    const hr = D.EAT_HOT_REACH, hrc = Math.ceil(hr);
    for (let dy = -hrc; dy <= hrc; dy++) {
        for (let dx = -hrc; dx <= hrc; dx++) {
            const X = cx + dx, Y = cy + dy;
            if (X < 1 || Y < 0 || X >= W - 1 || Y >= H - 1 || dx * dx + dy * dy > hr * hr) continue;
            const i = Y * W + X;
            const m = mat[i];
            if (!M_HOT[m]) continue;
            creature.internal[m] += 1;
            setCell(i, 0);
            return;                 // one grain per bite
        }
    }
}

// ---- contamination -------------------------------------------------------------
// Surface: radioactive powder touching the skin sticks to it and keeps
// decaying there until it is washed off with water. Internal: what was
// swallowed decays from random meat particles until it has transmuted or
// been excreted. In both cases the alpha is deposited where it is born,
// because an alpha never gets more than a fraction of a cell from its
// source: on the skin that is the dead outer layer and does almost nothing,
// in the gut it is living tissue.
export function contaminate(creature) {
    const body = creature.body;
    const { x, y, ring } = body;
    const rn = body.ringN;
    const speck = creature.speck;
    const sens = creature.phen.radSens;
    for (let e = 0; e < rn; e++) {
        const i = ring[e];
        if (!body.on[i]) continue;
        outward(body, e, nrm);
        const sx = Math.floor(x[i] + nrm.x * 0.9), sy = Math.floor(y[i] + nrm.y * 0.9);
        if (sx < 1 || sy < 0 || sx >= W - 1 || sy >= H - 1) continue;
        const ci = sy * W + sx;
        const cm = mat[ci];
        const sm = speck[i];
        if (!sm) {
            if (M_HOT[cm] && rnd() < D.STICK_CHANCE) { speck[i] = cm; setCell(ci, 0); }
            continue;
        }
        // washing: the speck comes off into the water as a grain again
        if (M_STATE[cm] === STATE.LIQUID && rnd() < D.WASH_CHANCE) {
            mat[ci] = sm; life[ci] = 0;
            speck[i] = 0;
            continue;
        }
        if (rnd() < M_DECAY_P[sm]) {
            const alphaE = rad.emitFrom(x[i] + nrm.x * 0.7, y[i] + nrm.y * 0.7, sm, true);
            if (alphaE > 0) creature.addDose(i, D.SCALE * alphaE * D.QUALITY[COL.ALPHA] * D.SENS[SKIN][RT.ALPHA] * sens);
            if (rnd() < M_DECAY_TRANSMUTE[sm]) {
                const to = M_DECAY_TO[sm];
                speck[i] = to !== M_NONE && M_HOT[to] ? to : 0;
            }
        }
    }

    const internal = creature.internal;
    const meat = creature.plan.lattice;
    for (let m = 1; m < MAT_COUNT; m++) {
        const amount = internal[m];
        if (amount <= 0.01) { internal[m] = 0; continue; }
        const expect = amount * M_DECAY_P[m];
        let events = Math.floor(expect);
        if (rnd() < expect - events) events++;
        for (let k = 0; k < events; k++) {
            let j = meat[(rnd() * meat.length) | 0];
            if (!body.on[j]) j = meat[0];
            const alphaE = rad.emitFrom(body.x[j], body.y[j], m, true);
            if (alphaE > 0) creature.addDose(j, D.SCALE * alphaE * D.QUALITY[COL.ALPHA] * D.SENS[MEAT][RT.ALPHA] * D.INTERNAL_ALPHA * sens);
            if (rnd() < M_DECAY_TRANSMUTE[m]) {
                internal[m] = Math.max(0, internal[m] - 1);
                const to = M_DECAY_TO[m];
                if (to !== M_NONE && M_HOT[to]) internal[to] += 1;
            }
        }
    }
}

// ---- radiation hits ------------------------------------------------------------
// The transport calls this for every interaction inside a BODY cell. The hit
// goes to the nearest particle of a tissue that radiation type can reach:
// an alpha stops in the skin, a beta gets as far as the meat, and gammas and
// neutrons reach bone and blood. A bigger animal takes more hits for no
// other reason than that it covers more cells.
let hitTarget = null;
export function setHitTarget(creature) { hitTarget = creature; }

const MASK_SKIN = 1 << SKIN;
const MASK_BETA = (1 << SKIN) | (1 << MEAT);
const MASK_ALL = 15;

function onBodyHit(i, X, Y, col, dep) {
    const c = hitTarget;
    if (!c || c.dead || life[i] !== OWNER_CREATURE) return;
    const mask = col === COL.ALPHA ? MASK_SKIN : col === COL.BETA ? MASK_BETA : MASK_ALL;
    const j = c.body.nearest(X, Y, mask);
    if (j < 0) return;
    const rt = col >= COL.NFAST ? RT.NEUTRON : col;
    c.addDose(j, D.SCALE * dep * D.QUALITY[col] * D.SENS[c.body.tissue[j]][rt] * c.phen.radSens);
}
rad.setBodyHitHandler(onBodyHit);

// ---- bleeding, waste, death ----------------------------------------------------
function nearestEmpty(cx, cy, r) {
    for (let k = 0; k <= r; k++) {
        for (let dy = -k; dy <= k; dy++) {
            for (let dx = -k; dx <= k; dx++) {
                if (Math.abs(dx) !== k && Math.abs(dy) !== k) continue;
                const X = cx + dx, Y = cy + dy;
                if (X < 1 || Y < 0 || X >= W - 1 || Y >= H - 1) continue;
                if (mat[Y * W + X] === 0) return Y * W + X;
            }
        }
    }
    return -1;
}

// A blood particle that got out through a wound stops being a particle and
// becomes a BLOOD cell.
export function bleed(creature) {
    const body = creature.body;
    const blood = creature.plan.blood;
    for (let k = 0; k < blood.length; k++) {
        const i = blood[k];
        if (!body.on[i] || !body.fluidOut[i]) continue;
        body.fluidOut[i] = 0;
        body.on[i] = 0;
        creature.bled[i] = 1;
        const j = nearestEmpty(Math.floor(body.x[i]), Math.floor(body.y[i]), 3);
        if (j >= 0) { setCell(j, MAT.BLOOD); temp[j] = creature.bodyTemp; }
    }
}

export function excrete(creature) {
    if (creature.pendingWaste <= 0) return;
    // behind the animal: out past the tail, away from the centre
    const dx = creature.tailX - creature.cx, dy = creature.tailY - creature.cy;
    const l = Math.hypot(dx, dy) || 1;
    const bx = Math.floor(creature.tailX + dx / l * 2), by = Math.floor(creature.tailY + dy / l * 1);
    while (creature.pendingWaste > 0) {
        const j = nearestEmpty(bx, by, 5);
        if (j < 0) break;
        setCell(j, MAT.WASTE); temp[j] = creature.bodyTemp;
        creature.pendingWaste--;
    }
    // part of whatever was swallowed leaves the same way
    const internal = creature.internal;
    for (let m = 1; m < MAT_COUNT; m++) {
        let out = Math.floor(internal[m] * D.EXCRETE_SHARE + rnd());
        while (out-- > 0 && internal[m] >= 1) {
            const j = nearestEmpty(bx, by, 5);
            if (j < 0) break;
            setCell(j, m);
            internal[m] -= 1;
        }
    }
}

// Death. The constraints are already gone; every cell the body occupied
// becomes loose tissue according to the particle nearest it -- bone where
// there was bone, blood where it had pooled, meat everywhere else -- and
// the automaton takes it from there. The bone never decays.
export function corpse(creature) {
    const body = creature.body;
    const cells = raster.a, count = raster.na;
    const internal = creature.internal;
    for (let k = 0; k < count; k++) {
        const i = cells[k];
        if (mat[i] !== MAT.BODY) continue;
        const cxi = i % W, cyi = (i / W) | 0;
        const X = cxi + 0.5, Y = cyi + 0.5;
        const j = body.nearest(X, Y, MASK_ALL);
        let m = MAT.MEAT;
        if (j >= 0) {
            const t = body.tissue[j];
            if (t === BONE && body._nearestD2 < 2.2) m = MAT.BONE;
            else if (t === BLOOD && body._nearestD2 < 2.4) m = MAT.BLOOD;
        }
        // The footprint is four cells to a particle, and a body is not
        // solid meat: every other meat cell is left empty, so what falls is
        // a carcass rather than a block. Bone and blood are kept whole.
        if (m === MAT.MEAT && ((cxi + cyi) & 1)) { mat[i] = 0; life[i] = 0; continue; }
        // what it had swallowed is still in there
        for (let h = 1; h < MAT_COUNT; h++) {
            if (internal[h] >= 1 && rnd() < 0.05) { m = h; internal[h] -= 1; break; }
        }
        setCell(i, m);
        temp[i] = creature.bodyTemp;
    }
    for (let i = 0; i < creature.speck.length; i++) {
        const sm = creature.speck[i];
        if (!sm) continue;
        const j = nearestEmpty(Math.floor(body.x[i]), Math.floor(body.y[i]), 4);
        if (j >= 0) setCell(j, sm);
        creature.speck[i] = 0;
    }
    raster.na = 0;
}

// ---- the egg -------------------------------------------------------------------
// The shell is real SHELL cells. Whenever the egg moves or tilts the old
// oval is lifted and the new one stamped, displacing loose material exactly
// as the body does.
export function stampEgg(egg) {
    const key = Math.round(egg.x) + ',' + Math.round(egg.y) + ',' + Math.round(egg.tilt * 40);
    if (key === egg.stampKey) return;
    egg.stampKey = key;
    liftEgg(egg);
    maskStamp++;
    const x0 = Math.floor(egg.x - egg.rx - 4), x1 = Math.ceil(egg.x + egg.rx + 4);
    const y0 = Math.floor(egg.y - egg.ry - 3), y1 = Math.ceil(egg.y + egg.ry * 1.3 + 3);
    let np = 0;
    for (let Y = y0; Y <= y1; Y++) {
        if (Y < 0 || Y >= H - 1) continue;
        for (let X = x0; X <= x1; X++) {
            if (X < 1 || X >= W - 1) continue;
            if (!egg.inside(X + 0.5, Y + 0.5)) continue;
            const idx = Y * W + X;
            mask[idx] = maskStamp;
            if (np < pending.length) pending[np++] = idx;
        }
    }
    let n = 0;
    for (let k = 0; k < np && n < egg.cells.length; k++) {
        const idx = pending[k];
        const m = mat[idx];
        if (m !== 0) {
            if (!M_DISPLACEABLE[m]) continue;
            if (!displace(idx)) continue;
        }
        setCell(idx, MAT.SHELL);
        egg.cells[n++] = idx;
    }
    egg.nCells = n;
}

function liftEgg(egg) {
    for (let k = 0; k < egg.nCells; k++) { const i = egg.cells[k]; if (mat[i] === MAT.SHELL) { mat[i] = 0; life[i] = 0; } }
    egg.nCells = 0;
}

// An egg with nothing under it falls.
export function settleEgg(egg) {
    const by = Math.floor(egg.y + egg.ry * 1.15) + 1;
    if (by >= H - 1) return;
    let support = 0;
    for (let dx = -3; dx <= 3; dx++) {
        const X = Math.floor(egg.x) + dx;
        if (X < 1 || X >= W - 1) continue;
        const m = mat[by * W + X];
        if (m !== 0 && M_STATE[m] !== STATE.GAS && M_STATE[m] !== STATE.LIQUID) support++;
    }
    if (support === 0) egg.y += 1;
}

// Hatching: the shell is no longer one solid thing, it is powder. Only the
// rind is shell; the hollow the embryo was floating in (`womb`) is simply
// opened, or the hatchling would start life buried in its own egg.
export function crackEgg(egg) {
    const rind = CFG.EGG.SHELL;
    for (let k = 0; k < egg.nCells; k++) {
        const i = egg.cells[k];
        if (mat[i] !== MAT.SHELL) continue;
        if (egg.inside((i % W) + 0.5, ((i / W) | 0) + 0.5, -rind)) { mat[i] = 0; life[i] = 0; }
        else setCell(i, MAT.SHELL_BITS);
    }
    egg.nCells = 0;
}

export function removeEgg(egg) { liftEgg(egg); }

// Where an egg of radius (rx, ry) can sit near column x: on top of whatever
// is there.
export function eggSite(x, rx, ry, fromY) {
    x = Math.max(rx + 4, Math.min(W - rx - 4, x));
    let top = H;
    for (let dx = -Math.floor(rx); dx <= Math.floor(rx); dx += 2) top = Math.min(top, surfaceY(Math.floor(x + dx), fromY || 0));
    return { x, y: top - ry * 1.15 - 1 };
}

// ---- senses --------------------------------------------------------------------
const bb = { x0: 0, y0: 0, x1: 0, y1: 0 };
export function sense(creature, world) {
    const sn = creature.sense;
    const mx = creature.mouthX, my = creature.mouthY;
    creature.body.bounds(bb);
    // nearest food to the mouth. Height counts for more than distance: food
    // up a slope is further away than it looks. Food lying on the animal's
    // own back is ignored -- it cannot reach it and would stand staring at it.
    let best = 1e9, fx = 0, fy = 0;
    if (census[MAT.FOOD] > 0) {
        for (let i = 0; i < N; i++) {
            if (mat[i] !== MAT.FOOD) continue;
            const X = i % W, Y = (i / W) | 0;
            if (X > bb.x0 && X < bb.x1 && Y < creature.cy) continue;
            const d = Math.abs(X - mx) + 1.6 * Math.abs(Y - my);
            if (d < best) { best = d; fx = X + 0.5; fy = Y + 0.5; }
        }
    }
    sn.hasFood = best < 1e9;
    sn.foodX = fx; sn.foodY = fy;

    const P = CFG.AI.PROBE;
    const cx = Math.floor(creature.cx), cy = Math.floor(creature.cy);
    sn.tempL = heatSample(cx - P, cy, 3); sn.tempR = heatSample(cx + P, cy, 3);
    sn.doseL = rad.fieldNear(cx - P, cy); sn.doseR = rad.fieldNear(cx + P, cy);
    sn.wasteCount = census[MAT.WASTE];
    sn.lights = world.lights;
    sn.hasBall = !!world.ball;
    if (world.ball) { sn.ballX = world.ball.x; sn.ballY = world.ball.y; }

    // what the eyes follow: food first, then the toy, then wherever it is going
    if (sn.hasFood) { creature.lookX = fx; creature.lookY = fy; }
    else if (sn.hasBall) { creature.lookX = sn.ballX; creature.lookY = sn.ballY; }
    else { creature.lookX = creature.cx + (creature.face >= 0 ? 30 : -30); creature.lookY = creature.cy; }
}

// The activity-weighted mean decay constant of everything radioactive in the
// tank, as a half-life. A save file uses it to let the dose rate it recorded
// die away at the right speed while the tab was closed.
export function sourceHalfLife() {
    let act = 0, lam = 0;
    for (let m = 1; m < MAT_COUNT; m++) {
        const p = M_DECAY_P[m];
        if (p <= 0 || census[m] === 0) continue;
        const a = p * census[m];
        act += a;
        const to = M_DECAY_TO[m];
        if (to !== M_NONE && M_DECAY_TRANSMUTE[m] > 0) {
            // cell half-life = event half-life / transmute chance
            lam += a * Math.LN2 * M_DECAY_TRANSMUTE[m] * (-Math.log2(1 - p) * CFG.SIM.HZ);
        }
    }
    if (act <= 0 || lam <= 0) return Infinity;
    return Math.LN2 / (lam / act);
}
