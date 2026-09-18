// ============ CRITICALITY — THE AUTOMATON ============
// Falling sand: powders fall and heap, liquids fall and spread, gases rise,
// solids hold still. On top of that, heat, phase change and dissolution.
// Zero DOM. Owns `grid`.
//
// FIVE ARRAYS TRAVEL WITH THE PARTICLE (type, mass, tint, temp, fp) AND TWO
// BELONG TO THE LOCATION (own, depth). Keeping that split straight is what
// makes a hot molten blob carry its heat downhill while the inferred
// thickness of the pile stays a property of where you are standing.
//
// THE THIRD DIMENSION IS INFERRED, NOT DRAWN. A 2-D pile cannot go critical
// at anything like the right mass, because the leakage through the screen is
// missing. So the grid carries two inferred half-thicknesses in z, and the
// distinction between them is the most load-bearing thing in this file:
//
//   own[c]   how thick this cell's OWN material is in z. Its mass and heat
//            capacity come from this, and so does how far its material
//            reaches along z.
//   depth[c] how thick the whole body is in z. Past it, the neutron is out.
//
// Both are the SPHERICAL CHORD of the region they belong to:
//
//     h = sqrt( d * (2R - d) )
//
// where d is the distance from the cell to the edge of its region and R is
// that region's largest such distance. This is exact, not fitted: a disc of
// radius R comes out as a sphere of radius R, because the integral of the
// chord over the disc is precisely 4/3 pi R^3. A long ridge of half-width w
// comes out as a half-cylinder of radius w. Nothing needs calibrating, and
// there is no free constant anywhere in the geometry.
//
// The first attempt used h = 2 x d, which also integrates to a sphere's
// volume but describes a double cone: too fat at the centre and far too thin
// near the rim. Metal assemblies survived it, because a mean free path of
// 2 cm barely notices the rim. A 45-litre solution did not — 82% of its
// neutrons leaked out through the collapsing roof and a tank that should have
// been near critical measured k = 0.08.
//
// Between own and depth the medium is taken from WHAT IS NEARBY IN THE PLANE:
// at height z the material is sampled at in-plane distance z. That one line
// is what makes a reflector work. With a single thickness field, a 9 cm
// beryllium shell around a 2 cm plutonium core made the CORE read as 44 cm
// thick in z, and the mass readout said 12.8 kg for a 1.2 kg ball. Sampling
// outward instead puts the beryllium above and below the core where it
// belongs, and in a lattice of wet fuel it puts water between the lumps in z
// as well as in the plane.
//
// The payoff is that a thin horizontal smear of a critical mass leaks in z
// and cannot go critical, which is the geometry rule of criticality safety,
// for free.

const grid = {
    W: 240, H: 150,          // cells, and one cell is 1 cm: a 2.4 x 1.5 m bench

    type: null, mass: null, tint: null, temp: null, fp: null,
    depth: null, dist: null, own: null,
    lab: null, rmax: null,   // region labels and each region's peak distance
    occ: null, blur: null,   // occupancy and its blur, for the body envelope
    BRIDGE: 5,               // cells; voids narrower than this stay inside the body
    bandOf: null,            // cross-section temperature band, cached per cell

    n: 0,
    mapVersion: 0,           // bumped whenever a cell's type changes
    depthVersion: -1,
    flip: false,
    amb: 293,

    rs: 0,                   // deterministic stream for the automaton

    init() {
        this.n = this.W * this.H;
        this.type = new Uint8Array(this.n);
        this.mass = new Float32Array(this.n);
        this.tint = new Uint8Array(this.n);
        this.temp = new Float32Array(this.n);
        this.fp = new Float32Array(this.n);      // fissions accumulated, for decay heat
        this.depth = new Float32Array(this.n);
        this.dist = new Float32Array(this.n);
        this.own = new Float32Array(this.n);
        this.lab = new Int32Array(this.n);
        this.rmax = new Float32Array(this.n);
        this.occ = new Float32Array(this.n);
        this.blur = new Float32Array(this.n);
        this.bandOf = new Uint8Array(this.n);
        this.clear();
    },

    rand() {
        let s = this.rs;
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        this.rs = s | 0;
        return ((s >>> 0) % 1e6) / 1e6;
    },

    clear(seed) {
        this.rs = (seed || 0x9e3779b9) | 0;
        this.type.fill(elements.AIR);
        this.mass.fill(0);
        this.tint.fill(0);
        this.temp.fill(this.amb);
        this.fp.fill(0);
        // A floor to stack things on. It is steel, so it reflects a little —
        // which is honest: a bench is not a vacuum, and a pile on a steel
        // table is slightly closer to critical than one in mid-air.
        const steel = elements.byKey.STEEL.id;
        for (let x = 0; x < this.W; x++) {
            for (let y = this.H - 3; y < this.H; y++) this.set(x, y, steel);
        }
        this.mapVersion++;
        this.depthVersion = -1;
    },

    i(x, y) { return y * this.W + x; },
    inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; },
    el(c) { return elements.list[this.type[c]]; },

    set(x, y, id, massOverride) {
        // Floored deliberately. A fractional index into a typed array is not
        // an error, it is a silent no-op, and a caller looping from a
        // non-integer bound wrote a whole beryllium reflector into nowhere.
        x = Math.floor(x); y = Math.floor(y);
        if (!this.inside(x, y)) return;
        const c = y * this.W + x;
        const e = elements.list[id];
        this.type[c] = id;
        this.mass[c] = massOverride === undefined ? e.massG : massOverride;
        this.tint[c] = (this.rand() * 255) | 0;
        if (e.empty) { this.mass[c] = 0; this.fp[c] = 0; }
        if (e.fpPerGram) this.fp[c] = e.fpPerGram * e.massG;
        this.mapVersion++;
    },

    setCell(c, id, keepTemp) {
        const e = elements.list[id];
        this.type[c] = id;
        this.mass[c] = e.massG;
        if (e.empty) this.mass[c] = 0;
        if (!keepTemp) this.temp[c] = this.amb;
        this.mapVersion++;
    },

    // Actual atom density relative to the element's nominal, which is the one
    // scalar the cross-section tables get multiplied by. Mass is what is
    // conserved; density is derived from it. A cell cannot swell on a fixed
    // grid, so thermal expansion shows up here as a real thinning rather than
    // as a bigger picture — under 1% of radius at 500 K, invisible on screen,
    // and enough to shut a prompt burst down.
    dens(c) {
        const e = elements.list[this.type[c]];
        if (e.empty) return 0;
        let f = this.mass[c] / e.massG;
        if (e.expand) {
            const dT = this.temp[c] - 293;
            if (dT > 0) f /= (1 + 3 * e.expand * dT);
        }
        return f;
    },

    // ---- the sand update ----

    step() {
        const W = this.W, H = this.H;
        this.flip = !this.flip;
        for (let y = H - 1; y >= 0; y--) {
            if (this.flip) {
                for (let x = 0; x < W; x++) this.moveCell(x, y);
            } else {
                for (let x = W - 1; x >= 0; x--) this.moveCell(x, y);
            }
        }
    },

    moveCell(x, y) {
        const c = y * this.W + x;
        const e = elements.list[this.type[c]];
        if (e.empty || e.phaseSolid) return;

        if (e.phaseGas) {
            // Rises, wanders, and thins out. Steam that finds cool air
            // condenses; fuel vapour simply disperses, which is the assembly
            // taking itself apart.
            if (this.rand() < 0.25) return;
            const dx = this.rand() < 0.5 ? -1 : 1;
            if (!this.tryMove(c, x, y - 1) && !this.tryMove(c, x + dx, y - 1)) this.tryMove(c, x + dx, y);
            return;
        }

        const below = y + 1;
        if (this.tryMove(c, x, below)) return;

        const dir = this.rand() < 0.5 ? -1 : 1;
        // Angle of repose. A powder that always took the diagonal would run
        // out flat like a liquid; refusing it most of the time is what builds
        // a heap with a slope, and the slope is what makes a heap of dust a
        // worse shape than a sphere.
        if (e.phasePowder) {
            if (this.rand() < 0.45) {
                if (this.tryMove(c, x + dir, below)) return;
                this.tryMove(c, x - dir, below);
            }
            return;
        }

        if (e.phaseLiquid) {
            if (this.tryMove(c, x + dir, below)) return;
            if (this.tryMove(c, x - dir, below)) return;
            // Molten fuel coalesces before it spreads: a half-empty cell pulls
            // mass from its neighbours until it is full. That is what turns a
            // loose heap of powder into a dense puddle when it melts — and a
            // denser puddle is closer to critical than the powder was.
            if (this.mass[c] < elements.list[this.type[c]].massG * 0.98 && this.pull(c, x, y)) return;
            if (this.tryMove(c, x + dir, y)) return;
            this.tryMove(c, x - dir, y);
        }
    },

    // Density ladder: anything condensed sinks through gas, and a heavier
    // powder or liquid sinks through a lighter liquid. Same-phase equals never
    // swap, or piles would churn forever.
    tryMove(c, nx, ny) {
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) return false;
        const d = ny * this.W + nx;
        const a = elements.list[this.type[c]], b = elements.list[this.type[d]];
        if (b.phaseSolid) return false;
        let ok = false;
        if (b.empty || b.phaseGas) ok = !a.phaseGas;
        else if (a.phaseGas) ok = false;
        else if (b.phaseLiquid && !a.phaseGas) ok = a.bulk > b.bulk * 1.15;
        if (!ok) return false;
        this.swap(c, d);
        return true;
    },

    swap(c, d) {
        let t = this.type[c]; this.type[c] = this.type[d]; this.type[d] = t;
        let m = this.mass[c]; this.mass[c] = this.mass[d]; this.mass[d] = m;
        let i = this.tint[c]; this.tint[c] = this.tint[d]; this.tint[d] = i;
        let p = this.temp[c]; this.temp[c] = this.temp[d]; this.temp[d] = p;
        let f = this.fp[c]; this.fp[c] = this.fp[d]; this.fp[d] = f;
        this.mapVersion++;
    },

    pull(c, x, y) {
        const id = this.type[c], cap = elements.list[id].massG;
        for (let k = 0; k < 4; k++) {
            const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0), ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
            if (!this.inside(nx, ny)) continue;
            const d = ny * this.W + nx;
            if (this.type[d] !== id) continue;
            const take = Math.min(this.mass[d], cap - this.mass[c]);
            if (take <= 0) continue;
            this.mass[c] += take;
            this.mass[d] -= take;
            if (this.mass[d] < 0.02) this.setCell(d, elements.AIR, true);
            return true;
        }
        return false;
    },

    // ---- heat, phase change, chemistry ----
    //
    // One pass, because all three need the same walk and the same neighbour
    // lookups. dt is model seconds.
    thermal(dt) {
        const W = this.W, H = this.H, T = this.temp;
        const SB = 5.67e-12;            // Stefan-Boltzmann, W/(cm^2 K^4)
        // Explicit diffusion is only stable to a quarter of a cell per step,
        // and time compression can hand us a dt of hours. Clamping here means
        // conduction saturates at one cell per tick at high speed rather than
        // exploding — the trade is deliberate and is why the pile stays hot
        // longer than it should when you fast-forward.
        for (let y = H - 1; y >= 0; y--) {
            for (let x = 0; x < W; x++) {
                const c = y * W + x;
                const e = elements.list[this.type[c]];
                if (e.empty) { T[c] += (this.amb - T[c]) * 0.02; continue; }

                const cap = this.heatCap(c);
                if (cap <= 0) continue;

                // conduction
                const k = Math.min(0.22, (e.cond || (e.phaseSolid ? 0.30 : e.phaseLiquid ? 0.12 : 0.04)) * dt * 40);
                let sum = 0, cnt = 0, exposed = 0;
                for (let s = 0; s < 4; s++) {
                    const nx = x + (s === 0 ? -1 : s === 1 ? 1 : 0), ny = y + (s === 2 ? -1 : s === 3 ? 1 : 0);
                    if (!this.inside(nx, ny)) continue;
                    const d = ny * W + nx;
                    const ne = elements.list[this.type[d]];
                    if (ne.empty || ne.phaseGas) { exposed++; continue; }
                    sum += T[d]; cnt++;
                }
                if (cnt) T[c] += k * (sum / cnt - T[c]);

                // decay heat: the element's own activity plus whatever fission
                // products this cell has accumulated. This is the part that
                // does not switch off when the neutrons stop.
                let W_ = e.decayW * (this.mass[c] / Math.max(1e-9, e.massG));
                if (this.fp[c] > 0) W_ += this.fpPower(c);
                if (W_ > 0) T[c] += W_ * dt / cap;

                // losses to open air, radiative and convective
                if (exposed) {
                    const f = exposed / 4;
                    const rad = SB * (T[c] * T[c] * T[c] * T[c] - this.amb * this.amb * this.amb * this.amb);
                    const conv = 0.0012 * (T[c] - this.amb);
                    T[c] -= Math.min(T[c] - this.amb, (rad + conv) * f * dt / cap);
                }
                if (T[c] < this.amb) T[c] = this.amb;
                this.bandOf[c] = elements.band(T[c]);

                this.phase(c, e);
            }
        }
    },

    // Heat capacity of what this cell actually stands for: the mass in the
    // column it represents, not the gram in the square.
    heatCap(c) {
        const e = elements.list[this.type[c]];
        return this.mass[c] * 2 * Math.max(0.5, this.own[c]) * (e.heat || 1);
    },

    phase(c, e) {
        const T = this.temp[c];
        if (e.boil && T > e.boil) {
            const to = elements.byKey[e.boilTo];
            // Boiling a solution does not boil the fuel off with it: the water
            // flashes to steam and leaves the powder behind. That is exactly
            // how a solution excursion shuts itself down.
            this.setCell(c, to.id, true);
            if (to.phase === 'powder' || to.phase === 'solid') {
                this.mass[c] = Math.min(to.massG, this.mass[c] * 0.26);
                this.temp[c] = Math.min(T, e.boil);
            }
            return;
        }
        if (e.melt && T > e.melt && e.meltTo) {
            const to = elements.byKey[e.meltTo];
            const m = this.mass[c];
            this.setCell(c, to.id, true);
            this.mass[c] = m;               // melting conserves mass, not volume
            return;
        }
        if (e.freeze && T < e.freeze.below) {
            const m = this.mass[c];
            this.setCell(c, elements.byKey[e.freeze.to].id, true);
            this.mass[c] = m;
            return;
        }
        if (e.condense && T < e.condense.below) {
            this.setCell(c, elements.byKey[e.condense.to].id, true);
        }
    },

    // Fission-product decay power for a cell, from the exponential bank that
    // reproduces t^-1.2. Held as a single "equivalent age" per cell so the
    // memory is one float, not twelve.
    fpPower(c) {
        const age = Math.max(1, this.fpAge);
        return this.fp[c] * 4.2e-13 * Math.pow(age, -1.2);
    },
    fpAge: 1,

    // ---- dissolution ----
    // Fissile dust that meets water goes into solution, one water cell at a
    // time. The solution carries 0.4 g of metal per cm3, so one 10 g cell of
    // dust charges twenty-five cells of liquid: the fuel spreads out, picks up
    // a moderator, and a heap that was nowhere near critical dry can be
    // critical wet. This is the commonest way the accident actually happens.
    SOL_U_PER_CELL: 0.4,

    dissolve(dt) {
        const p = Math.min(0.9, dt * 6);
        for (let y = this.H - 1; y >= 0; y--) {
            for (let x = 0; x < this.W; x++) {
                const c = y * this.W + x;
                const e = elements.list[this.type[c]];
                if (!e.dissolves || this.mass[c] <= 0) continue;
                if (this.rand() > p) continue;
                for (let s = 0; s < 4; s++) {
                    const nx = x + (s === 0 ? -1 : s === 1 ? 1 : 0), ny = y + (s === 2 ? -1 : s === 3 ? 1 : 0);
                    if (!this.inside(nx, ny)) continue;
                    const d = ny * this.W + nx;
                    if (this.type[d] !== elements.byKey.WATER.id) continue;
                    const sol = elements.byKey[e.dissolves];
                    const take = Math.min(this.SOL_U_PER_CELL, this.mass[c]);
                    this.setCell(d, sol.id, true);
                    this.mass[d] = sol.massG * (take / this.SOL_U_PER_CELL);
                    this.mass[c] -= take;
                    if (this.mass[c] < 0.05) this.setCell(c, elements.AIR, true);
                    break;
                }
            }
        }
    },

    // ---- the two thickness fields ----
    // See the header: `depth` is the body, `own` is this cell's own material,
    // and both are the spherical chord of their region.
    updateDepth() {
        if (this.depthVersion === this.mapVersion) return;
        this.depthVersion = this.mapVersion;
        // The body: everything condensed counts as one region.
        this.chord(this.dist, this.depth, 0);
        // The cell's own material: an interface with any other element ends it.
        this.chord(this.own, this.own, 1);
    },

    // Distance transform, then connected regions, then the chord. mode 0
    // treats all condensed matter as one region; mode 1 splits at every change
    // of element.
    chord(dbuf, out, mode) {
        const W = this.W, H = this.H, t = this.type, els = elements.list, n = this.n;
        const d = dbuf, BIG = 1e6, D1 = 1, D2 = 1.41421356;
        if (mode === 0) this.envelope();
        const env = this.blur;

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const c = y * W + x;
                const e = els[t[c]];
                const solid = !(e.empty || e.phaseGas) || (mode === 0 && env[c] >= 0.5);
                if (!solid) { d[c] = 0; continue; }
                let seed = x === 0 || y === 0 || x === W - 1 || y === H - 1;
                if (!seed && mode === 1 && !(e.empty || e.phaseGas)) {
                    seed = t[c - 1] !== t[c] || t[c + 1] !== t[c] ||
                           t[c - W] !== t[c] || t[c + W] !== t[c];
                }
                d[c] = seed ? 0.5 : BIG;
            }
        }
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const c = y * W + x;
                let v = d[c];
                if (v <= 0.5) continue;
                if (y > 0) {
                    if (d[c - W] + D1 < v) v = d[c - W] + D1;
                    if (x > 0 && d[c - W - 1] + D2 < v) v = d[c - W - 1] + D2;
                    if (x < W - 1 && d[c - W + 1] + D2 < v) v = d[c - W + 1] + D2;
                }
                if (x > 0 && d[c - 1] + D1 < v) v = d[c - 1] + D1;
                d[c] = v;
            }
        }
        for (let y = H - 1; y >= 0; y--) {
            for (let x = W - 1; x >= 0; x--) {
                const c = y * W + x;
                let v = d[c];
                if (v <= 0.5) continue;
                if (y < H - 1) {
                    if (d[c + W] + D1 < v) v = d[c + W] + D1;
                    if (x < W - 1 && d[c + W + 1] + D2 < v) v = d[c + W + 1] + D2;
                    if (x > 0 && d[c + W - 1] + D2 < v) v = d[c + W - 1] + D2;
                }
                if (x < W - 1 && d[c + 1] + D1 < v) v = d[c + 1] + D1;
                d[c] = v;
            }
        }

        // Label regions with union-find, then take each region's peak
        // distance. R has to be the region's own size: bounding the chord by a
        // global maximum would let a pebble beside a boulder inherit the
        // boulder's thickness.
        const lab = this.lab, rm = this.rmax;
        for (let c = 0; c < n; c++) lab[c] = d[c] > 0 ? c : -1;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const c = y * W + x;
                if (lab[c] < 0) continue;
                if (x > 0 && lab[c - 1] >= 0 && (mode === 0 || t[c - 1] === t[c])) this.union(c, c - 1);
                if (y > 0 && lab[c - W] >= 0 && (mode === 0 || t[c - W] === t[c])) this.union(c, c - W);
            }
        }
        for (let c = 0; c < n; c++) rm[c] = 0;
        for (let c = 0; c < n; c++) {
            if (lab[c] < 0) continue;
            const r = this.find(c);
            if (d[c] > rm[r]) rm[r] = d[c];
        }
        for (let c = 0; c < n; c++) {
            if (lab[c] < 0) { out[c] = 0; continue; }
            const R = rm[this.find(c)], dd = d[c];
            out[c] = Math.sqrt(Math.max(0, dd * (2 * R - dd)));
        }
    },

    // The body's envelope, not its exact outline. A separable box blur of
    // occupancy, thresholded at a half: at a straight edge the blur is exactly
    // a half, so the boundary does not move and a bare sphere is untouched,
    // but a void narrower than BRIDGE fills in.
    //
    // This is what lets a reflector standing a centimetre off the core still
    // be above and below it in z. Without it the two are separate bodies, the
    // core's z extent stops at its own surface, and a beryllium shell reflects
    // only in the plane: a 6 kg plutonium core with the shell closed right up
    // measured k = 0.94 instead of going critical, which is the entire 1946
    // accident failing to happen.
    envelope() {
        const W = this.W, H = this.H, n = this.n, occ = this.occ, bl = this.blur;
        const els = elements.list, t = this.type, R = this.BRIDGE;
        for (let c = 0; c < n; c++) {
            const e = els[t[c]];
            occ[c] = (e.empty || e.phaseGas) ? 0 : 1;
        }
        const win = 2 * R + 1;
        for (let y = 0; y < H; y++) {
            const row = y * W;
            let sum = 0;
            for (let x = 0; x <= R && x < W; x++) sum += occ[row + x];
            for (let x = 0; x < W; x++) {
                bl[row + x] = sum;
                const add = x + R + 1, sub = x - R;
                if (add < W) sum += occ[row + add];
                if (sub >= 0) sum -= occ[row + sub];
            }
        }
        for (let x = 0; x < W; x++) {
            let sum = 0;
            for (let y = 0; y <= R && y < H; y++) sum += bl[y * W + x];
            for (let y = 0; y < H; y++) {
                occ[y * W + x] = sum / (win * win);
                const add = y + R + 1, sub = y - R;
                if (add < H) sum += bl[add * W + x];
                if (sub >= 0) sum -= bl[sub * W + x];
            }
        }
        bl.set(occ);
    },

    find(c) {
        const lab = this.lab;
        let r = c;
        while (lab[r] !== r) r = lab[r];
        while (lab[c] !== r) { const nx = lab[c]; lab[c] = r; c = nx; }
        return r;
    },

    union(a, b) {
        const ra = this.find(a), rb = this.find(b);
        if (ra !== rb) this.lab[ra] = rb;
    },

    // ---- tallies for the panel ----
    // Mass is summed over the columns the cells stand for, so it is the mass
    // of the three-dimensional body and not of a one-centimetre slice.
    survey() {
        this.updateDepth();
        const s = {
            fissileG: 0, heavyG: 0, totalG: 0, hotCells: 0, maxT: this.amb, sumT: 0, cells: 0,
            spontN: 0, activity: 0, gammaField: 0, fissions: 0, moderatorG: 0
        };
        for (let c = 0; c < this.n; c++) {
            const e = elements.list[this.type[c]];
            if (e.empty) continue;
            const col = this.mass[c] * 2 * Math.max(0.5, this.own[c]);
            s.totalG += col;
            if (e.heavyFrac > 0) {
                s.heavyG += col * e.heavyFrac;
                if (e.enrich > 0.005) s.fissileG += col * e.heavyFrac;
            }
            if (e.group === 'moderator') s.moderatorG += col;
            const f = col / Math.max(1e-9, e.massG);
            s.spontN += e.spontN * f;
            s.activity += e.activity * f;
            s.gammaField += e.gammaField * f;
            s.fissions += this.fp[c];
            if (this.temp[c] > s.maxT) s.maxT = this.temp[c];
            s.sumT += this.temp[c]; s.cells++;
            if (this.temp[c] > 500) s.hotCells++;
        }
        s.meanT = s.cells ? s.sumT / s.cells : this.amb;
        return s;
    }
};

grid.init();
