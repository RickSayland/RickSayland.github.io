// ============ THERMALIZE — WIRING ============
// The only file that boots. Tools, the neutron gun, the scenes, the loop.
// Bump THERMALIZE_VERSION together with the ?v= queries in index.html.

const THERMALIZE_VERSION = '0.1.0';

const app = {

    paused: false,
    speed: 1,
    tool: 'paint',
    mat: 0,
    auto: 'single',         // 'off' | 'single' | 'stream'
    autoWait: 0.5,
    streamAcc: 0,
    sandAcc: 0,
    track: true,
    viewSlider: 2e6,
    gun: { x: 20, y: 50, ang: 0, E: 2e6, spread: 0.4 },
    drag: null,
    last: 0,
    lastDropped: 0,
    capUntil: 0,
    box: null,
    boxAge: 99,
    el: {},

    $(id) { return this.el[id] || (this.el[id] = document.getElementById(id)); },

    boot() {
        this.$('version').textContent = 'v' + THERMALIZE_VERSION;
        bench.init(this.$('bench'));
        bench.gun = this.gun;
        inspector.init();
        this.buildPalette();
        this.wire();
        this.selectMat(materials.byKey.WATER.id);
        this.preset('lab');
        requestAnimationFrame(t => this.frame(t));
    },

    // ---- Palette and tools ----

    buildPalette() {
        const root = this.$('palette');
        for (const g of materials.GROUPS) {
            const box = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'pal-group-name'; name.textContent = g.name;
            const items = document.createElement('div');
            items.className = 'pal-items';
            for (const m of materials.DEFS) {
                if (m.group !== g.key) continue;
                const b = document.createElement('button');
                b.className = 'pal'; b.dataset.id = m.id;
                b.title = m.formula + ' · ' + m.phase + ' · ' + m.rho + ' g/cm³';
                const sw = document.createElement('i');
                sw.className = 'ph-' + m.phase; sw.style.background = m.css;
                b.appendChild(sw); b.appendChild(document.createTextNode(m.name));
                b.addEventListener('click', () => {
                    this.selectMat(m.id);
                    if (this.tool !== 'paint') this.setTool('paint');
                });
                items.appendChild(b);
            }
            box.appendChild(name); box.appendChild(items); root.appendChild(box);
        }
    },

    selectMat(id) {
        this.mat = id; inspector.selMat = id;
        for (const b of this.$('palette').querySelectorAll('.pal')) b.classList.toggle('is-on', +b.dataset.id === id);
        const m = materials.list[id];
        this.$('matBlurb').textContent = m.blurb;
    },

    setTool(t) {
        this.tool = t;
        for (const b of this.$('tools').querySelectorAll('.tool')) b.classList.toggle('is-on', b.dataset.tool === t);
        bench.showBrush = t === 'paint' || t === 'erase';
        this.$('bench').style.cursor = t === 'pick' ? 'pointer' : 'crosshair';
    },

    setAuto(mode) {
        this.auto = mode;
        for (const b of document.querySelectorAll('.auto')) b.classList.toggle('is-on', b.dataset.auto === mode);
        this.autoWait = 0.3; this.streamAcc = 0;
    },

    setGunE(E) {
        this.gun.E = E;
        this.$('gunE').value = Math.log10(E);
        this.$('gunEVal').textContent = nuc.fmtE(E);
    },

    setToggle(id, on) { this.$(id).classList.toggle('is-on', on); },

    fire(follow) {
        const g = this.gun;
        return neutrons.fire(g.x, g.y, g.ang + (rng.next() - 0.5) * g.spread, g.E, follow);
    },

    // Run the followed neutron forward to the moment it next hits something.
    nextCollision() {
        if (neutrons.fIdx < 0) { if (this.auto === 'off' || !neutrons.f.alive) this.fire(true); return; }
        const c = neutrons.f.col;
        for (let k = 0; k < 40000 && neutrons.fIdx >= 0 && neutrons.f.col === c; k++) neutrons.step(0.002);
    },

    // ---- Wiring ----

    wire() {
        const cv = this.$('bench');
        const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

        cv.addEventListener('contextmenu', e => e.preventDefault());
        cv.addEventListener('pointerdown', e => {
            cv.setPointerCapture(e.pointerId);
            const p = pos(e), wx = bench.wx(p.x), wy = bench.wy(p.y);
            if (e.button === 1 || e.button === 2) { this.drag = { k: 'pan', x: p.x, y: p.y }; return; }
            if (this.tool === 'paint' || this.tool === 'erase') {
                this.drag = { k: 'paint', wx, wy, replace: e.shiftKey };
                this.stroke(wx, wy, wx, wy);
            } else if (this.tool === 'gun') {
                this.gun.x = Math.max(0.5, Math.min(grid.W - 0.5, wx));
                this.gun.y = Math.max(0.5, Math.min(grid.H - 0.5, wy));
                this.drag = { k: 'gun' };
            } else {
                const i = neutrons.pick(wx, wy, Math.max(0.8, 14 / bench.cam.z));
                if (i >= 0) neutrons.setFollow(i);
                else {
                    const m = grid.get(wx, wy);
                    if (m) inspector.selMat = m;
                    this.drag = { k: 'pan', x: p.x, y: p.y };
                }
            }
        });
        cv.addEventListener('pointermove', e => {
            const p = pos(e), wx = bench.wx(p.x), wy = bench.wy(p.y);
            bench.mouse.x = p.x; bench.mouse.y = p.y; bench.mouse.on = true;
            this.hover(wx, wy);
            const d = this.drag;
            if (!d) return;
            if (d.k === 'pan') {
                bench.cam.x -= (p.x - d.x) / bench.cam.z; bench.cam.y -= (p.y - d.y) / bench.cam.z;
                d.x = p.x; d.y = p.y; bench.clampCam();
            } else if (d.k === 'paint') {
                this.stroke(d.wx, d.wy, wx, wy); d.wx = wx; d.wy = wy;
            } else if (d.k === 'gun') {
                const dx = wx - this.gun.x, dy = wy - this.gun.y;
                if (dx * dx + dy * dy > 0.2) this.gun.ang = Math.atan2(dy, dx);
            }
        });
        const up = () => {
            if (this.drag && this.drag.k === 'gun') this.fire(true);
            this.drag = null;
        };
        cv.addEventListener('pointerup', up);
        cv.addEventListener('pointercancel', up);
        cv.addEventListener('pointerleave', () => { bench.mouse.on = false; this.$('hover').hidden = true; });
        cv.addEventListener('wheel', e => {
            e.preventDefault();
            const p = pos(e);
            bench.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
        }, { passive: false });

        window.addEventListener('resize', () => bench.resize());
        window.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') { if (e.code !== 'Space') return; e.target.blur(); }
            if (e.code === 'Space') { e.preventDefault(); this.setPaused(!this.paused); }
            else if (e.key === 'f' || e.key === 'F') this.fire(true);
            else if (e.key === 'n' || e.key === 'N') this.nextCollision();
        });

        this.$('playBtn').addEventListener('click', () => this.setPaused(!this.paused));
        this.$('stepBtn').addEventListener('click', () => this.nextCollision());
        for (const b of document.querySelectorAll('.spd')) {
            b.addEventListener('click', () => {
                this.speed = +b.dataset.speed;
                for (const o of document.querySelectorAll('.spd')) o.classList.toggle('is-on', o === b);
            });
        }
        this.$('clearNBtn').addEventListener('click', () => { neutrons.reset(); this.autoWait = 0.4; });
        this.$('clearBtn').addEventListener('click', () => {
            grid.clear(); neutrons.reset(); this.setAuto('off');
            for (const b of document.querySelectorAll('.preset')) b.classList.remove('is-on');
            this.$('presetNote').textContent = 'An empty bench, 160 cm by 100. Pick a material and paint.';
        });

        for (const b of document.querySelectorAll('.preset')) b.addEventListener('click', () => this.preset(b.dataset.preset));

        this.$('gunE').addEventListener('input', e => this.setGunE(Math.pow(10, +e.target.value)));
        for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => this.setGunE(+c.dataset.e));
        this.$('fireBtn').addEventListener('click', () => this.fire(true));
        for (const b of document.querySelectorAll('.auto')) {
            b.addEventListener('click', () => this.setAuto(this.auto === b.dataset.auto ? 'off' : b.dataset.auto));
        }

        this.$('zoom').addEventListener('input', e => {
            const lo = bench.zFit * 0.8, z = lo * Math.pow(bench.ZMAX / lo, +e.target.value);
            bench.zoomAt(bench.w / 2, bench.h / 2, z / bench.cam.z);
        });
        this.$('viewE').addEventListener('input', e => { this.viewSlider = Math.pow(10, +e.target.value); });
        this.$('burnBtn').addEventListener('click', () => { neutrons.burn = !neutrons.burn; this.setToggle('burnBtn', neutrons.burn); });
        this.$('eyeBtn').addEventListener('click', () => { bench.eye = !bench.eye; this.setToggle('eyeBtn', bench.eye); });
        this.$('trackBtn').addEventListener('click', () => { this.track = !this.track; this.setToggle('trackBtn', this.track); });

        this.$('brushSize').addEventListener('input', e => {
            bench.brush = +e.target.value;
            this.$('brushVal').textContent = (bench.brush * 2) + ' cm';
        });
        bench.brush = +this.$('brushSize').value;
        this.$('brushVal').textContent = (bench.brush * 2) + ' cm';
        for (const b of this.$('tools').querySelectorAll('.tool')) b.addEventListener('click', () => this.setTool(b.dataset.tool));
    },

    setPaused(p) {
        this.paused = p;
        this.$('playBtn').textContent = p ? 'Play' : 'Pause';
        this.$('playBtn').classList.toggle('is-on', p);
    },

    // A brush stroke is a run of discs close enough together to leave no gaps.
    stroke(x0, y0, x1, y1) {
        const id = this.tool === 'erase' ? 0 : this.mat, r = bench.brush;
        const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / Math.max(0.4, r * 0.5)));
        for (let k = 0; k <= n; k++) {
            const t = k / n;
            grid.paint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, id, this.drag && this.drag.replace);
        }
    },

    hover(wx, wy) {
        const h = this.$('hover');
        h.hidden = wx < 0 || wy < 0 || wx >= grid.W || wy >= grid.H;
        if (h.hidden) return;
        const m = grid.get(wx, wy);
        if (!m) { h.textContent = 'empty bench'; return; }
        const M = materials.list[m], s = this._sig || (this._sig = {});
        materials.sigma(M, nuc.group(bench.viewE), s);
        h.textContent = M.name + ' (' + M.formula + ') · free path ' + nuc.fmtLen(1 / s.tot) + ' at ' + nuc.fmtE(bench.viewE);
    },

    // ---- Scenes ----

    preset(key) {
        const P = this.PRESETS[key];
        if (!P) return;
        grid.clear(); neutrons.reset();
        rng.seed(0x7e57ab1e);
        neutrons.burn = true; bench.eye = false;
        this.gun.spread = 0.4;
        P.build.call(this, k => materials.byKey[k].id);
        this.setToggle('burnBtn', neutrons.burn);
        this.setToggle('eyeBtn', bench.eye);
        this.$('presetNote').textContent = P.note;
        for (const b of document.querySelectorAll('.preset')) b.classList.toggle('is-on', b.dataset.preset === key);
        this.autoWait = 0.6;
    },

    aim(x, y, ang, E, spread) {
        this.gun.x = x; this.gun.y = y; this.gun.ang = ang;
        if (spread !== undefined) this.gun.spread = spread;
        this.setGunE(E);
    },

    // A tank is two walls; the bench is its floor.
    tank(A, x0, x1, top, wall) {
        grid.rect(x0 - 1, top - 2, x0 - 1, grid.H - 1, A(wall));
        grid.rect(x1 + 1, top - 2, x1 + 1, grid.H - 1, A(wall));
    },

    PRESETS: {
        lab: {
            note: 'A 2 MeV neutron goes into water. Every collision with hydrogen costs it energy, the discs around it swell, and by the time it reaches the boron it cannot get through. Try Next collision.',
            build(A) {
                this.tank(A, 65, 93, 86, 'AL');
                grid.rect(65, 86, 76, 99, A('WATER'));
                grid.rect(77, 84, 81, 99, A('BORON'));
                grid.rect(82, 86, 93, 99, A('WATER'));
                this.aim(60.5, 92.5, 0, 2e6, 0.5);
                this.setAuto('single');
                bench.fit(57, 81, 97, 100.5);
            }
        },
        cutoff: {
            note: 'A stream of slow neutrons against two centimetres of cadmium. Slide the gun energy up through half an electron-volt: the sheet does not fade, it opens.',
            build(A) {
                grid.rect(80, 36, 81, 64, A('CD'));
                this.aim(64, 50, 0, 0.05, 0.75);
                neutrons.burn = false;
                this.setAuto('stream');
                bench.fit(58, 32, 102, 68);
            }
        },
        race: {
            note: 'The same californium source in water, heavy water and graphite. Violet is fast, amber is thermal. Water gets there in centimetres; graphite needs the whole block and loses most of them out of the sides.',
            build(A) {
                this.tank(A, 14, 42, 70, 'AL'); grid.rect(14, 70, 42, 99, A('WATER'));
                this.tank(A, 66, 94, 70, 'AL'); grid.rect(66, 70, 94, 99, A('HEAVY'));
                grid.rect(118, 70, 146, 99, A('GRAPHITE'));
                for (const x of [27, 79, 131]) grid.rect(x, 84, x + 1, 85, A('CF'));
                this.aim(6, 40, 0, 2e6);
                this.setAuto('off');
                bench.fit(6, 60, 154, 100.5);
            }
        },
        chain: {
            note: 'A block of uranium-235. Press Fire: one neutron in, two or three out of every fission, and each atom that fissions is left as fission products. The staircase follows one line of descent.',
            build(A) {
                grid.rect(70, 86, 89, 99, A('U235'));
                this.aim(64.5, 92.5, 0, 2e6, 0.3);
                this.setAuto('off');
                bench.fit(60, 82, 99, 100.5);
            }
        },
        rods: {
            note: 'Rods of 4% uranium standing in water, with a source between them. Fission neutrons are born fast in a rod, have to leave it to slow down, and come back thermal. Try draining the water.',
            build(A) {
                this.tank(A, 50, 110, 64, 'AL');
                grid.rect(50, 64, 110, 99, A('WATER'));
                for (let x = 53; x <= 107; x += 6) grid.rect(x, 68, x + 1, 99, A('LEU'));
                grid.set(81, 82, A('CF'));
                this.aim(40, 82, 0, 2e6);
                this.setAuto('off');
                bench.fit(45, 58, 115, 100.5);
            }
        },
        sand: {
            note: 'Everything pours. Sand heaps, water finds its level, mercury sinks under it, xenon pools on the floor. Zoom into any of it and it is atoms.',
            build(A) {
                grid.rect(20, 60, 60, 60, A('FE')); grid.rect(96, 72, 140, 72, A('FE'));
                grid.rect(0, 92, 0, 99, A('FE')); grid.rect(159, 92, 159, 99, A('FE'));
                grid.paint(36, 30, 9, A('SAND'), true);
                grid.paint(80, 22, 10, A('WATER'), true);
                grid.paint(118, 40, 8, A('BPOWDER'), true);
                grid.paint(104, 12, 5, A('HG'), true);
                grid.paint(146, 84, 6, A('XE135'), true);
                grid.rect(78, 97, 79, 98, A('CF'));
                this.aim(8, 30, 0.2, 2e6);
                this.setAuto('off');
                bench.fit(0, 0, 160, 100.5);
            }
        }
    },

    // The bounding box of everything on the bench, a few cells proud.
    sceneBox() {
        this.boxAge = 0;
        const W = grid.W, H = grid.H, type = grid.type;
        let x0 = W, x1 = -1, y0 = H, y1 = -1;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (type[y * W + x] === 0) continue;
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        this.box = x1 < 0 ? null : { x0: x0 - 3, x1: x1 + 4, y0: y0 - 3, y1: y1 + 4 };
    },

    // ---- The loop ----

    simulate(dt) {
        // Sand at 30 steps a second of simulated time, whatever the frame rate.
        this.sandAcc += dt * 30;
        let k = 0;
        while (this.sandAcc >= 1 && k < 6) { grid.step(); this.sandAcc -= 1; k++; }
        if (k === 6) this.sandAcc = 0;

        // Sources: a grain of californium throws a fission neutron now and then.
        const emit = materials.emit, type = grid.type, W = grid.W;
        for (let c = 0; c < type.length; c++) {
            const r = emit[type[c]];
            if (r > 0 && rng.next() < r * dt) {
                const a = rng.next() * 6.2831853;
                if (neutrons.spawn((c % W) + 0.5, ((c / W) | 0) + 0.5, Math.cos(a), Math.sin(a),
                    nuc.sampleFission(neutrons._r), c, 0) >= 0) neutrons.tally.fired++;
            }
        }

        if (this.auto === 'single') {
            if (neutrons.fIdx < 0) {
                this.autoWait -= dt;
                if (this.autoWait <= 0) { this.fire(true); this.autoWait = 0.8; }
            }
        } else if (this.auto === 'stream') {
            this.streamAcc += dt * 9;
            while (this.streamAcc >= 1) { this.fire(neutrons.fIdx < 0); this.streamAcc -= 1; }
        }

        neutrons.step(dt);
    },

    frame(t) {
        const dtReal = Math.min(0.05, Math.max(0.001, (t - this.last) / 1000 || 0.016));
        this.last = t;
        if (!this.paused) this.simulate(dtReal * this.speed);
        this.present(dtReal);
        requestAnimationFrame(tt => this.frame(tt));
    },

    present(dtReal) {
        const i = neutrons.fIdx;
        bench.viewE = i >= 0 ? neutrons.E[i] : this.viewSlider;

        // Keep the followed neutron inside the middle of the view, but only
        // nudge the camera when it nears the edge: a camera glued to a
        // neutron that changes direction every centimetre is unwatchable.
        // And only while it is among the things on the bench. One that has
        // escaped is on its way out for good, and following it strands the
        // view over empty bench with the next neutron nowhere in sight.
        if (++this.boxAge > 20) this.sceneBox();
        const bx = this.box;
        if (this.track && i >= 0 && bench.lattice() && !this.drag && bx &&
            neutrons.x[i] > bx.x0 && neutrons.x[i] < bx.x1 && neutrons.y[i] > bx.y0 && neutrons.y[i] < bx.y1) {
            const c = bench.cam, mx = bench.w * 0.32 / c.z, my = bench.h * 0.32 / c.z;
            const dx = neutrons.x[i] - c.x, dy = neutrons.y[i] - c.y;
            const k = Math.min(1, dtReal * 5);
            if (dx > mx) c.x += (dx - mx) * k; else if (dx < -mx) c.x += (dx + mx) * k;
            if (dy > my) c.y += (dy - my) * k; else if (dy < -my) c.y += (dy + my) * k;
        }

        bench.draw(dtReal);
        inspector.update(dtReal);

        // Controls that mirror state they do not own.
        const lo = bench.zFit * 0.8;
        const zt = Math.log(bench.cam.z / lo) / Math.log(bench.ZMAX / lo);
        const zs = this.$('zoom');
        if (document.activeElement !== zs && Math.abs(+zs.value - zt) > 0.004) zs.value = zt;
        const zl = (bench.lattice() ? 'lattice' : 'sand') + ' · ' + bench.cam.z.toFixed(0) + ' px/cm';
        if (this.$('zoomVal').textContent !== zl) this.$('zoomVal').textContent = zl;
        const vl = nuc.fmtE(bench.viewE) + (i >= 0 ? ' (followed)' : '');
        if (this.$('viewEVal').textContent !== vl) this.$('viewEVal').textContent = vl;
        this.$('viewE').disabled = i >= 0;

        const dropped = neutrons.tally.dropped;
        if (dropped > this.lastDropped) this.capUntil = performance.now() + 2500;
        this.lastDropped = dropped;
        const b = this.$('banner'), show = performance.now() < this.capUntil;
        if (b.hidden === show) {
            b.hidden = !show;
            b.textContent = 'Particle limit: ' + neutrons.MAX.toLocaleString('en-US') + ' neutrons in flight. New ones are being dropped.';
        }
    }
};

app.boot();

// A development handle, not a feature. requestAnimationFrame is throttled in
// hidden tabs and most automated browsers, so step(n) runs the same update
// and draw the loop does, by hand.
window.thermalize = {
    app, grid, neutrons, bench, materials, nuc, inspector,
    step(n, dt) {
        for (let k = 0; k < (n || 1); k++) app.simulate(dt || 1 / 60);
        inspector.acc = 1;
        app.present(1 / 60);
    }
};
