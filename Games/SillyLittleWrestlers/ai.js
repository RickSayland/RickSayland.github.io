/* =============================================================================
   SLWF - ai.js
   The CPU opponent. It writes the same `intent` block a pad writes, so it can
   only do things a player could do, and a movement bug cannot be a bug in just
   one of them.

   Difficulty is three numbers that matter and nothing else: how long it takes
   to react, how accurately it can hit its half of the grapple bar, and how
   hard it mashes out of a pin. Everything else about the behaviour is the same
   at every level, which is what keeps Easy feeling like a wrestler rather than
   a mannequin.
   ============================================================================= */
(function () {
    'use strict';

    var ai = {};
    var fp = core.fp, px = core.px;

    ai.LEVELS = {
        easy: {
            react: 24,        // frames of delay before acting on a decision
            tieAcc: 1.9,      // multiplier on its allowed timing error
            mash: 0.22,       // probability of a mash input per frame
            aggr: 0.45,       // how often it closes rather than circles
            risk: 0.12,       // top-rope attempts
            whip: 0.25,
            pinUrge: 0.5      // how readily it goes for a cover
        },
        normal: {
            react: 13, tieAcc: 1.0, mash: 0.45, aggr: 0.66,
            risk: 0.25, whip: 0.45, pinUrge: 0.8
        },
        hard: {
            react: 5, tieAcc: 0.45, mash: 0.8, aggr: 0.85,
            risk: 0.4, whip: 0.6, pinUrge: 1.0
        }
    };

    ai.difficulty = 'normal';

    ai.attach = function (w, level) {
        w.ai = {
            level: level || ai.difficulty,
            state: 'approach',
            think: 0,
            delay: 0,
            queued: null,
            tiePressed: false,
            circleDir: core.chance(0.5) ? 1 : -1,
            patience: 0
        };
    };

    function L(w) { return ai.LEVELS[w.ai.level] || ai.LEVELS.normal; }

    /* ------------------------------------------------------------- decisions */

    // One decision every 9-24 frames, the think timer every state machine of
    // this era used. Deciding every frame makes the CPU twitch; deciding too
    // rarely makes it wander into strikes.
    function rethink(w, opp, m) {
        var a = w.ai, p = L(w);
        var d = opp ? ring.reach(w, opp) : 999;
        var health = w.hp / w.maxHp;
        var oppHealth = opp ? opp.hp / opp.maxHp : 1;

        a.think = 9 + core.rnd(16);

        // Finish it if the window is open. A CPU that never covers is a CPU
        // that cannot win, and a CPU that always covers is exhausting.
        if (opp && wrestlers.isDown(opp) && d < 34) {
            if (oppHealth < 0.3 && core.chance(p.pinUrge)) { a.state = 'pin'; return; }
            if (oppHealth < 0.55 && core.chance(p.pinUrge * 0.5)) { a.state = 'submit'; return; }
            a.state = core.chance(0.65) ? 'stomp' : 'pin';
            return;
        }

        if (w.spirit >= 1000 && opp && oppHealth < 0.5) {
            a.state = d < 44 ? 'finisher' : 'approach';
            return;
        }

        // Catch your breath. The CPU respects stamina, which is what stops it
        // sprinting into every exchange and makes the back half of a match
        // slow down the way it should.
        if (w.stam < 220 && health > 0.25) { a.state = 'recover'; return; }

        if (w.weapon) { a.state = d < 38 ? 'weaponHit' : 'approach'; return; }

        if (m && m.stip.weapons && !w.weapon && core.chance(0.08) && combat.weapons.length) {
            a.state = 'getWeapon'; return;
        }

        if (d > 70) { a.state = core.chance(p.aggr) ? 'charge' : 'approach'; return; }
        if (d > 34) {
            a.state = core.chance(p.aggr) ? 'approach' : 'circle';
            return;
        }

        // In range: strike, tie up, or back off.
        var r = core.rndf();
        if (r < 0.40) a.state = 'strike';
        else if (r < 0.78) a.state = 'grapple';
        else if (r < 0.86 && core.chance(p.risk)) a.state = 'climb';
        else if (r < 0.93) a.state = 'circle';
        else a.state = 'taunt';
    }

    /* ------------------------------------------------------------- the frame */

    ai.update = function (w, m) {
        var i = w.in;
        wrestlers.clearIntent(w);
        if (!w.ai) ai.attach(w);
        var a = w.ai, p = L(w);
        var opp = combat.nearestOpponent(w, m.wrestlers);
        w.opp = opp;

        /* ---- paired states: these have their own, narrower problems ---- */

        if (w.st === 'grappling') {
            tieUpInput(w, p);
            return;
        }
        if (w.st === 'pinned' || w.st === 'submitted' || w.st === 'held' || w.st === 'down') {
            // Mash out. The probability is the difficulty.
            if (core.chance(p.mash)) i.mash = 1;
            // In a submission, crawl for the ropes -- the AI uses the same
            // escape a player does.
            if (w.st === 'submitted' && !ring.cage) {
                var hx = ring.halfWidth(w.y);
                i.dx = core.sign(px(w.x) >= 0 ? 1 : -1);
                if (px(hx - (w.x < 0 ? -w.x : w.x)) > 40) i.dy = w.y > 0 ? 1 : -1;
            }
            return;
        }
        if (w.st === 'pinning' || w.st === 'applying' || w.st === 'executing' ||
            w.st === 'receiving' || w.st === 'hurt' || w.st === 'stagger' ||
            w.st === 'falling' || w.st === 'gettingUp' || w.st === 'landing' ||
            w.st === 'climbing' || w.st === 'taunting' || w.st === 'dead') {
            return;
        }

        /* ---- holding somebody: pick a move out of the grapple table ---- */

        if (w.hold) {
            if (a.delay > 0) { a.delay--; return; }
            if (w.spirit >= 1000) { i.Z = 1; return; }
            if (core.chance(p.whip)) { i.C = 1; return; }
            // Bias toward forward and back, the two big slots.
            var r = core.rndf();
            if (r < 0.35) { i.dx = facingSign(w); i.A = 1; }
            else if (r < 0.6) { i.dx = -facingSign(w); i.A = 1; }
            else if (r < 0.8) { i.dy = -1; i.B = 1; }
            else { i.B = 1; }
            return;
        }

        /* ---- on the top rope ---- */

        if (w.st === 'onTurnbuckle') {
            if (a.delay > 0) { a.delay--; return; }
            if (opp && wrestlers.isDown(opp)) { i.A = 1; }
            else if (core.chance(0.3)) { i.B = 1; }
            else if (core.chance(0.1)) { i.C = 1; }   // think better of it
            return;
        }

        /* ---- normal play ---- */

        if (--a.think <= 0) { rethink(w, opp, m); a.delay = p.react; }
        if (a.delay > 0) { a.delay--; }

        if (!opp) { return; }
        var d = ring.reach(w, opp);
        var toward = core.dirFromVec(opp.x - w.x, opp.y - w.y);
        var tv = core.DIRVEC[toward];

        switch (a.state) {

            case 'approach':
                moveDir(i, toward);
                if (a.delay === 0 && d < 30) { a.state = 'grapple'; }
                break;

            case 'charge':
                moveDir(i, toward);
                i.Ch = 1;
                if (a.delay === 0 && d < 46) { i.A = 1; }
                break;

            case 'circle':
                // Strafe: perpendicular to the line between them.
                moveDir(i, (toward + 2 * a.circleDir + 8) & 7);
                if (core.chance(0.02)) a.circleDir = -a.circleDir;
                break;

            case 'recover':
                // Walk away slowly; standing still is what refills stamina, so
                // back off and stop rather than keep moving.
                if (d < 50) moveDir(i, (toward + 4) & 7);
                if (w.stam > w.maxStam * 0.7) a.state = 'approach';
                break;

            case 'strike':
                if (d > 28) { moveDir(i, toward); break; }
                if (a.delay > 0) break;
                i.A = 1;
                // Mix the direction so it is not always the same jab.
                var rr = core.rndf();
                if (rr < 0.3) i.dx = facingSign(w);
                else if (rr < 0.5) i.dy = -1;
                else if (rr < 0.6) i.dy = 1;
                a.state = 'approach';
                break;

            case 'grapple':
                if (d > combat.TUNE.GRAPPLE_RANGE) { moveDir(i, toward); break; }
                if (a.delay > 0) break;
                i.B = 1;
                a.state = 'approach';
                break;

            case 'finisher':
                if (d > 40) { moveDir(i, toward); break; }
                if (a.delay > 0) break;
                i.Z = 1;
                a.state = 'approach';
                break;

            case 'pin':
                if (d > 28) { moveDir(i, toward); break; }
                if (a.delay > 0) break;
                i.B = 1;
                a.state = 'approach';
                break;

            case 'submit':
                if (d > 28) { moveDir(i, toward); break; }
                if (a.delay > 0) break;
                i.C = 1;
                // Attack whatever is already hurt. The AI reads the injury
                // model, which is what makes it finish a leg it has worked on.
                i.dy = opp.inj.leg >= opp.inj.arm ? 1 : 0;
                i.dx = opp.inj.arm > opp.inj.leg ? facingSign(w) : 0;
                a.state = 'approach';
                break;

            case 'stomp':
                if (d > 26) { moveDir(i, toward); break; }
                if (a.delay > 0) break;
                i.A = 1;
                break;

            case 'climb':
                var corner = ring.nearestCorner(w.x, w.y);
                if (px(corner.dist) > 18) {
                    moveDir(i, core.dirFromVec(corner.x - w.x, corner.y - w.y));
                } else {
                    i.C = 1;
                }
                break;

            case 'getWeapon':
                var wp = nearestWeapon(w);
                if (!wp) { a.state = 'approach'; break; }
                var wd = Math.abs(px(wp.x - w.x)) + Math.abs(px(wp.y - w.y));
                if (wd > 18) moveDir(i, core.dirFromVec(wp.x - w.x, wp.y - w.y));
                else i.Y = 1;
                break;

            case 'weaponHit':
                if (d > 32) { moveDir(i, toward); break; }
                if (a.delay > 0) break;
                i.Y = 1;
                break;

            case 'taunt':
                if (core.chance(0.3)) i.X = 1;
                a.state = 'approach';
                break;
        }

        // Always square up to the opponent when not actively moving, so the
        // CPU does not throw strikes at nothing.
        if (!i.dx && !i.dy) { /* facing is handled by combat when it strikes */ }
    };

    function facingSign(w) {
        return core.DIRVEC[w.dir][0] >= 0 ? 1 : -1;
    }

    function moveDir(i, d) {
        if (d < 0) return;
        var v = core.DIRVEC[d];
        i.dx = v[0] > 60 ? 1 : (v[0] < -60 ? -1 : 0);
        i.dy = v[1] > 60 ? 1 : (v[1] < -60 ? -1 : 0);
    }

    function nearestWeapon(w) {
        var best = null, bd = 1e9;
        for (var k = 0; k < combat.weapons.length; k++) {
            var wp = combat.weapons[k];
            if (wp.state !== 'ground') continue;
            var dx = px(wp.x - w.x), dy = px(wp.y - w.y);
            var dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = wp; }
        }
        return best;
    }

    /* ------------------------------------------------------ the grapple bar */

    // The CPU plays the same timing bar the player does. It aims for the
    // centre of its own zone and presses when the cursor is inside an allowed
    // error window -- widened on Easy, narrowed on Hard. That is the whole of
    // "grapple win rate": no dice roll, the same mechanic played better or
    // worse.
    function tieUpInput(w, p) {
        var t = combat.tie;
        if (!t.active) return;
        var isA = (t.a === w);
        var mine = isA ? t.lockA : t.lockB;
        if (mine >= 0) return;                   // already locked in
        var centre = isA ? t.ca : t.cb;
        var half = isA ? t.ha : t.hb;
        var err = Math.max(3, (half * 0.55 * p.tieAcc) | 0);
        var d = t.cursor - centre; if (d < 0) d = -d;
        // Panic-press as the contest runs out rather than forfeit it.
        if (d <= err || t.timer < 8) w.in.B = 1;
    }

    window.ai = ai;
})();
