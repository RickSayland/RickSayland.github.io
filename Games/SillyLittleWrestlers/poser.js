/* =============================================================================
   SLWF - poser.js
   The wrestler frame generator. There are no image assets in this game: every
   one of the ~116 pose-frames x 3 views is rasterized here, as a 48x48 array of
   palette indices, from a small skeleton.

   Why a skeleton and not pixels: nine characters x 116 frames x 3 views is
   3,132 frames. Hand-authored that is a spritesheet nobody can tune; generated
   it is one pose table of joint positions that a human can read and move by a
   pixel. The same pixels recolour into any wrestler because the only colours
   written are the sixteen contract indices from DESIGN.md -- roster.js fills
   those slots per character, so "a character" is five colours plus the style
   object, never art.

   Three things in here are load-bearing:

   * The pose tables are a *3-D* skeleton (x lateral, y up, z forward), and the
     three views are three projections of it. Authoring `side` and then redrawing
     `front` by hand is 232 extra frames of work and they drift out of agreement
     the first time a pose is tuned. Projecting one table cannot drift.

   * Prone poses are authored in a second mode (`flat`), where the long axis is
     screen-horizontal, because a body lying along the depth axis is correct and
     unreadable -- front view would show a foreshortened blob. `lay()` rotates
     the standing skeleton into the screen plane, so a knockdown is one angle.

   * The outline is a separate pass over the FINISHED pixels, not part of any
     shape. The play area sits over a cheering crowd; an un-outlined 48px figure
     disappears into it. Doing it last is what makes the outline wrap hair,
     trunks and boots as one silhouette instead of each part being ringed.

   Determinism: no Math.random anywhere. Stubble and hair texture scatter come
   from hash2() of the pixel position plus the style, so a style always
   generates identical pixels and the check harness can compare two renders
   byte for byte.

   ---------------------------------------------------------------------------
   PAIRED-POSE OFFSET TABLE  (also exposed as poser.PAIR)

   The `held*`, `*Bottom` and `subTaken` poses are the victim half of a paired
   move. Each is drawn as its own wrestler with its own palette, so each must
   stand alone in its 48x48 box. These are the offsets the integrator applies to
   the VICTIM's anchor, relative to the ATTACKER's anchor, in screen pixels,
   with +dx meaning "in the attacker's facing direction" and -dy meaning "up".
   `flip` is the victim's facing relative to the attacker's: 'face' = victim
   drawn mirrored (facing the attacker), 'same' = victim drawn with the
   attacker's own flip. `under` means draw the victim FIRST (behind).

     attacker pose   victim pose      dx    dy   flip   under
     -------------   -----------      --    --   ----   -----
     holdFront       heldFront       +14     0   face   no
     holdRear        heldRear        +10     0   same   no
     tieup           tieup           +17     0   face   no     (mirror image)
     slam  f2/f3     heldUp           +2    -8   face   no
     powerbomb f2    heldUp           +2    -8   face   no
     powerbomb f0/f1 heldInverted     +9    -4   face   no
     suplex f0/f1    heldFront       +13     0   face   no
     suplex f2/f3    heldInverted     +6   -10   same   no
     ddt   f0/f1     heldFront       +12     0   face   no
     throwWhip f0    heldFront       +14     0   face   no
     pinTop          pinBottom        +3     0   same   YES
     subApply        subTaken        +14     0   face   YES

   The numbers are a starting point measured off the pose tables below, not a
   law -- tune dx first, it is the one that reads wrong immediately.
   ============================================================================= */
(function () {
    'use strict';

    var poser = {};

    poser.VERSION = '0.1.0';

    /* ===================================================================== */
    /* GEOMETRY CONTRACT                                                     */
    /* ===================================================================== */

    // 96x96. The skeleton below is still authored in the same body units --
    // one unit was one pixel at 48 -- and SCALE is applied once, in
    // scalesOf(), so every radius and every joint position follows without a
    // single pose number changing. The rasterizer is analytic, so this is
    // genuinely more detail rather than a pixel-doubling.
    poser.SCALE = core.VIEW;
    poser.FW = 48 * poser.SCALE;
    poser.FH = 48 * poser.SCALE;
    poser.AX = 24 * poser.SCALE;
    poser.AY = poser.FH - 1;

    var FW = 48, FH = 48, AX = 24;

    // Body pixels bottom out one row ABOVE the anchor so the outline pass has
    // somewhere to put the sole's own outline -- the figure's visible bottom,
    // outline included, then lands exactly on the anchor row.
    var GY = poser.FH - 2;

    /* ===================================================================== */
    /* TUNABLES -- projection                                                */
    /* ===================================================================== */

    // Front/back view is a slight oblique rather than a true orthographic
    // front: a limb reaching toward the camera gets this much screen offset per
    // unit of forward reach. At 0 a front-view jab is a fist-sized dot on the
    // chest and reads as nothing; at 0.45 it reads as a punch.
    var SKEW = 0.45;

    // Profile view separates the near and far limb by this much per unit of
    // lateral offset. Without it both legs project to the same screen column in
    // a square stance and the figure looks one-legged.
    var STAGGER = 0.26;

    // Light direction in screen space (y down), so this is up-and-left.
    var LX = -0.60, LY = -0.80;

    // Tone band edges, as the dot of the surface offset with the light.
    var LIT = 0.33, DARK = -0.30;
    var R_LIT = 2.00;   // a limb thinner than this gets no light tone
    var R_DARK = 1.30;  // ...nor this, no shadow tone either: mush at 48px

    // Toward-camera limbs thicken very slightly in front/back view. The
    // hardware cannot scale a sprite, but a fist coming at you may be fatter.
    var DEPTH_FAT = 0.022, DEPTH_FAT_MAX = 0.26;

    /* ===================================================================== */
    /* TUNABLES -- builds                                                    */
    /* ===================================================================== */

    // ms = lateral/forward position scale (reach and stance width)
    // hs = vertical scale (height)
    // bs = limb radius scale (bulk)
    // Height is kept inside +-8.5% because the head and hair have to stay in
    // the box: a 'super' at tall=+1 already puts the hair's outline on row 1.
    var BUILDS = {
        light: { ms: 0.92, hs: 0.970, bs: 0.84 },
        cruiser: { ms: 1.00, hs: 1.000, bs: 1.00 },
        heavy: { ms: 1.10, hs: 1.025, bs: 1.20 },
        super: { ms: 1.18, hs: 1.050, bs: 1.42 }
    };
    var TALL_STEP = 0.035;    // per unit of style.tall

    /* ===================================================================== */
    /* TUNABLES -- the base skeleton                                         */
    /* ===================================================================== */

    /* Joint positions in body units. One unit is one pixel at cruiser build.
       Axes:  x = lateral, +x is the FAR side in profile
              y = up from the floor, 0 = soles
              z = forward, the direction the wrestler faces

       Limbs are named A and B rather than left/right, because which is which
       depends on the view and "left" would be a lie in two of the three:
         A  (x negative) = NEAR the camera in profile. The lead hand, the lead
                           foot, the limb that does the visible work.
         B  (x positive) = FAR side in profile.

       Total standing height is 38.1 units (head top), which at cruiser puts
       the hair's outline near row 6 and the soles' outline on row 47 -- the
       ~40px figure a 320x224 screen with a WrestleFest camera wants. */
    var BASE = {
        pel: [0.0, 19.0, 0.0],   // pelvis
        wst: [0.0, 22.0, 0.0],   // waist
        cst: [0.0, 27.3, 0.0],   // chest / top of torso
        nek: [0.0, 29.0, 0.0],   // base of skull
        hed: [0.0, 33.4, 0.0],   // head centre

        shA: [-4.4, 27.0, 0.0], shB: [4.4, 27.0, 0.0],
        elA: [-5.3, 22.2, 0.6], elB: [5.3, 22.2, 0.6],
        haA: [-5.4, 17.0, 1.2], haB: [5.4, 17.0, 1.2],

        hiA: [-2.3, 18.3, 0.0], hiB: [2.3, 18.3, 0.0],
        knA: [-2.6, 9.6, 0.4], knB: [2.6, 9.6, 0.4],
        ftA: [-2.8, 1.3, 0.8], ftB: [2.8, 1.3, 0.8]
    };
    poser.BASE = BASE;

    var JOINTS = ['pel', 'wst', 'cst', 'nek', 'hed', 'shA', 'shB', 'elA', 'elB',
        'haA', 'haB', 'hiA', 'hiB', 'knA', 'knB', 'ftA', 'ftB'];

    var PIVY = BASE.pel[1];   // lay() rotates about the pelvis

    /* ===================================================================== */
    /* TUNABLES -- limb radii, in body units before bs                       */
    /* ===================================================================== */

    var R = {
        torsoPel: 4.00, torsoCst: 5.20, shoulder: 3.00, neck: 1.90,
        thighTop: 3.00, thighBot: 2.45, shinTop: 2.30, shinBot: 1.75,
        foot: 1.70, toe: 1.45, toeLen: 2.60,
        armTop: 2.45, armMid: 2.00, foreTop: 2.00, foreBot: 1.55,
        fist: 2.25,                      // deliberately big: readability
        headRx: 4.50, headRy: 4.70
    };

    // Boot top as a fraction along ankle->knee, or past the knee into the thigh
    // for the knee-high pair.
    var BOOT_TOP = [0.42, 0.92, 1.26];

    /* ===================================================================== */
    /* MATERIALS -- the palette index contract from DESIGN.md                */
    /* ===================================================================== */

    //                    shadow  base  light
    var SKIN = { sh: 2, base: 3, lt: 4 };
    var HAIR = { sh: 5, base: 6, lt: 6 };   // only two hair slots exist
    var TRUNK = { sh: 7, base: 8, lt: 9 };
    var BOOT = { sh: 10, base: 11, lt: 11 };  // only two boot slots exist
    var ACC = { sh: 12, base: 12, lt: 12 };  // tape, trim, logo: flat
    var OUTL = 1, WHITE = 15;

    /* ===================================================================== */
    /* STYLE                                                                 */
    /* ===================================================================== */

    var DEF_STYLE = {
        build: 'cruiser', tall: 0, hair: 1, mask: 0, beard: 0, boots: 1
    };

    // The character-select screen calls in before the roster is built, so a
    // missing or half-filled style must not throw.
    function norm(st) {
        st = st || {};
        var b = st.build;
        if (!BUILDS[b]) b = DEF_STYLE.build;
        return {
            build: b,
            tall: clampI(st.tall, -1, 1, 0),
            hair: clampI(st.hair, 0, 8, DEF_STYLE.hair),
            mask: clampI(st.mask, 0, 3, 0),
            beard: clampI(st.beard, 0, 2, 0),
            boots: clampI(st.boots, 0, 2, DEF_STYLE.boots)
        };
    }
    function clampI(v, lo, hi, dflt) {
        v = (typeof v === 'number' && isFinite(v)) ? (v | 0) : dflt;
        return v < lo ? lo : (v > hi ? hi : v);
    }

    poser.normStyle = norm;

    poser.styleKey = function (st) {
        var s = norm(st);
        return s.build.charAt(0) + s.tall + '.' + s.hair + s.mask + s.beard + s.boots;
    };

    // Derived per-style scalars, cached by key: every frame of a style needs
    // them and they are four multiplies to work out.
    var scaleCache = Object.create(null);
    function scalesOf(s) {
        var k = s.build + ':' + s.tall;
        var c = scaleCache[k];
        if (c) return c;
        var b = BUILDS[s.build], S = poser.SCALE;
        // SCALE rides on all four, which is the whole of the resolution
        // change as far as the figure is concerned: positions and radii both
        // come through here.
        c = {
            ms: b.ms * S,
            hs: (b.hs + s.tall * TALL_STEP) * S,
            bs: b.bs * S,
            // Heads stay round: scaling them by ms would give a super a head
            // wider than it is tall.
            hd: (1 + (b.bs - 1) * 0.35) * S
        };
        scaleCache[k] = c;
        return c;
    }

    /* ===================================================================== */
    /* POSE AUTHORING HELPERS                                                */
    /* ===================================================================== */

    // Merge an override object onto the base skeleton. Overrides are ABSOLUTE
    // positions, not deltas -- a delta table is shorter to write and impossible
    // to read six months later.
    function merged(ov) {
        var out = {}, k;
        for (var i = 0; i < JOINTS.length; i++) { k = JOINTS[i]; out[k] = BASE[k]; }
        for (k in ov) { if (k.charAt(0) !== '_') out[k] = ov[k]; }
        out._flat = !!ov._flat;
        out._fwd = ov._fwd || null;
        out._face = ov._face || null;
        return out;
    }

    /* Rotate the whole standing skeleton into the screen plane.

       ang: degrees of tilt. 0 is standing; 90 puts the head at screen-left and
            the feet at screen-right; -90 is the mirror of that.
       ox, oy: where the pelvis lands, in authoring units (oy is height off the
            floor, so a body on the mat wants oy near its own torso radius).
       roll: +1 face-up / face-forward, -1 rolled over (face into the mat).
       post: joints to overwrite AFTER the rotation, given in (u, v, w) --
            u = screen horizontal, v = up, w = lateral depth. This is where
            limbs get splayed, because a rotated standing pose has its arms
            tucked against the body and a downed wrestler's do not.

       Output frames carry _flat, so the projector knows u/v/w and not x/y/z. */
    function lay(ang, ox, oy, roll, post) {
        var t = ang * Math.PI / 180, s = Math.sin(t), c = Math.cos(t);
        var out = {}, k;
        for (var i = 0; i < JOINTS.length; i++) {
            k = JOINTS[i];
            var j = BASE[k];
            var x = j[0] * roll, y = j[1], z = j[2] * roll;
            out[k] = [
                ox + (y - PIVY) * (-s) + z * c,
                oy + (y - PIVY) * c + z * s,
                x
            ];
        }
        if (post) for (k in post) out[k] = post[k];
        out._flat = true;
        // The body's forward axis, in the same (u,v,w) space, so the face knows
        // which way it is looking after an arbitrary tilt.
        out._fwd = [c * roll, s * roll, 0];
        return out;
    }

    /* ===================================================================== */
    /* PROCEDURAL CYCLES                                                     */
    /* ===================================================================== */

    /* idle, walk, run, limp and entrance are generated rather than tabled:
       a six-frame walk is one sine and five numbers, and tuning the stride by
       hand across six frames x three views is how a walk ends up limping. */

    // --- idle: a breath, a weight shift, hands live ------------------------
    var IDLE = { breath: 0.42, sway: 0.55, handZ: 1.9 };
    function genIdle(i, n) {
        var a = (i / n) * Math.PI * 2;
        var b = Math.sin(a) * IDLE.breath;          // chest rise
        var w = Math.cos(a) * IDLE.sway;            // weight shift
        return {
            pel: [w * 0.5, 19.0 - b * 0.2, 0],
            wst: [w * 0.4, 22.0 + b * 0.3, 0],
            cst: [w * 0.2, 27.3 + b, 0.3],
            nek: [w * 0.15, 29.0 + b, 0.3],
            hed: [w * 0.1, 33.4 + b, 0.5],
            shA: [-4.5, 27.0 + b, 0.2], shB: [4.5, 27.0 + b, 0.2],
            elA: [-5.7, 22.2 + b * 0.6, 1.1], elB: [5.7, 22.2 + b * 0.6, 1.1],
            haA: [-5.9, 16.9 + b * 0.3, IDLE.handZ], haB: [5.9, 16.9 + b * 0.3, IDLE.handZ],
            hiA: [-2.6, 18.3, 0], hiB: [2.6, 18.3, 0],
            knA: [-3.0, 9.4, 0.7], knB: [3.0, 9.4, 0.1],
            ftA: [-3.4, 1.3, 1.4], ftB: [3.4, 1.3, -0.7]
        };
    }

    // --- walk / run / entrance: one cycle, three parameter sets -----------
    //  stride : foot travel in z, peak to peak is 2x this
    //  lift   : how high the trailing foot comes up
    //  bob    : vertical bounce of the whole upper body
    //  lean   : forward lean of the chest
    //  swing  : hand travel in z, counter-phase to the legs
    //  armY   : hand height (a run pumps its arms higher than a walk)
    //  crouch : how much lower the hips ride
    //  roll   : shoulder roll, which is all the entrance swagger really is
    var GAITS = {
        walk: { stride: 4.6, lift: 2.4, bob: 0.55, lean: 0.7, swing: 3.4, armY: 17.2, crouch: 0.0, roll: 0.3, wide: 0.0 },
        run: { stride: 6.6, lift: 3.8, bob: 1.00, lean: 2.4, swing: 5.2, armY: 19.6, crouch: 0.9, roll: 0.5, wide: 0.0 },
        entrance: { stride: 3.8, lift: 1.9, bob: 0.70, lean: -0.6, swing: 2.2, armY: 16.6, crouch: 0.0, roll: 1.6, wide: 1.7 }
    };
    function genGait(g, i, n) {
        var a = (i / n) * Math.PI * 2;
        var sa = Math.sin(a), ca = Math.cos(a);
        var liftA = Math.max(0, Math.sin(a + 1.15)), liftB = Math.max(0, Math.sin(a + 1.15 + Math.PI));
        var bob = (Math.abs(ca) - 0.5) * g.bob;
        var f = {
            pel: [ca * 0.3, 19.0 - g.crouch + bob * 0.5, g.lean * 0.25],
            wst: [ca * 0.2, 22.0 - g.crouch * 0.7 + bob * 0.7, g.lean * 0.5],
            cst: [0, 27.3 - g.crouch * 0.3 + bob, g.lean],
            nek: [0, 29.0 - g.crouch * 0.2 + bob, g.lean * 1.05],
            hed: [0, 33.4 - g.crouch * 0.1 + bob, g.lean * 1.15],

            shA: [-4.4 - g.wide * 0.3, 27.0 + bob, g.lean * 0.9 - ca * g.roll],
            shB: [4.4 + g.wide * 0.3, 27.0 + bob, g.lean * 0.9 + ca * g.roll],
            elA: [-5.3 - g.wide, 22.2 + bob * 0.6 + (g.armY - 17.0) * 0.45, 0.6 - sa * g.swing * 0.45],
            elB: [5.3 + g.wide, 22.2 + bob * 0.6 + (g.armY - 17.0) * 0.45, 0.6 + sa * g.swing * 0.45],
            haA: [-5.4 - g.wide * 1.2, g.armY + bob * 0.3, 1.2 - sa * g.swing],
            haB: [5.4 + g.wide * 1.2, g.armY + bob * 0.3, 1.2 + sa * g.swing],

            hiA: [-2.4, 18.3 - g.crouch + bob * 0.4, 0], hiB: [2.4, 18.3 - g.crouch + bob * 0.4, 0],
            knA: [-2.7, 9.6 - g.crouch * 0.5 + liftA * 1.3, 0.4 + sa * g.stride * 0.5],
            knB: [2.7, 9.6 - g.crouch * 0.5 + liftB * 1.3, 0.4 - sa * g.stride * 0.5],
            ftA: [-2.9, 1.3 + liftA * g.lift, 0.8 + sa * g.stride],
            ftB: [2.9, 1.3 + liftB * g.lift, 0.8 - sa * g.stride]
        };
        return f;
    }
    function genWalk(i, n) { return genGait(GAITS.walk, i, n); }
    function genRun(i, n) { return genGait(GAITS.run, i, n); }
    function genEntrance(i, n) { return genGait(GAITS.entrance, i, n); }

    // --- limp: a short stride on the bad leg, and the body drops onto it ---
    // Low stamina shows as this (DESIGN.md: the player reads the body, not a
    // meter) so it has to be obvious from the silhouette: asymmetric stride,
    // a dip, and a hand on the hip.
    var LIMP = { badStride: 1.6, goodStride: 4.4, dip: 1.7, lift: 1.1 };
    function genLimp(i, n) {
        var a = (i / n) * Math.PI * 2;
        var sa = Math.sin(a);
        var onBad = Math.max(0, -Math.cos(a));         // 1 when weight is on A
        var dip = onBad * LIMP.dip;
        var liftA = Math.max(0, Math.sin(a + 1.15)), liftB = Math.max(0, Math.sin(a + 1.15 + Math.PI));
        return {
            pel: [0.4, 19.0 - dip, -0.4],
            wst: [0.5, 22.0 - dip, 0.4],
            cst: [0.6, 27.3 - dip * 0.9, 1.8],
            nek: [0.5, 29.0 - dip * 0.9, 2.0],
            hed: [0.4, 33.1 - dip * 0.9, 2.4],
            shA: [-4.2, 27.0 - dip * 0.9, 1.4], shB: [4.6, 27.0 - dip * 0.9, 1.8],
            elA: [-5.0, 22.0 - dip, 0.4], elB: [5.6, 22.4 - dip * 0.8, 1.0],
            haA: [-3.6, 18.4 - dip, 0.6],                 // hand braced on the hip
            haB: [5.8, 17.0 - dip * 0.6, 1.6 + sa * 1.8],
            hiA: [-2.5, 18.3 - dip, 0], hiB: [2.5, 18.3 - dip, 0],
            knA: [-2.8, 9.2 - dip * 0.5 + liftA * 0.6, 0.4 + sa * LIMP.badStride * 0.5],
            knB: [2.8, 9.6 + liftB * 1.3, 0.4 - sa * LIMP.goodStride * 0.5],
            ftA: [-3.0, 1.3 + liftA * LIMP.lift, 0.8 + sa * LIMP.badStride],
            ftB: [3.0, 1.3 + liftB * 2.3, 0.8 - sa * LIMP.goodStride]
        };
    }

    /* ===================================================================== */
    /* POSE TABLE -- the part a human tunes                                  */
    /* ===================================================================== */
    /* Every entry is either `gen` (a cycle function above) or `f`, a list of
       frames. A frame lists only the joints that move; everything else comes
       from BASE. Positions are absolute, in the units at the top of this file.

       `face` overrides what the head shows: 'hide' (we are looking at the back
       of the skull), 'closed' (out cold). Default follows the view.

       Readability beats anatomy throughout. A jab has to be a jab from the
       silhouette at 2x zoom, so the stances are wider, the fists bigger and
       the arcs deeper than a person's would be. */
    var POSE = {

        /* ---- locomotion ------------------------------------------------- */
        idle: { n: 4, gen: genIdle },
        walk: { n: 6, gen: genWalk },
        run: { n: 6, gen: genRun },
        limp: { n: 4, gen: genLimp },
        entrance: { n: 6, gen: genEntrance },

        /* ---- guard ------------------------------------------------------ */
        // Forearms crossed high and in front, knees loaded. The crossed arms
        // are the whole silhouette read: nothing else in the game puts both
        // hands on the centre line above the chest.
        block: {
            n: 1, f: [{
                pel: [0, 17.6, 0.6], wst: [0, 20.6, 0.6], cst: [0, 25.8, 1.2],
                nek: [0, 27.4, 1.0], hed: [0, 31.6, 1.4],
                shA: [-4.2, 25.6, 0.8], shB: [4.2, 25.6, 0.8],
                elA: [-4.8, 22.4, 3.4], elB: [4.8, 22.4, 3.2],
                haA: [-1.4, 25.6, 6.2], haB: [1.8, 24.0, 6.4],
                hiA: [-2.6, 16.9, 0], hiB: [2.6, 16.9, 0],
                knA: [-3.2, 8.8, 1.4], knB: [3.2, 8.8, 1.0],
                ftA: [-3.4, 1.3, 1.6], ftB: [3.4, 1.3, 0.2]
            }]
        },

        /* ---- strikes ---------------------------------------------------- */
        // jabA: the lead (near) hand. Cocked at the chin, out at shoulder
        // height, half-retracted. Three frames is all a 4-frame startup needs.
        jabA: {
            n: 3, f: [{
                shA: [-4.2, 27.2, -0.8], elA: [-5.2, 23.4, -1.4], haA: [-3.2, 25.0, 1.4],
                shB: [4.4, 26.8, 1.6], elB: [5.2, 23.2, 1.0], haB: [3.4, 24.6, 2.6],
                cst: [0, 27.2, -0.5], hed: [0, 33.3, 0.4],
                ftA: [-3.2, 1.3, 2.2], ftB: [3.4, 1.3, -1.6],
                knA: [-3.0, 9.3, 1.4], knB: [3.2, 9.3, -0.8]
            }, {
                shA: [-4.0, 27.1, 1.2], elA: [-4.4, 26.5, 6.6], haA: [-4.0, 26.7, 12.6],
                shB: [4.4, 26.6, -1.4], elB: [5.2, 23.0, -1.0], haB: [3.6, 24.4, 1.2],
                cst: [0, 27.2, 1.0], wst: [0, 22.0, 0.5], nek: [0, 29.0, 0.8], hed: [0, 33.3, 1.2],
                ftA: [-3.2, 1.3, 3.4], ftB: [3.4, 1.3, -1.8],
                knA: [-3.0, 9.4, 2.0], knB: [3.2, 9.3, -1.0]
            }, {
                shA: [-4.1, 27.1, 0.4], elA: [-4.8, 24.6, 3.2], haA: [-4.4, 24.6, 6.6],
                shB: [4.4, 26.7, 0.4], elB: [5.2, 23.1, 0.4], haB: [3.5, 24.5, 2.0],
                cst: [0, 27.2, 0.2], hed: [0, 33.3, 0.6],
                ftA: [-3.2, 1.3, 2.6], ftB: [3.4, 1.3, -1.6],
                knA: [-3.0, 9.3, 1.6], knB: [3.2, 9.3, -0.9]
            }]
        },

        // jabB: the rear hand, which means the torso has to rotate or the arm
        // is hidden behind the chest in profile. shB swings from x 4.2 to 2.4
        // as it comes through -- that rotation is the punch.
        jabB: {
            n: 3, f: [{
                shB: [4.2, 27.0, -2.2], elB: [5.4, 23.6, -2.6], haB: [4.0, 25.2, 0.4],
                shA: [-4.0, 27.0, 1.8], elA: [-5.2, 23.4, 1.2], haA: [-4.2, 25.0, 3.0],
                cst: [0.3, 27.2, -0.6], hed: [0, 33.3, 0.2],
                ftA: [-3.2, 1.3, 1.8], ftB: [3.4, 1.3, -1.8]
            }, {
                shB: [2.4, 27.2, 2.6], elB: [2.6, 26.8, 7.6], haB: [2.2, 26.9, 12.8],
                shA: [-4.8, 26.8, -2.4], elA: [-5.6, 23.0, -2.2], haA: [-4.6, 24.8, 0.0],
                cst: [-0.4, 27.2, 1.2], wst: [-0.2, 22.0, 0.6], nek: [-0.2, 29.0, 1.0],
                hed: [-0.2, 33.3, 1.4],
                ftA: [-3.2, 1.3, 2.4], ftB: [3.2, 1.3, -1.2], knB: [3.0, 9.4, -0.4]
            }, {
                shB: [3.4, 27.1, 0.8], elB: [4.2, 25.0, 3.2], haB: [3.2, 25.6, 7.0],
                shA: [-4.4, 26.9, -0.6], elA: [-5.4, 23.2, -0.6], haA: [-4.4, 24.8, 1.4],
                cst: [0, 27.2, 0.4], hed: [0, 33.3, 0.6],
                ftA: [-3.2, 1.3, 2.0], ftB: [3.3, 1.3, -1.6]
            }]
        },

        // kick: knee up, boot out at waist height, retract. The support leg
        // straightens and the torso leans away -- the counterweight is what
        // stops a kick looking like a stumble.
        kick: {
            n: 3, f: [{
                pel: [0, 18.6, -0.6], wst: [0, 21.6, -0.8], cst: [0, 26.8, -1.2],
                nek: [0, 28.6, -1.2], hed: [0, 33.0, -1.0],
                hiA: [-2.2, 18.6, 0], knA: [-2.4, 14.6, 4.6], ftA: [-2.6, 10.6, 3.0],
                hiB: [2.4, 18.6, 0], knB: [2.8, 9.4, 0.2], ftB: [3.0, 1.3, -0.4],
                haA: [-5.2, 18.8, -2.0], elA: [-5.6, 22.6, -1.2],
                haB: [5.4, 20.2, -1.2], elB: [5.6, 23.2, -0.6]
            }, {
                pel: [0, 18.2, -1.8], wst: [0, 21.0, -2.0], cst: [0, 26.2, -2.6],
                nek: [0, 27.8, -2.6], hed: [0, 32.2, -2.4],
                hiA: [-2.2, 18.4, -0.4], knA: [-2.4, 13.8, 6.8], ftA: [-2.6, 12.6, 12.4],
                hiB: [2.4, 18.2, -0.4], knB: [2.8, 9.2, -0.8], ftB: [3.0, 1.3, -1.2],
                haA: [-5.4, 17.0, -3.8], elA: [-5.8, 21.6, -2.6],
                haB: [5.6, 19.4, -2.6], elB: [5.8, 22.8, -1.6]
            }, {
                pel: [0, 18.6, -1.0], wst: [0, 21.6, -1.0], cst: [0, 26.8, -1.4],
                nek: [0, 28.6, -1.4], hed: [0, 33.0, -1.2],
                hiA: [-2.2, 18.6, 0], knA: [-2.4, 12.8, 5.0], ftA: [-2.6, 7.8, 6.6],
                hiB: [2.4, 18.6, 0], knB: [2.8, 9.4, 0], ftB: [3.0, 1.3, -0.6],
                haA: [-5.2, 18.4, -2.2], haB: [5.4, 20.0, -1.4]
            }]
        },

        // bigStrike: the lariat. Wound right back behind the shoulder line,
        // through, and a follow-through that carries across the body. The
        // commitment is the point -- four frames of it.
        bigStrike: {
            n: 4, f: [{
                shA: [-3.6, 27.3, -4.0], elA: [-6.4, 25.4, -5.6], haA: [-7.0, 27.8, -6.4],
                shB: [4.6, 26.8, 2.4], elB: [5.4, 23.0, 2.4], haB: [4.6, 20.0, 3.0],
                cst: [0.4, 27.2, -1.6], wst: [0.3, 22.0, -0.8], nek: [0.3, 29.0, -1.6],
                hed: [0.6, 33.4, -1.8],
                knA: [-3.0, 9.0, 0.8], knB: [3.2, 9.0, -0.4],
                ftA: [-3.4, 1.3, -1.0], ftB: [3.6, 1.3, 1.8]
            }, {
                shA: [-4.4, 27.4, 0.2], elA: [-6.6, 26.8, 2.8], haA: [-6.2, 28.2, 8.0],
                shB: [4.4, 26.8, 0.4], elB: [5.4, 23.0, 0.6], haB: [4.8, 19.6, 1.0],
                cst: [0.2, 27.2, 0.6], nek: [0.2, 29.0, 0.6], hed: [0.2, 33.3, 0.8],
                knA: [-3.0, 9.2, 1.6], knB: [3.2, 9.2, 0.2],
                ftA: [-3.4, 1.3, 0.8], ftB: [3.6, 1.3, 1.2]
            }, {
                shA: [-4.2, 27.2, 2.6], elA: [-4.8, 27.0, 7.4], haA: [-3.2, 26.6, 12.2],
                shB: [4.0, 26.6, -2.8], elB: [5.6, 22.8, -3.4], haB: [5.2, 18.6, -2.2],
                cst: [-0.4, 27.2, 2.0], wst: [-0.2, 22.0, 1.0], nek: [-0.3, 29.0, 1.8],
                hed: [-0.6, 33.2, 2.2],
                knA: [-3.0, 9.4, 2.4], knB: [3.2, 9.2, -0.8],
                ftA: [-3.2, 1.3, 3.0], ftB: [3.6, 1.3, -1.4]
            }, {
                shA: [-3.2, 27.0, 1.6], elA: [-2.4, 26.2, 7.0], haA: [0.8, 24.6, 10.0],
                shB: [4.2, 26.6, -1.6], elB: [5.6, 22.8, -2.2], haB: [5.2, 18.8, -1.4],
                cst: [-0.6, 27.0, 1.2], nek: [-0.6, 28.8, 1.2], hed: [-0.8, 33.0, 1.6],
                knA: [-3.0, 9.3, 2.0], knB: [3.2, 9.2, -0.6],
                ftA: [-3.2, 1.3, 2.6], ftB: [3.6, 1.3, -1.0]
            }]
        },

        // runAttack: the clothesline. Mid-stride legs, arm locked out level,
        // body thrown forward over the lead foot.
        runAttack: {
            n: 3, f: [{
                pel: [0, 18.4, 1.6], wst: [0, 21.4, 2.6], cst: [0, 26.6, 3.8],
                nek: [0, 28.2, 4.0], hed: [0, 32.4, 4.6],
                shA: [-4.2, 26.6, 4.0], elA: [-5.6, 25.2, 1.0], haA: [-6.0, 26.4, -2.6],
                shB: [4.4, 26.4, 3.6], elB: [5.6, 22.6, 5.6], haB: [4.8, 20.0, 8.4],
                knA: [-2.8, 10.6, 3.4], ftA: [-3.0, 3.6, 6.0],
                knB: [2.8, 9.2, -2.4], ftB: [3.0, 1.3, -5.2]
            }, {
                pel: [0, 18.2, 2.0], wst: [0, 21.2, 3.0], cst: [0, 26.4, 4.2],
                nek: [0, 28.0, 4.4], hed: [0, 32.2, 5.0],
                shA: [-4.4, 26.8, 3.2], elA: [-4.6, 26.6, 7.8], haA: [-4.2, 26.4, 12.4],
                shB: [4.4, 26.2, 2.6], elB: [5.6, 22.4, 4.0], haB: [5.0, 19.4, 6.4],
                knA: [-2.8, 11.6, 1.0], ftA: [-3.0, 5.2, 2.0],
                knB: [2.8, 9.4, -1.0], ftB: [3.0, 1.3, -3.6]
            }, {
                pel: [0, 18.6, 1.8], wst: [0, 21.6, 2.8], cst: [0, 26.8, 4.0],
                nek: [0, 28.4, 4.2], hed: [0, 32.6, 4.8],
                shA: [-4.4, 26.8, 3.4], elA: [-4.8, 26.4, 7.6], haA: [-4.4, 26.2, 12.2],
                shB: [4.4, 26.4, 3.0], elB: [5.6, 22.6, 4.6], haB: [4.8, 19.8, 7.2],
                knA: [-2.8, 9.6, -1.6], ftA: [-3.0, 1.3, -4.2],
                knB: [2.8, 10.8, 3.0], ftB: [3.0, 3.2, 5.6]
            }]
        },

        // chop: up and over, the big flat-hand shot. Open hand, whole arm.
        chop: {
            n: 3, f: [{
                shA: [-4.0, 27.6, -1.2], elA: [-6.6, 31.0, -1.6], haA: [-7.2, 34.4, -1.0],
                shB: [4.4, 26.8, 1.0], haB: [5.2, 19.2, 2.0],
                cst: [0.2, 27.4, -0.8], hed: [0.2, 33.4, -0.6],
                ftA: [-3.2, 1.3, 1.4], ftB: [3.4, 1.3, -1.0]
            }, {
                shA: [-4.2, 27.4, 0.6], elA: [-6.2, 28.4, 3.6], haA: [-6.0, 27.0, 8.0],
                shB: [4.4, 26.6, -0.6], haB: [5.2, 19.0, 1.0],
                cst: [0, 27.3, 0.8], hed: [0, 33.3, 1.0],
                ftA: [-3.2, 1.3, 2.2], ftB: [3.4, 1.3, -1.2]
            }, {
                shA: [-4.2, 27.0, 1.4], elA: [-5.2, 24.4, 5.4], haA: [-4.6, 21.0, 9.4],
                shB: [4.4, 26.6, -1.0], haB: [5.2, 19.0, 0.6],
                cst: [0, 27.1, 1.0], hed: [0, 33.1, 1.2],
                ftA: [-3.2, 1.3, 2.4], ftB: [3.4, 1.3, -1.2]
            }]
        },

        /* ---- grappling: the attacker's side ----------------------------- */
        // tieup: both hands out at collar height, head down, feet planted
        // wide. Two frames of shove so a lock-up is not a freeze-frame.
        tieup: {
            n: 2, f: [{
                pel: [0, 18.4, 0.6], wst: [0, 21.4, 1.0], cst: [0, 26.6, 2.0],
                nek: [0, 28.0, 2.2], hed: [0, 32.0, 3.0],
                shA: [-4.2, 26.4, 2.2], elA: [-5.4, 24.2, 4.6], haA: [-4.2, 25.8, 7.6],
                shB: [4.2, 26.4, 2.2], elB: [5.4, 24.2, 4.6], haB: [4.2, 25.8, 7.6],
                hiA: [-2.8, 18.2, 0], hiB: [2.8, 18.2, 0],
                knA: [-3.4, 9.0, 1.2], knB: [3.4, 9.0, 0.6],
                ftA: [-3.8, 1.3, 1.0], ftB: [3.8, 1.3, -0.4]
            }, {
                pel: [0, 18.0, 1.0], wst: [0, 21.0, 1.6], cst: [0, 26.2, 2.8],
                nek: [0, 27.6, 3.0], hed: [0, 31.6, 3.8],
                shA: [-4.0, 26.0, 3.0], elA: [-5.2, 23.8, 5.4], haA: [-4.0, 25.4, 8.6],
                shB: [4.0, 26.0, 3.0], elB: [5.2, 23.8, 5.4], haB: [4.0, 25.4, 8.6],
                hiA: [-2.8, 17.8, 0], hiB: [2.8, 17.8, 0],
                knA: [-3.4, 8.6, 1.4], knB: [3.4, 8.6, 0.8],
                ftA: [-3.8, 1.3, 1.2], ftB: [3.8, 1.3, -0.6]
            }]
        },

        // holdFront: the opponent is doubled over in front; both hands grip
        // down and forward at waist height. Pairs with heldFront at dx +14.
        holdFront: {
            n: 1, f: [{
                pel: [0, 18.6, 0.2], wst: [0, 21.6, 0.6], cst: [0, 26.8, 1.4],
                nek: [0, 28.4, 1.6], hed: [0, 32.4, 2.6],
                shA: [-4.2, 26.6, 1.8], elA: [-5.2, 22.8, 4.2], haA: [-3.8, 20.8, 7.2],
                shB: [4.2, 26.6, 1.8], elB: [5.2, 22.8, 4.2], haB: [3.8, 21.4, 7.4],
                knA: [-3.0, 9.2, 1.0], knB: [3.2, 9.2, 0.4],
                ftA: [-3.4, 1.3, 1.4], ftB: [3.6, 1.3, -0.6]
            }]
        },

        // holdRear: a waistlock from behind, so the hands are low and the
        // whole body is bent over the opponent's back.
        holdRear: {
            n: 1, f: [{
                pel: [0, 18.0, -0.6], wst: [0, 21.0, 0.8], cst: [0, 25.8, 2.6],
                nek: [0, 27.2, 3.2], hed: [0, 30.8, 4.6],
                shA: [-4.2, 25.6, 3.0], elA: [-5.0, 21.6, 4.8], haA: [-3.2, 16.0, 6.6],
                shB: [4.2, 25.6, 3.0], elB: [5.0, 21.6, 4.8], haB: [3.2, 16.0, 6.6],
                hiA: [-2.6, 17.8, 0], hiB: [2.6, 17.8, 0],
                knA: [-3.2, 8.8, 0.6], knB: [3.4, 8.8, 0.2],
                ftA: [-3.6, 1.3, 0.4], ftB: [3.8, 1.3, -1.2]
            }]
        },

        // throwWhip: the Irish whip. Wound across the body, swept out, and a
        // follow-through with the arm trailing -- the release is frame 1.
        throwWhip: {
            n: 3, f: [{
                shA: [-3.6, 27.2, -1.0], elA: [-3.0, 24.6, 2.0], haA: [1.6, 24.2, 3.0],
                shB: [4.6, 26.8, -1.6], elB: [5.4, 23.0, -1.4], haB: [4.8, 19.4, 0.4],
                cst: [0.6, 27.2, -0.8], hed: [0.8, 33.4, -1.0],
                ftA: [-3.2, 1.3, 0.4], ftB: [3.6, 1.3, 1.2]
            }, {
                shA: [-4.4, 27.2, 1.4], elA: [-6.0, 26.2, 5.0], haA: [-6.4, 25.4, 9.4],
                shB: [4.2, 26.6, -1.6], elB: [5.4, 22.8, -2.0], haB: [5.0, 19.0, -0.6],
                cst: [-0.2, 27.2, 1.4], nek: [-0.2, 29.0, 1.2], hed: [-0.4, 33.2, 1.6],
                ftA: [-3.2, 1.3, 2.6], ftB: [3.6, 1.3, -1.0]
            }, {
                shA: [-4.6, 26.8, 0.2], elA: [-6.8, 24.6, 2.2], haA: [-7.4, 22.4, 4.6],
                shB: [4.0, 26.6, -2.0], elB: [5.4, 22.8, -2.4], haB: [5.0, 19.0, -1.2],
                cst: [-0.4, 27.0, 0.6], hed: [-0.6, 33.0, 0.8],
                ftA: [-3.2, 1.3, 2.0], ftB: [3.6, 1.3, -1.2]
            }]
        },

        /* ---- grappling: the throws -------------------------------------- */
        // suplex: bent over the waistlock, lift, arch, land. Frame 2 is the
        // one the whole move is remembered by, so the arch is overdone: head
        // behind the heels and the hips thrown forward.
        suplex: {
            n: 4, f: [{
                pel: [0, 17.4, -1.4], wst: [0, 20.2, 0.6], cst: [0, 24.4, 3.2],
                nek: [0, 25.6, 4.4], hed: [0, 28.4, 6.2],
                shA: [-4.2, 24.8, 3.4], elA: [-5.0, 21.2, 5.6], haA: [-3.4, 18.2, 7.6],
                shB: [4.2, 24.8, 3.4], elB: [5.0, 21.2, 5.6], haB: [3.4, 18.2, 7.6],
                hiA: [-2.8, 17.2, 0], hiB: [2.8, 17.2, 0],
                knA: [-3.4, 8.4, 1.2], knB: [3.4, 8.4, 0.8],
                ftA: [-3.6, 1.3, 0.2], ftB: [3.8, 1.3, -1.0]
            }, {
                pel: [0, 19.2, -0.8], wst: [0, 22.2, 0.2], cst: [0, 26.8, 1.2],
                nek: [0, 28.2, 1.6], hed: [0, 32.0, 2.0],
                shA: [-4.2, 26.6, 1.6], elA: [-5.2, 23.4, 4.0], haA: [-3.4, 21.4, 7.0],
                shB: [4.2, 26.6, 1.6], elB: [5.2, 23.4, 4.0], haB: [3.4, 21.4, 7.0],
                hiA: [-2.8, 18.8, 0], hiB: [2.8, 18.8, 0],
                knA: [-3.2, 10.2, 0.8], knB: [3.2, 10.2, 0.4],
                ftA: [-3.4, 1.3, 0.2], ftB: [3.6, 1.3, -0.8]
            }, {
                pel: [0, 20.0, 1.6], wst: [0, 22.8, -0.6], cst: [0, 26.4, -3.8],
                nek: [0, 27.0, -5.2], hed: [0, 29.4, -8.0],
                shA: [-4.0, 26.6, -3.2], elA: [-4.8, 29.8, -1.0], haA: [-3.6, 31.8, 2.8],
                shB: [4.0, 26.6, -3.2], elB: [4.8, 29.8, -1.0], haB: [3.6, 31.8, 2.8],
                hiA: [-2.6, 19.8, 1.4], hiB: [2.6, 19.8, 1.4],
                knA: [-2.8, 10.4, 1.0], knB: [2.8, 10.4, 0.6],
                ftA: [-3.0, 1.3, -1.4], ftB: [3.2, 1.3, -2.2]
            }, {
                pel: [0, 17.6, 2.4], wst: [0, 19.6, -0.8], cst: [0, 22.0, -5.6],
                nek: [0, 22.2, -7.4], hed: [0, 23.2, -11.0],
                shA: [-4.0, 22.4, -5.0], elA: [-4.8, 25.6, -2.6], haA: [-3.8, 27.6, 1.0],
                shB: [4.0, 22.4, -5.0], elB: [4.8, 25.6, -2.6], haB: [3.8, 27.6, 1.0],
                hiA: [-2.6, 17.4, 2.2], hiB: [2.6, 17.4, 2.2],
                knA: [-3.0, 8.6, 3.0], knB: [3.0, 8.6, 2.4],
                ftA: [-3.2, 1.3, 0.2], ftB: [3.4, 1.3, -0.8]
            }]
        },

        // slam: scoop, lift, press overhead, throw down. Frame 2 pairs with
        // heldUp; frames 0 and 3 are the dip and the drive.
        slam: {
            n: 4, f: [{
                pel: [0, 17.8, -0.8], wst: [0, 20.8, 0.4], cst: [0, 25.6, 2.2],
                nek: [0, 27.0, 2.6], hed: [0, 31.0, 3.6],
                shA: [-4.2, 25.4, 2.4], elA: [-5.4, 22.0, 4.0], haA: [-4.6, 18.6, 5.6],
                shB: [4.2, 25.4, 2.4], elB: [5.0, 22.4, 4.6], haB: [3.8, 20.2, 6.6],
                knA: [-3.2, 8.6, 0.8], knB: [3.4, 8.6, 0.4],
                ftA: [-3.6, 1.3, 0.6], ftB: [3.8, 1.3, -0.8]
            }, {
                pel: [0, 18.8, -0.4], wst: [0, 21.8, 0.2], cst: [0, 26.8, 0.8],
                nek: [0, 28.4, 1.0], hed: [0, 32.6, 1.4],
                shA: [-4.2, 26.6, 1.0], elA: [-5.4, 25.2, 3.0], haA: [-4.4, 26.8, 4.4],
                shB: [4.2, 26.6, 1.0], elB: [5.2, 25.8, 3.4], haB: [3.8, 27.8, 5.0],
                knA: [-3.0, 9.6, 0.6], knB: [3.2, 9.6, 0.2],
                ftA: [-3.4, 1.3, 0.4], ftB: [3.6, 1.3, -0.8]
            }, {
                pel: [0, 19.4, -0.4], wst: [0, 22.4, -0.4], cst: [0, 27.8, -0.6],
                nek: [0, 29.4, -0.6], hed: [0, 33.6, -0.6],
                shA: [-4.2, 27.8, -0.2], elA: [-4.8, 31.2, 0.4], haA: [-4.2, 34.6, 1.0],
                shB: [4.2, 27.8, -0.2], elB: [4.8, 31.2, 0.4], haB: [4.2, 34.6, 1.0],
                knA: [-2.8, 10.4, 0.2], knB: [3.0, 10.4, 0.2],
                ftA: [-3.2, 1.3, 0.4], ftB: [3.4, 1.3, -0.4]
            }, {
                pel: [0, 17.0, 0.6], wst: [0, 20.0, 1.8], cst: [0, 24.8, 3.6],
                nek: [0, 26.0, 4.2], hed: [0, 29.6, 5.6],
                shA: [-4.2, 24.6, 3.8], elA: [-5.2, 21.4, 6.4], haA: [-4.4, 18.6, 8.6],
                shB: [4.2, 24.6, 3.8], elB: [5.2, 21.4, 6.4], haB: [4.4, 19.4, 8.8],
                hiA: [-2.8, 16.8, 0], hiB: [2.8, 16.8, 0],
                knA: [-3.4, 7.8, 1.2], knB: [3.6, 7.8, 0.8],
                ftA: [-3.8, 1.3, 0.4], ftB: [4.0, 1.3, -1.0]
            }]
        },

        // powerbomb: hands down between the legs, hoist, overhead, and the
        // drive. Frames 0-1 pair with heldInverted, frame 2 with heldUp.
        powerbomb: {
            n: 4, f: [{
                pel: [0, 15.6, -1.0], wst: [0, 18.6, 0.6], cst: [0, 23.2, 3.0],
                nek: [0, 24.6, 3.6], hed: [0, 28.2, 5.2],
                shA: [-4.2, 23.0, 3.2], elA: [-4.6, 19.0, 4.8], haA: [-3.0, 13.4, 6.2],
                shB: [4.2, 23.0, 3.2], elB: [4.6, 19.0, 4.8], haB: [3.0, 13.4, 6.2],
                hiA: [-2.8, 14.8, 0], hiB: [2.8, 14.8, 0],
                knA: [-3.6, 7.2, 1.6], knB: [3.8, 7.2, 1.2],
                ftA: [-3.8, 1.3, 0.2], ftB: [4.0, 1.3, -1.0]
            }, {
                pel: [0, 17.6, -0.6], wst: [0, 20.6, 0.2], cst: [0, 25.6, 1.4],
                nek: [0, 27.2, 1.6], hed: [0, 31.2, 2.2],
                shA: [-4.2, 25.4, 1.6], elA: [-4.8, 22.4, 3.6], haA: [-3.6, 21.6, 5.4],
                shB: [4.2, 25.4, 1.6], elB: [4.8, 22.4, 3.6], haB: [3.6, 21.6, 5.4],
                knA: [-3.2, 8.8, 1.0], knB: [3.4, 8.8, 0.6],
                ftA: [-3.6, 1.3, 0.4], ftB: [3.8, 1.3, -0.8]
            }, {
                pel: [0, 19.6, -0.2], wst: [0, 22.6, -0.4], cst: [0, 28.0, -0.6],
                nek: [0, 29.6, -0.6], hed: [0, 33.8, -0.4],
                shA: [-4.0, 28.0, -0.2], elA: [-4.2, 31.6, 0.4], haA: [-3.4, 35.0, 0.8],
                shB: [4.0, 28.0, -0.2], elB: [4.2, 31.6, 0.4], haB: [3.4, 35.0, 0.8],
                knA: [-2.8, 10.6, 0.2], knB: [3.0, 10.6, 0.2],
                ftA: [-3.0, 1.3, 0.6], ftB: [3.2, 1.3, -0.2]
            }, {
                pel: [0, 15.2, 0.8], wst: [0, 18.2, 2.2], cst: [0, 23.0, 4.0],
                nek: [0, 24.4, 4.6], hed: [0, 28.0, 6.0],
                shA: [-4.2, 22.8, 4.2], elA: [-4.8, 19.2, 6.2], haA: [-4.0, 16.0, 7.8],
                shB: [4.2, 22.8, 4.2], elB: [4.8, 19.2, 6.2], haB: [4.0, 16.0, 7.8],
                hiA: [-2.8, 14.6, 0], hiB: [2.8, 14.6, 0],
                knA: [-3.8, 7.0, 1.8], knB: [4.0, 7.0, 1.4],
                ftA: [-4.0, 1.3, 0.2], ftB: [4.2, 1.3, -1.2]
            }]
        },

        // ddt: hook the head, then fall. Frames 1-2 tip back further each
        // time and frame 3 is flat on the mat with the arm still hooked.
        ddt: {
            n: 4, f: [{
                shA: [-4.0, 27.0, 1.6], elA: [-5.2, 25.0, 3.4], haA: [-1.0, 25.4, 5.6],
                shB: [4.4, 26.8, 0.2], elB: [5.4, 23.0, 0.6], haB: [4.8, 19.4, 1.4],
                cst: [0, 27.2, 1.0], hed: [0, 33.2, 1.4],
                ftA: [-3.2, 1.3, 1.6], ftB: [3.4, 1.3, -0.8]
            }, {
                pel: [0, 18.6, -1.4], wst: [0, 21.4, -2.6], cst: [0, 26.2, -4.6],
                nek: [0, 27.6, -5.6], hed: [0, 31.2, -7.4],
                shA: [-4.0, 26.0, -3.6], elA: [-5.2, 24.2, -0.8], haA: [-1.2, 23.6, 2.0],
                shB: [4.4, 25.8, -4.8], elB: [5.4, 22.2, -4.0], haB: [4.8, 18.8, -3.0],
                knA: [-3.0, 9.0, -0.6], knB: [3.2, 9.0, -1.0],
                ftA: [-3.4, 1.3, 1.2], ftB: [3.6, 1.3, -0.6]
            }, {
                pel: [0, 15.4, -3.0], wst: [0, 17.6, -5.6], cst: [0, 20.6, -9.6],
                nek: [0, 21.4, -11.2], hed: [0, 23.6, -14.6],
                shA: [-4.0, 20.8, -8.2], elA: [-5.0, 19.6, -4.8], haA: [-1.6, 19.0, -2.0],
                shB: [4.4, 20.4, -9.8], elB: [5.2, 17.6, -8.0], haB: [4.8, 14.8, -6.4],
                hiA: [-2.6, 15.0, -2.4], hiB: [2.6, 15.0, -2.4],
                knA: [-3.0, 7.4, 1.6], knB: [3.2, 7.4, 1.0],
                ftA: [-3.4, 1.3, 1.8], ftB: [3.6, 1.3, 0.4]
            }],
            f3flat: true
        },

        /* ---- grappling: the victim's side ------------------------------- */
        // heldFront: doubled over, head forward and low, arms hanging dead.
        // Drawn mirrored at dx +14 this puts the victim's skull exactly where
        // holdFront's hands are.
        heldFront: {
            n: 1, f: [{
                pel: [0, 17.2, -1.2], wst: [0, 20.0, 0.8], cst: [0, 22.8, 3.6],
                nek: [0, 23.2, 5.0], hed: [0, 22.6, 8.4],
                shA: [-4.2, 22.8, 3.4], elA: [-4.8, 18.4, 4.4], haA: [-4.6, 13.6, 5.2],
                shB: [4.2, 22.8, 3.4], elB: [4.8, 18.4, 4.4], haB: [4.6, 13.6, 5.2],
                hiA: [-2.6, 17.0, -0.8], hiB: [2.6, 17.0, -0.8],
                knA: [-3.0, 8.8, 0.4], knB: [3.2, 8.8, 0.0],
                ftA: [-3.4, 1.3, -0.4], ftB: [3.6, 1.3, -1.6]
            }]
        },

        // heldRear: bent forward with the back exposed, arms out and useless.
        heldRear: {
            n: 1, f: [{
                pel: [0, 17.6, -0.6], wst: [0, 20.4, 1.0], cst: [0, 24.6, 3.4],
                nek: [0, 25.6, 4.6], hed: [0, 25.8, 7.8],
                shA: [-4.4, 24.4, 3.2], elA: [-6.4, 21.0, 3.4], haA: [-7.4, 17.2, 3.0],
                shB: [4.4, 24.4, 3.2], elB: [6.4, 21.0, 3.4], haB: [7.4, 17.2, 3.0],
                hiA: [-2.6, 17.4, -0.6], hiB: [2.6, 17.4, -0.6],
                knA: [-3.0, 9.0, 0.2], knB: [3.2, 9.0, -0.2],
                ftA: [-3.4, 1.3, -1.0], ftB: [3.6, 1.3, -2.0]
            }]
        },

        // heldUp: horizontal, overhead, limbs dangling. Authored high in its
        // own box (body centre at v 32, i.e. row 14) and dropped another 8px
        // by the integrator, so it clears the attacker's raised hands.
        heldUp: {
            n: 1, f: [lay(90, 1, 32, 1, {
                haA: [-9.0, 26.4, -4.0], elA: [-4.6, 28.4, -3.4],
                haB: [-8.2, 27.0, 4.0], elB: [-4.0, 29.0, 3.4],
                knA: [9.6, 30.6, -2.6], ftA: [16.0, 27.4, -3.0],
                knB: [9.2, 31.0, 2.6], ftB: [15.6, 28.0, 3.0]
            })]
        },

        // heldInverted: upside down, head at the attacker's belt. Legs up.
        heldInverted: {
            n: 1, f: [lay(180, 0, 22, 1, {
                haA: [-3.4, 5.0, -4.2], elA: [-2.6, 10.0, -3.6],
                haB: [3.4, 5.2, 4.2], elB: [2.6, 10.2, 3.6],
                knA: [-2.0, 30.4, -2.8], ftA: [-3.2, 38.6, -3.2],
                knB: [2.0, 30.6, 2.8], ftB: [3.2, 38.8, 3.2]
            })]
        },

        /* ---- taking damage ---------------------------------------------- */
        // hurtHi: head snapped back, arms thrown up, knees buckling. Two
        // frames: the snap and the sag.
        hurtHi: {
            n: 2, f: [{
                pel: [0, 18.4, -0.8], wst: [0, 21.2, -1.6], cst: [0, 26.2, -3.0],
                nek: [0, 27.6, -3.8], hed: [0, 31.4, -5.8],
                shA: [-4.6, 26.2, -2.6], elA: [-6.6, 28.4, -3.6], haA: [-7.2, 31.2, -3.0],
                shB: [4.6, 26.2, -2.6], elB: [6.6, 28.0, -3.6], haB: [7.2, 30.6, -3.0],
                knA: [-3.2, 9.0, -0.4], knB: [3.4, 9.0, -0.8],
                ftA: [-3.4, 1.3, 0.2], ftB: [3.8, 1.3, -1.8]
            }, {
                pel: [0, 17.6, -0.4], wst: [0, 20.4, -1.0], cst: [0, 25.2, -2.0],
                nek: [0, 26.6, -2.6], hed: [0, 30.4, -4.0],
                shA: [-4.6, 25.2, -1.6], elA: [-6.4, 25.6, -2.6], haA: [-6.8, 27.6, -2.4],
                shB: [4.6, 25.2, -1.6], elB: [6.4, 25.2, -2.6], haB: [6.8, 27.0, -2.4],
                knA: [-3.4, 8.2, -0.2], knB: [3.6, 8.2, -0.6],
                ftA: [-3.6, 1.3, 0.2], ftB: [4.0, 1.3, -1.6]
            }]
        },

        // hurtLo: folded over the gut, both hands clutching, head down.
        hurtLo: {
            n: 2, f: [{
                pel: [0, 17.4, -1.0], wst: [0, 20.0, 1.0], cst: [0, 23.8, 3.4],
                nek: [0, 24.6, 4.6], hed: [0, 24.6, 7.8],
                shA: [-4.2, 23.8, 3.2], elA: [-5.4, 20.6, 2.2], haA: [-2.4, 20.0, 4.2],
                shB: [4.2, 23.8, 3.2], elB: [5.4, 20.6, 2.2], haB: [2.4, 20.4, 4.4],
                hiA: [-2.6, 17.2, -0.6], hiB: [2.6, 17.2, -0.6],
                knA: [-3.2, 8.4, 0.6], knB: [3.4, 8.4, 0.2],
                ftA: [-3.4, 1.3, -0.6], ftB: [3.6, 1.3, -1.6]
            }, {
                pel: [0, 16.4, -1.4], wst: [0, 18.8, 1.2], cst: [0, 22.2, 4.0],
                nek: [0, 22.8, 5.2], hed: [0, 22.4, 8.4],
                shA: [-4.2, 22.2, 3.8], elA: [-5.4, 19.0, 2.6], haA: [-2.4, 18.4, 4.6],
                shB: [4.2, 22.2, 3.8], elB: [5.4, 19.0, 2.6], haB: [2.4, 18.8, 4.8],
                hiA: [-2.6, 16.2, -1.0], hiB: [2.6, 16.2, -1.0],
                knA: [-3.4, 7.6, 0.8], knB: [3.6, 7.6, 0.4],
                ftA: [-3.6, 1.3, -0.8], ftB: [3.8, 1.3, -1.8]
            }]
        },

        // stagger: off balance going backwards, arms wide, one foot trailing.
        stagger: {
            n: 2, f: [{
                pel: [0.8, 18.6, -1.6], wst: [1.0, 21.4, -2.6], cst: [1.2, 26.2, -4.2],
                nek: [1.2, 27.8, -4.8], hed: [1.4, 31.8, -6.2],
                shA: [-3.6, 26.4, -3.8], elA: [-7.0, 26.0, -3.0], haA: [-8.4, 23.8, -1.4],
                shB: [5.6, 26.0, -4.4], elB: [7.4, 24.6, -3.6], haB: [8.2, 22.0, -2.6],
                hiA: [-2.2, 18.4, -1.4], hiB: [3.0, 18.4, -1.4],
                knA: [-2.8, 9.8, 1.6], knB: [3.6, 9.2, -2.2],
                ftA: [-3.0, 1.3, 3.4], ftB: [4.0, 1.3, -4.6]
            }, {
                pel: [-0.8, 18.2, -2.2], wst: [-1.0, 21.0, -3.2], cst: [-1.2, 25.8, -5.0],
                nek: [-1.2, 27.4, -5.6], hed: [-1.4, 31.4, -7.0],
                shA: [-5.6, 26.0, -4.6], elA: [-7.6, 24.4, -3.8], haA: [-8.4, 22.0, -2.8],
                shB: [3.6, 26.0, -4.0], elB: [7.0, 25.6, -3.2], haB: [8.2, 23.4, -1.6],
                hiA: [-3.0, 18.0, -2.0], hiB: [2.2, 18.0, -2.0],
                knA: [-3.6, 9.2, -2.0], knB: [2.8, 9.8, 1.8],
                ftA: [-4.0, 1.3, -4.4], ftB: [3.0, 1.3, 3.6]
            }]
        },

        // knockdown: flying, rotating, hitting the mat. Flat-authored, so the
        // three frames are just three tilt angles plus flail.
        knockdown: {
            n: 3, f: [
                lay(30, -1.5, 12.5, 1, {
                    haA: [-11.0, 16.0, -4.4], elA: [-6.2, 16.6, -3.8],
                    haB: [-10.0, 18.6, 4.4], elB: [-5.4, 18.4, 3.8],
                    knA: [7.6, 7.2, -2.8], ftA: [13.6, 4.2, -3.2],
                    knB: [7.0, 9.0, 2.8], ftB: [13.0, 7.0, 3.2]
                }),
                lay(60, -0.5, 8.0, 1, {
                    haA: [-12.0, 10.0, -4.6], elA: [-6.6, 11.4, -4.0],
                    haB: [-11.0, 13.4, 4.6], elB: [-5.8, 13.4, 4.0],
                    knA: [8.6, 5.0, -3.0], ftA: [14.6, 7.2, -3.4],
                    knB: [8.0, 7.0, 3.0], ftB: [14.0, 9.6, 3.4]
                }),
                lay(86, 0.5, 5.0, 1, {
                    haA: [-12.4, 3.0, -5.2], elA: [-6.8, 3.4, -4.4],
                    haB: [-11.4, 4.2, 5.2], elB: [-6.0, 4.0, 4.4],
                    knA: [9.4, 6.4, -2.8], ftA: [15.6, 3.6, -3.2],
                    knB: [9.0, 4.2, 3.0], ftB: [16.6, 5.4, 3.4]
                })
            ]
        },

        // downFace: rolled over, face in the mat. roll -1 turns the forward
        // axis into the floor, which is also what hides the face.
        downFace: {
            n: 1, face: 'hide', f: [lay(90, 0, 4.0, -1, {
                haA: [-11.6, 3.0, -5.0], elA: [-6.2, 3.2, -4.4],
                haB: [-11.0, 3.2, 5.0], elB: [-5.6, 3.4, 4.4],
                knA: [9.4, 3.4, -3.0], ftA: [16.2, 4.8, -3.4],
                knB: [9.0, 3.2, 3.0], ftB: [16.8, 3.2, 3.4]
            })]
        },

        // downBack: flat on the back, knees loose, arms out. The pose a pin
        // is applied to.
        downBack: {
            n: 1, f: [lay(90, 0, 4.4, 1, {
                haA: [-11.4, 2.8, -5.2], elA: [-6.0, 3.0, -4.6],
                haB: [-10.6, 3.0, 5.2], elB: [-5.4, 3.2, 4.6],
                knA: [9.0, 6.4, -2.6], ftA: [15.8, 3.2, -3.2],
                knB: [9.4, 4.2, 2.8], ftB: [17.0, 5.4, 3.2]
            })]
        },

        // dead: limp, splayed, eyes closed. Not death -- DESIGN.md's broken
        // limb ending, where the match stops on the spot.
        dead: {
            n: 1, face: 'closed', f: [lay(92, 1.0, 4.2, 1, {
                haA: [-12.6, 2.6, -6.2], elA: [-6.4, 2.8, -5.4],
                haB: [-11.2, 2.8, 6.0], elB: [-5.6, 3.0, 5.2],
                knA: [9.6, 3.4, -4.0], ftA: [16.8, 3.0, -5.0],
                knB: [9.2, 3.2, 3.8], ftB: [17.4, 2.8, 4.8]
            })]
        },

        // getUp: all fours, a knee, a crouch, nearly up. The four frames are
        // the whole Fire Pro getup read -- low stamina just plays them slower.
        getUp: {
            n: 4, f: [{
                pel: [0, 8.6, -1.0], wst: [0, 10.6, 0.8], cst: [0, 12.6, 3.6],
                nek: [0, 13.0, 5.0], hed: [0, 12.2, 8.2],
                shA: [-4.0, 12.6, 3.6], elA: [-4.4, 7.6, 5.0], haA: [-4.2, 2.2, 6.0],
                shB: [4.0, 12.6, 3.6], elB: [4.4, 7.6, 5.0], haB: [4.2, 2.2, 6.0],
                hiA: [-2.6, 8.4, -1.2], knA: [-3.2, 2.6, 1.2], ftA: [-3.4, 1.2, -3.2],
                hiB: [2.6, 8.4, -1.2], knB: [3.2, 2.6, 1.2], ftB: [3.4, 1.2, -3.2]
            }, {
                pel: [0, 11.6, -1.0], wst: [0, 14.2, 0.4], cst: [0, 17.2, 2.0],
                nek: [0, 18.2, 2.8], hed: [0, 21.4, 4.2],
                shA: [-4.0, 17.0, 2.2], elA: [-4.4, 11.6, 4.4], haA: [-4.2, 4.2, 6.2],
                shB: [4.2, 17.2, 2.0], elB: [5.0, 13.4, 2.4], haB: [4.6, 9.8, 2.8],
                hiA: [-2.6, 11.4, -1.2], knA: [-3.2, 3.0, 1.0], ftA: [-3.4, 1.2, -2.2],
                hiB: [2.6, 11.4, -1.2], knB: [3.0, 10.0, 3.8], ftB: [3.2, 1.3, 5.0]
            }, {
                pel: [0, 15.0, -0.4], wst: [0, 17.8, 0.6], cst: [0, 21.6, 1.6],
                nek: [0, 22.8, 2.0], hed: [0, 26.6, 2.8],
                shA: [-4.2, 21.4, 1.8], elA: [-5.4, 17.0, 2.2], haA: [-5.0, 12.2, 2.6],
                shB: [4.2, 21.4, 1.8], elB: [5.4, 17.2, 2.4], haB: [5.0, 12.6, 3.0],
                hiA: [-2.8, 14.8, -0.4], knA: [-3.4, 7.0, 2.0], ftA: [-3.6, 1.3, -0.8],
                hiB: [2.8, 14.8, -0.4], knB: [3.4, 7.4, 3.0], ftB: [3.6, 1.3, 3.0]
            }, {
                pel: [0, 17.8, 0], wst: [0, 20.8, 0.4], cst: [0, 25.6, 0.8],
                nek: [0, 27.2, 1.0], hed: [0, 31.6, 1.2],
                shA: [-4.3, 25.4, 1.0], elA: [-5.4, 20.8, 1.4], haA: [-5.4, 15.2, 1.8],
                shB: [4.3, 25.4, 1.0], elB: [5.4, 21.0, 1.6], haB: [5.4, 15.6, 2.0],
                knA: [-2.9, 8.6, 1.0], knB: [3.1, 8.8, 1.4],
                ftA: [-3.2, 1.3, 0.8], ftB: [3.4, 1.3, -0.4]
            }]
        },

        /* ---- pins and submissions --------------------------------------- */
        // pinTop: lying across the opponent, head to screen-RIGHT (lay -90),
        // hands pressing the mat. Two frames of weight shift.
        pinTop: {
            n: 2, f: [
                lay(-90, 2.0, 11.0, 1, {
                    haA: [9.6, 4.0, -3.4], elA: [5.2, 7.6, -3.6],
                    haB: [11.0, 4.2, 3.4], elB: [6.0, 8.0, 3.6],
                    knA: [-13.0, 7.4, -3.4], ftA: [-18.0, 3.4, -4.0],
                    knB: [-12.4, 9.2, 3.4], ftB: [-17.4, 6.0, 4.0]
                }),
                lay(-96, 2.4, 12.0, 1, {
                    haA: [10.4, 4.0, -3.6], elA: [5.8, 8.4, -3.8],
                    haB: [11.8, 4.2, 3.6], elB: [6.6, 8.8, 3.8],
                    knA: [-13.4, 8.6, -3.6], ftA: [-18.4, 4.6, -4.2],
                    knB: [-12.8, 10.4, 3.6], ftB: [-17.8, 7.2, 4.2]
                })
            ]
        },

        // pinBottom: shoulders down, legs kicking. The two frames differ only
        // in the legs, because a kickout is read off the legs.
        pinBottom: {
            n: 2, f: [
                lay(90, -2.0, 4.4, 1, {
                    haA: [-12.0, 2.8, -5.4], elA: [-6.4, 3.0, -4.8],
                    haB: [-11.2, 3.0, 5.4], elB: [-5.8, 3.2, 4.8],
                    knA: [8.4, 7.6, -2.8], ftA: [14.4, 4.0, -3.4],
                    knB: [8.8, 4.4, 3.0], ftB: [16.0, 6.2, 3.4]
                }),
                lay(90, -2.0, 4.4, 1, {
                    haA: [-12.4, 3.6, -5.4], elA: [-6.6, 3.6, -4.8],
                    haB: [-11.6, 3.8, 5.4], elB: [-6.0, 3.8, 4.8],
                    knA: [8.6, 4.6, -2.8], ftA: [15.6, 6.4, -3.4],
                    knB: [8.4, 8.0, 3.0], ftB: [14.2, 4.2, 3.4]
                })
            ]
        },

        // subApply: down on one knee, hauling back on a leg. Not flat: the
        // attacker is kneeling, and the pull is in his shoulders.
        subApply: {
            n: 2, f: [{
                pel: [0, 10.4, -1.6], wst: [0, 13.2, -1.0], cst: [0, 17.6, 0.6],
                nek: [0, 18.8, 1.2], hed: [0, 22.4, 2.4],
                shA: [-4.2, 17.4, 0.8], elA: [-4.8, 14.0, 3.4], haA: [-3.0, 11.6, 6.6],
                shB: [4.2, 17.4, 0.8], elB: [4.8, 14.2, 3.6], haB: [3.0, 12.4, 7.0],
                hiA: [-2.6, 10.2, -1.6], knA: [-3.2, 2.6, 0.6], ftA: [-3.4, 1.2, -3.6],
                hiB: [2.6, 10.2, -1.6], knB: [3.2, 9.0, 3.4], ftB: [3.4, 1.3, 4.4]
            }, {
                pel: [0, 10.8, -2.6], wst: [0, 13.6, -2.2], cst: [0, 18.0, -0.8],
                nek: [0, 19.2, -0.4], hed: [0, 22.8, 0.6],
                shA: [-4.2, 17.8, -0.6], elA: [-5.2, 14.6, 1.8], haA: [-3.2, 12.8, 5.4],
                shB: [4.2, 17.8, -0.6], elB: [5.2, 14.8, 2.0], haB: [3.2, 13.6, 5.8],
                hiA: [-2.6, 10.6, -2.6], knA: [-3.2, 2.6, -0.4], ftA: [-3.4, 1.2, -4.4],
                hiB: [2.6, 10.6, -2.6], knB: [3.2, 9.2, 2.6], ftB: [3.4, 1.3, 3.8]
            }]
        },

        // subTaken: flat with the near leg hauled out toward the attacker and
        // both arms reaching for a rope that is not there.
        subTaken: {
            n: 2, f: [
                lay(90, -3.0, 4.4, 1, {
                    haA: [-14.0, 4.2, -5.0], elA: [-7.6, 3.4, -4.6],
                    haB: [-13.2, 4.4, 5.0], elB: [-7.0, 3.6, 4.6],
                    knA: [9.4, 4.0, -2.6], ftA: [16.8, 4.6, -2.8],
                    knB: [8.6, 6.8, 3.2], ftB: [14.6, 8.4, 3.6]
                }),
                lay(86, -3.4, 4.6, 1, {
                    haA: [-14.6, 5.6, -5.0], elA: [-7.8, 4.4, -4.6],
                    haB: [-13.8, 5.8, 5.0], elB: [-7.2, 4.6, 4.6],
                    knA: [9.8, 4.6, -2.6], ftA: [17.4, 5.6, -2.8],
                    knB: [9.0, 7.8, 3.2], ftB: [15.0, 9.6, 3.6]
                })
            ]
        },

        /* ---- the turnbuckle --------------------------------------------- */
        // climb: hands up on the pad, one knee driving. The ring code supplies
        // the actual height, so the feet stay on this pose's own floor.
        climb: {
            n: 3, f: [{
                pel: [0, 16.4, 1.4], wst: [0, 19.4, 2.0], cst: [0, 24.2, 2.8],
                nek: [0, 25.8, 3.0], hed: [0, 29.8, 3.6],
                shA: [-4.2, 24.2, 3.0], elA: [-5.0, 27.6, 3.6], haA: [-4.4, 31.2, 4.2],
                shB: [4.2, 24.2, 3.0], elB: [5.2, 25.0, 3.4], haB: [4.8, 21.6, 3.8],
                hiA: [-2.6, 16.2, 1.2], knA: [-2.8, 11.6, 4.6], ftA: [-3.0, 6.6, 3.6],
                hiB: [2.6, 16.2, 1.2], knB: [3.0, 8.6, 1.0], ftB: [3.2, 1.3, -0.6]
            }, {
                pel: [0, 18.4, 1.8], wst: [0, 21.4, 2.2], cst: [0, 26.2, 2.8],
                nek: [0, 27.8, 3.0], hed: [0, 31.8, 3.4],
                shA: [-4.2, 26.2, 3.0], elA: [-4.8, 29.8, 3.4], haA: [-4.2, 33.4, 3.8],
                shB: [4.2, 26.2, 3.0], elB: [5.0, 29.6, 3.4], haB: [4.4, 33.0, 3.8],
                hiA: [-2.6, 18.2, 1.6], knA: [-2.8, 14.0, 5.0], ftA: [-3.0, 9.6, 4.2],
                hiB: [2.6, 18.2, 1.6], knB: [3.0, 10.0, 1.4], ftB: [3.2, 1.3, -0.4]
            }, {
                pel: [0, 17.2, 0.8], wst: [0, 20.2, 1.2], cst: [0, 25.0, 1.8],
                nek: [0, 26.6, 2.0], hed: [0, 30.6, 2.6],
                shA: [-4.4, 25.0, 2.0], elA: [-6.0, 21.6, 2.6], haA: [-6.4, 18.0, 3.0],
                shB: [4.4, 25.0, 2.0], elB: [6.0, 21.6, 2.6], haB: [6.4, 18.0, 3.0],
                hiA: [-2.8, 17.0, 0.6], knA: [-3.4, 8.4, 2.6], ftA: [-3.6, 1.3, 0.6],
                hiB: [2.8, 17.0, 0.6], knB: [3.4, 8.4, 2.2], ftB: [3.6, 1.3, 0.2]
            }]
        },

        // turnbuckleTop: up there, arms in a V, chest out. One frame, held.
        turnbuckleTop: {
            n: 1, f: [{
                pel: [0, 19.2, -0.2], wst: [0, 22.2, -0.4], cst: [0, 27.6, -0.6],
                nek: [0, 29.2, -0.6], hed: [0, 33.6, -0.8],
                shA: [-4.6, 27.6, -0.4], elA: [-6.6, 30.8, 0], haA: [-8.0, 34.4, 0.4],
                shB: [4.6, 27.6, -0.4], elB: [6.6, 30.8, 0], haB: [8.0, 34.4, 0.4],
                hiA: [-2.6, 18.9, 0], hiB: [2.6, 18.9, 0],
                knA: [-3.0, 10.0, 0.4], knB: [3.0, 10.0, 0.4],
                ftA: [-3.4, 1.3, 0.8], ftB: [3.4, 1.3, 0.8]
            }]
        },

        // diveAir: horizontal, arms forward, legs trailing. Flat at a slight
        // nose-down tilt so it reads as travelling, not floating.
        diveAir: {
            n: 2, f: [
                lay(100, 1.0, 22.0, 1, {
                    haA: [-13.6, 24.0, -4.6], elA: [-7.6, 23.6, -4.0],
                    haB: [-12.8, 25.4, 4.6], elB: [-7.0, 24.8, 4.0],
                    knA: [9.6, 19.6, -3.0], ftA: [16.4, 17.6, -3.4],
                    knB: [9.0, 21.4, 3.0], ftB: [15.8, 19.8, 3.4]
                }),
                lay(108, 0.0, 21.0, 1, {
                    haA: [-13.8, 21.4, -5.0], elA: [-7.8, 21.6, -4.4],
                    haB: [-13.0, 22.8, 5.0], elB: [-7.2, 22.8, 4.4],
                    knA: [9.8, 22.4, -3.0], ftA: [16.6, 23.8, -3.4],
                    knB: [9.2, 20.2, 3.0], ftB: [16.0, 18.2, 3.4]
                })
            ]
        },

        // diveLand: the impact. Deep crouch, hands down, head low.
        diveLand: {
            n: 1, f: [{
                pel: [0, 12.6, 0.6], wst: [0, 15.4, 1.8], cst: [0, 19.4, 3.6],
                nek: [0, 20.6, 4.2], hed: [0, 23.4, 6.0],
                shA: [-4.4, 19.2, 3.6], elA: [-5.8, 15.2, 4.4], haA: [-5.6, 10.0, 5.4],
                shB: [4.4, 19.2, 3.6], elB: [5.8, 15.2, 4.4], haB: [5.6, 10.0, 5.4],
                hiA: [-3.0, 12.4, 0.4], hiB: [3.0, 12.4, 0.4],
                knA: [-4.0, 6.0, 3.0], knB: [4.0, 6.0, 2.6],
                ftA: [-4.2, 1.3, 0.6], ftB: [4.2, 1.3, 0.2]
            }]
        },

        /* ---- showmanship ------------------------------------------------ */
        // taunt: arms out, then up, then a point. Spends stamina for spirit.
        taunt: {
            n: 3, f: [{
                shA: [-4.8, 27.2, -0.4], elA: [-7.4, 25.8, -0.6], haA: [-9.4, 24.2, -0.6],
                shB: [4.8, 27.2, -0.4], elB: [7.4, 25.8, -0.6], haB: [9.4, 24.2, -0.6],
                cst: [0, 27.4, -0.4], hed: [0, 33.6, -0.8]
            }, {
                shA: [-4.6, 27.6, -0.6], elA: [-6.8, 31.0, -0.8], haA: [-7.8, 34.6, -0.8],
                shB: [4.6, 27.6, -0.6], elB: [6.8, 31.0, -0.8], haB: [7.8, 34.6, -0.8],
                cst: [0, 27.8, -0.8], nek: [0, 29.4, -1.0], hed: [0, 33.8, -1.6],
                pel: [0, 19.3, -0.2]
            }, {
                shA: [-4.2, 27.2, 1.0], elA: [-4.6, 26.6, 5.4], haA: [-4.2, 27.4, 10.4],
                shB: [4.6, 26.8, -1.0], elB: [6.6, 24.0, -1.4], haB: [6.0, 20.4, -1.0],
                cst: [0, 27.2, 0.8], hed: [0, 33.4, 1.0],
                ftA: [-3.2, 1.3, 2.0], ftB: [3.4, 1.3, -1.0]
            }]
        },

        // celebrate: both arms pumping, bouncing on the toes.
        celebrate: {
            n: 4, f: [{
                shA: [-4.4, 27.4, -0.4], elA: [-6.4, 30.6, -0.4], haA: [-7.0, 34.2, -0.4],
                shB: [4.4, 27.4, -0.4], elB: [6.4, 30.6, -0.4], haB: [7.0, 34.2, -0.4],
                cst: [0, 27.6, -0.4], nek: [0, 29.2, -0.4], hed: [0, 33.6, -0.6],
                pel: [0, 19.4, 0], knA: [-2.8, 10.2, 0.4], knB: [2.8, 10.2, 0.4],
                ftA: [-3.0, 1.3, 0.6], ftB: [3.0, 1.3, 0.6]
            }, {
                shA: [-4.6, 27.0, -0.2], elA: [-6.8, 25.4, 0.6], haA: [-7.6, 27.8, 2.0],
                shB: [4.6, 27.0, -0.2], elB: [6.8, 25.4, 0.6], haB: [7.6, 27.8, 2.0],
                cst: [0, 27.2, 0], nek: [0, 28.8, 0], hed: [0, 33.2, 0],
                pel: [0, 18.6, 0], knA: [-3.0, 9.0, 0.6], knB: [3.0, 9.0, 0.6],
                ftA: [-3.2, 1.3, 0.8], ftB: [3.2, 1.3, 0.8]
            }, {
                shA: [-4.4, 27.4, -0.4], elA: [-6.2, 30.8, -0.4], haA: [-6.6, 34.6, -0.4],
                shB: [4.4, 27.4, -0.4], elB: [6.2, 30.8, -0.4], haB: [6.6, 34.6, -0.4],
                cst: [0, 27.7, -0.4], nek: [0, 29.3, -0.4], hed: [0, 33.7, -0.6],
                pel: [0, 19.6, 0], knA: [-2.8, 10.6, 0.4], knB: [2.8, 10.6, 0.4],
                ftA: [-3.0, 2.0, 0.6], ftB: [3.0, 2.0, 0.6]
            }, {
                shA: [-4.6, 27.0, -0.2], elA: [-7.0, 25.6, 0.8], haA: [-8.0, 28.2, 2.2],
                shB: [4.6, 27.0, -0.2], elB: [7.0, 25.6, 0.8], haB: [8.0, 28.2, 2.2],
                cst: [0, 27.1, 0], nek: [0, 28.7, 0], hed: [0, 33.1, 0],
                pel: [0, 18.8, 0], knA: [-3.0, 9.2, 0.6], knB: [3.0, 9.2, 0.6],
                ftA: [-3.2, 1.3, 0.8], ftB: [3.2, 1.3, 0.8]
            }]
        },

        /* ---- weapons ---------------------------------------------------- */
        // grabWeapon: reach under the ring, come up with it.
        grabWeapon: {
            n: 2, f: [{
                pel: [0, 14.6, -1.2], wst: [0, 17.4, 0.8], cst: [0, 21.0, 3.4],
                nek: [0, 22.0, 4.6], hed: [0, 21.8, 7.8],
                shA: [-4.2, 21.0, 3.4], elA: [-4.6, 16.0, 5.0], haA: [-4.0, 10.0, 6.4],
                shB: [4.2, 21.0, 3.4], elB: [5.2, 17.2, 3.4], haB: [5.0, 13.0, 3.6],
                hiA: [-2.8, 14.4, -1.0], hiB: [2.8, 14.4, -1.0],
                knA: [-3.6, 6.8, 1.6], knB: [3.8, 6.8, 1.2],
                ftA: [-3.8, 1.3, 0.2], ftB: [4.0, 1.3, -1.0]
            }, {
                pel: [0, 18.4, -0.4], wst: [0, 21.4, 0.2], cst: [0, 26.2, 1.0],
                nek: [0, 27.8, 1.2], hed: [0, 31.8, 1.8],
                shA: [-4.2, 26.0, 1.4], elA: [-5.6, 23.0, 2.8], haA: [-5.2, 21.4, 5.6],
                shB: [4.4, 26.0, 0.6], elB: [5.6, 22.2, 0.8], haB: [5.4, 18.0, 1.4],
                knA: [-3.0, 9.2, 0.8], knB: [3.2, 9.2, 0.4],
                ftA: [-3.4, 1.3, 1.0], ftB: [3.6, 1.3, -0.6]
            }]
        },

        // weaponSwing: a two-handed overhead swing. Hands stay together so
        // art.js can hang a chair, a pipe or a kendo stick off the same point.
        weaponSwing: {
            n: 3, f: [{
                pel: [0, 18.8, -0.8], wst: [0, 21.8, -1.4], cst: [0, 27.0, -2.4],
                nek: [0, 28.6, -2.6], hed: [0, 32.8, -3.0],
                shA: [-4.2, 27.0, -1.8], elA: [-5.2, 30.4, -3.0], haA: [-3.4, 33.0, -5.0],
                shB: [4.2, 27.0, -1.8], elB: [5.2, 30.4, -3.0], haB: [2.6, 33.4, -4.6],
                knA: [-3.0, 9.4, -0.4], knB: [3.2, 9.4, -0.8],
                ftA: [-3.4, 1.3, -0.6], ftB: [3.6, 1.3, 1.4]
            }, {
                pel: [0, 18.6, 0.6], wst: [0, 21.6, 1.2], cst: [0, 26.6, 2.0],
                nek: [0, 28.2, 2.2], hed: [0, 32.4, 2.6],
                shA: [-4.2, 26.6, 2.2], elA: [-4.6, 28.2, 6.2], haA: [-3.4, 28.4, 11.0],
                shB: [4.2, 26.6, 2.2], elB: [4.6, 28.4, 6.0], haB: [2.6, 29.0, 10.6],
                knA: [-3.0, 9.2, 1.4], knB: [3.2, 9.2, 0.6],
                ftA: [-3.4, 1.3, 2.0], ftB: [3.6, 1.3, -0.8]
            }, {
                pel: [0, 17.4, 1.0], wst: [0, 20.2, 2.0], cst: [0, 24.8, 3.6],
                nek: [0, 26.0, 4.2], hed: [0, 29.6, 5.4],
                shA: [-4.2, 24.6, 3.8], elA: [-5.0, 20.8, 6.6], haA: [-3.6, 17.2, 9.4],
                shB: [4.2, 24.6, 3.8], elB: [5.0, 21.0, 6.4], haB: [2.8, 17.8, 9.0],
                hiA: [-2.8, 17.2, 0], hiB: [2.8, 17.2, 0],
                knA: [-3.4, 8.2, 1.6], knB: [3.6, 8.2, 1.0],
                ftA: [-3.8, 1.3, 0.6], ftB: [4.0, 1.3, -1.0]
            }]
        }
    };

    // ddt's last frame is flat (he lands on his back with the head still
    // hooked), which is the one place a pose mixes the two authoring modes.
    POSE.ddt.f.push(lay(88, -1.0, 5.2, 1, {
        haA: [-7.0, 8.4, -4.0], elA: [-5.2, 5.0, -4.4],
        haB: [-11.6, 3.4, 5.2], elB: [-6.0, 3.6, 4.6],
        knA: [9.0, 7.0, -2.8], ftA: [15.6, 3.6, -3.2],
        knB: [9.4, 4.4, 3.0], ftB: [16.8, 5.6, 3.4]
    }));
    delete POSE.ddt.f3flat;

    poser.POSEDATA = POSE;

    // The frame-count contract moves.js checks itself against.
    poser.POSES = (function () {
        var o = {};
        for (var k in POSE) o[k] = POSE[k].n;
        return o;
    })();

    // The paired-move offsets from the table at the top of this file, as data
    // so combat.js does not have to copy numbers out of a comment.
    poser.PAIR = {
        heldFront: { dx: 14, dy: 0, flip: 'face', under: false },
        heldRear: { dx: 10, dy: 0, flip: 'same', under: false },
        heldUp: { dx: 2, dy: -8, flip: 'face', under: false },
        heldInverted: { dx: 9, dy: -4, flip: 'face', under: false },
        pinBottom: { dx: 3, dy: 0, flip: 'same', under: true },
        subTaken: { dx: 14, dy: 0, flip: 'face', under: true },
        tieup: { dx: 17, dy: 0, flip: 'face', under: false }
    };

    /* ===================================================================== */
    /* PROJECTION                                                            */
    /* ===================================================================== */

    /* A joint is (x lateral, y up, z forward) for an upright pose, or
       (u screen-horizontal, v up, w lateral) for a laid-out one. Both collapse
       to the same three screen numbers:

         su  horizontal, in body units, 0 = the centre line
         sv  vertical, in body units, 0 = the soles
         d   depth, larger = nearer the camera. Used ONLY to sort the parts
             back-to-front; there is no z-buffer and there does not need to be
             at 48 pixels.

       The obliques (SKEW, STAGGER) are not realism, they are legibility. A
       true orthographic front view draws a jab as a fist-sized dot on the
       chest, and a true profile draws a square stance with one leg. */
    function project(j, view, flat, out) {
        var a = j[0], b = j[1], c = j[2];
        if (flat) {
            // a = u (along the floor), b = v (up), c = w (lateral)
            if (view === 'side') { out[0] = a; out[1] = b; out[2] = -c; }
            else if (view === 'front') { out[0] = a; out[1] = b - c * SKEW * 0.45; out[2] = c; }
            else { out[0] = -a; out[1] = b + c * SKEW * 0.45; out[2] = -c; }
            return out;
        }
        if (view === 'side') {
            // Facing screen-right. Lateral offset is depth, nudged into the
            // screen so the far limb is not hidden behind the near one.
            out[0] = c - a * STAGGER;
            out[1] = b;
            out[2] = -a;
        } else if (view === 'front') {
            // Facing the camera: forward reach comes down and to the right.
            out[0] = a + c * SKEW * 0.75;
            out[1] = b - c * SKEW * 0.45;
            out[2] = c;
        } else {
            // Facing away: the mirror of the above, and forward goes up-left.
            out[0] = -a - c * SKEW * 0.75;
            out[1] = b + c * SKEW * 0.45;
            out[2] = -c;
        }
        return out;
    }

    /* ===================================================================== */
    /* RASTER PRIMITIVES                                                     */
    /* ===================================================================== */

    var FW = poser.FW, FH = poser.FH;
    var pix = new Uint8Array(FW * FH);
    var tmp = new Uint8Array(FW * FH);

    function pset(x, y, v) {
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= FW || y >= FH) return;
        pix[y * FW + x] = v;
    }
    function pget(buf, x, y) {
        if (x < 0 || y < 0 || x >= FW || y >= FH) return 0;
        return buf[y * FW + x];
    }

    /* A tapered capsule between two screen points, shaded in three tones.

       The tone comes from the surface offset of each pixel from the segment
       axis, dotted with the light. That is a cheap stand-in for a normal and
       it is the right cheap stand-in: a limb is a cylinder, so the screen
       offset from its axis IS its normal, up to the part facing the camera.

       Below R_LIT and R_DARK the bands are dropped. A two-pixel-wide forearm
       with three tones in it is not shaded, it is noise. */
    function capsule(x0, y0, r0, x1, y1, r1, mat, fat) {
        if (fat) { r0 *= fat; r1 *= fat; }
        var dx = x1 - x0, dy = y1 - y0;
        var len2 = dx * dx + dy * dy;
        var rmax = (r0 > r1 ? r0 : r1) + 1;
        var xa = Math.floor(Math.min(x0, x1) - rmax), xb = Math.ceil(Math.max(x0, x1) + rmax);
        var ya = Math.floor(Math.min(y0, y1) - rmax), yb = Math.ceil(Math.max(y0, y1) + rmax);
        if (xa < 0) xa = 0; if (ya < 0) ya = 0;
        if (xb > FW - 1) xb = FW - 1; if (yb > FH - 1) yb = FH - 1;

        for (var y = ya; y <= yb; y++) {
            for (var x = xa; x <= xb; x++) {
                var px0 = x + 0.5 - x0, py0 = y + 0.5 - y0;
                var t = len2 > 0 ? (px0 * dx + py0 * dy) / len2 : 0;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                var cx = x0 + dx * t, cy = y0 + dy * t;
                var ox = x + 0.5 - cx, oy = y + 0.5 - cy;
                var dd = Math.sqrt(ox * ox + oy * oy);
                var r = r0 + (r1 - r0) * t;
                if (dd > r) continue;
                var tone = mat.base;
                if (r >= R_DARK) {
                    var n = dd > 0.001 ? (ox / dd * LX + oy / dd * LY) * (dd / r) : 0;
                    if (r >= R_LIT && n > LIT) tone = mat.lt;
                    else if (n < DARK) tone = mat.sh;
                }
                pix[y * FW + x] = tone;
            }
        }
    }

    // A shaded ellipse. Heads, fists and the barrel of a chest.
    function blob(cx, cy, rx, ry, mat) {
        var xa = Math.floor(cx - rx), xb = Math.ceil(cx + rx);
        var ya = Math.floor(cy - ry), yb = Math.ceil(cy + ry);
        if (xa < 0) xa = 0; if (ya < 0) ya = 0;
        if (xb > FW - 1) xb = FW - 1; if (yb > FH - 1) yb = FH - 1;
        for (var y = ya; y <= yb; y++) {
            for (var x = xa; x <= xb; x++) {
                var ox = (x + 0.5 - cx) / rx, oy = (y + 0.5 - cy) / ry;
                var d2 = ox * ox + oy * oy;
                if (d2 > 1) continue;
                var tone = mat.base;
                var rr = (rx + ry) * 0.5;
                if (rr >= R_DARK) {
                    var d = Math.sqrt(d2);
                    var n = d > 0.001 ? (ox / d * LX + oy / d * LY) * d : 0;
                    if (rr >= R_LIT && n > LIT) tone = mat.lt;
                    else if (n < DARK) tone = mat.sh;
                }
                pix[y * FW + x] = tone;
            }
        }
    }

    // Flat, single-index primitives. The shaded capsule() and blob() take a
    // material; face details are too small to shade and want a hard edge in
    // one colour, so these take a palette index directly.
    function dot(cx, cy, r, v) {
        var x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
        var y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
        if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
        if (x1 > FW - 1) x1 = FW - 1; if (y1 > FH - 1) y1 = FH - 1;
        var rr = r * r;
        for (var y = y0; y <= y1; y++) {
            for (var x = x0; x <= x1; x++) {
                var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (dx * dx + dy * dy <= rr) pix[y * FW + x] = v;
            }
        }
    }

    function stroke(x0, y0, x1, y1, r, v) {
        var dx = x1 - x0, dy = y1 - y0;
        var n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
        for (var i = 0; i <= n; i++) dot(x0 + dx * i / n, y0 + dy * i / n, r, v);
    }

    // Deterministic 2-D hash. No Math.random anywhere in this file: the same
    // style must generate the same pixels on every load or the gfx tile cache
    // hands out frames that disagree with each other.
    function hash2(a, b) {
        var h = (a | 0) * 374761393 + (b | 0) * 668265263;
        h = (h ^ (h >>> 13)) * 1274126177;
        return (h ^ (h >>> 16)) >>> 0;
    }

    /* Outline the finished silhouette in index 1.

       Last, and over the whole figure rather than per part, so it wraps hair,
       trunks and boots uniformly. Without it a wrestler drawn over a dark
       seething crowd simply disappears -- this one pass is the difference
       between readable and not. */
    function outlinePass() {
        tmp.set(pix);
        for (var y = 0; y < FH; y++) {
            var row = y * FW;
            for (var x = 0; x < FW; x++) {
                if (tmp[row + x]) continue;
                if (pget(tmp, x - 1, y) || pget(tmp, x + 1, y) ||
                    pget(tmp, x, y - 1) || pget(tmp, x, y + 1)) {
                    pix[row + x] = OUTL;
                }
            }
        }
    }

    /* ===================================================================== */
    /* THE HEAD                                                              */
    /* ===================================================================== */

    /* Hair styles, as the shape drawn over the skull. At a 9-pixel head these
       are silhouettes, not hairdos: the only thing that survives is the
       outline, so each one changes the head's profile rather than its texture.
         0 bald  1 short  2 long  3 ponytail  4 mohawk  5 afro  6 topknot
         7 wild  8 ears

       8 is a hood or a beast head rather than a hairstyle: two tall ears over
       a skull cap. It exists because a cartoon federation wants animal
       gimmicks, and because a pink bunny hood is not expressible any other
       way. */
    function drawHair(cx, cy, rx, ry, style, fx, key, view) {
        var h = style.hair;
        if (h === 0) return;                                  // bald
        var M = HAIR;
        switch (h) {
            case 1:                                            // short: a cap
                blob(cx, cy - ry * 0.42, rx * 1.02, ry * 0.62, M);
                break;
            case 2:                                            // long: past the jaw
                blob(cx, cy - ry * 0.35, rx * 1.10, ry * 0.76, M);
                capsule(cx - rx * 0.95, cy - ry * 0.2, rx * 0.44,
                    cx - rx * 0.85, cy + ry * 1.15, rx * 0.40, M);
                capsule(cx + rx * 0.95, cy - ry * 0.2, rx * 0.44,
                    cx + rx * 0.85, cy + ry * 1.15, rx * 0.40, M);
                break;
            case 3:                                            // ponytail
                blob(cx, cy - ry * 0.40, rx * 1.04, ry * 0.66, M);
                if (fx) {
                    capsule(cx - fx * rx * 0.9, cy - ry * 0.3, rx * 0.40,
                        cx - fx * rx * 2.3, cy + ry * 0.5, rx * 0.30, M);
                } else if (view === 'back') {
                    // From behind the tail hangs down the middle.
                    capsule(cx, cy + ry * 0.2, rx * 0.36,
                        cx, cy + ry * 1.5, rx * 0.26, M);
                }
                break;
            case 4:                                            // mohawk
                if (fx) {
                    // Profile: the crest runs front to back along the skull.
                    capsule(cx - fx * rx * 0.55, cy - ry * 1.45, rx * 0.30,
                        cx + fx * rx * 0.55, cy - ry * 1.20, rx * 0.42, M);
                    blob(cx, cy - ry * 0.70, rx * 0.95, ry * 0.34, M);
                } else {
                    // Head on, a mohawk is a narrow vertical crest. Drawing
                    // the profile shape here put a wide slab across the top of
                    // the skull that read as a hat.
                    capsule(cx, cy - ry * 1.55, rx * 0.22,
                        cx, cy - ry * 0.55, rx * 0.34, M);
                    blob(cx, cy - ry * 0.55, rx * 0.40, ry * 0.42, M);
                }
                break;
            case 5:                                            // afro
                blob(cx, cy - ry * 0.46, rx * 1.42, ry * 1.02, M);
                break;
            case 6:                                            // topknot
                blob(cx, cy - ry * 0.44, rx * 1.00, ry * 0.60, M);
                blob(cx - fx * rx * 0.25, cy - ry * 1.42, rx * 0.46, ry * 0.46, M);
                break;
            case 8: {                                          // ears
                var earW = rx * 0.30;
                if (fx) {
                    // Profile: both ears swept back, the near one lower and
                    // fuller so they read as two rather than one thick one.
                    capsule(cx - fx * rx * 0.05, cy - ry * 0.9, earW,
                        cx - fx * rx * 0.55, cy - ry * 2.25, earW * 0.62, M);
                    capsule(cx + fx * rx * 0.35, cy - ry * 0.85, earW * 0.85,
                        cx + fx * rx * 0.02, cy - ry * 2.0, earW * 0.55, M);
                } else {
                    capsule(cx - rx * 0.48, cy - ry * 0.8, earW,
                        cx - rx * 0.66, cy - ry * 2.3, earW * 0.62, M);
                    capsule(cx + rx * 0.48, cy - ry * 0.8, earW,
                        cx + rx * 0.66, cy - ry * 2.3, earW * 0.62, M);
                }
                // The skull cap is the hood itself. With a full mask the
                // mask has already drawn it, and capping again paints hair
                // over the whole face.
                if (style.mask !== 1) {
                    blob(cx, cy - ry * 0.42, rx * 1.0, ry * 0.58, M);
                }
                break;
            }

            default:                                           // wild / metal
                blob(cx, cy - ry * 0.30, rx * 1.16, ry * 0.86, M);
                // Spike length is capped so the tallest build at tall=+1
                // still fits: at rx*2.2 a super heavyweight's hair ran off the
                // top of its own 48px box and the outline pass had nowhere to
                // put the silhouette.
                for (var i = 0; i < 7; i++) {
                    var hs = hash2(key + i * 37, 11);
                    var a = (i / 7) * Math.PI - 0.25 + ((hs & 15) - 8) * 0.012;
                    var L = rx * (1.18 + ((hs >> 5) & 7) * 0.07);
                    capsule(cx - Math.cos(a) * rx * 0.8, cy - Math.sin(a) * ry * 0.8, 1.3,
                        cx - Math.cos(a) * L, cy - Math.sin(a) * L * 0.95, 0.9, M);
                }
                break;
        }
    }

    /* The face is four pixels and a brow. fx is +1 if the face points screen
       right, -1 left, 0 if it is pointing at or away from the camera. */
    function drawFace(cx, cy, rx, ry, style, fx, toward) {
        if (!toward) return;                 // back of the head: nothing
        var ex = fx ? fx * rx * 0.42 : 0;
        var ey = cy - ry * 0.10;
        // A head is nine pixels across. A trim line of radius 1.1 is a
        // quarter of it, and two of them plus the eyes left no face at all --
        // every masked wrestler came out as a solid slab of accent colour.
        // These are hairlines on purpose.
        if (style.mask === 1) {
            // Full luchador: the mask IS the head, with an accent trim and
            // two eye holes cut back to white.
            blob(cx, cy - ry * 0.12, rx * 1.02, ry * 0.92, TRUNK);
            // Trim widths are a FRACTION OF THE HEAD, not a pixel count:
            // absolute radii were tuned against a 48px figure and came out
            // half-weight the moment the view scale doubled.
            var tw = rx * 0.13;
            capsule(cx - rx * 0.95, cy - ry * 0.52, tw,
                cx + rx * 0.95, cy - ry * 0.52, tw, ACC);
            capsule(cx - rx * 0.55, cy + ry * 0.62, tw,
                cx + rx * 0.55, cy + ry * 0.62, tw, ACC);
            // A blaze down the centre, which is what makes a mask a mask
            // rather than a bucket.
            capsule(cx, cy - ry * 0.45, tw, cx, cy + ry * 0.35, tw, ACC);
        } else if (style.mask === 2) {
            // A visor wraps the whole eye line and you cannot see through it.
            // Solid, and the eyes are suppressed below -- which is the only
            // thing that stops it reading identically to face paint at this
            // size.
            capsule(cx - rx, cy - ry * 0.20, rx * 0.28, cx + rx, cy - ry * 0.20, rx * 0.28, ACC);
        } else if (style.mask === 3) {
            // Paint as two vertical streaks through the eyes, not a band.
            // Horizontally it was indistinguishable from the visor; this way
            // it reads as war paint on one and erosion on the other.
            var pw = rx * 0.19;
            capsule(cx - rx * 0.42, cy - ry * 0.95, pw,
                cx - rx * 0.42, cy + ry * 0.55, pw, ACC);
            capsule(cx + rx * 0.42, cy - ry * 0.95, pw,
                cx + rx * 0.42, cy + ry * 0.55, pw, ACC);
        }
        var blind = (style.mask === 2);
        if (blind) {
            // Nothing to draw: the visor is the face.
        } else if (fx) {
            // Eyes scale with the head too. A single pixel was an eye at 48;
            // at 96 it is a speck.
            var er = Math.max(0.5, rx * 0.14);
            dot(cx + ex, ey, er, WHITE);
            dot(cx + ex, ey + er + 0.5, er * 0.8, OUTL);
            // Brow and jaw line give the profile some attitude.
            stroke(cx + ex - er, ey - er * 1.8,
                cx + ex + er * 1.6, ey - er * 2.1, er * 0.7, OUTL);
            stroke(cx + fx * rx * 0.35, cy + ry * 0.48,
                cx + fx * rx * 0.72, cy + ry * 0.42, er * 0.6, OUTL);
        } else {
            var er2 = Math.max(0.5, rx * 0.14);
            dot(cx - rx * 0.40, ey, er2, WHITE);
            dot(cx + rx * 0.40, ey, er2, WHITE);
            dot(cx - rx * 0.40, ey + er2 + 0.5, er2 * 0.8, OUTL);
            dot(cx + rx * 0.40, ey + er2 + 0.5, er2 * 0.8, OUTL);
            stroke(cx - rx * 0.30, cy + ry * 0.52,
                cx + rx * 0.30, cy + ry * 0.52, er2 * 0.6, OUTL);
        }
        if (style.beard) {
            var bm = style.beard === 1 ? { sh: HAIR.sh, base: HAIR.sh, lt: HAIR.sh } : HAIR;
            var by = cy + ry * 0.52;
            if (fx) capsule(cx, by, rx * 0.40, cx + fx * rx * 0.72, by - ry * 0.1, rx * 0.34, bm);
            else capsule(cx - rx * 0.6, by, rx * 0.36, cx + rx * 0.6, by, rx * 0.36, bm);
        }
    }

    /* ===================================================================== */
    /* THE FIGURE                                                            */
    /* ===================================================================== */

    var P = {};                 // projected joints: name -> [su, sv, d]
    (function () { for (var i = 0; i < JOINTS.length; i++) P[JOINTS[i]] = [0, 0, 0]; })();

    var parts = [];             // collected, then painted back-to-front

    function part(depth, fn) { parts.push({ d: depth, fn: fn }); }

    // Lerp between two projected joints.
    function lerpJ(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t];
    }

    function drawLeg(S, hi, kn, ft, sc, style) {
        var bs = sc.bs;
        var bt = BOOT_TOP[style.boots];
        // Boot top: a fraction up the shin, or past the knee into the thigh.
        var top = bt <= 1 ? lerpJ(ft, kn, bt) : lerpJ(kn, hi, bt - 1);

        // Trunks cover the top third of the thigh.
        var trunkEnd = lerpJ(hi, kn, 0.34);
        capsule(hi[0], hi[1], R.thighTop * bs, trunkEnd[0], trunkEnd[1],
            R.thighTop * 0.88 * bs, TRUNK);

        if (bt <= 1) {
            capsule(trunkEnd[0], trunkEnd[1], R.thighTop * 0.88 * bs,
                kn[0], kn[1], R.thighBot * bs, SKIN);
            capsule(kn[0], kn[1], R.shinTop * bs, top[0], top[1], R.shinBot * 1.1 * bs, SKIN);
            capsule(top[0], top[1], R.shinBot * 1.15 * bs, ft[0], ft[1], R.foot * bs, BOOT);
        } else {
            capsule(trunkEnd[0], trunkEnd[1], R.thighTop * 0.88 * bs,
                top[0], top[1], R.thighBot * bs, SKIN);
            capsule(top[0], top[1], R.thighBot * 1.1 * bs, kn[0], kn[1], R.shinTop * bs, BOOT);
            capsule(kn[0], kn[1], R.shinTop * bs, ft[0], ft[1], R.foot * bs, BOOT);
        }
        // The toe, pointing the way the foot leads.
        var tx = ft[0] + (ft[0] - kn[0]) * 0.1;
        var dir = (ft[0] - hi[0]) >= 0 ? 1 : -1;
        capsule(ft[0], ft[1], R.foot * bs, tx + dir * R.toeLen * bs, ft[1] + 0.4,
            R.toe * bs, BOOT);
    }

    function drawArm(S, sh, el, ha, sc, fatS, fatE) {
        var bs = sc.bs;
        capsule(sh[0], sh[1], R.armTop * bs, el[0], el[1], R.armMid * bs, SKIN, fatS);
        capsule(el[0], el[1], R.foreTop * bs, ha[0], ha[1], R.foreBot * bs, SKIN, fatE);
        // The fist is deliberately oversized. A correctly-proportioned fist at
        // this scale is two pixels and a punch reads as an arm twitching.
        blob(ha[0], ha[1], R.fist * bs * (fatE || 1), R.fist * bs * (fatE || 1), SKIN);
    }

    /* Build one frame's pixels. */
    function build(style, pose, view, frame) {
        var S = norm(style);
        var sc = scalesOf(S);
        var def = POSE[pose] || POSE.idle;
        var n = def.n;
        var f = frame | 0;
        if (f < 0) f = 0; if (f >= n) f = n - 1;

        var j = def.gen ? def.gen(f, n) : def.f[f];
        var flat = !!j._flat;
        if (!def.gen && !flat) j = merged(j);
        else if (def.gen) j = merged(j);

        pix.fill(0);
        parts.length = 0;

        // Project every joint into screen units, then into pixels.
        var o = [0, 0, 0], k, i;
        for (i = 0; i < JOINTS.length; i++) {
            k = JOINTS[i];
            project(j[k], view, flat, o);
            P[k][0] = poser.AX + o[0] * sc.ms;
            P[k][1] = GY - o[1] * sc.hs;
            P[k][2] = o[2];
        }

        var bs = sc.bs;
        var depthFat = function (d) {
            if (view === 'side') return 1;
            var fv = 1 + d * DEPTH_FAT;
            var mx = 1 + DEPTH_FAT_MAX;
            return fv < 1 ? 1 : (fv > mx ? mx : fv);
        };

        // --- torso and neck: always in the middle of the sort
        var torsoD = (P.pel[2] + P.cst[2]) * 0.5;
        part(torsoD, function () {
            capsule(P.pel[0], P.pel[1], R.torsoPel * bs,
                P.wst[0], P.wst[1], R.torsoPel * 1.02 * bs, TRUNK);
            capsule(P.wst[0], P.wst[1], R.torsoPel * 1.02 * bs,
                P.cst[0], P.cst[1], R.torsoCst * bs, SKIN);
            capsule(P.shA[0], P.shA[1], R.shoulder * bs,
                P.shB[0], P.shB[1], R.shoulder * bs, SKIN);
            capsule(P.cst[0], P.cst[1], R.neck * bs,
                P.nek[0], P.nek[1], R.neck * bs, SKIN);
            // Trunks waistband, so the two materials do not just abut.
            capsule(P.hiA[0], P.hiA[1], R.thighTop * 0.9 * bs,
                P.hiB[0], P.hiB[1], R.thighTop * 0.9 * bs, TRUNK);
        });

        // --- limbs, each sorted on its own depth
        part((P.hiA[2] + P.ftA[2]) * 0.5 - 0.01, function () {
            drawLeg(S, P.hiA, P.knA, P.ftA, sc, S);
        });
        part((P.hiB[2] + P.ftB[2]) * 0.5, function () {
            drawLeg(S, P.hiB, P.knB, P.ftB, sc, S);
        });
        part((P.shA[2] + P.haA[2]) * 0.5 + 0.01, function () {
            drawArm(S, P.shA, P.elA, P.haA, sc, depthFat(P.shA[2]), depthFat(P.haA[2]));
        });
        part((P.shB[2] + P.haB[2]) * 0.5, function () {
            drawArm(S, P.shB, P.elB, P.haB, sc, depthFat(P.shB[2]), depthFat(P.haB[2]));
        });

        // --- head
        var hd = P.hed;
        part(hd[2] + 0.02, function () {
            var rx = R.headRx * sc.hd, ry = R.headRy * sc.hd;
            blob(hd[0], hd[1], rx, ry, SKIN);
            // Which way is the face pointing, in screen terms?
            var fwd = flat ? (j._fwd || [1, 0, 0]) : null;
            var fx = 0, toward = true;
            if (view === 'side') {
                fx = flat ? (fwd[0] >= 0 ? 1 : -1) : 1;
            } else if (view === 'front') {
                fx = 0; toward = true;
            } else {
                fx = 0; toward = false;
            }
            drawFace(hd[0], hd[1], rx, ry, S, fx, toward);
            // fx is 0 head-on, +-1 in profile. Hair needs to know which --
            // passing `fx || 1` threw that away and drew every profile-shaped
            // hairstyle from the front.
            drawHair(hd[0], hd[1], rx, ry, S, fx,
                S.hair * 97 + S.build.charCodeAt(0), view);
        });

        // Painter's algorithm, far to near. Stable: equal depths keep their
        // insertion order, so the torso never flickers against an arm.
        for (i = 1; i < parts.length; i++) {
            var cur = parts[i], b = i - 1;
            while (b >= 0 && parts[b].d > cur.d) { parts[b + 1] = parts[b]; b--; }
            parts[b + 1] = cur;
        }
        for (i = 0; i < parts.length; i++) parts[i].fn();

        outlinePass();
        return pix;
    }

    /* ===================================================================== */
    /* PUBLIC API                                                            */
    /* ===================================================================== */

    poser.render = function (style, pose, view, frame) {
        if (!POSE[pose]) pose = 'idle';
        if (view !== 'front' && view !== 'back') view = 'side';
        build(style, pose, view, frame);
        return pix.slice();           // callers retain these; never hand out
        // the scratch buffer.
    };

    // romFrame cache. Keyed by style + pose + view + frame, because gfx streams
    // these into VRAM and two different frames sharing a key would hand the
    // tile cache the wrong pixels.
    var romCache = Object.create(null);
    var romBytes = 0;

    poser.rom = function (style, pose, view, frame) {
        if (!POSE[pose]) pose = 'idle';
        if (view !== 'front' && view !== 'back') view = 'side';
        var n = POSE[pose].n;
        frame = frame | 0;
        if (frame < 0 || frame >= n) frame = 0;
        var key = poser.styleKey(style) + '|' + pose + '|' + view + '|' + frame;
        var hit = romCache[key];
        if (hit) return hit;
        build(style, pose, view, frame);
        var rom = gfx.romFrame(pix.slice(), FW >> 3, FH >> 3, poser.AX, poser.AY);
        romCache[key] = rom;
        romBytes += FW * FH;
        return rom;
    };

    /* Warm the cache for a set of styles, a slice at a time.

       Returns a stepper the boot loader calls once per frame; it returns true
       when there is nothing left. Generating three hundred frames in one go
       locks the page for a second with no progress bar moving, which looks
       like a hang rather than a load. */
    poser.prepare = function (styles, onProgress) {
        var jobs = [];
        var views = ['side', 'front', 'back'];
        var seen = Object.create(null);
        for (var s = 0; s < styles.length; s++) {
            var key = poser.styleKey(styles[s]);
            if (seen[key]) continue;              // two wrestlers, one build
            seen[key] = 1;
            for (var p in POSE) {
                for (var v = 0; v < views.length; v++) {
                    for (var f = 0; f < POSE[p].n; f++) {
                        jobs.push([styles[s], p, views[v], f]);
                    }
                }
            }
        }
        var i = 0, total = jobs.length;
        var SLICE = 14;        // frames per call: about 4ms on a slow machine
        if (onProgress) onProgress(0, total);
        return function step() {
            var end = Math.min(total, i + SLICE);
            for (; i < end; i++) {
                var jb = jobs[i];
                poser.rom(jb[0], jb[1], jb[2], jb[3]);
            }
            if (onProgress) onProgress(i, total);
            return i >= total;
        };
    };

    poser.clearCache = function () {
        romCache = Object.create(null);
        romBytes = 0;
        gfx.flushStream();
    };

    poser.cacheBytes = function () { return romBytes; };
    poser.cacheCount = function () { return Object.keys(romCache).length; };



    window.poser = poser;
})();
