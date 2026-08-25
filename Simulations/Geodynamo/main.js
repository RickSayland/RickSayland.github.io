// ============ GEODYNAMO — BOOT, LOOP, PANEL ============
// Plain scripts, so load order is the <script> order in index.html:
// field → render → instruments → main. Only this file boots, because
// meridian.init() needs the solver's grid to exist before it can build the
// pixel-to-cell tables it draws through.

const DYNAMO_VERSION = '0.1';

// A polarity change only counts once the dipole has settled this far into the
// new direction. Below it the field is TRANSITIONAL — and the distinction is
// not bookkeeping, it is the difference between a reversal and an excursion,
// which is a real argument palaeomagnetists have about real cores.
const REV_THRESHOLD = 2.0;      // 10^22 A m^2

const PRESETS = {
    earth: {
        p: { vigour: 1.0, rotation: 1.0, shear: 0.18, turbulence: 1.0 },
        note: 'Earth today: vigorous convection, rapid rotation, a whisper of ' +
              'differential rotation, and turbulence enough to knock the dipole ' +
              'over every few hundred thousand years.'
    },
    superchron: {
        p: { vigour: 1.0, rotation: 1.0, shear: 0.10, turbulence: 0.25 },
        note: 'A quiet core. The dynamo runs just as hard but nothing perturbs it, ' +
              'so the dipole holds one polarity indefinitely. Earth did this for ' +
              '40 million years in the Cretaceous.'
    },
    mars: {
        p: { vigour: 0.30, rotation: 1.0, shear: 0.18, turbulence: 1.0 },
        note: 'The core cools, convection dies back, and the dynamo drops below ' +
              'critical. The field decays away over tens of thousands of years and ' +
              'does not come back. Mars still carries the magnetised crust it left behind.'
    },
    slow: {
        p: { vigour: 1.0, rotation: 0.10, shear: 0.18, turbulence: 1.0 },
        note: 'Plenty of heat, almost no spin. Without Coriolis the convection has ' +
              'no preferred handedness, its twists cancel, and a churning molten core ' +
              'generates nothing at all. Venus rotates once every 243 days.'
    },
    sun: {
        p: { vigour: 1.0, rotation: 1.0, shear: 1.0, turbulence: 0.30 },
        note: 'Strong differential rotation takes over. The dynamo stops being a ' +
              'stable dipole and becomes a wave: it reverses on a schedule, cleanly, ' +
              'whether or not anything disturbs it. The Sun does this every 11 years.'
    }
};

const sim = {
    running: true,
    speed: 20,               // kyr of model time per second of wall clock
    lastFrame: 0,
    hudAt: 0,
    siteLat: 52,

    polarity: 1,
    transitional: false,
    chronStart: 0,
    reversals: 0,
    chronSum: 0,
    chronCount: 0,

    init() {
        dynamo.init();
        meridian.init(document.getElementById('coreCanvas'));
        instruments.init(document.getElementById('recordCanvas'), document.getElementById('dipCanvas'));

        this.buildKnobs();
        this.bindControls();
        this.bindHover();
        this.apply('earth');

        window.addEventListener('resize', () => {
            meridian.resize();
            instruments.resize();
        });

        this.lastFrame = performance.now();
        requestAnimationFrame(t => this.loop(t));
    },

    // ---- Loop ----

    loop(now) {
        const wall = Math.min(0.1, (now - this.lastFrame) / 1000);
        this.lastFrame = now;

        if (this.running) {
            dynamo.advance(this.speed * wall / KYR_PER_T);
            this.track();
        }

        meridian.draw(now);
        if (now - this.hudAt > 100) { this.updateHud(); this.hudAt = now; }
        instruments.drawRecord();

        requestAnimationFrame(t => this.loop(t));
    },

    kyr() { return dynamo.t * KYR_PER_T; },

    // Chron bookkeeping, with the hysteresis that makes an excursion an
    // excursion: the dipole has to arrive in the new polarity, not merely leave
    // the old one.
    track() {
        const m = dynamo.dipoleMoment();
        const t = this.kyr();

        if (Math.abs(m) < REV_THRESHOLD) {
            this.transitional = true;
        } else {
            const p = m > 0 ? 1 : -1;
            if (p !== this.polarity) {
                this.polarity = p;
                this.reversals++;
                const len = t - this.chronStart;
                this.chronSum += len;
                this.chronCount++;
                this.chronStart = t;
            }
            this.transitional = false;
        }
        instruments.push(t, m, this.polarity);
    },

    // ---- Panel construction ----

    buildKnobs() {
        for (const knob of document.querySelectorAll('.knob')) {
            const input = knob.querySelector('.slider');
            input.min = knob.dataset.min;
            input.max = knob.dataset.max;
            input.step = knob.dataset.step;
            input.addEventListener('input', () => {
                dynamo.p[knob.dataset.key] = parseFloat(input.value);
                knob.querySelector('.knob-val').textContent = this.knobText(knob.dataset.key);
                this.clearPreset();
                this.updateDynamoNumber();
            });
        }
    },

    knobText(key) {
        const v = dynamo.p[key];
        if (key === 'rotation') {
            // Expressed as a day length, because "0.1" means nothing and
            // "240 hours" is immediately Venus.
            if (v < 0.02) return 'stopped';
            return (24 / v).toFixed(v < 0.5 ? 0 : 1) + ' h day';
        }
        if (key === 'shear') return v < 0.005 ? 'none' : v.toFixed(2);
        return v.toFixed(2);
    },

    syncKnobs() {
        for (const knob of document.querySelectorAll('.knob')) {
            const key = knob.dataset.key;
            knob.querySelector('.slider').value = dynamo.p[key];
            knob.querySelector('.knob-val').textContent = this.knobText(key);
        }
    },

    apply(name) {
        const pre = PRESETS[name];
        dynamo.p = Object.assign({}, pre.p);
        document.getElementById('presetNote').textContent = pre.note;
        for (const b of document.querySelectorAll('.preset')) {
            b.classList.toggle('is-on', b.dataset.preset === name);
        }
        this.syncKnobs();
        this.updateDynamoNumber();
        this.restart();
    },

    clearPreset() {
        for (const b of document.querySelectorAll('.preset')) b.classList.remove('is-on');
    },

    restart() {
        dynamo.reset();
        instruments.clear();
        this.polarity = 1;
        this.transitional = false;
        this.chronStart = 0;
        this.reversals = 0;
        this.chronSum = 0;
        this.chronCount = 0;
    },

    bindControls() {
        const play = document.getElementById('playBtn');
        play.addEventListener('click', () => {
            this.running = !this.running;
            play.textContent = this.running ? 'Pause' : 'Play';
            play.classList.toggle('is-on', !this.running);
        });

        document.getElementById('speedGroup').addEventListener('click', e => {
            const btn = e.target.closest('.spd');
            if (!btn) return;
            this.speed = parseFloat(btn.dataset.speed);
            for (const b of document.querySelectorAll('.spd')) b.classList.toggle('is-on', b === btn);
        });

        document.getElementById('kickBtn').addEventListener('click', () => dynamo.kick());
        document.getElementById('resetBtn').addEventListener('click', () => this.restart());

        document.getElementById('presets').addEventListener('click', e => {
            const btn = e.target.closest('.preset');
            if (btn) this.apply(btn.dataset.preset);
        });

        const site = document.getElementById('siteLat');
        site.addEventListener('input', () => { this.siteLat = parseFloat(site.value); });
    },

    bindHover() {
        const c = document.getElementById('coreCanvas');
        c.addEventListener('pointermove', e => {
            const r = c.getBoundingClientRect();
            meridian.setHover(e.clientX - r.left, e.clientY - r.top);
        });
        c.addEventListener('pointerleave', () => meridian.setHover(null));
    },

    // ---- Readout ----

    updateDynamoNumber() {
        const d = dynamo.dynamoNumber(), crit = dynamo.critical();
        document.getElementById('dnumValue').textContent = d.toFixed(1);
        document.getElementById('dnumCrit').textContent = crit.toFixed(1);

        const full = Math.max(d, crit) * 1.6;
        document.getElementById('dnumFill').style.width = (d / full * 100).toFixed(1) + '%';
        document.getElementById('dnumMark').style.left = (crit / full * 100).toFixed(1) + '%';

        const el = document.getElementById('regime');
        const note = document.getElementById('regimeNote');
        let text, cls, why;
        if (d < crit) {
            text = 'SUBCRITICAL — dying';
            cls = 'dead';
            why = 'Generation cannot keep up with ohmic decay. Whatever field is ' +
                  'left drains away with a 19,000-year half-life and does not return.';
        } else if (dynamo.p.shear < 0.10) {
            text = 'α² — dipole locked';
            cls = 'locked';
            why = 'Almost no shear, so the field is regenerated by helical convection ' +
                  'alone. This has two stable polarities and sits in one of them. It will ' +
                  'not reverse on its own.';
        } else if (dynamo.p.shear < 0.55) {
            text = 'α²Ω — reversing';
            cls = 'live';
            why = 'Near the threshold where the solution wants to oscillate but has not ' +
                  'committed. Turbulence pushes it over at random intervals — irregular ' +
                  'reversals, long chrons, no schedule. This is the Earth-like regime.';
        } else {
            text = 'αΩ — oscillating';
            cls = 'wave';
            why = 'Shear dominates. The dynamo is now a travelling wave that reverses on ' +
                  'its own timetable whether or not anything disturbs it, and it spends ' +
                  'far more of its life with a weak, tangled dipole.';
        }
        el.textContent = text;
        el.className = 'regime ' + cls;
        note.textContent = why;
    },

    updateHud() {
        const m = dynamo.dipoleMoment();
        const st = dynamo.station(this.siteLat);

        document.getElementById('momentValue').textContent = Math.abs(m).toFixed(1);

        const pol = document.getElementById('polarity');
        if (this.transitional) {
            pol.textContent = 'TRANSITIONAL';
            pol.className = 'polarity trans';
        } else if (m > 0) {
            pol.textContent = 'NORMAL POLARITY';
            pol.className = 'polarity normal';
        } else {
            pol.textContent = 'REVERSED POLARITY';
            pol.className = 'polarity reversed';
        }

        document.getElementById('statIntensity').textContent = st.F.toFixed(1);
        document.getElementById('statInc').textContent = st.inc.toFixed(0) + '°';
        document.getElementById('statVgp').textContent = st.vgp.toFixed(0) + '°';

        instruments.drawDip(st.inc, st.F, this.siteLat);

        const north = st.X >= 0;
        document.getElementById('siteNote').textContent =
            'A dip circle here reads ' + st.inc.toFixed(0) + '°, and the compass needle points ' +
            (north ? 'north' : 'south') + '. ' +
            (Math.abs(st.vgp) < 45
                ? 'The pole this implies is nowhere near the rotation axis — the field is not a dipole right now.'
                : 'Consistent with a dipole aligned to the spin axis.');

        const chron = this.kyr() - this.chronStart;
        document.getElementById('statChron').textContent = this.fmtKyr(chron);
        document.getElementById('statRev').textContent = this.reversals;
        document.getElementById('statMean').textContent =
            this.chronCount ? this.fmtKyr(this.chronSum / this.chronCount) : '—';

        document.getElementById('statTor').textContent = dynamo.peakToroidal().toFixed(2) + ' mT';
        const cmb = Math.abs(2 * dynamo.gauss[1]) * B_EQ * 1e6;
        document.getElementById('statCmb').textContent = (cmb / 1000).toFixed(2) + ' mT';
        const nd = dynamo.nonDipole();
        document.getElementById('statNd').textContent = (nd * 100).toFixed(0) + '%';
        document.getElementById('ndFill').style.width = (nd * 100).toFixed(1) + '%';

        document.getElementById('statTime').textContent = this.fmtKyr(this.kyr());
    },

    fmtKyr(k) {
        if (k >= 1000) return (k / 1000).toFixed(2) + ' Myr';
        return Math.round(k) + ' kyr';
    }
};

sim.init();
