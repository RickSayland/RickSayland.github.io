// ============ GUTSIM — ANATOMY ============
// The tract is authored as a chain of capsules (a segment plus a radius). That
// one primitive covers everything: the oesophagus is a thin vertical capsule,
// the stomach is two fat overlapping ones, an intestinal run is a long thin one.
//
// Walls are not authored at all — they are DILATED out of the lumen. Any cell
// that is not lumen but sits within WALL_R of one becomes tissue, so adding an
// organ means adding a capsule and nothing else. It also means two runs of
// intestine can never accidentally leak into each other: every cell in the gap
// between them is non-lumen, and therefore wall.
//
// Cells also pick up the fields that make peristalsis work — a flow direction,
// a strength, and `arc`, the 0-255 position along the whole tract that the
// travelling contraction wave is indexed by.

const WALL_R = 3;

const ZONES = {
    outside:   { id: 0, name: '—' },
    mouth:     { id: 1, name: 'Mouth',              lining: 'MUSCLE', absorbs: [] },
    esophagus: { id: 2, name: 'Oesophagus',         lining: 'MUSCLE', absorbs: [] },

    // The only place ethanol crosses without being digested first. Everything
    // else has to survive the pylorus before any of it counts.
    stomach:   { id: 3, name: 'Stomach',            lining: 'MUSCLE', absorbs: ['alcohol'],
                 secretes: 'acid' },

    pylorus:   { id: 4, name: 'Pyloric sphincter',  lining: 'MUSCLE', absorbs: [] },

    duodenum:  { id: 5, name: 'Duodenum',           lining: 'VILLI',
                 absorbs: ['protein', 'carb', 'fat', 'alcohol', 'water'],
                 enzymes: true, secretes: 'bile' },

    intestine: { id: 6, name: 'Small intestine',    lining: 'VILLI',
                 absorbs: ['protein', 'carb', 'fat', 'alcohol', 'water'],
                 enzymes: true },

    colon:     { id: 7, name: 'Colon',              lining: 'VILLI', absorbs: ['water'] },
    exit:      { id: 8, name: 'Elimination',        lining: 'MUSCLE', absorbs: [] }
};

const ZONE_BY_ID = [];
for (const key of Object.keys(ZONES)) {
    ZONES[key].key = key;
    ZONE_BY_ID[ZONES[key].id] = ZONES[key];
}

// Ordered mouth-to-exit; `arc` is cumulative length along this chain.
// `flow: 'along'` pushes toward (x2,y2); 'churn' rotates about the midpoint,
// which is what the antrum does to grind a bolus down to something the sieve
// will pass. The fundus above it is deliberately still — it stores, it does
// not mix, and a stomach that churned everywhere would refluxes up the
// oesophagus.
const TRACT = [
    { zone: 'mouth',     x1: 58,  y1: 4,   x2: 58,  y2: 22,  r: 20, flow: 'none' },
    { zone: 'esophagus', x1: 58,  y1: 20,  x2: 56,  y2: 54,  r: 10, flow: 'along', str: 210 },

    // Fundus, body, antrum. The fundus bulges left of where the oesophagus
    // enters, which is what gives a stomach its shoulder instead of reading as
    // a tube that simply got fatter. The antrum then tapers over two shrinking
    // capsules into the pylorus, and the pylorus SLOPES DOWN as it goes right:
    // its far lip has to be the lowest point of the whole stomach, or chyme
    // settles into a sump below the opening and gravity will never empty it.
    // The fundus is a reservoir and stays still — its round floor drains itself.
    // Everything below it needs a push, though: the body floor is nearly level
    // where it meets the antrum, and gravity cannot move anything sideways, so
    // without a flow here chyme settles on that floor and simply stops. Real
    // gastric peristalsis starts in the body and sweeps toward the pylorus,
    // which is exactly the fix.
    { zone: 'stomach',   x1: 42,  y1: 64,  x2: 44,  y2: 70,  r: 21, flow: 'none' },
    { zone: 'stomach',   x1: 46,  y1: 78,  x2: 54,  y2: 92,  r: 16, flow: 'along', str: 95 },
    { zone: 'stomach',   x1: 56,  y1: 94,  x2: 72,  y2: 104, r: 11, flow: 'churn', str: 110 },
    { zone: 'stomach',   x1: 72,  y1: 104, x2: 86,  y2: 112, r: 9,  flow: 'along', str: 150 },

    { zone: 'pylorus',   x1: 86,  y1: 116, x2: 104, y2: 122, r: 5,  flow: 'along', str: 200 },
    { zone: 'duodenum',  x1: 104, y1: 122, x2: 134, y2: 128, r: 7,  flow: 'along', str: 190 },
    { zone: 'intestine', x1: 134, y1: 128, x2: 256, y2: 128, r: 7,  flow: 'along', str: 190 },
    { zone: 'intestine', x1: 256, y1: 128, x2: 256, y2: 146, r: 7,  flow: 'along', str: 190 },
    { zone: 'intestine', x1: 256, y1: 146, x2: 90,  y2: 146, r: 7,  flow: 'along', str: 190 },
    { zone: 'intestine', x1: 90,  y1: 146, x2: 90,  y2: 166, r: 7,  flow: 'along', str: 190 },
    { zone: 'intestine', x1: 90,  y1: 166, x2: 258, y2: 166, r: 7,  flow: 'along', str: 190 },
    { zone: 'colon',     x1: 258, y1: 166, x2: 262, y2: 186, r: 8,  flow: 'along', str: 165 },
    { zone: 'colon',     x1: 262, y1: 186, x2: 34,  y2: 186, r: 8,  flow: 'along', str: 165 },
    { zone: 'exit',      x1: 34,  y1: 186, x2: 14,  y2: 186, r: 8,  flow: 'along', str: 255 }
];

// The sieve is one column of cells in the gap between the antrum's right edge
// (x 95) and the duodenum's left (x 97), so it spans the entire opening and
// there is no way around it. It has to be restricted to the pylorus zone as
// well as the column: other runs of intestine cross x 96 further down, and
// stamping those would wall off the jejunum.
const SIEVE_X = 96;

const anatomy = {
    lumen: null,
    emitters: { acid: [], bile: [] },
    dropX: 58,
    dropY: 2,

    init() {
        const g = grid, n = g.w * g.h;
        this.lumen = new Uint8Array(n);

        this.carveLumen();
        this.buildWalls();
        this.stampSieve();
        this.findEmitters();
    },

    // ---- Pass 1: lumen, zones, flow field ----

    carveLumen() {
        const g = grid;

        // Cumulative arc length, so the peristaltic wave marches continuously
        // from mouth to exit instead of restarting at every segment boundary.
        let total = 0;
        for (const s of TRACT) {
            s.len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
            s.arc0 = total;
            total += s.len;
        }

        for (let y = 0; y < g.h; y++) {
            for (let x = 0; x < g.w; x++) {
                let best = null, bestDepth = Infinity;

                for (const s of TRACT) {
                    const p = projectOnSegment(x + 0.5, y + 0.5, s);
                    if (p.d > s.r) continue;
                    // Relative depth, so a narrow tube crossing a fat chamber
                    // still owns the cells on its own axis.
                    const depth = p.d / s.r;
                    if (depth < bestDepth) { bestDepth = depth; best = { s, p }; }
                }
                if (!best) continue;

                const i = y * g.w + x;
                const { s, p } = best;
                this.lumen[i] = 1;
                g.zone[i] = ZONES[s.zone].id;
                g.arc[i] = Math.round(((s.arc0 + p.t * s.len) / total) * 255) & 255;

                if (s.flow === 'along') {
                    g.flowDir[i] = nearestDir(s.x2 - s.x1, s.y2 - s.y1);
                    g.flowStr[i] = s.str;
                } else if (s.flow === 'churn') {
                    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
                    g.flowDir[i] = nearestDir(-(y - my), x - mx);
                    g.flowStr[i] = s.str;
                }
            }
        }
    },

    // ---- Pass 2: dilate the lumen into tissue ----

    buildWalls() {
        const g = grid;
        for (let y = 0; y < g.h; y++) {
            for (let x = 0; x < g.w; x++) {
                const i = y * g.w + x;
                if (this.lumen[i]) continue;

                let nearZone = 0, bestD = Infinity, touching = false;
                for (let dy = -WALL_R; dy <= WALL_R; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= g.h) continue;
                    for (let dx = -WALL_R; dx <= WALL_R; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= g.w) continue;
                        const j = ny * g.w + nx;
                        if (!this.lumen[j]) continue;
                        const d = dx * dx + dy * dy;
                        if (d > WALL_R * WALL_R) continue;
                        if (d < bestD) { bestD = d; nearZone = g.zone[j]; }
                        if (d === 1) touching = true;
                    }
                }
                if (bestD === Infinity) continue;

                // Only the innermost course is lining. The rest is bulk wall, so
                // the villi read as a bright inner surface rather than a slab.
                g.type[i] = touching ? EL[ZONE_BY_ID[nearZone].lining] : EL.TISSUE;
                g.tint[i] = (Math.random() * 8) | 0;
                g.zone[i] = nearZone;
            }
        }
    },

    stampSieve() {
        const g = grid;
        for (let y = 0; y < g.h; y++) {
            const i = y * g.w + SIEVE_X;
            if (!this.lumen[i] || g.zone[i] !== ZONES.pylorus.id) continue;
            g.type[i] = EL.SIEVE;
            g.tint[i] = (Math.random() * 8) | 0;
        }
    },

    // ---- Secretion sites ----
    // Found by scanning rather than hard-coded, so nudging a capsule does not
    // silently leave an emitter buried in the wall.

    findEmitters() {
        this.emitters.acid = this.pickLumen(ZONES.stomach.id, (a, b) => a.y - b.y, 0.10, 6);
        this.emitters.bile = this.pickLumen(ZONES.duodenum.id, (a, b) => (a.x + a.y) - (b.x + b.y), 0.15, 4);
    },

    pickLumen(zoneId, cmp, headFrac, count) {
        const g = grid, cells = [];
        for (let y = 0; y < g.h; y++) {
            for (let x = 0; x < g.w; x++) {
                const i = y * g.w + x;
                if (this.lumen[i] && g.zone[i] === zoneId) cells.push({ x, y, i });
            }
        }
        cells.sort(cmp);
        const head = cells.slice(0, Math.max(count, Math.floor(cells.length * headFrac)));
        const out = [];
        for (let k = 0; k < count && head.length; k++) {
            out.push(head[Math.floor((k + 0.5) / count * head.length)]);
        }
        return out;
    },

    zoneAt(i) { return ZONE_BY_ID[grid.zone[i]] || ZONES.outside; }
};

// ---- Geometry helpers ----

function projectOnSegment(px, py, s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - s.x1) * dx + (py - s.y1) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
    return { d: Math.hypot(px - cx, py - cy), t };
}

function nearestDir(dx, dy) {
    let best = NO_DIR, bestDot = -Infinity;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    for (let k = 0; k < DIRS.length; k++) {
        const d = DIRS[k];
        const dl = Math.hypot(d[0], d[1]);
        const dot = (ux * d[0] + uy * d[1]) / dl;
        if (dot > bestDot) { bestDot = dot; best = k; }
    }
    return best;
}
