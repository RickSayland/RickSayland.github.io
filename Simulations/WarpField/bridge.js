// ============ WARP FIELD ENGINEERING — BRIDGE VIEW ============
// What the crew see. Owns no physics: every direction goes through the
// optics table, every colour through the Doppler factor it returns.
//
// Colour and brightness are not tinted by eye. A blackbody seen with
// Doppler factor D is exactly a blackbody at D·T, so each star is looked up
// in a table of Planck intensities at three wavelengths (610, 550, 465 nm):
// the ratio at 550 nm is how much brighter it gets in the visible, the three
// together are its colour. Hot blue stars ahead brighten roughly as D (the
// Rayleigh–Jeans tail); astern, the Wien tail cuts them off exponentially.
//
// Stars go into a pixel buffer at CSS resolution and are blitted up; only
// bright ones and solid bodies are drawn with paths.

const BAND = [610e-9, 550e-9, 465e-9];
const HC_K = 0.014387769;          // hc/k, m·K

function planckB(lam, T) {
    const x = HC_K / (lam * T);
    if (x > 700) return 0;
    return 1 / (Math.pow(lam, 5) * Math.expm1(x));
}

const BB = (() => {
    const n = 600, lo = Math.log(400), hi = Math.log(3e6);
    const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), vis = new Float64Array(n);
    const ref = BAND.map(l => planckB(l, 5772));
    for (let i = 0; i < n; i++) {
        const T = Math.exp(lo + (hi - lo) * i / (n - 1));
        const R = planckB(BAND[0], T) / ref[0], G = planckB(BAND[1], T) / ref[1], B = planckB(BAND[2], T) / ref[2];
        const m = Math.max(R, G, B) || 1;
        r[i] = R / m; g[i] = G / m; b[i] = B / m;
        vis[i] = G;
    }
    return { n, lo, hi, r, g, b, vis };
})();
function bbIdx(T) {
    const u = (Math.log(Math.max(T, 400)) - BB.lo) / (BB.hi - BB.lo) * (BB.n - 1);
    return Math.max(0, Math.min(BB.n - 1, Math.round(u)));
}
// Visible-band brightness of a blackbody at T, relative to the Sun's.
function bbVis(T) {
    if (T > 3e6) return BB.vis[BB.n - 1] * T / 3e6;
    return BB.vis[bbIdx(T)];
}

const bridge = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    star: null, sctx: null, img: null, SW: 0, SH: 0,
    fov: 70 * Math.PI / 180,
    lookYaw: 0, lookPitch: 0,
    targetScreen: null,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.star = document.createElement('canvas');
        this.sctx = this.star.getContext('2d');
        this.resize();
        let drag = null;
        canvas.addEventListener('pointerdown', e => {
            drag = { x: e.clientX, y: e.clientY, yaw: this.lookYaw, pitch: this.lookPitch };
            canvas.setPointerCapture(e.pointerId);
            canvas.classList.add('dragging');
        });
        canvas.addEventListener('pointermove', e => {
            if (!drag) return;
            const k = this.fov / this.H;
            this.lookYaw = drag.yaw - (e.clientX - drag.x) * k;
            this.lookPitch = Math.max(-1.5, Math.min(1.5, drag.pitch + (e.clientY - drag.y) * k));
        });
        const end = () => { drag = null; canvas.classList.remove('dragging'); };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            this.fov = Math.max(8 * Math.PI / 180, Math.min(130 * Math.PI / 180, this.fov * Math.exp(e.deltaY * 0.001)));
        }, { passive: false });
        canvas.addEventListener('dblclick', () => { this.lookYaw = 0; this.lookPitch = 0; });
    },

    resize() {
        const r = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = Math.max(1, r.width);
        this.H = Math.max(1, r.height);
        this.canvas.width = Math.round(this.W * this.dpr);
        this.canvas.height = Math.round(this.H * this.dpr);
        this.SW = Math.max(1, Math.round(this.W));
        this.SH = Math.max(1, Math.round(this.H));
        this.star.width = this.SW;
        this.star.height = this.SH;
        this.img = this.sctx.createImageData(this.SW, this.SH);
    },

    // Camera basis: the ship's, turned by the free-look offsets.
    camera(s) {
        let f = s.fwd, u = s.up, r = s.right;
        const cy = Math.cos(this.lookYaw), sy = Math.sin(this.lookYaw);
        let f2 = [f[0] * cy + r[0] * -sy, f[1] * cy + r[1] * -sy, f[2] * cy + r[2] * -sy];
        let r2 = v3cross(f2, u);
        const cp = Math.cos(this.lookPitch), sp = Math.sin(this.lookPitch);
        const f3 = [f2[0] * cp + u[0] * -sp, f2[1] * cp + u[1] * -sp, f2[2] * cp + u[2] * -sp];
        const u3 = v3cross(r2, f3);
        return { f: f3, u: u3, r: r2 };
    },

    draw(s, t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const cam = this.camera(s);
        const F = (H / 2) / Math.tan(this.fov / 2);
        const cx = W / 2, cy = H / 2;
        const fw = s.fwd, up = s.up;
        const data = this.img.data;
        data.fill(0);
        const SW = this.SW, SH = this.SH;
        const bright = [];
        const kx = SW / W, ky = SH / H;
        const identity = !optics.table || optics.table.identity;

        // Map a true direction to its images on screen. cb(px, py, D, mu).
        const view = (d, cb) => {
            const c = Math.max(-1, Math.min(1, d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2]));
            if (identity) {
                const z = d[0] * cam.f[0] + d[1] * cam.f[1] + d[2] * cam.f[2];
                if (z < 0.02) return;
                cb(cx + (d[0] * cam.r[0] + d[1] * cam.r[1] + d[2] * cam.r[2]) / z * F,
                   cy - (d[0] * cam.u[0] + d[1] * cam.u[1] + d[2] * cam.u[2]) / z * F, 1, 1);
                return;
            }
            const th = Math.acos(c);
            let px = d[0] - c * fw[0], py = d[1] - c * fw[1], pz = d[2] - c * fw[2];
            let pl = Math.sqrt(px * px + py * py + pz * pz);
            if (pl < 1e-12) { px = up[0]; py = up[1]; pz = up[2]; pl = 1; }
            px /= pl; py /= pl; pz /= pl;
            optics.images(th, (tho, flip, D, mu) => {
                const ct = Math.cos(tho), st = Math.sin(tho) * (flip ? -1 : 1);
                const ax = ct * fw[0] + st * px, ay = ct * fw[1] + st * py, az = ct * fw[2] + st * pz;
                const z = ax * cam.f[0] + ay * cam.f[1] + az * cam.f[2];
                if (z < 0.02) return;
                cb(cx + (ax * cam.r[0] + ay * cam.r[1] + az * cam.r[2]) / z * F,
                   cy - (ax * cam.u[0] + ay * cam.u[1] + az * cam.u[2]) / z * F, D, mu);
            });
        };

        // A point source of magnitude m and temperature T: into the buffer
        // if faint, onto the bright list if not.
        const MREF = 1.2;
        let late = false;       // true once the buffer is on screen
        const plot = (x, y, m, T, D, mu) => {
            if (x < -4 || y < -4 || x > W + 4 || y > H + 4) return;
            const Td = T * D;
            const gain = mu * bbVis(Td) / bbVis(T);
            if (!(gain > 1e-6)) return;
            const me = m - 2.5 * Math.log10(gain);
            if (me > 8.2) return;
            const I = Math.pow(10, -0.4 * (me - MREF));
            const k = bbIdx(Td);
            if (I > 0.9) { bright.push({ x, y, I, r: BB.r[k], g: BB.g[k], b: BB.b[k] }); return; }
            if (late) {
                const a = Math.pow(I, 0.55);
                ctx.fillStyle = `rgba(${(255 * BB.r[k]) | 0},${(255 * BB.g[k]) | 0},${(255 * BB.b[k]) | 0},${a.toFixed(3)})`;
                ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
                return;
            }
            const px = (x * kx) | 0, py = (y * ky) | 0;
            if (px < 0 || py < 0 || px >= SW || py >= SH) return;
            const v = 255 * Math.pow(I, 0.55);
            const o = (py * SW + px) * 4;
            data[o] = Math.min(255, data[o] + v * BB.r[k]);
            data[o + 1] = Math.min(255, data[o + 1] + v * BB.g[k]);
            data[o + 2] = Math.min(255, data[o + 2] + v * BB.b[k]);
            data[o + 3] = 255;
        };

        // ---- Faint background ----
        const bg = space.bg;
        const dir = [0, 0, 0];
        for (let i = 0; i < space.bgCount; i++) {
            dir[0] = bg[i * 5]; dir[1] = bg[i * 5 + 1]; dir[2] = bg[i * 5 + 2];
            const m = bg[i * 5 + 3], T = bg[i * 5 + 4];
            view(dir, (x, y, D, mu) => plot(x, y, m, T, D, mu));
        }

        // ---- Named stars, at their real distances ----
        this.targetScreen = null;
        const discs = [];
        for (const st of space.stars) {
            const dx = st.pos[0] - s.pos[0], dy = st.pos[1] - s.pos[1], dz = st.pos[2] - s.pos[2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            dir[0] = dx / d; dir[1] = dy / d; dir[2] = dz / d;
            const ang = Math.asin(Math.min(1, st.radius / d));
            if (ang * F > 1.5) { discs.push({ kind: 'star', b: st, d, dir: dir.slice(), ang }); continue; }
            const m = st.absMag + 5 * Math.log10(d / PHYS.PC / 10);
            const isT = st.id === s.target;
            view(dir, (x, y, D, mu) => {
                plot(x, y, m, st.T, D, mu);
                if (isT && !this.targetScreen) this.targetScreen = { x, y, r: 6 };
            });
        }
        this.sctx.putImageData(this.img, 0, 0);

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.star, 0, 0, W, H);
        late = true;

        this.drawBright(bright.splice(0));

        // ---- Sun, planets, Moon ----
        const labels = [];
        const P = [0, 0, 0];
        for (const b of space.bodies) {
            space.apparentPos(b.id, t, s.pos, P);
            const dx = P[0] - s.pos[0], dy = P[1] - s.pos[1], dz = P[2] - s.pos[2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            discs.push({ kind: b.type === 'star' ? 'sun' : 'planet', b, d, dir: [dx / d, dy / d, dz / d], ang: Math.asin(Math.min(1, b.radius / d)), pos: P.slice() });
        }
        discs.sort((a, b) => b.d - a.d);
        for (const it of discs) this.drawBody(it, s, view, plot, F, labels);

        // Anything that fell to the bright list after the buffer went up.
        this.drawBright(bright.splice(0));

        // ---- Labels and HUD ----
        ctx.font = '11px "Share Tech Mono", monospace';
        for (const l of labels) {
            ctx.fillStyle = l.target ? '#ffb547' : 'rgba(170,190,215,0.75)';
            ctx.fillText(l.text, l.x + 8, l.y - 6);
        }
        this.hud(s, t, cam, F, cx, cy);
    },

    // Bright point sources: a hard core plus a halo that grows with the log
    // of brightness, so a star ten times brighter reads brighter without
    // turning into a lamp.
    drawBright(list) {
        if (!list.length) return;
        const ctx = this.ctx;
        ctx.globalCompositeOperation = 'lighter';
        for (const b of list) {
            const L = Math.log10(b.I + 1);
            const core = Math.min(2.6, 0.9 + 0.8 * L);
            const halo = Math.min(11, core * (1.8 + 1.2 * L));
            const col = `${(255 * b.r) | 0},${(255 * b.g) | 0},${(255 * b.b) | 0}`;
            const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, halo);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(core / halo, `rgba(${col},0.85)`);
            g.addColorStop(Math.min(1, 2.2 * core / halo), `rgba(${col},${Math.min(0.35, 0.12 * L + 0.08).toFixed(2)})`);
            g.addColorStop(1, `rgba(${col},0)`);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(b.x, b.y, halo, 0, 2 * Math.PI); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
    },

    drawBody(it, s, view, plot, F, labels) {
        const ctx = this.ctx, b = it.b;
        const isT = b.id === s.target;
        let img = null;
        view(it.dir, (x, y, D, mu) => { if (!img || mu > img.mu) img = { x, y, D, mu }; });
        if (!img) return;
        const T = b.type === 'star' ? b.T : 5772;
        const rpx = Math.min(F * Math.tan(Math.min(it.ang, 1.4)) * Math.sqrt(img.mu), 4 * this.H);

        if (b.type === 'star') {
            const m = b.absMag + 5 * Math.log10(it.d / PHYS.PC / 10);
            const gain = img.mu * bbVis(T * img.D) / bbVis(T);
            const k = bbIdx(T * img.D);
            const col = `${(255 * BB.r[k]) | 0},${(255 * BB.g[k]) | 0},${(255 * BB.b[k]) | 0}`;
            if (rpx < 1.5) {
                plot(img.x, img.y, m, T, img.D, img.mu);
            } else {
                // Glare scales with how bright the star really is from here.
                const me = m - 2.5 * Math.log10(Math.max(gain, 1e-30));
                const glare = Math.min(this.H * 0.8, rpx * 2 + Math.max(0, -me) * 6);
                ctx.globalCompositeOperation = 'lighter';
                const g = ctx.createRadialGradient(img.x, img.y, rpx * 0.9, img.x, img.y, rpx + glare);
                g.addColorStop(0, `rgba(${col},0.55)`);
                g.addColorStop(1, `rgba(${col},0)`);
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(img.x, img.y, rpx + glare, 0, 2 * Math.PI); ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = gain > 1e-4 ? `rgb(${col})` : '#1a0a06';
                ctx.beginPath(); ctx.arc(img.x, img.y, rpx, 0, 2 * Math.PI); ctx.fill();
            }
            if (it.kind === 'sun' || isT || rpx >= 1.5) {
                labels.push({ x: img.x, y: img.y, text: `${b.name} · ${fmtDist(it.d)}`, target: isT });
            }
            if (isT) this.targetScreen = { x: img.x, y: img.y, r: Math.max(6, rpx) };
            return;
        }

        // Reflected sunlight: phase angle between the Sun and the ship, seen
        // from the planet.
        const P = it.pos;
        const rs = Math.hypot(P[0], P[1], P[2]);
        const sd = [-P[0] / rs, -P[1] / rs, -P[2] / rs];
        const cosPh = -(sd[0] * it.dir[0] + sd[1] * it.dir[1] + sd[2] * it.dir[2]);
        const ph = Math.acos(Math.max(-1, Math.min(1, cosPh)));
        const tintK = bbIdx(5772 * img.D), baseK = bbIdx(5772);
        const lum = Math.max(0.12, Math.min(2.2, bbVis(5772 * img.D) / bbVis(5772) * img.mu));
        const base = hexRgb(b.color);
        const tint = [BB.r[tintK] / BB.r[baseK], BB.g[tintK] / BB.g[baseK], BB.b[tintK] / BB.b[baseK]];
        const lit = base.map((c, i) => Math.min(255, c * tint[i] * lum));

        if (rpx < 1.5) {
            const Phi = (Math.sin(ph) + (Math.PI - ph) * Math.cos(ph)) / Math.PI;
            const flux = b.albedo * Math.max(Phi, 1e-4) * Math.pow(b.radius / it.d, 2) * Math.pow(PHYS.AU / rs, 2);
            const m = -26.74 - 2.5 * Math.log10(flux);
            plot(img.x, img.y, m, 5772, img.D, img.mu);
            // Label what can actually be seen, after the Doppler shift.
            const seen = m - 2.5 * Math.log10(Math.max(1e-30, img.mu * bbVis(5772 * img.D) / bbVis(5772)));
            if (img.x > 0 && img.x < this.W && img.y > 0 && img.y < this.H && (seen < 6 || isT)) {
                labels.push({ x: img.x, y: img.y, text: `${b.name} · ${fmtDist(it.d)}`, target: isT });
            }
            if (isT) this.targetScreen = { x: img.x, y: img.y, r: 6 };
            return;
        }

        // Which way is the Sun, on screen? Push a point on the planet toward
        // it through the same optics and see where it lands.
        let sx = 1, sy = 0;
        {
            const q = [P[0] + sd[0] * b.radius * 0.5 - s.pos[0], P[1] + sd[1] * b.radius * 0.5 - s.pos[1], P[2] + sd[2] * b.radius * 0.5 - s.pos[2]];
            const ql = Math.hypot(q[0], q[1], q[2]);
            let best = null;
            view([q[0] / ql, q[1] / ql, q[2] / ql], (x, y) => {
                const dd = Math.hypot(x - img.x, y - img.y);
                if (!best || dd < best.dd) best = { x, y, dd };
            });
            if (best && best.dd > 1e-6) { sx = (best.x - img.x) / best.dd; sy = (best.y - img.y) / best.dd; }
        }

        ctx.save();
        ctx.translate(img.x, img.y);
        ctx.rotate(Math.atan2(sy, sx));
        ctx.fillStyle = `rgb(${lit.map(c => (c * 0.06) | 0).join(',')})`;
        ctx.beginPath(); ctx.arc(0, 0, rpx, 0, 2 * Math.PI); ctx.fill();
        const g = ctx.createRadialGradient(rpx * 0.35, 0, rpx * 0.1, 0, 0, rpx);
        g.addColorStop(0, `rgb(${lit.map(c => Math.min(255, c * 1.15) | 0).join(',')})`);
        g.addColorStop(1, `rgb(${lit.map(c => (c * 0.55) | 0).join(',')})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rpx, -Math.PI / 2, Math.PI / 2);
        const ex = rpx * Math.abs(Math.cos(ph));
        ctx.ellipse(0, 0, Math.max(ex, 0.01), rpx, 0, Math.PI / 2, -Math.PI / 2, ph > Math.PI / 2);
        ctx.fill();
        if (b.id === 'earth') {
            ctx.strokeStyle = 'rgba(120,170,255,0.35)';
            ctx.lineWidth = Math.max(1, rpx * 0.03);
            ctx.beginPath(); ctx.arc(0, 0, rpx * 1.01, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        }
        ctx.restore();
        labels.push({ x: img.x + rpx * 0.7, y: img.y - rpx * 0.7, text: `${b.name} · ${fmtDist(it.d - b.radius)}`, target: isT });
        if (isT) this.targetScreen = { x: img.x, y: img.y, r: rpx };
    },

    hud(s, t, cam, F, cx, cy) {
        const ctx = this.ctx, W = this.W, H = this.H;
        const proj = d => {
            const z = v3dot(d, cam.f);
            if (z < 0.02) return null;
            return [cx + v3dot(d, cam.r) / z * F, cy - v3dot(d, cam.u) / z * F];
        };
        // Bow: the direction the bubble moves.
        const bow = proj(s.fwd);
        if (bow) {
            ctx.strokeStyle = 'rgba(95,212,255,0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(bow[0], bow[1], 9, 0, 2 * Math.PI);
            ctx.moveTo(bow[0] - 18, bow[1]); ctx.lineTo(bow[0] - 11, bow[1]);
            ctx.moveTo(bow[0] + 11, bow[1]); ctx.lineTo(bow[0] + 18, bow[1]);
            ctx.moveTo(bow[0], bow[1] - 18); ctx.lineTo(bow[0], bow[1] - 11);
            ctx.stroke();
        }
        // Target bracket, or an arrow toward it.
        const ts = this.targetScreen;
        if (ts && ts.x > -20 && ts.x < W + 20 && ts.y > -20 && ts.y < H + 20) {
            const r = ts.r + 8;
            ctx.strokeStyle = '#ffb547';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                ctx.moveTo(ts.x + sx * r, ts.y + sy * (r - 6));
                ctx.lineTo(ts.x + sx * r, ts.y + sy * r);
                ctx.lineTo(ts.x + sx * (r - 6), ts.y + sy * r);
            }
            ctx.stroke();
        } else {
            const g = s.targetGeom();
            const z = v3dot(g.dir, cam.f);
            let ax = v3dot(g.dir, cam.r), ay = -v3dot(g.dir, cam.u);
            if (z < 0) { ax = -ax; ay = -ay; }
            const l = Math.hypot(ax, ay) || 1;
            const ex = cx + ax / l * (W / 2 - 40), ey = cy + ay / l * (H / 2 - 40);
            ctx.save();
            ctx.translate(Math.max(30, Math.min(W - 30, ex)), Math.max(30, Math.min(H - 30, ey)));
            ctx.rotate(Math.atan2(ay, ax));
            ctx.fillStyle = '#ffb547';
            ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.fill();
            ctx.restore();
        }

        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(140,160,190,0.8)';
        const tab = optics.table;
        const mode = !tab || tab.identity ? 'at rest — no warp optics'
            : s.isShell() ? 'aberration + Doppler + shell potential (analytic)'
            : 'null geodesics traced through the metric';
        ctx.fillText(`BRIDGE · FOV ${(this.fov * 180 / Math.PI).toFixed(0)}° · ${mode}${optics.building ? ' · retracing…' : ''}`, 12, 20);
        if (s.horizon()) {
            ctx.fillStyle = 'rgba(255,181,71,0.9)';
            ctx.fillText('Sky astern is dark: those rays trace back to the rear horizon and never leave it', 12, 36);
        }
    }
};

function hexRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
