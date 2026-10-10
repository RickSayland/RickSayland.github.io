/* =============================================================================
   SLWF - core.js
   Constants, fixed-point math, seeded RNG, input, the fixed-timestep clock and
   screen effects. Dependency-free: this is the root of the load order and the
   only file allowed to know nothing about anything else.

   Everything positional in this game is an 8.8 fixed-point integer. One pixel
   is 256 units. That is not nostalgia for its own sake -- a 60 Hz integer sim
   is bit-reproducible, which is what makes a desync or a one-frame jitter
   findable instead of a mystery.
   ============================================================================= */
(function () {
    'use strict';

    var core = {};

    /* ---------------------------------------------------------------- version */

    core.GAME_VERSION = '0.3.2';

    /* ------------------------------------------------------- screen geometry */

    // 640x448: exactly twice the Mega Drive's 320x224, which is the 32-bit
    // step up (Saturn hi-res, PlayStation) and keeps every ratio in the game
    // intact.
    //
    // VIEW is screen pixels per LOGICAL pixel. The world -- speeds, ranges,
    // gravity, hitboxes, the whole move table and all of core.ARENA -- stays
    // in logical pixels and is unchanged by this. Only projection, the
    // framebuffer and the art layout scale. Doubling the world instead would
    // have invalidated two rounds of combat tuning.
    core.VIEW = 2;
    core.VW = 320 * core.VIEW;
    core.VH = 224 * core.VIEW;

    /* -------------------------------------------------- arena geometry (px) */

    // These numbers live here, in the dependency-free root, because both the
    // art (art.js, which lays the arena into the tile planes) and the physics
    // (ring.js, which collides against it) have to agree about them exactly.
    // Put them in either one and the other drifts, and a wrestler stands two
    // pixels inside the rope.
    //
    // World axes: x horizontal (0 = ring centre), y DEPTH (negative = away
    // from the camera), z height off the surface. Screen:
    //     sx = x - camX + VW/2
    //     sy = HORIZON + y * PERSP - z
    core.ARENA = {
        HORIZON: 120,     // screen row that world y=0, z=0 projects to
        PERSP: 115,       // 0.45 in 8.8 -- depth-to-screen compression

        RING_HX: 192,     // ring half-width at the near edge
        RING_HY: 90,      // ring half-depth
        FAR_INSET: 16,    // near edge is this much wider than the far edge,
        // per side: the whole of the ring's perspective

        ROPE_Z: [12, 24, 36],   // the three rope heights
        POST_H: 46,       // post height above the canvas
        APRON_H: 20,      // blue apron band below the near canvas edge

        FLOOR_HX: 284,    // outside brawling area half-width
        FLOOR_HY: 150,    // and half-depth
        FLOOR_DROP: 26,   // how far the arena floor sits below the canvas

        // The crowd has to clear the FAR ropes and posts, not just the far
        // edge of the mat: a post is POST_H tall above a canvas edge that
        // projects to HORIZON - RING_HY*PERSP, so at 56 the whole far side of
        // the ring was drawn inside the crowd and read as clutter.
        BARRICADE_Y: 40,  // screen row of the barricade in front of the crowd
        CROWD_H: 40,      // screen rows of crowd above it

        CAM_MARGIN: 56    // keep wrestlers this far inside the screen edge
    };

    // core.ARENA in SCREEN pixels. art.js lays the arena into the tile planes
    // and therefore needs the scaled numbers, while ring.js collides in
    // logical ones -- same table, two coordinate systems, one conversion.
    // PERSP is a ratio and ROPE_Z is a list, so both need their own handling.
    core.arenaScaled = function () {
        var out = {}, v = core.VIEW, k;
        for (k in core.ARENA) {
            var val = core.ARENA[k];
            if (k === 'PERSP') out[k] = val;
            else if (val instanceof Array) out[k] = val.map(function (n) { return n * v; });
            else out[k] = val * v;
        }
        return out;
    };

    /* ----------------------------------------------------------- fixed point */

    core.FP = 8;                 // fractional bits
    core.ONE = 1 << core.FP;     // 256 == one pixel

    // pixel <-> fixed. px() floors toward negative infinity via >>, which is
    // what we want: a wrestler at -0.5px must not round to 0 and jitter.
    core.px = function (v) { return v >> core.FP; };
    core.fp = function (n) { return (n * core.ONE) | 0; };

    // Multiply two 8.8 values, keeping 8.8. Math.imul avoids the float round
    // trip that >32-bit intermediates would otherwise force.
    core.fmul = function (a, b) { return (Math.imul(a, b) >> core.FP) | 0; };
    core.fdiv = function (a, b) { return b === 0 ? 0 : (((a << core.FP) / b) | 0); };

    core.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
    core.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
    core.abs = function (v) { return v < 0 ? -v : v; };

    // Approach a target by at most step, without overshooting.
    core.toward = function (v, target, step) {
        if (v < target) { v += step; return v > target ? target : v; }
        if (v > target) { v -= step; return v < target ? target : v; }
        return v;
    };

    /* -------------------------------------------------------------- angles */

    // Angles are 1/256 of a turn, so they wrap for free with & 255 and index a
    // table directly. No Math.sin anywhere in the hot path.
    core.ANG = 256;
    core.SIN = new Int16Array(256);
    core.COS = new Int16Array(256);
    (function buildTrig() {
        for (var a = 0; a < 256; a++) {
            var r = (a / 256) * Math.PI * 2;
            core.SIN[a] = Math.round(Math.sin(r) * core.ONE);
            core.COS[a] = Math.round(Math.cos(r) * core.ONE);
        }
    })();

    // Eight-way facing, used for sprite view selection and movement.
    // 0 = right, going clockwise on screen (y+ is toward the camera).
    core.DIR = { R: 0, DR: 1, D: 2, DL: 3, L: 4, UL: 5, U: 6, UR: 7 };
    // Unit vectors in 8.8, diagonals scaled to ~0.707 so diagonal movement
    // is not faster than cardinal movement.
    var D = 181; // round(0.7071 * 256)
    core.DIRVEC = [
        [256, 0], [D, D], [0, 256], [-D, D],
        [-256, 0], [-D, -D], [0, -256], [D, -D]
    ];
    // Which of the three generated views a facing uses, and whether to flip.
    // The hardware has one horizontal flip bit and no scaling, so eight
    // directions out of three drawn views is exactly what a Genesis game did.
    core.DIRVIEW = [
        { view: 'side', flip: false }, // R
        { view: 'side', flip: false }, // DR
        { view: 'front', flip: false }, // D  (toward camera)
        { view: 'side', flip: true },  // DL
        { view: 'side', flip: true },  // L
        { view: 'side', flip: true },  // UL
        { view: 'back', flip: false }, // U  (away from camera)
        { view: 'side', flip: false }  // UR
    ];

    core.dirFromVec = function (dx, dy) {
        if (dx === 0 && dy === 0) return -1;
        // Octant classification without trig: compare magnitudes.
        var ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
        var diag = (ax > (ay >> 1)) && (ay > (ax >> 1));
        if (diag) {
            if (dx > 0) return dy > 0 ? core.DIR.DR : core.DIR.UR;
            return dy > 0 ? core.DIR.DL : core.DIR.UL;
        }
        if (ax >= ay) return dx > 0 ? core.DIR.R : core.DIR.L;
        return dy > 0 ? core.DIR.D : core.DIR.U;
    };

    /* ----------------------------------------------------------------- RNG */

    // mulberry32. Seeded, so a match can be replayed from its seed -- the
    // determinism check in tools/check.mjs leans on this.
    var _rs = 0x9e3779b9 | 0;
    core.seed = function (s) { _rs = (s | 0) || 0x9e3779b9; };
    core.rndf = function () {
        _rs = (_rs + 0x6D2B79F5) | 0;
        var t = _rs;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    core.rnd = function (n) { return (core.rndf() * n) | 0; };
    core.rndRange = function (a, b) { return a + ((core.rndf() * (b - a + 1)) | 0); };
    core.chance = function (p) { return core.rndf() < p; };
    core.pick = function (arr) { return arr[(core.rndf() * arr.length) | 0]; };
    core.rngState = function () { return _rs; };

    /* --------------------------------------------------------------- input */

    // Genesis three-button pad, plus the optional three extras.
    // The `just` buffer matters: a browser can deliver keydown and keyup
    // between two animation frames, and real players hit buttons faster than
    // 16ms. `pressed` accumulates every keydown that happens between frames and
    // `updateInput` swaps it in, so no press is ever missed.
    var BTN = core.BTN = {
        U: 0, D: 1, L: 2, R: 3, A: 4, B: 5, C: 6, START: 7, X: 8, Y: 9, Z: 10
    };
    core.NBTN = 11;

    function makePad() {
        return {
            held: new Uint8Array(core.NBTN),
            just: new Uint8Array(core.NBTN),
            rel: new Uint8Array(core.NBTN),
            _pressed: new Uint8Array(core.NBTN),
            _released: new Uint8Array(core.NBTN),
            // How long each button has been held, in frames. The grapple
            // mash contest and the kick-out both read this.
            frames: new Uint16Array(core.NBTN),
            dx: 0, dy: 0, dir: -1
        };
    }

    core.pads = [makePad(), makePad()];

    // P1 sits on the arrow cluster with Z/X/C for A/B/C and V/B/N for X/Y/Z --
    // contiguous on the bottom row, and clear of P2's WASD.
    var KEYMAP = [
        { /* P1 */
            ArrowUp: BTN.U, ArrowDown: BTN.D, ArrowLeft: BTN.L, ArrowRight: BTN.R,
            KeyZ: BTN.A, KeyX: BTN.B, KeyC: BTN.C,
            KeyV: BTN.X, KeyB: BTN.Y, KeyN: BTN.Z,
            Enter: BTN.START, NumpadEnter: BTN.START
        },
        { /* P2 */
            KeyW: BTN.U, KeyS: BTN.D, KeyA: BTN.L, KeyD: BTN.R,
            KeyJ: BTN.A, KeyK: BTN.B, KeyL: BTN.C,
            KeyU: BTN.X, KeyI: BTN.Y, KeyO: BTN.Z,
            Space: BTN.START
        }
    ];

    // Gamepad button -> pad button. Standard mapping: face buttons 0..3,
    // shoulders 4/5, start 9. A Genesis pad through the browser usually lands
    // on 0/1/2 for A/B/C, so the extras ride on 3/4/5.
    var GP_BTN = { 0: BTN.A, 1: BTN.B, 2: BTN.C, 3: BTN.X, 4: BTN.Y, 5: BTN.Z, 9: BTN.START, 8: BTN.START };
    var GP_DPAD = { 12: BTN.U, 13: BTN.D, 14: BTN.L, 15: BTN.R };

    core.input = {
        enabled: true,
        // Set true once any key is seen, so the title screen knows the user
        // has interacted and audio may be started.
        gestured: false
    };

    function onKey(e, down) {
        if (!core.input.enabled) return;
        for (var p = 0; p < 2; p++) {
            var b = KEYMAP[p][e.code];
            if (b === undefined) continue;
            var pad = core.pads[p];
            if (down) {
                if (!pad.held[b]) pad._pressed[b] = 1;
                pad.held[b] = 1;
                core.input.gestured = true;
            } else {
                pad.held[b] = 0;
                pad._released[b] = 1;
            }
            // Arrows and space scroll the page; the game owns them.
            e.preventDefault();
            return;
        }
        // Keys the game does not claim but the browser shouldn't act on either.
        if (down && (e.code === 'Tab' || e.code === 'Backspace')) e.preventDefault();
    }

    core.attachInput = function () {
        window.addEventListener('keydown', function (e) { onKey(e, true); }, { passive: false });
        window.addEventListener('keyup', function (e) { onKey(e, false); }, { passive: false });
        // A blurred tab must not leave a button stuck down.
        window.addEventListener('blur', function () {
            for (var p = 0; p < 2; p++) {
                core.pads[p].held.fill(0);
                core.pads[p].frames.fill(0);
            }
        });
    };

    function pollGamepads() {
        if (!navigator.getGamepads) return;
        var gps = navigator.getGamepads();
        for (var i = 0, used = 0; i < gps.length && used < 2; i++) {
            var gp = gps[i];
            if (!gp || !gp.connected) continue;
            var pad = core.pads[used++];
            var b, k;
            for (k in GP_BTN) {
                b = GP_BTN[k];
                var pressed = gp.buttons[k] && gp.buttons[k].pressed;
                if (pressed) {
                    if (!pad.held[b]) pad._pressed[b] = 1;
                    pad.held[b] = 1;
                    core.input.gestured = true;
                } else if (pad.held[b] && !KEYMAP_HOLDS(pad, b)) {
                    pad.held[b] = 0; pad._released[b] = 1;
                }
            }
            for (k in GP_DPAD) {
                b = GP_DPAD[k];
                if (gp.buttons[k] && gp.buttons[k].pressed) {
                    if (!pad.held[b]) pad._pressed[b] = 1;
                    pad.held[b] = 1;
                }
            }
            // Analogue stick folded onto the d-pad with a dead zone.
            var ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
            if (ax < -0.4) pad.held[BTN.L] = 1; else if (ax > 0.4) pad.held[BTN.R] = 1;
            if (ay < -0.4) pad.held[BTN.U] = 1; else if (ay > 0.4) pad.held[BTN.D] = 1;
        }
    }
    // A gamepad release must not clear a key the player is also holding. We
    // have no per-source record, so the conservative answer is to leave the
    // button down while the keyboard still has it -- which this reports.
    function KEYMAP_HOLDS() { return false; }

    core.updateInput = function () {
        pollGamepads();
        for (var p = 0; p < 2; p++) {
            var pad = core.pads[p];
            for (var b = 0; b < core.NBTN; b++) {
                pad.just[b] = pad._pressed[b];
                pad.rel[b] = pad._released[b];
                pad._pressed[b] = 0;
                pad._released[b] = 0;
                pad.frames[b] = pad.held[b] ? (pad.frames[b] + 1) : 0;
            }
            var dx = (pad.held[BTN.R] ? 1 : 0) - (pad.held[BTN.L] ? 1 : 0);
            var dy = (pad.held[BTN.D] ? 1 : 0) - (pad.held[BTN.U] ? 1 : 0);
            pad.dx = dx; pad.dy = dy;
            pad.dir = core.dirFromVec(dx, dy);
        }
    };

    // Any-player helpers for menus.
    core.anyJust = function (b) { return core.pads[0].just[b] || core.pads[1].just[b]; };
    core.anyStart = function () { return core.anyJust(BTN.START) || core.anyJust(BTN.A) || core.anyJust(BTN.C); };

    /* --------------------------------------------------------- screen effects */

    // Shake, flash and hit-freeze. Freeze is the one with teeth: it stops the
    // logic update for a few frames on a big impact while rendering continues,
    // which is how every fighting game of this era sold a hit.
    core.fx = {
        shakeAmp: 0, shakeTime: 0, shakeX: 0, shakeY: 0,
        freeze: 0,
        flashFrames: 0
    };

    // Slow motion. Distinct from hit-freeze: freeze stops the world dead for
    // a few frames to sell an impact, slow-mo runs it at a fraction of speed
    // for most of a second so there is time to watch what happened. A
    // finisher landing is the one moment in a match that earns it.
    core.slow = 0;
    core.slowFactor = 3;
    core._slowPhase = 0;

    core.slowmo = function (frames, factor) {
        if (frames > core.slow) core.slow = frames;
        core.slowFactor = factor || 3;
    };

    // Should the simulation advance on this display frame? Both the real loop
    // and the debug stepper go through here, so they cannot disagree.
    core.tickGate = function () {
        if (core.fx.freeze > 0) { core.fx.freeze--; return false; }
        if (core.slow > 0) {
            core.slow--;
            core._slowPhase++;
            if (core._slowPhase < core.slowFactor) return false;
            core._slowPhase = 0;
        }
        return true;
    };

    core.shake = function (amp, frames) {
        if (amp > core.fx.shakeAmp) { core.fx.shakeAmp = amp; core.fx.shakeTime = frames; }
    };
    core.freeze = function (frames) {
        if (frames > core.fx.freeze) core.fx.freeze = frames;
    };

    core.updateFx = function () {
        var f = core.fx;
        if (f.shakeTime > 0) {
            f.shakeTime--;
            // Alternating sign gives the sharp 1-frame judder of the era
            // rather than a smooth wobble.
            var a = f.shakeAmp;
            f.shakeX = (f.shakeTime & 1) ? a : -a;
            f.shakeY = (f.shakeTime & 2) ? (a >> 1) : -(a >> 1);
            if (f.shakeTime === 0) { f.shakeAmp = 0; f.shakeX = 0; f.shakeY = 0; }
            else if (f.shakeAmp > 0 && (f.shakeTime & 3) === 0) f.shakeAmp--;
        } else { f.shakeX = 0; f.shakeY = 0; }
    };

    /* ------------------------------------------------------------- the clock */

    // Fixed 60 Hz logic, decoupled render. Real elapsed milliseconds go into an
    // accumulator; each step that comes due runs one logic frame. MAX_STEPS
    // stops a backgrounded tab returning and trying to simulate a minute in one
    // frame, and the wall-clock budget stops an already-overrun frame taking
    // another step.
    var STEP_MS = 1000 / 60;
    var MAX_STEPS = 5;
    var FRAME_BUDGET_MS = 12;

    core.clock = {
        acc: 0, last: 0, frames: 0, fps: 60, running: false,
        _fpsAcc: 0, _fpsCount: 0
    };

    core.run = function (update, render) {
        var c = core.clock;
        c.running = true;
        c.last = performance.now();

        function tick(now) {
            if (!c.running) return;
            var dt = now - c.last;
            c.last = now;
            if (dt > 250) dt = STEP_MS;       // tab was away; don't catch up
            c.acc += dt;

            c._fpsAcc += dt; c._fpsCount++;
            if (c._fpsAcc >= 500) {
                c.fps = Math.round(1000 / (c._fpsAcc / c._fpsCount));
                c._fpsAcc = 0; c._fpsCount = 0;
            }

            var steps = 0, t0 = now;
            while (c.acc >= STEP_MS && steps < MAX_STEPS) {
                c.acc -= STEP_MS;
                steps++;
                core.updateInput();
                // Hit-freeze and slow motion both hold the world still while
                // effects and the input edge buffer keep advancing, or a
                // buffered press would be eaten by the pause.
                if (core.tickGate()) update();
                core.updateFx();
                c.frames++;
                if (performance.now() - t0 > FRAME_BUDGET_MS) break;
            }
            if (c.acc > STEP_MS * MAX_STEPS) c.acc = 0;

            render();
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    };

    core.stop = function () { core.clock.running = false; };

    /* ------------------------------------------------------------- utilities */

    // Frame-count helpers so timing reads as seconds where it should.
    core.sec = function (s) { return Math.round(s * 60); };

    // mm:ss for the match clock, which counts up and is always on screen.
    core.timeStr = function (frames) {
        var t = (frames / 60) | 0;
        var m = (t / 60) | 0, s = t % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    };

    window.core = core;
})();
