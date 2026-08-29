import { D } from '../../core/num';
import { AU, DAY } from '../constants';
import type { WorldNode } from '../types';

interface Raw {
  id: string;
  name: string;
  short: string;
  region: string;
  parent: string;
  a: number; // AU
  local: number; // days inside the parent system
  dv: number; // m/s from LEO
  value: number;
  research: number;
  hazard: number;
  survey: number;
  angle: number; // where it sits on the orbital diagram
  flavor: string;
}

/**
 * Eighteen endpoints. Delta-v is the terrain of era 1, so these numbers are the
 * level design: everything past Ceres is unreachable on chemical propulsion
 * because exp(-dv/ve) drops under the structural fraction and the payload
 * fraction goes negative. The player does not need to be told that; the route
 * simply reports NO PAYLOAD until the engine line catches up.
 */
const RAW: Raw[] = [
  {
    id: 'leo', name: 'Low Earth Orbit', short: 'LEO', region: 'inner', parent: 'earth',
    a: 1.0, local: 0, dv: 0, value: 1.0, research: 1.0, hazard: 0.02, survey: 0, angle: 0.0,
    flavor: 'Origin of record for all tonnage. Congested, litigious, and the only place anyone files on time.',
  },
  {
    id: 'geo', name: 'Geostationary Belt', short: 'GEO', region: 'inner', parent: 'earth',
    a: 1.0, local: 0.6, dv: 3900, value: 1.05, research: 1.1, hazard: 0.05, survey: 25, angle: 0.35,
    flavor: 'Slot allocation is handled by a treaty body that has not met since the incident.',
  },
  {
    id: 'luna', name: 'Luna — Shackleton', short: 'Luna', region: 'inner', parent: 'earth',
    a: 1.0, local: 3.2, dv: 5900, value: 1.18, research: 1.3, hazard: 0.08, survey: 70, angle: 0.9,
    flavor: 'Water, regolith, and a customs shed with a view. Nothing here is exciting, which is the point.',
  },
  {
    id: 'neo', name: 'Apophis Yard', short: 'NEO', region: 'inner', parent: 'sun',
    a: 1.12, local: 0, dv: 4300, value: 1.4, research: 1.5, hazard: 0.22, survey: 320, angle: 1.6,
    flavor: 'A drifting scrapyard of near-Earth rocks. Ownership disputes are settled by whoever is docked.',
  },
  {
    id: 'venus', name: 'Cloud Nine Aerostat', short: 'Venus', region: 'inner', parent: 'sun',
    a: 0.723, local: 0, dv: 6500, value: 1.55, research: 2.2, hazard: 0.55, survey: 2600, angle: 2.4,
    flavor: 'Fifty kilometres up it is shirtsleeves weather. Below that it is a filing cabinet on fire.',
  },
  {
    id: 'mars', name: 'Arcadia Terminal', short: 'Mars', region: 'inner', parent: 'sun',
    a: 1.524, local: 0, dv: 6100, value: 1.65, research: 1.8, hazard: 0.2, survey: 1100, angle: 3.1,
    flavor: 'Population sufficient to generate paperwork. Windows open every 26 months, punctually.',
  },
  {
    id: 'phobos', name: 'Phobos Depot', short: 'Phobos', region: 'inner', parent: 'mars',
    a: 1.524, local: 1.0, dv: 5700, value: 1.75, research: 1.9, hazard: 0.18, survey: 3400, angle: 3.2,
    flavor: 'Cheaper to reach than the planet it orbits. The tariff schedule has never acknowledged this.',
  },
  {
    id: 'mercury', name: 'Caloris Foundry', short: 'Mercury', region: 'inner', parent: 'sun',
    a: 0.387, local: 0, dv: 13100, value: 2.1, research: 2.0, hazard: 0.62, survey: 1.9e5, angle: 4.2,
    flavor: 'Unlimited insolation, unlimited metal, no shade. Shift rotations are measured in minutes.',
  },
  {
    id: 'vesta', name: 'Vesta Assay', short: 'Vesta', region: 'belt', parent: 'sun',
    a: 2.362, local: 0, dv: 9300, value: 2.25, research: 2.1, hazard: 0.3, survey: 6.5e4, angle: 5.0,
    flavor: 'Differentiated, which means the good metal is where the survey said it would be. Rare.',
  },
  {
    id: 'ceres', name: 'Ceres Waypoint', short: 'Ceres', region: 'belt', parent: 'sun',
    a: 2.767, local: 0, dv: 9700, value: 2.45, research: 2.3, hazard: 0.28, survey: 2.4e4, angle: 5.6,
    flavor: 'The belt has one town and this is it. Everything transiting outward stops here to argue.',
  },
  {
    id: 'callisto', name: 'Callisto Roads', short: 'Callisto', region: 'outer', parent: 'jupiter',
    a: 5.204, local: 12, dv: 14300, value: 3.0, research: 2.4, hazard: 0.35, survey: 7e5, angle: 0.6,
    flavor: 'Outside the worst of the radiation belt. Jovian traffic control operates from here by preference.',
  },
  {
    id: 'europa', name: 'Europa Under-Ice', short: 'Europa', region: 'outer', parent: 'jupiter',
    a: 5.204, local: 9, dv: 16900, value: 3.4, research: 3.4, hazard: 0.85, survey: 2.6e6, angle: 0.75,
    flavor: 'Quarantine protocol Class IV. Manifests are inspected on the way out, not the way in.',
  },
  {
    id: 'titan', name: 'Titan Fractionation', short: 'Titan', region: 'outer', parent: 'saturn',
    a: 9.583, local: 18, dv: 17400, value: 3.9, research: 2.7, hazard: 0.3, survey: 9e6, angle: 1.9,
    flavor: 'An atmosphere you can fly in and a hydrocarbon budget nobody has finished counting.',
  },
  {
    id: 'enceladus', name: 'Enceladus Plume Station', short: 'Enceladus', region: 'outer', parent: 'saturn',
    a: 9.583, local: 20, dv: 18300, value: 4.3, research: 3.3, hazard: 0.5, survey: 3.4e7, angle: 2.05,
    flavor: 'Parks in the plume and lets the moon load the tanks. Elegant, and constantly behind schedule.',
  },
  {
    id: 'oberon', name: 'Oberon Cold Store', short: 'Oberon', region: 'outer', parent: 'sun',
    a: 19.19, local: 0, dv: 19800, value: 5.0, research: 3.0, hazard: 0.4, survey: 1.7e8, angle: 3.6,
    flavor: 'Uranian system. Sideways, dark, and cheap to rent. Three permanent staff and a lot of tanks.',
  },
  {
    id: 'triton', name: 'Triton Retrograde', short: 'Triton', region: 'outer', parent: 'sun',
    a: 30.07, local: 0, dv: 21500, value: 5.7, research: 3.6, hazard: 0.55, survey: 8e8, angle: 4.6,
    flavor: 'Orbits the wrong way, which complicates arrival and every insurance form thereafter.',
  },
  {
    id: 'kuiper', name: 'Kuiper Ice Claims', short: 'Kuiper', region: 'outer', parent: 'sun',
    a: 45, local: 0, dv: 24000, value: 6.6, research: 4.2, hazard: 0.45, survey: 5e9, angle: 5.4,
    flavor: 'Volatiles by the cubic kilometre. Round trip: one professional lifetime, give or take.',
  },
  {
    id: 'oort', name: 'Inner Oort Beacon', short: 'Oort', region: 'outer', parent: 'sun',
    a: 320, local: 0, dv: 27500, value: 8.2, research: 5.5, hazard: 0.5, survey: 3e10, angle: 0.2,
    flavor: 'The last place a chemical rocket is even theoretically relevant. It is not, in practice.',
  },
];

export const SOL_NODES: WorldNode[] = RAW.map((r) => ({
  id: r.id,
  name: r.name,
  short: r.short,
  era: 1,
  region: r.region,
  parent: r.parent,
  a: r.a * AU,
  localTransit: r.local * DAY,
  dv: r.dv,
  dist: r.a * AU,
  valueMult: r.value,
  researchMult: r.research,
  hazard: r.hazard,
  surveyCost: D(r.survey),
  mx: Math.cos(r.angle),
  my: Math.sin(r.angle),
  flavor: r.flavor,
}));
