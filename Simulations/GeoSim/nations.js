// ============ GEOPOLITICS SIMULATOR — NATIONS ============

const NATION_DEFS = [
    { id: 'aurelia', name: 'Aurelia', color: '#4a90c8', player: true },
    { id: 'karth',   name: 'Karth',   color: '#c85a4a' },
    { id: 'vesk',    name: 'Vesk',    color: '#c8a04a' },
    { id: 'solane',  name: 'Solane',  color: '#9a7ac8' }
];

// Great-circle degrees a rival capital must keep from the player's, and from
// other rivals. Deliberately generous: early expansion needs somewhere to go.
// 32 degrees is roughly 3,500km.
const SEP_FROM_PLAYER = 32;
const SEP_BETWEEN_AI  = 22;

const MAX_SETTLE_LAT = 72;   // no polar capitals
const AI_REVEAL_MS   = 420;  // rivals appear one at a time, not all at once

function toVec(lat, lon) {
    const phi = lat * DEG, lam = lon * DEG, cp = Math.cos(phi);
    return [cp * Math.sin(lam), cp * Math.cos(lam), Math.sin(phi)];
}

function angleBetween(u, v) {
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    return Math.acos(Math.max(-1, Math.min(1, d))) / DEG;
}

function formatCoord(lat, lon) {
    return Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' +
           Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'W');
}

function formatArea(km2) {
    if (km2 >= 1e6) return (km2 / 1e6).toFixed(2) + 'M km²';
    if (km2 >= 1e3) return Math.round(km2 / 1e3) + 'k km²';
    return Math.round(km2) + ' km²';
}

function formatPeople(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'k';
    return Math.round(n).toString();
}

const nations = {
    list: [],
    phase: 'placement',
    hover: null,
    pointerDown: null,

    init() {
        this.list = NATION_DEFS.map(def => ({ ...def, site: null, vec: null, revealed: false }));

        globe.overlay = ctx => this.render(ctx);

        const canvas = globe.canvas;
        canvas.addEventListener('pointerdown', e => {
            this.pointerDown = { x: e.clientX, y: e.clientY };
        });
        canvas.addEventListener('pointerup', e => {
            const d = this.pointerDown;
            this.pointerDown = null;
            // A drag to rotate must not also drop a capital.
            if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
            this.onClick(e);
        });
        canvas.addEventListener('pointermove', e => this.onMove(e));
        canvas.addEventListener('pointerleave', () => {
            if (this.hover) { this.hover = null; globe.dirty = true; this.updateHint(); }
        });

        this.updateHint();
    },

    // ---- Placement ----

    randomLandPoint(tries) {
        for (let i = 0; i < tries; i++) {
            // asin keeps the sample uniform by area instead of bunching at the poles.
            const lat = Math.asin(Math.random() * 2 - 1) / DEG;
            if (Math.abs(lat) > MAX_SETTLE_LAT) continue;
            const lon = Math.random() * 360 - 180;
            if (globe.isLand(lat, lon)) return { lat, lon };
        }
        return null;
    },

    // Keeps rival capitals off one-pixel islets and right on the coast, so they
    // start with actual room around them.
    isViableSite(lat, lon) {
        let land = 0;
        for (let i = 0; i < 8; i++) {
            const th = i * Math.PI / 4;
            const dLon = 2 * Math.sin(th) / Math.max(0.2, Math.cos(lat * DEG));
            if (globe.isLand(lat + 2 * Math.cos(th), lon + dLon)) land++;
        }
        return land >= 5;
    },

    // Samples viable sites and keeps the ones far enough from everyone already
    // placed, relaxing the requirement only if the map leaves no other option.
    pickAISite() {
        const placed = this.list.filter(n => n.site);

        for (let relax = 0; relax <= 6; relax++) {
            const needPlayer = SEP_FROM_PLAYER - relax * 3;
            const needAI     = SEP_BETWEEN_AI  - relax * 2;
            const candidates = [];

            for (let i = 0; i < 500; i++) {
                const p = this.randomLandPoint(40);
                if (!p || !this.isViableSite(p.lat, p.lon)) continue;
                const vec = toVec(p.lat, p.lon);
                let ok = true;
                for (const n of placed) {
                    if (angleBetween(vec, n.vec) < (n.player ? needPlayer : needAI)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) candidates.push({ lat: p.lat, lon: p.lon, vec });
            }

            if (candidates.length) {
                return candidates[Math.floor(Math.random() * candidates.length)];
            }
        }
        return null;
    },

    settle(nation, lat, lon) {
        nation.site = { lat, lon };
        nation.vec = toVec(lat, lon);
    },

    beginGame(lat, lon) {
        const player = this.list.find(n => n.player);
        this.settle(player, lat, lon);
        player.revealed = true;

        const rivals = this.list.filter(n => !n.player);
        for (const n of rivals) {
            const site = this.pickAISite();
            if (site) this.settle(n, site.lat, site.lon);
        }

        this.phase = 'playing';
        globe.idleSpin = false;
        globe.flyTo(lat, lon, 1000);
        globe.dirty = true;
        territory.activate(player, this.list.indexOf(player) + 1);

        document.getElementById('placementPanel').hidden = true;
        document.getElementById('gamePanel').hidden = false;
        document.getElementById('placementBanner').hidden = true;
        globe.canvas.classList.remove('picking', 'over-water');
        this.renderRoster();

        rivals.forEach((n, i) => {
            setTimeout(() => {
                n.revealed = true;
                territory.activate(n, this.list.indexOf(n) + 1);
                this.renderRoster();
                globe.dirty = true;
            }, (i + 1) * AI_REVEAL_MS);
        });
    },

    // ---- Interaction ----

    onMove(e) {
        if (this.phase !== 'placement') return;
        const rect = globe.canvas.getBoundingClientRect();
        const c = globe.unproject(e.clientX - rect.left, e.clientY - rect.top);
        const next = c && globe.isLand(c.lat, c.lon) ? c : null;

        globe.canvas.classList.toggle('picking', !!next);
        globe.canvas.classList.toggle('over-water', !!c && !next);

        const changed = (!!next !== !!this.hover) ||
            (next && this.hover && (next.lat !== this.hover.lat || next.lon !== this.hover.lon));
        this.hover = next;
        if (changed) { globe.dirty = true; this.updateHint(c); }
    },

    onClick(e) {
        if (this.phase !== 'placement') return;
        const rect = globe.canvas.getBoundingClientRect();
        const c = globe.unproject(e.clientX - rect.left, e.clientY - rect.top);
        if (!c || !globe.isLand(c.lat, c.lon)) return;
        this.beginGame(c.lat, c.lon);
    },

    // ---- UI ----

    updateHint(coord) {
        const el = document.getElementById('placementHint');
        if (!el) return;
        if (this.hover) {
            el.textContent = 'Habitable — ' + formatCoord(this.hover.lat, this.hover.lon);
            el.className = 'sidebar-hint ok';
        } else if (coord) {
            el.textContent = 'Open ocean — pick a landmass.';
            el.className = 'sidebar-hint bad';
        } else {
            el.textContent = 'Hover the globe to survey a site.';
            el.className = 'sidebar-hint';
        }
    },

    renderRoster() {
        const list = document.getElementById('nationList');
        if (!list) return;
        list.innerHTML = '';
        for (const n of this.list) {
            if (!n.site || !n.revealed) continue;
            const li = document.createElement('li');
            li.className = 'nation-row' + (n.player ? ' is-player' : '');
            li.title = n.name + ' — capital at ' + formatCoord(n.site.lat, n.site.lon);

            const dot = document.createElement('span');
            dot.className = 'nation-dot';
            dot.style.background = n.color;

            const name = document.createElement('span');
            name.className = 'nation-name';
            name.textContent = n.name + (n.player ? ' (you)' : '');

            const area = document.createElement('span');
            area.className = 'nation-coord';
            n.areaEl = area;

            li.append(dot, name, area);
            list.appendChild(li);
        }
        this.updateStats();
    },

    // Called every territory tick; only touches text, never rebuilds the list.
    updateStats() {
        for (const n of this.list) {
            if (n.areaEl && n.stats) n.areaEl.textContent = formatArea(n.stats.area);
        }
    },

    // ---- Rendering ----

    render(ctx) {
        if (this.phase === 'placement' && this.hover) {
            this.drawMarker(ctx, this.hover.lat, this.hover.lon, '#4a90c8', null, true);
        }
        for (const n of this.list) {
            if (n.site && n.revealed) {
                this.drawMarker(ctx, n.site.lat, n.site.lon, n.color, n.name, n.player);
            }
        }
    },

    drawMarker(ctx, lat, lon, color, label, emphasis) {
        const p = globe.projectPoint(lat, lon);
        if (p.z <= 0) return;

        // Fade out near the limb so markers dissolve instead of popping.
        const alpha = Math.min(1, p.z * 6);
        ctx.save();
        ctx.globalAlpha = alpha;

        const r = emphasis ? 4.5 : 3.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha * 0.18;
        ctx.fill();

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(8,10,18,0.9)';
        ctx.stroke();

        if (emphasis) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2);
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha * 0.55;
            ctx.stroke();
            ctx.globalAlpha = alpha;
        }

        if (label) {
            ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
            ctx.textBaseline = 'middle';
            const w = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(8,10,18,0.72)';
            ctx.fillRect(p.x + 9, p.y - 8, w + 9, 16);
            ctx.fillStyle = color;
            ctx.fillText(label, p.x + 13.5, p.y + 0.5);
        }

        ctx.restore();
    }
};
