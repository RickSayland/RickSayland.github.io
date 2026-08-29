/** Physical constants. Plain numbers: none of these need 300 digits of range. */
export const AU = 1.495978707e11; // m
export const MU_SUN = 1.32712440018e20; // m^3/s^2
export const C = 299792458; // m/s
export const LY = 9.4607304725808e15; // m
export const PARSEC = 3.0856775814913673e16; // m
export const MPC = 1e6 * PARSEC;
export const H0 = 70e3 / MPC; // s^-1, 70 km/s/Mpc
export const HUBBLE_RADIUS = C / H0; // m, ~4.4 Gpc
export const DAY = 86400;
export const YEAR = 365.25 * DAY;

/**
 * Sim seconds per real second. 10 days a second is what makes an Earth-Mars
 * synodic period (780 d) land at ~78 s of play: long enough that the dead time
 * between windows is genuinely felt, short enough that it is not a punishment.
 */
export const TIME_SCALE = 10 * DAY;

/** Fixed sim timestep. Rendering is decoupled and runs on rAF. */
export const TICK_HZ = 20;
export const TICK_DT = 1 / TICK_HZ;

/** Ceiling on catch-up steps in one frame, so a backgrounded tab cannot stall. */
export const MAX_CATCHUP_STEPS = 8;

/** Offline progress: the fast-forward loop runs this many steps at most. */
export const OFFLINE_MAX_STEPS = 12000;
export const OFFLINE_BASE_CAP_H = 8;

/** Turnaround that no amount of transfer-time cleverness removes, in sim seconds. */
export const BASE_OVERHEAD = 2.5 * DAY;

/** Interdiction: orders of magnitude of economy that go unpoliced for free. */
export const INTERDICTION_FREE_DECADES = 2.0;
export const INTERDICTION_K = 0.95;
/** Relaxation time of Interdiction toward its target, in sim seconds (~4 s of play). */
export const INTERDICTION_TAU = 40 * DAY;

/** Era 2 velocity economics (see DESIGN.md - both are per unit of throughput). */
export const CREW_K = 0.05;
export const FUEL_K = 0.02;

/**
 * Value densities, in credits per kilogram delivered. These are the numbers
 * that set the pace of the whole game, and they are small because throughput
 * is quoted per SIM second: one lighter on the Luna run moves ~5 t of real
 * second, so a density of 1e-4 makes it worth about 0.6 credits a second.
 */
export const TRADE_DENSITY = 1.0e-4;
export const SCIENCE_CREDIT_DENSITY = 0.3e-4;
export const MILITARY_CREDIT_DENSITY = 0.2e-4;
export const RESEARCH_DENSITY = 1.2e-5;
export const SECURITY_DENSITY = 2.0e-5;

/** Era 3+ warp bubble upkeep: exotic matter per sim second = K * w^3 * volume * ships. */
export const EXOTIC_K = 1.0e-10;
/** Exotic matter per kg delivered on a science route, era 3+. */
export const EXOTIC_YIELD = 4.0;

/**
 * mandate = MANDATE_K * lifetimeCredits^(1/3).
 *
 * Fitted, not guessed: `tools/check.ts` drives a naive player to the era-2
 * authorisation and reports lifetime credits there, which lands around 2e7.
 * The cube root of that is ~270, so K = 0.08 makes a first Recharter worth
 * about 20 Mandate — enough to buy several Institutions immediately, few
 * enough to still be a number a person can hold in their head. An earlier
 * 0.0022 was set against a guessed 1e12 and paid out zero.
 */
export const MANDATE_K = 0.08;

export const ERA_NAMES = ['', 'Sol', 'Near Stars', 'Galactic', 'Local Group', 'Multiversal'];

export const MAX_ROUTES = 500;

export const GAME_VERSION = '0.5.0';
