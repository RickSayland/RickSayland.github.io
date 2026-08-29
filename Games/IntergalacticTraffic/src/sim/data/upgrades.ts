import { D, type Decimal } from '../../core/num';

export type Bucket = 'propulsion' | 'structures' | 'logistics' | 'markets';

export interface Upgrade {
  id: string;
  name: string;
  bucket: Bucket;
  era: number;
  tech?: string;
  baseCost: Decimal;
  growth: number;
  max: number;
  /** Human-readable effect of one more level, for the card. */
  step: string;
  desc: string;
}

/**
 * Repeatables, bought with credits. Five buckets, kept multiplicatively
 * separate so a player can read what a purchase actually did: propulsion moves
 * exp(-dv/ve), structures moves the term subtracted from it, logistics moves
 * the denominator, markets move the price. Institutions are the fifth bucket
 * and live in INSTITUTIONS below, because they are bought with Mandate.
 */
export const UPGRADES: Upgrade[] = [
  // --- propulsion ---
  {
    id: 've', name: 'Specific Impulse Program', bucket: 'propulsion', era: 1,
    baseCost: D(40), growth: 1.115, max: 400, step: '+8% exhaust velocity',
    desc: 'Raises vₑ across the fleet. Compounds into payload fraction exponentially, so it is worth most on the routes that currently carry nothing.',
  },
  {
    id: 'betaCap', name: 'Frame Tolerance', bucket: 'propulsion', era: 2, tech: 'era2-relativistic',
    baseCost: D(2e9), growth: 1.165, max: 200, step: 'closes 14% of the gap to c',
    desc: 'Raises the certified velocity ceiling. It never reaches c, and the fuel term diverges before the ceiling does.',
  },
  {
    // Throughput is linear in w, so +35% a level against 1.185 growth was the
    // same free-upgrade bug as the tariff schedule. The w^3 exotic matter draw
    // is the intended brake; the credit price should not also be a giveaway.
    id: 'warpCap', name: 'Metric Gradient Licence', bucket: 'propulsion', era: 3, tech: 'era3-metric',
    baseCost: D(4e21), growth: 1.45, max: 300, step: '+35% maximum warp factor',
    desc: 'Authorises a steeper metric gradient. Upkeep goes as w³, so the licence is cheap and the exotic matter is not.',
  },
  // --- structures ---
  {
    id: 'struct', name: 'Structural Efficiency', bucket: 'structures', era: 1,
    baseCost: D(85), growth: 1.135, max: 120, step: '−4.5% structural fraction',
    desc: 'Every kilogram of tankage and truss is a kilogram of payload not carried. Matters most where exp(−Δv/vₑ) is already small.',
  },
  {
    id: 'mass', name: 'Hull Scaling', bucket: 'structures', era: 1,
    baseCost: D(65), growth: 1.125, max: 300, step: '+10% wet mass',
    desc: 'Bigger hulls. Linear in throughput and never diminishing, which makes it the reliable purchase and never the exciting one.',
  },
  // --- logistics ---
  {
    id: 'overhead', name: 'Turnaround Reduction', bucket: 'logistics', era: 1,
    baseCost: D(55), growth: 1.108, max: 200, step: '−7% loading overhead',
    desc: 'Berth time, inspection, and paperwork. Fixed cost per round trip, so it dominates the short hops and vanishes on the long ones.',
  },
  {
    id: 'stagger', name: 'Fleet Staggering', bucket: 'logistics', era: 1, tech: 'ops-stagger',
    baseCost: D(220), growth: 1.145, max: 40, step: 'closes 12% of the gap to continuous flow',
    desc: 'Disperses departures around the cycle. Does not change average throughput at all — it changes it from a spike into an income.',
  },
  {
    id: 'berths', name: 'Charter Ceiling', bucket: 'logistics', era: 1,
    baseCost: D(900), growth: 1.36, max: 240, step: '+2 concurrent route charters',
    desc: 'The authority may only administer so many active charters at once. This is a paperwork limit and is priced like one.',
  },
  {
    id: 'crew', name: 'Crew Rotation Scheme', bucket: 'logistics', era: 2, tech: 'era2-relativistic',
    baseCost: D(8e9), growth: 1.15, max: 120, step: '−10% crew cost coefficient',
    desc: 'Crew are paid in proper time, so the bill already falls as γ rises. This lowers what is left.',
  },
  {
    id: 'exoticEff', name: 'Bubble Wall Thinning', bucket: 'logistics', era: 3, tech: 'era3-metric',
    baseCost: D(2e23), growth: 1.16, max: 200, step: '−12% exotic matter upkeep',
    desc: 'Thinner bubble walls hold the same gradient for less negative energy density. There is a floor and nobody has found it.',
  },
  {
    id: 'horizon', name: 'Comoving Correction', bucket: 'logistics', era: 4, tech: 'era4-intergalactic',
    baseCost: D(1e40), growth: 1.19, max: 200, step: '−15% effective recession',
    desc: 'Pre-positioning and comoving station-keeping. It does not slow the expansion; it stops you paying the whole of it twice.',
  },
  // --- markets ---
  {
    // Growth must stay above the benefit. At 1.125 against +13% this schedule
    // paid for itself at every level, which is not an expensive upgrade, it is
    // a free one — a naive 30-minute run reached 1e28 credits before the first
    // Recharter and the whole Mandate economy went with it.
    id: 'value', name: 'Tariff Schedule Revision', bucket: 'markets', era: 1,
    baseCost: D(200), growth: 1.17, max: 400, step: '+13% value density, all kinds',
    desc: 'What a kilogram is worth on arrival. The broadest multiplier in the game and priced accordingly.',
  },
  {
    id: 'fuel', name: 'Reaction Mass Contracts', bucket: 'markets', era: 2, tech: 'era2-relativistic',
    baseCost: D(9e9), growth: 1.15, max: 120, step: '−10% fuel cost coefficient',
    desc: 'Fuel scales as (γ−1)mc² and is what ends the era. Cheapening it moves the optimum velocity up, it does not remove the wall.',
  },
  {
    id: 'tradeVal', name: 'Cargo Brokerage', bucket: 'markets', era: 1, tech: 'mkt-broker',
    baseCost: D(1500), growth: 1.13, max: 300, step: '+11% trade value density',
    desc: 'Applies to trade routes only.',
  },
  {
    id: 'sciVal', name: 'Instrument Standardisation', bucket: 'markets', era: 1, tech: 'mkt-broker',
    baseCost: D(1500), growth: 1.13, max: 300, step: '+12% research yield',
    desc: 'Applies to science routes only. Research is the currency the technology tree runs on.',
  },
  {
    id: 'milVal', name: 'Security Appropriations', bucket: 'markets', era: 1, tech: 'mkt-broker',
    baseCost: D(1500), growth: 1.13, max: 300, step: '+12% security generated',
    desc: 'Applies to military routes only. Security suppresses Interdiction, which is a penalty on everything else.',
  },
];

const UP_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));
export function upgrade(id: string): Upgrade {
  const u = UP_BY_ID.get(id);
  if (!u) throw new Error(`unknown upgrade ${id}`);
  return u;
}

// -------------------------------------------------------- institutions -----

export interface Institution {
  id: string;
  name: string;
  baseCost: number;
  growth: number;
  max: number;
  step: string;
  desc: string;
}

/** The fifth bucket. Bought with Mandate, survives every Recharter. */
export const INSTITUTIONS: Institution[] = [
  {
    id: 'mult', name: 'Charter Authority', baseCost: 3, growth: 1.55, max: 500,
    step: '+25% all credit income',
    desc: 'The flat multiplier. Unglamorous, permanent, and the reason the next charter goes faster than the last.',
  },
  {
    id: 'resMult', name: 'Standing Research Budget', baseCost: 5, growth: 1.7, max: 300,
    step: '+30% research yield',
    desc: 'Research is kept across a Recharter, so this compounds across your entire career rather than one charter.',
  },
  {
    id: 'offline', name: 'Continuity of Operations', baseCost: 4, growth: 1.95, max: 16,
    step: '+4 h offline accrual cap',
    desc: 'Traffic does not stop when the office is closed. Base cap is 8 hours; the ceiling is 72.',
  },
  {
    id: 'head', name: 'Standing Survey Record', baseCost: 8, growth: 2.3, max: 12,
    step: 'begin each charter with 1 more endpoint surveyed and more seed capital',
    desc: 'Surveys are a matter of record, and records outlive charters. Skips the opening minutes.',
  },
  {
    id: 'auto', name: 'Delegated Scheduling', baseCost: 14, growth: 2.5, max: 6,
    step: '+1 automation pass per second',
    desc: 'How aggressively the automation you have researched actually acts. Without any automation technology this does nothing.',
  },
  {
    id: 'mandateGain', name: 'Precedent', baseCost: 25, growth: 2.9, max: 200,
    step: '+20% Mandate from every future Recharter',
    desc: 'Each filing cites the last. Compounds on the cube root, which is the only reason it is affordable at all.',
  },
];

const INST_BY_ID = new Map(INSTITUTIONS.map((i) => [i.id, i]));
export function institution(id: string): Institution {
  const i = INST_BY_ID.get(id);
  if (!i) throw new Error(`unknown institution ${id}`);
  return i;
}
