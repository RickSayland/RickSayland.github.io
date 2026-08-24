// ============ GUTSIM — BOOT, LOOP, UI ============
// Plain scripts, so load order is the <script> order in index.html:
// elements → grid → anatomy → foods → digestion → main. Nothing self-boots
// except this file, because anatomy.init() has to carve the tract into the grid
// before the first particle can be placed in it.

const GUT_VERSION = '0.5';

// Empty cells are painted two different darks so the hollow organ reads as a
// hollow organ: lumen you can drop things into, and solid body around it.
const BG_OUTSIDE = [14, 10, 12];
const BG_LUMEN   = [30, 18, 22];

const LABELS = [
    { t: 'MOUTH',            x: 84,  y: 10 },
    { t: 'OESOPHAGUS',       x: 76,  y: 40 },
    { t: 'STOMACH',          x: 74,  y: 58 },
    { t: 'PYLORIC SIEVE',    x: 100, y: 98 },
    { t: 'DUODENUM',         x: 146, y: 104 },
    { t: 'SMALL INTESTINE',  x: 196, y: 110 },
    { t: 'COLON',            x: 150, y: 186 },
    { t: 'OUT',              x: 14,  y: 170 }
];

const LEGEND_KEYS = [
    'ACID', 'BILE', 'AMINO', 'GLUCOSE', 'FAT', 'FATBLOB',
    'ETHANOL', 'FIBER', 'WATER', 'GAS', 'VILLI', 'SIEVE'
];

const sim = {
    canvas: null,
    ctx: null,
    buf: null,
    bufCtx: null,
    img: null,
    data: null,
    running: true,
    speed: 2,
    hudAt: 0,
    macroRows: {},

    init() {
        this.canvas = document.getElementById('gutCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Draw at grid resolution into an offscreen buffer, then blit it up.
        // Writing 56k pixels beats issuing 56k fillRects by a wide margin.
        this.buf = document.createElement('canvas');
        this.buf.width = grid.w;
        this.buf.height = grid.h;
        this.bufCtx = this.buf.getContext('2d');
        this.img = this.bufCtx.createImageData(grid.w, grid.h);
        this.data = this.img.data;
        for (let p = 3; p < this.data.length; p += 4) this.data[p] = 255;

        grid.init();
        anatomy.init();
        digestion.init();

        this.buildTray();
        this.buildMacros();
        this.buildLegend();
        this.bindControls();
        this.bindProbe();

        requestAnimationFrame(t => this.loop(t));
    },

    // ---- Loop ----

    loop(t) {
        if (this.running) {
            for (let s = 0; s < this.speed; s++) {
                foods.tick();
                grid.step();
                digestion.step();
            }
        }
        this.render();
        if (t - this.hudAt > 120) { this.updateHud(); this.hudAt = t; }
        requestAnimationFrame(n => this.loop(n));
    },

    render() {
        const g = grid, d = this.data;
        let p = 0;
        for (let i = 0; i < g.type.length; i++) {
            const t = g.type[i];
            if (t === EL.EMPTY) {
                const bg = g.zone[i] ? BG_LUMEN : BG_OUTSIDE;
                d[p] = bg[0]; d[p + 1] = bg[1]; d[p + 2] = bg[2];
            } else {
                const pal = ELEMENTS[t].pal;
                const k = g.tint[i] * 3;
                d[p] = pal[k]; d[p + 1] = pal[k + 1]; d[p + 2] = pal[k + 2];
            }
            p += 4;
        }
        this.bufCtx.putImageData(this.img, 0, 0);

        const ctx = this.ctx;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.buf, 0, 0, this.canvas.width, this.canvas.height);

        this.drawSparks(ctx);
        this.drawLabels(ctx);
    },

    // A flash where a macro crossed the lining, so absorption is something you
    // see happen rather than a number that quietly ticks up.
    drawSparks(ctx) {
        ctx.save();
        for (const s of digestion.sparks) {
            ctx.globalAlpha = s.life * 0.85;
            ctx.fillStyle = s.color;
            ctx.beginPath();
            ctx.arc(s.x * CELL + CELL / 2, s.y * CELL + CELL / 2, CELL * (2.2 - s.life), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    },

    drawLabels(ctx) {
        ctx.save();
        ctx.font = '600 15px ui-monospace, Consolas, monospace';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(10, 6, 8, 0.9)';
        ctx.fillStyle = 'rgba(190, 140, 148, 0.62)';
        for (const l of LABELS) {
            const x = l.x * CELL, y = l.y * CELL;
            ctx.strokeText(l.t, x, y);
            ctx.fillText(l.t, x, y);
        }
        ctx.restore();
    },

    // ---- UI construction ----

    buildTray() {
        const list = document.getElementById('trayList');
        for (const food of FOODS) {
            const btn = document.createElement('button');
            btn.className = 'food';
            btn.dataset.key = food.key;

            const macros = MACROS.map(m => {
                const v = food.panel[m.key] || 0;
                return `<em style="--c:${m.color}" class="${v ? '' : 'zero'}">${v}<i>${m.key[0].toUpperCase()}</i></em>`;
            }).join('');

            btn.innerHTML =
                `<span class="food-icon">${food.icon}</span>` +
                `<span class="food-name">${food.name}` +
                `<span class="food-kcal">${panelKcal(food.panel)} kcal</span></span>` +
                `<span class="food-macros">${macros}</span>` +
                `<span class="food-note">${food.note}</span>`;

            btn.addEventListener('click', () => foods.drop(food.key));
            list.appendChild(btn);
        }
    },

    buildMacros() {
        const list = document.getElementById('macroList');
        for (const m of MACROS) {
            const row = document.createElement('div');
            row.className = 'macro dormant';
            row.style.setProperty('--c', m.color);
            row.innerHTML =
                `<div class="macro-head">` +
                `<span class="macro-name">${m.name}</span>` +
                `<span class="macro-num"><b>0.0</b> / 0.0 g</span></div>` +
                `<div class="macro-track"><div class="macro-fill"></div></div>` +
                `<div class="macro-sub">${m.kcal} kcal/g · 0 kcal</div>`;
            list.appendChild(row);
            this.macroRows[m.key] = {
                row,
                num: row.querySelector('.macro-num'),
                fill: row.querySelector('.macro-fill'),
                sub: row.querySelector('.macro-sub')
            };
        }
    },

    buildLegend() {
        const box = document.getElementById('legend');
        for (const key of LEGEND_KEYS) {
            const el = ELEMENTS[EL[key]];
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML =
                `<span class="legend-swatch" style="background:${el.color}"></span>` +
                `<span class="legend-label">${el.name}</span>`;
            box.appendChild(item);
        }
    },

    bindControls() {
        const play = document.getElementById('playBtn');
        play.addEventListener('click', () => {
            this.running = !this.running;
            play.textContent = this.running ? 'Pause' : 'Play';
            play.classList.toggle('is-on', !this.running);
        });

        document.getElementById('speedGroup').addEventListener('click', e => {
            const btn = e.target.closest('.spd');
            if (!btn) return;
            this.speed = parseInt(btn.dataset.speed, 10);
            for (const b of document.querySelectorAll('.spd')) {
                b.classList.toggle('is-on', b === btn);
            }
        });

        document.getElementById('flushBtn').addEventListener('click', () => {
            grid.flush();
            foods.reset();
            digestion.reset();
            this.updateHud();
        });
    },

    bindProbe() {
        const probe = document.getElementById('probe');
        const view = this.canvas.parentElement;

        this.canvas.addEventListener('pointermove', e => {
            const r = this.canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - r.left) / r.width * grid.w);
            const y = Math.floor((e.clientY - r.top) / r.height * grid.h);
            if (!grid.inBounds(x, y)) { probe.hidden = true; return; }

            const i = grid.idx(x, y);
            const zone = anatomy.zoneAt(i);
            const t = grid.type[i];
            const name = t === EL.EMPTY
                ? (zone.id ? 'Lumen (empty)' : '—')
                : ELEMENTS[t].name;

            probe.innerHTML = `<b>${name}</b><br><span>${zone.name}</span>`;
            probe.hidden = false;

            const vr = view.getBoundingClientRect();
            probe.style.left = (e.clientX - vr.left + 14) + 'px';
            probe.style.top = (e.clientY - vr.top + 14) + 'px';
        });

        this.canvas.addEventListener('pointerleave', () => { probe.hidden = true; });
    },

    // ---- Readout ----

    updateHud() {
        for (const m of MACROS) {
            const r = this.macroRows[m.key];
            const total = digestion.panel[m.key];
            const g = digestion.gramsOf(m.key);
            r.row.classList.toggle('dormant', total <= 0);
            r.num.innerHTML = `<b>${g.toFixed(1)}</b> / ${total.toFixed(1)} g`;
            r.fill.style.width = (digestion.fractionOf(m.key) * 100).toFixed(1) + '%';
            r.sub.textContent = `${m.kcal} kcal/g · ${Math.round(g * m.kcal)} kcal`;
        }

        const c = digestion.census;
        document.getElementById('kcalValue').textContent = Math.round(digestion.kcalAbsorbed());
        document.getElementById('kcalOf').textContent = 'of ' + Math.round(digestion.kcalOffered()) + ' kcal';
        document.getElementById('statContents').textContent = c.contents;
        document.getElementById('statAcid').textContent = c.acid;
        document.getElementById('statBile').textContent = c.bile;

        let passed = digestion.passed.other;
        for (const k of ALL_MACRO_KEYS) passed += digestion.passed[k];
        document.getElementById('statPassed').textContent = passed;

        const fibre = digestion.passed.fiber;
        document.getElementById('passedNote').textContent = fibre
            ? `${fibre} of those are fibre — never absorbed, it rides the whole tract and leaves.`
            : 'Fibre is never absorbed — it rides the whole tract and leaves.';
    }
};

sim.init();
