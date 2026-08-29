/**
 * Icon set for Intergalactic Traffic Simulator.
 *
 * One 24x24 grid, one 1.6 stroke weight, one optical weight. Every mark is
 * drawn as official signage: registry stamps, technical schematics, filing
 * marks. Colour is never named here -- the SVG inherits `currentColor` from
 * whatever element it is dropped into, so the stylesheet owns the palette.
 *
 * Dependency-free by design: no imports, no framework, returns markup strings.
 */

export type IconName =
  // Resources
  | 'credits'
  | 'research'
  | 'security'
  | 'exotic'
  | 'mandate'
  // Route kinds
  | 'trade'
  | 'science'
  | 'military'
  // Nouns
  | 'route'
  | 'node'
  | 'survey'
  | 'ship'
  | 'fleet'
  | 'engine'
  | 'hull'
  | 'market'
  | 'institution'
  // Navigation
  | 'routes'
  | 'network'
  | 'map'
  | 'upgrades'
  | 'tech'
  | 'stats'
  | 'settings'
  // Actions
  | 'plus'
  | 'minus'
  | 'maxout'
  | 'charter'
  | 'recharter'
  | 'save'
  | 'export'
  | 'import'
  | 'trash'
  | 'filter'
  | 'sortAsc'
  | 'sortDesc'
  // Status
  | 'lock'
  | 'check'
  | 'warn'
  | 'info'
  | 'clock'
  | 'window'
  | 'throttle'
  | 'blocked';

/**
 * Inner markup for each icon, on a 0 0 24 24 grid. Keep every entry to a
 * handful of primitives: these render at 14-18px and anything finer than
 * ~1.5 grid units disappears. Order here is the order of `ICON_NAMES`.
 */
const PATHS: Record<IconName, string> = {
  // --- Resources ------------------------------------------------------------
  // Ledger docket with a clipped corner, not a coin.
  credits:
    '<path d="M4.5 5.5h9.5l4.5 4.5v8.5h-14z"/><path d="M14 5.5v4.5h4.5"/><path d="M7.5 12.6h7"/><path d="M7.5 15.6h4.4"/>',
  // Graduated vessel, drawn as apparatus rather than a magic potion.
  research:
    '<path d="M9.5 3.5v5.2L5.1 17.6a1.6 1.6 0 0 0 1.4 2.4h11a1.6 1.6 0 0 0 1.4-2.4L14.5 8.7V3.5"/><path d="M8.3 3.5h7.4"/><path d="M7.4 14.6h9.2"/>',
  security: '<path d="M12 3.2 19 5.8v5.4c0 4.4-2.9 7.4-7 9.6-4.1-2.2-7-5.2-7-9.6V5.8z"/><path d="M8.6 11.4h6.8"/>',
  // Inside-out: the boundary runs back through itself and the core is hollow.
  exotic:
    '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a4.1 4.1 0 0 0 0 8.2 4.1 4.1 0 0 1 0 8.2"/><circle cx="12" cy="7.9" r="1.15"/>',
  // Authority seal with ribbon tails.
  mandate: '<circle cx="12" cy="9" r="6.3"/><circle cx="12" cy="9" r="2.9"/><path d="M8.5 14.7 7.1 21l4.9-2.4 4.9 2.4-1.4-6.3"/>',

  // --- Route kinds ----------------------------------------------------------
  trade: '<rect x="4.5" y="7.6" width="15" height="9.8" rx="1"/><path d="M4.5 11.4h15"/><path d="M12 7.6v9.8"/>',
  science: '<rect x="8.4" y="3.4" width="7.2" height="17.2" rx="3.6"/><path d="M8.4 9.2h7.2"/><path d="M8.4 15h7.2"/>',
  military: '<path d="M5 14.6 12 9.4l7 5.2"/><path d="M5 19.4 12 14.2l7 5.2"/>',

  // --- Nouns ----------------------------------------------------------------
  route:
    '<circle cx="5.4" cy="18.6" r="2.1"/><circle cx="18.6" cy="5.4" r="2.1"/><path d="M6.9 17.1C9 12.4 12.4 9 17.1 6.9"/>',
  node: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4"/>',
  survey:
    '<circle cx="10.6" cy="10.6" r="5.9"/><path d="m14.9 14.9 5.6 5.6"/><path d="M10.6 8.2v4.8M8.2 10.6h4.8"/>',
  ship: '<path d="M21 12 12.8 8.2H5.6v7.6h7.2z"/><path d="M5.6 10.2H2.8M5.6 13.8H2.8"/>',
  fleet: '<path d="m12.6 4.2 6.8 3.4-6.8 3.4"/><path d="m12.6 13 6.8 3.4-6.8 3.4"/><path d="M4.2 8.6 11 12l-6.8 3.4"/>',
  engine: '<path d="M9 3.6h6v4H9z"/><path d="M9 7.6 6 20.4h12L15 7.6"/><path d="M7.8 12.4h8.4"/>',
  hull: '<ellipse cx="12" cy="12" rx="8.2" ry="5.6"/><path d="M9 6.9v10.2M15 6.9v10.2"/>',
  market: '<path d="M4 8.6h13"/><path d="m14 5.6 3 3-3 3"/><path d="M20 15.4H7"/><path d="m10 12.4-3 3 3 3"/>',
  institution:
    '<path d="M12 3.4 20.6 8.8H3.4z"/><path d="M6.6 11.4v6M12 11.4v6M17.4 11.4v6"/><path d="M3.6 20.4h16.8"/>',

  // --- Navigation -----------------------------------------------------------
  routes:
    '<circle cx="5" cy="6.8" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="17.2" r="1.6"/><path d="M9.2 6.8h11M9.2 12h11M9.2 17.2h7.6"/>',
  network:
    '<circle cx="12" cy="5.4" r="2.2"/><circle cx="5.4" cy="17.4" r="2.2"/><circle cx="18.6" cy="17.4" r="2.2"/><path d="M6.5 15.5 10.9 7.4M13.1 7.4l4.4 8.1M7.6 17.4h8.8"/>',
  map: '<path d="M3.6 6.6 9 4.4l6 2.2 5.4-2.2v13l-5.4 2.2-6-2.2-5.4 2.2z"/><path d="M9 4.4v13M15 6.6v13"/>',
  upgrades: '<path d="M3.4 20.6h4.8V15H13V9.4h4.8V4"/><path d="m15.4 6.4 2.4-2.4 2.4 2.4"/>',
  tech: '<path d="M6.6 12h4.6"/><path d="M11.2 12V7.2h5.2M11.2 12v4.8h5.2"/><circle cx="4.6" cy="12" r="2"/><circle cx="18.4" cy="7.2" r="2"/><circle cx="18.4" cy="16.8" r="2"/>',
  stats: '<path d="M4.2 3.8v16h15.6"/><path d="M8.4 16.6v-4.4M12.4 16.6V7.6M16.4 16.6v-6.6"/>',
  settings:
    '<path d="M3.4 7h17M3.4 12h17M3.4 17h17"/><circle cx="8.2" cy="7" r="2.1"/><circle cx="15.4" cy="12" r="2.1"/><circle cx="10.4" cy="17" r="2.1"/>',

  // --- Actions --------------------------------------------------------------
  plus: '<path d="M12 4.8v14.4M4.8 12h14.4"/>',
  minus: '<path d="M4.8 12h14.4"/>',
  maxout: '<path d="M4.8 4.4h14.4"/><path d="M12 20.4V8.6"/><path d="m7.2 13.4 4.8-4.8 4.8 4.8"/>',
  charter:
    '<path d="M6 3.4h8l4 4v13.2H6z"/><path d="M14 3.4v4h4"/><path d="M9 11h6"/><circle cx="12" cy="15.6" r="2.6"/>',
  // The prestige mark: a stamp on its way down onto the platen. Heaviest in the set.
  recharter:
    '<path d="M8.4 4.6h7.2"/><path d="M12 4.6v5"/><path d="M7 15.6 8.7 9.6h6.6l1.7 6z"/><path d="M3.6 20.2h16.8"/><path d="M6.8 8 5.4 6.6M17.2 8l1.4-1.4"/>',
  save: '<path d="M4.4 4.4h11.2l4 4v11.2H4.4z"/><path d="M8.4 4.4v4.2h6.2V4.4"/><path d="M8 19.6v-5.2h8v5.2"/>',
  export:
    '<path d="M4.2 14.4v3.4a1.8 1.8 0 0 0 1.8 1.8h12a1.8 1.8 0 0 0 1.8-1.8v-3.4"/><path d="M12 15V3.6"/><path d="m8 7.6 4-4 4 4"/>',
  import:
    '<path d="M4.2 14.4v3.4a1.8 1.8 0 0 0 1.8 1.8h12a1.8 1.8 0 0 0 1.8-1.8v-3.4"/><path d="M12 3.6V15"/><path d="m8 11 4 4 4-4"/>',
  trash:
    '<path d="M3.6 6.4h16.8"/><path d="M9.4 6.4V4.2h5.2v2.2"/><path d="m6.2 6.4 1 13.4h9.6l1-13.4"/><path d="M10.4 10.2v5.8M13.6 10.2v5.8"/>',
  filter: '<path d="M3.6 4.8h16.8l-6.6 7.6v6.4l-3.6 1.8v-8.2z"/>',
  sortAsc: '<path d="M4.6 19.4V5.2"/><path d="m2.2 7.6 2.4-2.4 2.4 2.4"/><path d="M9.6 6.6h10.8M9.6 12h8M9.6 17.4h5"/>',
  sortDesc: '<path d="M4.6 4.6v14.2"/><path d="m2.2 16.4 2.4 2.4 2.4-2.4"/><path d="M9.6 6.6h5M9.6 12h8M9.6 17.4h10.8"/>',

  // --- Status ---------------------------------------------------------------
  lock: '<path d="M8 10.2V7.6a4 4 0 0 1 8 0v2.6"/><rect x="5.2" y="10.2" width="13.6" height="9.6" rx="1.4"/><path d="M12 13.6v2.8"/>',
  check: '<path d="m4.4 12.4 5 5 10.2-10.4"/>',
  warn: '<path d="M12 3.8 21 19.6H3z"/><path d="M12 9.8v4.4"/><path d="M12 17.3v.01"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.6"/><path d="M12 7.6v.01"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 6.8V12l3.8 2.2"/>',
  // Transfer window: the gap in the arc is the window, the ticks are its edges.
  window:
    '<path d="M16.1 5A8 8 0 1 1 7.9 5"/><path d="M16.1 5 17.7 2.2M7.9 5 6.3 2.2"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  throttle: '<path d="M12 3.6v16.8"/><rect x="7.4" y="10.1" width="9.2" height="3.8" rx="1"/><path d="M3.8 6.4h2.6M3.8 17.6h2.6"/>',
  blocked: '<path d="M2.8 12H9M15 12h6.2"/><path d="M12 4.2v15.6"/><path d="M9 9.4v5.2M15 9.4v5.2"/>',
};

/** Every icon name, in declaration order. */
export const ICON_NAMES: readonly IconName[] = Object.keys(PATHS) as IconName[];

/** Inline SVG markup for `name`, sized `size` px square, colour inherited from `currentColor`. */
export function icon(name: IconName, size: number = 16, extraClass?: string): string {
  const cls = extraClass ? `icon icon--${name} ${extraClass}` : `icon icon--${name}`;
  return (
    `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  );
}
