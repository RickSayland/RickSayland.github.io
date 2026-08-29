import { D, Decimal, geomCost, geomCostBulk, geomBuyMax } from '../core/num';
import { MANDATE_K, OFFLINE_MAX_STEPS } from './constants';
import {
  markDirty, markStructure, refresh, tick, shipPrice, shipBulkPrice,
  shipsAffordable, tierPrice, routeCap, type Sim,
} from './engine';
import { getNode, node, nodesUpToEra } from './nodes';
import { getShipClass, SHIP_CLASSES } from './data/ships';
import { getTech, TECHS } from './data/tech';
import { UPGRADES, INSTITUTIONS, upgrade, institution } from './data/upgrades';
import { makeRoute, rechartered } from './state';
import { optimalBeta } from './routeMath';
import type { RouteKind, RouteState } from './types';

export type ActionResult = { ok: true } | { ok: false; why: string };
const OK: ActionResult = { ok: true };
const no = (why: string): ActionResult => ({ ok: false, why });

// ------------------------------------------------------------- surveying ---

export function isSurveyed(sim: Sim, id: string): boolean {
  return sim.state.surveyed.includes(id);
}

export function survey(sim: Sim, id: string): ActionResult {
  const s = sim.state;
  const n = getNode(id);
  if (!n) return no('No such endpoint.');
  if (isSurveyed(sim, id)) return no('Already surveyed.');
  if (n.era > s.era) return no(`Requires era ${n.era}.`);
  if (s.credits.lt(n.surveyCost)) return no('Insufficient credits.');
  s.credits = s.credits.sub(n.surveyCost);
  s.surveyed.push(id);
  markStructure(sim);
  return OK;
}

// -------------------------------------------------------------- charters ---

/** Filing fee, scaled off what the two endpoints cost to survey. */
export function charterCost(from: string, to: string): Decimal {
  const a = getNode(from);
  const b = getNode(to);
  if (!a || !b) return D(Infinity);
  return a.surveyCost.add(b.surveyCost).mul(0.04).add(12);
}

export function canCharter(sim: Sim, from: string, to: string): ActionResult {
  const s = sim.state;
  if (from === to) return no('An endpoint cannot be routed to itself.');
  if (!isSurveyed(sim, from) || !isSurveyed(sim, to)) return no('Both endpoints must be surveyed.');
  if (s.routes.length >= routeCap(sim)) return no('Charter ceiling reached.');
  if (s.credits.lt(charterCost(from, to))) return no('Insufficient credits for the filing fee.');
  return OK;
}

export function charter(
  sim: Sim, from: string, to: string, kind: RouteKind, shipClassId: string,
): ActionResult {
  const check = canCharter(sim, from, to);
  if (!check.ok) return check;
  const sc = getShipClass(shipClassId);
  if (!sc) return no('Unknown hull class.');
  if (!classAvailable(sim, shipClassId)) return no('Hull class not certified.');
  const s = sim.state;
  s.credits = s.credits.sub(charterCost(from, to));
  const r = makeRoute(from, to, kind, shipClassId);
  if (s.era >= 2) r.v = defaultVelocity(sim);
  s.routes.push(r);
  s.stats.routesChartered++;
  markStructure(sim);
  return OK;
}

export function dissolve(sim: Sim, routeId: string): ActionResult {
  const s = sim.state;
  const i = s.routes.findIndex((r) => r.id === routeId);
  if (i < 0) return no('No such charter.');
  s.routes.splice(i, 1);
  markStructure(sim);
  return OK;
}

export function classAvailable(sim: Sim, id: string): boolean {
  const sc = getShipClass(id);
  if (!sc) return false;
  if (sc.era > sim.state.era) return false;
  return !sc.tech || sim.state.tech.includes(sc.tech);
}

export function availableClasses(sim: Sim) {
  return SHIP_CLASSES.filter((c) => classAvailable(sim, c.id));
}

/** Era 2 opens at the current optimum; later eras open at full warp. */
function defaultVelocity(sim: Sim): number {
  if (sim.state.era !== 2) return 1;
  const b = optimalBeta(sim.mods.betaCap, sim.mods.crewK, sim.mods.fuelK);
  return Math.min(1, b / sim.mods.betaCap);
}

// ----------------------------------------------------------------- fleet ---

export function buyShips(sim: Sim, routeId: string, count: number): ActionResult {
  const s = sim.state;
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return no('No such charter.');
  if (count <= 0) return no('Nothing to buy.');
  const price = shipBulkPrice(r.shipClass, r.ships, count);
  if (s.credits.lt(price)) return no('Insufficient credits.');
  s.credits = s.credits.sub(price);
  r.ships = r.ships.add(count);
  s.stats.shipsBought += count;
  markDirty(sim);
  return OK;
}

export function buyShipsMax(sim: Sim, routeId: string): ActionResult {
  const s = sim.state;
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return no('No such charter.');
  const n = shipsAffordable(r.shipClass, r.ships, s.credits);
  if (n <= 0) return no('Insufficient credits.');
  return buyShips(sim, routeId, n);
}

export function nextShipPrice(r: RouteState): Decimal {
  return shipPrice(r.shipClass, r.ships);
}

export function buyTier(sim: Sim, routeId: string): ActionResult {
  const s = sim.state;
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return no('No such charter.');
  const price = tierPrice(r.shipClass, r.tier);
  if (s.credits.lt(price)) return no('Insufficient credits.');
  s.credits = s.credits.sub(price);
  r.tier++;
  markDirty(sim);
  return OK;
}

export function nextTierPrice(r: RouteState): Decimal {
  return tierPrice(r.shipClass, r.tier);
}

export function setVelocity(sim: Sim, routeId: string, v: number): void {
  const r = sim.state.routes.find((x) => x.id === routeId);
  if (!r) return;
  r.v = Math.max(0.001, Math.min(1, v));
  markDirty(sim);
}

export function setKind(sim: Sim, routeId: string, kind: RouteKind): void {
  const r = sim.state.routes.find((x) => x.id === routeId);
  if (!r) return;
  r.kind = kind;
  markDirty(sim);
}

export function setShipClass(sim: Sim, routeId: string, classId: string): ActionResult {
  const r = sim.state.routes.find((x) => x.id === routeId);
  if (!r) return no('No such charter.');
  if (!classAvailable(sim, classId)) return no('Hull class not certified.');
  // Hulls are fungible within a class but not across one: swapping the class
  // of a route retires its tonnage rather than converting it, which is what
  // stops a free upgrade every time a certification lands.
  r.shipClass = classId;
  r.ships = D(0);
  markDirty(sim);
  return OK;
}

export function toggleAuto(sim: Sim, routeId: string): void {
  const r = sim.state.routes.find((x) => x.id === routeId);
  if (!r) return;
  r.auto = !r.auto;
}

/** One click, every affordable hull, cheapest marginal cost first. */
export function upgradeAllAffordable(sim: Sim): number {
  const s = sim.state;
  let bought = 0;
  // Buying in rounds keeps this fair between routes and bounded in time: each
  // pass buys at most one hull per route, and stops as soon as a pass is empty.
  for (let pass = 0; pass < 40; pass++) {
    let any = false;
    for (const r of s.routes) {
      const price = shipPrice(r.shipClass, r.ships);
      if (s.credits.lt(price)) continue;
      s.credits = s.credits.sub(price);
      r.ships = r.ships.add(1);
      bought++;
      any = true;
    }
    if (!any) break;
  }
  if (bought) {
    s.stats.shipsBought += bought;
    markDirty(sim);
  }
  return bought;
}

// -------------------------------------------------------------- upgrades ---

export function upgradeAvailable(sim: Sim, id: string): boolean {
  const u = upgrade(id);
  if (u.era > sim.state.era) return false;
  return !u.tech || sim.state.tech.includes(u.tech);
}

export function upgradeCost(sim: Sim, id: string, count = 1): Decimal {
  const u = upgrade(id);
  const owned = sim.state.up[id] ?? 0;
  return count === 1
    ? geomCost(u.baseCost, u.growth, owned)
    : geomCostBulk(u.baseCost, u.growth, owned, count);
}

export function upgradeMax(sim: Sim, id: string): number {
  const u = upgrade(id);
  const owned = sim.state.up[id] ?? 0;
  const room = u.max - owned;
  if (room <= 0) return 0;
  return Math.min(room, geomBuyMax(sim.state.credits, u.baseCost, u.growth, owned));
}

export function buyUpgrade(sim: Sim, id: string, count = 1): ActionResult {
  const s = sim.state;
  const u = upgrade(id);
  if (!upgradeAvailable(sim, id)) return no('Not yet available.');
  const owned = s.up[id] ?? 0;
  const n = Math.min(count, u.max - owned);
  if (n <= 0) return no('Already at maximum.');
  const price = geomCostBulk(u.baseCost, u.growth, owned, n);
  if (s.credits.lt(price)) return no('Insufficient credits.');
  s.credits = s.credits.sub(price);
  s.up[id] = owned + n;
  markDirty(sim);
  return OK;
}

export function buyAllAffordableUpgrades(sim: Sim): number {
  let bought = 0;
  for (let pass = 0; pass < 30; pass++) {
    let any = false;
    for (const u of UPGRADES) {
      if (!upgradeAvailable(sim, u.id)) continue;
      if (buyUpgrade(sim, u.id, 1).ok) {
        bought++;
        any = true;
      }
    }
    if (!any) break;
  }
  return bought;
}

// ------------------------------------------------------------ technology ---

export function techState(sim: Sim, id: string): 'owned' | 'available' | 'locked' {
  const s = sim.state;
  if (s.tech.includes(id)) return 'owned';
  const t = getTech(id);
  if (!t) return 'locked';
  if (t.era > s.era) return 'locked';
  for (const req of t.req) if (!s.tech.includes(req)) return 'locked';
  return 'available';
}

export function buyTech(sim: Sim, id: string): ActionResult {
  const s = sim.state;
  const t = getTech(id);
  if (!t) return no('No such technology.');
  if (s.tech.includes(id)) return no('Already researched.');
  if (techState(sim, id) === 'locked') return no('Prerequisites not met.');
  if (s.research.lt(t.cost)) return no('Insufficient research.');
  s.research = s.research.sub(t.cost);
  s.tech.push(id);
  if (t.unlocksEra && t.unlocksEra > s.eraUnlocked) s.eraUnlocked = t.unlocksEra;
  markStructure(sim);
  return OK;
}

export function availableTechs(sim: Sim) {
  return TECHS.filter((t) => t.era <= sim.state.era || sim.state.tech.includes(t.id));
}

// ---------------------------------------------------------- institutions ---

export function institutionCost(sim: Sim, id: string): Decimal {
  const inst = institution(id);
  const owned = sim.state.inst[id] ?? 0;
  return D(inst.baseCost).mul(Decimal.pow(inst.growth, owned));
}

export function buyInstitution(sim: Sim, id: string): ActionResult {
  const s = sim.state;
  const inst = institution(id);
  const owned = s.inst[id] ?? 0;
  if (owned >= inst.max) return no('Already at maximum.');
  const price = institutionCost(sim, id);
  if (s.mandate.lt(price)) return no('Insufficient Mandate.');
  s.mandate = s.mandate.sub(price);
  s.inst[id] = owned + 1;
  markDirty(sim);
  return OK;
}

export { INSTITUTIONS };

// -------------------------------------------------------------- recharter --

/** mandate = k * lifetimeCredits^(1/3). Cube root, so the meta-currency stays countable. */
export function mandateGain(sim: Sim): Decimal {
  const s = sim.state;
  if (s.lifetimeCredits.lte(1)) return D(0);
  return s.lifetimeCredits.pow(1 / 3).mul(MANDATE_K * sim.mods.mandateMult).floor();
}

export function canRecharter(sim: Sim): ActionResult {
  const s = sim.state;
  if (s.eraUnlocked <= s.era) return no('No further era has been authorised.');
  return OK;
}

export function recharter(sim: Sim): ActionResult {
  const check = canRecharter(sim);
  if (!check.ok) return check;
  const s = sim.state;
  const gain = mandateGain(sim);
  const next = rechartered(s, gain, s.era + 1);
  // The Standing Survey Record is what a head start actually is: surveys are a
  // matter of record and records outlive charters.
  const head = sim.mods.headStart;
  if (head > 0) {
    const pool = nodesUpToEra(next.era)
      .filter((n) => !next.surveyed.includes(n.id))
      .sort((a, b) => (a.surveyCost.lt(b.surveyCost) ? -1 : 1));
    for (let i = 0; i < head && i < pool.length; i++) next.surveyed.push(pool[i]!.id);
    next.credits = D(50).mul(Decimal.pow(12, head));
  }
  sim.state = next;
  markStructure(sim);
  refresh(sim);
  return OK;
}

// ---------------------------------------------------------------- offline --

export interface OfflineReport {
  realSeconds: number;
  cappedSeconds: number;
  credits: Decimal;
  research: Decimal;
  ticks: number;
}

/**
 * Offline progress runs the identical `tick`, only with a larger dt. That is
 * not an optimisation, it is the reason the two can never disagree — there is
 * no second implementation to drift.
 */
export function applyOffline(sim: Sim, elapsedSeconds: number): OfflineReport | null {
  const cap = sim.mods.offlineCapH * 3600;
  const real = Math.max(0, elapsedSeconds);
  const capped = Math.min(real, cap);
  if (capped < 30) return null;

  const before = sim.state.credits;
  const beforeR = sim.state.research;
  const steps = Math.min(OFFLINE_MAX_STEPS, Math.max(60, Math.ceil(capped / 2)));
  const dt = capped / steps;
  refresh(sim);
  for (let i = 0; i < steps; i++) tick(sim, dt);
  refresh(sim);

  return {
    realSeconds: real,
    cappedSeconds: capped,
    credits: sim.state.credits.sub(before),
    research: sim.state.research.sub(beforeR),
    ticks: steps,
  };
}

// ------------------------------------------------------------------ misc ---

export function nodeName(id: string): string {
  const n = getNode(id);
  return n ? n.short : id;
}

export function nodeFull(id: string): string {
  return node(id).name;
}
