import { D, Decimal } from '../core/num';
import { EXOTIC_K, CREW_K, FUEL_K, INTERDICTION_FREE_DECADES, OFFLINE_BASE_CAP_H } from './constants';
import { ENGINE_FLOORS } from './data/tech';
import type { GameState, RouteKind } from './types';

/**
 * Everything the player has bought, collapsed into the ~25 numbers the route
 * solver actually reads. Recomputed only when something changes (see
 * `markDirty` in engine.ts), never inside the tick.
 */
export interface Mods {
  ve: number;
  engineLabel: string;
  structMult: number;
  massMult: number;
  overheadMult: number;
  /** Fraction of the wait-for-return-window that has been engineered away. */
  continuity: number;
  /** 0 = one lump per round trip, 1 = a continuous income. */
  smoothness: number;
  valueMult: Decimal;
  kindMult: Record<RouteKind, number>;
  researchMult: Decimal;
  securityMult: number;
  betaCap: number;
  warpCap: number;
  crewK: number;
  fuelK: number;
  exoticK: number;
  exoticYield: number;
  recFactor: number;
  maxRoutes: number;
  freeDecades: number;
  offlineCapH: number;
  mandateMult: number;
  autoAssign: boolean;
  autoCharter: boolean;
  autoSurvey: boolean;
  autoOptimise: boolean;
  autoRate: number;
  headStart: number;
}

const lvl = (s: GameState, id: string): number => s.up[id] ?? 0;
const inst = (s: GameState, id: string): number => s.inst[id] ?? 0;

export function computeMods(s: GameState): Mods {
  const has = (t: string): boolean => s.tech.includes(t);

  // Engine floors are a ladder of one-shots; the repeatable stacks on top.
  let ve = ENGINE_FLOORS[0]!.ve;
  let engineLabel = ENGINE_FLOORS[0]!.label;
  for (const e of ENGINE_FLOORS) {
    if (e.tech === '' || has(e.tech)) {
      ve = e.ve;
      engineLabel = e.label;
    }
  }
  ve *= Math.pow(1.08, lvl(s, 've'));

  let continuity = 0;
  if (has('traj-continuous')) continuity = 0.45;
  if (has('traj-cycler')) continuity = 1;

  let smoothBase = 0;
  if (has('ops-stagger')) smoothBase = 0.25;
  if (has('ops-control')) smoothBase = 0.65;
  const smoothness = 1 - (1 - smoothBase) * Math.pow(0.88, lvl(s, 'stagger'));

  const instMult = Decimal.pow(1.25, inst(s, 'mult'));
  const valueMult = Decimal.pow(1.13, lvl(s, 'value')).mul(instMult);

  const researchMult = Decimal.pow(1.12, lvl(s, 'sciVal'))
    .mul(Decimal.pow(1.3, inst(s, 'resMult')))
    .mul(valueMult);

  let securityMult = Math.pow(1.12, lvl(s, 'milVal'));
  if (has('sec-doctrine')) securityMult *= 3;

  let recFactor = Math.pow(0.85, lvl(s, 'horizon'));
  if (has('horizon-survey')) recFactor *= 0.5;

  let exoticYield = 1;
  if (has('exotic-synthesis')) exoticYield = 4;

  const autoFull = has('auto-full');

  return {
    ve,
    engineLabel,
    structMult: Math.pow(0.955, lvl(s, 'struct')),
    massMult: Math.pow(1.1, lvl(s, 'mass')),
    overheadMult: Math.pow(0.93, lvl(s, 'overhead')),
    continuity,
    smoothness,
    valueMult,
    kindMult: {
      trade: Math.pow(1.11, lvl(s, 'tradeVal')),
      science: 1,
      military: 1,
    },
    researchMult,
    securityMult,
    // Cap approaches c asymptotically and never arrives, which is the point.
    betaCap: 1 - 0.65 * Math.pow(0.86, lvl(s, 'betaCap')),
    warpCap: 2 * Math.pow(1.35, lvl(s, 'warpCap')),
    crewK: CREW_K * Math.pow(0.9, lvl(s, 'crew')),
    fuelK: FUEL_K * Math.pow(0.9, lvl(s, 'fuel')),
    exoticK: EXOTIC_K * Math.pow(0.88, lvl(s, 'exoticEff')),
    exoticYield,
    recFactor,
    maxRoutes: 6 + 2 * lvl(s, 'berths') + 2 * inst(s, 'head'),
    freeDecades: INTERDICTION_FREE_DECADES + (has('sec-treaty') ? 1 : 0),
    offlineCapH: Math.min(72, OFFLINE_BASE_CAP_H + 4 * inst(s, 'offline')),
    mandateMult: Math.pow(1.2, inst(s, 'mandateGain')),
    autoAssign: has('auto-assign') || autoFull,
    autoCharter: has('auto-charter') || autoFull,
    autoSurvey: has('auto-survey') || autoFull,
    autoOptimise: has('rel-optimizer') || autoFull,
    autoRate: inst(s, 'auto'),
    headStart: inst(s, 'head'),
  };
}

/** Credits carried by a kilogram arriving on this kind of route, before nodes. */
export function kindCreditDensity(kind: RouteKind): number {
  return kind === 'trade' ? 1.0e-4 : kind === 'science' ? 0.3e-4 : 0.2e-4;
}

export const ZERO_MODS_CACHE = D(0);
