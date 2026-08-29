import { Decimal } from './num';

export type Notation = 'scientific' | 'engineering' | 'standard';

let notation: Notation = 'scientific';

export function setNotation(n: Notation): void {
  notation = n;
}
export function getNotation(): Notation {
  return notation;
}

// Short-scale names. Past this the number is bigger than the vocabulary and we
// fall back to exponents, which physics-literate players prefer anyway.
const NAMES = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc',
  'Vg', 'UVg', 'DVg', 'TVg', 'QaVg', 'QiVg', 'SxVg', 'SpVg', 'OcVg', 'NoVg', 'Tg',
];

function mantissaExp(v: Decimal): [number, number] {
  const e = Math.floor(v.log10());
  const m = v.div(Decimal.pow(10, e)).toNumber();
  return [m, e];
}

/** Currency / resource formatting. Below 1e6 it stays plain and readable. */
export function fmt(value: Decimal | number, places = 2): string {
  const v = typeof value === 'number' ? new Decimal(value) : value;
  if (!isFinite(v.mantissa) && v.mantissa !== 0) return '∞';
  if (v.lt(0)) return '-' + fmt(v.neg(), places);
  if (v.lt(1e-3) && v.gt(0)) return v.toNumber().toExponential(2);
  if (v.lt(1000)) {
    const n = v.toNumber();
    return n < 10 ? n.toFixed(Math.min(places, 2)) : n.toFixed(n < 100 ? 1 : 0);
  }
  if (v.lt(1e6)) return Math.round(v.toNumber()).toLocaleString('en-US');

  const [m, e] = mantissaExp(v);
  switch (notation) {
    case 'standard': {
      const tier = Math.floor(e / 3);
      const name = NAMES[tier];
      if (name) return (m * Math.pow(10, e - tier * 3)).toFixed(places) + name;
      return sci(m, e, places);
    }
    case 'engineering': {
      const e3 = Math.floor(e / 3) * 3;
      return (m * Math.pow(10, e - e3)).toFixed(places) + 'e' + e3;
    }
    default:
      return sci(m, e, places);
  }
}

function sci(m: number, e: number, places: number): string {
  return m.toFixed(places) + 'e' + e;
}

/** Integers that stay integers (ship counts, node counts). */
export function fmtInt(value: Decimal | number): string {
  const v = typeof value === 'number' ? new Decimal(value) : value;
  if (v.lt(1e6)) return Math.floor(v.toNumber()).toLocaleString('en-US');
  return fmt(v, 2);
}

const SI_UP = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
const SI_DOWN = ['', 'm', 'µ', 'n', 'p', 'f'];

/**
 * Physical quantities get SI prefixes, because "12.4 km/s" means something to
 * the audience for this game and "1.24e4 m/s" means slightly less.
 */
export function fmtSI(value: number, unit: string, places = 2): string {
  if (!isFinite(value)) return '∞ ' + unit;
  if (value === 0) return '0 ' + unit;
  const neg = value < 0;
  let v = Math.abs(value);
  let tier = 0;
  if (v >= 1) {
    while (v >= 1000 && tier < SI_UP.length - 1) {
      v /= 1000;
      tier++;
    }
    const p = SI_UP[tier]!;
    return (neg ? '-' : '') + v.toFixed(v < 10 ? places : v < 100 ? 1 : 0) + ' ' + p + unit;
  }
  while (v < 1 && tier < SI_DOWN.length - 1) {
    v *= 1000;
    tier++;
  }
  const p = SI_DOWN[tier]!;
  return (neg ? '-' : '') + v.toFixed(places) + ' ' + p + unit;
}

const MASS_UNITS = ['t', 'kt', 'Mt', 'Gt', 'Tt', 'Pt', 'Et'];

/**
 * Mass in tonnes, because cargo is quoted in tonnes and "4.44 Mg" is a unit
 * that is technically correct and read by nobody.
 */
export function fmtMass(kg: number): string {
  if (!isFinite(kg)) return '∞ t';
  if (kg <= 0) return '0 t';
  if (kg < 1000) return kg.toFixed(kg < 10 ? 2 : 0) + ' kg';
  let t = kg / 1000;
  let i = 0;
  while (t >= 1000 && i < MASS_UNITS.length - 1) {
    t /= 1000;
    i++;
  }
  if (i === MASS_UNITS.length - 1 && t >= 1000) {
    return fmt(new Decimal(kg / 1000), 2) + ' t';
  }
  return t.toFixed(t < 10 ? 2 : t < 100 ? 1 : 0) + ' ' + MASS_UNITS[i]!;
}

/** Durations, in whatever unit keeps the number under three digits. */
export function fmtTime(seconds: number): string {
  if (!isFinite(seconds)) return '—';
  if (seconds < 0) return '—';
  if (seconds < 1) return (seconds * 1000).toFixed(0) + ' ms';
  if (seconds < 90) return seconds.toFixed(seconds < 10 ? 1 : 0) + ' s';
  const m = seconds / 60;
  if (m < 90) return m.toFixed(1) + ' min';
  const h = m / 60;
  if (h < 48) return h.toFixed(1) + ' h';
  const d = h / 24;
  if (d < 400) return d.toFixed(1) + ' d';
  return (d / 365.25).toFixed(2) + ' yr';
}

const DAY = 86400;
const YEAR = 365.25 * DAY;

/** Sim-clock durations get astronomical units of time, not stopwatch ones. */
export function fmtSimTime(seconds: number): string {
  if (!isFinite(seconds)) return '—';
  if (seconds < DAY) return (seconds / 3600).toFixed(1) + ' h';
  if (seconds < 400 * DAY) return (seconds / DAY).toFixed(seconds < 10 * DAY ? 1 : 0) + ' d';
  const y = seconds / YEAR;
  if (y < 1e4) return y.toFixed(y < 100 ? 1 : 0) + ' yr';
  return fmt(new Decimal(y), 2) + ' yr';
}

export function fmtPct(frac: number, places = 1): string {
  return (frac * 100).toFixed(places) + '%';
}

export function fmtMult(m: number | Decimal): string {
  return '×' + fmt(m, 2);
}
