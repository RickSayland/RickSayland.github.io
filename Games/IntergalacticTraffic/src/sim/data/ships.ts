import { D } from '../../core/num';
import type { ShipClass } from '../types';

/**
 * Ship classes are SIDEGRADES within a tier, not a ladder (see DESIGN.md).
 * Each tier offers a bulk option and a fast option, and the throughput formula
 * decides between them per route without any special-casing:
 *
 *   payloadFraction = exp(-dv/ve) - structural
 *
 * A hauler's large structural fraction is nearly free on a low-delta-v run and
 * fatal on a high one, because exp(-dv/ve) has already shrunk to something the
 * structural term can eat. So bulk wins on the short hops and couriers win on
 * the hard ones, and the crossover moves every time the engine line advances.
 */
export const SHIP_CLASSES: ShipClass[] = [
  {
    id: 'lighter', name: 'Standard Lighter', era: 1,
    wetMass: 4.0e4, structural: 0.075, veMult: 1.0, rttMult: 1.0,
    bubbleVolume: 1, baseCost: D(18), costGrowth: 1.062,
    blurb: 'The unit of account. Everything else is measured against a lighter.',
  },
  {
    id: 'hauler', name: 'Bulk Hauler', era: 1, tech: 'ship-hauler',
    wetMass: 2.6e5, structural: 0.155, veMult: 0.95, rttMult: 1.35,
    bubbleVolume: 4.5, baseCost: D(420), costGrowth: 1.068,
    blurb: 'Six times the hull for twice the structure. Superb inside the belt, useless past it.',
  },
  {
    id: 'courier', name: 'Fast Courier', era: 1, tech: 'ship-courier',
    wetMass: 1.1e4, structural: 0.042, veMult: 1.15, rttMult: 0.55,
    bubbleVolume: 0.4, baseCost: D(300), costGrowth: 1.058,
    blurb: 'Small, light, and back before the paperwork clears. Carries almost nothing, constantly.',
  },
  {
    id: 'freighter', name: 'Heavy Freighter', era: 1, tech: 'ship-freighter',
    wetMass: 1.4e6, structural: 0.135, veMult: 1.0, rttMult: 1.22,
    bubbleVolume: 22, baseCost: D(4.5e4), costGrowth: 1.07,
    blurb: 'A bulk hauler that learned to build itself in orbit. Never lands anywhere, ever.',
  },
  {
    id: 'clipper', name: 'Torch Clipper', era: 1, tech: 'ship-clipper',
    wetMass: 9.0e4, structural: 0.036, veMult: 1.28, rttMult: 0.34,
    bubbleVolume: 1.2, baseCost: D(2.2e5), costGrowth: 1.061,
    blurb: 'Mostly radiator. Runs the torch continuously and treats a Hohmann window as advice.',
  },
  {
    id: 'starliner', name: 'Relativistic Liner', era: 2, tech: 'ship-starliner',
    wetMass: 6.0e6, structural: 0.098, veMult: 1.1, rttMult: 1.0,
    bubbleVolume: 60, baseCost: D(4e9), costGrowth: 1.072,
    blurb: 'Whipple shield forward, crew aft, and a clock that disagrees with the port authority.',
  },
  {
    id: 'needle', name: 'Ramscoop Needle', era: 2, tech: 'ship-needle',
    wetMass: 4.0e5, structural: 0.028, veMult: 1.45, rttMult: 0.48,
    bubbleVolume: 3, baseCost: D(2.6e10), costGrowth: 1.063,
    blurb: 'Collects its own reaction mass. The intake is larger than the ship and always has been.',
  },
  {
    id: 'bubblefreighter', name: 'Bubble Freighter', era: 3, tech: 'ship-bubble',
    wetMass: 5.0e8, structural: 0.088, veMult: 1.2, rttMult: 1.0,
    bubbleVolume: 900, baseCost: D(1e22), costGrowth: 1.075,
    blurb: 'Cargo does not move. The metric does. Legally this is still haulage.',
  },
  {
    id: 'skiff', name: 'Metric Skiff', era: 3, tech: 'ship-skiff',
    wetMass: 2.0e7, structural: 0.021, veMult: 1.6, rttMult: 0.5,
    bubbleVolume: 130, baseCost: D(9e22), costGrowth: 1.064,
    blurb: 'Almost all bubble and almost no hull. The exotic matter bill is the ship.',
  },
  {
    id: 'arkline', name: 'Comoving Arkline', era: 4, tech: 'ship-arkline',
    wetMass: 8.0e10, structural: 0.066, veMult: 1.35, rttMult: 0.95,
    bubbleVolume: 2.4e4, baseCost: D(1e39), costGrowth: 1.078,
    blurb: 'Built to outrun the expansion of space. Mostly succeeds, on the routes that were surveyed early.',
  },
  {
    id: 'braneferry', name: 'Brane Ferry', era: 5, tech: 'ship-braneferry',
    wetMass: 3.0e9, structural: 0.018, veMult: 2.2, rttMult: 0.42,
    bubbleVolume: 5.5e4, baseCost: D(1e58), costGrowth: 1.066,
    blurb: 'Exists in two universes and is taxed in neither. The forms for this are still in draft.',
  },
];

const BY_ID = new Map(SHIP_CLASSES.map((s) => [s.id, s]));

export function shipClass(id: string): ShipClass {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`unknown ship class ${id}`);
  return s;
}

export function getShipClass(id: string): ShipClass | undefined {
  return BY_ID.get(id);
}
