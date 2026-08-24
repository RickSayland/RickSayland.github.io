/* ============================================================
   reactor.js — the physics.

   A lumped-parameter PWR: point kinetics under the prompt-jump
   approximation, one delayed-precursor group, Doppler / moderator /
   void / xenon feedback, a two-node thermal model (fuel -> coolant),
   a steam generator + turbine secondary, and a reactor protection
   system that trips on its own.

   No DOM in here. `reactor.state` is read by main.js and pushed at
   the panel; nothing in this file knows a gauge exists.
   ============================================================ */
const reactor = (function () {
  'use strict';

  /* ---------- TUNING ----------------------------------------
     Everything the model's behaviour hangs on. The values are
     picked so that a 4-loop-ish 3000 MWt plant sits at a steady
     100% with rods near 70% withdrawn; see EQUILIBRIUM below. */
  const K = {
    /* neutronics */
    BETA:    0.0065,     // delayed neutron fraction
    LAMBDA:  0.0767,     // effective precursor decay constant, 1/s
    SOURCE:  1.5e-9,     // startup source (keeps a shut reactor off zero)
    RHO_CLAMP: 0.985,    // fraction of BETA we refuse to exceed, numerically

    ROD_WORTH: 0.090,    // total Delta-k of all four banks, fully in -> fully out
    RHO_BASE: 0,         // solved below so the design point is exactly critical
    DESIGN_ROD: 0.70,    // rod position the plant is trimmed to at 100%

    ALPHA_F:  1.20e-5,   // Doppler, Delta-k per degF of fuel
    MOD_WORTH: 0.062,    // total moderator defect, cold -> 700 degF
    MOD_TOP: 700,        // temperature the moderator curve is scaled against
    VOID_COEF: 0.150,    // Delta-k per unit void fraction
    XE_WORTH:  0.026,    // Delta-k at equilibrium full-power xenon
    T_REF: 70,           // cold reference temperature, degF

    /* xenon-135 / iodine-135 */
    GAMMA_I: 0.0639, GAMMA_X: 0.00237,
    LAM_I: 2.87e-5,  LAM_X: 2.09e-5,   // 6.6 h and 9.2 h half lives
    SIG_PHI: 1.2e-4,                   // xenon burnout rate at 100% power, 1/s

    /* decay heat: two exponential groups, ~7% of rated at trip */
    DK1_FRAC: 0.045, DK1_TAU: 25,
    DK2_FRAC: 0.025, DK2_TAU: 1200,

    /* thermal */
    RATED_TH: 3000,   // MWt at 100% RTP
    FUEL_C:   24.6,   // MW*s/degF   -> 5 s fuel time constant
    H_FC:      4.92,  // MW/degF fuel -> coolant  (610 degF gap at full power)
    COOL_C:  400,     // MW*s/degF
    SG_UA:    66.7,   // MW/degF primary -> steam, at 100% flow

    /* pressurizer. Coolant expansion moves pressure directly; heaters and
       spray pull it back to the setpoint but only so fast, so a quick
       transient outruns them — which is exactly when the trips fire. */
    P_NOM: 2250,
    PRESS_PER_DEG: 14,    // psi of swell per degF of coolant
    PZR_GAIN: 0.5,        // 1/s, control authority toward the setpoint
    HEATER_MAX: 10,       // psi/s the heaters can add
    SPRAY_MAX: 45,        // psi/s the spray can remove
    RELIEF_RATE: 90,      // psi/s with the relief valve wide open
    VOID_PRESS: 600,      // psi/s of spike per unit void

    /* secondary */
    SG_CAP: 100,          // MW*s/psi
    STEAM_NOM: 1000,      // psia at full load
    DUMP_SET: 1075,       // steam dump to the condenser starts opening here
    DUMP_BAND: 70,        // psi from cracked to wide open
    DUMP_CAP: 0.40,       // fraction of rated the dump valves can absorb
    TURB_EFF: 0.33,
    STEAM_RELIEF: 1185,   // secondary safety valves lift here
    SYNC_RPM: 3600,
    OVERSPEED: 3960,
    SHAFT_ACCEL: 0.50,    // rpm/s per MW of unopposed shaft power
    SHAFT_DRAG: 0.03,     // 1/s windage — a ~33 s unloaded coastdown

    /* Rod drive. Deliberately slow: differential worth near the core
       midplane runs about 140 pcm per 1% of travel, so even 1.5 %/s is
       200 pcm/s — an operator holding the knob at full rate can still
       drive the core prompt critical, which is the point. */
    ROD_RATE_MIN: 0.05,   // %/s at rate knob 0
    ROD_RATE_MAX: 1.50,   // %/s at rate knob 100
    AUTO_RATE: 0.5,       // auto control uses half the selected drive rate
    SCRAM_RATE: 45,       // %/s free-fall on a trip

    /* damage */
    CLAD_FAIL: 2200,      // degF fuel temp where fission products escape
    MELT: 4900,
  };

  /* Saturation temperature of water, degF, for pressure in psia.
     115.1*P^0.225 is within a degree or two from 15 to 2500 psia. */
  function tsat(psia) { return 115.1 * Math.pow(Math.max(psia, 1), 0.225); }

  /* Integral control rod worth. The classic S-curve: a bank is worth
     little at either extreme and most near the core midplane. */
  function rodWorth(fracOut) {
    const x = Math.max(0, Math.min(1, fracOut));
    return K.ROD_WORTH * (x - Math.sin(2 * Math.PI * x) / (2 * Math.PI));
  }

  /* Moderator feedback. Deliberately NOT a constant coefficient: it
     tracks water density, which barely moves when the coolant is cold
     and falls off a cliff near saturation. A single linear alpha strong
     enough to be right at 590 degF would make the cold core supercritical
     with every rod inserted, which is the wrong answer for the startup
     case. The cubic gives roughly -20 pcm/degF hot and ~0 cold. */
  function modReactivity(coolT) {
    const x = Math.max(0, (coolT - K.T_REF) / (K.MOD_TOP - K.T_REF));
    return -K.MOD_WORTH * x * x * x;
  }

  /* Equilibrium xenon inventory at 100% power, used to normalise. */
  const I_EQ = K.GAMMA_I / K.LAM_I;
  const X_EQ = (K.GAMMA_X + K.LAM_I * I_EQ) / (K.LAM_X + K.SIG_PHI);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- DESIGN POINT ----------------------------------
     Rather than hand-tuning constants until the plant happens to
     sit still, solve the 100% steady state from the constants and
     then pick RHO_BASE so that state is exactly critical. Change a
     heat-transfer number and the trim follows it automatically. */
  K.TURB_K = K.RATED_TH / K.STEAM_NOM;        // MW drawn per psi at full throttle

  const DESIGN = {
    power: 1,
    steamP: K.STEAM_NOM,
    steamT: tsat(K.STEAM_NOM),
  };
  DESIGN.coolT = DESIGN.steamT + K.RATED_TH / K.SG_UA;   // SG removes rated power
  DESIGN.fuelT = DESIGN.coolT + K.RATED_TH / K.H_FC;     // fuel-to-coolant gap
  K.RHO_BASE = -(
    rodWorth(K.DESIGN_ROD)
    - K.ALPHA_F * (DESIGN.fuelT - K.T_REF)
    + modReactivity(DESIGN.coolT)
    - K.XE_WORTH
  );

  /* ---------- STATE ---------------------------------------- */
  const state = {
    /* neutronics */
    power: 1,          // fraction of rated thermal power (neutron flux)
    precursor: 1,      // normalised delayed-neutron precursors
    rho: 0,            // total reactivity, Delta-k
    rhoParts: { rods: 0, doppler: 0, moderator: 0, void: 0, xenon: 0 },
    period: Infinity,  // reactor period, s
    powerRate: 0,      // smoothed dP/dt, fraction of rated per second
    relRate: 0,        // powerRate / power, i.e. d ln P / dt
    promptCritical: false,

    /* poisons */
    iodine: I_EQ,
    xenon: X_EQ,
    xeNorm: 1,

    /* decay heat */
    dk1: K.DK1_FRAC, dk2: K.DK2_FRAC,
    thermalMW: K.RATED_TH,

    /* thermal-hydraulic */
    fuelTemp: DESIGN.fuelT,
    coolTemp: DESIGN.coolT,
    pressure: K.P_NOM,
    voidFrac: 0,
    flowFrac: 1,
    satTemp: tsat(K.P_NOM),

    /* secondary */
    steamP: DESIGN.steamP,
    steamTemp: DESIGN.steamT,
    sgMW: K.RATED_TH,
    dumpFrac: 0,
    rpm: K.SYNC_RPM,
    loadMW: K.RATED_TH * K.TURB_EFF,
    synced: true,
    turbineTripped: false,

    /* rods: commanded (knobs) vs actual position, % withdrawn */
    rodDemand: [70, 70, 70, 70].map(() => K.DESIGN_ROD * 100),
    rodPos: [70, 70, 70, 70].map(() => K.DESIGN_ROD * 100),
    rodAvg: K.DESIGN_ROD * 100,

    /* protection */
    scram: false,
    tripReason: '',
    fuelDamage: 0,
    radiation: 0.02,   // mR/hr at the core instrument

    /* bookkeeping */
    simTime: 0,
    timeBase: 1,
  };

  /* Inputs main.js copies off the panel each frame. */
  const input = {
    rodDemand: [70, 70, 70, 70].map(() => K.DESIGN_ROD * 100),
    rodRate: 35,
    rodAuto: false,
    flowSlider: 100,
    pumps: [true, true, true],
    reliefValve: 0,
    throttle: 100,
    mainBreaker: true,
    genSync: true,
    exciter: true,
    mode: 'RUN',
  };

  const events = [];   // {t, text, kind} — drained by main.js into the log
  function log(text, kind) {
    events.push({ t: state.simTime, text, kind: kind || 'info' });
    if (events.length > 40) events.shift();
  }

  /* ---------- PROTECTION ----------------------------------- */
  function trip(reason) {
    if (state.scram) return;
    state.scram = true;
    state.tripReason = reason;
    log('REACTOR TRIP — ' + reason, 'trip');
    /* A reactor trip trips the turbine with it. Left open, the throttle
       keeps drawing rated steam off a core making 7% decay heat and
       drags the primary through a violent cooldown. */
    if (!state.turbineTripped) {
      state.turbineTripped = true;
      log('TURBINE TRIP — REACTOR TRIP', 'trip');
    }
  }

  function checkTrips() {
    if (state.scram) return;
    if (state.power > 1.18)                      trip('HIGH NEUTRON FLUX');
    /* short period == relative rate above 1/5 per second; tested on the
       rate rather than the period so it cannot fire on a 1/x artifact */
    else if (state.power > 1e-3 && state.relRate > 0.20) trip('SHORT PERIOD');
    else if (state.pressure > 2385)              trip('HIGH RCS PRESSURE');
    else if (state.pressure < 1750 && state.power > 0.10) trip('LOW RCS PRESSURE');
    else if (state.coolTemp > 650)               trip('HIGH CORE TEMP');
    else if (state.flowFrac < 0.30 && state.power > 0.15) trip('LOW COOLANT FLOW');
    else if (state.turbineTripped && state.power > 0.50)  trip('TURBINE TRIP');
  }

  /* ---------- ROD DRIVE ------------------------------------ */
  function rodSpeed() {
    return state.scram
      ? K.SCRAM_RATE
      : K.ROD_RATE_MIN + (input.rodRate / 100) * (K.ROD_RATE_MAX - K.ROD_RATE_MIN);
  }

  function driveRods(dt, speed) {
    for (let i = 0; i < 4; i++) {
      /* A trip, or the mode switch at OFF, overrides the operator. */
      let want = state.rodDemand[i];
      if (state.scram || input.mode === 'OFF') want = 0;

      const d = want - state.rodPos[i];
      const step = speed * dt;
      state.rodPos[i] = Math.abs(d) <= step ? want : state.rodPos[i] + Math.sign(d) * step;
      state.rodPos[i] = clamp(state.rodPos[i], 0, 100);
    }
    state.rodAvg = (state.rodPos[0] + state.rodPos[1] + state.rodPos[2] + state.rodPos[3]) / 4;
  }

  /* Automatic rod control: hold power at the turbine's demand.
     A real plant runs reactor-follows-turbine, so throttle sets the target. */
  function autoRods(dt, speed) {
    if (!input.rodAuto || state.scram || input.mode === 'OFF') {
      for (let i = 0; i < 4; i++) state.rodDemand[i] = input.rodDemand[i];
      return;
    }
    const target = clamp(input.throttle / 100, 0.02, 1.0);
    const err = target - state.power;

    /* PD, not P. The core answers a rod movement over tens of seconds,
       so proportional-only control walks the rods far past where they
       needed to be, then chases the overshoot back the other way — which
       is how this landed a short-period trip the first time round. The
       derivative term makes it stop pulling once power is already moving,
       and its gain is what caps the ramp: the loop stalls the rods once
       dP/dt reaches roughly GAIN/DAMP, here about 5% of rated per second,
       which keeps the period well clear of the 5 s trip. */
    const cmd = err * 3.0 - state.powerRate * 60.0;
    if (Math.abs(err) > 0.004 || Math.abs(state.powerRate) > 0.002) {
      const move = clamp(cmd, -1, 1) * speed * K.AUTO_RATE * dt;
      for (let i = 0; i < 4; i++) {
        state.rodDemand[i] = clamp(state.rodDemand[i] + move, 0, 100);
      }
    }
  }

  /* ---------- ONE PHYSICS SUB-STEP ------------------------- */
  function step(dt) {
    state.simTime += dt;

    const speed = rodSpeed();
    autoRods(dt, speed);
    driveRods(dt, speed);

    /* --- coolant flow from the pumps and the flow control valve --- */
    const pumpCount = input.pumps.reduce((n, p) => n + (p ? 1 : 0), 0);
    const forced = (pumpCount / 3) * (input.flowSlider / 100);
    /* natural circulation still moves some heat with every pump off */
    state.flowFrac = Math.max(forced, 0.04);

    /* --- reactivity ------------------------------------------- */
    const rp = state.rhoParts;
    rp.rods      = rodWorth(state.rodAvg / 100);
    rp.doppler   = -K.ALPHA_F * (state.fuelTemp - K.T_REF);
    rp.moderator = modReactivity(state.coolTemp);
    rp.void      = -K.VOID_COEF * state.voidFrac;
    rp.xenon     = -K.XE_WORTH * state.xeNorm;

    let rho = K.RHO_BASE + rp.rods + rp.doppler + rp.moderator + rp.void + rp.xenon;
    state.promptCritical = rho >= K.BETA;
    rho = Math.min(rho, K.BETA * K.RHO_CLAMP);
    state.rho = rho;

    /* --- point kinetics, prompt-jump approximation -------------
       Prompt neutrons are assumed to equilibrate instantly, which
       removes the 1e-4 s generation time from the integration and
       lets us run at 50 ms steps. The precursors carry the dynamics:
         P = (c*BETA + S) / (BETA - rho)
         dc/dt = LAMBDA * (P - c)
       so a rod movement produces the characteristic step-then-ramp. */
    const prev = state.power;
    state.power = (state.precursor * K.BETA + K.SOURCE) / (K.BETA - rho);
    state.power = clamp(state.power, 0, 60);
    state.precursor += K.LAMBDA * (state.power - state.precursor) * dt;
    state.precursor = Math.max(state.precursor, 0);

    /* smoothed dP/dt, in fraction of rated per second — the auto rod
       controller's derivative term and the period both come off this */
    state.powerRate += ((state.power - prev) / dt - state.powerRate) * Math.min(1, dt * 3);

    /* Reactor period = 1 / (d ln P / dt), derived from the already-smoothed
       rate. Do NOT smooth the period itself: it is 1/x, so as a settling
       plant's rate crosses zero the period jumps between large negative and
       large positive values, and interpolating between them sweeps through
       the small positive numbers — which trips SHORT PERIOD on a reactor
       that is sitting perfectly still. Smooth the rate, invert afterwards. */
    state.relRate = state.powerRate / Math.max(state.power, 1e-9);
    state.period = Math.abs(state.relRate) < 1e-6 ? Infinity : 1 / state.relRate;

    /* --- xenon / iodine ---------------------------------------- */
    const P = state.power;
    state.iodine += (K.GAMMA_I * P - K.LAM_I * state.iodine) * dt;
    state.xenon += (K.GAMMA_X * P + K.LAM_I * state.iodine
                    - K.LAM_X * state.xenon - K.SIG_PHI * P * state.xenon) * dt;
    state.iodine = Math.max(state.iodine, 0);
    state.xenon = Math.max(state.xenon, 0);
    state.xeNorm = state.xenon / X_EQ;

    /* --- decay heat -------------------------------------------- */
    state.dk1 += (K.DK1_FRAC * P - state.dk1) / K.DK1_TAU * dt;
    state.dk2 += (K.DK2_FRAC * P - state.dk2) / K.DK2_TAU * dt;
    const qth = (0.93 * P + state.dk1 + state.dk2) * K.RATED_TH;
    state.thermalMW = qth;

    /* --- fuel and coolant nodes -------------------------------- */
    /* Voids wreck the fuel-to-coolant heat transfer, which is what
       makes a boiling core run away rather than self-correct. */
    const hfc = K.H_FC * (1 - 0.75 * state.voidFrac);
    const fuelToCool = hfc * (state.fuelTemp - state.coolTemp);
    state.fuelTemp += (qth - fuelToCool) / K.FUEL_C * dt;

    state.steamTemp = tsat(state.steamP);
    state.sgMW = K.SG_UA * state.flowFrac * (state.coolTemp - state.steamTemp);

    const coolPrev = state.coolTemp;
    state.coolTemp += (fuelToCool - state.sgMW) / K.COOL_C * dt;

    state.fuelTemp = clamp(state.fuelTemp, K.T_REF, 6000);
    state.coolTemp = clamp(state.coolTemp, K.T_REF, 1200);

    /* --- primary pressure -------------------------------------- */
    /* swell/shrink from the coolant expanding, which the pressurizer
       control can only partly chase */
    state.pressure += (state.coolTemp - coolPrev) * K.PRESS_PER_DEG;
    state.pressure += clamp((K.P_NOM - state.pressure) * K.PZR_GAIN,
                            -K.SPRAY_MAX, K.HEATER_MAX) * dt;
    state.pressure += state.voidFrac * K.VOID_PRESS * dt;
    state.pressure -= (input.reliefValve / 100) * K.RELIEF_RATE * dt;
    state.pressure = clamp(state.pressure, 14.7, 3200);

    /* --- boiling ------------------------------------------------ */
    state.satTemp = tsat(state.pressure);
    /* Void takes time to develop and time to collapse — snapping it to an
       algebraic function of superheat makes the reactivity jump. */
    const voidTarget = clamp((state.coolTemp - state.satTemp) / 25, 0, 1);
    state.voidFrac += (voidTarget - state.voidFrac) * Math.min(1, dt * 0.6);
    /* Once it is boiling the bulk coolant is pinned near saturation: the
       extra enthalpy goes into making steam, not into raising temperature. */
    if (state.coolTemp > state.satTemp) {
      state.coolTemp += (state.satTemp - state.coolTemp) * Math.min(1, dt * 0.35);
    }

    /* --- secondary: steam generator, turbine, generator --------- */
    const throttle = state.turbineTripped ? 0 : input.throttle / 100;
    const steamDraw = throttle * state.steamP * K.TURB_K;

    /* Steam dump to the condenser. This is what absorbs the mismatch on
       a load rejection; without it the secondary safeties chatter and the
       primary is left to soak up the whole transient on feedback alone. */
    state.dumpFrac = clamp((state.steamP - K.DUMP_SET) / K.DUMP_BAND, 0, 1);
    const dumpMW = state.dumpFrac * K.DUMP_CAP * K.RATED_TH;

    state.steamP += (state.sgMW - steamDraw - dumpMW) / K.SG_CAP * dt;
    if (state.steamP > K.STEAM_RELIEF) {
      state.steamP -= (state.steamP - K.STEAM_RELIEF) * 2 * dt;
    }
    state.steamP = clamp(state.steamP, 14.7, 1600);

    const shaftMW = Math.max(0, steamDraw) * K.TURB_EFF;
    const gridLocked = input.mainBreaker && input.genSync && input.exciter && !state.turbineTripped;
    state.synced = gridLocked && Math.abs(state.rpm - K.SYNC_RPM) < 120;

    if (state.synced) {
      /* the grid holds the shaft at synchronous speed */
      state.rpm += (K.SYNC_RPM - state.rpm) * Math.min(1, dt * 3);
      state.loadMW = shaftMW;
    } else {
      /* unloaded: steam torque against windage, so it runs away */
      state.rpm += (shaftMW * K.SHAFT_ACCEL - state.rpm * K.SHAFT_DRAG) * dt;
      state.rpm = Math.max(0, state.rpm);
      state.loadMW += (0 - state.loadMW) * Math.min(1, dt * 2);
    }
    if (state.rpm > K.OVERSPEED && !state.turbineTripped) {
      state.turbineTripped = true;
      log('TURBINE TRIP — OVERSPEED', 'trip');
    }

    /* --- fuel damage and radiation ------------------------------ */
    if (state.fuelTemp > K.CLAD_FAIL) {
      state.fuelDamage = Math.min(1, state.fuelDamage
        + (state.fuelTemp - K.CLAD_FAIL) / (K.MELT - K.CLAD_FAIL) * 0.05 * dt);
    }
    const leakPath = (input.reliefValve / 100) * 0.7 + 0.3;
    const target_r = 0.02 + state.fuelDamage * 9000 * leakPath + state.voidFrac * 1.5 + P * 0.4;
    state.radiation += (target_r - state.radiation) * Math.min(1, dt * 0.5);

    checkTrips();
  }

  /* ---------- PUBLIC --------------------------------------- */
  const SUB_DT = 0.05;   // fixed physics step, s
  const MAX_SUB = 120;   // ceiling so a background tab cannot stall the page

  return {
    K, state, input, events, tsat, rodWorth,
    X_EQ, I_EQ,

    /* dtReal is wall-clock seconds; timeBase compresses time so the
       hours-long xenon transients are actually watchable. */
    update(dtReal) {
      /* Reject a non-positive or non-finite step. The first animation frame
         can report dt <= 0 — the rAF timestamp is the frame's start, which
         may precede the performance.now() taken while that same frame's
         script was still evaluating. Left alone, Math.ceil(0 / SUB_DT) is 0,
         the substep size becomes 0/0, and step(NaN) poisons every state
         variable irrecoverably. */
      if (!Number.isFinite(dtReal) || dtReal <= 0) return;
      const dtSim = Math.min(dtReal, 0.25) * state.timeBase;
      if (!Number.isFinite(dtSim) || dtSim <= 0) return;
      let n = Math.ceil(dtSim / SUB_DT);
      if (n < 1) n = 1;
      if (n > MAX_SUB) n = MAX_SUB;
      const h = dtSim / n;
      for (let i = 0; i < n; i++) step(h);
    },

    setTimeBase(x) { state.timeBase = x; },

    scram(reason) { trip(reason || 'MANUAL SCRAM'); },

    resetTrip() {
      if (!state.scram) return false;
      state.scram = false;
      state.tripReason = '';
      state.turbineTripped = false;
      log('TRIP RESET', 'info');
      return true;
    },

    log,
  };
})();
