/* =============================================================================
   SLWF - wrestler.js
   The entity: one wrestler, its state machine, its animation, and how it draws.

   Two rules hold this file together:

   * Player and CPU go down the SAME path. Both fill an `intent` block and the
     state machine reads only that, so a bug in movement cannot be a bug in
     only one of them, and the AI cannot do anything a player could not.

   * PAIRED states belong to combat.js, not here. A tie-up, a hold, a pin and a
     submission each involve two wrestlers whose states must agree; letting
     either side change its own mind independently is where desyncs live. This
     file will enter and leave those states on request and otherwise leaves
     them alone.
   ============================================================================= */
(function () {
    'use strict';

    var wrestlers = {};
    var fp = core.fp, px = core.px;

    /* ------------------------------------------------------------- tuning */

    var T = wrestlers.TUNE = {
        WALK: 272,            // 1.06 px/frame at speed 5
        RUN: 600,             // 2.34 px/frame
        SPEED_PER_PT: 26,     // added per point of the speed stat
        // Depth moves slower than width, because the camera compresses y and
        // equal world speed would look faster going up the screen. But not
        // THIS much slower: at 150 the on-screen vertical rate was a quarter
        // of the horizontal one and walking up and down the ring felt like
        // wading.
        DEPTH_SCALE: 210,
        ACCEL: 96,
        STOP: 128,

        STAM_MAX: 1000,
        STAM_RUN: 4,          // per frame while running
        STAM_MOVE: 5,         // multiplier on a move's `cost`
        STAM_REGEN_STILL: 3,  // standing still
        STAM_REGEN_WALK: 1,
        STAM_TIRED: 320,      // below this the body shows it

        HP_MAX: 1000,
        SPIRIT_MAX: 1000,
        SPIRIT_TAKEN: 10,     // per 10 damage received
        SPIRIT_DEALT: 6,      // per 10 damage dealt

        DOWN_BASE: 42,        // frames down after a knockdown...
        DOWN_PER_DMG: 90,     // ...plus this scaled by how hurt you are
        GETUP_INVULN: 14,     // frames of invulnerability off the mat
        BUFFER: 8,            // frames an unusable button press is remembered
        BUFFER_B: 14,         // ...and longer for grapple, which also lunges
        DTAP: 15,             // double-tap window for a run
        ROPE_EXIT: 26,        // frames leaning on a rope before you go over it
        MASH_HELP: 3,         // frames shaved per button press while down

        KNOCK_VX: 420,
        KNOCK_VZ: 560,
        LAUNCH_VZ: 900,

        INJ_MAX: 1000,
        // Head damage that opens a cut. A typical six-minute match accumulates
        // about 300 to the head, so 520 meant nobody ever bled; 340 makes it
        // a thing that happens in the hard ones and not in every match.
        BLEED_AT: 340
    };

    // Frames each pose holds per animation frame. A run cycles fast, an idle
    // breathes slowly, and a hold is static because the attacker's timing bar
    // is what the player is reading in that moment.
    var RATE = wrestlers.POSE_RATE = {
        idle: 14, walk: 5, run: 3, limp: 9, block: 1,
        jabA: 1, jabB: 1, kick: 1, bigStrike: 1, runAttack: 1, chop: 1,
        tieup: 6, holdFront: 1, holdRear: 1, throwWhip: 1,
        suplex: 1, slam: 1, powerbomb: 1, ddt: 1,
        heldFront: 1, heldRear: 1, heldUp: 1, heldInverted: 1,
        hurtHi: 5, hurtLo: 5, stagger: 7, knockdown: 5,
        downFace: 1, downBack: 1, getUp: 6,
        pinTop: 10, pinBottom: 10, subApply: 8, subTaken: 8,
        climb: 7, turnbuckleTop: 1, diveAir: 6, diveLand: 1,
        taunt: 9, celebrate: 8, entrance: 6, dead: 1,
        grabWeapon: 6, weaponSwing: 1
    };

    /* ------------------------------------------------------------- creation */

    var nextId = 1;

    wrestlers.create = function (char, side, palId, opts) {
        opts = opts || {};
        var w = {
            id: nextId++,
            char: char,
            name: char.name,
            side: side,                 // 0 = starts on the left
            pal: palId,
            cpu: !!opts.cpu,
            padIndex: opts.padIndex === undefined ? -1 : opts.padIndex,
            team: opts.team === undefined ? side : opts.team,

            x: 0, y: 0, z: 0,
            vx: 0, vy: 0, vz: 0,
            sx: 0, sy: 0,
            dir: side ? core.DIR.L : core.DIR.R,
            surface: ring.RING,
            ropeMode: 'block',

            st: 'idle', stFrame: 0, stTimer: 0,
            pose: 'idle', poseFrame: 0, poseTick: 0,

            hp: T.HP_MAX, stam: T.STAM_MAX, spirit: 0,
            inj: { head: 0, arm: 0, leg: 0, back: 0 },
            bleeding: false,
            broken: null,               // the limb that ended the match

            move: null, moveId: null, moveFrame: 0, moveHitDone: false,
            hold: null,                 // the wrestler we are holding
            heldBy: null,               // the wrestler holding us
            holdSide: null,             // 'front' | 'rear'
            partner: null,              // paired state counterpart

            onTop: false, onApron: false,
            stun: 0, invuln: 0, downTimer: 0, mashCount: 0,
            rebound: 0, lastRope: 0, pushRope: 0, exiting: 0, grab: 0,
            escape: 0, cageSide: 0,
            tieCd: 0, pinCd: 0,
            weapon: null,
            out: false, eliminated: false, dead: false,

            // intent: the only thing the state machine reads. Player input and
            // the AI both write here.
            in: {
                dx: 0, dy: 0,
                A: 0, B: 0, C: 0, X: 0, Y: 0, Z: 0,
                Ah: 0, Bh: 0, Ch: 0, mash: 0
            },

            // Buffered presses. A button pushed during hitstun or the tail of
            // a move is remembered for a few frames and fires the moment the
            // wrestler can act again. Without this every input that lands a
            // frame early is simply discarded, which is the single biggest
            // reason a game like this feels unresponsive.
            buf: { A: 0, B: 0, C: 0, X: 0, Y: 0, Z: 0 },
            tapDir: -1, tapAge: 0, heldDir: -1, dashRun: 0, sweatTick: 0,

            // per-frame scratch used by combat.js
            hitbox: null, hurtbox: null,
            flash: 0, lastHitBy: null, lastHitFrame: -999,
            comboCount: 0
        };
        wrestlers.applyStats(w);
        return w;
    };

    wrestlers.applyStats = function (w) {
        var s = w.char.stats;
        w.walkSpeed = T.WALK + T.SPEED_PER_PT * (s.speed - 5);
        w.runSpeed = T.RUN + (T.SPEED_PER_PT * 2) * (s.speed - 5);
        w.maxStam = T.STAM_MAX + (s.stamina - 5) * 60;
        w.stam = w.maxStam;
        w.maxHp = T.HP_MAX + (s.stamina - 5) * 30;
        w.hp = w.maxHp;
    };

    wrestlers.reset = function (w, x, y, dir) {
        w.x = fp(x); w.y = fp(y); w.z = 0;
        w.vx = w.vy = w.vz = 0;
        w.dir = dir;
        w.surface = ring.surfaceAt(w.x, w.y);
        w.ropeMode = 'block';
        w.hp = w.maxHp; w.stam = w.maxStam; w.spirit = 0;
        w.inj.head = w.inj.arm = w.inj.leg = w.inj.back = 0;
        w.bleeding = false; w.broken = null; w.dead = false;
        w.st = 'idle'; w.stFrame = 0; w.stTimer = 0;
        w.move = null; w.moveId = null;
        w.hold = w.heldBy = w.partner = null; w.holdSide = null;
        w.onTop = w.onApron = false;
        w.stun = w.invuln = w.downTimer = w.mashCount = 0;
        w.rebound = 0; w.weapon = null; w.grab = 0; w.escape = 0;
        w.cageSide = 0;
        w.pushRope = 0; w.exiting = 0; w.tieCd = 0; w.pinCd = 0;
        w.buf.A = w.buf.B = w.buf.C = w.buf.X = w.buf.Y = w.buf.Z = 0;
        w.tapDir = -1; w.tapAge = 0; w.heldDir = -1; w.dashRun = 0; w.sweatTick = 0;
        w.out = false; w.eliminated = false;
        w.flash = 0; w.comboCount = 0;
        wrestlers.setPose(w, 'idle');
    };

    /* --------------------------------------------------------------- states */

    wrestlers.setState = function (w, st, timer) {
        w.st = st;
        w.stFrame = 0;
        w.stTimer = timer || 0;
        switch (st) {
            case 'idle': case 'walking': w.ropeMode = 'block'; break;
            case 'running': case 'whipped': w.ropeMode = 'bounce'; break;
            case 'airborne': case 'falling': w.ropeMode = 'through'; break;
        }
    };

    wrestlers.setPose = function (w, pose, resetFrame) {
        if (w.pose !== pose || resetFrame) {
            w.pose = pose; w.poseFrame = 0; w.poseTick = 0;
        }
    };

    wrestlers.canAct = function (w) {
        switch (w.st) {
            case 'idle': case 'walking': case 'running': return true;
            default: return false;
        }
    };

    wrestlers.isDown = function (w) {
        return w.st === 'down' || w.st === 'falling' || w.st === 'gettingUp' ||
            w.st === 'pinned' || w.st === 'dead';
    };

    wrestlers.isBusy = function (w) {
        switch (w.st) {
            case 'grappling': case 'held': case 'executing': case 'receiving':
            case 'pinning': case 'pinned': case 'applying': case 'submitted':
                return true;
            default: return false;
        }
    };

    wrestlers.isTired = function (w) { return w.stam < T.STAM_TIRED; };

    /* ---------------------------------------------------------- input buffer */

    var BUFKEYS = ['A', 'B', 'C', 'X', 'Y', 'Z'];

    // Called once per frame for every wrestler, after its intent is written
    // and before combat reads it. Player and CPU both go through here.
    wrestlers.bufferIntent = function (w) {
        var i = w.in, b = w.buf, k;
        for (var n = 0; n < BUFKEYS.length; n++) {
            k = BUFKEYS[n];
            if (i[k]) b[k] = (k === 'B') ? T.BUFFER_B : T.BUFFER;
            else if (b[k] > 0) b[k]--;
        }
        // Double-tap a direction to run, which is how both reference games do
        // it and how anyone actually plays. Holding C still works.
        if (w.tapAge > 0) w.tapAge--;
        var d = (i.dx || i.dy) ? core.dirFromVec(i.dx, i.dy) : -1;
        if (d >= 0 && d !== w.heldDir) {
            if (w.tapAge > 0 && w.tapDir === d) { w.dashRun = 1; w.tapAge = 0; }
            else { w.tapDir = d; w.tapAge = T.DTAP; }
        }
        if (d < 0) w.dashRun = 0;
        w.heldDir = d;
    };

    // Is a press pending? consume() spends it. Two calls so a branch can test
    // without eating the input when it turns out it cannot act on it.
    wrestlers.has = function (w, k) { return w.buf[k] > 0; };
    wrestlers.consume = function (w, k) { w.buf[k] = 0; };
    wrestlers.took = function (w, k) {
        if (w.buf[k] > 0) { w.buf[k] = 0; return true; }
        return false;
    };

    /* -------------------------------------------------------------- movement */

    function applyMove(w) {
        var i = w.in;
        var running = w.st === 'running';
        var base = running ? w.runSpeed : w.walkSpeed;
        // A tired body moves like one. This is the main channel through which
        // stamina is legible without a meter, which is the whole point.
        if (w.stam < T.STAM_TIRED) base = core.fmul(base, 160 + ((w.stam << 8) / T.STAM_TIRED / 2) | 0);
        if (w.inj.leg > 600) base = core.fmul(base, 180);

        var dx = i.dx, dy = i.dy;
        if (dx || dy) {
            // Diagonals must not be faster. DIRVEC already carries the 0.707.
            var d = core.dirFromVec(dx, dy);
            var v = core.DIRVEC[d];
            var tx = core.fmul(v[0], base);
            var ty = core.fmul(core.fmul(v[1], base), T.DEPTH_SCALE);
            w.vx = core.toward(w.vx, tx, T.ACCEL);
            w.vy = core.toward(w.vy, ty, T.ACCEL);
            // Facing follows movement unless we are locked onto somebody.
            if (!w.faceLock) w.dir = d;
        } else {
            w.vx = core.toward(w.vx, 0, T.STOP);
            w.vy = core.toward(w.vy, 0, T.STOP);
        }
    }

    /* ---------------------------------------------------------------- moves */

    // Begin a move from the table. The caller has already decided it is legal.
    wrestlers.startMove = function (w, id, opts) {
        var m = moves.get(id);
        if (!m) return false;
        opts = opts || {};
        w.move = m; w.moveId = id;
        w.moveFrame = 0; w.moveHitDone = false;
        w.stam -= (m.cost || 0) * T.STAM_MOVE;
        if (w.stam < 0) w.stam = 0;
        if (m.spirit) w.spirit -= m.spirit;
        if (w.spirit < 0) w.spirit = 0;
        wrestlers.setState(w, opts.state || 'executing', moves.total(id));
        wrestlers.setPose(w, m.pose, true);
        if (m.air) { w.ropeMode = 'through'; }
        if (window.sound && m.startSfx) sound.sfx(m.startSfx);
        return true;
    };

    // Phase of the current move: 0 startup, 1 active, 2 recovery.
    wrestlers.movePhase = function (w) {
        var m = w.move; if (!m) return -1;
        if (w.moveFrame < m.startup) return 0;
        if (w.moveFrame < m.startup + m.active) return 1;
        return 2;
    };

    // World-space hitbox while active, else null. The table stores it facing
    // +x relative to the feet anchor, so a left-facing wrestler mirrors it.
    wrestlers.activeHitbox = function (w) {
        var m = w.move;
        if (!m || !m.hit || wrestlers.movePhase(w) !== 1 || w.moveHitDone) return null;
        var v = core.DIRVEC[w.dir] || core.DIRVEC[0];
        var fwd = v[0] >= 0 ? 1 : -1;
        var hb = m.hit;
        var cx = w.x + fp(fwd * hb.x);
        var cy = w.y + fp(((hb.dy || 0)));
        return {
            x0: cx - fp(hb.w >> 1), x1: cx + fp(hb.w >> 1),
            y0: cy - fp(10), y1: cy + fp(10),
            z0: w.z + fp(-(hb.y) - (hb.h >> 1)), z1: w.z + fp(-(hb.y) + (hb.h >> 1))
        };
    };

    /* ----------------------------------------------------------------- damage */

    wrestlers.hurt = function (w, dmg, stun, knock, part, from) {
        if (w.invuln > 0) return false;
        w.hp -= dmg;
        if (w.hp < 0) w.hp = 0;
        w.spirit += ((dmg * T.SPIRIT_TAKEN) / 10) | 0;
        if (w.spirit > T.SPIRIT_MAX) w.spirit = T.SPIRIT_MAX;
        if (part && w.inj[part] !== undefined) {
            w.inj[part] += dmg;
            if (w.inj[part] > T.INJ_MAX) w.inj[part] = T.INJ_MAX;
        }
        if (w.inj.head > T.BLEED_AT) w.bleeding = true;
        w.flash = 4;
        w.lastHitBy = from || null;
        w.lastHitFrame = core.clock.frames;

        // Anything at all knocks you off a ladder, whatever the move's own
        // knockdown value. Being up there is the risk.
        if (combat.isClimbing(w)) {
            w.grab = 0; w.escape = 0;
            w.vx = (from ? (core.sign(px(w.x - from.x)) || 1) : 1) * T.KNOCK_VX;
            w.vy = 0;
            w.vz = 40;
            wrestlers.setState(w, 'falling');
            wrestlers.setPose(w, 'knockdown', true);
            if (window.match) {
                match.say(w.st === 'onCage' || w.st === 'climbCage'
                    ? 'OFF THE CAGE' : 'OFF THE LADDER');
            }
            if (window.sound) sound.sfx('crowdGasp');
            core.shake(3, 10);
            return true;
        }

        // A hit lands you out of whatever you were doing, and clears a hold.
        if (w.hold) combat.breakHold(w);
        if (w.heldBy) combat.breakHold(w.heldBy);

        if (knock >= 2) {
            var away = from ? core.sign(px(w.x - from.x)) || 1 : 1;
            w.vx = away * T.KNOCK_VX;
            w.vy = core.fmul(w.vy, 128);
            w.vz = knock >= 3 ? T.LAUNCH_VZ : T.KNOCK_VZ;
            wrestlers.setState(w, 'falling');
            wrestlers.setPose(w, 'knockdown', true);
            w.stun = 0;
        } else if (knock === 1) {
            wrestlers.setState(w, 'stagger', Math.max(stun, 12));
            wrestlers.setPose(w, 'stagger', true);
        } else {
            wrestlers.setState(w, 'hurt', stun);
            wrestlers.setPose(w, (part === 'leg' ? 'hurtLo' : 'hurtHi'), true);
        }
        return true;
    };

    wrestlers.credit = function (w, dmg) {
        w.spirit += ((dmg * T.SPIRIT_DEALT) / 10) | 0;
        if (w.spirit > T.SPIRIT_MAX) w.spirit = T.SPIRIT_MAX;
    };

    wrestlers.downFor = function (w) {
        var hurtFrac = 1 - (w.hp / w.maxHp);
        var t = T.DOWN_BASE + (T.DOWN_PER_DMG * hurtFrac) | 0;
        if (wrestlers.isTired(w)) t += 20;
        return t;
    };

    /* ----------------------------------------------------------------- update */

    wrestlers.update = function (w) {
        var i = w.in;
        w.stFrame++;
        if (w.invuln > 0) w.invuln--;
        if (w.flash > 0) w.flash--;
        if (w.rebound > 0) w.rebound--;

        // Stamina. Standing still refills it; this is the only recovery and it
        // is why a player who paces themselves wins the long matches.
        if (w.st === 'running') {
            w.stam -= T.STAM_RUN;
        } else if (w.st === 'idle') {
            w.stam += T.STAM_REGEN_STILL;
        } else if (w.st === 'walking') {
            w.stam += T.STAM_REGEN_WALK;
        }
        if (w.stam < 0) w.stam = 0;
        if (w.stam > w.maxStam) w.stam = w.maxStam;

        switch (w.st) {

            case 'idle':
            case 'walking':
                applyMove(w);
                if (i.dx || i.dy) {
                    if (w.st !== 'walking') wrestlers.setState(w, 'walking');
                    wrestlers.setPose(w, wrestlers.isTired(w) ? 'limp' : 'walk');
                    if ((i.Ch || w.dashRun) && w.stam > 40) {
                        wrestlers.setState(w, 'running');
                        wrestlers.setPose(w, 'run', true);
                        // A puff off the back foot as you take off.
                        if (window.combat) {
                            combat.spawnFx('dust', w.x, w.y, w.z, w.surface);
                        }
                    }
                } else {
                    if (w.st !== 'idle') wrestlers.setState(w, 'idle');
                    wrestlers.setPose(w, 'idle');
                }
                break;

            case 'running':
                applyMove(w);
                wrestlers.setPose(w, 'run');
                if ((!i.Ch && !w.dashRun) || w.stam <= 0) {
                    wrestlers.setState(w, 'walking');
                } else if (!i.dx && !i.dy && w.rebound === 0) {
                    wrestlers.setState(w, 'walking');
                }
                break;

            case 'whipped':
                // Carried by velocity; the ropes will turn us around.
                w.stTimer--;
                wrestlers.setPose(w, 'run');
                if (w.stTimer <= 0) wrestlers.setState(w, 'walking');
                break;

            case 'executing':
            case 'receiving':
                w.moveFrame++;
                // Lock in place for most moves; a running attack keeps its feet.
                if (w.move && w.move.kind === 'run') {
                    // keep current velocity
                } else {
                    w.vx = core.toward(w.vx, 0, T.STOP << 1);
                    w.vy = core.toward(w.vy, 0, T.STOP << 1);
                }
                advanceMovePose(w);
                // 'executing' is also used as a plain "busy for N frames"
                // state with no move at all -- picking a weapon up, standing
                // a table on its legs. moves.total(null) throws, so the state
                // timer is the fallback duration.
                var dur = w.moveId ? moves.total(w.moveId) : w.stTimer;
                if (w.moveFrame >= dur) {
                    w.move = null; w.moveId = null;
                    wrestlers.setState(w, 'idle');
                    wrestlers.setPose(w, 'idle', true);
                }
                break;

            case 'hurt':
                w.vx = core.toward(w.vx, 0, T.STOP);
                w.vy = core.toward(w.vy, 0, T.STOP);
                w.stTimer--;
                if (w.stTimer <= 0) { wrestlers.setState(w, 'idle'); wrestlers.setPose(w, 'idle', true); }
                break;

            case 'stagger':
                w.vx = core.toward(w.vx, 0, 48);
                w.stTimer--;
                if (w.stTimer <= 0) { wrestlers.setState(w, 'idle'); wrestlers.setPose(w, 'idle', true); }
                break;

            case 'falling':
                w.vx = core.fmul(w.vx, 248);
                wrestlers.setPose(w, 'knockdown');
                break;

            case 'down':
                w.vx = core.toward(w.vx, 0, 64);
                w.vy = core.toward(w.vy, 0, 64);
                // Mashing shortens the count on the mat. Everything about
                // being down is a negotiation with the clock.
                if (i.mash) { w.downTimer -= T.MASH_HELP * i.mash; w.mashCount += i.mash; }
                w.downTimer--;
                if (w.downTimer <= 0) {
                    wrestlers.setState(w, 'gettingUp', RATE.getUp * poseFrames('getUp'));
                    wrestlers.setPose(w, 'getUp', true);
                    w.invuln = T.GETUP_INVULN;
                }
                break;

            case 'gettingUp':
                w.stTimer--;
                if (w.stTimer <= 0) {
                    wrestlers.setState(w, 'idle');
                    wrestlers.setPose(w, 'idle', true);
                    w.invuln = T.GETUP_INVULN;
                }
                break;

            case 'climbCage':
                w.vx = w.vy = 0;
                w.stTimer--;
                var gt = 1 - (w.stTimer / combat.TUNE.CAGE_CLIMB);
                w.z = fp(Math.round(combat.TUNE.CAGE_H * core.clamp(gt, 0, 1)));
                wrestlers.setPose(w, 'climb');
                if (w.stTimer <= 0) {
                    w.z = fp(combat.TUNE.CAGE_H);
                    w.escape = 0;
                    wrestlers.setState(w, 'onCage');
                    wrestlers.setPose(w, 'turnbuckleTop', true);
                }
                break;

            case 'onCage':
                // Straddling the top. The drop is on a timer rather than a
                // button: the player's job up here is to not get pulled off,
                // which is the whole drama of a cage escape.
                w.vx = w.vy = w.vz = 0;
                w.z = fp(combat.TUNE.CAGE_H);
                w.escape = (w.escape || 0) + 1;
                if (w.escape >= combat.TUNE.CAGE_OVER) {
                    w.escape = 0;
                    if (window.match) match.onCageEscape(w);
                }
                break;

            case 'climbLadder':
                // Rising. z interpolates over the climb so the figure is
                // visibly partway up rather than teleporting to the top.
                w.vx = w.vy = 0;
                w.stTimer--;
                var ct = 1 - (w.stTimer / combat.TUNE.LADDER_CLIMB);
                w.z = fp(Math.round(combat.TUNE.LADDER_H * core.clamp(ct, 0, 1)));
                wrestlers.setPose(w, 'climb');
                if (w.stTimer <= 0) {
                    w.z = fp(combat.TUNE.LADDER_H);
                    w.grab = 0;
                    wrestlers.setState(w, 'onLadder');
                    wrestlers.setPose(w, 'turnbuckleTop', true);
                }
                break;

            case 'onLadder':
                // Held up there by the ladder, so gravity must not apply.
                w.vx = w.vy = w.vz = 0;
                w.z = fp(combat.TUNE.LADDER_H);
                break;

            case 'climbing':
                w.vx = w.vy = 0;
                w.stTimer--;
                if (w.stTimer <= 0) {
                    w.onTop = true;
                    wrestlers.setState(w, 'onTurnbuckle');
                    wrestlers.setPose(w, 'turnbuckleTop', true);
                }
                break;

            case 'onTurnbuckle':
                w.vx = w.vy = 0;
                // combat.js reads the intent here and launches the dive.
                break;

            case 'airborne':
                wrestlers.setPose(w, 'diveAir');
                if (w.move) w.moveFrame++;
                break;

            case 'landing':
                w.stTimer--;
                if (w.stTimer <= 0) { wrestlers.setState(w, 'idle'); wrestlers.setPose(w, 'idle', true); }
                break;

            case 'taunting':
                w.vx = w.vy = 0;
                w.stTimer--;
                wrestlers.setPose(w, 'taunt');
                // A taunt is a gamble: it builds spirit and costs you the time.
                w.spirit += 2;
                if (w.spirit > T.SPIRIT_MAX) w.spirit = T.SPIRIT_MAX;
                if (w.stTimer <= 0) { wrestlers.setState(w, 'idle'); wrestlers.setPose(w, 'idle', true); }
                break;

            case 'celebrating':
                w.vx = w.vy = 0;
                wrestlers.setPose(w, 'celebrate');
                break;

            case 'entrance':
                applyMove(w);
                wrestlers.setPose(w, (i.dx || i.dy) ? 'walk' : 'entrance');
                break;

            case 'dead':
                w.vx = w.vy = 0;
                wrestlers.setPose(w, 'dead');
                break;

            // grappling / held / pinning / pinned / applying / submitted are
            // driven by combat.js; it owns both halves of a paired state.
            default:
                w.vx = core.toward(w.vx, 0, T.STOP);
                w.vy = core.toward(w.vy, 0, T.STOP);
                break;
        }

        // Physics, then react to what we ran into.
        var ev = ring.step(w);

        if (ev.rope) {
            w.lastRope = ev.rope;
            // Lean on the ropes long enough and you go over them. Both
            // reference games work this way, and without it a wrestler can
            // never follow an opponent to the floor: a walker is blocked by
            // the ropes and a runner bounces off them, so a brawl that gets
            // outside can never be joined.
            // ev.rope fires whenever containment clamps, which includes
            // merely sliding along a rope. Going OVER one has to be something
            // you chose: the intent has to point outward through the rope you
            // are against, for the whole count.
            var pushing = false;
            switch (ev.rope) {
                case 1: pushing = i.dy < 0; break;   // far side
                case 2: pushing = i.dx > 0; break;   // right
                case 3: pushing = i.dy > 0; break;   // near side
                case 4: pushing = i.dx < 0; break;   // left
            }
            if (pushing && (w.st === 'walking' || w.st === 'idle') && !ring.cage) {
                if (++w.pushRope >= T.ROPE_EXIT) {
                    w.pushRope = 0;
                    w.ropeMode = 'through';
                    w.exiting = 22;
                }
            }
            // Make the rope take the weight. Near and far ropes displace
            // their own cells; the side ropes share a deduplicated diagonal
            // zone with the canvas edge and cannot, so they get the dust.
            if (window.art && art.flexRope) {
                var sp = core.abs(px(w.vx)) + core.abs(px(w.vy));
                var power = core.clamp(60 + sp * 55, 60, 256);
                if (ev.rope === 1 || ev.rope === 3) {
                    art.flexRope(ev.rope, ring.planeX(w.x), power);
                } else if (w.st === 'running' || w.st === 'whipped') {
                    combat.spawnFx('dust', w.x, w.y, w.z, w.surface);
                }
            }
            if (w.st === 'running' || w.st === 'whipped') {
                w.rebound = 18;
                core.shake(1, 4);
                if (window.sound) sound.sfx('ropeTwang');
                // A rebound hands the wrestler back their momentum, which is
                // what makes a whip into a lariat the bread-and-butter
                // sequence of the whole game.
                var d = core.dirFromVec(w.vx, w.vy);
                if (d >= 0) w.dir = d;
                if (w.st === 'whipped') w.stTimer = 26;
            }
        }

        // Running or being whipped into a standing table goes through it.
        if ((w.st === 'whipped' || w.st === 'running') &&
            window.combat && window.match) {
            combat.checkTableBreak(w, match);
        }

        if (!ev.rope) w.pushRope = 0;
        if (w.exiting > 0 && --w.exiting === 0 && w.ropeMode === 'through') {
            w.ropeMode = 'block';
        }

        if (ev.landed) {
            if (w.st === 'falling') {
                wrestlers.setState(w, 'down', 0);
                w.downTimer = wrestlers.downFor(w);
                w.mashCount = 0;
                // Anything that puts a body on the mat might be putting it
                // through a table instead.
                if (window.combat && window.match) combat.checkTableBreak(w, match);
                wrestlers.setPose(w, core.chance(0.5) ? 'downBack' : 'downFace', true);
                if (window.sound) sound.sfx('bodyDrop');
                if (window.combat) combat.spawnFx('slamDust', w.x, w.y, w.z, w.surface);
                core.shake(2, 6);
            } else if (w.st === 'airborne') {
                combat.resolveDiveLanding(w, ev.impact);
            }
        }

        // A spent wrestler visibly sweats. Stamina has no meter by design, so
        // every channel that leaks it -- the limp, the slow getup, this --
        // is doing real work.
        if (wrestlers.isTired(w) && !wrestlers.isDown(w) && !wrestlers.isBusy(w)) {
            if (++w.sweatTick >= 44) {
                w.sweatTick = 0;
                if (window.combat) {
                    combat.spawnFx('sweat', w.x + (core.rnd(9) - 4) * 256,
                        w.y, w.z + fp(34), w.surface);
                }
            }
        } else { w.sweatTick = 0; }

        advancePose(w);
    };

    function poseFrames(pose) {
        if (window.poser && poser.POSES && poser.POSES[pose]) return poser.POSES[pose];
        return 1;
    }

    function advancePose(w) {
        var rate = RATE[w.pose] || 6;
        // A tired or injured body animates slower; a fast wrestler's walk
        // cycles quicker. Animation speed is a readout, not decoration.
        if (w.pose === 'walk' || w.pose === 'run') {
            rate = rate - ((w.char.stats.speed - 5) >> 1);
            if (rate < 2) rate = 2;
        }
        w.poseTick++;
        if (w.poseTick >= rate) {
            w.poseTick = 0;
            var n = poseFrames(w.pose);
            w.poseFrame = (w.poseFrame + 1) % n;
        }
    }

    // A move's pose maps its frames onto startup/active/recovery rather than
    // cycling, so the windup, the hit and the recovery are all visible. This is
    // what makes a move readable enough to counter.
    function advanceMovePose(w) {
        var m = w.move; if (!m) return;
        var n = poseFrames(m.pose);
        if (n <= 1) { w.poseFrame = 0; return; }
        var total = moves.total(w.moveId);
        var f = w.moveFrame;
        var idx;
        if (n === 2) {
            idx = f < m.startup ? 0 : 1;
        } else if (n === 3) {
            idx = f < m.startup ? 0 : (f < m.startup + m.active ? 1 : 2);
        } else {
            // Spread the extra frames over the startup, where the anticipation
            // lives.
            var tail = n - 2;
            if (f < m.startup) {
                idx = Math.min(tail - 1, ((f * tail) / Math.max(1, m.startup)) | 0);
            } else if (f < m.startup + m.active) {
                idx = tail;
            } else {
                idx = n - 1;
            }
        }
        w.poseFrame = core.clamp(idx, 0, n - 1);
    }

    /* ------------------------------------------------------------- rendering */

    // Fallback art so the game is testable before poser.js lands, and so a
    // missing pose is a visible grey slab rather than a crash.
    var fbRom = null;
    function fallbackRom() {
        if (fbRom) return fbRom;
        var W = 48, H = 48, p = new Uint8Array(W * H);
        for (var y = 8; y < 48; y++) {
            for (var x = 18; x < 30; x++) {
                var edge = (x === 18 || x === 29 || y === 8 || y === 47);
                p[y * W + x] = edge ? 1 : (y < 18 ? 3 : (y < 32 ? 8 : 11));
            }
        }
        fbRom = gfx.romFrame(p, 6, 6, 24, 47);
        return fbRom;
    }

    wrestlers.rom = function (w) {
        if (window.poser && poser.rom) {
            var r = poser.rom(w.char.style, w.pose, viewOf(w).view, w.poseFrame);
            if (r) return r;
        }
        return fallbackRom();
    };

    function viewOf(w) {
        return core.DIRVIEW[w.dir < 0 ? 0 : w.dir];
    }

    // Drawn first, on the surface rather than at the body, so a wrestler in
    // the air has a shadow on the mat beneath him. With no sprite scaling the
    // size steps instead of shrinking, which at three sizes is enough to read
    // a dive off the top rope as height rather than as walking up the screen.
    wrestlers.drawShadow = function (w) {
        if (!window.art || !art.shadowRom) return;
        if (w.out && w.eliminated) return;
        var zp = px(w.z);
        var st = w.char.style.build;
        var big = (st === 'heavy' || st === 'super');
        var size = zp > 30 ? 0 : (zp > 12 ? 1 : (wrestlers.isDown(w) || big ? 2 : 1));
        var rom = art.shadowRom(w.surface, size);
        if (!rom) return;
        var fr = gfx.stream(rom);
        gfx.frame(ring.screenX(w.x), ring.screenY(w.y, 0, w.surface), fr,
            pal.UI, false, false);
    };

    wrestlers.draw = function (w) {
        if (w.out && w.eliminated) return;
        var v = viewOf(w);
        var rom = wrestlers.rom(w);
        var fr = gfx.stream(rom);
        ring.project(w);

        // A hit flashes the body by drawing it in the UI palette for a frame,
        // which on this hardware is the cheapest possible hit confirmation.
        var palId = (w.flash > 0 && (w.flash & 1)) ? pal.UI : w.pal;
        gfx.frame(w.sx, w.sy, fr, palId, v.flip, false);

        if (w.weapon && window.art && art.weaponRom) {
            var wr = art.weaponRom(w.weapon.id, 'held');
            if (wr) {
                var hf = gfx.stream(wr);
                gfx.frame(w.sx + (v.flip ? -12 : 12), w.sy - 24, hf, pal.UI, v.flip, false);
            }
        }
    };

    // Draw a list back-to-front. The sort is on the projected depth, including
    // the surface drop, or somebody brawling on the floor sorts as if they
    // were still on the mat.
    var sortBuf = [];
    wrestlers.drawList = function (list) {
        sortBuf.length = 0;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && !(list[i].out && list[i].eliminated)) sortBuf.push(list[i]);
        }
        // Insertion sort: the list is never longer than six and it must be
        // stable so two wrestlers at identical depth do not swap every frame.
        for (var a = 1; a < sortBuf.length; a++) {
            var cur = sortBuf[a], k = ring.depthKey(cur), b = a - 1;
            while (b >= 0 && ring.depthKey(sortBuf[b]) > k) { sortBuf[b + 1] = sortBuf[b]; b--; }
            sortBuf[b + 1] = cur;
        }
        // Every shadow first, so no wrestler is ever drawn under another one.
        for (var sh = 0; sh < sortBuf.length; sh++) wrestlers.drawShadow(sortBuf[sh]);
        for (var d = 0; d < sortBuf.length; d++) wrestlers.draw(sortBuf[d]);
    };

    /* ---------------------------------------------------------------- input */

    // Fill the intent block from a real pad.
    wrestlers.readPad = function (w, pad) {
        var B = core.BTN, i = w.in;
        i.dx = pad.dx; i.dy = pad.dy;
        i.A = pad.just[B.A]; i.B = pad.just[B.B]; i.C = pad.just[B.C];
        i.X = pad.just[B.X]; i.Y = pad.just[B.Y]; i.Z = pad.just[B.Z];
        i.Ah = pad.held[B.A]; i.Bh = pad.held[B.B]; i.Ch = pad.held[B.C];
        // Any button press counts as a mash while down or in a submission.
        i.mash = (pad.just[B.A] || 0) + (pad.just[B.B] || 0) + (pad.just[B.C] || 0) +
            (pad.just[B.L] || 0) + (pad.just[B.R] || 0);
    };

    wrestlers.clearIntent = function (w) {
        var i = w.in;
        i.dx = i.dy = 0;
        i.A = i.B = i.C = i.X = i.Y = i.Z = 0;
        i.Ah = i.Bh = i.Ch = 0; i.mash = 0;
    };

    /* ------------------------------------------------------------- palettes */

    // Called when a wrestler takes the ring. Blood is a palette change rather
    // than extra sprites: the highlight tone on the skin turns red, so a cut
    // man reads as bloodied from across the screen for zero sprite budget.
    wrestlers.applyPalette = function (w) {
        roster.applyPalette(w.pal, w.char);
        if (w.bleeding) {
            // Slot 14 is the rim light now, so the blood colour is named
            // outright rather than read back out of the palette.
            var blood = pal.hex('#db0000');
            pal.setRGB(w.pal, 4, blood);
            pal.setRGB(w.pal, 2, pal.shade(blood, 150));
        }
    };

    window.wrestlers = wrestlers;
})();
