/* =============================================================================
   SLWF - moves.js
   THE FRAME DATA TABLE. Every tunable number about every move in the game is in
   this one file, and nothing else in the codebase is allowed to hardcode damage
   or timing. This is where the game is balanced; it is written to be edited by
   hand with a calculator and no knowledge of the rest of the engine.

   Loads after roster.js and before ring.js. Depends on nothing at parse time --
   it is a data file with a small selection API bolted on. `poser.POSES` is read
   only inside moves.validate(), which the check harness calls after boot, so
   this file does not care whether poser.js has run yet.

   -----------------------------------------------------------------------------
   THE SCHEMA
   -----------------------------------------------------------------------------
   Required on every entry:

     name      string   Flashed on screen when the move lands. <=20 chars so it
                        fits the 8x8 font across 320px with room for a border.
     pose      string   A pose id from poser.POSES (the list is in DESIGN.md).
                        The pose's frame count drives the animation; the move's
                        total duration must be at least that many frames or a
                        pose frame would never be shown. validate() checks it.
     kind      string   strike | grapple | run | aerial | ground | sub |
                        weapon | pin | taunt
     startup   int      Frames before the hitbox exists. THIS IS THE RISK DIAL.
                        A jab is 4 and cannot be punished; a finisher is 20+ and
                        can be walked into and interrupted. Nothing else in the
                        table matters as much as this column.
     active    int      Frames the hitbox is live. For kind:'sub' it is instead
                        the length of the hold (see `dmg` below).
     recovery  int      Frames before the attacker accepts another action.
     dmg       int      Health damage out of 1000. For kind:'sub' it is the TOTAL
                        damage if the hold runs its full `active` window, applied
                        in equal slices -- there is no separate per-tick number.
     stun      int      Frames of hitstun inflicted on the victim.
     knock     int      0 none | 1 stagger | 2 knockdown | 3 launch (over the top
                        rope / off the apron; the ring code reads this).
     reach     int      The AI's idea of its own range in pixels. Not used for
                        collision -- `hit` is. Grapple and submission entries
                        carry tie-up range (~14) so the AI can still weigh them.
     cost      int      Stamina, out of 1000.
     part      string   head | body | arm | leg | back. Feeds the injury model;
                        a submission on an already-damaged limb can end the match.
     sfx       string   An SFX name from audio.js. See moves.SFX below.
     fx        string   An art.FX name. See moves.FX below.

   Required on anything that must physically connect (strike, run, aerial,
   ground, weapon):

     hit       {x,y,w,h} Hitbox in pixels relative to the FEET ANCHOR at (24,47)
                        of the 48x48 pose frame, facing +x. y is negative
                        upward: head ~ -38, chest ~ -30, gut ~ -22, shin ~ -8.
                        The engine mirrors x for a left-facing wrestler.

   Optional, and each one means something specific:

     victim    string   The victim's pose for a paired move: heldFront, heldRear,
                        heldUp, heldInverted, subTaken, pinBottom. combat.js is
                        the only thing allowed to put two wrestlers into a paired
                        state, and this is the pose it hands the victim.
     hold      string   'front' | 'rear' | null. Which grapple position the move
                        must be launched from. Absent means it needs no hold.
     spirit    int      Spirit cost out of 1000. A finisher is 1000 -- a FULL
                        meter, which is the rule. A signature is 300. NEGATIVE
                        spirit is a GAIN: the taunt is spirit:-60, which is how a
                        showboat builds toward a finish.
     risk      {dmg,stun}  Self-damage and self-stun if the move WHIFFS. A missed
                        top-rope dive must hurt, and a missed diving headbutt
                        must hurt more than the man it missed. Absent means a
                        whiff costs only the recovery frames.
     shake     int      Screen shake amplitude in pixels, passed to core.shake.
     freeze    int      Hit-freeze frames, passed to core.freeze. Shake and
                        freeze together are the entire feeling of impact; a
                        powerbomb without them reads as a shove.
     air       true     Needs the attacker airborne (off the turnbuckle/apron).
     grounded  true     Needs the TARGET already down.
     tags      [string] Free-form hooks for combat.js and the AI. In use:
                        'finisher' 'signature' 'slam' 'highImpact' 'aerial'
                        'sub' 'whip' 'weapon' 'illegal' 'blood' 'dangerous'
                        'corner' 'outside' 'utility' 'pin'
     classes   [string] Which weight classes may be dealt this move by
                        roster.random(). Only on signatures and finishers.
     count     {...}    kind:'pin' only -- the three-count timing, in frames.

   -----------------------------------------------------------------------------
   BALANCE INTENT (the bands these numbers were written to hit)
   -----------------------------------------------------------------------------
     strike .............  2 -  6 dmg,  startup  4 - 12
     grapple ............ 15 - 48 dmg,  startup  7 - 20
     big slam ........... 50 - 70 dmg,  startup 19 - 26
     submission (total) . 22 - 38 dmg,  startup 12 - 20
     running / ground ... 22 - 36 dmg,  startup  5 - 11
     aerial ............. 46 - 64 dmg,  startup 12 - 22
     signature .......... 72 - 78 dmg,  startup 10 - 22, spirit  300
     finisher ........... 140 -185 dmg, startup 21 - 28, spirit 1000

   Those bands form a strict ladder, and keeping it strict is worth a tuning
   pass of its own: the best plain strike (6) is below the weakest slam (38),
   the biggest shared slam (piledriver, 70) is below the weakest signature (72),
   and the strongest signature (78) is far below the weakest finisher (140). A
   signature that a shared piledriver out-damages is not a signature, which is
   exactly what the first draft of this table shipped.

   Three entries sit deliberately outside their band, and all three are the
   point of the move rather than a mistake:

     irishWhip    dmg 5    It is a throw, not a hit. The damage is whatever the
                           rope rebound does, which ring.js owns.
     pickUp       dmg 0    A utility: it drags a downed man to his feet.
     chairShotHead dmg 95  "Deliberately nastier than it ought to be." Half a
                           finisher off an object found under the ring, with no
                           spirit cost and tags ['illegal','blood']. It is meant
                           to make a Hardcore match a different game, and the
                           referee code is meant to disqualify for it outside
                           that stipulation. If it ever feels fair, lower it.

   -----------------------------------------------------------------------------
   HAND-TUNING NOTES
   -----------------------------------------------------------------------------
   * Startup is the only thing that makes a move readable. If a move feels
     cheap, add startup frames before you take damage away -- a 70-damage slam
     that cannot be interrupted is a worse problem than a 90-damage one that can.
   * stun should be roughly recovery + 10 for a move you want to be able to
     follow up from, and less than recovery for one you should not. That single
     relationship is what makes combos exist here without a combo system.
   * cost is in the same units as health but drains a pool that refills by
     standing still. A wrestler who throws nothing but powerbombs should be
     walking with the `limp` pose inside two minutes.
   * Raising `dmg` on a grapple is nearly free; raising `knock` is not. A
     knockdown hands the opponent the getUp frames and the initiative.
   ============================================================================= */
(function () {
    'use strict';

    var moves = {};

    /* ------------------------------------------------------------ vocabulary */

    // Kept as arrays rather than inline literals so validate() and the editor
    // read from the same source as the table does.
    moves.KINDS = ['strike', 'grapple', 'run', 'aerial', 'ground', 'sub', 'weapon', 'pin', 'taunt'];
    moves.PARTS = ['head', 'body', 'arm', 'leg', 'back'];
    moves.HOLDS = ['front', 'rear'];
    moves.VICTIM_POSES = ['heldFront', 'heldRear', 'heldUp', 'heldInverted', 'subTaken', 'pinBottom'];
    moves.CLASSES = ['light', 'cruiser', 'heavy', 'super'];

    // Direction keys. 'F' is toward the opponent and 'B' away from them, which
    // is NOT the same as left/right -- wrestler.js resolves facing before it
    // asks for a move, so this table never has to know which way anyone is
    // pointing. 'U' is away from the camera (world -y), 'D' toward it (+y).
    moves.DIRS = ['N', 'F', 'B', 'U', 'D'];

    // Two strength tiers, Fire Pro style: a tap is weak, a held button is
    // strong. This is where the move count comes from -- five directions times
    // two tiers is ten slots per set without needing a six-button pad.
    moves.TIERS = ['w', 's'];
    moves.STRONG_FRAMES = 10;   // held this long (frames) and the press is strong

    // Every SFX name this table asks audio.js for. Exposed so the check harness
    // can diff it against audio's own list instead of discovering a silent move
    // in a match.
    moves.SFX = ['punch', 'kick', 'chop', 'boot', 'headbutt', 'whoosh', 'grab',
        'whip', 'mat', 'slam', 'slamHeavy', 'bone', 'splash', 'dive',
        'land', 'strain', 'chair', 'metal', 'taunt'];

    // Every FX name this table asks art.js for.
    moves.FX = ['none', 'impactS', 'impactM', 'impactL', 'star', 'dust',
        'slamDust', 'bloodSpray', 'flashWhite', 'shockRing', 'sweat', 'sparkle'];

    /* =========================================================================
       THE TABLE
       ========================================================================= */

    moves.TABLE = {

        /* ------------------------------------------------------------ STRIKES
           Thirteen of them. The five on the A button's directions are the ones a
           player will throw a thousand times a match, so they are cheap, short
           and almost free to whiff. The strong tier (chop, lariat, backfist,
           big boot, knee) costs real frames and real stamina.

           stomp and elbowDrop carry grounded:true -- both are aimed at a man
           already on the mat, which is also why they are the ground set's first
           two slots. One entry, two routes to it.                           */

        jab: {
            name: 'Jab', pose: 'jabA', kind: 'strike',
            startup: 4, active: 3, recovery: 7,
            dmg: 3, stun: 10, knock: 0,
            hit: { x: 14, y: -34, w: 16, h: 10 },
            reach: 20, cost: 2, part: 'head',
            sfx: 'punch', fx: 'impactS'
        },
        hook: {
            name: 'Hook', pose: 'jabB', kind: 'strike',
            startup: 6, active: 3, recovery: 10,
            dmg: 5, stun: 14, knock: 1,
            hit: { x: 14, y: -34, w: 18, h: 12 },
            reach: 22, cost: 3, part: 'head',
            sfx: 'punch', fx: 'impactM', shake: 1
        },
        backElbow: {
            name: 'Back Elbow', pose: 'jabB', kind: 'strike',
            startup: 7, active: 3, recovery: 11,
            dmg: 5, stun: 13, knock: 1,
            hit: { x: 12, y: -33, w: 16, h: 12 },
            reach: 18, cost: 3, part: 'head',
            sfx: 'punch', fx: 'impactM', shake: 1
        },
        uppercut: {
            name: 'Uppercut', pose: 'bigStrike', kind: 'strike',
            startup: 9, active: 4, recovery: 13,
            dmg: 6, stun: 18, knock: 1,
            hit: { x: 12, y: -38, w: 16, h: 14 },
            reach: 20, cost: 4, part: 'head',
            sfx: 'punch', fx: 'star', shake: 2, freeze: 2
        },
        lowKick: {
            name: 'Low Kick', pose: 'kick', kind: 'strike',
            startup: 5, active: 3, recovery: 9,
            dmg: 4, stun: 11, knock: 0,
            hit: { x: 16, y: -12, w: 20, h: 10 },
            reach: 26, cost: 3, part: 'leg',
            sfx: 'kick', fx: 'impactS'
        },
        chop: {
            name: 'Chop', pose: 'chop', kind: 'strike',
            startup: 5, active: 3, recovery: 8,
            dmg: 4, stun: 12, knock: 0,
            hit: { x: 14, y: -30, w: 16, h: 10 },
            reach: 20, cost: 2, part: 'body',
            sfx: 'chop', fx: 'impactS', tags: ['corner']
        },
        bigBoot: {
            name: 'Big Boot', pose: 'kick', kind: 'strike',
            startup: 11, active: 4, recovery: 16,
            dmg: 6, stun: 22, knock: 2,
            hit: { x: 18, y: -36, w: 24, h: 14 },
            reach: 30, cost: 5, part: 'head',
            sfx: 'boot', fx: 'impactL', shake: 3, freeze: 3
        },
        lariat: {
            name: 'Lariat', pose: 'bigStrike', kind: 'strike',
            startup: 12, active: 4, recovery: 18,
            dmg: 6, stun: 24, knock: 2,
            hit: { x: 14, y: -34, w: 22, h: 14 },
            reach: 26, cost: 5, part: 'head',
            sfx: 'punch', fx: 'impactL', shake: 3, freeze: 3
        },
        spinningBackfist: {
            name: 'Spin Backfist', pose: 'bigStrike', kind: 'strike',
            startup: 10, active: 4, recovery: 14,
            dmg: 6, stun: 20, knock: 1,
            hit: { x: 14, y: -34, w: 18, h: 12 },
            reach: 22, cost: 4, part: 'head',
            sfx: 'punch', fx: 'star', shake: 2, freeze: 2
        },
        headbutt: {
            name: 'Headbutt', pose: 'bigStrike', kind: 'strike',
            startup: 8, active: 3, recovery: 12,
            dmg: 5, stun: 16, knock: 1,
            hit: { x: 10, y: -38, w: 14, h: 12 },
            reach: 16, cost: 3, part: 'head',
            // A headbutt that misses means your skull met a turnbuckle. The
            // risk here is small but it is the only strike that has any, and
            // it is why the AI will not spam it at range.
            risk: { dmg: 2, stun: 10 },
            sfx: 'headbutt', fx: 'star', shake: 2, freeze: 2
        },
        kneeStrike: {
            name: 'Knee Strike', pose: 'kick', kind: 'strike',
            startup: 6, active: 3, recovery: 9,
            dmg: 4, stun: 13, knock: 0,
            hit: { x: 10, y: -24, w: 14, h: 14 },
            reach: 16, cost: 3, part: 'body',
            sfx: 'kick', fx: 'impactS'
        },
        stomp: {
            name: 'Stomp', pose: 'kick', kind: 'strike',
            startup: 6, active: 3, recovery: 10,
            dmg: 3, stun: 12, knock: 0,
            hit: { x: 12, y: -6, w: 18, h: 8 },
            reach: 14, cost: 2, part: 'body',
            grounded: true,
            sfx: 'kick', fx: 'dust'
        },
        elbowDrop: {
            name: 'Elbow Drop', pose: 'bigStrike', kind: 'strike',
            startup: 10, active: 4, recovery: 16,
            dmg: 6, stun: 18, knock: 0,
            hit: { x: 8, y: -6, w: 20, h: 12 },
            reach: 14, cost: 4, part: 'body',
            grounded: true,
            risk: { dmg: 3, stun: 16 },
            sfx: 'mat', fx: 'slamDust', shake: 2, freeze: 2
        },

        /* ----------------------------------------------- GRAPPLE, FRONT HOLD
           Thirteen. The cheap three (knee lift, headbutt in the hold, snap
           mare) exist so a tie-up is not an all-or-nothing commitment; the
           expensive three (brainbuster, piledriver, fireman's carry) are not in
           the default sets at all and are reached only through a character's
           moveset overrides, which is what makes a heavyweight's tie-up feel
           different from a cruiserweight's.                                  */

        bodySlam: {
            name: 'Body Slam', pose: 'slam', kind: 'grapple',
            hold: 'front', victim: 'heldUp',
            startup: 14, active: 6, recovery: 22,
            dmg: 42, stun: 50, knock: 2,
            reach: 14, cost: 14, part: 'back',
            sfx: 'slam', fx: 'slamDust', shake: 4, freeze: 4,
            tags: ['slam', 'highImpact']
        },
        verticalSuplex: {
            name: 'Vertical Suplex', pose: 'suplex', kind: 'grapple',
            hold: 'front', victim: 'heldInverted',
            startup: 18, active: 6, recovery: 26,
            dmg: 48, stun: 58, knock: 2,
            reach: 14, cost: 17, part: 'back',
            sfx: 'slam', fx: 'slamDust', shake: 5, freeze: 5,
            tags: ['slam', 'highImpact']
        },
        bellyToBelly: {
            name: 'Belly To Belly', pose: 'suplex', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 15, active: 6, recovery: 22,
            dmg: 38, stun: 48, knock: 2,
            reach: 14, cost: 14, part: 'back',
            sfx: 'slam', fx: 'slamDust', shake: 4, freeze: 4,
            tags: ['slam']
        },
        ddt: {
            name: 'DDT', pose: 'ddt', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 13, active: 5, recovery: 24,
            dmg: 44, stun: 60, knock: 2,
            reach: 14, cost: 15, part: 'head',
            sfx: 'slam', fx: 'star', shake: 5, freeze: 5,
            tags: ['slam', 'highImpact']
        },
        powerbomb: {
            name: 'Powerbomb', pose: 'powerbomb', kind: 'grapple',
            hold: 'front', victim: 'heldUp',
            startup: 22, active: 7, recovery: 30,
            dmg: 62, stun: 70, knock: 2,
            reach: 14, cost: 22, part: 'back',
            sfx: 'slamHeavy', fx: 'slamDust', shake: 7, freeze: 7,
            tags: ['slam', 'highImpact']
        },
        brainbuster: {
            name: 'Brainbuster', pose: 'suplex', kind: 'grapple',
            hold: 'front', victim: 'heldInverted',
            startup: 24, active: 7, recovery: 32,
            dmg: 66, stun: 74, knock: 2,
            reach: 14, cost: 24, part: 'head',
            sfx: 'slamHeavy', fx: 'star', shake: 7, freeze: 8,
            tags: ['slam', 'highImpact', 'dangerous']
        },
        snapMare: {
            name: 'Snap Mare', pose: 'slam', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 9, active: 4, recovery: 14,
            dmg: 18, stun: 34, knock: 2,
            reach: 14, cost: 8, part: 'back',
            sfx: 'mat', fx: 'dust', shake: 2
        },
        kneeLift: {
            name: 'Knee Lift', pose: 'kick', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 7, active: 3, recovery: 10,
            dmg: 15, stun: 20, knock: 0,
            reach: 14, cost: 5, part: 'body',
            sfx: 'kick', fx: 'impactM', shake: 1
        },
        headbuttHold: {
            name: 'Headbutt', pose: 'bigStrike', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 8, active: 3, recovery: 11,
            dmg: 16, stun: 22, knock: 0,
            reach: 14, cost: 5, part: 'head',
            sfx: 'headbutt', fx: 'star', shake: 2, freeze: 2
        },
        irishWhip: {
            name: 'Irish Whip', pose: 'throwWhip', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 10, active: 4, recovery: 14,
            // Almost no damage of its own: the whip hands the opponent to
            // ring.js, which bounces them off the ropes at a velocity scaled
            // by the thrower's power. Whatever they hit on the way back is
            // where the damage comes from.
            dmg: 5, stun: 26, knock: 0,
            reach: 14, cost: 7, part: 'back',
            sfx: 'whip', fx: 'none',
            tags: ['whip', 'utility']
        },
        hipToss: {
            name: 'Hip Toss', pose: 'slam', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 11, active: 5, recovery: 18,
            dmg: 28, stun: 42, knock: 2,
            reach: 14, cost: 11, part: 'back',
            sfx: 'mat', fx: 'dust', shake: 3, freeze: 3
        },
        piledriver: {
            name: 'Piledriver', pose: 'powerbomb', kind: 'grapple',
            hold: 'front', victim: 'heldInverted',
            startup: 26, active: 7, recovery: 34,
            dmg: 70, stun: 80, knock: 2,
            reach: 14, cost: 26, part: 'head',
            sfx: 'bone', fx: 'star', shake: 8, freeze: 8,
            tags: ['slam', 'highImpact', 'dangerous']
        },
        firemansCarry: {
            name: "Fireman's Carry", pose: 'slam', kind: 'grapple',
            hold: 'front', victim: 'heldUp',
            startup: 16, active: 6, recovery: 24,
            dmg: 40, stun: 50, knock: 2,
            reach: 14, cost: 15, part: 'back',
            sfx: 'slam', fx: 'slamDust', shake: 4, freeze: 4,
            tags: ['slam']
        },

        /* ------------------------------------------------ GRAPPLE, REAR HOLD
           Only five, and that is on purpose: getting behind someone is harder
           than facing them, so the reward is that every rear move except the
           chinlock is a genuine slam. The chinlock is the one rest hold in the
           game -- it drains the victim and refills the holder's stamina, which
           is combat.js's job, not this table's.                              */

        germanSuplex: {
            name: 'German Suplex', pose: 'suplex', kind: 'grapple',
            hold: 'rear', victim: 'heldRear',
            startup: 20, active: 6, recovery: 28,
            dmg: 56, stun: 66, knock: 2,
            reach: 14, cost: 20, part: 'back',
            sfx: 'slamHeavy', fx: 'slamDust', shake: 6, freeze: 6,
            tags: ['slam', 'highImpact']
        },
        backDrop: {
            name: 'Back Drop', pose: 'suplex', kind: 'grapple',
            hold: 'rear', victim: 'heldRear',
            startup: 16, active: 6, recovery: 24,
            dmg: 44, stun: 54, knock: 2,
            reach: 14, cost: 16, part: 'back',
            sfx: 'slam', fx: 'slamDust', shake: 5, freeze: 5,
            tags: ['slam']
        },
        atomicDrop: {
            name: 'Atomic Drop', pose: 'slam', kind: 'grapple',
            hold: 'rear', victim: 'heldRear',
            startup: 13, active: 5, recovery: 20,
            dmg: 30, stun: 44, knock: 2,
            reach: 14, cost: 12, part: 'back',
            sfx: 'mat', fx: 'dust', shake: 3, freeze: 3
        },
        fullNelsonSlam: {
            name: 'Full Nelson Slam', pose: 'slam', kind: 'grapple',
            hold: 'rear', victim: 'heldRear',
            startup: 19, active: 6, recovery: 27,
            dmg: 50, stun: 60, knock: 2,
            reach: 14, cost: 18, part: 'back',
            sfx: 'slamHeavy', fx: 'slamDust', shake: 5, freeze: 5,
            tags: ['slam', 'highImpact']
        },
        rearChinlock: {
            name: 'Rear Chinlock', pose: 'subApply', kind: 'sub',
            hold: 'rear', victim: 'subTaken',
            startup: 12, active: 50, recovery: 18,
            dmg: 20, stun: 40, knock: 0,
            reach: 14, cost: 10, part: 'head',
            sfx: 'strain', fx: 'sweat',
            tags: ['sub']
        },

        /* ----------------------------------------------------------- RUNNING
           Everything here trades recovery for damage and every one of them has
           `risk`, because a running move that misses leaves you in the far
           corner with your back turned. That asymmetry is what makes the ropes
           worth running in the first place.                                  */

        shoulderBlock: {
            name: 'Shoulder Block', pose: 'runAttack', kind: 'run',
            startup: 6, active: 4, recovery: 18,
            dmg: 28, stun: 36, knock: 2,
            hit: { x: 14, y: -28, w: 20, h: 16 },
            reach: 26, cost: 12, part: 'body',
            risk: { dmg: 3, stun: 20 },
            sfx: 'slam', fx: 'impactL', shake: 3, freeze: 3
        },
        runLariat: {
            name: 'Running Lariat', pose: 'runAttack', kind: 'run',
            startup: 8, active: 4, recovery: 20,
            dmg: 36, stun: 44, knock: 2,
            hit: { x: 16, y: -34, w: 22, h: 14 },
            reach: 30, cost: 14, part: 'head',
            risk: { dmg: 4, stun: 24 },
            sfx: 'punch', fx: 'impactL', shake: 4, freeze: 4,
            tags: ['highImpact']
        },
        runDropkick: {
            name: 'Dropkick', pose: 'runAttack', kind: 'run',
            startup: 9, active: 4, recovery: 24,
            dmg: 32, stun: 40, knock: 2,
            hit: { x: 18, y: -32, w: 22, h: 12 },
            reach: 32, cost: 13, part: 'head',
            // You land on your own back whether it hits or not; a whiff just
            // means nobody broke your fall.
            risk: { dmg: 6, stun: 30 },
            sfx: 'kick', fx: 'impactM', shake: 3, freeze: 3
        },
        runningKnee: {
            name: 'Running Knee', pose: 'runAttack', kind: 'run',
            startup: 7, active: 4, recovery: 19,
            dmg: 30, stun: 38, knock: 2,
            hit: { x: 14, y: -32, w: 16, h: 14 },
            reach: 24, cost: 12, part: 'head',
            risk: { dmg: 4, stun: 22 },
            sfx: 'kick', fx: 'impactL', shake: 4, freeze: 4
        },
        baseballSlide: {
            name: 'Baseball Slide', pose: 'runAttack', kind: 'run',
            startup: 8, active: 6, recovery: 22,
            dmg: 22, stun: 34, knock: 2,
            hit: { x: 18, y: -10, w: 26, h: 10 },
            reach: 34, cost: 11, part: 'head',
            risk: { dmg: 5, stun: 26 },
            sfx: 'boot', fx: 'dust', shake: 2, freeze: 2,
            // Slides under the bottom rope. Only legal from inside the ring at
            // an opponent standing on the floor -- match.js gates it.
            tags: ['outside']
        },
        crossBody: {
            name: 'Cross Body', pose: 'diveAir', kind: 'run',
            startup: 10, active: 6, recovery: 26,
            dmg: 34, stun: 42, knock: 2,
            hit: { x: 14, y: -26, w: 24, h: 18 },
            reach: 30, cost: 14, part: 'body',
            risk: { dmg: 8, stun: 34 },
            sfx: 'splash', fx: 'impactL', shake: 4, freeze: 4,
            tags: ['highImpact']
        },

        /* ------------------------------------------------------------ AERIAL
           From the top turnbuckle. air:true, and every one of them has a risk
           block heavier than any running move -- the diving headbutt's whiff
           hurts more than it does when it connects on anybody's ribs, which is
           historically accurate and makes the player think twice.

           missileDropkick is the only one that wants its target STANDING. The
           rest need them down, which is why they are the reward for a knockdown
           rather than something you open with.                               */

        divingSplash: {
            name: 'Diving Splash', pose: 'diveAir', kind: 'aerial',
            air: true, grounded: true,
            startup: 14, active: 8, recovery: 26,
            dmg: 52, stun: 60, knock: 2,
            hit: { x: 4, y: -14, w: 28, h: 18 },
            reach: 20, cost: 18, part: 'body',
            risk: { dmg: 16, stun: 50 },
            sfx: 'splash', fx: 'slamDust', shake: 6, freeze: 6,
            tags: ['aerial', 'highImpact']
        },
        divingElbow: {
            name: 'Diving Elbow', pose: 'diveAir', kind: 'aerial',
            air: true, grounded: true,
            startup: 15, active: 7, recovery: 26,
            dmg: 50, stun: 58, knock: 2,
            hit: { x: 4, y: -12, w: 22, h: 16 },
            reach: 20, cost: 17, part: 'body',
            risk: { dmg: 16, stun: 50 },
            sfx: 'mat', fx: 'slamDust', shake: 6, freeze: 6,
            tags: ['aerial', 'highImpact']
        },
        missileDropkick: {
            name: 'Missile Dropkick', pose: 'diveAir', kind: 'aerial',
            air: true,
            startup: 12, active: 7, recovery: 28,
            dmg: 46, stun: 54, knock: 2,
            hit: { x: 18, y: -30, w: 24, h: 14 },
            reach: 34, cost: 17, part: 'head',
            risk: { dmg: 18, stun: 54 },
            sfx: 'kick', fx: 'impactL', shake: 5, freeze: 5,
            tags: ['aerial']
        },
        moonsault: {
            name: 'Moonsault', pose: 'diveAir', kind: 'aerial',
            air: true, grounded: true,
            startup: 18, active: 8, recovery: 30,
            dmg: 58, stun: 66, knock: 2,
            hit: { x: 2, y: -14, w: 28, h: 18 },
            reach: 22, cost: 21, part: 'body',
            risk: { dmg: 22, stun: 60 },
            sfx: 'splash', fx: 'slamDust', shake: 6, freeze: 7,
            tags: ['aerial', 'highImpact']
        },
        splash450: {
            name: '450 Splash', pose: 'diveAir', kind: 'aerial',
            air: true, grounded: true,
            startup: 22, active: 8, recovery: 32,
            dmg: 64, stun: 72, knock: 2,
            hit: { x: 2, y: -14, w: 28, h: 18 },
            reach: 22, cost: 24, part: 'body',
            risk: { dmg: 26, stun: 66 },
            sfx: 'splash', fx: 'slamDust', shake: 7, freeze: 7,
            tags: ['aerial', 'highImpact']
        },
        divingHeadbutt: {
            name: 'Diving Headbutt', pose: 'diveAir', kind: 'aerial',
            air: true, grounded: true,
            startup: 20, active: 8, recovery: 34,
            dmg: 60, stun: 70, knock: 2,
            hit: { x: 6, y: -12, w: 20, h: 16 },
            reach: 20, cost: 22, part: 'head',
            // The nastiest risk in the table, and it should stay that way.
            risk: { dmg: 30, stun: 70 },
            sfx: 'bone', fx: 'star', shake: 7, freeze: 7,
            tags: ['aerial', 'highImpact', 'dangerous']
        },

        /* ------------------------------------------------------- GROUND GAME
           Five slots, three new entries: the ground set's N and F reuse `stomp`
           and `elbowDrop` from the strike section rather than duplicating their
           numbers, because two tables with the same move in them is how a
           balance pass silently half-applies.                                */

        pickUp: {
            name: 'Pick Up', pose: 'tieup', kind: 'ground',
            victim: 'heldFront', grounded: true,
            startup: 8, active: 4, recovery: 12,
            // No damage: this exists to drag a downed man up into a hold so a
            // match does not stall into stomps forever.
            dmg: 0, stun: 20, knock: 0,
            hit: { x: 10, y: -8, w: 16, h: 10 },
            reach: 16, cost: 4, part: 'arm',
            sfx: 'grab', fx: 'none',
            tags: ['utility']
        },
        mountedPunch: {
            name: 'Mounted Punches', pose: 'jabA', kind: 'ground',
            grounded: true,
            startup: 5, active: 3, recovery: 8,
            dmg: 4, stun: 10, knock: 0,
            hit: { x: 8, y: -10, w: 14, h: 10 },
            reach: 14, cost: 3, part: 'head',
            sfx: 'punch', fx: 'impactS',
            tags: ['blood']
        },
        legDrop: {
            name: 'Leg Drop', pose: 'bigStrike', kind: 'ground',
            grounded: true,
            startup: 11, active: 4, recovery: 17,
            dmg: 24, stun: 30, knock: 0,
            hit: { x: 6, y: -8, w: 24, h: 10 },
            reach: 16, cost: 7, part: 'head',
            risk: { dmg: 4, stun: 18 },
            sfx: 'mat', fx: 'slamDust', shake: 3, freeze: 3
        },

        /* ------------------------------------------------------- SUBMISSIONS
           `active` is the length of the hold, and `dmg` is the TOTAL over that
           window, applied in slices by combat.js. Every one names the `part` it
           attacks, which is the whole reason `part` exists: a figure four on a
           leg that is already at its damage ceiling breaks it, the match stops
           on the spot and the `bone` SFX plays. That is the one Wrestling
           Empire mechanic worth stealing wholesale.

           The three limb holds (figureFour, camelClutch, crossFace) are the
           long, damaging ones. sleeper and bearHug work on a standing opponent,
           which is why they are cheaper and shorter.                         */

        armbar: {
            name: 'Armbar', pose: 'subApply', kind: 'sub',
            victim: 'subTaken', grounded: true,
            startup: 14, active: 60, recovery: 20,
            dmg: 26, stun: 70, knock: 0,
            reach: 14, cost: 12, part: 'arm',
            sfx: 'strain', fx: 'sweat', tags: ['sub']
        },
        legLock: {
            name: 'Leg Lock', pose: 'subApply', kind: 'sub',
            victim: 'subTaken', grounded: true,
            startup: 15, active: 60, recovery: 20,
            dmg: 26, stun: 70, knock: 0,
            reach: 14, cost: 12, part: 'leg',
            sfx: 'strain', fx: 'sweat', tags: ['sub']
        },
        figureFour: {
            name: 'Figure Four', pose: 'subApply', kind: 'sub',
            victim: 'subTaken', grounded: true,
            startup: 20, active: 90, recovery: 24,
            dmg: 38, stun: 100, knock: 0,
            reach: 14, cost: 18, part: 'leg',
            sfx: 'strain', fx: 'sweat', tags: ['sub', 'dangerous']
        },
        sleeper: {
            name: 'Sleeper Hold', pose: 'subApply', kind: 'sub',
            victim: 'subTaken',
            startup: 12, active: 70, recovery: 18,
            dmg: 22, stun: 80, knock: 0,
            reach: 14, cost: 11, part: 'head',
            sfx: 'strain', fx: 'sweat', tags: ['sub']
        },
        camelClutch: {
            name: 'Camel Clutch', pose: 'subApply', kind: 'sub',
            victim: 'subTaken', grounded: true,
            startup: 18, active: 80, recovery: 22,
            dmg: 34, stun: 90, knock: 0,
            reach: 14, cost: 16, part: 'back',
            sfx: 'strain', fx: 'sweat', tags: ['sub', 'dangerous']
        },
        ankleLock: {
            name: 'Ankle Lock', pose: 'subApply', kind: 'sub',
            victim: 'subTaken', grounded: true,
            startup: 13, active: 60, recovery: 18,
            dmg: 24, stun: 70, knock: 0,
            reach: 14, cost: 11, part: 'leg',
            sfx: 'strain', fx: 'sweat', tags: ['sub']
        },
        crossFace: {
            name: 'Cross Face', pose: 'subApply', kind: 'sub',
            victim: 'subTaken', grounded: true,
            startup: 16, active: 75, recovery: 20,
            dmg: 30, stun: 85, knock: 0,
            reach: 14, cost: 14, part: 'head',
            sfx: 'strain', fx: 'sweat', tags: ['sub', 'dangerous']
        },
        bearHug: {
            name: 'Bear Hug', pose: 'subApply', kind: 'sub',
            victim: 'subTaken',
            startup: 16, active: 70, recovery: 22,
            dmg: 28, stun: 80, knock: 0,
            reach: 14, cost: 15, part: 'body',
            sfx: 'strain', fx: 'sweat', tags: ['sub']
        },

        /* --------------------------------------------------------------- PIN */

        pin: {
            name: 'Pin', pose: 'pinTop', kind: 'pin',
            victim: 'pinBottom', grounded: true,
            startup: 10, active: 180, recovery: 20,
            dmg: 0, stun: 0, knock: 0,
            reach: 16, cost: 4, part: 'body',
            sfx: 'grab', fx: 'none',
            // The three count, in frames from the moment the shoulders are
            // down. One second between slaps, so `active` is exactly `three`.
            // A kickout is accepted any time before `three`; `grace` is the
            // window AFTER three in which it still counts, and that handful of
            // frames is the entire reason a near-fall is exciting. Kickout
            // probability itself lives in combat.js because it is a function of
            // health, stamina and mashing -- not of the move.
            count: { one: 60, two: 120, three: 180, grace: 4 },
            tags: ['pin']
        },

        /* ----------------------------------------------------------- WEAPONS
           Weapons are found, not carried: combat.weapons spawns them from under
           the ring or over the barricade, so these three entries cover every
           object in the game. The swing and the thrust are generic; `part`
           comes from the entry, not the object.

           chairShotHead is the exception to every band in this file. See the
           header. It is meant to be an obviously terrible idea that a player
           reaches for anyway.                                                */

        weaponSwing: {
            name: 'Weapon Swing', pose: 'weaponSwing', kind: 'weapon',
            startup: 9, active: 5, recovery: 16,
            dmg: 30, stun: 40, knock: 1,
            hit: { x: 18, y: -28, w: 24, h: 16 },
            reach: 32, cost: 8, part: 'body',
            sfx: 'metal', fx: 'impactL', shake: 4, freeze: 4,
            tags: ['weapon']
        },
        weaponThrust: {
            name: 'Weapon Thrust', pose: 'weaponSwing', kind: 'weapon',
            startup: 7, active: 4, recovery: 14,
            dmg: 22, stun: 30, knock: 0,
            hit: { x: 22, y: -26, w: 18, h: 10 },
            reach: 36, cost: 6, part: 'body',
            sfx: 'metal', fx: 'impactM', shake: 2, freeze: 2,
            tags: ['weapon']
        },
        chairShotHead: {
            name: 'CHAIR SHOT', pose: 'weaponSwing', kind: 'weapon',
            startup: 12, active: 5, recovery: 20,
            dmg: 95, stun: 90, knock: 2,
            hit: { x: 16, y: -38, w: 22, h: 14 },
            reach: 30, cost: 12, part: 'head',
            sfx: 'chair', fx: 'bloodSpray', shake: 9, freeze: 10,
            tags: ['weapon', 'illegal', 'blood', 'dangerous', 'highImpact']
        },

        /* ------------------------------------------------------------- TAUNT
           The only entry with negative spirit: a taunt GAINS 60 spirit and
           costs you 30 frames of standing still to do it, which against a
           competent opponent is a bad trade and against a hurt one is how you
           finish the match. No hitbox, no damage.                            */

        taunt: {
            name: 'Taunt', pose: 'taunt', kind: 'taunt',
            startup: 6, active: 0, recovery: 24,
            dmg: 0, stun: 0, knock: 0,
            reach: 0, cost: 0, part: 'body',
            spirit: -60,
            sfx: 'taunt', fx: 'sparkle',
            tags: ['utility']
        },

        /* ========================================================= SIGNATURES
           One per character, spirit 300 -- about a third of a meter, so a
           signature lands two or three times a match. Damage 66-78 puts them
           just above the biggest shared slam and well below a finish, which is
           exactly the job: a signature is what tells the crowd the finish is
           coming, not the finish.                                            */

        gravityWell: {                                   // QUASAR
            name: 'Gravity Well', pose: 'powerbomb', kind: 'grapple',
            hold: 'front', victim: 'heldUp',
            startup: 20, active: 6, recovery: 30,
            dmg: 78, stun: 80, knock: 2,
            reach: 14, cost: 24, part: 'back', spirit: 300,
            sfx: 'slamHeavy', fx: 'shockRing', shake: 7, freeze: 7,
            tags: ['signature', 'slam', 'highImpact'],
            classes: ['heavy', 'super']
        },
        deadlineDrop: {                                  // DKS
            name: 'Deadline Drop', pose: 'suplex', kind: 'grapple',
            hold: 'rear', victim: 'heldRear',
            startup: 22, active: 6, recovery: 30,
            dmg: 74, stun: 82, knock: 2,
            reach: 14, cost: 23, part: 'head', spirit: 300,
            sfx: 'slamHeavy', fx: 'star', shake: 6, freeze: 6,
            tags: ['signature', 'slam', 'highImpact'],
            classes: ['cruiser', 'heavy', 'super']
        },
        skyHook: {                                       // FLYE
            name: 'Sky Hook', pose: 'diveAir', kind: 'aerial',
            air: true,
            startup: 16, active: 8, recovery: 26,
            dmg: 72, stun: 78, knock: 2,
            hit: { x: 16, y: -32, w: 26, h: 16 },
            reach: 32, cost: 20, part: 'head', spirit: 300,
            risk: { dmg: 24, stun: 58 },
            sfx: 'kick', fx: 'shockRing', shake: 6, freeze: 7,
            tags: ['signature', 'aerial', 'highImpact'],
            classes: ['light', 'cruiser']
        },
        southpawSuplex: {                                // SAMANTHA
            name: 'Southpaw Suplex', pose: 'suplex', kind: 'grapple',
            hold: 'rear', victim: 'heldRear',
            startup: 20, active: 6, recovery: 28,
            dmg: 72, stun: 80, knock: 2,
            reach: 14, cost: 22, part: 'back', spirit: 300,
            sfx: 'slamHeavy', fx: 'slamDust', shake: 6, freeze: 6,
            tags: ['signature', 'slam', 'highImpact'],
            classes: ['light', 'cruiser', 'heavy']
        },
        stingerSplash: {                                 // SCORP
            name: 'Stinger Splash', pose: 'runAttack', kind: 'run',
            startup: 10, active: 6, recovery: 24,
            dmg: 68, stun: 76, knock: 2,
            hit: { x: 14, y: -28, w: 26, h: 20 },
            reach: 28, cost: 20, part: 'body', spirit: 300,
            risk: { dmg: 12, stun: 40 },
            sfx: 'splash', fx: 'shockRing', shake: 6, freeze: 6,
            tags: ['signature', 'highImpact', 'corner'],
            classes: ['light', 'cruiser', 'heavy']
        },
        boardroomBomb: {                                 // SHARON
            name: 'Boardroom Bomb', pose: 'powerbomb', kind: 'grapple',
            hold: 'front', victim: 'heldUp',
            startup: 21, active: 6, recovery: 30,
            dmg: 76, stun: 80, knock: 2,
            reach: 14, cost: 24, part: 'back', spirit: 300,
            sfx: 'slamHeavy', fx: 'slamDust', shake: 7, freeze: 7,
            tags: ['signature', 'slam', 'highImpact'],
            classes: ['heavy', 'super']
        },
        poltergeistPlunge: {                             // SPOOPY
            name: 'Poltergeist Dive', pose: 'diveAir', kind: 'aerial',
            air: true, grounded: true,
            startup: 18, active: 8, recovery: 28,
            dmg: 74, stun: 80, knock: 2,
            hit: { x: 2, y: -14, w: 30, h: 18 },
            reach: 22, cost: 22, part: 'body', spirit: 300,
            risk: { dmg: 20, stun: 52 },
            sfx: 'splash', fx: 'shockRing', shake: 7, freeze: 7,
            tags: ['signature', 'aerial', 'highImpact'],
            classes: ['light', 'cruiser']
        },
        breezeBlock: {                                   // BREE
            name: 'Breeze Block', pose: 'bigStrike', kind: 'strike',
            startup: 14, active: 4, recovery: 20,
            dmg: 68, stun: 70, knock: 2,
            hit: { x: 14, y: -34, w: 20, h: 14 },
            reach: 26, cost: 18, part: 'head', spirit: 300,
            risk: { dmg: 6, stun: 26 },
            sfx: 'punch', fx: 'shockRing', shake: 6, freeze: 6,
            tags: ['signature', 'highImpact'],
            classes: ['light', 'cruiser', 'heavy']
        },
        cricketKick: {                                   // RICKITYCRICKET
            name: 'Cricket Kick', pose: 'kick', kind: 'strike',
            startup: 13, active: 4, recovery: 19,
            dmg: 66, stun: 70, knock: 2,
            hit: { x: 18, y: -36, w: 24, h: 14 },
            reach: 30, cost: 17, part: 'head', spirit: 300,
            risk: { dmg: 6, stun: 26 },
            sfx: 'boot', fx: 'shockRing', shake: 6, freeze: 6,
            tags: ['signature', 'highImpact'],
            classes: ['light', 'cruiser', 'heavy']
        },

        /* ========================================================== FINISHERS
           One per character. spirit 1000 is a FULL meter and that is a hard
           rule validate() enforces. Startup is 21-28 frames, which is a third
           of a second of visible wind-up: long enough that a player who sees it
           coming can hit you out of it, which is the whole reason the spirit
           meter being full is dramatic rather than automatic.

           Damage 140-185 out of 1000 does not finish a fresh opponent and is
           not supposed to. Four or five of these, or two plus the damage of the
           match that earned them, is a finish.                               */

        eventHorizon: {                                  // QUASAR
            name: 'EVENT HORIZON', pose: 'powerbomb', kind: 'grapple',
            hold: 'front', victim: 'heldUp',
            startup: 28, active: 8, recovery: 44,
            dmg: 185, stun: 150, knock: 2,
            reach: 14, cost: 40, part: 'back', spirit: 1000,
            sfx: 'bone', fx: 'flashWhite', shake: 12, freeze: 14,
            tags: ['finisher', 'slam', 'highImpact', 'dangerous'],
            classes: ['heavy', 'super']
        },
        dksDriver: {                                     // DKS
            name: 'D.K.S. DRIVER', pose: 'powerbomb', kind: 'grapple',
            hold: 'front', victim: 'heldInverted',
            startup: 26, active: 8, recovery: 42,
            dmg: 175, stun: 145, knock: 2,
            reach: 14, cost: 38, part: 'head', spirit: 1000,
            sfx: 'bone', fx: 'flashWhite', shake: 11, freeze: 13,
            tags: ['finisher', 'slam', 'highImpact', 'dangerous'],
            classes: ['cruiser', 'heavy', 'super']
        },
        terminalVelocity: {                              // FLYE
            name: 'TERMINAL VELOCITY', pose: 'diveAir', kind: 'aerial',
            air: true, grounded: true,
            startup: 24, active: 9, recovery: 40,
            dmg: 160, stun: 140, knock: 2,
            hit: { x: 2, y: -14, w: 30, h: 18 },
            reach: 22, cost: 34, part: 'body', spirit: 1000,
            // Miss this and you have fallen fifteen feet onto a mat with
            // nothing under you. It is the heaviest whiff in the game.
            risk: { dmg: 40, stun: 80 },
            sfx: 'splash', fx: 'flashWhite', shake: 10, freeze: 12,
            tags: ['finisher', 'aerial', 'highImpact', 'dangerous'],
            classes: ['light', 'cruiser']
        },
        lastCallSuplex: {                                // SAMANTHA
            name: 'LAST CALL', pose: 'suplex', kind: 'grapple',
            hold: 'rear', victim: 'heldRear',
            startup: 25, active: 8, recovery: 40,
            dmg: 168, stun: 142, knock: 2,
            reach: 14, cost: 36, part: 'head', spirit: 1000,
            sfx: 'bone', fx: 'flashWhite', shake: 11, freeze: 12,
            tags: ['finisher', 'slam', 'highImpact', 'dangerous'],
            classes: ['cruiser', 'heavy']
        },
        venomClutch: {                                   // SCORP
            name: 'VENOM CLUTCH', pose: 'subApply', kind: 'sub',
            victim: 'subTaken', grounded: true,
            startup: 22, active: 110, recovery: 34,
            dmg: 150, stun: 180, knock: 0,
            reach: 14, cost: 32, part: 'back', spirit: 1000,
            sfx: 'strain', fx: 'flashWhite', shake: 4, freeze: 6,
            tags: ['finisher', 'sub', 'dangerous'],
            classes: ['light', 'cruiser', 'heavy']
        },
        glassCeiling: {                                  // SHARON
            name: 'THE GLASS CEILING', pose: 'powerbomb', kind: 'grapple',
            hold: 'front', victim: 'heldUp',
            startup: 27, active: 8, recovery: 42,
            dmg: 178, stun: 148, knock: 2,
            reach: 14, cost: 39, part: 'back', spirit: 1000,
            sfx: 'bone', fx: 'flashWhite', shake: 12, freeze: 13,
            tags: ['finisher', 'slam', 'highImpact', 'dangerous'],
            classes: ['heavy', 'super']
        },
        nightTerror: {                                   // SPOOPY
            name: 'NIGHT TERROR', pose: 'ddt', kind: 'grapple',
            hold: 'front', victim: 'heldFront',
            startup: 23, active: 8, recovery: 38,
            dmg: 155, stun: 150, knock: 2,
            reach: 14, cost: 33, part: 'head', spirit: 1000,
            sfx: 'bone', fx: 'flashWhite', shake: 10, freeze: 12,
            tags: ['finisher', 'slam', 'highImpact', 'dangerous'],
            classes: ['light', 'cruiser', 'heavy']
        },
        hurricaneBree: {                                 // BREE
            name: 'HURRICANE BREE', pose: 'runAttack', kind: 'run',
            startup: 21, active: 7, recovery: 36,
            dmg: 140, stun: 135, knock: 2,
            hit: { x: 16, y: -32, w: 26, h: 18 },
            reach: 32, cost: 30, part: 'head', spirit: 1000,
            risk: { dmg: 30, stun: 70 },
            sfx: 'punch', fx: 'flashWhite', shake: 9, freeze: 11,
            tags: ['finisher', 'highImpact', 'dangerous'],
            classes: ['light', 'cruiser']
        },
        theLastWicket: {                                 // RICKITYCRICKET
            name: 'THE LAST WICKET', pose: 'bigStrike', kind: 'strike',
            startup: 22, active: 7, recovery: 36,
            dmg: 145, stun: 138, knock: 2,
            hit: { x: 16, y: -36, w: 24, h: 16 },
            reach: 28, cost: 31, part: 'head', spirit: 1000,
            risk: { dmg: 14, stun: 44 },
            sfx: 'bone', fx: 'flashWhite', shake: 10, freeze: 12,
            tags: ['finisher', 'highImpact', 'dangerous'],
            classes: ['light', 'cruiser', 'heavy']
        }
    };

    /* =========================================================================
       SELECTION
       -------------------------------------------------------------------------
       Five directions times two strength tiers per set. A slot value is either
       a move id (both tiers do the same thing) or {w, s}.

       Not every move is in SETS, and that is deliberate: brainbuster,
       piledriver, firemansCarry and the standing headbutt are reached only
       through a character's `moveset` overrides, which is what makes one
       wrestler's tie-up feel unlike another's with no per-character code.
       ========================================================================= */

    moves.SETS = {

        strike: {
            N: { w: 'jab', s: 'chop' },
            F: { w: 'hook', s: 'lariat' },
            B: { w: 'backElbow', s: 'spinningBackfist' },
            U: { w: 'uppercut', s: 'bigBoot' },
            D: { w: 'lowKick', s: 'kneeStrike' }
        },

        grappleFront: {
            N: { w: 'kneeLift', s: 'bodySlam' },
            F: { w: 'snapMare', s: 'verticalSuplex' },
            B: { w: 'headbuttHold', s: 'bellyToBelly' },
            U: { w: 'irishWhip', s: 'powerbomb' },
            D: { w: 'hipToss', s: 'ddt' }
        },

        // Only five rear moves exist, so slots repeat. A rear waistlock having
        // fewer answers than a front facelock is the correct shape, not a gap.
        grappleRear: {
            N: { w: 'rearChinlock', s: 'backDrop' },
            F: { w: 'atomicDrop', s: 'germanSuplex' },
            B: { w: 'atomicDrop', s: 'fullNelsonSlam' },
            U: { w: 'rearChinlock', s: 'germanSuplex' },
            D: { w: 'atomicDrop', s: 'backDrop' }
        },

        run: {
            N: { w: 'shoulderBlock', s: 'runLariat' },
            F: { w: 'runningKnee', s: 'runLariat' },
            B: 'baseballSlide',
            U: { w: 'runDropkick', s: 'crossBody' },
            D: { w: 'baseballSlide', s: 'runDropkick' }
        },

        ground: {
            N: { w: 'stomp', s: 'elbowDrop' },
            F: { w: 'mountedPunch', s: 'elbowDrop' },
            B: 'pickUp',
            U: { w: 'stomp', s: 'legDrop' },
            D: { w: 'mountedPunch', s: 'legDrop' }
        },

        sub: {
            N: { w: 'sleeper', s: 'crossFace' },
            F: { w: 'armbar', s: 'figureFour' },
            B: 'camelClutch',
            U: { w: 'bearHug', s: 'sleeper' },
            D: { w: 'legLock', s: 'ankleLock' }
        },

        aerial: {
            N: { w: 'divingSplash', s: 'splash450' },
            F: { w: 'divingElbow', s: 'divingHeadbutt' },
            B: 'moonsault',
            U: 'missileDropkick',
            D: { w: 'divingSplash', s: 'moonsault' }
        },

        weapon: {
            N: { w: 'weaponSwing', s: 'chairShotHead' },
            F: { w: 'weaponThrust', s: 'weaponSwing' },
            B: 'weaponSwing',
            U: { w: 'weaponSwing', s: 'chairShotHead' },
            D: 'weaponThrust'
        }
    };

    /* ------------------------------------------------------------------- API */

    // `btn` may be a tier ('w'/'s') or a pad button name. A and B are weak;
    // C, X, Y and Z are strong, which matches the control mapping in DESIGN.md
    // where C is the run button and the 6-button extras are all "more".
    var TIER_OF = {
        w: 'w', s: 's',
        A: 'w', B: 'w', C: 's', X: 's', Y: 's', Z: 's'
    };

    moves.tier = function (btn) { return TIER_OF[btn] || 'w'; };

    moves.get = function (id) {
        var m = moves.TABLE[id];
        if (!m) throw new Error('moves.get: unknown move id "' + id + '"');
        return m;
    };

    moves.has = function (id) { return !!moves.TABLE[id]; };

    moves.total = function (id) {
        var m = moves.get(id);
        return m.startup + m.active + m.recovery;
    };

    moves.ids = function () { return Object.keys(moves.TABLE); };

    moves.byKind = function (kind) {
        return moves.ids().filter(function (id) { return moves.TABLE[id].kind === kind; });
    };

    moves.tagged = function (tag) {
        return moves.ids().filter(function (id) {
            var t = moves.TABLE[id].tags;
            return !!t && t.indexOf(tag) >= 0;
        });
    };

    moves.finishers = function () { return moves.tagged('finisher'); };
    moves.signatures = function () { return moves.tagged('signature'); };

    // Signatures/finishers legal for a weight class, used by roster.random.
    moves.forClass = function (tag, wclass) {
        return moves.tagged(tag).filter(function (id) {
            var c = moves.TABLE[id].classes;
            return !c || c.indexOf(wclass) >= 0;
        });
    };

    // Resolve a slot. Character overrides win, most specific first:
    //     char.moveset['grappleFront.F.s']   one tier of one direction
    //     char.moveset['grappleFront.F']     both tiers of one direction
    // then moves.SETS. Returns a move id, or null for an unknown set.
    moves.pick = function (char, set, dirKey, btn) {
        var tier = moves.tier(btn);
        var dir = (moves.DIRS.indexOf(dirKey) >= 0) ? dirKey : 'N';
        var slots = moves.SETS[set];
        if (!slots) return null;

        var ms = char && char.moveset;
        if (ms) {
            var id = ms[set + '.' + dir + '.' + tier];
            if (id === undefined) id = ms[set + '.' + dir];
            if (id !== undefined && moves.TABLE[id]) return id;
        }

        var slot = slots[dir];
        if (slot === undefined) slot = slots.N;
        if (typeof slot === 'string') return slot;
        return slot[tier] || slot.w || slot.s || null;
    };

    // True if `key` names a real slot: 'set.dir' or 'set.dir.tier'. The roster
    // editor and validate() both need this, and a typo'd override key that
    // silently never fires is exactly the bug worth catching at boot.
    moves.isSlot = function (key) {
        var p = String(key).split('.');
        if (p.length < 2 || p.length > 3) return false;
        var slots = moves.SETS[p[0]];
        if (!slots) return false;
        if (moves.DIRS.indexOf(p[1]) < 0) return false;
        if (p.length === 3) {
            if (moves.TIERS.indexOf(p[2]) < 0) return false;
            var slot = slots[p[1]];
            // A string slot answers both tiers, so a tier-specific override of
            // it is still meaningful.
            if (slot === undefined) return false;
        }
        return slots[p[1]] !== undefined;
    };

    /* ------------------------------------------------------------ validation
       Given a {poseName: frameCount} map -- poser.POSES -- return a list of
       human-readable problems. Empty means the table is coherent. The check
       harness calls this; so does main.js in a debug build.

       The pose-length rule: a move's total commitment must be at least its
       pose's frame count, or a pose frame exists that the animation can never
       reach. That is the one way this table and poser.js can silently disagree.
    */
    moves.validate = function (poses) {
        var bad = [];
        function err(id, msg) { bad.push(id + ': ' + msg); }

        function num(id, m, f, lo, hi, required) {
            var v = m[f];
            if (v === undefined || v === null) {
                if (required) err(id, 'missing ' + f);
                return;
            }
            if (typeof v !== 'number' || !isFinite(v) || (v | 0) !== v) {
                err(id, f + ' is not an integer (' + v + ')');
            } else if (v < lo || v > hi) {
                err(id, f + ' out of range ' + lo + '..' + hi + ' (' + v + ')');
            }
        }

        var NEEDS_HIT = { strike: 1, run: 1, aerial: 1, ground: 1, weapon: 1 };

        Object.keys(moves.TABLE).forEach(function (id) {
            var m = moves.TABLE[id];

            /* identity */
            if (typeof m.name !== 'string' || !m.name.length) err(id, 'missing name');
            else if (m.name.length > 20) err(id, 'name "' + m.name + '" is ' + m.name.length + ' chars, max 20');

            if (moves.KINDS.indexOf(m.kind) < 0) err(id, 'unknown kind "' + m.kind + '"');
            if (moves.PARTS.indexOf(m.part) < 0) err(id, 'unknown part "' + m.part + '"');

            /* poses */
            if (typeof m.pose !== 'string' || !m.pose.length) {
                err(id, 'missing pose');
            } else if (poses && poses[m.pose] === undefined) {
                err(id, 'unknown pose "' + m.pose + '"');
            }
            if (m.victim !== undefined) {
                if (moves.VICTIM_POSES.indexOf(m.victim) < 0) {
                    err(id, 'victim "' + m.victim + '" is not a paired pose');
                } else if (poses && poses[m.victim] === undefined) {
                    err(id, 'victim pose "' + m.victim + '" does not exist');
                }
            }

            /* timing */
            num(id, m, 'startup', 1, 120, true);
            num(id, m, 'active', 0, 300, true);
            num(id, m, 'recovery', 0, 120, true);

            if (poses && poses[m.pose] !== undefined &&
                typeof m.startup === 'number' && typeof m.active === 'number' &&
                typeof m.recovery === 'number') {
                var total = m.startup + m.active + m.recovery;
                if (total < poses[m.pose]) {
                    err(id, 'total ' + total + 'f is shorter than pose "' + m.pose +
                        '" (' + poses[m.pose] + ' frames) -- frames would never be shown');
                }
            }

            /* effect */
            num(id, m, 'dmg', 0, 400, true);
            num(id, m, 'stun', 0, 600, true);
            num(id, m, 'knock', 0, 3, true);
            num(id, m, 'reach', 0, 200, true);
            num(id, m, 'cost', 0, 200, true);
            num(id, m, 'spirit', -1000, 1000, false);
            num(id, m, 'shake', 0, 16, false);
            num(id, m, 'freeze', 0, 24, false);

            /* hitbox */
            if (NEEDS_HIT[m.kind] && !m.hit) {
                err(id, 'kind "' + m.kind + '" needs a hit box');
            }
            if (m.hit) {
                var h = m.hit, k;
                for (k in { x: 1, y: 1, w: 1, h: 1 }) {
                    if (typeof h[k] !== 'number' || (h[k] | 0) !== h[k]) {
                        err(id, 'hit.' + k + ' is not an integer');
                    }
                }
                if (h.w <= 0 || h.h <= 0) err(id, 'hit box has no area');
                if (h.x < -48 || h.x > 64) err(id, 'hit.x ' + h.x + ' is off the frame');
                if (h.y < -56 || h.y > 8) err(id, 'hit.y ' + h.y + ' is off the frame');
            }

            /* holds and preconditions */
            if (m.hold !== undefined && m.hold !== null && moves.HOLDS.indexOf(m.hold) < 0) {
                err(id, 'unknown hold "' + m.hold + '"');
            }
            if (m.hold && !m.victim) err(id, 'has hold "' + m.hold + '" but no victim pose');
            if (m.air !== undefined && m.air !== true) err(id, 'air must be true or absent');
            if (m.grounded !== undefined && m.grounded !== true) err(id, 'grounded must be true or absent');

            /* risk */
            if (m.risk !== undefined) {
                if (typeof m.risk !== 'object' || m.risk === null) err(id, 'risk is not an object');
                else {
                    if (typeof m.risk.dmg !== 'number' || m.risk.dmg < 0 || m.risk.dmg > 200) {
                        err(id, 'risk.dmg out of range 0..200');
                    }
                    if (typeof m.risk.stun !== 'number' || m.risk.stun < 0 || m.risk.stun > 200) {
                        err(id, 'risk.stun out of range 0..200');
                    }
                }
            }

            /* audio and fx must name something */
            if (typeof m.sfx !== 'string' || !m.sfx.length) err(id, 'missing sfx');
            else if (moves.SFX.indexOf(m.sfx) < 0) err(id, 'sfx "' + m.sfx + '" is not in moves.SFX');
            if (typeof m.fx !== 'string' || !m.fx.length) err(id, 'missing fx');
            else if (moves.FX.indexOf(m.fx) < 0) err(id, 'fx "' + m.fx + '" is not in moves.FX');

            /* tags and classes */
            if (m.tags !== undefined) {
                if (!Array.isArray(m.tags)) err(id, 'tags is not an array');
                else m.tags.forEach(function (t) {
                    if (typeof t !== 'string' || !t.length) err(id, 'tags holds a non-string');
                });
            }
            if (m.classes !== undefined) {
                if (!Array.isArray(m.classes) || !m.classes.length) {
                    err(id, 'classes is not a non-empty array');
                } else m.classes.forEach(function (c) {
                    if (moves.CLASSES.indexOf(c) < 0) err(id, 'unknown class "' + c + '"');
                });
            }

            var tags = m.tags || [];

            /* the two rules that make a finisher a finisher */
            if (tags.indexOf('finisher') >= 0) {
                if (m.spirit !== 1000) err(id, 'a finisher must cost a full meter (spirit 1000)');
                if (m.startup < 20) err(id, 'a finisher must have 20+ startup frames to be interruptible');
                if (m.dmg < 120 || m.dmg > 200) err(id, 'finisher dmg ' + m.dmg + ' outside 120..200');
                if (!m.classes) err(id, 'a finisher needs `classes` for roster.random');
            }
            if (tags.indexOf('signature') >= 0) {
                if (m.spirit !== 300) err(id, 'a signature must cost spirit 300');
                if (!m.classes) err(id, 'a signature needs `classes` for roster.random');
            }

            /* the pin's three count */
            if (m.kind === 'pin') {
                var c = m.count;
                if (!c) err(id, 'a pin needs a `count` block');
                else if (!(c.one > 0 && c.two > c.one && c.three > c.two)) {
                    err(id, 'count must be ascending one < two < three');
                } else if (m.active !== c.three) {
                    err(id, 'active (' + m.active + ') should equal count.three (' + c.three + ')');
                }
            }
        });

        /* every SETS slot must resolve */
        Object.keys(moves.SETS).forEach(function (set) {
            var slots = moves.SETS[set];
            moves.DIRS.forEach(function (dir) {
                if (slots[dir] === undefined) {
                    bad.push('SETS.' + set + ': missing direction ' + dir);
                    return;
                }
                moves.TIERS.forEach(function (tier) {
                    var id = moves.pick(null, set, dir, tier);
                    if (!id) bad.push('SETS.' + set + '.' + dir + '.' + tier + ': resolves to nothing');
                    else if (!moves.TABLE[id]) {
                        bad.push('SETS.' + set + '.' + dir + '.' + tier + ': unknown move "' + id + '"');
                    }
                });
            });
        });

        /* every signature and finisher must be reachable by at least one class */
        ['signature', 'finisher'].forEach(function (tag) {
            moves.CLASSES.forEach(function (wc) {
                if (moves.forClass(tag, wc).length === 0) {
                    bad.push('no ' + tag + ' is legal for weight class "' + wc + '"');
                }
            });
        });

        return bad;
    };

    window.moves = moves;
})();
