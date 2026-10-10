/* =============================================================================
   SLWF - main.js
   Boot, the scene manager and the loop. The only file that runs anything.

   Load order is the <script> order in index.html and it is not negotiable:
   core -> palette -> gfx -> font -> art -> poser -> roster -> moves -> ring
        -> wrestler -> combat -> ai -> audio -> match -> ui -> main
   Everything above defines its global and waits; this file calls each init()
   in dependency order, because art.init() needs tile memory to exist and
   ui.init() needs the window plane.
   ============================================================================= */
(function () {
    'use strict';

    /* --------------------------------------------------------- shared state */

    var ctx = {
        stipIndex: 0,
        difficulty: 'normal',
        showBars: false,
        picks: [0, 1],
        musicVol: 0.7,
        sfxVol: 0.9,

        go: function (name) { setScene(name); },

        beginMatch: function () {
            var chars = [], cpu = [], pads = [];
            for (var i = 0; i < ctx.picks.length; i++) {
                chars.push(roster.CHARS[ctx.picks[i]]);
                cpu.push(i !== 0);
                pads.push(i === 0 ? 0 : -1);
            }
            match.start({
                chars: chars, cpu: cpu, pads: pads,
                stip: match.STIPS[ctx.stipIndex],
                difficulty: ctx.difficulty,
                showBars: ctx.showBars,
                seed: (Date.now() & 0x7fffffff)
            });
        }
    };

    /* -------------------------------------------------------------- scenes */

    var scene = null, sceneName = '';

    // The match scene is here rather than in ui.js because it is the one that
    // drives the simulation; ui.js only paints its HUD.
    var matchScene = {
        enter: function () {
            // The entrance left the player out by the tunnel; the bell brings
            // everybody back to their marks.
            match.takePositions();
            if (window.sound) sound.music('match');
        },
        update: function () {
            if (core.pads[0].just[core.BTN.START]) { setScene('pause'); return; }
            match.update();
            // The crowd animates by cycling tile CONTENT, not cells: a few
            // tiles re-uploaded at 6 Hz move thousands of pixels.
            if (window.art && art.crowdFrame && (core.clock.frames % 10) === 0) {
                art.crowdFrame((core.clock.frames / 10) | 0);
            }
            // Switch to the tense cue for the closing stretch of a long match,
            // which with bars off is the only other pacing signal there is.
            if (match.clock === 60 * 300 && window.sound) sound.music('matchTense');
            if (match.isOver()) { match.clearDone(); setScene('results'); }
        },
        draw: function () {
            ui.drawHud(ctx);
            match.draw();
        }
    };

    // Generating ~300 pose frames per wrestler is a one-time cost, paid here
    // behind a progress bar, which is exactly what a cartridge-era game would
    // have done with a loading screen it was not embarrassed about.
    var loadingScene = {
        step: null, done: 0, total: 1, note: '',
        enter: function () {
            this.done = 0; this.total = 1; this.note = 'GENERATING WRESTLERS';
            ui.menuBackdrop('#000012');
            var styles = [];
            for (var i = 0; i < ctx.picks.length; i++) styles.push(roster.CHARS[ctx.picks[i]].style);
            var self = this;
            if (window.poser && poser.prepare) {
                this.step = poser.prepare(styles, function (d, t) { self.done = d; self.total = t; });
            } else {
                this.step = function () { return true; };
            }
        },
        update: function () {
            if (!this.step) { setScene('entrance'); return; }
            // A slice per frame: the bar has to move or it looks hung.
            var finished = this.step();
            if (finished) { this.step = null; setScene('entrance'); }
        },
        draw: function () { ui.loading.draw(this.done, this.total, this.note); }
    };

    var SCENES = {
        title: ui.title,
        menu: ui.menu,
        options: ui.options,
        roster: ui.roster,
        select: ui.select,
        vs: ui.vs,
        loading: loadingScene,
        entrance: ui.entrance,
        match: matchScene,
        pause: ui.pause,
        results: ui.results
    };

    function setScene(name) {
        if (scene && scene.exit) scene.exit(ctx);
        scene = SCENES[name];
        sceneName = name;
        if (!scene) { scene = SCENES.title; sceneName = 'title'; }
        if (scene.enter) scene.enter(ctx);
    }

    // The VS screen hands off to loading rather than straight to the entrance.
    ui.vs.update = (function (orig) {
        return function (c) {
            this.t++;
            if (this.t > 180 || core.anyStart()) c.go('loading');
        };
    })(ui.vs.update);

    /* ----------------------------------------------------------- the missing */

    // With no build step, a module that failed to load is a blank screen and a
    // console message nobody reads. Say so on screen instead.
    function missingModules() {
        var need = ['pal', 'gfx', 'font', 'art', 'poser', 'roster', 'moves',
            'ring', 'wrestlers', 'combat', 'ai', 'match', 'ui'];
        var miss = [];
        for (var i = 0; i < need.length; i++) if (!window[need[i]]) miss.push(need[i]);
        return miss;
    }

    var fatal = null;

    var errorScene = {
        update: function () { },
        draw: function () {
            ui.clear();
            font.textCentred(gfx.planeW, 6, 'SLWF CANNOT START', font.RED);
            font.textCentred(gfx.planeW, 9, 'MISSING MODULES', font.WHITE);
            for (var i = 0; i < fatal.length && i < 8; i++) {
                font.textCentred(gfx.planeW, 11 + i, fatal[i].toUpperCase() + '.JS', font.YELLOW);
            }
            font.textCentred(gfx.planeW, 22, 'SERVE THE REPO OVER HTTP', font.GREY);
        }
    };

    /* ----------------------------------------------------------- debug view */

    var debug = false;
    function drawDebug() {
        var W = gfx.planeW, F = font;
        F.text(W, 0, 24, 'FPS ' + core.clock.fps + ' SPR ' + gfx.spriteCount() +
            ' LN ' + gfx.peakLine(), F.GREEN);
        F.text(W, 0, 25, 'TILE ' + gfx.staticUsed() + ' DMA ' + gfx.dmaTiles +
            (gfx.spriteOverflow ? ' OVF' + gfx.spriteOverflow : '') +
            (gfx.tileOverflow ? ' VRAM!' : ''), F.GREEN);
        var w = match.wrestlers[0];
        if (w) {
            F.text(W, 0, 26, (w.st + '/' + w.pose).substring(0, 20).toUpperCase() +
                ' HP' + w.hp + ' ST' + w.stam, F.GREEN);
        }
    }

    /* ---------------------------------------------------------------- boot */

    function boot() {
        var canvas = document.getElementById('screen');
        if (!canvas) { return; }

        gfx.init(canvas);
        pal.reset();
        ui.init();
        core.attachInput();

        fatal = missingModules();
        if (fatal.length) {
            scene = errorScene; sceneName = 'error';
        } else {
            art.init();
            roster.load();
            ring.init();
            // Past this point a tile allocation failure degrades instead of
            // throwing, because font.js allocates glyphs lazily inside draw().
            gfx.booted = true;
            setScene('title');
        }

        // Audio can only start from a gesture, so arm it on the first one and
        // never try again.
        var armed = false;
        function arm() {
            if (armed || !window.sound) return;
            armed = true;
            try {
                sound.init();
                sound.setVolume(ctx.musicVol, ctx.sfxVol);
                if (sceneName === 'title') sound.music('title');
            } catch (e) { /* silent: the game stays playable */ }
        }
        window.addEventListener('keydown', arm, { once: false });
        window.addEventListener('pointerdown', arm, { once: false });

        window.addEventListener('keydown', function (e) {
            if (e.code === 'Backquote') { debug = !debug; e.preventDefault(); }
            if (e.code === 'F2') { gfx.scanlines = !gfx.scanlines; e.preventDefault(); }
        });

        core.run(update, render);
    }

    function update() {
        if (window.sound && sound.update) sound.update(1 / 60);
        pal.update();
        if (scene && scene.update) scene.update(ctx);
    }

    function render() {
        gfx.beginFrame();
        if (scene && scene.draw) scene.draw(ctx);
        if (debug) drawDebug();
        gfx.present();
    }

    /* ------------------------------------------------------- debug handle */

    // A development surface, not a game feature. requestAnimationFrame is
    // throttled in a hidden tab, a backgrounded window and most automated
    // browsers, which makes the game impossible to drive from a test harness
    // and awkward to inspect while it runs. step() advances the same update
    // and render the loop does, by hand, so a frame can be produced on demand.
    window.slwf = {
        ctx: ctx,
        go: function (name) { setScene(name); },
        scene: function () { return sceneName; },
        step: function (n) {
            n = n || 1;
            for (var i = 0; i < n; i++) {
                core.updateInput();
                if (core.fx.freeze > 0) core.fx.freeze--; else update();
                core.updateFx();
                core.clock.frames++;
            }
            render();
            return sceneName;
        },
        // Hold a button for the next stepped frame, the way a pad would.
        hold: function (btn, down) {
            core.pads[0].held[core.BTN[btn]] = down ? 1 : 0;
            if (down) core.pads[0]._pressed[core.BTN[btn]] = 1;
        },
        tap: function (btn) {
            core.pads[0]._pressed[core.BTN[btn]] = 1;
            core.pads[0].held[core.BTN[btn]] = 1;
            window.slwf.step(1);
            core.pads[0].held[core.BTN[btn]] = 0;
        }
    };

    // Module scripts are deferred by the loader in index.html, so the DOM is
    // ready by the time this runs and there is nothing to wait for.
    boot();
})();
