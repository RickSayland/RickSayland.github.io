import { D, type Decimal } from '../../core/num';

export type TechCat =
  | 'propulsion' | 'ships' | 'operations' | 'markets' | 'security' | 'automation' | 'era';

export interface Tech {
  id: string;
  name: string;
  cat: TechCat;
  era: number;
  cost: Decimal;
  req: string[];
  /** Set only on the four era gates. Buying it makes a Recharter available. */
  unlocksEra?: number;
  desc: string;
}

/**
 * One-shot technologies, bought with Research, kept across every Recharter.
 * Research is the only progress that a Recharter does not touch, which is what
 * makes science routes worth building on a charter you are about to burn.
 */
export const TECHS: Tech[] = [
  // ---------------------------------------------------------------- era 1 ---
  {
    id: 'ship-hauler', name: 'Bulk Hauler Certification', cat: 'ships', era: 1,
    cost: D(6), req: [],
    desc: 'Licenses a hull six times the size of a lighter, at twice the structural fraction. A bargain inside Mars and a liability past Ceres.',
  },
  {
    id: 'eng-ntr', name: 'Nuclear Thermal Rocket', cat: 'propulsion', era: 1,
    cost: D(14), req: [],
    desc: 'Exhaust velocity floor rises to 9.0 km/s. Roughly doubles what a chemical stack can put on a Mars manifest.',
  },
  {
    id: 'ship-courier', name: 'Fast Courier Certification', cat: 'ships', era: 1,
    cost: D(34), req: ['eng-ntr'],
    desc: 'A light, low-structure hull that cycles twice as often. Carries almost nothing per trip and makes very many trips.',
  },
  {
    id: 'ops-stagger', name: 'Departure Staggering', cat: 'operations', era: 1,
    cost: D(70), req: ['eng-ntr'],
    desc: 'Disperses a route\'s fleet around its cycle. Average throughput is unchanged; the payout stops arriving all at once.',
  },
  {
    id: 'traj-continuous', name: 'Continuous-Thrust Trajectories', cat: 'operations', era: 1,
    cost: D(180), req: ['eng-ntr'],
    desc: 'Low-thrust spirals instead of impulsive burns. Removes 45% of the wait for a return window. The first real relief from the synodic period.',
  },
  {
    id: 'eng-ion', name: 'Gridded Ion Drive', cat: 'propulsion', era: 1,
    cost: D(450), req: ['eng-ntr'],
    desc: 'Exhaust velocity floor 30 km/s. The belt becomes reachable with payload still on board.',
  },
  {
    id: 'mkt-broker', name: 'Brokerage Licence', cat: 'markets', era: 1,
    cost: D(800), req: [],
    desc: 'Unlocks the per-kind market upgrades. Trade, science and military can now be priced separately.',
  },
  {
    id: 'sec-doctrine', name: 'Escort Doctrine', cat: 'security', era: 1,
    cost: D(1400), req: [],
    desc: 'Triples the Security a military route generates. Security is the only thing that holds Interdiction down.',
  },
  {
    id: 'ship-freighter', name: 'Heavy Freighter Certification', cat: 'ships', era: 1,
    cost: D(3000), req: ['eng-ion', 'ship-hauler'],
    desc: 'Orbit-built bulk. Thirty-five times a lighter\'s mass and never enters an atmosphere.',
  },
  {
    id: 'traj-cycler', name: 'Cycler Infrastructure', cat: 'operations', era: 1,
    cost: D(7000), req: ['traj-continuous'],
    desc: 'Permanent cycling stations on free-return trajectories. The return window disappears entirely: a route now pays the moment it can carry anything.',
  },
  {
    id: 'eng-vasimr', name: 'Variable Specific Impulse Plasma', cat: 'propulsion', era: 1,
    cost: D(1.4e4), req: ['eng-ion'],
    desc: 'Exhaust velocity floor 50 km/s, with thrust traded against efficiency in flight.',
  },
  {
    id: 'ops-control', name: 'Unified Traffic Control', cat: 'operations', era: 1,
    cost: D(3.6e4), req: ['ops-stagger', 'traj-cycler'],
    desc: 'One schedule for the whole authority. Pushes fleet staggering most of the rest of the way to continuous flow.',
  },
  {
    id: 'ship-clipper', name: 'Torch Clipper Certification', cat: 'ships', era: 1,
    cost: D(9e4), req: ['eng-vasimr'],
    desc: 'Burns continuously and ignores transfer windows. Mostly radiator; the cargo bay is an afterthought and it does not matter.',
  },
  {
    id: 'sec-treaty', name: 'Traffic Convention', cat: 'security', era: 1,
    cost: D(1.8e5), req: ['sec-doctrine'],
    desc: 'One further order of magnitude of unpoliced economy before Interdiction begins to bite.',
  },
  {
    id: 'eng-fusion', name: 'Fusion Torch', cat: 'propulsion', era: 1,
    cost: D(5e5), req: ['eng-vasimr'],
    desc: 'Exhaust velocity floor 1 000 km/s. The rocket equation stops binding anywhere in Sol — and the round-trip time, which no engine fixes, becomes the whole problem.',
  },
  {
    id: 'auto-assign', name: 'Delegated Tonnage Assignment', cat: 'automation', era: 1,
    cost: D(1.2e6), req: ['ops-control'],
    desc: 'Routes flagged for automation buy their own ships out of surplus credits. Requires Delegated Scheduling to act at any useful rate.',
  },
  {
    id: 'era2-relativistic', name: 'Relativistic Drives', cat: 'era', era: 1,
    cost: D(6e6), req: ['eng-fusion', 'traj-cycler'], unlocksEra: 2,
    desc: 'Sustained acceleration to a meaningful fraction of c. Transfer windows cease to exist and distance becomes the cost. File a Recharter to begin operating under it.',
  },

  // ---------------------------------------------------------------- era 2 ---
  {
    id: 'eng-antimatter', name: 'Antimatter Catalysis', cat: 'propulsion', era: 2,
    cost: D(3e8), req: ['era2-relativistic'],
    desc: 'Exhaust velocity floor 25 000 km/s. Structural fraction is now the only term left in the payload equation.',
  },
  {
    id: 'ship-starliner', name: 'Relativistic Liner Certification', cat: 'ships', era: 2,
    cost: D(7e8), req: ['era2-relativistic'],
    desc: 'Heavy interstellar bulk with a forward shield. At 0.9c a dust grain arrives as an explosion.',
  },
  {
    id: 'rel-optimizer', name: 'Velocity Optimisation Board', cat: 'operations', era: 2,
    cost: D(6e9), req: ['era2-relativistic'],
    desc: 'Solves each route for the velocity that maximises net income and holds it there. The optimum moves whenever fuel or crew costs change.',
  },
  {
    id: 'ship-needle', name: 'Ramscoop Needle Certification', cat: 'ships', era: 2,
    cost: D(5e9), req: ['eng-antimatter'],
    desc: 'Collects reaction mass in transit. Very low structure, very high vₑ, negligible hold.',
  },
  {
    id: 'auto-survey', name: 'Standing Survey Authority', cat: 'automation', era: 2,
    cost: D(1.1e10), req: ['auto-assign'],
    desc: 'Surveys the cheapest unsurveyed endpoint automatically whenever it is comfortably affordable.',
  },
  {
    id: 'era3-metric', name: 'Metric Engineering', cat: 'era', era: 2,
    cost: D(3e11), req: ['eng-antimatter', 'ship-needle'], unlocksEra: 3,
    desc: 'Apparent velocity is no longer bounded by c, because nothing is moving through space. Requires negative energy density, continuously, forever.',
  },

  // ---------------------------------------------------------------- era 3 ---
  {
    id: 'ship-bubble', name: 'Bubble Freighter Certification', cat: 'ships', era: 3,
    cost: D(7e13), req: ['era3-metric'],
    desc: 'Half a million tonnes inside a warp shell. Upkeep scales with the bubble, not the cargo, so you want it full.',
  },
  {
    id: 'exotic-synthesis', name: 'Exotic Matter Synthesis', cat: 'markets', era: 3,
    cost: D(3e14), req: ['era3-metric'],
    desc: 'Quadruples exotic matter yield from science routes. Every warp-active route consumes it continuously; run out and the whole network throttles.',
  },
  {
    id: 'ship-skiff', name: 'Metric Skiff Certification', cat: 'ships', era: 3,
    cost: D(1e15), req: ['ship-bubble'],
    desc: 'Almost no hull inside a very large bubble. Fast, cheap to build, ruinous to run.',
  },
  {
    id: 'auto-charter', name: 'Standing Charter Authority', cat: 'automation', era: 3,
    cost: D(8e15), req: ['auto-survey'],
    desc: 'Charters routes to newly surveyed endpoints without being asked, using the current template.',
  },
  {
    id: 'templates', name: 'Route Templates', cat: 'automation', era: 3,
    cost: D(4e16), req: ['auto-charter'],
    desc: 'Fixes the kind, hull and velocity every automatic charter is issued with. By this point you are setting policy, not routes.',
  },
  {
    id: 'era4-intergalactic', name: 'Intergalactic Charter', cat: 'era', era: 3,
    cost: D(9e17), req: ['ship-skiff', 'exotic-synthesis'], unlocksEra: 4,
    desc: 'Extends the authority beyond the galaxy, where the destination is not merely far away but actively leaving.',
  },

  // ---------------------------------------------------------------- era 4 ---
  {
    id: 'ship-arkline', name: 'Comoving Arkline Certification', cat: 'ships', era: 4,
    cost: D(4e22), req: ['era4-intergalactic'],
    desc: 'Built to hold station against the Hubble flow. Enormous, and the only hull that pays past the Virgo cluster.',
  },
  {
    id: 'horizon-survey', name: 'Horizon Survey Programme', cat: 'markets', era: 4,
    cost: D(1e24), req: ['era4-intergalactic'],
    desc: 'Halves effective recession velocity on every route. Does not slow the expansion — it stops you paying for it twice.',
  },
  {
    id: 'auto-full', name: 'Autonomous Route Authority', cat: 'automation', era: 4,
    cost: D(8e25), req: ['templates'],
    desc: 'Survey, charter, crew and tune, without instruction. The office is now a formality and the formality is the job.',
  },
  {
    id: 'era5-multiversal', name: 'Multiversal Routing', cat: 'era', era: 4,
    cost: D(3e28), req: ['ship-arkline', 'horizon-survey'], unlocksEra: 5,
    desc: 'Expansion research returns anomalous correlations across the horizon. The metric is not simply connected. There is traffic between universes, and it is unregulated.',
  },

  // ---------------------------------------------------------------- era 5 ---
  {
    id: 'ship-braneferry', name: 'Brane Ferry Certification', cat: 'ships', era: 5,
    cost: D(2e34), req: ['era5-multiversal'],
    desc: 'A hull that exists in two universes and is taxed in neither. The forms for this remain in draft.',
  },
  {
    id: 'fx-arbitrage', name: 'Clearing House', cat: 'markets', era: 5,
    cost: D(9e35), req: ['era5-multiversal'],
    desc: 'Universes price a kilogram differently and the rates drift. Shows the spread, and takes a cut of it automatically.',
  },
  {
    id: 'terminus', name: 'Terminus Filing', cat: 'era', era: 5,
    cost: D(5e40), req: ['ship-braneferry', 'fx-arbitrage'],
    desc: 'A complete and final schedule of all traffic, in every universe surveyed, in perpetuity. Filing it concludes the charter.',
  },
];

const BY_ID = new Map(TECHS.map((t) => [t.id, t]));
export function tech(id: string): Tech {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`unknown tech ${id}`);
  return t;
}
export function getTech(id: string): Tech | undefined {
  return BY_ID.get(id);
}

/** Exhaust-velocity floors, m/s. The propulsion percentage stacks on top. */
export const ENGINE_FLOORS: { tech: string; ve: number; label: string }[] = [
  { tech: '', ve: 4400, label: 'Chemical' },
  { tech: 'eng-ntr', ve: 9000, label: 'Nuclear Thermal' },
  { tech: 'eng-ion', ve: 30000, label: 'Gridded Ion' },
  { tech: 'eng-vasimr', ve: 50000, label: 'VASIMR' },
  { tech: 'eng-fusion', ve: 1.0e6, label: 'Fusion Torch' },
  { tech: 'eng-antimatter', ve: 2.5e7, label: 'Antimatter' },
];
