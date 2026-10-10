/* =============================================================================
   SLWF - art.js
   Every non-wrestler tile in the game, generated in code. No image assets ship
   with this project, so the ring, the crowd, the arena, the effects, the
   weapons, the referee and the title logo are all drawn here as arrays of
   palette indices and handed to gfx.

   Three things in here are load-bearing:

   * The ARENA IS AUTHORED FOR THE LEFT HALF AND MIRRORED. A ring is symmetric
     about its centre line and the hardware has a horizontal flip bit per cell,
     so every tile on the right-hand side of the ring is the left-hand tile with
     gfx.HF set. `MIRROR_COL - col` is the mirror of a column; it is 127 because
     the ring's centre line sits on plane pixel 511.5, between cells 63 and 64.
     Authoring both halves would roughly double the arena's tile cost for art
     that is identical.

   * EVERY 1x1 TILE IS CONTENT-DEDUPLICATED (`defTile`). The canvas trapezoid's
     diagonal edge steps one pixel every five rows and the side ropes do the
     same, so most of those cells are byte-for-byte identical to a neighbour.
     Dedup takes the rope zone from 56 authored cells to a handful of tiles and
     is the only reason the diagonals are affordable at all.

   * FX, WEAPONS AND THE REFEREE COST NO STATIC TILES. They are gfx.romFrame
     pixel arrays, streamed into the DMA ring when they are actually on screen.
     Only the arena and the logo draw from the 1024-tile static pool, which the
     font also lazily eats 150-250 tiles of.

   Determinism: no Math.random() anywhere. Texture scatter comes from hash2() of
   the tile and pixel coordinates, so the arena is identical on every load.
   ============================================================================= */
(function () {
    'use strict';

    var art = {};

    /* ======================================================================
       Plane layout constants
       ====================================================================== */

    // Plane pixel x of world x = 0. The planes are 1024px wide and the arena is
    // about 600, so the camera pans inside one plane and no wrap seam is ever
    // on screen. 512 is both the plane centre and cell-aligned.
    var ORIGIN_X = 512;
    // Published because ring.js has to turn the camera into a plane scroll
    // value and the two must agree about where world x = 0 sits in the plane.
    art.ORIGIN_X = ORIGIN_X;

    // Mirror of column c is MIRROR_COL - c. See the header.
    var MIRROR_COL = 127;

    var CROWD_BANDS = 3;        // far / mid / near rows of spectators
    var CROWD_VARIANTS = 4;     // distinct tiles per band
    var CROWD_PHASES = 4;       // animation phases cycled into tile content

    /* ----------------------------------------------------- arena palette (0) */

    var BLACK = 1, CSHADOW = 2, CWHITE = 3;
    var APRON_D = 4, APRON_M = 5, APRON_L = 6;
    var YEL_D = 7, YEL = 8;
    var FLOOR_D = 9, FLOOR_M = 10;
    var CROWD_D = 11, CROWD_M = 12, CROWD_L = 13;

    /* -------------------------------------------------------- UI palette (3) */

    var UI_BLACK = 1, UI_DARK = 2, UI_MID = 3, UI_LIGHT = 4, UI_WHITE = 5;
    var UI_RED = 6, UI_ORANGE = 7, UI_YELLOW = 8, UI_GREEN = 9, UI_CYAN = 10;
    var UI_WOOD = 13, UI_STEEL = 14, UI_STEELL = 15;

    /* ======================================================================
       Geometry derived from core.ARENA. Filled by geom() inside init(), never
       at parse time -- core.ARENA is the physics module's copy of these numbers
       and art.js is not allowed to have its own.
       ====================================================================== */

    var A = null;
    var CAN_TOP, CAN_BOT, CAN_H;          // canvas top/bottom in plane px
    var R_CROWD0, R_CROWD1, R_BARR0, R_BARR1, R_FLOOR0;
    var R_CAN0, R_CAN1, R_APR0, R_APR1, R_BOT;
    var C_NEAR_L, C_NEAR_R, C_FAR_L, C_FAR_R;
    var C_EDGE0, C_EDGE_N;                // left edge/rope zone
    var C_POST_NEAR, C_POST_FAR;
    var POST_ROWS, POST_H_PX;
    var PRIO_SPLIT;

    function geom() {
        A = core.ARENA;

        // Snap the canvas to cell rows. The unrounded far edge is one pixel
        // above the snapped one (79 vs 80 at the shipped constants); a single
        // pixel of depth is not worth a per-row partial tile.
        CAN_TOP = (A.HORIZON + (((-A.RING_HY * A.PERSP) >> 8)) + 7) & ~7;
        CAN_BOT = (A.HORIZON + ((A.RING_HY * A.PERSP) >> 8)) & ~7;
        CAN_H = CAN_BOT - CAN_TOP;

        R_CROWD0 = Math.max(0, (A.BARRICADE_Y - A.CROWD_H) >> 3);
        R_CROWD1 = (A.BARRICADE_Y >> 3) - 1;
        R_BARR0 = A.BARRICADE_Y >> 3;
        R_BARR1 = R_BARR0 + 1;
        R_FLOOR0 = R_BARR1 + 1;

        R_CAN0 = CAN_TOP >> 3;
        R_CAN1 = (CAN_BOT >> 3) - 1;
        R_APR0 = CAN_BOT >> 3;
        R_APR1 = R_APR0 + (((A.APRON_H + 7) >> 3) - 1);
        R_BOT = (core.VH >> 3) - 1;

        C_NEAR_L = (ORIGIN_X - A.RING_HX) >> 3;
        C_NEAR_R = MIRROR_COL - C_NEAR_L;
        C_FAR_L = (ORIGIN_X - A.RING_HX + A.FAR_INSET) >> 3;
        C_FAR_R = MIRROR_COL - C_FAR_L;

        // The zone the diagonal canvas edge and the three side ropes live in.
        // One cell left of the near edge (the ropes' outside highlight pixel
        // falls there) through the far edge column.
        C_EDGE0 = C_NEAR_L - 1;
        C_EDGE_N = C_FAR_L - C_EDGE0 + 1;

        C_POST_NEAR = C_NEAR_L - 1;
        C_POST_FAR = C_FAR_L - 1;

        POST_ROWS = (A.POST_H + 7) >> 3;
        POST_H_PX = POST_ROWS * 8;

        // Plane A arena cells at or below this row are high priority, so a
        // wrestler near the camera walks behind the near ropes.
        PRIO_SPLIT = A.HORIZON >> 3;
    }

    // Half-width of the canvas at plane row py: the far edge is FAR_INSET
    // narrower per side than the near edge, linearly over CAN_H rows.
    function halfW(py) {
        var d = py - CAN_TOP;
        if (d < 0) d = 0; else if (d > CAN_H) d = CAN_H;
        return (A.RING_HX - A.FAR_INSET) + ((d * A.FAR_INSET / CAN_H) | 0);
    }

    // Plane x of the leftmost canvas pixel on row py.
    function leftEdge(py) { return ORIGIN_X - halfW(py); }

    /* ======================================================================
       Pixel-buffer helpers. A "buf" is a Uint8Array of palette indices with a
       width; 0 is transparent in every palette.
       ====================================================================== */

    function buf(w, h) { return new Uint8Array(w * h); }

    function px(p, w, h, x, y, v) {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        p[y * w + x] = v;
    }
    function at(p, w, h, x, y) {
        if (x < 0 || y < 0 || x >= w || y >= h) return 0;
        return p[y * w + x];
    }
    function rect(p, w, h, x, y, rw, rh, v) {
        for (var j = 0; j < rh; j++) {
            var yy = y + j;
            if (yy < 0 || yy >= h) continue;
            for (var i = 0; i < rw; i++) {
                var xx = x + i;
                if (xx < 0 || xx >= w) continue;
                p[yy * w + xx] = v;
            }
        }
    }
    function hline(p, w, h, x0, x1, y, v) { rect(p, w, h, x0, y, x1 - x0 + 1, 1, v); }
    function vline(p, w, h, x, y0, y1, v) { rect(p, w, h, x, y0, 1, y1 - y0 + 1, v); }

    function disc(p, w, h, cx, cy, r, v) {
        var rr = r * r + r;
        for (var y = -r; y <= r; y++) {
            for (var x = -r; x <= r; x++) {
                if (x * x + y * y <= rr) px(p, w, h, cx + x, cy + y, v);
            }
        }
    }
    function annulus(p, w, h, cx, cy, r0, r1, v) {
        var a = r0 * r0, b = r1 * r1 + r1;
        for (var y = -r1; y <= r1; y++) {
            for (var x = -r1; x <= r1; x++) {
                var d = x * x + y * y;
                if (d >= a && d <= b) px(p, w, h, cx + x, cy + y, v);
            }
        }
    }
    function thickLine(p, w, h, x0, y0, x1, y1, t, v) {
        var dx = x1 - x0, dy = y1 - y0;
        var n = Math.max(Math.abs(dx), Math.abs(dy));
        var o = t >> 1;
        if (n === 0) { rect(p, w, h, x0 - o, y0 - o, t, t, v); return; }
        for (var i = 0; i <= n; i++) {
            var x = x0 + Math.round(dx * i / n);
            var y = y0 + Math.round(dy * i / n);
            rect(p, w, h, x - o, y - o, t, t, v);
        }
    }
    // A ray from (cx,cy) along a 1/256-turn angle, thickness tapering t0 -> t1.
    function ray(p, w, h, cx, cy, ang, r0, r1, t0, t1, v) {
        var c = core.COS[ang & 255], s = core.SIN[ang & 255];
        var span = (r1 - r0) || 1;
        for (var r = r0; r <= r1; r++) {
            var t = t0 + (((t1 - t0) * (r - r0) / span) | 0);
            if (t < 1) t = 1;
            var x = cx + ((c * r) >> 8), y = cy + ((s * r) >> 8);
            if (t === 1) px(p, w, h, x, y, v);
            else rect(p, w, h, x - (t >> 1), y - (t >> 1), t, t, v);
        }
    }

    // Deterministic scatter. Two coordinates in, 32 bits of hash out.
    function hash2(a, b) {
        var h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x2545f491);
        h = h ^ (h >>> 13);
        return h >>> 0;
    }

    function dilate(m, w, h, r) {
        var o = new Uint8Array(w * h), lim = r * r + r;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                if (!m[y * w + x]) continue;
                for (var dy = -r; dy <= r; dy++) {
                    for (var dx = -r; dx <= r; dx++) {
                        if (dx * dx + dy * dy > lim) continue;
                        var nx = x + dx, ny = y + dy;
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h) o[ny * w + nx] = 1;
                    }
                }
            }
        }
        return o;
    }

    // Lay a one-pixel outline of `v` around everything already drawn, without
    // disturbing the art: the silhouette is dilated into a copy and the art is
    // painted back over it.
    function outlineBuf(p, w, h, v) {
        var o = buf(w, h);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                if (p[y * w + x]) continue;
                if (at(p, w, h, x - 1, y) || at(p, w, h, x + 1, y) ||
                    at(p, w, h, x, y - 1) || at(p, w, h, x, y + 1)) o[y * w + x] = v;
            }
        }
        for (var i = 0; i < p.length; i++) if (o[i] && !p[i]) p[i] = o[i];
    }

    /* ======================================================================
       Static tile allocation, with content dedup. See the header.
       ====================================================================== */

    var tileMap = null;
    var tilesUsed = 0;
    var scratch = new Uint8Array(64);

    function alloc(n) { tilesUsed += n; return gfx.allocStatic(n); }

    // Cut one 8x8 tile out of a buffer, dedup it, return its index.
    // An all-transparent tile is tile 0, which gfx reserves blank forever.
    function defTile(p, w, ox, oy) {
        var any = false, i = 0;
        for (var y = 0; y < 8; y++) {
            var row = (oy + y) * w + ox;
            for (var x = 0; x < 8; x++) {
                var v = p[row + x] & 15;
                scratch[i++] = v;
                if (v) any = true;
            }
        }
        if (!any) return 0;
        var key = String.fromCharCode.apply(null, scratch);
        var hit = tileMap[key];
        if (hit !== undefined) return hit;
        var idx = alloc(1);
        gfx.uploadTile(idx, scratch, 8, 0, 0);
        tileMap[key] = idx;
        return idx;
    }

    // Slice a whole buffer into a grid of deduped tiles.
    function defGrid(p, w, h) {
        var cols = w >> 3, rows = h >> 3;
        var t = new Array(cols * rows);
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) t[r * cols + c] = defTile(p, w, c * 8, r * 8);
        }
        return { cols: cols, rows: rows, t: t };
    }

    // Place a grid into a plane. `mirror` flips it about the ring centre line:
    // column order reverses and every cell carries gfx.HF, which is exactly
    // what the hardware flip bit is for.
    function putGrid(plane, col, row, g, palId, flags, mirror) {
        flags = flags || 0;
        for (var r = 0; r < g.rows; r++) {
            for (var c = 0; c < g.cols; c++) {
                var t = g.t[r * g.cols + c];
                if (!t) continue;
                var tc = mirror ? (MIRROR_COL - (col + c)) : (col + c);
                gfx.cell(plane, tc, row + r, t, palId,
                    flags | (mirror ? gfx.HF : 0));
            }
        }
    }

    /* ======================================================================
       CROWD
       A dense dark mass of heads and shoulders in the three crowd tones, in
       three depth bands. The animation does NOT touch cells: crowdFrame()
       re-uploads the tile CONTENT, so a few dozen bytes of DMA a frame animate
       every spectator on screen at once. That is the hardware trick and it is
       the only affordable way to make thousands of pixels seethe.
       ====================================================================== */

    var CROWD_HEADS = [3, 3, 2];   // heads per tile, per band
    var CROWD_HR = [1, 1, 2];   // head radius, per band
    var crowdBase = 0;
    var crowdPix = null;           // [band*VARIANTS + variant][phase] -> 64 bytes

    function crowdTile(band, variant, phase) {
        var p = buf(8, 8);
        // Base is always the darkest tone: the crowd must stay dark enough for
        // white-outlined wrestlers and the HUD to read over it.
        rect(p, 8, 8, 0, 0, 8, 8, CROWD_D);

        var n = CROWD_HEADS[band], hr = CROWD_HR[band];
        for (var i = 0; i < n; i++) {
            var h = hash2(variant * 97 + i * 31, band * 7 + 3);
            var hx = 1 + (h % 6);
            var hy = 2 + ((h >> 4) % 5);
            // Bob: each head keeps its own phase offset so neighbouring cells
            // (different variants) never move in lockstep.
            var bob = (((phase + i + variant) & 3) < 2) ? 0 : -1;
            hy += bob;

            var tone = ((h >> 8) & 3) === 0 ? CROWD_L : CROWD_M;
            disc(p, 8, 8, hx, hy, hr, tone);
            // Shoulders: a wider, darker mass under the head.
            rect(p, 8, 8, hx - hr - 1, hy + hr + 1, hr * 2 + 3, 2, CROWD_M);
            if (band === 2) {
                px(p, 8, 8, hx - hr, hy - hr, CROWD_L);
                px(p, 8, 8, hx + hr + 1, hy + hr + 1, BLACK);
            }
            // A waving arm on a fraction of the heads, length driven by phase.
            if (((h >> 12) & 3) === 0) {
                var len = 1 + ((phase + i) & 1) * 2;
                vline(p, 8, 8, hx + hr + 1, hy - len, hy, CROWD_L);
            }
        }
        return p;
    }

    function buildCrowd() {
        var n = CROWD_BANDS * CROWD_VARIANTS;
        crowdBase = alloc(n);
        crowdPix = new Array(n);
        for (var b = 0; b < CROWD_BANDS; b++) {
            for (var v = 0; v < CROWD_VARIANTS; v++) {
                var slot = b * CROWD_VARIANTS + v;
                crowdPix[slot] = new Array(CROWD_PHASES);
                for (var ph = 0; ph < CROWD_PHASES; ph++) {
                    crowdPix[slot][ph] = crowdTile(b, v, ph);
                }
            }
        }
        art.crowdFrame(0);
    }

    art.crowdFrame = function (n) {
        if (!crowdPix) return;
        n = n | 0;
        for (var i = 0; i < crowdPix.length; i++) {
            // The per-slot offset keeps the banks out of phase with each other.
            var ph = (n + i) & (CROWD_PHASES - 1);
            gfx.uploadTile(crowdBase + i, crowdPix[i][ph], 8, 0, 0);
        }
    };

    function crowdCellTile(col, row) {
        var band = (row <= R_CROWD0 + 1) ? 0
            : (row >= R_CROWD1 - 1 ? 2 : 1);
        var h = hash2(col * 13 + 7, row * 29 + 1);
        return crowdBase + band * CROWD_VARIANTS + (h & 3);
    }

    /* ======================================================================
       BARRICADE
       The guardrail in front of the crowd at ARENA.BARRICADE_Y: a lit top rail
       over a blue hoarding with yellow chevrons, on a post every sixth cell.
       Three 8x16 variants, authored side by side in one buffer.
       ====================================================================== */

    var BARR_RAIL_H = 2;
    var barrGrid = null;

    function buildBarricade() {
        var W = 24, H = 16, p = buf(W, H);
        for (var v = 0; v < 3; v++) {
            var x0 = v * 8;
            // Top rail, lit.
            rect(p, W, H, x0, 0, 8, BARR_RAIL_H, CSHADOW);
            rect(p, W, H, x0, BARR_RAIL_H, 8, 1, FLOOR_D);
            // Hoarding.
            rect(p, W, H, x0, 3, 8, 10, v === 0 ? APRON_D : APRON_M);
            if (v === 1) {
                // Yellow chevrons, which is as much branding as 8px allows.
                for (var i = 0; i < 8; i++) {
                    var yy = 5 + ((i + 2) & 3);
                    px(p, W, H, x0 + i, yy, YEL);
                    px(p, W, H, x0 + i, yy + 1, YEL_D);
                }
            }
            if (v === 2) {
                // Post.
                rect(p, W, H, x0 + 3, 0, 3, 13, CSHADOW);
                rect(p, W, H, x0 + 5, 0, 1, 13, FLOOR_M);
            }
            // Bottom lip, then the floor the barricade stands on.
            rect(p, W, H, x0, 13, 8, 1, BLACK);
            rect(p, W, H, x0, 14, 8, 2, FLOOR_D);
        }
        barrGrid = defGrid(p, W, H);
    }

    function barrCellTile(col, row) {
        var v = ((col % 6) === 0) ? 2 : (((col >> 1) & 1) ? 1 : 0);
        return barrGrid.t[(row - R_BARR0) * barrGrid.cols + v];
    }

    /* ======================================================================
       ARENA FLOOR
       Where a hardcore match spends half its time, so it is drawn as concrete
       rather than left flat: two depth bands of four hash-speckled variants,
       the near band a shade lighter so the eye reads depth off it.
       ====================================================================== */

    var FLOOR_SPECK = 26;      // speckle density out of 256
    var floorFar = null, floorNear = null, floorShadow = 0, floorLip = 0;

    function floorVariants(base, speck, seed) {
        var W = 32, p = buf(W, 8);
        for (var v = 0; v < 4; v++) {
            for (var y = 0; y < 8; y++) {
                for (var x = 0; x < 8; x++) {
                    var h = hash2(v * 211 + x + seed, y * 37 + seed);
                    var c = base;
                    if ((h & 255) < FLOOR_SPECK) c = speck;
                    else if (((h >> 8) & 255) < 10) c = BLACK;
                    px(p, W, 8, v * 8 + x, y, c);
                }
            }
            // A faint slab seam, so the floor has some scale to it.
            if (v === 3) vline(p, W, 8, v * 8 + 1, 0, 7, BLACK);
        }
        return defGrid(p, W, 8);
    }

    function buildFloor() {
        floorFar = floorVariants(FLOOR_D, FLOOR_M, 11);
        floorNear = floorVariants(FLOOR_M, FLOOR_D, 97);

        // The shadow the ring casts on the floor directly under the apron.
        var s = buf(8, 8);
        for (var y = 0; y < 8; y++) {
            for (var x = 0; x < 8; x++) {
                var h = hash2(x + 3, y * 19);
                var c = y < 3 ? BLACK : (y < 6 ? FLOOR_D : FLOOR_M);
                if (y >= 3 && (h & 255) < 20) c = BLACK;
                px(s, 8, 8, x, y, c);
            }
        }
        floorShadow = defTile(s, 8, 0, 0);

        // The ring's far lip: the strip of far apron visible beyond the canvas.
        var l = buf(8, 8);
        for (var y2 = 0; y2 < 8; y2++) {
            for (var x2 = 0; x2 < 8; x2++) {
                var c2;
                if (y2 < 4) c2 = ((hash2(x2, y2 * 7) & 255) < FLOOR_SPECK) ? FLOOR_M : FLOOR_D;
                else if (y2 === 4) c2 = BLACK;
                else if (y2 < 7) c2 = APRON_M;
                else c2 = APRON_D;
                px(l, 8, 8, x2, y2, c2);
            }
        }
        floorLip = defTile(l, 8, 0, 0);
    }

    function floorCellTile(col, row) {
        var g = (row >= R_APR0) ? floorNear : floorFar;
        var h = hash2(col * 7 + 1, row * 53 + 9);
        return g.t[h & 3];
    }

    /* ======================================================================
       RING CANVAS
       White, because blood has to show on it. Three row kinds (far edge, mid,
       near edge) of four hash-textured variants each: a flat 384x80 expanse of
       one tile would be dead, and a weave fine enough to be subliminal is a few
       canvasShadow pixels per tile and nothing more.
       ====================================================================== */

    var CANVAS_DIRT = 12;       // speckle density out of 256
    var canvasFar = null, canvasMid = null, canvasNear = null;

    // kind: 0 far edge, 1 interior, 2 near edge.
    function canvasRow(p, w, x0, kind) {
        for (var y = 0; y < 8; y++) {
            for (var x = 0; x < 8; x++) {
                var h = hash2(x0 * 31 + x, y * 17 + kind * 101);
                var c = CWHITE;
                if ((h & 255) < CANVAS_DIRT) c = CSHADOW;
                // A very loose weave: one shaded pixel on a 4x4 lattice,
                // jittered by the hash so it never reads as a grid.
                else if (((x + y + ((h >> 10) & 1)) & 3) === 0 &&
                    ((h >> 16) & 7) === 0) c = CSHADOW;
                if (kind === 0 && y === 0) c = CSHADOW;          // far edge
                if (kind === 2 && y === 7) c = CSHADOW;          // near edge
                px(p, w, 8, x0 + x, y, c);
            }
        }
    }

    function canvasVariants(kind) {
        var W = 32, p = buf(W, 8);
        for (var v = 0; v < 4; v++) canvasRow(p, W, v * 8, kind);
        // Overwrite one variant's texture with a faint centre-mark smudge so
        // the middle of the ring is not identical to its corners.
        return defGrid(p, W, 8);
    }

    function buildCanvas() {
        canvasFar = canvasVariants(0);
        canvasMid = canvasVariants(1);
        canvasNear = canvasVariants(2);
    }

    function canvasCellTile(col, row) {
        var g = (row === R_CAN0) ? canvasFar : (row === R_CAN1 ? canvasNear : canvasMid);
        var h = hash2(col * 23 + 5, row * 11 + 3);
        return g.t[h & 3];
    }

    /* ======================================================================
       THE DIAGONAL CANVAS EDGE
       The trapezoid's side: FAR_INSET pixels over CAN_H rows is a step of one
       pixel every five, so the whole diagonal fits in a four-cell-wide zone and
       most of its cells dedup against each other. Outside the edge is floor,
       then the ring's side skirt, then a black frame, then canvas.
       ====================================================================== */

    var SKIRT_W = 3;            // px of blue side skirt along the diagonal
    var edgeGrid = null;

    function buildCanvasEdge() {
        var W = C_EDGE_N * 8, H = CAN_H;
        var p = buf(W, H);
        var x0 = C_EDGE0 * 8;                  // plane x of the zone's left
        for (var y = 0; y < H; y++) {
            var py = CAN_TOP + y;
            var e = leftEdge(py) - x0;         // buffer x of the first canvas px
            var kind = (y === 0) ? 0 : (y === H - 1 ? 2 : 1);
            for (var x = 0; x < W; x++) {
                var c;
                if (x < e - SKIRT_W - 1) {
                    // Outside the ring: arena floor. These tiles land on plane
                    // B over the floor fill, so they have to carry it.
                    var h = hash2((x0 + x) * 7 + 1, py * 53 + 9);
                    c = ((h & 255) < FLOOR_SPECK) ? FLOOR_M : FLOOR_D;
                    if (((h >> 8) & 255) < 10) c = BLACK;
                } else if (x < e - 1) {
                    c = (x === e - SKIRT_W - 1) ? APRON_L : APRON_M;
                } else if (x === e - 1) {
                    c = BLACK;                 // ring frame
                } else {
                    var h2 = hash2((x0 + x) * 31 + x, y * 17 + kind * 101);
                    c = ((h2 & 255) < CANVAS_DIRT) ? CSHADOW : CWHITE;
                    if (x === e) c = CSHADOW;  // canvas edge shading
                    if (kind === 0 && y === 0) c = CSHADOW;
                    if (kind === 2 && y === H - 1) c = CSHADOW;
                }
                px(p, W, H, x, y, c);
            }
        }
        edgeGrid = defGrid(p, W, H);
    }

    /* ======================================================================
       APRON
       The blue band below the near canvas edge with SLWF in yellow across it,
       facing the camera. A black shadow line on top and a darker lower face is
       what stops it reading as more floor: it has to look like a vertical
       surface the ring stands on.
       ====================================================================== */

    var apronPlain = null, apronText = null;
    var APRON_TEXT_COLS = 12;   // 96px of SLWF, centred on the ring

    // Colour of apron pixel `dy` rows below the near canvas edge.
    function apronColor(dy) {
        if (dy === 0) return BLACK;
        if (dy === 1) return APRON_L;
        if (dy < A.APRON_H - 8) return APRON_M;
        if (dy < A.APRON_H - 1) return APRON_D;
        if (dy === A.APRON_H - 1) return BLACK;
        return -1;              // below the apron: floor
    }

    function apronPixel(p, w, h, x, y, dy, planeX) {
        var c = apronColor(dy);
        if (c < 0) {
            var hh = hash2(planeX * 7 + 1, (CAN_BOT + dy) * 53 + 9);
            c = ((hh & 255) < FLOOR_SPECK) ? FLOOR_D : FLOOR_M;
        }
        px(p, w, h, x, y, c);
    }

    /* ------------------------------------------------- chunky letter strokes */

    // Letters are strokes, not bitmaps, so the same four shapes serve the 12px
    // apron text and the 32px title logo. Each writes 1s into a mask.
    function letterS(m, w, h, x, y, lw, lh, t) {
        // An S is three full-width bars and two half-height sides, so it needs
        // at least a pixel of gap above and below the middle bar. At lh = 3t
        // the bars meet and the glyph fills its whole box -- which is exactly
        // what the apron's SLWF did until the stroke was thinned.
        if (lh < 3 * t + 2) t = Math.max(1, ((lh - 2) / 3) | 0);
        var mid = (lh - t) >> 1;
        rect(m, w, h, x, y, lw, t, 1);
        rect(m, w, h, x, y, t, mid + t, 1);
        rect(m, w, h, x, y + mid, lw, t, 1);
        rect(m, w, h, x + lw - t, y + mid, t, lh - mid - t, 1);
        rect(m, w, h, x, y + lh - t, lw, t, 1);
    }
    function letterL(m, w, h, x, y, lw, lh, t) {
        rect(m, w, h, x, y, t, lh, 1);
        rect(m, w, h, x, y + lh - t, lw, t, 1);
    }
    function letterF(m, w, h, x, y, lw, lh, t) {
        var mid = (lh - t) >> 1;
        rect(m, w, h, x, y, t, lh, 1);
        rect(m, w, h, x, y, lw, t, 1);
        rect(m, w, h, x, y + mid, (lw * 3 / 4) | 0, t, 1);
    }
    function letterW(m, w, h, x, y, lw, lh, t) {
        var o = t >> 1;
        var yT = y + o, yB = y + lh - 1 - o;
        var p0 = x + o, p1 = x + ((lw * 27 / 100) | 0), p2 = x + (lw >> 1),
            p3 = x + ((lw * 73 / 100) | 0), p4 = x + lw - 1 - o;
        var yM = y + ((lh * 42 / 100) | 0);
        thickLine(m, w, h, p0, yT, p1, yB, t, 1);
        thickLine(m, w, h, p1, yB, p2, yM, t, 1);
        thickLine(m, w, h, p2, yM, p3, yB, t, 1);
        thickLine(m, w, h, p3, yB, p4, yT, t, 1);
    }

    var LETTERS = { S: letterS, L: letterL, W: letterW, F: letterF };

    // Rasterize "SLWF" into a mask of its own, given per-letter widths.
    function slwfMask(w, h, x, y, lw, lh, t, widths) {
        var m = buf(w, h), cx = x;
        var order = ['S', 'L', 'W', 'F'];
        for (var i = 0; i < 4; i++) {
            LETTERS[order[i]](m, w, h, cx, y, widths[i], lh, t);
            cx += widths[i] + lw;      // lw is the gap here
        }
        return m;
    }

    function buildApron() {
        var aprRows = R_APR1 - R_APR0 + 1, H = aprRows * 8;

        // Plain apron: one column's worth, repeated across the near edge.
        var pp = buf(8, H);
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < 8; x++) apronPixel(pp, 8, H, x, y, y, x);
        }
        apronPlain = defGrid(pp, 8, H);

        // SLWF. Authored as one 96xH buffer so the letters can straddle cells.
        var W = APRON_TEXT_COLS * 8;
        var tp = buf(W, H);
        var baseX = ((ORIGIN_X - (W >> 1)) | 0);
        for (var y2 = 0; y2 < H; y2++) {
            for (var x2 = 0; x2 < W; x2++) apronPixel(tp, W, H, x2, y2, y2, baseX + x2);
        }

        // 3 bars of 3 plus two 2px gaps fits in 13; 14 gives the S a little
        // air. A 4px stroke in 12 rows has no gap at all.
        var LH = 14, T = 3;
        var widths = [18, 14, 22, 16];
        var total = 18 + 14 + 22 + 16 + 3 * 6;
        var m = slwfMask(W, H, (W - total) >> 1, 3, 6, LH, T, widths);
        var ol = dilate(m, W, H, 1);
        for (var i = 0; i < m.length; i++) {
            if (!ol[i]) continue;
            if (!m[i]) { tp[i] = BLACK; continue; }
            // Bevel: shade the lower-right of each stroke so 12px of letter
            // still has some weight to it.
            var xx = i % W, yy = (i / W) | 0;
            tp[i] = (!m[(yy + 2) * W + xx] || !m[yy * W + Math.min(W - 1, xx + 2)])
                ? YEL_D : YEL;
        }
        apronText = defGrid(tp, W, H);
    }

    /* ======================================================================
       POSTS AND TURNBUCKLES
       One 1x6 tile strip serves all four posts. The strip is authored in the
       post's own frame -- z = POST_H_PX - y -- so the yellow pads land on
       ARENA.ROPE_Z automatically at both the near and the far corner, where the
       canvas edge is 81 rows apart on screen.
       ====================================================================== */

    var PAD_H = 8;              // turnbuckle pad height, centred on the rope
    var postBase = 0;

    function buildPost() {
        var H = POST_H_PX, p = buf(8, H);
        for (var y = 0; y < H; y++) {
            var z = H - y;
            // Round black post with a chrome highlight down one side.
            px(p, 8, H, 1, y, FLOOR_D);
            px(p, 8, H, 2, y, BLACK);
            px(p, 8, H, 3, y, CSHADOW);
            px(p, 8, H, 4, y, BLACK);
            px(p, 8, H, 5, y, BLACK);
            px(p, 8, H, 6, y, FLOOR_D);
            if (z > A.POST_H) {         // above the post: nothing
                for (var x = 0; x < 8; x++) px(p, 8, H, x, y, 0);
            }
        }
        // Cap.
        var capY = H - A.POST_H;
        rect(p, 8, H, 1, capY, 6, 1, CSHADOW);
        rect(p, 8, H, 1, capY + 1, 6, 1, BLACK);

        // Yellow pads at the rope heights.
        for (var i = 0; i < A.ROPE_Z.length; i++) {
            var y0 = H - A.ROPE_Z[i] - (PAD_H >> 1);
            rect(p, 8, H, 0, y0, 8, PAD_H, YEL);
            rect(p, 8, H, 0, y0, 8, 1, YEL_D);
            rect(p, 8, H, 0, y0 + PAD_H - 1, 8, 1, YEL_D);
            vline(p, 8, H, 6, y0, y0 + PAD_H - 1, YEL_D);
            vline(p, 8, H, 7, y0, y0 + PAD_H - 1, BLACK);
            vline(p, 8, H, 1, y0 + 1, y0 + PAD_H - 2, CWHITE);
        }
        // Contiguous, not deduped: T.post is a base the integrator can blit.
        postBase = alloc(POST_ROWS);
        tilesUsed -= POST_ROWS;                 // alloc() already counted it
        tilesUsed += POST_ROWS;
        for (var r = 0; r < POST_ROWS; r++) gfx.uploadTile(postBase + r, p, 8, 0, r * 8);
    }

    /* ======================================================================
       ROPES
       Black, with a light pixel alongside so they read against both the white
       canvas and the dark crowd. At the shipped ROPE_Z the six horizontal spans
       land on only two sub-row offsets, so two tiles cover all of them.

       The side ropes are the same near-vertical problem as the canvas edge and
       share its four-cell zone; they are generated as one buffer and deduped.
       ====================================================================== */

    var ropeH = null;           // sub-row offset -> tile
    var ropeSide = null;

    function buildRopesH() {
        ropeH = Object.create(null);
        var offs = {};
        for (var i = 0; i < A.ROPE_Z.length; i++) {
            offs[(CAN_BOT - A.ROPE_Z[i]) & 7] = 1;
            offs[(CAN_TOP - A.ROPE_Z[i]) & 7] = 1;
        }
        for (var k in offs) {
            var o = k | 0;
            var p = buf(8, 8);
            if (o <= 6) {
                hline(p, 8, 8, 0, 7, o, BLACK);
                hline(p, 8, 8, 0, 7, o + 1, CSHADOW);
            } else {
                hline(p, 8, 8, 0, 7, 6, CSHADOW);
                hline(p, 8, 8, 0, 7, 7, BLACK);
            }
            ropeH[o] = defTile(p, 8, 0, 0);
        }
    }

    // Plane x of the left side rope at height z on plane row py.
    function sideRopeX(py, z) {
        var d = py + z - CAN_TOP;
        if (d < 0) d = 0; else if (d > CAN_H) d = CAN_H;
        return (ORIGIN_X - A.RING_HX + A.FAR_INSET) - ((d * A.FAR_INSET / CAN_H) | 0);
    }

    function buildRopesSide() {
        var zMax = A.ROPE_Z[A.ROPE_Z.length - 1], zMin = A.ROPE_Z[0];
        var top = (CAN_TOP - zMax) & ~7;
        var bot = ((CAN_BOT - zMin) + 8) & ~7;
        var W = C_EDGE_N * 8, H = bot - top;
        var x0 = C_EDGE0 * 8;
        var p = buf(W, H);
        for (var i = 0; i < A.ROPE_Z.length; i++) {
            var z = A.ROPE_Z[i];
            for (var py = CAN_TOP - z; py <= CAN_BOT - z; py++) {
                var x = sideRopeX(py, z) - x0, y = py - top;
                px(p, W, H, x - 1, y, CSHADOW);   // outside, over dark floor
                px(p, W, H, x, y, BLACK);         // on the edge, over canvas
            }
        }
        ropeSide = defGrid(p, W, H);
        ropeSide.row0 = top >> 3;
    }

    /* ======================================================================
       RING STEPS AND THE LIFTED SKIRT
       Steps because a wrestler has to get out, and a lifted skirt because that
       is where every weapon in a hardcore match comes from.
       ====================================================================== */

    var STEP_TREADS = 3;
    var stepsGrid = null, skirtGrid = null;

    function buildSteps() {
        var W = 32, H = 32, p = buf(W, H);
        // Floor behind and below.
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                var h = hash2(x + 40, (CAN_BOT + y) * 53 + 9);
                px(p, W, H, x, y, ((h & 255) < FLOOR_SPECK) ? FLOOR_D : FLOOR_M);
            }
        }
        var treadH = Math.max(3, ((A.FLOOR_DROP + 6) / STEP_TREADS) | 0);
        for (var i = 0; i < STEP_TREADS; i++) {
            var ty = i * treadH;
            var tx = W - 8 - i * 8;
            if (tx < 0) tx = 0;
            rect(p, W, H, tx, ty, W - tx, treadH, FLOOR_M);
            rect(p, W, H, tx, ty, W - tx, 2, CSHADOW);       // lit tread
            rect(p, W, H, tx, ty + 2, W - tx, 1, CWHITE);
            hline(p, W, H, tx, W - 1, ty + treadH - 1, BLACK);
            vline(p, W, H, tx, ty, ty + treadH - 1, BLACK);
        }
        stepsGrid = defGrid(p, W, H);
    }

    function buildSkirt() {
        var aprRows = R_APR1 - R_APR0 + 1;
        var W = 40, H = aprRows * 8, p = buf(W, H);
        var baseX = ORIGIN_X - 128;
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) apronPixel(p, W, H, x, y, y, baseX + x);
        }
        // The flap is pulled up in a shallow triangle; under it is the black
        // underside of the ring, with a glint or two of steel in it.
        var apex = 20;
        for (var x2 = 6; x2 < 34; x2++) {
            var d = Math.abs(x2 - apex);
            var ytop = 5 + ((d * 9 / 14) | 0);
            if (ytop >= A.APRON_H - 1) continue;
            px(p, W, H, x2, ytop, APRON_L);              // folded edge
            for (var y2 = ytop + 1; y2 < A.APRON_H - 1; y2++) px(p, W, H, x2, y2, BLACK);
            var h = hash2(x2 * 17, 5);
            if ((h & 31) === 0) px(p, W, H, x2, A.APRON_H - 3, CSHADOW);
            if (((h >> 6) & 31) === 0) px(p, W, H, x2, A.APRON_H - 4, YEL_D);
        }
        skirtGrid = defGrid(p, W, H);
    }

    /* ======================================================================
       CAGE AND LADDER PROPS
       Stipulation furniture. Built unconditionally at init -- a dozen tiles is
       cheaper than two code paths -- and placed only when buildArena is asked.
       ====================================================================== */

    var cageMesh = 0, cageRail = 0, ladderGrid = null;

    function buildCage() {
        var p = buf(8, 8);
        for (var y = 0; y < 8; y++) {
            for (var x = 0; x < 8; x++) {
                if (((x + y) & 3) === 0 || ((x - y + 8) & 3) === 0) {
                    px(p, 8, 8, x, y, CSHADOW);
                }
            }
        }
        cageMesh = defTile(p, 8, 0, 0);
        rect(p, 8, 8, 0, 0, 8, 2, CWHITE);
        rect(p, 8, 8, 0, 2, 8, 1, FLOOR_M);
        cageRail = defTile(p, 8, 0, 0);
    }

    function buildLadderProp() {
        var W = 16, H = 48, p = buf(W, H);
        for (var y = 0; y < H; y++) {
            // Rails.
            px(p, W, H, 1, y, BLACK); px(p, W, H, 2, y, CSHADOW); px(p, W, H, 3, y, FLOOR_M);
            px(p, W, H, 12, y, FLOOR_M); px(p, W, H, 13, y, CSHADOW); px(p, W, H, 14, y, BLACK);
            // A rung every 8 rows at offset 4, which makes all six cells of
            // each rail identical and the whole prop two unique tiles.
            if ((y & 7) === 4) { rect(p, W, H, 3, y, 10, 2, CSHADOW); }
            if ((y & 7) === 6) { rect(p, W, H, 3, y, 10, 1, BLACK); }
        }
        ladderGrid = defGrid(p, W, H);
    }

    /* ======================================================================
       TITLE LOGO
       A chunky SLWF wordmark: heavy black outline, red offset drop, yellow face
       with an orange underside and a white top bevel. Cartridge-label weight.
       Authored in the UI palette (3) indices.
       ====================================================================== */

    var LOGO_PXW = 120, LOGO_PXH = 40;
    var LOGO_T = 7, LOGO_LH = 32, LOGO_DROP = 4, LOGO_OUT = 2;
    var logoGrid = null;

    function buildLogo() {
        var W = LOGO_PXW, H = LOGO_PXH;
        var widths = [24, 20, 34, 22];
        var gaps = 2;
        var total = widths[0] + widths[1] + widths[2] + widths[3] + gaps * 3;
        var m = slwfMask(W, H, (W - total - LOGO_DROP) >> 1, 3, gaps,
            LOGO_LH, LOGO_T, widths);
        var ol = dilate(m, W, H, LOGO_OUT);

        var p = buf(W, H);
        // Drop shadow first.
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                if (ol[y * W + x]) px(p, W, H, x + LOGO_DROP, y + LOGO_DROP, UI_RED);
            }
        }
        // Outline, then face with a bevel.
        for (var i = 0; i < ol.length; i++) {
            if (!ol[i]) continue;
            if (!m[i]) { p[i] = UI_BLACK; continue; }
            var xx = i % W, yy = (i / W) | 0;
            if (!at(m, W, H, xx, yy - 2) || !at(m, W, H, xx - 2, yy)) p[i] = UI_WHITE;
            else if (!at(m, W, H, xx, yy + 2) || !at(m, W, H, xx + 2, yy)) p[i] = UI_ORANGE;
            else p[i] = UI_YELLOW;
        }
        logoGrid = defGrid(p, W, H);
        art.LOGO_W = logoGrid.cols;
        art.LOGO_H = logoGrid.rows;
    }

    art.logo = function (plane, col, row, palId) {
        if (!logoGrid) return;
        putGrid(plane, col, row, logoGrid,
            (palId === undefined) ? pal.UI : palId, 0, false);
    };

    /* ======================================================================
       EFFECTS
       Streamed romFrames in the UI palette (3), so they are independent of
       whatever colours the two wrestlers are wearing.
       ====================================================================== */

    function fxImpactS(p, w, h, f) {
        var cx = w >> 1, cy = h >> 1;
        var R = [4, 6, 7][f];
        var tone = [UI_YELLOW, UI_YELLOW, UI_ORANGE][f];
        for (var i = 0; i < 8; i++) ray(p, w, h, cx, cy, i * 32 + f * 8, 2, R + 2 - f, 2, 1, tone);
        annulus(p, w, h, cx, cy, R - 1, R, tone);
        if (f < 2) disc(p, w, h, cx, cy, 3 - f, UI_WHITE);
    }

    function fxImpactL(p, w, h, f) {
        var cx = w >> 1, cy = h >> 1;
        var R = [6, 10, 14, 16][f];
        var tone = [UI_YELLOW, UI_YELLOW, UI_ORANGE, UI_RED][f];
        for (var i = 0; i < 12; i++) {
            ray(p, w, h, cx, cy, i * 21 + f * 5, 3, R + 3 - f, 3, 1, tone);
        }
        for (var k = 0; k < 4; k++) {
            ray(p, w, h, cx, cy, k * 64 + 8, R - 2, Math.min(cx - 1, R + 5), 2, 1, tone);
        }
        annulus(p, w, h, cx, cy, R - 2, R, tone);
        if (f < 3) disc(p, w, h, cx, cy, 6 - f * 2, f === 0 ? UI_WHITE : UI_YELLOW);
        if (f < 2) disc(p, w, h, cx, cy, 3 - f, UI_WHITE);
    }

    function fxDust(p, w, h, f) {
        var tone = f < 2 ? UI_LIGHT : UI_MID;
        var ox = [3, 9, 15, 20, 12], oy = [1, 3, 4, 2, 6], rr = [2, 3, 3, 2, 2];
        for (var i = 0; i < 5; i++) {
            var r = rr[i] + (f < 2 ? f : (3 - f));
            if (r < 1) r = 1;
            var y = h - 2 - oy[i] - f * 2;
            if (f >= 2) annulus(p, w, h, ox[i], y, r - 1, r, tone);
            else disc(p, w, h, ox[i], y, r, tone);
        }
        if (f === 0) rect(p, w, h, 2, h - 2, w - 4, 2, UI_MID);
    }

    function fxSweat(p, w, h, f) {
        var xs = [[3, 2], [2, 3], [5, 2]][f] || [3, 2];
        for (var i = 0; i < 3 - f; i++) {
            var x = (xs[0] + i * 2) & 7, y = (xs[1] + i) & 7;
            px(p, w, h, x, y, UI_CYAN);
            px(p, w, h, x, y + 1, UI_CYAN);
            px(p, w, h, x, y - 1, UI_WHITE);
        }
    }

    function fxBloodDrop(p, w, h, f) {
        if (f === 0) {
            rect(p, w, h, 3, 2, 2, 3, UI_RED);
            px(p, w, h, 3, 1, UI_RED);
            px(p, w, h, 3, 5, UI_DARK);
            px(p, w, h, 4, 5, UI_DARK);
        } else {
            rect(p, w, h, 2, 3, 2, 2, UI_RED);
            rect(p, w, h, 5, 1, 2, 2, UI_RED);
            px(p, w, h, 2, 5, UI_DARK);
            px(p, w, h, 5, 3, UI_DARK);
        }
    }

    function fxBloodSplat(p, w, h, f) {
        var cx = w >> 1, cy = h >> 1;
        var R = [3, 5, 7][f];
        disc(p, w, h, cx, cy, R, UI_RED);
        var n = 8 + f * 4;
        for (var i = 0; i < n; i++) {
            var hh = hash2(i * 37 + f * 11, 5);
            var ang = hh & 255;
            var d = R + 1 + (((hh >> 8) % (R + 3)));
            var x = cx + ((core.COS[ang] * d) >> 8);
            var y = cy + ((core.SIN[ang] * d) >> 8);
            disc(p, w, h, x, y, ((hh >> 16) & 1), UI_RED);
            if (((hh >> 20) & 3) === 0) px(p, w, h, x, y, UI_DARK);
        }
        // Darker centre, so a stamp on the white canvas has some depth.
        disc(p, w, h, cx + 1, cy + 1, R - 2, UI_DARK);
        disc(p, w, h, cx - 1, cy - 1, R - 3, UI_RED);
    }

    function fxStar(p, w, h, f) {
        var cx = w >> 1, cy = h >> 1, R = (w >> 1) - 1;
        var spin = f * 12;
        for (var i = 0; i < 5; i++) {
            ray(p, w, h, cx, cy, spin + i * 51, 0, R, 6, 1, UI_YELLOW);
        }
        disc(p, w, h, cx, cy, 4, UI_YELLOW);
        disc(p, w, h, cx, cy, 2, UI_WHITE);
        outlineBuf(p, w, h, UI_ORANGE);
    }

    function fxSpark(p, w, h, f) {
        var r = 3 - f;
        hline(p, w, h, 4 - r, 4 + r, 4, f ? UI_YELLOW : UI_WHITE);
        vline(p, w, h, 4, 4 - r, 4 + r, f ? UI_YELLOW : UI_WHITE);
        if (f === 0) px(p, w, h, 4, 4, UI_WHITE);
    }

    function fxBloodSpray(p, w, h, f) {
        var cx = w >> 1, cy = h - 4;
        for (var i = 0; i < 10; i++) {
            var hh = hash2(i * 53 + f * 7, 9);
            var ang = 160 + (hh % 64);                 // upward fan
            var d = 2 + f * 4 + ((hh >> 8) % 5);
            var x = cx + ((core.COS[ang] * d) >> 8);
            var y = cy + ((core.SIN[ang] * d) >> 8);
            px(p, w, h, x, y, UI_RED);
            px(p, w, h, x, y + 1, ((hh >> 16) & 1) ? UI_DARK : UI_RED);
        }
    }

    function fxWhoosh(p, w, h, f) {
        for (var k = 0; k < 3; k++) {
            var y = 3 + k * 4;
            var len = 18 - k * 5;
            var x0 = 3 + f * 5;
            var tone = (k === 0) ? UI_WHITE : (k === 1 ? UI_LIGHT : UI_MID);
            for (var i = 0; i < len; i++) {
                var yy = y + ((i * i) >> 6);
                px(p, w, h, x0 + i, yy, tone);
            }
        }
    }

    var FX_DEFS = {
        impactS: { frames: 3, w: 2, h: 2, ax: 8, ay: 8, draw: fxImpactS },
        impactL: { frames: 4, w: 4, h: 4, ax: 16, ay: 16, draw: fxImpactL },
        dust: { frames: 4, w: 3, h: 2, ax: 12, ay: 15, draw: fxDust },
        sweat: { frames: 3, w: 1, h: 1, ax: 4, ay: 4, draw: fxSweat },
        bloodDrop: { frames: 2, w: 1, h: 1, ax: 4, ay: 4, draw: fxBloodDrop },
        bloodSplat: { frames: 3, w: 3, h: 3, ax: 12, ay: 12, draw: fxBloodSplat },
        star: { frames: 4, w: 3, h: 3, ax: 12, ay: 12, draw: fxStar },
        spark: { frames: 3, w: 1, h: 1, ax: 4, ay: 4, draw: fxSpark },
        bloodSpray: { frames: 3, w: 2, h: 2, ax: 8, ay: 12, draw: fxBloodSpray },
        whoosh: { frames: 3, w: 4, h: 2, ax: 16, ay: 8, draw: fxWhoosh }
    };

    var fxRoms = null;

    function buildFx() {
        fxRoms = Object.create(null);
        art.FX = {};
        for (var name in FX_DEFS) {
            var d = FX_DEFS[name];
            var pw = d.w * 8, ph = d.h * 8;
            var list = new Array(d.frames);
            for (var f = 0; f < d.frames; f++) {
                var p = buf(pw, ph);
                d.draw(p, pw, ph, f);
                list[f] = gfx.romFrame(p, d.w, d.h, d.ax, d.ay);
            }
            fxRoms[name] = list;
            art.FX[name] = {
                frames: d.frames, w: d.w, h: d.h,
                ax: d.ax, ay: d.ay, pal: pal.UI
            };
        }
    }

    art.fxRom = function (name, frame) {
        var list = fxRoms && fxRoms[name];
        if (!list) return null;
        frame = frame | 0;
        if (frame < 0) frame = 0;
        if (frame >= list.length) frame = list.length - 1;
        return list[frame];
    };


    /* ======================================================================
       WEAPONS
       Found, not inventoried: they come from under the ring skirt or over the
       barricade. Streamed romFrames in the UI palette, so they cost no static
       tiles and are independent of whatever colours the wrestlers are wearing.

       `mult` scales a weapon move's damage, `part` is what it tends to hit,
       and `breakable` marks the two things that are supposed to come apart.
       combat.spawnWeapon reads all three straight off these entries.
       ====================================================================== */

    var WEAPON_DEFS = {
        chair: {
            w: 2, h: 3, ax: 8, ay: 23, mult: 300, part: 'head',
            draw: wChair
        },
        pipe: {
            w: 2, h: 1, ax: 8, ay: 7, mult: 340, part: 'head',
            draw: wPipe
        },
        hockeyStick: {
            w: 3, h: 2, ax: 12, ay: 15, mult: 280, part: 'leg',
            draw: wHockey
        },
        bottle: {
            w: 1, h: 2, ax: 4, ay: 15, mult: 260, part: 'head',
            breakable: true, draw: wBottle
        },
        trashCan: {
            w: 2, h: 3, ax: 8, ay: 23, mult: 290, part: 'head',
            draw: wTrashCan
        },
        kendoStick: {
            w: 3, h: 1, ax: 12, ay: 7, mult: 230, part: 'back',
            draw: wKendo
        },
        barbedBat: {
            w: 3, h: 2, ax: 12, ay: 15, mult: 420, part: 'head',
            draw: wBarbedBat
        },
        tacks: {
            w: 2, h: 1, ax: 8, ay: 7, mult: 200, part: 'back',
            draw: wTacks
        },
        table: {
            w: 4, h: 3, ax: 16, ay: 23, mult: 360, part: 'back',
            breakable: true, draw: wTable
        },
        ladder: {
            w: 2, h: 6, ax: 8, ay: 47, mult: 380, part: 'head',
            draw: wLadder
        }
    };

    // Each weapon is drawn once lying flat (`ground`), once angled as if
    // carried (`held`), and for the two breakables once in pieces.
    function wChair(p, w, h, state) {
        if (state === 'ground') {
            // Folded, lying on the mat: a flat slab seen end on.
            rect(p, w, h, 1, h - 6, w - 2, 3, UI_STEEL);
            hline(p, w, h, 1, w - 2, h - 6, UI_STEELL);
            hline(p, w, h, 1, w - 2, h - 4, UI_BLACK);
            rect(p, w, h, 2, h - 3, 2, 2, UI_DARK);
            rect(p, w, h, w - 4, h - 3, 2, 2, UI_DARK);
            return;
        }
        // Held: upright, seat and back.
        vline(p, w, h, 2, 2, h - 2, UI_STEEL);
        vline(p, w, h, 3, 1, h - 2, UI_STEELL);
        vline(p, w, h, w - 4, 2, h - 2, UI_STEEL);
        rect(p, w, h, 2, 1, w - 5, 7, UI_STEEL);     // back rest
        hline(p, w, h, 2, w - 4, 1, UI_STEELL);
        hline(p, w, h, 2, w - 4, 7, UI_BLACK);
        rect(p, w, h, 1, h - 10, w - 2, 3, UI_STEEL); // seat
        hline(p, w, h, 1, w - 2, h - 10, UI_STEELL);
        hline(p, w, h, 1, w - 2, h - 8, UI_BLACK);
    }

    function wPipe(p, w, h, state) {
        var y = state === 'ground' ? h - 3 : 2;
        hline(p, w, h, 0, w - 1, y, UI_STEELL);
        hline(p, w, h, 0, w - 1, y + 1, UI_STEEL);
        hline(p, w, h, 0, w - 1, y + 2, UI_BLACK);
        px(p, w, h, 0, y, UI_BLACK);
        px(p, w, h, w - 1, y + 1, UI_STEELL);
    }

    function wHockey(p, w, h, state) {
        var y = state === 'ground' ? h - 4 : 3;
        // Shaft.
        hline(p, w, h, 0, w - 6, y, UI_WOOD);
        hline(p, w, h, 0, w - 6, y + 1, UI_BLACK);
        // Blade, hooking down.
        thickLine(p, w, h, w - 6, y, w - 2, y + 4, 2, UI_WOOD);
        px(p, w, h, w - 2, y + 5, UI_BLACK);
        hline(p, w, h, 0, 3, y, UI_BLACK);      // taped grip
    }

    function wBottle(p, w, h, state) {
        if (state === 'broken') {
            rect(p, w, h, 2, h - 5, 4, 4, UI_GREEN);
            px(p, w, h, 1, h - 2, UI_GREEN);
            px(p, w, h, 6, h - 4, UI_GREEN);
            px(p, w, h, 3, h - 7, UI_WHITE);
            return;
        }
        var y0 = state === 'ground' ? h - 7 : 1;
        rect(p, w, h, 2, y0 + 4, 4, 9, UI_GREEN);   // body
        rect(p, w, h, 3, y0, 2, 5, UI_GREEN);       // neck
        vline(p, w, h, 2, y0 + 4, y0 + 12, UI_CYAN);
        vline(p, w, h, 5, y0 + 4, y0 + 12, UI_BLACK);
        hline(p, w, h, 3, 4, y0, UI_WHITE);
        rect(p, w, h, 2, y0 + 7, 4, 2, UI_WHITE);   // label
    }

    function wTrashCan(p, w, h, state) {
        var top = state === 'ground' ? h - 9 : 2;
        var bh = h - top - 1;
        rect(p, w, h, 2, top, w - 4, bh, UI_STEEL);
        vline(p, w, h, 2, top, top + bh - 1, UI_STEELL);
        vline(p, w, h, w - 3, top, top + bh - 1, UI_BLACK);
        // Corrugation.
        for (var y = top + 2; y < top + bh - 1; y += 3) {
            hline(p, w, h, 3, w - 4, y, UI_DARK);
        }
        rect(p, w, h, 1, top - 1, w - 2, 2, UI_STEELL);  // rim
        hline(p, w, h, 1, w - 2, top + bh - 1, UI_BLACK);
    }

    function wKendo(p, w, h, state) {
        var y = state === 'ground' ? h - 3 : 2;
        hline(p, w, h, 0, w - 1, y, UI_WOOD);
        hline(p, w, h, 0, w - 1, y + 1, UI_BLACK);
        // Split slats, which is the whole point of a kendo stick.
        for (var x = 4; x < w - 2; x += 3) px(p, w, h, x, y, UI_ORANGE);
        hline(p, w, h, 0, 3, y, UI_RED);        // handle wrap
        hline(p, w, h, 0, 3, y + 1, UI_RED);
    }

    function wBarbedBat(p, w, h, state) {
        var y = state === 'ground' ? h - 6 : 4;
        // Tapered bat.
        thickLine(p, w, h, 1, y, w - 3, y - 2, 2, UI_WOOD);
        thickLine(p, w, h, w - 8, y - 1, w - 2, y - 3, 4, UI_WOOD);
        // Barbed wire: a zigzag with barbs, which is what sells it.
        for (var x = w - 10; x < w - 1; x += 2) {
            var yy = y - 3 + ((x & 2) ? 0 : 3);
            px(p, w, h, x, yy, UI_STEELL);
            px(p, w, h, x + 1, yy + 1, UI_STEEL);
            if ((x & 4) === 0) px(p, w, h, x, yy - 1, UI_RED);
        }
        hline(p, w, h, 0, 3, y, UI_BLACK);
    }

    function wTacks(p, w, h) {
        // A scattered handful, always on the floor.
        for (var i = 0; i < 14; i++) {
            var hs = hash2(i * 37, i * 91);
            var x = 1 + (hs & 13), y = h - 5 + ((hs >> 5) & 3);
            px(p, w, h, x, y, UI_STEELL);
            px(p, w, h, x, y + 1, UI_RED);
        }
    }

    function wTable(p, w, h, state) {
        if (state === 'broken') {
            // Snapped in half and folded down the middle.
            thickLine(p, w, h, 1, h - 2, (w >> 1) - 1, h - 9, 3, UI_WOOD);
            thickLine(p, w, h, (w >> 1) + 1, h - 9, w - 2, h - 2, 3, UI_WOOD);
            px(p, w, h, w >> 1, h - 10, UI_LIGHT);
            hline(p, w, h, 1, w - 2, h - 1, UI_BLACK);
            return;
        }
        var top = state === 'ground' ? h - 12 : 1;
        rect(p, w, h, 0, top, w, 4, UI_WOOD);          // top
        hline(p, w, h, 0, w - 1, top, UI_ORANGE);
        hline(p, w, h, 0, w - 1, top + 3, UI_BLACK);
        // Legs.
        rect(p, w, h, 2, top + 4, 2, h - top - 5, UI_DARK);
        rect(p, w, h, w - 4, top + 4, 2, h - top - 5, UI_DARK);
        hline(p, w, h, 0, w - 1, h - 1, UI_BLACK);
    }

    function wLadder(p, w, h, state) {
        if (state === 'ground') {
            // Lying flat: rungs run across.
            for (var y = h - 10; y < h - 1; y += 3) {
                hline(p, w, h, 1, w - 2, y, UI_STEEL);
            }
            hline(p, w, h, 1, w - 2, h - 11, UI_STEELL);
            hline(p, w, h, 1, w - 2, h - 1, UI_STEELL);
            return;
        }
        vline(p, w, h, 2, 0, h - 1, UI_STEELL);
        vline(p, w, h, 3, 0, h - 1, UI_STEEL);
        vline(p, w, h, w - 4, 0, h - 1, UI_STEEL);
        vline(p, w, h, w - 3, 0, h - 1, UI_DARK);
        for (var yy = 3; yy < h - 2; yy += 6) {
            hline(p, w, h, 3, w - 4, yy, UI_STEELL);
            hline(p, w, h, 3, w - 4, yy + 1, UI_DARK);
        }
    }

    var weaponRoms = null;

    function buildWeapons() {
        weaponRoms = Object.create(null);
        art.WEAPONS = {};
        for (var id in WEAPON_DEFS) {
            var d = WEAPON_DEFS[id];
            var pw = d.w * 8, ph = d.h * 8;
            var states = d.breakable ? ['ground', 'held', 'broken'] : ['ground', 'held'];
            var set = Object.create(null);
            for (var i = 0; i < states.length; i++) {
                var p = buf(pw, ph);
                d.draw(p, pw, ph, states[i]);
                set[states[i]] = gfx.romFrame(p, d.w, d.h, d.ax, d.ay);
            }
            weaponRoms[id] = set;
            art.WEAPONS[id] = {
                id: id, mult: d.mult, part: d.part,
                breakable: !!d.breakable, w: d.w, h: d.h, pal: pal.UI
            };
        }
    }

    art.weaponRom = function (id, state) {
        var set = weaponRoms && weaponRoms[id];
        if (!set) return null;
        return set[state || 'ground'] || set.ground;
    };

    /* ======================================================================
       THE REFEREE
       Drawn in the UI palette rather than the arena one: a striped shirt needs
       black and white, which the arena palette has, but a face needs a skin
       tone, which it does not. The UI palette's wood entry is a serviceable
       tan and everything else he wears is black, white or grey.
       ====================================================================== */

    var REF_W = 3, REF_H = 5;              // tiles
    var REF_PW = REF_W * 8, REF_PH = REF_H * 8;
    var REF_AX = 12, REF_AY = REF_PH - 1;  // feet centre

    var REF_SKIN = UI_WOOD, REF_SHIRT = UI_WHITE, REF_STRIPE = UI_BLACK;
    var REF_TROUSER = UI_DARK, REF_SHOE = UI_BLACK;

    art.REF_POSES = { stand: 1, walk: 4, count: 3, check: 2, wave: 2 };

    // Arm angles per pose and frame, in 1/256 turns, measured from the
    // shoulder with 0 pointing right. Tunable: this table is the referee's
    // whole performance.
    var REF_ARMS = {
        stand: [[40, 216]],
        walk: [[48, 208], [32, 224], [48, 208], [32, 224]],
        count: [[200, 216], [224, 216], [250, 216]],   // slapping the mat
        check: [[20, 216], [10, 220]],
        wave: [[192, 64], [200, 56]]
    };
    var REF_LEGS = {
        stand: [[0, 0]],
        walk: [[-3, 3], [0, 0], [3, -3], [0, 0]],
        count: [[-4, 4]], check: [[-3, 3]], wave: [[0, 0]]
    };

    function refDraw(p, pose, frame) {
        var arms = REF_ARMS[pose] || REF_ARMS.stand;
        var legs = REF_LEGS[pose] || REF_LEGS.stand;
        var a = arms[frame % arms.length];
        var lg = legs[frame % legs.length];

        // A counting referee is down on one knee, so the whole body drops.
        var crouch = (pose === 'count') ? 10 : (pose === 'check' ? 6 : 0);
        var hipY = REF_PH - 15 + crouch;
        var shoulderY = hipY - 11;
        var headY = shoulderY - 5;
        var cx = REF_AX;

        // Legs.
        var bob = (pose === 'walk' && (frame & 1)) ? 1 : 0;
        thickLine(p, REF_PW, REF_PH, cx - 2, hipY, cx - 3 + lg[0], REF_PH - 3, 3, REF_TROUSER);
        thickLine(p, REF_PW, REF_PH, cx + 2, hipY, cx + 3 + lg[1], REF_PH - 3, 3, REF_TROUSER);
        rect(p, REF_PW, REF_PH, cx - 5 + lg[0], REF_PH - 3, 4, 2, REF_SHOE);
        rect(p, REF_PW, REF_PH, cx + 1 + lg[1], REF_PH - 3, 4, 2, REF_SHOE);

        // Torso in the striped shirt. The stripes are vertical and two pixels
        // apart, which at this size is the only way they read as stripes
        // rather than as noise.
        for (var y = shoulderY - bob; y <= hipY; y++) {
            for (var x = cx - 5; x <= cx + 5; x++) {
                var edge = (x === cx - 5 || x === cx + 5);
                p[y * REF_PW + x] = edge ? REF_STRIPE
                    : (((x - cx) & 3) < 2 ? REF_SHIRT : REF_STRIPE);
            }
        }

        // Arms.
        var sx = cx - 4, sy = shoulderY + 1 - bob;
        ray(p, REF_PW, REF_PH, sx, sy, a[0], 1, 11, 3, 2, REF_SHIRT);
        ray(p, REF_PW, REF_PH, cx + 4, sy, a[1], 1, 11, 3, 2, REF_SHIRT);
        // Hands.
        var c0 = core.COS[a[0] & 255], s0 = core.SIN[a[0] & 255];
        var c1 = core.COS[a[1] & 255], s1 = core.SIN[a[1] & 255];
        disc(p, REF_PW, REF_PH, sx + ((c0 * 11) >> 8), sy + ((s0 * 11) >> 8), 1, REF_SKIN);
        disc(p, REF_PW, REF_PH, cx + 4 + ((c1 * 11) >> 8), sy + ((s1 * 11) >> 8), 1, REF_SKIN);

        // Head, with the shirt's collar under it.
        disc(p, REF_PW, REF_PH, cx, headY - bob, 4, REF_SKIN);
        rect(p, REF_PW, REF_PH, cx - 4, headY - 5 - bob, 9, 3, REF_STRIPE);  // hair
        px(p, REF_PW, REF_PH, cx - 2, headY - bob, UI_BLACK);
        px(p, REF_PW, REF_PH, cx + 2, headY - bob, UI_BLACK);

        // Outline the silhouette so he reads over the white canvas as well as
        // over the crowd. Same pass the wrestlers get.
        outline(p, REF_PW, REF_PH, UI_BLACK);
    }

    // Any transparent pixel orthogonally touching something becomes `ink`.
    function outline(p, w, h, ink) {
        var src = p.slice();
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                if (src[y * w + x]) continue;
                if (at(src, w, h, x - 1, y) || at(src, w, h, x + 1, y) ||
                    at(src, w, h, x, y - 1) || at(src, w, h, x, y + 1)) {
                    p[y * w + x] = ink;
                }
            }
        }
    }

    var refRoms = null;

    function buildRef() {
        refRoms = Object.create(null);
        for (var pose in art.REF_POSES) {
            var n = art.REF_POSES[pose];
            var list = new Array(n);
            for (var f = 0; f < n; f++) {
                var p = buf(REF_PW, REF_PH);
                refDraw(p, pose, f);
                list[f] = gfx.romFrame(p, REF_W, REF_H, REF_AX, REF_AY);
            }
            refRoms[pose] = list;
        }
    }

    art.refRom = function (pose, frame) {
        var list = refRoms && (refRoms[pose] || refRoms.stand);
        if (!list) return null;
        frame = frame | 0;
        if (frame < 0 || frame >= list.length) frame = 0;
        return list[frame];
    };
    // The referee is UI-palette art, so match.js must not draw him in the
    // arena palette. Stated here rather than assumed over there.
    art.REF_PAL = 3;

    /* ======================================================================
       INIT
       ====================================================================== */

    var built = false;

    art.init = function () {
        if (built) return;
        built = true;
        tileMap = Object.create(null);
        tilesUsed = 0;
        geom();

        buildCrowd();
        buildBarricade();
        buildFloor();
        buildCanvas();
        buildCanvasEdge();
        buildApron();
        buildPost();
        buildRopesH();
        buildRopesSide();
        buildSteps();
        buildSkirt();
        buildCage();
        buildLadderProp();
        buildLogo();

        // No static cost: these are streamed romFrames.
        buildFx();
        buildWeapons();
        buildRef();

        art.T = {
            crowd: crowdBase,
            barricade: barrGrid,
            floorFar: floorFar, floorNear: floorNear,
            floorShadow: floorShadow, floorLip: floorLip,
            canvasFar: canvasFar, canvasMid: canvasMid, canvasNear: canvasNear,
            canvasEdge: edgeGrid,
            apronPlain: apronPlain, apronText: apronText,
            post: postBase, postRows: POST_ROWS,
            ropeH: ropeH, ropeSide: ropeSide,
            steps: stepsGrid, skirt: skirtGrid,
            cageMesh: cageMesh, cageRail: cageRail, ladder: ladderGrid,
            logo: logoGrid
        };
        art.tilesUsed = tilesUsed;
        // The dedup map is only useful while building; a few thousand string
        // keys is not worth keeping alive for the rest of the session.
        tileMap = null;
    };

    /* ======================================================================
       BUILD ARENA
       Lay the tiles into the planes.

       plane B: crowd, barricade, arena floor, the canvas, the apron, the
                steps and the lifted skirt. The crowd rows get their parallax
                from ring.applyScroll's per-line scroll table, not from being
                on a different plane -- plane A is entirely spoken for.
       plane A: ropes and posts. Anything at or below PRIO_SPLIT carries
                gfx.PRIO, so a wrestler near the camera walks BEHIND the near
                ropes and in FRONT of the far ones with no special case
                anywhere in the entity code.
       ====================================================================== */

    function putGridRowPrio(plane, col, row, g, palId, mirror) {
        for (var r = 0; r < g.rows; r++) {
            var flags = (row + r >= PRIO_SPLIT) ? gfx.PRIO : 0;
            for (var c = 0; c < g.cols; c++) {
                var t = g.t[r * g.cols + c];
                if (!t) continue;
                var tc = mirror ? (MIRROR_COL - (col + c)) : (col + c);
                gfx.cell(plane, tc, row + r, t, palId, flags | (mirror ? gfx.HF : 0));
            }
        }
    }

    art.buildArena = function (opts) {
        if (!built) art.init();
        opts = opts || {};
        var B = gfx.planeB, PA = gfx.planeA;
        var P0 = pal.ARENA;
        var col, row, r, c, i, z;

        gfx.clearPlane(B, 0);
        gfx.clearPlane(PA, 0);

        /* ---- crowd: the full plane width, so panning never finds an edge */
        var bandRows = Math.max(1, ((R_CROWD1 - R_CROWD0 + 1) / CROWD_BANDS) | 0);
        for (row = R_CROWD0; row <= R_CROWD1; row++) {
            var band = Math.min(CROWD_BANDS - 1, ((row - R_CROWD0) / bandRows) | 0);
            for (col = 0; col < gfx.PW; col++) {
                var hv = hash2(col * 17 + 1, row * 29 + 7);
                var variant = hv & (CROWD_VARIANTS - 1);
                gfx.cell(B, col, row, crowdBase + band * CROWD_VARIANTS + variant,
                    P0, (hv & 0x100) ? gfx.HF : 0);
            }
        }

        /* ---- barricade */
        if (barrGrid) {
            for (col = 0; col < gfx.PW; col += barrGrid.cols) {
                putGrid(B, col, R_BARR0, barrGrid, P0, 0, false);
            }
        }

        /* ---- arena floor, everywhere below the barricade */
        for (row = R_FLOOR0; row <= R_BOT; row++) {
            var g = (row < R_CAN0) ? floorFar : floorNear;
            for (col = 0; col < gfx.PW; col++) {
                var hf = hash2(col * 13 + row, row * 7 + 2);
                gfx.cell(B, col, row, g.t[hf & 3], P0, (hf & 0x100) ? gfx.HF : 0);
            }
        }

        /* ---- the canvas, between the diagonal edges on each row */
        for (row = R_CAN0; row <= R_CAN1; row++) {
            // Inside the edge zone on both sides the edge grid wins; between
            // them it is canvas.
            var cl = (leftEdge(row * 8 + 7) + 7) >> 3;
            var crr = MIRROR_COL - cl;
            for (col = cl; col <= crr; col++) {
                gfx.cell(B, col, row, canvasCellTile(col, row), P0, 0);
            }
        }
        if (edgeGrid) {
            putGrid(B, C_EDGE0, R_CAN0, edgeGrid, P0, 0, false);
            putGrid(B, C_EDGE0, R_CAN0, edgeGrid, P0, 0, true);
        }

        /* ---- apron, with SLWF across the middle of it */
        if (apronPlain) {
            for (col = C_NEAR_L; col <= C_NEAR_R; col++) {
                putGrid(B, col, R_APR0, apronPlain, P0, 0, false);
            }
        }
        if (apronText) {
            putGrid(B, (ORIGIN_X >> 3) - (apronText.cols >> 1), R_APR0, apronText, P0, 0, false);
        }

        /* ---- steps and the lifted skirt, both sides */
        if (stepsGrid) {
            putGrid(B, C_NEAR_L - stepsGrid.cols, R_APR0, stepsGrid, P0, 0, false);
            putGrid(B, C_NEAR_L - stepsGrid.cols, R_APR0, stepsGrid, P0, 0, true);
        }
        if (skirtGrid) {
            // Authored against plane x ORIGIN_X-128, so it has to go back at
            // that column or its apron shading does not line up -- and at
            // -12 cells it sat on top of the S of SLWF.
            putGrid(B, (ORIGIN_X - 128) >> 3, R_APR0, skirtGrid, P0, 0, false);
        }

        /* ---- horizontal ropes */
        for (i = 0; i < A.ROPE_Z.length; i++) {
            z = A.ROPE_Z[i];
            var pyNear = CAN_BOT - z, pyFar = CAN_TOP - z;
            var tNear = ropeH[pyNear & 7], tFar = ropeH[pyFar & 7];
            var rowNear = pyNear >> 3, rowFar = pyFar >> 3;
            for (col = C_NEAR_L; col <= C_NEAR_R; col++) {
                if (tNear) gfx.cell(PA, col, rowNear, tNear, P0,
                    rowNear >= PRIO_SPLIT ? gfx.PRIO : 0);
            }
            for (col = C_FAR_L; col <= C_FAR_R; col++) {
                if (tFar) gfx.cell(PA, col, rowFar, tFar, P0,
                    rowFar >= PRIO_SPLIT ? gfx.PRIO : 0);
            }
        }

        /* ---- side ropes */
        if (ropeSide) {
            putGridRowPrio(PA, C_EDGE0, ropeSide.row0, ropeSide, P0, false);
            putGridRowPrio(PA, C_EDGE0, ropeSide.row0, ropeSide, P0, true);
        }

        /* ---- posts. The near pair is entirely high priority so a wrestler
                in the near corner is hidden by it, which is what the camera
                angle demands. */
        var nearTop = (CAN_BOT >> 3) - POST_ROWS;
        var farTop = (CAN_TOP >> 3) - POST_ROWS;
        for (r = 0; r < POST_ROWS; r++) {
            gfx.cell(PA, C_POST_NEAR, nearTop + r, postBase + r, P0, gfx.PRIO);
            gfx.cell(PA, MIRROR_COL - C_POST_NEAR, nearTop + r, postBase + r, P0, gfx.PRIO | gfx.HF);
            gfx.cell(PA, C_POST_FAR, farTop + r, postBase + r, P0, 0);
            gfx.cell(PA, MIRROR_COL - C_POST_FAR, farTop + r, postBase + r, P0, gfx.HF);
        }

        /* ---- stipulation furniture */
        if (opts.cage && cageMesh) {
            // Mesh over the whole ring, high priority at the near side so the
            // camera is genuinely looking through it.
            for (row = farTop; row <= (CAN_BOT >> 3); row++) {
                for (col = C_POST_NEAR; col <= MIRROR_COL - C_POST_NEAR; col++) {
                    if (row >= PRIO_SPLIT) {
                        gfx.cell(PA, col, row, cageMesh, P0, gfx.PRIO);
                    }
                }
            }
            if (cageRail) {
                for (col = C_POST_NEAR; col <= MIRROR_COL - C_POST_NEAR; col++) {
                    gfx.cell(PA, col, farTop, cageRail, P0, 0);
                }
            }
        }
        if (opts.ladder && ladderGrid) {
            putGrid(B, (ORIGIN_X >> 3) + 14, R_APR0 - ladderGrid.rows, ladderGrid, P0, 0, false);
        }
    };

    window.art = art;
})();
