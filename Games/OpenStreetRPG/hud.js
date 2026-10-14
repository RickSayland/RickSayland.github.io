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

    // Line icons for the inventory, keyed by item id. Drawn in currentColor so
    // a row can recolour its icon from CSS.
    ICONS: {
        bicycle: '<circle cx="5.5" cy="15.5" r="3.8"/><circle cx="18.5" cy="15.5" r="3.8"/>' +
            '<path d="M5.5 15.5 L11 15.5 L8.5 9 Z M8.5 9 H16 L11 15.5 M16 9 L18.5 15.5 M16 9 L16.6 6.5 H19 M7 7.2 H10.4 M8.5 9 L8.8 7.2"/>',
        car: '<path d="M2.5 15.5 V12.8 C2.5 12 3 11.4 3.8 11.3 L6.5 11 L9 7.8 H14.2 L17.2 11 L20.5 11.6 C21.2 11.8 21.5 12.3 21.5 13 V15.5"/>' +
            '<circle cx="7" cy="16" r="2.3"/><circle cx="17" cy="16" r="2.3"/><path d="M9.3 16 H14.7 M2.5 15.5 H4.7 M19.3 15.5 H21.5 M6.5 11 H17.2"/>',
        helicopter: '<path d="M4 5 H20 M12 5 V7.5"/>' +
            '<path d="M8.5 12.5 C8.5 9.5 10.5 7.5 13.5 7.5 C17 7.5 19 10 19 12.5 C19 15 17 16.5 14 16.5 H11 C9.5 16.5 8.5 15 8.5 12.5 Z"/>' +
            '<path d="M8.5 11.5 L3.5 10 M3.5 7.5 V12.5 M10.5 19.5 H19 M12 16.5 V19.5 M17 16.5 V19.5 M14 7.8 V12 H18.8"/>',
        jet: '<path d="M3 12.5 H17 C19.5 12.5 21.5 13.2 22 14 C21.5 14.8 19.5 15.5 17 15.5 H4.5 Z"/>' +
            '<path d="M3 12.5 L2.5 8 H4.8 L7.5 12.5 M9.5 15.5 L7 20 H9.5 L14 15.5 M14.5 12.5 C15 11 17.5 11 18.5 12.6"/>',
        ufo: '<ellipse cx="12" cy="13.5" rx="10" ry="3.5"/><path d="M7.2 11.6 C7.2 6.5 16.8 6.5 16.8 11.6"/>' +
            '<path d="M8.5 19.5 L9.8 17 M15.5 19.5 L14.2 17 M12 20.5 V17.2"/>' +
            '<g fill="currentColor" stroke="none"><circle cx="6.5" cy="13.5" r="0.8"/><circle cx="12" cy="14.7" r="0.8"/><circle cx="17.5" cy="13.5" r="0.8"/></g>'
    },

    icon(id) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (this.ICONS[id] || '') + '</svg>';
    },

    el: {},
    lastSearch: -Infinity,
    toastTimer: 0,
    toastHeldUntil: 0,
    toastQueued: null,
    readoutText: '',
    tileWarned: false,
    wasBlocked: false,
    blockToastAt: -Infinity,
    invOpen: false,
    invVersion: -1,
    expanded: null,         // the item whose details are showing (an accordion inside the accordion)

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
            const btn = e.target.closest('button[data-item], button[data-expand]');
            if (!btn) return;
            btn.blur();
            if (btn.dataset.item) this.equip(btn.dataset.item);
            else this.expand(btn.dataset.expand);
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

    // Open one item's details and close the others; clicking the open one
    // closes it. Done with classes on the rows that exist, not a rebuild, so
    // the rows can animate.
    expand(id) {
        this.expanded = this.expanded === id ? null : id;
        for (const li of this.$('invList').children) {
            const open = li.dataset.id === this.expanded;
            li.classList.toggle('open', open);
            li.querySelector('.item-expand').setAttribute('aria-expanded', String(open));
        }
    },

    renderInventory() {
        const list = this.$('invList');
        list.textContent = '';
        inventory.items.forEach((id, i) => {
            const it = ITEMS[id], on = inventory.isEquipped(id), open = this.expanded === id;
            const el = (tag, cls, text) => {
                const e = document.createElement(tag);
                if (cls) e.className = cls;
                if (text != null) e.textContent = text;
                return e;
            };

            const li = el('li', 'item' + (on ? ' equipped' : '') + (open ? ' open' : ''));
            li.dataset.id = id;

            const head = el('button', 'item-expand');
            head.type = 'button';
            head.dataset.expand = id;
            head.setAttribute('aria-expanded', String(open));
            const icon = el('span', 'item-icon');
            icon.innerHTML = this.icon(id);
            const name = el('span', 'item-name', it.name);
            name.appendChild(el('span', 'item-tag', on ? 'Equipped' : SLOTS[it.slot]));
            head.append(icon, name);

            const btn = el('button', 'item-btn', on ? 'Unequip' : 'Equip');
            btn.type = 'button';
            btn.dataset.item = id;
            if (i < 9) btn.appendChild(el('kbd', null, i + 1));

            const row = el('div', 'item-row');
            row.append(head, btn);

            const more = el('div', 'item-more');
            const clip = el('div', 'item-clip');
            clip.appendChild(el('p', 'item-blurb', it.blurb));
            const stats = el('div', 'item-stats');
            if (it.move) {
                stats.append(el('span', null, 'Speed ×' + it.move.speed), el('span', null, 'Shift ×' + it.move.boost));
            }
            if (it.alt) stats.appendChild(el('span', null, 'Flies'));
            if (it.landOnly) stats.appendChild(el('span', null, 'Land only'));
            clip.appendChild(stats);
            more.appendChild(clip);

            li.append(row, more);
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

    // A held toast (the UFO announcement) is not overwritten by ordinary ones
    // while it shows; the latest of those waits and follows it. Otherwise the
    // start-up location messages, which arrive a second later, replace it.
    toast(msg, ms = 4000, hold = false) {
        if (!hold && performance.now() < this.toastHeldUntil) {
            this.toastQueued = [msg, ms];
            return;
        }
        const t = this.$('toast');
        t.textContent = msg;
        t.classList.add('show');
        this.toastHeldUntil = hold ? performance.now() + ms : 0;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            t.classList.remove('show');
            this.toastHeldUntil = 0;
            const q = this.toastQueued;
            this.toastQueued = null;
            if (q) this.toastTimer = setTimeout(() => this.toast(q[0], q[1]), 300);
        }, ms);
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

        // Say why the bike stopped, once per bump and not more than every few
        // seconds while sliding along a bank.
        if (player.blocked && !this.wasBlocked && performance.now() - this.blockToastAt > 6000) {
            this.blockToastAt = performance.now();
            this.toast(player.mount ? 'The ' + player.mount.name.toLowerCase() + ' can’t go into the water.'
                                    : 'You can’t swim… yet.', 2500);
        }
        this.wasBlocked = player.blocked;

        if (!this.tileWarned && tiles.failed >= 6 && tiles.loaded === 0) {
            this.tileWarned = true;
            this.toast('Map tiles aren’t loading. Are you offline?', 8000);
        }
    }
};
