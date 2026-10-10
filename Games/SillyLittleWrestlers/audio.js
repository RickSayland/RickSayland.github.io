// ============ SILLY LITTLE WRESTLING FEDERATION — SOUND ============
//
// A Sega Genesis / Mega Drive sound chip, in software.
//
// Plain classic script (IIFE), not an ES module, so load order is the <script>
// order in index.html. This file defines exactly one global: `sound`. Nothing
// here touches the DOM and nothing here creates an AudioContext until
// sound.init() is called from a real user gesture — browsers block a context
// built at parse time, and a blocked context is indistinguishable from a
// broken one at the point where you would like to debug it.
//
// WHAT IS EMULATED
//
//   YM2612 (OPN2) — music. Six channels of four-operator FM: all eight
//   connection algorithms, per-operator multiple/detune/total-level, the
//   chip's AR/D1R/D2R/RR envelope with its sustain level and rate scaling,
//   and feedback on operator 1. The datapath is the real one: a quarter
//   log-sine table plus an exponential attenuation table, so the output is
//   quantised the way the hardware quantises it. The core runs at the chip's
//   own 53267 Hz and is resampled to the context rate; channels clip at 14
//   bits and the mix bus hard-clips. The crunch is the point.
//
//   SN76489 (PSG) — sound effects. Three hard-edged square tone channels on
//   10-bit dividers plus one noise channel (16-bit LFSR, white and periodic),
//   4-bit logarithmic volume. No anti-aliasing anywhere; squares are squares.
//
// Real FM needs per-sample work, so the whole synth lives in an
// AudioWorkletNode. There is no build step in this repo and no separate
// worklet file, so the worklet source is built as a string from
// GenesisCore.toString() and registered from a Blob URL. If audioWorklet is
// missing or addModule rejects, the SAME GenesisCore function is driven from
// a ScriptProcessorNode instead — one DSP core, two transports.
//
// Because the worklet source comes from Function.prototype.toString(), the
// GenesisCore function must stay self-contained: it may use globals (Math,
// typed arrays) and its own internals, and nothing from this closure.
//
// The music sequencer also lives inside the core, driven by sample counts, so
// a hitched frame cannot make the music stutter. sound.update(dt) only does
// bookkeeping.
//
// Load order in index.html: core -> ring -> wrestler -> combat -> ai -> ui ->
// audio -> main. Cache-busting is a ?v= query on the script tag; bump it with
// SOUND_VERSION below on each release.

(function () {
    'use strict';

    var SOUND_VERSION = '1.0.0';

    /* Master trim applied by a GainNode after the synth. The chip's own output
       is already hot and deliberately clips, so this is headroom for the
       browser, not a mix control — sound.setVolume() is the mix control. */
    var MASTER_GAIN = 0.75;

    /* ======================================================================
       1. FM PATCH BANK  (YM2612 voices)
       ======================================================================

       alg  0..7   connection algorithm:
                     0  1>2>3>4            (serial, metallic)
                     1  (1+2)>3>4
                     2  2>3, (1+3)>4
                     3  1>2, (2+3)>4
                     4  1>2 + 3>4          (two stacks — basses, leads)
                     5  1>2, 1>3, 1>4      (one modulator, three carriers)
                     6  1>2 + 3 + 4
                     7  1+2+3+4            (additive — organs, squares)
       fb   0..7   feedback on operator 1. 0 is none, 7 is nearly noise.
       peg  [semitones, seconds]  optional pitch envelope: starts this many
                   semitones sharp and decays to pitch with that time
                   constant. The chip has no such thing; a Genesis driver did
                   it by rewriting the frequency registers every frame, which
                   is exactly what drums, zaps and thuds were made of.

       Per operator:
         mul 0..15  frequency multiple (0 means x0.5)
         dt  0..7   detune, ~3.5 cents a step; 0-3 sharp, 4-7 flat. This is
                    where the slightly-out-of-tune FM shimmer comes from.
         tl  0..127 total level — ATTENUATION, so 0 is loudest. On a carrier
                    this is volume; on a modulator it is brightness.
         ar  0..31  attack rate  (31 = instant)
         d1r 0..31  first decay rate, down to...
         sl  0..15  ...the sustain level (0 = no decay, 15 = decay to silence)
         d2r 0..31  second decay rate from the sustain level (0 = hold)
         rr  0..31  release rate after key off
         ks  0..3   rate scaling: how much faster the envelope runs up high
       ------------------------------------------------------------------ */

    var PATCHES = {

        /* ---- BASS ---------------------------------------------------- */

        // Slap bass. Two stacks: op1 is a bright 3x modulator that dies in
        // ~60 ms (that is the slap), op3/op4 fill in a detuned body. fb 6 on
        // op1 puts dirt on the attack.
        bassSlap: { alg: 4, fb: 6, ops: [
            { mul: 3, dt: 0, tl: 26, ar: 31, d1r: 21, sl: 13, d2r: 7, rr: 20, ks: 2 },
            { mul: 1, dt: 0, tl: 14, ar: 31, d1r: 11, sl:  3, d2r: 3, rr: 20, ks: 1 },
            { mul: 2, dt: 1, tl: 36, ar: 31, d1r: 17, sl:  9, d2r: 5, rr: 20, ks: 2 },
            { mul: 1, dt: 7, tl: 20, ar: 31, d1r:  9, sl:  2, d2r: 2, rr: 20, ks: 1 }
        ]},

        // Additive square bass: four sines on the odd harmonics with the
        // amplitudes stepped down is a square wave, and on this chip it is
        // the cheapest way to get a PSG-flavoured bass with FM's bottom end.
        bassSq: { alg: 7, fb: 0, ops: [
            { mul: 1, dt: 0, tl: 16, ar: 31, d1r: 6,  sl: 2, d2r: 0, rr: 19, ks: 1 },
            { mul: 3, dt: 1, tl: 26, ar: 31, d1r: 8,  sl: 3, d2r: 0, rr: 19, ks: 1 },
            { mul: 5, dt: 5, tl: 32, ar: 31, d1r: 10, sl: 4, d2r: 0, rr: 19, ks: 1 },
            { mul: 7, dt: 2, tl: 37, ar: 31, d1r: 12, sl: 5, d2r: 0, rr: 19, ks: 1 }
        ]},

        // Sludge bass for the heavy entrance. Serial chain with full feedback:
        // the output is barely periodic, which is what a distorted guitar
        // sounded like on this chip.
        heavy: { alg: 0, fb: 7, ops: [
            { mul: 1, dt: 0, tl: 18, ar: 31, d1r: 8,  sl: 2, d2r: 0, rr: 18, ks: 0 },
            { mul: 1, dt: 1, tl: 22, ar: 31, d1r: 10, sl: 3, d2r: 0, rr: 18, ks: 0 },
            { mul: 2, dt: 5, tl: 26, ar: 31, d1r: 12, sl: 4, d2r: 0, rr: 18, ks: 0 },
            { mul: 1, dt: 0, tl: 12, ar: 31, d1r: 7,  sl: 1, d2r: 0, rr: 18,  ks: 0 }
        ]},

        /* ---- LEADS --------------------------------------------------- */

        // Square lead. Odd harmonics again, detuned apart so held notes beat
        // against themselves.
        leadSq: { alg: 7, fb: 0, ops: [
            { mul: 1, dt: 0, tl: 18, ar: 31, d1r: 5,  sl: 1, d2r: 0, rr: 19, ks: 1 },
            { mul: 3, dt: 6, tl: 27, ar: 31, d1r: 7,  sl: 2, d2r: 0, rr: 19, ks: 1 },
            { mul: 5, dt: 2, tl: 33, ar: 31, d1r: 9,  sl: 3, d2r: 0, rr: 19, ks: 1 },
            { mul: 1, dt: 3, tl: 24, ar: 31, d1r: 6,  sl: 2, d2r: 0, rr: 19, ks: 1 }
        ]},

        // Fatter sawish lead with a bite on the attack.
        lead2: { alg: 4, fb: 5, ops: [
            { mul: 2, dt: 1, tl: 30, ar: 31, d1r: 14, sl: 6, d2r: 3, rr: 19, ks: 2 },
            { mul: 1, dt: 0, tl: 16, ar: 31, d1r: 6,  sl: 2, d2r: 0, rr: 19, ks: 1 },
            { mul: 1, dt: 5, tl: 34, ar: 30, d1r: 12, sl: 5, d2r: 2, rr: 19, ks: 2 },
            { mul: 1, dt: 2, tl: 22, ar: 31, d1r: 7,  sl: 2, d2r: 0, rr: 19, ks: 1 }
        ]},

        // Whistle/ocarina for the goofy entrance — nearly a pure sine with a
        // wobble, deliberately silly.
        whistle: { alg: 6, fb: 1, ops: [
            { mul: 1, dt: 0, tl: 40, ar: 25, d1r: 10, sl: 4, d2r: 0, rr: 17, ks: 1 },
            { mul: 1, dt: 0, tl: 20, ar: 26, d1r: 5,  sl: 1, d2r: 0, rr: 17, ks: 1 },
            { mul: 2, dt: 6, tl: 34, ar: 24, d1r: 8,  sl: 3, d2r: 0, rr: 17, ks: 1 },
            { mul: 4, dt: 3, tl: 44, ar: 22, d1r: 9,  sl: 4, d2r: 0, rr: 17, ks: 1 }
        ]},

        /* ---- BRASS AND STABS ----------------------------------------- */

        // Brass. alg 2 with a slowish modulator attack is the classic OPN2
        // horn: the brightness arrives after the note does.
        brass: { alg: 2, fb: 4, ops: [
            { mul: 1, dt: 1, tl: 30, ar: 22, d1r: 10, sl: 4,  d2r: 0, rr: 18, ks: 2 },
            { mul: 1, dt: 0, tl: 34, ar: 24, d1r: 11, sl: 5,  d2r: 0, rr: 18, ks: 2 },
            { mul: 1, dt: 5, tl: 26, ar: 26, d1r: 12, sl: 4,  d2r: 0, rr: 18, ks: 2 },
            { mul: 1, dt: 0, tl: 17, ar: 29, d1r: 8,  sl: 2,  d2r: 0, rr: 18, ks: 1 }
        ]},

        // Bigger, brighter brass for fanfares.
        fanfare: { alg: 2, fb: 5, ops: [
            { mul: 1, dt: 2, tl: 24, ar: 27, d1r: 9,  sl: 3, d2r: 0, rr: 18, ks: 2 },
            { mul: 2, dt: 0, tl: 30, ar: 28, d1r: 10, sl: 4, d2r: 0, rr: 18, ks: 2 },
            { mul: 1, dt: 6, tl: 22, ar: 30, d1r: 11, sl: 3, d2r: 0, rr: 18, ks: 2 },
            { mul: 1, dt: 0, tl: 14, ar: 31, d1r: 7,  sl: 1, d2r: 0, rr: 18, ks: 1 }
        ]},

        // Short orchestra-hit stab. Everything fast, nothing sustains.
        stab: { alg: 1, fb: 6, ops: [
            { mul: 1,  dt: 0, tl: 26, ar: 31, d1r: 20, sl: 10, d2r: 10, rr: 18, ks: 2 },
            { mul: 7,  dt: 3, tl: 34, ar: 31, d1r: 22, sl: 12, d2r: 12, rr: 18, ks: 2 },
            { mul: 2,  dt: 5, tl: 28, ar: 31, d1r: 21, sl: 11, d2r: 11, rr: 18, ks: 2 },
            { mul: 1,  dt: 0, tl: 18, ar: 31, d1r: 17, sl: 8,  d2r: 9,  rr: 17, ks: 1 }
        ]},

        /* ---- PADS AND KEYS ------------------------------------------- */

        // Drawbar organ: four parallel sines at 1/2/4/8.
        organ: { alg: 7, fb: 0, ops: [
            { mul: 1, dt: 0, tl: 20, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 18, ks: 0 },
            { mul: 2, dt: 1, tl: 26, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 18, ks: 0 },
            { mul: 4, dt: 5, tl: 32, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 18, ks: 0 },
            { mul: 8, dt: 2, tl: 38, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 18, ks: 0 }
        ]},

        // Detuned pad, slow in and slow out.
        pad: { alg: 2, fb: 2, ops: [
            { mul: 1, dt: 1, tl: 36, ar: 14, d1r: 6, sl: 2, d2r: 0, rr: 7, ks: 0 },
            { mul: 1, dt: 6, tl: 32, ar: 13, d1r: 5, sl: 2, d2r: 0, rr: 7, ks: 0 },
            { mul: 2, dt: 2, tl: 38, ar: 12, d1r: 6, sl: 3, d2r: 0, rr: 7, ks: 0 },
            { mul: 1, dt: 5, tl: 22, ar: 15, d1r: 4, sl: 1, d2r: 0, rr: 6, ks: 0 }
        ]},

        // Plucked string / harp.
        pluck: { alg: 4, fb: 3, ops: [
            { mul: 3, dt: 0, tl: 28, ar: 31, d1r: 22, sl: 14, d2r: 14, rr: 16, ks: 3 },
            { mul: 1, dt: 0, tl: 18, ar: 31, d1r: 15, sl: 11, d2r: 9,  rr: 15, ks: 2 },
            { mul: 1, dt: 6, tl: 32, ar: 31, d1r: 20, sl: 13, d2r: 12, rr: 16, ks: 3 },
            { mul: 1, dt: 2, tl: 24, ar: 31, d1r: 14, sl: 10, d2r: 8,  rr: 15, ks: 2 }
        ]},

        // Ring bell — inharmonic multiples and a long release. Used for the
        // ringside bell SFX as well as the victory theme.
        bellFM: { alg: 5, fb: 2, ops: [
            { mul: 7,  dt: 1, tl: 30, ar: 31, d1r: 14, sl: 8,  d2r: 5, rr: 6, ks: 1 },
            { mul: 1,  dt: 0, tl: 18, ar: 31, d1r: 10, sl: 6,  d2r: 3, rr: 5, ks: 1 },
            { mul: 11, dt: 5, tl: 36, ar: 31, d1r: 16, sl: 10, d2r: 6, rr: 6, ks: 1 },
            { mul: 2,  dt: 2, tl: 26, ar: 31, d1r: 12, sl: 7,  d2r: 4, rr: 5, ks: 1 }
        ]},

        // Dark church-organ-ish voice for the sinister entrance. The 5x and
        // 11x multiples against a slow attack make it crawl.
        sinister: { alg: 5, fb: 3, ops: [
            { mul: 1,  dt: 2, tl: 22, ar: 18, d1r: 6,  sl: 2, d2r: 0, rr: 14, ks: 0 },
            { mul: 1,  dt: 6, tl: 20, ar: 17, d1r: 5,  sl: 1, d2r: 0, rr: 14, ks: 0 },
            { mul: 5,  dt: 1, tl: 38, ar: 15, d1r: 8,  sl: 4, d2r: 0, rr: 14, ks: 0 },
            { mul: 11, dt: 5, tl: 46, ar: 14, d1r: 10, sl: 6, d2r: 0, rr: 14, ks: 0 }
        ]},

        // Bouncy rubber-band voice for the goofy entrance.
        goofy: { alg: 6, fb: 4, ops: [
            { mul: 4, dt: 3, tl: 32, ar: 31, d1r: 19, sl: 11, d2r: 8, rr: 16, ks: 2 },
            { mul: 1, dt: 0, tl: 18, ar: 31, d1r: 16, sl: 9,  d2r: 7, rr: 15, ks: 2 },
            { mul: 2, dt: 6, tl: 28, ar: 31, d1r: 18, sl: 10, d2r: 8, rr: 16, ks: 2 },
            { mul: 6, dt: 2, tl: 38, ar: 31, d1r: 21, sl: 13, d2r: 9, rr: 16, ks: 2 }
        ]},

        /* ---- DRUMS AND IMPACTS --------------------------------------- */
        // All of these lean on `peg`. A Genesis kick with no pitch envelope
        // is just a click; the drop from +30 semitones in 25 ms is the drum.

        kick: { alg: 7, fb: 1, peg: [30, 0.022], ops: [
            { mul: 1, dt: 0, tl: 10,  ar: 31, d1r: 23, sl: 15, d2r: 23, rr: 23, ks: 0 },
            { mul: 1, dt: 4, tl: 26,  ar: 31, d1r: 26, sl: 15, d2r: 26, rr: 26, ks: 0 },
            { mul: 2, dt: 0, tl: 44,  ar: 31, d1r: 28, sl: 15, d2r: 28, rr: 28, ks: 0 },
            { mul: 1, dt: 0, tl: 127, ar: 31, d1r: 31, sl: 15, d2r: 31, rr: 31, ks: 0 }
        ]},

        tom: { alg: 4, fb: 2, peg: [14, 0.05], ops: [
            { mul: 2, dt: 1, tl: 32, ar: 31, d1r: 22, sl: 14, d2r: 18, rr: 20, ks: 1 },
            { mul: 1, dt: 0, tl: 14, ar: 31, d1r: 17, sl: 12, d2r: 14, rr: 18, ks: 1 },
            { mul: 1, dt: 5, tl: 36, ar: 31, d1r: 24, sl: 15, d2r: 20, rr: 20, ks: 1 },
            { mul: 1, dt: 2, tl: 24, ar: 31, d1r: 19, sl: 13, d2r: 16, rr: 19, ks: 1 }
        ]},

        // Body-on-canvas thud. Almost no harmonics, a big pitch drop, gone in
        // a quarter second. This is the low half of most of the impact SFX.
        thud: { alg: 7, fb: 2, peg: [20, 0.045], ops: [
            { mul: 1, dt: 0, tl: 8,   ar: 31, d1r: 19, sl: 15, d2r: 19, rr: 19, ks: 0 },
            { mul: 1, dt: 5, tl: 20,  ar: 31, d1r: 21, sl: 15, d2r: 21, rr: 21, ks: 0 },
            { mul: 3, dt: 0, tl: 52,  ar: 31, d1r: 26, sl: 15, d2r: 26, rr: 26, ks: 0 },
            { mul: 1, dt: 0, tl: 127, ar: 31, d1r: 31, sl: 15, d2r: 31, rr: 31, ks: 0 }
        ]},

        // Metal. Serial chain, full feedback, inharmonic multiples, long ring.
        // Chairs, steel steps, and the finisher.
        clang: { alg: 0, fb: 7, ops: [
            { mul: 11, dt: 3, tl: 28, ar: 31, d1r: 12, sl: 6,  d2r: 4, rr: 10, ks: 1 },
            { mul: 7,  dt: 6, tl: 24, ar: 31, d1r: 14, sl: 7,  d2r: 5, rr: 10, ks: 1 },
            { mul: 13, dt: 1, tl: 26, ar: 31, d1r: 16, sl: 9,  d2r: 6, rr: 10, ks: 1 },
            { mul: 1,  dt: 0, tl: 14, ar: 31, d1r: 11, sl: 5,  d2r: 3, rr: 9,  ks: 1 }
        ]},

        // Timpani for the VS screen.
        timpani: { alg: 4, fb: 3, peg: [10, 0.07], ops: [
            { mul: 1, dt: 1, tl: 30, ar: 31, d1r: 16, sl: 10, d2r: 11, rr: 14, ks: 1 },
            { mul: 1, dt: 0, tl: 12, ar: 31, d1r: 12, sl: 8,  d2r: 8,  rr: 13, ks: 1 },
            { mul: 2, dt: 6, tl: 40, ar: 31, d1r: 20, sl: 13, d2r: 14, rr: 15, ks: 1 },
            { mul: 1, dt: 5, tl: 22, ar: 31, d1r: 14, sl: 9,  d2r: 10, rr: 13, ks: 1 }
        ]}
    };

    /* ======================================================================
       2. PSG INSTRUMENTS  (SN76489 layers)
       ======================================================================

       One "layer" is one sound on one hardware resource, with a 4-bit volume
       envelope stepped at 60 Hz. The same format is used by the music tracker
       for its PSG channels and by the SFX table below, because on the real
       chip they are competing for the same three tone channels and the same
       single noise channel, and pretending otherwise is how you end up with
       a hi-hat that eats a punch.

         ch     'tone' | 'noise' | 'fm'
                'fm' borrows FM channel 5, which the music tracks leave free
                for exactly this reason - a Genesis driver always reserved one
                FM channel for effects.
         mode   'white' | 'periodic'   (noise only). Periodic is the 16-shift
                buzz: a cheap gritty pitch, and the backbone of the bone snap.
         nf     0 | 1 | 2   fixed noise shift rate (high/mid/low). Ignored
                when `note` is given.
         note   pitch, as a tracker note string or a number in Hz. On a noise
                layer it sets the shift divider from the same formula either
                way, so the noise colour tracks the note.
         vol    4-bit volume per step, 15 LOUDEST, 0 silent. Its length is the
                layer's duration in steps.
         sus    hold the last `vol` entry until note off (sustaining music
                tones; drums and effects leave it off and simply end).
         step   frames (1/60 s) per envelope step. Default 1.
         delay  frames to wait before starting. This is how a sound gets two
                noise bursts out of one noise channel: run them back to back.
         bend   semitones added per step - slides.
         pitch  explicit per-step semitone offsets; overrides `bend`.
         vib    [depth in semitones, period in steps]
         rand   random semitone jitter per step. Splintering wood, bone.
         patch  FM patch name, for ch:'fm' layers only.
         prio   0..3, default 1. A layer will not steal a resource from a
                higher-priority effect. The story beats are prio 3.
       ------------------------------------------------------------------ */

    var PSG_INST = {

        /* ---- drum kit (all on the one noise channel) ---------------- */
        sn:  { ch: 'noise', mode: 'white', note: 'C-6', vol: [15, 13, 10, 7, 4, 2, 1] },
        sn2: { ch: 'noise', mode: 'white', note: 'A-5', vol: [15, 14, 12, 10, 7, 5, 3, 2, 1] },
        hh:  { ch: 'noise', mode: 'white', note: 'C-8', vol: [12, 7, 3, 1] },
        oh:  { ch: 'noise', mode: 'white', note: 'C-8', vol: [12, 11, 9, 8, 6, 5, 3, 2, 1] },
        cr:  { ch: 'noise', mode: 'white', note: 'G-7', vol: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], step: 2 },
        cl:  { ch: 'noise', mode: 'periodic', note: 'C-7', vol: [15, 10, 5, 1] },

        /* ---- pitched PSG voices for the music ----------------------- */
        // Sustaining square, the PSG's only real voice.
        sq:    { ch: 'tone', vol: [15, 14, 13, 13, 12], sus: true },
        // Quieter sustaining square for harmony lines.
        sqLo:  { ch: 'tone', vol: [11, 10, 10, 9, 9], sus: true },
        // Decaying blip for arpeggios.
        pling: { ch: 'tone', vol: [15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
        // Very short tick.
        tick:  { ch: 'tone', vol: [13, 7, 2] },
        // Buzzy periodic-noise pedal, used low on the dark tracks.
        buzz:  { ch: 'noise', mode: 'periodic', vol: [12, 11, 11, 10, 10], sus: true },
        // Square with a dive on the front, for the goofy theme.
        boing: { ch: 'tone', vol: [15, 14, 12, 11, 9, 8, 6, 5, 3, 2, 1], bend: -1.1 }
    };

    /* ======================================================================
       3. SOUND EFFECTS  (one entry per sound.sfx() name)
       ======================================================================
       Each entry is a list of layers in the format above. Layers that want
       the same resource must be separated by `delay`, because the hardware
       has three tone channels and ONE noise channel and so does this.
       ------------------------------------------------------------------ */

    var SFX = {

        /* ---- strikes ------------------------------------------------- */

        punch: [
            { ch: 'noise', mode: 'white', note: 'C-7', vol: [15, 12, 8, 4, 1] },
            { ch: 'tone', note: 'C-3', vol: [12, 6, 2], bend: -6 }
        ],

        kick: [
            { ch: 'noise', mode: 'white', note: 'G-6', vol: [15, 14, 10, 6, 3, 1] },
            { ch: 'tone', note: 'G-2', vol: [13, 9, 5, 2], bend: -8 }
        ],

        bigHit: [
            { ch: 'noise', mode: 'white', note: 'A-6', vol: [15, 15, 13, 10, 7, 5, 3, 2, 1], prio: 2 },
            { ch: 'tone', note: 'D-3', vol: [14, 12, 9, 6, 3, 1], bend: -10, prio: 2 },
            { ch: 'fm', patch: 'thud', note: 'D-1', vol: [15, 13, 10, 7, 4, 2], prio: 2 }
        ],

        // Whole body, flat on the canvas. The noise swells INTO the hit
        // (vol starts low) so it lands like a crash rather than a tap.
        slam: [
            { ch: 'noise', mode: 'white', note: 'E-6', vol: [8, 13, 15, 15, 14, 12, 10, 8, 6, 4, 3, 2, 1], prio: 2 },
            { ch: 'fm', patch: 'thud', note: 'C-1', vol: [15, 14, 12, 10, 8, 6, 4, 2, 1], step: 2, prio: 2 },
            { ch: 'tone', note: 'C-4', vol: [10, 8, 5, 2], bend: -18, delay: 1, prio: 2 }
        ],

        bodyDrop: [
            { ch: 'noise', mode: 'white', note: 'D-5', vol: [15, 13, 10, 7, 4, 2, 1] },
            { ch: 'fm', patch: 'thud', note: 'A-0', vol: [14, 12, 9, 6, 3, 1], step: 2 }
        ],

        // Irish whip - the rising hiss of somebody being thrown.
        whip: [
            { ch: 'noise', mode: 'white', note: 'C-5', vol: [4, 7, 10, 13, 15, 13, 9, 5, 2], bend: 4.5 }
        ],

        ropeTwang: [
            { ch: 'tone', note: 'E-4', vol: [15, 13, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], bend: -0.9, vib: [0.7, 3] },
            { ch: 'noise', mode: 'periodic', note: 'E-6', vol: [10, 6, 3, 1] }
        ],

        /* ---- ringside ----------------------------------------------- */

        // One strike of the timekeeper's bell. Call it three times for a
        // three-bell ring; it is deliberately one hit.
        bell: [
            { ch: 'fm', patch: 'bellFM', note: 'C-6', vol: [15, 15, 14, 14, 13, 13, 12, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], step: 2, prio: 3 },
            { ch: 'tone', note: 'G-6', vol: [12, 10, 8, 6, 4, 3, 2, 1], step: 2, prio: 3 }
        ],

        // The referee's hand hitting the mat.
        count: [
            { ch: 'tone', note: 'A-5', vol: [15, 14, 12, 9, 5, 2] },
            { ch: 'tone', note: 'E-6', vol: [10, 7, 4, 1], delay: 3 }
        ],

        buzzer: [
            { ch: 'noise', mode: 'periodic', note: 'A-3', vol: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 14, 12, 9, 6, 3, 1], step: 3, prio: 2 },
            { ch: 'tone', note: 'A-3', vol: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 11, 9, 7, 5, 3, 1], step: 3, prio: 2 },
            // A semitone apart on purpose: the beating is the unpleasantness.
            { ch: 'tone', note: 'A#3', vol: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 9, 8, 6, 4, 2, 1], step: 3, prio: 2 }
        ],

        /* ---- crowd (short reactions; the ambient bed is sound.crowd) -- */

        crowdPop: [
            { ch: 'noise', mode: 'white', note: 'G-5', vol: [2, 6, 10, 13, 15, 15, 14, 13, 12, 10, 9, 7, 6, 4, 3, 2, 1], step: 2 }
        ],

        crowdBoo: [
            { ch: 'noise', mode: 'white', note: 'C-4', vol: [2, 5, 8, 11, 13, 14, 14, 13, 13, 12, 11, 10, 9, 8, 6, 5, 4, 3, 2, 1], step: 3 },
            { ch: 'tone', note: 'C-3', vol: [6, 8, 9, 9, 8, 7, 6, 5, 4, 3, 2, 1], bend: -0.45, step: 3 }
        ],

        crowdGasp: [
            { ch: 'noise', mode: 'white', note: 'D-5', vol: [1, 4, 8, 12, 14, 13, 11, 9, 7, 5, 3, 2, 1], bend: 1.2, step: 2 }
        ],

        // Four stamped syllables. The zeroes in the envelope are the gaps.
        chant: [
            { ch: 'noise', mode: 'white', note: 'A-4', vol: [13, 9, 4, 1, 0, 13, 9, 4, 1, 0, 13, 9, 4, 1, 0, 13, 9, 4, 1, 0], step: 3 },
            { ch: 'tone', note: 'A-2', vol: [9, 6, 3, 1, 0, 9, 6, 3, 1, 0, 9, 6, 3, 1, 0, 9, 6, 3, 1, 0], step: 3 }
        ],

        /* ---- gristle ------------------------------------------------- */

        blood: [
            { ch: 'noise', mode: 'periodic', note: 'A-5', vol: [15, 12, 8, 5, 3, 1], bend: -7 },
            { ch: 'tone', note: 'D-5', vol: [10, 7, 4, 2, 1], bend: -9 }
        ],

        // THE LIMB SNAP. Five layers, and every one is doing a job:
        //   1  the crack      periodic noise, bright, over in six frames
        //   2  the splinter   tone screaming downward with jitter on it
        //   3  the wet give   a lower tone doing the same thing slower
        //   4  the grind      periodic noise again, AFTER the crack (delay 7)
        //   5  the drop       low FM thud as the limb lands
        // It is the only sound in the game using four voices at once.
        bone: [
            { ch: 'noise', mode: 'periodic', note: 'C-8', vol: [15, 15, 13, 9, 5, 2], bend: -9, prio: 3 },
            { ch: 'tone', note: 'G-7', vol: [15, 14, 12, 10, 8, 6, 4, 3, 2, 1], bend: -5.5, rand: 1.4, prio: 3 },
            { ch: 'tone', note: 'C-4', vol: [13, 11, 8, 6, 4, 2, 1], bend: -6, prio: 3 },
            { ch: 'noise', mode: 'periodic', note: 'E-4', vol: [12, 13, 11, 9, 7, 5, 4, 3, 2, 1], bend: -1.6, step: 2, delay: 7, prio: 3 },
            { ch: 'fm', patch: 'thud', note: 'D-1', vol: [15, 13, 11, 8, 6, 4, 2, 1], step: 2, delay: 2, prio: 3 }
        ],

        // A TABLE, GONE. Heavy `rand` is the splintering; the second noise
        // layer starts at frame 15, after the first has finished, so the
        // break has a collapse behind the impact.
        tableBreak: [
            { ch: 'fm', patch: 'thud', note: 'C-1', vol: [15, 14, 12, 10, 8, 6, 5, 4, 3, 2, 1], step: 2, prio: 3 },
            { ch: 'noise', mode: 'white', note: 'C-7', vol: [15, 15, 14, 12, 10, 8, 6, 5, 4, 3, 3, 2, 2, 1], rand: 2.5, prio: 3 },
            { ch: 'tone', note: 'A-6', vol: [14, 11, 8, 12, 9, 6, 10, 7, 4, 6, 3, 1], rand: 6, prio: 3 },
            { ch: 'tone', note: 'C-5', vol: [12, 9, 6, 10, 7, 4, 8, 5, 3, 5, 2, 1], bend: -1.2, rand: 4, step: 2, delay: 3, prio: 3 },
            { ch: 'noise', mode: 'white', note: 'E-6', vol: [10, 13, 11, 9, 12, 8, 6, 9, 5, 4, 6, 3, 2, 1], rand: 3, step: 2, delay: 15, prio: 3 }
        ],

        chairShot: [
            { ch: 'noise', mode: 'white', note: 'A-6', vol: [15, 13, 9, 5, 2], prio: 2 },
            { ch: 'fm', patch: 'clang', note: 'A-5', vol: [15, 14, 13, 12, 10, 9, 8, 6, 5, 4, 3, 2, 1], step: 2, prio: 2 },
            { ch: 'tone', note: 'D-6', vol: [12, 10, 8, 6, 4, 2, 1], bend: 0.4, step: 2, prio: 2 }
        ],

        metalClang: [
            { ch: 'fm', patch: 'clang', note: 'E-5', vol: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], step: 2 },
            { ch: 'noise', mode: 'periodic', note: 'C-7', vol: [13, 9, 5, 2] }
        ],

        /* ---- movement ----------------------------------------------- */

        woosh: [
            { ch: 'noise', mode: 'white', note: 'C-4', vol: [2, 5, 8, 11, 13, 12, 10, 8, 6, 4, 2, 1], bend: 2.8 }
        ],

        land: [
            { ch: 'noise', mode: 'white', note: 'C-5', vol: [14, 10, 6, 3, 1] },
            { ch: 'fm', patch: 'thud', note: 'G-0', vol: [13, 10, 7, 4, 2], step: 2 }
        ],

        /* ---- front end ----------------------------------------------- */

        cursor: [
            { ch: 'tone', note: 'C-6', vol: [12, 8, 4, 1] }
        ],

        // Blip that jumps up a fifth halfway through.
        select: [
            { ch: 'tone', note: 'G-5', vol: [13, 13, 11, 8, 5, 2], pitch: [0, 0, 7, 7, 7, 7] }
        ],

        // Rising triad. This is the first thing the player hears, and it is
        // fired from the same keypress that calls sound.init().
        start: [
            { ch: 'tone', note: 'C-5', vol: [14, 13, 12, 14, 13, 12, 15, 14, 13, 11, 9, 7, 5, 3, 1],
              pitch: [0, 0, 0, 4, 4, 4, 7, 7, 7, 7, 7, 7, 7, 7, 7], step: 2, prio: 2 },
            { ch: 'tone', note: 'C-6', vol: [9, 8, 7, 9, 8, 7, 10, 9, 8, 7, 6, 5, 4, 2, 1],
              pitch: [0, 0, 0, 4, 4, 4, 7, 7, 7, 7, 7, 7, 7, 7, 7], step: 2, prio: 2 }
        ],

        pause: [
            { ch: 'tone', note: 'E-5', vol: [13, 11, 9, 13, 11, 8, 5, 2], pitch: [0, 0, 0, -5, -5, -5, -5, -5], step: 2 }
        ],

        /* ---- the big one -------------------------------------------- */

        // Finisher connects. Noise wall + a ringing FM clang + a tone falling
        // through two octaves + a low vibrato groan under it. Nothing else in
        // the game sounds remotely like this.
        finisherHit: [
            { ch: 'noise', mode: 'white', note: 'C-7', vol: [15, 15, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], step: 2, prio: 3 },
            { ch: 'fm', patch: 'clang', note: 'C-4', vol: [15, 15, 14, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], step: 3, prio: 3 },
            { ch: 'tone', note: 'C-7', vol: [15, 14, 13, 12, 11, 10, 9, 8, 6, 5, 4, 3, 2, 1], bend: -3.2, step: 2, prio: 3 },
            { ch: 'tone', note: 'G-3', vol: [14, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], bend: -1.1, vib: [0.9, 2], step: 3, prio: 3 }
        ],

        // Two thumps, the second quieter and lower. Call it on a timer from
        // the game for a pulse; one call is one beat of the heart. Pitched at
        // A-1 rather than the A-0 it wants, because 27 Hz does not survive a
        // laptop speaker and the cue has to be heard to do its job.
        heartbeat: [
            { ch: 'fm', patch: 'thud', note: 'A-1', vol: [15, 13, 10, 7, 4, 2, 1], step: 2 },
            { ch: 'fm', patch: 'thud', note: 'F-1', vol: [13, 11, 8, 5, 3, 1], step: 2, delay: 16 }
        ]
    };

    /* ======================================================================
       4. MUSIC  (tracker data)
       ======================================================================

       A track is:
         bpm        beats per minute
         rpb        rows per beat (4 = sixteenth notes everywhere below)
         loop       true to repeat `order` forever, false for a one-shot
         loopOrder  index in `order` to jump back to (default 0), so a track
                    can have an intro that is not replayed
         chans      the channel strip: which hardware channel, its default
                    instrument, default volume (0-15) and pan (-1..1)
         order      pattern indices, played in sequence
         patterns   each is { len: rows } plus one string per channel name

       Channel names map straight onto hardware: fm0..fm5 are the YM2612's
       six FM channels, psg0..psg2 the SN76489's three squares, noise its one
       noise generator. TRACKS LEAVE fm5 ALONE: it is the effects channel, and
       a track that uses it will be interrupted by the first bone snap.

       CELL GRAMMAR, one token per row, whitespace separated:
         .        nothing (let the previous note ring)
         |        ignored - bar line, purely for reading the table
         =        note off (start the release phase)
         C-4      note on. '-' is the no-accidental placeholder, so C-4, C#4
                  and Db4 are all valid and C-4 is middle C.
         k        an alias from this channel's `map`, which supplies both an
                  instrument and a note. Drums are written this way.
         ...  /9  volume for this note only, 0-15
         ...  :sq  instrument for this note and after
         ~C-4     glide to the note from wherever the channel is now

       A `map` entry is [instrument, note] or [instrument, note, volume].
       ------------------------------------------------------------------ */

    // The two drum maps, shared by most tracks. Kick and toms are FM (they
    // need the pitch envelope); everything with a hiss in it is the one
    // noise channel, which is why the hats and the snare are written as a
    // single interleaved line.
    var KICKMAP  = { k: ['kick', 'C-1'], K: ['kick', 'G-0'], t: ['tom', 'G-2'], T: ['tom', 'C-3'] };
    var NOISEMAP = { s: ['sn', 'C-6'], S: ['sn2', 'A-5'], h: ['hh', 'C-8'],
                     o: ['oh', 'C-8'], c: ['cr', 'G-7'], x: ['cl', 'C-7'] };

    var TRACKS = {

    /* ---------------------------------------------------------------- TITLE
       Heroic, E minor, four-on-the-floor with a brass answer. The one the
       logo drops in on. */
    title: {
        bpm: 150, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'bassSq',  vol: 13, pan: 0 },
            { ch: 'fm1', inst: 'leadSq',  vol: 11, pan: -0.3 },
            { ch: 'fm2', inst: 'brass',   vol: 10, pan: 0.35 },
            { ch: 'fm3', inst: 'stab',    vol: 8,  pan: -0.45 },
            { ch: 'fm4', inst: 'kick',    vol: 14, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn',    vol: 11, pan: 0, map: NOISEMAP },
            { ch: 'psg0', inst: 'pling',  vol: 8,  pan: 0.5 }
        ],
        order: [0, 1, 2, 1, 0, 1, 3, 1],
        patterns: [
            // 0 - groove, no lead
            { len: 16,
              fm0:   'E-2 .   E-2 E-3 | E-2 .   E-2 .   | C-2 .   C-2 C-3 | D-2 .   D-2 .  ',
              fm2:   'E-3 .   .   .   | .   .   .   .   | C-3 .   .   .   | D-3 .   .   .  ',
              fm3:   '.   .   B-3 .   | .   .   B-3 .   | .   .   G-3 .   | .   .   A-3 .  ',
              fm4:   'k   .   .   .   | k   .   .   .   | .   k   .   .   | k   .   .   k  ',
              noise: 'h   .   h   s   | h   .   h   .   | h   s   h   .   | h   .   s   h  ' },
            // 1 - the hook
            { len: 16,
              fm0:   'E-2 .   E-2 E-3 | E-2 .   E-2 .   | C-2 .   C-2 C-3 | D-2 .   D-2 .  ',
              fm1:   'E-4 .   G-4 .   | B-4 .   A-4 .   | G-4 .   E-4 .   | F#4 .   .   =  ',
              fm2:   'E-3 .   .   .   | .   .   .   .   | C-3 .   .   .   | D-3 .   .   .  ',
              fm4:   'k   .   .   .   | k   .   .   .   | .   k   .   .   | k   .   .   k  ',
              noise: 'h   .   h   s   | h   .   h   .   | h   s   h   .   | h   .   s   h  ',
              psg0:  '.   .   .   .   | B-5 .   .   .   | .   .   .   .   | A-5 .   .   .  ' },
            // 2 - lift to the relative major
            { len: 16,
              fm0:   'G-2 .   G-2 G-3 | G-2 .   G-2 .   | A-2 .   A-2 A-3 | B-2 .   B-2 .  ',
              fm1:   'B-4 .   .   D-5 | B-4 .   G-4 .   | A-4 .   .   C-5 | B-4 .   .   =  ',
              fm2:   'G-3 .   .   .   | .   .   .   .   | A-3 .   .   .   | B-3 .   .   .  ',
              fm4:   'k   .   .   k   | .   .   k   .   | k   .   .   k   | .   .   k   .  ',
              noise: 'h   .   s   h   | h   .   h   s   | h   .   s   h   | h   s   h   o  ',
              psg0:  'B-5 .   D-6 .   | .   .   .   .   | C-6 .   E-6 .   | .   .   .   .  ' },
            // 3 - turnaround, the fill
            { len: 16,
              fm0:   'C-2 .   C-2 .   | D-2 .   D-2 .   | E-2 .   E-3 .   | E-2 E-2 E-2 E-2',
              fm1:   'C-5 .   B-4 .   | A-4 .   G-4 .   | F#4 .   E-4 .   | .   .   .   =  ',
              fm2:   'C-3 .   .   .   | D-3 .   .   .   | E-3 .   .   .   | .   .   .   .  ',
              fm4:   'k   .   .   .   | k   .   .   .   | k   .   t   T   | t   T   t   T  ',
              noise: 'h   .   s   .   | h   .   s   .   | S   .   s   s   | S   s   S   c  ' }
        ]
    },

    /* --------------------------------------------------------------- SELECT
       Funky, A minor, slap bass out front. Light enough to sit under a menu
       for a long time. */
    select: {
        bpm: 128, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'bassSlap', vol: 14, pan: 0 },
            { ch: 'fm1', inst: 'lead2',    vol: 9,  pan: -0.35 },
            { ch: 'fm2', inst: 'organ',    vol: 7,  pan: 0.4 },
            { ch: 'fm4', inst: 'kick',     vol: 13, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn',     vol: 10, pan: 0, map: NOISEMAP },
            { ch: 'psg0', inst: 'pling',   vol: 7,  pan: 0.55 }
        ],
        order: [0, 1, 0, 2],
        patterns: [
            { len: 16,
              fm0:   'A-2 .   A-2 .   | E-2 A-2 .   C-3 | .   .   A-2 .   | G-2 .   .   A-2',
              fm2:   'A-3 .   .   .   | .   .   .   .   | .   .   .   .   | G-3 .   .   .  ',
              fm4:   'k   .   .   .   | .   .   k   .   | k   .   .   .   | .   k   .   .  ',
              noise: 'h   .   h   s   | h   .   h   .   | h   .   s   h   | h   .   s   .  ',
              psg0:  '.   .   E-5 .   | .   .   .   A-5 | .   .   .   .   | .   .   G-5 .  ' },
            { len: 16,
              fm0:   'A-2 .   A-2 .   | E-2 A-2 .   C-3 | .   .   A-2 .   | G-2 .   .   A-2',
              fm1:   'A-4 .   C-5 .   | E-5 .   D-5 C-5 | A-4 .   .   .   | G-4 .   A-4 =  ',
              fm2:   'A-3 .   .   .   | .   .   .   .   | .   .   .   .   | G-3 .   .   .  ',
              fm4:   'k   .   .   .   | .   .   k   .   | k   .   .   .   | .   k   .   .  ',
              noise: 'h   .   h   s   | h   .   h   .   | h   .   s   h   | h   .   s   o  ' },
            { len: 16,
              fm0:   'F-2 .   F-2 .   | C-3 F-2 .   A-2 | D-2 .   D-2 .   | E-2 .   E-3 E-2',
              fm1:   'F-4 .   A-4 .   | C-5 .   .   .   | D-5 .   C-5 .   | B-4 .   .   =  ',
              fm2:   'F-3 .   .   .   | .   .   .   .   | D-3 .   .   .   | E-3 .   .   .  ',
              fm4:   'k   .   .   .   | .   .   k   .   | k   .   .   k   | .   .   k   .  ',
              noise: 'h   .   h   s   | h   .   h   .   | h   s   h   .   | s   .   s   c  ',
              psg0:  'A-5 .   .   .   | C-6 .   .   .   | .   .   .   .   | B-5 .   .   .  ' }
        ]
    },

    /* ------------------------------------------------------------------- VS
       Eight bars of standoff. Slow, timpani, brass stabs, a tritone sitting
       in the middle of it. Loops, but it is meant to play once or twice. */
    vs: {
        bpm: 104, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'timpani', vol: 15, pan: 0, map: { d: ['timpani', 'D-1'], a: ['timpani', 'A-1'] } },
            { ch: 'fm1', inst: 'fanfare', vol: 11, pan: -0.4 },
            { ch: 'fm2', inst: 'brass',   vol: 10, pan: 0.4 },
            { ch: 'fm3', inst: 'pad',     vol: 8,  pan: 0 },
            { ch: 'noise', inst: 'cr',    vol: 11, pan: 0, map: NOISEMAP }
        ],
        order: [0, 1],
        patterns: [
            { len: 16,
              fm0:   'd   .   .   .   | .   .   d   d   | a   .   .   .   | .   .   d   .  ',
              fm1:   'D-4 .   .   .   | =   .   .   .   | A-4 .   .   .   | =   .   .   .  ',
              fm2:   'A-3 .   .   .   | =   .   .   .   | E-4 .   .   .   | =   .   .   .  ',
              fm3:   'D-2 .   .   .   | .   .   .   .   | .   .   .   .   | .   .   .   .  ',
              noise: 'c   .   .   .   | .   .   .   .   | .   .   .   .   | .   .   s   S  ' },
            { len: 16,
              fm0:   'd   .   d   .   | .   .   a   .   | d   .   .   d   | d   d   d   d  ',
              // The G#/A# over a D pedal is the tritone. It is supposed to
              // feel wrong; the bell is about to ring.
              fm1:   'G#4 .   .   .   | A-4 .   .   .   | A#4 .   .   .   | A-4 .   .   =  ',
              fm2:   'D-4 .   .   .   | .   .   .   .   | F-4 .   .   .   | E-4 .   .   =  ',
              fm3:   'D-2 .   .   .   | .   .   .   .   | .   .   .   .   | .   .   .   .  ',
              noise: '.   .   s   .   | .   .   s   .   | .   .   s   s   | S   s   S   c  ' }
        ]
    },

    /* ---------------------------------------------------------------- MATCH
       The main theme. D minor, 152, square lead over a slap-bass riff. Eight
       patterns of order so the loop takes a while to come round. */
    match: {
        bpm: 152, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'bassSlap', vol: 14, pan: 0 },
            { ch: 'fm1', inst: 'leadSq',   vol: 11, pan: -0.3 },
            { ch: 'fm2', inst: 'brass',    vol: 9,  pan: 0.35 },
            { ch: 'fm3', inst: 'stab',     vol: 8,  pan: -0.45 },
            { ch: 'fm4', inst: 'kick',     vol: 14, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn',     vol: 11, pan: 0, map: NOISEMAP },
            { ch: 'psg0', inst: 'pling',   vol: 7,  pan: 0.5 }
        ],
        order: [0, 1, 0, 2, 0, 1, 3, 2],
        patterns: [
            // 0 - the riff
            { len: 16,
              fm0:   'D-2 .   D-3 D-2 | D-2 .   D-3 .   | F-2 .   F-3 F-2 | C-3 .   C-2 .  ',
              fm3:   '.   .   A-3 .   | .   .   A-3 .   | .   .   C-4 .   | .   .   G-3 .  ',
              fm4:   'k   .   .   .   | .   .   k   .   | k   .   .   .   | .   .   k   .  ',
              noise: 'h   .   h   .   | s   .   h   .   | h   .   h   .   | s   .   h   h  ' },
            // 1 - riff plus lead
            { len: 16,
              fm0:   'D-2 .   D-3 D-2 | D-2 .   D-3 .   | F-2 .   F-3 F-2 | C-3 .   C-2 .  ',
              fm1:   'D-4 .   F-4 .   | G-4 .   A-4 .   | .   C-5 .   A-4 | G-4 .   F-4 =  ',
              fm2:   'D-3 .   .   .   | .   .   .   .   | F-3 .   .   .   | C-3 .   .   .  ',
              fm4:   'k   .   .   .   | .   .   k   .   | k   .   .   .   | .   .   k   .  ',
              noise: 'h   .   h   .   | s   .   h   .   | h   .   h   .   | s   .   h   o  ' },
            // 2 - the B section, up to Bb
            { len: 16,
              fm0:   'A#2 .   A#3 A#2 | A#2 .   A#3 .   | A-2 .   A-3 A-2 | A-2 .   A-3 .  ',
              fm1:   'A#4 .   .   D-5 | A#4 .   F-4 .   | A-4 .   .   C-5 | A-4 .   E-4 =  ',
              fm2:   'A#3 .   .   .   | .   .   .   .   | A-3 .   .   .   | .   .   .   .  ',
              fm4:   'k   .   .   k   | .   .   k   .   | k   .   .   k   | .   .   k   .  ',
              noise: 'h   .   s   h   | h   .   h   s   | h   .   s   h   | h   s   h   o  ',
              psg0:  'D-6 .   .   .   | A#5 .   .   .   | C-6 .   .   .   | A-5 .   .   .  ' },
            // 3 - the fill, straight into the top of the order
            { len: 16,
              fm0:   'D-2 D-2 D-2 D-2 | F-2 F-2 F-2 F-2 | G-2 .   G-2 .   | A-2 .   A-3 A-2',
              fm1:   'D-5 .   C-5 .   | A#4 .   A-4 .   | G-4 .   F-4 .   | E-4 .   .   =  ',
              fm3:   'D-4 .   .   .   | F-4 .   .   .   | G-4 .   .   .   | A-4 .   .   .  ',
              fm4:   'k   .   k   .   | k   .   k   .   | t   T   t   T   | k   .   k   k  ',
              noise: 's   .   s   .   | s   .   s   .   | S   s   S   s   | S   s   S   c  ' }
        ]
    },

    /* ----------------------------------------------------------- MATCHTENSE
       The same material at 180 with the chromatic bass walked up, for the
       closing minutes. Swap to it with sound.music('matchTense'); it is a
       different track rather than a tempo change so the transition lands on
       a downbeat of its own. */
    matchTense: {
        bpm: 180, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'bassSlap', vol: 15, pan: 0 },
            { ch: 'fm1', inst: 'leadSq',   vol: 12, pan: -0.3 },
            { ch: 'fm2', inst: 'brass',    vol: 10, pan: 0.35 },
            { ch: 'fm3', inst: 'stab',     vol: 9,  pan: -0.45 },
            { ch: 'fm4', inst: 'kick',     vol: 15, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn',     vol: 12, pan: 0, map: NOISEMAP },
            { ch: 'psg0', inst: 'pling',   vol: 8,  pan: 0.5 }
        ],
        order: [0, 1, 0, 2],
        patterns: [
            { len: 16,
              fm0:   'D-2 D-2 D#2 D#2 | E-2 E-2 F-2 F-2 | D-2 D-2 D#2 D#2 | E-2 .   A-2 .  ',
              fm1:   'D-5 .   .   .   | E-5 .   .   .   | F-5 .   E-5 .   | D-5 .   .   =  ',
              fm3:   'A-3 .   A-3 .   | A-3 .   A-3 .   | A-3 .   A-3 .   | A-3 A-3 A-3 A-3',
              fm4:   'k   .   k   .   | k   .   k   .   | k   .   k   .   | k   .   k   k  ',
              noise: 'h   s   h   s   | h   s   h   s   | h   s   h   s   | S   s   S   s  ',
              psg0:  'D-6 .   .   .   | E-6 .   .   .   | F-6 .   .   .   | E-6 .   .   .  ' },
            { len: 16,
              fm0:   'F-2 F-2 F#2 F#2 | G-2 G-2 G#2 G#2 | A-2 A-2 A-2 A-2 | A-2 A#2 A-2 G-2',
              fm1:   'F-5 .   G-5 .   | A-5 .   .   G-5 | F-5 .   E-5 .   | D-5 .   .   =  ',
              fm2:   'F-3 .   .   .   | G-3 .   .   .   | A-3 .   .   .   | .   .   .   .  ',
              fm4:   'k   .   k   .   | k   .   k   .   | k   .   k   .   | k   k   k   k  ',
              noise: 'h   s   h   s   | h   s   h   s   | h   s   h   s   | S   s   S   c  ' },
            { len: 16,
              fm0:   'D-2 .   A-2 .   | D-3 .   A-2 .   | C-3 .   G-2 .   | A#2 .   F-2 .  ',
              fm1:   'A-5 .   F-5 .   | D-5 .   A-4 .   | A#4 .   C-5 .   | D-5 .   .   =  ',
              fm3:   'D-4 .   .   .   | A-4 .   .   .   | C-5 .   .   .   | A#4 .   .   .  ',
              fm4:   'k   k   .   k   | k   .   k   .   | k   k   .   k   | k   .   k   k  ',
              noise: 'S   s   h   s   | S   s   h   s   | S   s   h   s   | S   s   S   c  ' }
        ]
    },

    /* ------------------------------------------------------- ENTRANCE 1 (heroic)
       G major, brass fanfare over a marching bass. Short, loops cleanly. */
    entrance1: {
        bpm: 124, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'bassSq',  vol: 14, pan: 0 },
            { ch: 'fm1', inst: 'fanfare', vol: 12, pan: -0.3 },
            { ch: 'fm2', inst: 'brass',   vol: 10, pan: 0.35 },
            { ch: 'fm4', inst: 'kick',    vol: 14, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn',    vol: 12, pan: 0, map: NOISEMAP }
        ],
        order: [0, 1],
        patterns: [
            { len: 16,
              fm0:   'G-2 .   G-2 .   | D-3 .   G-2 .   | C-3 .   C-3 .   | D-3 .   D-3 .  ',
              fm1:   'G-4 .   B-4 .   | D-5 .   .   .   | .   .   G-4 .   | A-4 .   B-4 =  ',
              fm2:   'D-4 .   .   .   | G-4 .   .   .   | E-4 .   .   .   | F#4 .   .   .  ',
              fm4:   'k   .   .   .   | k   .   .   .   | k   .   .   .   | k   .   k   .  ',
              noise: 'S   .   s   s   | S   .   s   s   | S   .   s   s   | S   s   S   s  ' },
            { len: 16,
              fm0:   'G-2 .   G-2 .   | B-2 .   D-3 .   | G-2 .   G-2 .   | G-2 D-2 G-1 .  ',
              fm1:   'D-5 .   .   B-4 | G-5 .   .   .   | D-5 .   B-4 .   | G-4 .   .   =  ',
              fm2:   'B-4 .   .   G-4 | D-5 .   .   .   | B-4 .   G-4 .   | D-4 .   .   .  ',
              fm4:   'k   .   .   .   | k   .   .   .   | k   .   k   .   | k   .   k   k  ',
              noise: 'S   .   s   s   | S   .   s   s   | S   s   S   s   | S   s   S   c  ' }
        ]
    },

    /* ------------------------------------------------- ENTRANCE 2 (sinister)
       96 BPM, F minor, a low pedal with the dark organ crawling over it and a
       periodic-noise tick keeping time like a clock. */
    entrance2: {
        bpm: 96, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'heavy',    vol: 13, pan: 0 },
            { ch: 'fm1', inst: 'sinister', vol: 11, pan: -0.4 },
            { ch: 'fm2', inst: 'sinister', vol: 9,  pan: 0.45 },
            { ch: 'fm3', inst: 'pad',      vol: 8,  pan: 0 },
            { ch: 'noise', inst: 'cl',     vol: 8,  pan: 0, map: NOISEMAP }
        ],
        order: [0, 1, 0, 2],
        patterns: [
            { len: 16,
              fm0:   'F-1 .   .   .   | .   .   .   F-1 | .   .   .   .   | C-2 .   .   .  ',
              fm1:   'F-3 .   .   .   | .   .   .   .   | A#3 .   .   .   | .   .   .   =  ',
              fm3:   'F-2 .   .   .   | .   .   .   .   | .   .   .   .   | .   .   .   .  ',
              noise: 'x   .   .   .   | x   .   .   .   | x   .   .   .   | x   .   .   x  ' },
            { len: 16,
              // ~ glides. A pitch that will not sit still is the whole idea.
              fm0:   'F-1 .   .   .   | .   .   .   F-1 | .   .   .   .   | B-1 .   .   .  ',
              fm1:   'C-4 .   .   .   | ~B-3 .  .   .   | ~A#3 .  .   .   | ~A-3 .  .   =  ',
              fm2:   'F-4 .   .   .   | .   .   .   .   | E-4 .   .   .   | .   .   .   =  ',
              fm3:   'F-2 .   .   .   | .   .   .   .   | .   .   .   .   | .   .   .   .  ',
              noise: 'x   .   .   .   | x   .   .   .   | x   .   x   .   | x   .   x   x  ' },
            { len: 16,
              fm0:   'D#1 .   .   .   | .   .   .   D#1 | .   .   .   .   | C-2 .   .   C-2',
              fm1:   'F#3 .   .   .   | .   .   .   .   | G-3 .   .   .   | .   .   .   =  ',
              fm2:   'C-4 .   .   .   | .   .   .   .   | B-3 .   .   .   | .   .   .   =  ',
              fm3:   'D#2 .   .   .   | .   .   .   .   | .   .   .   .   | .   .   .   .  ',
              noise: 'x   .   x   .   | x   .   x   .   | x   .   x   .   | x   x   x   x  ' }
        ]
    },

    /* --------------------------------------------------- ENTRANCE 3 (goofy)
       F major oom-pah at 142 with a whistle on top and a rubber-band bass.
       Nobody takes this wrestler seriously and the music agrees. */
    entrance3: {
        bpm: 142, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'goofy',   vol: 14, pan: 0 },
            { ch: 'fm1', inst: 'whistle', vol: 12, pan: -0.35 },
            { ch: 'fm2', inst: 'pluck',   vol: 9,  pan: 0.45 },
            { ch: 'fm4', inst: 'kick',    vol: 13, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn',    vol: 10, pan: 0, map: NOISEMAP },
            { ch: 'psg0', inst: 'boing',  vol: 9,  pan: 0.6 }
        ],
        order: [0, 1, 0, 2],
        patterns: [
            { len: 16,
              fm0:   'F-2 .   C-3 .   | F-2 .   C-3 .   | C-2 .   G-2 .   | C-2 .   G-2 .  ',
              fm1:   'F-5 .   A-5 .   | C-6 .   A-5 .   | G-5 .   .   E-5 | G-5 .   .   =  ',
              fm2:   '.   A-4 .   C-5 | .   A-4 .   C-5 | .   G-4 .   B-4 | .   G-4 .   B-4',
              fm4:   'k   .   .   .   | k   .   .   .   | k   .   .   .   | k   .   .   .  ',
              noise: '.   .   s   .   | .   .   s   .   | .   .   s   .   | .   .   s   o  ' },
            { len: 16,
              fm0:   'F-2 .   C-3 .   | A-2 .   C-3 .   | B#2 .   G-2 .   | C-2 .   G-2 .  ',
              fm1:   'A-5 F-5 A-5 C-6 | D-6 .   C-6 A-5 | F-5 .   G-5 .   | F-5 .   .   =  ',
              fm2:   '.   A-4 .   C-5 | .   A-4 .   C-5 | .   G-4 .   B-4 | .   G-4 .   B-4',
              fm4:   'k   .   .   .   | k   .   .   k   | k   .   .   .   | k   .   k   .  ',
              noise: '.   .   s   .   | .   .   s   .   | .   .   s   .   | s   .   s   o  ',
              psg0:  '.   .   .   .   | .   .   .   .   | .   .   .   .   | C-6 .   .   .  ' },
            { len: 16,
              fm0:   'A#2 .   F-3 .   | A#2 .   F-3 .   | C-3 .   G-3 .   | F-2 .   C-3 .  ',
              fm1:   'A#5 .   D-6 .   | F-6 .   D-6 A#5 | C-6 .   A-5 .   | F-5 .   .   =  ',
              fm2:   '.   D-5 .   F-5 | .   D-5 .   F-5 | .   C-5 .   E-5 | .   A-4 .   C-5',
              fm4:   'k   .   .   .   | k   .   .   .   | k   .   .   k   | k   .   .   .  ',
              noise: '.   .   s   .   | .   .   s   o   | .   .   s   .   | s   s   s   c  ',
              psg0:  'A#5 .   .   .   | .   .   .   .   | C-6 .   .   .   | .   .   .   .  ' }
        ]
    },

    /* --------------------------------------------------- ENTRANCE 4 (heavy)
       84 BPM, E minor, the sludge bass on power fifths with half-time drums.
       Everything is slow and everything hurts. */
    entrance4: {
        bpm: 84, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'heavy',  vol: 15, pan: 0 },
            { ch: 'fm1', inst: 'heavy',  vol: 11, pan: -0.45 },
            { ch: 'fm2', inst: 'leadSq', vol: 9,  pan: 0.4 },
            { ch: 'fm4', inst: 'kick',   vol: 15, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn2',  vol: 13, pan: 0, map: NOISEMAP }
        ],
        order: [0, 0, 1, 2],
        patterns: [
            { len: 16,
              fm0:   'E-1 .   .   E-1 | .   .   E-1 .   | E-1 .   .   .   | G-1 .   A#1 .  ',
              fm1:   'B-1 .   .   B-1 | .   .   B-1 .   | B-1 .   .   .   | D-2 .   F-2 .  ',
              fm4:   'K   .   .   K   | .   .   K   .   | K   .   .   .   | K   .   K   .  ',
              noise: '.   .   .   .   | S   .   .   .   | .   .   .   .   | S   .   .   S  ' },
            { len: 16,
              fm0:   'C-2 .   .   C-2 | .   .   C-2 .   | A#1 .   .   .   | A#1 A#1 A#1 .  ',
              fm1:   'G-2 .   .   G-2 | .   .   G-2 .   | F-2 .   .   .   | F-2 F-2 F-2 .  ',
              fm2:   'E-4 .   .   .   | .   .   .   .   | D-4 .   .   .   | .   .   .   =  ',
              fm4:   'K   .   .   K   | .   .   K   .   | K   .   .   .   | K   K   K   .  ',
              noise: '.   .   .   .   | S   .   .   .   | .   .   .   .   | S   s   S   .  ' },
            { len: 16,
              fm0:   'E-1 E-1 .   E-1 | E-1 .   E-1 .   | G-1 .   G-1 .   | A#1 .   B-1 .  ',
              fm1:   'B-1 B-1 .   B-1 | B-1 .   B-1 .   | D-2 .   D-2 .   | F-2 .   F#2 .  ',
              fm2:   'B-4 .   .   .   | .   .   .   .   | A#4 .   .   .   | B-4 .   .   =  ',
              fm4:   'K   K   .   K   | K   .   K   .   | K   .   K   .   | K   .   K   K  ',
              noise: '.   .   S   .   | .   .   .   S   | .   .   S   .   | S   s   S   c  ' }
        ]
    },

    /* -------------------------------------------------------------- VICTORY
       C major, bells and brass, loops so it can sit under a results screen. */
    victory: {
        bpm: 136, rpb: 4, loop: true, loopOrder: 1,
        chans: [
            { ch: 'fm0', inst: 'bassSq',  vol: 13, pan: 0 },
            { ch: 'fm1', inst: 'fanfare', vol: 12, pan: -0.3 },
            { ch: 'fm2', inst: 'bellFM',  vol: 10, pan: 0.4 },
            { ch: 'fm3', inst: 'brass',   vol: 9,  pan: -0.5 },
            { ch: 'fm4', inst: 'kick',    vol: 14, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'sn',    vol: 12, pan: 0, map: NOISEMAP }
        ],
        // Pattern 0 is the hit at the top and is not replayed: loopOrder 1.
        order: [0, 1, 2],
        patterns: [
            { len: 16,
              fm0:   'C-2 .   .   .   | .   .   .   .   | G-1 .   .   .   | C-2 .   .   .  ',
              fm1:   'C-5 .   E-5 .   | G-5 .   .   .   | .   .   .   .   | C-5 .   .   .  ',
              fm2:   'C-6 .   .   .   | .   .   .   .   | G-5 .   .   .   | C-6 .   .   .  ',
              fm4:   'k   .   .   .   | .   .   .   .   | k   .   .   .   | k   .   t   T  ',
              noise: 'c   .   .   .   | .   .   .   .   | S   .   .   .   | S   s   S   s  ' },
            { len: 16,
              fm0:   'C-2 .   C-2 .   | G-2 .   C-2 .   | F-2 .   F-2 .   | G-2 .   G-2 .  ',
              fm1:   'G-5 .   E-5 .   | C-5 .   E-5 .   | F-5 .   A-5 .   | G-5 .   .   =  ',
              fm2:   'C-6 .   .   .   | .   .   .   .   | A-5 .   .   .   | B-5 .   .   .  ',
              fm3:   'E-4 .   .   .   | G-4 .   .   .   | A-4 .   .   .   | B-4 .   .   .  ',
              fm4:   'k   .   .   .   | k   .   .   .   | k   .   .   .   | k   .   k   .  ',
              noise: 'S   .   s   s   | S   .   s   s   | S   .   s   s   | S   s   S   s  ' },
            { len: 16,
              fm0:   'A-2 .   A-2 .   | F-2 .   F-2 .   | G-2 .   G-2 .   | C-2 .   C-3 C-2',
              fm1:   'A-5 .   .   C-6 | A-5 .   F-5 .   | G-5 .   B-5 .   | C-6 .   .   =  ',
              fm2:   'E-6 .   .   .   | .   .   .   .   | D-6 .   .   .   | C-6 .   .   .  ',
              fm3:   'C-5 .   .   .   | A-4 .   .   .   | B-4 .   .   .   | G-4 .   .   .  ',
              fm4:   'k   .   .   .   | k   .   .   .   | k   .   k   .   | k   .   k   k  ',
              noise: 'S   .   s   s   | S   .   s   s   | S   s   S   s   | S   s   S   c  ' }
        ]
    },

    /* ------------------------------------------------------------- FINISHER
       ONE SHOT. About a second and a half of chromatic descent onto a tonic
       hit. loop:false, so the sequencer releases everything and stops rather
       than wrapping; the match music has to be restarted afterwards. */
    finisher: {
        bpm: 150, rpb: 4, loop: false,
        chans: [
            { ch: 'fm0', inst: 'heavy',   vol: 15, pan: 0 },
            { ch: 'fm1', inst: 'stab',    vol: 13, pan: -0.3 },
            { ch: 'fm2', inst: 'clang',   vol: 11, pan: 0.4 },
            { ch: 'fm4', inst: 'kick',    vol: 15, pan: 0, map: KICKMAP },
            { ch: 'noise', inst: 'cr',    vol: 13, pan: 0, map: NOISEMAP }
        ],
        order: [0],
        patterns: [
            { len: 16,
              fm0:   'C-3 B-2 A#2 A-2 | G#2 G-2 F#2 F-2 | E-2 D#2 D-2 C#2 | C-2 .   .   .  ',
              fm1:   'C-5 B-4 A#4 A-4 | G#4 G-4 F#4 F-4 | E-4 D#4 D-4 C#4 | C-4 .   .   .  ',
              fm2:   '.   .   .   .   | .   .   .   .   | .   .   .   .   | C-5 .   .   .  ',
              fm4:   'k   .   k   .   | k   .   k   .   | k   k   k   k   | k   .   .   .  ',
              noise: 's   .   s   .   | s   .   s   .   | S   s   S   s   | c   .   .   .  ' }
        ]
    },

    /* ------------------------------------------------------------- GAMEOVER
       A minor, 78 BPM, defeated. Loops, quietly, as long as you leave it. */
    gameover: {
        bpm: 78, rpb: 4, loop: true,
        chans: [
            { ch: 'fm0', inst: 'bassSq',   vol: 11, pan: 0 },
            { ch: 'fm1', inst: 'sinister', vol: 9,  pan: -0.35 },
            { ch: 'fm2', inst: 'pad',      vol: 8,  pan: 0.4 },
            { ch: 'fm4', inst: 'tom',      vol: 10, pan: 0, map: KICKMAP },
            { ch: 'psg0', inst: 'tick',    vol: 6,  pan: 0.55 }
        ],
        order: [0, 1],
        patterns: [
            { len: 16,
              fm0:   'A-2 .   .   .   | .   .   .   .   | E-2 .   .   .   | .   .   .   .  ',
              fm1:   'A-4 .   .   .   | G-4 .   .   .   | F-4 .   .   .   | E-4 .   .   =  ',
              fm2:   'A-3 .   .   .   | .   .   .   .   | C-4 .   .   .   | .   .   .   .  ',
              fm4:   'T   .   .   .   | .   .   .   .   | t   .   .   .   | .   .   .   .  ' },
            { len: 16,
              fm0:   'F-2 .   .   .   | .   .   .   .   | D-2 .   .   .   | E-2 .   .   .  ',
              fm1:   'D-4 .   .   .   | C-4 .   .   .   | B-3 .   .   .   | A-3 .   .   =  ',
              fm2:   'F-3 .   .   .   | .   .   .   .   | D-4 .   .   .   | E-4 .   .   .  ',
              fm4:   'T   .   .   .   | .   .   .   .   | t   .   .   t   | .   .   .   .  ',
              psg0:  '.   .   .   .   | .   .   .   .   | .   .   .   .   | A-5 .   E-5 .  ' }
        ]
    }

    };

    /* ======================================================================
       5. THE DSP CORE
       ======================================================================

       Everything below runs per sample. It is ONE function on purpose: the
       worklet source is built from GenesisCore.toString(), so this function
       must not reference anything in the enclosing closure — only globals
       (Math, typed arrays) and its own internals. The ScriptProcessor
       fallback calls the very same function object directly, with no eval at
       all, which is why there is only one copy of the synth in this file.

       Interface:
         var core = new GenesisCore(contextSampleRate);
         core.command({ t: 'bank', ... });     // see the compiler, section 7
         core.render(floatL, floatR, nFrames);
       ------------------------------------------------------------------ */

    function GenesisCore(outRate) {
        'use strict';

        /* ---- hardware rates ----------------------------------------- */

        // YM2612 on an NTSC Genesis: 53693175/7 master, divided by 144.
        var FM_RATE = 53267;
        // SN76489: 3579545 clock, internal divide by 16. A tone channel with
        // divider n flips every n of these ticks, so f = clock/(32n).
        var PSG_TICK = 223721.5625;
        var PSG_PER_FM = PSG_TICK / FM_RATE;          // ~4.201

        var PHASE_ONE = 1048576;                      // 2^20 = one sine cycle
        var MOD_SHIFT = 7;                            // 8192 << 7 = one cycle
        var OUT_MAX = 8191, OUT_MIN = -8192;          // 14-bit channel clip
        var EG_EVERY = 3;                             // EG runs at FM_RATE/3
        var EG_RATE = FM_RATE / EG_EVERY;
        var FRAME_SAMPLES = FM_RATE / 60;             // one game frame
        var GLIDE_K = 0.0012;                         // per EG tick

        // Mix trims. The FM bus is summed as if three and a half channels at
        // full scale filled the output, which six channels of music plus an
        // effect can beat — and when they do it clips, which is the sound of
        // this chip being driven hard. Scaling for the worst case instead
        // would be quieter AND cleaner, i.e. wrong twice.
        var FM_SCALE = 1 / (8192 * 3.5);
        var PSG_SCALE = 0.22;
        var CROWD_SCALE = 0.5;
        // Channel 5 is the effects channel. A driver always mixed it hot so a
        // hit cut through the music; one FM channel against a PSG noise burst
        // otherwise disappears.
        var FM_SFX_BOOST = 1.7;

        var rsStep = FM_RATE / (outRate > 0 ? outRate : 44100);

        /* ---- the OPN2 datapath tables ------------------------------- */
        // Attenuation is in units of 1/256 of a log2, i.e. 256 units is 6 dB.
        // A 7-bit total level steps 0.75 dB, which is 32 of these units, and
        // a 10-bit envelope steps 4 of them: 1023 << 2 is the chip's 96 dB.

        var i, k, r;
        var logSin = new Int32Array(256);             // quarter sine, in att
        for (i = 0; i < 256; i++) {
            var sv = Math.sin((i + 0.5) * Math.PI / 512);
            var lv = Math.round(-Math.log(sv) / Math.LN2 * 256);
            logSin[i] = lv > 4095 ? 4095 : lv;
        }
        var expTab = new Int32Array(256);             // 2^-x, 13-bit output
        for (i = 0; i < 256; i++) expTab[i] = Math.round(8192 * Math.pow(2, -i / 256));

        // Envelope rate tables. A rate picks a shift (how many EG ticks
        // between steps) and an increment pattern; the four patterns are what
        // give the chip its non-uniform low rates.
        var EG_SHIFT = new Int32Array(64);
        var EG_INC = new Int32Array(64 * 8);
        var EG_PAT = [[0, 1, 0, 1, 0, 1, 0, 1], [0, 1, 1, 1, 0, 1, 1, 1],
                      [0, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1]];
        for (r = 0; r < 64; r++) {
            var sh = 11 - (r >> 2), mu = 1;
            if (sh < 0) { mu = 1 << (-sh); sh = 0; }
            EG_SHIFT[r] = sh;
            for (k = 0; k < 8; k++) EG_INC[r * 8 + k] = EG_PAT[r & 3][k] * mu;
        }

        // Note table, and the 5-bit key code the rate scaling reads.
        var noteHz = new Float64Array(128);
        var keyCode = new Int32Array(128);
        for (i = 0; i < 128; i++) {
            noteHz[i] = 440 * Math.pow(2, (i - 69) / 12);
            var blk = Math.floor(i / 12) - 1;
            if (blk < 0) blk = 0; else if (blk > 7) blk = 7;
            var sem = i % 12;
            keyCode[i] = blk * 4 + (sem >= 9 ? 3 : sem >= 6 ? 2 : sem >= 3 ? 1 : 0);
        }

        // Tracker volume 0-15 to attenuation units, and PSG 0-15 to a linear
        // amplitude on the chip's 2 dB ladder.
        var VOL_ATT = new Int32Array(16);
        for (i = 0; i < 16; i++) {
            VOL_ATT[i] = i <= 0 ? 4096 : Math.round(-Math.log(i / 15) / Math.LN2 * 256);
        }
        var PSG_AMP = new Float64Array(16);
        for (i = 0; i < 16; i++) PSG_AMP[i] = i <= 0 ? 0 : Math.pow(10, -2 * (15 - i) / 20);

        var MULT = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        // Detune, 0-3 sharp and 4-7 flat, about 3.5 cents a step.
        var DETUNE = [1, 1.00202, 1.00405, 1.00608, 1, 0.99798, 0.99597, 0.99396];

        /* ---- FM state ----------------------------------------------- */

        var NCH = 6, NOP = 24;
        var phase = new Int32Array(NOP), pinc = new Int32Array(NOP);
        var env = new Int32Array(NOP), est = new Uint8Array(NOP);
        var oMul = new Float64Array(NOP), oDet = new Float64Array(NOP);
        var oTL = new Int32Array(NOP);
        var oAR = new Int32Array(NOP), oD1 = new Int32Array(NOP);
        var oD2 = new Int32Array(NOP), oRR = new Int32Array(NOP);
        var oSL = new Int32Array(NOP), oKS = new Int32Array(NOP);
        var oKSV = new Int32Array(NOP);
        var chAlg = new Int32Array(NCH), chFb = new Int32Array(NCH);
        var chAtt = new Int32Array(NCH), chExtra = new Int32Array(NCH);
        var chFreq = new Float64Array(NCH), chNote = new Int32Array(NCH);
        var chGlide = new Uint8Array(NCH), chGlideTo = new Float64Array(NCH);
        var chPegAmt = new Float64Array(NCH), chPegK = new Float64Array(NCH);
        var chPegVal = new Float64Array(NCH), chPegMul = new Float64Array(NCH);
        var chPL = new Float64Array(NCH), chPR = new Float64Array(NCH);
        var chMixL = new Float64Array(NCH), chMixR = new Float64Array(NCH);
        var fbP1 = new Int32Array(NCH), fbP2 = new Int32Array(NCH);
        for (i = 0; i < NCH; i++) {
            chFreq[i] = 440; chPegMul[i] = 1; chPL[i] = 1; chPR[i] = 1;
        }
        for (i = 0; i < NOP; i++) { oMul[i] = 1; oDet[i] = 1; env[i] = 1023; oTL[i] = 127; }

        /* ---- PSG state ---------------------------------------------- */

        var tPer = new Int32Array(3), tCnt = new Float64Array(3);
        var tOut = new Int32Array(3), tAmp = new Float64Array(3);
        var tPL = new Float64Array(3), tPR = new Float64Array(3);
        var tVL = new Float64Array(3), tVR = new Float64Array(3);
        for (i = 0; i < 3; i++) { tPer[i] = 100; tCnt[i] = 100; tOut[i] = 1; tPL[i] = 1; tPR[i] = 1; }
        var nPer = 64, nCnt = 64, nOut = 1, nMode = 0, nAmp = 0, nLfsr = 0x8000;
        var nPL = 1, nPR = 1, nVL = 0, nVR = 0;
        var psgAcc = 0;

        /* ---- volumes ------------------------------------------------ */

        var musV = 0.7, sfxV = 0.9;
        var crowdTarget = 0, crowdLev = 0;

        /* ---- voices: one per hardware resource ---------------------- *
         * 0,1,2  PSG tone     3  PSG noise     4  FM channel 5          */

        var NRES = 5;
        var vLive = new Uint8Array(NRES), vSrc = new Uint8Array(NRES);
        var vPrio = new Int32Array(NRES), vStep = new Int32Array(NRES);
        var vFa = new Int32Array(NRES), vS = new Int32Array(NRES);
        var vHz = new Float64Array(NRES), vMul = new Float64Array(NRES);
        var vScale = new Float64Array(NRES), vPan = new Float64Array(NRES);
        var vInst = [null, null, null, null, null];

        // Layers waiting on their `delay`. A sound with two noise bursts
        // needs this: the second one cannot hold the noise channel while the
        // first is still using it.
        var PEND = 16;
        var pLive = new Uint8Array(PEND), pDelay = new Int32Array(PEND);
        var pMul = new Float64Array(PEND), pScale = new Float64Array(PEND);
        var pPan = new Float64Array(PEND), pPrio = new Int32Array(PEND);
        var pInst = new Array(PEND);

        /* ---- bank + sequencer --------------------------------------- */

        var bPatch = [], bPsg = [], bSfx = null, bTrack = null;
        var sqOn = 0, sqT = null, sqOrd = 0, sqRow = 0, sqAcc = 0, sqSpr = 1000;
        var frameAcc = 0, egAcc = 0, egCnt = 0;

        /* ---- crowd bed ---------------------------------------------- */
        // Filtered noise, two decorrelated sides, with a slow murmur on top.
        // Band-pass one-poles at roughly 250 Hz and 1400 Hz.
        var cDiv = 0, cS1 = 22695477, cS2 = 69069;
        var cN1 = 0, cN2 = 0;
        var cLp1 = 0, cHp1 = 0, cLp2 = 0, cHp2 = 0, cLp1b = 0, cLp2b = 0;
        var C_LP = 1 - Math.exp(-2 * Math.PI * 1400 / FM_RATE);
        var C_HP = 1 - Math.exp(-2 * Math.PI * 250 / FM_RATE);
        var C_SM = 1 - Math.exp(-1 / (0.25 * FM_RATE));
        var cM1 = 0, cM2 = 0.37, cM3 = 0.71, cSurge = 1;

        /* ---- resampler ---------------------------------------------- */
        var rsPos = 1, pvL = 0, pvR = 0, cvL = 0, cvR = 0;

        /* ---- random ------------------------------------------------- */
        var rnd1 = 123456789;
        function rnd() {
            rnd1 ^= rnd1 << 13; rnd1 ^= rnd1 >>> 17; rnd1 ^= rnd1 << 5;
            return ((rnd1 >>> 0) % 65536) / 65536;
        }

        /* =============== FM =============== */

        function updateInc(c) {
            var b = c << 2, f = chFreq[c] * chPegMul[c];
            for (var j = 0; j < 4; j++) {
                var o = b + j;
                var hz = f * oMul[o] * oDet[o];
                var v = (hz / FM_RATE) * PHASE_ONE;
                pinc[o] = v > 16000000 ? 16000000 : (v | 0);
            }
        }

        function applyPatch(c, pi) {
            var p = bPatch[pi];
            if (!p) return;
            chAlg[c] = p.alg; chFb[c] = p.fb;
            chPegAmt[c] = p.pegAmt; chPegK[c] = p.pegK;
            var b = c << 2;
            for (var j = 0; j < 4; j++) {
                var o = b + j, s = p.ops[j];
                oMul[o] = s.mul; oDet[o] = s.dt; oTL[o] = s.tl << 5;
                oAR[o] = s.ar; oD1[o] = s.d1r; oD2[o] = s.d2r; oRR[o] = s.rr;
                oSL[o] = s.sl; oKS[o] = s.ks;
            }
            updateInc(c);
        }

        function keyOn(c, note) {
            var b = c << 2, kc = keyCode[note < 0 ? 60 : (note > 127 ? 127 : note)];
            for (var j = 0; j < 4; j++) {
                var o = b + j;
                oKSV[o] = kc >> (3 - oKS[o]);
                phase[o] = 0; env[o] = 1023; est[o] = 1;
            }
            fbP1[c] = 0; fbP2[c] = 0;
            if (chPegAmt[c] !== 0) {
                chPegVal[c] = chPegAmt[c];
                chPegMul[c] = Math.pow(2, chPegVal[c] / 12);
                updateInc(c);
            } else if (chPegMul[c] !== 1) {
                chPegMul[c] = 1; updateInc(c);
            }
        }

        function keyOff(c) {
            var b = c << 2;
            for (var j = 0; j < 4; j++) if (est[b + j] !== 0) est[b + j] = 4;
        }

        function mixCh(c) {
            var m = (c === 5) ? sfxV * FM_SFX_BOOST : musV;
            chMixL[c] = chPL[c] * m; chMixR[c] = chPR[c] * m;
        }
        function setPan(c, pan) {
            // The chip can only do L, R or both, so centre is full on both
            // sides rather than -3 dB: no dip in the middle.
            chPL[c] = pan <= 0 ? 1 : 1 - pan;
            chPR[c] = pan >= 0 ? 1 : 1 + pan;
            mixCh(c);
        }

        function op(o, mod, extra) {
            var p = (phase[o] + (mod << MOD_SHIFT)) | 0;
            var idx = (p >> 10) & 1023;
            var q = idx & 255;
            if (idx & 256) q = 255 - q;
            var att = logSin[q] + (env[o] << 2) + oTL[o] + extra;
            if (att > 4095) return 0;
            var v = expTab[att & 255] >> (att >> 8);
            return (idx & 512) ? -v : v;
        }

        function renderFM(c) {
            var b = c << 2;
            if (est[b] === 0 && est[b + 1] === 0 && est[b + 2] === 0 && est[b + 3] === 0) return 0;
            var alg = chAlg[c], fb = chFb[c], ca = chAtt[c] + chExtra[c];
            var fm = fb ? (((fbP1[c] + fbP2[c]) >> 1) >> (7 - fb)) : 0;
            var o1 = op(b, fm, alg === 7 ? ca : 0);
            fbP2[c] = fbP1[c]; fbP1[c] = o1;
            var o2, o3, o4, out;
            // Modulator sums are halved: the chip's accumulator is wider than
            // one operator, but letting two full-scale modulators stack turns
            // every alg-1 patch into noise.
            switch (alg) {
            case 0: o2 = op(b + 1, o1, 0); o3 = op(b + 2, o2, 0); o4 = op(b + 3, o3, ca); out = o4; break;
            case 1: o2 = op(b + 1, 0, 0); o3 = op(b + 2, (o1 + o2) >> 1, 0); o4 = op(b + 3, o3, ca); out = o4; break;
            case 2: o2 = op(b + 1, 0, 0); o3 = op(b + 2, o2, 0); o4 = op(b + 3, (o1 + o3) >> 1, ca); out = o4; break;
            case 3: o2 = op(b + 1, o1, 0); o3 = op(b + 2, 0, 0); o4 = op(b + 3, (o2 + o3) >> 1, ca); out = o4; break;
            case 4: o2 = op(b + 1, o1, ca); o3 = op(b + 2, 0, 0); o4 = op(b + 3, o3, ca); out = o2 + o4; break;
            case 5: o2 = op(b + 1, o1, ca); o3 = op(b + 2, o1, ca); o4 = op(b + 3, o1, ca); out = o2 + o3 + o4; break;
            case 6: o2 = op(b + 1, o1, ca); o3 = op(b + 2, 0, ca); o4 = op(b + 3, 0, ca); out = o2 + o3 + o4; break;
            default: o2 = op(b + 1, 0, ca); o3 = op(b + 2, 0, ca); o4 = op(b + 3, 0, ca); out = o1 + o2 + o3 + o4; break;
            }
            phase[b] = (phase[b] + pinc[b]) | 0;
            phase[b + 1] = (phase[b + 1] + pinc[b + 1]) | 0;
            phase[b + 2] = (phase[b + 2] + pinc[b + 2]) | 0;
            phase[b + 3] = (phase[b + 3] + pinc[b + 3]) | 0;
            return out > OUT_MAX ? OUT_MAX : (out < OUT_MIN ? OUT_MIN : out);
        }

        /* =============== envelopes, glide, pitch env =============== */

        function egStep() {
            egCnt = (egCnt + 1) | 0;
            var o, st, rt, s2, inc, e;
            for (o = 0; o < NOP; o++) {
                st = est[o];
                if (st === 0) continue;
                rt = st === 1 ? oAR[o] : st === 2 ? oD1[o] : st === 3 ? oD2[o] : oRR[o];
                if (rt === 0) continue;
                rt = rt * 2 + oKSV[o];
                if (rt > 63) rt = 63;
                s2 = EG_SHIFT[rt];
                if (egCnt & ((1 << s2) - 1)) continue;
                inc = EG_INC[(rt << 3) | ((egCnt >> s2) & 7)];
                if (inc === 0) continue;
                e = env[o];
                if (st === 1) {
                    // The chip's attack curve: approach zero attenuation
                    // proportionally, so it is fast then eases in.
                    e += ((~e) * inc) >> 4;
                    if (e <= 0) { e = 0; est[o] = 2; }
                    env[o] = e;
                } else {
                    e += inc;
                    if (st === 2 && e >= oSL[o]) { e = oSL[o]; est[o] = 3; }
                    if (e >= 1023) { e = 1023; if (st === 4) est[o] = 0; }
                    env[o] = e;
                }
            }
            for (o = 0; o < NCH; o++) {
                var dirty = 0;
                if (chGlide[o]) {
                    var d = chGlideTo[o] - chFreq[o];
                    if (d < 0.02 && d > -0.02) { chFreq[o] = chGlideTo[o]; chGlide[o] = 0; }
                    else chFreq[o] += d * GLIDE_K;
                    dirty = 1;
                }
                if (chPegVal[o] > 0.002) {
                    chPegVal[o] *= chPegK[o];
                    chPegMul[o] = Math.pow(2, chPegVal[o] / 12);
                    dirty = 1;
                } else if (chPegVal[o] !== 0) {
                    chPegVal[o] = 0; chPegMul[o] = 1; dirty = 1;
                }
                if (dirty) updateInc(o);
            }
        }

        /* =============== PSG =============== */

        function psgMix(c) {
            var m = vSrc[c] ? sfxV : musV;
            tVL[c] = tAmp[c] * tPL[c] * m; tVR[c] = tAmp[c] * tPR[c] * m;
        }
        function noiseMix() {
            var m = vSrc[3] ? sfxV : musV;
            nVL = nAmp * nPL * m; nVR = nAmp * nPR * m;
        }
        function setTonePan(c, pan) {
            tPL[c] = pan <= 0 ? 1 : 1 - pan;
            tPR[c] = pan >= 0 ? 1 : 1 + pan;
            psgMix(c);
        }
        function setNoisePan(pan) {
            nPL = pan <= 0 ? 1 : 1 - pan;
            nPR = pan >= 0 ? 1 : 1 + pan;
            noiseMix();
        }

        function renderPSG() {
            psgAcc += PSG_PER_FM;
            var t = psgAcc | 0;
            if (t > 0) {
                psgAcc -= t;
                for (var c = 0; c < 3; c++) {
                    var per = tPer[c]; if (per < 1) per = 1;
                    var cn = tCnt[c] - t;
                    while (cn <= 0) { cn += per; tOut[c] = -tOut[c]; }
                    tCnt[c] = cn;
                }
                var np = nPer; if (np < 1) np = 1;
                var nc = nCnt - t;
                while (nc <= 0) {
                    nc += np;
                    var f = nMode ? (nLfsr & 1) : ((nLfsr & 1) ^ ((nLfsr >> 3) & 1));
                    nLfsr = ((nLfsr >>> 1) | (f << 15)) & 0xFFFF;
                    if (nLfsr === 0) nLfsr = 0x8000;
                    nOut = (nLfsr & 1) ? 1 : -1;
                }
                nCnt = nc;
            }
        }

        /* =============== voices =============== */

        function endVoice(res) {
            vLive[res] = 0; vInst[res] = null;
            if (res < 3) { tAmp[res] = 0; psgMix(res); }
            else if (res === 3) { nAmp = 0; noiseMix(); }
            else { keyOff(5); }
        }

        function alloc(kind, prio) {
            var lo, hi, j;
            if (kind === 1) { lo = 3; hi = 4; } else if (kind === 2) { lo = 4; hi = 5; } else { lo = 0; hi = 3; }
            for (j = lo; j < hi; j++) if (!vLive[j]) return j;
            for (j = lo; j < hi; j++) if (vSrc[j] === 0) return j;
            var best = -1, bp = prio;
            for (j = lo; j < hi; j++) if (vPrio[j] < bp) { bp = vPrio[j]; best = j; }
            return best;
        }

        function startVoice(res, inst, hz, scale, pan, pitchMul, src, prio) {
            vLive[res] = 1; vSrc[res] = src; vPrio[res] = prio;
            vInst[res] = inst; vS[res] = 0; vFa[res] = 0;
            vStep[res] = inst.step; vHz[res] = hz; vMul[res] = pitchMul;
            vScale[res] = scale;
            vPan[res] = pan;
            if (res < 3) setTonePan(res, pan);
            else if (res === 3) {
                setNoisePan(pan);
                nMode = inst.mode;
                nLfsr = 0x8000;
            } else {
                setPan(5, pan);
                if (inst.patch >= 0) applyPatch(5, inst.patch);
                chFreq[5] = hz * pitchMul; chGlide[5] = 0;
                chExtra[5] = scale <= 0 ? 4096 : Math.round(-Math.log(scale) / Math.LN2 * 256);
                updateInc(5);
                keyOn(5, hzToNote(hz * pitchMul));
            }
            stepVoice(res);
        }

        function hzToNote(hz) {
            if (!(hz > 0)) return 60;
            var m = Math.round(69 + 12 * Math.log(hz / 440) / Math.LN2);
            return m < 0 ? 0 : (m > 127 ? 127 : m);
        }

        function stepVoice(res) {
            var inst = vInst[res];
            if (!inst) { endVoice(res); return; }
            var va = inst.vol, s = vS[res], vv;
            if (s < va.length) vv = va[s];
            else if (inst.sus) vv = va[va.length - 1];
            else { endVoice(res); return; }

            var semi = 0;
            if (inst.pitch) semi = inst.pitch[s < inst.pitch.length ? s : inst.pitch.length - 1];
            else if (inst.bend) semi = inst.bend * s;
            if (inst.vibD) semi += inst.vibD * Math.sin(s * 2 * Math.PI / inst.vibP);
            if (inst.rand) semi += (rnd() * 2 - 1) * inst.rand;

            var hz = vHz[res] * vMul[res];
            if (semi !== 0) hz *= Math.pow(2, semi / 12);
            if (hz < 1) hz = 1;

            if (res < 3) {
                var per = Math.round(PSG_TICK / (2 * hz));
                tPer[res] = per < 1 ? 1 : (per > 1023 ? 1023 : per);
                tAmp[res] = PSG_AMP[vv < 0 ? 0 : (vv > 15 ? 15 : vv)] * vScale[res];
                psgMix(res);
            } else if (res === 3) {
                if (inst.nf >= 0) nPer = inst.nf === 0 ? 32 : inst.nf === 1 ? 64 : 128;
                else {
                    // One formula for both modes. In periodic mode the LFSR
                    // repeats every 16 shifts, so this IS the pitch; in white
                    // mode it is the shift rate, and the noise colour tracks
                    // the note an octave band at a time.
                    var npv = Math.round(PSG_TICK / (16 * hz));
                    nPer = npv < 1 ? 1 : (npv > 1023 ? 1023 : npv);
                }
                nAmp = PSG_AMP[vv < 0 ? 0 : (vv > 15 ? 15 : vv)] * vScale[res];
                noiseMix();
            } else {
                chFreq[5] = hz; updateInc(5);
                chAtt[5] = VOL_ATT[vv < 0 ? 0 : (vv > 15 ? 15 : vv)];
            }
            vFa[res] = vStep[res] - 1;
            vS[res] = s + 1;
        }

        function frameTick() {
            var j;
            for (j = 0; j < PEND; j++) {
                if (!pLive[j]) continue;
                if (pDelay[j] > 0) { pDelay[j]--; continue; }
                pLive[j] = 0;
                var inst = pInst[j];
                var res = alloc(inst.ch, pPrio[j]);
                if (res >= 0) startVoice(res, inst, inst.hz, pScale[j], pPan[j], pMul[j], 1, pPrio[j]);
                pInst[j] = null;
            }
            for (j = 0; j < NRES; j++) {
                if (!vLive[j]) continue;
                if (vFa[j] > 0) { vFa[j]--; continue; }
                stepVoice(j);
            }
            // Crowd surge: a slow random walk so the bed is never static.
            cSurge += (0.85 + rnd() * 0.3 - cSurge) * 0.04;
        }

        /* =============== sequencer =============== */

        // Used when a track starts or stops, and NOT the same thing as a
        // note-off in a pattern. Release rates in the patch bank run to a
        // second and a half on purpose (bells, pads, ringing metal), so a
        // plain key-off here bled the old track into the new one for as long
        // as the longest tail. The rates are forced fast first, which fades
        // over ~15 ms instead of cutting and clicking; the next applyPatch
        // writes the real ones back.
        function allNotesOff() {
            for (var c = 0; c < NCH; c++) {
                var b = c << 2;
                for (var j = 0; j < 4; j++) if (est[b + j] !== 0) oRR[b + j] = 28;
                keyOff(c);
            }
            for (var k2 = 0; k2 < 4; k2++) if (vLive[k2] && vSrc[k2] === 0) endVoice(k2);
        }

        function startTrack(t) {
            if (!t) return;
            allNotesOff();
            sqT = t; sqOrd = 0; sqRow = 0; sqAcc = 0; sqOn = 1;
            sqSpr = FM_RATE * 60 / (t.bpm * t.rpb);
            for (var j = 0; j < t.chans.length; j++) {
                var cd = t.chans[j], c = cd.ch;
                if (c < 6) {
                    if (cd.inst >= 0) applyPatch(c, cd.inst);
                    chAtt[c] = VOL_ATT[cd.vol]; chExtra[c] = 0;
                    setPan(c, cd.pan);
                }
            }
            seqRow();
        }

        function stopTrack() {
            sqOn = 0; sqT = null;
            allNotesOff();
        }

        function seqRow() {
            var t = sqT;
            if (!t) return;
            var pat = t.patterns[t.order[sqOrd]];
            if (!pat) { stopTrack(); return; }
            var chans = t.chans, n = chans.length;
            for (var j = 0; j < n; j++) {
                var col = pat.cols[j];
                if (!col) continue;
                var cell = col[sqRow];
                if (cell) fire(chans[j], cell);
            }
            sqRow++;
            if (sqRow >= pat.len) {
                sqRow = 0; sqOrd++;
                if (sqOrd >= t.order.length) {
                    if (t.loop) sqOrd = t.loopOrder;
                    else { stopTrack(); return; }
                }
            }
        }

        function fire(cd, cell) {
            var c = cd.ch;
            if (c < 6) {
                if (cell.o) { keyOff(c); return; }
                if (cell.p >= 0) applyPatch(c, cell.p);
                chAtt[c] = VOL_ATT[cell.v >= 0 ? cell.v : cd.vol];
                var hz = noteHz[cell.n];
                if (cell.g) { chGlideTo[c] = hz; chGlide[c] = 1; chNote[c] = cell.n; }
                else {
                    chFreq[c] = hz; chGlide[c] = 0; chNote[c] = cell.n;
                    updateInc(c); keyOn(c, cell.n);
                }
                return;
            }
            // PSG music channel. An effect that has stolen the resource keeps
            // it: the music simply loses that note, same as on the hardware.
            var res = c - 6;
            if (vLive[res] && vSrc[res] !== 0) return;
            if (cell.o) { if (vLive[res]) endVoice(res); return; }
            var inst = bPsg[cell.p >= 0 ? cell.p : cd.inst];
            if (!inst) return;
            var vol = cell.v >= 0 ? cell.v : cd.vol;
            startVoice(res, inst, inst.hz > 0 ? inst.hz : noteHz[cell.n], vol / 15, cd.pan, 1, 0, 0);
        }

        /* =============== one core sample =============== */

        function genSample() {
            egAcc += 1;
            if (egAcc >= EG_EVERY) { egAcc -= EG_EVERY; egStep(); }
            frameAcc += 1;
            if (frameAcc >= FRAME_SAMPLES) { frameAcc -= FRAME_SAMPLES; frameTick(); }
            if (sqOn) {
                sqAcc += 1;
                if (sqAcc >= sqSpr) { sqAcc -= sqSpr; seqRow(); }
            }

            var l = 0, rr2 = 0, v;
            v = renderFM(0); l += v * chMixL[0]; rr2 += v * chMixR[0];
            v = renderFM(1); l += v * chMixL[1]; rr2 += v * chMixR[1];
            v = renderFM(2); l += v * chMixL[2]; rr2 += v * chMixR[2];
            v = renderFM(3); l += v * chMixL[3]; rr2 += v * chMixR[3];
            v = renderFM(4); l += v * chMixL[4]; rr2 += v * chMixR[4];
            v = renderFM(5); l += v * chMixL[5]; rr2 += v * chMixR[5];
            l *= FM_SCALE; rr2 *= FM_SCALE;

            renderPSG();
            l += (tOut[0] * tVL[0] + tOut[1] * tVL[1] + tOut[2] * tVL[2] + nOut * nVL) * PSG_SCALE;
            rr2 += (tOut[0] * tVR[0] + tOut[1] * tVR[1] + tOut[2] * tVR[2] + nOut * nVR) * PSG_SCALE;

            crowdLev += (crowdTarget - crowdLev) * C_SM;
            if (crowdLev > 0.0005) {
                if (--cDiv <= 0) {
                    cDiv = 5;
                    cS1 = (cS1 * 1103515 + 12345) | 0;
                    cS2 = (cS2 * 1103515 + 54321) | 0;
                    cN1 = ((cS1 >>> 16) & 0xFFFF) / 32768 - 1;
                    cN2 = ((cS2 >>> 16) & 0xFFFF) / 32768 - 1;
                }
                cLp1 += (cN1 - cLp1) * C_LP; cLp1b += (cLp1 - cLp1b) * C_LP;
                cHp1 += (cLp1b - cHp1) * C_HP;
                cLp2 += (cN2 - cLp2) * C_LP; cLp2b += (cLp2 - cLp2b) * C_LP;
                cHp2 += (cLp2b - cHp2) * C_HP;
                cM1 += 0.0000131; if (cM1 > 1) cM1 -= 1;
                cM2 += 0.0000073; if (cM2 > 1) cM2 -= 1;
                cM3 += 0.0000041; if (cM3 > 1) cM3 -= 1;
                var mur = 0.72 + 0.14 * (cM1 < 0.5 ? cM1 * 4 - 1 : 3 - cM1 * 4)
                               + 0.09 * (cM2 < 0.5 ? cM2 * 4 - 1 : 3 - cM2 * 4)
                               + 0.05 * (cM3 < 0.5 ? cM3 * 4 - 1 : 3 - cM3 * 4);
                var g = crowdLev * crowdLev * mur * cSurge * CROWD_SCALE * sfxV;
                l += (cLp1b - cHp1) * g;
                rr2 += (cLp2b - cHp2) * g;
            }

            cvL = l; cvR = rr2;
        }

        /* =============== public =============== */

        this.render = function (L, R, n) {
            var mono = (R === L || !R);
            for (var i2 = 0; i2 < n; i2++) {
                while (rsPos >= 1) {
                    pvL = cvL; pvR = cvR;
                    genSample();
                    rsPos -= 1;
                }
                var a = pvL + (cvL - pvL) * rsPos;
                var b = pvR + (cvR - pvR) * rsPos;
                rsPos += rsStep;
                // Hard clip. No limiter: the Genesis did not have one, and
                // the distortion when it ran out of headroom is half the
                // character of the thing.
                if (a > 1) a = 1; else if (a < -1) a = -1;
                if (b > 1) b = 1; else if (b < -1) b = -1;
                if (a !== a) a = 0;
                if (b !== b) b = 0;
                L[i2] = a;
                if (!mono) R[i2] = b;
            }
        };

        this.command = function (c) {
            if (!c) return;
            switch (c.t) {
            case 'bank':
                bPatch = c.patches || []; bPsg = c.psg || [];
                bSfx = c.sfx || {}; bTrack = c.tracks || {};
                break;
            case 'music':
                if (bTrack && bTrack[c.n]) startTrack(bTrack[c.n]);
                break;
            case 'stop':
                stopTrack();
                break;
            case 'sfx': {
                if (!bSfx) return;
                var lay = bSfx[c.n];
                if (!lay) return;
                var pan = c.pan || 0, sc = c.vol === undefined ? 1 : c.vol;
                var pm = c.pitch || 1;
                if (pan < -1) pan = -1; else if (pan > 1) pan = 1;
                if (sc < 0) sc = 0; else if (sc > 1) sc = 1;
                if (pm < 0.25) pm = 0.25; else if (pm > 4) pm = 4;
                for (var j = 0; j < lay.length; j++) {
                    var ly = lay[j];
                    if (ly.delay > 0) {
                        for (var q = 0; q < PEND; q++) {
                            if (pLive[q]) continue;
                            pLive[q] = 1; pInst[q] = ly; pDelay[q] = ly.delay;
                            pMul[q] = pm; pScale[q] = sc; pPan[q] = pan; pPrio[q] = ly.prio;
                            break;
                        }
                    } else {
                        var res = alloc(ly.ch, ly.prio);
                        if (res >= 0) startVoice(res, ly, ly.hz, sc, pan, pm, 1, ly.prio);
                    }
                }
                break;
            }
            case 'crowd':
                crowdTarget = c.v < 0 ? 0 : (c.v > 1 ? 1 : c.v);
                break;
            case 'vol':
                musV = c.m < 0 ? 0 : (c.m > 1 ? 1 : c.m);
                sfxV = c.s < 0 ? 0 : (c.s > 1 ? 1 : c.s);
                for (var w = 0; w < NCH; w++) mixCh(w);
                for (w = 0; w < 3; w++) psgMix(w);
                noiseMix();
                break;
            case 'panic':
                stopTrack();
                for (var z = 0; z < NRES; z++) if (vLive[z]) endVoice(z);
                for (z = 0; z < PEND; z++) { pLive[z] = 0; pInst[z] = null; }
                crowdTarget = 0;
                break;
            }
        };

        // Exposed for the harness in tools: which track is playing, and
        // whether the sequencer is still running (one-shots stop on their
        // own, which is how sound.update knows a stinger has finished).
        this.state = function () {
            return { playing: sqOn, order: sqOrd, row: sqRow, crowd: crowdLev };
        };
    }

    /* ======================================================================
       6. TRANSPORT SOURCES
       ======================================================================
       The worklet source is the core function's own text plus a processor
       wrapper. Taking it from Function.prototype.toString() rather than a
       quoted string means `node --check` on this file checks the synth too,
       and an editor still highlights it. It also means GenesisCore must stay
       closure-free: see the note on it above.
       ------------------------------------------------------------------ */

    var DSP_SOURCE = "'use strict';\n" + GenesisCore.toString() + '\n';

    var WORKLET_SOURCE = DSP_SOURCE + [
        'class GenesisProcessor extends AudioWorkletProcessor {',
        '    constructor(options) {',
        '        super();',
        '        this.core = new GenesisCore(sampleRate);',
        '        this.dead = false;',
        '        var self = this;',
        '        this.port.onmessage = function (e) {',
        '            var d = e.data;',
        '            try {',
        '                if (d && d.length !== undefined) {',
        '                    for (var i = 0; i < d.length; i++) self.core.command(d[i]);',
        '                } else { self.core.command(d); }',
        '            } catch (err) { /* a bad command must not kill the node */ }',
        '        };',
        '    }',
        '    process(inputs, outputs) {',
        '        var out = outputs[0];',
        '        if (!out || !out.length) return true;',
        '        if (this.dead) return true;',
        '        try {',
        '            this.core.render(out[0], out.length > 1 ? out[1] : out[0], out[0].length);',
        '        } catch (err) {',
        '            // Go silent rather than spam the console every 128 frames.',
        '            this.dead = true;',
        '            for (var c = 0; c < out.length; c++) out[c].fill(0);',
        '        }',
        '        return true;',
        '    }',
        '}',
        "registerProcessor('slwf-genesis', GenesisProcessor);",
        ''
    ].join('\n');

    /* ======================================================================
       7. COMPILER  (hand-editable tables -> flat data for the core)
       ======================================================================
       Names become indices, note strings become MIDI numbers or Hz, and
       pattern strings become per-row cell objects. All of it happens once, on
       the main thread, and the result is structured-cloned into the worklet.
       The core never parses anything.
       ------------------------------------------------------------------ */

    var SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    var NOTE_RE = /^([a-gA-G])([#b-]?)(\d)$/;

    var warnings = [];
    function warn(msg) { if (warnings.length < 200) warnings.push(msg); }

    function noteToMidi(s) {
        if (typeof s === 'number') return s;
        var m = NOTE_RE.exec(String(s));
        if (!m) return -1;
        var v = SEMI[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
        v += (parseInt(m[3], 10) + 1) * 12;
        return (v < 0 || v > 127) ? -1 : v;
    }
    function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    // A note field on an instrument may be a note string or a literal Hz.
    function pitchToHz(n) {
        if (n === undefined || n === null) return 0;
        if (typeof n === 'number') return n > 0 ? n : 0;
        var m = noteToMidi(n);
        return m < 0 ? 0 : midiToHz(m);
    }

    var bank = null;

    function buildBank() {
        if (bank) return bank;

        /* ---- FM patches ---- */
        var patches = [], patchIx = {}, name, j, p, src, ops, o;
        for (name in PATCHES) {
            if (!Object.prototype.hasOwnProperty.call(PATCHES, name)) continue;
            src = PATCHES[name];
            ops = [];
            for (j = 0; j < 4; j++) {
                o = (src.ops && src.ops[j]) || {};
                ops.push({
                    mul: [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15][(o.mul || 0) & 15],
                    dt: [1, 1.00202, 1.00405, 1.00608, 1, 0.99798, 0.99597, 0.99396][(o.dt || 0) & 7],
                    tl: Math.max(0, Math.min(127, o.tl === undefined ? 127 : o.tl | 0)),
                    ar: Math.max(0, Math.min(31, o.ar === undefined ? 31 : o.ar | 0)),
                    d1r: Math.max(0, Math.min(31, o.d1r | 0)),
                    d2r: Math.max(0, Math.min(31, o.d2r | 0)),
                    rr: Math.max(0, Math.min(31, o.rr === undefined ? 10 : o.rr | 0)),
                    // SL is 3 dB a step in the chip's 96 dB envelope, which is
                    // 32 of its 1023 counts; 15 is the special case meaning
                    // "decay all the way to nothing".
                    sl: (o.sl | 0) >= 15 ? 1023 : ((o.sl | 0) << 5),
                    ks: Math.max(0, Math.min(3, o.ks | 0))
                });
            }
            p = {
                alg: Math.max(0, Math.min(7, src.alg | 0)),
                fb: Math.max(0, Math.min(7, src.fb | 0)),
                pegAmt: src.peg ? src.peg[0] : 0,
                // Per-EG-tick decay factor for the pitch envelope.
                pegK: src.peg ? Math.exp(-1 / (Math.max(0.001, src.peg[1]) * (53267 / 3))) : 0,
                ops: ops
            };
            patchIx[name] = patches.length;
            patches.push(p);
        }

        /* ---- one PSG/FM layer (used by instruments and effects alike) ---- */
        function layer(src) {
            var ch = src.ch === 'noise' ? 1 : src.ch === 'fm' ? 2 : 0;
            var hz = pitchToHz(src.note);
            var nf = -1;
            if (ch === 1 && !hz) nf = src.nf === undefined ? 1 : Math.max(0, Math.min(2, src.nf | 0));
            if (ch !== 1 && !hz) hz = 440;
            var vol = [];
            for (var q = 0; q < (src.vol ? src.vol.length : 0); q++) {
                vol.push(Math.max(0, Math.min(15, src.vol[q] | 0)));
            }
            if (!vol.length) vol = [0];
            var pi = -1;
            if (ch === 2) {
                pi = patchIx[src.patch];
                if (pi === undefined) { warn('unknown FM patch for layer: ' + src.patch); pi = -1; }
            }
            var pitch = null;
            if (src.pitch) { pitch = []; for (q = 0; q < src.pitch.length; q++) pitch.push(+src.pitch[q] || 0); }
            return {
                ch: ch,
                mode: src.mode === 'periodic' ? 1 : 0,
                nf: nf,
                hz: hz,
                vol: vol,
                sus: !!src.sus,
                step: Math.max(1, src.step === undefined ? 1 : src.step | 0),
                delay: Math.max(0, src.delay | 0),
                bend: +src.bend || 0,
                pitch: pitch,
                vibD: src.vib ? +src.vib[0] || 0 : 0,
                vibP: src.vib ? Math.max(1, +src.vib[1] || 4) : 4,
                rand: +src.rand || 0,
                patch: pi,
                prio: src.prio === undefined ? 1 : Math.max(0, Math.min(3, src.prio | 0))
            };
        }

        /* ---- PSG instruments ---- */
        var psg = [], psgIx = {};
        for (name in PSG_INST) {
            if (!Object.prototype.hasOwnProperty.call(PSG_INST, name)) continue;
            psgIx[name] = psg.length;
            psg.push(layer(PSG_INST[name]));
        }

        /* ---- sound effects ---- */
        var sfx = {}, list, k2;
        for (name in SFX) {
            if (!Object.prototype.hasOwnProperty.call(SFX, name)) continue;
            list = SFX[name];
            var out = [];
            for (k2 = 0; k2 < list.length; k2++) out.push(layer(list[k2]));
            sfx[name] = out;
        }

        /* ---- tracks ---- */
        var CHIX = { fm0: 0, fm1: 1, fm2: 2, fm3: 3, fm4: 4, fm5: 5, psg0: 6, psg1: 7, psg2: 8, noise: 9 };

        // One pattern token -> a cell, or null. See the grammar above the
        // TRACKS table.
        function cellOf(tok, chan, isFM) {
            var glide = 0;
            if (tok.charAt(0) === '~') { glide = 1; tok = tok.slice(1); }
            var vol = -1, inst = -1, ix;
            ix = tok.indexOf('/');
            if (ix >= 0) {
                var rest = tok.slice(ix + 1), ci = rest.indexOf(':');
                if (ci >= 0) { vol = parseInt(rest.slice(0, ci), 10); tok = tok.slice(0, ix) + ':' + rest.slice(ci + 1); }
                else { vol = parseInt(rest, 10); tok = tok.slice(0, ix); }
                if (isNaN(vol)) vol = -1; else vol = Math.max(0, Math.min(15, vol));
            }
            ix = tok.indexOf(':');
            if (ix >= 0) {
                var iname = tok.slice(ix + 1);
                tok = tok.slice(0, ix);
                inst = isFM ? patchIx[iname] : psgIx[iname];
                if (inst === undefined) { warn('unknown instrument in pattern: ' + iname); inst = -1; }
            }
            var note = -1;
            if (chan.map && Object.prototype.hasOwnProperty.call(chan.map, tok)) {
                var al = chan.map[tok];
                var ai = isFM ? patchIx[al[0]] : psgIx[al[0]];
                if (ai === undefined) { warn('unknown instrument in map: ' + al[0]); }
                else if (inst < 0) inst = ai;
                note = noteToMidi(al[1]);
                if (al.length > 2 && vol < 0) vol = Math.max(0, Math.min(15, al[2] | 0));
            } else {
                note = noteToMidi(tok);
            }
            if (note < 0) { warn('unparsed pattern token: ' + tok); return null; }
            return { n: note, p: inst, v: vol, g: glide, o: 0 };
        }

        function parseCells(str, len, chan, isFM) {
            var cells = new Array(len), q;
            for (q = 0; q < len; q++) cells[q] = null;
            var toks = String(str).split(/\s+/), row = 0;
            for (q = 0; q < toks.length && row < len; q++) {
                var tk = toks[q];
                if (!tk || tk === '|') continue;
                if (tk === '.') { row++; continue; }
                if (tk === '=') { cells[row++] = { n: -1, p: -1, v: -1, g: 0, o: 1 }; continue; }
                cells[row++] = cellOf(tk, chan, isFM);
            }
            return cells;
        }

        var tracks = {}, secs = {};
        for (name in TRACKS) {
            if (!Object.prototype.hasOwnProperty.call(TRACKS, name)) continue;
            src = TRACKS[name];
            var chans = [], rawChans = src.chans || [];
            for (j = 0; j < rawChans.length; j++) {
                var cs = rawChans[j], cix = CHIX[cs.ch];
                if (cix === undefined) { warn('unknown channel ' + cs.ch + ' in track ' + name); cix = 0; }
                var isFM = cix < 6;
                var ii = isFM ? patchIx[cs.inst] : psgIx[cs.inst];
                if (ii === undefined) { warn('unknown instrument ' + cs.inst + ' in track ' + name); ii = 0; }
                chans.push({
                    ch: cix, inst: ii,
                    vol: Math.max(0, Math.min(15, cs.vol === undefined ? 12 : cs.vol | 0)),
                    pan: Math.max(-1, Math.min(1, +cs.pan || 0)),
                    map: cs.map || null
                });
            }
            var pats = [], rows = 0;
            for (j = 0; j < (src.patterns || []).length; j++) {
                var rp = src.patterns[j];
                var len = rp.len | 0;
                if (!len) {
                    // Infer the length from the longest column if `len` was
                    // left off, so a pattern cannot silently truncate.
                    for (k2 = 0; k2 < rawChans.length; k2++) {
                        var s2 = rp[rawChans[k2].ch];
                        if (!s2) continue;
                        var ct = String(s2).split(/\s+/), n2 = 0;
                        for (var w = 0; w < ct.length; w++) if (ct[w] && ct[w] !== '|') n2++;
                        if (n2 > len) len = n2;
                    }
                    if (!len) len = 16;
                }
                var cols = [];
                for (k2 = 0; k2 < rawChans.length; k2++) {
                    var str = rp[rawChans[k2].ch];
                    cols.push(str ? parseCells(str, len, chans[k2], chans[k2].ch < 6) : null);
                }
                pats.push({ len: len, cols: cols });
            }
            var order = (src.order || [0]).slice();
            for (j = 0; j < order.length; j++) rows += pats[order[j]] ? pats[order[j]].len : 0;
            var bpm = src.bpm || 120, rpb = src.rpb || 4;
            tracks[name] = {
                bpm: bpm, rpb: rpb,
                loop: src.loop !== false,
                loopOrder: Math.max(0, Math.min(order.length - 1, src.loopOrder | 0)),
                chans: chans, order: order, patterns: pats
            };
            secs[name] = rows * 60 / (bpm * rpb);
        }

        bank = { t: 'bank', patches: patches, psg: psg, sfx: sfx, tracks: tracks, secs: secs };
        return bank;
    }

    /* ======================================================================
       8. PUBLIC API
       ======================================================================
       sound.init()                     from a user gesture; idempotent; bool
       sound.ready                      bool property
       sound.sfx(name, opts)            opts: { pan -1..1, vol 0..1, pitch
                                        as a frequency MULTIPLIER 0.25..4 }
       sound.music(name)                replaces whatever is playing; calling
                                        it with the track already playing is
                                        a no-op, so it is safe per frame
       sound.stopMusic()
       sound.crowd(level)               0..1 ambient bed
       sound.setVolume(musicVol, sfxVol)
       sound.update(dt)                 once per frame, dt in seconds
       sound.suspend() / sound.resume()
       ------------------------------------------------------------------ */

    var ctx = null, master = null, wnode = null, spnode = null, core = null;
    var post = null, queue = [], blobUrl = null;
    var engineState = 'none';         // none | pending | worklet | script
    var failed = false;

    var musicVol = 0.7, sfxVol = 0.9;
    var curTrack = null, curPlaying = false, curOneShot = false;
    var curElapsed = 0, curSecs = 0;
    var crowdWant = 0, crowdSent = -1, crowdAt = 0;
    var lastSfx = {}, clock = 0;

    function nowMs() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    var sound = {
        version: SOUND_VERSION,
        ready: false
    };

    /* ---- command plumbing --------------------------------------------
       Commands raised before the engine is online are queued. The worklet
       module usually resolves in a couple of milliseconds, but the very
       first sfx('start') is fired from the same keypress that calls init(),
       so dropping the queue would lose the first sound the player hears. */

    function send(cmd) {
        if (post) { try { post(cmd); } catch (e) { /* node gone */ } return; }
        if (queue.length < 32) queue.push({ c: cmd, at: nowMs() });
    }

    function flushQueue() {
        var t0 = nowMs();
        for (var i = 0; i < queue.length; i++) {
            var q = queue[i];
            // A hit queued a third of a second ago is not worth firing late.
            if (q.c.t === 'sfx' && t0 - q.at > 300) continue;
            try { post(q.c); } catch (e) { /* ignore */ }
        }
        queue.length = 0;
    }

    function revokeBlob() {
        if (!blobUrl) return;
        try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ }
        blobUrl = null;
    }

    function engineUp(kind) {
        engineState = kind;
        sound._dsp.path = kind === 'worklet' ? 'worklet' : 'scriptprocessor';
        try { post(buildBank()); } catch (e) { /* ignore */ }
        flushQueue();
    }

    /* ---- the ScriptProcessor fallback --------------------------------
       Same GenesisCore function object, called directly. No eval, no Blob,
       no second copy of the synth. 2048 frames is ~46 ms of latency at
       44.1 kHz, which is audible on a punch but is strictly better than a
       silent game. */

    function startScript() {
        if (engineState === 'script' || engineState === 'worklet') return;
        try {
            core = new GenesisCore(ctx.sampleRate);
            var sp;
            try { sp = ctx.createScriptProcessor(2048, 0, 2); }
            catch (e) { sp = ctx.createScriptProcessor(2048, 1, 2); }
            sp.onaudioprocess = function (ev) {
                var b = ev.outputBuffer;
                try {
                    core.render(b.getChannelData(0),
                        b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0),
                        b.length);
                } catch (err) { /* keep the callback alive */ }
            };
            sp.connect(master);
            // Hold the reference: an unreferenced ScriptProcessorNode can be
            // collected mid-session and the audio simply stops.
            spnode = sp;
            post = function (c) { core.command(c); };
            engineUp('script');
        } catch (e) {
            engineState = 'none';
            post = null; queue.length = 0;
            failed = true; sound.ready = false;
            sound._dsp.path = 'none';
        }
    }

    /* ---- the worklet path -------------------------------------------
       There is no separate worklet file in this repo and no build step, so
       the module is registered from a Blob URL built out of
       GenesisCore.toString(). A syntax error in there fails silently at
       runtime, which is why tools check the string on its own. */

    function startEngine() {
        var can = false;
        try {
            can = !!(ctx.audioWorklet && typeof ctx.audioWorklet.addModule === 'function' &&
                     typeof AudioWorkletNode === 'function' && typeof Blob === 'function' &&
                     typeof URL !== 'undefined' && URL.createObjectURL);
        } catch (e) { can = false; }
        if (!can) { startScript(); return; }

        try {
            blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        } catch (e) { startScript(); return; }

        engineState = 'pending';
        var settled = false;
        function fail() { if (settled) return; settled = true; revokeBlob(); startScript(); }

        try {
            ctx.audioWorklet.addModule(blobUrl).then(function () {
                if (settled) return;
                settled = true;
                revokeBlob();
                try {
                    wnode = new AudioWorkletNode(ctx, 'slwf-genesis', {
                        numberOfInputs: 0,
                        numberOfOutputs: 1,
                        outputChannelCount: [2]
                    });
                    wnode.connect(master);
                    post = function (c) { wnode.port.postMessage(c); };
                    engineUp('worklet');
                } catch (e) {
                    settled = false;
                    fail();
                }
            }, fail);
        } catch (e) { fail(); }
    }

    /* ---- init -------------------------------------------------------- */

    sound.init = function () {
        if (failed) return false;
        if (sound.ready) {
            // Called again from a later gesture: the usual reason is that the
            // context came up suspended, so try it once more.
            try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { /* ignore */ }
            return true;
        }
        try {
            var AC = (typeof window !== 'undefined') &&
                     (window.AudioContext || window.webkitAudioContext);
            if (!AC) { failed = true; return false; }
            try { ctx = new AC({ latencyHint: 'interactive' }); }
            catch (e) { ctx = new AC(); }
            master = ctx.createGain();
            master.gain.value = MASTER_GAIN;
            master.connect(ctx.destination);
            sound.ready = true;
            buildBank();
            send({ t: 'vol', m: musicVol, s: sfxVol });
            if (crowdSent >= 0) send({ t: 'crowd', v: crowdWant });
            startEngine();
            try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) { /* ignore */ }
            return true;
        } catch (e) {
            failed = true; sound.ready = false;
            ctx = null; master = null; post = null; queue.length = 0;
            return false;
        }
    };

    /* ---- effects ----------------------------------------------------- */

    sound.sfx = function (name, opts) {
        if (!sound.ready || failed) return;
        if (!SFX[name]) return;
        var t = nowMs();
        // Two calls in the same frame for the same sound is a bug in the
        // caller, not a double hit; the second would only phase-cancel.
        if (lastSfx[name] !== undefined && t - lastSfx[name] < 16) return;
        lastSfx[name] = t;
        var c = { t: 'sfx', n: name, pan: 0, vol: 1, pitch: 1 };
        if (opts) {
            if (opts.pan !== undefined && isFinite(opts.pan)) c.pan = +opts.pan;
            if (opts.vol !== undefined && isFinite(opts.vol)) c.vol = +opts.vol;
            if (opts.pitch !== undefined && isFinite(opts.pitch) && +opts.pitch > 0) c.pitch = +opts.pitch;
        }
        send(c);
    };

    /* ---- music ------------------------------------------------------- */

    sound.music = function (name) {
        if (!sound.ready || failed) return;
        if (!TRACKS[name]) return;
        if (curTrack === name && curPlaying) return;   // safe to call per frame
        curTrack = name;
        curPlaying = true;
        curOneShot = TRACKS[name].loop === false;
        curElapsed = 0;
        curSecs = buildBank().secs[name] || 0;
        send({ t: 'music', n: name });
    };

    sound.stopMusic = function () {
        curTrack = null; curPlaying = false; curOneShot = false;
        if (!sound.ready || failed) return;
        send({ t: 'stop' });
    };

    /* ---- crowd ------------------------------------------------------- */

    sound.crowd = function (level) {
        var v = +level;
        if (!isFinite(v)) v = 0;
        v = v < 0 ? 0 : (v > 1 ? 1 : v);
        crowdWant = v;
        if (!sound.ready || failed) return;
        // Big moves go straight out; small ones are coalesced in update().
        if (crowdSent < 0 || Math.abs(v - crowdSent) > 0.25) {
            crowdSent = v; crowdAt = nowMs();
            send({ t: 'crowd', v: v });
        }
    };

    /* ---- volume ------------------------------------------------------ */

    sound.setVolume = function (mv, sv) {
        if (typeof mv === 'number' && isFinite(mv)) musicVol = mv < 0 ? 0 : (mv > 1 ? 1 : mv);
        if (typeof sv === 'number' && isFinite(sv)) sfxVol = sv < 0 ? 0 : (sv > 1 ? 1 : sv);
        if (!sound.ready || failed) return;
        send({ t: 'vol', m: musicVol, s: sfxVol });
    };

    /* ---- per-frame bookkeeping ---------------------------------------
       The sequencer is NOT driven from here. It runs inside the core off
       sample counts, so a dropped frame cannot make the music stutter and a
       long hitch does not shift the beat. All this does is expire one-shot
       stingers and coalesce crowd changes. */

    sound.update = function (dt) {
        if (!sound.ready || failed) return;
        var d = (typeof dt === 'number' && dt > 0 && dt < 1) ? dt : 1 / 60;
        clock += d;
        if (curPlaying && curOneShot) {
            curElapsed += d;
            if (curElapsed >= curSecs) { curPlaying = false; curTrack = null; }
        }
        if (crowdWant !== crowdSent) {
            var t = nowMs();
            if (t - crowdAt > 90) {
                crowdSent = crowdWant; crowdAt = t;
                send({ t: 'crowd', v: crowdWant });
            }
        }
    };

    /* ---- transport --------------------------------------------------- */

    sound.suspend = function () {
        if (!ctx) return;
        try { if (ctx.state === 'running') ctx.suspend(); } catch (e) { /* ignore */ }
    };

    sound.resume = function () {
        if (!ctx) return;
        try { if (ctx.state !== 'closed') ctx.resume(); } catch (e) { /* ignore */ }
    };

    /* ---- debug surface -----------------------------------------------
       Not part of the game-facing API. `source` and `workletSource` are the
       exact text handed to the Blob, `Core` is the constructor the
       ScriptProcessor path uses, `bank()` compiles and returns the data
       tables, and `warnings` lists every pattern token or instrument name
       the compiler could not resolve — check it after editing the tables. */

    sound._dsp = {
        source: DSP_SOURCE,
        workletSource: WORKLET_SOURCE,
        Core: GenesisCore,
        bank: buildBank,
        warnings: warnings,
        path: 'none',
        state: function () { return engineState; },
        sfxNames: Object.keys(SFX),
        trackNames: Object.keys(TRACKS)
    };

    if (typeof window !== 'undefined') window.sound = sound;
    else if (typeof globalThis !== 'undefined') globalThis.sound = sound;

})();
