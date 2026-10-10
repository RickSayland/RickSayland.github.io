/* =============================================================================
   SLWF - ui.js
   Title, menus, character select, VS, entrances, the in-match HUD, pause and
   results. Every screen is built from window-plane CELLS rather than sprites,
   which is why a full HUD with two name plates, two bars and a clock costs
   nothing out of the 80-sprite budget.

   One hardware fact shapes the character select completely: there are only TWO
   wrestler palettes. Nine portraits in colour is not possible, so the grid is
   name plates and the two CHOSEN wrestlers are shown full size in palettes 1
   and 2. That is what a Genesis game would have done, and it reads better than
   nine muddy portraits would have.
   ============================================================================= */
(function () {
    'use strict';

    var ui = {};
    var W = null;                    // the window plane, set in init
    var F = font;

    ui.BARW = 11;                    // health bar width in cells

    /* ------------------------------------------------------------ bar tiles */

    // Nine fill levels per colour. Three colours because a bar that changes
    // colour as it empties is the only readable way to show damage at this
    // resolution, and a cell can only carry one palette.
    var BAR = { green: null, yellow: null, red: null, back: 0, spirit: null };

    function buildBars() {
        function set(ink) {
            var base = -1, px = new Uint8Array(9 * 8 * 8);
            for (var f = 0; f <= 8; f++) {
                for (var y = 0; y < 8; y++) {
                    for (var x = 0; x < 8; x++) {
                        var v;
                        if (y === 0 || y === 7) v = 1;                 // frame
                        else if (x < f) v = (y === 1 ? ink + 0 : ink);  // fill
                        else v = 2;                                    // empty
                        px[y * (9 * 8) + f * 8 + x] = v;
                    }
                }
            }
            base = gfx.defineTiles(px, 9, 1);
            return base;
        }
        BAR.green = set(F.GREEN);
        BAR.yellow = set(F.YELLOW);
        BAR.red = set(F.RED);
        BAR.spirit = set(F.CYAN);
    }

    // Draw a value as `cells` cells of bar, left to right.
    function drawBar(col, row, cells, frac, palId) {
        var base = frac > 0.55 ? BAR.green : (frac > 0.25 ? BAR.yellow : BAR.red);
        var total = cells * 8;
        var filled = Math.round(frac * total);
        for (var c = 0; c < cells; c++) {
            var f = core.clamp(filled - c * 8, 0, 8);
            gfx.cell(W, col + c, row, base + f, palId === undefined ? pal.UI : palId, 0);
        }
    }

    function drawSpiritBar(col, row, cells, frac) {
        var total = cells * 8, filled = Math.round(frac * total);
        for (var c = 0; c < cells; c++) {
            var f = core.clamp(filled - c * 8, 0, 8);
            gfx.cell(W, col + c, row, BAR.spirit + f, pal.UI, 0);
        }
    }

    /* ------------------------------------------------------------- the shell */

    ui.init = function () {
        W = gfx.planeW;
        buildBars();
    };

    ui.clear = function () { gfx.clearPlane(W, 0); };

    // A full-screen backdrop on plane A, used by every menu so the ring is not
    // showing behind the title.
    ui.menuBackdrop = function (tone) {
        gfx.clearPlane(gfx.planeB, 0);
        gfx.clearPlane(gfx.planeA, 0);
        pal.setBackdrop(tone || '#000024');
    };

    /* ---------------------------------------------------------------- title */

    ui.title = {
        t: 0,
        enter: function () {
            this.t = 0;
            ui.menuBackdrop('#000024');
            ui.clear();
            if (window.sound) sound.music('title');
        },
        update: function (ctx) {
            this.t++;
            if (core.anyStart()) { ctx.go('menu'); }
        },
        draw: function () {
            ui.clear();
            if (window.art && art.logo) {
                art.logo(W, (40 - art.LOGO_W) >> 1, 3, pal.UI);
            } else {
                F.bigCentred(W, 4, 'SLWF', F.YELLOW);
            }
            F.textCentred(W, 11, 'SILLY LITTLE WRESTLING FEDERATION', F.CYAN);
            // Flashing PRESS START, because of course.
            if ((this.t >> 4) & 1) F.textCentred(W, 16, 'PRESS START', F.WHITE);
            else F.clear(W, 0, 16, 40, 1);
            F.textCentred(W, 20, 'ARROWS MOVE  Z STRIKE  X GRAPPLE  C RUN', F.GREY);
            F.textCentred(W, 22, 'V TAUNT   B WEAPON   N FINISHER', F.GREY);
            F.textRight(W, 39, 26, 'V' + core.GAME_VERSION, F.GREY);
        }
    };

    /* ----------------------------------------------------------- main menu */

    var MENU = [
        { id: 'fight', label: 'FIGHT' },
        { id: 'stip', label: 'MATCH TYPE' },
        { id: 'difficulty', label: 'DIFFICULTY' },
        { id: 'roster', label: 'ROSTER' },
        { id: 'options', label: 'OPTIONS' }
    ];

    ui.menu = {
        sel: 0,
        enter: function () {
            ui.menuBackdrop('#000024');
            ui.clear();
            if (window.sound) sound.music('title');
        },
        update: function (ctx) {
            var p = core.pads[0], B = core.BTN;
            if (p.just[B.D]) { this.sel = (this.sel + 1) % MENU.length; beep(); }
            if (p.just[B.U]) { this.sel = (this.sel + MENU.length - 1) % MENU.length; beep(); }
            var item = MENU[this.sel];
            if (p.just[B.L] || p.just[B.R]) {
                var d = p.just[B.R] ? 1 : -1;
                if (item.id === 'stip') {
                    ctx.stipIndex = (ctx.stipIndex + d + match.STIPS.length) % match.STIPS.length;
                    beep();
                } else if (item.id === 'difficulty') {
                    var levels = ['easy', 'normal', 'hard'];
                    var k = (levels.indexOf(ctx.difficulty) + d + 3) % 3;
                    ctx.difficulty = levels[k];
                    beep();
                }
            }
            if (p.just[B.A] || p.just[B.C] || p.just[B.START]) {
                select();
                if (item.id === 'fight') ctx.go('select');
                else if (item.id === 'roster') ctx.go('roster');
                else if (item.id === 'options') ctx.go('options');
            }
        },
        draw: function (ctx) {
            ui.clear();
            F.bigCentred(W, 1, 'SLWF', F.YELLOW);
            var stip = match.STIPS[ctx.stipIndex];
            for (var i = 0; i < MENU.length; i++) {
                var row = 8 + i * 2;
                var ink = (i === this.sel) ? F.YELLOW : F.WHITE;
                F.text(W, 8, row, (i === this.sel ? '→' : ' ') + ' ' + MENU[i].label, ink);
                if (MENU[i].id === 'stip') F.text(W, 24, row, stip.name, F.CYAN);
                if (MENU[i].id === 'difficulty') F.text(W, 24, row, ctx.difficulty.toUpperCase(), F.CYAN);
            }
            F.textCentred(W, 20, stip.desc, F.GREY);
            F.textCentred(W, 24, 'ENTER SELECT', F.GREY);
        }
    };

    /* --------------------------------------------------------- options menu */

    var OPTS = [
        { id: 'bars', label: 'HEALTH BARS' },
        { id: 'flicker', label: 'SPRITE FLICKER' },
        { id: 'scanlines', label: 'SCANLINES' },
        { id: 'music', label: 'MUSIC' },
        { id: 'sfx', label: 'SOUND FX' },
        { id: 'back', label: 'BACK' }
    ];

    ui.options = {
        sel: 0,
        enter: function () { ui.menuBackdrop('#001224'); ui.clear(); },
        update: function (ctx) {
            var p = core.pads[0], B = core.BTN;
            if (p.just[B.D]) { this.sel = (this.sel + 1) % OPTS.length; beep(); }
            if (p.just[B.U]) { this.sel = (this.sel + OPTS.length - 1) % OPTS.length; beep(); }
            var o = OPTS[this.sel], d = (p.just[B.R] ? 1 : 0) - (p.just[B.L] ? 1 : 0);
            if (d || p.just[B.A]) {
                switch (o.id) {
                    case 'bars': ctx.showBars = !ctx.showBars; break;
                    case 'flicker': gfx.flicker = !gfx.flicker; break;
                    case 'scanlines': gfx.scanlines = !gfx.scanlines; break;
                    case 'music':
                        ctx.musicVol = core.clamp(ctx.musicVol + (d || 1) * 0.2, 0, 1);
                        if (ctx.musicVol > 1) ctx.musicVol = 0;
                        if (window.sound) sound.setVolume(ctx.musicVol, ctx.sfxVol);
                        break;
                    case 'sfx':
                        ctx.sfxVol = core.clamp(ctx.sfxVol + (d || 1) * 0.2, 0, 1);
                        if (window.sound) sound.setVolume(ctx.musicVol, ctx.sfxVol);
                        break;
                    case 'back': ctx.go('menu'); return;
                }
                beep();
            }
            if (p.just[B.START]) ctx.go('menu');
        },
        draw: function (ctx) {
            ui.clear();
            F.textCentred(W, 2, 'OPTIONS', F.YELLOW);
            for (var i = 0; i < OPTS.length; i++) {
                var row = 7 + i * 2, ink = (i === this.sel) ? F.YELLOW : F.WHITE;
                F.text(W, 6, row, (i === this.sel ? '→' : ' ') + ' ' + OPTS[i].label, ink);
                var v = '';
                switch (OPTS[i].id) {
                    case 'bars': v = ctx.showBars ? 'ON' : 'OFF'; break;
                    case 'flicker': v = gfx.flicker ? 'ON' : 'OFF'; break;
                    case 'scanlines': v = gfx.scanlines ? 'ON' : 'OFF'; break;
                    case 'music': v = Math.round(ctx.musicVol * 5) + '/5'; break;
                    case 'sfx': v = Math.round(ctx.sfxVol * 5) + '/5'; break;
                }
                if (v) F.text(W, 28, row, v, F.CYAN);
            }
            F.textCentred(W, 21, 'BARS OFF IS THE INTENDED WAY TO PLAY', F.GREY);
            F.textCentred(W, 23, 'READ THE BODY AND WATCH THE CLOCK', F.GREY);
        }
    };

    /* ------------------------------------------------------ character select */

    ui.select = {
        cur: 0, p1: -1, p2: -1, t: 0,
        enter: function () {
            this.cur = 0; this.p1 = -1; this.p2 = -1; this.t = 0;
            ui.menuBackdrop('#120024');
            ui.clear();
            // Palettes 1 and 2 are all zeros until somebody fills them, and a
            // wrestler drawn in an unset palette is a black silhouette on a
            // dark backdrop -- which looks exactly like nothing rendering.
            this.refresh();
            if (window.sound) sound.music('select');
        },
        update: function (ctx) {
            this.t++;
            var p = core.pads[0], B = core.BTN;
            var n = roster.CHARS.length, cols = 3;
            if (p.just[B.R]) { this.cur = (this.cur + 1) % n; beep(); this.refresh(); }
            if (p.just[B.L]) { this.cur = (this.cur + n - 1) % n; beep(); this.refresh(); }
            if (p.just[B.D]) { this.cur = (this.cur + cols) % n; beep(); this.refresh(); }
            if (p.just[B.U]) { this.cur = (this.cur + n - cols) % n; beep(); this.refresh(); }
            if (p.just[B.A] || p.just[B.C] || p.just[B.START]) {
                select();
                if (this.p1 < 0) {
                    this.p1 = this.cur;
                    this.refresh();
                } else {
                    this.p2 = this.cur;
                    ctx.picks = [this.p1, this.p2];
                    // More than two slots: fill the rest at random.
                    var slots = match.STIPS[ctx.stipIndex].slots;
                    while (ctx.picks.length < slots) {
                        ctx.picks.push(core.rnd(roster.CHARS.length));
                    }
                    ctx.go('vs');
                }
            }
            if (p.just[B.B] && this.p1 >= 0) { this.p1 = -1; this.refresh(); beep(); }
        },
        refresh: function () {
            // Only two wrestler palettes exist, so apply them to whoever is
            // being previewed right now.
            var a = this.p1 >= 0 ? roster.CHARS[this.p1] : roster.CHARS[this.cur];
            roster.applyPalette(pal.P1, a);
            roster.applyPalette(pal.P2, roster.CHARS[this.cur]);
        },
        draw: function (ctx) {
            ui.clear();
            F.textCentred(W, 0, this.p1 < 0 ? 'SELECT YOUR WRESTLER' : 'SELECT YOUR OPPONENT', F.YELLOW);

            // The grid: name plates, three across.
            for (var i = 0; i < roster.CHARS.length; i++) {
                var c = roster.CHARS[i];
                var col = 1 + (i % 3) * 13, row = 3 + ((i / 3) | 0) * 2;
                var ink = F.WHITE;
                if (i === this.p1) ink = F.GREEN;
                else if (i === this.cur) ink = ((this.t >> 3) & 1) ? F.YELLOW : F.ORANGE;
                F.text(W, col, row, F.pad('', 12, ' '), ink);
                F.text(W, col, row, c.name, ink);
            }

            var sel = roster.CHARS[this.cur];
            F.textCentred(W, 11, sel.nick || '', F.CYAN);
            F.text(W, 2, 13, sel.wclass.toUpperCase(), F.WHITE);
            F.textRight(W, 38, 13, sel.heightCm + 'CM ' + sel.weightKg + 'KG', F.WHITE);

            // Stats as bars, which is the only place in the game bars are
            // unambiguously the right answer.
            var st = sel.stats, names = ['POW', 'SPD', 'STA', 'TEC'];
            var vals = [st.power, st.speed, st.stamina, st.technique];
            for (var s = 0; s < 4; s++) {
                F.text(W, 2, 15 + s, names[s], F.GREY);
                drawBar(6, 15 + s, 10, vals[s] / 10);
                F.text(W, 17, 15 + s, String(vals[s]), F.WHITE);
            }
            F.text(W, 21, 15, 'SIG', F.GREY);
            F.text(W, 25, 15, nameOf(sel.signature), F.CYAN);
            F.text(W, 21, 16, 'FIN', F.GREY);
            F.text(W, 25, 16, nameOf(sel.finisher), F.ORANGE);
            F.text(W, 21, 18, sel.taunt || '', F.YELLOW);

            F.textCentred(W, 26, this.p1 < 0 ? 'ENTER PICK' : 'ENTER PICK    X BACK', F.GREY);

            // The two previews, in the only two palettes there are. Anchored
            // at the feet on the bottom row and kept out of the centre
            // columns, because the window plane draws over sprites and the
            // hint line lives there.
            drawPreview(52, 216, this.p1 >= 0 ? roster.CHARS[this.p1] : sel, pal.P1, false);
            drawPreview(268, 216, sel, pal.P2, true);
        }
    };

    function nameOf(id) {
        var m = window.moves && moves.get ? moves.get(id) : null;
        return m ? m.name.toUpperCase().substring(0, 13) : '?';
    }

    function drawPreview(sx, sy, char, palId, flip, pose, frame) {
        if (!window.poser || !char) return;
        var rom = poser.rom(char.style, pose || 'idle', 'front', frame || 0);
        if (!rom) return;
        var fr = gfx.stream(rom);
        gfx.frame(sx, sy, fr, palId, flip, false);
    }

    /* ------------------------------------------------------------ VS screen */

    ui.vs = {
        t: 0,
        enter: function (ctx) {
            this.t = 0;
            ui.menuBackdrop('#240000');
            ui.clear();
            roster.applyPalette(pal.P1, roster.CHARS[ctx.picks[0]]);
            roster.applyPalette(pal.P2, roster.CHARS[ctx.picks[1]]);
            if (window.sound) { sound.music('vs'); sound.sfx('crowdPop'); }
        },
        update: function (ctx) {
            this.t++;
            if (this.t > 180 || core.anyStart()) ctx.go('entrance');
        },
        draw: function (ctx) {
            ui.clear();
            var a = roster.CHARS[ctx.picks[0]], b = roster.CHARS[ctx.picks[1]];
            var stip = match.STIPS[ctx.stipIndex];
            F.textCentred(W, 1, stip.name, F.YELLOW);
            F.bigText(W, 2, 4, a.name.substring(0, 8), F.WHITE);
            F.text(W, 2, 7, a.nick || '', F.CYAN);
            F.bigCentred(W, 11, 'VS', F.RED);
            var bn = b.name.substring(0, 8);
            F.bigText(W, 38 - bn.length * 2, 16, bn, F.WHITE);
            F.textRight(W, 38, 19, b.nick || '', F.CYAN);
            if (((this.t >> 4) & 1)) F.textCentred(W, 25, 'PRESS START', F.GREY);
            else F.clear(W, 0, 25, 40, 1);

            drawPreview(76, 190, a, pal.P1, false);
            drawPreview(244, 190, b, pal.P2, true);
        }
    };

    /* ------------------------------------------------------------- entrance */

    // Simple, like both reference games: the wrestler walks to the ring, their
    // name is on screen, and you can mess about on the way if you want to.
    ui.entrance = {
        t: 0, idx: 0,
        enter: function (ctx) {
            this.t = 0; this.idx = 0;
            ctx.beginMatch();
            var w = match.wrestlers[0];
            wrestlers.reset(w, -(core.ARENA.FLOOR_HX - 10), core.ARENA.RING_HY + 60, core.DIR.R);
            wrestlers.setState(w, 'entrance');
            if (window.sound) sound.music('entrance' + (roster.CHARS[ctx.picks[0]].music || 1));
        },
        update: function (ctx) {
            this.t++;
            var w = match.wrestlers[0];
            wrestlers.readPad(w, core.pads[0]);
            wrestlers.update(w);
            ring.updateCamera([w]);
            ring.applyScroll();
            if (this.t > 60 * 9 || core.pads[0].just[core.BTN.START] ||
                w.surface === ring.RING) {
                ctx.go('match');
            }
        },
        draw: function (ctx) {
            ui.clear();
            var c = roster.CHARS[ctx.picks[0]];
            F.bigText(W, 2, 2, c.name.substring(0, 9), F.YELLOW);
            F.text(W, 2, 5, c.nick || '', F.CYAN);
            F.text(W, 2, 7, c.heightCm + 'CM   ' + c.weightKg + 'KG', F.WHITE);
            if (this.t > 50 && this.t < 170) F.text(W, 2, 9, '"' + c.taunt + '"', F.ORANGE);
            else F.clear(W, 0, 9, 40, 1);
            F.textCentred(W, 26, 'START TO SKIP', F.GREY);
            match.draw();
        }
    };

    /* -------------------------------------------------------------- the HUD */

    ui.drawHud = function (ctx) {
        ui.clear();
        var list = match.wrestlers;
        var a = list[0], b = list[1];

        // Name plates. Always on: you must be able to tell who is who.
        if (a) F.text(W, 1, 1, a.name.substring(0, 12), a.eliminated ? F.GREY : F.WHITE);
        if (b) F.textRight(W, 39, 1, b.name.substring(0, 12), b.eliminated ? F.GREY : F.WHITE);

        if (ctx.showBars) {
            if (a) drawBar(1, 2, ui.BARW, a.hp / a.maxHp);
            if (b) drawBar(39 - ui.BARW, 2, ui.BARW, b.hp / b.maxHp);
        }

        // Spirit: three dots rather than a bar, so a full meter is a glance.
        if (a) drawSpirit(1, ctx.showBars ? 3 : 2, a);
        if (b) drawSpirit(35, ctx.showBars ? 3 : 2, b);

        // The clock. Counting up, always visible. With bars off this is the
        // only pacing information there is, which is the point.
        F.textCentred(W, 1, core.timeStr(match.clock), F.YELLOW);

        // Extra wrestlers in a three-way or rumble get a compact line.
        for (var i = 2; i < list.length; i++) {
            F.text(W, 14, 3 + (i - 2), list[i].name.substring(0, 10),
                list[i].eliminated ? F.GREY : F.CYAN);
        }

        // The referee's count, large and central.
        if (match.refCount > 0) {
            F.bigCentred(W, 8, String(match.refCount), F.RED);
        }
        if (match.outCount > 60) {
            F.textCentred(W, 6, 'COUNT ' + ((match.outCount / 60) | 0), F.RED);
        }

        // Move name flash.
        if (match.lastMoveTimer > 0 && match.lastMove) {
            F.textCentred(W, 22, match.lastMove.toUpperCase(), F.ORANGE);
        }

        // Announcements: rope breaks, eliminations, broken limbs.
        for (var k = 0; k < match.messages.length; k++) {
            F.textCentred(W, 18 + k, match.messages[k].text, F.WHITE);
        }

        // Injuries, shown only once they matter. A limp is the first warning;
        // this is the confirmation.
        hudInjury(a, 1, 25);
        hudInjury(b, 26, 25);

        if (combat.tie.active) drawTieBar();

        if (match.phase === 'intro') {
            F.bigCentred(W, 12, 'FIGHT', F.YELLOW);
        }
    };

    function hudInjury(w, col, row) {
        if (!w) return;
        var parts = ['head', 'arm', 'leg', 'back'], label = ['HEAD', 'ARM', 'LEG', 'BACK'];
        for (var i = 0; i < 4; i++) {
            if (w.inj[parts[i]] > 600) {
                F.text(W, col, row, label[i] + (w.inj[parts[i]] > 880 ? '!!' : '!'), F.RED);
                return;
            }
        }
        if (w.bleeding) F.text(W, col, row, 'BLEEDING', F.RED);
    }

    function drawSpirit(col, row, w) {
        var full = w.spirit >= 1000;
        var n = Math.min(3, (w.spirit / 334) | 0);
        var s = '';
        for (var i = 0; i < 3; i++) s += (i < n ? '*' : '-');
        F.text(W, col, row, s, full ? (((core.clock.frames >> 2) & 1) ? F.YELLOW : F.WHITE) : F.CYAN);
    }

    // The grapple contest. A bar with two zones and a sweeping cursor: the
    // cursor is a sprite because it has to move at pixel precision, everything
    // else is cells.
    function drawTieBar() {
        var t = combat.tie;
        // Row 24 puts the bar on the arena floor below the apron rather
        // than across the SLWF lettering, and below where the wrestlers
        // actually stand.
        var col = 8, row = 24, cells = 24;
        for (var c = 0; c < cells; c++) {
            // Shade the two sweet spots so each player can see their own.
            var v = (c * 256 / cells) | 0;
            var inA = Math.abs(v - t.ca) <= t.ha;
            var inB = Math.abs(v - t.cb) <= t.hb;
            var ink = inA && inB ? F.MAGENTA : (inA ? F.GREEN : (inB ? F.RED : F.GREY));
            gfx.cell(W, col + c, row, font.tile(inA || inB ? '#' : '-', ink || F.GREY), pal.UI, 0);
        }
        F.text(W, col - 1, row - 1, 'TIE UP', F.WHITE);
        var cx = (col * 8) + ((t.cursor * cells * 8) >> 8);
        var tile = font.tile('+', F.WHITE);
        gfx.sprite(cx - 4, row * 8 - 8, tile, pal.UI, 1, 1, 0);
    }

    /* ---------------------------------------------------------------- pause */

    ui.pause = {
        enter: function () { if (window.sound) { sound.sfx('pause'); sound.suspend(); } },
        exit: function () { if (window.sound) sound.resume(); },
        update: function (ctx) {
            var p = core.pads[0], B = core.BTN;
            if (p.just[B.START]) { ctx.go('match'); }
            if (p.just[B.B]) { ctx.go('title'); }
        },
        draw: function (ctx) {
            ui.drawHud(ctx);
            F.bigCentred(W, 10, 'PAUSED', F.YELLOW);
            F.textCentred(W, 14, 'START RESUME      X QUIT', F.WHITE);
            match.draw();
        }
    };

    /* -------------------------------------------------------------- results */

    var HOW = {
        pinfall: 'BY PINFALL', submission: 'BY SUBMISSION',
        injury: 'BY REFEREE STOPPAGE', countout: 'DOUBLE COUNT OUT',
        knockout: 'BY KNOCKOUT', elimination: 'LAST ONE STANDING'
    };

    ui.results = {
        t: 0,
        enter: function () {
            this.t = 0;
            // Clear the arena off both planes. Leaving the ring up puts white
            // canvas behind white text and the whole screen becomes a smear;
            // the winner still celebrates on top as a sprite.
            ui.menuBackdrop('#000012');
            ui.clear();
            if (window.sound) sound.music('victory');
        },
        update: function (ctx) {
            this.t++;
            if (this.t > 60 && core.anyStart()) ctx.go('menu');
        },
        draw: function (ctx) {
            ui.clear();
            var r = match.result;
            F.textCentred(W, 2, 'MATCH RESULT', F.GREY);
            if (r && r.winner) {
                F.bigCentred(W, 5, r.winner.name.substring(0, 9), F.YELLOW);
                F.textCentred(W, 9, 'WINS ' + (HOW[r.how] || ''), F.WHITE);
            } else {
                F.bigCentred(W, 5, 'NO CONTEST', F.RED);
                F.textCentred(W, 9, HOW[r ? r.how : ''] || '', F.WHITE);
            }
            F.textCentred(W, 12, 'TIME ' + (r ? r.clock : '00:00'), F.CYAN);

            if (r && r.loser && r.loser.broken) {
                F.textCentred(W, 14, r.loser.name + ' WILL NOT BE WRESTLING', F.RED);
                F.textCentred(W, 15, 'FOR A WHILE', F.RED);
            }

            // What actually happened, in numbers. Fire Pro would approve.
            var a = match.wrestlers[0], b = match.wrestlers[1];
            F.text(W, 2, 18, 'HEALTH', F.GREY);
            if (a) { F.text(W, 10, 18, a.name.substring(0, 8), F.WHITE); drawBar(20, 18, 8, a.hp / a.maxHp); }
            if (b) { F.text(W, 10, 19, b.name.substring(0, 8), F.WHITE); drawBar(20, 19, 8, b.hp / b.maxHp); }
            F.text(W, 2, 21, 'STAMINA', F.GREY);
            if (a) drawBar(20, 21, 8, a.stam / a.maxStam);
            if (b) drawBar(20, 22, 8, b.stam / b.maxStam);

            if (this.t > 60 && ((this.t >> 4) & 1)) F.textCentred(W, 25, 'PRESS START', F.GREY);
            else F.clear(W, 0, 25, 40, 1);

            // Only the winner, and parked where the stats are not. Drawing
            // the whole match leaves both wrestlers wherever the final fall
            // happened to put them, which here is on top of the text.
            if (r && r.winner) {
                drawPreview(282, 206, r.winner.char, r.winner.pal, true,
                    'celebrate', (this.t >> 3) & 3);
            }
        }
    };

    /* -------------------------------------------------------- roster editor */

    var RFIELDS = ['name', 'hair', 'mask', 'beard', 'build', 'skin', 'trunk', 'boot', 'accent',
        'power', 'speed', 'stamina', 'technique'];

    ui.roster = {
        idx: 0, field: 0, nameCur: 0,
        enter: function () { ui.menuBackdrop('#001200'); ui.clear(); },
        update: function (ctx) {
            var p = core.pads[0], B = core.BTN;
            if (p.just[B.START]) { roster.save(); ctx.go('menu'); return; }
            if (p.just[B.D]) { this.field = (this.field + 1) % RFIELDS.length; beep(); }
            if (p.just[B.U]) { this.field = (this.field + RFIELDS.length - 1) % RFIELDS.length; beep(); }
            if (p.just[B.C]) { this.idx = (this.idx + 1) % roster.CHARS.length; beep(); this.refresh(); }
            if (p.just[B.B]) { this.idx = (this.idx + roster.CHARS.length - 1) % roster.CHARS.length; beep(); this.refresh(); }
            if (p.just[B.Y]) {
                // Roll this one at random: the fastest way to a roster you like.
                var rnd = roster.random(core.rndState());
                rnd.name = roster.CHARS[this.idx].name;
                roster.CHARS[this.idx] = rnd;
                this.refresh(); select();
            }
            if (p.just[B.X]) { roster.reset(); this.refresh(); select(); }
            var d = (p.just[B.R] ? 1 : 0) - (p.just[B.L] ? 1 : 0);
            if (d) { this.edit(d); this.refresh(); beep(); }
        },
        edit: function (d) {
            var c = roster.CHARS[this.idx], f = RFIELDS[this.field];
            switch (f) {
                case 'name': cycleName(c, d, this); break;
                case 'hair': c.style.hair = (c.style.hair + d + 8) % 8; break;
                case 'mask': c.style.mask = (c.style.mask + d + 4) % 4; break;
                case 'beard': c.style.beard = (c.style.beard + d + 3) % 3; break;
                case 'build':
                    var bl = ['light', 'cruiser', 'heavy', 'super'];
                    c.style.build = bl[(bl.indexOf(c.style.build) + d + 4) % 4];
                    c.wclass = c.style.build === 'super' ? 'super' : c.style.build;
                    break;
                case 'skin': case 'trunk': case 'boot': case 'accent':
                    cycleColor(c, f, d); break;
                default:
                    c.stats[f] = core.clamp(c.stats[f] + d, 1, 10); break;
            }
        },
        refresh: function () {
            roster.applyPalette(pal.P1, roster.CHARS[this.idx]);
        },
        draw: function (ctx) {
            ui.clear();
            var c = roster.CHARS[this.idx];
            F.textCentred(W, 0, 'ROSTER EDITOR', F.YELLOW);
            F.text(W, 1, 2, (this.idx + 1) + '/' + roster.CHARS.length + '  ' + c.name, F.WHITE);
            for (var i = 0; i < RFIELDS.length; i++) {
                var row = 4 + i, f = RFIELDS[i];
                var ink = (i === this.field) ? F.YELLOW : F.WHITE;
                F.text(W, 1, row, (i === this.field ? '→' : ' ') + f.toUpperCase(), ink);
                F.text(W, 13, row, String(fieldValue(c, f)).toUpperCase(), F.CYAN);
            }
            F.text(W, 22, 4, 'B/C WRESTLER', F.GREY);
            F.text(W, 22, 6, 'L/R CHANGE', F.GREY);
            F.text(W, 22, 8, 'B RANDOMISE', F.GREY);
            F.text(W, 22, 10, 'V RESET ALL', F.GREY);
            F.text(W, 22, 12, 'START SAVE', F.GREY);
            drawPreview(230, 200, c, pal.P1, false);
        }
    };

    function fieldValue(c, f) {
        switch (f) {
            case 'name': return c.name;
            case 'hair': return c.style.hair;
            case 'mask': return c.style.mask;
            case 'beard': return c.style.beard;
            case 'build': return c.style.build;
            case 'skin': return c.colors.skin;
            case 'trunk': return c.colors.trunk;
            case 'boot': return c.colors.boot;
            case 'accent': return c.colors.accent;
            default: return c.stats[f];
        }
    }

    // Name editing without a keyboard: step the last character through the
    // charset, which is how every console of the era did it.
    function cycleName(c, d, st) {
        var cs = F.CHARSET;
        var n = c.name;
        if (d > 0 && n.length < 12) {
            c.name = n + 'A';
        } else if (d < 0 && n.length > 1) {
            c.name = n.substring(0, n.length - 1);
        }
        st.nameCur = c.name.length - 1;
    }

    var PRESETS = ['#ffdbb6', '#db9249', '#924924', '#492400', '#ffffff', '#db0000',
        '#0049db', '#00db49', '#ffdb00', '#db00db', '#00dbdb', '#242424',
        '#ff9200', '#6d6d92', '#b6dbff', '#920092'];

    function cycleColor(c, key, d) {
        var i = PRESETS.indexOf(c.colors[key]);
        if (i < 0) i = 0;
        c.colors[key] = PRESETS[(i + d + PRESETS.length) % PRESETS.length];
    }

    /* ------------------------------------------------------------- loading */

    ui.loading = {
        draw: function (done, total, note) {
            ui.clear();
            F.bigCentred(W, 10, 'SLWF', F.YELLOW);
            F.textCentred(W, 14, note || 'GENERATING WRESTLERS', F.WHITE);
            drawBar(10, 16, 20, total ? done / total : 0);
            F.textCentred(W, 18, Math.round(total ? done * 100 / total : 0) + '%', F.CYAN);
        }
    };

    /* ---------------------------------------------------------------- noise */

    function beep() { if (window.sound) sound.sfx('cursor'); }
    function select() { if (window.sound) sound.sfx('select'); }

    ui.MAGENTA = 12;
    F.MAGENTA = 12;

    window.ui = ui;
})();
