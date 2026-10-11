/* =============================================================================
   SLWF - combat.js
   Everything that happens between two wrestlers: what a button press means,
   hit resolution, the grapple contest, holds, Irish whips, pins, submissions,
   injuries, weapons and blood.

   This file owns every PAIRED state. A tie-up, a hold, a pin and a submission
   each involve two wrestlers whose states must agree, so one place decides and
   writes both halves. wrestler.js will not touch them.
   ============================================================================= */
(function () {
    'use strict';

    var combat = {};
    var fp = core.fp, px = core.px;

    /* ------------------------------------------------------------- tuning */

    var C = combat.TUNE = {
        GRAPPLE_RANGE: 32,        // px between bodies to start a tie-up
        LUNGE_RANGE: 62,          // ...and the range you will step in from
        LUNGE_SPEED: 430,         // the step itself
        STRIKE_SLOP: 4,           // hitbox generosity, px

        TIE_FRAMES: 90,           // length of the tie-up contest
        TIE_GRACE: 4,             // frames before a press counts as a lock-in
        TIE_COOLDOWN: 45,         // lockout after a clean break
        TIE_SPEED: 5,             // cursor units per frame (of 256)
        TIE_ZONE_BASE: 30,        // half-width of the sweet spot
        TIE_ZONE_TECH: 4,         // ...plus this per point of technique
        TIE_ZONE_TIRED: 12,       // ...minus this much when exhausted
        HOLD_FRAMES: 100,         // how long you keep a won hold
        HOLD_ESCAPE_MASH: 26,     // mashes needed to shrug out of a hold

        WHIP_VEL: 760,

        PIN_COUNT_FRAMES: 60,     // one second per count
        // Kick-out chance PER FRAME, so these are small numbers and the
        // cubing matters more than the coefficient. Calibrated against the
        // three places that have to feel right:
        //   full health  ~0.060/frame -> out inside one count, near-certain
        //   half health  ~0.009/frame -> out before three, four times in five
        //   15% health   ~0.002/frame -> survives three counts 3 times in 4
        // The first build used 0.025 + 0.30*health^2 + 0.018*mash, which at
        // 35% health came to 0.28 a frame: every pin broke in four frames and
        // 1,724 covers in one match produced no falls at all.
        PIN_KICKOUT_BASE: 0.0015,
        PIN_KICKOUT_HURT: 0.058,
        PIN_MASH_BONUS: 0.004,    // and mashing is worth less as you fade
        PIN_COOLDOWN: 40,         // frames before the same cover can be retried

        SUB_DMG_PER_SEC: 26,
        SUB_INJ_PER_SEC: 55,
        SUB_ESCAPE_MASH: 40,
        SUB_ROPE_DIST: 16,        // px from a rope that forces a break
        SUB_MIN_FRAMES: 70,       // grace before a submission can be won

        BREAK_AT: 1000,           // injury at which a limb goes
        BREAK_CHANCE: 0.11,       // per second in a submission at max injury

        WEAPON_MULT: 240,         // 0.94x... weapons are about part damage
        DIVE_MISS_DMG: 55,
        DIVE_MISS_STUN: 70,

        TACK_DMG: 40,

        TABLE_SETUP_FRAMES: 26,   // how long setting one up leaves you open
        // You have to land ON it, not beside it. At 26 a wrestler roughly
        // 20px wide broke a table by falling over anywhere near it, and a
        // Tables match could end in three seconds.
        TABLE_RADIUS: 19,

        LADDER_H: 46,             // how high the top of a standing ladder is
        LADDER_CLIMB: 52,         // frames to go up it
        LADDER_FOOT: 22,          // px from the base you can start climbing
        PRIZE_Z: 78,              // how high the briefcase hangs
        GRAB_RANGE: 30,           // px from under it you can reach
        // Frames of holding on to pull it down. Long enough that the other
        // one has a chance to get there, short enough to be finishable: at
        // 160 nobody ever completed it because any hit at all resets you.
        GRAB_FRAMES: 95,
        TABLE_RUN_SPEED: 420,     // 8.8/frame: fast enough to go through one
        TABLE_DMG: 90,            // going through one, on top of the move
        TABLE_STUN: 150
    };

    /* ------------------------------------------------------------- hurtboxes */

    combat.hurtbox = function (w) {
        var down = wrestlers.isDown(w);
        var hw = fp(down ? 18 : 10);
        var hd = fp(9);
        var top = fp(down ? 12 : (w.char.style.build === 'super' ? 44 : 40));
        return {
            x0: w.x - hw, x1: w.x + hw,
            y0: w.y - hd, y1: w.y + hd,
            z0: w.z, z1: w.z + top
        };
    };

    function overlap(a, b) {
        return a.x1 > b.x0 && a.x0 < b.x1 &&
            a.y1 > b.y0 && a.y0 < b.y1 &&
            a.z1 > b.z0 && a.z0 < b.z1;
    }

    /* --------------------------------------------------- intent -> actions */

    // Direction key relative to the wrestler's facing: what the move tables
    // are written against. 'F' is toward where you are looking, so the same
    // table works facing either way without duplicate entries.
    function dirKey(w) {
        var i = w.in;
        if (!i.dx && !i.dy) return 'N';
        var d = core.dirFromVec(i.dx, i.dy);
        var v = (core.DIRVEC[w.dir] || core.DIRVEC[0]), u = core.DIRVEC[d];
        var dot = core.fmul(v[0], u[0]) + core.fmul(v[1], u[1]);
        if (dot > 150) return 'F';
        if (dot < -150) return 'B';
        // Perpendicular: up is away from the camera, down is toward it.
        return (i.dy < 0) ? 'U' : 'D';
    }
    combat.dirKey = dirKey;

    combat.nearestOpponent = function (w, list) {
        var best = null, bd = 1e9;
        for (var i = 0; i < list.length; i++) {
            var o = list[i];
            if (o === w || o.eliminated) continue;
            if (o.team === w.team && list.length > 2) continue;
            var d = ring.reach(w, o);
            if (d < bd) { bd = d; best = o; }
        }
        if (best) best._dist = bd;
        return best;
    };

    // The single place a button press becomes an action. Called for every
    // wrestler every frame, before wrestlers.update.
    // Step toward somebody you tried to grab from just outside range. The
    // buffered press stays alive while this runs, so the tie-up fires the
    // moment the gap closes -- which is the difference between "I pressed
    // grapple and nothing happened" and a wrestling game.
    combat.lunge = function (w, opp) {
        var d = ring.facing(w, opp);
        var v = core.DIRVEC[d] || core.DIRVEC[0];
        w.dir = d;
        w.vx = core.fmul(v[0], C.LUNGE_SPEED);
        w.vy = core.fmul(core.fmul(v[1], C.LUNGE_SPEED), 150);
        if (w.st === 'idle') wrestlers.setState(w, 'walking');
        wrestlers.setPose(w, 'walk');
    };

    combat.handleIntent = function (w, m) {
        var i = w.in;
        var opp = combat.nearestOpponent(w, m.wrestlers);
        w.opp = opp;

        // Buffered presses rather than this frame's raw edges. A button hit
        // during hitstun or the tail of a move is remembered and acted on the
        // instant the wrestler can move again. has() tests, consume() spends,
        // so a branch that cannot act leaves the press for the next one.
        var H = wrestlers.has, K = wrestlers.consume;
        var bA = H(w, 'A'), bB = H(w, 'B'), bC = H(w, 'C');
        var bX = H(w, 'X'), bY = H(w, 'Y'), bZ = H(w, 'Z');

        // ---- paired states read their own intent elsewhere
        if (w.st === 'grappling') return;
        if (w.st === 'held') { tryHoldEscape(w); return; }
        if (w.st === 'pinning' || w.st === 'pinned') return;
        if (w.st === 'applying' || w.st === 'submitted') return;

        // ---- holding somebody: direction + button picks the move
        if (w.hold && w.st === 'idle') {
            var set = w.holdSide === 'rear' ? 'grappleRear' : 'grappleFront';
            if (bZ && w.spirit >= 1000) {
                K(w, 'Z'); combat.flashFinisher(w);
                combat.executeHold(w, w.char.finisher); return;
            }
            // Grapple + run is the Irish whip, in both reference games.
            if (bC) { K(w, 'C'); combat.irishWhip(w); return; }
            if (bA || bB) {
                var id = moves.pick(w.char, set, dirKey(w), bA ? 'A' : 'B');
                if (id) { K(w, bA ? 'A' : 'B'); combat.executeHold(w, id); return; }
            }
            return;
        }

        // ---- at the top of the ladder: hold anything to pull the prize
        // down, or press down to climb off.
        if (w.st === 'onLadder') {
            var pz = m.prize;
            if (!pz || pz.taken) { combat.leaveLadder(w); return; }
            var inReach = Math.abs(px(pz.x - w.x)) <= C.GRAB_RANGE &&
                Math.abs(px(pz.y - w.y)) * 2 <= C.GRAB_RANGE;
            if (i.dy > 0) { combat.leaveLadder(w); return; }
            if (inReach && (i.Ah || i.Ch || bA || bC)) {
                w.grab = (w.grab || 0) + 1;
                wrestlers.setPose(w, 'turnbuckleTop');
                if (w.grab >= C.GRAB_FRAMES) {
                    w.grab = 0;
                    pz.taken = true;
                    m.onLadderWin(w);
                }
            } else if (w.grab > 0) {
                // Let go and the progress bleeds away, so it has to be done
                // in one go while nobody is knocking you off.
                w.grab -= 2;
                if (w.grab < 0) w.grab = 0;
            }
            return;
        }

        // ---- on the top rope
        if (w.st === 'onTurnbuckle') {
            if (bA || bB) {
                var aid = moves.pick(w.char, 'aerial', dirKey(w), bA ? 'A' : 'B');
                K(w, bA ? 'A' : 'B');
                combat.launchDive(w, aid);
            } else if (bC) {            // climb back down
                K(w, 'C');
                w.onTop = false;
                wrestlers.setState(w, 'idle');
                wrestlers.setPose(w, 'idle', true);
            }
            return;
        }

        if (!wrestlers.canAct(w)) return;

        // ---- running attacks
        if (w.st === 'running' && (bA || bB)) {
            var rid = moves.pick(w.char, 'run', 'N', bA ? 'A' : 'B');
            if (rid) { K(w, bA ? 'A' : 'B'); wrestlers.startMove(w, rid); return; }
        }

        // ---- finisher and signature
        if (bZ && opp) {
            if (opp._dist < 56) {
                K(w, 'Z');
                w.dir = ring.facing(w, opp);
                if (w.spirit >= 1000) {
                    combat.flashFinisher(w);
                    wrestlers.startMove(w, w.char.finisher);
                } else {
                    wrestlers.startMove(w, w.char.signature);
                }
                return;
            }
            if (opp._dist < C.LUNGE_RANGE + 20) combat.lunge(w, opp);
        }

        // ---- weapons
        if (bY) {
            if (w.weapon) { K(w, 'Y'); combat.swingWeapon(w); return; }
            if (combat.tryPickUp(w)) { K(w, 'Y'); return; }
        }

        // ---- taunt
        if (bX) {
            K(w, 'X');
            wrestlers.setState(w, 'taunting', 48);
            wrestlers.setPose(w, 'taunt', true);
            if (window.sound) sound.sfx('crowdPop');
            return;
        }

        // ---- climb a standing ladder. Checked before the turnbuckle, so
        // a ladder propped in the corner is a ladder and not a turnbuckle.
        if (bC) {
            var lad = combat.standingLadder();
            if (lad && w.surface === ring.RING) {
                var ldx = px(lad.x - w.x), ldy = px(lad.y - w.y);
                if (ldx * ldx + ldy * ldy * 4 <= C.LADDER_FOOT * C.LADDER_FOOT) {
                    K(w, 'C');
                    w.x = lad.x; w.y = lad.y;
                    w.vx = 0; w.vy = 0;
                    wrestlers.setState(w, 'climbLadder', C.LADDER_CLIMB);
                    wrestlers.setPose(w, 'climb', true);
                    if (window.sound) sound.sfx('metalClang');
                    return;
                }
            }
        }

        // ---- climb a turnbuckle / step to the apron
        if (bC && !i.dx && !i.dy) {
            var corner = ring.inCorner(w.x, w.y);
            if (corner && w.surface === ring.RING) {
                K(w, 'C');
                wrestlers.setState(w, 'climbing', 34);
                wrestlers.setPose(w, 'climb', true);
                w.x = corner.x; w.y = corner.y;
                w.z = ring.TOP_ROPE_Z;
                return;
            }
        }

        // ---- ground game
        if (opp && wrestlers.isDown(opp) && opp._dist < 36) {
            if (bB) { K(w, 'B'); combat.startPin(w, opp); return; }
            if (bA) {
                w.dir = ring.facing(w, opp);
                var gid = moves.pick(w.char, 'ground', dirKey(w), 'A');
                if (gid) { K(w, 'A'); wrestlers.startMove(w, gid); return; }
            }
            if (bC) {
                // A submission targets whatever is already hurt most, which is
                // how a leg injury turns into a broken leg.
                var part = worstLimb(opp);
                var sid = moves.pick(w.char, 'sub', partKey(part), 'C');
                if (sid) { K(w, 'C'); combat.startSubmission(w, opp, sid); return; }
            }
        }

        // ---- grapple attempt
        if (w.tieCd > 0) w.tieCd--;
        if (w.pinCd > 0) w.pinCd--;
        if (bB && opp && !wrestlers.isDown(opp) && !w.tieCd && !opp.tieCd) {
            if (opp._dist <= C.GRAPPLE_RANGE && wrestlers.canAct(opp)) {
                K(w, 'B');
                combat.startTieUp(w, opp);
                return;
            }
            // Just out of reach: step in and let the buffer finish the job.
            if (opp._dist <= C.LUNGE_RANGE) { combat.lunge(w, opp); return; }
        }

        // ---- strike
        if (bA) {
            // Square up FIRST, then read the direction. Computing the move
            // off the old facing and then turning means that holding toward
            // an opponent behind you selects the back attack and then throws
            // it forwards -- the direction you pressed has to mean the same
            // thing as the direction you are about to be looking.
            if (opp && opp._dist < 70) w.dir = ring.facing(w, opp);
            var sidk = moves.pick(w.char, 'strike', dirKey(w), 'A');
            if (sidk) { K(w, 'A'); wrestlers.startMove(w, sidk); return; }
        }
    };

    function partKey(part) {
        return part === 'leg' ? 'D' : part === 'arm' ? 'F' : part === 'back' ? 'B' : 'U';
    }

    function worstLimb(w) {
        var best = 'head', bv = -1;
        ['head', 'arm', 'leg', 'back'].forEach(function (k) {
            if (w.inj[k] > bv) { bv = w.inj[k]; best = k; }
        });
        return best;
    }

    /* ------------------------------------------------------- hit resolution */

    combat.resolveHits = function (m) {
        var list = m.wrestlers;
        for (var a = 0; a < list.length; a++) {
            var atk = list[a];
            if (atk.eliminated) continue;
            var hb = wrestlers.activeHitbox(atk);
            if (!hb) continue;
            for (var b = 0; b < list.length; b++) {
                var vic = list[b];
                if (vic === atk || vic.eliminated) continue;
                if (vic.team === atk.team && list.length > 2) continue;
                if (vic.invuln > 0) continue;
                // Somebody up a ladder is out of reach of every hitbox in
                // the table -- they are forty-six pixels up. Hitting the
                // ladder from its foot counts, which is how a climber gets
                // stopped and the only reason climbing is a risk.
                var onLadder = (vic.st === 'onLadder' || vic.st === 'climbLadder');
                if (onLadder) {
                    if (ring.reach(atk, vic) > C.LADDER_FOOT + 12) continue;
                } else if (!overlap(hb, combat.hurtbox(vic))) {
                    continue;
                }
                combat.land(atk, vic, atk.move, m);
                atk.moveHitDone = true;
                break;
            }
        }
        combat.updateWeapons(m);
        combat.updateParticles();
    };

    combat.land = function (atk, vic, mv, m) {
        var dmg = mv.dmg;
        // Power matters, and so does a weapon.
        dmg = (dmg * (70 + atk.char.stats.power * 6)) / 100 | 0;
        if (atk.weapon && mv.kind === 'weapon') {
            dmg = (dmg * (atk.weapon.mult || 256)) >> 8;
        }
        // A tired attacker hits softer. Nothing says so on screen; the player
        // feels the match slow down, which is the Fire Pro trick.
        if (wrestlers.isTired(atk)) dmg = (dmg * 160) >> 8;
        // Toughness.
        dmg = (dmg * 100) / (70 + vic.char.stats.stamina * 6) | 0;

        wrestlers.hurt(vic, dmg, mv.stun, mv.knock, mv.part, atk);
        wrestlers.credit(atk, dmg);

        core.shake(mv.shake || 1, mv.shake ? 8 : 4);
        if (mv.freeze) core.freeze(mv.freeze);
        if (window.sound) sound.sfx(mv.sfx || 'punch');
        if (window.art && mv.fx) combat.spawnFx(mv.fx, vic.x, vic.y, vic.z + fp(mv.part === 'leg' ? 10 : 30), vic.surface);

        // Anything that puts a body on the mat kicks up a ring of dust from
        // where it landed, and anything genuinely heavy blows the palette out
        // for two frames. A single white frame is the cheapest and most
        // era-correct way to say "that one hurt".
        if (mv.knock >= 2) {
            combat.spawnFx('shockRing', vic.x, vic.y, 0, vic.surface);
        }
        if (dmg >= 45) {
            pal.flash(5, [31, 31, 31], 150);
            if (m) m.crowdPop(mv.dmg >= 90 ? 40 : 24);
        }
        // A finisher connecting is the one moment worth slowing down for.
        if (mv.tags && mv.tags.indexOf('finisher') >= 0) {
            core.slowmo(54, 3);
            pal.flash(16, [31, 31, 26], 220);
        }

        if (vic.bleeding && core.chance(0.5)) combat.spawnBlood(vic, 3);
        if (vic.hp <= 0 && m) m.onKO(vic, atk);

        if (m) m.onBigMove(atk, vic, mv);
    };

    /* ------------------------------------------------------------ the tie-up */

    // A timing contest, not a mash. The cursor sweeps a bar; each wrestler has
    // a sweet spot whose width comes from technique, stamina and health, and
    // presses B to lock. Closest to the centre of their own zone wins. It is
    // readable, it is statty, and a worn-out wrestler visibly has less of the
    // bar to aim at.
    combat.tie = { active: false, a: null, b: null, cursor: 0, dirn: 1, timer: 0 };

    function zoneHalf(w) {
        var h = C.TIE_ZONE_BASE + C.TIE_ZONE_TECH * (w.char.stats.technique - 5);
        if (wrestlers.isTired(w)) h -= C.TIE_ZONE_TIRED;
        h = (h * (60 + 40 * w.hp / w.maxHp) / 100) | 0;
        return core.clamp(h, 8, 90);
    }

    combat.startTieUp = function (a, b) {
        var t = combat.tie;
        if (t.active) return;
        t.active = true; t.a = a; t.b = b;
        t.cursor = 0; t.dirn = 1; t.timer = C.TIE_FRAMES;
        // The press that STARTED the tie-up must not also be the press that
        // locks it in. Without this the initiator locks on frame one with the
        // cursor still at zero, scores nothing, and forfeits every tie-up it
        // ever starts -- which looks like two wrestlers shoving each other
        // for the whole match.
        t.grace = C.TIE_GRACE;
        a.in.B = 0; b.in.B = 0;
        // The two zones sit either side of centre, so the bar is symmetric and
        // neither wrestler is handed the easier half.
        t.ha = zoneHalf(a); t.hb = zoneHalf(b);
        t.ca = 128 - 40; t.cb = 128 + 40;
        t.lockA = -1; t.lockB = -1;
        a.dir = ring.facing(a, b); b.dir = ring.facing(b, a);
        // Stand them at a fixed separation so the tie-up always looks right.
        var mid = (a.x + b.x) >> 1, midY = (a.y + b.y) >> 1;
        var sep = fp(11);
        var left = a.x <= b.x ? a : b, rightW = a.x <= b.x ? b : a;
        left.x = mid - sep; rightW.x = mid + sep;
        left.y = midY; rightW.y = midY;
        a.partner = b; b.partner = a;
        wrestlers.setState(a, 'grappling'); wrestlers.setPose(a, 'tieup', true);
        wrestlers.setState(b, 'grappling'); wrestlers.setPose(b, 'tieup', true);
        if (window.sound) sound.sfx('woosh');
    };

    function scoreLock(cursor, centre, half) {
        var d = cursor - centre; if (d < 0) d = -d;
        if (d > half) return 0;
        return ((half - d) * 1000 / half) | 0;
    }

    combat.updateTieUp = function () {
        var t = combat.tie;
        if (!t.active) return;
        var a = t.a, b = t.b;
        if (a.eliminated || b.eliminated) { endTie(null, null); return; }

        t.cursor += t.dirn * C.TIE_SPEED;
        if (t.cursor >= 255) { t.cursor = 255; t.dirn = -1; }
        if (t.cursor <= 0) { t.cursor = 0; t.dirn = 1; }

        if (t.grace > 0) {
            t.grace--;
        } else {
            if (t.lockA < 0 && a.in.B) t.lockA = scoreLock(t.cursor, t.ca, t.ha);
            if (t.lockB < 0 && b.in.B) t.lockB = scoreLock(t.cursor, t.cb, t.hb);
        }

        t.timer--;
        var done = (t.lockA >= 0 && t.lockB >= 0) || t.timer <= 0;
        if (!done) return;

        var sa = t.lockA < 0 ? 0 : t.lockA;
        var sb = t.lockB < 0 ? 0 : t.lockB;
        // A wrestler who never pressed loses, and a double no-press breaks
        // clean rather than handing anybody a free hold.
        if (sa === 0 && sb === 0) { endTie(null, null); return; }
        if (sa === sb) { sa += a.char.stats.technique; sb += b.char.stats.technique; }
        if (sa >= sb) endTie(a, b); else endTie(b, a);
    };

    function endTie(winner, loser) {
        var t = combat.tie;
        t.active = false;
        var a = t.a, b = t.b;
        t.a = t.b = null;
        if (!winner) {
            [a, b].forEach(function (w) {
                if (!w) return;
                w.partner = null;
                wrestlers.setState(w, 'idle'); wrestlers.setPose(w, 'idle', true);
                // Shove them apart AND lock out another tie-up for a moment.
                // The push alone is not enough: both are still inside grapple
                // range on the next frame, so without the cooldown a clean
                // break is followed instantly by another tie-up and the match
                // never becomes a match.
                w.vx = (w === a ? -1 : 1) * 460;
                w.tieCd = C.TIE_COOLDOWN;
            });
            return;
        }
        combat.takeHold(winner, loser, 'front');
        if (window.sound) sound.sfx('crowdGasp');
    }

    /* ----------------------------------------------------------------- holds */

    combat.takeHold = function (holder, victim, side) {
        holder.hold = victim; holder.holdSide = side;
        victim.heldBy = holder;
        holder.partner = victim; victim.partner = holder;
        holder.holdTimer = C.HOLD_FRAMES;
        victim.escapeMash = 0;
        holder.dir = ring.facing(holder, victim);
        victim.dir = (holder.dir + 4) & 7;
        wrestlers.setState(holder, 'idle');
        wrestlers.setPose(holder, side === 'rear' ? 'holdRear' : 'holdFront', true);
        wrestlers.setState(victim, 'held');
        wrestlers.setPose(victim, side === 'rear' ? 'heldRear' : 'heldFront', true);
    };

    combat.breakHold = function (holder) {
        if (!holder || !holder.hold) return;
        var v = holder.hold;
        holder.hold = null; holder.holdSide = null; holder.partner = null;
        v.heldBy = null; v.partner = null;
        if (v.st === 'held') { wrestlers.setState(v, 'idle'); wrestlers.setPose(v, 'idle', true); }
        if (holder.st === 'idle') wrestlers.setPose(holder, 'idle', true);
    };

    function tryHoldEscape(w) {
        var h = w.heldBy;
        if (!h) { wrestlers.setState(w, 'idle'); return; }
        w.escapeMash += w.in.mash;
        var need = C.HOLD_ESCAPE_MASH - w.char.stats.technique;
        if (w.escapeMash >= need) {
            combat.breakHold(h);
            w.vx = core.sign(px(w.x - h.x)) * 260 || 260;
            if (window.sound) sound.sfx('woosh');
        }
    }

    combat.updateHolds = function (m) {
        var list = m.wrestlers;
        for (var i = 0; i < list.length; i++) {
            var w = list[i];
            if (!w.hold) continue;
            var v = w.hold;
            // Keep the victim glued to the holder, or the pair drifts apart
            // and the paired art stops lining up.
            var off = moves.HOLD_OFFSET || 13;
            var fwd = (core.DIRVEC[w.dir] || core.DIRVEC[0]);
            v.x = w.x + core.fmul(fwd[0], fp(off));
            v.y = w.y + core.fmul(fwd[1], fp(off >> 1));
            v.z = w.z;
            v.surface = w.surface;
            if (--w.holdTimer <= 0) combat.breakHold(w);
        }
    };

    combat.executeHold = function (holder, moveId) {
        // moves.get throws on an unknown id -- that is deliberate, it catches
        // typos in the tables loudly -- so anything that might legitimately
        // have no move has to ask first. moves.pick returns null for an
        // unfilled slot.
        if (!moveId || !moves.has(moveId)) return;
        var mv = moves.get(moveId);
        var victim = holder.hold;
        if (!mv || !victim) return;
        combat.pendingPair = { atk: holder, vic: victim, mv: mv };
        holder.hold = null; holder.holdSide = null;
        victim.heldBy = null;
        wrestlers.startMove(holder, moveId);
        // The victim is committed for the whole move: this is what makes a
        // suplex a suplex rather than two people near each other.
        wrestlers.setState(victim, 'receiving', moves.total(moveId));
        victim.move = mv; victim.moveId = moveId; victim.moveFrame = 0;
        wrestlers.setPose(victim, mv.victim || 'heldFront', true);
        victim.pairedWith = holder;
        holder.pairedWith = victim;
        holder.pairLanded = false;
    };

    // A paired move cannot miss, so its damage is applied at the impact frame
    // rather than through the hitbox pass.
    combat.updatePairedMoves = function (m) {
        var list = m.wrestlers;
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            if (!a.pairedWith || a.st !== 'executing' || a.pairLanded) continue;
            var v = a.pairedWith, mv = a.move;
            if (!mv || !v) { a.pairedWith = null; continue; }
            // Drag the victim along through the move.
            var fwd = core.DIRVEC[a.dir] || core.DIRVEC[0];
            v.x = a.x + core.fmul(fwd[0], fp(10));
            v.y = a.y + core.fmul(fwd[1], fp(5));
            v.surface = a.surface;
            if (a.moveFrame >= mv.startup) {
                a.pairLanded = true;
                combat.land(a, v, mv, m);
                v.pairedWith = null;
                a.pairedWith = null;
                if (mv.knock >= 2) {
                    // Put the victim on the mat where the move dropped them.
                    v.x = a.x + core.fmul(fwd[0], fp(14));
                    v.y = a.y + core.fmul(fwd[1], fp(7));
                }
            }
        }
    };

    /* ------------------------------------------------------------ Irish whip */

    combat.irishWhip = function (w) {
        var v = w.hold;
        if (!v) return;
        combat.breakHold(w);
        var i = w.in;
        // Whip in the direction held, or straight ahead.
        var d = (i.dx || i.dy) ? core.dirFromVec(i.dx, i.dy) : w.dir;
        var vec = core.DIRVEC[d];
        var power = C.WHIP_VEL + 22 * (w.char.stats.power - 5);
        v.vx = core.fmul(vec[0], power);
        v.vy = core.fmul(core.fmul(vec[1], power), 150);
        v.dir = d;
        wrestlers.setState(v, 'whipped', 40);
        wrestlers.setPose(v, 'run', true);
        wrestlers.startMove(w, 'irishWhip');
        if (window.sound) sound.sfx('whip');
    };

    /* ------------------------------------------------------------- the dive */

    combat.launchDive = function (w, moveId) {
        if (!moveId || !moves.has(moveId)) return;
        var mv = moves.get(moveId);
        if (!mv) return;
        w.onTop = false;
        var opp = w.opp;
        var d = opp ? ring.facing(w, opp) : w.dir;
        var vec = core.DIRVEC[d];
        w.dir = d;
        w.vx = core.fmul(vec[0], 330);
        w.vy = core.fmul(core.fmul(vec[1], 330), 150);
        w.vz = 180;
        w.move = mv; w.moveId = moveId; w.moveFrame = 0; w.moveHitDone = false;
        w.stam -= (mv.cost || 0) * wrestlers.TUNE.STAM_MOVE;
        wrestlers.setState(w, 'airborne');
        wrestlers.setPose(w, 'diveAir', true);
        if (window.sound) sound.sfx('woosh');
    };

    // Landing a dive: if the hitbox never connected, the mat does the damage.
    // A missed top-rope move has to hurt or there is no reason not to try one
    // every time.
    combat.resolveDiveLanding = function (w, impact) {
        var hit = w.moveHitDone;
        w.move = null; w.moveId = null;
        if (hit) {
            wrestlers.setState(w, 'landing', 16);
            wrestlers.setPose(w, 'diveLand', true);
        } else {
            wrestlers.hurt(w, C.DIVE_MISS_DMG, C.DIVE_MISS_STUN, 2, 'body', null);
            core.shake(3, 10);
            if (window.sound) { sound.sfx('bodyDrop'); sound.sfx('crowdGasp'); }
        }
    };

    /* ----------------------------------------------------------------- pins */

    combat.pin = { active: false, top: null, bottom: null, count: 0, timer: 0, mash: 0 };

    combat.startPin = function (top, bottom) {
        var p = combat.pin;
        if (p.active) return;
        // You cannot pin anybody in a ladder match. The briefcase is the
        // only finish, and allowing a pinfall meant the stipulation was
        // decided by an ordinary three-count every time.
        if (window.match && match.stip && match.stip.ladder) return;
        if (top.pinCd > 0) return;
        if (!wrestlers.isDown(bottom)) return;
        if (bottom.surface !== ring.RING) return;   // no pins on the floor
        p.active = true; p.top = top; p.bottom = bottom;
        p.count = 0; p.timer = C.PIN_COUNT_FRAMES; p.mash = 0;
        top.x = bottom.x; top.y = bottom.y + fp(4);
        top.partner = bottom; bottom.partner = top;
        wrestlers.setState(top, 'pinning'); wrestlers.setPose(top, 'pinTop', true);
        wrestlers.setState(bottom, 'pinned'); wrestlers.setPose(bottom, 'pinBottom', true);
    };

    combat.updatePin = function (m) {
        var p = combat.pin;
        if (!p.active) return;
        var top = p.top, bot = p.bottom;
        if (top.eliminated || bot.eliminated) { endPin(m, false); return; }

        p.mash += bot.in.mash;

        // Kick-out chance per frame. A healthy wrestler escapes almost at
        // once; a spent one needs the mash and some luck.
        // Mashing is multiplied by what is left of you: a spent wrestler
        // hammering the buttons is still a spent wrestler, and without this
        // the mash term swamps the health term exactly when the match is
        // supposed to be reaching its finish.
        var health = bot.hp / bot.maxHp;
        var chance = C.PIN_KICKOUT_BASE
            + C.PIN_KICKOUT_HURT * health * health * health
            + C.PIN_MASH_BONUS * Math.min(1, p.mash / 15) * health;
        if (bot.inj.back > 700) chance *= 0.7;
        if (core.rndf() < chance) {
            if (window.sound) sound.sfx('crowdPop');
            endPin(m, false);
            bot.downTimer = 20;
            return;
        }

        if (--p.timer <= 0) {
            p.count++;
            p.timer = C.PIN_COUNT_FRAMES;
            p.mash = 0;
            if (window.sound) sound.sfx('count');
            m.onRefCount(p.count);
            if (p.count === 2) m.crowdPop(34);
            if (p.count >= 3) { endPin(m, true); return; }
        }
    };

    function endPin(m, success) {
        var p = combat.pin;
        var top = p.top, bot = p.bottom;
        p.active = false; p.top = p.bottom = null;
        if (top) { top.partner = null; wrestlers.setState(top, 'idle'); wrestlers.setPose(top, 'idle', true); }
        if (bot) {
            bot.partner = null;
            if (success) { m.onFall(top, bot, 'pinfall'); }
            else {
                wrestlers.setState(bot, 'down', 0);
                wrestlers.setPose(bot, 'downBack', true);
                // A kicked-out cover cannot be retried immediately, or a CPU
                // that likes pinning never does anything else.
                if (top) top.pinCd = C.PIN_COOLDOWN;
            }
        }
        m.onRefCount(0);
    }

    /* ----------------------------------------------------------- submissions */

    combat.sub = {
        active: false, atk: null, vic: null, mv: null,
        frames: 0, mash: 0, part: 'arm'
    };

    combat.startSubmission = function (atk, vic, moveId) {
        var s = combat.sub;
        if (s.active) return;
        if (!moveId || !moves.has(moveId)) return;
        var mv = moves.get(moveId);
        if (!mv) return;
        s.active = true; s.atk = atk; s.vic = vic; s.mv = mv;
        s.frames = 0; s.mash = 0; s.part = mv.part || 'arm';
        atk.x = vic.x; atk.y = vic.y + fp(6);
        atk.partner = vic; vic.partner = atk;
        wrestlers.setState(atk, 'applying'); wrestlers.setPose(atk, mv.pose || 'subApply', true);
        wrestlers.setState(vic, 'submitted'); wrestlers.setPose(vic, mv.victim || 'subTaken', true);
        if (window.sound) sound.sfx('crowdGasp');
    };

    combat.updateSubmission = function (m) {
        var s = combat.sub;
        if (!s.active) return;
        var atk = s.atk, vic = s.vic;
        if (atk.eliminated || vic.eliminated) { endSub(m, null); return; }

        s.frames++;
        s.mash += vic.in.mash;

        // The victim can drag toward the ropes. Reaching them forces a break,
        // which is the only escape that does not depend on being strong enough.
        if (vic.in.dx || vic.in.dy) {
            vic.x += core.sign(vic.in.dx) * 42;
            vic.y += core.sign(vic.in.dy) * 22;
            atk.x = vic.x; atk.y = vic.y + fp(6);
        }
        if (!ring.cage && ring.ropeDistance(vic.x, vic.y) <= C.SUB_ROPE_DIST) {
            if (window.sound) sound.sfx('crowdPop');
            m.onRopeBreak(vic);
            endSub(m, null);
            return;
        }

        if (s.frames % 60 === 0) {
            var dmg = C.SUB_DMG_PER_SEC + atk.char.stats.technique * 2;
            vic.hp -= dmg; if (vic.hp < 0) vic.hp = 0;
            vic.inj[s.part] = Math.min(C.BREAK_AT,
                vic.inj[s.part] + C.SUB_INJ_PER_SEC + atk.char.stats.power);
            wrestlers.credit(atk, dmg);
            if (window.sound) sound.sfx('crowdGasp');

            // The Wrestling Empire moment: a limb that has taken enough can
            // simply go, and the match is over on the spot.
            if (vic.inj[s.part] >= C.BREAK_AT && core.chance(C.BREAK_CHANCE)) {
                combat.breakLimb(m, vic, s.part, atk);
                return;
            }
        }

        var need = C.SUB_ESCAPE_MASH + (atk.char.stats.technique - vic.char.stats.technique) * 2;
        if (s.mash >= need) { endSub(m, null); vic.downTimer = 30; return; }

        // Submitting: only once the grace period has passed and the body is
        // genuinely finished.
        if (s.frames > C.SUB_MIN_FRAMES && vic.hp <= 0) {
            endSub(m, atk);
            m.onFall(atk, vic, 'submission');
        }
    };

    function endSub(m, winner) {
        var s = combat.sub;
        var atk = s.atk, vic = s.vic;
        s.active = false; s.atk = s.vic = s.mv = null;
        if (atk) { atk.partner = null; wrestlers.setState(atk, 'idle'); wrestlers.setPose(atk, 'idle', true); }
        if (vic && !winner) {
            vic.partner = null;
            wrestlers.setState(vic, 'down', 0);
            wrestlers.setPose(vic, 'downFace', true);
        }
    }

    combat.breakLimb = function (m, vic, part, atk) {
        endSub(m, null);
        vic.broken = part;
        vic.hp = 0;
        wrestlers.setState(vic, 'down', 0);
        vic.downTimer = 100000;
        wrestlers.setPose(vic, 'downFace', true);
        core.freeze(22);
        core.shake(4, 24);
        pal.flash(10, [31, 0, 0], 200);
        if (window.sound) { sound.sfx('bone'); sound.sfx('crowdGasp'); }
        m.onInjuryStop(vic, part, atk);
    };

    /* --------------------------------------------------------------- weapons */

    // Weapons are found, not inventoried: they come from under the ring or
    // over the barricade. That is the Wrestling Empire texture, and it costs
    // one array.
    combat.weapons = [];

    combat.spawnWeapon = function (id, x, y) {
        var def = (window.art && art.WEAPONS && art.WEAPONS[id]) || {};
        var wp = {
            id: id, x: fp(x), y: fp(y), z: 0, vx: 0, vy: 0, vz: 0,
            state: 'ground', mult: def.mult || 256, dmg: def.dmg || 0,
            part: def.part || 'head', breakable: !!def.breakable,
            // Stood up rather than carried. Without copying this through
            // from the art metadata every table was picked up and swung like
            // a chair, and a Tables match could not be won.
            setup: !!def.setup, held: null,
            surface: ring.surfaceAt(fp(x), fp(y))
        };
        combat.weapons.push(wp);
        return wp;
    };

    combat.clearWeapons = function () { combat.weapons.length = 0; };

    combat.tryPickUp = function (w) {
        for (var i = 0; i < combat.weapons.length; i++) {
            var wp = combat.weapons[i];
            if (wp.state !== 'ground') continue;
            var dx = px(wp.x - w.x), dy = px(wp.y - w.y);
            if (dx * dx + dy * dy * 4 > 22 * 22) continue;

            // A table is not a thing you carry, it is a thing you stand up
            // and then put somebody through. Same button, different verb.
            if (wp.setup) {
                wp.state = 'setup';
                // Standing a LADDER up means dragging it under the prize
                // first -- that is the only place a ladder belongs in a
                // ladder match, and without it the thing could be climbed
                // but the briefcase was a hundred pixels away. A table is
                // set up where it lies.
                if (wp.id === 'ladder' && window.match && match.prize) {
                    wp.x = match.prize.x;
                    wp.y = match.prize.y;
                    wp.surface = ring.surfaceAt(wp.x, wp.y);
                }
                wrestlers.setState(w, 'executing', C.TABLE_SETUP_FRAMES);
                wrestlers.setPose(w, 'grabWeapon', true);
                w.move = null; w.moveId = null;
                if (window.sound) sound.sfx('woosh');
                if (window.match) match.say('TABLE SET UP');
                return true;
            }

            wp.state = 'held'; wp.held = w; w.weapon = wp;
            // There is no 'weaponPickup' entry in the move table, so this is
            // a pose and a timer rather than a move. It used to call
            // moves.get() on the id and take the whole frame down the first
            // time anybody actually picked something up.
            wrestlers.setState(w, 'executing', 20);
            wrestlers.setPose(w, 'grabWeapon', true);
            w.move = null; w.moveId = null;
            if (window.sound) sound.sfx('metalClang');
            return true;
        }
        return false;
    };

    combat.swingWeapon = function (w) {
        var id = (w.weapon && w.weapon.id === 'chair') ? 'chairShot' : 'weaponSwing';
        if (!moves.has(id)) id = 'weaponSwing';
        wrestlers.startMove(w, id);
    };

    combat.dropWeapon = function (w) {
        if (!w.weapon) return;
        var wp = w.weapon;
        wp.state = 'ground'; wp.held = null; w.weapon = null;
        wp.x = w.x; wp.y = w.y; wp.z = 0;
        wp.surface = w.surface;
    };

    combat.updateWeapons = function (m) {
        for (var i = combat.weapons.length - 1; i >= 0; i--) {
            var wp = combat.weapons[i];
            if (wp.state === 'held') {
                if (!wp.held || wp.held.eliminated || wrestlers.isDown(wp.held)) {
                    if (wp.held) combat.dropWeapon(wp.held);
                }
                continue;
            }
            if (wp.state === 'gone') { combat.weapons.splice(i, 1); continue; }
        }
    };

    combat.drawWeapons = function () {
        if (!window.art || !art.weaponRom) return;
        for (var i = 0; i < combat.weapons.length; i++) {
            var wp = combat.weapons[i];
            if (wp.state !== 'ground' && wp.state !== 'setup' &&
                wp.state !== 'broken') continue;
            var rom = art.weaponRom(wp.id, wp.state);
            if (!rom) continue;
            var fr = gfx.stream(rom);
            gfx.frame(ring.screenX(wp.x), ring.screenY(wp.y, wp.z, wp.surface), fr, pal.UI, false, false);
        }
    };

    /* -------------------------------------------------------------- ladders */

    combat.standingLadder = function () {
        for (var i = 0; i < combat.weapons.length; i++) {
            var wp = combat.weapons[i];
            if (wp.id === 'ladder' && wp.state === 'setup') return wp;
        }
        return null;
    };

    combat.leaveLadder = function (w) {
        w.grab = 0;
        w.z = 0;
        wrestlers.setState(w, 'idle');
        wrestlers.setPose(w, 'idle', true);
    };

    /* --------------------------------------------------------------- tables */

    /* The two ways through a table, and only these two:

         - a knockdown landing on it, which is a slam or a dive
         - running or being whipped into it at speed

       Walking into one does nothing, which is the whole distinction. Being
       whipped into a table is the ordinary way a wrestling match uses one,
       and without it the CPU could stand tables up all day and never win
       the stipulation. */
    combat.checkTableBreak = function (w, m) {
        if (w.z > fp(10)) return false;
        var dropped = (w.st === 'falling' || w.st === 'down');
        var fast = (w.st === 'whipped' || w.st === 'running') &&
            (core.abs(w.vx) + core.abs(w.vy) >= C.TABLE_RUN_SPEED);
        if (!dropped && !fast) return false;
        for (var i = 0; i < combat.weapons.length; i++) {
            var wp = combat.weapons[i];
            if (wp.state !== 'setup') continue;
            // Only things that break. A standing LADDER is also in the
            // 'setup' state, and without this test the first wrestler
            // knocked off it landed on it, "broke" it, and a ladder match
            // could never be won again.
            if (!wp.breakable) continue;
            var dx = px(wp.x - w.x), dy = px(wp.y - w.y);
            // Depth counts double, as everywhere else: the camera compresses
            // y, so a table that looks adjacent is further away than it reads.
            if (dx * dx + dy * dy * 4 > C.TABLE_RADIUS * C.TABLE_RADIUS) continue;
            combat.breakTable(wp, w, m);
            return true;
        }
        return false;
    };

    combat.breakTable = function (wp, victim, m) {
        if (!wp.breakable) return;
        wp.state = 'broken';
        wp.x = victim.x; wp.y = victim.y;
        victim.hp -= C.TABLE_DMG;
        if (victim.hp < 0) victim.hp = 0;
        victim.inj.back = Math.min(C.BREAK_AT, victim.inj.back + 220);
        victim.downTimer = Math.max(victim.downTimer, C.TABLE_STUN);
        // However they arrived, they are on the floor now.
        victim.vx = 0; victim.vy = 0; victim.vz = 0;
        if (victim.st !== 'down') {
            wrestlers.setState(victim, 'down', 0);
            wrestlers.setPose(victim, 'downBack', true);
        }

        core.freeze(16);
        core.shake(5, 22);
        pal.flash(8, [31, 31, 26], 190);
        combat.spawnFx('slamDust', victim.x, victim.y, 0, victim.surface);
        combat.spawnFx('impactL', victim.x, victim.y, fp(14), victim.surface);
        if (window.sound) { sound.sfx('tableBreak'); sound.sfx('crowdPop'); }

        if (m) {
            m.crowdPop(40);
            m.say('THROUGH THE TABLE');
            m.onTableBreak(victim, victim.lastHitBy || null);
        }
    };

    /* ------------------------------------------------------------- particles */

    // Blood, sweat and impact stars. Capped hard, because they compete with
    // wrestlers for the same 80 sprites.
    var MAXP = 28;
    combat.particles = [];

    function addParticle(p) {
        if (combat.particles.length >= MAXP) combat.particles.shift();
        combat.particles.push(p);
    }

    combat.spawnFx = function (name, x, y, z, surface) {
        addParticle({ kind: 'fx', name: name, x: x, y: y, z: z, surface: surface || 0, t: 0, life: 12, vx: 0, vy: 0, vz: 0 });
    };

    combat.spawnBlood = function (w, n) {
        for (var i = 0; i < n; i++) {
            addParticle({
                kind: 'blood', name: 'bloodDrop',
                x: w.x, y: w.y, z: w.z + fp(34), surface: w.surface,
                vx: (core.rnd(5) - 2) * 60, vy: (core.rnd(3) - 1) * 30, vz: core.rnd(260),
                t: 0, life: 40
            });
        }
    };

    combat.updateParticles = function () {
        for (var i = combat.particles.length - 1; i >= 0; i--) {
            var p = combat.particles[i];
            p.t++;
            if (p.kind === 'blood') {
                p.x += p.vx; p.y += p.vy; p.vz -= ring.GRAV; p.z += p.vz;
                if (p.z <= 0) {
                    // Blood stains the white canvas. The canvas is white for
                    // exactly this reason.
                    p.z = 0;
                    if (window.match && match.stainCanvas) match.stainCanvas(p.x, p.y);
                    p.life = 0;
                }
            }
            if (p.t >= p.life) combat.particles.splice(i, 1);
        }
    };

    combat.drawParticles = function () {
        if (!window.art || !art.fxRom) return;
        for (var i = 0; i < combat.particles.length; i++) {
            var p = combat.particles[i];
            var frames = (art.FX && art.FX[p.name] && art.FX[p.name].frames) || 1;
            var fi = Math.min(frames - 1, ((p.t * frames) / p.life) | 0);
            var rom = art.fxRom(p.name, fi);
            if (!rom) continue;
            var fr = gfx.stream(rom);
            gfx.frame(ring.screenX(p.x), ring.screenY(p.y, p.z, p.surface), fr, pal.UI, false, true);
        }
    };

    /* ------------------------------------------------------------- finishers */

    combat.flashFinisher = function (w) {
        pal.flash(14, [31, 31, 31], 256);
        core.freeze(10);
        core.shake(3, 14);
        if (window.sound) { sound.sfx('finisherHit'); sound.music('finisher'); }
    };

    /* ----------------------------------------------------------------- frame */

    combat.update = function (m) {
        combat.updateTieUp();
        combat.updateHolds(m);
        combat.updatePairedMoves(m);
        combat.updatePin(m);
        combat.updateSubmission(m);
    };

    combat.reset = function () {
        combat.tie.active = false; combat.tie.a = combat.tie.b = null;
        combat.pin.active = false; combat.pin.top = combat.pin.bottom = null;
        combat.sub.active = false; combat.sub.atk = combat.sub.vic = null;
        combat.particles.length = 0;
        combat.clearWeapons();
    };

    window.combat = combat;
})();
