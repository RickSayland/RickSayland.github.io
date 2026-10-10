/* =============================================================================
   SLWF - roster.js
   The nine characters, the random generator, the customization store and the
   palette writer.

   Loads after poser.js and BEFORE moves.js, which is why nothing in here
   touches `moves` at parse time: `signature`, `finisher` and the `moveset`
   overrides are plain strings, and the functions that resolve them (random(),
   validate()) run after boot when the whole load order has happened.

   -----------------------------------------------------------------------------
   WHY A CHARACTER IS FIVE COLOURS AND A BODY DESCRIPTION
   -----------------------------------------------------------------------------
   Four palettes of sixteen colours is the entire colour budget (DESIGN.md), and
   two of them are the wrestlers. So there is ONE shared wrestler tileset,
   recoloured per character through `applyPalette`, and a character is five base
   colours plus a `style` record that poser.js reads to change the silhouette.
   Nobody gets their own pixels.

   That makes colour choice load-bearing in a way it would not be otherwise.
   Every channel is three bits -- eight levels, 0x00 0x24 0x49 0x6d 0x92 0xb6
   0xdb 0xff -- so two colours a designer would call clearly different can land
   on the same quantized triple and two wrestlers become the same person. Every
   colour in this file is authored DIRECTLY on that grid so nothing shifts when
   pal.hex() rounds it, and validate() checks that no two characters share a
   quantized (skin, trunk) pair. Character select shows two side by side in
   palettes 1 and 2, so adjacent entries in CHARS matter most of all.

   -----------------------------------------------------------------------------
   THE CHARACTER SCHEMA
   -----------------------------------------------------------------------------
     id          string  lowercase, unique, stable -- saves key off it
     name        string  UPPERCASE, <=12 chars: twelve 8x8 cells is the width of
                         a name plate. RickityCricket does not fit, so `name` is
                         the plate abbreviation and `fullName` carries the name
                         as given.
     fullName    string  the character's name in full, for the VS screen crawl
     nick        string  shown under the name on the VS screen, <=28 chars
     wclass      string  light | cruiser | heavy | super. MUST equal style.build
                         -- one vocabulary, and validate() enforces the match so
                         a "cruiserweight" can never be drawn with a super
                         heavyweight's body.
     heightCm,
     weightKg    int     flavour, shown on character select
     colors      {skin, hair, trunk, boot, accent}  five grid-aligned hex colours
     style       {build, tall, hair, mask, beard, boots}  see below
     stats       {power, speed, stamina, technique}  each 1..10
     moveset     {}      slot overrides, keyed 'set.dir' or 'set.dir.tier'
     signature,
     finisher    string  move ids from moves.TABLE
     taunt       string  entrance line, <=24 chars
     music       1..4    which FM track audio.js plays
     entranceAnim 0..15  which entrance routine ui.js runs
     bio         string  one line

   `style` is poser.js's contract (DESIGN.md):
     build  light | cruiser | heavy | super
     tall   -1 short | 0 average | 1 tall
     hair   0 bald  1 short  2 long  3 ponytail  4 mohawk  5 afro  6 topknot
            7 wild
     mask   0 none  1 full luchador  2 visor  3 face paint
     beard  0 none  1 stubble  2 full
     boots  0 low   1 mid      2 knee

   Nine characters and eight hair styles, so one style repeats (DKS and
   RICKITY C. both wear `hair:1`) -- they are separated by build, beard and
   height instead, which at 48 pixels is a bigger difference than hair anyway.

   -----------------------------------------------------------------------------
   STAT BUDGET
   -----------------------------------------------------------------------------
   Every default character sums to exactly 26 across four stats, so nobody is
   strictly better than anybody and the differences are all SHAPE. The extremes
   are the point: BREE is 10 speed / 4 power, QUASAR is 10 power / 3 speed. A
   generated wrestler draws from the same 26 (roster.BUDGET) with a weight-class
   bias, which is why a random super heavyweight is never fast.
   ============================================================================= */
(function () {
    'use strict';

    var roster = {};

    /* ------------------------------------------------------------- constants */

    roster.SAVE_KEY = 'slwf.roster.v1';
    roster.NAME_MAX = 12;      // 8x8 cells across a name plate
    roster.TAUNT_MAX = 24;
    roster.NICK_MAX = 28;
    roster.BUDGET = 26;      // power + speed + stamina + technique
    roster.STAT_MIN = 3;
    roster.STAT_MAX = 10;

    roster.CLASSES = ['light', 'cruiser', 'heavy', 'super'];
    roster.CLASS_NAMES = {
        light: 'LIGHTWEIGHT',
        cruiser: 'CRUISERWEIGHT',
        heavy: 'HEAVYWEIGHT',
        super: 'SUPER HEAVY'
    };
    roster.STAT_KEYS = ['power', 'speed', 'stamina', 'technique'];
    roster.COLOR_KEYS = ['skin', 'hair', 'trunk', 'boot', 'accent'];

    // Hair/mask/beard/boot style ranges, kept here so the editor and validate()
    // read the same numbers poser.js was written against.
    roster.STYLE_RANGE = {
        build: roster.CLASSES,
        tall: [-1, 1],
        hair: [0, 7],
        mask: [0, 3],
        beard: [0, 2],
        boots: [0, 2]
    };

    /* ------------------------------------------------------- palette writing

       The sixteen wrestler palette slots are a contract -- poser.js writes
       these indices into its pixel arrays, so the meaning of each one is fixed
       (DESIGN.md "Wrestler palette index map"). Five base colours become
       fourteen: skin and trunk get a three-step ramp, hair and boot a two-step,
       and the last four slots are shared across every character.             */

    var IDX = roster.IDX = {
        transparent: 0, outline: 1,
        skinShadow: 2, skin: 3, skinLight: 4,
        hairShadow: 5, hair: 6,
        trunkShadow: 7, trunk: 8, trunkLight: 9,
        bootShadow: 10, boot: 11,
        accent: 12,
        bloodDark: 13, blood: 14, white: 15
    };

    // Ramp amounts for pal.shade: 8.8, so 256 is "unchanged".
    var SHADOW = 150;   // ~0.59x toward black
    var LIGHT = 332;   // ~0.30 of the way toward white

    // Shared across all wrestler palettes. Blood matches the arena's so a
    // bleeding wrestler and the stain he leaves on the canvas are the same red.
    roster.SHARED = {
        outline: '#000000',
        bloodDark: '#920000',
        blood: '#db0000',
        white: '#ffffff'
    };

    // pal.shade() quantizes, and a derived shade can therefore land back on its
    // base: a near-black skin has nowhere darker to go on an eight-level
    // channel, and a near-white one has nowhere lighter. When that happens,
    // nudge every channel one step instead, so a ramp always reads as a ramp
    // after quantization rather than flattening into one colour.
    //
    // A pure black base with dir<0 (or pure white with dir>0) genuinely cannot
    // move; validate() is what keeps a character from choosing one.
    function ramp(base, amt, dir) {
        var d = pal.shade(base, amt);
        if (d[0] !== base[0] || d[1] !== base[1] || d[2] !== base[2]) return d;
        var out = [base[0], base[1], base[2]], moved = false;
        for (var i = 0; i < 3; i++) {
            if (dir < 0 && out[i] > 0) { out[i]--; moved = true; }
            else if (dir > 0 && out[i] < 7) { out[i]++; moved = true; }
        }
        return moved ? out : d;
    }
    roster._ramp = ramp;

    roster.applyPalette = function (palId, char) {
        var c = char && char.colors;
        if (!c) return false;

        var skin = pal.hex(c.skin);
        var hair = pal.hex(c.hair);
        var trunk = pal.hex(c.trunk);
        var boot = pal.hex(c.boot);
        var accent = pal.hex(c.accent);

        // Index 0 is transparent in every palette and never drawn. It is still
        // written so a palette left over from a previous match cannot bleed a
        // stale colour through a tile the renderer thinks is clear.
        pal.set(palId, IDX.transparent, 0, 0, 0);
        pal.setHex(palId, IDX.outline, roster.SHARED.outline);

        pal.setRGB(palId, IDX.skinShadow, ramp(skin, SHADOW, -1));
        pal.setRGB(palId, IDX.skin, skin);
        pal.setRGB(palId, IDX.skinLight, ramp(skin, LIGHT, +1));

        pal.setRGB(palId, IDX.hairShadow, ramp(hair, SHADOW, -1));
        pal.setRGB(palId, IDX.hair, hair);

        pal.setRGB(palId, IDX.trunkShadow, ramp(trunk, SHADOW, -1));
        pal.setRGB(palId, IDX.trunk, trunk);
        pal.setRGB(palId, IDX.trunkLight, ramp(trunk, LIGHT, +1));

        pal.setRGB(palId, IDX.bootShadow, ramp(boot, SHADOW, -1));
        pal.setRGB(palId, IDX.boot, boot);

        pal.setRGB(palId, IDX.accent, accent);

        pal.setHex(palId, IDX.bloodDark, roster.SHARED.bloodDark);
        pal.setHex(palId, IDX.blood, roster.SHARED.blood);
        pal.setHex(palId, IDX.white, roster.SHARED.white);
        return true;
    };

    /* =========================================================================
       THE NINE
       -------------------------------------------------------------------------
       Grid order, which is also the order character select reads left to right,
       two rows of five (the ninth cell is the RANDOM slot ui.js adds). Adjacent
       entries were chosen to contrast: a purple super heavyweight, then a tan
       bruiser, then a masked green flyer, and so on.
       ========================================================================= */

    function defaults() {
        return [

            {
                id: 'quasar',
                name: 'QUASAR', fullName: 'QUASAR',
                nick: 'The Cosmic Collision',
                wclass: 'super',
                heightCm: 206, weightKg: 172,
                // Purple-skinned, cyan-mohawked, indigo-trunked. Nothing else
                // on the roster is in this corner of the colour space.
                colors: { skin: '#6d4992', hair: '#24dbff', trunk: '#2400b6', boot: '#000024', accent: '#ffdb00' },
                style: { build: 'super', tall: 1, hair: 4, mask: 3, beard: 0, boots: 2 },
                stats: { power: 10, speed: 3, stamina: 8, technique: 5 },
                moveset: {
                    'grappleFront.F.s': 'piledriver',
                    'grappleFront.N.s': 'firemansCarry',
                    'strike.U.s': 'headbutt',
                    'sub.N.s': 'camelClutch'
                },
                signature: 'gravityWell', finisher: 'eventHorizon',
                taunt: 'TASTE THE VOID!',
                music: 1, entranceAnim: 0,
                bio: 'Claims to be a dying star. Books himself accordingly.'
            },

            {
                id: 'dks',
                name: 'DKS', fullName: 'DKS',
                nick: 'Three Letters, One Nap',
                wclass: 'heavy',
                heightCm: 188, weightKg: 118,
                colors: { skin: '#db926d', hair: '#492400', trunk: '#920000', boot: '#242424', accent: '#ffffff' },
                style: { build: 'heavy', tall: 0, hair: 1, mask: 0, beard: 2, boots: 1 },
                stats: { power: 8, speed: 4, stamina: 6, technique: 8 },
                moveset: {
                    'grappleFront.F.s': 'brainbuster',
                    'strike.N.s': 'headbutt',
                    'sub.F.s': 'crossFace'
                },
                signature: 'deadlineDrop', finisher: 'dksDriver',
                taunt: 'NO GIMMICK NEEDED.',
                music: 2, entranceAnim: 1,
                bio: 'Refuses to explain the initials. Refuses to lose to anyone who asks.'
            },

            {
                id: 'flye',
                name: 'FLYE', fullName: 'FLYE',
                nick: 'Zero Fear, Zero Brakes',
                wclass: 'cruiser',
                heightCm: 173, weightKg: 79,
                // Full luchador mask, so the trunk green and the orange trim
                // are doing all the identifying work.
                colors: { skin: '#b66d49', hair: '#240024', trunk: '#00db49', boot: '#ffffff', accent: '#ff9200' },
                style: { build: 'cruiser', tall: -1, hair: 0, mask: 1, beard: 0, boots: 0 },
                stats: { power: 4, speed: 9, stamina: 6, technique: 7 },
                moveset: {
                    'aerial.F.s': 'splash450',
                    'aerial.D.s': 'missileDropkick',
                    'strike.U.s': 'kneeStrike'
                },
                signature: 'skyHook', finisher: 'terminalVelocity',
                taunt: 'UP IS A DIRECTION!',
                music: 3, entranceAnim: 2,
                bio: 'Has never once walked down from a turnbuckle.'
            },

            {
                id: 'samantha',
                name: 'SAMANTHA', fullName: 'SAMANTHA',
                nick: 'The Closing Argument',
                wclass: 'cruiser',
                heightCm: 168, weightKg: 68,
                colors: { skin: '#ffb692', hair: '#ffdb24', trunk: '#db0092', boot: '#492449', accent: '#00dbdb' },
                style: { build: 'cruiser', tall: 0, hair: 3, mask: 0, beard: 0, boots: 1 },
                stats: { power: 5, speed: 7, stamina: 5, technique: 9 },
                moveset: {
                    'grappleRear.N.s': 'germanSuplex',
                    'grappleFront.N.s': 'bellyToBelly',
                    'sub.D.s': 'figureFour'
                },
                signature: 'southpawSuplex', finisher: 'lastCallSuplex',
                taunt: 'I STUDIED FOR THIS.',
                music: 2, entranceAnim: 3,
                bio: 'Best technician in the federation. Will tell you so, slowly.'
            },

            {
                id: 'scorp',
                name: 'SCORP', fullName: 'SCORP',
                nick: 'Eight Legs Of Trouble',
                wclass: 'light',
                heightCm: 170, weightKg: 72,
                colors: { skin: '#6d4924', hair: '#002424', trunk: '#49db00', boot: '#242400', accent: '#db00db' },
                style: { build: 'light', tall: -1, hair: 7, mask: 3, beard: 0, boots: 0 },
                stats: { power: 4, speed: 8, stamina: 6, technique: 8 },
                moveset: {
                    'sub.N.w': 'crossFace',
                    'aerial.N.w': 'moonsault',
                    'strike.B.s': 'kneeStrike'
                },
                signature: 'stingerSplash', finisher: 'venomClutch',
                taunt: 'HOLD STILL. IT STINGS.',
                music: 4, entranceAnim: 4,
                bio: 'Paints a different arachnid on his face every show. None of them are scorpions.'
            },

            {
                id: 'sharon',
                name: 'SHARON', fullName: 'SHARON',
                nick: 'Quarterly Earnings',
                wclass: 'heavy',
                heightCm: 183, weightKg: 102,
                colors: { skin: '#ffdbb6', hair: '#490024', trunk: '#000092', boot: '#6d6d92', accent: '#ffdb00' },
                style: { build: 'heavy', tall: 1, hair: 2, mask: 0, beard: 0, boots: 2 },
                stats: { power: 9, speed: 4, stamina: 7, technique: 6 },
                moveset: {
                    'grappleFront.N.s': 'firemansCarry',
                    'grappleRear.N.s': 'fullNelsonSlam',
                    'strike.F.s': 'bigBoot'
                },
                signature: 'boardroomBomb', finisher: 'glassCeiling',
                taunt: 'YOU ARE A LINE ITEM.',
                music: 1, entranceAnim: 5,
                bio: 'Owns thirty percent of the federation and wrestles anyway.'
            },

            {
                id: 'spoopy',
                name: 'SPOOPY', fullName: 'SPOOPY',
                nick: 'Mostly Harmless, Mostly',
                wclass: 'cruiser',
                heightCm: 180, weightKg: 81,
                colors: { skin: '#dbdbff', hair: '#242449', trunk: '#240049', boot: '#000024', accent: '#92ff92' },
                style: { build: 'cruiser', tall: 1, hair: 6, mask: 3, beard: 0, boots: 0 },
                stats: { power: 5, speed: 7, stamina: 7, technique: 7 },
                moveset: {
                    'grappleFront.N.s': 'ddt',
                    'aerial.N.w': 'divingHeadbutt',
                    'strike.N.s': 'headbutt'
                },
                signature: 'poltergeistPlunge', finisher: 'nightTerror',
                taunt: 'BOO. ALSO, OW.',
                music: 4, entranceAnim: 6,
                bio: 'Insists the gimmick is not a gimmick. Casts no shadow, allegedly.'
            },

            {
                id: 'bree',
                name: 'BREE', fullName: 'BREE',
                nick: 'Category Five',
                wclass: 'light',
                heightCm: 165, weightKg: 61,
                colors: { skin: '#926d49', hair: '#db4900', trunk: '#00b6db', boot: '#ffdbdb', accent: '#db0000' },
                style: { build: 'light', tall: -1, hair: 5, mask: 0, beard: 0, boots: 0 },
                stats: { power: 4, speed: 10, stamina: 6, technique: 6 },
                moveset: {
                    'run.N.w': 'runningKnee',
                    'run.D.s': 'crossBody',
                    'strike.F.s': 'spinningBackfist'
                },
                signature: 'breezeBlock', finisher: 'hurricaneBree',
                taunt: 'CATCH ME. GO ON.',
                music: 3, entranceAnim: 7,
                bio: 'Fastest wrestler on the card. Loses on purpose to nobody, wins on purpose to everybody.'
            },

            {
                id: 'rickitycricket',
                // "RICKITYCRICKET" is fourteen characters and a name plate is
                // twelve cells wide, so the plate shows the abbreviation and
                // `fullName` keeps the name as given.
                name: 'RICKITY C.', fullName: 'RICKITYCRICKET',
                nick: 'Bowled Over Since 1987',
                wclass: 'light',
                heightCm: 176, weightKg: 74,
                colors: { skin: '#b69249', hair: '#6d2400', trunk: '#ffffff', boot: '#492400', accent: '#db0049' },
                style: { build: 'light', tall: 0, hair: 1, mask: 0, beard: 1, boots: 1 },
                stats: { power: 5, speed: 7, stamina: 6, technique: 8 },
                moveset: {
                    'weapon.F.s': 'chairShotHead',
                    'strike.U.s': 'bigBoot',
                    'sub.D.w': 'ankleLock'
                },
                signature: 'cricketKick', finisher: 'theLastWicket',
                taunt: 'THAT IS NOT CRICKET!',
                music: 2, entranceAnim: 8,
                bio: 'Wrestles in cricket whites. Has never explained the rules to anyone.'
            }
        ];
    }

    roster.DEFAULTS = defaults;

    /* ------------------------------------------------------------- the store

       CHARS is the live grid, `custom` is anything created beyond the nine
       (random wrestlers the player kept, editor creations). The save deliberately
       stores only the FIELDS roster.update changed, not whole characters: a
       later release that retunes QUASAR's stats then reaches a player who had
       only recoloured his trunks. A full snapshot would freeze him forever on
       whatever the defaults were the day he first opened the editor.         */

    roster.CHARS = defaults();
    roster.custom = [];
    var edits = {};          // { "<index>": { field: value, ... } }

    function clone(v) {
        if (Array.isArray(v)) return v.map(clone);
        if (v && typeof v === 'object') {
            var o = {}, k;
            for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = clone(v[k]);
            return o;
        }
        return v;
    }
    roster._clone = clone;

    roster.count = function () { return roster.CHARS.length + roster.custom.length; };

    roster.all = function () { return roster.CHARS.concat(roster.custom); };

    roster.get = function (key) {
        if (typeof key === 'number') {
            if (key >= 0 && key < roster.CHARS.length) return roster.CHARS[key];
            var j = key - roster.CHARS.length;
            return (j >= 0 && j < roster.custom.length) ? roster.custom[j] : null;
        }
        var list = roster.all();
        for (var i = 0; i < list.length; i++) if (list[i].id === key) return list[i];
        return null;
    };

    roster.indexOf = function (key) {
        var list = roster.all();
        for (var i = 0; i < list.length; i++) {
            if (list[i] === key || list[i].id === key) return i;
        }
        return -1;
    };

    // Edit one field (or one nested field, 'colors.trunk' / 'stats.power') of
    // one character. Records the edit so save() can persist it alone.
    roster.update = function (index, patch) {
        var ch = roster.get(index);
        if (!ch || !patch || typeof patch !== 'object') return false;

        var rec = null;
        if (typeof index === 'number' && index < roster.CHARS.length) {
            rec = edits[index] || (edits[index] = {});
        }

        Object.keys(patch).forEach(function (key) {
            var v = patch[key], dot = key.indexOf('.');
            if (dot > 0) {
                var head = key.substring(0, dot), tail = key.substring(dot + 1);
                if (ch[head] && typeof ch[head] === 'object') {
                    ch[head][tail] = v;
                    if (rec) {
                        if (!rec[head] || typeof rec[head] !== 'object') rec[head] = {};
                        rec[head][tail] = v;
                    }
                }
            } else {
                ch[key] = clone(v);
                if (rec) rec[key] = clone(v);
            }
        });
        return true;
    };

    roster.reset = function () {
        roster.CHARS = defaults();
        roster.custom = [];
        edits = {};
    };

    function applyEdits() {
        Object.keys(edits).forEach(function (k) {
            var i = parseInt(k, 10);
            var ch = roster.CHARS[i];
            if (!ch) return;
            var rec = edits[k];
            Object.keys(rec).forEach(function (f) {
                var v = rec[f];
                if (v && typeof v === 'object' && !Array.isArray(v) &&
                    ch[f] && typeof ch[f] === 'object') {
                    Object.keys(v).forEach(function (sub) { ch[f][sub] = v[sub]; });
                } else {
                    ch[f] = clone(v);
                }
            });
        });
    }

    /* --------------------------------------------------------- save and load

       localStorage can be absent (a file:// page with storage disabled), full,
       or hold whatever a previous version or a curious player left in it. None
       of those may throw during boot -- a corrupt save must cost the player
       their custom wrestlers and nothing else, silently, with the nine defaults
       still on screen.                                                        */

    function store() {
        try {
            if (typeof localStorage === 'undefined' || !localStorage) return null;
            return localStorage;
        } catch (e) { return null; }   // some browsers throw on mere access
    }

    roster.save = function () {
        var ls = store();
        if (!ls) return false;
        try {
            ls.setItem(roster.SAVE_KEY, JSON.stringify({
                v: 1, edits: edits, custom: roster.custom
            }));
            return true;
        } catch (e) { return false; }  // quota, private mode -- not fatal
    };

    roster.load = function () {
        roster.CHARS = defaults();
        roster.custom = [];
        edits = {};

        var ls = store();
        if (!ls) return false;

        var raw;
        try { raw = ls.getItem(roster.SAVE_KEY); } catch (e) { return false; }
        if (!raw || typeof raw !== 'string') return false;

        var data;
        try { data = JSON.parse(raw); } catch (e) { return false; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
        if (data.v !== 1) return false;

        if (data.edits && typeof data.edits === 'object' && !Array.isArray(data.edits)) {
            Object.keys(data.edits).forEach(function (k) {
                var rec = data.edits[k];
                if (/^\d+$/.test(k) && rec && typeof rec === 'object' && !Array.isArray(rec)) {
                    edits[k] = clone(rec);
                }
            });
        }
        if (Array.isArray(data.custom)) {
            data.custom.forEach(function (c) {
                // Only keep something that at least looks like a character.
                if (c && typeof c === 'object' && typeof c.id === 'string' &&
                    c.colors && c.stats && c.style) {
                    roster.custom.push(clone(c));
                }
            });
        }

        try { applyEdits(); } catch (e) { roster.CHARS = defaults(); edits = {}; }
        return true;
    };

    /* =========================================================================
       RANDOM GENERATION
       -------------------------------------------------------------------------
       Everything here draws from core.rndf() after core.seed(seed), so a seed
       reproduces a wrestler exactly -- same name, same colours, same stats,
       same finisher. That is what makes a generated rumble card replayable and
       what lets the check harness test the generator at all.

       No Math.random anywhere in this file.
       ========================================================================= */

    // Syllables. Deliberately short: a name must survive at 12 characters and a
    // wrestling name is better blunt than clever.
    roster.NAME_PARTS = {
        first: ['BRIX', 'VOLT', 'KANE', 'RUSK', 'TORQ', 'GRIM', 'JAX', 'ZED',
            'MAUL', 'CLAW', 'HEX', 'BOLT', 'RAZE', 'DUKE', 'SPIKE', 'FANG',
            'GLOOM', 'TANK', 'PIPE', 'SLAB', 'WREN', 'NOVA', 'HUSK', 'CRUX'],
        second: ['IRON', 'STEEL', 'STONE', 'FIST', 'BONE', 'HAMMER', 'JAW',
            'SPINE', 'HIDE', 'RIOT', 'CRASH', 'GRIND', 'BLAST', 'WRECK',
            'QUAKE', 'THORN', 'VOID', 'SLAM', 'DREAD', 'FURY'],
        prefix: ['BIG', 'MAD', 'OLD', 'WEE', 'LIL', 'DOC', 'SIR', 'CPT'],
        title: ['The Unlicensed', 'The Last Honest Man', 'Mostly Legal',
            'Two Time Something', 'The Human Suplex', 'Doctor Of Pain',
            'Barely Insured', 'The Reasonable Option', 'Nobody Asked',
            'The Walking Receipt', 'Still Undefeated*', 'King Of Nowhere',
            'The Polite Problem', 'Local Hero, Probably', 'The Tax Write-Off',
            'Loud And Incorrect', 'Technically A Wrestler'],
        taunt: ['GET IN THE RING!', 'I AM NOT TIRED!', 'THIS IS MY HOUSE!',
            'NOBODY LIKES YOU!', 'I BROUGHT A CHAIR.', 'READ THE SIGN!',
            'YOU ARE NEXT!', 'I DO THIS FOR FUN.', 'WRONG NIGHT, PAL.',
            'TELL THEM I SAID HI.', 'STAY DOWN. PLEASE.', 'MY TURN!'],
        bio: ['Trained in a car park. It shows.',
            'Undefeated in matches nobody filmed.',
            'Has a finisher and absolutely no plan B.',
            'Once wrestled a ladder to a draw.',
            'Sells merchandise out of a cooler.',
            'Claims a forty match win streak. Cannot name one opponent.',
            'Signed the contract without reading it.',
            'Brings their own referee. It never works.',
            'Says the gimmick writes itself. It does not.']
    };

    // Grid-aligned colour pools, one per role. Every entry is already on the
    // 3-bit grid so pal.hex() is a no-op and nothing a generator picks can
    // quantize into a neighbour's colour by surprise.
    var POOL = roster.COLOR_POOL = {
        skin: ['#ffdbb6', '#ffb692', '#db926d', '#b66d49', '#926d49', '#6d4924',
            '#492400', '#dbdbff', '#b6db92', '#6d4992', '#92b6db', '#db6d6d'],
        hair: ['#000000', '#242400', '#492400', '#6d2400', '#db4900', '#ffdb24',
            '#ffffff', '#24dbff', '#db00db', '#00db49', '#242449', '#920000'],
        trunk: ['#db0000', '#0049db', '#00db49', '#ffdb00', '#db00db', '#00dbdb',
            '#ff9200', '#920092', '#2400b6', '#49db00', '#ffffff', '#242424',
            '#db0092', '#006d24', '#b66d00', '#000092'],
        boot: ['#000000', '#242424', '#ffffff', '#920000', '#0049db', '#ffdb00',
            '#6d6d92', '#492400', '#db00db', '#00db49'],
        accent: ['#ffffff', '#ffdb00', '#db0000', '#00dbdb', '#ff9200', '#92ff92',
            '#db00db', '#0049db', '#b6b6b6', '#ffdbdb']
    };

    function rpick(arr) { return arr[(core.rndf() * arr.length) | 0]; }
    function rint(a, b) { return a + ((core.rndf() * (b - a + 1)) | 0); }

    function sameRGB(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

    // Draw a colour from a pool that does not quantize onto any of `avoid`.
    // The pools are big enough that this converges immediately; the counter is
    // there so a shrunken pool cannot hang the boot.
    function pickColor(poolName, avoid) {
        var pool = POOL[poolName];
        for (var tries = 0; tries < 24; tries++) {
            var h = rpick(pool), c = pal.hex(h), ok = true;
            for (var i = 0; i < avoid.length; i++) {
                if (sameRGB(c, avoid[i])) { ok = false; break; }
            }
            if (ok) return h;
        }
        return pool[0];
    }

    // Weight-class shape. Each class gets a floor on the stat it is defined by
    // and a ceiling on the one it is not, then the remaining budget is spread
    // at random -- so two random heavyweights differ without either becoming a
    // fast heavyweight, which would make the class meaningless.
    var CLASS_SHAPE = {
        light: { power: [3, 5], speed: [8, 10], stamina: [4, 7], technique: [5, 9], h: [160, 175], w: [58, 80] },
        cruiser: { power: [4, 7], speed: [6, 9], stamina: [5, 8], technique: [5, 9], h: [168, 184], w: [75, 95] },
        heavy: { power: [7, 9], speed: [3, 6], stamina: [5, 8], technique: [4, 8], h: [180, 196], w: [98, 130] },
        super: { power: [9, 10], speed: [3, 4], stamina: [6, 9], technique: [3, 6], h: [195, 215], w: [140, 200] }
    };

    function makeStats(wclass) {
        var shape = CLASS_SHAPE[wclass] || CLASS_SHAPE.cruiser;
        var keys = roster.STAT_KEYS, s = {}, i, k;

        // Start every stat at its class floor, then hand out what is left of
        // the budget one point at a time to whichever stats can still take it.
        var sum = 0;
        for (i = 0; i < keys.length; i++) {
            k = keys[i];
            s[k] = shape[k][0];
            sum += s[k];
        }

        var guard = 0;
        while (sum < roster.BUDGET && guard++ < 200) {
            k = keys[(core.rndf() * keys.length) | 0];
            if (s[k] < shape[k][1] && s[k] < roster.STAT_MAX) { s[k]++; sum++; }
            else {
                // Nothing in the preferred range can take it; widen to the hard
                // cap so the budget is always spent exactly.
                var any = false;
                for (i = 0; i < keys.length; i++) {
                    if (s[keys[i]] < roster.STAT_MAX) { any = true; break; }
                }
                if (!any) break;
            }
        }
        // Over budget (a class whose floors already sum past it) -- shave from
        // whatever is furthest above its own floor.
        guard = 0;
        while (sum > roster.BUDGET && guard++ < 200) {
            var best = null, bestSlack = 0;
            for (i = 0; i < keys.length; i++) {
                k = keys[i];
                var slack = s[k] - Math.max(shape[k][0], roster.STAT_MIN);
                if (slack > bestSlack) { bestSlack = slack; best = k; }
            }
            if (!best) break;
            s[best]--; sum--;
        }
        return s;
    }

    function makeName(used) {
        var p = roster.NAME_PARTS, n;
        for (var tries = 0; tries < 40; tries++) {
            var roll = core.rndf();
            if (roll < 0.45) n = rpick(p.first) + rpick(p.second);
            else if (roll < 0.70) n = rpick(p.prefix) + ' ' + rpick(p.first);
            else if (roll < 0.90) n = rpick(p.first);
            else n = rpick(p.second) + rpick(p.first);

            if (n.length <= roster.NAME_MAX && (!used || used.indexOf(n) < 0)) return n;
        }
        // Fall back to something that is always short enough and always unique.
        return rpick(p.first).substring(0, 6) + rint(10, 99);
    }

    // A fully-formed wrestler. `seed` reseeds the shared stream; pass it on the
    // first call of a batch and leave it off for the rest (randomRoster does
    // exactly that) so a run of wrestlers is one reproducible sequence.
    roster.random = function (seed, opts) {
        if (seed !== undefined && seed !== null) core.seed(seed);
        opts = opts || {};

        var wclass = opts.wclass || rpick(roster.CLASSES);
        var shape = CLASS_SHAPE[wclass] || CLASS_SHAPE.cruiser;

        var name = makeName(opts.used);
        var id = 'rnd_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '_' +
            ((core.rndf() * 0x10000) | 0).toString(16);

        var skin = pickColor('skin', []);
        var skinQ = pal.hex(skin);
        var trunk = pickColor('trunk', [skinQ]);
        var trunkQ = pal.hex(trunk);
        var hair = pickColor('hair', [skinQ]);
        var boot = pickColor('boot', [trunkQ]);
        var accent = pickColor('accent', [trunkQ]);

        var mask = core.rndf() < 0.22 ? rint(1, 3) : 0;

        var ch = {
            id: id,
            name: name, fullName: name,
            nick: rpick(roster.NAME_PARTS.title),
            wclass: wclass,
            heightCm: rint(shape.h[0], shape.h[1]),
            weightKg: rint(shape.w[0], shape.w[1]),
            colors: { skin: skin, hair: hair, trunk: trunk, boot: boot, accent: accent },
            style: {
                build: wclass,
                tall: rint(-1, 1),
                // A full luchador mask covers the hair, so do not also roll a
                // mohawk underneath it -- poser.js would draw both.
                hair: mask === 1 ? 0 : rint(0, 7),
                mask: mask,
                beard: wclass === 'light' ? rint(0, 1) : rint(0, 2),
                boots: rint(0, 2)
            },
            stats: makeStats(wclass),
            moveset: {},
            signature: null, finisher: null,
            taunt: rpick(roster.NAME_PARTS.taunt),
            music: rint(1, 4),
            entranceAnim: rint(0, 15),
            bio: rpick(roster.NAME_PARTS.bio),
            generated: true
        };

        // Signature and finisher come out of moves.TABLE filtered by weight
        // class, which is why moves carries a `classes` field at all. moves.js
        // loads after this file, so this is a runtime lookup, not a parse-time
        // one -- and a caller who somehow runs before it gets nulls rather than
        // an exception.
        if (window.moves && moves.forClass) {
            var sigs = moves.forClass('signature', wclass);
            var fins = moves.forClass('finisher', wclass);
            if (sigs.length) ch.signature = sigs[(core.rndf() * sigs.length) | 0];
            if (fins.length) ch.finisher = fins[(core.rndf() * fins.length) | 0];

            // One or two slot overrides so a generated wrestler does not play
            // like the shared default set. Drawn from the moves that are NOT in
            // moves.SETS plus a few that are, keyed by what the class is good at.
            var flavour = {
                light: [['aerial.N.w', 'moonsault'], ['run.N.w', 'runningKnee'], ['sub.F.s', 'figureFour']],
                cruiser: [['aerial.F.s', 'splash450'], ['grappleFront.N.s', 'ddt'], ['strike.B.s', 'kneeStrike']],
                heavy: [['grappleFront.F.s', 'brainbuster'], ['grappleRear.N.s', 'fullNelsonSlam'], ['strike.N.s', 'headbutt']],
                super: [['grappleFront.F.s', 'piledriver'], ['grappleFront.N.s', 'firemansCarry'], ['strike.U.s', 'bigBoot']]
            }[wclass] || [];
            var n = rint(1, 2);
            for (var i = 0; i < n && flavour.length; i++) {
                var pickIdx = (core.rndf() * flavour.length) | 0;
                var entry = flavour[pickIdx];
                if (moves.has(entry[1]) && moves.isSlot(entry[0])) ch.moveset[entry[0]] = entry[1];
            }
        }

        return ch;
    };

    // n wrestlers from one seed, with their names kept distinct. Used by the
    // rumble card generator and by the editor's "surprise me" button.
    roster.randomRoster = function (n, seed) {
        if (seed !== undefined && seed !== null) core.seed(seed);
        var out = [], used = [];
        n = Math.max(0, n | 0);
        for (var i = 0; i < n; i++) {
            var ch = roster.random(undefined, { used: used });
            used.push(ch.name);
            out.push(ch);
        }
        return out;
    };

    /* =========================================================================
       VALIDATION
       -------------------------------------------------------------------------
       Returns a list of human-readable problems; empty means the roster is
       coherent. The check harness calls this, and so does the editor after
       every save, because a character with a bad move id is a crash in the
       middle of a match rather than a warning at boot.

       `chars` defaults to the live roster plus customs.
       ========================================================================= */

    roster.validate = function (chars) {
        var list = chars || roster.all();
        var bad = [];
        var seenId = {}, seenName = {}, seenPair = {};

        function err(who, msg) { bad.push(who + ': ' + msg); }

        function checkHex(who, field, h) {
            if (typeof h !== 'string' || !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(h)) {
                err(who, field + ' is not a hex colour ("' + h + '")');
                return null;
            }
            return pal.hex(h);
        }

        list.forEach(function (ch, i) {
            var who = (ch && ch.id) ? ch.id : ('#' + i);

            if (!ch || typeof ch !== 'object') { bad.push(who + ': not an object'); return; }

            /* identity */
            if (typeof ch.id !== 'string' || !/^[a-z0-9_]+$/.test(ch.id)) {
                err(who, 'id must be lowercase alphanumeric');
            } else if (seenId[ch.id]) err(who, 'duplicate id');
            else seenId[ch.id] = 1;

            if (typeof ch.name !== 'string' || !ch.name.length) err(who, 'missing name');
            else {
                if (ch.name.length > roster.NAME_MAX) {
                    err(who, 'name "' + ch.name + '" is ' + ch.name.length +
                        ' chars, max ' + roster.NAME_MAX);
                }
                if (ch.name !== ch.name.toUpperCase()) err(who, 'name must be uppercase');
                if (seenName[ch.name]) err(who, 'duplicate name "' + ch.name + '"');
                else seenName[ch.name] = 1;
            }

            if (ch.nick !== undefined && typeof ch.nick === 'string' &&
                ch.nick.length > roster.NICK_MAX) {
                err(who, 'nick is ' + ch.nick.length + ' chars, max ' + roster.NICK_MAX);
            }
            if (typeof ch.taunt !== 'string' || !ch.taunt.length) err(who, 'missing taunt');
            else if (ch.taunt.length > roster.TAUNT_MAX) {
                err(who, 'taunt is ' + ch.taunt.length + ' chars, max ' + roster.TAUNT_MAX);
            }

            /* weight class, and the one invariant that keeps it honest */
            if (roster.CLASSES.indexOf(ch.wclass) < 0) {
                err(who, 'unknown wclass "' + ch.wclass + '"');
            }
            if (!ch.style || typeof ch.style !== 'object') {
                err(who, 'missing style');
            } else {
                var st = ch.style, R = roster.STYLE_RANGE;
                if (R.build.indexOf(st.build) < 0) err(who, 'unknown style.build "' + st.build + '"');
                else if (st.build !== ch.wclass) {
                    err(who, 'style.build "' + st.build + '" does not match wclass "' + ch.wclass + '"');
                }
                ['tall', 'hair', 'mask', 'beard', 'boots'].forEach(function (f) {
                    var v = st[f], r = R[f];
                    if (typeof v !== 'number' || (v | 0) !== v) err(who, 'style.' + f + ' is not an integer');
                    else if (v < r[0] || v > r[1]) {
                        err(who, 'style.' + f + ' ' + v + ' out of range ' + r[0] + '..' + r[1]);
                    }
                });
            }

            if (typeof ch.heightCm !== 'number' || ch.heightCm < 120 || ch.heightCm > 260) {
                err(who, 'heightCm out of range 120..260');
            }
            if (typeof ch.weightKg !== 'number' || ch.weightKg < 40 || ch.weightKg > 300) {
                err(who, 'weightKg out of range 40..300');
            }
            if (typeof ch.music !== 'number' || ch.music < 1 || ch.music > 4) {
                err(who, 'music must be 1..4');
            }
            if (typeof ch.entranceAnim !== 'number' || ch.entranceAnim < 0 || ch.entranceAnim > 15) {
                err(who, 'entranceAnim must be 0..15');
            }
            if (typeof ch.bio !== 'string' || !ch.bio.length) err(who, 'missing bio');

            /* stats */
            if (!ch.stats || typeof ch.stats !== 'object') err(who, 'missing stats');
            else {
                roster.STAT_KEYS.forEach(function (k) {
                    var v = ch.stats[k];
                    if (typeof v !== 'number' || (v | 0) !== v) err(who, 'stats.' + k + ' is not an integer');
                    else if (v < 1 || v > roster.STAT_MAX) {
                        err(who, 'stats.' + k + ' ' + v + ' out of range 1..' + roster.STAT_MAX);
                    }
                });
            }

            /* colours -- the part that decides whether two wrestlers are the
               same person once the hardware has had its three bits per channel */
            if (!ch.colors || typeof ch.colors !== 'object') {
                err(who, 'missing colors');
            } else {
                var q = {};
                roster.COLOR_KEYS.forEach(function (k) {
                    q[k] = checkHex(who, 'colors.' + k, ch.colors[k]);
                });
                if (q.skin && q.trunk) {
                    if (sameRGB(q.skin, q.trunk)) {
                        err(who, 'skin and trunk quantize to the same colour');
                    }
                    var pair = q.skin.join(',') + '/' + q.trunk.join(',');
                    if (seenPair[pair] !== undefined) {
                        err(who, 'skin+trunk pair is identical to "' + seenPair[pair] +
                            '" after 9-bit quantization');
                    } else seenPair[pair] = ch.name || who;
                }
                if (q.skin && q.hair && sameRGB(q.skin, q.hair)) {
                    err(who, 'skin and hair quantize to the same colour');
                }
                if (q.trunk && q.boot && sameRGB(q.trunk, q.boot)) {
                    err(who, 'trunk and boot quantize to the same colour');
                }
                // A pure black or pure white base has no room for its ramp, and
                // the figure loses its shading entirely.
                ['skin', 'trunk'].forEach(function (k) {
                    var c = q[k];
                    if (!c) return;
                    if (c[0] === 0 && c[1] === 0 && c[2] === 0) {
                        err(who, 'colors.' + k + ' is pure black -- no shadow ramp is possible');
                    }
                });
            }

            /* moves. moves.js loads after this file, so these checks only run
               once the whole load order has happened -- which is every real
               call site, main.js and the harness both. */
            if (window.moves) {
                ['signature', 'finisher'].forEach(function (f) {
                    var id = ch[f];
                    if (typeof id !== 'string' || !id.length) err(who, 'missing ' + f);
                    else if (!moves.has(id)) err(who, f + ' "' + id + '" is not in moves.TABLE');
                    else {
                        var m = moves.get(id);
                        var tags = m.tags || [];
                        if (tags.indexOf(f) < 0) {
                            err(who, f + ' "' + id + '" is not tagged "' + f + '"');
                        }
                        if (m.classes && ch.wclass && m.classes.indexOf(ch.wclass) < 0) {
                            err(who, f + ' "' + id + '" is not legal for a ' + ch.wclass);
                        }
                    }
                });
                if (ch.moveset !== undefined) {
                    if (typeof ch.moveset !== 'object' || ch.moveset === null || Array.isArray(ch.moveset)) {
                        err(who, 'moveset is not an object');
                    } else {
                        Object.keys(ch.moveset).forEach(function (key) {
                            if (!moves.isSlot(key)) {
                                err(who, 'moveset key "' + key + '" is not a moves.SETS slot');
                            }
                            var id = ch.moveset[key];
                            if (typeof id !== 'string' || !moves.has(id)) {
                                err(who, 'moveset["' + key + '"] = "' + id + '" is not in moves.TABLE');
                            }
                        });
                    }
                }
            }
        });

        return bad;
    };

    /* ------------------------------------------------------------------ boot

       main.js calls this once, after moves.js exists. Kept separate from
       load() so the harness can test the storage paths on their own.         */

    roster.init = function () {
        roster.load();
        return roster;
    };

    window.roster = roster;
})();
