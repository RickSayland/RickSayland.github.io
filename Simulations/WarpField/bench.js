// ============ WARP FIELD ENGINEERING — THE WORKSHOP BENCH ============
// Draws a finished analysis. Owns no physics.
//
// Three views of one field over the meridional plane (the plane containing
// the axis of motion — every drive here is symmetric about that axis):
// a wireframe surface, a heat map, and profiles along the axis and through
// the equator. The radius is drawn in the engine's stretched coordinate, so
// a 10 cm wall on a 100 m bubble is as wide on screen as it is important;
// labels always give true radii. Drawn from a snapshot of the last complete
// analysis, so a rebuild in progress never shows a half-filled grid.

const FIELDS = {
    rho:   { label: 'Eulerian energy density', unit: 'J/m³', kind: 'div', src: 'rho', scale: 'energy' },
    nec:   { label: 'Null energy condition — worst light ray', unit: 'J/m³', kind: 'nec', src: 'nec', scale: 'energy' },
    york:  { label: 'York time θ — expansion of volume', unit: 's⁻¹', kind: 'div', src: 'york', scale: 'rate' },
    mom:   { label: 'Momentum density (energy flux through the wall)', unit: 'W/m²', kind: 'seq', src: 'mom', scale: 'flux' },
    clock: { label: 'Clock rate, at rest in the bubble frame', unit: '', kind: 'clock', src: 'clock', scale: 'none' },
    shift: { label: 'Shift — speed of the flow of space', unit: 'c', kind: 'shift', src: 'shift', scale: 'none' }
};

function mixColor(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const COL = {
    base: [14, 22, 36], violet: [169, 139, 255], amber: [255, 181, 71], cyan: [95, 212, 255],
    red: [255, 79, 79], teal: [63, 208, 176], white: [230, 240, 255]
};

// Colour for a normalised value. Returns [r, g, b].
function fieldColor(kind, t) {
    switch (kind) {
        case 'div': return t < 0 ? mixColor(COL.base, COL.violet, Math.sqrt(-t)) : mixColor(COL.base, COL.amber, Math.sqrt(t));
        case 'nec': return t < 0 ? mixColor([60, 14, 18], COL.red, 0.35 + 0.65 * Math.sqrt(-t)) : mixColor(COL.base, COL.teal, Math.sqrt(t));
        case 'seq': return mixColor(COL.base, COL.cyan, Math.pow(Math.max(t, 0), 0.5));
        case 'clock': return mixColor([60, 30, 90], COL.cyan, t);
        case 'shift': return t > 1 ? mixColor(COL.amber, COL.red, Math.min(1, (t - 1) * 2)) : mixColor(COL.base, COL.cyan, t);
    }
    return COL.white;
}
const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

// Read one field of a snapshot. `mom` is the magnitude of the momentum
// density; everything else is stored directly.
// Energy-condition margins inside the engine's tolerance are zero, not
// violations: drawn raw, the vacuum outside a shell speckled red with
// round-off at a part in 10⁸.
function snapValue(snap, field, i) {
    const f = snap.f;
    if (field === 'mom') return Math.hypot(f.jx[i], f.jy[i]);
    const v = f[field][i];
    if (field === 'nec' && v > -snap.totals.tol) return Math.max(v, 0);
    return v;
}

function snapSample(snap, field, rr, t) {
    const { r, nr, nth } = snap.grid;
    if (t < 0) t = -t;
    if (t > Math.PI) t = 2 * Math.PI - t;
    let lo = 0, hi = nr - 1;
    if (rr <= r[0]) { hi = 0; }
    else if (rr >= r[nr - 1]) { lo = hi = nr - 1; }
    else {
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (r[mid] > rr) hi = mid; else lo = mid;
        }
    }
    const fr = hi === lo ? 0 : (rr - r[lo]) / (r[hi] - r[lo]);
    let tj = t / Math.PI * nth - 0.5;
    if (tj < 0) tj = 0;
    if (tj > nth - 1) tj = nth - 1;
    const j0 = Math.floor(tj), j1 = Math.min(nth - 1, j0 + 1), ft = tj - j0;
    const v = (i, j) => snapValue(snap, field, i * nth + j);
    const a = v(lo, j0) * (1 - ft) + v(lo, j1) * ft;
    const b = v(hi, j0) * (1 - ft) + v(hi, j1) * ft;
    return a * (1 - fr) + b * fr;
}

const bench = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    field: 'rho',
    yaw: -0.75, pitch: 0.62,
    dragAt: -1e9,
    heatCache: null,
    snap: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
        let drag = null;
        canvas.addEventListener('pointerdown', e => {
            drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', e => {
            if (!drag) return;
            this.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
            this.pitch = Math.max(0.08, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.006));
            this.dragAt = performance.now();
        });
        const end = () => { drag = null; };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
    },

    resize() {
        const r = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = Math.max(1, r.width);
        this.H = Math.max(1, r.height);
        this.canvas.width = Math.round(this.W * this.dpr);
        this.canvas.height = Math.round(this.H * this.dpr);
        this.heatCache = null;
    },

    setSnapshot(snap) {
        this.snap = snap;
        this.heatCache = null;
    },

    // ---- The stretched radius ----
    // Display radius in [0, 1] for true radius r (code units): the node index,
    // interpolated. Node spacing follows the geometry, so this magnifies
    // exactly where the geometry changes.
    xi(snap, rr) {
        const { r, nr } = snap.grid;
        if (rr <= r[0]) return (rr / r[0]) / nr;
        if (rr >= r[nr - 1]) return 1;
        let lo = 0, hi = nr - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (r[mid] > rr) hi = mid; else lo = mid;
        }
        return (1 + lo + (rr - r[lo]) / (r[hi] - r[lo])) / nr;
    },
    xiInv(snap, x) {
        const { r, nr } = snap.grid;
        const u = x * nr;
        if (u <= 1) return u * r[0];
        const i = Math.min(nr - 2, Math.floor(u - 1));
        const f = u - 1 - i;
        return r[i] + f * (r[i + 1] - r[i]);
    },

    fieldRange(snap, field) {
        const n = snap.grid.nr * snap.grid.nth;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < n; i++) {
            const v = snapValue(snap, field, i);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        return { lo, hi, abs: Math.max(Math.abs(lo), Math.abs(hi)) || 1 };
    },

    // Normalised value for colouring and height.
    norm(field, v, rng) {
        const k = FIELDS[field].kind;
        if (k === 'clock') return v;
        if (k === 'shift') return v;
        if (k === 'seq') return v / (rng.hi || 1);
        return v / rng.abs;
    },

    // SI conversion for labels.
    toSI(snap, field, v) {
        const L = snap.metric.L;
        switch (FIELDS[field].scale) {
            case 'energy': return v * PHYS.C4G / (L * L);
            case 'rate': return v * PHYS.c / L;
            case 'flux': return v * PHYS.C4G * PHYS.c / (L * L);
        }
        return v;
    },

    // ---- Frame ----

    draw(now) {
        const ctx = this.ctx, W = this.W, H = this.H;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = '#03050a';
        ctx.fillRect(0, 0, W, H);
        const snap = this.snap;
        if (!snap) {
            ctx.fillStyle = '#5d6e85';
            ctx.font = '13px "Share Tech Mono", monospace';
            ctx.fillText('analysing the metric…', 20, 70);
            return;
        }
        if (now - this.dragAt > 4000) this.yaw += 0.0025;

        const top = 46, bottom = 30;
        const prof = Math.max(96, Math.min(170, H * 0.24));
        const mainH = H - top - prof - bottom - 10;
        const heatS = Math.min(mainH, W * 0.44);
        const meshW = W - heatS - 30;
        const rng = this.fieldRange(snap, this.field);

        this.drawMesh(snap, rng, 12, top, meshW, mainH);
        this.drawHeat(ctx, snap, this.field, W - heatS - 14, top, heatS, rng, true);
        this.drawProfiles(snap, rng, 14, top + mainH + 10, W - 28, prof);
    },

    // ---- Wireframe surface ----

    drawMesh(snap, rng, x0, y0, w, h) {
        const ctx = this.ctx;
        const field = this.field, kind = FIELDS[field].kind;
        const { nr, nth, th, r } = snap.grid;
        const cx = x0 + w / 2, cy = y0 + h * 0.55;
        const S = Math.min(w * 0.45, h * 0.62);
        const cyaw = Math.cos(this.yaw), syaw = Math.sin(this.yaw);
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
        const hScale = kind === 'clock' || kind === 'shift' ? 0.32 : 0.42;
        const proj = (X, Y, Z, out) => {
            const Xr = X * cyaw - Y * syaw, Yr = X * syaw + Y * cyaw;
            const depth = Yr * cp - Z * sp;
            const s = S / (1 + 0.18 * depth);
            out[0] = cx + Xr * s;
            out[1] = cy - (Z * cp + Yr * sp) * s;
            return out;
        };
        const height = v => {
            if (kind === 'clock') return (v - 1) * 1.6 * hScale;
            if (kind === 'shift') return Math.min(v, 2) * 0.5 * hScale * 1.4;
            return this.norm(field, v, rng) * hScale;
        };

        // Rings: evenly spaced in the stretched coordinate.
        const nRing = Math.min(nr, 64);
        const rings = [];
        for (let k = 0; k < nRing; k++) rings.push(Math.round((k + 1) / nRing * (nr - 1)));
        const spokes = [];
        for (let j = 0; j < nth; j++) spokes.push({ j, sgn: 1 });
        for (let j = nth - 1; j >= 0; j--) spokes.push({ j, sgn: -1 });

        const pts = new Float64Array(nRing * spokes.length * 2);
        const vals = new Float64Array(nRing * spokes.length);
        const tmp = [0, 0];
        for (let a = 0; a < nRing; a++) {
            const i = rings[a];
            const xr = (1 + i) / nr;
            for (let b = 0; b < spokes.length; b++) {
                const { j, sgn } = spokes[b];
                const t = th[j] * sgn;
                const v = snapValue(snap, field, i * nth + j);
                proj(xr * Math.cos(t), xr * Math.sin(t), height(v), tmp);
                const k = a * spokes.length + b;
                pts[k * 2] = tmp[0]; pts[k * 2 + 1] = tmp[1];
                vals[k] = v;
            }
        }

        // Floor first: rim, walls, horizon, payload, direction of travel.
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(80,110,150,0.25)';
        ctx.beginPath();
        for (let q = 0; q <= 96; q++) {
            const t = q / 96 * 2 * Math.PI;
            proj(Math.cos(t), Math.sin(t), 0, tmp);
            q ? ctx.lineTo(tmp[0], tmp[1]) : ctx.moveTo(tmp[0], tmp[1]);
        }
        ctx.stroke();
        const a0 = proj(-1.08, 0, 0, [0, 0]), a1 = proj(1.18, 0, 0, [0, 0]);
        ctx.strokeStyle = 'rgba(95,212,255,0.45)';
        ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
        const ah = proj(1.1, 0.04, 0, [0, 0]), ah2 = proj(1.1, -0.04, 0, [0, 0]);
        ctx.fillStyle = 'rgba(95,212,255,0.7)';
        ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(ah[0], ah[1]); ctx.lineTo(ah2[0], ah2[1]); ctx.fill();
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.fillText('direction of travel', a1[0] + 6, a1[1] + 3);
        this.floorOverlays(snap, (X, Y) => proj(X, Y, 0, [0, 0]));
        ctx.restore();

        // Mesh, bucketed by colour so it goes down in a few dozen strokes.
        const NB = 24;
        const buckets = Array.from({ length: NB }, () => []);
        const bucketOf = v => {
            let t = this.norm(field, v, rng);
            if (kind === 'clock' || kind === 'seq') t = t * 2 - 1;
            if (kind === 'shift') t = Math.min(v, 2) - 1;
            return Math.max(0, Math.min(NB - 1, Math.floor((t + 1) / 2 * NB)));
        };
        const nS = spokes.length;
        for (let a = 0; a < nRing; a++) {
            for (let b = 0; b < nS; b++) {
                const k = a * nS + b, kr = a * nS + (b + 1) % nS;
                buckets[bucketOf(0.5 * (vals[k] + vals[kr]))].push(k, kr);
                if (a + 1 < nRing) {
                    const ko = (a + 1) * nS + b;
                    buckets[bucketOf(0.5 * (vals[k] + vals[ko]))].push(k, ko);
                }
            }
        }
        ctx.lineWidth = 0.9;
        for (let q = 0; q < NB; q++) {
            const list = buckets[q];
            if (!list.length) continue;
            const tq = (q + 0.5) / NB * 2 - 1;
            let c;
            if (kind === 'clock' || kind === 'seq') c = fieldColor(kind, (tq + 1) / 2);
            else if (kind === 'shift') c = fieldColor(kind, tq + 1);
            else c = fieldColor(kind, tq);
            const lift = mixColor(c, COL.white, 0.15);
            ctx.strokeStyle = rgb(lift);
            ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, Math.abs(tq) * 1.4 + 0.15);
            ctx.beginPath();
            for (let m = 0; m < list.length; m += 2) {
                ctx.moveTo(pts[list[m] * 2], pts[list[m] * 2 + 1]);
                ctx.lineTo(pts[list[m + 1] * 2], pts[list[m + 1] * 2 + 1]);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        ctx.fillStyle = '#8193ab';
        ctx.font = '11px Oswald, sans-serif';
        ctx.fillText(FIELDS[field].label.toUpperCase(), x0 + 4, y0 + 14);
        ctx.fillStyle = '#5d6e85';
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.fillText('drag to turn · radius stretched about the walls', x0 + 4, y0 + 28);
    },

    // Overlays drawn on the floor of any view: wall radii, the payload, and
    // the surface where the flow of space reaches light speed.
    floorOverlays(snap, P) {
        const ctx = this.ctx;
        const m = snap.metric;
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(160,180,210,0.35)';
        for (const f of m.features.slice(0, m.kind === 'shell' ? 2 : 1)) {
            const x = this.xi(snap, f.r);
            ctx.beginPath();
            for (let q = 0; q <= 72; q++) {
                const t = q / 72 * 2 * Math.PI;
                const p = P(x * Math.cos(t), x * Math.sin(t));
                q ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Payload: a 12 m crew module, drawn to (stretched) scale.
        const hl = this.xi(snap, PAYLOAD_HALF / m.L), hw = this.xi(snap, 2.2 / m.L);
        const inWall = m.flatRadius < PAYLOAD_HALF;
        ctx.fillStyle = inWall ? 'rgba(255,79,79,0.8)' : 'rgba(215,225,240,0.85)';
        ctx.beginPath();
        const poly = [[-hl, -hw], [hl * 0.7, -hw], [hl, 0], [hl * 0.7, hw], [-hl, hw]];
        poly.forEach((q, k) => { const p = P(q[0], q[1]); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
        ctx.closePath();
        ctx.fill();

        // Light-speed surface: where the shift crosses 1, spoke by spoke.
        const { nr, nth, th, r } = snap.grid;
        const f = snap.f.shift;
        const hits = [];
        for (let j = 0; j < nth; j++) {
            for (let i = 1; i < nr; i++) {
                const a = f[(i - 1) * nth + j], b = f[i * nth + j];
                if ((a - 1) * (b - 1) < 0) {
                    const rr = r[i - 1] + (1 - a) / (b - a) * (r[i] - r[i - 1]);
                    hits.push([this.xi(snap, rr), th[j]]);
                }
            }
        }
        if (hits.length) {
            ctx.fillStyle = 'rgba(255,79,79,0.9)';
            for (const [x, t] of hits) {
                for (const s of [1, -1]) {
                    const p = P(x * Math.cos(t), s * x * Math.sin(t));
                    ctx.fillRect(p[0] - 1.2, p[1] - 1.2, 2.4, 2.4);
                }
            }
        }
        return hits.length > 0;
    },

    // ---- Heat map of the meridional slice ----

    drawHeat(ctx, snap, field, x0, y0, size, rng, full) {
        const N = Math.max(60, Math.min(300, Math.round(size)));
        const key = field + '|' + N + '|' + snap.id;
        let cache = full ? this.heatCache : this.miniCache;
        if (!cache || cache.key !== key) {
            const cv = document.createElement('canvas');
            cv.width = N; cv.height = N;
            const c2 = cv.getContext('2d');
            const img = c2.createImageData(N, N);
            const kind = FIELDS[field].kind;
            for (let py = 0; py < N; py++) {
                for (let px = 0; px < N; px++) {
                    const u = (px + 0.5) / N * 2 - 1, v = 1 - (py + 0.5) / N * 2;
                    const d = Math.hypot(u, v);
                    const o = (py * N + px) * 4;
                    if (d > 1) { img.data[o + 3] = 0; continue; }
                    const rr = this.xiInv(snap, d);
                    const val = snapSample(snap, field, rr, Math.atan2(Math.abs(v), u));
                    let t = this.norm(field, val, rng);
                    const c = fieldColor(kind, t);
                    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
                }
            }
            c2.putImageData(img, 0, 0);
            cache = { key, cv };
            if (full) this.heatCache = cache; else this.miniCache = cache;
        }
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(cache.cv, x0, y0, size, size);
        const cx = x0 + size / 2, cy = y0 + size / 2, R = size / 2;
        const P = (X, Y) => [cx + X * R, cy - Y * R];
        const saved = this.ctx;
        this.ctx = ctx;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(95,212,255,0.4)';
        ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
        ctx.fillStyle = 'rgba(95,212,255,0.7)';
        ctx.beginPath(); ctx.moveTo(cx + R, cy); ctx.lineTo(cx + R - 7, cy - 4); ctx.lineTo(cx + R - 7, cy + 4); ctx.fill();
        this.floorOverlays(snap, P);
        this.ctx = saved;

        if (full) {
            // Radius labels at the walls.
            ctx.font = '10px "Share Tech Mono", monospace';
            ctx.fillStyle = '#8193ab';
            const m = snap.metric;
            const feats = m.kind === 'shell'
                ? [['R₁', m.params.R1], ['R₂', m.params.R2]]
                : [['R', m.params.R]];
            feats.forEach(([n, val], k) => {
                const x = this.xi(snap, val / m.L);
                ctx.fillText(`${n} ${fmtLen(val)}`, cx + x * R * 0.72 + 4, cy - x * R * 0.72 - 4 - k * 12);
            });
            ctx.fillStyle = '#5d6e85';
            ctx.fillText('meridional slice · bow →', x0, y0 + size + 13);
            this.legend(ctx, snap, field, rng, x0, y0 + size + 18, size);
        }
        ctx.restore();
    },

    legend(ctx, snap, field, rng, x, y, w) {
        const kind = FIELDS[field].kind;
        const h = 7;
        for (let i = 0; i < w; i++) {
            const t = i / (w - 1);
            let c;
            if (kind === 'div' || kind === 'nec') c = fieldColor(kind, t * 2 - 1);
            else if (kind === 'shift') c = fieldColor(kind, t * 2);
            else c = fieldColor(kind, t);
            ctx.fillStyle = rgb(c);
            ctx.fillRect(x + i, y, 1, h);
        }
        ctx.font = '10px "Share Tech Mono", monospace';
        ctx.fillStyle = '#8193ab';
        const u = FIELDS[field].unit;
        let lo, hi;
        if (kind === 'div' || kind === 'nec') { lo = -rng.abs; hi = rng.abs; }
        else if (kind === 'shift') { lo = 0; hi = 2; }
        else if (kind === 'clock') { lo = 0; hi = 1; }
        else { lo = 0; hi = rng.hi; }
        const L = this.toSI(snap, field, lo), Hh = this.toSI(snap, field, hi);
        ctx.textAlign = 'left';
        ctx.fillText(fmtSci(L, 2) + (u ? ' ' + u : ''), x, y + h + 11);
        ctx.textAlign = 'right';
        ctx.fillText(fmtSci(Hh, 2) + (u ? ' ' + u : ''), x + w, y + h + 11);
        if (kind === 'shift') { ctx.textAlign = 'center'; ctx.fillText('c', x + w / 2, y + h + 11); }
        ctx.textAlign = 'left';
    },

    // ---- Profiles ----

    drawProfiles(snap, rng, x0, y0, w, h) {
        const ctx = this.ctx;
        const field = this.field, kind = FIELDS[field].kind;
        const { nr, nth } = snap.grid;
        const gap = 24;
        const w1 = (w - gap) * 0.6, w2 = w - gap - w1;
        const val = (i, j) => snapValue(snap, field, i * nth + j);
        const yOf = (v, top, hh) => {
            let t;
            if (kind === 'clock') t = v * 2 - 1;
            else if (kind === 'shift') t = Math.min(v, 2) - 1;
            else if (kind === 'seq') t = v / (rng.hi || 1) * 2 - 1;
            else t = v / rng.abs;
            return top + hh / 2 - t * (hh / 2 - 4);
        };
        const panel = (px, pw, title, series) => {
            ctx.fillStyle = '#070b12';
            ctx.fillRect(px, y0, pw, h);
            ctx.strokeStyle = '#1a2536';
            ctx.strokeRect(px + 0.5, y0 + 0.5, pw - 1, h - 1);
            ctx.strokeStyle = 'rgba(120,140,170,0.25)';
            ctx.beginPath(); ctx.moveTo(px, yOf(kind === 'clock' ? 0.5 : kind === 'shift' ? 1 : kind === 'seq' ? rng.hi / 2 : 0, y0, h)); ctx.lineTo(px + pw, yOf(kind === 'clock' ? 0.5 : kind === 'shift' ? 1 : kind === 'seq' ? rng.hi / 2 : 0, y0, h)); ctx.stroke();
            for (const s of series) {
                ctx.strokeStyle = s.color;
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                s.pts.forEach(([u, v], k) => {
                    const X = px + u * pw, Y = yOf(v, y0, h);
                    k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
                });
                ctx.stroke();
            }
            ctx.fillStyle = '#8193ab';
            ctx.font = '10px Oswald, sans-serif';
            ctx.fillText(title, px + 6, y0 + 13);
        };
        // Along the axis of motion: rear half mirrored to the left.
        const axis = [];
        for (let i = nr - 1; i >= 0; i--) axis.push([0.5 - 0.5 * (1 + i) / nr, val(i, nth - 1)]);
        for (let i = 0; i < nr; i++) axis.push([0.5 + 0.5 * (1 + i) / nr, val(i, 0)]);
        panel(x0, w1, 'ALONG THE AXIS OF MOTION   ← rear · centre · bow →', [{ pts: axis, color: '#5fd4ff' }]);
        const eq = [];
        for (let i = 0; i < nr; i++) eq.push([(1 + i) / nr, val(i, nth >> 1)]);
        panel(x0 + w1 + gap, w2, 'THROUGH THE EQUATOR   centre → out', [{ pts: eq, color: '#ffb547' }]);

        // True-radius ticks at the walls.
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillStyle = '#5d6e85';
        const m = snap.metric;
        const feats = m.kind === 'shell' ? [m.params.R1, m.params.R2] : [m.params.R];
        for (const R of feats) {
            const x = this.xi(snap, R / m.L);
            for (const X of [x0 + w1 * (0.5 + 0.5 * x), x0 + w1 * (0.5 - 0.5 * x), x0 + w1 + gap + w2 * x]) {
                ctx.fillRect(X, y0 + h - 5, 1, 5);
            }
            ctx.fillText(fmtLen(R), x0 + w1 + gap + w2 * x + 3, y0 + h - 3);
        }
    }
};

function fmtLen(m) {
    const a = Math.abs(m);
    if (a >= 1e3) return (m / 1e3).toFixed(a >= 1e4 ? 0 : 1) + ' km';
    if (a >= 1) return m.toFixed(a >= 100 ? 0 : 1) + ' m';
    if (a >= 1e-2) return (m * 100).toFixed(1) + ' cm';
    if (a >= 1e-3) return (m * 1e3).toFixed(1) + ' mm';
    return fmtSci(m, 2) + ' m';
}
