/* =============================================================================
   SLWF - palette.js
   The colour RAM. Four palettes of sixteen colours, every channel quantized to
   three bits, index 0 transparent in all of them.

   The 9-bit grid is not applied as a filter at the end -- it is applied at
   store time, so there is no such thing as a colour in this game that the
   hardware could not hold. Anything that wants a shade asks for one through
   shade()/mix(), which quantize on the way out too, so a derived ramp lands on
   the grid rather than near it.
   ============================================================================= */
(function () {
    'use strict';

    var pal = {};

    pal.NPAL = 4;
    pal.NCOL = 16;

    // Palette roles. Named because every one of the four is spoken for and
    // running out is a design problem, not a bug to fix later.
    pal.ARENA = 0;   // ring, ropes, apron, floor, crowd, referee
    pal.P1 = 1;   // wrestler A
    pal.P2 = 2;   // wrestler B
    pal.UI = 3;   // font, HUD, weapons, blood spray, impact FX

    // Three bits per channel, stored as 0..7. 4*16*3 bytes is the whole CRAM.
    pal.cram = new Uint8Array(pal.NPAL * pal.NCOL * 3);

    // The render LUT: 256 entries of packed RGBA, indexed by the framebuffer
    // byte (pal<<4 | index), with 0xFF reserved for the backdrop. 256 rather
    // than 64 so the framebuffer can carry its sentinel without a branch in
    // the blit loop.
    pal.lut = new Uint32Array(256);

    // Global brightness, 0..256 in 8.8. Scene transitions fade through this
    // rather than drawing a black rectangle over the top, because that is how
    // the hardware did it and because a fade that touches CRAM also fades the
    // backdrop and the letterbox edge stays honest.
    pal.brightness = 256;

    // A flash overrides every colour for a few frames. Finishers use it.
    var flashFrames = 0, flashR = 7, flashG = 7, flashB = 7, flashMix = 256;

    var dirty = true;

    /* ----------------------------------------------------------- quantization */

    // 8-bit channel -> 3-bit. Round rather than shift: >>5 would make pure
    // white 7 but 0xF0 only 7 as well, and the rounding keeps mid tones where
    // the eye expects them.
    function q8(v) {
        v = v < 0 ? 0 : (v > 255 ? 255 : v);
        return Math.round(v * 7 / 255);
    }
    pal.q8 = q8;

    // 3-bit channel -> 8-bit for display. The Genesis DAC is not linear across
    // the nine levels, but it is close enough that even spacing is the right
    // call; what matters is that only eight values per channel exist.
    function e8(v) { return (v * 255 / 7) | 0; }
    pal.e8 = e8;

    // "#rrggbb" -> [r,g,b] on the 3-bit grid. The single entry point for art
    // that was authored as hex.
    pal.hex = function (h) {
        if (h.charAt(0) === '#') h = h.substring(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [q8((n >> 16) & 255), q8((n >> 8) & 255), q8(n & 255)];
    };

    /* --------------------------------------------------------------- derived */

    // Scale a 3-bit triple toward black (amt < 256) or white (amt > 256),
    // staying on the grid. The wrestler palettes derive their shadow and
    // highlight rows from one base colour this way, which is why a character
    // is five colours and a body description rather than a spritesheet.
    pal.shade = function (c, amt) {
        var r, g, b;
        if (amt <= 256) {
            r = (c[0] * amt) >> 8; g = (c[1] * amt) >> 8; b = (c[2] * amt) >> 8;
        } else {
            var t = amt - 256;
            r = c[0] + (((7 - c[0]) * t) >> 8);
            g = c[1] + (((7 - c[1]) * t) >> 8);
            b = c[2] + (((7 - c[2]) * t) >> 8);
        }
        return [
            r < 0 ? 0 : (r > 7 ? 7 : r | 0),
            g < 0 ? 0 : (g > 7 ? 7 : g | 0),
            b < 0 ? 0 : (b > 7 ? 7 : b | 0)
        ];
    };

    pal.mix = function (a, b, t) {
        var u = 256 - t;
        return [
            ((a[0] * u + b[0] * t) >> 8) | 0,
            ((a[1] * u + b[1] * t) >> 8) | 0,
            ((a[2] * u + b[2] * t) >> 8) | 0
        ];
    };

    /* ---------------------------------------------------------------- access */

    // Channels are 0..7. Anything outside clamps rather than wrapping, because
    // a wrapped channel is a bright magenta pixel in the middle of a sprite and
    // takes an hour to find.
    pal.set = function (p, i, r, g, b) {
        var o = (p * pal.NCOL + i) * 3;
        pal.cram[o] = r < 0 ? 0 : (r > 7 ? 7 : r);
        pal.cram[o + 1] = g < 0 ? 0 : (g > 7 ? 7 : g);
        pal.cram[o + 2] = b < 0 ? 0 : (b > 7 ? 7 : b);
        dirty = true;
    };

    pal.setRGB = function (p, i, c) { pal.set(p, i, c[0], c[1], c[2]); };
    pal.setHex = function (p, i, h) { pal.setRGB(p, i, pal.hex(h)); };

    pal.get = function (p, i) {
        var o = (p * pal.NCOL + i) * 3;
        return [pal.cram[o], pal.cram[o + 1], pal.cram[o + 2]];
    };

    // Load sixteen colours at once. Accepts hex strings or [r,g,b] triples, and
    // a null leaves a slot alone -- handy for the wrestler palettes, whose
    // blood and white entries are shared and should not be respecified by
    // every character.
    pal.load = function (p, list) {
        for (var i = 0; i < list.length && i < pal.NCOL; i++) {
            var c = list[i];
            if (c === null || c === undefined) continue;
            if (typeof c === 'string') pal.setHex(p, i, c);
            else pal.setRGB(p, i, c);
        }
    };

    /* ------------------------------------------------------------- backdrop */

    // A separate register on the real hardware, not palette 0 index 0. It is
    // what shows where no plane and no sprite drew, and it is also the colour
    // the letterbox bars are *not* -- those stay black.
    pal.backdrop = [0, 0, 1];
    pal.setBackdrop = function (c) {
        pal.backdrop = (typeof c === 'string') ? pal.hex(c) : c;
        dirty = true;
    };

    /* ----------------------------------------------------------- fade/flash */

    pal.fade = function (v) {
        v = v < 0 ? 0 : (v > 256 ? 256 : v);
        if (v !== pal.brightness) { pal.brightness = v; dirty = true; }
    };

    // Flash the whole screen toward a colour. mix is 0..256; a finisher uses
    // 256 (full white) for two frames and then ramps out.
    pal.flash = function (frames, c, mix) {
        c = c || [7, 7, 7];
        flashFrames = frames;
        flashR = c[0]; flashG = c[1]; flashB = c[2];
        flashMix = (mix === undefined) ? 256 : mix;
        dirty = true;
    };

    pal.flashing = function () { return flashFrames > 0; };

    pal.update = function () {
        if (flashFrames > 0) {
            flashFrames--;
            // Ramp the mix down over the tail of the flash so it reads as a
            // pop rather than a stutter.
            if (flashFrames < 8) flashMix = (flashMix * 7) >> 3;
            dirty = true;
        }
    };

    /* ---------------------------------------------------------------- build */

    // Pack into the ABGR order a little-endian Uint32 view of an ImageData
    // expects. Checked at runtime rather than assumed, because a big-endian
    // host would silently swap red and blue.
    var LE = (function () {
        var b = new ArrayBuffer(4);
        new Uint32Array(b)[0] = 0x01020304;
        return new Uint8Array(b)[0] === 0x04;
    })();

    function pack(r, g, b) {
        var R = e8(r), G = e8(g), B = e8(b);
        return LE
            ? (0xFF000000 | (B << 16) | (G << 8) | R) >>> 0
            : ((R << 24) | (G << 16) | (B << 8) | 0xFF) >>> 0;
    }

    pal.rebuild = function () {
        var br = pal.brightness, fm = flashFrames > 0 ? flashMix : 0;
        for (var p = 0; p < pal.NPAL; p++) {
            for (var i = 0; i < pal.NCOL; i++) {
                var o = (p * pal.NCOL + i) * 3;
                var r = pal.cram[o], g = pal.cram[o + 1], b = pal.cram[o + 2];
                if (fm) {
                    var u = 256 - fm;
                    r = (r * u + flashR * fm) >> 8;
                    g = (g * u + flashG * fm) >> 8;
                    b = (b * u + flashB * fm) >> 8;
                }
                if (br !== 256) { r = (r * br) >> 8; g = (g * br) >> 8; b = (b * br) >> 8; }
                pal.lut[(p << 4) | i] = pack(r, g, b);
            }
        }
        var bd = pal.backdrop, br2 = pal.brightness;
        var dr = bd[0], dg = bd[1], db = bd[2];
        if (fm) {
            var u2 = 256 - fm;
            dr = (dr * u2 + flashR * fm) >> 8;
            dg = (dg * u2 + flashG * fm) >> 8;
            db = (db * u2 + flashB * fm) >> 8;
        }
        if (br2 !== 256) { dr = (dr * br2) >> 8; dg = (dg * br2) >> 8; db = (db * br2) >> 8; }
        pal.lut[0xFF] = pack(dr, dg, db);
        dirty = false;
    };

    pal.isDirty = function () { return dirty; };
    pal.touch = function () { dirty = true; };

    /* ------------------------------------------------------------- defaults */

    // The arena. The ring is specified: vibrant blue apron with SLWF in yellow
    // facing the camera, white canvas, black ropes and posts, yellow
    // turnbuckle pads. The canvas is white so blood shows on it.
    pal.ARENA_COLORS = [
        '#000000', // 0  transparent (never drawn)
        '#000000', // 1  black        ropes, posts, outlines
        '#b4b4c0', // 2  canvasShadow
        '#ffffff', // 3  canvasWhite
        '#002492', // 4  apronBlueDark
        '#0049db', // 5  apronBlue
        '#2492ff', // 6  apronBlueLight
        '#b66d00', // 7  yellowDark
        '#ffdb00', // 8  yellow       turnbuckles, SLWF
        '#241824', // 9  floorDark
        '#492449', // 10 floorMid
        '#120012', // 11 crowdDark
        '#492436', // 12 crowdMid
        '#6d496d', // 13 crowdLight
        '#920000', // 14 bloodDark
        '#db0000'  // 15 blood
    ];

    // UI and effects. The font lives here, so does every weapon.
    pal.UI_COLORS = [
        '#000000', // 0  transparent
        '#000000', // 1  black
        '#241824', // 2  uiDark
        '#496d92', // 3  uiMid
        '#b6dbff', // 4  uiLight
        '#ffffff', // 5  white
        '#db0000', // 6  red
        '#ff9200', // 7  orange
        '#ffdb00', // 8  yellow
        '#00db49', // 9  green
        '#00dbdb', // 10 cyan
        '#0049db', // 11 blue
        '#db00db', // 12 magenta
        '#926d24', // 13 wood     tables, chairs' seats
        '#6d6d92', // 14 steel    chair, pipe, ladder
        '#dbdbff'  // 15 steelLight
    ];

    pal.reset = function () {
        pal.load(pal.ARENA, pal.ARENA_COLORS);
        pal.load(pal.UI, pal.UI_COLORS);
        pal.setBackdrop('#000012');
        pal.brightness = 256;
        flashFrames = 0;
        dirty = true;
    };

    /* ----------------------------------------------------------- validation */

    // Used by tools/check.mjs: every stored channel must be on the grid.
    pal.validate = function () {
        var bad = [];
        for (var i = 0; i < pal.cram.length; i++) {
            if (pal.cram[i] > 7) bad.push(i);
        }
        return bad;
    };

    window.pal = pal;
})();
