import { Decimal } from '../core/num';
import { C, H0, MU_SUN, BASE_OVERHEAD, RESEARCH_DENSITY, SECURITY_DENSITY, EXOTIC_YIELD } from './constants';
import { kindCreditDensity, type Mods } from './modifiers';
import { shipClass } from './data/ships';
import type { RouteCache, RouteState, TransitModel, WorldNode } from './types';

/** Which transit model an era solves its routes with. Never a player choice. */
export function transitModel(era: number, a: WorldNode, b: WorldNode): TransitModel {
  if (era <= 1) return 'hohmann';
  if (era === 2) return 'relativistic';
  if (era === 3) return 'warp';
  if (era === 4) return 'comoving';
  return a.era === 5 || b.era === 5 ? 'brane' : 'comoving';
}

/**
 * Delta-v is the pairwise difference in the two endpoints' budgets from LEO,
 * plus a fixed allowance for departure and rendezvous. It has the pleasant
 * consequence that a chain of outward hops is cheaper than one long jump, so a
 * player who builds hubs is rewarded without being told to.
 */
export function routeDeltaV(a: WorldNode, b: WorldNode): number {
  return Math.abs(a.dv - b.dv) + 1500;
}

/**
 * Separation by the law of cosines on the map directions. Using the same
 * numbers the map draws with means a route the player can see is long IS long,
 * which matters once the node list stops being memorable.
 */
export function routeDistance(a: WorldNode, b: WorldNode): number {
  const cos = Math.max(-1, Math.min(1, a.mx * b.mx + a.my * b.my));
  const d2 = a.dist * a.dist + b.dist * b.dist - 2 * a.dist * b.dist * cos;
  return Math.max(1e7, Math.sqrt(Math.max(0, d2)));
}

function orbitalPeriod(a: number): number {
  return 2 * Math.PI * Math.sqrt((a * a * a) / MU_SUN);
}

/** t = pi * sqrt((a1+a2)^3 / (8 mu)). The textbook half-ellipse. */
export function hohmannTime(a1: number, a2: number): number {
  const s = a1 + a2;
  return Math.PI * Math.sqrt((s * s * s) / (8 * MU_SUN));
}

/** T_syn = 1 / |1/T1 - 1/T2|. Infinite for co-orbital bodies, which is correct. */
export function synodicPeriod(a1: number, a2: number): number {
  const t1 = orbitalPeriod(a1);
  const t2 = orbitalPeriod(a2);
  const inv = Math.abs(1 / t1 - 1 / t2);
  return inv < 1e-14 ? Infinity : 1 / inv;
}

interface Transit {
  oneWay: number;
  synodic: number;
  local: boolean;
}

function solveHohmann(a: WorldNode, b: WorldNode): Transit {
  const sameSystem = a.parent !== undefined && a.parent === b.parent && a.parent !== 'sun';
  if (sameSystem) {
    // Inside a planet's system there is no meaningful synodic gate: the moons
    // come round in days, not years.
    const t = Math.max(0.5 * 86400, (a.localTransit ?? 0) + (b.localTransit ?? 0));
    return { oneWay: t, synodic: 0, local: true };
  }
  const a1 = a.a ?? a.dist;
  const a2 = b.a ?? b.dist;
  const helio = hohmannTime(a1, a2);
  // A moon of the destination still has to be reached from its primary.
  const legs = (a.parent && a.parent !== 'sun' ? a.localTransit ?? 0 : 0)
    + (b.parent && b.parent !== 'sun' ? b.localTransit ?? 0 : 0);
  return { oneWay: helio + legs, synodic: synodicPeriod(a1, a2), local: false };
}

/**
 * The transfer window, as a duty cycle. A route is only paying while a window
 * is open; the rest of the cycle the fleet is parked at the far end waiting for
 * the geometry to come back round. Continuity technology eats this wait.
 */
export function windowDuty(oneWay: number, synodic: number, continuity: number): number {
  if (!isFinite(synodic) || synodic <= 0) return 1;
  const round = 2 * oneWay;
  const wait = mod(synodic - round, synodic);
  const total = round + wait * (1 - continuity);
  return total > 0 ? round / total : 1;
}

function mod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

/** Net income per unit throughput at velocity beta. The era-2 trade-off, entire. */
export function relativisticNet(beta: number, crewK: number, fuelK: number): number {
  const b = Math.min(0.9999999, Math.max(1e-6, beta));
  const gamma = 1 / Math.sqrt(1 - b * b);
  // Crew are paid in proper time and throughput rises with beta, so their cost
  // per tonne-delivered falls as 1/(beta*gamma). Fuel is (gamma-1)mc^2 per
  // trip against a fixed payload, so it rises without bound. The optimum sits
  // where those two cross, and it moves whenever either coefficient changes.
  const crew = (crewK / gamma) / b;
  const fuel = fuelK * (gamma - 1);
  return Math.max(0, 1 - crew - fuel);
}

/** Numeric scan for the velocity that maximises beta * net(beta). */
export function optimalBeta(cap: number, crewK: number, fuelK: number): number {
  let best = 0.001;
  let bestVal = -1;
  const steps = 240;
  for (let i = 1; i <= steps; i++) {
    // Geometric in (1 - beta) so the scan is dense exactly where the optimum is.
    const beta = cap * (1 - Math.pow(1 - i / (steps + 1), 3));
    const v = beta * relativisticNet(beta, crewK, fuelK);
    if (v > bestVal) {
      bestVal = v;
      best = beta;
    }
  }
  return best;
}

const EMPTY = new Decimal(0);

/**
 * The whole game in one function. Fills `out` in place; allocates one Decimal
 * per resource stream and nothing else, because this runs for every route
 * whenever anything at all changes.
 */
export function solveRoute(
  r: RouteState,
  a: WorldNode,
  b: WorldNode,
  mods: Mods,
  era: number,
  out: RouteCache,
): void {
  const sc = shipClass(r.shipClass);
  const model = transitModel(era, a, b);
  const uni = a.constants ?? b.constants;

  const deltaV = routeDeltaV(a, b);
  const distance = routeDistance(a, b);
  const ve = mods.ve * sc.veMult * (uni ? uni.c : 1);

  // exp(-dv/ve) is the payload fraction before structure is subtracted. When
  // the ratio is large an engine upgrade is worth an order of magnitude; when
  // it is small it is worth almost nothing. No hand-tuning produces that.
  const structural = sc.structural * mods.structMult * (uni ? uni.g : 1);
  const payloadFraction = Math.exp(-deltaV / ve) - structural;
  const wetMass = sc.wetMass * mods.massMult;
  const payloadPerShip = wetMass * Math.max(0, payloadFraction);

  const overhead = BASE_OVERHEAD * mods.overheadMult * sc.rttMult;

  let rtt: number;
  let smoothness: number;
  let velocity = 0;
  let gamma = 1;
  let netMult = 1;
  let viable = payloadFraction > 0;
  let note = viable ? '' : 'NO PAYLOAD';
  let duty = 1;
  let warpW = 0;

  if (model === 'hohmann') {
    const t = solveHohmann(a, b);
    const oneWay = t.oneWay * sc.rttMult;
    const round = 2 * oneWay;
    const wait = t.local || !isFinite(t.synodic) ? 0 : mod(t.synodic - round, t.synodic);
    rtt = round + wait * (1 - mods.continuity) + overhead;
    duty = windowDuty(oneWay, t.synodic, mods.continuity);
    smoothness = mods.smoothness;
    velocity = distance / Math.max(1, oneWay);
  } else if (model === 'relativistic') {
    const beta = Math.min(mods.betaCap, Math.max(0.002, r.v * mods.betaCap));
    gamma = 1 / Math.sqrt(1 - beta * beta);
    velocity = beta * C * (uni ? uni.c : 1);
    rtt = (2 * distance) / velocity * sc.rttMult + overhead;
    netMult = relativisticNet(beta, mods.crewK, mods.fuelK);
    // Windows do not exist once a ship can hold thrust the whole way.
    smoothness = 1;
    if (netMult <= 0 && viable) {
      viable = false;
      note = 'NO NET';
    }
  } else {
    warpW = Math.max(0.02, r.v * mods.warpCap) * (uni ? uni.c : 1);
    const apparent = warpW * C;
    let closing = apparent;
    if (model === 'comoving' || model === 'brane') {
      // v_rec = H0 * d. Past the Hubble radius this exceeds c on its own, and
      // a warp factor that was ample at 10 Mly closes nothing at all at 20 Gly.
      const rec = H0 * distance * mods.recFactor;
      closing = apparent - rec;
      if (closing <= 0) {
        viable = false;
        note = 'RECEDING';
        closing = 1e-9;
      }
    }
    velocity = closing;
    rtt = (2 * distance) / closing * sc.rttMult + overhead;
    smoothness = 1;
  }

  if (!isFinite(rtt) || rtt <= 0) rtt = overhead;

  const perShipRate = viable ? payloadPerShip / rtt : 0;
  const ships = r.ships;
  const noShips = ships.lte(0);
  if (noShips && !note) note = 'NO TONNAGE';

  const tierMult = Math.pow(1.25, r.tier);
  const nodeValue = 0.5 * (a.valueMult + b.valueMult) * (uni ? uni.alpha : 1);
  const nodeResearch = 0.5 * (a.researchMult + b.researchMult) * (uni ? uni.alpha : 1);

  const flowD = noShips || perShipRate <= 0 ? EMPTY : ships.mul(perShipRate * tierMult);

  const credits = flowD.eq(0) ? EMPTY : flowD
    .mul(kindCreditDensity(r.kind) * nodeValue * netMult * mods.kindMult[r.kind])
    .mul(mods.valueMult);

  const research = r.kind === 'science' && !flowD.eq(0)
    ? flowD.mul(RESEARCH_DENSITY * nodeResearch).mul(mods.researchMult)
    : EMPTY;

  const security = r.kind === 'military' && !flowD.eq(0)
    ? flowD.mul(SECURITY_DENSITY * nodeValue * mods.securityMult).mul(mods.valueMult)
    : EMPTY;

  // Exotic matter: science routes make it, every warp-active route burns it.
  // Consumption is per hull on station, not per delivery — a bubble held open
  // by a ship that is carrying nothing costs exactly as much as a full one.
  let exotic = EMPTY;
  if (era >= 3 && !noShips) {
    if (r.kind === 'science' && !flowD.eq(0)) {
      exotic = flowD.mul(EXOTIC_YIELD * mods.exoticYield);
    }
    if (warpW > 0) {
      const draw = mods.exoticK * warpW * warpW * warpW * sc.bubbleVolume;
      exotic = exotic.sub(ships.mul(draw));
    }
  }

  out.deltaV = deltaV;
  out.distance = distance;
  out.payloadFraction = payloadFraction;
  out.payloadPerShip = payloadPerShip;
  out.rtt = rtt;
  out.throughput = perShipRate * tierMult;
  out.gross = credits;
  out.rate = credits;
  out.research = research;
  out.security = security;
  out.exotic = exotic;
  out.smoothness = smoothness;
  out.velocity = velocity;
  out.gamma = gamma;
  out.netMult = netMult;
  // Duty is only meaningful under Hohmann; it is what the window meter draws.
  out.duty = duty;
  out.viable = viable && !noShips;
  out.note = note;
}

export function emptyCache(): RouteCache {
  return {
    deltaV: 0, distance: 0, payloadFraction: 0, payloadPerShip: 0, rtt: 1,
    throughput: 0, gross: EMPTY, rate: EMPTY, research: EMPTY, security: EMPTY,
    exotic: EMPTY, smoothness: 0, velocity: 0, gamma: 1, netMult: 1, duty: 1,
    viable: false, note: '',
  };
}
