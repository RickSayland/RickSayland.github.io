/* ============================================================
   panel.js — the hardware layer.

   Knobs, toggles, sliders, gauges, bargraphs, annunciators, the
   mode and key switches, and the SCRAM assembly. Every control
   writes to `state` and dispatches a 'panelchange' CustomEvent,
   so the panel stays usable on its own with nothing wired to it.

   Two ways to push a value back INTO a control:
     ControlPanel.setValue(id, v)  - update visuals AND emit
     ControlPanel.indicate(id, v)  - update visuals only
   The simulation uses indicate(), 60 times a second, so it does
   not flood the event bus with its own instrument readings.
   ============================================================ */
const ControlPanel = (function () {
  'use strict';

  const state = {};
  const updaters = {};          // id -> fn(value): push a value into a control's visuals
  const gauges = {};            // id -> gauge record (needles are damped, not snapped)
  const bars = {};              // id -> fn(percent)
  const texts = {};             // id -> element
  const annun = {};             // id -> annunciator record

  function emit(id, value) {
    state[id] = value;
    document.dispatchEvent(new CustomEvent('panelchange', { detail: { id, value, state } }));
  }

  const api = {
    state,
    on(cb) { document.addEventListener('panelchange', e => cb(e.detail)); },
    setValue(id, value) { emit(id, value); if (updaters[id]) updaters[id](value); },
    indicate(id, value) { state[id] = value; if (updaters[id]) updaters[id](value); },
    getValue(id) { return state[id]; },
    setBar(id, pct) { if (bars[id]) bars[id](pct); },
    setText(id, str) { const e = texts[id]; if (e && e.textContent !== str) e.textContent = str; },
    setAlarm, ackAlarms, tick,
  };

  /* ================= CLOCK ================= */
  function tickClock() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const el = document.getElementById('clock');
    if (el) el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  tickClock(); setInterval(tickClock, 1000);

  /* ================= LAMPS ================= */
  document.querySelectorAll('.lamp').forEach(l => {
    const id = l.dataset.lamp;
    state[id] = l.classList.contains('on');
    updaters[id] = v => l.classList.toggle('on', !!v);
  });

  /* ================= TOGGLES ================= */
  document.querySelectorAll('[data-toggle]').forEach(t => {
    const id = t.dataset.toggle;
    const wrap = t.closest('.toggle-wrap');
    const setOn = v => {
      t.classList.toggle('on', v);
      if (wrap) wrap.classList.toggle('on', v);
    };
    state[id] = t.classList.contains('on');
    setOn(state[id]);
    updaters[id] = v => setOn(!!v);
    t.addEventListener('click', () => {
      const v = !state[id];
      setOn(v);
      emit(id, v);
    });
  });

  /* ================= BARGRAPHS =================
     Decoupled from the knobs: a bargraph shows measured rod
     POSITION, while the knob above it shows the operator's
     DEMAND. On a scram they visibly disagree. */
  document.querySelectorAll('[data-bar]').forEach(bar => {
    const id = bar.dataset.bar;
    const segs = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
      const s = document.createElement('div');
      s.className = 'seg';
      bar.appendChild(s);
      segs.push(s);
    }
    let last = -1;
    bars[id] = pct => {
      const lit = Math.round(Math.max(0, Math.min(100, pct)) / 100 * N);
      if (lit === last) return;
      last = lit;
      for (let i = 0; i < N; i++) {
        segs[i].className = 'seg' + (i < lit ? ' lit' : '') + (i < lit && i >= 8 ? ' top' : '');
      }
    };
    bars[id](0);
  });

  /* ================= TEXT READOUTS ================= */
  document.querySelectorAll('[data-text]').forEach(el => { texts[el.dataset.text] = el; });

  /* ================= KNOBS ================= */
  document.querySelectorAll('[data-knob]').forEach(k => {
    const id = k.dataset.knob;
    const min = parseFloat(k.dataset.min ?? 0);
    const max = parseFloat(k.dataset.max ?? 100);
    const detents = parseInt(k.dataset.detents || '0', 10);
    const pointer = k.querySelector('.pointer');
    const readout = document.querySelector(`[data-readout="${id}"]`);
    const SWEEP = 270;   // degrees, -135 to +135

    function valueToAngle(v) { return -SWEEP / 2 + (v - min) / (max - min) * SWEEP; }
    function snap(v) {
      if (detents > 0) {
        const step = (max - min) / (detents - 1);
        return Math.round((v - min) / step) * step + min;
      }
      return v;
    }
    function renderReadout(v) {
      if (!readout) return;
      if (id === 'reliefValve') {
        const labels = ['CLOSED', '25%', '50%', '75%', 'OPEN'];
        readout.textContent = labels[Math.round((v - min) / (max - min) * (labels.length - 1))];
      } else {
        readout.textContent = Math.round(v) + '%';
      }
    }
    function setValue(v, fromUser) {
      v = snap(Math.max(min, Math.min(max, v)));
      pointer.style.transform = `translateX(-50%) rotate(${valueToAngle(v)}deg)`;
      renderReadout(v);
      state[id] = v;
      if (fromUser) emit(id, v);
    }

    const start = parseFloat(k.dataset.start ?? min);
    setValue(start, false);
    updaters[id] = v => setValue(v, false);

    let dragging = false, startY = 0, startVal = 0;
    k.addEventListener('pointerdown', e => {
      dragging = true; startY = e.clientY; startVal = state[id] ?? start;
      k.setPointerCapture(e.pointerId);
      k.style.cursor = 'grabbing';
    });
    k.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dy = startY - e.clientY;          // up = increase
      setValue(startVal + (dy / 140) * (max - min), true);
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      k.style.cursor = 'grab';
    }
    k.addEventListener('pointerup', endDrag);
    k.addEventListener('pointercancel', endDrag);
    k.addEventListener('wheel', e => {
      e.preventDefault();
      setValue((state[id] ?? start) - Math.sign(e.deltaY) * (max - min) / 50, true);
    }, { passive: false });
  });

  /* ================= SLIDERS ================= */
  document.querySelectorAll('[data-slider]').forEach(s => {
    const id = s.dataset.slider;
    const readout = document.querySelector(`[data-readout="${id}"]`);
    const render = v => { if (readout) readout.textContent = Math.round(v) + '%'; };
    state[id] = parseFloat(s.value);
    render(s.value);
    updaters[id] = v => { s.value = v; render(v); state[id] = parseFloat(v); };
    s.addEventListener('input', () => { render(s.value); emit(id, parseFloat(s.value)); });
  });

  /* ================= GAUGES (SVG) =================
     Needles are damped toward their target rather than snapped,
     which is both what a real d'Arsonval movement does and what
     keeps a 60 Hz simulation from looking like a seizure. */
  function buildGauge(container) {
    const id = container.dataset.gauge;
    const min = parseFloat(container.dataset.min);
    const max = parseFloat(container.dataset.max);
    const unit = container.dataset.unit || '';
    const label = container.dataset.label || id;
    const redline = container.dataset.redline ? parseFloat(container.dataset.redline) : null;
    const log = container.dataset.scale === 'log';
    const START = -120, END = 120, SWEEP = END - START;

    const cx = 75, cy = 78, r = 60;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 150 150');

    const polar = (deg, radius) => {
      const a = (deg - 90) * Math.PI / 180;
      return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
    };
    /* fraction of full sweep for a value */
    const frac = v => {
      if (!log) return (v - min) / (max - min);
      const lo = Math.log10(Math.max(min, 1e-6)), hi = Math.log10(max);
      return (Math.log10(Math.max(v, Math.pow(10, lo))) - lo) / (hi - lo);
    };

    const TICKS = 8;
    for (let i = 0; i <= TICKS; i++) {
      const f = i / TICKS;
      const val = log
        ? Math.pow(10, Math.log10(Math.max(min, 1e-6)) + f * (Math.log10(max) - Math.log10(Math.max(min, 1e-6))))
        : min + (max - min) * f;
      const angle = START + SWEEP * f;
      const [x1, y1] = polar(angle, r);
      const [x2, y2] = polar(angle, r - 9);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('class', 'tick' + (redline !== null && val >= redline ? ' red' : ''));
      svg.appendChild(line);
      if (i % 2 === 0) {
        const [tx, ty] = polar(angle, r - 20);
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', tx); t.setAttribute('y', ty + 3);
        t.setAttribute('class', 'ticklabel');
        t.textContent = log
          ? (val >= 1 ? Math.round(val) : val.toPrecision(1))
          : Math.round(val);
        svg.appendChild(t);
      }
    }

    /* redline arc on the face */
    if (redline !== null) {
      const a0 = START + SWEEP * frac(redline), a1 = END;
      const [sx, sy] = polar(a0, r - 4), [ex, ey] = polar(a1, r - 4);
      const arc = document.createElementNS(NS, 'path');
      arc.setAttribute('d', `M ${sx} ${sy} A ${r - 4} ${r - 4} 0 0 1 ${ex} ${ey}`);
      arc.setAttribute('class', 'redarc');
      svg.appendChild(arc);
    }

    const mk = (y, cls, txt) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', cx); t.setAttribute('y', y);
      t.setAttribute('class', cls); t.textContent = txt;
      svg.appendChild(t);
    };
    mk(cy + 34, 'facelabel', label);
    mk(cy + 46, 'unit', unit);

    const needle = document.createElementNS(NS, 'line');
    needle.setAttribute('class', 'needle');
    needle.setAttribute('x1', cx); needle.setAttribute('y1', cy);
    const [nx, ny] = polar(START, r - 14);
    needle.setAttribute('x2', nx); needle.setAttribute('y2', ny);
    svg.appendChild(needle);

    const hub = document.createElementNS(NS, 'circle');
    hub.setAttribute('cx', cx); hub.setAttribute('cy', cy); hub.setAttribute('r', 5);
    hub.setAttribute('class', 'hub');
    svg.appendChild(hub);

    container.appendChild(svg);

    const rec = {
      target: parseFloat(container.dataset.start ?? min),
      shown: parseFloat(container.dataset.start ?? min),
      pegged: false,
      apply(v) {
        const clamped = Math.max(min, Math.min(max, v));
        const angle = START + SWEEP * Math.max(0, Math.min(1, frac(clamped)));
        needle.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
        const peg = v > max * 0.999;
        if (peg !== rec.pegged) { rec.pegged = peg; container.classList.toggle('pegged', peg); }
      },
    };
    rec.apply(rec.shown);
    gauges[id] = rec;
    state[id] = rec.target;
    updaters[id] = v => { rec.target = v; };
  }
  document.querySelectorAll('.gauge').forEach(buildGauge);

  /* Needle damping + anything else that wants a frame tick. */
  function tick(dt) {
    /* A NaN dt here is unrecoverable: the damping term writes NaN into a
       needle's position and it stays there for the life of the page. */
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    const k = Math.min(1, dt * 9);
    for (const id in gauges) {
      const g = gauges[id];
      if (Math.abs(g.target - g.shown) < 1e-4) continue;
      g.shown += (g.target - g.shown) * k;
      g.apply(g.shown);
    }
    /* annunciator flash */
    flashPhase = (flashPhase + dt) % 1;
    const on = flashPhase < 0.5;
    if (on !== flashOn) {
      flashOn = on;
      for (const id in annun) {
        const a = annun[id];
        if (a.active && !a.acked) a.el.classList.toggle('flash', on);
      }
    }
  }
  let flashPhase = 0, flashOn = false;

  /* ================= ANNUNCIATORS =================
     Real annunciator logic: a new alarm flashes until it is
     acknowledged, then burns steady until the condition clears. */
  document.querySelectorAll('[data-annun]').forEach(el => {
    annun[el.dataset.annun] = { el, active: false, acked: false };
  });

  function setAlarm(id, active) {
    const a = annun[id];
    if (!a || a.active === active) return;
    a.active = active;
    if (active) {
      a.acked = false;
      a.el.classList.add('active');
      document.dispatchEvent(new CustomEvent('panelalarm', { detail: { id } }));
    } else {
      a.acked = false;
      a.el.classList.remove('active', 'flash', 'acked');
    }
    refreshAlarmSummary();
  }

  function ackAlarms() {
    for (const id in annun) {
      const a = annun[id];
      if (a.active && !a.acked) { a.acked = true; a.el.classList.remove('flash'); a.el.classList.add('acked'); }
    }
  }

  function refreshAlarmSummary() {
    let any = false;
    for (const id in annun) if (annun[id].active) { any = true; break; }
    api.indicate('alarm', any);
  }

  const ackBtn = document.querySelector('[data-ack]');
  if (ackBtn) ackBtn.addEventListener('click', ackAlarms);

  /* ================= MODE ROTARY SWITCH ================= */
  document.querySelectorAll('[data-mode]').forEach(m => {
    const id = m.dataset.mode;
    const positions = m.dataset.positions.split(',');
    const dial = m.querySelector('.dial');
    const needle = m.querySelector('.needle');
    const labelsWrap = m.querySelector('.labels');
    const spread = 140;
    positions.forEach((name, i) => {
      const span = document.createElement('span');
      span.textContent = name;
      const angle = -spread / 2 + (spread / (positions.length - 1)) * i;
      const rad = (angle - 90) * Math.PI / 180;
      const radius = 78;
      span.style.left = `calc(50% + ${radius * Math.cos(rad)}px - 30px)`;
      span.style.top = `calc(50% + ${radius * Math.sin(rad)}px - 6px)`;
      labelsWrap.appendChild(span);
    });
    let idx = positions.indexOf(m.dataset.start || positions[0]);
    if (idx < 0) idx = 0;
    function render() {
      const angle = -spread / 2 + (spread / (positions.length - 1)) * idx;
      needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;
      [...labelsWrap.children].forEach((s, i) => s.classList.toggle('active', i === idx));
    }
    render();
    state[id] = positions[idx];
    updaters[id] = v => { const i = positions.indexOf(v); if (i >= 0) { idx = i; render(); } };
    dial.addEventListener('click', () => {
      idx = (idx + 1) % positions.length;
      render();
      emit(id, positions[idx]);
    });
  });

  /* ================= KEY SWITCH ================= */
  document.querySelectorAll('[data-key]').forEach(k => {
    const id = k.dataset.key;
    const positions = k.dataset.positions.split(',');
    const svg = k.querySelector('svg');
    let idx = 0;
    const render = () => { svg.style.transform = `rotate(${idx * 70}deg)`; };
    render();
    state[id] = positions[idx];
    updaters[id] = v => { const i = positions.indexOf(v); if (i >= 0) { idx = i; render(); } };
    k.querySelector('.hole').addEventListener('click', () => {
      idx = (idx + 1) % positions.length;
      render();
      emit(id, positions[idx]);
    });
  });

  /* ================= SCRAM ================= */
  const scramCover = document.querySelector('[data-scram-cover]');
  const scramBtn = document.querySelector('[data-scram-btn]');
  if (scramCover && scramBtn) {
    scramCover.addEventListener('click', () => scramCover.classList.toggle('open'));
    scramBtn.addEventListener('click', () => {
      if (!scramCover.classList.contains('open')) return;
      emit('scramPressed', Date.now());
    });
  }
  api.closeScramCover = () => scramCover && scramCover.classList.remove('open');

  /* ================= TIME BASE ================= */
  document.querySelectorAll('[data-timebase]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-timebase]').forEach(o => o.classList.remove('sel'));
      b.classList.add('sel');
      emit('timeBase', parseFloat(b.dataset.timebase));
    });
  });
  state.timeBase = 1;

  return api;
})();

window.ControlPanel = ControlPanel;
