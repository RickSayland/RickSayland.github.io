// ============ OPENSTREETRPG — WIRING ============
// The only file that boots. Start position, zoom, the camera, saving, and the
// loop. Owns `game`.

const game = {

    START: { lat: 51.50803, lon: -0.12804, zoom: 18 },     // Trafalgar Square
    MIN_ZOOM: 15,
    MAX_ZOOM: 19,           // tiles.MAX_Z: the deepest the OSM layer goes
    ZOOM_RATE: 12,          // 1/s, how fast the display zoom eases
    FOLLOW_RATE: 8,         // 1/s, how tightly the camera chases the player
    SAVE_KEY: 'openstreetrpg.save',
    SAVE_EVERY_MS: 1000,
    LOCATE_HOLD_MS: 3000,   // how long a fresh start waits for a fix before showing the fallback map
    LOCATE_TIMEOUT_MS: 15000,

    last: 0,
    dirty: false,
    savedAt: 0,
    vignette: null,
    locating: false,
    holdTilesUntil: 0,
    fallbackName: '',

    boot() {
        resizeCanvas();
        this.buildVignette();
        addEventListener('resize', () => { resizeCanvas(); this.buildVignette(); });

        input.init();
        hud.init();

        // A position in the URL wins: it is either a shared link or a reload,
        // since save() keeps the hash current. A reload resuming in place is
        // deliberate — a live-reload dev server reloads on every file save.
        // A fresh start goes to where you really are, standing on the saved
        // spot (or the default) until the browser answers or if it will not.
        const saved = this.load();
        const hash = this.fromHash();
        const s = hash || saved || this.START;
        this.fallbackName = saved ? 'where you left off' : 'Trafalgar Square';
        this.travel(s.lat, s.lon, null, s.zoom);
        player.walked = (saved && saved.walked) || 0;
        if (!hash) this.locate(true);

        addEventListener('hashchange', () => {
            const h = this.fromHash();
            if (h) this.travel(h.lat, h.lon, null, h.zoom);
        });
        addEventListener('pagehide', () => this.save());

        requestAnimationFrame(t => { this.last = t; this.frame(t); });
    },

    // Teleport: player and camera both, so the view does not sweep across the
    // planet fetching every tile on the way.
    travel(lat, lon, label, zoom) {
        player.place(lat, lon);
        camera.x = player.x;
        camera.y = player.y;
        if (zoom) camera.zoom = camera.zoomTarget = clamp(Math.round(zoom), this.MIN_ZOOM, this.MAX_ZOOM);
        if (label) hud.toast('Arrived: ' + label);
        this.dirty = true;
    },

    // Ask the browser where the player really is, and go there. `auto` is the
    // call at start-up. That one briefly holds tile requests, so when
    // permission is already granted the fallback spot's tiles are never
    // fetched only to be thrown away a second later, and it does not yank a
    // player who has started walking while the prompt was up.
    locate(auto) {
        if (this.locating) return;
        if (!navigator.geolocation) {
            if (!auto) hud.toast('This browser can’t share its location');
            return;
        }
        this.locating = true;
        if (auto) this.holdTilesUntil = performance.now() + this.LOCATE_HOLD_MS;
        const walkedBefore = player.walked;
        hud.setLocating(true);
        hud.toast('Finding where you are…', this.LOCATE_TIMEOUT_MS);

        const done = () => { this.locating = false; hud.setLocating(false); };
        navigator.geolocation.getCurrentPosition(pos => {
            done();
            const { latitude, longitude, accuracy } = pos.coords;
            if (auto && player.walked - walkedBefore > 5) {
                hud.toast('Found you. Use the locate button (top right) to go there.');
                return;
            }
            this.travel(latitude, longitude, null);
            // A laptop without GPS is placed from Wi-Fi or its IP address,
            // which can be kilometres out; say so rather than look wrong.
            hud.toast(accuracy > 150
                ? 'You’re here, give or take ' + (accuracy < 1000 ? Math.round(accuracy) + ' m' : (accuracy / 1000).toFixed(1) + ' km') + '.'
                : 'You’re here.');
        }, err => {
            done();
            const where = auto ? ' Starting at ' + this.fallbackName + '.' : '';
            hud.toast(err.code === err.PERMISSION_DENIED
                ? 'Location is blocked for this page.' + where + ' Allow it from the address bar, then use the locate button.'
                : err.code === err.TIMEOUT
                    ? 'Finding your location took too long.' + where
                    : 'Couldn’t work out where you are.' + where,
                7000);
        }, { enableHighAccuracy: true, timeout: this.LOCATE_TIMEOUT_MS, maximumAge: 60000 });
    },

    frame(t) {
        const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
        this.last = t;
        this.update(dt, t);
        this.render();
        requestAnimationFrame(t2 => this.frame(t2));
    },

    update(dt, t) {
        if (input.zoomSteps) {
            camera.zoomTarget = clamp(camera.zoomTarget + input.zoomSteps, this.MIN_ZOOM, this.MAX_ZOOM);
            input.zoomSteps = 0;
            this.dirty = true;
        }
        camera.zoom += (camera.zoomTarget - camera.zoom) * Math.min(1, dt * this.ZOOM_RATE);
        if (Math.abs(camera.zoomTarget - camera.zoom) < 1e-3) camera.zoom = camera.zoomTarget;

        player.update(dt);
        if (player.moving) this.dirty = true;

        // Exponential follow, frame-rate independent. The player runs a little
        // ahead of centre while moving and the view settles when they stop.
        const k = 1 - Math.exp(-dt * this.FOLLOW_RATE);
        camera.x = geo.wrapX(camera.x + geo.dx(player.x, camera.x) * k);
        camera.y += (player.y - camera.y) * k;

        if (!(this.locating && performance.now() < this.holdTilesUntil)) tiles.request();
        hud.update();

        if (this.dirty && t - this.savedAt > this.SAVE_EVERY_MS) this.save(t);
    },

    render() {
        tiles.draw();

        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        ctx.fillStyle = this.vignette;
        ctx.fillRect(0, 0, view.w, view.h);

        const wp = geo.worldPx(camera.zoom);
        player.draw(view.w / 2 + geo.dx(player.x, camera.x) * wp,
                    view.h / 2 + (player.y - camera.y) * wp);
    },

    // Darkened corners: frames the map as a game screen rather than a web map.
    buildVignette() {
        const w = view.w, h = view.h;
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
        g.addColorStop(0, 'rgba(30, 20, 45, 0)');
        g.addColorStop(1, 'rgba(30, 20, 45, 0.3)');
        this.vignette = g;
    },

    // ---- Saving ----
    // Position lives in two places: localStorage, so a revisit resumes where
    // you stopped, and the URL hash (#zoom/lat/lon, OSM's own order), so a
    // place can be shared as a link. replaceState never fires hashchange.

    save(t) {
        this.savedAt = t || performance.now();
        this.dirty = false;
        const s = {
            lat: +player.lat().toFixed(6),
            lon: +player.lon().toFixed(6),
            zoom: camera.zoomTarget,
            walked: Math.round(player.walked)
        };
        try { localStorage.setItem(this.SAVE_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
        try { history.replaceState(null, '', '#' + s.zoom + '/' + s.lat.toFixed(5) + '/' + s.lon.toFixed(5)); } catch (e) { /* sandboxed */ }
    },

    load() {
        try {
            const s = JSON.parse(localStorage.getItem(this.SAVE_KEY));
            return s && this.valid(s.lat, s.lon) ? s : null;
        } catch (e) {
            return null;
        }
    },

    fromHash() {
        const m = location.hash.match(/^#(\d+)\/(-?[\d.]+)\/(-?[\d.]+)$/);
        if (!m || !this.valid(+m[2], +m[3])) return null;
        return { zoom: +m[1], lat: +m[2], lon: +m[3] };
    },

    valid(lat, lon) {
        return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    }
};

// A development handle, not a game feature: requestAnimationFrame is throttled
// in hidden tabs and most automated browsers, so step(n) runs the same update
// and render the loop does, by hand.
window.osrpg = {
    step(n = 1, dt = 1 / 60) {
        for (let i = 0; i < n; i++) {
            game.last += dt * 1000;
            game.update(dt, game.last);
        }
        game.render();
    }
};

game.boot();
