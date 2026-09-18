// ============ CRITICALITY — NEUTRON TRANSPORT ============
// Zero DOM. Owns `neutrons`.
//
// Every neutron is tracked individually in real three-dimensional space and
// real time: a position in centimetres, a direction, an energy in eV, and a
// statistical weight. Flights are sampled from the actual macroscopic cross
// section of the cells they cross. NOTHING HERE COMPUTES k. k is measured
// afterwards, as production over loss, the same way a subcritical
// multiplication measurement is made on a real bench — which is why it
// arrives with counting statistics and takes a moment to settle.
//
// Consequences of that choice, all of them load-bearing:
//   - Critical mass is not a number in this file. Change the shape of a heap,
//     compact it, wet it, put a plate beside it, and the measurement moves
//     because the transport moved.
//   - There is no reactivity coefficient anywhere. Heat expands the metal,
//     boils the water, melts the powder into a denser puddle; each of those
//     changes a density the tracker reads, and the burst quenches itself.
//   - Delayed neutrons come from the nuclide that actually fissioned, so a
//     plutonium system carries a third of uranium's delayed fraction without
//     anything being told to do that. Prompt criticality is three times
//     closer, which is the whole character of the thing.
//
// Tracking is a 2-D DDA across cells with a continuous z, not the delta
// tracking a code like this usually reaches for. Delta tracking needs a
// majorant, and one cell of boron carbide puts the thermal majorant at
// 200/cm — a neutron crossing air would take two hundred virtual collisions
// per centimetre. Marching cells costs one table lookup per centimetre
// instead, and the grid is uniform, so the march is a couple of adds.

// A stand-in for "nothing here", so the march can decide a point is outside
// the body without another branch in the inner loop.
const AIR_EL = { empty: true };

const neutrons = {
    MAX: 7000,
    TARGET: 3200,               // tracked particles aimed for; weight carries the rest
    MAX_CELLS: 600,             // cells one flight may cross before we call it gone
    MAX_PATH: 400,              // cm; longer than the bench diagonal
    SEG_MAX: 4000,

    px: null, py: null, pz: null, dx: null, dy: null, dz: null, pe: null, pw: null,
    pr: null,                   // model seconds this particle still owes the step
    pa: null,                   // seconds lived so far, for the lifetime tally
    pb: null,                   // 1 while inside the assembly, for net leakage
    VAC_MAX: 60,                // cm of empty space before a leaked neutron is dropped
    n: 0,

    // Delayed-neutron precursors. Six groups, U-235 decay constants; the
    // fractions each fission contributes are the fissioning nuclide's own.
    LAM: [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01],
    FRAC: [0.033, 0.219, 0.196, 0.395, 0.115, 0.042],
    BETA: { U235: 0.0065, U238: 0.0157, Pu239: 0.0021, Pu240: 0.0026 },
    C: [0, 0, 0, 0, 0, 0],

    // Recent fission sites, for putting delayed neutrons back where their
    // precursors were made. The ring is already distributed in proportion to
    // the fission rate, so a uniform draw from it is the right sample.
    siteRing: null, siteN: 0, siteHead: 0, SITE_MAX: 4096,

    seg: null, segN: 0,         // flight segments for the renderer
    flash: null, flashN: 0,     // fission points for the renderer

    // Physical neutrons per unit of particle weight. Tracked weights are kept
    // near 1 and this scalar carries the magnitude, so one bench can show ten
    // neutrons a second from a source and 10^17 fissions in a burst with the
    // same few thousand dots. Particle weights are a sampling choice; THIS is
    // the population.
    scale: 1,
    accProd: 0, accLoss: 0, accW2: 0,
    renormalize: false,         // power-iteration mode; see rebalance()

    rs: 12345,

    // tallies, per step and smoothed
    t: {
        prod: 0, abs: 0, leak: 0, fis: 0, pop: 0, life: 0, born: 0,
        k: 0, kVar: 0, ell: 1e-7, alpha: 0, beta: 0.0065, fisRate: 0, power: 0,
        thermalFrac: 0, dtLast: 1e-9, tally: 0, events: 0, ageSum: 0, ageW: 0,
        alphaPrompt: 0, loss2: 0
    },
    hist: { k: [], kn: 0 },
    modelTime: 0,
    totalFissions: 0,
    energyJ: 0,
    limited: false,

    // The dosimeter. Next-event estimation from every collision, so the number
    // it shows includes whatever the neutron would have had to cross to get
    // there — which is the only way the shielding lesson can be honest.
    probe: { x: 200, y: 120, neutron: 0, gamma: 0, decay: 0, dose: 0, cps: 0 },
    GAMMA_PER_FISSION: 2.2e-10,  // Sv cm^2 per fission, prompt + capture gammas
    MU_RHO: 0.062,               // cm^2/g, gamma attenuation around 1 MeV

    init() {
        const M = this.MAX;
        this.px = new Float32Array(M); this.py = new Float32Array(M); this.pz = new Float32Array(M);
        this.dx = new Float32Array(M); this.dy = new Float32Array(M); this.dz = new Float32Array(M);
        this.pe = new Float32Array(M); this.pw = new Float32Array(M);
        this.pr = new Float32Array(M);
        this.pa = new Float32Array(M);
        this.pb = new Uint8Array(M);
        this.seg = new Float32Array(this.SEG_MAX * 5);
        this.flash = new Float32Array(600 * 3);
        this.siteRing = new Int32Array(this.SITE_MAX);
        this.sel = new Int32Array(M);
        this.sel2 = new Uint8Array(M);
        this.tmp = [];
        for (let q = 0; q < 9; q++) this.tmp.push(new Float32Array(M));
        // Hoisted once. The samplers take a generator, and allocating a fresh
        // closure at every collision was showing up as real time.
        const self = this;
        this._r = function () { return self.rand(); };
        this.reset();
    },

    reset() {
        this.n = 0; this.segN = 0; this.flashN = 0;
        this.C = [0, 0, 0, 0, 0, 0];
        this.siteN = 0; this.siteHead = 0;
        this.modelTime = 0; this.totalFissions = 0; this.energyJ = 0;
        this.scale = 1;
        this.probe.dose = 0;
        this.t.k = 0; this.t.alpha = 0; this.t.alphaPrompt = 0; this.popPrev = 0;
        this.accProd = 0; this.accLoss = 0; this.accW2 = 0; this.t.pop = 0; this.t.fisRate = 0; this.t.power = 0;
        this.hist.k.length = 0; this.hist.kn = 0;
        this.srcList = null;
    },

    rand() {
        let s = this.rs;
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        this.rs = s | 0;
        return ((s >>> 0) % 16777216) / 16777216;
    },

    // Deflect particle i by polar cosine mu about its own direction. The
    // standard rotation, with the degenerate case near the z axis handled
    // separately because the t = sqrt(1-w^2) denominator vanishes there.
    deflect(i, mu) {
        const phi = 6.2831853 * this.rand();
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const sn = Math.sqrt(Math.max(0, 1 - mu * mu));
        const u = this.dx[i], v = this.dy[i], w = this.dz[i];
        const t = Math.sqrt(Math.max(0, 1 - w * w));
        if (t < 1e-6) {
            this.dx[i] = sn * cp; this.dy[i] = sn * sp;
            this.dz[i] = mu * (w < 0 ? -1 : 1);
            return;
        }
        this.dx[i] = mu * u + sn * (u * w * cp - v * sp) / t;
        this.dy[i] = mu * v + sn * (v * w * cp + u * sp) / t;
        this.dz[i] = mu * w - sn * t * cp;
    },

    isoDir(i) {
        // Uniform on the sphere. cos(theta) uniform in [-1,1] is the part that
        // is easy to get wrong, and getting it wrong biases leakage.
        const mu = 2 * this.rand() - 1, phi = 6.2831853 * this.rand();
        const st = Math.sqrt(Math.max(0, 1 - mu * mu));
        this.dx[i] = st * Math.cos(phi);
        this.dy[i] = st * Math.sin(phi);
        this.dz[i] = mu;
    },

    // `rem` is how much of the current step this neutron still has to live
    // through. A fission daughter inherits whatever was left of its parent's
    // step, so a whole chain resolves inside one step instead of advancing one
    // generation per step — which is what lets the same integrator show a
    // ten-nanosecond fast burst and an hour of fission-product decay.
    add(x, y, z, E, w, rem) {
        if (this.n >= this.MAX) return -1;
        const i = this.n++;
        this.px[i] = x; this.py[i] = y; this.pz[i] = z;
        this.pe[i] = E; this.pw[i] = w; this.pr[i] = rem || 0; this.pa[i] = 0; this.pb[i] = 1;
        this.isoDir(i);
        return i;
    },

    kill(i) {
        const j = --this.n;
        if (i !== j) {
            this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
            this.dx[i] = this.dx[j]; this.dy[i] = this.dy[j]; this.dz[i] = this.dz[j];
            this.pe[i] = this.pe[j]; this.pw[i] = this.pw[j]; this.pr[i] = this.pr[j];
            this.pa[i] = this.pa[j]; this.pb[i] = this.pb[j];
        }
    },

    // ---- material lookup ----

    sigmas(c, E, out) {
        const e = elements.list[grid.type[c]];
        if (e.empty) { out.t = 0; return out; }
        const d = grid.dens(c);
        if (d <= 0) { out.t = 0; return out; }
        const tb = e.tables[grid.bandOf[c]];
        const g = nuclear.group(E);
        out.t = nuclear.lerp(tb.St, g) * d;
        out.s = nuclear.lerp(tb.Ss, g) * d;
        out.f = nuclear.lerp(tb.Sf, g) * d;
        out.a = nuclear.lerp(tb.Sa, g) * d;
        out.g = g; out.gi = g | 0; out.tb = tb; out.e = e;
        return out;
    },
    _sg: { t: 0, s: 0, f: 0, a: 0, g: 0, gi: 0, tb: null, e: null },

    // ---- the step ----
    //
    // dtWanted is model seconds. The step returns what it actually managed,
    // because two things can bind: the population's own growth rate (a step
    // that let the population double several times over would outrun the
    // feedback that stops it) and a work budget. Neither changes the physics;
    // they stop the frame from trying to simulate a microsecond of prompt
    // supercriticality in one go.
    // Only a GROWING population needs the step held back. The clamp exists so
    // a prompt excursion cannot double itself many times over inside one step
    // and outrun the heating that stops it; a decaying one has no runaway to
    // outrun, and its chains finish inside whatever step they are given. That
    // asymmetry is what lets the same loop cover microseconds and days.
    EVENT_BUDGET: 90000,
    MAX_PASS: 80,
    MAX_EVENTS: 40,             // collisions one particle may take per pass

    suggestDt(dtWanted) {
        let dt = dtWanted;
        this.limited = false;
        const a = this.t.alphaPrompt;
        if (this.n > 0 && a > 1) {
            const lim = 0.25 / a;
            if (lim < dt) { dt = lim; this.limited = true; }
        }
        if (this.t.events > this.EVENT_BUDGET * 0.9 && this.t.dtLast > 0) {
            // Last step already overran its work budget, so do not ask for
            // more model time than it managed.
            const lim = this.t.dtLast * 0.9;
            if (lim < dt) { dt = lim; this.limited = true; }
        }
        return Math.max(1e-11, dt);
    },

    beginFrame() { this.segN = 0; this.flashN = 0; },

    step(dt) {
        const T = this.t;
        T.prod = 0; T.abs = 0; T.leak = 0; T.fis = 0; T.life = 0; T.events = 0;
        T.ageSum = 0; T.ageW = 0; T.loss2 = 0;
        T.dtLast = dt;

        let pop = 0, thermal = 0;
        for (let i = 0; i < this.n; i++) {
            this.pr[i] = dt;
            const w = this.pw[i];
            pop += w;
            if (this.pe[i] < 1) thermal += w;
        }
        T.pop = pop;
        T.thermalFrac = pop > 0 ? thermal / pop : 0;

        this.source(dt);
        this.emitDelayed(dt);

        // One pass per generation. New particles land at the end of the array
        // with time still owed, so the next pass picks them up; iterating
        // downward means a swap-removal can never skip or re-fly anybody.
        for (let pass = 0; pass < this.MAX_PASS; pass++) {
            let any = false;
            for (let i = this.n - 1; i >= 0; i--) {
                if (this.pr[i] <= 0) continue;
                any = true;
                if (!this.fly(i)) this.kill(i);
            }
            if (!any || T.events > this.EVENT_BUDGET) break;
        }

        this.rebalance();
        this.measure(dt);
        this.modelTime += dt;
        return this.n;
    },

    // ---- source ----
    // Spontaneous fission, always on. A plutonium assembly is emitting a third
    // of a million neutrons a second before anyone touches it, which is why
    // there is no "start" button for the chain reaction: the only question is
    // whether the arrangement multiplies what is already there.
    source(dt) {
        if (!this.srcList || this.srcVersion !== grid.mapVersion) this.buildSource();
        const S = this.srcTotal + this.extra;
        if (S <= 0) return;
        const expect = S * dt;
        if (expect <= 0) return;
        const count = Math.max(1, Math.min(160, Math.round(expect)));
        const w = expect / count / this.scale;      // physical -> particle weight
        for (let k = 0; k < count; k++) {
            const c = this.pickSourceCell();
            if (c < 0) continue;
            const x = (c % grid.W) + this.rand(), y = ((c / grid.W) | 0) + this.rand();
            const z = (this.rand() * 2 - 1) * grid.own[c];
            this.add(x, y, z, nuclear.sampleFission(this._r), w, this.rand() * dt);
        }
    },
    extra: 0,
    srcTotal: 0, srcVersion: -1, srcList: null, srcCum: null,

    buildSource() {
        this.srcVersion = grid.mapVersion;
        grid.updateDepth();
        const list = [], cum = [];
        let tot = 0;
        for (let c = 0; c < grid.n; c++) {
            const e = elements.list[grid.type[c]];
            if (!e.spontN) continue;
            const col = grid.mass[c] * 2 * Math.max(0.5, grid.own[c]);
            const r = e.spontN * col / Math.max(1e-9, e.massG);
            if (r <= 0) continue;
            tot += r; list.push(c); cum.push(tot);
        }
        this.srcList = list; this.srcCum = cum; this.srcTotal = tot;
    },

    pickSourceCell() {
        const L = this.srcList, C = this.srcCum;
        if (!L || !L.length) {
            // An external source with no fissile material in the world still
            // has to come from somewhere: use the probe's own neighbourhood.
            return grid.i(Math.min(grid.W - 1, this.probe.x | 0), Math.min(grid.H - 1, this.probe.y | 0));
        }
        const u = this.rand() * C[C.length - 1];
        let lo = 0, hi = C.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (C[m] < u) lo = m + 1; else hi = m; }
        return L[lo];
    },

    emitDelayed(dt) {
        let w = 0;
        for (let g = 0; g < 6; g++) {
            if (this.C[g] <= 0) continue;
            const out = this.C[g] * (1 - Math.exp(-this.LAM[g] * dt));
            this.C[g] -= out;
            w += out;
        }
        if (w <= 0 || this.siteN === 0) return;
        const count = Math.max(1, Math.min(120, Math.round(w / this.scale)));
        const each = w / count / this.scale;
        for (let k = 0; k < count; k++) {
            const c = this.siteRing[(this.rand() * this.siteN) | 0];
            const x = (c % grid.W) + this.rand(), y = ((c / grid.W) | 0) + this.rand();
            // Delayed neutrons are born soft, around 0.4 MeV.
            this.add(x, y, (this.rand() * 2 - 1) * grid.own[c],
                     nuclear.sampleFission(this._r) * 0.22, each, this.rand() * dt);
        }
    },

    // ---- one neutron, one step ----

    fly(i) {
        let x = this.px[i], y = this.py[i], z = this.pz[i];
        let ux = this.dx[i], uy = this.dy[i], uz = this.dz[i];
        let E = this.pe[i], w = this.pw[i];
        const T = this.t;
        let tRem = this.pr[i];
        const sg = this._sg;
        let events = 0;

        // Locals for the march. Hoisting these and computing the energy's
        // table index ONCE per flight rather than once per cell was the
        // difference between 30 ms a frame and 6: the energy cannot change
        // between collisions, so neither can the index.
        const gType = grid.type, gMass = grid.mass, gTemp = grid.temp,
              gBand = grid.bandOf, gDepth = grid.depth, gOwn = grid.own,
              els = elements.list, GW = grid.W, GH = grid.H;
        // One azimuth per flight for the outward sample. Per cell would be
        // more random than the geometry it stands for, and costs more.
        const azi = 6.2831853 * this.rand();
        const ax = Math.cos(azi), ay = Math.sin(azi);

        while (tRem > 0) {
            const v = nuclear.speed(E);
            let sMax = v * tRem;
            if (!(sMax > 0)) return true;
            // A flight longer than the bench is a flight through nothing. Left
            // uncapped, a neutron heading straight up the z axis with a step of
            // a second in front of it consumed the whole step in one go and
            // reported a lifetime of a second, which is 14 orders out and went
            // straight into the period on the panel.
            const capped = sMax > this.MAX_PATH;
            if (capped) sMax = this.MAX_PATH;
            const gE = nuclear.group(E);
            const gi = gE | 0, gf = gE - gi;

            // Sample an optical depth and march cells until it is used up.
            let tau = -Math.log(1 - this.rand() * 0.9999999);
            let s = 0;
            let cx = x | 0, cy = y | 0;
            let collided = false;
            const sx0 = x, sy0 = y;

            const stepX = ux > 0 ? 1 : -1, stepY = uy > 0 ? 1 : -1;
            const invX = ux !== 0 ? 1 / Math.abs(ux) : Infinity;
            const invY = uy !== 0 ? 1 / Math.abs(uy) : Infinity;
            let tx = ux !== 0 ? ((ux > 0 ? cx + 1 - x : x - cx) * invX) : Infinity;
            let ty = uy !== 0 ? ((uy > 0 ? cy + 1 - y : y - cy) * invY) : Infinity;

            let cells = 0;
            let inBody = this.pb[i] !== 0;
            let vac = 0;
            while (true) {
                if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) {
                    if (inBody) T.leak += w;
                    this.pushSeg(sx0, sy0, x + ux * s, y + uy * s, E);
                    this.endLife(i, w); return false;
                }
                const nextEdge = tx < ty ? tx : ty;
                let ds = (nextEdge < sMax ? nextEdge : sMax) - s;
                if (ds < 0) ds = 0;

                let c = cy * GW + cx;
                const zAbs = Math.abs(z + uz * (s + ds * 0.5));

                // LEAKAGE IS TALLIED AT THE SURFACE OF THE ASSEMBLY, as a net
                // current: out counts, and back in counts negative. Tallying it
                // where the neutron finally leaves the BENCH instead looks
                // equivalent and is not — the flight across a metre of empty
                // air takes seventy nanoseconds, which is several generations.
                // During a prompt excursion the loss term then lagged
                // production by that much and the panel read k = 2.6 on an
                // assembly whose k was 1.09, with a burst to match.
                const inside = gDepth[c] > 0 && zAbs <= gDepth[c];
                if (inside !== inBody) {
                    if (inBody) T.leak += w; else T.leak -= w;
                    inBody = inside;
                }
                if (inside) vac = 0; else vac += ds;

                let e = AIR_EL;
                if (inside) {
                    e = els[gType[c]];
                    // Past this cell's own material the medium is whatever sits
                    // that far out in the plane.
                    if (zAbs > gOwn[c]) {
                        const qx = (cx + 0.5 + ax * zAbs) | 0, qy = (cy + 0.5 + ay * zAbs) | 0;
                        if (qx < 0 || qy < 0 || qx >= GW || qy >= GH) e = AIR_EL;
                        else { c = qy * GW + qx; e = els[gType[c]]; }
                    }
                }
                if (!e.empty) {
                    let d = gMass[c] / e.massG;
                    if (e.expand) {
                        const dT = gTemp[c] - 293;
                        if (dT > 0) d /= (1 + 3 * e.expand * dT);
                    }
                    if (d > 0) {
                        const St = e.tables[gBand[c]].St;
                        const sig = (St[gi] + (St[gi + 1] - St[gi]) * gf) * d;
                        if (sig > 0) {
                            const dTau = sig * ds;
                            if (tau <= dTau) { s += tau / sig; collided = true; break; }
                            tau -= dTau;
                        }
                    }
                }
                s += ds;
                // Already counted as leaked; tracking it further only costs
                // time. The distance is generous enough that two piles set
                // apart on the bench still see each other.
                if (vac > this.VAC_MAX) { this.endLife(i, w); return false; }
                if (s >= sMax - 1e-9) break;
                if (++cells > this.MAX_CELLS) {
                    if (inBody) { T.leak += w; T.lkCells = (T.lkCells||0)+w; }
                    this.endLife(i, w); return false;
                }
                if (tx < ty) { cx += stepX; tx += invX; } else { cy += stepY; ty += invY; }
            }
            this.pb[i] = inBody ? 1 : 0;

            // Advance, and hand the renderer the flight it just made.
            const nx = x + ux * s, ny = y + uy * s, nz = z + uz * s;
            this.pushSeg(x, y, nx, ny, E);
            x = nx; y = ny; z = nz;
            const dtFlight = s / v;
            tRem -= dtFlight;
            // Time spent outside the assembly is not part of a neutron's
            // working life, and counting it stretched the generation time.
            if (this.pb[i]) { this.pa[i] += dtFlight; T.life += w * dtFlight; }

            if (Math.abs(z) > 220) {
                if (this.pb[i]) { T.leak += w; T.lkZ = (T.lkZ||0)+w; }
                this.endLife(i, w); return false;
            }

            if (!collided) {
                if (capped) {
                    if (this.pb[i]) { T.leak += w; T.lkCells = (T.lkCells||0)+w; }
                    this.endLife(i, w); return false;
                }
                break;
            }

            // ---- collision ----
            const cc = (y | 0) >= 0 && (y | 0) < grid.H && (x | 0) >= 0 && (x | 0) < grid.W
                ? (y | 0) * grid.W + (x | 0) : -1;
            if (cc < 0) { T.leak += w; this.endLife(i, w); return false; }
            this.sigmas(cc, E, sg);
            if (sg.t <= 0) continue;

            // Dose: next-event estimate from a tenth of all collisions, with
            // the weight scaled back up. Every collision would cost a second
            // ray march; a tenth of them is plenty for a meter that is
            // supposed to look like counting statistics anyway.
            // Only the SCATTERED fraction can be redirected at the dosimeter;
            // a neutron about to be absorbed goes nowhere.
            if (this.rand() < 0.1) this.probeScore(x, y, z, w * this.scale * 10 * (sg.s / sg.t), E);

            const u = this.rand() * sg.t;
            if (u < sg.f) {
                this.doFission(cc, x, y, z, w, E, sg, tRem);
                this.endLife(i, w);
                T.events += events + 1;
                return false;                    // the neutron itself is gone
            } else if (u < sg.f + sg.a) {
                T.abs += w;
                this.endLife(i, w);
                T.events += events + 1;
                return false;
            } else {
                // doScatter sets the new direction itself: for elastic
                // scattering the deflection is not free to choose, it is fixed
                // by how much energy was lost.
                this.dx[i] = ux; this.dy[i] = uy; this.dz[i] = uz;
                E = this.doScatter(cc, i, x, y, z, w, E, sg, tRem);
                if (E <= 0) { T.abs += w; this.endLife(i, w); T.events += events + 1; return false; }
                ux = this.dx[i]; uy = this.dy[i]; uz = this.dz[i];
            }
            if (++events > this.MAX_EVENTS) break;
        }

        this.px[i] = x; this.py[i] = y; this.pz[i] = z;
        this.pe[i] = E; this.pw[i] = w;
        this.pr[i] = tRem > 0 ? tRem : 0;
        T.events += events;
        return true;
    },

    isoDirInto(i) { this.isoDir(i); },

    // A neutron's whole life, recorded when it ends. Dividing the population
    // by the loss rate gives the same answer only while the step is short
    // compared with a lifetime; once a step covers several lifetimes it
    // saturates AT THE STEP SIZE, and a fast assembly with a 700 ns generation
    // time reported 153 microseconds — which then went straight into the
    // period and the dollar reading.
    endLife(i, w) {
        const T = this.t;
        T.ageSum += w * this.pa[i];
        T.ageW += w;
        T.loss2 += w * w;        // for the effective sample size
    },

    doFission(c, x, y, z, w, E, sg, rem) {
        const T = this.t;
        T.fis += w;
        T.abs += w;              // the neutron that caused it is gone: fission
                                 // is an absorption, and leaving it out of the
                                 // loss term reported k above k_inf, which is
                                 // impossible and was the tell.
        const real = w * this.scale;            // actual fissions, not weight
        this.totalFissions += real;

        // Which nuclide fissioned decides nu and, more importantly, the
        // delayed fraction.
        const tb = sg.tb, g = sg.g, nN = tb.nN;
        let pick = tb.nuc[0], best = 0;
        const target = this.rand() * nuclear.lerp(tb.Sf, g);
        let acc = 0;
        for (let q = 0; q < nN; q++) {
            const nuc = tb.nuc[q];
            const contrib = nuclear.sigF(nuc, E) * (sg.e.comp[q].N);
            acc += contrib;
            if (acc >= target) { pick = nuc; break; }
            if (contrib > best) { best = contrib; pick = nuc; }
        }
        const nu = nuclear.nu(pick, E);
        const beta = this.BETA[pick.key] || 0.0065;
        T.prod += w * nu;
        T.beta = T.beta * 0.995 + beta * 0.005;

        // Energy. 180 of the 200 MeV lands here and now; the rest comes out
        // of the fission products over the following hours.
        const J = real * nuclear.E_PROMPT * nuclear.MEV;
        this.energyJ += J;
        const cap = grid.heatCap(c);
        if (cap > 0) grid.temp[c] += J / cap;
        grid.fp[c] += real;

        this.siteRing[this.siteHead] = c;
        this.siteHead = (this.siteHead + 1) % this.SITE_MAX;
        if (this.siteN < this.SITE_MAX) this.siteN++;

        if (this.flashN < 600) {
            const f = this.flashN++ * 3;
            this.flash[f] = x; this.flash[f + 1] = y; this.flash[f + 2] = w;
        }

        // Prompt gammas reach the dosimeter whether or not a neutron does.
        this.probeGamma(x, y, real * nuclear.GAMMA_SHARE);

        // Delayed neutrons go to the precursor banks; prompt ones are born now.
        const del = real * nu * beta;           // precursors are kept physical
        for (let q = 0; q < 6; q++) this.C[q] += del * this.FRAC[q];

        const prompt = nu * (1 - beta);
        let cnt = Math.floor(prompt);
        if (this.rand() < prompt - cnt) cnt++;
        for (let q = 0; q < cnt; q++) {
            this.add(x, y, z, nuclear.sampleFission(this._r), w, rem);
        }
        return false;
    },

    doScatter(c, i, x, y, z, w, E, sg, rem) {
        const tb = sg.tb, nN = tb.nN;
        // Which nuclide it bounced off decides how much energy it loses:
        // everything about moderation is in this one choice. The index must be
        // the INTEGER group: a fractional one indexes a typed array as
        // undefined, the comparison against NaN is always false, and the
        // nuclide silently comes out as whichever is listed first. In a
        // solution that is uranium, so every collision was off a 235-nucleon
        // target, nothing ever thermalised, and a 45-litre tank that should
        // have been close to critical measured k = 0.1.
        const base = sg.gi * nN;
        const target = this.rand() * tb.cum[base + nN - 1];
        let q = 0;
        while (q < nN - 1 && tb.cum[base + q] < target) q++;
        const nuc = tb.nuc[q];

        const ss = nuclear.sigS(nuc, E), si = nuclear.sigIn(nuc, E), sn = nuclear.sigN2n(nuc, E);
        const tot = ss + si + sn;
        const roll = this.rand() * tot;
        let E2;
        if (roll < sn) {
            // (n,2n) on beryllium: the reflector does not merely scatter
            // neutrons back, it makes extra ones.
            E2 = E * 0.28;
            this.t.prod += w;
            this.add(x, y, z, E * 0.28, w, rem);
            this.isoDir(i);
        } else if (roll < sn + si) {
            E2 = E * nuc.inel.frac;
            this.isoDir(i);
        } else {
            // Elastic. Sampling the energy uniformly in [alpha E, E] IS
            // isotropic scattering in the centre of mass, and the lab
            // deflection that goes with it is then fixed, not free. Choosing a
            // fresh isotropic lab direction instead — which is what this did
            // first — throws away the forward bias of a light target: with
            // mu-bar = 2/3 for hydrogen, water turned neutrons around far too
            // easily and every moderating reflector came out roughly twice as
            // effective as it should be.
            const A = nuc.A;
            const ratio = nuc.alpha + (1 - nuc.alpha) * this.rand();
            E2 = E * ratio;
            const cm = ((A + 1) * (A + 1) * ratio - A * A - 1) / (2 * A);
            const c2 = cm < -1 ? -1 : cm > 1 ? 1 : cm;
            const den = Math.sqrt(A * A + 2 * A * c2 + 1);
            let mu = (1 + A * c2) / den;
            const fwd = nuclear.forwardBias(nuc, E);
            if (fwd > 0) mu += (1 - mu) * fwd;
            this.deflect(i, mu);
        }

        const kT = nuclear.KB_EV * grid.temp[c];
        if (E2 < kT * 1.5) E2 = nuclear.thermalE(grid.temp[c], this._r);
        return Math.max(nuclear.E_MIN, E2);
    },

    pushSeg(x0, y0, x1, y1, E) {
        if (this.segN >= this.SEG_MAX) return;
        const s = this.segN++ * 5;
        this.seg[s] = x0; this.seg[s + 1] = y0; this.seg[s + 2] = x1; this.seg[s + 3] = y1;
        this.seg[s + 4] = E;
    },

    // ---- population control ----
    // The number of tracks on screen is a sampling choice; the population is
    // the total weight. Roulette and splitting both preserve that weight in
    // expectation, which is what lets one bench show a source of ten neutrons
    // a second and a burst of 10^17 fissions with the same few thousand dots.
    rebalance() {
        const n = this.n;
        if (!n) { this.scale = 1; return; }
        let W = 0;
        for (let i = 0; i < n; i++) W += this.pw[i];
        if (!(W > 0)) { this.n = 0; this.scale = 1; return; }

        // A POWER ITERATION renormalises the bank every cycle — that is what
        // makes it an eigenvalue calculation rather than a simulation, and it
        // is how the offline harness measures k. The live bench must not: its
        // population is a physical quantity that is allowed to die away.
        if (this.renormalize) { this.comb(this.TARGET, W); return; }

        // Too many to track: comb down, which normalises the weights and hands
        // the magnitude to `scale`. This is the supercritical case.
        if (n > this.TARGET) { this.comb(this.TARGET, W); return; }

        // Too few to look at or to average: split, which is weight preserving
        // and NEVER touches `scale`.
        //
        // Combing upward instead looks like the same operation and is not. It
        // normalises weights to 1, so `scale` takes the ratio — and in a
        // decaying population that ratio is below one every single step. scale
        // marches toward zero, the source weight (which is divided by it to
        // convert physical neutrons into particle weight) explodes to
        // compensate, and one source particle ends up carrying a million times
        // its neighbours. A graphite pile with a perfectly ordinary k reported
        // 0.001, with absorption tallies in the billions.
        if (n < this.TARGET * 0.5 && this.t.events < this.EVENT_BUDGET * 0.5) {
            const lim = n;
            for (let i = 0; i < lim && this.n < this.TARGET; i++) {
                const h = this.pw[i] * 0.5;
                if (h <= 0) continue;
                this.pw[i] = h;
                const j = this.add(this.px[i], this.py[i], this.pz[i], this.pe[i], h, this.pr[i]);
                if (j < 0) break;
                this.dx[j] = this.dx[i]; this.dy[j] = this.dy[i]; this.dz[j] = this.dz[i];
                this.pa[j] = this.pa[i]; this.pb[j] = this.pb[i];
            }
        }
    },

    // Systematic resampling: walk the cumulative weight and take Nt equally
    // spaced draws. Heavy particles are split, light ones are dropped, and
    // every survivor comes out at weight exactly 1 with the magnitude handed
    // to `scale`.
    //
    // The first version rouletted and boosted weights instead, which is
    // unbiased but lets a handful of particles end up carrying weight 2.6^N
    // after N supercritical generations. The measured k then wandered so badly
    // it came out NON-MONOTONIC in radius — a bigger sphere reading less
    // reactive than a smaller one. Uniform weights are not a nicety here.
    comb(Nt, W) {
        const n = this.n, T = this.tmp, sel = this.sel, sel2 = this.sel2;
        const stepW = W / Nt;
        let pick = this.rand() * stepW, acc = 0, j = 0;
        for (let i = 0; i < n && j < Nt; i++) {
            acc += this.pw[i];
            while (pick < acc && j < Nt) { sel[j++] = i; pick += stepW; }
        }
        while (j < Nt) sel[j++] = n - 1;
        for (let q = 0; q < Nt; q++) {
            const i = sel[q];
            T[0][q] = this.px[i]; T[1][q] = this.py[i]; T[2][q] = this.pz[i];
            T[3][q] = this.dx[i]; T[4][q] = this.dy[i]; T[5][q] = this.dz[i];
            T[6][q] = this.pe[i]; T[7][q] = this.pr[i]; T[8][q] = this.pa[i];
            sel2[q] = this.pb[i];
        }
        for (let q = 0; q < Nt; q++) {
            this.px[q] = T[0][q]; this.py[q] = T[1][q]; this.pz[q] = T[2][q];
            this.dx[q] = T[3][q]; this.dy[q] = T[4][q]; this.dz[q] = T[5][q];
            this.pe[q] = T[6][q]; this.pr[q] = T[7][q]; this.pa[q] = T[8][q];
            this.pb[q] = sel2[q]; this.pw[q] = 1;
        }
        this.n = Nt;
        this.scale *= stepW;
    },

    // ---- measurement ----
    measure(dt) {
        const T = this.t;
        const loss = T.abs + T.leak;

        // THE RATIO OF THE SUMS, NOT THE MEAN OF THE RATIOS. Averaging the
        // per-step ratio is badly biased low whenever the counts are small:
        // most steps of a source-driven pile contain one neutron that leaks
        // and contributes a ratio of zero, and the occasional fission
        // contributes 2.5, and an exponential mean of those lands nowhere near
        // production over loss. A bare uranium sphere whose k is 0.84 read
        // 0.23 that way, while the offline harness — which accumulates both
        // sums and divides once — had it right all along.
        const decay = 0.99;
        this.accProd = this.accProd * decay + T.prod;
        this.accLoss = this.accLoss * decay + loss;
        this.accW2 = this.accW2 * decay + T.loss2;
        if (this.accLoss > 0) T.k = this.accProd / this.accLoss;

        // Counting statistics, reported rather than hidden. With weighted
        // particles the honest sample size is the effective one.
        const nEff = this.accW2 > 0 ? (this.accLoss * this.accLoss) / this.accW2 : 0;
        T.kVar = nEff > 1 ? (T.k * T.k) / nEff : 1;

        // Mean prompt lifetime: the population divided by the rate it is
        // being removed at. Measured, so it spans five orders of magnitude
        // between a metal assembly and a solution without being told to.
        if (T.ageW > 0) {
            const ell = T.ageSum / T.ageW;
            if (isFinite(ell) && ell > 0) T.ell = T.ell + (Math.min(1, ell) - T.ell) * 0.08;
        }

        // Two different growth rates, and using one for the other's job is
        // wrong by six orders of magnitude.
        //
        // alphaPrompt is (k-1)/l, the PROMPT rate. It is what bounds the
        // timestep and what decides a burst is happening, and above prompt
        // critical it is also the real one.
        //
        // alpha is the rate the population is ACTUALLY growing at, measured
        // off its own log derivative. Below prompt critical the two disagree
        // completely: at k = 1.0016 the prompt formula says the power doubles
        // in a microsecond, when in fact the rise is paced by precursors
        // decaying seconds after the fission that made them, and the reactor
        // period is tens of seconds. That gap IS delayed-neutron control, and
        // a panel that prints the prompt number for it is printing a reactor
        // no one could ever operate.
        //
        // Smooth the RATE and invert afterwards, never the period: a period
        // runs off to infinity as the rate crosses zero, and any average
        // across that sweeps through the small numbers that mean "running
        // away" on an assembly sitting perfectly still.
        T.alphaPrompt = (T.k - 1) / Math.max(T.ell, 1e-10);
        const popNow = T.pop * this.scale;
        if (this.popPrev > 0 && popNow > 0 && dt > 0) {
            const inst = Math.log(popNow / this.popPrev) / dt;
            if (isFinite(inst)) T.alpha = T.alpha + (inst - T.alpha) * 0.04;
        }
        this.popPrev = popNow;

        T.fisRate = dt > 0 ? T.fis * this.scale / dt : 0;
        T.popReal = T.pop * this.scale;
        T.power = T.fisRate * nuclear.E_FISSION * nuclear.MEV;
        T.tally = loss;

        this.hist.k.push(T.k);
        if (this.hist.k.length > 600) this.hist.k.shift();
    },

    // ---- dosimeter ----

    probeScore(x, y, z, w, E) {
        const p = this.probe;
        const dx = p.x - x, dy = p.y - y, dz = -z;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 16) return;
        const r = Math.sqrt(r2);
        const tau = this.rayTau(x, y, p.x, p.y, E, false);
        if (tau > 24) return;
        p.neutron += w * Math.exp(-tau) / (12.566 * r2) * nuclear.SV_PER_NCM2;
    },

    probeGamma(x, y, w) {
        const p = this.probe;
        const dx = p.x - x, dy = p.y - y;
        const r2 = dx * dx + dy * dy;
        if (r2 < 16) return;
        const tau = this.rayTau(x, y, p.x, p.y, 0, true);
        if (tau > 24) return;
        p.gamma += w * Math.exp(-tau) / (12.566 * r2) * this.GAMMA_PER_FISSION * 12.566;
    },

    // Optical depth along a straight line, marched cell by cell. For gammas
    // that is mass attenuation, so lead is opaque and water is not; for
    // neutrons it is the real total cross section, so water is opaque and lead
    // is not. Getting those two backwards is the classic shielding mistake and
    // the bench will show it.
    rayTau(x0, y0, x1, y1, E, gamma) {
        let dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return 0;
        dx /= len; dy /= len;
        const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
        const invX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
        const invY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
        let cx = x0 | 0, cy = y0 | 0;
        let tx = dx !== 0 ? ((dx > 0 ? cx + 1 - x0 : x0 - cx) * invX) : Infinity;
        let ty = dy !== 0 ? ((dy > 0 ? cy + 1 - y0 : y0 - cy) * invY) : Infinity;
        let s = 0, tau = 0, guard = 0;
        const sg = this._sgRay;
        while (s < len && guard++ < 400) {
            const edge = Math.min(Math.min(tx, ty), len);
            const ds = edge - s;
            if (cx >= 0 && cy >= 0 && cx < grid.W && cy < grid.H && ds > 0) {
                const c = cy * grid.W + cx;
                const e = elements.list[grid.type[c]];
                if (!e.empty) {
                    if (gamma) tau += (e.muRho || this.MU_RHO) * e.bulk * grid.dens(c) * ds;
                    else { this.sigmas(c, E, sg); tau += sg.t * ds; }
                }
            }
            s = edge;
            if (tx < ty) { cx += stepX; tx += invX; } else { cy += stepY; ty += invY; }
            if (tau > 26) return tau;
        }
        return tau;
    },
    _sgRay: { t: 0, s: 0, f: 0, a: 0, g: 0, gi: 0, tb: null, e: null },

    // The steady field from everything that is simply radioactive: the
    // sample's own activity and whatever fission products it is carrying.
    // Summed over a random subsample of emitting cells each frame and scaled
    // back up, which converges over a second and makes the meter flicker the
    // way a real one does.
    decayField(age) {
        const emit = [];
        for (let c = 0; c < grid.n; c++) {
            const e = elements.list[grid.type[c]];
            if (e.empty) continue;
            if (e.gammaField > 0 || grid.fp[c] > 0) emit.push(c);
        }
        if (!emit.length) { this.probe.decay = 0; return; }
        const take = Math.min(emit.length, 150);
        let sum = 0;
        for (let k = 0; k < take; k++) {
            const c = emit[(this.rand() * emit.length) | 0];
            const x = (c % grid.W) + 0.5, y = ((c / grid.W) | 0) + 0.5;
            const dx = this.probe.x - x, dy = this.probe.y - y;
            const r2 = Math.max(16, dx * dx + dy * dy);
            const e = elements.list[grid.type[c]];
            const col = grid.mass[c] * 2 * Math.max(0.5, grid.own[c]);
            // uSv/h at 1 m -> uSv/h here, r in cm
            let uSvh = e.gammaField * (col / Math.max(1e-9, e.massG)) * (1e4 / r2);
            if (grid.fp[c] > 0) {
                // Fission products: t^-1.2, with about a third of the decay
                // energy coming out as penetrating gamma.
                const bq = grid.fp[c] * 1.2 * Math.pow(Math.max(1, age), -1.2);
                uSvh += bq * 1e-9 * 40 * (1e4 / r2);
            }
            const tau = this.rayTau(x, y, this.probe.x, this.probe.y, 0, true);
            sum += uSvh * Math.exp(-tau);
        }
        const est = sum * emit.length / take / 1e6;          // uSv/h -> Sv/h
        this.probe.decay = this.probe.decay * 0.7 + est * 0.3;
    },

    // Called once per frame by main: turn the step's scored fluence into rates.
    finishFrame(modelDt, wallDt, age) {
        const p = this.probe;
        if (modelDt > 0) {
            p.rateN = p.neutron / modelDt * 3600;            // Sv/h
            p.rateG = p.gamma / modelDt * 3600;
        } else { p.rateN = 0; p.rateG = 0; }
        p.neutron = 0; p.gamma = 0;
        this.decayField(age);
        p.rate = (p.rateN || 0) + (p.rateG || 0) + p.decay;
        p.dose += p.rate * (modelDt / 3600);
        // A GM tube reads roughly ten counts a second per uSv/h, and it
        // stretches its pulses at high rate, which is why a real one goes
        // quiet exactly when it matters most.
        const uSvh = p.rate * 1e6;
        const raw = uSvh * 12;
        p.cps = raw / (1 + raw * 3e-5);
    }
};

neutrons.init();
