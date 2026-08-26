/* SocietySim — the world view.
 *
 * Two layers, drawn very differently on purpose.
 *
 * The land is 16,000 cells, so it is painted into an offscreen canvas one pixel
 * per cell and blown up by drawImage — the upscale happens on the GPU and costs
 * nothing, and the smoothing turns a coarse grid into a landscape. Ownership
 * rides on the same pass as a per-estate tint, which is what makes the domains
 * legible as blocs rather than as a uniform "owned" wash.
 *
 * The agents are up to 10,000 rectangles, which is only fast if the fill style
 * stops changing. They are bucketed first into pre-allocated coordinate lists,
 * so the whole population goes down in eight fill-style changes rather than ten
 * thousand.
 */
'use strict';

const render = {
    canvas: null,
    ctx: null,
    vw: 0, vh: 0, dpr: 1,

    cam: { x: 800, y: 500, z: 1 },
    zMin: 0.3, zMax: 14,

    selected: -1,
    onPick: null,
    showEstates: true,

    /* offscreen land */
    tcv: null, tctx: null, timg: null, tbuf: null,

    /* buckets: one per wealth band, then hungry, soldier, lord */
    _bx: null, _by: null, _bn: null, _nb: 0,
    _colors: null,

    _drag: null,

    /* Muted so a domain reads as a bloc without burying the terrain under it.
       Estates are tinted by id, so neighbours are near-certain to differ. */
    _tint: [
        [126, 82, 58], [66, 92, 142], [132, 68, 112], [88, 124, 60], [146, 114, 48],
        [58, 112, 124], [116, 58, 74], [82, 70, 136], [124, 132, 68], [68, 124, 94]
    ],

    /* -------------------------------------------------------------- init -- */

    init(canvas, s) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });

        this.tcv = document.createElement('canvas');
        this.tcv.width = s.GW;
        this.tcv.height = s.GH;
        this.tctx = this.tcv.getContext('2d');
        this.timg = this.tctx.createImageData(s.GW, s.GH);
        this.tbuf = this.timg.data;
        for (let i = 3; i < this.tbuf.length; i += 4) this.tbuf[i] = 255;

        const CL = metrics.CLASSES;
        this._nb = CL.length + 3;
        this._colors = CL.map(c => c.color)
            .concat([metrics.HUNGRY_COLOR, metrics.SOLDIER_COLOR, metrics.LORD_COLOR]);
        this._iHungry = CL.length;
        this._iSoldier = CL.length + 1;
        this._iLord = CL.length + 2;

        this._bx = [];
        this._by = [];
        this._bn = new Int32Array(this._nb);
        for (let b = 0; b < this._nb; b++) {
            this._bx.push(new Float32Array(s.MAX_AGENTS));
            this._by.push(new Float32Array(s.MAX_AGENTS));
        }

        this.resize();
        this.fit(s);
        this._attach(s);
        return this;
    },

    resize() {
        const cv = this.canvas;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (w === 0 || h === 0) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        this.vw = w; this.vh = h; this.dpr = dpr;
    },

    fit(s) {
        this.resize();
        if (!this.vw) return;
        const z = Math.min(this.vw / s.W, this.vh / s.H) * 0.96;
        this.cam.z = z;
        this.cam.x = s.W / 2;
        this.cam.y = s.H / 2;
    },

    screenToWorld(sx, sy) {
        const c = this.cam;
        return {
            x: (sx - this.vw / 2) / c.z + c.x,
            y: (sy - this.vh / 2) / c.z + c.y
        };
    },

    /* -------------------------------------------------------------- draw -- */

    draw(s) {
        this.resize();
        if (!this.vw) return;
        const ctx = this.ctx;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = '#070b0c';
        ctx.fillRect(0, 0, this.vw, this.vh);

        const c = this.cam, z = c.z;
        const ox = this.vw / 2 - c.x * z;
        const oy = this.vh / 2 - c.y * z;

        this._paintLand(s);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.tcv, ox, oy, s.W * z, s.H * z);

        ctx.strokeStyle = '#1e3234';
        ctx.lineWidth = 1;
        ctx.strokeRect(ox + 0.5, oy + 0.5, s.W * z, s.H * z);

        this._paintAgents(s, ox, oy, z);
        if (this.showEstates) this._paintSeats(s, ox, oy, z);
        this._paintSelection(s, ox, oy, z);
    },

    _paintLand(s) {
        const buf = this.tbuf, fert = s.fert, crop = s.crop, own = s.owner;
        const tint = this._tint, showE = this.showEstates;
        const n = s.NCELL;
        for (let i = 0, p = 0; i < n; i++, p += 4) {
            const f = fert[i];
            /* bare soil darkens toward barren, standing crop pulls it green */
            const sr = 16 + 20 * f, sg = 22 + 28 * f, sb = 25 + 21 * f;
            const t = crop[i];
            let r = sr + (78 - sr) * t;
            let g = sg + (192 - sg) * t;
            let b = sb + (158 - sb) * t;

            const o = own[i];
            if (o >= 0 && showE) {
                const c = tint[o % 10];
                r += (c[0] - r) * 0.26;
                g += (c[1] - g) * 0.26;
                b += (c[2] - b) * 0.26;
            }
            buf[p] = r; buf[p + 1] = g; buf[p + 2] = b;
        }
        this.tctx.putImageData(this.timg, 0, 0);
    },

    _paintAgents(s, ox, oy, z) {
        const ctx = this.ctx;
        const bn = this._bn, bx = this._bx, by = this._by;
        bn.fill(0);

        const CL = metrics.CLASSES;
        const nc = CL.length;
        const hungryFood = metrics.HUNGRY_FOOD;
        const iH = this._iHungry, iS = this._iSoldier, iL = this._iLord;

        /* cull to the visible rectangle, with a cell of slack */
        const wx0 = -ox / z - 4, wx1 = (this.vw - ox) / z + 4;
        const wy0 = -oy / z - 4, wy1 = (this.vh - oy) / z + 4;

        const X = s.x, Y = s.y, F = s.food, C = s.capital, AL = s.alive, RO = s.role;
        for (let i = 0; i < s.MAX_AGENTS; i++) {
            if (AL[i] === 0) continue;
            const wx = X[i];
            if (wx < wx0 || wx > wx1) continue;
            const wy = Y[i];
            if (wy < wy0 || wy > wy1) continue;

            /* Role wins over wealth on the map: a garrison and a manor are what
               you are looking for, and neither shows up in a wealth ramp. */
            let b;
            const role = RO[i];
            if (role === 1) b = iL;
            else if (F[i] < hungryFood) b = iH;
            else if (role === 2) b = iS;
            else {
                const cap = C[i];
                b = 0;
                for (let q = nc - 1; q >= 1; q--) {
                    if (cap >= CL[q].min) { b = q; break; }
                }
            }
            const k = bn[b]++;
            bx[b][k] = ox + wx * z;
            by[b][k] = oy + wy * z;
        }

        const d = Math.max(1.2, Math.min(6, 1.5 * z));
        const half = d * 0.5;
        const colors = this._colors;

        for (let b = 0; b < this._nb; b++) {
            const n = bn[b];
            if (n === 0) continue;
            /* Lords are few and matter; give them a bigger mark. */
            const sz = b === iL ? Math.max(3, d * 2) : d;
            const hf = sz * 0.5;
            ctx.fillStyle = colors[b];
            const ax = bx[b], ay = by[b];
            for (let k = 0; k < n; k++) ctx.fillRect(ax[k] - hf, ay[k] - hf, sz, sz);
        }
    },

    _paintSeats(s, ox, oy, z) {
        const ctx = this.ctx;
        ctx.lineWidth = 1;
        for (let e = 0; e < s.MAX_ESTATES; e++) {
            if (s.eAlive[e] === 0) continue;
            const px = ox + s.eSeatX[e] * z, py = oy + s.eSeatY[e] * z;
            if (px < -40 || py < -40 || px > this.vw + 40 || py > this.vh + 40) continue;

            /* the border the garrison is holding */
            ctx.strokeStyle = s.eBroke[e] ? 'rgba(226,96,60,0.55)' : 'rgba(255,215,107,0.22)';
            ctx.beginPath();
            ctx.arc(px, py, s.eRadius[e] * z, 0, 6.2831853);
            ctx.stroke();

            /* the manor */
            const r = Math.max(2.5, 1.6 * z);
            ctx.fillStyle = '#ffd76b';
            ctx.fillRect(px - r, py - r, r * 2, r * 2);
            ctx.strokeStyle = 'rgba(10,16,18,0.85)';
            ctx.strokeRect(px - r, py - r, r * 2, r * 2);
        }
    },

    _paintSelection(s, ox, oy, z) {
        const i = this.selected;
        if (i < 0 || s.alive[i] === 0) return;
        const ctx = this.ctx;
        const px = ox + s.x[i] * z, py = oy + s.y[i] * z;
        const r = Math.max(7, 2.4 * z);
        ctx.strokeStyle = '#e9eef0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 6.2831853);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(233,238,240,0.35)';
        ctx.beginPath();
        ctx.moveTo(px - r - 5, py); ctx.lineTo(px - r - 1, py);
        ctx.moveTo(px + r + 1, py); ctx.lineTo(px + r + 5, py);
        ctx.moveTo(px, py - r - 5); ctx.lineTo(px, py - r - 1);
        ctx.moveTo(px, py + r + 1); ctx.lineTo(px, py + r + 5);
        ctx.stroke();
    },

    /* ------------------------------------------------------- interaction -- */

    _attach(s) {
        const cv = this.canvas;
        const self = this;

        cv.addEventListener('pointerdown', e => {
            cv.setPointerCapture(e.pointerId);
            self._drag = { x: e.clientX, y: e.clientY, moved: 0 };
        });

        cv.addEventListener('pointermove', e => {
            const d = self._drag;
            if (!d) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            d.moved += Math.abs(dx) + Math.abs(dy);
            self.cam.x -= dx / self.cam.z;
            self.cam.y -= dy / self.cam.z;
            d.x = e.clientX; d.y = e.clientY;
            self._clampCam(s);
        });

        cv.addEventListener('pointerup', e => {
            const d = self._drag;
            self._drag = null;
            /* a pointer that barely moved is a pick, not a pan */
            if (!d || d.moved > 5) return;
            const r = cv.getBoundingClientRect();
            const w = self.screenToWorld(e.clientX - r.left, e.clientY - r.top);
            if (self.onPick) self.onPick(w.x, w.y);
        });

        cv.addEventListener('pointercancel', () => { self._drag = null; });

        cv.addEventListener('wheel', e => {
            e.preventDefault();
            const r = cv.getBoundingClientRect();
            const mx = e.clientX - r.left, my = e.clientY - r.top;
            const before = self.screenToWorld(mx, my);
            const f = Math.exp(-e.deltaY * 0.0016);
            let z = self.cam.z * f;
            if (z < self.zMin) z = self.zMin; else if (z > self.zMax) z = self.zMax;
            self.cam.z = z;
            /* keep the world point under the cursor pinned to the cursor */
            const after = self.screenToWorld(mx, my);
            self.cam.x += before.x - after.x;
            self.cam.y += before.y - after.y;
            self._clampCam(s);
        }, { passive: false });
    },

    /* Let the view drift a little past the edge, but not so far the world
       leaves the screen entirely. */
    _clampCam(s) {
        const m = 200;
        const c = this.cam;
        if (c.x < -m) c.x = -m; else if (c.x > s.W + m) c.x = s.W + m;
        if (c.y < -m) c.y = -m; else if (c.y > s.H + m) c.y = s.H + m;
    }
};
