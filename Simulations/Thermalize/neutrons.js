// ============ THERMALIZE — NEUTRON TRANSPORT ============
// One particle is one neutron. No weights, no dice for whether it interacts:
// a collision happens when the neutron's straight line actually passes inside
// a nucleus's disc, and WHERE it crosses that disc decides everything else.
// Zero DOM. Owns `neutrons`.
//
// The disc of a nucleus is cut into rings by impact parameter, innermost
// first, each as wide as its reaction's share of the total cross section:
//
//     fission | capture | (n,2n) | inelastic | elastic
//
// so a dead-centre hit on uranium-235 fissions, a hit on boron's core is
// absorbed, and the outer annulus scatters. Inside the elastic annulus the
// impact parameter is the scattering angle: nearest the centre is head-on
// and loses the most energy the target's mass allows, the rim is a graze
// that loses none. Mapped linearly, that is exactly isotropic scattering in
// the centre of mass — the energy after a collision comes out uniform between
// alpha*E and E, as it should, with no random number spent on it.
//
// THE CLOCK IS WARPED, THE GEOMETRY IS NOT. A 2 MeV neutron is 9,000 times
// faster than a thermal one; drawn at true ratios the whole slowing-down is
// over inside one frame. On-screen speed is compressed to about 11:1
// (`speed`). Where collisions happen is untouched, because each flight is a
// straight line through the same discs whatever the clock says.

const neutrons = {

    MAX: 4000,
    RCAP: 1.0,              // cells: the widest a disc is allowed to reach
    STEP: 0.5,              // cells: longest stride between hit tests
    V_TH: 5,                // cells per second, on screen, at 0.0253 eV
    V_K: 1.27,              // extra per decade of energy above that

    n: 0,
    nextId: 1,
    x: null, y: null, ux: null, uy: null, E: null,
    id: null, nc: null, lc: null, ls: null,

    burn: true,             // a capture turns the atom into its product

    // The followed neutron. `follow` is its id (0 for none) and fIdx its slot,
    // which moves when another neutron's death compacts the arrays.
    follow: 0,
    fIdx: -1,
    f: null,
    trail: [],              // x, y, energy of the flight that ENDED there
    hist: [],               // energy after each collision
    histK: [],              // 0 a collision, 1 born from a fission

    fx: [],
    tally: null,

    _r: () => rng.next(),

    init() {
        const M = this.MAX;
        this.x = new Float64Array(M); this.y = new Float64Array(M);
        this.ux = new Float64Array(M); this.uy = new Float64Array(M);
        this.E = new Float64Array(M);
        this.id = new Int32Array(M); this.nc = new Int32Array(M);
        this.lc = new Int32Array(M); this.ls = new Int8Array(M);
        this.reset();
    },

    reset() {
        this.n = 0;
        this.follow = 0; this.fIdx = -1;
        this.f = { alive: false, E: 0, col: 0, path: 0, atoms: 0, mat: 0, fate: '', rx: '', gen: 0 };
        this.trail = []; this.hist = []; this.histK = [];
        this.fx = [];
        this.tally = {
            fired: 0, born: 0, absorbed: 0, fissions: 0, leaked: 0, dropped: 0,
            byMat: new Float64Array(materials.list.length)
        };
    },

    // lc/ls name the nucleus a neutron has just left, which the next hit test
    // must skip: it is sitting at that nucleus's closest approach already.
    spawn(x, y, ux, uy, E, lc, ls) {
        if (this.n >= this.MAX) { this.tally.dropped++; return -1; }
        const i = this.n++;
        this.x[i] = x; this.y[i] = y; this.ux[i] = ux; this.uy[i] = uy; this.E[i] = E;
        this.id[i] = this.nextId++; this.nc[i] = 0;
        this.lc[i] = lc === undefined ? -1 : lc; this.ls[i] = ls || 0;
        return i;
    },

    fire(x, y, ang, E, follow) {
        const i = this.spawn(x, y, Math.cos(ang), Math.sin(ang), E);
        if (i < 0) return -1;
        this.tally.fired++;
        if (follow) this.setFollow(i);
        return i;
    },

    setFollow(i) {
        this.follow = this.id[i]; this.fIdx = i;
        this.f = { alive: true, E: this.E[i], col: this.nc[i], path: 0, atoms: 0, mat: 0, fate: '', rx: '', gen: 0 };
        this.trail = [this.x[i], this.y[i], this.E[i]];
        this.hist = [this.E[i]]; this.histK = [0];
    },

    kill(i) {
        const last = --this.n;
        if (this.fIdx === i) this.fIdx = -1;
        if (i !== last) {
            this.x[i] = this.x[last]; this.y[i] = this.y[last];
            this.ux[i] = this.ux[last]; this.uy[i] = this.uy[last];
            this.E[i] = this.E[last]; this.id[i] = this.id[last];
            this.nc[i] = this.nc[last]; this.lc[i] = this.lc[last]; this.ls[i] = this.ls[last];
            if (this.fIdx === last) this.fIdx = i;
        }
    },

    // Nearest neutron to a point, for click-to-follow.
    pick(wx, wy, radius) {
        let best = -1, bd = radius * radius;
        for (let i = 0; i < this.n; i++) {
            const dx = this.x[i] - wx, dy = this.y[i] - wy, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    },

    // On-screen speed, cells per second. Logarithmic in energy: a neutron
    // visibly slows at every collision that costs it a decade.
    speed(E) {
        const k = 1 + this.V_K * Math.log10(E / 0.0253);
        return this.V_TH * (k < 0.6 ? 0.6 : k);
    },

    step(dt) {
        // Downward, because a death moves the LAST neutron into the dead one's
        // slot — and the last one has already had its turn.
        for (let i = this.n - 1; i >= 0; i--) this.advance(i, dt);
        if (this.fx.length > 260) this.fx.splice(0, 80);
    },

    addFx(k, x, y, dx, dy, mag, ej) {
        this.fx.push({ k, x, y, dx, dy, mag, ej, life: 1, ang: Math.random() * 6.2831853 });
    },

    pickComp(sp, g, fission) {
        const arr = fission ? nuc.fis : nuc.cap;
        let tot = 0;
        for (const c of sp.mix) tot += c.f * arr[c.sp.idx][g];
        let u = rng.next() * tot;
        for (const c of sp.mix) { u -= c.f * arr[c.sp.idx][g]; if (u <= 0) return c.sp; }
        return sp.mix[sp.mix.length - 1].sp;
    },

    advance(i, tRem) {
        const W = grid.W, H = grid.H, type = grid.type, seed = grid.seed, ovr = grid.ovr;
        const mats = materials.list, TOT = nuc.tot, RCAP = this.RCAP;
        let x = this.x[i], y = this.y[i], ux = this.ux[i], uy = this.uy[i], E = this.E[i];
        const followed = i === this.fIdx, f = this.f;
        let guard = 0;

        while (tRem > 1e-9 && guard++ < 400) {
            const v = this.speed(E);
            let seg = v * tRem;
            if (seg > this.STEP) seg = this.STEP;
            const g = nuc.group(E);
            const cx = Math.floor(x), cy = Math.floor(y);
            const lc = this.lc[i], ls = this.ls[i];

            // The nearest closest-approach inside any disc, within this stride.
            // Two cells either way is enough: a disc reaches at most RCAP and
            // the stride is STEP, so nothing further off can be met yet.
            let bt = seg, hc = -1, hs = 0, hb = 0, hr = 0, hsp = 0, hx = 0, hy = 0;
            const y0 = cy < 2 ? 0 : cy - 2, y1 = cy + 2 >= H ? H - 1 : cy + 2;
            const x0 = cx < 2 ? 0 : cx - 2, x1 = cx + 2 >= W ? W - 1 : cx + 2;
            for (let yy = y0; yy <= y1; yy++) {
                const row = yy * W;
                for (let xx = x0; xx <= x1; xx++) {
                    const c = row + xx, m = type[c];
                    if (m === 0) continue;
                    const M = mats[m], ns = M.ns, sd = seed[c], off = M.off;
                    const vi = (M.crystal ? (((yy & 1) << 3) | (sd & 7)) : (sd & 15)) * ns * 2;
                    for (let s = 0; s < ns; s++) {
                        if (c === lc && s === ls) continue;
                        const o = ovr[c * 3 + s], spi = o ? o : M.slotSp[s];
                        let r = M.w[s] * TOT[spi][g];
                        if (r > RCAP) r = RCAP;
                        const dx = xx + 0.5 + off[vi + s * 2] - x;
                        const dy = yy + 0.5 + off[vi + s * 2 + 1] - y;
                        const t = dx * ux + dy * uy;
                        if (t <= 1e-7 || t > bt) continue;
                        const cr = ux * dy - uy * dx;
                        if (cr >= r || cr <= -r) continue;
                        bt = t; hc = c; hs = s; hb = cr; hr = r; hsp = spi;
                        hx = x + dx; hy = y + dy;
                    }
                }
            }

            const d = hc >= 0 ? bt : seg;
            if (followed) {
                const my = Math.floor(y + uy * d * 0.5), mx = Math.floor(x + ux * d * 0.5);
                if (mx >= 0 && my >= 0 && mx < W && my < H) {
                    const mc = type[my * W + mx];
                    if (mc) f.atoms += d * mats[mc].perCm;
                }
                f.path += d;
            }
            x += ux * d; y += uy * d;
            tRem -= d / v;

            if (hc < 0) {
                if (x < 0 || y < 0 || x >= W || y >= H) {
                    this.tally.leaked++;
                    if (followed) {
                        f.alive = false; f.E = E; f.fate = 'Left the bench'; f.rx = '';
                        this.trail.push(x, y, E);
                    }
                    this.kill(i);
                    return;
                }
                continue;
            }

            // ---- A collision, at the point of closest approach ----
            const M = mats[type[hc]], sp = nuc.sp[hsp];
            const tot = TOT[hsp][g];
            const u = Math.abs(hb) / hr;
            const fF = nuc.fis[hsp][g] / tot, fC = nuc.cap[hsp][g] / tot;
            const fN = nuc.n2n[hsp][g] / tot, fI = nuc.inel[hsp][g] / tot;
            this.nc[i]++;
            if (followed) { f.col++; f.mat = M.id; this.trail.push(x, y, E); }

            if (u < fF + fC) {
                const fission = u < fF;
                const comp = sp.mix ? this.pickComp(sp, g, fission) : sp;
                if (!fission) {
                    this.tally.absorbed++; this.tally.byMat[M.id]++;
                    this.addFx(1, hx, hy, 0, 0, 1, comp.ej || 'g');
                    if (this.burn && comp.spentIdx) ovr[hc * 3 + hs] = comp.spentIdx;
                    if (followed) {
                        f.alive = false; f.E = E; f.rx = comp.rx || '';
                        f.fate = 'Absorbed by ' + comp.name + ' in ' + M.name.toLowerCase();
                        this.trail.push(hx, hy, E);
                    }
                    this.kill(i);
                    return;
                }
                // Fission: the neutron is gone and two or three fast ones leave
                // the nucleus in its place.
                this.tally.fissions++; this.tally.byMat[M.id]++;
                const nuv = nuc.nuAt(comp, E);
                let k = Math.floor(nuv);
                if (rng.next() < nuv - k) k++;
                this.addFx(2, hx, hy, 0, 0, 1, 'f');
                if (this.burn) ovr[hc * 3 + hs] = nuc.idx.FP;
                this.kill(i);
                let first = -1;
                for (let q = 0; q < k; q++) {
                    const a = rng.next() * 6.2831853;
                    const j = this.spawn(hx, hy, Math.cos(a), Math.sin(a), nuc.sampleFission(this._r), hc, hs);
                    if (j >= 0) { this.tally.born++; if (first < 0) first = j; }
                }
                if (followed) {
                    f.gen++;
                    this.trail.push(hx, hy, E);
                    if (first >= 0) {
                        // Carry on with one of the daughters, so the staircase
                        // shows the whole cycle: down to thermal, fission, back up.
                        this.fIdx = first; this.follow = this.id[first];
                        f.E = this.E[first];
                        this.hist.push(f.E); this.histK.push(1);
                        f.rx = comp.name + ' fissioned, releasing ' + k;
                    } else {
                        f.alive = false; f.E = E; f.fate = 'Caused fission in ' + comp.name; f.rx = '';
                    }
                }
                return;
            }

            let E1, nx, ny;
            if (u < fF + fC + fN) {
                // (n,2n): what is left after the binding energy, shared.
                const Ea = Math.max(1e4, E - 1.67e6), sh = 0.15 + 0.7 * rng.next();
                E1 = Ea * sh;
                let a = rng.next() * 6.2831853;
                nx = Math.cos(a); ny = Math.sin(a);
                a = rng.next() * 6.2831853;
                if (this.spawn(x, y, Math.cos(a), Math.sin(a), Ea * (1 - sh), hc, hs) >= 0) this.tally.born++;
                if (followed) this.addFx(3, hx, hy, 0, 0, 1, 'g');
            } else if (u < fF + fC + fN + fI) {
                // Inelastic: the nucleus keeps a large share as excitation and
                // radiates it. This is how heavy metal slows a fast neutron at all.
                E1 = E * (0.15 + 0.45 * rng.next());
                const a = rng.next() * 6.2831853;
                nx = Math.cos(a); ny = Math.sin(a);
                if (followed) this.addFx(3, hx, hy, 0, 0, 1, 'g');
            } else {
                const base = fF + fC + fN + fI;
                const un = base < 1 ? (u - base) / (1 - base) : 1;
                const A = sp.A, cm = 2 * un - 1, den = A * A + 2 * A * cm + 1;
                E1 = E * den / ((A + 1) * (A + 1));
                if (E1 < nuc.E_CUT) {
                    // In equilibrium with the material: energy comes from its
                    // own distribution, and the direction is anyone's guess.
                    E1 = nuc.sampleThermal(this._r);
                    const a = rng.next() * 6.2831853;
                    nx = Math.cos(a); ny = Math.sin(a);
                } else {
                    let cl = den > 1e-12 ? (A * cm + 1) / Math.sqrt(den) : 0;
                    if (cl > 1) cl = 1; else if (cl < -1) cl = -1;
                    // Deflected AWAY from the nucleus: which side it passed on
                    // is the sign of the impact parameter.
                    const th = Math.acos(cl) * (hb > 0 ? -1 : 1);
                    const co = Math.cos(th), si = Math.sin(th);
                    nx = ux * co - uy * si; ny = ux * si + uy * co;
                }
                if (followed) {
                    // The struck nucleus recoils with whatever the neutron lost.
                    const a = Math.sqrt(E), b = Math.sqrt(E1);
                    let rx = ux * a - nx * b, ry = uy * a - ny * b;
                    const L = Math.hypot(rx, ry) || 1;
                    this.addFx(0, hx, hy, rx / L, ry / L, E1 < E ? 1 - E1 / E : 0, sp.A < 1.5 ? 'p' : 'r');
                }
            }
            // Swing the neutron round the nucleus by the angle it was turned
            // through, so it LEAVES on a line the same distance from the
            // nucleus as the one it came in on. This is not decoration. Turning
            // on the spot does not preserve the measure on lines, the neutron
            // then starts each flight from a place the lattice has already
            // shadowed, and free paths in a heavy crystal came out 20% short.
            {
                const co = ux * nx + uy * ny, si = ux * ny - uy * nx;
                const px = x - hx, py = y - hy;
                x = hx + px * co - py * si; y = hy + px * si + py * co;
            }
            E = E1; ux = nx; uy = ny;
            this.lc[i] = hc; this.ls[i] = hs;
            if (followed) {
                this.trail.push(x, y, E);
                f.E = E;
                this.hist.push(E); this.histK.push(0);
                if (this.hist.length > 1600) { this.hist.splice(0, 400); this.histK.splice(0, 400); }
                if (this.trail.length > 3600) this.trail.splice(0, 600);
            }
        }

        this.x[i] = x; this.y[i] = y; this.ux[i] = ux; this.uy[i] = uy; this.E[i] = E;
    }
};

neutrons.init();
