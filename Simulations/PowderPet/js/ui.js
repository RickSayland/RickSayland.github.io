// ui.js -- buttons, overlays, pointer input, audio.
//
// The only file besides main.js that touches the DOM. It reads the world and
// calls back into main.js through the `act` table it is handed at init; it
// owns no simulation state of its own.

import { CFG, STAGE, STAGE_NAMES, AI, AI_NAMES, TISSUE, VERSION } from './config.js';
import * as grid from './grid.js';
import * as rad from './radiation.js';
import { MAT, MAT_LABELS, PALETTE_TABS, rgbCss, M_STATE, STATE } from './materials.js';
import { KIND } from './softbody.js';
import { buildPlan, restOutline, outlineR, decode, encode, mutationRates } from './genome.js';
import { loadPrefs, savePrefs } from './save.js';
import { raster } from './coupling.js';

const $ = (id) => document.getElementById(id);
const U = CFG.UI;

let world = null, act = null;
let sim, overlay, octx, stage;
const prefs = Object.assign({ sound: false, layers: { particles: true, constraints: true, dose: true, temp: false } }, loadPrefs());

const ui = {
    sandbox: false,
    debug: false,
    tab: 'basic',
    mat: MAT.SAND,
    brush: U.BRUSH,
    pointer: { down: false, x: 0, y: 0, lx: 0, ly: 0, mode: '', inside: false },
    statTimer: 0,
    overlayDirty: true,
    frame: 0,
};
export const perf = { fps: 0, tickMs: 0, renderMs: 0, frames: 0, acc: 0 };

// ================================================================== init
export function init(w, actions) {
    world = w; act = actions;
    sim = $('sim'); overlay = $('overlay'); stage = $('stage');
    octx = overlay.getContext('2d');

    $('btnFeed').onclick = () => { audioUnlock(); act.feed(); };
    $('btnClean').onclick = () => { audioUnlock(); act.clean(); };
    $('btnPlay').onclick = () => { audioUnlock(); act.play(); };
    $('btnShare').onclick = share;
    $('btnLights').onclick = () => { act.toggleLights(); syncButtons(); };
    $('btnMedicine').onclick = () => { audioUnlock(); act.medicine(); };
    $('btnSandbox').onclick = () => { ui.sandbox = !ui.sandbox; $('palette').hidden = !ui.sandbox; syncButtons(); ui.overlayDirty = true; };
    $('btnLineage').onclick = () => { refreshLineage(); $('lineageModal').hidden = false; };
    $('btnDebug').onclick = () => { ui.debug = !ui.debug; $('debugPanel').hidden = !ui.debug; syncButtons(); ui.overlayDirty = true; };
    $('btnMute').onclick = () => { prefs.sound = !prefs.sound; if (prefs.sound) audioUnlock(); savePrefs(prefs); syncButtons(); };
    $('btnNewEgg').onclick = () => { audioUnlock(); act.newEgg(null); };
    $('btnBreed').onclick = setMate;
    for (const m of document.querySelectorAll('.modal')) {
        m.addEventListener('pointerdown', (e) => { if (e.target === m && m.id !== 'dialogModal') m.hidden = true; });
    }
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => { b.closest('.modal').hidden = true; };
    for (const cb of document.querySelectorAll('#debugPanel input[data-layer]')) {
        cb.checked = !!prefs.layers[cb.dataset.layer];
        cb.onchange = () => { prefs.layers[cb.dataset.layer] = cb.checked; savePrefs(prefs); };
    }

    // sandbox palette
    for (const b of $('paletteTabs').children) b.onclick = () => { ui.tab = b.dataset.tab; buildSwatches(); };
    $('brush').value = ui.brush;
    $('brush').oninput = (e) => { ui.brush = Number(e.target.value); };
    buildSwatches();

    // pointer
    sim.addEventListener('pointerdown', onDown);
    sim.addEventListener('pointermove', onMove);
    sim.addEventListener('pointerup', onUp);
    sim.addEventListener('pointercancel', onUp);
    sim.addEventListener('pointerleave', () => { ui.pointer.inside = false; ui.overlayDirty = true; });
    sim.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new window.ResizeObserver(resize).observe($('center'));
    resize();
    syncButtons();
}

// The tank is a fixed grid; only the scale changes. The stage is sized to the
// largest 4:3 box that fits the centre column and the canvas (CSS
// image-rendering: pixelated) stretches to it.
export function resize() {
    const box = $('center').getBoundingClientRect();
    const k = Math.min(box.width / grid.W, box.height / grid.H);
    const w = Math.max(grid.W, Math.floor(grid.W * k)), h = Math.max(grid.H, Math.floor(grid.H * k));
    const cw = Math.min(w, Math.floor(box.width)), ch = Math.min(h, Math.floor(box.height));
    stage.style.width = cw + 'px';
    stage.style.height = ch + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    overlay.width = Math.round(cw * dpr);
    overlay.height = Math.round(ch * dpr);
    ui.overlayDirty = true;
}

function syncButtons() {
    $('btnLights').classList.toggle('on', !!world.lights);
    $('btnSandbox').classList.toggle('on', ui.sandbox);
    $('btnDebug').classList.toggle('on', ui.debug);
    $('btnMute').textContent = prefs.sound ? '\u{1F50A}' : '\u{1F507}';
    $('btnMute').classList.toggle('on', prefs.sound);
}
export { syncButtons };

function buildSwatches() {
    for (const b of $('paletteTabs').children) b.classList.toggle('on', b.dataset.tab === ui.tab);
    const box = $('swatches');
    box.textContent = '';
    const list = PALETTE_TABS[ui.tab];
    if (!list.includes(ui.mat)) ui.mat = list[list.length > 1 && ui.tab === 'basic' ? 2 : 0];
    for (const m of list) {
        const b = document.createElement('button');
        const sw = document.createElement('i');
        sw.style.background = m === 0 ? 'repeating-linear-gradient(45deg,#222 0 3px,#444 3px 6px)' : rgbCss(m);
        b.appendChild(sw);
        b.appendChild(document.createTextNode(MAT_LABELS[m]));
        b.classList.toggle('on', m === ui.mat);
        b.onclick = () => { ui.mat = m; buildSwatches(); };
        box.appendChild(b);
    }
}

// ================================================================= pointer
function toGrid(e) {
    const r = sim.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * grid.W, y: (e.clientY - r.top) / r.height * grid.H };
}

function alive() {
    const c = world.creature;
    return c && !c.dead && c.stage !== STAGE.EGG ? c : null;
}

function onDown(e) {
    e.preventDefault();
    audioUnlock();
    try { sim.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    const p = toGrid(e), ptr = ui.pointer;
    ptr.down = true; ptr.x = ptr.lx = p.x; ptr.y = ptr.ly = p.y; ptr.inside = true; ptr.mode = '';

    // an egg: tapping hurries it along
    if (world.egg && world.egg.inside(p.x, p.y, 1.5)) { act.tapEgg(); ptr.mode = 'tap'; return; }

    // the animal: grab the nearest skin particle on a spring
    const c = alive();
    if (c) {
        const b = c.body;
        const i = b.nearest(p.x, p.y, 1 << TISSUE.SKIN);
        if (i >= 0 && (b.contains(p.x, p.y) || b._nearestD2 < U.GRAB_REACH * U.GRAB_REACH)) {
            b.grabI = i; b.grabX = p.x; b.grabY = p.y;
            ptr.mode = 'grab';
            return;
        }
    }
    if (world.ball) {
        const b = world.ball.body;
        const i = b.nearest(p.x, p.y, 1 << TISSUE.SKIN);
        if (i >= 0 && (b.contains(p.x, p.y) || b._nearestD2 < 9)) {
            b.grabI = i; b.grabX = p.x; b.grabY = p.y;
            ptr.mode = 'grabBall';
            return;
        }
    }
    if (ui.sandbox) { ptr.mode = 'paint'; paintStroke(p.x, p.y, p.x, p.y); }
}

function onMove(e) {
    const p = toGrid(e), ptr = ui.pointer;
    ptr.inside = true;
    if (ptr.down) {
        if (ptr.mode === 'grab') { const c = world.creature; if (c) { c.body.grabX = p.x; c.body.grabY = p.y; } }
        else if (ptr.mode === 'grabBall') { if (world.ball) { world.ball.body.grabX = p.x; world.ball.body.grabY = p.y; } }
        else if (ptr.mode === 'paint') paintStroke(ptr.x, ptr.y, p.x, p.y);
    }
    ptr.x = p.x; ptr.y = p.y;
    if (ui.sandbox || ptr.down) ui.overlayDirty = true;
}

function onUp() {
    const ptr = ui.pointer;
    ptr.down = false;
    if (world.creature) world.creature.body.grabI = -1;
    if (world.ball) world.ball.body.grabI = -1;
    ptr.mode = '';
    ui.overlayDirty = true;
}

function paintStroke(x0, y0, x1, y1) {
    const m = ui.mat;
    const st = M_STATE[m];
    // loose materials pour as a spray; walls and the eraser are solid strokes
    const sparse = (st === STATE.POWDER || st === STATE.LIQUID || st === STATE.GAS) ? 0.55 : 0;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) {
        const t = k / n;
        grid.paint(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t), ui.brush, m, sparse);
    }
}

// Called once per simulation tick: a held brush keeps pouring.
export function tickInput() {
    const ptr = ui.pointer;
    if (ptr.down && ptr.mode === 'paint') paintStroke(ptr.x, ptr.y, ptr.x, ptr.y);
}

// ================================================================== sharing
function shareUrl(code) {
    return location.origin + location.pathname + location.search + '#g=' + code;
}

async function share() {
    const g = world.creature ? world.creature.genome : world.egg ? world.egg.genome : null;
    if (!g) { toast('Nothing to share yet'); return; }
    const url = shareUrl(encode(g));
    try {
        await navigator.clipboard.writeText(url);
        toast('Genome link copied');
    } catch (e) {
        // no clipboard permission: fall back to a selection the user can copy
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        ta.remove();
        toast(ok ? 'Genome link copied' : url, ok ? 0 : 9000);
    }
}

// Accepts a full link, a bare "#g=..." fragment, or just the code.
export function parseGenomeText(text) {
    if (!text) return null;
    let s = String(text).trim();
    const k = s.indexOf('g=');
    if (k >= 0) s = s.slice(k + 2);
    s = s.split(/[&\s]/)[0];
    return decode(s);
}

function setMate() {
    const g = parseGenomeText($('breedInput').value);
    const note = $('breedNote');
    if (!g) { note.textContent = 'That is not a genome this version can read.'; return; }
    const msg = act.setMate(g);
    note.textContent = msg;
    $('breedInput').value = '';
    refreshLineage();
}

// ================================================================== toast
let toastTimer = 0;
export function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || U.TOAST_MS);
}

export function showNewEgg(show, note) {
    $('newEgg').hidden = !show;
    if (note !== undefined) $('newEggNote').textContent = note;
}

// A modal question. buttons: [{ label, primary, run }]
export function showDialog(title, text, genome, buttons) {
    $('dialogTitle').textContent = title;
    $('dialogText').textContent = text;
    const cv = $('dialogThumb');
    cv.hidden = !genome;
    if (genome) drawThumb(cv, genome);
    const row = $('dialogButtons');
    row.textContent = '';
    for (const b of buttons) {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (b.primary) el.className = 'primary';
        el.onclick = () => { $('dialogModal').hidden = true; if (b.run) b.run(); };
        row.appendChild(el);
    }
    $('dialogModal').hidden = false;
}

// ================================================================= lineage
// A thumbnail is drawn from nothing but a genome: build the plan, take the
// rest outline, paint the pattern and the eyes. No physics, no stored image.
export function drawThumb(cv, genome) {
    const plan = buildPlan(genome);
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const pts = restOutline(plan, 1, 140);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    // one scale for every thumbnail, so a big animal looks big
    const s = Math.min(w / 40, h / 26);
    const ox = w / 2 - (x0 + x1) / 2 * s, oy = h / 2 - (y0 + y1) / 2 * s;
    const pal = plan.palette;
    const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => { const X = ox + p[0] * s, Y = oy + p[1] * s; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.closePath();
    ctx.fillStyle = css(pal.primary);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = css(pal.secondary);
    const pat = plan.pattern;
    if (pat.type === 1) {
        for (const sp of pat.spots) {
            const R = outlineR(plan, sp.th, 1) * sp.rho;
            ctx.beginPath();
            ctx.arc(ox + R * Math.cos(sp.th) * s, oy + R * Math.sin(sp.th) * s, sp.r * s, 0, 6.2832);
            ctx.fill();
        }
    } else if (pat.type === 2) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.transform(1, 0, -pat.slant, 1, 0, 0);
        for (let x = -40; x < 40; x += pat.period) ctx.fillRect((x + pat.period * 0.03) * s, -30 * s, pat.period * 0.44 * s, 60 * s);
        ctx.restore();
    }
    const grad = ctx.createLinearGradient(0, oy + plan.b * 0.3 * s, 0, oy + plan.b * 1.4 * s);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    ctx.beginPath();
    pts.forEach((p, i) => { const X = ox + p[0] * s, Y = oy + p[1] * s; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.closePath();
    ctx.lineWidth = Math.max(1.5, s * 0.5);
    ctx.strokeStyle = css(pal.outline);
    ctx.stroke();
    const f = plan.face;
    for (let e = -1; e <= 1; e += 2) {
        const ex = ox + (f.hx + e * f.eyeGap * 0.5 + 0.4) * s, ey = oy + f.hy * s;
        ctx.fillStyle = '#fbfbf6';
        ctx.beginPath(); ctx.arc(ex, ey, f.eyeR * s, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#14121c';
        ctx.beginPath(); ctx.arc(ex + f.eyeR * 0.35 * s, ey, f.eyeR * 0.5 * s, 0, 6.2832); ctx.fill();
    }
}

function kinCard(entry, now) {
    const el = document.createElement('div');
    el.className = 'kin' + (now ? ' now' : '');
    const cv = document.createElement('canvas');
    cv.width = 200; cv.height = 130;
    const g = decode(entry.genome);
    if (g) drawThumb(cv, g);
    el.appendChild(cv);
    const title = document.createElement('b');
    title.textContent = 'Generation ' + entry.gen + (now ? ' · now' : '');
    el.appendChild(title);
    const info = document.createElement('span');
    if (now) info.textContent = entry.note || '';
    else {
        const mins = Math.max(0, Math.round((entry.lived || 0) / 60));
        info.textContent = `lived ${mins} min · ${entry.cause || 'unknown'}` + (entry.dose > 1 ? ` · dose ${Math.round(entry.dose)}` : '');
    }
    el.appendChild(info);
    const code = document.createElement('code');
    code.textContent = entry.genome;
    code.title = 'Copy link';
    code.onclick = async () => {
        try { await navigator.clipboard.writeText(shareUrl(entry.genome)); toast('Genome link copied'); } catch (e) { toast(shareUrl(entry.genome), 9000); }
    };
    el.appendChild(code);
    return el;
}

export function refreshLineage() {
    const list = $('lineageList');
    list.textContent = '';
    const c = world.creature, e = world.egg;
    if (c && !c.dead) {
        const r = mutationRates(c.doseTotal);
        list.appendChild(kinCard({
            gen: c.generation, genome: encode(c.genome),
            note: `${STAGE_NAMES[c.stage]} · egg mutation σ ${r.sigma.toFixed(3)}` + (c.mate ? ' · mate set' : ''),
        }, true));
    }
    if (e && (!c || c.dead || e.generation !== c.generation)) {
        list.appendChild(kinCard({ gen: e.generation, genome: encode(e.genome), note: e.incubating ? 'incubating' : 'dormant egg' }, true));
    }
    const anc = world.lineage.slice().reverse();
    for (const a of anc) list.appendChild(kinCard(a, false));
    if (!list.children.length) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'No ancestors yet.';
        list.appendChild(d);
    }
    const note = $('breedNote');
    if (!note.textContent) note.textContent = c && c.mate ? 'A mate is set: the next egg will be a cross.' : 'The next egg laid will be a uniform cross between this pet and the pasted genome.';
}

// ============================================================ per-frame UI
const STAT_KEYS = ['hunger', 'happiness', 'hygiene', 'energy', 'health'];
const statEls = {};

export function frame(dt) {
    ui.frame++;
    perf.acc += dt; perf.frames++;
    if (perf.acc >= 0.5) { perf.fps = perf.frames / perf.acc; perf.acc = 0; perf.frames = 0; }
    ui.statTimer -= dt;
    if (ui.statTimer <= 0) { ui.statTimer = 0.15; updateReadouts(); }
    drawOverlay();
}

function updateReadouts() {
    const c = world.creature, e = world.egg;
    const live = c && !c.dead && c.stage !== STAGE.EGG;
    for (const k of STAT_KEYS) {
        let el = statEls[k];
        if (!el) {
            const root = document.querySelector(`.stat[data-stat="${k}"]`);
            el = statEls[k] = { root, bar: root.querySelector('i'), val: root.querySelector('.val') };
        }
        const v = live ? c.stats[k] : 0;
        el.bar.style.width = (live ? Math.max(2, v) : 0) + '%';
        el.val.textContent = live ? Math.round(v) : '—';
        el.root.classList.toggle('low', live && v < 25);
        el.root.classList.toggle('mid', live && v >= 25 && v < 50);
    }
    const D = CFG.DOSE;
    const t = $('readTemp'), r = $('readRate'), d = $('readDose'), s = $('readStage');
    if (live) {
        t.textContent = c.bodyTemp.toFixed(1) + ' °C';
        const lo = c.phen.comfort - c.phen.comfortW, hi = c.phen.comfort + c.phen.comfortW;
        t.className = c.bodyTemp > hi ? 'bad' : c.bodyTemp < lo ? 'warn' : '';
        r.textContent = c.doseRate < 0.005 ? '0.00 /s' : c.doseRate.toFixed(2) + ' /s';
        r.className = c.doseRate > D.FLEE_RATE * 3 ? 'bad' : c.doseRate > D.FLEE_RATE ? 'warn' : '';
        d.textContent = c.doseTotal.toFixed(c.doseTotal < 10 ? 1 : 0);
        d.className = c.doseTotal > D.MODERATE ? 'bad' : c.doseTotal > D.LOW ? 'warn' : '';
        const left = Math.max(0, c.phen.lifespan - c.age);
        s.textContent = `${STAGE_NAMES[c.stage]} · ${Math.floor(c.age / 60)}m`;
        s.title = `about ${Math.round(left / 60)} min of life left`;
    } else {
        t.textContent = r.textContent = d.textContent = '—';
        t.className = r.className = d.className = '';
        s.textContent = c && c.stage === STAGE.EGG ? 'Egg' : e ? 'Egg' : '—';
    }

    // HUD line over the tank
    const name = $('hudName'), st = $('hudState');
    if (live) {
        name.textContent = `Gen ${c.generation}`;
        let txt = AI_NAMES[c.ai];
        if (c.sick > 0) txt += ' · radiation sickness';
        if (c.wounds > 0) txt += ' · bleeding';
        if (c.shiver > 0.3 && c.ai !== AI.DISTRESSED) txt += ' · shivering';
        if (e && !e.incubating) txt += ' · egg laid';
        st.textContent = txt;
    } else if (e) {
        name.textContent = `Gen ${e.generation}`;
        st.textContent = e.incubating ? `incubating ${Math.min(99, Math.round(e.progress * 100))}% · tap the egg` : 'dormant egg';
    } else { name.textContent = ''; st.textContent = ''; }

    const med = $('btnMedicine');
    let cd = med.querySelector('.cd');
    if (!cd) { cd = document.createElement('span'); cd.className = 'cd'; med.appendChild(cd); }
    const wait = live ? c.medicineCooldown : 0;
    cd.textContent = wait > 0 ? Math.ceil(wait) + 's' : '';
    med.disabled = !live || wait > 0;
    $('btnFeed').disabled = false;

    if (ui.debug) updateDebugText();
}

// ================================================================= overlay
// A second, device-resolution canvas stacked on the tank. Normally empty.
// It carries the things that are unreadable at 200x150: the debug view of
// particles and constraints, the two heat maps, the grab spring and the
// sandbox brush outline.
let heatCv = null, heatCtx = null, heatImg = null, doseCv = null, doseCtx = null, doseImg = null;

function ensureMaps() {
    if (heatCv) return;
    heatCv = document.createElement('canvas'); heatCv.width = grid.W; heatCv.height = grid.H;
    heatCtx = heatCv.getContext('2d'); heatImg = heatCtx.createImageData(grid.W, grid.H);
    doseCv = document.createElement('canvas'); doseCv.width = rad.FW; doseCv.height = rad.FH;
    doseCtx = doseCv.getContext('2d'); doseImg = doseCtx.createImageData(rad.FW, rad.FH);
}

const TISSUE_COLORS = ['#f4f1e4', '#ff7f9a', '#ff2a3c', '#ffc46b'];

function drawOverlay() {
    const ptr = ui.pointer;
    const active = ui.debug || ptr.mode === 'grab' || ptr.mode === 'grabBall' || (ui.sandbox && ptr.inside);
    if (!active && !ui.overlayDirty) return;
    ui.overlayDirty = active;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const s = overlay.width / grid.W;
    octx.setTransform(s, 0, 0, s, 0, 0);

    if (ui.debug) drawDebug();

    const c = world.creature;
    if (ptr.mode === 'grab' && c && c.body.grabI >= 0) {
        const b = c.body;
        octx.strokeStyle = 'rgba(255,255,255,0.8)'; octx.lineWidth = 0.25;
        octx.beginPath(); octx.moveTo(b.x[b.grabI], b.y[b.grabI]); octx.lineTo(b.grabX, b.grabY); octx.stroke();
    }
    if (ui.sandbox && ptr.inside && ptr.mode !== 'grab') {
        octx.strokeStyle = 'rgba(255,255,255,0.55)'; octx.lineWidth = 0.2;
        octx.beginPath(); octx.arc(Math.floor(ptr.x) + 0.5, Math.floor(ptr.y) + 0.5, ui.brush + 0.6, 0, 6.2832); octx.stroke();
    }
}

function drawDebug() {
    ensureMaps();
    const L = prefs.layers;
    const AMB = CFG.GRID.AMBIENT;

    if (L.temp) {
        if ((ui.frame & 3) === 0) {
            const d = heatImg.data, T = grid.temp;
            for (let i = 0, o = 0; i < grid.N; i++, o += 4) {
                const dt = T[i] - AMB;
                if (dt > 1) {
                    const u = Math.min(1, dt / 80);
                    d[o] = 255; d[o + 1] = Math.round(60 + 180 * Math.min(1, dt / 400)); d[o + 2] = 30;
                    d[o + 3] = Math.round(40 + 170 * u);
                } else if (dt < -1) {
                    d[o] = 60; d[o + 1] = 140; d[o + 2] = 255; d[o + 3] = Math.round(Math.min(1, -dt / 15) * 180);
                } else d[o + 3] = 0;
            }
            heatCtx.putImageData(heatImg, 0, 0);
        }
        octx.imageSmoothingEnabled = false;
        octx.drawImage(heatCv, 0, 0);
    }
    if (L.dose) {
        if ((ui.frame & 3) === 1) {
            const d = doseImg.data, F = rad.field;
            for (let i = 0, o = 0; i < F.length; i++, o += 4) {
                const v = F[i];
                // log scale: the field spans several decades between "a
                // gamma passed by" and "inside the pile"
                const u = v > 0.05 ? Math.min(1, Math.log10(v / 0.05) / 3.2) : 0;
                d[o] = Math.round(120 + 135 * u); d[o + 1] = Math.round(255 * u * u); d[o + 2] = Math.round(255 - 120 * u);
                d[o + 3] = Math.round(175 * u);
            }
            doseCtx.putImageData(doseImg, 0, 0);
        }
        octx.imageSmoothingEnabled = true;
        octx.drawImage(doseCv, 0, 0, rad.FW * rad.FC, rad.FH * rad.FC);
    }

    const c = world.creature;
    if (c && !c.dead) drawBody(c.body, L, CFG.INJURY.STRAIN_WEAKEN);
    if (world.ball) drawBody(world.ball.body, L, 0.5);
}

function drawBody(b, L, weaken) {
    if (L.constraints) {
        octx.lineWidth = 0.13;
        // three passes by colour band rather than one stroke per constraint
        for (let band = 0; band < 4; band++) {
            octx.beginPath();
            for (let k = 0; k < b.nc; k++) {
                const on = b.cOn[k];
                const st = Math.abs(b.cStrain[k]);
                const bd = !on ? 3 : st > weaken ? 2 : st > weaken * 0.4 ? 1 : 0;
                if (bd !== band) continue;
                if (b.cKind[k] === KIND.SKIN_BEND && on) continue;
                const i = b.ci[k], j = b.cj[k];
                octx.moveTo(b.x[i], b.y[i]); octx.lineTo(b.x[j], b.y[j]);
            }
            octx.strokeStyle = band === 0 ? 'rgba(90,230,140,0.75)' : band === 1 ? 'rgba(240,220,80,0.9)' : band === 2 ? 'rgba(255,70,60,1)' : 'rgba(150,150,170,0.5)';
            if (band === 3) octx.setLineDash([0.4, 0.4]); else octx.setLineDash([]);
            octx.stroke();
        }
        octx.setLineDash([]);
        // muscles on top, thicker
        octx.lineWidth = 0.22; octx.strokeStyle = 'rgba(120,190,255,0.95)';
        octx.beginPath();
        for (let k = 0; k < b.nc; k++) {
            if (b.cKind[k] !== KIND.MUSCLE || !b.cOn[k]) continue;
            octx.moveTo(b.x[b.ci[k]], b.y[b.ci[k]]); octx.lineTo(b.x[b.cj[k]], b.y[b.cj[k]]);
        }
        octx.stroke();
    }
    if (L.particles) {
        for (let t = 0; t < 4; t++) {
            octx.fillStyle = TISSUE_COLORS[t];
            octx.beginPath();
            const r = t === TISSUE.BONE ? 0.5 : 0.34;
            for (let i = 0; i < b.n; i++) {
                if (!b.on[i] || b.tissue[i] !== t) continue;
                octx.moveTo(b.x[i] + r, b.y[i]);
                octx.arc(b.x[i], b.y[i], r, 0, 6.2832);
            }
            octx.fill();
        }
    }
}

function updateDebugText() {
    const c = world.creature;
    const bt = rad.pool.byType;
    const lines = [
        `v${VERSION}  ${perf.fps.toFixed(0)} fps  tick ${perf.tickMs.toFixed(2)} ms  draw ${perf.renderMs.toFixed(2)} ms`,
        `energy ${rad.pool.count}/${rad.CAP}  α ${bt[0]}  β ${bt[1]}  γ ${bt[2]}  n ${bt[3]}`,
        `fissions ${rad.pool.fissionRate.toFixed(1)}/s  emission x${grid.state.emitScale.toFixed(2)}`,
    ];
    if (c && !c.dead) {
        const b = c.body;
        let on = 0, broken = 0;
        for (let i = 0; i < b.n; i++) on += b.on[i];
        for (let k = 0; k < b.nc; k++) if (!b.cOn[k]) broken++;
        let inside = 0;
        for (let m = 1; m < c.internal.length; m++) inside += c.internal[m];
        lines.push(
            `body ${on} particles  ${b.nc} constraints  ${broken} broken  ${raster.na} cells`,
            `scale ${c.scale.toFixed(2)}  blood ${c.bloodCount || 0}/${c.bloodMax || 0}  strain rate ${b.peakStrainRate.toFixed(3)}`,
            `ai ${AI_NAMES[c.ai]}  heat x${c.regulation.toFixed(2)}  swallowed ${inside.toFixed(1)}  specks ${c.specks || 0}`,
        );
    }
    $('debugText').textContent = lines.join('\n');
}

// =================================================================== audio
// Web Audio, off until the mute button is pressed (and a browser will not
// start a context without a gesture anyway).
const audio = { ctx: null, master: null, click: null, noise: null, lastSquish: 0 };

function audioUnlock() {
    if (!prefs.sound) return;
    if (!audio.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = audio.ctx = new AC();
        audio.master = ctx.createGain();
        audio.master.gain.value = CFG.AUDIO.VOLUME;
        audio.master.connect(ctx.destination);
        // one Geiger click: a few milliseconds of noise with a sharp decay
        const n = Math.floor(ctx.sampleRate * 0.006);
        audio.click = ctx.createBuffer(1, n, ctx.sampleRate);
        const cd = audio.click.getChannelData(0);
        for (let i = 0; i < n; i++) cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
        const m = Math.floor(ctx.sampleRate * 0.3);
        audio.noise = ctx.createBuffer(1, m, ctx.sampleRate);
        const nd = audio.noise.getChannelData(0);
        for (let i = 0; i < m; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
}

// Knuth's Poisson sampler; lambda here is always small.
function poisson(lambda) {
    if (lambda <= 0) return 0;
    const Lm = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > Lm && k < 12);
    return k - 1;
}

function playClick(when) {
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.click;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    src.connect(audio.master);
    src.start(when);
}

function playSquish(level) {
    const ctx = audio.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(240 + 240 * level, t);
    f.frequency.exponentialRampToValueAtTime(110, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + 0.5 * level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f); f.connect(g); g.connect(audio.master);
    src.start(t, Math.random() * 0.1, 0.2);
}

// Once per simulation tick.
//
// Geiger counter: decays are independent, so the clicks in a time step are
// a Poisson process -- a Poisson-distributed COUNT, each click at a uniformly
// random time inside the step (equivalently, exponential gaps). The mean
// rate is proportional to the dose rate at the animal: the local field, plus
// whatever it is carrying inside it.
export function audioTick(dt) {
    if (!prefs.sound || !audio.ctx || audio.ctx.state !== 'running') return;
    const Au = CFG.AUDIO;
    const c = alive();
    let rate;
    if (c) rate = rad.fieldNear(c.cx, c.cy) * Au.GEIGER_FIELD + c.doseRate * Au.GEIGER_PER_RATE;
    else if (world.egg) rate = rad.fieldNear(world.egg.x, world.egg.y) * Au.GEIGER_FIELD;
    else rate = rad.fieldNear(grid.W / 2, grid.H * 0.7) * Au.GEIGER_FIELD;
    rate = Math.min(Au.GEIGER_MAX, rate);
    const n = poisson(rate * dt);
    const t0 = audio.ctx.currentTime;
    for (let k = 0; k < n; k++) playClick(t0 + Math.random() * dt);

    // Squish: loudness follows the fastest any constraint changed length
    // during the tick. A footstep is silent; a drop or a squeeze is not.
    if (c) {
        const sr = c.body.peakStrainRate;
        if (sr > Au.SQUISH_THRESHOLD && t0 - audio.lastSquish > Au.SQUISH_GAP) {
            audio.lastSquish = t0;
            playSquish(Math.min(1, (sr - Au.SQUISH_THRESHOLD) * Au.SQUISH_GAIN));
        }
    }
}

export function isSandbox() { return ui.sandbox; }
