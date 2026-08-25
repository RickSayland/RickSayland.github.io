// ============ GEODYNAMO — THE MERIDIONAL VIEW ============
// A slice through the planet from pole to pole, which is the one cut that shows
// what a dynamo is doing. Two fields are drawn at once and they are physically
// different animals:
//
//   TOROIDAL (the colour wash) runs east-west around the axis. It is the
//   stronger of the two and it never leaves the core — an insulating mantle
//   cannot carry the current that would let it out — so no instrument on the
//   surface has ever measured it. This is the part you can only see in a model.
//
//   POLOIDAL (the lines) loops through the meridional plane. Contours of
//   r*sin(theta)*A are exactly the field lines, and outside the core they are
//   continued analytically from the harmonic coefficients rather than being
//   guessed, so a line leaving the core-mantle boundary is the same line that
//   reaches the surface and points a compass.
//
// The picture is mirrored about the axis because the model is axisymmetric: the
// left half is the right half, not a second independent solution.

const meridian = {
    R_MAX: 2.12,          // core radii shown; the surface is at 1.83
    N_EXT: 26,            // exterior rings used for the field-line continuation
    N_LEVELS: 6,          // contour levels per polarity at reference strength
    MAX_LEVELS: 16,

    canvas: null, ctx: null,
    buf: null, bufCtx: null, img: null, data: null,
    psi: null, aExt: null,
    // Both references start at zero and snap to the first frame they see, then
    // crawl. They have to be SLOW — several seconds — or they track the field
    // they are supposed to be measuring it against, and a reversal stops looking
    // like anything at all.
    psiRef: 0, torRef: 0,
    hover: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.buf = document.createElement('canvas');
        this.bufCtx = this.buf.getContext('2d', { willReadFrequently: true });

        const NRT = dynamo.NR + this.N_EXT;
        this.NRT = NRT;
        this.psi = new Float64Array(NRT * dynamo.NTH);

        // Radii of the combined grid: the solver's shell, then rings out to
        // R_MAX stretched geometrically so the near field gets the detail.
        this.R = new Float64Array(NRT);
        for (let i = 0; i < dynamo.NR; i++) this.R[i] = dynamo.r[i];
        for (let e = 1; e <= this.N_EXT; e++) {
            const f = e / this.N_EXT;
            this.R[dynamo.NR - 1 + e] = 1 + (this.R_MAX - 1) * f * f;
        }
        this.TH = new Float64Array(dynamo.NTH);
        for (let j = 0; j < dynamo.NTH; j++) this.TH[j] = (j + 0.5) * dynamo.dth;

        this.resize();
    },

    resize() {
        const c = this.canvas;
        const rect = c.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(320, Math.round(rect.width)), h = Math.max(280, Math.round(rect.height));
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        this.w = w; this.h = h; this.dpr = dpr;
        this.cx = w / 2;
        this.cy = h / 2;
        this.S = Math.min(w, h) / 2 / this.R_MAX * 0.97;

        // The toroidal wash is painted into a small buffer and scaled up. The
        // field is smooth, so the interpolation costs nothing visually and the
        // per-pixel sampling drops by a factor of five.
        const bw = Math.min(340, Math.round(w / 2.2)), bh = Math.min(340, Math.round(h / 2.2));
        this.buf.width = bw; this.buf.height = bh;
        this.img = this.bufCtx.createImageData(bw, bh);
        this.data = this.img.data;
        this.buildMap(bw, bh);
        this.buildStreaks();
    },

    // Screen pixel -> grid cell, resolved once per resize. Per frame this
    // becomes four multiply-adds instead of two trig calls.
    buildMap(bw, bh) {
        const n = bw * bh;
        this.mi = new Int16Array(n);
        this.mj = new Int16Array(n);
        this.mfr = new Float32Array(n);
        this.mft = new Float32Array(n);
        this.mIn = new Uint8Array(n);
        this.mS = new Float32Array(n);     // cylindrical radius, for the streaks

        const NR = dynamo.NR, NTH = dynamo.NTH;
        for (let py = 0; py < bh; py++) {
            for (let px = 0; px < bw; px++) {
                const k = py * bw + px;
                // Buffer spans the same world box as the canvas.
                const x = (px + 0.5 - bw / 2) / (this.S * bw / this.w);
                const y = -(py + 0.5 - bh / 2) / (this.S * bh / this.h);
                const ax = Math.abs(x);
                const r = Math.hypot(ax, y);
                if (r < dynamo.R_IN || r > 1) { this.mIn[k] = 0; continue; }
                const colat = Math.atan2(ax, y);
                const fi = (r - dynamo.R_IN) / dynamo.dr;
                const fj = colat / dynamo.dth - 0.5;
                let i = Math.floor(fi), j = Math.floor(fj);
                i = Math.max(0, Math.min(NR - 2, i));
                j = Math.max(0, Math.min(NTH - 2, j));
                this.mi[k] = i; this.mj[k] = j;
                this.mfr[k] = Math.max(0, Math.min(1, fi - i));
                this.mft[k] = Math.max(0, Math.min(1, fj - j));
                this.mIn[k] = 1;
                this.mS[k] = ax;
            }
        }
        this.bw = bw; this.bh = bh;
    },

    // Convection is PARAMETERISED in this model, not resolved — alpha stands in
    // for it. These streaks are therefore a legend, not a simulation: they mark
    // the columns aligned with the rotation axis that rapid rotation organises
    // the flow into, drifting along the axis in alternating directions.
    buildStreaks() {
        this.streaks = [];
        const tc = dynamo.R_IN;
        for (let n = 0; n < 26; n++) {
            const s = tc + 0.03 + (n / 26) * (0.97 - tc);
            this.streaks.push({ s, dir: n % 2 ? 1 : -1, phase: (n * 0.37) % 1 });
        }
    },

    // ---- Frame ----

    draw(now) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        ctx.clearRect(0, 0, this.w, this.h);

        this.drawSpace(ctx);
        this.drawBody(ctx);
        this.paintToroidal();
        ctx.drawImage(this.buf, 0, 0, this.w, this.h);
        this.drawStreaks(ctx, now);
        this.drawInnerCore(ctx);
        this.buildPsi();
        this.drawFieldLines(ctx);
        this.drawShells(ctx);
        this.drawAxis(ctx);
        this.drawLabels(ctx);
        this.drawProbe(ctx);

        ctx.restore();
    },

    px(r, colat) { return this.cx + r * Math.sin(colat) * this.S; },
    py(r, colat) { return this.cy - r * Math.cos(colat) * this.S; },

    drawSpace(ctx) {
        ctx.fillStyle = '#05070e';
        ctx.fillRect(0, 0, this.w, this.h);
    },

    // The mantle is 2,900 km of silicate rock and the reason none of the
    // interesting field is observable. It is drawn dark on purpose: it is the
    // lid, not the subject.
    drawBody(ctx) {
        const S = this.S;
        const g = ctx.createRadialGradient(this.cx, this.cy, S, this.cx, this.cy, R_SURF * S);
        g.addColorStop(0, '#191113');
        g.addColorStop(1, '#0b0c13');
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R_SURF * S, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
    },

    // Bilinear sample of the toroidal field into the small buffer.
    paintToroidal() {
        const d = this.data, n = this.bw * this.bh;
        const B = dynamo.B, NR = dynamo.NR;

        // Reference strength adapts slowly, so a reversal reads as the colour
        // draining out rather than the palette silently rescaling to hide it.
        let mx = 0;
        for (let k = 0; k < dynamo.N; k++) { const v = Math.abs(B[k]); if (v > mx) mx = v; }
        mx = Math.max(mx, 0.05);
        this.torRef = this.torRef === 0 ? mx : this.torRef + (mx - this.torRef) * 0.004;
        const inv = 1 / Math.max(this.torRef, 1e-6);

        for (let k = 0, p = 0; k < n; k++, p += 4) {
            if (!this.mIn[k]) { d[p] = 5; d[p + 1] = 7; d[p + 2] = 14; d[p + 3] = 0; continue; }
            const i = this.mi[k], j = this.mj[k], fr = this.mfr[k], ft = this.mft[k];
            const b0 = j * NR + i;
            const v = (B[b0] * (1 - fr) + B[b0 + 1] * fr) * (1 - ft) +
                      (B[b0 + NR] * (1 - fr) + B[b0 + NR + 1] * fr) * ft;
            let t = v * inv;
            t = Math.max(-1, Math.min(1, t));
            const a = Math.abs(t);
            const s = Math.sqrt(a);
            if (t >= 0) {                       // eastward
                d[p]     = 26 + 232 * s;
                d[p + 1] = 18 + 122 * s * s;
                d[p + 2] = 34 + 30 * s * s;
            } else {                            // westward
                d[p]     = 20 + 30 * s * s;
                d[p + 1] = 22 + 150 * s * s;
                d[p + 2] = 40 + 210 * s;
            }
            d[p + 3] = 255;
        }
        this.bufCtx.putImageData(this.img, 0, 0);
    },

    drawStreaks(ctx, now) {
        const amp = Math.min(1, dynamo.p.vigour) * 0.5;
        if (amp <= 0.01) return;
        const speed = 0.00006 * dynamo.p.vigour * (0.4 + dynamo.p.rotation);
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 240, 220, ' + (0.20 * amp).toFixed(3) + ')';
        ctx.beginPath();
        for (const st of this.streaks) {
            const half = Math.sqrt(Math.max(0, 1 - st.s * st.s));
            if (half < 0.06) continue;
            const inner = st.s < dynamo.R_IN ? Math.sqrt(dynamo.R_IN * dynamo.R_IN - st.s * st.s) : 0;
            for (let dash = 0; dash < 7; dash++) {
                let u = ((dash / 7 + st.phase + st.dir * now * speed) % 1 + 1) % 1;
                let y0 = -half + u * 2 * half;
                let y1 = y0 + 0.075 * st.dir;
                if (Math.abs(y0) < inner || Math.abs(y1) < inner) continue;
                if (Math.abs(y1) > half) continue;
                for (const sgn of [1, -1]) {
                    ctx.moveTo(this.cx + sgn * st.s * this.S, this.cy - y0 * this.S);
                    ctx.lineTo(this.cx + sgn * st.s * this.S, this.cy - y1 * this.S);
                }
            }
        }
        ctx.stroke();
        ctx.restore();
    },

    drawInnerCore(ctx) {
        const S = this.S, R = dynamo.R_IN;
        const g = ctx.createRadialGradient(this.cx - R * S * 0.3, this.cy - R * S * 0.3, 1, this.cx, this.cy, R * S);
        g.addColorStop(0, '#ffe3ae');
        g.addColorStop(0.55, '#f0a655');
        g.addColorStop(1, '#8c3b1e');
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R * S, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 220, 170, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    // psi = r sin(theta) A over the shell, then continued outward as a vacuum
    // field. Contours of psi ARE the poloidal field lines.
    buildPsi() {
        const NR = dynamo.NR, NTH = dynamo.NTH, NRT = this.NRT;
        const psi = this.psi, A = dynamo.A, sn = dynamo.sn, g = dynamo.gauss;

        for (let j = 0; j < NTH; j++) {
            const s = sn[j];
            for (let i = 0; i < NR; i++) psi[j * NRT + i] = this.R[i] * s * A[j * NR + i];
        }
        for (let e = 1; e <= this.N_EXT; e++) {
            const i = NR - 1 + e, rr = this.R[i];
            const fall = [];
            for (let l = 1; l <= LMAX; l++) fall.push(g[l] * Math.pow(rr, -(l + 1)));
            for (let j = 0; j < NTH; j++) {
                let a = 0;
                for (let l = 1; l <= LMAX; l++) a += fall[l - 1] * dynamo.S[l][j];
                psi[j * NRT + i] = rr * sn[j] * a;
            }
        }
    },

    drawFieldLines(ctx) {
        const NRT = this.NRT, NTH = dynamo.NTH, psi = this.psi;

        let mx = 0;
        for (let k = 0; k < psi.length; k++) { const v = Math.abs(psi[k]); if (v > mx) mx = v; }
        // The contour SPACING is held steady and the number of lines is left to
        // float, so a strong field is drawn as a dense bundle and a collapsing
        // one visibly thins out. Pegging the levels to the current maximum
        // instead would draw the same picture at every field strength.
        mx = Math.max(mx, 1e-4);
        this.psiRef = this.psiRef === 0 ? mx : this.psiRef + (mx - this.psiRef) * 0.0015;
        const spacing = Math.max(this.psiRef, 1e-4) / this.N_LEVELS;
        const nLev = Math.min(this.MAX_LEVELS, Math.ceil(mx / spacing));
        if (nLev < 1) return;

        // Polarity colours the whole poloidal system, so a reversal is a change
        // of colour across the entire picture rather than a detail to hunt for.
        const warm = dynamo.gauss[1] < 0;
        const inCol = warm ? 'rgba(255, 209, 128, 0.92)' : 'rgba(126, 212, 255, 0.92)';
        const outCol = warm ? 'rgba(255, 196, 110, 0.55)' : 'rgba(120, 198, 255, 0.55)';

        // Every level is drawn on both sides of the core-mantle boundary. A line
        // that stops at the CMB would be a lie: the flux leaving the core is the
        // same flux that reaches the surface, and the continuity is the point.
        const inner = new Path2D(), outer = new Path2D();
        for (let n = 0; n < nLev; n++) {
            const lv = (n + 0.5) * spacing;
            this.contour(lv, inner, outer);
            this.contour(-lv, inner, outer);
        }

        // Outside the core the lines are faded with radius. A dipole's loops
        // close far beyond this frame, so what is visible out there is the inner
        // part of very large arcs; letting them dissolve into space reads as
        // "this continues" rather than as arcs chopped off at the canvas edge.
        const fade = ctx.createRadialGradient(this.cx, this.cy, this.S * 0.98,
                                              this.cx, this.cy, this.R_MAX * this.S);
        fade.addColorStop(0, outCol);
        fade.addColorStop(1, warm ? 'rgba(255, 196, 110, 0.03)' : 'rgba(120, 198, 255, 0.03)');

        ctx.save();
        ctx.lineWidth = 1.15;
        ctx.lineCap = 'round';
        ctx.strokeStyle = fade;
        ctx.stroke(outer);
        ctx.strokeStyle = inCol;
        ctx.lineWidth = 1.35;
        ctx.stroke(inner);
        ctx.restore();
    },

    // Marching squares on the (r, theta) grid, emitted straight into two paths:
    // inside the core and beyond it, so they can be stroked at different weights
    // without walking the grid twice.
    contour(level, inner, outer) {
        const NRT = this.NRT, NTH = dynamo.NTH, psi = this.psi;
        const R = this.R, TH = this.TH, S = this.S, cx = this.cx, cy = this.cy;
        const T = meridian.CASES;

        for (let j = 0; j < NTH - 1; j++) {
            const r0 = j * NRT, r1 = (j + 1) * NRT;
            for (let i = 0; i < NRT - 1; i++) {
                const v00 = psi[r0 + i], v10 = psi[r0 + i + 1];
                const v11 = psi[r1 + i + 1], v01 = psi[r1 + i];
                let lo = v00, hi = v00;
                if (v10 < lo) lo = v10; else if (v10 > hi) hi = v10;
                if (v11 < lo) lo = v11; else if (v11 > hi) hi = v11;
                if (v01 < lo) lo = v01; else if (v01 > hi) hi = v01;
                if (level < lo || level > hi) continue;

                const code = (v00 > level ? 1 : 0) | (v10 > level ? 2 : 0) |
                             (v11 > level ? 4 : 0) | (v01 > level ? 8 : 0);
                const edges = T[code];
                if (!edges.length) continue;

                const path = R[i] < 1 ? inner : outer;
                if (!path) continue;

                for (let e = 0; e < edges.length; e += 2) {
                    let ax = 0, ay = 0, bx = 0, by = 0;
                    for (let s = 0; s < 2; s++) {
                        const ed = edges[e + s];
                        let rr, th, t;
                        // t is clamped because the two corner values can be
                        // arbitrarily close — routine in the smooth exterior
                        // field — and an unclamped ratio then places the vertex
                        // far outside its own cell, drawing a straight line off
                        // to the edge of the canvas.
                        if (ed === 0) { t = (level - v00) / (v10 - v00); t = t < 0 ? 0 : t > 1 ? 1 : t; rr = R[i] + t * (R[i + 1] - R[i]); th = TH[j]; }
                        else if (ed === 1) { t = (level - v10) / (v11 - v10); t = t < 0 ? 0 : t > 1 ? 1 : t; rr = R[i + 1]; th = TH[j] + t * (TH[j + 1] - TH[j]); }
                        else if (ed === 2) { t = (level - v11) / (v01 - v11); t = t < 0 ? 0 : t > 1 ? 1 : t; rr = R[i + 1] + t * (R[i] - R[i + 1]); th = TH[j + 1]; }
                        else { t = (level - v01) / (v00 - v01); t = t < 0 ? 0 : t > 1 ? 1 : t; rr = R[i]; th = TH[j + 1] + t * (TH[j] - TH[j + 1]); }
                        const dx = rr * Math.sin(th) * S, dy = cy - rr * Math.cos(th) * S;
                        if (s === 0) { ax = dx; ay = dy; } else { bx = dx; by = dy; }
                    }
                    path.moveTo(cx + ax, ay);
                    path.lineTo(cx + bx, by);
                    // The mirrored half. Axisymmetry means the left side is the
                    // same solution, not a second one.
                    path.moveTo(cx - ax, ay);
                    path.lineTo(cx - bx, by);
                }
            }
        }
    },

    CASES: [
        [], [3, 0], [0, 1], [1, 3], [1, 2], [3, 0, 1, 2], [0, 2], [2, 3],
        [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [0, 3], []
    ],

    drawShells(ctx) {
        const S = this.S;
        ctx.save();
        ctx.lineWidth = 1;

        // Core-mantle boundary — the deepest surface any measurement reaches.
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, S, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 170, 120, 0.55)';
        ctx.stroke();

        // Earth's surface.
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R_SURF * S, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(150, 190, 220, 0.42)';
        ctx.stroke();

        // The tangent cylinder: the cylinder touching the inner core, parallel
        // to the rotation axis. Rotation makes the fluid stiff along the axis,
        // so the flow inside it is largely walled off from the flow outside —
        // a real and consequential piece of core geography.
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(190, 214, 255, 0.42)';
        ctx.beginPath();
        const s = dynamo.R_IN * S, top = Math.sqrt(1 - dynamo.R_IN * dynamo.R_IN) * S;
        ctx.moveTo(this.cx - s, this.cy - top); ctx.lineTo(this.cx - s, this.cy + top);
        ctx.moveTo(this.cx + s, this.cy - top); ctx.lineTo(this.cx + s, this.cy + top);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    },

    drawAxis(ctx) {
        const S = this.S, top = this.R_MAX * S;
        ctx.save();
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = 'rgba(150, 175, 205, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy - top);
        ctx.lineTo(this.cx, this.cy + top);
        ctx.stroke();
        ctx.restore();
    },

    label(ctx, text, x, y, align, alpha) {
        ctx.textAlign = align || 'left';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(5, 7, 14, 0.85)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = 'rgba(186, 205, 228, ' + (alpha || 0.72) + ')';
        ctx.fillText(text, x, y);
    },

    drawLabels(ctx) {
        const S = this.S;
        ctx.save();
        ctx.font = '600 10px ui-monospace, Consolas, monospace';
        ctx.textBaseline = 'middle';

        this.label(ctx, 'ROTATION AXIS · N', this.cx + 6, this.cy - this.R_MAX * S + 12, 'left', 0.55);
        this.label(ctx, 'S', this.cx + 6, this.cy + this.R_MAX * S - 12, 'left', 0.55);
        this.label(ctx, 'INNER CORE', this.cx, this.cy + dynamo.R_IN * S * 0.55, 'center', 0.85);
        this.label(ctx, 'OUTER CORE', this.cx, this.cy + (dynamo.R_IN + 1) / 2 * S, 'center', 0.8);
        this.label(ctx, 'MANTLE', this.cx, this.cy + (1 + R_SURF) / 2 * S, 'center', 0.62);
        this.label(ctx, 'TANGENT CYLINDER', this.cx - dynamo.R_IN * S - 6,
                   this.cy + Math.sqrt(1 - dynamo.R_IN * dynamo.R_IN) * S - 10, 'right', 0.42);
        this.label(ctx, 'CMB', this.cx + S * 0.73, this.cy - S * 0.73, 'left', 0.5);
        this.label(ctx, 'SURFACE', this.cx + R_SURF * S * 0.74, this.cy - R_SURF * S * 0.74, 'left', 0.45);
        ctx.restore();
    },

    // ---- Hover probe ----

    setHover(px, py) {
        if (px === null) { this.hover = null; return; }
        const x = (px - this.cx) / this.S, y = -(py - this.cy) / this.S;
        const r = Math.hypot(x, y);
        if (r > this.R_MAX) { this.hover = null; return; }
        this.hover = { x: px, y: py, r, colat: Math.atan2(Math.abs(x), y) };
    },

    drawProbe(ctx) {
        const h = this.hover;
        if (!h) return;
        const lat = 90 - h.colat * 180 / Math.PI;
        let line1, line2;

        if (h.r < dynamo.R_IN) {
            line1 = 'INNER CORE';
            line2 = 'solid iron · ' + Math.round(h.r * R_CORE / 1000) + ' km';
        } else if (h.r <= 1) {
            const i = Math.max(0, Math.min(dynamo.NR - 1, Math.round((h.r - dynamo.R_IN) / dynamo.dr)));
            const j = Math.max(0, Math.min(dynamo.NTH - 1, Math.round(h.colat / dynamo.dth - 0.5)));
            const k = j * dynamo.NR + i;
            const tor = dynamo.B[k] * B_EQ * 1e3;
            const pol = Math.hypot(dynamo.br[k], dynamo.bth[k]) * B_EQ * 1e3;
            line1 = 'TOROIDAL ' + (tor >= 0 ? 'east ' : 'west ') + Math.abs(tor).toFixed(2) + ' mT';
            line2 = 'poloidal ' + pol.toFixed(2) + ' mT · ' + Math.round(h.r * R_CORE / 1000) + ' km · ' +
                    Math.abs(Math.round(lat)) + '°' + (lat >= 0 ? 'N' : 'S');
        } else {
            const e = dynamo.exterior(h.r, h.colat);
            const f = Math.hypot(e.br, e.bth) * B_EQ * 1e6;
            line1 = (h.r < R_SURF ? 'MANTLE' : 'ABOVE THE SURFACE') + ' · ' + f.toFixed(1) + ' µT';
            line2 = Math.round(h.r * R_CORE / 1000) + ' km from centre · no dynamo here';
        }

        ctx.save();
        ctx.font = '600 10.5px ui-monospace, Consolas, monospace';
        const wA = ctx.measureText(line1).width, wB = ctx.measureText(line2).width;
        const w = Math.max(wA, wB) + 16;
        let bx = h.x + 14, by = h.y + 14;
        if (bx + w > this.w) bx = h.x - w - 14;
        if (by + 38 > this.h) by = h.y - 38 - 14;
        ctx.fillStyle = 'rgba(6, 9, 17, 0.93)';
        ctx.strokeStyle = 'rgba(90, 118, 150, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(bx, by, w, 36);
        ctx.fill();
        ctx.stroke();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#dbe6f2';
        ctx.fillText(line1, bx + 8, by + 12);
        ctx.fillStyle = '#7d93ad';
        ctx.fillText(line2, bx + 8, by + 25);
        ctx.restore();
    }
};
