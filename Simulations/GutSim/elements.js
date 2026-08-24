// ============ GUTSIM — ELEMENT TABLE ============
// The falling-sand material registry. Every cell in the grid holds one element
// id, and four families live in here:
//
//   tissue  — the tract itself (wall, villi, sphincters). Never moves.
//   agents  — acid, bile, water, gas. Move, and drive breakdown.
//   bolus   — coarse food chunks, which break DOWN into...
//   macros  — the four the panel counts, plus fibre and water.
//
// Breakdown is one generic rule (`digest`) shared by every family, which is the
// seam medications drop into later: a pill shell is just an element that
// `becomes` its payload after a dwell time in a named zone, and an enteric
// coating is the same element with `zone: ['intestine']` instead of ['stomach'].

const FORM = {
    TISSUE: 0,   // static; never moves
    CHUNK:  1,   // solid food; piles up and holds its shape for a while
    GRAIN:  2,   // fine powder; flows freely
    LIQUID: 3,   // flows down and spreads sideways
    GAS:    4    // rises
};

// The four the teaching panel is built around, plus the two that ride along.
// kcal/g is what makes alcohol worth calling a macro at all — 7 is nearly fat.
const MACROS = [
    { key: 'protein', name: 'Protein', kcal: 4, color: '#e15759' },
    { key: 'carb',    name: 'Carbs',   kcal: 4, color: '#edc948' },
    { key: 'fat',     name: 'Fat',     kcal: 9, color: '#f2e6cf' },
    { key: 'alcohol', name: 'Alcohol', kcal: 7, color: '#a06bd8' }
];

const TRACE_MACROS = [
    { key: 'fiber', name: 'Fibre', kcal: 0, color: '#6f9a4a' },
    { key: 'water', name: 'Water', kcal: 0, color: '#3f7fb5' }
];

const ALL_MACRO_KEYS = [...MACROS, ...TRACE_MACROS].map(m => m.key);

const ELEMENTS = [];
const EL = {};

function defineElement(key, spec) {
    const el = {
        id: ELEMENTS.length,
        key,
        name: key,
        form: FORM.CHUNK,
        color: '#888888',
        jitter: 12,       // per-cell brightness scatter, so piles look granular
        density: 1.20,    // heavier sinks through lighter
        slip: 0.30,       // powder: chance of sliding diagonally when blocked
        spread: 0,        // liquid: how far it creeps sideways per step
        fine: false,      // small enough to clear the pyloric sieve
        macro: null,      // which panel column this counts toward
        absorbable: false,// villi take it up
        agent: null,      // 'acid' / 'bile' — satisfies another element's `needs`
        membrane: false,  // one-cell gate that only `fine` particles cross
        digest: null,     // { zone, needs, time, into } — see resolveElements()
        ...spec
    };
    ELEMENTS.push(el);
    EL[key] = el.id;
    return el.id;
}

// ---- Nothing ----

defineElement('EMPTY', { name: 'Empty', form: FORM.TISSUE, color: '#000000', jitter: 0 });

// ---- Tissue ----

defineElement('TISSUE', { name: 'Gut wall',  form: FORM.TISSUE, color: '#5d3038', jitter: 9 });
defineElement('VILLI',  { name: 'Villi',     form: FORM.TISSUE, color: '#b0596a', jitter: 16 });
defineElement('MUSCLE', { name: 'Muscle',    form: FORM.TISSUE, color: '#8a4152', jitter: 10 });

// The pyloric sphincter is a sieve, not a door. Real stomachs hold food back
// until it is ground to roughly 2mm, so this is one cell thick and only
// `fine` particles pass — which is what stops a whole burger from dropping
// straight through, without needing a timer to gate it.
defineElement('SIEVE', {
    name: 'Pyloric sphincter', form: FORM.TISSUE,
    color: '#c07a4a', jitter: 10, membrane: true
});

// ---- Agents ----

// Acid is deliberately NOT `fine`: real gastric acid does empty into the
// duodenum, but modelling that drains the pool that makes the stomach legible.
// Secretion is capped instead (see digestion.secrete).
defineElement('ACID', {
    name: 'Gastric acid (HCl)', form: FORM.LIQUID,
    color: '#c2e04a', jitter: 14, density: 1.06, spread: 4, agent: 'acid'
});

defineElement('BILE', {
    name: 'Bile', form: FORM.LIQUID,
    color: '#3f9f63', jitter: 12, density: 1.02, spread: 4, fine: true, agent: 'bile'
});

defineElement('WATER', {
    name: 'Water', form: FORM.LIQUID,
    color: '#3f7fb5', jitter: 10, density: 1.00, spread: 5,
    fine: true, macro: 'water', absorbable: true
});

defineElement('GAS', {
    name: 'Gas (CO₂)', form: FORM.GAS,
    color: '#9fb0bd', jitter: 14, density: 0.05, spread: 2, fine: true
});

// ---- Macros: what the villi actually take up ----

defineElement('AMINO', {
    name: 'Amino acids', form: FORM.GRAIN,
    color: '#e15759', jitter: 16, density: 1.10, slip: 0.90,
    fine: true, macro: 'protein', absorbable: true
});

defineElement('GLUCOSE', {
    name: 'Glucose', form: FORM.GRAIN,
    color: '#edc948', jitter: 16, density: 1.08, slip: 0.92,
    fine: true, macro: 'carb', absorbable: true
});

defineElement('FAT', {
    name: 'Fatty acids', form: FORM.LIQUID,
    color: '#f2e6cf', jitter: 10, density: 0.90, spread: 3,
    fine: true, macro: 'fat', absorbable: true
});

// Ethanol needs no digestion at all, which is exactly why it hits so fast —
// the stomach lining absorbs it directly (see ZONES.stomach.absorbs).
defineElement('ETHANOL', {
    name: 'Ethanol', form: FORM.LIQUID,
    color: '#a06bd8', jitter: 14, density: 0.98, spread: 5,
    fine: true, macro: 'alcohol', absorbable: true
});

// Fibre is `fine` so it clears the pylorus, but never absorbable — it rides
// the whole tract and is tallied at the exit instead.
defineElement('FIBER', {
    name: 'Fibre', form: FORM.GRAIN,
    color: '#6f9a4a', jitter: 14, density: 1.05, slip: 0.60,
    fine: true, macro: 'fiber', absorbable: false
});

// Undigested fat leaves the stomach as coarse globules — floating on the acid
// the whole way, because density 0.88 is lighter than everything around it.
// Bile in the duodenum is the only thing that splits it into absorbable FAT.
defineElement('FATBLOB', {
    name: 'Fat globule', form: FORM.LIQUID,
    color: '#e8c98a', jitter: 12, density: 0.88, spread: 2, fine: true,
    digest: { zone: ['duodenum', 'intestine'], needs: 'bile', time: 60, into: { FAT: 1 } }
});

// ---- Food ----
// `into` weights are element keys, not macro keys, so a chunk can break into
// an intermediate (FATBLOB) that then breaks down again further along.
// `needs: 'acid'` is satisfied by touching acid OR by sitting in a zone that
// secretes pancreatic enzymes (duodenum, intestine) — see digestion.canDigest.

function defineFood(key, spec) {
    return defineElement(key, { form: FORM.CHUNK, density: 1.25, slip: 0.22, ...spec });
}

defineFood('BUN', {
    name: 'Bun', color: '#d8a860',
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 70,
              into: { GLUCOSE: 0.74, WATER: 0.20, FIBER: 0.06 } }
});

defineFood('PATTY', {
    name: 'Beef patty', color: '#6b4030', slip: 0.16,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 170,
              into: { AMINO: 0.50, FATBLOB: 0.34, WATER: 0.16 } }
});

defineFood('CHEESE', {
    name: 'Cheese', color: '#e8b040', slip: 0.18,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 130,
              into: { FATBLOB: 0.58, AMINO: 0.31, WATER: 0.11 } }
});

defineFood('LETTUCE', {
    name: 'Lettuce', color: '#5fa04a', slip: 0.35,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 45,
              into: { FIBER: 0.48, WATER: 0.52 } }
});

defineFood('SAUCE', {
    name: 'Special sauce', form: FORM.LIQUID, color: '#d8804a', density: 1.10, spread: 2,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 40,
              into: { FATBLOB: 0.42, GLUCOSE: 0.38, WATER: 0.20 } }
});

defineFood('PICKLE', {
    name: 'Pickle', color: '#7a9a3a', slip: 0.30,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 55,
              into: { FIBER: 0.38, WATER: 0.62 } }
});

defineFood('RICE', {
    name: 'Sushi rice', color: '#f0ece0', slip: 0.55,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 60,
              into: { GLUCOSE: 0.80, WATER: 0.20 } }
});

defineFood('FISH', {
    name: 'Salmon', color: '#e8907a', slip: 0.18,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 120,
              into: { AMINO: 0.64, FATBLOB: 0.21, WATER: 0.15 } }
});

defineFood('NORI', {
    name: 'Nori', color: '#2f5244', slip: 0.28,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 65,
              into: { FIBER: 0.68, AMINO: 0.16, WATER: 0.16 } }
});

defineFood('CRUST', {
    name: 'Pizza crust', color: '#d4a05a',
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 85,
              into: { GLUCOSE: 0.76, WATER: 0.16, FIBER: 0.08 } }
});

defineFood('MOZZ', {
    name: 'Mozzarella', color: '#f0e8d0', slip: 0.18,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 125,
              into: { FATBLOB: 0.54, AMINO: 0.35, WATER: 0.11 } }
});

defineFood('PEPPERONI', {
    name: 'Pepperoni', color: '#a03828', slip: 0.16,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 150,
              into: { FATBLOB: 0.56, AMINO: 0.32, WATER: 0.12 } }
});

defineFood('TOMATO', {
    name: 'Tomato sauce', form: FORM.LIQUID, color: '#c8402a', density: 1.08, spread: 3,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 35,
              into: { GLUCOSE: 0.34, WATER: 0.50, FIBER: 0.16 } }
});

defineFood('CREAM', {
    name: 'Ice cream', color: '#f4e0e8', slip: 0.45,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 55,
              into: { FATBLOB: 0.40, GLUCOSE: 0.40, WATER: 0.20 } }
});

defineFood('CONE', {
    name: 'Wafer cone', color: '#c89050',
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 75,
              into: { GLUCOSE: 0.84, FIBER: 0.10, WATER: 0.06 } }
});

// A shake is already liquid, so it needs no grinding — it digests in a third
// the time of a patty and empties the stomach fast. That contrast is the point.
defineFood('WHEY', {
    name: 'Protein shake', form: FORM.LIQUID, color: '#e0d8ee', density: 1.03, spread: 4,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: 'acid', time: 45,
              into: { AMINO: 0.74, GLUCOSE: 0.10, WATER: 0.16 } }
});

// Beer splits with no acid required at all — `needs: null`. The ethanol it
// releases is absorbable on contact, so it starts crossing the stomach lining
// while a burger dropped at the same moment is still a lump of patty.
defineFood('BEERLIQ', {
    name: 'Beer', form: FORM.LIQUID, color: '#d8a838', density: 1.00, spread: 5,
    digest: { zone: ['stomach', 'duodenum', 'intestine'], needs: null, time: 18,
              into: { ETHANOL: 0.26, GLUCOSE: 0.16, WATER: 0.52, GAS: 0.06 } }
});

// ---- Resolution ----
// Runs once, after the table is complete, so `into` can name elements defined
// later in the file without forward-reference gymnastics.

function resolveElements() {
    for (const el of ELEMENTS) {
        buildPalette(el);
        if (!el.digest) continue;

        const d = el.digest;
        const src = d.becomes ? { [d.becomes]: 1 } : d.into;
        const keys = Object.keys(src);
        let total = 0;
        for (const k of keys) total += src[k];

        // Cumulative weights, so picking an outcome is one pass over a small array.
        d.outcomes = [];
        let acc = 0;
        for (const k of keys) {
            acc += src[k] / total;
            d.outcomes.push({ id: EL[k], upto: acc });
        }
        d.zoneSet = new Set(d.zone);
    }

    // Roll each element's `into` chain forward to terminal macros, so a drop of
    // food can declare up front how many particles of each macro it is worth.
    // That count is what turns absorbed particles back into grams.
    for (const el of ELEMENTS) el.macroYield = macroYieldOf(el, 0);
}

function macroYieldOf(el, depth) {
    const out = {};
    for (const k of ALL_MACRO_KEYS) out[k] = 0;

    if (el.macro) { out[el.macro] = 1; return out; }
    if (!el.digest || depth > 6) return out;

    let prev = 0;
    for (const o of el.digest.outcomes) {
        const share = o.upto - prev;
        prev = o.upto;
        const sub = macroYieldOf(ELEMENTS[o.id], depth + 1);
        for (const k of ALL_MACRO_KEYS) out[k] += sub[k] * share;
    }
    return out;
}

// Eight pre-jittered shades per element. Each cell keeps a fixed index into
// this, so a pile has grain but individual particles do not shimmer as they move.
const JITTER_STEPS = [-1, 0.55, -0.7, 0.25, 0.85, -0.35, 0.1, -0.9];

function buildPalette(el) {
    const hex = el.color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    el.pal = new Uint8Array(24);
    for (let k = 0; k < 8; k++) {
        const j = JITTER_STEPS[k] * el.jitter;
        el.pal[k * 3]     = Math.max(0, Math.min(255, Math.round(r + j)));
        el.pal[k * 3 + 1] = Math.max(0, Math.min(255, Math.round(g + j)));
        el.pal[k * 3 + 2] = Math.max(0, Math.min(255, Math.round(b + j)));
    }
}

resolveElements();
