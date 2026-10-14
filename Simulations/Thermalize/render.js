// ============ THERMALIZE — BENCH VIEW ============
// One world, two ways of drawing it, switched by how far in the camera is.
// Zoomed out, a cell is a few pixels and the bench is a falling-sand game:
// one pixel per cell into an offscreen canvas, blown up by drawImage. Zoomed
// in past LOD pixels a cell, every cell resolves into the atoms it holds, each
// nucleus wearing the disc a neutron of the VIEW ENERGY would have to hit.
// Owns no simulation. Owns `bench`.
//
// The view energy is the followed neutron's while one is alive, and the slider
// otherwise (main.js keeps it). That is the whole trick of the lattice view:
// the discs are not a property of the material, they are a property of the
// material AND the neutron looking at it, so they swell as it slows.

const bench = {

    canvas: null, ctx: null,
    w: 0, h: 0, dpr: 1,
    cam: { x: 80, y: 50, z: 6 },
    LOD: 12,                // pixels per cell where atoms start being drawn
    ZMAX: 60,
    zFit: 6,
    viewE: 2e6,
    eye: false,
    mouse: { x: 0, y: 0, on: false },
    brush: 3,
    showBrush: true,
    gun: null,

    off: null, offctx: null, img: null,
    NCOL: 48, ECOL: [],
    nb: null,
    buf: null, bufN: 0,
    _sig: { tot: 0, cap: 0, fis: 0 },
    _col: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.off = document.createElement('canvas');
        this.off.width = grid.W; this.off.height = grid.H;
        this.offctx = this.off.getContext('2d');
        this.img = this.offctx.createImageData(grid.W, grid.H);
        this.nb = new Uint8Array(neutrons.MAX);
        this.buf = new Float32Array(4 * 14000);
        this._col = new Float32Array(materials.list.length * 3);

        // Energy ramp: thermal amber, epithermal teal, fast violet.
        const stops = [[255, 176, 64], [72, 208, 196], [164, 128, 255]];
        for (let k = 0; k < this.NCOL; k++) {
            const t = k / (this.NCOL - 1) * 2, i = t >= 1 ? 1 : 0, f = t - i;
            const a = stops[i], b = stops[i + 1];
            this.ECOL.push('rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
                Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')');
        }
        this.resize();
    },

    resize() {
        const r = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.w = Math.max(50, r.width); this.h = Math.max(50, r.height);
        this.canvas.width = Math.round(this.w * this.dpr);
        this.canvas.height = Math.round(this.h * this.dpr);
        this.zFit = Math.min(this.w / grid.W, this.h / grid.H) * 0.96;
    },

    // 0.01 eV to 10 MeV across the ramp.
    ci(E) {
        const t = (Math.log10(E) + 2) / 9;
        return t <= 0 ? 0 : t >= 1 ? this.NCOL - 1 : (t * (this.NCOL - 1)) | 0;
    },
    ecol(E) { return this.ECOL[this.ci(E)]; },

    wx(px) { return (px - this.w / 2) / this.cam.z + this.cam.x; },
    wy(py) { return (py - this.h / 2) / this.cam.z + this.cam.y; },

    clampCam() {
        const c = this.cam;
        if (c.z < this.zFit * 0.8) c.z = this.zFit * 0.8;
        if (c.z > this.ZMAX) c.z = this.ZMAX;
        c.x = Math.max(0, Math.min(grid.W, c.x));
        c.y = Math.max(0, Math.min(grid.H, c.y));
    },

    fit(x0, y0, x1, y1) {
        this.cam.x = (x0 + x1) / 2; this.cam.y = (y0 + y1) / 2;
        this.cam.z = Math.min(this.w / (x1 - x0), this.h / (y1 - y0)) * 0.94;
        this.clampCam();
    },

    zoomAt(px, py, f) {
        const wx = this.wx(px), wy = this.wy(py);
        this.cam.z *= f;
        this.clampCam();
        this.cam.x = wx - (px - this.w / 2) / this.cam.z;
        this.cam.y = wy - (py - this.h / 2) / this.cam.z;
        this.clampCam();
    },

    lattice() { return this.cam.z >= this.LOD; },

    draw(dt) {
        const ctx = this.ctx, z = this.cam.z;
        const ox = this.w / 2 - this.cam.x * z, oy = this.h / 2 - this.cam.y * z;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = '#04060a';
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.fillStyle = '#080c14';
        ctx.fillRect(ox, oy, grid.W * z, grid.H * z);

        const gv = nuc.group(this.viewE);
        if (this.lattice()) this.drawLattice(ctx, z, ox, oy, gv);
        else this.drawSand(ctx, z, ox, oy, gv);

        ctx.strokeStyle = '#1c2838'; ctx.lineWidth = 1;
        ctx.strokeRect(ox - 0.5, oy - 0.5, grid.W * z + 1, grid.H * z + 1);

        this.drawTrail(ctx, z, ox, oy);
        if (this.gun) this.drawGun(ctx, z, ox, oy);
        this.drawNeutrons(ctx, z, ox, oy);
        this.drawFx(ctx, z, ox, oy, dt);

        if (this.mouse.on && this.showBrush) {
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(this.mouse.x, this.mouse.y, Math.max(2, this.brush * z), 0, 6.2831853);
            ctx.stroke();
        }
        this.drawScale(ctx, z);
    },

    // ---- Sand: one pixel per cell ----

    drawSand(ctx, z, ox, oy, gv) {
        const col = this._col, list = materials.list, sig = this._sig;
        for (let m = 1; m < list.length; m++) {
            const M = list[m];
            if (this.eye) {
                // How much of a centimetre of this is in the way, and what it
                // does about it: blue scatters, red absorbs, yellow fissions.
                materials.sigma(M, gv, sig);
                const cov = 0.10 + 0.90 * (1 - Math.exp(-sig.tot));
                const a = sig.tot > 0 ? sig.cap / sig.tot : 0, f = sig.tot > 0 ? sig.fis / sig.tot : 0, s = 1 - a - f;
                col[m * 3] = (55 * s + 226 * a + 255 * f) * cov;
                col[m * 3 + 1] = (138 * s + 75 * a + 214 * f) * cov;
                col[m * 3 + 2] = (221 * s + 74 * a + 90 * f) * cov;
            } else {
                col[m * 3] = M.color[0]; col[m * 3 + 1] = M.color[1]; col[m * 3 + 2] = M.color[2];
            }
        }
        const d = this.img.data, type = grid.type, seed = grid.seed, ovr = grid.ovr;
        for (let c = 0, p = 0, o = 0; c < type.length; c++, p += 4, o += 3) {
            const m = type[c];
            if (m === 0) { d[p + 3] = 0; continue; }
            let sh = 0.84 + (seed[c] & 15) * 0.021;
            // A cell whose atoms have been used up shows from across the room,
            // in proportion: a spent boron atom is the whole cell, one hydrogen
            // turned to deuterium is a third of a water molecule.
            if (ovr[o] | ovr[o + 1] | ovr[o + 2]) {
                const used = (ovr[o] ? 1 : 0) + (ovr[o + 1] ? 1 : 0) + (ovr[o + 2] ? 1 : 0);
                sh *= 1 - 0.5 * used / list[m].ns;
            }
            d[p] = col[m * 3] * sh; d[p + 1] = col[m * 3 + 1] * sh; d[p + 2] = col[m * 3 + 2] * sh;
            d[p + 3] = 255;
        }
        this.offctx.putImageData(this.img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.off, ox, oy, grid.W * z, grid.H * z);
    },

    // ---- Lattice: every cell is the atoms in it ----

    drawLattice(ctx, z, ox, oy, gv) {
        const W = grid.W, H = grid.H, type = grid.type, seed = grid.seed, ovr = grid.ovr;
        const list = materials.list, TOT = nuc.tot, CAP = nuc.cap, FIS = nuc.fis;
        const x0 = Math.max(0, Math.floor(-ox / z) - 1), x1 = Math.min(W - 1, Math.ceil((this.w - ox) / z) + 1);
        const y0 = Math.max(0, Math.floor(-oy / z) - 1), y1 = Math.min(H - 1, Math.ceil((this.h - oy) / z) + 1);

        let last = -1;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const m = type[y * W + x];
                if (m === 0) continue;
                if (m !== last) { ctx.fillStyle = list[m].bg; last = m; }
                ctx.fillRect(ox + x * z, oy + y * z, z + 0.5, z + 0.5);
            }
        }

        // The three disc layers are each ONE path, filled once. Besides being
        // the only way this is fast, a single path fills overlapping discs as
        // their union, so thermal water reads as an even fog and not as a
        // pile of translucent circles getting darker where they cross.
        const pS = new Path2D(), pC = new Path2D(), pF = new Path2D(), pB = new Path2D();
        const buf = this.buf, cap = buf.length / 4;
        let n = 0;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const c = y * W + x, m = type[c];
                if (m === 0) continue;
                const M = list[m], ns = M.ns, sd = seed[c], off = M.off;
                const vi = (M.crystal ? (((y & 1) << 3) | (sd & 7)) : (sd & 15)) * ns * 2;
                let bx = 0, by = 0;
                for (let s = 0; s < ns; s++) {
                    const o = ovr[c * 3 + s], spi = o ? o : M.slotSp[s];
                    const px = ox + (x + 0.5 + off[vi + s * 2]) * z;
                    const py = oy + (y + 0.5 + off[vi + s * 2 + 1]) * z;
                    const tot = TOT[spi][gv];
                    let r = M.w[s] * tot;
                    if (r > 0.5) r = 0.5;
                    r *= z;
                    if (r > 0.45) {
                        pS.moveTo(px + r, py); pS.arc(px, py, r, 0, 6.2831853);
                        const rf = r * FIS[spi][gv] / tot, rc = r * (CAP[spi][gv] + FIS[spi][gv]) / tot;
                        if (rc > 0.45) { pC.moveTo(px + rc, py); pC.arc(px, py, rc, 0, 6.2831853); }
                        if (rf > 0.45) { pF.moveTo(px + rf, py); pF.arc(px, py, rf, 0, 6.2831853); }
                    }
                    if (s === 0) { bx = px; by = py; }
                    else if (M.bonded) { pB.moveTo(bx, by); pB.lineTo(px, py); }
                    if (n < cap) { buf[n * 4] = px; buf[n * 4 + 1] = py; buf[n * 4 + 2] = spi; buf[n * 4 + 3] = o ? 1 : 0; n++; }
                }
            }
        }
        ctx.strokeStyle = 'rgba(200,215,235,0.20)'; ctx.lineWidth = 1;
        ctx.stroke(pB);
        ctx.fillStyle = 'rgba(55,138,221,0.42)'; ctx.fill(pS);
        ctx.fillStyle = 'rgba(226,75,74,0.86)'; ctx.fill(pC);
        ctx.fillStyle = 'rgba(255,214,90,0.95)'; ctx.fill(pF);

        // The nuclei themselves, and what each one is once there is room.
        const ds = Math.max(1.5, Math.min(3, z * 0.06));
        ctx.fillStyle = '#dfe7f2';
        ctx.strokeStyle = '#ffc266'; ctx.lineWidth = 1;
        for (let k = 0; k < n; k++) {
            const px = buf[k * 4], py = buf[k * 4 + 1];
            if (buf[k * 4 + 3]) {
                // An atom that has been changed by a capture: a hollow ring.
                ctx.beginPath(); ctx.arc(px, py, ds + 1.5, 0, 6.2831853); ctx.stroke();
            } else ctx.fillRect(px - ds / 2, py - ds / 2, ds, ds);
        }
        if (z >= 26 && n < 2600) {
            ctx.font = (z >= 40 ? 11 : 10) + 'px ui-monospace, Consolas, monospace';
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            for (let k = 0; k < n; k++) {
                ctx.fillStyle = buf[k * 4 + 3] ? 'rgba(255,194,102,0.9)' : 'rgba(214,224,238,0.62)';
                ctx.fillText(nuc.sp[buf[k * 4 + 2]].sym, buf[k * 4] + ds + 1, buf[k * 4 + 1] - ds - 1);
            }
        }
    },

    // ---- The followed neutron's path ----

    drawTrail(ctx, z, ox, oy) {
        const t = neutrons.trail;
        if (t.length < 3) return;
        ctx.lineWidth = this.lattice() ? 1.6 : 1.2;
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.85;
        let cur = -1;
        ctx.beginPath();
        for (let k = 3; k < t.length; k += 3) {
            const ci = this.ci(t[k + 2]);
            if (ci !== cur) {
                if (cur >= 0) ctx.stroke();
                ctx.beginPath(); ctx.strokeStyle = this.ECOL[ci]; cur = ci;
                ctx.moveTo(ox + t[k - 3] * z, oy + t[k - 2] * z);
            }
            ctx.lineTo(ox + t[k] * z, oy + t[k + 1] * z);
        }
        if (cur >= 0) ctx.stroke();
        const i = neutrons.fIdx;
        if (i >= 0) {
            const k = t.length - 3;
            ctx.beginPath(); ctx.strokeStyle = this.ecol(neutrons.E[i]);
            ctx.moveTo(ox + t[k] * z, oy + t[k + 1] * z);
            ctx.lineTo(ox + neutrons.x[i] * z, oy + neutrons.y[i] * z);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    },

    // Up to four thousand of them, so they are bucketed by colour first and
    // each bucket goes down as one path: twelve style changes, not thousands.
    drawNeutrons(ctx, z, ox, oy) {
        const N = neutrons.n;
        if (N === 0) return;
        const nb = this.nb, X = neutrons.x, Y = neutrons.y, UX = neutrons.ux, UY = neutrons.uy, E = neutrons.E;
        const rad = Math.max(1.4, Math.min(3.6, z * 0.10));
        const tail = Math.max(4, Math.min(14, z * 0.5));
        const seen = new Uint8Array(12);
        for (let i = 0; i < N; i++) { const b = this.ci(E[i]) >> 2; nb[i] = b; seen[b] = 1; }
        ctx.lineWidth = Math.max(1, rad * 0.7);
        for (let b = 0; b < 12; b++) {
            if (!seen[b]) continue;
            const col = this.ECOL[b * 4 + 2];
            ctx.strokeStyle = col; ctx.fillStyle = col;
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            for (let i = 0; i < N; i++) {
                if (nb[i] !== b) continue;
                const px = ox + X[i] * z, py = oy + Y[i] * z;
                if (px < -20 || py < -20 || px > this.w + 20 || py > this.h + 20) continue;
                ctx.moveTo(px - UX[i] * tail, py - UY[i] * tail); ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            for (let i = 0; i < N; i++) {
                if (nb[i] !== b) continue;
                const px = ox + X[i] * z, py = oy + Y[i] * z;
                if (px < -20 || py < -20 || px > this.w + 20 || py > this.h + 20) continue;
                ctx.moveTo(px + rad, py); ctx.arc(px, py, rad, 0, 6.2831853);
            }
            ctx.fill();
        }
        const f = neutrons.fIdx;
        if (f >= 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(ox + X[f] * z, oy + Y[f] * z, rad + 4, 0, 6.2831853);
            ctx.stroke();
        }
    },

    // What a collision leaves behind for a moment: the struck nucleus's
    // recoil, a capture's flash and whatever it throws out, a fission.
    drawFx(ctx, z, ox, oy, dt) {
        const fx = neutrons.fx;
        let w = 0;
        for (let k = 0; k < fx.length; k++) {
            const f = fx[k];
            f.life -= dt * (f.k === 0 ? 2.4 : 1.5);
            if (f.life <= 0) continue;
            fx[w++] = f;
            const px = ox + f.x * z, py = oy + f.y * z, a = f.life, t = 1 - f.life;
            if (px < -60 || py < -60 || px > this.w + 60 || py > this.h + 60) continue;
            const cx = Math.cos(f.ang), sy = Math.sin(f.ang);
            ctx.globalAlpha = a;
            if (f.k === 0) {
                // Recoil. A proton knocked out of water gets a longer, pinker
                // streak than a carbon nucleus that barely moved.
                const L = (0.10 + 0.55 * Math.sqrt(f.mag)) * Math.max(z, 8) * (0.4 + 0.6 * t);
                ctx.strokeStyle = f.ej === 'p' ? '#ffb4d2' : '#cfe0f5';
                ctx.lineWidth = f.ej === 'p' ? 2 : 1.4;
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + f.dx * L, py + f.dy * L); ctx.stroke();
                continue;
            }
            const fis = f.k === 2;
            if (f.k !== 3) {
                ctx.strokeStyle = fis ? '#ffe9a0' : '#ff6f66';
                ctx.lineWidth = fis ? 2.4 : 1.6;
                ctx.beginPath();
                ctx.arc(px, py, 3 + t * (fis ? 1.5 : 0.9) * Math.max(z, 10), 0, 6.2831853);
                ctx.stroke();
            }
            if (fis) {
                // Two fragments, back to back.
                const L = 0.7 * Math.max(z, 10) * (0.3 + 0.7 * t);
                ctx.strokeStyle = '#ffd65a'; ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(px - cx * L, py - sy * L); ctx.lineTo(px + cx * L, py + sy * L);
                ctx.stroke();
            } else if (f.ej === 'a' || f.ej === 'p') {
                const L = (f.ej === 'a' ? 0.5 : 0.8) * Math.max(z, 10) * (0.3 + 0.7 * t);
                ctx.strokeStyle = f.ej === 'a' ? '#ffd9a8' : '#ffb4d2';
                ctx.lineWidth = f.ej === 'a' ? 3 : 2;
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + cx * L, py + sy * L); ctx.stroke();
            } else {
                // A gamma ray: gone at once, and nothing on the bench stops it.
                const d0 = t * 9 * Math.max(z, 10), d1 = d0 + 1.6 * Math.max(z, 10);
                ctx.strokeStyle = '#f4f0c4'; ctx.lineWidth = 1;
                ctx.setLineDash([3, 4]);
                ctx.beginPath(); ctx.moveTo(px + cx * d0, py + sy * d0); ctx.lineTo(px + cx * d1, py + sy * d1); ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        fx.length = w;
        ctx.globalAlpha = 1;
    },

    drawGun(ctx, z, ox, oy) {
        const g = this.gun, px = ox + g.x * z, py = oy + g.y * z;
        const s = Math.max(7, Math.min(16, z * 0.55));
        const c = Math.cos(g.ang), sn = Math.sin(g.ang);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + c * s * 5, py + sn * s * 5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = this.ecol(g.E);
        ctx.strokeStyle = '#04060a'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px + c * s, py + sn * s);
        ctx.lineTo(px - c * s * 0.6 - sn * s * 0.65, py - sn * s * 0.6 + c * s * 0.65);
        ctx.lineTo(px - c * s * 0.6 + sn * s * 0.65, py - sn * s * 0.6 - c * s * 0.65);
        ctx.closePath(); ctx.fill(); ctx.stroke();
    },

    drawScale(ctx, z) {
        const cm = z * 10 <= 170 ? 10 : 1;
        const L = cm * z, x = this.w - 16 - L, y = this.h - 16;
        ctx.strokeStyle = '#7f90a6'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + L, y); ctx.lineTo(x + L, y - 4);
        ctx.stroke();
        ctx.fillStyle = '#7f90a6';
        ctx.font = '10.5px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(cm + ' cm' + (cm === 1 ? ' = one drawn atom' : ''), x + L, y - 8);
    }
};
