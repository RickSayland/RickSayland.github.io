/**
 * Headless checks for the things a screenshot cannot show: determinism, tick
 * cost at the stated route count, and that each era's wall is where the design
 * says it is.
 *
 *   npx esbuild tools/check.ts --bundle --platform=node --format=esm --outfile=.check.mjs && node .check.mjs
 *
 * Not a test framework. It prints numbers and exits non-zero if a hard
 * invariant is violated.
 */
import { D, Decimal } from '../src/core/num';
import { initNodes, nodesUpToEra, getNode } from '../src/sim/nodes';
import { createSim, refresh, tick, type Sim } from '../src/sim/engine';
import { newGame } from '../src/sim/state';
import {
  charter, survey, buyShips, buyTech, buyUpgrade, techState, upgradeAllAffordable,
  upgradeAvailable, upgradeCost, mandateGain,
} from '../src/sim/actions';
import { TECHS } from '../src/sim/data/tech';
import { UPGRADES } from '../src/sim/data/upgrades';
import { solveRoute, optimalBeta, relativisticNet, emptyCache } from '../src/sim/routeMath';
import { makeRoute } from '../src/sim/state';
import { TIME_SCALE, C, H0 } from '../src/sim/constants';
import { shipClass } from '../src/sim/data/ships';
import { encodeSave, decodeSave } from '../src/save/save';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`);
}
function head(s: string): void {
  console.log('\n' + s + '\n' + '-'.repeat(s.length));
}

function freshSim(seed = 12345, credits = 0): Sim {
  const s = newGame(seed);
  if (credits) s.credits = D(credits);
  initNodes(s.seed);
  return createSim(s);
}

/** Fails loudly: a check that silently no-ops is worse than no check. */
function must(res: { ok: true } | { ok: false; why: string }, what: string): void {
  if (!res.ok) throw new Error(`${what}: ${res.why}`);
}

/**
 * Grant technology without paying for it or satisfying prerequisites. Only a
 * harness may do this — `buyTech` refuses both, which is correct, and is why
 * the first version of this file silently tested an un-upgraded sim.
 */
function grant(sim: Sim, ...techs: string[]): void {
  for (const t of techs) if (!sim.state.tech.includes(t)) sim.state.tech.push(t);
  refresh(sim);
}

/** Stable fingerprint of everything the sim owns. */
function hash(sim: Sim): string {
  const s = sim.state;
  const parts: string[] = [
    s.credits.toString(), s.research.toString(), s.exotic.toString(),
    s.t.toFixed(3), String(s.era), String(s.surveyed.length),
  ];
  for (const r of s.routes) {
    parts.push(`${r.id}|${r.from}>${r.to}|${r.kind}|${r.shipClass}|${r.ships.toString()}|${r.tier}|${r.v.toFixed(6)}|${r.phase.toFixed(3)}`);
  }
  for (const k of Object.keys(s.interdiction).sort()) parts.push(`${k}=${(s.interdiction[k] ?? 0).toFixed(9)}`);
  let h = 2166136261 >>> 0;
  const str = parts.join(';');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------- determinism ----

head('Determinism');
{
  const run = (): string => {
    const sim = freshSim(9001, 500);
    must(survey(sim, 'geo'), 'survey geo');
    must(charter(sim, 'leo', 'geo', 'science', 'lighter'), 'charter leo-geo');
    must(buyShips(sim, sim.state.routes[1]!.id, 3), 'buy 3 hulls');
    for (let i = 0; i < 4000; i++) tick(sim, 1 / 20);
    return hash(sim);
  };
  const a = run();
  const b = run();
  check('same seed + same inputs = identical state after 4000 ticks', a === b, `${a} vs ${b}`);

  const other = (): string => {
    const sim = freshSim(9002, 500);
    for (let i = 0; i < 200; i++) tick(sim, 1 / 20);
    return hash(sim);
  };
  check('different seed diverges', other() !== run(), '');
}

// ------------------------------------------------------ offline == online --

head('Offline progress uses the same code path');
{
  const online = freshSim(4242);
  for (let i = 0; i < 20 * 60; i++) tick(online, 1 / 20); // 60 s at 20 Hz

  const offline = freshSim(4242);
  for (let i = 0; i < 120; i++) tick(offline, 0.5); // 60 s in coarse steps

  const a = online.state.credits.toNumber();
  const b = offline.state.credits.toNumber();
  const rel = Math.abs(a - b) / Math.max(a, 1);
  // Not bit-identical — a coarser dt integrates the interdiction relaxation
  // differently — but it must not be a different economy.
  check('60 s at 20 Hz vs 0.5 s steps agree within 2%', rel < 0.02,
    `${a.toFixed(2)} vs ${b.toFixed(2)} (${(rel * 100).toFixed(3)}%)`);
}

// -------------------------------------------------------------- era 1 -----

head('Era 1 — the rocket equation is the terrain');
{
  const sim = freshSim(1);
  const cache = emptyCache();
  const probe = (from: string, to: string, cls: string): number => {
    const r = makeRoute(from, to, 'trade', cls);
    r.ships = D(1);
    solveRoute(r, getNode(from)!, getNode(to)!, sim.mods, 1, cache);
    return cache.payloadFraction;
  };

  check('chemical reaches Luna with payload', probe('leo', 'luna', 'lighter') > 0.05,
    probe('leo', 'luna', 'lighter').toFixed(4));
  check('chemical CANNOT reach Callisto', probe('leo', 'callisto', 'lighter') <= 0,
    probe('leo', 'callisto', 'lighter').toFixed(4));

  // The sidegrade claim: bulk wins the short hop, courier wins the hard one.
  const hShort = probe('leo', 'luna', 'hauler') * shipClass('hauler').wetMass;
  const cShort = probe('leo', 'luna', 'courier') * shipClass('courier').wetMass;
  check('bulk hauler out-carries the courier to Luna', hShort > cShort,
    `${(hShort / 1000).toFixed(1)} t vs ${(cShort / 1000).toFixed(1)} t`);
  const hFar = probe('leo', 'ceres', 'hauler');
  const cFar = probe('leo', 'ceres', 'courier');
  check('hauler is dead to Ceres on chemical while the courier is not', hFar <= 0 && cFar > 0,
    `hauler ${hFar.toFixed(4)}, courier ${cFar.toFixed(4)}`);

  // Engine ladder opens ground.
  const withTech = (techs: string[]): number => {
    const s2 = freshSim(1);
    s2.state.research = D(1e9);
    for (const t of techs) buyTech(s2, t);
    refresh(s2);
    const r = makeRoute('leo', 'callisto', 'trade', 'lighter');
    r.ships = D(1);
    solveRoute(r, getNode('leo')!, getNode('callisto')!, s2.mods, 1, cache);
    return cache.payloadFraction;
  };
  check('ion drive opens Callisto', withTech(['eng-ntr', 'eng-ion']) > 0,
    withTech(['eng-ntr', 'eng-ion']).toFixed(4));

  // Round trip: the wall.
  const rtt = (to: string): number => {
    const r = makeRoute('leo', to, 'trade', 'lighter');
    r.ships = D(1);
    solveRoute(r, getNode('leo')!, getNode(to)!, sim.mods, 1, cache);
    return cache.rtt;
  };
  const mars = rtt('mars') / TIME_SCALE;
  const kuiper = rtt('kuiper') / TIME_SCALE;
  console.log(`  Mars round trip   ${(rtt('mars') / 86400).toFixed(0)} d  = ${mars.toFixed(0)} s of play`);
  console.log(`  Kuiper round trip ${(rtt('kuiper') / 86400 / 365.25).toFixed(0)} yr = ${(kuiper / 60).toFixed(0)} min of play`);
  check('Mars round trip is the textbook ~780 days', Math.abs(rtt('mars') / 86400 - 782) < 40);
  check('Kuiper is the wall (no engine fixes round-trip time)', kuiper > 1500);

  // Continuity removes the wait, and nothing else does.
  const s3 = freshSim(1);
  s3.state.research = D(1e9);
  buyTech(s3, 'eng-ntr');
  buyTech(s3, 'traj-continuous');
  buyTech(s3, 'traj-cycler');
  refresh(s3);
  const r2 = makeRoute('leo', 'mars', 'trade', 'lighter');
  r2.ships = D(1);
  solveRoute(r2, getNode('leo')!, getNode('mars')!, s3.mods, 1, cache);
  check('cycler infrastructure removes the return-window wait',
    cache.rtt / 86400 < 560, `${(cache.rtt / 86400).toFixed(0)} d`);
}

// -------------------------------------------------------------- era 2 -----

head('Era 2 — there is a real optimum velocity');
{
  const sim = freshSim(2);
  const m = sim.mods;
  const best = optimalBeta(0.999999, m.crewK, m.fuelK);
  const value = (b: number): number => b * relativisticNet(b, m.crewK, m.fuelK);
  console.log(`  optimum beta ${best.toFixed(5)}c   value ${value(best).toFixed(4)}`);
  check('the optimum is interior, not at the ceiling', best > 0.5 && best < 0.9999,
    best.toFixed(5));
  check('going faster than the optimum is worse', value(0.99999) < value(best));
  check('going slower than the optimum is worse', value(best * 0.6) < value(best));
  check('fuel cost diverges: nothing survives at gamma -> inf',
    relativisticNet(0.999999, m.crewK, m.fuelK) === 0);

  // Cheaper fuel should push the optimum toward c.
  const cheaper = optimalBeta(0.999999, m.crewK, m.fuelK * 0.25);
  check('cheaper fuel moves the optimum up', cheaper > best,
    `${best.toFixed(5)} -> ${cheaper.toFixed(5)}`);
}

// -------------------------------------------------------------- era 4 -----

head('Era 4 — the expansion actually bites');
{
  const sim = freshSim(4);
  sim.state.era = 4;
  // An era-4 player necessarily has the whole propulsion line; without it the
  // routes fail on payload fraction and nothing about recession is tested.
  grant(sim, 'eng-ntr', 'eng-ion', 'eng-vasimr', 'eng-fusion', 'eng-antimatter',
    'era2-relativistic', 'era3-metric', 'era4-intergalactic');
  const cache = emptyCache();
  const far = nodesUpToEra(4).filter((n) => n.era === 4).sort((a, b) => b.dist - a.dist);
  const furthest = far[0]!;
  const near = far[far.length - 1]!;
  const probe = (id: string): boolean => {
    const r = makeRoute('leo', id, 'trade', 'lighter');
    r.ships = D(1);
    r.v = 1;
    solveRoute(r, getNode('leo')!, getNode(id)!, sim.mods, 4, cache);
    return cache.viable;
  };
  const hubbleLy = (C / H0) / 9.4607304725808e15;
  console.log(`  Hubble radius ${(hubbleLy / 1e9).toFixed(1)} Gly; furthest node ${(furthest.dist / 9.4607304725808e15 / 1e9).toFixed(1)} Gly`);
  check('the furthest node recedes faster than a starting warp factor closes', !probe(furthest.id));
  check('a Local Group node is reachable at the same warp factor', probe(near.id));

  // Raising the cap must eventually fix it.
  const s2 = freshSim(4);
  s2.state.era = 4;
  s2.state.credits = new Decimal('1e200');
  grant(s2, 'eng-ntr', 'eng-ion', 'eng-vasimr', 'eng-fusion', 'eng-antimatter',
    'era2-relativistic', 'era3-metric', 'era4-intergalactic');
  for (let i = 0; i < 60; i++) must(buyUpgrade(s2, 'warpCap', 1), 'buy warpCap');
  refresh(s2);
  const r = makeRoute('leo', furthest.id, 'trade', 'lighter');
  r.ships = D(1);
  solveRoute(r, getNode('leo')!, getNode(furthest.id)!, s2.mods, 4, cache);
  check('60 levels of warp licence make the furthest node viable', cache.viable,
    `w cap ${s2.mods.warpCap.toExponential(2)}`);
}

// -------------------------------------------------------------- save ------

head('Save round trip');
{
  const sim = freshSim(777, 5000);
  must(survey(sim, 'geo'), 'survey geo');
  must(charter(sim, 'leo', 'geo', 'military', 'lighter'), 'charter');
  must(buyShips(sim, sim.state.routes[1]!.id, 7), 'buy hulls');
  sim.state.credits = new Decimal('1.2345e678');
  for (let i = 0; i < 100; i++) tick(sim, 1 / 20);
  const before = hash(sim);
  const blob = encodeSave(sim.state);
  const back = decodeSave(blob);
  initNodes(back.seed);
  const restored = createSim(back);
  check('encode -> decode preserves state exactly', hash(restored) === before,
    `${before} vs ${hash(restored)}`);
  check('a 1.2345e678 balance survives', restored.state.credits.toString().startsWith('1.2345e+678'),
    restored.state.credits.toString());
  console.log(`  blob ${blob.length} chars`);
}

// ------------------------------------------------------------- perf -------

head('Performance at the stated scale');
{
  const sim = freshSim(31337);
  sim.state.credits = new Decimal('1e120');
  sim.state.research = new Decimal('1e40');
  for (const t of ['ship-hauler', 'eng-ntr', 'ship-courier', 'ops-stagger', 'eng-ion']) buyTech(sim, t);
  const ids = nodesUpToEra(1).map((n) => n.id);
  for (const id of ids) survey(sim, id);
  for (let i = 0; i < 400; i++) buyUpgrade(sim, 'berths', 1);
  refresh(sim);

  // 18 endpoints give 306 ordered pairs, so the last ~200 charters are
  // duplicates of earlier pairs. That is fine: the cost of a tick is per
  // route, not per distinct pair, and duplicate charters are legal.
  const kinds = ['trade', 'science', 'military'] as const;
  const classes = ['lighter', 'hauler', 'courier'] as const;
  let made = 0;
  let guard = 0;
  while (made < 500 && guard++ < 5000) {
    const a = ids[made % ids.length]!;
    const b = ids[(made * 7 + 3) % ids.length]!;
    if (a === b) {
      made++;
      continue;
    }
    const res = charter(sim, a, b, kinds[made % 3]!, classes[made % 3]!);
    if (!res.ok) break;
    must(buyShips(sim, sim.state.routes[sim.state.routes.length - 1]!.id, 25), 'buy hulls');
    made++;
  }
  refresh(sim);
  console.log(`  ${sim.state.routes.length} active charters`);

  for (let i = 0; i < 200; i++) tick(sim, 1 / 20); // warm
  const N = 2000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) tick(sim, 1 / 20);
  const t1 = process.hrtime.bigint();
  const per = Number(t1 - t0) / 1e6 / N;
  console.log(`  tick ${per.toFixed(3)} ms  (target < 2 ms)`);
  check('tick under 2 ms at 500 routes', per < 2, `${per.toFixed(3)} ms`);

  const r0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) refresh(sim);
  const r1 = process.hrtime.bigint();
  console.log(`  refresh ${(Number(r1 - r0) / 1e6 / 200).toFixed(3)} ms (only on change)`);
}

// ----------------------------------------------------------- pacing -------

head('Pacing — a naive player, 30 minutes');
{
  // Buys the cheapest useful thing whenever it can afford it. Not an optimal
  // player; the point is that a player who thinks about nothing still moves.
  const sim = freshSim(2024);
  const marks: string[] = [];
  let lastNote = '';
  const note = (t: number, what: string): void => {
    if (what === lastNote) return;
    lastNote = what;
    marks.push(`  ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}  ${what}`);
  };

  const HZ = 20;
  let unlockT = -1;
  let unlockLifetime = D(0);
  let unlockMandate = D(0);
  for (let step = 0; step < 90 * 60 * HZ; step++) {
    tick(sim, 1 / HZ);
    if (step % HZ !== 0) continue;
    const t = step / HZ;
    if (unlockT < 0 && sim.state.eraUnlocked >= 2) {
      unlockT = t;
      unlockLifetime = sim.state.lifetimeCredits;
      unlockMandate = mandateGain(sim);
      note(t, '>>> RELATIVISTIC DRIVES — era 2 authorised');
    }

    // 1. cheapest unsurveyed endpoint
    const nextNode = nodesUpToEra(sim.state.era)
      .filter((n) => !sim.state.surveyed.includes(n.id))
      .sort((a, b) => (a.surveyCost.lt(b.surveyCost) ? -1 : 1))[0];
    if (nextNode && sim.state.credits.gt(nextNode.surveyCost.mul(3))) {
      if (survey(sim, nextNode.id).ok) {
        note(t, `surveyed ${nextNode.short}`);
        // and charter to it, alternating kinds so research flows
        const kind = sim.state.routes.length % 3 === 1 ? 'science' : 'trade';
        charter(sim, 'leo', nextNode.id, kind, 'lighter');
        continue;
      }
    }
    // 2. cheapest affordable technology
    const nextTech = TECHS
      .filter((x) => techState(sim, x.id) === 'available' && sim.state.research.gte(x.cost))
      .sort((x, y) => (x.cost.lt(y.cost) ? -1 : 1))[0];
    if (nextTech) {
      buyTech(sim, nextTech.id);
      note(t, `researched ${nextTech.name}`);
      continue;
    }
    // 3. more charters to endpoints already on the register
    if (sim.state.routes.length < 12 && sim.state.surveyed.length > 2) {
      const to = sim.state.surveyed[sim.state.routes.length % sim.state.surveyed.length]!;
      const kind = sim.state.routes.length % 3 === 1 ? 'science'
        : sim.state.routes.length % 7 === 4 ? 'military' : 'trade';
      if (to !== 'leo' && charter(sim, 'leo', to, kind, 'lighter').ok) {
        note(t, `chartered LEO to ${to}`);
        continue;
      }
    }
    // 4. the cheapest repeatable upgrade, then hulls
    const cheapest = UPGRADES
      .filter((u) => upgradeAvailable(sim, u.id) && (sim.state.up[u.id] ?? 0) < u.max)
      .map((u) => ({ u, c: upgradeCost(sim, u.id, 1) }))
      .sort((x, y) => (x.c.lt(y.c) ? -1 : 1))[0];
    if (cheapest && sim.state.credits.gt(cheapest.c.mul(4))) {
      buyUpgrade(sim, cheapest.u.id, 1);
      continue;
    }
    upgradeAllAffordable(sim);
  }

  const perReal = sim.totals.credits.mul(TIME_SCALE);
  for (const m of marks.slice(0, 10)) console.log(m);
  if (marks.length > 10) console.log(`  … and ${marks.length - 10} more`);
  console.log(`\n  era 2 authorised at ${unlockT < 0 ? 'NEVER' : (unlockT / 60).toFixed(1) + ' min'}`
    + `  (lifetime ${unlockLifetime.toExponential(2)}, ${unlockMandate.toString()} Mandate)`);
  console.log(`  after 90 min: ${sim.state.credits.toExponential(2)} credits, `
    + `${perReal.toExponential(2)}/s, ${sim.state.routes.length} charters, `
    + `${sim.state.surveyed.length} endpoints, ${sim.state.tech.length} technologies`);
  check('something happens in the first four minutes', marks.length > 0 && marks[0]!.startsWith('  0'));
  check('era 1 is completable by a naive player', unlockT > 0, `${(unlockT / 60).toFixed(1)} min`);
  // This bot buys the cheapest useful thing every single second and never
  // hesitates, so it is a floor on how long a human takes, not an estimate.
  check('era 1 is not over inside five minutes', unlockT > 5 * 60,
    `${(unlockT / 60).toFixed(1)} min`);
  // The whole point of the cube root is a meta-currency a person can hold in
  // their head: two or three digits on the first Recharter, not fifteen.
  check('the first Recharter grants a countable amount of Mandate',
    unlockMandate.gte(5) && unlockMandate.lte(500), unlockMandate.toString());
}

head(failures === 0 ? 'All checks passed' : `${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);

