// main.js -- bootstrap and the game loop.
//
// Three layers, stepped in a fixed order at a fixed 30 Hz:
//
//   environment   grid.step()      the falling-sand automaton (and decay)
//                 heat.step()      the temperature field
//   radiation     rad.step()       energy particles ray-marched through both
//   creature      think -> skinPass -> body.step -> afterStep
//                 rasterize        its footprint stamped back into the grid
//                 eat, contaminate, bleed, excrete
//
// Rendering runs at the display rate and never advances the simulation; the
// accumulator below decides how many fixed ticks a frame owes.

import { CFG, STAGE, VERSION } from './config.js';
import * as grid from './grid.js';
import * as heat from './heat.js';
import * as rad from './radiation.js';
import * as coupling from './coupling.js';
import { Creature, Egg, Ball } from './creature.js';
import { randomGenome, mutate, crossover, encode, decode, mutationRates } from './genome.js';
import { MAT } from './materials.js';
import * as save from './save.js';
import * as ui from './ui.js';

const DT = 1 / CFG.SIM.HZ;
const { W, H, N } = grid;

export const world = {
    creature: null,     // the one living animal (or the embryo in an incubating egg)
    egg: null,          // dormant while its parent lives, incubating after
    ball: null,
    lights: true,
    generation: 0,
    lineage: [],        // every ancestor: { gen, genome, lived, cause, dose }
    pours: [],          // Feed and Clean are streams that run for a second or so
};

let canvas, ctx, image, buf;

// ================================================================= actions
function petX() {
    const c = world.creature;
    if (c && !c.dead) return c.cx || W / 2;
    return world.egg ? world.egg.x : W / 2;
}

function pour(mat, seconds, rate, x, spread) {
    world.pours.push({ mat, t: seconds, rate, x: Math.max(6, Math.min(W - 7, x)), spread, acc: 0 });
}

const act = {
    // Feed: about a second of food, dropped a little ahead of the animal so
    // it has to go and get it.
    feed() {
        const c = world.creature;
        const live = c && !c.dead && !c.body.womb;
        const dir = live ? (c.face >= 0 ? 1 : -1) : (Math.random() < 0.5 ? -1 : 1);
        // clear of its nose, so it lands on the sand and not on its back
        const off = (live ? c.plan.a * c.scale * 1.3 : 6) + 5 + Math.random() * 9;
        let x = petX() + dir * off;
        if (x < 10 || x > W - 10) x = petX() - dir * off;
        pour(MAT.FOOD, CFG.UI.FEED_TIME, CFG.UI.FEED_RATE, x, 3);
    },
    // Clean: water, over the animal. Dissolves waste, washes off specks.
    clean() { pour(MAT.WATER, CFG.UI.CLEAN_TIME, CFG.UI.CLEAN_RATE, petX(), 16); },
    play() {
        if (world.ball) coupling.clearBodies();
        const x = Math.max(12, Math.min(W - 12, petX() + (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 12)));
        world.ball = new Ball(x, 18);
    },
    toggleLights() {
        world.lights = !world.lights;
        ui.toast(world.lights ? 'Lights on' : 'Lights out');
    },
    medicine() {
        const c = world.creature;
        if (c && c.medicine()) ui.toast('Medicine given');
    },
    tapEgg() { if (world.egg) world.egg.tap(); },
    setMate(g) {
        const c = world.creature;
        if (!c || c.dead || c.stage === STAGE.EGG) return 'There is no pet to breed with yet.';
        c.mate = g;
        return 'Mate set. The next egg this pet lays will be a cross of the two.';
    },
    // A fresh line: generation 1, no ancestors.
    newEgg(g) {
        coupling.clearBodies();
        world.creature = null;
        coupling.setHitTarget(null);
        if (world.egg) { coupling.removeEgg(world.egg); world.egg = null; }
        world.ball = null;
        world.lineage = [];
        save.saveLineage(world.lineage);
        placeEgg(g || randomGenome(), 1, W * (0.35 + 0.3 * Math.random()), true, 0);
        ui.showNewEgg(false);
        ui.toast('A new egg');
        persist();
    },
};

// ================================================================ lifecycle
function placeEgg(genome, generation, x, incubating, parentDose) {
    const E = CFG.EGG;
    const site = coupling.eggSite(x, E.RX, E.RY, 0);
    world.egg = new Egg(genome, generation, site.x, site.y, parentDose);
    coupling.stampEgg(world.egg);
    if (incubating) startIncubation();
}

// The egg's embryo is the real animal, already a soft body, at embryo scale
// and held in by a round wall instead of the grid.
function wombOf(egg) {
    return { x: egg.x + Math.sin(egg.tilt) * egg.ry * 0.7, y: egg.y + egg.ry * 0.15, r: egg.rx - 1.8 };
}

function startIncubation() {
    const egg = world.egg;
    egg.incubating = true;
    const c = new Creature(egg.genome, egg.generation);
    const w = wombOf(egg);
    c.place(w.x, w.y);
    c.body.womb = w;
    world.creature = c;
    world.generation = egg.generation;
    coupling.setHitTarget(c);
}

function hatch() {
    const egg = world.egg, c = world.creature;
    coupling.crackEgg(egg);     // the shell turns to powder
    world.egg = null;
    c.hatch();
    ui.toast(`Generation ${c.generation} hatched`);
}

function layEgg(c) {
    c.wantsToLay = false;
    if (world.egg) return;
    const E = CFG.EGG;
    const dir = c.face >= 0 ? 1 : -1;
    const off = c.plan.a * c.scale + E.RX + 3;
    let x = c.cx - dir * off;                     // behind it
    if (x < E.RX + 6 || x > W - E.RX - 6) x = c.cx + dir * off;
    // Offspring genome: the parent's (crossed with a mate's, if one was
    // given), plus noise that grows with the dose the parent has absorbed.
    let child = c.mate ? crossover(c.genome, c.mate) : c.genome;
    child = mutate(child, c.doseTotal);
    placeEgg(child, c.generation + 1, x, false, c.doseTotal);
    const rates = mutationRates(c.doseTotal);
    c.laid();
    c.mate = null;
    ui.toast(c.doseTotal > CFG.DOSE.LOW ? `An egg — irradiated parent, mutation σ ${rates.sigma.toFixed(2)}` : 'An egg!');
}

function onDeath(c) {
    world.lineage.push({ gen: c.generation, genome: encode(c.genome), lived: c.age, cause: c.cause, dose: c.doseTotal, died: Date.now() });
    save.saveLineage(world.lineage);
    const wasEmbryo = !!c.body.womb;
    if (!wasEmbryo) coupling.corpse(c);     // bone, meat and blood go to the sand
    world.creature = null;
    coupling.setHitTarget(null);
    if (wasEmbryo && world.egg) { coupling.removeEgg(world.egg); world.egg = null; }
    if (world.egg) {
        ui.toast(`Generation ${c.generation} died of ${c.cause}. The egg stirs.`, 4200);
        startIncubation();
    } else {
        ui.showNewEgg(true, `Generation ${c.generation} died of ${c.cause} and left no egg.`);
    }
}

// ================================================================ one tick
function stepPours() {
    for (let k = world.pours.length - 1; k >= 0; k--) {
        const p = world.pours[k];
        p.t -= DT;
        p.acc += p.rate * DT;
        while (p.acc >= 1) {
            p.acc -= 1;
            const x = Math.round(p.x + (Math.random() - 0.5) * p.spread);
            if (x < 1 || x >= W - 1) continue;
            const y = 1 + ((Math.random() * 3) | 0);
            const i = y * W + x;
            if (grid.mat[i] === 0) { grid.setCell(i, p.mat); grid.temp[i] = CFG.GRID.AMBIENT; }
        }
        if (p.t <= 0) world.pours.splice(k, 1);
    }
}

export function tick() {
    const t0 = performance.now();
    ui.tickInput();
    if (world.pours.length) stepPours();

    // 1. environment, 2. radiation
    grid.step();
    heat.step();
    rad.step();

    // the egg
    const egg = world.egg;
    let c = world.creature;
    if (egg) {
        const due = egg.update(DT);
        coupling.settleEgg(egg);
        coupling.stampEgg(egg);
        if (c && c.body.womb) {
            const w = wombOf(egg);
            c.body.womb.x = w.x; c.body.womb.y = w.y;
            if (due) hatch();
        }
    }

    // 3. the creature
    const ball = world.ball;
    coupling.setBodies(c && !c.dead && !c.body.womb ? c.body : null, ball ? ball.body : null);
    if (c) {
        const embryo = c.stage === STAGE.EGG;
        if (!embryo) {
            c.hasEgg = !!world.egg;
            if (grid.state.tick % CFG.AI.SENSE_TICKS === 0) coupling.sense(c, world);
        }
        c.think(DT, grid.state.tick);
        if (!embryo) coupling.skinPass(c, DT);
        c.body.step(DT, CFG.SOFT.SUBSTEPS, coupling.collide);
        c.afterStep(DT);
    }
    if (ball) {
        coupling.ballForces(ball);
        ball.body.step(DT, CFG.SOFT.SUBSTEPS, coupling.collide);
        if (!ball.update(DT)) world.ball = null;
    }

    // its footprint goes back into the grid
    coupling.rasterize(c, world.ball);

    if (c && !c.dead && c.stage !== STAGE.EGG) {
        coupling.eat(c);
        coupling.contaminate(c);
        coupling.bleed(c);
        coupling.excrete(c);
        if (c.wantsToLay) layEgg(c);
        // playing: touching the ball is the fun, and gives it a shove
        if (world.ball && coupling.ballWasTouched()) {
            c.stats.happiness = Math.min(100, c.stats.happiness + CFG.STATS.HAPPY_PLAY * DT);
            const b = world.ball.body;
            if (b.hit[world.ball.hub] === 0 && Math.random() < 0.25) {
                const dir = Math.sign(world.ball.x - c.cx) || 1;
                for (let i = 0; i < b.n; i++) { b.vx[i] += dir * CFG.COUPLING.BALL_KICK * 0.5; b.vy[i] -= CFG.COUPLING.BALL_KICK; }
            }
        }
    }
    if (c && c.dead) onDeath(c);

    ui.audioTick(DT);
    ui.perf.tickMs += (performance.now() - t0 - ui.perf.tickMs) * 0.05;
}

// ================================================================== render
function render() {
    const t0 = performance.now();
    grid.render(buf);
    const c = world.creature;
    if (world.egg) world.egg.render(buf, W, H);
    if (c && !c.dead) {
        if (c.body.womb) c.renderEmbryo(buf, W, H);
        else c.render(buf, coupling.raster.a, coupling.raster.na, W, H, grid.mat);
    }
    if (world.ball) world.ball.render(buf, coupling.raster.b, coupling.raster.nb, W, grid.mat);
    // Lights out dims the whole palette -- and the radiation is drawn after,
    // so in the dark the glow is what you see.
    if (!world.lights) {
        for (let i = 0; i < N; i++) {
            const v = buf[i];
            buf[i] = 0xff000000 | ((v >> 2) & 0x3f3f3f) + ((v >> 3) & 0x1f1f1f) + 0x060201;
        }
    }
    rad.render(buf);
    ctx.putImageData(image, 0, 0);
    ui.perf.renderMs += (performance.now() - t0 - ui.perf.renderMs) * 0.05;
}

// ==================================================================== loop
let last = 0, acc = 0, saveClock = 0, noSave = false;
function persist() { if (!noSave) save.saveWorld(world); }

function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;           // a stalled tab does not owe a backlog
    acc += dt;
    let n = 0;
    while (acc >= DT && n < CFG.SIM.MAX_TICKS_PER_FRAME) { tick(); acc -= DT; n++; }
    if (acc > DT * 2) acc = 0;
    render();
    ui.frame(dt);
    saveClock += dt;
    if (saveClock >= CFG.SAVE.INTERVAL) { saveClock = 0; persist(); }
}

// ================================================================ the link
// #g=<genome> offers a new egg with that genome.
function checkHash() {
    const m = /[#&]g=([^&]+)/.exec(location.hash);
    if (!m) return;
    let g = null;
    try { g = decode(decodeURIComponent(m[1])); } catch (e) { g = null; }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// */ }
    if (!g) { ui.toast('That genome link is not one this version can read'); return; }
    const c = world.creature;
    const haveAdult = c && !c.dead && c.stage !== STAGE.EGG;
    const buttons = [{ label: 'Hatch this egg', primary: true, run: () => act.newEgg(g) }];
    if (haveAdult) buttons.push({ label: 'Breed with it', run: () => ui.toast(act.setMate(g), 3600) });
    buttons.push({ label: 'Not now' });
    ui.showDialog('A shared genome',
        haveAdult
            ? 'This link carries a genome. Hatching it starts a new line and replaces your current pet. Or keep your pet and have its next egg be a cross with this one.'
            : 'This link carries a genome. Start a new egg with it? It replaces the egg you have now.',
        g, buttons);
}

// ==================================================================== boot
function freshWorld() {
    grid.initWorld();
    for (let k = 0; k < 40; k++) grid.step();
    rad.clear();
    world.creature = null; world.egg = null; world.ball = null;
    world.lights = true;
    world.lineage = [];
    save.saveLineage(world.lineage);
    placeEgg(randomGenome(), 1, W / 2, true, 0);
}

function boot() {
    canvas = document.getElementById('sim');
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    image = ctx.createImageData(W, H);
    buf = new Uint32Array(image.data.buffer);

    world.lineage = save.loadLineage();
    ui.init(world, act);

    const data = save.loadSave();
    const away = data ? save.restoreWorld(data, world) : -1;
    if (away < 0) freshWorld();
    else {
        // put back what a save does not store
        let c = world.creature;
        if (c && c.stage === STAGE.EGG && !world.egg) { world.creature = c = null; }
        if (world.egg) {
            coupling.stampEgg(world.egg);
            if (world.egg.incubating && !c) startIncubation();
            else if (c && c.body.womb) Object.assign(c.body.womb, wombOf(world.egg));
        }
        c = world.creature;
        if (c) { coupling.setHitTarget(c); c.hasEgg = !!world.egg && !c.body.womb; }
        if (!c && !world.egg) ui.showNewEgg(true, 'The tank is empty.');
        if (away > 90) ui.toast(`Welcome back — ${away > 7200 ? Math.round(away / 3600) + ' hours' : Math.round(away / 60) + ' minutes'} passed`, 4000);
    }
    ui.syncButtons();

    // save on the way out as well as every ten seconds
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
    window.addEventListener('pagehide', persist);
    window.addEventListener('hashchange', checkHash);
    checkHash();

    last = performance.now();
    requestAnimationFrame(frame);
}

// A development handle, not a game feature. requestAnimationFrame is
// throttled in hidden tabs and most automated browsers, so step(n) advances
// the same tick and render the loop does, by hand.
window.powderpet = {
    VERSION, CFG, world, grid, heat, rad, coupling, save, act, MAT,
    step(n = 1) { for (let k = 0; k < n; k++) tick(); render(); },
    render,
    // forget everything and stop saving, so the next reload starts clean
    wipe() { noSave = true; save.clearSave(); save.saveLineage([]); },
};

boot();
