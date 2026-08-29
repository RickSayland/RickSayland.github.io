import { D, Decimal } from '../core/num';
import { Rng, hashStr } from '../core/rng';
import { LY } from './constants';
import type { UniverseConstants, WorldNode } from './types';
import { SOL_NODES } from './data/solNodes';

export interface RegionInfo {
  id: string;
  label: string;
  era: number;
}

export const REGIONS: RegionInfo[] = [
  { id: 'inner', label: 'Inner System', era: 1 },
  { id: 'belt', label: 'Main Belt', era: 1 },
  { id: 'outer', label: 'Outer System', era: 1 },
  { id: 'shell-a', label: 'Solar Neighbourhood', era: 2 },
  { id: 'shell-b', label: 'Inner Shell', era: 2 },
  { id: 'shell-c', label: 'Outer Shell', era: 2 },
  { id: 'orion', label: 'Orion Spur', era: 3 },
  { id: 'perseus', label: 'Perseus Arm', era: 3 },
  { id: 'sagittarius', label: 'Sagittarius Arm', era: 3 },
  { id: 'core', label: 'Galactic Core', era: 3 },
  { id: 'halo', label: 'Halo Clusters', era: 3 },
  { id: 'localgroup', label: 'Local Group', era: 4 },
  { id: 'virgo', label: 'Virgo Supercluster', era: 4 },
  { id: 'laniakea', label: 'Laniakea', era: 4 },
  { id: 'beyond', label: 'Beyond the Horizon', era: 4 },
  { id: 'multiverse', label: 'Adjacent Manifolds', era: 5 },
];

export function regionLabel(id: string): string {
  return REGIONS.find((r) => r.id === id)?.label ?? id;
}

export function regionsForEra(era: number): RegionInfo[] {
  return REGIONS.filter((r) => r.era <= era);
}

// ---------------------------------------------------------------- era 2 ----

interface StarRaw {
  id: string;
  name: string;
  short: string;
  ly: number;
  dv: number;
  value: number;
  research: number;
  hazard: number;
  flavor: string;
}

/**
 * Real stars, real distances. Era 2's whole point is that distance is now the
 * cost, so these numbers have to be the ones the player can look up.
 */
const STARS: StarRaw[] = [
  { id: 'proxima', name: 'Proxima Centauri b', short: 'Proxima', ly: 4.24, dv: 12400, value: 9, research: 4.0, hazard: 0.4, flavor: 'Nearest port of entry outside Sol. Tidally locked; the terminator strip is zoned commercial.' },
  { id: 'alphacen', name: 'Alpha Centauri A', short: 'α Cen A', ly: 4.37, dv: 12600, value: 9.6, research: 3.8, hazard: 0.25, flavor: 'Two suns, one harbourmaster, and a docking fee schedule of legendary complexity.' },
  { id: 'barnard', name: "Barnard's Star", short: 'Barnard', ly: 5.96, dv: 13100, value: 11, research: 4.4, hazard: 0.35, flavor: 'A red dwarf in a hurry. High proper motion means the ephemeris is reissued quarterly.' },
  { id: 'wolf359', name: 'Wolf 359', short: 'Wolf 359', ly: 7.86, dv: 13600, value: 13, research: 4.9, hazard: 0.6, flavor: 'Flare star. Insurance is written per hour and read very carefully.' },
  { id: 'lalande', name: 'Lalande 21185', short: 'Lalande', ly: 8.31, dv: 13700, value: 13.6, research: 4.6, hazard: 0.3, flavor: 'Unremarkable, which in this business is a selling point.' },
  { id: 'sirius', name: 'Sirius B Salvage', short: 'Sirius', ly: 8.6, dv: 15900, value: 16, research: 6.2, hazard: 0.8, flavor: 'A white dwarf with a gravity well like a filing error. Approach fees are punitive.' },
  { id: 'ross154', name: 'Ross 154', short: 'Ross 154', ly: 9.71, dv: 14000, value: 15, research: 5.0, hazard: 0.45, flavor: 'Young, active, and still deciding what kind of star it wants to be.' },
  { id: 'epseri', name: 'Epsilon Eridani', short: 'ε Eridani', ly: 10.5, dv: 14400, value: 18, research: 5.6, hazard: 0.5, flavor: 'Two debris belts. Traffic separation here is genuinely load-bearing.' },
  { id: 'cygni61', name: '61 Cygni', short: '61 Cygni', ly: 11.4, dv: 14600, value: 19, research: 5.4, hazard: 0.3, flavor: 'The first star anyone measured the distance to. It has never let the sector forget it.' },
  { id: 'procyon', name: 'Procyon Transfer', short: 'Procyon', ly: 11.46, dv: 15200, value: 20, research: 5.8, hazard: 0.4, flavor: 'A natural interchange. Half the manifests filed here were never going to stop.' },
  { id: 'tauceti', name: 'Tau Ceti e', short: 'Tau Ceti', ly: 11.9, dv: 14700, value: 22, research: 6.4, hazard: 0.35, flavor: 'The one everybody wanted. Metal-poor, crowded, and permanently short of berths.' },
  { id: 'altair', name: 'Altair Yards', short: 'Altair', ly: 16.7, dv: 15600, value: 27, research: 6.0, hazard: 0.45, flavor: 'Spins so fast it is visibly oblate. The dry docks are aligned to the equator.' },
  { id: 'gliese581', name: 'Gliese 581', short: 'Gliese 581', ly: 20.4, dv: 15900, value: 32, research: 7.2, hazard: 0.55, flavor: 'Four confirmed worlds, three contested claims, and one very tired arbitration panel.' },
  { id: 'gliese667', name: 'Gliese 667 C', short: 'Gl 667C', ly: 23.6, dv: 16200, value: 36, research: 7.6, hazard: 0.5, flavor: 'Triple system. Every schedule here is quoted in three reference frames as a courtesy.' },
  { id: 'vega', name: 'Vega Ring', short: 'Vega', ly: 25.0, dv: 17400, value: 40, research: 8.0, hazard: 0.6, flavor: 'A face-on debris disc and a bright, indifferent star. Excellent for calibration, terrible for parking.' },
  { id: 'fomalhaut', name: 'Fomalhaut Belt', short: 'Fomalhaut', ly: 25.1, dv: 17300, value: 41, research: 8.2, hazard: 0.65, flavor: 'The belt has a sharp inner edge. Something is keeping it that way and nobody has filed what.' },
  { id: 'pollux', name: 'Pollux Terminal', short: 'Pollux', ly: 33.8, dv: 18100, value: 52, research: 8.6, hazard: 0.4, flavor: 'An orange giant with a gas giant on a long leash. The tanks here are the size of moons.' },
  { id: 'trappist', name: 'TRAPPIST-1', short: 'TRAPPIST-1', ly: 40.7, dv: 18600, value: 64, research: 10.5, hazard: 0.7, flavor: 'Seven worlds inside Mercury\'s orbit. Local transfers take hours and the queue takes weeks.' },
  { id: 'upsand', name: 'Upsilon Andromedae', short: 'υ And', ly: 44.0, dv: 18900, value: 70, research: 10.0, hazard: 0.55, flavor: 'Mutually inclined orbits. The traffic model was written twice and both versions are wrong.' },
  { id: 'cancri55', name: '55 Cancri e', short: '55 Cnc', ly: 41.0, dv: 19400, value: 68, research: 11.0, hazard: 0.85, flavor: 'Surface temperature in the thousands. Cargo is rated by how long it survives the manifest.' },
];

function starRegion(ly: number): string {
  return ly < 12 ? 'shell-a' : ly < 30 ? 'shell-b' : 'shell-c';
}

// --------------------------------------------------------- procedural ------

const ARM_NAMES = ['orion', 'perseus', 'sagittarius'] as const;
const ARM_LABEL: Record<string, string> = {
  orion: 'Ori', perseus: 'Per', sagittarius: 'Sgr', core: 'Cor', halo: 'Hal',
};

const CATALOG_PREFIX = ['HD', 'GJ', 'HIP', 'TYC', 'NGC', 'IC', 'PSR', 'WD', 'BD', 'LP'];
const PLACE_A = [
  'Anvil', 'Barrow', 'Candela', 'Dovetail', 'Ember', 'Flint', 'Gantry', 'Harbour',
  'Iron', 'Jetty', 'Keel', 'Lantern', 'Marker', 'Notch', 'Orrery', 'Pallet',
  'Quarry', 'Reach', 'Sounding', 'Tally', 'Undercut', 'Vault', 'Weir', 'Yardarm',
];
const PLACE_B = [
  'Crossing', 'Depot', 'Junction', 'Waypoint', 'Terminal', 'Roads', 'Anchorage',
  'Transit', 'Halt', 'Siding', 'Berth', 'Layover', 'Interchange', 'Bond',
];

/** Flavour is generated too, but from fixed fragments, so it stays deadpan. */
const GEN_FLAVOR = [
  'Filed under general cargo. Nobody has ever inspected it.',
  'Three permanent staff, one of whom is a contractor in dispute.',
  'Berthing is first-come. The queue predates the station.',
  'Tariff schedule inherited from a jurisdiction that no longer exists.',
  'Listed as temporary in the founding charter. That was some time ago.',
  'The beacon works. Everything else is scheduled for review.',
  'Handles bulk volatiles and, on paper, nothing else.',
  'Customs operates on local solar time, which drifts.',
  'A waypoint that acquired a population by accident.',
  'Rated for automated traffic only. The rating is widely ignored.',
  'The survey report runs to nine pages, eight of which are the disclaimer.',
  'Assessed as low-value. The assessment is under appeal.',
];

function genName(rng: Rng, region: string): { name: string; short: string } {
  const style = rng.next();
  const tag = ARM_LABEL[region] ?? 'X';
  if (style < 0.45) {
    const cat = rng.pick(CATALOG_PREFIX);
    const num = rng.int(1000, 99999);
    return { name: `${cat} ${num} ${tag}`, short: `${cat} ${num}` };
  }
  const a = rng.pick(PLACE_A);
  const b = rng.pick(PLACE_B);
  const num = rng.int(2, 89);
  return { name: `${a} ${b} ${num}`, short: `${a} ${num}` };
}

interface EraGenSpec {
  era: number;
  count: number;
  minDist: number;
  maxDist: number;
  surveyBase: number; // log10 of the cheapest survey in the era
  surveySpan: number; // decades of cost across the era's node list
  regions: string[];
}

const GEN_SPECS: EraGenSpec[] = [
  {
    era: 3, count: 900, minDist: 120 * LY, maxDist: 1.1e5 * LY,
    surveyBase: 20, surveySpan: 15,
    regions: ['orion', 'perseus', 'sagittarius', 'core', 'halo'],
  },
  {
    era: 4, count: 260, minDist: 2.5e6 * LY, maxDist: 4.6e10 * LY,
    surveyBase: 37, surveySpan: 16,
    regions: ['localgroup', 'virgo', 'laniakea', 'beyond'],
  },
];

/** Log-uniform, so the node list is dense near home and thins outward. */
function logUniform(rng: Rng, lo: number, hi: number): number {
  const t = rng.next();
  return lo * Math.pow(hi / lo, t);
}

function pickRegion(spec: EraGenSpec, dist: number, rng: Rng): string {
  if (spec.era === 3) {
    const frac = Math.log(dist / spec.minDist) / Math.log(spec.maxDist / spec.minDist);
    const roll = rng.next();
    if (frac > 0.82 && roll < 0.5) return 'halo';
    if (frac > 0.55 && roll < 0.35) return 'core';
    return ARM_NAMES[rng.int(0, 2)]!;
  }
  const frac = Math.log(dist / spec.minDist) / Math.log(spec.maxDist / spec.minDist);
  if (frac < 0.12) return 'localgroup';
  if (frac < 0.35) return 'virgo';
  if (frac < 0.62) return 'laniakea';
  return 'beyond';
}

const ARM_PHASE: Record<string, number> = {
  orion: 0.0, perseus: 2.094, sagittarius: 4.189, core: 1.0, halo: 3.4,
};

function generateEra(spec: EraGenSpec, seed: number): WorldNode[] {
  const rng = new Rng(seed ^ (spec.era * 0x9e3779b9));
  const out: WorldNode[] = [];
  for (let i = 0; i < spec.count; i++) {
    const dist = logUniform(rng, spec.minDist, spec.maxDist);
    const region = pickRegion(spec, dist, rng);
    const { name, short } = genName(rng, region);
    // Logarithmic spiral: theta winds with log radius, so the map draws arms
    // rather than a shell of confetti.
    const wind = spec.era === 3 ? 1.35 : 0.55;
    const theta = (ARM_PHASE[region] ?? 0) + wind * Math.log(dist / spec.minDist) + rng.range(-0.22, 0.22);
    const scarcity = Math.pow(dist / spec.minDist, 0.16);
    const hazard = Math.min(0.95, rng.range(0.15, 0.7) + (region === 'core' || region === 'beyond' ? 0.2 : 0));
    out.push({
      id: `${spec.era}-${i.toString(36)}`,
      name,
      short,
      era: spec.era,
      region,
      dv: Math.round(rng.range(14000, 26000)),
      dist,
      valueMult: scarcity * rng.range(0.7, 1.5) * (spec.era === 3 ? 90 : 4200),
      researchMult: scarcity * rng.range(0.8, 1.6) * (spec.era === 3 ? 16 : 260),
      hazard,
      surveyCost: D(0), // assigned after the era-wide distance sort, below
      mx: Math.cos(theta),
      my: Math.sin(theta),
      flavor: GEN_FLAVOR[rng.int(0, GEN_FLAVOR.length - 1)]!,
    });
  }
  // Survey price follows distance rank, not the roll: the next thing you can
  // afford is always the next thing out, which is what makes the list a ladder.
  out.sort((a, b) => a.dist - b.dist);
  const step = spec.surveySpan / Math.max(1, out.length - 1);
  out.forEach((n, i) => {
    n.surveyCost = Decimal.pow(10, spec.surveyBase + i * step);
  });
  return out;
}

// ---------------------------------------------------------- era 5 ----------

const UNIVERSE_LABELS = [
  'Sheet', 'Fold', 'Leaf', 'Branch', 'Coset', 'Stratum', 'Cover', 'Section',
  'Bundle', 'Chart', 'Atlas', 'Germ',
];

/**
 * Rolled constants are multipliers on the player's whole existing build, which
 * is what makes the endgame a re-evaluation rather than a bigger number: a
 * universe with a low c punishes the propulsion line and rewards structures.
 */
function rollConstants(rng: Rng): UniverseConstants {
  const c = Math.exp(rng.normal(0, 0.9));
  const alpha = Math.exp(rng.normal(0, 0.55));
  const g = Math.exp(rng.normal(0, 0.7));
  const parts: string[] = [];
  parts.push(c > 1.6 ? 'fast light' : c < 0.62 ? 'slow light' : 'nominal c');
  parts.push(alpha > 1.4 ? 'strong coupling' : alpha < 0.72 ? 'weak coupling' : 'nominal α');
  parts.push(g > 1.5 ? 'heavy' : g < 0.68 ? 'light' : 'nominal G');
  return { c, alpha, g, label: parts.join(', ') };
}

function generateUniverses(seed: number): WorldNode[] {
  const rng = new Rng(seed ^ 0x5bf03635);
  const out: WorldNode[] = [];
  const count = 48;
  for (let i = 0; i < count; i++) {
    const consts = rollConstants(rng);
    const label = UNIVERSE_LABELS[i % UNIVERSE_LABELS.length]!;
    const idx = Math.floor(i / UNIVERSE_LABELS.length) + 1;
    const theta = (i / count) * Math.PI * 2 + rng.range(-0.05, 0.05);
    // "Distance" between universes is not a length. It is a mismatch in the
    // metric, and it is quoted in metres only because the forms have that field.
    const dist = 1e27 * Math.pow(10, i * 0.28) * rng.range(0.8, 1.25);
    out.push({
      id: `u-${i.toString(36)}`,
      name: `${label} ${String.fromCharCode(65 + (i % 26))}${idx} — ${consts.label}`,
      short: `${label} ${String.fromCharCode(65 + (i % 26))}${idx}`,
      era: 5,
      region: 'multiverse',
      dv: 20000,
      dist,
      valueMult: 1.4e7 * Math.pow(1.6, i) * consts.alpha,
      researchMult: 9e5 * Math.pow(1.5, i) * consts.alpha,
      hazard: Math.min(0.95, rng.range(0.3, 0.9)),
      surveyCost: Decimal.pow(10, 55 + i * 0.9),
      constants: consts,
      mx: Math.cos(theta),
      my: Math.sin(theta),
      flavor: 'Continuation of the metric is formally undefined. Traffic is nevertheless observed.',
    });
  }
  return out;
}

// ---------------------------------------------------------- registry -------

let registry = new Map<string, WorldNode>();
let ordered: WorldNode[] = [];
let byEra: WorldNode[][] = [];
let builtSeed: number | null = null;

export function initNodes(seed: number): void {
  if (builtSeed === seed && ordered.length) return;
  const stars: WorldNode[] = STARS.map((s) => ({
    id: s.id,
    name: s.name,
    short: s.short,
    era: 2,
    region: starRegion(s.ly),
    dv: s.dv,
    dist: s.ly * LY,
    valueMult: s.value,
    researchMult: s.research,
    hazard: s.hazard,
    surveyCost: Decimal.pow(10, 10 + Math.log10(s.ly / 4) * 6.2),
    mx: Math.cos(hashStr(s.id) % 6283 / 1000),
    my: Math.sin(hashStr(s.id) % 6283 / 1000),
    flavor: s.flavor,
  }));

  ordered = [
    ...SOL_NODES,
    ...stars,
    ...generateEra(GEN_SPECS[0]!, seed),
    ...generateEra(GEN_SPECS[1]!, seed),
    ...generateUniverses(seed),
  ];

  registry = new Map(ordered.map((n) => [n.id, n]));
  byEra = [[], [], [], [], [], []];
  for (const n of ordered) byEra[n.era]!.push(n);
  builtSeed = seed;
}

export function getNode(id: string): WorldNode | undefined {
  return registry.get(id);
}

/** Throws rather than returning undefined: a dangling node id is a bug, not a state. */
export function node(id: string): WorldNode {
  const n = registry.get(id);
  if (!n) throw new Error(`unknown node ${id}`);
  return n;
}

export function allNodes(): readonly WorldNode[] {
  return ordered;
}

export function nodesOfEra(era: number): readonly WorldNode[] {
  return byEra[era] ?? [];
}

/** Every node the player is currently allowed to see in the survey list. */
export function nodesUpToEra(era: number): WorldNode[] {
  const out: WorldNode[] = [];
  for (let e = 1; e <= era; e++) out.push(...(byEra[e] ?? []));
  return out;
}

export const STARTING_NODE = 'leo';
