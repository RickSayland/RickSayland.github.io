/**
 * Save format versioning.
 *
 * Contract:
 *   - `SAVE_VERSION` is the format the current build writes.
 *   - `migrations[n]` takes a save that is AT version `n` and returns one at
 *     version `n + 1`. It may mutate and return the same object; `migrate`
 *     stamps `version` after each step so a half-applied chain is still
 *     self-describing.
 *   - Every step from the oldest version we still accept up to `SAVE_VERSION`
 *     must exist. A migration is written at the same time as the change that
 *     needs it, never afterwards, so a save written by an old build is never
 *     orphaned by a gap in the chain.
 *   - Migrations run on the raw JSON, BEFORE Decimals are rehydrated. Numeric
 *     fields are therefore strings at this point; treat them as such.
 *   - A save from a NEWER build (version > SAVE_VERSION) is not migrated
 *     downward. It is passed through untouched and the loader is expected to
 *     tolerate whatever it does not recognise.
 */

export const SAVE_VERSION = 1;

/** A save as it exists on disk: plain JSON, no Decimals, no guarantees. */
export type RawSave = Record<string, any>;

/** Keyed by the version the step upgrades FROM. Empty until format 1 is superseded. */
export const migrations: Record<number, (s: RawSave) => RawSave> = {};

/** Walk `raw` up to SAVE_VERSION, one registered step at a time. Throws on a gap. */
export function migrate(raw: RawSave): RawSave {
  const start = raw['version'];
  if (typeof start !== 'number' || !Number.isFinite(start)) {
    throw new Error('save has no usable version field');
  }

  let out = raw;
  let v = start;
  while (v < SAVE_VERSION) {
    const step = migrations[v];
    if (!step) {
      throw new Error(`no migration from save version ${v} to ${v + 1}`);
    }
    out = step(out);
    v += 1;
    out['version'] = v;
  }
  return out;
}
