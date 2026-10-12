// softbody.js -- an XPBD particle solver.
//
// The creature is not drawn, it is simulated: a few dozen to a hundred and
// fifty particles held together by constraints, and how stiff a tissue is is
// nothing more than the compliance of the constraints through it. The toy
// ball is the same class with a different set of constraints.
//
// XPBD (Macklin, Mueller, Chentanez 2016), in the "small steps" form
// (Macklin et al. 2019): one constraint iteration per substep, many substeps
// per tick. For a constraint C(x) = 0 with compliance alpha (the inverse of a
// stiffness, alpha = 1/k), one substep of length h does
//
//     alpha~  = alpha / h^2
//     dlambda = -C / (sum_i w_i |grad_i C|^2 + alpha~)
//     dx_i    = w_i * dlambda * grad_i C            (w_i = 1 / m_i)
//
// The alpha~ term is what distinguishes this from plain position-based
// dynamics: the constraint behaves like a real spring of stiffness 1/alpha
// regardless of the timestep or the iteration count, and alpha = 0 is a
// perfectly rigid constraint rather than a division by zero. Stiffness is a
// physical quantity and the solver is stable at any value of it, which is
// why bone, meat and skin can differ by four orders of magnitude here.
//
// A substep is:
//     1. v += h * a_external ;  x_prev = x ;  x += h * v      (gravity etc.)
//     2. project every constraint once                        (positions only)
//     3. v = (x - x_prev) / h                                 (velocity update)
//     4. v *= 1 - damping * h                                 (mild damping)
// Nothing ever writes a velocity to make something happen; forces act on
// positions through constraints and the velocity is read back off the result.

import { CFG, TISSUE } from './config.js';

export const KIND = Object.freeze({
    BONE: 0, MEAT: 1, MEAT_BONE: 2, SKIN: 3, SKIN_BEND: 4, SPOKE: 5, FOOT: 6, MUSCLE: 7,
});
export const KIND_NAMES = ['bone', 'meat', 'meat-bone', 'skin', 'skin-bend', 'spoke', 'foot', 'muscle'];

const S = CFG.SOFT;

export class SoftBody {
    constructor(maxP = 256, maxC = 2048, maxRing = 64) {
        this.maxP = maxP; this.maxC = maxC;
        this.n = 0;
        // particles
        this.x = new Float32Array(maxP); this.y = new Float32Array(maxP);
        this.px = new Float32Array(maxP); this.py = new Float32Array(maxP);
        this.vx = new Float32Array(maxP); this.vy = new Float32Array(maxP);
        this.m = new Float32Array(maxP);      // mass
        this.w = new Float32Array(maxP);      // inverse mass
        this.rx = new Float32Array(maxP);     // rest position (already scaled)
        this.ry = new Float32Array(maxP);
        this.ax = new Float32Array(maxP);     // external acceleration, set per tick
        this.ay = new Float32Array(maxP);
        this.drag = new Float32Array(maxP);   // extra velocity damping, 1/s
        this.fric = new Float32Array(maxP);   // friction coefficient against the grid
        this.temp = new Float32Array(maxP);
        this.dose = new Float32Array(maxP);
        this.tissue = new Uint8Array(maxP);
        this.on = new Uint8Array(maxP);
        this.hit = new Uint8Array(maxP);      // touched something solid this tick
        this.fluidOut = new Uint8Array(maxP); // a blood particle that left through a wound
        // distance constraints
        this.nc = 0;
        this.ci = new Int16Array(maxC); this.cj = new Int16Array(maxC);
        this.cKind = new Uint8Array(maxC);
        this.cOn = new Uint8Array(maxC);
        this.cRest = new Float32Array(maxC);   // current rest length
        this.cAlpha = new Float32Array(maxC);  // current compliance
        this.cBase = new Float32Array(maxC);   // compliance before damage / sickness
        this.cStrain = new Float32Array(maxC);
        this.cDamage = new Float32Array(maxC);
        this.cMend = new Float32Array(maxC);   // seconds until a broken one knits
        // the closed skin ring, in order
        this.ring = new Int16Array(maxRing);
        this.ringEdge = new Int16Array(maxRing).fill(-1);   // constraint of edge e -> e+1
        this.ringN = 0;
        this.areaRest = 0;
        this.areaAlpha = S.ALPHA_AREA;
        this.area = 0;
        this._gx = new Float32Array(maxRing);
        this._gy = new Float32Array(maxRing);
        // shape-matching groups: a tissue bitmask and a compliance each
        this.groups = [];
        // fluid (blood) parameters
        this.fluidR = S.BLOOD_R;
        this.fluidCohR = S.BLOOD_COHESION_R;
        this.fluidWall = S.BLOOD_WALL;
        // mouse spring
        this.grabI = -1; this.grabX = 0; this.grabY = 0;
        // per-body settings
        this.gravity = S.GRAVITY;
        this.damping = S.DAMPING;
        this.peakStrainRate = 0;     // largest |d strain| over the last tick
        // a circular container that replaces grid collision (the egg)
        this.womb = null;
        // centre of the body, refreshed every substep (collision falls back on it)
        this.cx = 0; this.cy = 0;
    }

    reset() {
        this.n = 0; this.nc = 0; this.ringN = 0; this.groups.length = 0;
        this.grabI = -1; this.womb = null;
        this.on.fill(0); this.cOn.fill(0); this.fluidOut.fill(0);
        this.dose.fill(0); this.ax.fill(0); this.ay.fill(0); this.drag.fill(0);
    }

    addParticle(x, y, mass, tissue) {
        const i = this.n++;
        this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y;
        this.vx[i] = this.vy[i] = 0;
        this.m[i] = mass; this.w[i] = 1 / mass;
        this.rx[i] = x; this.ry[i] = y;
        this.tissue[i] = tissue;
        this.on[i] = 1;
        this.fric[i] = 0.5;
        this.temp[i] = CFG.THERMO.START;
        this.dose[i] = 0;
        return i;
    }

    clearConstraints() { this.nc = 0; this.ringEdge.fill(-1); }

    addConstraint(i, j, kind, alpha, rest) {
        if (this.nc >= this.maxC || i === j) return -1;
        const k = this.nc++;
        this.ci[k] = i; this.cj[k] = j;
        this.cKind[k] = kind;
        this.cOn[k] = 1;
        this.cBase[k] = this.cAlpha[k] = alpha;
        this.cRest[k] = rest;
        this.cStrain[k] = 0; this.cDamage[k] = 0; this.cMend[k] = 0;
        return k;
    }

    addGroup(mask, alpha) {
        const g = { mask, alpha, cx: 0, cy: 0, angle: 0, mass: 0 };
        this.groups.push(g);
        return g;
    }

    setMass(i, mass) { this.m[i] = mass; this.w[i] = 1 / mass; }

    // ---- one tick --------------------------------------------------------------
    step(dt, substeps, collide) {
        const h = dt / substeps, ih = 1 / h, ih2 = ih * ih;
        const n = this.n;
        const { x, y, px, py, vx, vy, ax, ay, on, drag } = this;
        const g = this.gravity;
        const keep = Math.max(0, 1 - this.damping * h);
        const vmax = S.MAX_SPEED;
        this.hit.fill(0, 0, n);
        this.peakStrainRate = 0;

        for (let s = 0; s < substeps; s++) {
            // 1. gravity and external forces, then predict
            for (let i = 0; i < n; i++) {
                if (!on[i]) continue;
                vx[i] += h * ax[i];
                vy[i] += h * (g + ay[i]);
                px[i] = x[i]; py[i] = y[i];
                x[i] += h * vx[i]; y[i] += h * vy[i];
            }

            // 2. constraint projection
            this.solveDistance(ih2, s === substeps - 1);
            this.solveFluid();
            if (this.ringN >= 3) this.solveArea(ih2);
            this.solveShape(ih2);
            if (this.grabI >= 0) this.solveGrab(ih2);
            if (collide) collide(this, h);

            // 3. velocity update, 4. damping
            for (let i = 0; i < n; i++) {
                if (!on[i]) continue;
                const k = keep * Math.max(0, 1 - drag[i] * h);
                let ux = (x[i] - px[i]) * ih * k, uy = (y[i] - py[i]) * ih * k;
                const sp = ux * ux + uy * uy;
                if (sp > vmax * vmax) { const f = vmax / Math.sqrt(sp); ux *= f; uy *= f; }
                vx[i] = ux; vy[i] = uy;
            }
        }
    }

    // Distance constraints: C = |x_i - x_j| - L. The gradient is the unit
    // vector along the constraint (+ at i, - at j), so the denominator is
    // just w_i + w_j + alpha~. Bone, meat, skin, spokes and muscles are all
    // this one constraint with different L and alpha; a muscle is one whose
    // L is being changed from outside.
    solveDistance(ih2, track) {
        const { x, y, w, ci, cj, cOn, cRest, cAlpha, cStrain } = this;
        let peak = this.peakStrainRate;
        for (let k = 0, nc = this.nc; k < nc; k++) {
            if (!cOn[k]) continue;
            const i = ci[k], j = cj[k];
            let ex = x[i] - x[j], ey = y[i] - y[j];
            const len = Math.sqrt(ex * ex + ey * ey);
            if (len < 1e-6) continue;
            const rest = cRest[k];
            const C = len - rest;
            const wi = w[i], wj = w[j];
            const dl = -C / (wi + wj + cAlpha[k] * ih2);
            ex /= len; ey /= len;
            x[i] += wi * dl * ex; y[i] += wi * dl * ey;
            x[j] -= wj * dl * ex; y[j] -= wj * dl * ey;
            if (track) {
                const st = C / rest;
                const d = st - cStrain[k];
                if (d > peak) peak = d; else if (-d > peak) peak = -d;
                cStrain[k] = st;
            }
        }
        this.peakStrainRate = peak;
    }

    // Area preservation on the skin polygon. With the ring p_0 .. p_{n-1},
    //
    //     A = 1/2 * sum_i (x_i * y_{i+1} - x_{i+1} * y_i)        (shoelace)
    //     C = A - A_rest
    //
    // Each vertex appears in two terms of the sum, which gives the gradient
    //
    //     dA/dx_i = 1/2 * (y_{i+1} - y_{i-1})
    //     dA/dy_i = 1/2 * (x_{i-1} - x_{i+1})
    //
    // i.e. half the vector between a vertex's two neighbours, rotated a
    // quarter turn: every vertex is pushed along its own outward normal, by
    // an amount proportional to the length of boundary it stands for. This
    // is internal pressure, and it is why squashing the animal makes it
    // bulge sideways instead of deflating.
    solveArea(ih2) {
        const { x, y, w, ring, _gx, _gy } = this;
        const n = this.ringN;
        let A = 0;
        for (let e = 0; e < n; e++) {
            const i = ring[e], j = ring[e + 1 === n ? 0 : e + 1];
            A += x[i] * y[j] - x[j] * y[i];
        }
        A *= 0.5;
        this.area = A;
        const C = A - this.areaRest;
        let denom = 0;
        for (let e = 0; e < n; e++) {
            const i = ring[e];
            const a = ring[e === 0 ? n - 1 : e - 1], b = ring[e + 1 === n ? 0 : e + 1];
            const gx = 0.5 * (y[b] - y[a]), gy = 0.5 * (x[a] - x[b]);
            _gx[e] = gx; _gy[e] = gy;
            denom += w[i] * (gx * gx + gy * gy);
        }
        denom += this.areaAlpha * ih2;
        if (denom < 1e-9) return;
        const dl = -C / denom;
        for (let e = 0; e < n; e++) {
            const i = ring[e];
            x[i] += w[i] * dl * _gx[e];
            y[i] += w[i] * dl * _gy[e];
        }
    }

    // Shape matching (Mueller, Heidelberger, Teschner, Gross 2005). For a
    // group of particles with rest offsets q_i (from the rest centre of
    // mass) and current offsets p_i (from the current one):
    //
    //     A_pq = sum_i m_i p_i q_i^T
    //
    // is the best linear map from rest to current in the least-squares
    // sense. Its polar decomposition A_pq = R S splits it into a rotation R
    // and a stretch S; throwing the stretch away leaves the best-fit RIGID
    // motion. In two dimensions the decomposition has a closed form -- R is
    // the rotation by
    //
    //     theta = atan2(A21 - A12, A11 + A22)
    //
    // Every particle is then pulled toward its goal g_i = c + R q_i. The
    // pull is an XPBD zero-length spring of compliance alpha to a target
    // treated as fixed for the substep, so dx_i = (g_i - x_i) / (1 + alpha~ m_i).
    //
    // With alpha ~ 0 the group is a rigid body that still translates and
    // rotates freely: that is the skeleton. With a large alpha it is a weak
    // memory of the rest shape the meat jiggles around and returns to.
    solveShape(ih2) {
        const { x, y, m, rx, ry, on, tissue } = this;
        const n = this.n;
        for (let gi = 0; gi < this.groups.length; gi++) {
            const grp = this.groups[gi];
            const mask = grp.mask;
            let M = 0, cx = 0, cy = 0, qx0 = 0, qy0 = 0;
            for (let i = 0; i < n; i++) {
                if (!on[i] || !((mask >> tissue[i]) & 1)) continue;
                const mi = m[i];
                M += mi; cx += mi * x[i]; cy += mi * y[i];
                qx0 += mi * rx[i]; qy0 += mi * ry[i];
            }
            if (M <= 0) continue;
            cx /= M; cy /= M; qx0 /= M; qy0 /= M;
            let a11 = 0, a12 = 0, a21 = 0, a22 = 0;
            for (let i = 0; i < n; i++) {
                if (!on[i] || !((mask >> tissue[i]) & 1)) continue;
                const mi = m[i];
                const dx = x[i] - cx, dy = y[i] - cy, qx = rx[i] - qx0, qy = ry[i] - qy0;
                a11 += mi * dx * qx; a12 += mi * dx * qy;
                a21 += mi * dy * qx; a22 += mi * dy * qy;
            }
            const ang = Math.atan2(a21 - a12, a11 + a22);
            const c = Math.cos(ang), s = Math.sin(ang);
            grp.cx = cx; grp.cy = cy; grp.angle = ang; grp.mass = M;
            grp.qx0 = qx0; grp.qy0 = qy0;
            const at = grp.alpha * ih2;
            for (let i = 0; i < n; i++) {
                if (!on[i] || !((mask >> tissue[i]) & 1)) continue;
                const qx = rx[i] - qx0, qy = ry[i] - qy0;
                const k = 1 / (1 + at * m[i]);
                x[i] += k * (cx + c * qx - s * qy - x[i]);
                y[i] += k * (cy + s * qx + c * qy - y[i]);
            }
            if (gi === 0) { this.cx = cx; this.cy = cy; }
        }
    }

    // Blood. Loose particles with a short-range repulsion (so they have a
    // volume and pile up) and a weak attraction just beyond it (so they pool
    // rather than disperse), then confined by the skin: a blood particle
    // outside the ring, or within fluidWall of it, is projected back along
    // the inward normal of the nearest edge. The projection is shared with
    // the two skin particles of that edge by inverse mass, so pooled blood
    // has weight and makes the belly sag.
    //
    // The one exception is an edge whose skin constraint is broken: a wound.
    // Nothing is projected back across it, and a particle that gets out is
    // flagged for the coupling layer to turn into a BLOOD cell.
    solveFluid() {
        const { x, y, w, on, tissue, ring, ringEdge, cOn } = this;
        const n = this.n, rn = this.ringN;
        const R = this.fluidR, R2 = R * R, RC = this.fluidCohR, RC2 = RC * RC;
        const BLOOD = TISSUE.BLOOD;
        for (let a = 0; a < n; a++) {
            if (!on[a] || tissue[a] !== BLOOD) continue;
            for (let b = a + 1; b < n; b++) {
                if (!on[b] || tissue[b] !== BLOOD) continue;
                let dx = x[b] - x[a], dy = y[b] - y[a];
                const d2 = dx * dx + dy * dy;
                if (d2 >= RC2) continue;
                let d = Math.sqrt(d2);
                if (d < 1e-4) { dx = 0.01; dy = 0.003 * (a - b); d = Math.sqrt(dx * dx + dy * dy); }
                const f = d2 < R2 ? (d - R) * S.BLOOD_REPEL * 0.5 / d : (d - R) * S.BLOOD_COHERE * 0.5 / d;
                x[a] += dx * f; y[a] += dy * f;
                x[b] -= dx * f; y[b] -= dy * f;
            }
        }
        if (rn < 3) return;
        const wall = this.fluidWall;
        for (let b = 0; b < n; b++) {
            if (!on[b] || tissue[b] !== BLOOD) continue;
            const X = x[b], Y = y[b];
            let inside = false, best = 1e30, be = 0, bt = 0, bqx = 0, bqy = 0;
            for (let e = 0; e < rn; e++) {
                const i = ring[e], j = ring[e + 1 === rn ? 0 : e + 1];
                const ax = x[i], ay = y[i], bx = x[j], by = y[j];
                // even-odd crossing test against a ray going +x
                if ((ay > Y) !== (by > Y) && X < (bx - ax) * (Y - ay) / (by - ay) + ax) inside = !inside;
                const ex = bx - ax, ey = by - ay;
                const l2 = ex * ex + ey * ey;
                let t = l2 > 1e-9 ? ((X - ax) * ex + (Y - ay) * ey) / l2 : 0;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                const qx = ax + ex * t, qy = ay + ey * t;
                const d2 = (X - qx) * (X - qx) + (Y - qy) * (Y - qy);
                if (d2 < best) { best = d2; be = e; bt = t; bqx = qx; bqy = qy; }
            }
            const ek = ringEdge[be];
            if (ek >= 0 && !cOn[ek]) {
                if (!inside) this.fluidOut[b] = 1;
                continue;
            }
            const d = Math.sqrt(best);
            let nx = X - bqx, ny = Y - bqy;
            if (d > 1e-5) { nx /= d; ny /= d; } else { nx = this.cx - X; ny = this.cy - Y; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; }
            if (!inside) { nx = -nx; ny = -ny; }
            const pen = inside ? wall - d : wall + d;
            if (pen <= 0) continue;
            const i = ring[be], j = ring[be + 1 === rn ? 0 : be + 1];
            const wb = w[b], s0 = 1 - bt, s1 = bt;
            const denom = wb + s0 * s0 * w[i] + s1 * s1 * w[j];
            if (denom < 1e-9) continue;
            const c = pen / denom;
            x[b] += nx * c * wb; y[b] += ny * c * wb;
            x[i] -= nx * c * w[i] * s0; y[i] -= ny * c * w[i] * s0;
            x[j] -= nx * c * w[j] * s1; y[j] -= ny * c * w[j] * s1;
        }
    }

    solveGrab(ih2) {
        const i = this.grabI;
        if (!this.on[i]) { this.grabI = -1; return; }
        const k = this.w[i] / (this.w[i] + S.GRAB_ALPHA * ih2);
        this.x[i] += (this.grabX - this.x[i]) * k;
        this.y[i] += (this.grabY - this.y[i]) * k;
    }

    // ---- geometry helpers --------------------------------------------------------
    ringArea() {
        const { x, y, ring } = this;
        const n = this.ringN;
        let A = 0;
        for (let e = 0; e < n; e++) {
            const i = ring[e], j = ring[e + 1 === n ? 0 : e + 1];
            A += x[i] * y[j] - x[j] * y[i];
        }
        return 0.5 * A;
    }

    restRingArea() {
        const { rx, ry, ring } = this;
        const n = this.ringN;
        let A = 0;
        for (let e = 0; e < n; e++) {
            const i = ring[e], j = ring[e + 1 === n ? 0 : e + 1];
            A += rx[i] * ry[j] - rx[j] * ry[i];
        }
        return 0.5 * A;
    }

    contains(X, Y) {
        const { x, y, ring } = this;
        const n = this.ringN;
        let inside = false;
        for (let e = 0; e < n; e++) {
            const i = ring[e], j = ring[e + 1 === n ? 0 : e + 1];
            if ((y[i] > Y) !== (y[j] > Y) && X < (x[j] - x[i]) * (Y - y[i]) / (y[j] - y[i]) + x[i]) inside = !inside;
        }
        return inside;
    }

    bounds(out) {
        const { x, y, on } = this;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let i = 0; i < this.n; i++) {
            if (!on[i]) continue;
            if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i];
            if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i];
        }
        out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1;
        return out;
    }

    nearest(X, Y, tissueMask) {
        const { x, y, on, tissue } = this;
        let best = 1e30, bi = -1;
        for (let i = 0; i < this.n; i++) {
            if (!on[i] || !((tissueMask >> tissue[i]) & 1)) continue;
            const d = (x[i] - X) * (x[i] - X) + (y[i] - Y) * (y[i] - Y);
            if (d < best) { best = d; bi = i; }
        }
        this._nearestD2 = best;
        return bi;
    }

    translate(dx, dy) {
        for (let i = 0; i < this.n; i++) {
            this.x[i] += dx; this.px[i] += dx;
            this.y[i] += dy; this.py[i] += dy;
        }
    }

    finite() {
        for (let i = 0; i < this.n; i++) {
            if (this.on[i] && !(Number.isFinite(this.x[i]) && Number.isFinite(this.y[i]))) return false;
        }
        return true;
    }
}

// Keep the ring particles of `a` out of the polygon of `b`: any vertex of a
// found inside b is moved to b's nearest edge, with the correction shared by
// inverse mass between the vertex and that edge. Run both ways round it is a
// soft-body / soft-body collision. (It is the blood confinement turned
// inside out.)
export function pushOut(a, b) {
    const rn = b.ringN;
    if (rn < 3) return false;
    let touched = false;
    for (let e0 = 0; e0 < a.ringN; e0++) {
        const p = a.ring[e0];
        const X = a.x[p], Y = a.y[p];
        if (!b.contains(X, Y)) continue;
        let best = 1e30, be = 0, bt = 0, bqx = 0, bqy = 0;
        for (let e = 0; e < rn; e++) {
            const i = b.ring[e], j = b.ring[e + 1 === rn ? 0 : e + 1];
            const ax = b.x[i], ay = b.y[i];
            const ex = b.x[j] - ax, ey = b.y[j] - ay;
            const l2 = ex * ex + ey * ey;
            let t = l2 > 1e-9 ? ((X - ax) * ex + (Y - ay) * ey) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + ex * t, qy = ay + ey * t;
            const d2 = (X - qx) * (X - qx) + (Y - qy) * (Y - qy);
            if (d2 < best) { best = d2; be = e; bt = t; bqx = qx; bqy = qy; }
        }
        const i = b.ring[be], j = b.ring[be + 1 === rn ? 0 : be + 1];
        const s0 = 1 - bt, s1 = bt;
        const wp = a.w[p];
        const denom = wp + s0 * s0 * b.w[i] + s1 * s1 * b.w[j];
        if (denom < 1e-9) continue;
        const dx = (bqx - X) / denom, dy = (bqy - Y) / denom;
        a.x[p] += dx * wp; a.y[p] += dy * wp;
        b.x[i] -= dx * b.w[i] * s0; b.y[i] -= dy * b.w[i] * s0;
        b.x[j] -= dx * b.w[j] * s1; b.y[j] -= dy * b.w[j] * s1;
        a.hit[p] = 2;
        touched = true;
    }
    return touched;
}
