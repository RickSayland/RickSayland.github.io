// ============ WARP FIELD ENGINEERING — FLIGHT CONSOLE ============
// The hardware: lever, knobs, guarded switch, key switch, annunciator. The
// only file besides main.js that touches the console DOM. It reports what
// the operator did through handler callbacks and never changes the ship
// itself, so every refusal (helm locked, gate closed) is decided in one
// place — ship.js — and merely shown here.

// The lever runs in decades: a stop detent at the bottom, then 300 m/s at
// the first mark to 10⁵ c at the top.
const LEVER_LO = -6, LEVER_HI = 5, LEVER_STOP = 0.05;
function leverPos(b) {
    if (b <= 0) return 0;
    const p = LEVER_STOP + (1 - LEVER_STOP) * (Math.log10(b) - LEVER_LO) / (LEVER_HI - LEVER_LO);
    return Math.max(LEVER_STOP, Math.min(1, p));
}
function leverBeta(p) {
    if (p < LEVER_STOP * 0.6) return 0;
    return Math.pow(10, LEVER_LO + (LEVER_HI - LEVER_LO) * Math.max(0, p - LEVER_STOP) / (1 - LEVER_STOP));
}

const TILES = [
    ['field', 'Field energised', 'cyan'],
    ['super', 'Superluminal', 'amber'],
    ['horizon', 'Horizon · front wall lost', 'red'],
    ['helm', 'Helm locked', 'amber'],
    ['negE', 'Negative energy', 'amber'],
    ['nec', 'Null energy violated', 'red'],
    ['qi', 'Quantum inequality', 'amber'],
    ['hull', 'Hull in wall', 'red'],
    ['loaded', 'Front wall loaded', 'amber'],
    ['thrust', 'Thrusting', 'cyan'],
    ['bypass', 'Interlock bypassed', 'red'],
    ['prox', 'Proximity', 'red']
];

const consoleUI = {
    h: null,
    el: {},
    tiles: {},
    tileState: {},
    knobDefs: null,

    init(handlers) {
        this.h = handlers;
        const $ = id => document.getElementById(id);
        for (const id of ['lever', 'leverScale', 'leverGate', 'leverHandle', 'rdBeta', 'rdCruise', 'rdStatus',
            'knobs', 'conFamily', 'conFieldTitle', 'thrustRow', 'thrustSeg', 'gaugeFill', 'gaugeTicks',
            'rdEnergy', 'rdMass', 'rdPeak', 'rdCasimir', 'rdQI', 'conEnergyTitle',
            'rdHorizon', 'rdKappa', 'rdTH', 'rdInstab', 'rdSwept', 'interlock',
            'annun', 'guard', 'guardLbl', 'engageBtn', 'stopBtn', 'rdLoad', 'rdClock', 'rdLocal',
            'modeSeg', 'targetSel', 'rdDist', 'rdEta', 'rdLag', 'rdFrame']) this.el[id] = $(id);

        this.buildLever();
        this.buildGauge();
        this.buildTiles();
        this.buildTargets();

        const e = this.el;
        e.modeSeg.addEventListener('click', ev => {
            const b = ev.target.closest('button');
            if (b) handlers.mode(b.dataset.helm);
        });
        e.targetSel.addEventListener('change', () => handlers.target(e.targetSel.value));
        e.thrustSeg.addEventListener('click', ev => {
            const b = ev.target.closest('button');
            if (b) handlers.thrust(parseFloat(b.dataset.g));
        });
        e.interlock.addEventListener('click', () => handlers.interlock());
        e.engageBtn.addEventListener('click', () => handlers.engage());
        e.stopBtn.addEventListener('click', () => handlers.stop());

        // Guarded switch: the first press lifts the cover, the second throws
        // the switch. The cover drops again once the field is safed.
        e.guard.addEventListener('click', () => {
            if (!e.guard.classList.contains('open')) { e.guard.classList.add('open'); return; }
            handlers.field();
        });
    },

    buildLever() {
        const e = this.el;
        const marks = [[0, 'STOP'], [1e-6, '300 m/s'], [1e-4, '30 km/s'], [1e-2, '0.01 c'], [1, 'c'], [1e2, '100 c'], [1e4, '10⁴ c'], [1e5, '10⁵ c']];
        e.leverScale.innerHTML = marks.map(([b, t]) =>
            `<span class="${b === 1 ? 'c' : ''}" style="top:${((1 - leverPos(b)) * 100).toFixed(2)}%">${t}</span>`).join('');
        const track = e.lever.querySelector('.lever-track');
        let dragging = false;
        const set = ev => {
            const r = track.getBoundingClientRect();
            const p = 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
            this.h.cruise(leverBeta(p));
        };
        track.addEventListener('pointerdown', ev => { dragging = true; track.setPointerCapture(ev.pointerId); set(ev); });
        track.addEventListener('pointermove', ev => { if (dragging) set(ev); });
        track.addEventListener('pointerup', () => { dragging = false; });
        track.addEventListener('pointercancel', () => { dragging = false; });
    },

    flashGate() {
        const g = this.el.leverGate;
        g.classList.remove('flash');
        void g.offsetWidth;
        g.classList.add('flash');
    },

    buildGauge() {
        // Mass equivalent, 10²⁰ to 10⁶⁶ kg, on a log scale.
        const ticks = [[PHYS.M_EARTH, 'Earth'], [PHYS.M_SUN, 'Sun'], [PHYS.M_GALAXY, 'Galaxy'], [PHYS.M_UNIVERSE, 'Universe']];
        this.el.gaugeTicks.innerHTML = ticks.map(([m, n]) =>
            `<span style="left:${(this.gaugePos(m) * 100).toFixed(1)}%">${n}</span>`).join('');
    },
    gaugePos(kg) {
        if (!(kg > 0)) return 0;
        return Math.max(0, Math.min(1, (Math.log10(kg) - 20) / 46));
    },

    buildTiles() {
        this.el.annun.innerHTML = TILES.map(([id, label, col]) =>
            `<div class="tile ${col}" data-tile="${id}">${label}</div>`).join('');
        for (const [id] of TILES) this.tiles[id] = this.el.annun.querySelector(`[data-tile="${id}"]`);
    },

    buildTargets() {
        const sel = this.el.targetSel;
        const near = space.stars.filter(s => s.target).sort((a, b) => a.ly - b.ly);
        const bodies = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
        sel.innerHTML =
            '<optgroup label="Solar system">' +
            bodies.map(id => `<option value="${id}">${space.byId[id].name}</option>`).join('') +
            '</optgroup><optgroup label="Stars">' +
            near.map(s => `<option value="${s.id}">${s.name} — ${s.ly < 100 ? s.ly.toFixed(1) : Math.round(s.ly)} ly</option>`).join('') +
            '</optgroup>';
    },

    // Rebuild the knob row for a family. Knobs are rotary, dragged
    // vertically; the value lives in main.js and is only displayed here.
    buildKnobs(family, params) {
        const defs = FAMILIES[family].params;
        this.knobDefs = defs;
        this.el.knobs.innerHTML = defs.map(d =>
            `<div class="knob-wrap" data-key="${d.key}">
                <div class="knob"><div class="ptr"></div></div>
                <div class="knob-lbl">${d.label}</div>
                <div class="knob-val">—</div>
            </div>`).join('');
        this.el.knobs.querySelectorAll('.knob-wrap').forEach(w => {
            const d = defs.find(x => x.key === w.dataset.key);
            const knob = w.querySelector('.knob');
            let drag = null;
            knob.addEventListener('pointerdown', ev => {
                drag = { y: ev.clientY, u: paramToUnit(d, this.h.getParam(d.key)) };
                knob.setPointerCapture(ev.pointerId);
            });
            knob.addEventListener('pointermove', ev => {
                if (!drag) return;
                const u = Math.max(0, Math.min(1, drag.u + (drag.y - ev.clientY) / 220));
                this.h.param(d.key, unitToParam(d, u));
            });
            const end = () => { drag = null; };
            knob.addEventListener('pointerup', end);
            knob.addEventListener('pointercancel', end);
        });
    },

    // ---- Readouts, ~10 Hz ----

    update(st) {
        const e = this.el, s = st.ship;
        const shell = s.isShell();
        const locked = s.helmLocked();

        // Helm.
        e.modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.helm === s.mode));
        if (e.targetSel.value !== s.target) e.targetSel.value = s.target;
        e.targetSel.disabled = locked;
        const g = s.targetGeom();
        e.rdDist.textContent = fmtDist(Math.max(0, g.dist - g.body.radius));
        e.rdEta.textContent = st.eta;
        e.rdLag.textContent = fmtTime(st.lagEarth);
        e.rdFrame.textContent = space.byId[s.anchor] ? space.byId[s.anchor].name : s.anchor;

        // Throttle.
        e.leverHandle.style.top = ((1 - leverPos(s.cruise)) * 100).toFixed(2) + '%';
        const gateB = shell ? 0.99 : st.vh;
        e.leverGate.style.top = ((1 - leverPos(gateB)) * 100).toFixed(2) + '%';
        e.leverGate.classList.toggle('hard', shell);
        e.leverGate.style.display = shell || s.interlock ? '' : 'none';
        e.lever.classList.toggle('locked', locked);
        e.rdBeta.textContent = fmtBeta(s.beta);
        e.rdBeta.classList.toggle('super', s.horizon());
        e.rdCruise.textContent = fmtBeta(s.cruise) + (s.effCruise() < s.cruise ? '  → ' + fmtBeta(s.effCruise()) : '');
        e.rdStatus.innerHTML = st.status;

        // Field / shell.
        e.conFieldTitle.textContent = shell ? 'Shell geometry' : 'Field geometry';
        e.conFamily.textContent = FAMILIES[st.family].name + ' · ' + FAMILIES[st.family].year;
        e.thrustRow.style.display = shell ? '' : 'none';
        e.thrustSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', parseFloat(b.dataset.g) === s.thrustG));
        if (this.knobDefs) {
            e.knobs.querySelectorAll('.knob-wrap').forEach(w => {
                const d = this.knobDefs.find(x => x.key === w.dataset.key);
                const v = st.params[d.key];
                const u = paramToUnit(d, v);
                w.querySelector('.ptr').style.transform = `rotate(${(-135 + 270 * u).toFixed(1)}deg)`;
                w.querySelector('.knob').classList.toggle('locked', locked);
                w.querySelector('.knob-val').textContent = fmtParam(d, v);
            });
        }

        // Energy.
        const en = st.energy;
        e.conEnergyTitle.textContent = shell ? 'Shell energy' : 'Exotic energy';
        e.gaugeFill.style.width = (this.gaugePos(Math.abs(en.kg)) * 100).toFixed(1) + '%';
        e.gaugeFill.classList.toggle('pos', en.kg > 0);
        setRd(e.rdEnergy, en.J === null ? '—' : fmtSci(en.J, 3) + ' J', en.J < 0 ? 'neg' : '');
        setRd(e.rdMass, en.J === null ? '—' : fmtMass(en.kg), en.kg < 0 ? 'neg' : 'ok');
        setRd(e.rdPeak, en.peak === null ? '—' : fmtSci(en.peak, 2) + ' J/m³', en.peak < 0 ? 'neg' : '');
        setRd(e.rdCasimir, en.casimir, en.casimirCls);
        setRd(e.rdQI, en.qi, en.qiCls);

        // Causality.
        const c = st.causal;
        setRd(e.rdHorizon, c.horizon, c.horizonCls);
        setRd(e.rdKappa, c.kappa, '');
        setRd(e.rdTH, c.TH, '');
        setRd(e.rdInstab, c.instab, c.instabCls);
        setRd(e.rdSwept, s.swept > 0 ? `${fmtSci(s.swept, 2)} p⁺ · ${fmtMass(s.swept * PHYS.m_p)}` : 'none', s.swept > 0 ? 'warn' : '');
        e.interlock.classList.toggle('bypass', !s.interlock);

        // Master.
        e.guard.classList.toggle('on', s.fieldOn);
        if (this.prevField && !s.fieldOn) e.guard.classList.remove('open');
        if (s.fieldOn) e.guard.classList.add('open');
        this.prevField = s.fieldOn;
        e.guardLbl.textContent = shell ? 'PROPULSION' : 'FIELD';
        e.engageBtn.disabled = s.mode !== 'auto' || !s.fieldOn || s.engaged || locked;
        e.stopBtn.disabled = locked;
        setRd(e.rdLoad, st.load, st.load !== '0.000 g' ? 'warn' : 'ok');
        setRd(e.rdClock, st.clock, '');
        setRd(e.rdLocal, shell ? fmtBeta(s.beta) : '0 — at rest in its own space', shell ? '' : 'ok');

        // Annunciator. New alarms flash for a few seconds.
        for (const [id] of TILES) {
            const on = !!st.tiles[id];
            const t = this.tiles[id];
            if (on && !this.tileState[id]) { t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); }
            t.classList.toggle('on', on);
            this.tileState[id] = on;
        }
        this.tiles.field.textContent = shell ? 'Propulsion armed' : 'Field energised';
    }
};

function setRd(el, text, cls) {
    if (el.textContent !== text) el.textContent = text;
    el.className = cls || '';
}

function paramToUnit(d, v) {
    if (d.log) return (Math.log10(Math.max(v, d.min)) - Math.log10(d.min)) / (Math.log10(d.max) - Math.log10(d.min));
    return (v - d.min) / (d.max - d.min);
}
function unitToParam(d, u) {
    if (d.log) return Math.pow(10, Math.log10(d.min) + u * (Math.log10(d.max) - Math.log10(d.min)));
    return d.min + u * (d.max - d.min);
}
function fmtParam(d, v) {
    if (d.unit === 'm') return fmtLen(v);
    if (d.unit === 'kg') return fmtMass(v);
    if (d.unit === 'c') return v.toFixed(3) + ' c';
    return fmtSci(v, 3);
}
