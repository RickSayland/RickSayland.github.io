import type { Decimal } from '../core/num';

export type RouteKind = 'trade' | 'science' | 'military';
export type NodeId = string;
export type ShipClassId = string;

/** Which transit model a route is solved with. Set by era, not by the player. */
export type TransitModel = 'hohmann' | 'relativistic' | 'warp' | 'comoving' | 'brane';

export interface WorldNode {
  id: NodeId;
  name: string;
  short: string;
  era: number;
  region: string;
  /** Era 1 only: parent body, so intra-system hops don't get a heliocentric Hohmann. */
  parent?: string;
  /** Heliocentric semi-major axis, m (era 1). */
  a?: number;
  /** Transit within the parent system, sim seconds (era 1). */
  localTransit?: number;
  /** One-way delta-v from LEO, m/s. The terrain of era 1. */
  dv: number;
  /** Distance from Sol, m (era 2+). */
  dist: number;
  valueMult: number;
  researchMult: number;
  hazard: number;
  surveyCost: Decimal;
  /** Era 5: rolled physical constants, as multipliers on the player's build. */
  constants?: UniverseConstants;
  /** Map placement. Era 1 uses real orbits; later eras use a laid-out graph. */
  mx: number;
  my: number;
  flavor: string;
}

export interface UniverseConstants {
  c: number;
  alpha: number;
  g: number;
  label: string;
}

export interface ShipClass {
  id: ShipClassId;
  name: string;
  era: number;
  tech?: string;
  wetMass: number; // kg
  structural: number; // fraction of wet mass that is never payload
  veMult: number;
  rttMult: number; // turnaround character: couriers cycle, haulers lumber
  bubbleVolume: number; // era 3+ exotic matter draw
  baseCost: Decimal;
  costGrowth: number;
  blurb: string;
}

export interface RouteState {
  id: string;
  from: NodeId;
  to: NodeId;
  kind: RouteKind;
  shipClass: ShipClassId;
  ships: Decimal;
  tier: number;
  /** Commanded velocity as a fraction of the current cap (era 2+). */
  v: number;
  /** Seconds into the current round trip. Drives burst payouts. */
  phase: number;
  auto: boolean;
}

/** Everything derived. Recomputed on a dirty flag, never inside the tick. */
export interface RouteCache {
  deltaV: number;
  distance: number;
  payloadFraction: number;
  payloadPerShip: number; // kg
  rtt: number; // sim seconds
  throughput: number; // kg per sim second (per-ship terms x ships handled in Decimal)
  gross: Decimal; // credits per sim second before region penalty
  rate: Decimal; // credits per sim second, net
  research: Decimal;
  security: Decimal;
  /** Exotic matter per sim second for the whole route; negative = consumption. */
  exotic: Decimal;
  smoothness: number;
  velocity: number; // m/s or apparent m/s
  gamma: number;
  netMult: number;
  /** Fraction of the cycle a Hohmann window is open. 1 under every other model. */
  duty: number;
  viable: boolean;
  note: string;
}

export interface Settings {
  notation: 'scientific' | 'engineering' | 'standard';
  reducedMotion: boolean;
  showMap: boolean;
  confirmRecharter: boolean;
  autosaveSec: number;
}

export interface Stats {
  ticks: number;
  playMs: number;
  routesChartered: number;
  shipsBought: number;
  bestRate: Decimal;
}

export interface GameState {
  version: number;
  seed: number;
  rngState: number;
  /** Sim seconds since the charter was filed. */
  t: number;
  lastSaveMs: number;

  era: number;
  /** Highest era whose enabling technology has been researched. */
  eraUnlocked: number;

  credits: Decimal;
  research: Decimal;
  exotic: Decimal;
  mandate: Decimal;

  lifetimeCredits: Decimal; // this charter
  totalCredits: Decimal; // all charters
  recharters: number;

  surveyed: NodeId[];
  routes: RouteState[];

  /** Repeatable upgrade levels, keyed by upgrade id. */
  up: Record<string, number>;
  /** One-shot technologies purchased. */
  tech: string[];
  /** Mandate-bought institutions. */
  inst: Record<string, number>;

  interdiction: Record<string, number>;

  /** Era 5 exchange rates per universe node, drifting. */
  fx: Record<string, number>;

  settings: Settings;
  stats: Stats;
}
