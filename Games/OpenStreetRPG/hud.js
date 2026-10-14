// ============ OPENSTREETRPG — HUD ============
// The DOM overlay: the travel box, the position readout, the controls hint and
// toasts. The only file besides main.js that touches the DOM. Owns `hud`.

const hud = {

    // Nominatim's policy: at most one request a second and no search-as-you-
    // type, so it is only ever called on submit.
    // operations.osmfoundation.org/policies/nominatim
    NOMINATIM: 'https://nominatim.openstreetmap.org/search',
    SEARCH_GAP_MS: 1100,
    HINT_AFTER_M: 60,       // the controls hint fades once you have walked this far

    el: {},
    lastSearch: -Infinity,
    toastTimer: 0,
    readoutText: '',
    tileWarned: false,

    $(id) { return this.el[id] || (this.el[id] = document.getElementById(id)); },

    init() {
        this.$('version').textContent = 'v' + GAME_VERSION;
        this.$('search').addEventListener('submit', e => {
            e.preventDefault();
            this.search(this.$('searchInput').value);
        });
        this.$('searchInput').addEventListener('keydown', e => {
            if (e.key === 'Escape') e.target.blur();
        });
        this.$('locateBtn').addEventListener('click', e => {
            e.currentTarget.blur();     // or the next Space/Enter would press it again
            game.locate(false);
        });
    },

    setLocating(on) { this.$('locateBtn').classList.toggle('busy', on); },

    focusSearch() {
        const i = this.$('searchInput');
        i.focus();
        i.select();
    },

    async search(q) {
        q = q.trim();
        if (!q) return;

        // "lat, lon" goes straight there without asking anyone.
        const m = q.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
        if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) {
            game.travel(+m[1], +m[2], m[1] + ', ' + m[2]);
            this.$('searchInput').blur();
            return;
        }

        if (performance.now() - this.lastSearch < this.SEARCH_GAP_MS) return;
        this.lastSearch = performance.now();
        const btn = this.$('searchBtn');
        btn.disabled = true;
        try {
            const r = await fetch(this.NOMINATIM + '?format=jsonv2&limit=1&q=' + encodeURIComponent(q));
            if (!r.ok) throw new Error('the search service answered ' + r.status);
            const hits = await r.json();
            if (!hits.length) { this.toast('Couldn’t find “' + q + '” on the map'); return; }
            const h = hits[0];
            game.travel(+h.lat, +h.lon, h.display_name.split(', ').slice(0, 3).join(', '));
            this.$('searchInput').blur();
        } catch (err) {
            this.toast('Search failed: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    },

    toast(msg, ms = 4000) {
        const t = this.$('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
    },

    update() {
        const lat = player.lat(), lon = player.lon();
        const m = player.walked;
        const text =
            Math.abs(lat).toFixed(5) + '° ' + (lat >= 0 ? 'N' : 'S') + '   ' +
            Math.abs(lon).toFixed(5) + '° ' + (lon >= 0 ? 'E' : 'W') + '   ·   zoom ' +
            camera.zoomTarget + '   ·   walked ' +
            (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km');
        if (text !== this.readoutText) {
            this.readoutText = text;
            this.$('readout').textContent = text;
        }

        if (m > this.HINT_AFTER_M) this.$('hint').classList.add('gone');

        if (!this.tileWarned && tiles.failed >= 6 && tiles.loaded === 0) {
            this.tileWarned = true;
            this.toast('Map tiles aren’t loading. Are you offline?', 8000);
        }
    }
};
