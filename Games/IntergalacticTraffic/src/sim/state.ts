import { D, Decimal } from '../core/num';
import type { GameState, RouteState, Settings, Stats } from './types';
import { SAVE_VERSION } from '../save/migrations';

export function defaultSettings(): Settings {
  return {
    notation: 'scientific',
    reducedMotion: false,
    showMap: true,
    confirmRecharter: true,
    autosaveSec: 20,
  };
}

export function defaultStats(): Stats {
  return { ticks: 0, playMs: 0, routesChartered: 0, shipsBought: 0, bestRate: D(0) };
}

let routeCounter = 0;

/**
 * Ids are a pure counter. An earlier version mixed in Date.now() to avoid
 * collisions across sessions, which quietly broke the determinism contract:
 * two runs of the same seed and the same inputs produced states that differed
 * only in route ids, and any hash over the state disagreed. Collisions are
 * instead prevented by seeding the counter past whatever a loaded save used.
 */
export function nextRouteId(): string {
  return 'r' + (routeCounter++).toString(36);
}

/** Keeps generated ids ahead of anything a loaded save already used. */
export function seedRouteCounter(routes: RouteState[]): void {
  let max = routeCounter;
  for (const r of routes) {
    const m = /^r([0-9a-z]+)$/.exec(r.id);
    if (!m) continue;
    const n = parseInt(m[1]!, 36);
    if (isFinite(n) && n >= max) max = n + 1;
  }
  routeCounter = max;
}

export function makeRoute(
  from: string, to: string, kind: RouteState['kind'], shipClass: string,
): RouteState {
  return {
    id: nextRouteId(), from, to, kind, shipClass,
    ships: D(0), tier: 0, v: 1, phase: 0, auto: false,
  };
}

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0): GameState {
  // A new charter numbers its routes from zero. Without this the counter is
  // process-global and the same seed produces different ids on a second run.
  routeCounter = 0;
  const s: GameState = {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    rngState: seed >>> 0,
    t: 0,
    lastSaveMs: Date.now(),
    era: 1,
    eraUnlocked: 1,
    credits: D(0),
    research: D(0),
    exotic: D(0),
    mandate: D(0),
    lifetimeCredits: D(0),
    totalCredits: D(0),
    recharters: 0,
    surveyed: ['leo', 'luna'],
    routes: [],
    up: {},
    tech: [],
    inst: {},
    interdiction: {},
    fx: {},
    settings: defaultSettings(),
    stats: defaultStats(),
  };
  // The authority opens with one licensed run and one hull on it, because an
  // idle game whose first screen earns nothing is a form, not a game.
  const first = makeRoute('leo', 'luna', 'trade', 'lighter');
  first.ships = D(1);
  s.routes.push(first);
  return s;
}

/**
 * A charter kept across a Recharter: era unlocks, technology, research and
 * Mandate survive; everything operational does not.
 */
export function rechartered(old: GameState, gainedMandate: Decimal, newEra: number): GameState {
  const s = newGame(old.seed);
  s.era = newEra;
  s.eraUnlocked = old.eraUnlocked;
  s.research = old.research;
  s.tech = old.tech.slice();
  s.inst = { ...old.inst };
  s.mandate = old.mandate.add(gainedMandate);
  s.totalCredits = old.totalCredits;
  s.recharters = old.recharters + 1;
  s.settings = { ...old.settings };
  s.stats = { ...old.stats, bestRate: D(0) };
  s.rngState = old.rngState;
  return s;
}

/**
 * Loaded saves come back with whatever the file contained. Fill the shape in
 * so nothing downstream has to guard: the persistence layer deliberately does
 * not know what a default is, and this is where that knowledge lives.
 */
export function hydrateDefaults(s: GameState): GameState {
  const d = newGame(s.seed || 1);
  s.settings = { ...d.settings, ...(s.settings ?? {}) };
  s.stats = { ...d.stats, ...(s.stats ?? {}) };
  if (!s.stats.bestRate || typeof (s.stats.bestRate as Decimal).add !== 'function') {
    s.stats.bestRate = D(0);
  }
  s.up = s.up ?? {};
  s.inst = s.inst ?? {};
  s.interdiction = s.interdiction ?? {};
  s.fx = s.fx ?? {};
  s.tech = s.tech ?? [];
  s.surveyed = s.surveyed?.length ? s.surveyed : ['leo', 'luna'];
  s.routes = s.routes ?? [];
  if (!s.era || s.era < 1) s.era = 1;
  if (!s.eraUnlocked || s.eraUnlocked < 1) s.eraUnlocked = 1;
  if (!isFinite(s.t)) s.t = 0;
  for (const r of s.routes) {
    if (!isFinite(r.v) || r.v <= 0) r.v = 1;
    if (!isFinite(r.phase)) r.phase = 0;
    if (!isFinite(r.tier)) r.tier = 0;
  }
  seedRouteCounter(s.routes);
  return s;
}
