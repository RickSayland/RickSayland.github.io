// ============ GEOPOLITICS SIMULATOR — GLOBE ENGINE ============

const DEG = Math.PI / 180;

// LAND array loaded from landData.js (included before this script)

// ============ GLOBE OBJECT ============

const globe = {
    canvas: null,
    ctx: null,
    cx: 0,
    cy: 0,
    width: 0,
    height: 0,
    radius: 0,
    rotation: { lon: -20, lat: 20 },
    zoom: 1.0,
    dragging: false,
    lastPointer: { x: 0, y: 0 },
    dirty: true,
    autoRotate: true,
    autoRotateSpeed: 0.012,
    autoRotateTimer: null,
    idleSpin: true,     // cleared once the game starts; the player owns the view
    fly: null,
    overlay: null,      // set by nations.js to draw on top of the sphere

    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.prepareGeometry();
        this.resize();

        window.addEventListener('resize', () => this.resize());

        this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
        window.addEventListener('pointermove', e => this.onPointerMove(e));
        window.addEventListener('pointerup', () => this.onPointerUp());
        this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });

        this.canvas.addEventListener('mousemove', e => {
            if (this.dragging) return;
            const rect = this.canvas.getBoundingClientRect();
            const coords = this.unproject(e.clientX - rect.left, e.clientY - rect.top);
            const el = document.getElementById('coords');
            if (coords) {
                const ns = coords.lat >= 0 ? 'N' : 'S';
                const ew = coords.lon >= 0 ? 'E' : 'W';
                el.textContent =
                    Math.abs(coords.lat).toFixed(1) + '°' + ns + '  ' +
                    Math.abs(coords.lon).toFixed(1) + '°' + ew;
            } else {
                el.textContent = '—';
            }
        });

        this.loop();
    },

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
        this.cx = this.width / 2;
        this.cy = this.height / 2;
        this.radius = Math.min(this.cx, this.cy) * 0.82 * this.zoom;
        this.buildGradients();
        this.dirty = true;
    },

    // Cached: these depend only on centre and radius, and rebuilding all three
    // every frame was a steady source of GC pressure.
    buildGradients() {
        const ctx = this.ctx, R = this.radius, cx = this.cx, cy = this.cy;

        const glow = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.18);
        glow.addColorStop(0, 'rgba(70,150,255,0.22)');
        glow.addColorStop(1, 'rgba(70,150,255,0)');

        const depth = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, 0, cx, cy, R);
        depth.addColorStop(0, 'rgba(30,90,160,0.25)');
        depth.addColorStop(1, 'rgba(0,8,25,0.35)');

        const spec = ctx.createRadialGradient(
            cx - R * 0.3, cy - R * 0.3, 0,
            cx - R * 0.3, cy - R * 0.3, R * 0.8
        );
        spec.addColorStop(0, 'rgba(255,255,255,0.06)');
        spec.addColorStop(1, 'rgba(255,255,255,0)');

        this.gradients = { glow, depth, spec };
    },

    // ---- Geometry precompute ----

    // Rotating 60k points per frame with trig in the inner loop is the render
    // bottleneck. Decomposing sin/cos(lon - rLon) lets the per-point terms be
    // computed once here, leaving only multiply-adds at frame time.
    prepareGeometry() {
        this.geo = LAND.map(poly => {
            const n = poly.length;
            const a = new Float64Array(n);
            const b = new Float64Array(n);
            const c = new Float64Array(n);

            let sa = 0, sb = 0, sc = 0;
            for (let i = 0; i < n; i++) {
                const lat = poly[i][0], lon = poly[i][1];
                const phi = lat * DEG, lam = lon * DEG;
                const cp = Math.cos(phi);
                a[i] = cp * Math.sin(lam);
                b[i] = cp * Math.cos(lam);
                c[i] = Math.sin(phi);
                sa += a[i]; sb += b[i]; sc += c[i];
            }

            const len = Math.hypot(sa, sb, sc) || 1;
            const ca = sa / len, cb = sb / len, cc = sc / len;

            let minDot = 1;
            for (let i = 0; i < n; i++) {
                const d = a[i] * ca + b[i] * cb + c[i] * cc;
                if (d < minDot) minDot = d;
            }
            const capRadius = Math.acos(Math.max(-1, Math.min(1, minDot)));

            return {
                n, a, b, c, ca, cb, cc,
                sinCap: Math.sin(capRadius),
                cullable: capRadius < Math.PI / 2
            };
        });

        const maxN = this.geo.reduce((m, g) => Math.max(m, g.n), 0);
        this.px = new Float64Array(maxN);
        this.py = new Float64Array(maxN);
        this.pz = new Float64Array(maxN);
        this.frame = { cosRLon: 1, sinRLon: 0, cosRLat: 1, sinRLat: 0 };
        this.partials = [];

        this.graticule = [];
        const line = (pts, faint) => {
            const m = pts.length;
            const a = new Float64Array(m), b = new Float64Array(m), c = new Float64Array(m);
            for (let i = 0; i < m; i++) {
                const phi = pts[i][0] * DEG, lam = pts[i][1] * DEG;
                const cp = Math.cos(phi);
                a[i] = cp * Math.sin(lam);
                b[i] = cp * Math.cos(lam);
                c[i] = Math.sin(phi);
            }
            this.graticule.push({ m, a, b, c, faint });
        };
        for (let lon = -180; lon < 180; lon += 30) {
            const pts = [];
            for (let lat = -90; lat <= 90; lat += 2) pts.push([lat, lon]);
            line(pts, true);
        }
        for (let lat = -60; lat <= 60; lat += 30) {
            const pts = [];
            for (let lon = -180; lon <= 180; lon += 2) pts.push([lat, lon]);
            line(pts, lat !== 0);
        }

        this.buildLandMask();

        // The source rings are fully baked into typed arrays above. Releasing
        // them drops ~48k short-lived JS arrays from the heap, which is what
        // was driving the periodic multi-hundred-millisecond GC pauses.
        LAND.length = 0;
    },

    // Rasterises the rings once into an equirectangular bitmap, turning
    // "is this coordinate on land?" into an array lookup. Must run before
    // prepareGeometry releases LAND. Natural Earth splits rings at the
    // antimeridian, so none of them smear across the map here.
    buildLandMask() {
        const W = 1440, H = 720;            // 0.25 degrees, ~28km at the equator
        const off = document.createElement('canvas');
        off.width = W;
        off.height = H;
        const octx = off.getContext('2d', { willReadFrequently: true });

        octx.fillStyle = '#000';
        octx.fillRect(0, 0, W, H);
        octx.fillStyle = '#fff';
        octx.beginPath();
        for (const poly of LAND) {
            for (let i = 0; i < poly.length; i++) {
                const x = (poly[i][1] + 180) / 360 * W;
                const y = (90 - poly[i][0]) / 180 * H;
                i ? octx.lineTo(x, y) : octx.moveTo(x, y);
            }
            octx.closePath();
        }
        octx.fill();

        const px = octx.getImageData(0, 0, W, H).data;
        const mask = new Uint8Array(W * H);
        for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? 1 : 0;
        this.landMask = { W, H, mask };
    },

    isLand(lat, lon) {
        const { W, H, mask } = this.landMask;
        let y = Math.floor((90 - lat) / 180 * H);
        if (y < 0) y = 0; else if (y >= H) y = H - 1;
        const x = ((Math.floor((lon + 180) / 360 * W) % W) + W) % W;
        return mask[y * W + x] === 1;
    },

    // ---- Projection ----

    projectPoint(lat, lon) {
        const phi = lat * DEG, lam = lon * DEG, cp = Math.cos(phi);
        const a = cp * Math.sin(lam), b = cp * Math.cos(lam), c = Math.sin(phi);
        const f = this.frame;
        const x  = a * f.cosRLon - b * f.sinRLon;
        const z  = b * f.cosRLon + a * f.sinRLon;
        return {
            x: this.cx + x * this.radius,
            y: this.cy - (c * f.cosRLat - z * f.sinRLat) * this.radius,
            z: c * f.sinRLat + z * f.cosRLat
        };
    },

    unproject(sx, sy) {
        const x  = (sx - this.cx) / this.radius;
        const y2 = -(sy - this.cy) / this.radius;
        const r2 = x * x + y2 * y2;
        if (r2 > 1) return null;

        const z2   = Math.sqrt(1 - r2);
        const rLat = this.rotation.lat * DEG;

        const y = y2 * Math.cos(rLat) + z2 * Math.sin(rLat);
        const z = -y2 * Math.sin(rLat) + z2 * Math.cos(rLat);

        const lat = Math.asin(Math.max(-1, Math.min(1, y))) / DEG;
        let   lon = Math.atan2(x, z) / DEG + this.rotation.lon;
        while (lon > 180)  lon -= 360;
        while (lon < -180) lon += 360;
        return { lat, lon };
    },

    // ---- Drawing helpers ----

    // Adds one landmass to the current path. Returns true if the ring crosses
    // the horizon and `allowPartial` was false, meaning the caller must draw it
    // on its own path — see the batching note in render().
    addLandPath(g, allowPartial) {
        const ctx = this.ctx;
        const n = g.n;
        const { a, b, c } = g;
        const { cosRLon, sinRLon, cosRLat, sinRLat } = this.frame;
        const cx = this.cx, cy = this.cy, R = this.radius;

        // Back-hemisphere cull: skip polygons whose bounding cap is fully behind.
        if (g.cullable) {
            const zc = g.cb * cosRLon + g.ca * sinRLon;
            if (g.cc * sinRLat + zc * cosRLat < -g.sinCap) return false;
            // Islet smaller than a pixel at this zoom; drawing it costs more
            // than it shows.
            if (2 * R * g.sinCap < 1) return false;
        }

        const sx = this.px, sy = this.py, sz = this.pz;
        let anyFront = false, anyBack = false;
        for (let i = 0; i < n; i++) {
            const x = a[i] * cosRLon - b[i] * sinRLon;
            const z = b[i] * cosRLon + a[i] * sinRLon;
            const y = c[i];
            const y2 = y * cosRLat - z * sinRLat;
            const z2 = y * sinRLat + z * cosRLat;
            sx[i] = cx + x * R;
            sy[i] = cy - y2 * R;
            sz[i] = z2;
            if (z2 > 0) anyFront = true; else anyBack = true;
        }
        if (!anyFront) return false;

        // Wholly visible: emit the ring as-is.
        if (!anyBack) {
            ctx.moveTo(sx[0], sy[0]);
            for (let i = 1; i < n; i++) ctx.lineTo(sx[i], sy[i]);
            ctx.closePath();
            return false;
        }

        if (!allowPartial) return true;

        // Partially visible. Walk from a known entry crossing so the visible
        // spans come out in traversal order.
        let start = -1;
        for (let i = 0; i < n; i++) {
            if (sz[i] > 0 && sz[(i - 1 + n) % n] <= 0) { start = i; break; }
        }
        if (start < 0) return false;

        // Crossing point, without trig or allocation: z2 is linear in the
        // projected coords, so lerping screen x/y by t lands exactly on the
        // z2 = 0 plane. That point sits on the chord, so push it back out to
        // radius R — every visible-horizon point projects to exactly R.
        const ex = [0, 0];
        const edgeAt = (j, i) => {
            const t = sz[j] / (sz[j] - sz[i]);
            const mx = sx[j] + t * (sx[i] - sx[j]) - cx;
            const my = sy[j] + t * (sy[i] - sy[j]) - cy;
            const d = Math.hypot(mx, my) || 1;
            ex[0] = cx + mx * R / d;
            ex[1] = cy + my * R / d;
            return ex;
        };

        const spans = [];
        let cur = null;
        for (let k = 0; k < n; k++) {
            const i = (start + k) % n;
            const j = (i - 1 + n) % n;
            if (sz[i] > 0) {
                if (sz[j] <= 0) {
                    const e = edgeAt(j, i);
                    cur = [e[0], e[1]];
                    spans.push(cur);
                }
                cur.push(sx[i], sy[i]);
            } else if (sz[j] > 0) {
                const e = edgeAt(j, i);
                cur.push(e[0], e[1]);
                cur = null;
            }
        }
        if (cur) {
            const e = edgeAt((start - 1 + n) % n, start);
            cur.push(e[0], e[1]);
        }
        if (!spans.length) return false;

        // Close each gap along the sphere's limb rather than with a straight
        // chord — a chord cuts a wedge across landmasses spanning >180°.
        // Each gap takes the shorter way around: the hidden stretch between two
        // visible spans is the minor arc for any real landmass at any view.
        const TAU = Math.PI * 2;
        ctx.moveTo(spans[0][0], spans[0][1]);
        for (let s = 0; s < spans.length; s++) {
            const p = spans[s];
            for (let m = 2; m < p.length; m += 2) ctx.lineTo(p[m], p[m + 1]);
            const nxt = spans[(s + 1) % spans.length];
            const a0 = Math.atan2(p[p.length - 1] - cy, p[p.length - 2] - cx);
            const a1 = Math.atan2(nxt[1] - cy, nxt[0] - cx);
            let ccw = a1 - a0;
            while (ccw < 0) ccw += TAU;
            ctx.arc(cx, cy, R, a0, a1, ccw > Math.PI);
        }
        ctx.closePath();
        return false;
    },

    drawGraticule() {
        const ctx = this.ctx;
        const { cosRLon, sinRLon, cosRLat, sinRLat } = this.frame;
        const cx = this.cx, cy = this.cy, R = this.radius;

        for (const g of this.graticule) {
            ctx.strokeStyle = g.faint ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = g.faint ? 0.5 : 0.7;
            ctx.beginPath();
            let on = false;
            for (let i = 0; i < g.m; i++) {
                const x = g.a[i] * cosRLon - g.b[i] * sinRLon;
                const z = g.b[i] * cosRLon + g.a[i] * sinRLon;
                const y = g.c[i];
                if (y * sinRLat + z * cosRLat > 0) {
                    const sx = cx + x * R;
                    const sy = cy - (y * cosRLat - z * sinRLat) * R;
                    on ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
                    on = true;
                } else on = false;
            }
            ctx.stroke();
        }
    },

    // ---- Main render ----

    render() {
        const ctx = this.ctx;
        const R   = this.radius;

        const rLon = this.rotation.lon * DEG, rLat = this.rotation.lat * DEG;
        this.frame.cosRLon = Math.cos(rLon);
        this.frame.sinRLon = Math.sin(rLon);
        this.frame.cosRLat = Math.cos(rLat);
        this.frame.sinRLat = Math.sin(rLat);

        ctx.fillStyle = '#0a0c14';
        ctx.fillRect(0, 0, this.width, this.height);

        ctx.fillStyle = this.gradients.glow;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R * 1.18, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0d2847';
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.gradients.depth;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.fill();

        this.drawGraticule();

        ctx.save();
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle   = '#28694a';
        ctx.strokeStyle = 'rgba(80,150,100,0.25)';
        ctx.lineWidth   = 0.4;

        // Landmasses clear of the horizon are disjoint closed rings, so they
        // batch into one path safely. The handful that straddle the horizon
        // each get their own: their closing arcs all lie on the same limb
        // circle, and sharing a path would accumulate winding number there and
        // flood the disc. Batching matters — a fill/stroke per polygon meant
        // ~2800 draw calls a frame and periodic multi-frame flush stalls.
        const partials = this.partials;
        partials.length = 0;

        ctx.beginPath();
        for (const g of this.geo) {
            if (this.addLandPath(g, false)) partials.push(g);
        }
        ctx.fill();
        ctx.stroke();

        for (const g of partials) {
            ctx.beginPath();
            this.addLandPath(g, true);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();

        ctx.fillStyle = this.gradients.spec;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(100,180,255,0.12)';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.stroke();

        // Markers sit above the sphere and unclipped, so labels near the limb
        // stay readable; they hide themselves by z instead.
        if (this.overlay) this.overlay(ctx);
    },

    // Eases the view to a coordinate, taking the short way around in longitude.
    flyTo(lat, lon, duration = 900) {
        let dLon = lon - this.rotation.lon;
        while (dLon > 180)  dLon -= 360;
        while (dLon < -180) dLon += 360;
        this.fly = {
            lon0: this.rotation.lon, dLon,
            lat0: this.rotation.lat, dLat: lat - this.rotation.lat,
            t0: performance.now(), duration
        };
        this.autoRotate = false;
        clearTimeout(this.autoRotateTimer);
    },

    // ---- Loop ----

    loop() {
        if (this.fly) {
            const k = Math.min(1, (performance.now() - this.fly.t0) / this.fly.duration);
            const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
            this.rotation.lon = this.fly.lon0 + this.fly.dLon * e;
            this.rotation.lat = this.fly.lat0 + this.fly.dLat * e;
            this.dirty = true;
            if (k >= 1) this.fly = null;
        } else if (this.autoRotate && !this.dragging) {
            this.rotation.lon += this.autoRotateSpeed;
            this.dirty = true;
        }
        if (this.dirty) {
            this.render();
            this.dirty = false;
        }
        requestAnimationFrame(() => this.loop());
    },

    // ---- Interaction ----

    onPointerDown(e) {
        this.dragging    = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
        this.autoRotate = false;
        this.fly = null;
        clearTimeout(this.autoRotateTimer);
    },

    onPointerMove(e) {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;

        this.rotation.lon -= dx * 0.3;
        this.rotation.lat += dy * 0.3;
        this.rotation.lat  = Math.max(-90, Math.min(90, this.rotation.lat));

        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.dirty = true;
    },

    onPointerUp() {
        this.dragging = false;
        if (this.idleSpin) {
            this.autoRotateTimer = setTimeout(() => { this.autoRotate = true; }, 3000);
        }
    },

    onWheel(e) {
        e.preventDefault();
        this.zoom *= e.deltaY > 0 ? 0.95 : 1.05;
        this.zoom  = Math.max(0.5, Math.min(3, this.zoom));
        this.radius = Math.min(this.cx, this.cy) * 0.82 * this.zoom;
        this.buildGradients();
        this.dirty = true;
    }
};
