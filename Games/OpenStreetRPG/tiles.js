// ============ OPENSTREETRPG — MAP TILES ============
// Fetches the standard OpenStreetMap raster tiles and paints them under the
// camera. Owns `tiles`.
//
// The OSM tile servers are donated, and their usage policy is the constraint
// this file is written around (operations.osmfoundation.org/policies/tiles):
// show the attribution (index.html does), let the browser cache tiles, and
// never fetch what nobody is going to see. So tiles are only ever REQUESTED
// at the integer target zoom, for the screen plus a thin MARGIN, nearest the
// centre first and at most MAX_INFLIGHT at a time. Mid-zoom frames DRAW at a
// fractional scale but fetch nothing extra: a missing tile is filled from an
// ancestor that is already cached (blurry for a moment, never blank) or from
// its children when zooming out.

const tiles = {

    URL: 'https://tile.openstreetmap.org/',
    MAX_Z: 19,              // deepest level the OSM standard layer serves
    MAX_INFLIGHT: 8,
    MARGIN: 128,            // CSS px fetched past each screen edge
    CACHE_MAX: 400,         // entries kept before least-recently-drawn eviction
    RETRY_MS: 15000,        // a failed tile is tried again after this long
    ANCESTORS: 6,           // how many levels up to look for a stand-in

    LAND: '#e8e3d9',        // background before anything arrives
    EMPTY: '#ddd7cb',       // a tile with no stand-in at all

    cache: new Map(),       // 'z/x/y' -> { img, state: 0 loading | 1 ready | 2 failed, used, failedAt }
    inflight: 0,
    frame: 0,
    loaded: 0,
    failed: 0,

    key(z, x, y) { return z + '/' + x + '/' + y; },

    // The decoded image for a tile, or null. Marks it used this frame so the
    // eviction keeps whatever is on screen, stand-ins included.
    ready(z, x, y) {
        const t = this.cache.get(this.key(z, x, y));
        if (!t || t.state !== 1) return null;
        t.used = this.frame;
        return t.img;
    },

    load(z, x, y) {
        const k = this.key(z, x, y);
        let t = this.cache.get(k);
        if (t) {
            t.used = this.frame;
            if (t.state !== 2 || performance.now() - t.failedAt < this.RETRY_MS) return;
        }
        if (this.inflight >= this.MAX_INFLIGHT) return;

        const img = new Image();
        // OSM sends CORS headers, so this keeps the canvas readable (useful
        // for screenshots and debugging) at no cost.
        img.crossOrigin = 'anonymous';
        t = { img, state: 0, used: this.frame, failedAt: 0 };
        this.cache.set(k, t);
        this.inflight++;
        img.src = this.URL + k + '.png';
        // decode() rejects on a network error too, and decodes off the main
        // thread, so the first draw of a new tile does not hitch the frame.
        img.decode().then(
            () => { t.state = 1; this.inflight--; this.loaded++; },
            () => { t.state = 2; t.failedAt = performance.now(); this.inflight--; this.failed++; }
        );
    },

    // Queue what the screen will show at the target zoom, centre outwards.
    request() {
        this.frame++;
        const z = camera.zoomTarget, n = 1 << z;
        const cx = camera.x * n, cy = camera.y * n;
        const hw = (view.w / 2 + this.MARGIN) / geo.TILE;
        const hh = (view.h / 2 + this.MARGIN) / geo.TILE;
        const want = [];
        for (let ty = Math.floor(cy - hh); ty <= Math.floor(cy + hh); ty++) {
            if (ty < 0 || ty >= n) continue;
            for (let tx = Math.floor(cx - hw); tx <= Math.floor(cx + hw); tx++) {
                const ddx = tx + 0.5 - cx, ddy = ty + 0.5 - cy;
                want.push({ x: ((tx % n) + n) % n, y: ty, d: ddx * ddx + ddy * ddy });
            }
        }
        want.sort((a, b) => a.d - b.d);
        for (const t of want) this.load(z, t.x, t.y);
        this.evict();
    },

    evict() {
        if (this.cache.size <= this.CACHE_MAX) return;
        const old = [];
        for (const [k, t] of this.cache) if (t.state !== 0 && t.used < this.frame) old.push([k, t.used]);
        old.sort((a, b) => a[1] - b[1]);
        const target = Math.floor(this.CACHE_MAX * 0.8);
        for (let i = 0; i < old.length && this.cache.size > target; i++) this.cache.delete(old[i][0]);
    },

    // Paint every tile under the camera. Works in DEVICE pixels: each tile's
    // edges are rounded from one shared origin, so neighbours always meet
    // exactly and no hairline of background shows between them.
    draw() {
        const dpr = view.dpr;
        const W = canvas.width, H = canvas.height;
        const z = camera.zoomTarget, n = 1 << z;
        const size = geo.TILE * Math.pow(2, camera.zoom - z) * dpr;
        const cx = camera.x * n, cy = camera.y * n;
        const tx0 = Math.floor(cx - W / 2 / size), tx1 = Math.floor(cx + W / 2 / size);
        const ty0 = Math.floor(cy - H / 2 / size), ty1 = Math.floor(cy + H / 2 / size);
        const ox = W / 2 - (cx - tx0) * size;
        const oy = H / 2 - (cy - ty0) * size;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = this.LAND;
        ctx.fillRect(0, 0, W, H);

        for (let ty = ty0; ty <= ty1; ty++) {
            if (ty < 0 || ty >= n) continue;
            const y0 = Math.round(oy + (ty - ty0) * size);
            const y1 = Math.round(oy + (ty - ty0 + 1) * size);
            for (let tx = tx0; tx <= tx1; tx++) {
                const x0 = Math.round(ox + (tx - tx0) * size);
                const x1 = Math.round(ox + (tx - tx0 + 1) * size);
                this.drawTile(z, ((tx % n) + n) % n, ty, x0, y0, x1 - x0, y1 - y0);
            }
        }
    },

    drawTile(z, x, y, dx, dy, dw, dh) {
        const img = this.ready(z, x, y);
        if (img) { ctx.drawImage(img, dx, dy, dw, dh); return; }

        // Nearest cached ancestor, cropped to this tile's corner of it.
        let filled = false;
        for (let k = 1; k <= this.ANCESTORS && k <= z; k++) {
            const a = this.ready(z - k, x >> k, y >> k);
            if (!a) continue;
            const s = geo.TILE >> k;
            ctx.drawImage(a, (x - ((x >> k) << k)) * s, (y - ((y >> k) << k)) * s, s, s, dx, dy, dw, dh);
            filled = true;
            break;
        }
        if (!filled) {
            ctx.fillStyle = this.EMPTY;
            ctx.fillRect(dx + 1, dy + 1, dw - 2, dh - 2);
        }

        // Children on top, when zooming out from a level that is still cached.
        if (z >= this.MAX_Z) return;
        const mx = dx + Math.round(dw / 2), my = dy + Math.round(dh / 2);
        for (let i = 0; i < 4; i++) {
            const c = this.ready(z + 1, 2 * x + (i & 1), 2 * y + (i >> 1));
            if (!c) continue;
            const cx0 = i & 1 ? mx : dx, cy0 = i >> 1 ? my : dy;
            const cx1 = i & 1 ? dx + dw : mx, cy1 = i >> 1 ? dy + dh : my;
            ctx.drawImage(c, cx0, cy0, cx1 - cx0, cy1 - cy0);
        }
    }
};
