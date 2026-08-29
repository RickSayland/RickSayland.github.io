/**
 * Set pieces for Intergalactic Traffic Simulator: era seals, ship elevations
 * and the ending plate. Same convention as `icons.ts` -- these return SVG
 * markup strings and import nothing.
 *
 * Unlike the icons, these are multi-tone, so they name colours. Every colour
 * goes through a CSS variable with a literal fallback, so a renamed or missing
 * variable degrades to a legible dark-UI value instead of to black-on-black.
 */

const LINE = 'var(--art-line, var(--fg, #cdd7e2))';
const DIM = 'var(--art-dim, var(--fg-dim, #6d7c8e))';
const ACCENT = 'var(--art-accent, var(--accent, #c8a24a))';
const PLATE = 'var(--art-plate, var(--panel, #10151c))';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SERIF = 'Georgia, "Times New Roman", Times, serif';

export type ShipClassId =
  | 'lighter'
  | 'hauler'
  | 'courier'
  | 'freighter'
  | 'clipper'
  | 'starliner'
  | 'needle'
  | 'bubblefreighter'
  | 'skiff'
  | 'arkline'
  | 'braneferry';

/* ==========================================================================
 * Era emblems -- five certification seals, 120x120 grid, centre (60, 60).
 * Each is a technical diagram of that era's binding constraint. Diagram work
 * area is y 26..88; the label sits above it and the numeral below it.
 * ========================================================================== */

/** Thin double ring plus the four registration ticks every seal carries. */
const SEAL_FRAME =
  `<circle cx="60" cy="60" r="57" fill="none" stroke="${DIM}" stroke-width="1.4"/>` +
  `<circle cx="60" cy="60" r="52.5" fill="none" stroke="${DIM}" stroke-width="0.9"/>` +
  `<path d="M60 1v10M60 109v10M1 60h10M109 60h10" stroke="${DIM}" stroke-width="1.2" fill="none"/>`;

interface EraSeal {
  label: string;
  body: string;
}

const ERAS: Record<1 | 2 | 3 | 4 | 5, EraSeal> = {
  // 1 -- Hohmann transfer between two circular orbits. Periapsis on the inner
  // orbit at x=76, apoapsis on the outer at x=29; the ellipse is tangent to both.
  1: {
    label: 'SOL',
    body:
      `<circle cx="60" cy="58" r="16" fill="none" stroke="${DIM}" stroke-width="1"/>` +
      `<circle cx="60" cy="58" r="31" fill="none" stroke="${DIM}" stroke-width="1"/>` +
      `<circle cx="60" cy="58" r="3" fill="${ACCENT}"/>` +
      `<path d="M76 58A23.5 22.3 0 0 0 29 58" fill="none" stroke="${LINE}" stroke-width="1.8"/>` +
      `<path d="M57 32.9 52.2 35.7l4.8 2.9" fill="none" stroke="${LINE}" stroke-width="1.6" ` +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      `<circle cx="76" cy="58" r="2.6" fill="${LINE}"/><circle cx="29" cy="58" r="2.6" fill="${LINE}"/>`,
  },
  // 2 -- Light cone and a timelike worldline through the origin.
  2: {
    label: 'NEAR STARS',
    body:
      `<path d="M60 60 26 26h68z" fill="${LINE}" fill-opacity="0.1" stroke="none"/>` +
      `<path d="M60 26v68M18 60h84" stroke="${DIM}" stroke-width="0.9" fill="none"/>` +
      `<path d="M60 60 26 26M60 60 94 26M60 60 26 94M60 60 94 94" fill="none" stroke="${LINE}" ` +
      'stroke-width="1.4"/>' +
      `<path d="M62 92c-4-14-7-26-2-32 4-6 6-20 3-34" fill="none" stroke="${ACCENT}" ` +
      'stroke-width="1.9" stroke-linecap="round"/>' +
      `<circle cx="60" cy="60" r="2.8" fill="${LINE}"/>`,
  },
  // 3 -- Warp bubble: metric compressed ahead (right), stretched behind (left),
  // flat inside the shell. The bubble is filled so it punches out the grid.
  3: {
    label: 'GALACTIC',
    body:
      `<g stroke="${DIM}" stroke-width="0.9" fill="none">` +
      '<path d="M24 36v44M34 27v63M43 27v63M51 27v63"/>' +
      '<path d="M69 27v63M75 27v63M80 27v63M84 27v63M87.5 27v62M90 29v58M92 31v54"/></g>' +
      `<ellipse cx="59" cy="58" rx="21" ry="13.5" fill="${PLATE}" stroke="${LINE}" stroke-width="1.8"/>` +
      `<path d="M52 55h10l4 3-4 3H52z" fill="none" stroke="${LINE}" stroke-width="1.4" ` +
      'stroke-linejoin="round"/>',
  },
  // 4 -- Comoving grid expanding, galaxies receding along it.
  4: {
    label: 'LOCAL GROUP',
    body:
      `<g fill="none" stroke="${DIM}" stroke-width="0.85">` +
      '<circle cx="60" cy="60" r="12"/><circle cx="60" cy="60" r="24"/><circle cx="60" cy="60" r="36"/>' +
      '<path d="M60 24v72M24 60h72M34.5 34.5 85.5 85.5M85.5 34.5 34.5 85.5"/></g>' +
      `<path d="M56 60h8M60 56v8" stroke="${LINE}" stroke-width="1.4" fill="none"/>` +
      `<g fill="none" stroke="${LINE}" stroke-width="1.5">` +
      '<ellipse cx="39" cy="48" rx="6.5" ry="3" transform="rotate(-28 39 48)"/>' +
      '<ellipse cx="82" cy="50" rx="7" ry="3.2" transform="rotate(16 82 50)"/>' +
      '<ellipse cx="46" cy="82" rx="5.5" ry="2.6" transform="rotate(32 46 82)"/>' +
      '<ellipse cx="85" cy="80" rx="5" ry="2.4" transform="rotate(-14 85 80)"/></g>' +
      `<g fill="none" stroke="${ACCENT}" stroke-width="1.3" stroke-linecap="round" ` +
      'stroke-linejoin="round">' +
      '<path d="M34 45 27.5 41m0 0 4.5.2m-4.5-.2.6 4.4"/>' +
      '<path d="M88 47.5 94 44m0 0-4.4-.4m4.4.4-.8 4.3"/></g>',
  },
  // 5 -- Branching manifolds: three sheets, one worldline splitting through them.
  5: {
    label: 'MULTIVERSAL',
    body:
      `<path d="M26 86 50 76l34 10-24 10z" fill="${PLATE}" stroke="${LINE}" stroke-width="1.5" ` +
      'stroke-linejoin="round"/>' +
      `<path d="M60 86V66" fill="none" stroke="${ACCENT}" stroke-width="1.9"/>` +
      `<path d="M26 60 50 50l34 10-24 10z" fill="${PLATE}" fill-opacity="0.9" stroke="${LINE}" ` +
      'stroke-width="1.5" stroke-linejoin="round"/>' +
      `<path d="M60 64C60 52 48 46 44 38M60 64C60 52 72 46 76 38" fill="none" stroke="${ACCENT}" ` +
      'stroke-width="1.6" stroke-linecap="round"/>' +
      `<path d="M26 34 50 24l34 10-24 10z" fill="none" stroke="${LINE}" stroke-width="1.5" ` +
      'stroke-linejoin="round"/>' +
      `<circle cx="60" cy="86" r="2.4" fill="${LINE}"/><circle cx="44" cy="38" r="2.4" fill="${ACCENT}"/>` +
      `<circle cx="76" cy="38" r="2.4" fill="${ACCENT}"/>`,
  },
};

/** Circular certification seal for `era`, diagramming that era's binding constraint. */
export function eraEmblem(era: 1 | 2 | 3 | 4 | 5, size: number = 64): string {
  const seal = ERAS[era];
  return (
    `<svg class="emblem emblem--era${era}" width="${size}" height="${size}" viewBox="0 0 120 120" ` +
    'fill="none" aria-hidden="true" focusable="false">' +
    SEAL_FRAME +
    seal.body +
    // x is nudged by half the tracking: SVG letter-spacing also trails the last
    // glyph, which pulls centred text off-axis by that amount.
    `<text x="61.1" y="22" text-anchor="middle" font-family="${MONO}" font-size="7" ` +
    `letter-spacing="2.2" fill="${DIM}">${seal.label}</text>` +
    `<path d="M40 100.5h9M71 100.5h9" stroke="${DIM}" stroke-width="1"/>` +
    `<text x="60" y="105.5" text-anchor="middle" font-family="${MONO}" font-size="14" ` +
    `font-weight="600" fill="${LINE}">${era}</text>` +
    '</svg>'
  );
}

/* ==========================================================================
 * Ship glyphs -- orthographic side elevations on a 96x40 grid, nose to the
 * right, centreline y=20. Hull outline at full strength; secondary structure
 * in a dimmed group so the silhouette still reads at 40px.
 * ========================================================================== */

const SHIPS: Record<ShipClassId, string> = {
  // Small utilitarian box: two bays, a stub drive, one mast.
  lighter:
    '<path d="M30 13h26l7 7-7 7H30z"/><path d="M30 15h-6v10h6"/>' +
    '<g opacity="0.55"><path d="M38 13v14M46 13v14M43 13V7h6"/></g>',
  // Long blunt cargo spine with a stern block and frame ribs.
  hauler:
    '<path d="M16 12h54l8 8-8 8H16z"/><path d="M8 14h8v12H8z"/>' +
    '<g opacity="0.55"><path d="M16 20h62M26 12v16M36 12v16M46 12v16M56 12v16M66 12v16"/></g>',
  // Needle hull dwarfed by its drive bell.
  courier:
    '<path d="M86 20 62 16.5H44v7h18z"/><path d="M44 12 24 6.5v27L44 28z"/>' +
    '<g opacity="0.55"><path d="M44 12v16M36 8.8v22.4M30 7.2v25.6"/></g>',
  // Container train: four boxes on a spine behind a tug.
  freighter:
    '<path d="M14 13h12v14H14zM28 13h12v14H28zM42 13h12v14H42zM56 13h12v14H56z"/>' +
    '<path d="M70 13h8l10 7-10 7h-8z"/>' +
    '<g opacity="0.55"><path d="M12 20h2M26 20h2M40 20h2M54 20h2M68 20h2"/></g>',
  // Fusion torch forward, long radiator boom aft.
  clipper:
    '<path d="M88 20 76 15H62v10h14z"/><path d="M62 20H26"/><path d="M26 16 12 20l14 4"/>' +
    '<g opacity="0.55"><path d="M30 11h30M30 29h30M34 11v18M42 11v18M50 11v18M58 11v18M26 14v12"/></g>',
  // Relativistic liner: standoff shield ahead of a pressure hull.
  starliner:
    '<path d="M44 13h30v14H44z"/><path d="M44 13 34 16.5v7L44 27"/>' +
    '<path d="M86 4A18 18 0 0 1 86 36"/>' +
    '<g opacity="0.55"><path d="M74 16 84 12M74 24l10 4M50 20h1.5M55 20h1.5M60 20h1.5M65 20h1.5M70 20h1.5"/></g>',
  // Ramscoop: wide intake funnel, almost no hull.
  needle:
    '<path d="M18 18h38v4H18z"/><path d="M18 18 8 20l10 2"/><path d="M56 20 90 3M56 20l34 17"/>' +
    '<g opacity="0.55"><path d="M74 11.5A14 14 0 0 1 74 28.5M64 15.5A9 9 0 0 1 64 24.5"/></g>',
  // Boxy hull carried inside a warp shell, compressed fore and stretched aft.
  bubblefreighter:
    '<ellipse cx="48" cy="20" rx="43" ry="17"/><path d="M32 15h26l6 5-6 5H32z"/>' +
    '<g opacity="0.55"><path d="M84 8A20 20 0 0 1 84 32M14 6A26 26 0 0 0 14 34M42 15v10M50 15v10"/></g>',
  // Almost nothing but bubble.
  skiff:
    '<circle cx="48" cy="20" r="17.5"/><path d="M42 18h10l4 2-4 2H42z"/>' +
    '<g opacity="0.55"><circle cx="48" cy="20" r="19.5"/><path d="M8 20h20M68 20h20M47 18v-5"/></g>',
  // Vast segmented structure, six drums on one keel.
  arkline:
    '<path d="M8 7h11v26H8zM21 7h11v26H21zM34 7h11v26H34zM47 7h11v26H47zM60 7h11v26H60zM73 7h11v26H73z"/>' +
    '<path d="M84 14 92 20l-8 6z"/>' +
    '<g opacity="0.55"><path d="M6 20h84M8 5h76M8 35h76"/></g>',
  // Half in this sheet, half in the next.
  braneferry:
    '<path d="M20 15h26v10H20z"/><path d="M20 15 12 20l8 5"/>' +
    '<g opacity="0.4"><path d="M46 15h22l8 5-8 5H46z"/></g>' +
    '<g opacity="0.55"><path d="M6 8h84M6 32h84"/></g>' +
    '<g opacity="0.3"><path d="M52 8v24M62 8v24M72 8v24"/></g>',
};

/** Neutral hull for an id the art set does not know about. */
const SHIP_FALLBACK =
  '<path d="M28 14h30l8 6-8 6H28z"/><path d="M28 16h-6v8h6"/>' +
  '<g opacity="0.55"><path d="M40 14v12"/></g>';

/** Widened view of the table so an unknown runtime id falls back rather than throwing. */
const SHIP_TABLE: Record<string, string | undefined> = SHIPS;

/** Side elevation for a ship class. Renders `size` px tall on a 2.4:1 canvas. */
export function shipGlyph(classId: ShipClassId, size: number = 40): string {
  const body = SHIP_TABLE[classId] ?? SHIP_FALLBACK;
  const width = Math.round(size * 2.4);
  return (
    `<svg class="ship ship--${classId}" width="${width}" height="${size}" viewBox="0 0 96 40" ` +
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/* ==========================================================================
 * Ending plate -- shown once, on the final milestone. 400x260, engraved.
 * ========================================================================== */

/** Commemorative plate for the end of the run. */
export function endingPlate(size: number = 400): string {
  const height = Math.round(size * 0.65);
  const corner = (x: number, y: number, dx: number, dy: number): string =>
    `<path d="M${x} ${y + dy * 9}V${y}h${dx * 9}"/>`;
  return (
    `<svg class="ending-plate" width="${size}" height="${height}" viewBox="0 0 400 260" ` +
    'fill="none" aria-hidden="true" focusable="false">' +
    `<rect x="0.5" y="0.5" width="399" height="259" rx="3" fill="${PLATE}" stroke="${DIM}"/>` +
    `<rect x="10.5" y="10.5" width="379" height="239" fill="none" stroke="${LINE}" stroke-width="1.2"/>` +
    `<rect x="16.5" y="16.5" width="367" height="227" fill="none" stroke="${DIM}" stroke-width="0.8"/>` +
    `<g stroke="${ACCENT}" stroke-width="1.4" fill="none">` +
    corner(24, 24, 1, 1) +
    corner(376, 24, -1, 1) +
    corner(24, 236, 1, -1) +
    corner(376, 236, -1, -1) +
    '</g>' +
    // Every centred line is nudged right by half its tracking: SVG letter-spacing
    // trails the last glyph too, which otherwise pulls the line off-axis.
    `<text x="202" y="48" text-anchor="middle" font-family="${MONO}" font-size="8.5" ` +
    `letter-spacing="4" fill="${DIM}">OFFICE OF INTERGALACTIC TRAFFIC</text>` +
    `<text x="202.5" y="84" text-anchor="middle" font-family="${SERIF}" font-size="31" ` +
    `letter-spacing="5" fill="${LINE}">ROUTE AUTHORITY</text>` +
    `<path d="M70 96h260" stroke="${DIM}" stroke-width="0.9"/>` +
    `<text x="201.5" y="118" text-anchor="middle" font-family="${MONO}" font-size="9" ` +
    `letter-spacing="3" fill="${LINE}">CERTIFICATE OF FINAL CLEARANCE</text>` +
    `<text x="200.7" y="140" text-anchor="middle" font-family="${MONO}" font-size="8.5" ` +
    `letter-spacing="1.4" fill="${DIM}">ALL LANES CHARTERED &#183; ALL TRANSFER WINDOWS CLOSED</text>` +
    `<text x="200.7" y="155" text-anchor="middle" font-family="${MONO}" font-size="8.5" ` +
    `letter-spacing="1.4" fill="${DIM}">SOL &#8594; MULTIVERSE, SURVEYED AND LICENSED IN FULL</text>` +
    `<text x="203.5" y="183" text-anchor="middle" font-family="${SERIF}" font-size="17" ` +
    `letter-spacing="7" fill="${ACCENT}">IN PERPETUITY</text>` +
    // Registry seal, lower left.
    `<g transform="translate(62 204)" fill="none" stroke="${DIM}">` +
    '<circle r="18" stroke-width="1.2"/><circle r="14" stroke-width="0.8"/>' +
    '<path d="M0-22v7M0 15v7M-22 0h7M15 0h7" stroke-width="1"/>' +
    `<text x="0.75" y="4" text-anchor="middle" font-family="${MONO}" font-size="11" ` +
    `letter-spacing="1.5" fill="${LINE}" stroke="none">RA</text></g>` +
    // Countersignature, lower right.
    `<text x="275" y="202" text-anchor="middle" font-family="${SERIF}" font-size="13" ` +
    `font-style="italic" fill="${LINE}">the undersigned</text>` +
    `<path d="M212 209h126" stroke="${DIM}" stroke-width="0.9"/>` +
    `<text x="276.3" y="222" text-anchor="middle" font-family="${MONO}" font-size="7.5" ` +
    `letter-spacing="2.6" fill="${DIM}">REGISTRAR OF ROUTES</text>` +
    `<text x="201" y="237" text-anchor="middle" font-family="${MONO}" font-size="6.5" ` +
    `letter-spacing="2" fill="${DIM}">FILE 00000001 &#183; NO FURTHER TRAFFIC IS EXPECTED</text>` +
    '</svg>'
  );
}
