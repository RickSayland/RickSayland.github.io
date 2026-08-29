import { compressToBase64, decompressFromBase64 } from 'lz-string';
import { D, ZERO } from '../core/num';
import type { Decimal } from '../core/num';
import type { GameState, RouteKind, RouteState, Settings, Stats } from '../sim/types';
import { migrate, SAVE_VERSION } from './migrations';
import type { RawSave } from './migrations';

export const SAVE_KEY = 'its.save.v1';

/**
 * Which fields are Decimals, declared rather than discovered.
 *
 * Nothing here walks the state guessing at types: a Decimal survives a round
 * trip only if its path is in one of these tables. That is deliberate. A new
 * Decimal field that nobody registers does not quietly serialize as
 * `[object Object]` — `fromRaw` builds the state field by field, so the
 * compiler stops on the missing property and the omission is caught in review.
 */
const ROOT_DECIMALS = ['credits', 'research', 'exotic', 'mandate', 'lifetimeCredits', 'totalCredits'] as const;
const STATS_DECIMALS = ['bestRate'] as const;
/** Plus one per element of `routes`, handled by `routeToRaw` / `routeFromRaw`. */

/** A Decimal's string form round-trips exactly through `new Decimal(str)`. */
function decToStr(v: Decimal | undefined | null): string {
  return v == null ? '0' : v.toString();
}

/** Parse a serialized Decimal. Anything unusable becomes ZERO rather than NaN. */
function toDec(v: unknown): Decimal {
  if (typeof v !== 'string' && typeof v !== 'number') return ZERO;
  try {
    const d = D(v);
    return Number.isFinite(d.mantissa) && Number.isFinite(d.exponent) ? d : ZERO;
  } catch {
    return ZERO;
  }
}

function plainObject(v: unknown): RawSave {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as RawSave) : {};
}

function numField(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function strField(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function numRecord(v: unknown): Record<string, number> {
  const src = plainObject(v);
  const out: Record<string, number> = {};
  for (const k of Object.keys(src)) {
    const n = src[k];
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function routeToRaw(r: RouteState): RawSave {
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    kind: r.kind,
    shipClass: r.shipClass,
    ships: decToStr(r.ships),
    tier: r.tier,
    v: r.v,
    phase: r.phase,
    auto: r.auto,
  };
}

function routeFromRaw(v: unknown): RouteState {
  const r = plainObject(v);
  return {
    id: strField(r['id'], ''),
    from: strField(r['from'], ''),
    to: strField(r['to'], ''),
    kind: strField(r['kind'], 'trade') as RouteKind,
    shipClass: strField(r['shipClass'], ''),
    ships: toDec(r['ships']),
    tier: numField(r['tier'], 0),
    v: numField(r['v'], 1),
    phase: numField(r['phase'], 0),
    auto: r['auto'] === true,
  };
}

/**
 * State -> plain JSON. Every registered Decimal is replaced by its string form;
 * the `version` stamped is the format we are writing, not whatever the state
 * was loaded as.
 */
function toRaw(state: GameState): RawSave {
  const raw: RawSave = {
    version: SAVE_VERSION,
    seed: state.seed,
    rngState: state.rngState,
    t: state.t,
    lastSaveMs: state.lastSaveMs,
    era: state.era,
    eraUnlocked: state.eraUnlocked,
    recharters: state.recharters,
    surveyed: state.surveyed.slice(),
    routes: state.routes.map(routeToRaw),
    up: { ...state.up },
    tech: state.tech.slice(),
    inst: { ...state.inst },
    interdiction: { ...state.interdiction },
    fx: { ...state.fx },
    settings: { ...state.settings },
  };

  for (const k of ROOT_DECIMALS) raw[k] = decToStr(state[k]);

  const stats: RawSave = {
    ticks: state.stats.ticks,
    playMs: state.stats.playMs,
    routesChartered: state.stats.routesChartered,
    shipsBought: state.stats.shipsBought,
  };
  for (const k of STATS_DECIMALS) stats[k] = decToStr(state.stats[k]);
  raw['stats'] = stats;

  return raw;
}

/**
 * Migrated JSON -> state. Tolerant by design: a save from an older or newer
 * build is missing or gaining fields all the time, and losing a whole run to
 * one absent key is the worst outcome available. Unknown/absent Decimals
 * become ZERO, absent containers become empty, and `settings`/`stats` come
 * back with whatever they carried — the caller merges those over its own
 * defaults, since this module has no business inventing balance numbers.
 */
function fromRaw(raw: RawSave): GameState {
  const stats = { ...plainObject(raw['stats']) } as unknown as Stats;
  for (const k of STATS_DECIMALS) stats[k] = toDec(plainObject(raw['stats'])[k]);

  const routes = Array.isArray(raw['routes']) ? raw['routes'].map(routeFromRaw) : [];

  const state: GameState = {
    version: numField(raw['version'], SAVE_VERSION),
    seed: numField(raw['seed'], 0),
    rngState: numField(raw['rngState'], 0),
    t: numField(raw['t'], 0),
    lastSaveMs: numField(raw['lastSaveMs'], 0),
    era: numField(raw['era'], 1),
    eraUnlocked: numField(raw['eraUnlocked'], 1),

    credits: ZERO,
    research: ZERO,
    exotic: ZERO,
    mandate: ZERO,
    lifetimeCredits: ZERO,
    totalCredits: ZERO,

    recharters: numField(raw['recharters'], 0),
    surveyed: strArray(raw['surveyed']),
    routes,

    up: numRecord(raw['up']),
    tech: strArray(raw['tech']),
    inst: numRecord(raw['inst']),
    interdiction: numRecord(raw['interdiction']),
    fx: numRecord(raw['fx']),

    settings: { ...plainObject(raw['settings']) } as unknown as Settings,
    stats,
  };

  for (const k of ROOT_DECIMALS) state[k] = toDec(raw[k]);

  return state;
}

/** Plain-JSON snapshot with every Decimal stringified. */
export function serialize(state: GameState): string {
  return JSON.stringify(toRaw(state));
}

/** Parse + migrate + rehydrate Decimals. Throws on unusable input. */
export function deserialize(text: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('save is not valid JSON');
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('save is not an object');
  }
  const raw = parsed as RawSave;
  if (typeof raw['version'] !== 'number' || !Number.isFinite(raw['version'])) {
    throw new Error('save has no version');
  }
  return fromRaw(migrate(raw));
}

/** JSON -> lz-string compressToBase64. URL/textarea-safe. */
export function encodeSave(state: GameState): string {
  return compressToBase64(serialize(state));
}

/**
 * Inverse of `encodeSave`, but it also accepts raw uncompressed JSON: players
 * paste both, and a blob that has been through a chat window or an email
 * arrives wrapped in whitespace either way.
 */
export function decodeSave(blob: string): GameState {
  const text = blob.trim();
  if (!text) throw new Error('save is empty');

  let inflated: string | null = null;
  try {
    inflated = decompressFromBase64(text);
  } catch {
    // Not base64 at all. Whatever it is, JSON gets the next look.
  }
  if (inflated) {
    try {
      return deserialize(inflated);
    } catch {
      // Decompression produced garbage: it was never a blob. Fall through.
    }
  }
  return deserialize(text);
}

/** Write to localStorage. Returns false if storage is full or unavailable; never throws. */
export function saveToStorage(state: GameState): boolean {
  try {
    localStorage.setItem(SAVE_KEY, encodeSave(state));
    return true;
  } catch {
    // QuotaExceededError, or SecurityError where site data is blocked.
    return false;
  }
}

/** Read from localStorage. Returns null if absent or corrupt; never throws. */
export function loadFromStorage(): GameState | null {
  try {
    const blob = localStorage.getItem(SAVE_KEY);
    if (!blob) return null;
    return decodeSave(blob);
  } catch {
    return null;
  }
}

/** Drop the stored save. Silent if storage is unavailable. */
export function clearStorage(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to do: unreadable storage is also unwritable.
  }
}

/** Whether a stored save exists, without paying to decode it. */
export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) != null;
  } catch {
    return false;
  }
}
