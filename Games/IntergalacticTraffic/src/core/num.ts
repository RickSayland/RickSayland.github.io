import Decimal from 'break_infinity.js';

export { Decimal };
export type DecimalSource = Decimal | number | string;

export const D = (v: DecimalSource): Decimal => new Decimal(v);

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

/** Geometric price of the (owned+1)-th purchase: base * r^owned. */
export function geomCost(base: Decimal, r: number, owned: number): Decimal {
  return base.mul(Decimal.pow(r, owned));
}

/** Total price of `count` purchases starting from `owned`. */
export function geomCostBulk(base: Decimal, r: number, owned: number, count: number): Decimal {
  if (count <= 0) return ZERO;
  const rn = Decimal.pow(r, count);
  return base.mul(Decimal.pow(r, owned)).mul(rn.sub(1)).div(r - 1);
}

/**
 * How many purchases `funds` covers, given a geometric ladder.
 * Solved in closed form: r^n = 1 + funds*(r-1) / (base*r^owned).
 * Doing this by loop is what makes late-game "buy max" buttons hitch.
 */
export function geomBuyMax(funds: Decimal, base: Decimal, r: number, owned: number, cap = 1e9): number {
  const first = geomCost(base, r, owned);
  if (funds.lt(first)) return 0;
  const ratio = funds.mul(r - 1).div(first).add(1);
  const n = Math.floor(ratio.log10() / Math.log10(r));
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, cap);
}

/** log10 that tolerates zero and negatives without producing NaN. */
export function safeLog10(v: Decimal): number {
  if (v.lte(0)) return 0;
  const l = v.log10();
  return isFinite(l) ? l : 0;
}

export function decMax(a: Decimal, b: Decimal): Decimal {
  return a.gt(b) ? a : b;
}

export function decMin(a: Decimal, b: Decimal): Decimal {
  return a.lt(b) ? a : b;
}
