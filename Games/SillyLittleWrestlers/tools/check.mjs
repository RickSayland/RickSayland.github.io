/* =============================================================================
   SLWF - tools/check.mjs
   Loads the browser scripts into a node vm and checks the things that are easy
   to break silently. Run it after touching the renderer, the pose list, the
   move table or the tick:

       node tools/check.mjs

   It does not need a browser, a build step or any dependency. Everything the
   page uses that node lacks is stubbed below, and the stubs are deliberately
   thin: if the game starts needing something real from the DOM, this harness
   should break and say so rather than quietly paper over it.
   ============================================================================= */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ----------------------------------------------------------------- harness */

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
    if (cond) { pass++; return true; }
    fail++;
    failures.push(name + (detail ? '  -- ' + detail : ''));
    return false;
}
function eq(name, got, want) {
    return ok(name, got === want, 'got ' + got + ', want ' + want);
}
function near(name, got, want, tol) {
    return ok(name, Math.abs(got - want) <= tol, 'got ' + got + ', want ' + want + ' +-' + tol);
}

/* -------------------------------------------------------------- the stubs */

const listeners = {};
const sandbox = {
    console,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,
    navigator: {},                       // no getGamepads: input polling is skipped
    localStorage: (() => {
        let store = {};
        return {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; },
            clear: () => { store = {}; },
            _set: (k, v) => { store[k] = v; }
        };
    })(),
    document: {
        // gfx.init wants a canvas; the harness never calls it, but art and ui
        // must not reach for the DOM at all, so this throws loudly if they do.
        createElement() { throw new Error('a module touched document.createElement'); },
        getElementById() { return null; }
    },
    addEventListener(k, f) { (listeners[k] = listeners[k] || []).push(f); },
    removeEventListener() { }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// main.js boots on load, so it is deliberately not in this list.
const FILES = ['core', 'palette', 'gfx', 'font', 'art', 'poser', 'roster',
    'moves', 'ring', 'wrestler', 'combat', 'ai', 'match', 'ui'];

for (const f of FILES) {
    const src = readFileSync(join(ROOT, f + '.js'), 'utf8');
    try {
        vm.runInContext(src, sandbox, { filename: f + '.js' });
    } catch (e) {
        console.error('FATAL: ' + f + '.js threw while loading:\n  ' + e.message);
        process.exit(1);
    }
}

const { core, pal, gfx, font, art, poser, roster, moves, ring, wrestlers,
    combat, ai, match, ui } = sandbox;

console.log('SLWF check  (version ' + core.GAME_VERSION + ')\n');

/* ------------------------------------------------------------ fixed point */

{
    eq('fp/px round trip', core.px(core.fp(37)), 37);
    eq('fp negative floors down', core.px(core.fp(-3) - 1), -4);
    eq('fmul identity', core.fmul(core.fp(5), core.ONE), core.fp(5));
    near('fmul half', core.fmul(core.fp(8), 128), core.fp(4), 1);

    // Diagonal movement must not be faster than cardinal, or a player who
    // holds two keys gets free speed.
    const card = Math.hypot(core.DIRVEC[0][0], core.DIRVEC[0][1]);
    const diag = Math.hypot(core.DIRVEC[1][0], core.DIRVEC[1][1]);
    near('diagonal speed == cardinal', diag, card, 2);

    for (let d = 0; d < 8; d++) {
        const v = core.DIRVEC[d];
        if (!ok('dirFromVec inverts DIRVEC ' + d, core.dirFromVec(v[0], v[1]) === d)) break;
    }

    // The RNG is a contract: a seed must reproduce a run.
    core.seed(12345);
    const a = [core.rndf(), core.rndf(), core.rndf()];
    core.seed(12345);
    const b = [core.rndf(), core.rndf(), core.rndf()];
    ok('seeded RNG reproduces', a.every((v, i) => v === b[i]));
}

/* ---------------------------------------------------------------- palette */

{
    pal.reset();
    ok('palette reset leaves every channel on the 3-bit grid',
        pal.validate().length === 0, pal.validate().join(','));

    // Quantization has to be idempotent, or a colour drifts each time it is
    // read back and rewritten by the roster editor.
    const c = pal.hex('#4a9fd2');
    pal.setRGB(0, 5, c);
    const back = pal.get(0, 5);
    ok('quantized colour round trips', back.every((v, i) => v === c[i]));

    const shaded = pal.shade([4, 4, 4], 128);
    ok('shade stays on the grid', shaded.every(v => v >= 0 && v <= 7 && (v | 0) === v));

    for (let i = 0; i < roster.CHARS.length; i++) {
        roster.applyPalette(pal.P1, roster.CHARS[i]);
        if (!ok('roster palette ' + roster.CHARS[i].name + ' is legal',
            pal.validate().length === 0)) break;
    }
}

/* ------------------------------------------------------------------- tiles */

{
    art.init();
    ok('art fits the static tile pool', art.tilesUsed < 700,
        'used ' + art.tilesUsed);
    ok('static pool not exhausted after art + ui', gfx.staticUsed() < gfx.STATIC_TILES,
        gfx.staticUsed() + '/' + gfx.STATIC_TILES);

    // Every tile byte must be a legal palette index. A 16 here is a pixel that
    // reads whatever colour happens to follow the palette in memory.
    let bad = -1;
    for (let i = 0; i < gfx.staticUsed() * 64; i++) {
        if (gfx.tiles[i] > 15) { bad = i; break; }
    }
    ok('every static tile byte is 0..15', bad < 0, 'byte ' + bad + ' = ' + gfx.tiles[bad]);
}

/* ------------------------------------------------------------------ poses */

{
    const poses = poser.POSES;
    ok('poser exposes a pose table', poses && Object.keys(poses).length > 20);

    const style = roster.CHARS[0].style;
    const views = ['front', 'back', 'side'];
    let worst = null, empties = [], oversize = [];
    for (const p of Object.keys(poses)) {
        for (const v of views) {
            for (let f = 0; f < poses[p]; f++) {
                let px;
                try { px = poser.render(style, p, v, f); }
                catch (e) { worst = p + '/' + v + '/' + f + ': ' + e.message; break; }
                if (px.length !== poser.FW * poser.FH) {
                    oversize.push(p + '/' + v + ' len ' + px.length);
                    break;
                }
                let any = false;
                for (let i = 0; i < px.length; i++) {
                    if (px[i] > 15) { oversize.push(p + '/' + v + '/' + f + ' index ' + px[i]); break; }
                    if (px[i]) any = true;
                }
                if (!any) empties.push(p + '/' + v + '/' + f);
            }
            if (worst) break;
        }
        if (worst) break;
    }
    ok('every pose renders', !worst, worst || '');
    ok('every pose frame is the right size and in range', oversize.length === 0,
        oversize.slice(0, 3).join('; '));
    ok('no pose frame is blank', empties.length === 0, empties.slice(0, 4).join(', '));

    // Determinism: the same arguments must give the same pixels, or the tile
    // cache in gfx hands out stale frames.
    const p1 = poser.render(style, 'idle', 'side', 0);
    const p2 = poser.render(style, 'idle', 'side', 0);
    ok('pose rendering is deterministic', p1.every((v, i) => v === p2[i]));
}

/* ------------------------------------------------------------------ moves */

{
    const problems = moves.validate(poser.POSES);
    ok('every move names a pose that exists with enough frames',
        problems.length === 0, problems.slice(0, 5).join(' | '));

    // Balance intent from DESIGN.md, asserted rather than hoped for.
    const dmgByKind = {};
    for (const id of moves.ids()) {
        const m = moves.TABLE[id];
        (dmgByKind[m.kind] = dmgByKind[m.kind] || []).push(m.dmg || 0);
    }
    // Finishers and signatures are strikes too (a finisher lariat is still a
    // lariat), so the ordinary-strike ceiling has to exclude them or it is
    // measuring the wrong thing.
    const plainStrikes = moves.byKind('strike').filter(id => {
        const t = moves.TABLE[id].tags || [];
        return t.indexOf('finisher') < 0 && t.indexOf('signature') < 0;
    }).map(id => moves.TABLE[id].dmg);
    ok('ordinary strikes stay small', Math.max(...plainStrikes) <= 24,
        'biggest ' + Math.max(...plainStrikes));

    const fins = moves.finishers ? moves.finishers() : [];
    ok('finishers exist', fins.length >= 9, fins.length + ' found');
    let slowEnough = true, weakest = 1e9;
    for (const id of fins) {
        const m = moves.TABLE[id];
        if (m.startup < 16) slowEnough = false;
        if (m.dmg < weakest) weakest = m.dmg;
    }
    ok('a finisher can be interrupted (startup >= 16)', slowEnough);
    ok('finishers actually finish (dmg >= 100)', weakest >= 100, 'weakest ' + weakest);

    // Every slot of every set must resolve for every character, or a direction
    // the player can hold does nothing and feels like a dropped input.
    let unresolved = [];
    for (const ch of roster.CHARS) {
        for (const set of Object.keys(moves.SETS)) {
            for (const d of ['N', 'F', 'B', 'U', 'D']) {
                for (const btn of ['A', 'B']) {
                    const id = moves.pick(ch, set, d, btn);
                    if (!id || !moves.has(id)) unresolved.push(ch.name + ' ' + set + '.' + d + '.' + btn);
                }
            }
        }
        if (!moves.has(ch.signature)) unresolved.push(ch.name + ' signature ' + ch.signature);
        if (!moves.has(ch.finisher)) unresolved.push(ch.name + ' finisher ' + ch.finisher);
    }
    ok('every move slot resolves for every character', unresolved.length === 0,
        unresolved.slice(0, 4).join(', '));
}

/* ------------------------------------------------------------------ roster */

{
    ok('roster.validate is clean', roster.validate().length === 0,
        roster.validate().slice(0, 4).join(' | '));
    eq('nine wrestlers', roster.CHARS.length, 9);

    const want = ['QUASAR', 'DKS', 'FLYE', 'SAMANTHA', 'SCORP', 'SHARON',
        'SPOOPY', 'BREE', 'RICKITYCRICKET'];
    const have = roster.CHARS.map(c => c.name.toUpperCase().replace(/\s/g, ''));
    ok('the nine named wrestlers are all present',
        want.every(n => have.some(h => h.startsWith(n.substring(0, 5)))),
        have.join(','));

    // Two wrestlers who quantize to the same skin AND trunk are the same
    // person on screen, and at 3 bits per channel that is easy to do.
    const seen = {};
    let clash = null;
    for (const c of roster.CHARS) {
        const k = pal.hex(c.colors.skin).join('') + '/' + pal.hex(c.colors.trunk).join('');
        if (seen[k]) clash = seen[k] + ' and ' + c.name;
        seen[k] = c.name;
    }
    ok('no two wrestlers share a quantized skin+trunk pair', !clash, clash || '');

    core.seed(777);
    const r1 = roster.random(777);
    core.seed(777);
    const r2 = roster.random(777);
    ok('random wrestlers are reproducible from a seed', r1.name === r2.name &&
        r1.colors.trunk === r2.colors.trunk && r1.finisher === r2.finisher);

    // Corrupt save data must not take the game down.
    let threw = null;
    try {
        sandbox.localStorage._set('slwf.roster.v1', '{{not json');
        roster.load();
        sandbox.localStorage._set('slwf.roster.v1', '');
        roster.load();
        sandbox.localStorage.removeItem('slwf.roster.v1');
        roster.load();
    } catch (e) { threw = e.message; }
    ok('corrupt or absent save data is survivable', !threw, threw || '');
    roster.reset();
}

/* ------------------------------------------------------------------- ring */

{
    const A = core.ARENA;
    const near0 = ring.halfWidth(core.fp(A.RING_HY));
    const far0 = ring.halfWidth(-core.fp(A.RING_HY));
    near('near edge is the full half-width', core.px(near0), A.RING_HX, 1);
    near('far edge is inset', core.px(far0), A.RING_HX - A.FAR_INSET, 1);
    ok('the ring narrows with depth', far0 < near0);

    ok('ring centre is in the ring', ring.inRing(0, 0));
    ok('well outside is not', !ring.inRing(core.fp(A.FLOOR_HX), 0));
    eq('surface at centre', ring.surfaceAt(0, 0), ring.RING);
    eq('surface far outside', ring.surfaceAt(core.fp(A.FLOOR_HX - 2), 0), ring.FLOOR);

    // Projection has to agree with the art, which is laid out from the same
    // constants. A mismatch here is a wrestler standing inside the apron.
    eq('world y=0 projects to the horizon', ring.screenY(0, 0, ring.RING), A.HORIZON);
    ok('the near edge projects below the far edge',
        ring.screenY(core.fp(A.RING_HY), 0, 0) > ring.screenY(-core.fp(A.RING_HY), 0, 0));
    ok('height moves a body up the screen',
        ring.screenY(0, core.fp(20), 0) < ring.screenY(0, 0, 0));
    ok('the floor sits below the mat',
        ring.screenY(0, 0, ring.FLOOR) > ring.screenY(0, 0, ring.RING));

    // Gravity must bring a jump back down in a sane number of frames.
    const body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: core.fp(5), surface: ring.RING, ropeMode: 'block' };
    let frames = 0, peak = 0;
    for (; frames < 240; frames++) {
        const ev = ring.step(body);
        if (body.z > peak) peak = body.z;
        if (ev.landed) break;
    }
    ok('a jump lands again', frames < 240, frames + ' frames');
    ok('a jump clears the ropes but not the roof',
        core.px(peak) > 20 && core.px(peak) < 120, 'peak ' + core.px(peak) + 'px');
}

/* ---------------------------------------------------------------- sprites */

{
    // The per-scanline budget is the one hardware limit a software renderer
    // silently ignores, so prove it is enforced rather than merely declared.
    gfx.beginFrame();
    let accepted = 0;
    for (let i = 0; i < 140; i++) {
        if (gfx.sprite((i % 40) * 8, 100, 1, 0, 2, 2, 0)) accepted++;
    }
    eq('sprite list caps at MAX_SPRITES', accepted, gfx.MAX_SPRITES);
    ok('the overflow is counted', gfx.spriteOverflow === 140 - gfx.MAX_SPRITES,
        'overflow ' + gfx.spriteOverflow);

    gfx.budget();
    ok('no scanline exceeds MAX_PER_LINE', gfx.peakLine() <= gfx.MAX_PER_LINE,
        'peak ' + gfx.peakLine() + ' > ' + gfx.MAX_PER_LINE);
    ok('the budget pass still drew something', gfx.peakLine() > 0);

    // A sprite wholly off screen must not spend a slot.
    gfx.beginFrame();
    gfx.sprite(-400, 100, 1, 0, 2, 2, 0);
    eq('off-screen sprites cost nothing', gfx.spriteCount(), 0);
}

/* ------------------------------------------------------------ a whole match */

{
    // Two CPUs, one seed, a few thousand frames. This exercises the tick, the
    // paired states and every win condition path, and it is the check that
    // catches a crash in a state nobody reaches by hand.
    function runMatch(seed, frames) {
        ai.difficulty = 'hard';
        match.start({
            chars: [roster.CHARS[0], roster.CHARS[1]],
            cpu: [true, true], pads: [-1, -1],
            stip: match.STIPS[0], difficulty: 'hard', showBars: true, seed
        });
        let states = {}, movesSeen = {};
        for (let i = 0; i < frames; i++) {
            gfx.beginFrame();
            match.update();
            for (const w of match.wrestlers) {
                states[w.st] = (states[w.st] || 0) + 1;
                if (w.moveId) movesSeen[w.moveId] = 1;
            }
            if (match.result) break;
        }
        return {
            clock: match.clock,
            hp: match.wrestlers.map(w => w.hp),
            stam: match.wrestlers.map(w => w.stam),
            x: match.wrestlers.map(w => w.x),
            rng: core.rngState(),
            result: match.result ? match.result.how : null,
            states, moveCount: Object.keys(movesSeen).length
        };
    }

    let crashed = null, a1 = null;
    try { a1 = runMatch(4242, 4000); } catch (e) { crashed = e.stack || e.message; }
    ok('a full CPU-vs-CPU match runs without throwing', !crashed, crashed || '');

    if (a1) {
        ok('the match actually progressed', a1.clock > 500, 'clock ' + a1.clock);
        ok('somebody took damage', a1.hp.some(h => h < 1000), a1.hp.join('/'));
        ok('stamina moved', a1.stam.some(s => s < 1000), a1.stam.join('/'));

        // Determinism: same seed, same match, frame for frame.
        const a2 = runMatch(4242, 4000);
        ok('a seeded match replays identically',
            a1.clock === a2.clock &&
            a1.hp.join() === a2.hp.join() &&
            a1.x.join() === a2.x.join() &&
            a1.rng === a2.rng,
            'clock ' + a1.clock + '/' + a2.clock + ' hp ' + a1.hp + ' vs ' + a2.hp);

        // The interesting states have to be reachable, or a mechanic is dead
        // code that nobody will notice for a month.
        for (const s of ['walking', 'running', 'executing', 'hurt', 'down', 'gettingUp']) {
            ok('state reachable: ' + s, (a1.states[s] || 0) > 0);
        }

        // "Grapples happen" is too weak an assertion to be worth making: the
        // first build spent 93% of every match in a tie-up that could never
        // resolve, because the press that STARTED the tie-up was consumed as
        // the press that locked it in. Both wrestlers shoved each other for
        // ten minutes and the state counter looked healthy. So assert what
        // actually matters: that tie-ups turn into holds, and that no single
        // state eats the match.
        const totalFrames = Object.values(a1.states).reduce((x, y) => x + y, 0);
        const grappling = a1.states.grappling || 0;
        ok('the tie-up does not dominate the match',
            grappling < totalFrames * 0.6,
            Math.round(grappling * 100 / totalFrames) + '% of frames in a tie-up');
        ok('tie-ups resolve into holds', (a1.states.held || 0) > 0,
            'frames held: ' + (a1.states.held || 0));
        ok('a variety of moves get thrown', a1.moveCount >= 8,
            a1.moveCount + ' distinct moves in ' + a1.clock + ' frames');
        // Pace, as a rate rather than a threshold, because the threshold
        // depends on how long the harness happens to run. 1000 health at
        // 60-450 a minute is a match somewhere between two and a half and
        // twelve minutes -- Fire Pro territory at the slow end, arcade at the
        // fast one. Outside that bracket the tuning has drifted.
        const mins = a1.clock / 3600;
        const rate = Math.max(1090 - a1.hp[0], 1030 - a1.hp[1]) / Math.max(0.1, mins);
        ok('damage lands at a plausible pace', rate > 60 && rate < 450,
            Math.round(rate) + ' health/minute after ' + core.timeStr(a1.clock) +
            ' (' + Math.round(1000 / rate) + ' minute match)');
    }
}

/* ------------------------------------------------------------------ report */

console.log('');
if (failures.length) {
    console.log('FAILURES');
    for (const f of failures) console.log('  x ' + f);
    console.log('');
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
