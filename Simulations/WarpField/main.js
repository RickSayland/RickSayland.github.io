// ============ WARP FIELD ENGINEERING — BOOT, LOOP, PANEL ============
// Plain scripts, so load order is the <script> order in index.html:
// metrics → einstein → optics → space → ship → bench → bridge → navmap →
// console → main. Only this file boots, because space.init() has to build
// the catalogue before the ship can park beside Earth or the console can
// list destinations.
//
// Two load-bearing rules for the analysis scheduler:
//
// - **The drive you fly is the drive you designed.** One parameter set per
//   family, shared by the workshop sliders and the flight knobs, and one
//   analysis at a time. In the workshop it runs at the design velocity; in
//   flight at the ship's speed, quantised to tenths of a decade.
// - **In flight a running analysis is left to finish** unless the speed has
//   moved by more than 3×. The bubble ramps a decade every 1.5 s, and
//   restarting on every tenth of a decade meant no analysis ever completed
//   during a ramp. Eulerian energy scales exactly as v² for every shift
//   drive (the density is quadratic in the shift), so the gauges stay exact
//   between analyses by scaling the last one.

const WARP_VERSION = '0.1';
const ENGINE_WALL_FLOOR = 5e-4;     // thinnest wall the engine grids, in bubble radii
const HORIZON_WALL_FLOOR = 1e-6;    // and the horizon finder

const TAGS = { alcubierre: ['neg', 'negative'], natario: ['neg', 'negative'], potential: ['neg', 'mixed'], shell: ['pos', 'positive'], warpshell: ['pos', 'positive'] };

const app = {
    mode: 'workshop',
    rate: 1,
    family: 'alcubierre',
    params: {},
    vDesign: 1.5,
    job: null,
    snap: null,
    snapId: 0,
    railDirty: true,
    lastUI: 0,
    lastMini: 0,
    lastFrame: 0,
    keys: {},
    t0: 0,
    logCount: 0,
    horizonCache: null,
    lastBeta: 0,

    init() {
        space.init();
        for (const k of FAMILY_ORDER) {
            const p = {};
            for (const d of FAMILIES[k].params) p[d.key] = d.def;
            this.params[k] = sanitizeParams(k, p);
        }
        this.t0 = space.nowSec();
        ship.init(this.t0);
        ship.log('Test article parked 60,000 km from Earth. Field generators cold.');

        bench.init(document.getElementById('benchCanvas'));
        bridge.init(document.getElementById('bridgeCanvas'));
        navmap.init(document.getElementById('navCanvas'), id => handlers.target(id));
        this.mini = document.getElementById('miniCanvas');
        this.miniCtx = this.mini.getContext('2d');
        consoleUI.init(handlers);

        this.buildRail();
        this.bindChrome();
        this.selectFamily(this.family, true);

        this.lastFrame = performance.now();
        requestAnimationFrame(t => this.loop(t));
    },

    p() { return this.params[this.family]; },
    fam() { return FAMILIES[this.family]; },

    // ---- Drive changes ----

    selectFamily(key, force) {
        if (!force && key === this.family) return;
        if (!force && ship.beta > 0) {
            ship.log('Bring the ship to rest before swapping the drive', 'warn');
            return;
        }
        this.family = key;
        consoleUI.buildKnobs(key, this.p());
        this.buildSliders();
        this.updateDrive();
        this.railDirty = true;
        document.querySelectorAll('#families button').forEach(b => b.classList.toggle('on', b.dataset.key === key));
    },

    setParam(k, v) {
        if (ship.helmLocked()) return;
        const p = Object.assign({}, this.p());
        p[k] = v;
        this.params[this.family] = sanitizeParams(this.family, p);
        this.updateDrive();
        this.railDirty = true;
    },

    // Tell the ship what it is carrying: swept area, mass, interior clock
    // rate, and the speed at which horizons form.
    updateDrive() {
        const key = this.family, p = this.p(), fam = this.fam();
        if (fam.kind === 'shell') {
            const m = buildMetric(key, p, 0, 0);
            ship.setDrive({ kind: 'shell', R: p.R2, M: p.M, clockRate: m.clockRate, vh: Infinity });
        } else {
            ship.setDrive({ kind: 'shift', R: p.R, M: 0, clockRate: 1, vh: this.horizonThreshold(key, p) });
        }
        this.horizonCache = null;
    },

    // Bubble speed at which the flow along the forward axis first reaches
    // light speed: 1 / max(N^x / v) over the axis ahead of the cabin.
    horizonThreshold(key, p) {
        const m = buildMetric(key, p, 1, HORIZON_WALL_FLOOR);
        const N = new Float64Array(3);
        let mx = 0;
        const probe = x => { m.shift(x, 0, 0, N); if (N[0] > mx) mx = N[0]; };
        for (let i = 1; i <= 200; i++) probe(m.rmax * i / 200);
        for (let u = -10; u <= 10; u += 0.02) probe(1 + u * m.w);
        return mx > 0 ? Math.min(1, 1 / mx) : 1;
    },

    // Where the forward horizon sits at bubble speed v, and how hard it
    // pulls: κ = dN^x/dx there. The Hawking temperature of a horizon with
    // surface gravity κ is ħκ / 2πk_B, and Finazzi, Liberati & Barceló
    // (2009) found the front one semiclassically unstable on a timescale
    // set by the same κ.
    horizonAt(v) {
        const key = this.family, p = this.p();
        const ck = key + JSON.stringify(p) + '|' + v.toPrecision(4);
        if (this.horizonCache && this.horizonCache.key === ck) return this.horizonCache.val;
        const m = buildMetric(key, p, v, HORIZON_WALL_FLOOR);
        const N = new Float64Array(3);
        const f = x => { m.shift(x, 0, 0, N); return N[0] - 1; };
        let val = null;
        let prev = 0, xp = 0;
        const xs = [];
        for (let i = 1; i <= 200; i++) xs.push(m.rmax * i / 200);
        for (let u = -10; u <= 10; u += 0.05) xs.push(1 + u * m.w);
        xs.sort((a, b) => a - b);
        prev = f(0);
        for (const x of xs) {
            const y = f(x);
            if (prev < 0 && y >= 0) {
                let lo = xp, hi = x;
                for (let k = 0; k < 60; k++) { const mid = 0.5 * (lo + hi); if (f(mid) < 0) lo = mid; else hi = mid; }
                const xh = 0.5 * (lo + hi);
                const e = 1e-4 * m.w;
                const kc = Math.abs((f(xh + e) - f(xh - e)) / (2 * e));
                // Past the floor, the wall is thinner than we built it: a
                // thin wall's gradients go as 1/Δ.
                const extra = m.clamped ? m.w / m.wTrue : 1;
                const kappa = kc * extra * PHYS.c / m.L;
                val = { r: xh * m.L, kappa, TH: PHYS.hbar * kappa / (2 * Math.PI * PHYS.kB), extrap: m.clamped };
                break;
            }
            prev = y; xp = x;
        }
        this.horizonCache = { key: ck, val };
        return val;
    },

    // ---- Analysis scheduling ----

    wanted() {
        const key = this.family, p = this.p();
        let v;
        if (this.fam().kind === 'shell') v = 0;
        else if (this.mode === 'flight' && ship.beta > 0) v = Math.pow(10, Math.round(Math.log10(ship.beta) * 10) / 10);
        else v = this.vDesign;
        const base = key + '|' + JSON.stringify(p);
        return { key, p, v, base, sig: base + '|' + v };
    },

    schedule() {
        const w = this.wanted();
        const j = this.job;
        let start = false;
        if (!j || j.base !== w.base) start = true;
        else if (j.v !== w.v) {
            if (this.mode === 'workshop') start = true;
            else if (einstein.done) start = true;
            else if (Math.abs(Math.log(w.v / j.v)) > Math.log(3)) start = true;
        }
        if (start) {
            einstein.start(buildMetric(w.key, w.p, w.v, ENGINE_WALL_FLOOR));
            this.job = w;
            this.railDirty = true;
        }
        einstein.work(this.mode === 'workshop' ? 10 : 3);
        if (einstein.done && this.job && (!this.snap || this.snap.sig !== this.job.sig)) {
            this.snap = {
                id: ++this.snapId, sig: this.job.sig, base: this.job.base, key: this.job.key,
                v: this.job.v, grid: einstein.grid, f: einstein.f, totals: einstein.totals, metric: einstein.metric
            };
            bench.setSnapshot(this.snap);
            this.railDirty = true;
        }
    },

    // Energy numbers at bubble speed v, from the latest analysis of this
    // exact geometry.
    energyAt(v) {
        const s = this.snap, fam = this.fam();
        const out = { J: null, kg: 0, peak: null, casimir: '—', casimirCls: '', qi: '—', qiCls: '' };
        if (!s || s.base !== this.wanted().base) return out;
        const L = s.metric.L;
        if (fam.kind === 'shell') {
            const p = this.p();
            out.J = p.M * PHYS.c * PHYS.c;
            out.kg = p.M;
            out.peak = s.totals.rhoMax * PHYS.C4G / (L * L);
            out.casimir = 'n/a — positive energy';
            out.qi = 'n/a — no negative energy';
            out.qiCls = 'ok';
            return out;
        }
        if (!(v > 0)) {
            out.J = 0; out.kg = 0; out.peak = 0;
            out.casimir = 'flat space';
            out.qi = 'no field';
            return out;
        }
        const k = (v / s.v) * (v / s.v);
        out.J = s.totals.Enet * k * L * PHYS.C4G;
        out.kg = out.J / (PHYS.c * PHYS.c);
        out.peak = s.totals.rhoMin * k * PHYS.C4G / (L * L);
        const ratio = Math.abs(out.peak) / CASIMIR_RHO;
        out.casimir = ratio > 1 ? '10' + supNum(Math.round(Math.log10(ratio))) + ' ×' : 'within';
        out.casimirCls = ratio > 1 ? 'bad' : 'ok';
        const lim = qiWallLimit(v), D = this.p().D;
        out.qi = D > lim ? '10' + supNum(Math.round(Math.log10(D / lim))) + ' × too thick' : 'within the bound';
        out.qiCls = D > lim ? 'warn' : 'ok';
        return out;
    },

    // ---- Workshop rail ----

    buildRail() {
        const fam = document.getElementById('families');
        fam.innerHTML = FAMILY_ORDER.map(k => {
            const f = FAMILIES[k], t = TAGS[k];
            return `<button data-key="${k}"><span class="tag ${t[0]}">${t[1]}</span><b>${f.name}</b><span>${f.year} · ${f.kind === 'shell' ? 'subluminal' : 'any speed'}</span></button>`;
        }).join('');
        fam.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (b) this.selectFamily(b.dataset.key);
        });
        const vs = document.getElementById('velSlider');
        const vDef = { min: 0.01, max: 1000, log: true };
        vs.value = Math.round(paramToUnit(vDef, this.vDesign) * 1000);
        vs.addEventListener('input', () => {
            this.vDesign = unitToParam(vDef, vs.value / 1000);
            this.railDirty = true;
        });
    },

    buildSliders() {
        const box = document.getElementById('paramSliders');
        const defs = this.fam().params;
        box.innerHTML = defs.map(d => `
            <div class="slider-row" data-key="${d.key}">
                <div class="sr-head"><span>${d.label}</span><b>—</b></div>
                <input type="range" min="0" max="1000" step="1">
            </div>`).join('');
        box.querySelectorAll('.slider-row').forEach(row => {
            const d = defs.find(x => x.key === row.dataset.key);
            const inp = row.querySelector('input');
            inp.value = Math.round(paramToUnit(d, this.p()[d.key]) * 1000);
            inp.addEventListener('input', () => this.setParam(d.key, unitToParam(d, inp.value / 1000)));
        });
    },

    renderRail() {
        const fam = this.fam(), p = this.p();
        const $ = id => document.getElementById(id);
        $('famName').textContent = fam.name;
        $('famCite').innerHTML = `${fam.authors}, ${fam.year} · <a href="${fam.ref}" target="_blank" rel="noopener">arXiv:${fam.refLabel}</a>`;
        $('famBlurb').textContent = fam.blurb;
        document.querySelectorAll('#paramSliders .slider-row').forEach(row => {
            const d = fam.params.find(x => x.key === row.dataset.key);
            row.querySelector('b').textContent = fmtParam(d, p[d.key]);
            const inp = row.querySelector('input');
            if (document.activeElement !== inp) inp.value = Math.round(paramToUnit(d, p[d.key]) * 1000);
        });
        $('velRow').style.display = fam.kind === 'shell' ? 'none' : '';
        $('velVal').textContent = fmtBeta(this.vDesign);

        const s = this.snap && this.snap.base === this.wanted().base ? this.snap : null;
        const V = $('verdicts');
        const rows = [
            ['nec', 'NEC', 'light rays'],
            ['wec', 'WEC', 'every observer'],
            ['sec', 'SEC', 'gravity attracts'],
            ['dec', 'DEC', 'energy flows below c']
        ];
        V.innerHTML = rows.map(([k, n, what]) => {
            if (!s) return `<div class="verdict wait"><span class="lamp"></span><span class="name">${n}</span><span class="what"><i>${what}</i> — analysing</span></div>`;
            const t = s.totals, pass = t.pass[k];
            const frac = t.bad[k] / t.matterVol;
            const worst = t.worst[k] * PHYS.C4G / (s.metric.L * s.metric.L) * (t.extrap * t.extrap);
            const txt = pass ? 'satisfied everywhere'
                : `violated in ${fmtPct(frac)} of the curved region · worst ${fmtSci(worst, 2)} J/m³`;
            return `<div class="verdict ${pass ? 'pass' : 'fail'}"><span class="lamp"></span><span class="name">${n}</span><span class="what"><i>${what}:</i> ${txt}</span></div>`;
        }).join('');

        $('totals').innerHTML = s ? this.totalsHTML(s) : '<dt>—</dt><dd></dd>';
        $('insight').textContent = s ? this.insight(s) : '';
        const m = s ? s.metric : null;
        $('benchNote').textContent = s
            ? `Analysed ${fam.kind === 'shell' ? 'at rest' : 'at ' + fmtBeta(s.v)} · ${s.grid.nr * s.grid.nth} points × ${EC_DIRS.length / 3 * EC_SPEEDS.length} observers each` +
              (m.clamped ? ` · wall thinner than R/${Math.round(1 / ENGINE_WALL_FLOOR)} — gridded there, totals carried to ${fmtLen(p.D)} by the thin-wall 1/Δ law` : '')
            : '';
    },

    totalsHTML(s) {
        const t = s.totals, m = s.metric, L = m.L, fam = this.fam(), p = this.p();
        const J = x => x * L * PHYS.C4G;
        const row = (k, v, cls, sub) => `<dt>${k}</dt><dd class="${cls || ''}">${v}</dd>` + (sub ? `<div class="sub">${sub}</div>` : '');
        let h = '';
        const eMass = x => fmtMass(J(x) / (PHYS.c * PHYS.c));
        if (fam.kind === 'shift') {
            h += row('Eulerian energy, net', `${fmtSci(J(t.Enet), 3)} J`, t.Enet < 0 ? 'neg' : 'pos', eMass(t.Enet) + (t.Enet < 0 ? ' of negative energy' : ''));
            if (t.Epos > 1e-9 * Math.abs(t.Eneg)) {
                h += row('negative part', eMass(t.Eneg), 'neg');
                h += row('positive part', eMass(t.Epos), 'pos');
            }
            if (this.family === 'alcubierre') {
                const cf = alcubierreEnergyCode(s.v, 2 * p.R / p.D);
                const err = Math.abs(t.Enet / cf - 1);
                h += row('closed form (Pfenning–Ford)', `${fmtSci(J(cf), 3)} J`, '', `the grid integral agrees to ${fmtPct(err)}`);
            }
            const peak = t.rhoMin * PHYS.C4G / (L * L);
            h += row('peak density', `${fmtSci(peak, 2)} J/m³`, 'neg', `10${supNum(Math.round(Math.log10(Math.abs(peak) / CASIMIR_RHO)))} × a Casimir cavity at 100 nm, the most negative energy density ever measured`);
            const lim = qiWallLimit(s.v);
            if (p.D > lim) {
                const Eqi = J(t.Enet) * p.D / lim;
                h += row('quantum inequality', `wall 10${supNum(Math.round(Math.log10(p.D / lim)))} × too thick`, 'warn',
                    `Pfenning & Ford: Δ ≲ 100 v ℓ_P = ${fmtSci(lim, 2)} m. Thinned to that, the same bubble needs ${fmtMass(Eqi / (PHYS.c * PHYS.c))}.`);
            } else {
                h += row('quantum inequality', 'within the bound', 'ok');
            }
            const vh = this.horizonThreshold(this.family, p);
            h += row('horizons form at', fmtBeta(vh), vh < 1 ? 'warn' : '',
                vh < 0.999 ? 'the flow of space inside the wall outruns light long before the bubble does' : 'the bubble outrunning light along its own axis');
        } else {
            h += row('shell mass (ADM)', fmtMass(p.M), 'pos', `${fmtSci(p.M, 3)} kg of ordinary, positive-energy matter`);
            h += row('Eulerian energy', `${fmtSci(J(t.Enet), 3)} J`, t.Eneg < -1e-6 * t.Epos ? 'warn' : 'pos',
                t.Eneg < -1e-6 * t.Epos ? `includes ${eMass(t.Eneg)} negative` : 'positive everywhere');
            h += row('compactness 2GM/Rc²', m.compactness.toFixed(3), m.compactness > 0.6 ? 'warn' : '');
            h += row('interior clock rate', m.clockRate.toFixed(4), '', `clocks inside run ${fmtPct(1 - m.clockRate)} slow: the only thing this drive changes`);
            if (m.bw > 0) {
                let jmax = 0;
                for (let i = 0; i < s.f.jx.length; i++) jmax = Math.max(jmax, Math.hypot(s.f.jx[i], s.f.jy[i]));
                h += row('momentum flux / peak density', (jmax / t.rhoMax).toFixed(3), jmax > 0.5 * t.rhoMax ? 'warn' : '', 'energy conditions need the flux to stay below the density that carries it');
            }
            const g = 1 / Math.sqrt(1 - 0.01);
            const KE = (g - 1) * p.M * PHYS.c * PHYS.c;
            h += row('to reach 0.1 c', `${fmtSci(KE, 2)} J`, 'warn', `${fmtSci(KE / PHYS.L_SUN / 3.156e7, 2)} years of the Sun's entire output — delivered by propulsion, since a shell is a mass`);
        }
        const room = m.flatRadius;
        h += row('flat room for the crew', fmtLen(room), room < PAYLOAD_HALF ? 'bad' : 'ok',
            room < PAYLOAD_HALF ? 'the 12 m crew module sticks into the curved region' : 'radius inside which space is flat to 0.1%');
        return h;
    },

    insight(s) {
        const t = s.totals, key = this.family;
        const all = t.pass.nec && t.pass.wec && t.pass.dec;
        if (key === 'alcubierre') return 'Negative energy wherever the wall is, and every observer agrees — it is a ring around the equator, not a sheet across the bow. Energy grows as v², and as 1/Δ as the wall thins: the quantum inequality forces it thin enough to cost more than the mass of the universe.';
        if (key === 'natario') {
            return 'York time is zero everywhere — nothing contracts ahead or expands behind — and the energy is still negative. The famous expansion was never the engine. What moves you is the shift; the price is its gradient.';
        }
        if (key === 'potential') {
            const frac = Math.abs(t.Enet) / Math.max(t.Epos, 1e-300);
            return `The Eulerian energy is positive over part of the wall: this is the observation positive-energy warp papers build on. But for a shift that switches off outside the bubble it integrates to zero (here, to ${fmtPct(frac)} of either half): every positive joule is paid for by a negative one. Fell & Heisenberg get a positive total by not switching the field off — their exterior falls away like a Schwarzschild field. And the null condition still fails for observers crossing the wall (Santiago, Schuster & Visser 2021).`;
        }
        if (key === 'shell') return all
            ? 'Every observer sees non-negative energy. This is an ordinary massive shell, and that is Bobrick & Martire\'s point: any warp drive is a shell of material moving inertially. Made of normal matter it is subluminal, must be pushed like any mass, and the one thing it changes is how fast time passes inside.'
            : 'The shell is too compact for the stresses holding it up: they break the dominant energy condition. Spread the mass over a larger radius.';
        if (key === 'warpshell') return all
            ? 'Every energy condition holds: the shell\'s density pays for the shift\'s momentum flux. This is the Fuchs et al. result. Raise the interior shift — or thin the shell — until the flux outgrows the density that carries it and the null condition fails. Where that happens is the limit the paper left open.'
            : 'The shift\'s momentum flux now exceeds what the shell can pay for: observers crossing it see negative energy. More mass, a thicker shell, or a gentler shift.';
        return '';
    },

    // ---- Chrome: modes, time base, field tabs, keys ----

    bindChrome() {
        document.getElementById('modes').addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            this.mode = b.dataset.mode;
            document.body.dataset.mode = this.mode;
            document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x === b));
            this.railDirty = true;
        });
        document.getElementById('timebase').addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            this.rate = parseFloat(b.dataset.rate);
            document.querySelectorAll('#timebase button').forEach(x => x.classList.toggle('on', x === b));
        });
        document.getElementById('fieldTabs').addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            bench.field = b.dataset.field;
            bench.heatCache = null;
            document.querySelectorAll('#fieldTabs button').forEach(x => x.classList.toggle('on', x === b));
        });
        document.getElementById('navZoom').addEventListener('click', e => {
            const b = e.target.closest('button');
            if (b) navmap.half = parseFloat(b.dataset.zoom);
        });
        window.addEventListener('keydown', e => {
            if (e.target.closest && e.target.closest('input, select, textarea')) return;
            this.keys[e.code] = true;
            if (this.mode !== 'flight') return;
            if (e.code === 'BracketRight') handlers.cruise(ship.cruise > 0 ? ship.cruise * 1.25 : 1e-6);
            else if (e.code === 'BracketLeft') handlers.cruise(ship.cruise > 1e-6 ? ship.cruise / 1.25 : 0);
            else if (e.code === 'Space') { e.preventDefault(); handlers.engage(); }
            else if (e.code === 'KeyX') handlers.stop();
        });
        window.addEventListener('keyup', e => { this.keys[e.code] = false; });
        window.addEventListener('blur', () => { this.keys = {}; });
    },

    // Manual stick from the keyboard.
    stick(dt) {
        if (this.mode !== 'flight') return;
        const k = this.keys, rate = 0.45;
        const yaw = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
        const pitch = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
        const roll = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
        if (!yaw && !pitch && !roll) return;
        if (!ship.steer(yaw * rate, pitch * rate, roll * rate, dt) && !this.stickWarned) {
            ship.log(ship.helmLocked() ? 'Helm locked — the front wall is beyond the horizon' : 'Autopilot has the helm — select MANUAL to steer', 'warn');
            this.stickWarned = true;
        }
    },

    // ---- Loop ----

    loop(now) {
        const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
        this.lastFrame = now;
        this.fitCanvases();

        this.stick(dt);
        if (!Object.values(this.keys).some(Boolean)) this.stickWarned = false;
        ship.helm(dt);
        const b0 = ship.beta;
        if (this.rate > 0) ship.advance(dt * this.rate);
        this.accelerating = ship.isShell() && Math.abs(ship.beta - b0) > 0;

        this.schedule();

        if (this.mode === 'flight') {
            optics.request({ key: this.family, params: this.p(), v: ship.beta, clockRate: ship.drive.clockRate });
            optics.work(4);
            bridge.draw(ship, ship.t);
            navmap.draw(ship, ship.t);
            if (now - this.lastMini > 250) { this.drawMini(); this.lastMini = now; }
        } else {
            bench.draw(now);
        }

        if (now - this.lastUI > 100) {
            this.updatePanel();
            if (this.railDirty && this.mode === 'workshop') { this.renderRail(); this.railDirty = false; }
            this.lastUI = now;
        }
        requestAnimationFrame(t => this.loop(t));
    },

    fitCanvases() {
        const fit = (cv, obj) => {
            if (!cv.offsetParent) return;
            const r = cv.getBoundingClientRect();
            if (Math.abs(r.width - obj.W) > 0.5 || Math.abs(r.height - obj.H) > 0.5) obj.resize();
        };
        fit(document.getElementById('benchCanvas'), bench);
        fit(document.getElementById('bridgeCanvas'), bridge);
        fit(document.getElementById('navCanvas'), navmap);
    },

    drawMini() {
        const cv = this.mini;
        if (!cv.offsetParent) return;
        const r = cv.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
        const ctx = this.miniCtx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#03050a';
        ctx.fillRect(0, 0, r.width, r.height);
        const s = this.snap;
        if (!s) return;
        const size = r.height - 12;
        const rng = bench.fieldRange(s, 'rho');
        bench.drawHeat(ctx, s, 'rho', 6, 6, size, rng, false);
        const t = s.totals;
        const x = size + 18;
        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.fillStyle = '#8193ab';
        ctx.fillText(FAMILIES[s.key].name.toUpperCase(), x, 20);
        ctx.fillStyle = '#5d6e85';
        ctx.fillText(s.metric.kind === 'shell' ? 'analysed at rest' : 'analysed at ' + fmtBeta(s.v), x, 36);
        const lines = [['NEC', t.pass.nec], ['WEC', t.pass.wec], ['SEC', t.pass.sec], ['DEC', t.pass.dec]];
        lines.forEach(([n, ok], i) => {
            ctx.fillStyle = ok ? '#4be38f' : '#ff4f4f';
            ctx.beginPath(); ctx.arc(x + 4, 56 + i * 16, 4, 0, 2 * Math.PI); ctx.fill();
            ctx.fillStyle = '#b7c5d8';
            ctx.fillText(`${n} ${ok ? 'satisfied' : 'violated'}`, x + 14, 60 + i * 16);
        });
        ctx.fillStyle = '#5d6e85';
        ctx.fillText('Eulerian energy density,', x, 132);
        ctx.fillText('meridional slice, bow →', x, 146);
        document.getElementById('miniLabel').textContent = ship.beta > 0 ? 'energy scales as v²' : '';
    },

    // ---- Console and clocks, ~10 Hz ----

    updatePanel() {
        const s = ship;
        const date = space.secToDate(s.t);
        document.getElementById('clkEarth').textContent = date.toISOString().replace('T', ' ').slice(0, 19);
        const earthElapsed = s.t - this.t0;
        const lag = earthElapsed - s.tau;
        document.getElementById('clkShip').textContent = 'T+' + fmtClock(s.tau) + (Math.abs(lag) > 0.5 ? ` (−${fmtTime(lag)})` : '');

        this.drainLog();
        const pr = einstein.progress();
        document.getElementById('anaBar').style.width = (pr * 100).toFixed(1) + '%';
        document.getElementById('anaText').textContent = einstein.done
            ? `metric → Einstein tensor → ${einstein.total.toLocaleString('en-US')} points, ${EC_DIRS.length / 3 * EC_SPEEDS.length} observers each`
            : `solving the field equations… ${Math.round(pr * 100)}%`;
        if (this.mode !== 'flight') return;

        const shell = s.isShell();
        const g = s.targetGeom();
        const E = space.bodyPos('earth', s.t);
        const lagEarth = Math.hypot(E[0] - s.pos[0], E[1] - s.pos[1], E[2] - s.pos[2]) / PHYS.c;

        const energy = this.energyAt(s.beta);
        const causal = { horizon: 'none', horizonCls: 'ok', kappa: '—', TH: '—', instab: '—', instabCls: '' };
        if (shell) {
            causal.horizon = 'none — subluminal matter';
        } else if (s.beta > 0 && s.beta >= s.vh()) {
            const hz = this.horizonAt(s.beta);
            if (hz) {
                causal.horizon = `front & rear, ${fmtLen(hz.r)} out`;
                causal.horizonCls = 'bad';
                causal.kappa = fmtSci(hz.kappa, 2) + ' s⁻¹' + (hz.extrap ? ' *' : '');
                causal.TH = fmtSci(hz.TH, 2) + ' K';
                causal.instab = '~' + fmtTime(1 / hz.kappa);
                causal.instabCls = 'bad';
            }
        } else if (s.beta > 0) {
            causal.horizon = `none below ${fmtBeta(s.vh())}`;
        }

        const near = space.nearest(s.pos, s.t);
        const snapOk = this.snap && this.snap.base === this.wanted().base;
        const t = snapOk ? this.snap.totals : null;
        const moving = s.beta > 0;
        const tiles = {
            field: s.fieldOn,
            super: !shell && s.beta > 1,
            horizon: s.horizon(),
            helm: s.helmLocked(),
            negE: !shell && moving && t && t.rhoMin < -t.tol,
            nec: t && !t.pass.nec && (shell || moving),
            qi: !shell && moving && this.p().D > qiWallLimit(s.beta),
            hull: snapOk && this.snap.metric.flatRadius < PAYLOAD_HALF,
            loaded: s.swept > 0,
            thrust: this.accelerating,
            bypass: !s.interlock,
            prox: near.dist < near.body.radius
        };

        const gam = shell ? 1 / Math.sqrt(1 - s.beta * s.beta) : 1;
        consoleUI.update({
            ship: s, family: this.family, params: this.p(), vh: s.vh(),
            eta: this.eta(), lagEarth, status: this.status(g),
            energy, causal, tiles,
            load: shell && this.accelerating ? s.thrustG.toFixed(3) + ' g' : '0.000 g',
            clock: shell ? (s.drive.clockRate / gam).toFixed(5) : '1.00000 — free fall'
        });
    },

    status(g) {
        const s = ship;
        const ang = Math.acos(Math.max(-1, Math.min(1, v3dot(s.fwd, g.dir)))) * 180 / Math.PI;
        if (s.helmLocked()) return `<span style="color:var(--amber)">COMMITTED</span><br>${fmtDist(s.plan ? s.plan.remaining : g.rem)} to the braking mark`;
        if (s.mode === 'auto') {
            if (!s.fieldOn) return 'AUTO · field cold<br>lift the guard, throw FIELD';
            if (!s.engaged) return `AUTO · ready<br>ENGAGE for ${g.body.name}`;
            if (!s.legActive) return `ALIGNING<br>${ang.toFixed(1)}° to go`;
            if (s.braking) return 'BRAKING';
            if (s.beta < s.effCruise() * 0.999) return 'ACCELERATING';
            return 'CRUISE';
        }
        return `MANUAL${s.fieldOn ? '' : ' · field cold'}<br>${ang.toFixed(1)}° off ${g.body.name}`;
    },

    // Rough time to arrival for the leg in progress.
    eta() {
        const s = ship;
        if (!s.engaged || !s.legActive) {
            if (s.beta > 0 && s.mode === 'manual') return fmtTime(Math.max(0, s.targetGeom().rem) / (PHYS.c * s.beta));
            return '—';
        }
        const rem = s.plan && s.plan.committed ? s.plan.remaining : s.targetGeom().rem;
        const c = PHYS.c, k = s.rate(), b = s.beta, bc = s.effCruise();
        if (s.lin()) {
            if (s.braking) return fmtTime(b / k);
            const dUp = c * (bc * bc - b * b) / (2 * k), dDn = c * bc * bc / (2 * k);
            if (dUp + dDn > rem) {
                const bp = Math.sqrt(Math.max(b * b, (2 * k * rem / c + b * b) / 2));
                return fmtTime((bp - b) / k + bp / k);
            }
            return fmtTime((bc - b) / k + (rem - dUp - dDn) / (c * bc) + bc / k);
        }
        const fl = BETA_FLOOR, bs = Math.max(b, fl);
        if (s.braking) return fmtTime(Math.log(bs / fl) / k);
        const dUp = c * (bc - bs) / k, dDn = c * bc / k;
        if (dUp + dDn > rem) {
            const bp = Math.max(bs, (rem * k / c + bs) / 2);
            return fmtTime(Math.log(bp / bs) / k + Math.log(bp / fl) / k);
        }
        return fmtTime(Math.log(bc / bs) / k + (rem - dUp - dDn) / (c * bc) + Math.log(bc / fl) / k);
    },

    drainLog() {
        if (!ship.events.length) return;
        const ol = document.getElementById('log');
        for (const ev of ship.events.splice(0)) {
            const li = document.createElement('li');
            li.className = ev.level;
            li.innerHTML = `<span class="ts">${fmtClock(ev.t - this.t0)}</span>`;
            li.appendChild(document.createTextNode(ev.text));
            ol.insertBefore(li, ol.firstChild);
        }
        while (ol.children.length > 80) ol.removeChild(ol.lastChild);
    }
};

const handlers = {
    mode(m) { ship.setMode(m); },
    target(id) { if (ship.setTarget(id)) ship.log('Destination: ' + space.byId[id].name); },
    thrust(g) { if (!ship.helmLocked()) ship.thrustG = g; },
    interlock() { ship.setInterlock(!ship.interlock); },
    engage() { ship.engage(); },
    stop() { ship.allStop(); },
    field() { ship.setField(!ship.fieldOn); },
    cruise(b) {
        if (ship.helmLocked()) { consoleUI.flashGate(); return; }
        const shell = ship.isShell();
        if (shell && b > 0.99) { b = 0.99; consoleUI.flashGate(); }
        else if (!shell && ship.mode === 'manual' && ship.interlock && b > ship.vh() * C_GATE) {
            b = ship.vh() * C_GATE;
            consoleUI.flashGate();
            if (!handlers.gateWarned) {
                ship.log('C-GATE: past light speed the helm is lost — use AUTO and commit a flight plan', 'warn');
                handlers.gateWarned = true;
            }
        }
        ship.setCruise(b);
    },
    param(k, v) { app.setParam(k, v); },
    getParam(k) { return app.p()[k]; }
};

function fmtPct(x) {
    const a = Math.abs(x) * 100;
    if (a === 0) return '0%';
    if (a < 0.01) return a.toExponential(1) + '%';
    if (a < 1) return a.toFixed(2) + '%';
    return a.toFixed(1) + '%';
}
function fmtClock(s) {
    s = Math.max(0, s);
    const d = Math.floor(s / 86400);
    const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, sec = Math.floor(s) % 60;
    const pad = n => String(n).padStart(2, '0');
    return (d ? d + 'd ' : '') + pad(h) + ':' + pad(m) + ':' + pad(sec);
}

app.init();
