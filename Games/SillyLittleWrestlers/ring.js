/* =============================================================================
   SLWF - ring.js
   The pseudo-3D ring: projection, surfaces, bounds, rope physics, gravity and
   the camera. No DOM, no drawing.

   The geometry constants are NOT here -- they live in core.ARENA, because the
   art module lays the arena into the tile planes from the same numbers. Split
   them and a wrestler stands two pixels inside the rope.
   ============================================================================= */
(function () {
    'use strict';

    var ring = {};
    var A = core.ARENA;
    var fp = core.fp, px = core.px;

    /* ----------------------------------------------------------- constants */

    // All in fixed point unless named _PX.
    var RING_HX = fp(A.RING_HX);
    var RING_HY = fp(A.RING_HY);
    var FAR_INSET = fp(A.FAR_INSET);
    var FLOOR_HX = fp(A.FLOOR_HX);
    var FLOOR_HY = fp(A.FLOOR_HY);
    var APRON_W = fp(22);          // walkable ledge outside the ropes

    ring.GRAV = 112;               // ~0.44 px/frame^2
    ring.FRICTION = 236;           // 0.92 in 8.8, applied to sliding bodies
    ring.ROPE_BOUNCE = 300;        // 1.17 -- a whip comes back faster than it left
    ring.TOP_ROPE_Z = fp(A.ROPE_Z[2]);
    ring.POST_Z = fp(A.POST_H);

    // Surfaces. A wrestler's z is always relative to the surface it is on;
    // the drop is added at projection time, which is what lets the same
    // jump arc work on the mat and on the arena floor.
    ring.RING = 0; ring.APRON = 1; ring.FLOOR = 2;
    var DROP = [0, 6, A.FLOOR_DROP];
    ring.SURFACE_DROP = DROP;

    /* ---------------------------------------------------------- the trapezoid */

    // Half-width of the ring surface at depth y. The far edge is FAR_INSET
    // narrower per side than the near edge -- the whole of the ring's
    // perspective, and the reason collision and the painted canvas agree.
    ring.halfWidth = function (y) {
        var t = y + RING_HY;                       // 0 .. 2*RING_HY
        if (t < 0) t = 0;
        var span = RING_HY << 1;
        if (t > span) t = span;
        return (RING_HX - FAR_INSET) + core.fdiv(core.fmul(FAR_INSET, t), span);
    };

    ring.bounds = function (y) {
        var hx = ring.halfWidth(y);
        return { minX: -hx, maxX: hx, hx: hx };
    };

    ring.inRing = function (x, y) {
        if (y < -RING_HY || y > RING_HY) return false;
        var hx = ring.halfWidth(y);
        return x >= -hx && x <= hx;
    };

    ring.onApronBand = function (x, y) {
        if (ring.inRing(x, y)) return false;
        if (y < -RING_HY - APRON_W || y > RING_HY + APRON_W) return false;
        var hx = ring.halfWidth(core.clamp(y, -RING_HY, RING_HY)) + APRON_W;
        return x >= -hx && x <= hx;
    };

    ring.surfaceAt = function (x, y) {
        if (ring.inRing(x, y)) return ring.RING;
        if (ring.onApronBand(x, y)) return ring.APRON;
        return ring.FLOOR;
    };

    // Clamp a position to the outermost legal ground, so nobody walks into
    // the crowd.
    ring.clampFloor = function (w) {
        if (w.x < -FLOOR_HX) { w.x = -FLOOR_HX; if (w.vx < 0) w.vx = 0; }
        if (w.x > FLOOR_HX) { w.x = FLOOR_HX; if (w.vx > 0) w.vx = 0; }
        if (w.y < -FLOOR_HY) { w.y = -FLOOR_HY; if (w.vy < 0) w.vy = 0; }
        if (w.y > FLOOR_HY) { w.y = FLOOR_HY; if (w.vy > 0) w.vy = 0; }
    };

    /* ---------------------------------------------------------- projection */

    ring.camX = 0;
    ring.camTarget = 0;

    // Screen position of a world point. Still no per-sprite scaling -- the
    // whole view is scaled by the same constant, so a wrestler at the back of
    // the ring is the same size as one at the front and depth is carried
    // entirely by the vertical offset and the draw-order sort.
    //
    // V converts logical pixels to screen pixels. camX is in SCREEN pixels,
    // because it also drives the plane scroll registers.
    var V = core.VIEW;

    ring.screenX = function (x) { return px(x) * V - ring.camX + (core.VW >> 1); };

    // World x to PLANE x. Not the same as screenX plus the camera: the art
    // lays the arena around art.ORIGIN_X, not around the middle of the
    // screen, and anything that writes cells under a world position -- blood
    // on the canvas, a flexing rope -- has to go through here.
    ring.planeX = function (x) {
        return ((window.art && art.ORIGIN_X) || 1024) + px(x) * V;
    };
    ring.planeY = function (y, z, surface) {
        return ring.screenY(y, z, surface);
    };
    ring.screenY = function (y, z, surface) {
        return (A.HORIZON + ((px(y) * A.PERSP) >> 8) - px(z) + DROP[surface || 0]) * V;
    };

    ring.project = function (w) {
        w.sx = ring.screenX(w.x);
        w.sy = ring.screenY(w.y, w.z, w.surface);
    };

    // Depth key for the draw-order sort: the surface drop has to be in it or a
    // wrestler on the floor sorts as though he were on the mat.
    ring.depthKey = function (w) {
        return (((px(w.y) * A.PERSP) >> 8) + DROP[w.surface || 0]) * V;
    };

    /* ------------------------------------------------------------- physics */

    // One integration step. The caller has already decided what vx/vy/vz are;
    // this moves the body, applies gravity, lands it, and reports what it ran
    // into so the state machine can react.
    //
    // ropeMode:
    //   'block'  walking: the ropes stop you
    //   'bounce' running or whipped: the ropes throw you back
    //   'through' thrown or diving: you pass over/through them
    ring.step = function (w) {
        var ev = { rope: 0, post: 0, landed: false, leftRing: false, enteredRing: false };
        var wasSurface = w.surface;

        w.x += w.vx;
        w.y += w.vy;

        // Vertical first, so a landing is detected before containment runs.
        if (w.z > 0 || w.vz !== 0) {
            w.vz -= ring.GRAV;
            w.z += w.vz;
            if (w.z <= 0) {
                w.z = 0;
                // Impact speed is wanted by the caller for slam damage.
                ev.landed = true; ev.impact = -w.vz;
                w.vz = 0;
            }
        }

        // Containment. Above the top rope nothing holds you in, which is how
        // a dive to the outside works without a special case.
        var airborne = w.z > ring.TOP_ROPE_Z;
        var mode = w.ropeMode || 'block';

        if (!airborne && mode !== 'through') {
            var hx = ring.halfWidth(w.y);
            var hitSide = 0;
            if (w.x < -hx) hitSide = -1; else if (w.x > hx) hitSide = 1;
            var hitDepth = 0;
            if (w.y < -RING_HY) hitDepth = -1; else if (w.y > RING_HY) hitDepth = 1;

            // Only contain a wrestler who was in the ring to begin with --
            // somebody brawling on the floor must not be pushed into it.
            if (wasSurface === ring.RING && (hitSide || hitDepth)) {
                if (mode === 'bounce') {
                    if (hitSide) {
                        w.x = hitSide < 0 ? -hx : hx;
                        w.vx = -core.fmul(w.vx, ring.ROPE_BOUNCE);
                        ev.rope = hitSide < 0 ? 4 : 2;     // W / E
                    }
                    if (hitDepth) {
                        w.y = hitDepth < 0 ? -RING_HY : RING_HY;
                        w.vy = -core.fmul(w.vy, ring.ROPE_BOUNCE);
                        ev.rope = hitDepth < 0 ? 1 : 3;    // N / S
                    }
                } else {
                    if (hitSide) { w.x = hitSide < 0 ? -hx : hx; w.vx = 0; ev.rope = hitSide < 0 ? 4 : 2; }
                    if (hitDepth) { w.y = hitDepth < 0 ? -RING_HY : RING_HY; w.vy = 0; ev.rope = hitDepth < 0 ? 1 : 3; }
                }
            }
        }

        ring.clampFloor(w);

        // Resolve which surface the body is standing on now.
        var s = ring.surfaceAt(w.x, w.y);
        if (s !== w.surface) {
            if (w.surface === ring.RING && s !== ring.RING) ev.leftRing = true;
            if (w.surface !== ring.RING && s === ring.RING) ev.enteredRing = true;
            w.surface = s;
        }

        return ev;
    };

    /* ----------------------------------------------------------- the corners */

    // Corner posts, near pair first so a "nearest corner" search prefers the
    // ones the player can actually see behind.
    ring.corners = function () {
        var hxNear = ring.halfWidth(RING_HY), hxFar = ring.halfWidth(-RING_HY);
        return [
            { x: -hxNear, y: RING_HY, i: 0 },
            { x: hxNear, y: RING_HY, i: 1 },
            { x: -hxFar, y: -RING_HY, i: 2 },
            { x: hxFar, y: -RING_HY, i: 3 }
        ];
    };

    var CORNER_R = fp(34);

    ring.nearestCorner = function (x, y) {
        var cs = ring.corners(), best = null, bd = 1 << 30;
        for (var i = 0; i < cs.length; i++) {
            var dx = px(cs[i].x - x), dy = px(cs[i].y - y);
            var d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = cs[i]; }
        }
        best.dist = fp(Math.sqrt(bd) | 0);
        return best;
    };

    ring.inCorner = function (x, y) {
        var c = ring.nearestCorner(x, y);
        return c.dist <= CORNER_R ? c : null;
    };

    // Which rope run a body is standing against, or 0. Used for whips, apron
    // steps and rope breaks during a submission.
    ring.atRopes = function (x, y) {
        if (!ring.inRing(x, y)) return 0;
        var hx = ring.halfWidth(y), near = fp(14);
        if (y > RING_HY - near) return 3;
        if (y < -RING_HY + near) return 1;
        if (x > hx - near) return 2;
        if (x < -hx + near) return 4;
        return 0;
    };

    // Distance to the nearest rope, for the submission rope-break rule.
    ring.ropeDistance = function (x, y) {
        if (!ring.inRing(x, y)) return 0;
        var hx = ring.halfWidth(y);
        var d = Math.min(px(hx - (x < 0 ? -x : x)), px(RING_HY - (y < 0 ? -y : y)));
        return d < 0 ? 0 : d;
    };

    /* -------------------------------------------------------------- camera */

    // Pan horizontally to keep everyone framed, easing rather than snapping.
    // The clamp keeps the plane's wrap seam off screen; the arena is ~700px
    // wide inside a 1024px plane, so there is room either side.
    var CAM_MIN = -(A.FLOOR_HX * V - (core.VW >> 1) + 20 * V);
    var CAM_MAX = (A.FLOOR_HX * V - (core.VW >> 1) + 20 * V);

    ring.resetCamera = function () { ring.camX = 0; ring.camTarget = 0; };

    ring.updateCamera = function (list) {
        var lo = 1e9, hi = -1e9, n = 0;
        for (var i = 0; i < list.length; i++) {
            var w = list[i];
            if (!w || w.out) continue;
            var sxw = px(w.x) * V;
            if (sxw < lo) lo = sxw;
            if (sxw > hi) hi = sxw;
            n++;
        }
        if (!n) return;
        var mid = (lo + hi) >> 1;
        // If they are further apart than the screen can hold, favour the
        // midpoint anyway -- a camera that picks a favourite is worse than one
        // that lets somebody clip the edge.
        ring.camTarget = core.clamp(mid, CAM_MIN, CAM_MAX);
        var d = ring.camTarget - ring.camX;
        // Ease, but never move less than a pixel or the camera creeps forever.
        if (d !== 0) {
            var step = d >> 3;
            if (step === 0) step = d > 0 ? 1 : -1;
            ring.camX += step;
        }
    };

    // Push the camera into the plane scroll registers. Plane B carries the
    // crowd and gets a slower scroll on its upper rows through the per-line
    // table -- real VDP line scroll, and the only way to parallax a crowd that
    // shares a plane with the ring.
    // The art lays the arena around plane x = art.ORIGIN_X, while screenX puts
    // world x = 0 at the middle of the screen. The scroll register has to
    // carry the difference or the camera looks at empty plane -- which is a
    // ring that renders perfectly and is simply not where you are pointing.
    ring.planeOffset = function () {
        var o = (window.art && art.ORIGIN_X) || 512;
        return o - (core.VW >> 1);
    };

    ring.applyScroll = function () {
        var sx = ring.camX + ring.planeOffset();
        gfx.planeA.sx = sx;
        gfx.planeB.sx = sx;
        var hs = gfx.planeB.hs || gfx.enableLineScroll(gfx.planeB);
        var crowdBottom = (A.BARRICADE_Y + 8) * V;
        for (var y = 0; y < core.VH; y++) {
            // The crowd parallaxes at half rate. Its offset is taken about the
            // same origin so the back wall stays behind the ring rather than
            // sliding out from under it.
            hs[y] = (y < crowdBottom)
                ? ((ring.camX >> 1) + ring.planeOffset())
                : sx;
        }
    };

    /* ------------------------------------------------------------ distances */

    ring.dist = function (a, b) {
        var dx = px(a.x - b.x), dy = px(a.y - b.y);
        return Math.sqrt(dx * dx + dy * dy) | 0;
    };

    // Depth-weighted separation: two wrestlers a long way apart in depth are
    // not in grapple range even if their x matches, but depth counts for less
    // than width because the camera compresses it.
    ring.reach = function (a, b) {
        var dx = px(a.x - b.x), dy = (px(a.y - b.y) * A.PERSP) >> 8;
        return Math.sqrt(dx * dx + dy * dy * 4) | 0;
    };

    // Never -1. dirFromVec reports "no direction" for a zero vector, which is
    // the right answer for a movement stick and the wrong one for a facing:
    // two wrestlers can genuinely occupy the same point (a pin sets the
    // attacker's x to the victim's), and -1 indexed into DIRVEC is undefined
    // and takes the frame down.
    ring.facing = function (a, b) {
        var d = core.dirFromVec(b.x - a.x, b.y - a.y);
        return d < 0 ? (a.dir >= 0 ? a.dir : core.DIR.R) : d;
    };

    // Is b in front of a, given a's facing? Strikes need this.
    ring.inFront = function (a, b) {
        var v = core.DIRVEC[a.dir] || core.DIRVEC[0];
        var dx = b.x - a.x, dy = b.y - a.y;
        return (core.fmul(v[0], dx) + core.fmul(v[1], dy)) > 0;
    };

    /* ----------------------------------------------------------- stipulation */

    // The cage changes one rule: the ropes become walls that never let you
    // out, and climbing is the only exit. Everything else reads these flags.
    ring.cage = false;
    ring.noRingOut = false;

    ring.setStipulation = function (s) {
        ring.cage = !!(s && s.cage);
        ring.noRingOut = !!(s && (s.cage || s.noRingOut));
    };

    ring.init = function () {
        ring.resetCamera();
    };

    window.ring = ring;
})();
