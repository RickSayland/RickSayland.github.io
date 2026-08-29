import './styles.css';

import { fmt, fmtTime, setNotation } from './core/format';
import { TICK_DT, MAX_CATCHUP_STEPS, TIME_SCALE, GAME_VERSION } from './sim/constants';
import { initNodes } from './sim/nodes';
import { createSim, refresh, tick, type Sim } from './sim/engine';
import { applyOffline } from './sim/actions';
import { hydrateDefaults, newGame } from './sim/state';
import { loadFromStorage, saveToStorage } from './save/save';
import { initApp, rebindSim, renderFrame, appToast, appModal } from './ui/app';
import type { GameState } from './sim/types';

/** Render the view at 12 Hz; the resource bar and the map run at frame rate. */
const VIEW_HZ = 12;

let sim: Sim;
let acc = 0;
let viewAcc = 0;
let last = performance.now();
let saveAcc = 0;

function boot(): void {
  const loaded = loadFromStorage();
  const state = loaded ? hydrateDefaults(loaded) : newGame();
  start(state, loaded !== null);
}

function start(state: GameState, fromSave: boolean): void {
  // Node generation is seeded off the save, so the same charter always gets
  // the same galaxy. It has to happen before anything reads a node id.
  initNodes(state.seed);
  setNotation(state.settings.notation);

  sim = createSim(state);

  let report = null;
  if (fromSave && state.lastSaveMs) {
    const elapsed = (Date.now() - state.lastSaveMs) / 1000;
    report = applyOffline(sim, elapsed);
  }
  state.lastSaveMs = Date.now();

  initApp(sim, { saveNow: () => doSave(true) });

  if (report) showOfflineReport(report.realSeconds, report.cappedSeconds, report.credits, report.research);

  last = performance.now();
  requestAnimationFrame(frame);
}

function showOfflineReport(
  real: number, capped: number, credits: import('./core/num').Decimal,
  research: import('./core/num').Decimal,
): void {
  const clipped = real > capped + 1;
  appModal(
    'While the office was closed',
    `<div class="kv">
       <div class="kv-row"><div class="kv-k">Elapsed</div><div class="kv-v">${fmtTime(real)}</div></div>
       <div class="kv-row"><div class="kv-k">Accrued over</div><div class="kv-v">${fmtTime(capped)}</div></div>
       <div class="kv-row"><div class="kv-k">Credits</div><div class="kv-v">${fmt(credits)}</div></div>
       <div class="kv-row"><div class="kv-k">Research</div><div class="kv-v">${fmt(research)}</div></div>
     </div>
     ${clipped
      ? '<p class="warn">Accrual is capped. Continuity of Operations, under Institutions, raises the cap to 72 hours.</p>'
      : ''}
     <p class="panel-note">Computed by running the same simulation you were watching, at a coarser step. Nothing was estimated.</p>`,
    [{ label: 'Resume operations', cls: 'btn btn-primary' }],
  );
}

/**
 * Fixed timestep, decoupled from rendering. The sim only ever advances in
 * TICK_DT increments, which is what makes offline progress and online progress
 * literally the same arithmetic.
 */
function frame(now: number): void {
  const raw = (now - last) / 1000;
  last = now;

  if (raw > 2) {
    // The tab was hidden or the machine slept. Do not try to make that up at
    // 20 Hz — run a bounded coarse catch-up instead, the same way offline does.
    catchUp(raw);
  } else {
    acc += raw;
    let steps = 0;
    while (acc >= TICK_DT && steps < MAX_CATCHUP_STEPS) {
      tick(sim, TICK_DT);
      acc -= TICK_DT;
      steps++;
    }
    // A backlog we are never going to clear is dropped rather than carried.
    if (acc > TICK_DT * MAX_CATCHUP_STEPS) acc = 0;
  }

  sim.state.stats.playMs += Math.min(raw, 2) * 1000;

  viewAcc += raw;
  const full = viewAcc >= 1 / VIEW_HZ;
  if (full) viewAcc = 0;
  renderFrame(sim, full);

  const every = sim.state.settings.autosaveSec;
  if (every > 0) {
    saveAcc += raw;
    if (saveAcc >= every) {
      saveAcc = 0;
      doSave(false);
    }
  }

  requestAnimationFrame(frame);
}

function catchUp(seconds: number): void {
  const steps = Math.min(600, Math.max(1, Math.ceil(seconds / 0.5)));
  const dt = seconds / steps;
  for (let i = 0; i < steps; i++) tick(sim, dt);
  acc = 0;
}

function doSave(loud: boolean): void {
  sim.state.lastSaveMs = Date.now();
  const ok = saveToStorage(sim.state);
  if (loud) appToast(ok ? 'Charter filed to local storage.' : 'Could not write to local storage.', ok ? 'good' : 'bad');
  else if (!ok) appToast('Autosave failed — local storage is unavailable.', 'bad');
}

// Settings dispatches these; the app owns state, so the swap happens here.
window.addEventListener('its:loadstate', (e) => {
  const detail = (e as CustomEvent<GameState>).detail;
  if (!detail) return;
  const state = hydrateDefaults(detail);
  initNodes(state.seed);
  setNotation(state.settings.notation);
  sim = createSim(state);
  refresh(sim);
  rebindSim(sim);
  doSave(false);
  appToast('Save imported.', 'good');
});

window.addEventListener('its:newgame', () => {
  const state = newGame();
  initNodes(state.seed);
  sim = createSim(state);
  rebindSim(sim);
  doSave(false);
  appToast('Charter reset. Everything is gone.', 'info');
});

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') doSave(false);
});
window.addEventListener('pagehide', () => doSave(false));

// eslint-disable-next-line no-console
console.info(`Intergalactic Traffic Simulator ${GAME_VERSION} — ${TIME_SCALE / 86400} sim days per second`);

boot();
