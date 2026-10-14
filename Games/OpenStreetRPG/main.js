// ============ OPENSTREETRPG — WIRING ============
// The only file that boots. Start position, zoom, the camera, saving, and the
// loop. Owns `game`.

const game = {

    START: { lat: 51.50803, lon: -0.12804, zoom: 18 },     // Trafalgar Square
    MIN_ZOOM: 15,           // the range on foot; a vehicle's `view` replaces it
    MAX_ZOOM: 19,           // tiles.MAX_Z: the deepest the OSM layer goes
    GROUND_ZOOM: 18,
    ZOOM_RATE: 12,          // 1/s, how fast the display zoom eases
    ZOOM_MAX_SPEED: 4.5,    // levels/s: a six-level climb into a jet takes over a second, not a blink
    FOLLOW_RATE: 8,         // 1/s, how tightly the camera chases the player
    LOOK_AHEAD: 0.35,       // s of travel the camera aims ahead, so a fast rider sees where they are going
    MAX_DRIFT: 0.3,         // the player never drifts further than this x the screen's short side from centre
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
    invSeen: -1,
    mountSeen: null,
    groundZoom: 18,         // the zoom to come back down to when you land

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
        const secret = this.takeSecret('ufo');      // before fromHash: it may be stuck on the end of the hash
        const saved = this.load();
        const hash = this.fromHash();
        const s = hash || saved || this.START;
        this.fallbackName = saved ? 'where you left off' : 'Trafalgar Square';

        // The inventory before the position: what you are riding decides the
        // zoom range the saved zoom is clamped into.
        inventory.restore(saved && saved.inv);
        this.mountSeen = inventory.equipped.mount || null;
        this.groundZoom = (saved && saved.groundZoom) || this.GROUND_ZOOM;
        this.travel(s.lat, s.lon, null, s.zoom);
        player.walked = (saved && saved.walked) || 0;
        hud.toggleInventory(saved ? !!saved.invOpen : true);    // open on a first visit, so the bike is found

        if (secret) this.unlockUfo();
        this.invSeen = inventory.version;
        if (!hash) this.locate(true);

        // Editing only the hash does not reload the page, so the secret is
        // looked for here too.
        addEventListener('hashchange', () => {
            if (this.takeSecret('ufo')) this.unlockUfo();
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
        if (zoom) {
            const [lo, hi] = this.zoomRange();
            camera.zoom = camera.zoomTarget = clamp(Math.round(zoom), lo, hi);
        }
        if (label) hud.toast('Arrived: ' + label);
        this.dirty = true;
    },

    // ---- The secret ----
    // `ufo` in the address puts a UFO in the inventory, for good (the save
    // keeps it). It is accepted in the query (?ufo) AND anywhere in the hash
    // (#ufo, or ?ufo typed onto the end of an address that already carries a
    // position, which lands after the #). The hash matters because it
    // survives a server redirect and a query may not: VS Code's Live Server
    // answers /Games/OpenStreetRPG?ufo with a redirect to
    // /Games/OpenStreetRPG/ and the ?ufo is simply gone. (GitHub Pages keeps
    // it.) The token is then removed from the address so the position hash
    // parses again and a reload does not announce it twice.

    takeSecret(token) {
        const q = new URLSearchParams(location.search);
        const re = new RegExp('(^|[?&])' + token + '(=[^?&]*)?(?=$|[?&])', 'ig');
        let hash = location.hash.slice(1);
        const inHash = hash.search(re) >= 0;
        if (!q.has(token) && !inHash) return false;
        q.delete(token);
        hash = hash.replace(re, '').replace(/^[?&]+|[?&]+$/g, '');
        const search = q.toString();
        try {
            history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + (hash ? '#' + hash : ''));
        } catch (e) { /* sandboxed */ }
        return true;
    },

    unlockUfo() {
        hud.toggleInventory(true);
        hud.expanded = 'ufo';
        if (inventory.grant('ufo')) {
            hud.toast('Something not of this Earth has landed in your inventory…', 6000, true);
        } else {
            hud.renderInventory();
            hud.toast('The UFO is already in your inventory. Press ' + (inventory.items.indexOf('ufo') + 1) + ' to fly it.', 5000, true);
        }
    },

    // The zoom levels allowed with what you are riding.
    zoomRange() {
        const m = inventory.inSlot('mount');
        return m && m.view ? [m.view.min, m.view.max] : [this.MIN_ZOOM, this.MAX_ZOOM];
    },

    // A vehicle with a `view` takes the camera to its cruising zoom; getting
    // out of one returns to the zoom you were walking at. Swapping between two
    // without one (feet and the bike) leaves the zoom alone.
    mountChanged(prevId, nextId) {
        const prev = prevId && ITEMS[prevId], next = nextId && ITEMS[nextId];
        if (!(prev && prev.view)) this.groundZoom = camera.zoomTarget;
        const [lo, hi] = this.zoomRange();
        camera.zoomTarget = clamp(next && next.view ? next.view.cruise : this.groundZoom, lo, hi);
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
        const mountId = inventory.equipped.mount || null;
        if (mountId !== this.mountSeen) {
            this.mountChanged(this.mountSeen, mountId);
            this.mountSeen = mountId;
        }
        if (input.zoomSteps) {
            const [lo, hi] = this.zoomRange();
            camera.zoomTarget = clamp(camera.zoomTarget + input.zoomSteps, lo, hi);
            input.zoomSteps = 0;
            this.dirty = true;
        }
        const dz = (camera.zoomTarget - camera.zoom) * Math.min(1, dt * this.ZOOM_RATE);
        camera.zoom += clamp(dz, -this.ZOOM_MAX_SPEED * dt, this.ZOOM_MAX_SPEED * dt);
        if (Math.abs(camera.zoomTarget - camera.zoom) < 1e-3) camera.zoom = camera.zoomTarget;

        player.update(dt);
        if (player.moving) this.dirty = true;
        if (inventory.version !== this.invSeen) { this.invSeen = inventory.version; this.dirty = true; }

        // Exponential follow, frame-rate independent, aimed a little ahead of
        // the player along their velocity. Without the lead a fast rider sits
        // behind centre and sees less of the road ahead than the road behind.
        const k = 1 - Math.exp(-dt * this.FOLLOW_RATE);
        const lead = this.LOOK_AHEAD / geo.worldPx(player.REF_ZOOM);
        const tx = player.x + player.vx * lead, ty = player.y + player.vy * lead;
        camera.x = geo.wrapX(camera.x + geo.dx(tx, camera.x) * k);
        camera.y += (ty - camera.y) * k;

        // The lead and the lag both grow with speed, and at UFO speeds their
        // sum would carry the player off the edge of a small window. Leash
        // the camera to the player, in screen pixels.
        const wp = geo.worldPx(camera.zoom);
        const ox = geo.dx(camera.x, player.x) * wp, oy = (camera.y - player.y) * wp;
        const off = Math.hypot(ox, oy), max = this.MAX_DRIFT * Math.min(view.w, view.h);
        if (off > max) {
            camera.x = geo.wrapX(player.x + ox * (max / off) / wp);
            camera.y = player.y + oy * (max / off) / wp;
        }

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
        avatar.draw(view.w / 2 + geo.dx(player.x, camera.x) * wp,
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
            walked: Math.round(player.walked),
            inv: inventory.save(),
            invOpen: hud.invOpen,
            groundZoom: this.groundZoom
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
