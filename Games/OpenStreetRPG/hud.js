// ============ OPENSTREETRPG — HUD ============
// The DOM overlay: the inventory, the travel box, the position readout, the
// controls hint and toasts. The only file besides main.js that touches the
// DOM. Owns `hud`.

const hud = {

    // Nominatim's policy: at most one request a second and no search-as-you-
    // type, so it is only ever called on submit.
    // operations.osmfoundation.org/policies/nominatim
    NOMINATIM: 'https://nominatim.openstreetmap.org/search',
    SEARCH_GAP_MS: 1100,
    HINT_AFTER_M: 60,       // the controls hint fades once you have walked this far

    // Line icons for the inventory, keyed by an item's `icon`. Drawn in
    // currentColor so a row can recolour its icon from CSS.
    ICONS: {
        bicycle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="5.5" cy="15.5" r="3.8"/><circle cx="18.5" cy="15.5" r="3.8"/>' +
            '<path d="M5.5 15.5 L11 15.5 L8.5 9 Z M8.5 9 H16 L11 15.5 M16 9 L18.5 15.5 M16 9 L16.6 6.5 H19 M7 7.2 H10.4 M8.5 9 L8.8 7.2"/></svg>'
    },

    el: {},
    lastSearch: -Infinity,
    toastTimer: 0,
    readoutText: '',
    tileWarned: false,
    invOpen: false,
    invVersion: -1,

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
        this.$('invHead').addEventListener('click', e => {
            e.currentTarget.blur();
            this.toggleInventory();
        });
        this.$('invList').addEventListener('click', e => {
            const btn = e.target.closest('button[data-item]');
            if (!btn) return;
            btn.blur();
            this.equip(btn.dataset.item);
        });
    },

    // ---- Inventory ----
    // An accordion: the header folds the list away. Rows are rebuilt whenever
    // inventory.version moves, which is rarely enough that rebuilding beats
    // keeping a patch path in step with the data.

    toggleInventory(open = !this.invOpen) {
        this.invOpen = open;
        this.$('inv').classList.toggle('open', open);
        this.$('invHead').setAttribute('aria-expanded', String(open));
        game.dirty = true;
    },

    // Equip or unequip, by id. Keys 1-9 come here too, by row.
    equip(id) {
        const it = ITEMS[id];
        if (!it) return;
        this.toast(inventory.toggle(id) ? it.equipText : it.unequipText, 2500);
    },

    renderInventory() {
        const list = this.$('invList');
        list.textContent = '';
        inventory.items.forEach((id, i) => {
            const it = ITEMS[id], on = inventory.isEquipped(id);
            const li = document.createElement('li');
            li.className = 'item' + (on ? ' equipped' : '');

            const icon = document.createElement('div');
            icon.className = 'item-icon';
            icon.innerHTML = this.ICONS[it.icon] || '';

            const main = document.createElement('div');
            main.className = 'item-main';
            const name = document.createElement('div');
            name.className = 'item-name';
            name.textContent = it.name;
            const tag = document.createElement('span');
            tag.className = 'item-tag';
            tag.textContent = on ? 'Equipped' : SLOTS[it.slot];
            name.appendChild(tag);
            const blurb = document.createElement('p');
            blurb.className = 'item-blurb';
            blurb.textContent = it.blurb;

            const foot = document.createElement('div');
            foot.className = 'item-foot';
            const stats = document.createElement('span');
            stats.className = 'item-stats';
            if (it.move) {
                for (const line of ['Speed ×' + it.move.speed, 'Shift ×' + it.move.boost]) {
                    const l = document.createElement('span');
                    l.textContent = line;
                    stats.appendChild(l);
                }
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'item-btn';
            btn.dataset.item = id;
            btn.textContent = on ? 'Unequip' : 'Equip';
            if (i < 9) {
                const k = document.createElement('kbd');
                k.textContent = i + 1;
                btn.appendChild(k);
            }
            foot.append(stats, btn);
            main.append(name, blurb, foot);
            li.append(icon, main);
            list.appendChild(li);
        });
        this.$('invCount').textContent = inventory.items.length;
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
        if (inventory.version !== this.invVersion) {
            this.invVersion = inventory.version;
            this.renderInventory();
        }

        const lat = player.lat(), lon = player.lon();
        const m = player.walked;
        const text =
            Math.abs(lat).toFixed(5) + '° ' + (lat >= 0 ? 'N' : 'S') + '   ' +
            Math.abs(lon).toFixed(5) + '° ' + (lon >= 0 ? 'E' : 'W') + '   ·   zoom ' +
            camera.zoomTarget + '   ·   travelled ' +
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
