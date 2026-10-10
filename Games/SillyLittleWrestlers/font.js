/* =============================================================================
   SLWF - font.js
   One 8x8 tile per glyph, generated on demand.

   Glyphs are authored as 6x6 ink inside the 8x8 cell with a one-pixel drop
   shadow baked in at +1,+1. The shadow is not decoration: the HUD sits on the
   window plane directly over a cheering crowd, and unshadowed white-on-crowd is
   unreadable in exactly the moment a player needs to read it.

   Tiles are allocated lazily per (glyph, ink, size) pair, because a resident
   four-colour font plus a resident double-height font is 600-odd tiles of a
   1024-tile static budget that the arena also has to fit in. Only the glyphs
   actually used get memory.
   ============================================================================= */
(function () {
    'use strict';

    var font = {};

    // Ink indices into the UI palette (palette 3). See DESIGN.md.
    font.WHITE = 5; font.RED = 6; font.ORANGE = 7; font.YELLOW = 8;
    font.GREEN = 9; font.CYAN = 10; font.BLUE = 11; font.GREY = 3;
    font.SHADOW = 1;

    // One line per glyph: eight rows of eight, '/'-separated, X is ink.
    // Uppercase only, as every console font of the era was -- lowercase input
    // is folded on the way in.
    var G = {
        'A'       : '..XX..../.XXXX.../XX..XX../XXXXXX../XX..XX../XX..XX../......../........',
        'B'       : 'XXXXX.../XX..XX../XXXXX.../XX..XX../XX..XX../XXXXX.../......../........',
        'C'       : '.XXXX.../XX..XX../XX....../XX....../XX..XX../.XXXX.../......../........',
        'D'       : 'XXXXX.../XX..XX../XX..XX../XX..XX../XX..XX../XXXXX.../......../........',
        'E'       : 'XXXXXX../XX....../XXXXX.../XX....../XX....../XXXXXX../......../........',
        'F'       : 'XXXXXX../XX....../XXXXX.../XX....../XX....../XX....../......../........',
        'G'       : '.XXXX.../XX..XX../XX....../XX.XXX../XX..XX../.XXXX.../......../........',
        'H'       : 'XX..XX../XX..XX../XXXXXX../XX..XX../XX..XX../XX..XX../......../........',
        'I'       : '.XXXX.../..XX..../..XX..../..XX..../..XX..../.XXXX.../......../........',
        'J'       : '...XXX../....XX../....XX../....XX../XX..XX../.XXXX.../......../........',
        'K'       : 'XX..XX../XX.XX.../XXXX..../XXXX..../XX.XX.../XX..XX../......../........',
        'L'       : 'XX....../XX....../XX....../XX....../XX....../XXXXXX../......../........',
        'M'       : 'XX..XX../XXXXXX../XXXXXX../XX..XX../XX..XX../XX..XX../......../........',
        'N'       : 'XX..XX../XXX.XX../XXXXXX../XX.XXX../XX..XX../XX..XX../......../........',
        'O'       : '.XXXX.../XX..XX../XX..XX../XX..XX../XX..XX../.XXXX.../......../........',
        'P'       : 'XXXXX.../XX..XX../XX..XX../XXXXX.../XX....../XX....../......../........',
        'Q'       : '.XXXX.../XX..XX../XX..XX../XX.XXX../XX..XX../.XXXXX../......../........',
        'R'       : 'XXXXX.../XX..XX../XX..XX../XXXXX.../XX.XX.../XX..XX../......../........',
        'S'       : '.XXXXX../XX....../.XXXX.../....XX../XX..XX../XXXXX.../......../........',
        'T'       : 'XXXXXX../..XX..../..XX..../..XX..../..XX..../..XX..../......../........',
        'U'       : 'XX..XX../XX..XX../XX..XX../XX..XX../XX..XX../.XXXX.../......../........',
        'V'       : 'XX..XX../XX..XX../XX..XX../XX..XX../.XXXX.../..XX..../......../........',
        'W'       : 'XX..XX../XX..XX../XX..XX../XXXXXX../XXXXXX../XX..XX../......../........',
        'X'       : 'XX..XX../.XXXX.../..XX..../..XX..../.XXXX.../XX..XX../......../........',
        'Y'       : 'XX..XX../XX..XX../.XXXX.../..XX..../..XX..../..XX..../......../........',
        'Z'       : 'XXXXXX../....XX../...XX.../..XX..../.XX...../XXXXXX../......../........',
        '0'       : '.XXXX.../XX..XX../XX.XXX../XXX.XX../XX..XX../.XXXX.../......../........',
        '1'       : '..XX..../.XXX..../..XX..../..XX..../..XX..../.XXXX.../......../........',
        '2'       : '.XXXX.../XX..XX../...XX.../..XX..../.XX...../XXXXXX../......../........',
        '3'       : 'XXXXX.../....XX../..XXX.../....XX../XX..XX../.XXXX.../......../........',
        '4'       : '...XX.../..XXX.../.XX.XX../XXXXXX../...XX.../...XX.../......../........',
        '5'       : 'XXXXXX../XX....../XXXXX.../....XX../XX..XX../XXXXX.../......../........',
        '6'       : '..XXX.../.XX...../XXXXX.../XX..XX../XX..XX../.XXXX.../......../........',
        '7'       : 'XXXXXX../....XX../...XX.../..XX..../..XX..../..XX..../......../........',
        '8'       : '.XXXX.../XX..XX../.XXXX.../XX..XX../XX..XX../.XXXX.../......../........',
        '9'       : '.XXXX.../XX..XX../XX..XX../.XXXXX../....XX../.XXX..../......../........',
        ' '       : '......../......../......../......../......../......../......../........',
        '.'       : '......../......../......../......../..XX..../..XX..../......../........',
        ','       : '......../......../......../......../..XX..../..XX..../.XX...../........',
        ':'       : '......../..XX..../..XX..../......../..XX..../..XX..../......../........',
        '!'       : '..XX..../..XX..../..XX..../..XX..../......../..XX..../......../........',
        '?'       : '.XXXX.../XX..XX../...XX.../..XX..../......../..XX..../......../........',
        '-'       : '......../......../.XXXX.../......../......../......../......../........',
        '+'       : '......../..XX..../.XXXXX../..XX..../......../......../......../........',
        '/'       : '....XX../...XX.../..XX..../.XX...../XX....../......../......../........',
        "'"       : '..XX..../..XX..../......../......../......../......../......../........',
        '"'       : '.XX.XX../.XX.XX../......../......../......../......../......../........',
        '('       : '...XX.../..XX..../..XX..../..XX..../..XX..../...XX.../......../........',
        ')'       : '..XX..../...XX.../...XX.../...XX.../...XX.../..XX..../......../........',
        '*'       : '......../.X.XX.X./..XXX.../.XXXXX../..XXX.../.X.XX.X./......../........',
        '%'       : 'XX...XX./....XX../...XX.../..XX..../.XX...../XX...XX./......../........',
        '&'       : '.XXX..../XX..X.../.XXX..../XX.XXX../XX..XX../.XXXXX../......../........',
        '#'       : '.XX.XX../XXXXXX../.XX.XX../.XX.XX../XXXXXX../.XX.XX../......../........',
        '<'       : '...XX.../..XX..../.XX...../.XX...../..XX..../...XX.../......../........',
        '>'       : '.XX...../..XX..../...XX.../...XX.../..XX..../.XX...../......../........',
        '='       : '......../.XXXXX../......../.XXXXX../......../......../......../........',
        '['       : '..XXX.../..XX..../..XX..../..XX..../..XX..../..XXX.../......../........',
        ']'       : '..XXX.../....XX../....XX../....XX../....XX../..XXX.../......../........',
        '_'       : '......../......../......../......../......../XXXXXX../......../........',
        '→'       : '......../..X...../..XXXX../XXXXXXX./..XXXX../..X...../......../........'
    };

    // Decoded glyphs: 64-byte masks, 1 = ink.
    var masks = Object.create(null);
    (function decode() {
        for (var ch in G) {
            var rows = G[ch].split('/');
            var m = new Uint8Array(64);
            for (var y = 0; y < 8 && y < rows.length; y++) {
                var r = rows[y];
                for (var x = 0; x < 8 && x < r.length; x++) {
                    if (r.charAt(x) === 'X') m[y * 8 + x] = 1;
                }
            }
            masks[ch] = m;
        }
    })();

    font.MISSING = '?';

    /* ---------------------------------------------------------------- cache */

    var small = Object.create(null);   // key "ch|ink"  -> tile index
    var big = Object.create(null);     // key "ch|ink"  -> base of 2x2 tiles
    var huge = Object.create(null);    // key "ch|ink"  -> base of 4x4 tiles
    var px = new Uint8Array(32 * 32);  // scratch

    function glyphMask(ch) {
        var m = masks[ch];
        if (!m) m = masks[font.MISSING];
        return m;
    }

    // Render a glyph into `px` at the given scale with its baked shadow.
    // Shadow first, ink over: at scale 1 the shadow is one pixel down-right,
    // at scale 2 it is two, which keeps the weight looking the same.
    function rasterize(ch, ink, scale) {
        var m = glyphMask(ch);
        var dim = 8 * scale;
        px.fill(0, 0, dim * dim);
        var s = scale, d = scale;
        var x, y, i, j;
        for (y = 0; y < 8; y++) {
            for (x = 0; x < 8; x++) {
                if (!m[y * 8 + x]) continue;
                for (i = 0; i < s; i++) {
                    for (j = 0; j < s; j++) {
                        var sy = y * s + i + d, sx = x * s + j + d;
                        if (sx < dim && sy < dim) px[sy * dim + sx] = font.SHADOW;
                    }
                }
            }
        }
        for (y = 0; y < 8; y++) {
            for (x = 0; x < 8; x++) {
                if (!m[y * 8 + x]) continue;
                for (i = 0; i < s; i++) {
                    for (j = 0; j < s; j++) {
                        px[(y * s + i) * dim + x * s + j] = ink;
                    }
                }
            }
        }
        return dim;
    }

    function norm(ch) {
        ch = ch.toUpperCase();
        return masks[ch] ? ch : font.MISSING;
    }

    font.tile = function (ch, ink) {
        ch = norm(ch);
        ink = ink || font.WHITE;
        var key = ch + '|' + ink;
        var t = small[key];
        if (t !== undefined) return t;
        rasterize(ch, ink, 1);
        t = gfx.defineTiles(px, 1, 1);
        small[key] = t;
        return t;
    };

    // Four cells square. Headings only: sixteen tiles a glyph is not
    // something to spend on body text.
    font.hugeTile = function (ch, ink) {
        ch = norm(ch);
        ink = ink || font.WHITE;
        var key = ch + '|' + ink;
        var t = huge[key];
        if (t !== undefined) return t;
        rasterize(ch, ink, 4);
        t = gfx.defineTiles(px, 4, 4);
        huge[key] = t;
        return t;
    };

    font.hugeText = function (plane, col, row, str, ink, palId) {
        str = String(str);
        if (palId === undefined) palId = pal.UI;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charAt(i);
            if (ch === ' ') { gfx.fillCells(plane, col + i * 4, row, 4, 4, 0, palId, 0); continue; }
            gfx.blitCells(plane, col + i * 4, row, font.hugeTile(ch, ink), 4, 4, palId, 0);
        }
        return col + str.length * 4;
    };

    font.hugeCentred = function (plane, row, str, ink, palId, cols) {
        return font.hugeText(plane, font.centreHuge(str, cols), row, str, ink, palId);
    };

    font.bigTile = function (ch, ink) {
        ch = norm(ch);
        ink = ink || font.WHITE;
        var key = ch + '|' + ink;
        var t = big[key];
        if (t !== undefined) return t;
        rasterize(ch, ink, 2);
        t = gfx.defineTiles(px, 2, 2);
        big[key] = t;
        return t;
    };

    /* --------------------------------------------------------------- drawing */

    // Text goes into a plane as cells. Tile-aligned, which is both authentic
    // and the reason the HUD costs zero sprites.
    font.text = function (plane, col, row, str, ink, palId) {
        str = String(str);
        if (palId === undefined) palId = pal.UI;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charAt(i);
            if (ch === ' ') { gfx.cell(plane, col + i, row, 0, palId, 0); continue; }
            gfx.cell(plane, col + i, row, font.tile(ch, ink), palId, 0);
        }
        return col + str.length;
    };

    // Double height and width: two cells across, two down.
    font.bigText = function (plane, col, row, str, ink, palId) {
        str = String(str);
        if (palId === undefined) palId = pal.UI;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charAt(i);
            if (ch === ' ') {
                gfx.fillCells(plane, col + i * 2, row, 2, 2, 0, palId, 0);
                continue;
            }
            var base = font.bigTile(ch, ink);
            gfx.blitCells(plane, col + i * 2, row, base, 2, 2, palId, 0);
        }
        return col + str.length * 2;
    };

    // Centre in a plane of `cols` columns, defaulting to the window plane's
    // actual width rather than a baked 40 -- the plane is 80 cells wide now.
    function planeCols() { return (window.gfx && gfx.planeW) ? gfx.planeW.w : 40; }

    font.centre = function (str, cols) {
        return ((cols || planeCols()) - String(str).length) >> 1;
    };
    font.centreBig = function (str, cols) {
        return ((cols || planeCols()) - String(str).length * 2) >> 1;
    };
    font.centreHuge = function (str, cols) {
        return ((cols || planeCols()) - String(str).length * 4) >> 1;
    };

    font.textCentred = function (plane, row, str, ink, palId, cols) {
        return font.text(plane, font.centre(str, cols), row, str, ink, palId);
    };
    font.bigCentred = function (plane, row, str, ink, palId, cols) {
        return font.bigText(plane, font.centreBig(str, cols), row, str, ink, palId);
    };

    // Clear a run of cells -- menus redraw by clearing and rewriting rather
    // than tracking what changed, because the window plane is 1120 cells and
    // clearing all of it is nothing.
    font.clear = function (plane, col, row, w, h, palId) {
        gfx.fillCells(plane, col, row, w, h || 1, 0, palId || 0, 0);
    };

    // Right-aligned, for the clock and counters.
    font.textRight = function (plane, colEnd, row, str, ink, palId) {
        str = String(str);
        return font.text(plane, colEnd - str.length, row, str, ink, palId);
    };

    font.pad = function (n, w, ch) {
        var s = String(n);
        while (s.length < w) s = (ch || '0') + s;
        return s;
    };

    // Which glyphs exist, for the roster name editor's character wheel.
    font.CHARSET = (function () {
        var s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-\'';
        return s;
    })();

    font.has = function (ch) { return !!masks[ch.toUpperCase()]; };

    window.font = font;
})();
