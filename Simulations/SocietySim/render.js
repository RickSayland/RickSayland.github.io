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

    /* Bare-ground colour per terrain: water, plain, forest, desert, mountain. */
    _terrainPal: [
        [26, 58, 82],    // water — deepens with depth
        [34, 44, 36],    // plain
        [24, 42, 30],    // forest
        [78, 66, 44],    // desert
        [64, 64, 68]     // mountain
    ],

    /* Deposit colours, in RES order: minerals, oil, energy, fertiliser. */
    _resPal: [
        [176, 190, 204], [168, 108, 220], [242, 193, 78], [122, 208, 108]
    ],
    showDeposits: false,

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

        /* Border segments, four numbers each. Worst case is every cell fenced
           on all sides, which cannot happen, but the buffer is cheap. */
        this._segState = new Float32Array(s.NCELL * 8);
        this._segInner = new Float32Array(s.NCELL * 4);
        this._nSeg = 0;
        this._nInner = 0;
        this._borderVersion = -1;
        this._estTint = new Int8Array(s.MAX_ESTATES);

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
        this.worldChanged(s);
        this.fit(s);
        this._attach(s);
        return this;
    },

    /* Called after any sim.reset(): the terrain the soil cache was baked from
       no longer exists, and every border on the map belongs to a dead world. */
    worldChanged(s) {
        this._bakeSoil(s);
        this._borderVersion = -1;
        this._nSeg = 0;
        this._nInner = 0;
        this.selected = -1;
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

        if (this.showEstates) {
            if (this._borderVersion !== s.ownerVersion) this._traceBorders(s);
            this._paintBorders(s, ox, oy, z);
        }
        this._paintAgents(s, ox, oy, z);
        if (this.showEstates) this._paintSeats(s, ox, oy, z);
        this._paintSelection(s, ox, oy, z);
    },

    /* Paints the terrain and, in the same pass, collects the border segments.
       Territory is tinted by *state*, not by estate, so a union visibly turns
       two blocs into one colour — and the internal line between them survives
       as a thin seam, which is the whole picture of a federation in one glance.
       Segments come out in grid units, independent of the camera, and are
       transformed at stroke time. */
    /* Bare-ground colour depends only on terrain and soil, neither of which
       ever changes, so it is baked once and the per-frame loop is reduced to
       lerping towards the crop colour and blending the owner's tint. */
    _bakeSoil(s) {
        const n = s.NCELL;
        this._soil = new Float32Array(n * 3);
        this._soilD = new Float32Array(n * 3);
        const soil = this._soil, d = this._soilD;
        const PAL = this._terrainPal;
        for (let i = 0; i < n; i++) {
            const t = s.terrain[i], f = s.fert[i];
            const c = PAL[t];
            let r, g, b;
            if (t === 0) {
                /* deep water darkens with depth */
                const dp = s.depth[i];
                r = c[0] * (1 - dp * 0.55);
                g = c[1] * (1 - dp * 0.5);
                b = c[2] * (1 - dp * 0.35);
            } else {
                /* richer soil reads darker and warmer than thin ground */
                r = c[0] - f * 8; g = c[1] + f * 6; b = c[2] - f * 2;
            }
            const p = i * 3;
            soil[p] = r; soil[p + 1] = g; soil[p + 2] = b;
            /* how far this cell travels towards full standing crop */
            const grows = (t === 1 || t === 2) ? 1 : t === 0 ? 0 : 0.35;
            d[p] = (78 - r) * grows;
            d[p + 1] = (196 - g) * grows;
            d[p + 2] = (152 - b) * grows;
        }
    },

    _paintLand(s) {
        const buf = this.tbuf, crop = s.crop, own = s.owner;
        const soil = this._soil, d = this._soilD;
        const showE = this.showEstates;
        const n = s.NCELL;

        /* Resolve each estate's tint once rather than per cell. */
        const est = s.eState, tint = this._tint, et = this._estTint;
        if (showE) {
            for (let e = 0; e < s.MAX_ESTATES; e++) {
                if (s.eAlive[e] === 0) { et[e] = -1; continue; }
                const st = est[e];
                et[e] = (st >= 0 ? st : e) % 10;
            }
        }

        for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
            const t = crop[i];
            let r = soil[q] + d[q] * t;
            let g = soil[q + 1] + d[q + 1] * t;
            let b = soil[q + 2] + d[q + 2] * t;

            if (showE) {
                const o = own[i];
                if (o >= 0) {
                    const ti = et[o];
                    if (ti >= 0) {
                        const c = tint[ti];
                        r += (c[0] - r) * 0.26;
                        g += (c[1] - g) * 0.26;
                        b += (c[2] - b) * 0.26;
                    }
                }
            }
            buf[p] = r; buf[p + 1] = g; buf[p + 2] = b;
        }

        if (this.showDeposits) this._paintDeposits(s, buf);
        this.tctx.putImageData(this.timg, 0, 0);
    },

    /* Each cell is washed towards whichever deposit is richest under it, by how
       rich it is. Showing all four at once would just average to grey; showing
       the dominant one keeps the ore country, the oil country and the good
       farmland reading as distinct regions, which is the thing worth seeing. */
    _paintDeposits(s, buf) {
        const res = s.res, pal = this._resPal, n = s.NCELL;
        for (let i = 0, p = 0; i < n; i++, p += 4) {
            let best = -1, bv = 0.08;
            for (let k = 0; k < 4; k++) {
                const v = res[k][i];
                if (v > bv) { bv = v; best = k; }
            }
            if (best < 0) {
                /* fade the barren ground back so deposits stand out */
                buf[p] *= 0.45; buf[p + 1] *= 0.45; buf[p + 2] *= 0.45;
                continue;
            }
            const c = pal[best];
            const a = 0.25 + bv * 0.7;
            buf[p] = buf[p] * (1 - a) + c[0] * a;
            buf[p + 1] = buf[p + 1] * (1 - a) + c[1] * a;
            buf[p + 2] = buf[p + 2] * (1 - a) + c[2] * a;
        }
    },

    /* Borders are traced only when the ownership map or a state assignment has
       actually changed. Territory moves a few times a century; tracing it every
       frame was scanning thirty thousand cells sixty times a second to redraw
       an identical outline. */
    _traceBorders(s) {
        const own = s.owner, est = s.eState;
        const GW = s.GW, GH = s.GH;
        const sb_ = this._segState, si_ = this._segInner;
        let ns = 0, ni = 0;

        for (let gy = 0, i = 0; gy < GH; gy++) {
            for (let gx = 0; gx < GW; gx++, i++) {
                const o = own[i];
                if (o < 0) continue;
                const st = est[o];

                /* Right and bottom edges are emitted whenever the neighbour
                   differs; left and top only against unowned ground. That way
                   an edge shared by two owned cells is emitted exactly once. */
                const ro = gx + 1 < GW ? own[i + 1] : -1;
                if (ro < 0 || est[ro] !== st) {
                    sb_[ns++] = gx + 1; sb_[ns++] = gy; sb_[ns++] = gx + 1; sb_[ns++] = gy + 1;
                } else if (ro !== o) {
                    si_[ni++] = gx + 1; si_[ni++] = gy; si_[ni++] = gx + 1; si_[ni++] = gy + 1;
                }

                const bo = gy + 1 < GH ? own[i + GW] : -1;
                if (bo < 0 || est[bo] !== st) {
                    sb_[ns++] = gx; sb_[ns++] = gy + 1; sb_[ns++] = gx + 1; sb_[ns++] = gy + 1;
                } else if (bo !== o) {
                    si_[ni++] = gx; si_[ni++] = gy + 1; si_[ni++] = gx + 1; si_[ni++] = gy + 1;
                }

                if ((gx > 0 ? own[i - 1] : -1) < 0) {
                    sb_[ns++] = gx; sb_[ns++] = gy; sb_[ns++] = gx; sb_[ns++] = gy + 1;
                }
                if ((gy > 0 ? own[i - GW] : -1) < 0) {
                    sb_[ns++] = gx; sb_[ns++] = gy; sb_[ns++] = gx + 1; sb_[ns++] = gy;
                }
            }
        }
        this._nSeg = ns;
        this._nInner = ni;
        this._borderVersion = s.ownerVersion;
    },

    _paintBorders(s, ox, oy, z) {
        const ctx = this.ctx, CELL = s.CELL;
        const k = CELL * z;

        /* seams between manors inside one state */
        if (this._nInner > 0) {
            const a = this._segInner;
            ctx.beginPath();
            for (let i = 0; i < this._nInner; i += 4) {
                ctx.moveTo(ox + a[i] * k, oy + a[i + 1] * k);
                ctx.lineTo(ox + a[i + 2] * k, oy + a[i + 3] * k);
            }
            ctx.strokeStyle = 'rgba(12,20,22,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        /* the hard border of a state */
        if (this._nSeg > 0) {
            const a = this._segState;
            ctx.beginPath();
            for (let i = 0; i < this._nSeg; i += 4) {
                ctx.moveTo(ox + a[i] * k, oy + a[i + 1] * k);
                ctx.lineTo(ox + a[i + 2] * k, oy + a[i + 3] * k);
            }
            ctx.strokeStyle = 'rgba(240,246,246,0.72)';
            ctx.lineWidth = Math.max(1, Math.min(2.5, z * 1.6));
            ctx.stroke();
        }
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

        /* One path per bucket, one fill. Twenty thousand separate fillRect
           calls spend most of their time re-validating canvas state; batching
           the rectangles into a path pays that cost eight times instead. */
        for (let b = 0; b < this._nb; b++) {
            const n = bn[b];
            if (n === 0) continue;
            /* Lords are few and matter; give them a bigger mark. */
            const sz = b === iL ? Math.max(3, d * 2) : d;
            const hf = sz * 0.5;
            const ax = bx[b], ay = by[b];
            ctx.beginPath();
            for (let k = 0; k < n; k++) ctx.rect(ax[k] - hf, ay[k] - hf, sz, sz);
            ctx.fillStyle = colors[b];
            ctx.fill();
        }
    },

    /* Manors, and which of them is a capital. The old circle-of-influence ring
       is gone: territory is drawn as the ground actually held, so a ring around
       the seat would only disagree with it. A state at war gets a red halo,
       which is the one thing the borders cannot show on their own. */
    _paintSeats(s, ox, oy, z) {
        const ctx = this.ctx;
        for (let e = 0; e < s.MAX_ESTATES; e++) {
            if (s.eAlive[e] === 0) continue;
            const px = ox + s.eSeatX[e] * z, py = oy + s.eSeatY[e] * z;
            if (px < -40 || py < -40 || px > this.vw + 40 || py > this.vh + 40) continue;

            const st = s.eState[e];
            const atWar = st >= 0 && s.stWar[st] >= 0;
            const capital = st >= 0 && s.stLead[st] === e;

            if (atWar || s.eBroke[e]) {
                ctx.strokeStyle = atWar ? 'rgba(226,96,60,0.85)' : 'rgba(226,96,60,0.45)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(px, py, Math.max(6, 3.4 * z), 0, 6.2831853);
                ctx.stroke();
            }

            const r = capital ? Math.max(3.4, 2.2 * z) : Math.max(2.2, 1.4 * z);
            ctx.fillStyle = capital ? '#fff2c8' : '#ffd76b';
            ctx.fillRect(px - r, py - r, r * 2, r * 2);
            ctx.strokeStyle = 'rgba(10,16,18,0.85)';
            ctx.lineWidth = 1;
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
