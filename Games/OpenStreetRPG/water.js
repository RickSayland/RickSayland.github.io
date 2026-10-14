// ============ OPENSTREETRPG — WATER ============
// Where the water is, read off the map tiles the player is already looking
// at. Owns `water`.
//
// OpenStreetMap does mark water — lakes, rivers, canals and ponds as areas,
// and the sea as a coastline line that gets assembled into ocean polygons —
// and the standard map style fills all of it in one colour, #aad3df. Reading
// that colour back out of the rendered tiles costs no extra network request
// at all, covers the whole planet, and means what blocks you is exactly what
// you can see. The alternative, fetching the vector data from Overpass, would
// mean assembling the coastline ourselves and a heavy query per area against
// a donated service.
//
// The price is that this sees pixels, not features, so three rules make it
// behave:
//   - Each loaded tile is reduced once to a 256x256 water mask (64 KB),
//     cached, and sampled from then on; the tile canvas is never read.
//   - A point is water only if MOST of a small disc around it is water
//     coloured. Lines and lettering drawn on top of water (ferry routes,
//     borders, river names) cannot open a gap, and a bridge — whose road is
//     drawn over the river — stays dry.
//   - No tile loaded means "don't know", which never blocks. Being stuck
//     because a tile was slow is worse than an occasional splash.

const water = {

    RGB: [170, 211, 223],       // OSM Carto's water fill
    TOL2: 3 * 14 * 14,          // squared RGB distance still counted as water
    LEVELS: [18, 17, 16, 15, 19],   // fallback order after the level on screen
    RADIUS: 3,                  // sample disc radius, in pixels at zoom 18 (~1.5 m in London)
    MASK_MAX: 64,

    masks: new Map(),           // 'z/x/y' -> Uint8Array mask, or null if the tile could not be read
    lastKey: '',
    lastMask: null,
    canvas: null,
    cx: null,

    init() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvas.height = 256;
        this.cx = this.canvas.getContext('2d', { willReadFrequently: true });
    },

    // The water mask for a tile: built on first use from the cached image,
    // undefined if the tile is not loaded, null if it cannot be read (a
    // server that stopped sending CORS headers would taint the canvas).
    mask(z, tx, ty) {
        const k = z + '/' + tx + '/' + ty;
        if (k === this.lastKey) return this.lastMask;
        let m = this.masks.get(k);
        if (m === undefined) {
            const img = tiles.ready(z, tx, ty);
            if (!img) return undefined;
            m = this.build(img);
            this.masks.set(k, m);
            if (this.masks.size > this.MASK_MAX) this.masks.delete(this.masks.keys().next().value);
        } else {
            this.masks.delete(k);       // move to the back: least-recently-used eviction
            this.masks.set(k, m);
        }
        this.lastKey = k;
        this.lastMask = m;
        return m;
    },

    build(img) {
        const c = this.cx;
        c.clearRect(0, 0, 256, 256);
        c.drawImage(img, 0, 0);
        let d;
        try { d = c.getImageData(0, 0, 256, 256).data; } catch (e) { return null; }
        const [R, G, B] = this.RGB, m = new Uint8Array(65536);
        for (let i = 0, j = 0; i < 65536; i++, j += 4) {
            const dr = d[j] - R, dg = d[j + 1] - G, db = d[j + 2] - B;
            m[i] = dr * dr + dg * dg + db * db <= this.TOL2 ? 1 : 0;
        }
        return m;
    },

    // One pixel at zoom z: 1 water, 0 not, undefined if that tile is not loaded.
    pixel(z, x, y) {
        x -= Math.floor(x);
        const n = 1 << z, px = x * n * 256, py = y * n * 256;
        const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
        if (ty < 0 || ty >= n) return undefined;
        const m = this.mask(z, tx % n, ty);
        if (!m) return undefined;
        return m[(Math.floor(py) - ty * 256) * 256 + (Math.floor(px) - tx * 256)];
    },

    // How much of the small disc around normalised mercator (x, y) is water,
    // 0..1, or null when too little of the map there has loaded to say.
    //
    // The whole disc is read from ONE zoom level: the one on screen first
    // (always loaded around the player), then the fallbacks. Each level draws
    // a shore slightly differently, and a disc stitched from two of them
    // flickers at the edge — a car at zoom 17 driving past leftover zoom-18
    // tiles slipped into a lake that way.
    wetness(x, y) {
        const r = this.RADIUS / geo.worldPx(18), shown = tiles.level();
        for (let k = -1; k < this.LEVELS.length; k++) {
            const z = k < 0 ? shown : this.LEVELS[k];
            if (k >= 0 && z === shown) continue;
            if (this.pixel(z, x, y) === undefined) continue;
            let wet = 0, known = 0;
            for (let i = -1; i < 8; i++) {
                const a = i * Math.PI / 4;
                const v = i < 0 ? this.pixel(z, x, y) : this.pixel(z, x + Math.cos(a) * r, y + Math.sin(a) * r);
                if (v === undefined) continue;
                known++;
                wet += v;
            }
            if (known >= 5) return wet / known;
        }
        return null;
    },

    // true, false, or null (unknown). Water is MOST of the disc, not any of it.
    isWater(x, y) {
        const w = this.wetness(x, y);
        return w === null ? null : w > 0.5;
    },

    blocks(x, y) { return this.isWater(x, y) === true; },

    // A unit vector pointing from (x, y) into the water — the shore's normal
    // — from the slope of the wetness field, or null where it is flat or the
    // map has not loaded, i.e. there is no shore here to slide along.
    shoreNormal(x, y) {
        const h = 2 * this.RADIUS / geo.worldPx(18);
        const e = this.wetness(x + h, y), w = this.wetness(x - h, y);
        const s = this.wetness(x, y + h), n = this.wetness(x, y - h);
        if (e === null || w === null || s === null || n === null) return null;
        const gx = e - w, gy = s - n, g = Math.hypot(gx, gy);
        return g < 0.05 ? null : [gx / g, gy / g];
    }
};
