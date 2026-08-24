/* ============================================================
   main.js — wiring.

   Nothing self-boots. This file reads the panel into reactor.input,
   advances the physics, pushes the results back onto the gauges,
   evaluates the annunciators, and draws the trend strip.
   ============================================================ */
(function () {
  'use strict';

  const S = reactor.state;
  const IN = reactor.input;
  const CP = ControlPanel;

  /* ---------- panel -> simulation ---------------------------- */
  function readPanel() {
    for (let i = 0; i < 4; i++) IN.rodDemand[i] = CP.getValue('rod' + (i + 1)) ?? 0;
    IN.rodRate     = CP.getValue('rodRate') ?? 35;
    IN.rodAuto     = !!CP.getValue('rodAuto');
    IN.flowSlider  = CP.getValue('flowRate') ?? 100;
    IN.pumps[0]    = !!CP.getValue('pump1');
    IN.pumps[1]    = !!CP.getValue('pump2');
    IN.pumps[2]    = !!CP.getValue('pump3');
    IN.reliefValve = CP.getValue('reliefValve') ?? 0;
    IN.throttle    = CP.getValue('throttle') ?? 100;
    IN.mainBreaker = !!CP.getValue('mainBreaker');
    IN.genSync     = !!CP.getValue('genSync');
    IN.exciter     = !!CP.getValue('exciter');
    IN.mode        = CP.getValue('reactorMode') || 'RUN';
  }

  /* ---------- simulation -> panel ---------------------------- */
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);

  function writePanel() {
    CP.indicate('neutronFlux', S.power * 100);
    CP.indicate('pressure', S.pressure);
    CP.indicate('temp', S.coolTemp);
    CP.indicate('rpm', S.rpm);
    CP.indicate('load', S.loadMW);
    CP.indicate('radiation', S.radiation);

    for (let i = 0; i < 4; i++) CP.setBar('rod' + (i + 1), S.rodPos[i]);

    /* In auto, the controller owns the demand — move the knobs to match. */
    if (IN.rodAuto && !S.scram) {
      for (let i = 0; i < 4; i++) CP.indicate('rod' + (i + 1), S.rodDemand[i]);
    }

    CP.setText('txLoad', String(Math.round(S.loadMW)).padStart(4, '0') + ' MWe');
    CP.setText('txThermal', Math.round(S.thermalMW) + ' MWt');
    CP.setText('txFuelTemp', Math.round(S.fuelTemp) + ' °F');
    CP.setText('txTavg', Math.round(S.coolTemp) + ' °F');
    CP.setText('txSat', Math.round(S.satTemp) + ' °F');
    CP.setText('txSteam', Math.round(S.steamP) + ' psia');
    CP.setText('txFlow', Math.round(S.flowFrac * 100) + ' %');
    CP.setText('txVoid', f1(S.voidFrac * 100) + ' %');
    CP.setText('txXenon', f1(S.xeNorm * 100) + ' %');
    CP.setText('txRad', S.radiation < 10 ? f1(S.radiation) + ' mR/h'
                                         : Math.round(S.radiation) + ' mR/h');

    /* Reactivity in pcm and in dollars — control rooms use both. */
    const pcm = S.rho * 1e5;
    CP.setText('txRho', (pcm >= 0 ? '+' : '') + Math.round(pcm) + ' pcm');
    CP.setText('txDollars', (S.rho / reactor.K.BETA >= 0 ? '+' : '')
      + (S.rho / reactor.K.BETA).toFixed(2) + ' $');

    /* Period, and the startup rate every operator actually watches. */
    if (!isFinite(S.period) || Math.abs(S.period) > 999) {
      CP.setText('txPeriod', '∞ s');
      CP.setText('txDpm', '+0.00 DPM');
    } else {
      CP.setText('txPeriod', (S.period > 0 ? '+' : '') + Math.round(S.period) + ' s');
      CP.setText('txDpm', ((26.06 / S.period) >= 0 ? '+' : '') + (26.06 / S.period).toFixed(2) + ' DPM');
    }

    CP.setText('txTrip', S.scram ? S.tripReason : 'NONE');
    CP.indicate('scramActive', S.scram);
    const bulb = document.querySelector('[data-lamp="scramActive"]');
    if (bulb) bulb.classList.toggle('lit', S.scram);

    CP.indicate('comms', true);
    CP.indicate('aux', IN.pumps.some(Boolean));
  }

  /* ---------- annunciators ----------------------------------- */
  function evalAlarms() {
    CP.setAlarm('anHiFlux',   S.power > 1.05);
    CP.setAlarm('anPeriod',   S.period > 0 && S.period < 25);
    CP.setAlarm('anHiPress',  S.pressure > 2250);
    CP.setAlarm('anLoPress',  S.pressure < 1900);
    CP.setAlarm('anHiTemp',   S.coolTemp > 615);
    CP.setAlarm('anLoFlow',   S.flowFrac < 0.45);
    CP.setAlarm('anVoid',     S.voidFrac > 0.005);
    CP.setAlarm('anRad',      S.radiation > 5);
    CP.setAlarm('anTurbine',  S.turbineTripped);
    CP.setAlarm('anBreaker',  !S.synced);
    CP.setAlarm('anFuel',     S.fuelDamage > 0.001);
    CP.setAlarm('anPrompt',   S.promptCritical);
  }

  /* ---------- operator actions ------------------------------- */
  CP.on(({ id, value }) => {
    if (id === 'scramPressed') {
      reactor.scram('MANUAL SCRAM');
      CP.closeScramCover();
    }
    if (id === 'resetKey' && value === 'RUN') {
      if (S.fuelDamage > 0.02) {
        reactor.log('RESET INHIBITED — FUEL DAMAGE', 'trip');
      } else if (reactor.resetTrip()) {
        CP.ackAlarms();
      }
    }
    if (id === 'timeBase') reactor.setTimeBase(value);
    if (id === 'reactorMode') reactor.log('MODE — ' + value, 'info');
  });

  /* ---------- event log -------------------------------------- */
  const logEl = document.getElementById('event-log');
  /* Drain destructively. An index cursor would silently skip entries once
     reactor.events starts dropping its oldest to stay bounded. */
  function drainLog() {
    while (reactor.events.length) {
      const e = reactor.events.shift();
      if (!logEl) continue;
      const row = document.createElement('div');
      row.className = 'logrow ' + e.kind;
      const mm = String(Math.floor(e.t / 60)).padStart(2, '0');
      const ss = String(Math.floor(e.t % 60)).padStart(2, '0');
      row.textContent = `T+${mm}:${ss}  ${e.text}`;
      logEl.appendChild(row);
      while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  /* ---------- trend strip ------------------------------------ */
  const trend = document.getElementById('trend');
  const tctx = trend ? trend.getContext('2d') : null;
  const HIST = 240;
  const hist = { power: [], temp: [] };
  let sampleAcc = 0;
  let tw = 0, th = 0, tdpr = 1;

  function sizeTrend() {
    if (!trend) return;
    const r = trend.getBoundingClientRect();
    if (!r.width) return;
    tdpr = Math.min(window.devicePixelRatio || 1, 2);
    tw = r.width; th = r.height;
    trend.width = Math.round(tw * tdpr);
    trend.height = Math.round(th * tdpr);
    tctx.setTransform(tdpr, 0, 0, tdpr, 0, 0);
  }

  function drawTrend() {
    if (!tctx || !tw) return;
    tctx.clearRect(0, 0, tw, th);
    tctx.fillStyle = '#04170d';
    tctx.fillRect(0, 0, tw, th);

    tctx.strokeStyle = 'rgba(120,180,140,0.13)';
    tctx.lineWidth = 1;
    tctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = Math.round(th * i / 4) + 0.5;
      tctx.moveTo(0, y); tctx.lineTo(tw, y);
    }
    tctx.stroke();

    const n = hist.power.length;
    if (n > 1) {
      const dx = tw / (HIST - 1);
      const x0 = tw - (n - 1) * dx;

      /* power, 0-120% RTP, filled */
      tctx.beginPath();
      tctx.moveTo(x0, th);
      for (let i = 0; i < n; i++) {
        tctx.lineTo(x0 + i * dx, th - Math.min(1, hist.power[i] / 1.2) * th);
      }
      tctx.lineTo(x0 + (n - 1) * dx, th);
      tctx.closePath();
      tctx.fillStyle = 'rgba(255,171,26,0.16)';
      tctx.fill();

      tctx.beginPath();
      for (let i = 0; i < n; i++) {
        const y = th - Math.min(1, hist.power[i] / 1.2) * th;
        i ? tctx.lineTo(x0 + i * dx, y) : tctx.moveTo(x0 + i * dx, y);
      }
      tctx.strokeStyle = '#ffab1a';
      tctx.lineWidth = 1.4;
      tctx.stroke();

      /* coolant temperature, 400-700 degF */
      tctx.beginPath();
      for (let i = 0; i < n; i++) {
        const f = Math.max(0, Math.min(1, (hist.temp[i] - 400) / 300));
        const y = th - f * th;
        i ? tctx.lineTo(x0 + i * dx, y) : tctx.moveTo(x0 + i * dx, y);
      }
      tctx.strokeStyle = 'rgba(57,255,140,0.85)';
      tctx.lineWidth = 1.2;
      tctx.stroke();
    }

    tctx.font = '9px "Share Tech Mono", monospace';
    tctx.fillStyle = 'rgba(255,171,26,0.85)';
    tctx.fillText('FLUX', 6, 12);
    tctx.fillStyle = 'rgba(57,255,140,0.8)';
    tctx.fillText('T-AVG', 40, 12);
    tctx.fillStyle = 'rgba(180,200,185,0.45)';
    tctx.textAlign = 'right';
    tctx.fillText('120s', tw - 6, 12);
    tctx.textAlign = 'left';
  }

  /* ---------- loop ------------------------------------------- */
  let last = performance.now();

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    /* Normalise once, here, so no consumer downstream has to defend itself.
       The first frame can produce dt <= 0 because the rAF timestamp marks the
       frame's start and can predate the performance.now() captured while this
       script was still evaluating. */
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    else if (dt > 0.25) dt = 0.25;   // tab was hidden; do not fast-forward

    readPanel();
    reactor.update(dt);
    writePanel();
    evalAlarms();
    drainLog();
    CP.tick(dt);
    coreView.render(dt);

    sampleAcc += dt * S.timeBase;
    if (sampleAcc >= 0.5) {
      sampleAcc = 0;
      hist.power.push(S.power);
      hist.temp.push(S.coolTemp);
      if (hist.power.length > HIST) { hist.power.shift(); hist.temp.shift(); }
      drawTrend();
    }

    requestAnimationFrame(frame);
  }

  /* ---------- boot ------------------------------------------- */
  function init() {
    const cv = document.getElementById('coreview');
    coreView.init(cv);
    sizeTrend();
    window.addEventListener('resize', sizeTrend);

    /* Start at a settled 100%: seed the knobs from the model so the
       operator's demand matches where the rods actually are. */
    for (let i = 0; i < 4; i++) CP.setValue('rod' + (i + 1), S.rodPos[i]);
    readPanel();
    reactor.log('PLANT AT 100% — STEADY STATE', 'info');

    requestAnimationFrame(frame);
  }

  init();
})();
