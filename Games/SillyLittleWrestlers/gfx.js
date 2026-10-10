/* =============================================================================
   SLWF - gfx.js
   The VDP. Tile memory, two scrolling planes plus a non-scrolling window, a
   sprite list with a real per-scanline budget, and an indexed framebuffer that
   is only resolved to colour once, at blit time, through the palette LUT.

   Three decisions in here are load-bearing:

   * There is NO SPRITE SCALING, because the hardware has none. Depth in the
     ring is a vertical offset and a draw-order sort, exactly as WrestleFest
     did it. Anything that wants perspective gets it from the floor trapezoid
     on plane B.

   * Priority is a bit per cell and per sprite, not a layer hack. The draw
     order is B(low) A(low) sprites(low) B(high) A(high) sprites(high) W, so
     the near ropes are simply high-priority plane A cells and a wrestler walks
     behind them with no special case anywhere in the entity code.

   * Wrestler frames are STREAMED, not resident. 2048 tiles is the whole of
     VRAM and three hundred generated pose frames are several times that, so
     poses live in "ROM" as pixel arrays and the frames actually on screen are
     DMA'd into a 1024-tile ring each frame, against a per-frame upload budget
     the real machine also had. This is why poser.js produces pixels and knows
     nothing about tiles.
   ============================================================================= */
(function () {
    'use strict';

    var gfx = {};

    var VW = 320, VH = 224;
    gfx.VW = VW; gfx.VH = VH;

    /* -------------------------------------------------------------- limits */

    gfx.MAX_TILES = 2048;        // 11-bit tile index, as on the hardware
    gfx.STATIC_TILES = 1024;     // arena, font, FX, weapons: uploaded once
    gfx.MAX_SPRITES = 80;        // sprites per frame
    gfx.MAX_PER_LINE = 20;       // sprites per scanline
    gfx.DMA_BUDGET = 234;        // tiles uploadable per frame (~7.5KB vblank)

    gfx.flicker = true;          // emulate sprite dropout when over budget
    gfx.scanlines = false;       // optional CRT line darkening at blit time

    // Cell word layout: tile 0..10 | pal 11..12 | hflip 13 | vflip 14 | prio 15
    gfx.HF = 1 << 13;
    gfx.VF = 1 << 14;
    gfx.PRIO = 1 << 15;

    /* ---------------------------------------------------------- tile memory */

    // 8x8 indexed, one byte per pixel. The real thing packs two pixels per
    // byte; unpacked costs 64KB more and saves a shift in the innermost loop
    // of the whole program.
    gfx.tiles = new Uint8Array(gfx.MAX_TILES * 64);

    var staticNext = 1;          // tile 0 is reserved blank, forever
    var streamNext = gfx.STATIC_TILES;

    // Exhausting tile memory during boot is a budgeting error and should be
    // loud. Exhausting it later -- font.js allocates a glyph the first time a
    // menu uses it -- must not take the running game down, so it degrades to
    // the blank tile and sets a flag the debug overlay shows.
    gfx.booted = false;
    gfx.tileOverflow = 0;

    gfx.allocStatic = function (n) {
        if (staticNext + n > gfx.STATIC_TILES) {
            if (!gfx.booted) {
                throw new Error('gfx: static tile memory exhausted (' + staticNext + '+' + n + ')');
            }
            gfx.tileOverflow += n;
            return 0;
        }
        var at = staticNext; staticNext += n; return at;
    };

    gfx.staticUsed = function () { return staticNext; };

    gfx.uploadTile = function (index, px, stride, ox, oy) {
        var dst = index * 64, o;
        stride = stride || 8; ox = ox || 0; oy = oy || 0;
        for (var y = 0; y < 8; y++) {
            o = (oy + y) * stride + ox;
            for (var x = 0; x < 8; x++) gfx.tiles[dst + y * 8 + x] = px[o + x] & 15;
        }
    };

    // Turn a (w*8) x (h*8) pixel array into w*h contiguous resident tiles.
    // Row-major. Returns the first tile index.
    gfx.defineTiles = function (px, w, h) {
        var base = gfx.allocStatic(w * h);
        for (var r = 0; r < h; r++) {
            for (var c = 0; c < w; c++) {
                gfx.uploadTile(base + r * w + c, px, w * 8, c * 8, r * 8);
            }
        }
        return base;
    };

    gfx.defineTile = function (px) { return gfx.defineTiles(px, 1, 1); };

    /* ------------------------------------------------------- "ROM" frames */

    // A romFrame is a generated animation frame that has not been uploaded.
    // The block split and the blank analysis are done once, here, at boot --
    // not per display frame. A block is at most 4x4 tiles because that is the
    // largest hardware sprite; a block whose every tile is empty is dropped,
    // which is why an idle pose costs two sprites and not four.
    var romId = 0;

    gfx.romFrame = function (px, w, h, ax, ay) {
        var blocks = [];
        for (var by = 0; by < h; by += 4) {
            for (var bx = 0; bx < w; bx += 4) {
                var bw = Math.min(4, w - bx), bh = Math.min(4, h - by);
                // Does this block contain anything at all?
                var any = false;
                for (var y = by * 8; y < (by + bh) * 8 && !any; y++) {
                    var o = y * w * 8;
                    for (var x = bx * 8; x < (bx + bw) * 8; x++) {
                        if (px[o + x]) { any = true; break; }
                    }
                }
                if (!any) continue;
                blocks.push({ bx: bx, by: by, bw: bw, bh: bh, base: -1 });
            }
        }
        var tiles = 0;
        for (var i = 0; i < blocks.length; i++) tiles += blocks[i].bw * blocks[i].bh;
        return {
            id: ++romId, px: px, w: w, h: h, ax: ax, ay: ay,
            blocks: blocks, tileCount: tiles
        };
    };

    /* --------------------------------------------------------- DMA / stream */

    // Persistent cache across frames keyed by romFrame id, so a pose held for
    // twenty frames uploads once and an idle animation costs no bandwidth. On
    // exhaustion the whole cache is flushed rather than defragmented: that
    // costs one frame of re-upload and saves a free-list.
    var cache = Object.create(null);
    var dmaThisFrame = 0;
    gfx.dmaTiles = 0;
    gfx.dmaOver = 0;

    function flushCache() {
        cache = Object.create(null);
        streamNext = gfx.STATIC_TILES;
    }
    gfx.flushStream = flushCache;

    // Upload a romFrame if it is not already resident, and return a resolved
    // frame: { blocks:[{bx,by,bw,bh,base}], w, h, ax, ay }.
    gfx.stream = function (rom) {
        var hit = cache[rom.id];
        if (hit) return hit;

        if (streamNext + rom.tileCount > gfx.MAX_TILES) flushCache();
        if (rom.tileCount > gfx.MAX_TILES - gfx.STATIC_TILES) return null;

        dmaThisFrame += rom.tileCount;
        if (dmaThisFrame > gfx.DMA_BUDGET) gfx.dmaOver++;

        var stride = rom.w * 8;
        var out = { blocks: [], w: rom.w, h: rom.h, ax: rom.ax, ay: rom.ay };
        for (var i = 0; i < rom.blocks.length; i++) {
            var b = rom.blocks[i];
            var base = streamNext; streamNext += b.bw * b.bh;
            for (var r = 0; r < b.bh; r++) {
                for (var c = 0; c < b.bw; c++) {
                    gfx.uploadTile(base + r * b.bw + c, rom.px, stride,
                        (b.bx + c) * 8, (b.by + r) * 8);
                }
            }
            out.blocks.push({ bx: b.bx, by: b.by, bw: b.bw, bh: b.bh, base: base });
        }
        cache[rom.id] = out;
        return out;
    };

    /* --------------------------------------------------------------- planes */

    // 128x32 cells = 1024x256 pixels, a real VDP plane size. The arena is
    // about 700 pixels wide, so the camera pans inside one plane with room to
    // spare and no wrap seam ever reaches the screen.
    var PW = 128, PH = 32;
    gfx.PW = PW; gfx.PH = PH;

    function makePlane() {
        return { map: new Uint16Array(PW * PH), sx: 0, sy: 0, hs: null };
    }
    // Allocate the per-line scroll table for a plane and seed it from sx.
    gfx.enableLineScroll = function (plane) {
        if (!plane.hs) plane.hs = new Int16Array(VH);
        plane.hs.fill(plane.sx | 0);
        return plane.hs;
    };
    gfx.planeA = makePlane();
    gfx.planeB = makePlane();
    // The window plane does not scroll and is exactly the screen. The HUD
    // lives here, which is what keeps name plates and the match clock off the
    // sprite budget entirely.
    gfx.planeW = { map: new Uint16Array(40 * 28), sx: 0, sy: 0, w: 40, h: 28 };

    gfx.cell = function (plane, col, row, tile, palId, flags) {
        var w = (plane === gfx.planeW) ? plane.w : PW;
        var h = (plane === gfx.planeW) ? plane.h : PH;
        if (col < 0 || row < 0 || col >= w || row >= h) return;
        plane.map[row * w + col] = (tile & 0x7FF) | ((palId & 3) << 11) | (flags || 0);
    };

    gfx.fillCells = function (plane, col, row, w, h, tile, palId, flags) {
        for (var r = 0; r < h; r++) {
            for (var c = 0; c < w; c++) gfx.cell(plane, col + c, row + r, tile, palId, flags);
        }
    };

    gfx.clearPlane = function (plane, word) {
        plane.map.fill(word || 0);
    };

    // Lay a block of contiguous tiles (from defineTiles) into a plane.
    gfx.blitCells = function (plane, col, row, base, w, h, palId, flags) {
        for (var r = 0; r < h; r++) {
            for (var c = 0; c < w; c++) {
                gfx.cell(plane, col + c, row + r, base + r * w + c, palId, flags);
            }
        }
    };

    /* -------------------------------------------------------------- sprites */

    // Flat arrays rather than objects: the sprite list is rebuilt from scratch
    // every frame and 80 object allocations a frame is 4800 a second for no
    // reason.
    var MS = gfx.MAX_SPRITES;
    var spX = new Int16Array(MS), spY = new Int16Array(MS);
    var spBase = new Uint16Array(MS), spW = new Uint8Array(MS), spH = new Uint8Array(MS);
    var spPal = new Uint8Array(MS), spFlags = new Uint8Array(MS);
    var spMask = new Uint32Array(MS);       // which of its pixel rows survived
    var spCount = 0;
    gfx.spriteOverflow = 0;

    var lineCount = new Uint8Array(VH);
    var flickerPhase = 0;

    // x,y are the TOP-LEFT in screen pixels. wt/ht are in tiles, 1..4.
    // flags: gfx.HF | gfx.VF | gfx.PRIO. A multi-tile sprite's flip mirrors
    // the whole sprite, not each tile -- which is what the hardware does, and
    // what lets a six-tile-wide wrestler frame flip for free.
    gfx.sprite = function (x, y, base, palId, wt, ht, flags) {
        if (spCount >= MS) { gfx.spriteOverflow++; return false; }
        if (wt < 1) wt = 1; if (wt > 4) wt = 4;
        if (ht < 1) ht = 1; if (ht > 4) ht = 4;
        // Entirely off screen: do not spend a slot on it. The hardware would,
        // but the budget is meant to constrain what is visible.
        if (x >= VW || y >= VH || x + wt * 8 <= 0 || y + ht * 8 <= 0) return false;
        var i = spCount++;
        spX[i] = x; spY[i] = y; spBase[i] = base;
        spW[i] = wt; spH[i] = ht; spPal[i] = palId & 3; spFlags[i] = (flags || 0) >> 8;
        return true;
    };

    // Draw a streamed frame at an anchor point. One hardware sprite per
    // surviving block; a frame whose arms are tucked in costs fewer sprites
    // than one mid-lariat, which is exactly the behaviour we want.
    gfx.frame = function (ax, ay, fr, palId, hflip, prio) {
        if (!fr) return 0;
        var x0 = ax - (hflip ? (fr.w * 8 - 1 - fr.ax) : fr.ax);
        var y0 = ay - fr.ay;
        var flags = (hflip ? gfx.HF : 0) | (prio ? gfx.PRIO : 0);
        var n = 0;
        for (var i = 0; i < fr.blocks.length; i++) {
            var b = fr.blocks[i];
            var bx = hflip ? (fr.w - b.bx - b.bw) : b.bx;
            if (gfx.sprite(x0 + bx * 8, y0 + b.by * 8, b.base, palId, b.bw, b.bh, flags)) n++;
        }
        return n;
    };

    /* ---------------------------------------------------------- framebuffer */

    // One byte per pixel: (pal << 4) | index, with 0xFF meaning "nothing drew
    // here, show the backdrop". Colour happens once, in present().
    var fb = new Uint8Array(VW * VH);
    gfx.fb = fb;

    var canvas = null, ctx = null, off = null, octx = null, img = null, img32 = null;
    gfx.scale = 1; gfx.ox = 0; gfx.oy = 0;

    gfx.init = function (cv) {
        canvas = cv;
        ctx = canvas.getContext('2d', { alpha: false });
        off = document.createElement('canvas');
        off.width = VW; off.height = VH;
        octx = off.getContext('2d', { alpha: false });
        img = octx.createImageData(VW, VH);
        img32 = new Uint32Array(img.data.buffer);
        gfx.canvas = canvas;
        gfx.resize();
        window.addEventListener('resize', gfx.resize);
    };

    // Integer scale only, centred, letterboxed. A non-integer scale is the one
    // thing that would put a sub-pixel seam through 8x8 art.
    gfx.resize = function () {
        if (!canvas) return;
        var cw = canvas.clientWidth || window.innerWidth;
        var ch = canvas.clientHeight || window.innerHeight;
        var dpr = window.devicePixelRatio || 1;
        var pw = Math.max(1, Math.round(cw * dpr));
        var ph = Math.max(1, Math.round(ch * dpr));
        if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw; canvas.height = ph;
        }
        var s = Math.floor(Math.min(pw / VW, ph / VH));
        if (s < 1) s = 1;
        gfx.scale = s;
        gfx.ox = ((pw - VW * s) >> 1);
        gfx.oy = ((ph - VH * s) >> 1);
        ctx.imageSmoothingEnabled = false;
        if (octx) octx.imageSmoothingEnabled = false;
    };

    /* ------------------------------------------------------- plane rendering */

    // One screen row at a time, walking cells rather than pixels: 40 cells of
    // up to 8 pixels beats 320 independent cell lookups by enough to matter at
    // four plane passes a frame.
    function drawPlane(plane, prio) {
        var map = plane.map, tiles = gfx.tiles;
        var psx = plane.sx | 0, psy = plane.sy | 0;
        // Per-line horizontal scroll. The VDP has this, and it is the reason
        // the crowd can parallax against the ring while both live on the same
        // plane -- which they have to, because plane B is spoken for and the
        // arena needs every cell of plane A.
        var hs = plane.hs || null;
        for (var sy = 0; sy < VH; sy++) {
            var wy = (sy + psy) & (PH * 8 - 1);
            var row = (wy >> 3) * PW, ty = wy & 7;
            var fbRow = sy * VW;
            var sx = 0;
            var wx = (hs ? hs[sy] : psx) & (PW * 8 - 1);
            var tx = wx & 7;
            var col = wx >> 3;
            while (sx < VW) {
                var word = map[row + col];
                var run = 8 - tx;
                if (sx + run > VW) run = VW - sx;
                var tile = word & 0x7FF;
                if (tile && ((word >>> 15) & 1) === prio) {
                    var palByte = ((word >>> 11) & 3) << 4;
                    var hf = (word >>> 13) & 1, vf = (word >>> 14) & 1;
                    var srcY = vf ? 7 - ty : ty;
                    var tbase = tile * 64 + srcY * 8;
                    var o = fbRow + sx;
                    if (hf) {
                        for (var i = 0; i < run; i++) {
                            var v = tiles[tbase + (7 - (tx + i))];
                            if (v) fb[o + i] = palByte | v;
                        }
                    } else {
                        for (var j = 0; j < run; j++) {
                            var v2 = tiles[tbase + tx + j];
                            if (v2) fb[o + j] = palByte | v2;
                        }
                    }
                }
                sx += run;
                tx = 0;
                col = (col + 1) & (PW - 1);
            }
        }
    }

    function drawWindow() {
        var plane = gfx.planeW, map = plane.map, tiles = gfx.tiles;
        for (var row = 0; row < plane.h; row++) {
            for (var col = 0; col < plane.w; col++) {
                var word = map[row * plane.w + col];
                var tile = word & 0x7FF;
                if (!tile) continue;
                var palByte = ((word >>> 11) & 3) << 4;
                var hf = (word >>> 13) & 1, vf = (word >>> 14) & 1;
                var tb = tile * 64;
                for (var y = 0; y < 8; y++) {
                    var sy = row * 8 + y;
                    if (sy >= VH) break;
                    var srcY = vf ? 7 - y : y;
                    var o = sy * VW + col * 8;
                    for (var x = 0; x < 8; x++) {
                        var v = tiles[tb + srcY * 8 + (hf ? 7 - x : x)];
                        if (v) fb[o + x] = palByte | v;
                    }
                }
            }
        }
    }

    /* ------------------------------------------------------ sprite rendering */

    // The budget pass. Sprites are evaluated in list order and a sprite that
    // finds a scanline already full is simply dropped from that line -- which
    // is what the hardware does, and why an overloaded line in a Genesis game
    // shows the *back* of the sprite list disappearing. Rotating the starting
    // point each frame turns that dropout into the flicker everyone remembers.
    function budgetSprites() {
        lineCount.fill(0);
        var order0 = 0;
        if (gfx.flicker && spCount > 0) {
            flickerPhase = (flickerPhase + 1) % spCount;
            order0 = flickerPhase;
        }
        for (var k = 0; k < spCount; k++) {
            var i = (k + order0) % spCount;
            var y = spY[i], ph = spH[i] * 8, mask = 0;
            for (var r = 0; r < ph; r++) {
                var sy = y + r;
                if (sy < 0 || sy >= VH) continue;
                if (lineCount[sy] >= gfx.MAX_PER_LINE) continue;
                lineCount[sy]++;
                mask |= (1 << r);
            }
            spMask[i] = mask;
        }
    }

    function drawSprites(prio) {
        var tiles = gfx.tiles;
        for (var i = 0; i < spCount; i++) {
            var fl = spFlags[i] << 8;
            if ((((fl & gfx.PRIO) ? 1 : 0)) !== prio) continue;
            var mask = spMask[i];
            if (!mask) continue;
            var x = spX[i], y = spY[i];
            var wt = spW[i], ht = spH[i];
            var pw = wt * 8, ph = ht * 8;
            var hf = (fl & gfx.HF) ? 1 : 0, vf = (fl & gfx.VF) ? 1 : 0;
            var palByte = spPal[i] << 4;
            var base = spBase[i];

            var x0 = x < 0 ? -x : 0;
            var x1 = (x + pw > VW) ? VW - x : pw;

            for (var r = 0; r < ph; r++) {
                if (!(mask & (1 << r))) continue;
                var srcR = vf ? ph - 1 - r : r;
                var tRow = (srcR >> 3) * wt, tY = (srcR & 7) * 8;
                var o = (y + r) * VW + x;
                for (var c = x0; c < x1; c++) {
                    var srcC = hf ? pw - 1 - c : c;
                    var v = tiles[(base + tRow + (srcC >> 3)) * 64 + tY + (srcC & 7)];
                    if (v) fb[o + c] = palByte | v;
                }
            }
        }
    }

    /* ------------------------------------------------------------ the frame */

    gfx.beginFrame = function () {
        spCount = 0;
        gfx.spriteOverflow = 0;
        gfx.dmaTiles = dmaThisFrame;
        dmaThisFrame = 0;
        gfx.dmaOver = 0;
    };

    gfx.present = function () {
        if (!ctx) return;
        fb.fill(0xFF);
        budgetSprites();
        drawPlane(gfx.planeB, 0);
        drawPlane(gfx.planeA, 0);
        drawSprites(0);
        drawPlane(gfx.planeB, 1);
        drawPlane(gfx.planeA, 1);
        drawSprites(1);
        drawWindow();

        if (pal.isDirty()) pal.rebuild();
        var lut = pal.lut, n = VW * VH;
        for (var i = 0; i < n; i++) img32[i] = lut[fb[i]];
        octx.putImageData(img, 0, 0);

        var s = gfx.scale;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Shake shifts the whole picture inside the letterbox, the way a game
        // of this era did it from the vertical interrupt -- HUD included.
        var sx = (core.fx.shakeX * s) | 0, sy = (core.fx.shakeY * s) | 0;
        ctx.drawImage(off, 0, 0, VW, VH, gfx.ox + sx, gfx.oy + sy, VW * s, VH * s);

        if (gfx.scanlines && s >= 2) {
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = '#000';
            for (var y = 0; y < VH; y++) {
                ctx.fillRect(gfx.ox + sx, gfx.oy + sy + y * s + s - 1, VW * s, 1);
            }
            ctx.globalAlpha = 1;
        }
    };

    // Exposed so tools/check.mjs can exercise the per-scanline budget without
    // a canvas: present() is the only other caller.
    gfx.budget = budgetSprites;

    gfx.spriteCount = function () { return spCount; };
    gfx.peakLine = function () {
        var m = 0;
        for (var i = 0; i < VH; i++) if (lineCount[i] > m) m = lineCount[i];
        return m;
    };

    window.gfx = gfx;
})();
