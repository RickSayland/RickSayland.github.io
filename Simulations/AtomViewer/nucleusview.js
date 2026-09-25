// ============ ATOM VIEWER — NUCLEUS VIEW ============
// Owns `nucleusView`: the nucleus drawn at femtometre scale on a 2-D canvas,
// sharing the atom view's camera so the two stay in the same orientation.
//
// A nucleus is at most ~300 balls, so this is plain canvas: depth-sort every
// frame and stamp pre-shaded sprites. The balls tremble a little — nucleons
// are never at rest, and a still picture reads as a solid object — and a
// decay plays out as the particles actually leaving: an alpha cluster peeling
// off the surface, an electron and antineutrino flying out while a neutron
// turns into a proton, an inner electron falling in for electron capture.

const nucleusView = (() => {
    let canvas = null, ctx = null;
    let pack = null;
    let zoom = 1;
    const sprites = { 1: [], 0: [] };
    const LEVELS = 10;
    let anim = null;
    let jig = null;

    function makeSprites() {
        const S = 96;
        const base = { 1: [255, 92, 80], 0: [150, 172, 205] };
        for (const type of [1, 0]) {
            for (let k = 0; k < LEVELS; k++) {
                const c = document.createElement('canvas');
                c.width = c.height = S;
                const g = c.getContext('2d');
                const shade = 0.38 + 0.62 * k / (LEVELS - 1);
                const [r, gg, b] = base[type].map(v => Math.round(v * shade));
                const grad = g.createRadialGradient(S * 0.36, S * 0.34, S * 0.04, S * 0.5, S * 0.5, S * 0.5);
                const hi = `rgb(${Math.min(255, r + 110 * shade)},${Math.min(255, gg + 100 * shade)},${Math.min(255, b + 100 * shade)})`;
                grad.addColorStop(0, hi);
                grad.addColorStop(0.45, `rgb(${r},${gg},${b})`);
                grad.addColorStop(1, `rgb(${Math.round(r * 0.35)},${Math.round(gg * 0.35)},${Math.round(b * 0.35)})`);
                g.fillStyle = grad;
                g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.fill();
                sprites[type].push(c);
            }
        }
    }

    function init(c) {
        canvas = c;
        ctx = canvas.getContext('2d');
        makeSprites();
    }

    function setNucleus(p) {
        pack = p;
        anim = null;
        const n = p ? p.A : 0;
        jig = new Float32Array(n * 6);
        for (let i = 0; i < n * 6; i++) jig[i] = Math.sin(i * 12.9898 + 4.1) * 43758.5453 % 1;
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    }

    function scalePx() {
        const W = canvas.width, H = canvas.height;
        const ext = pack ? (pack.R * (1 + 0.63 * pack.beta) + pack.rn) : 2;
        return 0.38 * Math.min(W, H) / Math.max(ext, 1.2) * zoom;
    }

    // ---- Decay animation ----
    // Primitive steps per decay mode; composite modes run them staggered.
    const STEPS = {
        'B-': ['B-'], 'B-N': ['B-', 'N'], 'B-2N': ['B-', 'N', 'N'], 'B-A': ['B-', 'A'], '2B-': ['B-', 'B-'],
        'B+': ['B+'], 'EC': ['EC'], 'EC+B+': ['B+'], '2EC': ['EC', 'EC'], '2B+': ['B+', 'B+'],
        'ECP': ['EC', 'P'], 'B+P': ['B+', 'P'], 'A': ['A'], 'N': ['N'], '2N': ['N', 'N'], 'P': ['P'], '2P': ['P', 'P'],
    };
    const canDecay = mode => !!STEPS[mode];

    function pickDir(seed) {
        const a = seed * 2.399, z = Math.cos(seed * 1.7) * 0.6;
        const r = Math.sqrt(1 - z * z);
        return [r * Math.cos(a), r * Math.sin(a), z];
    }

    // Returns false if the mode cannot be animated.
    function decay(mode, onDone) {
        if (!pack || !STEPS[mode]) return false;
        const steps = STEPS[mode];
        const used = new Set();
        const type = Uint8Array.from(pack.type);
        const actions = [];
        const pos = pack.pos;
        const outer = (want, u) => {
            let best = -1, bd = -Infinity;
            for (let i = 0; i < pack.A; i++) {
                if (used.has(i) || type[i] !== want) continue;
                const d = pos[3 * i] * u[0] + pos[3 * i + 1] * u[1] + pos[3 * i + 2] * u[2];
                if (d > bd) { bd = d; best = i; }
            }
            if (best >= 0) used.add(best);
            return best;
        };
        steps.forEach((s, k) => {
            const u = pickDir(performance.now() * 0.001 + k * 2.1);
            const delay = k * 0.35;
            if (s === 'A') {
                const ids = [outer(1, u), outer(1, u), outer(0, u), outer(0, u)].filter(i => i >= 0);
                actions.push({ kind: 'eject', ids, u, delay });
            } else if (s === 'N' || s === 'P') {
                const i = outer(s === 'N' ? 0 : 1, u);
                if (i >= 0) actions.push({ kind: 'eject', ids: [i], u, delay });
            } else if (s === 'B-' || s === 'B+' || s === 'EC') {
                const from = s === 'B-' ? 0 : 1;
                const i = outer(from, u);
                if (i < 0) return;
                actions.push({ kind: s, id: i, u, delay, to: 1 - from,
                               nu: pickDir(performance.now() * 0.0013 + k * 5.3) });
            }
        });
        anim = { t: 0, dur: 1.6 + 0.35 * (steps.length - 1), actions, onDone };
        return true;
    }

    function render(dt, time, M) {
        resize();
        const W = canvas.width, H = canvas.height;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, W, H);
        if (!pack || !pack.A) return;
        const s = scalePx();
        const cx = W / 2, cy = H / 2;

        // Halo: the diffuse nuclear surface.
        const Rpx = pack.R * s;
        const halo = ctx.createRadialGradient(cx, cy, Rpx * 0.4, cx, cy, Rpx * 1.5);
        halo.addColorStop(0, 'rgba(255,150,110,0.10)');
        halo.addColorStop(0.7, 'rgba(255,120,90,0.04)');
        halo.addColorStop(1, 'rgba(255,120,90,0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(cx, cy, Rpx * 1.5, 0, Math.PI * 2); ctx.fill();

        let type = pack.type;
        const moved = new Map();           // id → extra displacement (fm)
        const extras = [];                 // light particles: { x, y, z, kind }
        if (anim) {
            anim.t += dt;
            type = Uint8Array.from(pack.type);
            for (const a of anim.actions) {
                const t = anim.t - a.delay;
                if (t < 0) continue;
                if (a.kind === 'eject') {
                    const dist = t < 0.15 ? 0 : 3.2 * (t - 0.15) * (t - 0.15) * 10 + (t - 0.15) * 4;
                    for (const id of a.ids) moved.set(id, [a.u[0] * dist, a.u[1] * dist, a.u[2] * dist]);
                } else {
                    const i = a.id, p = [pack.pos[3 * i], pack.pos[3 * i + 1], pack.pos[3 * i + 2]];
                    if (a.kind === 'EC') {
                        // An inner electron falls in, then the proton becomes a neutron.
                        const inT = 0.45;
                        if (t < inT) {
                            const f = 1 - t / inT, far = 3 * pack.R + 6;
                            extras.push({ x: p[0] + a.u[0] * far * f, y: p[1] + a.u[1] * far * f, z: p[2] + a.u[2] * far * f, kind: 'e-' });
                        } else {
                            type[i] = a.to;
                            const d = (t - inT) * 40;
                            extras.push({ x: p[0] + a.nu[0] * d, y: p[1] + a.nu[1] * d, z: p[2] + a.nu[2] * d, kind: 'nu' });
                        }
                    } else {
                        if (t > 0.12) type[i] = a.to;
                        const d = t * 30;
                        extras.push({ x: p[0] + a.u[0] * d, y: p[1] + a.u[1] * d, z: p[2] + a.u[2] * d, kind: a.kind === 'B-' ? 'e-' : 'e+' });
                        const dn = t * 40;
                        extras.push({ x: p[0] + a.nu[0] * dn, y: p[1] + a.nu[1] * dn, z: p[2] + a.nu[2] * dn, kind: 'nu' });
                    }
                    if (t < 0.4) extras.push({ x: p[0], y: p[1], z: p[2], kind: 'flash', a: 1 - t / 0.4 });
                }
            }
            if (anim.t >= anim.dur) {
                const done = anim.onDone;
                anim = null;
                if (done) done();
                return;
            }
        }

        // Project and depth-sort.
        const A = pack.A;
        const order = new Array(A);
        const sx = new Float32Array(A), sy = new Float32Array(A), sz = new Float32Array(A);
        const amp = pack.rn * 0.07;
        for (let i = 0; i < A; i++) {
            let x = pack.pos[3 * i], y = pack.pos[3 * i + 1], z = pack.pos[3 * i + 2];
            const j = 6 * i;
            x += amp * Math.sin(time * (3 + 2 * jig[j]) + 6.28 * jig[j + 1]);
            y += amp * Math.sin(time * (3 + 2 * jig[j + 2]) + 6.28 * jig[j + 3]);
            z += amp * Math.sin(time * (3 + 2 * jig[j + 4]) + 6.28 * jig[j + 5]);
            const m = moved.get(i);
            if (m) { x += m[0]; y += m[1]; z += m[2]; }
            sx[i] = M[0][0] * x + M[0][1] * y + M[0][2] * z;
            sy[i] = M[1][0] * x + M[1][1] * y + M[1][2] * z;
            sz[i] = M[2][0] * x + M[2][1] * y + M[2][2] * z;
            order[i] = i;
        }
        order.sort((a, b) => sz[a] - sz[b]);
        const zr = Math.max(pack.R, 1);
        const rpx = pack.rn * s;
        for (const i of order) {
            const depth = Math.max(0, Math.min(1, 0.5 + 0.5 * sz[i] / zr));
            const k = Math.round(depth * (LEVELS - 1));
            const px = cx + sx[i] * s, py = cy - sy[i] * s;
            if (px < -rpx || py < -rpx || px > W + rpx || py > H + rpx) continue;
            ctx.drawImage(sprites[type[i]][k], px - rpx, py - rpx, 2 * rpx, 2 * rpx);
        }

        for (const e of extras) {
            const x = M[0][0] * e.x + M[0][1] * e.y + M[0][2] * e.z;
            const y = M[1][0] * e.x + M[1][1] * e.y + M[1][2] * e.z;
            const px = cx + x * s, py = cy - y * s;
            if (e.kind === 'flash') {
                const g = ctx.createRadialGradient(px, py, 0, px, py, rpx * 3);
                g.addColorStop(0, `rgba(255,255,220,${0.8 * e.a})`);
                g.addColorStop(1, 'rgba(255,255,220,0)');
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(px, py, rpx * 3, 0, Math.PI * 2); ctx.fill();
                continue;
            }
            const col = e.kind === 'e-' ? '#6fd3ff' : e.kind === 'e+' ? '#ff7ad9' : 'rgba(230,230,255,0.55)';
            const rad = e.kind === 'nu' ? 2 * dpr : 4 * dpr;
            ctx.fillStyle = col;
            ctx.shadowColor = col;
            ctx.shadowBlur = 10 * dpr;
            ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }

        // Scale bar, bottom right above the hint.
        const nice = [0.5, 1, 2, 5, 10, 20];
        let fm = nice[0];
        for (const n of nice) if (n * s < W * 0.22) fm = n;
        const bx = W - 18 * dpr - fm * s, by = H - 30 * dpr;
        ctx.strokeStyle = 'rgba(215,225,240,0.75)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(bx, by - 4 * dpr); ctx.lineTo(bx, by); ctx.lineTo(bx + fm * s, by); ctx.lineTo(bx + fm * s, by - 4 * dpr);
        ctx.stroke();
        ctx.fillStyle = 'rgba(215,225,240,0.85)';
        ctx.font = `${11 * dpr}px "Share Tech Mono", monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(fm + ' fm', bx + fm * s, by - 6 * dpr);
    }

    function zoomBy(f) { zoom = Math.max(0.4, Math.min(3, zoom * f)); }

    return {
        init, setNucleus, render, decay, canDecay, zoomBy,
        get busy() { return !!anim; },
        get pxPerFm() { return canvas && canvas.width ? scalePx() / (window.devicePixelRatio || 1) : 0; },
    };
})();
