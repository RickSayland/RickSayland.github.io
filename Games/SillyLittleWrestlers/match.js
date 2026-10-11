/* =============================================================================
   SLWF - match.js
   The match: stipulations, the referee, the counts, the win conditions and the
   clock. Owns the wrestler list and drives combat.

   `match.wrestlers` is an ARRAY, never p1/p2. Three-ways and rumbles then cost
   almost nothing beyond sharing the two wrestler palettes, which is the one
   authentic compromise the hardware forces.

   The clock counts UP from zero and is always on screen, because with health
   bars switched off it is the only way to know how deep into a match you are.
   That is exactly how Fire Pro communicates pacing, and it is why the bars can
   be optional at all.
   ============================================================================= */
(function () {
    'use strict';

    var match = {};
    var fp = core.fp, px = core.px;

    /* -------------------------------------------------------- stipulations */

    match.STIPS = [
        {
            id: 'exhibition', name: 'EXHIBITION', count: 3, slots: 2,
            desc: 'ONE ON ONE. CLEAN BREAK.',
            weapons: false, dq: true, cage: false, ringOut: 20
        },
        {
            id: 'hardcore', name: 'HARDCORE', count: 3, slots: 2,
            desc: 'NO DQ. WEAPONS UNDER THE RING.',
            weapons: true, dq: false, cage: false, ringOut: 0
        },
        {
            id: 'tables', name: 'TABLES', count: 3, slots: 2,
            desc: 'PUT THEM THROUGH IT.',
            weapons: true, tables: true, dq: false, cage: false, ringOut: 0
        },
        {
            id: 'ladder', name: 'LADDER', count: 3, slots: 2,
            desc: 'CLIMB AND TAKE IT DOWN.',
            weapons: true, ladder: true, dq: false, cage: false, ringOut: 0
        },
        {
            id: 'cage', name: 'STEEL CAGE', count: 3, slots: 2,
            desc: 'NO ESCAPE. NO ROPE BREAKS.',
            weapons: false, dq: false, cage: true, ringOut: 0
        },
        {
            id: 'threeway', name: '3-WAY DANCE', count: 3, slots: 3,
            desc: 'EVERY FALL COUNTS ANYWHERE.',
            weapons: false, dq: false, cage: false, ringOut: 0
        },
        {
            id: 'rumble', name: 'ROYAL RUMBLE', count: 3, slots: 4,
            desc: 'OVER THE TOP ROPE AND OUT.',
            weapons: true, dq: false, cage: false, ringOut: 0, overTheTop: true
        }
    ];

    match.stip = match.STIPS[0];
    match.wrestlers = [];
    match.phase = 'intro';
    match.clock = 0;
    match.result = null;
    match.showBars = false;
    match.refCount = 0;
    match.outCount = 0;
    match.lastMove = null;
    match.lastMoveTimer = 0;
    match.messages = [];
    // What hangs over the ring in a ladder match. null in every other.
    match.prize = null;

    /* ------------------------------------------------------------- referee */

    var ref = match.ref = {
        x: 0, y: 0, pose: 'stand', frame: 0, tick: 0, target: null, counting: 0
    };

    function refPoses() {
        return (window.art && art.REF_POSES) || { stand: 1, walk: 4, count: 3, check: 2, wave: 2 };
    }

    function updateRef() {
        var p = combat.pin, s = combat.sub;
        var tx, ty, want = 'stand';
        if (p.active && p.bottom) {
            tx = p.bottom.x + fp(26); ty = p.bottom.y - fp(10); want = 'count';
        } else if (s.active && s.vic) {
            tx = s.vic.x + fp(26); ty = s.vic.y - fp(10); want = 'check';
        } else if (match.wrestlers.length) {
            // Hover near the action without getting in the way.
            var sum = 0, n = 0;
            for (var i = 0; i < match.wrestlers.length; i++) {
                if (match.wrestlers[i].eliminated) continue;
                sum += match.wrestlers[i].x; n++;
            }
            tx = (n ? (sum / n) | 0 : 0) + fp(50);
            ty = -fp(50);
        } else { tx = 0; ty = -fp(50); }

        var dx = tx - ref.x, dy = ty - ref.y;
        var moving = (dx > fp(3) || dx < -fp(3) || dy > fp(3) || dy < -fp(3));
        if (moving) {
            ref.x += core.clamp(dx, -230, 230);
            ref.y += core.clamp(dy, -120, 120);
            if (want === 'stand') want = 'walk';
        }
        // Keep the referee legally inside the ring.
        var hx = ring.halfWidth(ref.y) - fp(10);
        ref.x = core.clamp(ref.x, -hx, hx);
        ref.y = core.clamp(ref.y, -fp(core.ARENA.RING_HY - 8), fp(core.ARENA.RING_HY - 8));

        if (ref.pose !== want) { ref.pose = want; ref.frame = 0; ref.tick = 0; }
        var n2 = refPoses()[ref.pose] || 1;
        if (++ref.tick >= 7) { ref.tick = 0; ref.frame = (ref.frame + 1) % n2; }
    }

    function drawRef() {
        if (!window.art || !art.refRom) return;
        var rom = art.refRom(ref.pose, ref.frame);
        if (!rom) return;
        var fr = gfx.stream(rom);
        gfx.frame(ring.screenX(ref.x), ring.screenY(ref.y, 0, ring.RING), fr, pal.ARENA, ref.x > 0, false);
    }

    /* ------------------------------------------------------------ crowd pop */

    // The crowd lights up on a big move. Three palette entries, pushed toward
    // warm and eased back, which is a free and entirely period-correct way to
    // make eighteen thousand pixels react to something.
    var popTimer = 0, POP_MAX = 40;

    match.crowdPop = function (n) {
        n = n || 24;
        if (n > popTimer) popTimer = Math.min(POP_MAX, n);
    };

    function updateCrowdPop() {
        if (popTimer <= 0) return;
        popTimer--;
        var t = (popTimer * 256 / POP_MAX) | 0;
        for (var i = 11; i <= 13; i++) {
            var base = pal.hex(pal.ARENA_COLORS[i]);
            if (popTimer === 0) pal.setRGB(pal.ARENA, i, base);
            else pal.setRGB(pal.ARENA, i, pal.mix(base, [31, 26, 18], t >> 1));
        }
    }

    /* ------------------------------------------------------- canvas staining */

    // Blood on the white canvas. A small pool of tiles is set aside; a stain
    // copies whatever that cell currently shows into a pool tile, spatters it,
    // and repoints the cell. This is a VRAM write, exactly what the hardware
    // would do, and it costs nothing per frame afterwards.
    var STAIN_POOL = 20;
    var stainBase = -1, stainNext = 0, stainCells = [];

    match.initStains = function () {
        if (stainBase < 0) stainBase = gfx.allocStatic(STAIN_POOL);
        stainNext = 0;
        // Put the borrowed cells back.
        for (var i = 0; i < stainCells.length; i++) {
            var c = stainCells[i];
            gfx.cell(gfx.planeA, c.col, c.row, c.tile, c.pal, c.flags);
        }
        stainCells.length = 0;
    };

    match.stainCanvas = function (wx, wy) {
        if (stainBase < 0) return;
        if (!ring.inRing(wx, wy)) return;
        // Plane space. screenX plus the camera is NOT plane space -- the
        // arena is laid out around art.ORIGIN_X, not around the middle of the
        // screen, so this was staining cells 352 pixels from where the blood
        // actually landed.
        var sxp = ring.planeX(wx);
        var syp = ring.screenY(wy, 0, ring.RING);
        var col = (sxp >> 3) & (gfx.PW - 1);
        var row = (syp >> 3) & (gfx.PH - 1);
        var word = gfx.planeA.map[row * gfx.PW + col];
        var src = word & 0x7FF;
        // Already a stain tile? Spatter it further instead of burning another.
        var dst;
        if (src >= stainBase && src < stainBase + STAIN_POOL) {
            dst = src;
        } else {
            dst = stainBase + (stainNext % STAIN_POOL);
            stainNext++;
            stainCells.push({ col: col, row: row, tile: src, pal: (word >>> 11) & 31, flags: word & (gfx.HF | gfx.VF | gfx.PRIO) });
            // Copy the canvas tile we are replacing so the weave survives.
            for (var k = 0; k < 64; k++) gfx.tiles[dst * 64 + k] = gfx.tiles[src * 64 + k];
        }
        // Spatter. Arena palette 15 is blood, 14 is its shadow.
        var ox = (sxp & 7), oy = (syp & 7);
        for (var i = 0; i < 5; i++) {
            var x = core.clamp(ox + core.rnd(5) - 2, 0, 7);
            var y = core.clamp(oy + core.rnd(5) - 2, 0, 7);
            gfx.tiles[dst * 64 + y * 8 + x] = core.chance(0.65) ? 15 : 14;
        }
        gfx.cell(gfx.planeA, col, row, dst, pal.ARENA, 0);
    };

    /* ---------------------------------------------------------------- setup */

    match.start = function (opts) {
        match.stip = opts.stip || match.STIPS[0];
        match.showBars = !!opts.showBars;
        ai.difficulty = opts.difficulty || 'normal';
        core.seed(opts.seed || (Date.now() & 0x7fffffff));

        ring.init();
        ring.setStipulation(match.stip);
        combat.reset();

        match.wrestlers.length = 0;
        var chars = opts.chars;
        var n = chars.length;
        for (var i = 0; i < n; i++) {
            // Every wrestler gets its own palette now. Six of them exist, so
            // even a rumble never makes two people wear the same colours.
            var palId = pal.wrestlerSlot(i);
            var w = wrestlers.create(chars[i], i, palId, {
                cpu: opts.cpu[i], padIndex: opts.pads[i], team: i
            });
            match.wrestlers.push(w);
            if (opts.cpu[i]) ai.attach(w, ai.difficulty);
        }

        match.takePositions();
        for (var k = 0; k < match.wrestlers.length; k++) {
            wrestlers.applyPalette(match.wrestlers[k]);
        }

        if (window.art) art.buildArena({ cage: match.stip.cage, ladder: match.stip.ladder });
        match.initStains();

        match.prize = match.stip.ladder
            ? { x: 0, y: 0, z: combat.TUNE.PRIZE_Z, taken: false }
            : null;

        if (match.stip.weapons) scatterWeapons();

        match.phase = 'intro';
        match.introTimer = 150;
        match.clock = 0;
        match.result = null;
        match.refCount = 0;
        match.outCount = 0;
        match.messages.length = 0;
        match.lastMove = null; match.lastMoveTimer = 0;
        ref.x = fp(60); ref.y = -fp(50); ref.pose = 'stand';

        if (window.sound) { sound.music('match'); sound.crowd(0.5); sound.sfx('bell'); }
    };

    // Put everybody in the ring on their marks. Called at the start of a
    // match and again when the bell rings, because the entrance walks the
    // player out to the tunnel and nothing else would ever bring them back --
    // the first build started every match with the player stranded on the
    // ramp and the CPU jogging into the ropes trying to reach them.
    match.takePositions = function () {
        var n = match.wrestlers.length;
        var spots = n === 2
            ? [[-70, 20], [70, 20]]
            : [[-120, 40], [120, 40], [-120, -40], [120, -40], [0, 60], [0, -60]];
        for (var j = 0; j < n; j++) {
            var s = spots[j % spots.length];
            wrestlers.reset(match.wrestlers[j], s[0], s[1], s[0] < 0 ? core.DIR.R : core.DIR.L);
        }
    };

    function scatterWeapons() {
        // Under the ring and over the barricade: where they come from matters
        // more than what they are.
        var pool = ['chair', 'pipe', 'hockeyStick', 'bottle', 'trashCan', 'kendoStick'];
        if (match.stip.tables) pool.push('table', 'table');
        if (match.stip.ladder) pool.push('ladder');
        if (match.stip.id === 'hardcore') pool.push('barbedBat', 'tacks');
        var nearY = core.ARENA.RING_HY + 40;
        for (var i = 0; i < pool.length; i++) {
            var side = (i & 1) ? 1 : -1;
            var x = side * (70 + core.rnd(150));
            var y = (i & 2) ? nearY : -(core.ARENA.RING_HY + 30);
            // In a Tables match the tables ARE the match, so they start on
            // the mat where the wrestling is. Leaving them under the apron
            // with everything else meant the CPU never found one and the
            // stipulation played as an ordinary singles match.
            // Tables start in the ring for a Tables match, but in the
            // CORNERS. Dropped in the middle they sat exactly where the bell
            // rings and the first knockdown of the match ended it.
            // The ladder in a ladder match starts on the mat, off to one
            // side: under the ring it would never be found, and under the
            // prize it would be a race to a button rather than a match.
            if (pool[i] === 'ladder' && match.stip.ladder) {
                x = side * 120;
                y = 30;
            }
            if (pool[i] === 'table' && match.stip.tables) {
                x = side * (core.ARENA.RING_HX - 58);
                y = ((i & 2) ? 1 : -1) * (core.ARENA.RING_HY - 42);
            }
            combat.spawnWeapon(pool[i], x, y);
        }
    }

    /* ---------------------------------------------------------- the callbacks */

    match.onBigMove = function (atk, vic, mv) {
        if (mv.dmg >= 25) {
            match.lastMove = mv.name;
            match.lastMoveTimer = 90;
            if (window.sound && mv.dmg >= 60) sound.sfx('crowdPop');
        }
    };

    match.onKO = function (vic, atk) {
        if (vic.hp <= 0 && !vic.koAt) vic.koAt = match.clock;
    };

    match.onRefCount = function (n) { match.refCount = n; };

    // Going through a table ends a Tables match on the spot, and is just a
    // very bad time anywhere else.
    match.onTableBreak = function (victim, breaker) {
        if (!match.stip.tables) return;
        var winner = breaker;
        if (!winner) {
            for (var i = 0; i < match.wrestlers.length; i++) {
                if (match.wrestlers[i] !== victim && !match.wrestlers[i].eliminated) {
                    winner = match.wrestlers[i];
                    break;
                }
            }
        }
        match.onFall(winner, victim, 'table');
    };

    // Pulling the briefcase down ends a ladder match. There is no other
    // way to win one.
    match.onLadderWin = function (w) {
        var loser = null;
        for (var i = 0; i < match.wrestlers.length; i++) {
            if (match.wrestlers[i] !== w) { loser = match.wrestlers[i]; break; }
        }
        pal.flash(20, [31, 31, 24], 240);
        core.shake(3, 20);
        match.crowdPop(40);
        if (window.sound) sound.sfx('crowdPop');
        match.say('GOT IT');
        match.finish(w, loser, 'ladder');
    };

    // Over the wall and down to the floor. A legal finish in a cage match
    // alongside the pinfall and the submission, which is why pins are not
    // blocked here the way they are in a ladder match.
    match.onCageEscape = function (w) {
        if (match.result) return;
        var loser = null;
        for (var i = 0; i < match.wrestlers.length; i++) {
            if (match.wrestlers[i] !== w) { loser = match.wrestlers[i]; break; }
        }
        // Put them on the floor outside, which is where they now are.
        var side = w.cageSide || 3;
        var hx = ring.halfWidth(w.y);
        if (side === 2) w.x = hx + core.fp(40);
        else if (side === 4) w.x = -hx - core.fp(40);
        else if (side === 1) w.y = -core.fp(core.ARENA.RING_HY + 40);
        else w.y = core.fp(core.ARENA.RING_HY + 40);
        w.z = 0;
        w.surface = ring.FLOOR;
        match.crowdPop(40);
        if (window.sound) sound.sfx('crowdPop');
        match.say('OVER THE TOP AND OUT');
        match.finish(w, loser, 'escape');
    };

    match.onRopeBreak = function (vic) {
        match.say('ROPE BREAK!');
    };

    match.onInjuryStop = function (vic, part, atk) {
        var names = { head: 'NECK', arm: 'ARM', leg: 'LEG', back: 'BACK' };
        match.say(vic.name + "'S " + (names[part] || 'LIMB') + ' IS BROKEN');
        match.finish(atk, vic, 'injury');
    };

    match.onFall = function (winner, loser, how) {
        // In a ladder match there is no count and no submission: whatever
        // just happened, the match carries on until somebody climbs.
        if (match.stip.ladder && how !== 'ladder') {
            if (loser) loser.downTimer = Math.max(loser.downTimer, 60);
            return;
        }
        // In a three-way or a rumble a fall eliminates rather than ends it.
        if (match.wrestlers.length > 2 && !match.stip.overTheTop) {
            loser.eliminated = true;
            match.say(loser.name + ' IS OUT');
            if (aliveCount() <= 1) match.finish(winner, loser, how);
            return;
        }
        match.finish(winner, loser, how);
    };

    match.say = function (text) {
        match.messages.push({ text: text, t: 150 });
        if (match.messages.length > 3) match.messages.shift();
    };

    function aliveCount() {
        var n = 0;
        for (var i = 0; i < match.wrestlers.length; i++) if (!match.wrestlers[i].eliminated) n++;
        return n;
    }

    match.finish = function (winner, loser, how) {
        if (match.result) return;
        match.result = {
            winner: winner, loser: loser, how: how,
            time: match.clock, clock: core.timeStr(match.clock)
        };
        match.phase = 'over';
        match.overTimer = 200;
        if (winner) {
            wrestlers.setState(winner, 'celebrating');
            wrestlers.setPose(winner, 'celebrate', true);
        }
        if (loser && how === 'injury') {
            wrestlers.setState(loser, 'dead');
            wrestlers.setPose(loser, 'dead', true);
        }
        if (window.sound) { sound.sfx('bell'); sound.music('victory'); sound.crowd(1); }
    };

    /* ----------------------------------------------------------------- update */

    match.update = function () {
        var list = match.wrestlers, i, w;

        if (match.phase === 'intro') {
            if (--match.introTimer <= 0) match.phase = 'wrestling';
            for (i = 0; i < list.length; i++) {
                wrestlers.clearIntent(list[i]);
                wrestlers.update(list[i]);
            }
            updateRef();
            ring.updateCamera(list);
            ring.applyScroll();
            return;
        }

        if (match.phase === 'wrestling') match.clock++;
        if (match.lastMoveTimer > 0) match.lastMoveTimer--;
        for (i = match.messages.length - 1; i >= 0; i--) {
            if (--match.messages[i].t <= 0) match.messages.splice(i, 1);
        }

        // 1. intent
        for (i = 0; i < list.length; i++) {
            w = list[i];
            if (w.eliminated) { wrestlers.clearIntent(w); continue; }
            if (match.phase !== 'wrestling') { wrestlers.clearIntent(w); continue; }
            if (w.cpu) ai.update(w, match);
            else wrestlers.readPad(w, core.pads[w.padIndex < 0 ? 0 : w.padIndex]);
            // Age the input buffer for both kinds of wrestler, immediately
            // after the intent is written and before combat reads it.
            wrestlers.bufferIntent(w);
        }

        // 2. what the intent means
        if (match.phase === 'wrestling') {
            for (i = 0; i < list.length; i++) {
                if (!list[i].eliminated) combat.handleIntent(list[i], match);
            }
        }

        // 3. advance bodies
        for (i = 0; i < list.length; i++) wrestlers.update(list[i]);

        // 4. paired states and hits
        combat.update(match);
        if (match.phase === 'wrestling') combat.resolveHits(match);

        // 5. match rules
        if (match.phase === 'wrestling') {
            checkOverTheTop();
            checkCountOut();
            checkKO();
        }

        updateRef();
        updateCrowdPop();
        if (window.art && art.updateRopes) art.updateRopes();
        ring.updateCamera(list);
        ring.applyScroll();

        if (match.phase === 'over') {
            if (--match.overTimer <= 0) match.done = true;
        }
    };

    // Rumble elimination: thrown over the top rope and onto the floor.
    function checkOverTheTop() {
        if (!match.stip.overTheTop) return;
        for (var i = 0; i < match.wrestlers.length; i++) {
            var w = match.wrestlers[i];
            if (w.eliminated) continue;
            if (w.surface === ring.FLOOR && w.z === 0 && wrestlers.isDown(w)) {
                w.eliminated = true;
                match.say(w.name + ' IS ELIMINATED');
                if (window.sound) sound.sfx('buzzer');
                if (aliveCount() <= 1) {
                    var last = null;
                    for (var j = 0; j < match.wrestlers.length; j++) {
                        if (!match.wrestlers[j].eliminated) last = match.wrestlers[j];
                    }
                    match.finish(last, w, 'elimination');
                }
            }
        }
    }

    // The ring-out count. Only runs when EVERYONE is outside, so brawling on
    // the floor is allowed and stalling is not.
    function checkCountOut() {
        var limit = match.stip.ringOut;
        if (!limit) { match.outCount = 0; return; }
        var allOut = true, any = false;
        for (var i = 0; i < match.wrestlers.length; i++) {
            var w = match.wrestlers[i];
            if (w.eliminated) continue;
            any = true;
            if (w.surface === ring.RING) allOut = false;
        }
        if (!any) return;
        if (allOut) {
            match.outCount++;
            if ((match.outCount % 60) === 0) {
                var n = (match.outCount / 60) | 0;
                if (window.sound) sound.sfx('count');
                if (n >= limit) { match.finish(null, null, 'countout'); }
            }
        } else if (match.outCount > 0) {
            match.outCount = 0;
        }
    }

    // A wrestler whose health is gone and who is not being pinned gets a
    // ten-count. Without it a match can stall forever against a CPU that will
    // not cover.
    function checkKO() {
        for (var i = 0; i < match.wrestlers.length; i++) {
            var w = match.wrestlers[i];
            if (w.eliminated || w.hp > 0) continue;
            if (!wrestlers.isDown(w)) continue;
            w.koFrames = (w.koFrames || 0) + 1;
            if ((w.koFrames % 60) === 0 && window.sound) sound.sfx('count');
            if (w.koFrames >= 600) {
                var other = null;
                for (var j = 0; j < match.wrestlers.length; j++) {
                    if (match.wrestlers[j] !== w && !match.wrestlers[j].eliminated) other = match.wrestlers[j];
                }
                match.onFall(other, w, 'knockout');
            }
        }
    }

    /* ------------------------------------------------------------------ draw */

    match.draw = function () {
        combat.drawWeapons();
        wrestlers.drawList(match.wrestlers);
        drawRef();
        combat.drawParticles();
        drawPrize();
    };

    // Drawn last and at high priority: it hangs above everything, including
    // the near ropes.
    function drawPrize() {
        var pz = match.prize;
        if (!pz || pz.taken || !window.art || !art.prizeRom) return;
        var rom = art.prizeRom((match.clock / 22) | 0);
        if (!rom) return;
        var fr = gfx.stream(rom);
        gfx.frame(ring.screenX(pz.x), ring.screenY(pz.y, core.fp(pz.z), ring.RING),
            fr, pal.UI, false, true);
    }

    match.isOver = function () { return !!match.done; };
    match.clearDone = function () { match.done = false; };

    window.match = match;
})();
