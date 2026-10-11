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

    // Match seconds before the CPU will go and set a table up.
    var TABLE_PATIENCE = 60 * 70;

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

        // A ladder match cannot be won on the mat, so a downed opponent is
        // not a cover opportunity -- it is a free run at the ladder, which
        // is the only thing that ends it.
        if (m && m.stip.ladder && opp && wrestlers.isDown(opp)) {
            a.state = combat.standingLadder() ? 'climbLadder' : 'getWeapon';
            return;
        }

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

        // Beat the count. Nothing else in the AI knows the ring exists as a
        // place you are supposed to be, so without this two CPUs who spill
        // outside simply brawl there until the referee counts them both out
        // -- which is a real finish, and a dreadful one to get every match.
        if (m && w.surface !== ring.RING && m.stip.ringOut &&
            m.outCount > 60 * 5) {
            a.state = 'returnRing';
            return;
        }

        /* The cage. A third way out alongside the pinfall and the
           submission, and the right moment for it is while the other one is
           on the mat -- going up with them on their feet just hands them a
           free shot at your legs. */
        if (m && m.stip.cage && opp && !combat.isClimbing(w)) {
            if (combat.isClimbing(opp)) {
                if (core.chance(0.8)) { a.state = 'stopClimb'; return; }
            } else if (wrestlers.isDown(opp) && opp.downTimer > 40 &&
                core.chance(0.45)) {
                a.state = 'climbCage';
                return;
            }
        }

        /* The stipulation's own weapon. Standing a table or a ladder up is
           most of the plan rather than an occasional flourish, so it gets its
           own chance and ignores whether a weapon is already carried.

           Not in the opening minute, though. Nobody goes to the gimmick
           before they have had a wrestling match, and when the CPU did, a
           Tables match was over inside twenty seconds. */
        var gid = gimmickId(m);
        if (gid && combat.weapons.length && m.clock > TABLE_PATIENCE) {
            var standing = 0, flat = 0;
            for (var wi = 0; wi < combat.weapons.length; wi++) {
                var cw = combat.weapons[wi];
                if (cw.id !== gid) continue;
                if (cw.state === 'setup') standing++;
                else if (cw.state === 'ground') flat++;
            }
            if (standing === 0 && flat > 0 && core.chance(gid === 'ladder' ? 0.3 : 0.14)) {
                a.state = 'getWeapon';
                return;
            }
            // A ladder match is won up the ladder and nowhere else, so once
            // one is standing the CPU either climbs it or stops whoever is.
            if (gid === 'ladder' && standing > 0) {
                if (opp && combat.isClimbing(opp)) {
                    // Not every time. Two CPUs that always intercept each
                    // other produce a stalemate where neither ever reaches
                    // the top and the match runs forever.
                    if (core.chance(0.7)) { a.state = 'stopClimb'; return; }
                }
                if (core.chance(0.75)) { a.state = 'climbLadder'; return; }
            }
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
        // Straddling the cage: nothing to do but not get pulled off.
        if (w.st === 'onCage' || w.st === 'climbCage') return;

        // At the top: hold on and pull. This is the whole of the CPU's
        // ladder-match endgame.
        if (w.st === 'onLadder') {
            i.Ch = 1; i.Ah = 1;
            return;
        }
        if (w.st === 'climbLadder') return;

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
            // A table is standing: whip them into it. This is the one piece
            // of stipulation-specific intent the CPU has, and without it it
            // could set tables up all match and never win on one.
            var tbl = (m && m.clock > TABLE_PATIENCE) ? standingTable() : null;
            if (tbl && core.chance(0.26)) {
                moveDir(i, core.dirFromVec(tbl.x - w.x, tbl.y - w.y));
                i.C = 1;
                return;
            }
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

            case 'climbCage': {
                // Head for whichever wall is closest and start climbing.
                if (w.surface !== ring.RING) { moveDir(i, core.dirFromVec(-w.x, -w.y)); break; }
                if (ring.atRopes(w.x, w.y)) { i.C = 1; break; }
                var hx = ring.halfWidth(w.y);
                var dLeft = px(w.x + hx), dRight = px(hx - w.x);
                var dNear = px(core.fp(core.ARENA.RING_HY) - w.y);
                var dFar = px(w.y + core.fp(core.ARENA.RING_HY));
                var best = Math.min(dLeft, dRight, dNear, dFar);
                if (best === dLeft) i.dx = -1;
                else if (best === dRight) i.dx = 1;
                else if (best === dNear) i.dy = 1;
                else i.dy = -1;
                break;
            }

            case 'climbLadder': {
                var lad = combat.standingLadder();
                if (!lad) { a.state = 'approach'; break; }
                // Both hands, or you are not climbing anything.
                if (w.weapon) { combat.dropWeapon(w); }
                var ldx = px(lad.x - w.x), ldy = px(lad.y - w.y);
                if (Math.abs(ldx) + Math.abs(ldy) > 12) {
                    moveDir(i, core.dirFromVec(lad.x - w.x, lad.y - w.y));
                } else {
                    i.C = 1;
                }
                break;
            }

            case 'stopClimb': {
                // Get to the foot of the ladder and swing. Anything at all
                // knocks a climber off.
                if (!opp) { a.state = 'approach'; break; }
                if (d > 22) { moveDir(i, toward); i.Ch = 1; break; }
                if (a.delay > 0) break;
                i.A = 1;
                break;
            }

            case 'returnRing':
                // Head for the middle of the ring. The rope-exit rule works
                // in both directions, so walking into the apron takes them
                // back over.
                moveDir(i, core.dirFromVec(-w.x, -w.y));
                i.Ch = 1;
                if (w.surface === ring.RING) a.state = 'approach';
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
                var wp = nearestWeapon(w, m);
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

    // The weapon a stipulation is actually about.
    function gimmickId(m) {
        if (!m) return null;
        if (m.stip.tables) return 'table';
        if (m.stip.ladder) return 'ladder';
        return null;
    }

    function standingTable() {
        for (var i = 0; i < combat.weapons.length; i++) {
            var wp = combat.weapons[i];
            if (wp.id === 'table' && wp.state === 'setup') return wp;
        }
        return null;
    }

    /* In a Tables match a table outranks anything else, however far away --
       otherwise the CPU picks up whichever chair happens to be nearest and
       never gets round to the one thing the stipulation is about.

       But only after TABLE_PATIENCE. The generic weapon urge fires at 8% a
       decision regardless of stipulation, and while THAT path still preferred
       tables the CPU went straight for one off the bell and the match was
       over in ten seconds -- the patience gate on the other path bought
       nothing at all. Before the gate opens, tables are invisible. */
    function nearestWeapon(w, m) {
        var gid = gimmickId(m);
        var wantGimmick = !!gid && m.clock > TABLE_PATIENCE;
        var hideGimmick = !!gid && !wantGimmick;
        var best = null, bd = 1e9, bestIsGimmick = false;
        for (var k = 0; k < combat.weapons.length; k++) {
            var wp = combat.weapons[k];
            if (wp.state !== 'ground') continue;
            var isTable = (wp.id === gid);
            if (isTable && hideGimmick) continue;
            if (wantGimmick && bestIsGimmick && !isTable) continue;
            var dx = px(wp.x - w.x), dy = px(wp.y - w.y);
            var dd = dx * dx + dy * dy;
            if ((wantGimmick && isTable && !bestIsGimmick) || dd < bd) {
                bd = dd; best = wp; bestIsGimmick = isTable;
            }
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
