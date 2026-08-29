import { D, Decimal, safeLog10, geomCost, geomBuyMax, geomCostBulk } from '../core/num';
import { shipClass } from './data/ships';
import {
  TIME_SCALE, INTERDICTION_K, INTERDICTION_TAU, MAX_ROUTES,
} from './constants';
import { computeMods, type Mods } from './modifiers';
import { getNode, REGIONS } from './nodes';
import { emptyCache, solveRoute, optimalBeta } from './routeMath';
import type { GameState, RouteCache, WorldNode } from './types';

export interface Totals {
  credits: Decimal; // per sim second, after interdiction
  research: Decimal;
  security: Decimal;
  exoticProd: Decimal;
  exoticDraw: Decimal;
  throughput: Decimal;
  liveRoutes: number;
}

export interface Sim {
  state: GameState;
  mods: Mods;
  /** Parallel to state.routes. Rebuilt whole whenever the route list changes. */
  caches: RouteCache[];
  nodesA: (WorldNode | undefined)[];
  nodesB: (WorldNode | undefined)[];
  regionOf: number[];
  /** Steady per-sim-second gross per region, from the caches. Never mutated by the tick. */
  regionGross: Decimal[];
  /** Scratch: credits actually delivered to each region during the current tick. */
  regionAccum: Decimal[];
  regionSec: Decimal[];
  regionPenalty: number[];
  totals: Totals;
  /** Fraction of demanded exotic matter actually supplied, 0..1. */
  throttle: number;
  dirty: boolean;
  autoTimer: number;
  /** Bumped whenever the route list itself changes, so views can rebuild rows. */
  structureVersion: number;
}

const REGION_IDS = REGIONS.map((r) => r.id);
const REGION_INDEX = new Map(REGION_IDS.map((id, i) => [id, i]));

function zeroTotals(): Totals {
  return {
    credits: D(0), research: D(0), security: D(0),
    exoticProd: D(0), exoticDraw: D(0), throughput: D(0), liveRoutes: 0,
  };
}

export function createSim(state: GameState): Sim {
  const sim: Sim = {
    state,
    mods: computeMods(state),
    caches: [],
    nodesA: [],
    nodesB: [],
    regionOf: [],
    regionGross: REGION_IDS.map(() => D(0)),
    regionAccum: REGION_IDS.map(() => D(0)),
    regionSec: REGION_IDS.map(() => D(0)),
    regionPenalty: REGION_IDS.map(() => 1),
    totals: zeroTotals(),
    throttle: 1,
    dirty: true,
    autoTimer: 0,
    structureVersion: 0,
  };
  refresh(sim);
  return sim;
}

export function markDirty(sim: Sim): void {
  sim.dirty = true;
}

export function markStructure(sim: Sim): void {
  sim.dirty = true;
  sim.structureVersion++;
}

/**
 * Bring the caches in line if an action has invalidated them.
 *
 * Actions only set `dirty`; the tick is what normally clears it. But an action
 * can be followed synchronously by a read — filing a charter and immediately
 * switching to the route table is the obvious one — and `caches` is parallel
 * to `routes`, so between the two there is a route with no cache entry. Any
 * reader that runs outside the tick calls this first.
 */
export function ensureFresh(sim: Sim): void {
  if (sim.dirty) refresh(sim);
}

/**
 * A route's region is the outer of its two endpoints. Interdiction is a
 * property of where the traffic ends up, and traffic ends up at the far end.
 */
function routeRegion(a: WorldNode | undefined, b: WorldNode | undefined): number {
  const ra = a ? REGION_INDEX.get(a.region) ?? 0 : 0;
  const rb = b ? REGION_INDEX.get(b.region) ?? 0 : 0;
  return Math.max(ra, rb);
}

/**
 * Recompute everything derived. This is the expensive call and it is why the
 * tick is cheap: nothing in here runs 20 times a second unless the player has
 * actually changed something.
 */
export function refresh(sim: Sim): void {
  const s = sim.state;
  sim.mods = computeMods(s);
  const n = s.routes.length;

  while (sim.caches.length < n) sim.caches.push(emptyCache());
  sim.caches.length = n;
  sim.nodesA.length = n;
  sim.nodesB.length = n;
  sim.regionOf.length = n;

  for (let i = 0; i < REGION_IDS.length; i++) {
    sim.regionGross[i] = D(0);
    sim.regionSec[i] = D(0);
  }

  const t = zeroTotals();

  for (let i = 0; i < n; i++) {
    const r = s.routes[i]!;
    const a = getNode(r.from);
    const b = getNode(r.to);
    sim.nodesA[i] = a;
    sim.nodesB[i] = b;
    const cache = sim.caches[i]!;
    if (!a || !b) {
      // A dangling endpoint can only come from a save written by a different
      // build. Zero it rather than throwing the whole run away.
      Object.assign(cache, emptyCache());
      cache.note = 'UNKNOWN ENDPOINT';
      sim.regionOf[i] = 0;
      continue;
    }
    solveRoute(r, a, b, sim.mods, s.era, cache);
    const ri = routeRegion(a, b);
    sim.regionOf[i] = ri;
    sim.regionGross[ri] = sim.regionGross[ri]!.add(cache.rate);
    sim.regionSec[ri] = sim.regionSec[ri]!.add(cache.security);
    t.research = t.research.add(cache.research);
    t.security = t.security.add(cache.security);
    if (cache.exotic.gt(0)) t.exoticProd = t.exoticProd.add(cache.exotic);
    else if (cache.exotic.lt(0)) t.exoticDraw = t.exoticDraw.sub(cache.exotic);
    if (cache.viable) t.liveRoutes++;
    t.throughput = t.throughput.add(r.ships.mul(cache.throughput));
  }

  // Interdiction penalty is read from the previous tick's stored level; the
  // tick updates the level, refresh only re-derives the multiplier from it.
  let credits = D(0);
  for (let i = 0; i < REGION_IDS.length; i++) {
    const id = REGION_IDS[i]!;
    const I = s.interdiction[id] ?? 0;
    const p = 1 / (1 + Math.max(0, I));
    sim.regionPenalty[i] = p;
    credits = credits.add(sim.regionGross[i]!.mul(p));
  }
  t.credits = credits;
  sim.totals = t;
  sim.dirty = false;
}

/** Target Interdiction for one region, in orders of magnitude of unpoliced trade. */
function interdictionTarget(gross: Decimal, sec: Decimal, freeDecades: number): number {
  if (gross.lte(0)) return 0;
  const g = safeLog10(gross.mul(TIME_SCALE).add(1));
  const p = safeLog10(sec.mul(TIME_SCALE).add(1));
  return Math.max(0, g - p - freeDecades) * INTERDICTION_K;
}

/**
 * One step of the simulation. `dt` is REAL seconds; offline progress calls the
 * exact same function with a large dt, which is the only way the two can be
 * guaranteed to agree.
 */
export function tick(sim: Sim, dt: number): void {
  if (sim.dirty) refresh(sim);
  const s = sim.state;
  const dtSim = dt * TIME_SCALE;
  if (!(dtSim > 0)) return;

  // --- exotic matter supply, before income, because it gates income --------
  let throttle = 1;
  if (s.era >= 3) {
    const draw = sim.totals.exoticDraw;
    if (draw.gt(0)) {
      const available = sim.totals.exoticProd.add(s.exotic.div(dtSim));
      throttle = Math.min(1, Math.max(0, available.div(draw).toNumber()));
      if (!isFinite(throttle)) throttle = 1;
    }
    const net = sim.totals.exoticProd.sub(draw.mul(throttle));
    s.exotic = s.exotic.add(net.mul(dtSim));
    if (s.exotic.lt(0)) s.exotic = D(0);
  }
  sim.throttle = throttle;

  // --- per-route delivery --------------------------------------------------
  // Accrual goes into its own array. `regionGross` holds the STEADY rate and
  // must survive the tick: with staggering off, a bursty route delivers
  // nothing on most ticks, and reading the headline income off this tick's
  // accrual would report 0/s to a player watching a working network.
  const bucket = sim.regionAccum;
  for (let i = 0; i < bucket.length; i++) bucket[i] = D(0);

  const routes = s.routes;
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i]!;
    const c = sim.caches[i]!;
    const rtt = c.rtt;
    r.phase += dtSim;
    let completions = 0;
    if (rtt > 0 && r.phase >= rtt) {
      completions = Math.floor(r.phase / rtt);
      r.phase -= completions * rtt;
    }
    if (!c.viable) continue;
    // The smooth share accrues continuously; the rest arrives as whole
    // round trips. Averaged over a cycle the two are identical, which is
    // exactly why fleet staggering is a quality-of-life upgrade and not an
    // income upgrade, and why it still feels like one.
    const seconds = c.smoothness * dtSim + (1 - c.smoothness) * rtt * completions;
    if (seconds <= 0) continue;
    const ri = sim.regionOf[i]!;
    bucket[ri] = bucket[ri]!.add(c.rate.mul(seconds));
  }

  // --- interdiction --------------------------------------------------------
  const ease = 1 - Math.exp(-dtSim / INTERDICTION_TAU);
  let gained = D(0);
  for (let i = 0; i < REGION_IDS.length; i++) {
    const id = REGION_IDS[i]!;
    // Interdiction tracks the region's steady throughput, not this tick's
    // delivery, so a bursty era-1 network does not make the meter flap.
    const target = interdictionTarget(sim.regionGross[i]!, sim.regionSec[i]!, sim.mods.freeDecades);
    const cur = s.interdiction[id] ?? 0;
    const next = cur + (target - cur) * ease;
    s.interdiction[id] = next;
    const p = 1 / (1 + Math.max(0, next));
    sim.regionPenalty[i] = p;
    gained = gained.add(bucket[i]!.mul(p * throttle));
  }

  s.credits = s.credits.add(gained);
  s.lifetimeCredits = s.lifetimeCredits.add(gained);
  s.totalCredits = s.totalCredits.add(gained);

  if (sim.totals.research.gt(0)) {
    s.research = s.research.add(sim.totals.research.mul(dtSim * throttle));
  }

  s.t += dtSim;
  s.stats.ticks++;

  // The headline rate is the steady average, re-penalised with the levels this
  // tick just settled on. Recomputing only the multipliers keeps the cache.
  let creditRate = D(0);
  for (let i = 0; i < REGION_IDS.length; i++) {
    creditRate = creditRate.add(sim.regionGross[i]!.mul(sim.regionPenalty[i]! * throttle));
  }
  sim.totals.credits = creditRate;

  // Best rate is the steady average per real second, not a burst: a route that
  // pays one lump every eighty seconds would otherwise post a record that says
  // nothing about how the network actually performed.
  const perReal = creditRate.mul(TIME_SCALE);
  if (perReal.gt(s.stats.bestRate)) s.stats.bestRate = perReal;

  if (sim.mods.autoRate > 0) runAutomation(sim, dt);
}

// ------------------------------------------------------------ automation ---

/**
 * Automation is deliberately rate-limited rather than instantaneous: it acts
 * `autoRate` times a second, so the Institutions purchase that raises that rate
 * is worth something, and so a thousand-route network cannot be re-solved
 * inside a single tick.
 */
function runAutomation(sim: Sim, dt: number): void {
  const m = sim.mods;
  sim.autoTimer += dt * m.autoRate;
  if (sim.autoTimer < 1) return;
  const passes = Math.min(8, Math.floor(sim.autoTimer));
  sim.autoTimer -= passes;
  for (let p = 0; p < passes; p++) {
    if (m.autoOptimise) autoOptimiseOne(sim);
    if (m.autoAssign) autoAssignOne(sim);
  }
}

/** Nudge one route's velocity toward the era-2 optimum. */
function autoOptimiseOne(sim: Sim): void {
  const s = sim.state;
  if (s.era !== 2 || s.routes.length === 0) return;
  const best = optimalBeta(sim.mods.betaCap, sim.mods.crewK, sim.mods.fuelK);
  const target = Math.min(1, best / sim.mods.betaCap);
  let changed = false;
  for (const r of s.routes) {
    if (!r.auto) continue;
    if (Math.abs(r.v - target) > 1e-3) {
      r.v = target;
      changed = true;
    }
  }
  if (changed) markDirty(sim);
}

/** Buy one ship on the automated route with the best marginal income per credit. */
function autoAssignOne(sim: Sim): void {
  const s = sim.state;
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < s.routes.length; i++) {
    const r = s.routes[i]!;
    if (!r.auto) continue;
    const c = sim.caches[i]!;
    if (!c.viable && r.ships.gt(0)) continue;
    if (c.payloadPerShip <= 0) continue;
    const cost = shipPriceAt(sim, i);
    if (cost.gt(s.credits)) continue;
    // Income a marginal hull adds, per credit it costs.
    const marginal = c.rate.gt(0) && r.ships.gt(0)
      ? c.rate.div(r.ships)
      : D(c.payloadPerShip / Math.max(1, c.rtt));
    const score = marginal.div(cost);
    const sn = safeLog10(score);
    if (bestIdx < 0 || sn > bestScore) {
      bestIdx = i;
      bestScore = sn;
    }
  }
  if (bestIdx < 0) return;
  const cost = shipPriceAt(sim, bestIdx);
  if (cost.gt(s.credits)) return;
  s.credits = s.credits.sub(cost);
  const r = s.routes[bestIdx]!;
  r.ships = r.ships.add(1);
  s.stats.shipsBought++;
  markDirty(sim);
}

// --------------------------------------------------------------- pricing ---

/** Price of the next hull on route index i. */
export function shipPriceAt(sim: Sim, i: number): Decimal {
  const r = sim.state.routes[i]!;
  return shipPrice(r.shipClass, r.ships);
}

export function shipPrice(classId: string, owned: Decimal): Decimal {
  const sc = shipClass(classId);
  const n = owned.toNumber();
  if (!isFinite(n)) return Decimal.pow(sc.costGrowth, 1e9);
  return geomCost(sc.baseCost, sc.costGrowth, n);
}

export function shipBulkPrice(classId: string, owned: Decimal, count: number): Decimal {
  const sc = shipClass(classId);
  return geomCostBulk(sc.baseCost, sc.costGrowth, owned.toNumber(), count);
}

export function shipsAffordable(classId: string, owned: Decimal, funds: Decimal): number {
  const sc = shipClass(classId);
  return geomBuyMax(funds, sc.baseCost, sc.costGrowth, owned.toNumber(), 1e6);
}

/** Per-route tier upgrade: a flat +25% throughput, priced off the hull. */
export function tierPrice(classId: string, tier: number): Decimal {
  const sc = shipClass(classId);
  return sc.baseCost.mul(60).mul(Decimal.pow(3.2, tier));
}

export function routeCap(sim: Sim): number {
  return Math.min(MAX_ROUTES, sim.mods.maxRoutes);
}
