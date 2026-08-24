// ============ GUTSIM — CHEMISTRY & BOOKKEEPING ============
// One pass over the grid per simulation step does all three jobs, because they
// all need the same walk and the same neighbour lookups:
//
//   digest  — a chunk in the right zone, touching the right agent, counts down
//             and then BECOMES one of its breakdown products, in place.
//   absorb  — a macro particle touching the lining of a zone that takes up that
//             macro is tallied and removed.
//   drain   — anything reaching the exit is tallied as passed and removed.
//
// Breakdown is 1 cell in, 1 cell out. Nothing multiplies, so a pile erodes from
// the outside in — only the surface of a bolus is touching acid, which is both
// what really happens and the reason a patty takes so much longer than a shake.
//
// Grams come from the food's label, not from the particles. Each drop declares
// how many macro particles it is worth (expected) and how many grams that is
// (panel); absorbing 40% of the expected particles reports 40% of the grams.
// So a fully absorbed Big Mac reads exactly 25/45/33 and nothing has to be
// calibrated by hand.

const ACID_TARGET = 620;   // cells of gastric acid the stomach holds
const BILE_MAX    = 340;
const SPARK_LIMIT = 240;

const digestion = {
    absorbed: null,   // particle counts, per macro
    expected: null,   // particle counts queued by everything dropped so far
    panel: null,      // declared grams, per macro
    passed: null,     // particle counts that reached the exit
    census: null,
    sparks: [],
    log: [],

    init() {
        this.reset();
    },

    reset() {
        this.absorbed = {};
        this.expected = {};
        this.passed = {};
        for (const k of ALL_MACRO_KEYS) {
            this.absorbed[k] = 0;
            this.expected[k] = 0;
            this.passed[k] = 0;
        }
        this.panel = {};
        for (const m of MACROS) this.panel[m.key] = 0;
        this.passed.other = 0;
        this.census = { acid: 0, bile: 0, fatblob: 0, contents: 0 };
        this.sparks.length = 0;
        this.log.length = 0;
    },

    registerDrop(food, counts, frac) {
        for (const idStr of Object.keys(counts)) {
            const el = ELEMENTS[+idStr];
            const n = counts[idStr];
            for (const k of ALL_MACRO_KEYS) this.expected[k] += el.macroYield[k] * n;
        }
        for (const m of MACROS) this.panel[m.key] += (food.panel[m.key] || 0) * frac;
        this.log.push({ key: food.key, name: food.name, icon: food.icon });
    },

    step() {
        this.secrete();
        this.scan();
        this.ageSparks();
    },

    // ---- Secretion ----

    secrete() {
        const g = grid;

        // Acid tops itself up to a fixed pool. Modelling it as consumed and
        // replenished would be more honest, but the visible level in the fundus
        // is doing most of the teaching here.
        if (this.census.acid < ACID_TARGET) {
            for (const p of anatomy.emitters.acid) {
                if (g.type[p.i] === EL.EMPTY) g.spawn(p.i, EL.ACID);
            }
        }

        // The gallbladder contracts when fat arrives, so bile release tracks how
        // much undigested fat is sitting downstream of the pylorus.
        const want = Math.min(BILE_MAX, 40 + this.census.fatblob * 0.8);
        if (this.census.bile < want) {
            for (const p of anatomy.emitters.bile) {
                if (g.type[p.i] === EL.EMPTY) g.spawn(p.i, EL.BILE);
            }
        }
    },

    // ---- The pass ----

    scan() {
        const g = grid, w = g.w, h = g.h;
        let acid = 0, bile = 0, fatblob = 0, contents = 0;

        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                const i = row + x;
                const t = g.type[i];
                if (t === EL.EMPTY) continue;

                const el = ELEMENTS[t];
                if (el.form === FORM.TISSUE) continue;

                contents++;
                if (t === EL.ACID) acid++;
                else if (t === EL.BILE) bile++;
                else if (t === EL.FATBLOB) fatblob++;

                const zone = ZONE_BY_ID[g.zone[i]] || ZONES.outside;

                if (zone.id === ZONES.exit.id) { this.drain(i, el); continue; }

                if (el.digest && el.digest.zoneSet.has(zone.key)) {
                    if (this.canDigest(el, zone, x, y)) {
                        if (g.timer[i] > 0) g.timer[i]--;
                        if (g.timer[i] === 0) { this.convert(i, el.digest); continue; }
                    }
                }

                if (el.absorbable && zone.absorbs.indexOf(el.macro) !== -1) {
                    if (this.touchesLining(x, y)) this.absorb(i, x, y, el);
                }
            }
        }

        this.census = { acid, bile, fatblob, contents };
    },

    // `needs: 'acid'` is satisfied by gastric acid OR by a zone that secretes
    // pancreatic enzymes, so a chunk that slipped past the stomach half-broken
    // still finishes downstream instead of stalling forever in the jejunum.
    canDigest(el, zone, x, y) {
        const needs = el.digest.needs;
        if (!needs) return true;
        if (needs === 'acid' && zone.enzymes) return true;
        return this.touchesAgent(x, y, needs);
    },

    touchesAgent(x, y, agent) {
        const g = grid;
        for (let k = 0; k < DIRS.length; k++) {
            const nx = x + DIRS[k][0], ny = y + DIRS[k][1];
            if (!g.inBounds(nx, ny)) continue;
            const t = g.type[ny * g.w + nx];
            if (t !== EL.EMPTY && ELEMENTS[t].agent === agent) return true;
        }
        return false;
    },

    // Only the innermost course of wall is lining, so a 4-neighbour that is
    // tissue is by construction the surface the lumen actually touches.
    touchesLining(x, y) {
        const g = grid;
        for (let k = 0; k < DIRS.length; k += 2) {
            const nx = x + DIRS[k][0], ny = y + DIRS[k][1];
            if (!g.inBounds(nx, ny)) continue;
            const t = g.type[ny * g.w + nx];
            if (t === EL.EMPTY) continue;
            const el = ELEMENTS[t];
            if (el.form === FORM.TISSUE && !el.membrane) return true;
        }
        return false;
    },

    convert(i, digest) {
        const r = Math.random();
        const outs = digest.outcomes;
        for (let k = 0; k < outs.length; k++) {
            if (r <= outs[k].upto) { grid.spawn(i, outs[k].id); return; }
        }
        grid.spawn(i, outs[outs.length - 1].id);
    },

    absorb(i, x, y, el) {
        this.absorbed[el.macro]++;
        grid.clear(i);
        if (this.sparks.length < SPARK_LIMIT) {
            this.sparks.push({ x, y, life: 1, color: el.color });
        }
    },

    drain(i, el) {
        if (el.macro) this.passed[el.macro]++;
        else this.passed.other++;
        grid.clear(i);
    },

    ageSparks() {
        for (let k = this.sparks.length - 1; k >= 0; k--) {
            this.sparks[k].life -= 0.08;
            if (this.sparks[k].life <= 0) this.sparks.splice(k, 1);
        }
    },

    // ---- Readout ----

    gramsOf(macro) {
        const exp = this.expected[macro];
        if (!exp) return 0;
        const frac = Math.min(1, this.absorbed[macro] / exp);
        return (this.panel[macro] || 0) * frac;
    },

    fractionOf(macro) {
        const exp = this.expected[macro];
        return exp ? Math.min(1, this.absorbed[macro] / exp) : 0;
    },

    kcalAbsorbed() {
        let k = 0;
        for (const m of MACROS) k += this.gramsOf(m.key) * m.kcal;
        return k;
    },

    kcalOffered() {
        let k = 0;
        for (const m of MACROS) k += this.panel[m.key] * m.kcal;
        return k;
    }
};
