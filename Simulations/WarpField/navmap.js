// ============ WARP FIELD ENGINEERING — NAVIGATION MAP ============
// Top-down on the ecliptic, centred on the ship. Owns no physics.
// Wheel zooms across fifteen decades, from a planet's neighbourhood to the
// nearest stars; click picks a destination.

const navmap = {
    canvas: null, ctx: null, dpr: 1, W: 0, H: 0,
    half: 4e8,                 // metres from centre to the nearer edge
    orbitCache: null,
    orbitAt: -1e18,
    onPick: null,

    init(canvas, onPick) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onPick = onPick;
        this.resize();
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            this.half = Math.max(2e7, Math.min(4e17, this.half * Math.exp(e.deltaY * 0.0015)));
        }, { passive: false });
        canvas.addEventListener('click', e => {
            const r = canvas.getBoundingClientRect();
            this.pick(e.clientX - r.left, e.clientY - r.top);
        });
    },

    resize() {
        const r = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.W = Math.max(1, r.width);
        this.H = Math.max(1, r.height);
        this.canvas.width = Math.round(this.W * this.dpr);
        this.canvas.height = Math.round(this.H * this.dpr);
    },

    scale() { return Math.min(this.W, this.H) / 2 / this.half; },

    toScreen(p, s, out) {
        const k = this.scale();
        out[0] = this.W / 2 + (p[0] - s.pos[0]) * k;
        out[1] = this.H / 2 - (p[1] - s.pos[1]) * k;
        return out;
    },

    // Orbits change slowly; resample them every ten simulated days.
    orbits(t) {
        if (this.orbitCache && Math.abs(t - this.orbitAt) < 864000) return this.orbitCache;
        const T = t / (86400 * 36525);
        const out = {};
        for (const b of space.bodies) {
            if (b.type !== 'planet') continue;
            const pts = [];
            const el = b.el.slice();
            for (let k = 0; k <= 180; k++) {
                // Sweep mean longitude through a full revolution.
                el[3] = b.el[3] + b.rate[3] * T + k * 2;
                pts.push(space.kepler(el, [b.rate[0], b.rate[1], b.rate[2], 0, b.rate[4], b.rate[5]], T, [0, 0, 0]));
            }
            out[b.id] = pts;
        }
        this.orbitCache = out;
        this.orbitAt = t;
        return out;
    },

    draw(s, t) {
        const ctx = this.ctx, W = this.W, H = this.H;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = '#03050a';
        ctx.fillRect(0, 0, W, H);
        const k = this.scale();
        const q = [0, 0];
        this.hits = [];

        // Planetary orbits.
        const orb = this.orbits(t);
        ctx.lineWidth = 1;
        for (const id in orb) {
            const a = space.byId[id].el[0] * PHYS.AU;
            if (a * k < 3) continue;
            ctx.strokeStyle = id === s.target ? 'rgba(255,181,71,0.45)' : 'rgba(90,120,160,0.28)';
            ctx.beginPath();
            orb[id].forEach((p, i) => { this.toScreen(p, s, q); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
            ctx.stroke();
        }
        // The Moon's orbit around Earth, and the heliopause.
        const E = space.bodyPos('earth', t);
        this.toScreen(E, s, q);
        if (3.844e8 * k > 4) {
            ctx.strokeStyle = 'rgba(90,120,160,0.25)';
            ctx.beginPath(); ctx.arc(q[0], q[1], 3.844e8 * k, 0, 2 * Math.PI); ctx.stroke();
        }
        const hp = 120 * PHYS.AU * k;
        if (hp > 20 && hp < 4 * W) {
            this.toScreen([0, 0, 0], s, q);
            ctx.setLineDash([4, 6]);
            ctx.strokeStyle = 'rgba(140,110,200,0.3)';
            ctx.beginPath(); ctx.arc(q[0], q[1], hp, 0, 2 * Math.PI); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(140,110,200,0.5)';
            ctx.font = '9px "Share Tech Mono", monospace';
            ctx.fillText('heliopause', q[0] + hp * 0.7 + 4, q[1] - hp * 0.7);
        }

        // Bodies.
        ctx.font = '10px "Share Tech Mono", monospace';
        const P = [0, 0, 0];
        for (const b of space.bodies) {
            space.bodyPos(b.id, t, P);
            this.toScreen(P, s, q);
            if (q[0] < -40 || q[1] < -40 || q[0] > W + 40 || q[1] > H + 40) continue;
            const rp = Math.max(b.type === 'star' ? 3.5 : 2.2, b.radius * k);
            ctx.fillStyle = b.type === 'star' ? '#ffe9a8' : b.color;
            ctx.beginPath(); ctx.arc(q[0], q[1], Math.min(rp, 2 * W), 0, 2 * Math.PI); ctx.fill();
            this.hits.push({ id: b.id, x: q[0], y: q[1] });
            // Crowded near the Sun at system scale: only label what has room.
            if (b.id === s.target || b.type === 'star' || this.roomy(b, t, k)) {
                ctx.fillStyle = b.id === s.target ? '#ffb547' : 'rgba(170,190,215,0.8)';
                ctx.fillText(b.name, q[0] + rp + 4, q[1] + 3);
            }
        }
        // Stars, when the scale reaches them.
        for (const st of space.stars) {
            this.toScreen(st.pos, s, q);
            if (q[0] < -10 || q[1] < -10 || q[0] > W + 10 || q[1] > H + 10) continue;
            const bright = st.absMag < 6 || st.target;
            ctx.fillStyle = st.id === s.target ? '#ffb547' : bright ? '#cfd8ff' : '#56627a';
            ctx.beginPath(); ctx.arc(q[0], q[1], bright ? 2.4 : 1.5, 0, 2 * Math.PI); ctx.fill();
            this.hits.push({ id: st.id, x: q[0], y: q[1] });
            if (st.target || st.id === s.target) {
                ctx.fillStyle = st.id === s.target ? '#ffb547' : 'rgba(170,190,215,0.7)';
                ctx.fillText(st.name, q[0] + 5, q[1] + 3);
            }
        }

        // Where we are going: live line, or the committed plan with its
        // braking point marked.
        const g = s.targetGeom();
        const c0 = [W / 2, H / 2];
        this.toScreen(g.pos, s, q);
        if (s.plan && s.plan.committed) {
            const L = s.plan.remaining;
            const end = [s.pos[0] + s.plan.dir[0] * L, s.pos[1] + s.plan.dir[1] * L, s.pos[2] + s.plan.dir[2] * L];
            const e = this.toScreen(end, s, [0, 0]);
            ctx.strokeStyle = '#ffb547';
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
            const bd = Math.max(0, L - s.stopDist(s.effCruise()));
            const bp = this.toScreen([s.pos[0] + s.plan.dir[0] * bd, s.pos[1] + s.plan.dir[1] * bd, 0], s, [0, 0]);
            ctx.fillStyle = '#ff4f4f';
            ctx.fillRect(bp[0] - 2, bp[1] - 2, 4, 4);
        } else {
            ctx.setLineDash([3, 4]);
            ctx.strokeStyle = 'rgba(255,181,71,0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.strokeStyle = '#ffb547';
        ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, 2 * Math.PI); ctx.stroke();

        // The ship.
        const fx = s.fwd[0], fy = -s.fwd[1];
        const fl = Math.hypot(fx, fy) || 1;
        ctx.save();
        ctx.translate(c0[0], c0[1]);
        ctx.rotate(Math.atan2(fy / fl, fx / fl));
        ctx.fillStyle = s.horizon() ? '#ffb547' : '#5fd4ff';
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -5); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
        ctx.restore();

        this.scaleBar();
    },

    // Label a planet only if its neighbours are not on top of it.
    roomy(b, t, k) {
        if (b.type !== 'planet' && b.type !== 'moon') return true;
        if (b.id === 'moon') return 3.844e8 * k > 40;
        return b.el[0] * PHYS.AU * k > 26;
    },

    scaleBar() {
        const ctx = this.ctx, k = this.scale();
        const target = this.W * 0.28 / k;
        const units = [[1e3, 'km'], [PHYS.AU, 'AU'], [PHYS.LY, 'ly']];
        let u = units[0];
        if (target > 0.3 * PHYS.AU) u = units[1];
        if (target > 0.3 * PHYS.LY) u = units[2];
        const raw = target / u[0];
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / p >= 5 ? 5 * p : raw / p >= 2 ? 2 * p : p;
        const len = n * u[0] * k;
        const x = 12, y = this.H - 14;
        ctx.strokeStyle = '#8193ab';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4); ctx.stroke();
        ctx.fillStyle = '#8193ab';
        ctx.font = '10px "Share Tech Mono", monospace';
        const lt = fmtTime(n * u[0] / PHYS.c);
        ctx.fillText(`${n.toLocaleString('en-US')} ${u[1]} · ${lt} of light`, x, y - 7);
    },

    pick(x, y) {
        let best = null, bd = 12;
        for (const h of this.hits || []) {
            const d = Math.hypot(h.x - x, h.y - y);
            if (d < bd) { bd = d; best = h; }
        }
        if (best && this.onPick) this.onPick(best.id);
    }
};
