// ============ CRITICALITY — BOOT, LOOP, PANEL ============
// Plain scripts, so load order is the <script> order in index.html:
// nuclear → elements → grid → neutrons → render → instruments → main.
// Only this file boots, because bench.init() needs the grid to exist before it
// can size the offscreen canvas it paints cells into.
//
// SPEED CHANGES THE MODEL TIMESTEP, NOT THE NUMBER OF TICKS. Everything here
// runs on model seconds, and the span that has to work is absurd: a prompt
// burst is over in tens of microseconds, and fission products are still warm a
// day later. So the frame asks for `speed x wall seconds` of model time and
// then hands it to the transport in as many substeps as the transport says it
// can take — which, when the chain reaction is growing, is a lot of small
// ones. When that binds, the achieved rate is reported rather than hidden.

const CRIT_VERSION = '0.1';

const app = {
    running: true,
    speed: 1,
    userSpeed: 1,
    autoSlow: true,
    slowUntil: 0,
    tool: 'paint',
    material: null,
    brush: 4,
    painting: false,
    erasing: false,
    preset: null,

    lastFrame: 0,
    sandAcc: 0,
    hudAt: 0,
    chartAt: 0,
    frameMs: 0,
    modelDt: 0,

    fisSum: 0, fisTimeSum: 0,

    SAND_DT: 0.02,          // model seconds per sand tick
    BUDGET_MS: 9,           // transport budget per frame

    init() {
        bench.init(document.getElementById('bench'));
        instruments.init(document.getElementById('powerChart'), document.getElementById('geigerChart'));
        this.buildPalette();
        this.bind();
        this.select('HEU_DUST');
        this.applyPreset('pour');
        window.addEventListener('resize', () => { bench.resize(); instruments.resize(); });
        this.lastFrame = performance.now();
        requestAnimationFrame(t => this.loop(t));
    },

    // ---- palette ----

    buildPalette() {
        const host = document.getElementById('palette');
        for (const g of elements.GROUPS) {
            const items = elements.list.filter(e => e.group === g.key);
            if (!items.length) continue;
            const wrap = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'pal-group-name';
            name.textContent = g.name;
            wrap.appendChild(name);
            const row = document.createElement('div');
            row.className = 'pal-items';
            for (const e of items) {
                const b = document.createElement('button');
                b.className = 'pal';
                b.dataset.key = e.key;
                const sw = document.createElement('i');
                sw.style.background = `rgb(${e.color[0]},${e.color[1]},${e.color[2]})`;
                b.appendChild(sw);
                b.appendChild(document.createTextNode(e.name));
                row.appendChild(b);
            }
            wrap.appendChild(row);
            host.appendChild(wrap);
        }
        host.addEventListener('click', ev => {
            const b = ev.target.closest('.pal');
            if (b) this.select(b.dataset.key);
        });
    },

    select(key) {
        this.material = elements.byKey[key];
        for (const b of document.querySelectorAll('.pal')) b.classList.toggle('is-on', b.dataset.key === key);
        const e = this.material;
        const bits = [];
        if (e.blurb) bits.push(e.blurb);
        bits.push(`${e.bulk} g/cm³ · ${e.phase}`);
        if (e.activity > 1e3) bits.push(`${instruments.si(e.activity, 'Bq')} per cm³`);
        if (e.spontN > 0.01) bits.push(`${instruments.si(e.spontN, 'n/s')} spontaneous per cm³`);
        document.getElementById('matBlurb').textContent = bits.join(' ');
    },

    // ---- controls ----

    bind() {
        const play = document.getElementById('playBtn');
        play.addEventListener('click', () => {
            this.running = !this.running;
            play.textContent = this.running ? 'Pause' : 'Play';
            play.classList.toggle('is-on', !this.running);
        });

        document.getElementById('speedGroup').addEventListener('click', ev => {
            const b = ev.target.closest('.spd');
            if (!b) return;
            this.userSpeed = parseFloat(b.dataset.speed);
            this.speed = this.userSpeed;
            this.slowUntil = 0;
            for (const x of document.querySelectorAll('.spd')) x.classList.toggle('is-on', x === b);
        });

        const slow = document.getElementById('slowmoBtn');
        slow.addEventListener('click', () => {
            this.autoSlow = !this.autoSlow;
            slow.classList.toggle('is-on', this.autoSlow);
        });

        const snd = document.getElementById('soundBtn');
        snd.addEventListener('click', () => {
            const on = instruments.toggleSound();
            snd.textContent = on ? '🔊' : '🔇';
            snd.classList.toggle('is-on', on);
        });

        document.getElementById('clearBtn').addEventListener('click', () => this.reset());

        document.getElementById('presets').addEventListener('click', ev => {
            const b = ev.target.closest('.preset');
            if (b) this.applyPreset(b.dataset.preset);
        });

        document.getElementById('tools').addEventListener('click', ev => {
            const b = ev.target.closest('.tool');
            if (!b) return;
            this.tool = b.dataset.tool;
            for (const x of document.querySelectorAll('.tool')) x.classList.toggle('is-on', x === b);
        });

        const bs = document.getElementById('brushSize');
        bs.addEventListener('input', () => {
            this.brush = parseInt(bs.value, 10);
            document.getElementById('brushVal').textContent = this.brush + ' cm';
            bench.cursor.r = this.brush;
        });

        const gap = document.getElementById('gapSlider');
        gap.addEventListener('input', () => {
            // Quarter-centimetre steps, because the last centimetre is the
            // whole experiment: from 1 cm to closed is forty dollars of
            // reactivity on a plutonium core.
            this.gap = parseFloat(gap.value);
            document.getElementById('gapUnit').textContent = this.gap.toFixed(2) + ' cm';
            if (this.preset === 'demon') this.buildDemon();
        });

        const c = document.getElementById('bench');
        c.addEventListener('contextmenu', e => e.preventDefault());
        c.addEventListener('pointerdown', e => {
            c.setPointerCapture(e.pointerId);
            this.painting = true;
            this.erasing = e.button === 2 || this.tool === 'erase';
            this.at(e);
        });
        c.addEventListener('pointermove', e => {
            this.at(e);
            if (this.painting) this.at(e);
        });
        c.addEventListener('pointerup', () => { this.painting = false; });
        c.addEventListener('pointerleave', () => { this.painting = false; bench.cursor.show = false; });

        window.addEventListener('keydown', e => {
            if (e.code === 'Space') { e.preventDefault(); play.click(); }
            if (e.key === '[') { bs.value = Math.max(1, this.brush - 1); bs.dispatchEvent(new Event('input')); }
            if (e.key === ']') { bs.value = Math.min(14, this.brush + 1); bs.dispatchEvent(new Event('input')); }
        });
    },

    at(e) {
        const r = bench.canvas.getBoundingClientRect();
        const [cx, cy] = bench.toCell(e.clientX - r.left, e.clientY - r.top);
        bench.cursor.x = cx; bench.cursor.y = cy;
        bench.cursor.show = true;
        bench.cursor.erase = this.erasing;
        if (!this.painting) return;
        if (this.tool === 'probe') {
            neutrons.probe.x = Math.max(1, Math.min(grid.W - 2, cx));
            neutrons.probe.y = Math.max(1, Math.min(grid.H - 2, cy));
            return;
        }
        this.stamp(cx, cy, this.brush, this.erasing ? elements.AIR : this.material.id);
    },

    stamp(cx, cy, r, id) {
        const r2 = r * r;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) {
            for (let x = Math.floor(cx - r); x <= cx + r; x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (dx * dx + dy * dy <= r2) grid.set(x, y, id);
            }
        }
    },

    disc(cx, cy, r, key) { this.stamp(cx, cy, r, elements.byKey[key].id); },

    // ---- the loop ----

    loop(now) {
        const t0 = performance.now();
        const wall = Math.min(0.05, (now - this.lastFrame) / 1000);
        this.lastFrame = now;

        neutrons.beginFrame();
        let done = 0;
        if (this.running) {
            this.autoSlowmo();
            let want = this.speed * wall;
            const deadline = t0 + this.BUDGET_MS;
            let guard = 0;
            while (done < want && guard++ < 400) {
                const dt = neutrons.suggestDt(want - done);
                neutrons.step(dt);
                done += dt;
                if (performance.now() > deadline) break;
            }
            this.modelDt = done;
            this.advanceWorld(done);
        } else {
            this.modelDt = 0;
        }

        grid.updateDepth();
        neutrons.finishFrame(done, wall, this.fpAge());
        instruments.tick(neutrons.probe.cps, wall);

        bench.draw();
        this.flash();

        if (now - this.chartAt > 90) {
            instruments.push(neutrons.t.power, neutrons.t.k, neutrons.probe.cps);
            instruments.drawPower();
            instruments.drawGeiger();
            this.chartAt = now;
        }
        if (now - this.hudAt > 110) { this.hud(); this.hudAt = now; }

        this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
        requestAnimationFrame(t => this.loop(t));
    },

    // The sand runs on its own fixed step. At a microsecond a second nothing
    // falls, which is correct — dust does not move during a burst — and at a
    // day a second it would fall infinitely fast, so the catch-up is capped.
    advanceWorld(dt) {
        if (dt <= 0) return;
        this.sandAcc += dt;
        let steps = 0;
        while (this.sandAcc >= this.SAND_DT && steps < 4) {
            grid.step();
            this.sandAcc -= this.SAND_DT;
            steps++;
        }
        if (this.sandAcc > this.SAND_DT * 4) this.sandAcc = this.SAND_DT * 4;
        grid.thermal(dt);
        grid.dissolve(dt);

        const f = neutrons.t.fis * neutrons.scale;
        if (f > 0) {
            this.fisSum += f;
            this.fisTimeSum += f * neutrons.modelTime;
        }
        grid.fpAge = this.fpAge();
    },

    // The mean age of the fission products, which is what the t^-1.2 law wants.
    // Tracking when the fissions happened costs two running sums and means a
    // burst and an hour-long run decay correctly off the same code.
    fpAge() {
        if (this.fisSum <= 0) return 1;
        return Math.max(1, neutrons.modelTime - this.fisTimeSum / this.fisSum);
    },

    // Slow motion, automatically. A prompt excursion is over in tens of
    // microseconds; at any watchable speed it is one frame of white and then
    // it is finished.
    autoSlowmo() {
        if (!this.autoSlow) return;
        const a = neutrons.t.alphaPrompt;
        if (a > 2000 && this.speed > 1e-6) {
            this.speed = 1e-7;
            this.slowUntil = performance.now() + 2500;
        } else if (this.slowUntil && performance.now() > this.slowUntil && a < 500) {
            this.speed = this.userSpeed;
            this.slowUntil = 0;
        }
    },

    flash() {
        // The blue flash. Every witness to a criticality accident described
        // it; it is ionised air, and it scales with the fission rate.
        const p = neutrons.t.power;
        const target = p > 1e3 ? Math.min(0.85, (Math.log10(p) - 3) / 9) : 0;
        bench.flashAmt += (target - bench.flashAmt) * 0.25;
        document.getElementById('flashLayer').style.opacity = bench.flashAmt.toFixed(3);
    },

    // ---- presets ----

    reset() {
        grid.clear(0x9e3779b9 ^ (Date.now() & 0xffff));
        neutrons.reset();
        instruments.clear();
        this.fisSum = 0; this.fisTimeSum = 0;
        this.sandAcc = 0;
    },

    applyPreset(name) {
        this.preset = name;
        this.reset();
        for (const b of document.querySelectorAll('.preset')) b.classList.toggle('is-on', b.dataset.preset === name);
        document.getElementById('gapKnob').style.display = name === 'demon' ? '' : 'none';
        document.getElementById('gapTitle').style.display = name === 'demon' ? '' : 'none';
        document.getElementById('gapUnit').textContent = name === 'demon' ? (this.gap).toFixed(2) + ' cm' : '—';

        const note = document.getElementById('presetNote');
        const P = this.PRESETS[name];
        note.textContent = P.note;
        P.build.call(this);
        if (P.material) this.select(P.material);
        if (P.brush) {
            document.getElementById('brushSize').value = P.brush;
            document.getElementById('brushSize').dispatchEvent(new Event('input'));
        }
        grid.updateDepth();
    },

    gap: 10,

    buildDemon() {
        // Rebuild only the reflector, so dragging the slider does not disturb
        // the core or anything the player has added.
        const be = elements.byKey.BE_BLOCK.id, air = elements.AIR;
        const cx = 120, cy = 78, r0 = 5.2, th = 3;
        for (let y = cy - r0 - th - 22; y <= cy + r0 + th + 2; y++) {
            for (let x = cx - r0 - th - 2; x <= cx + r0 + th + 2; x++) {
                const c = grid.i(Math.floor(x), Math.floor(y));
                if (grid.type[c] === be) grid.setCell(c, air, false);
            }
        }
        for (let y = Math.floor(cy - r0 - th - 22); y <= Math.ceil(cy + r0 + th + 2); y++) {
            for (let x = Math.floor(cx - r0 - th - 2); x <= Math.ceil(cx + r0 + th + 2); x++) {
                const dx = x + 0.5 - cx;
                const lower = y >= cy;
                const dy = lower ? (y + 0.5 - cy) : (y + 0.5 - cy + this.gap);
                if (!lower && dy > 0) continue;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d > r0 && d <= r0 + th) grid.set(x, y, be);
            }
        }
    },

    PRESETS: {
        pour: {
            note: 'An empty bench and a floor. Paint dust and watch the count rate: ' +
                  'nothing needs starting, because the material is already fissioning on its own.',
            material: 'HEU_DUST', brush: 6,
            build() { }
        },
        sphere: {
            note: 'A ball of highly enriched uranium, comfortably subcritical on its own. ' +
                  'Add metal, pack dust around it, or lay a reflector against it and watch what each one is worth.',
            material: 'HEU_METAL', brush: 3,
            build() { this.disc(120, 120, 7, 'HEU_METAL'); }
        },
        demon: {
            note: 'A 6 kg plutonium core between two beryllium hemispheres. The core is ' +
                  'nowhere near critical by itself; the reflector is what does it. Close the gap slowly.',
            material: 'BE_BLOCK', brush: 3,
            build() {
                this.disc(120, 78, 4.4, 'PU_METAL');
                this.buildDemon();
            }
        },
        solution: {
            note: 'A steel tank. Pour uranyl nitrate in and watch the level: the fuel is ' +
                  'dissolved in its own moderator, and there is a height at which the tank is a reactor.',
            material: 'URANYL', brush: 5,
            build() {
                const st = elements.byKey.STEEL.id;
                for (let y = 76; y <= 132; y++) { grid.set(86, y, st); grid.set(87, y, st); grid.set(154, y, st); grid.set(155, y, st); }
                for (let x = 86; x <= 155; x++) { grid.set(x, 131, st); grid.set(x, 132, st); }
            }
        },
        wet: {
            note: 'A heap of uranium dust that is safe dry. Pour water on it. The water ' +
                  'slows neutrons down and dissolves the fuel into the moderator, and safe stops being the word.',
            material: 'WATER', brush: 5,
            build() {
                for (let x = 96; x <= 144; x++) {
                    const h = Math.round(22 * Math.sqrt(Math.max(0, 1 - ((x - 120) / 24) ** 2)));
                    for (let y = 146 - h; y < 147; y++) grid.set(x, y, elements.byKey.HEU_DUST.id);
                }
            }
        },
        pile: {
            note: 'Natural uranium in lumps, in graphite, the way CP-1 was built. ' +
                  'Nothing here is enriched. It will not reach critical on this bench ' +
                  'and that is the lesson: the first reactor was six metres across, ' +
                  'because a graphite pile leaks until it is the size of a room.',
            material: 'GR_BLOCK', brush: 6,
            build() {
                const u = elements.byKey.NATU_METAL.id, g = elements.byKey.GR_BLOCK.id;
                for (let y = 16; y < 146; y++) for (let x = 6; x < 234; x++) grid.set(x, y, g);
                // Six-centimetre lumps on a twenty-centimetre pitch. Measured,
                // not guessed: lumps and spacing were scanned, and this is the
                // best a bench this size manages. Finer lattices do worse —
                // small lumps lose their own resonance self-shielding.
                for (let y = 18; y < 136; y += 20) for (let x = 8; x < 224; x += 20) {
                    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) grid.set(x + dx, y + dy, u);
                }
            }
        },
        shield: {
            note: 'No fission at all: a cobalt-60 source and some lead. Move the dosimeter, ' +
                  'build a wall, and see what stops gammas — then try the same wall against neutrons.',
            material: 'PB_BRICK', brush: 4,
            build() {
                // One centimetre of cobalt-60 is already 180 TBq and 60 Sv/h
                // at a metre. A blob of it would be an absurd object.
                this.disc(90, 143, 1, 'CO60_DUST');
                neutrons.probe.x = 175; neutrons.probe.y = 138;
            }
        }
    },

    // ---- the panel ----

    hud() {
        const T = neutrons.t, P = neutrons.probe;
        const s = grid.survey();
        const set = (id, v) => { const el = document.getElementById(id); if (el.textContent !== v) el.textContent = v; };

        const hasFuel = s.fissileG > 0.001;
        const k = T.k;
        set('kValue', hasFuel && k > 0 ? k.toFixed(4) : '—');
        const err = Math.sqrt(Math.max(0, T.kVar));
        set('kErr', hasFuel && k > 0 ? '±' + (err > 0.5 ? '—' : err.toFixed(3)) : '±—');

        const rho = k > 0 ? (k - 1) / k : 0;
        const beta = T.beta || 0.0065;
        set('statRho', hasFuel && k > 0 ? (rho * 100).toFixed(3) + '%' : '—');
        set('statDollar', hasFuel && k > 0 ? (rho / beta).toFixed(2) + '$' : '—');

        // Period from the smoothed RATE, never from a smoothed period: the
        // period runs off to infinity as the rate crosses zero and any average
        // across that sweeps through the small numbers that mean "running away".
        const a = T.alpha;
        set('statPeriod', hasFuel && k > 0
            ? (Math.abs(a) < 0.02 ? 'flat' : (a > 0 ? '+' : '−') + instruments.time(1 / Math.abs(a)))
            : '—');

        const st = document.getElementById('state');
        let cls = 'state', txt = 'NO FISSILE MATERIAL';
        if (hasFuel) {
            if (k <= 0) { txt = 'MEASURING…'; }
            else if (rho / beta >= 1) { txt = 'PROMPT CRITICAL'; cls += ' prompt'; }
            else if (k > 1.0005) { txt = 'SUPERCRITICAL'; cls += ' delayed'; }
            else if (k > 0.995) { txt = 'CRITICAL'; cls += ' delayed'; }
            else { txt = 'SUBCRITICAL'; cls += ' sub'; }
        }
        set('state', txt);
        if (st.className !== cls) st.className = cls;
        document.getElementById('kFill').style.width = Math.min(100, Math.max(0, k * 50)).toFixed(1) + '%';

        set('kNote', !hasFuel
            ? 'Put something fissile on the bench. k is production over loss, measured from the neutrons actually being tracked.'
            : rho / beta >= 1
                ? 'Past prompt critical the delayed neutrons no longer matter. The chain doubles on the prompt generation time and nothing an operator can do is fast enough.'
                : k > 1.0005
                    ? 'Supercritical, but under a dollar: the rise is paced by delayed neutrons arriving seconds after the fission that made them. This is the only regime a reactor is ever run in.'
                    : 'k is not computed here, it is measured: production over loss, with counting statistics, so the meter settles rather than snapping.');

        set('statPower', instruments.si(T.power, 'W'));
        set('statFis', instruments.si(neutrons.totalFissions, ''));
        set('statEnergy', instruments.si(neutrons.energyJ, 'J'));
        set('statLife', T.ell > 0 ? instruments.time(T.ell) : '—');
        set('statBeta', (beta * 100).toFixed(2) + '%');
        set('statTemp', (s.maxT - 273).toFixed(0) + ' °C');

        set('cpsValue', P.cps >= 1000 ? instruments.si(P.cps, '') : P.cps.toFixed(P.cps < 10 ? 1 : 0));
        set('statRate', instruments.sv(P.rate || 0) + '/h');
        set('statDose', instruments.sv(P.dose || 0));
        const dx = P.x - 120, dy = P.y - 100;
        set('statDist', Math.round(Math.sqrt(dx * dx + dy * dy)) + ' cm');
        set('splitN', instruments.sv(P.rateN || 0) + '/h');
        set('splitG', instruments.sv(P.rateG || 0) + '/h');
        set('splitD', instruments.sv(P.decay || 0) + '/h');

        const v = document.getElementById('verdict');
        const dose = P.dose || 0, rate = P.rate || 0;
        let vt, vc = 'verdict';
        if (dose > 6) { vt = `${dose.toFixed(1)} Sv. Above about 6 Sv, survival is not expected even with treatment.`; vc += ' bad'; }
        else if (dose > 1) { vt = `${dose.toFixed(2)} Sv. Acute radiation syndrome begins around 1 Sv.`; vc += ' bad'; }
        else if (dose > 0.05) { vt = `${(dose * 1000).toFixed(0)} mSv. Above a radiation worker's 20 mSv annual limit.`; vc += ' warn'; }
        else if (rate > 1e-5) { vt = `${instruments.sv(rate)}/h at the dosimeter. Elevated, but this is a dose rate, not a dose.`; vc += ' warn'; }
        else vt = 'Background. Nothing here is reaching the dosimeter in any quantity.';
        set('verdict', vt);
        if (v.className !== vc) v.className = vc;

        set('statFissile', s.fissileG <= 0 ? '—'
            : s.fissileG < 1000 ? s.fissileG.toFixed(s.fissileG < 10 ? 2 : 0) + ' g'
            : (s.fissileG / 1000).toFixed(2) + ' kg');
        set('statMass', s.totalG <= 0 ? '—'
            : s.totalG < 1000 ? s.totalG.toFixed(0) + ' g' : (s.totalG / 1000).toFixed(1) + ' kg');
        set('statSource', s.spontN > 0 ? instruments.si(s.spontN, 'n/s') : '—');
        set('statAct', s.activity > 0 ? instruments.si(s.activity, 'Bq') : '—');
        set('statTherm', (T.thermalFrac * 100).toFixed(0) + '%');

        this.fissionProducts();

        set('statTime', instruments.time(neutrons.modelTime));
        const eff = this.modelDt > 0 ? this.modelDt / Math.max(1e-6, 1 / 60) : 0;
        set('statSpeed', neutrons.limited ? '×' + instruments.si(eff, '', 0).trim() + ' (held)' : '×' + instruments.si(this.speed, '', 0).trim());
        set('statTracked', String(neutrons.n));
        set('statFrame', this.frameMs.toFixed(1) + ' ms');

        const banner = document.getElementById('banner');
        if (this.slowUntil) {
            banner.hidden = false;
            banner.className = 'banner slow';
            banner.textContent = 'EXCURSION — SLOW MOTION';
        } else if (s.maxT > 1400) {
            banner.hidden = false;
            banner.className = 'banner';
            banner.textContent = 'MATERIAL MELTING — THE ASSEMBLY IS TAKING ITSELF APART';
        } else if (neutrons.limited && T.alphaPrompt > 1000) {
            banner.hidden = false;
            banner.className = 'banner';
            banner.textContent = 'TIME COMPRESSION LIMITED BY THE CHAIN REACTION';
        } else banner.hidden = true;
    },

    fissionProducts() {
        const host = document.getElementById('fpRows');
        const F = neutrons.totalFissions;
        if (F < 1e6) {
            if (!host.dataset.empty) {
                host.innerHTML = '<div class="row empty">Nothing has fissioned yet.</div>';
                host.dataset.empty = '1';
            }
            return;
        }
        const age = this.fpAge();
        if (host.dataset.empty) { host.innerHTML = ''; delete host.dataset.empty; }
        if (!host.children.length) {
            for (const fp of nuclear.FISSION_PRODUCTS) {
                const r = document.createElement('div');
                r.className = 'row';
                r.innerHTML = `<span>${fp.key} <i>${fp.note}</i></span><b></b>`;
                host.appendChild(r);
            }
            const r = document.createElement('div');
            r.className = 'row';
            r.innerHTML = '<span>Decay heat</span><b></b>';
            host.appendChild(r);
        }
        let i = 0;
        for (const fp of nuclear.FISSION_PRODUCTS) {
            const lam = Math.LN2 / fp.halfLife;
            const act = fp.yield * F * lam * Math.exp(-lam * age);
            host.children[i].querySelector('b').textContent = instruments.si(act, 'Bq');
            i++;
        }
        host.children[i].querySelector('b').textContent =
            instruments.si(F * 4.2e-13 * Math.pow(age, -1.2), 'W');
    }
};

app.init();
