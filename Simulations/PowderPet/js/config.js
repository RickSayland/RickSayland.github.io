// config.js -- every tunable number in the toy lives here.
//
// Units, so the numbers below can be read:
//   length       cells (one grid cell)
//   time         seconds; the simulation ticks at SIM.HZ and the soft body
//                takes SOFT.SUBSTEPS substeps inside each tick
//   mass         arbitrary "particle units" (a meat particle is 1)
//   compliance   XPBD alpha = 1/k, i.e. cells per unit force. Zero is rigid.
//   temperature  degrees C
//   mu           radiation interaction probability per cell of path (1/cell)
//   dose         arbitrary units; thresholds are in DOSE below
//
// Nothing outside this file should contain a magic constant that changes how
// the toy plays. Genes do not live in physical units: each is a float in
// [0,1] and GENES maps it onto a range from this file.

export const VERSION = '0.1.0';
export const SAVE_VERSION = 1;
export const GENOME_VERSION = '1';

export const TISSUE = Object.freeze({ BONE: 0, MEAT: 1, BLOOD: 2, SKIN: 3 });
export const TISSUE_NAMES = ['bone', 'meat', 'blood', 'skin'];

// Radiation types. A neutron also carries a fast/thermal flag, so the
// per-material mu table has five columns: the four types, with the neutron
// split in two.
export const RT = Object.freeze({ ALPHA: 0, BETA: 1, GAMMA: 2, NEUTRON: 3 });
export const COL = Object.freeze({ ALPHA: 0, BETA: 1, GAMMA: 2, NFAST: 3, NTHERM: 4 });

export const STAGE = Object.freeze({ NONE: 0, EGG: 1, BABY: 2, CHILD: 3, ADULT: 4, ELDER: 5, DEAD: 6 });
export const STAGE_NAMES = ['none', 'Egg', 'Baby', 'Child', 'Adult', 'Elder', 'Dead'];

export const AI = Object.freeze({
    IDLE: 0, WANDER: 1, SEEK_FOOD: 2, EAT: 3, SLEEP: 4, PLAY: 5,
    SEEK_WARMTH: 6, SEEK_COOL: 7, FLEE_RADIATION: 8, LAY_EGG: 9, DISTRESSED: 10,
});
export const AI_NAMES = ['idle', 'wandering', 'looking for food', 'eating', 'asleep', 'playing',
    'seeking warmth', 'cooling off', 'fleeing radiation', 'laying an egg', 'distressed'];

export const CFG = {

    // ------------------------------------------------------------------ grid
    GRID: {
        W: 200,
        H: 150,
        AMBIENT: 22,            // air temperature the tank relaxes to
        LIQUID_SPREAD: 5,       // max cells a liquid slides sideways per tick
        DRAIN_TRIES: 1,         // columns the drain samples per tick
        DRAIN_CHANCE: 0.16,     // chance a sampled water cell is removed
        EVAP_CHANCE: 3e-5,      // per tick, for a water cell open to the air
        TERRAIN_BASE: 26,       // sand depth at world generation
        TERRAIN_AMP: 5,         // height of the dunes
        GLOW_T0: 260,           // temperature at which a cell starts to glow
        GLOW_T1: 1500,          // ...and at which it is white hot
        BOIL: 100,
        CONDENSE: 90,
        WASTE_DISSOLVE: 0.03,   // per tick, for waste touching water
    },

    SIM: {
        HZ: 30,
        MAX_TICKS_PER_FRAME: 3, // catch-up cap, so a stalled tab cannot spiral
    },

    // ------------------------------------------------------------- radiation
    RAD: {
        CAP: 4000,              // energy particle pool
        THROTTLE_AT: 0.7,       // pool fraction where emission starts scaling down
        // cells per tick, indexed by COL
        SPEED: [0.55, 2.4, 6.0, 3.2, 1.1],
        // energy carried at birth, indexed by RT (roughly MeV)
        ENERGY: [5.0, 1.0, 1.2, 2.0],
        E_THERMAL: 0.15,        // what a thermalised neutron is left with
        LIFE_TICKS: [60, 240, 300, 700],
        HEAT_PER_E: 0.8,        // deg C deposited in a cell per unit energy absorbed
        FISSION_HEAT: 90,       // deg C into the cell that fissioned
        FISSION_GAMMA: 0.7,     // chance a fission also emits a gamma
        SCATTER_KEEP_BETA: 0.55,   // energy fraction kept through a scatter
        SCATTER_KEEP_GAMMA: 0.6,
        GAMMA_CUTOFF: 0.15,     // below this a scattered gamma is just absorbed
        FIELD_CELL: 4,          // dose-rate field resolution, in grid cells
        FIELD_DECAY: 0.9,       // per tick: the field is an exponential average
        // how much each column counts toward the dose-rate field
        FIELD_WEIGHT: [1.0, 1.0, 1.0, 2.0, 1.0],
        // additive render colours (r, g, b), indexed by COL
        COLOR: [[255, 170, 40], [60, 230, 255], [225, 200, 255], [150, 190, 255], [90, 130, 230]],
    },

    // ------------------------------------------------------------- soft body
    SOFT: {
        SUBSTEPS: 8,
        GRAVITY: 62,            // cells / s^2
        DAMPING: 0.45,          // 1/s, mild velocity damping
        MAX_SPEED: 260,         // cells / s, a safety clamp and nothing else
        // base masses per tissue, indexed by TISSUE
        MASS: [3.2, 1.0, 0.8, 0.55],
        // base XPBD compliances. The genome multiplies bone / meat / skin.
        ALPHA_BONE: 2e-8,
        // Meat is soft on the scale of the animal's own weight: it sags a few
        // percent just standing there, which is what makes a load on its
        // back, or a landing, visibly flatten it.
        ALPHA_MEAT: 1.3e-3,
        ALPHA_MEAT_BONE: 1.0e-3,
        ALPHA_SKIN: 1.8e-4,
        ALPHA_SKIN_BEND: 1.8e-3,
        ALPHA_SPOKE: 7e-4,      // skin is tied to the flesh more firmly than flesh to itself
        ALPHA_FOOT: 3e-5,
        // A muscle has tone. Working, it is nearly as stiff as bone, which is
        // what lets a foot shove the animal along; relaxed, it gives, which
        // is most of the squash when the animal lands or is sat on.
        ALPHA_MUSCLE: 1.2e-5,
        ALPHA_MUSCLE_RELAXED: 1.0e-3,
        YOUNG_FIRM: 1.5,        // tissue compliance scales with (growth scale)^this
        ALPHA_AREA: 0.05,       // not quite incompressible: weight on its back flattens it
        // shape matching: bone is a rigid body, the whole animal only leans
        // back toward its rest shape
        ALPHA_SHAPE_BONE: 3e-8,
        ALPHA_SHAPE_BODY: 2.5e-3,
        // blood
        BLOOD_R: 1.45,          // repulsion radius between blood particles
        BLOOD_COHESION_R: 2.5,
        BLOOD_REPEL: 0.5,       // fraction of the overlap removed per substep
        BLOOD_COHERE: 0.012,
        BLOOD_WALL: 0.8,        // how far inside the skin blood is kept
        GRAB_ALPHA: 1.5e-4,     // the mouse spring
    },

    // ---------------------------------------------------- body generation
    BODY: {
        HALF_HEIGHT: 9.0,       // adult half-height in cells at size gene = 1
        SKIN_SPACING: 2.4,      // target skin edge length on an adult
        SKIN_MIN: 24, SKIN_MAX: 40,
        MEAT_SPACING: 2.85,     // hex lattice pitch on an adult
        MEAT_BABY_FRAC: 0.34,   // share of the lattice present at hatching
        MEAT_MARGIN: 0.5,       // lattice stays this many pitches off the skin
        BLOOD_COUNT: 22,        // at blood gene = 1, on an adult
        BLOOD_BABY_FRAC: 0.35,
        HEAD_ANGLE: -0.5,       // radians above the nose where the head bulges
        HEAD_SIGMA: 0.62,
        TAIL_TAPER: 0.16,
        TAIL_SIGMA: 0.7,
        NUB_WIDTH: 1.15,        // cells, half-width of a limb nub at its root
        FOOT_INSET: 0.8,        // how far inside the nub tip the foot pad sits
        LINK_RADIUS: 1.62,      // meat-meat link reach, in lattice pitches
        BONE_LINK_RADIUS: 1.9,
        MIN_LINKS: 3,
        MOUTH_ANGLE: 0.62,      // radians below the nose
        EYE_BASE_R: 1.45,       // eye radius on an adult at eye gene = 1
        EYE_BASE_GAP: 3.3,
    },

    // The genome. Each gene is a float in [0,1]; `min`/`max` is the physical
    // range it maps onto. kind: lin = linear, log = geometric (for
    // multipliers, so 0.5 means "x1"), int = rounded, cat = category index.
    GENES: [
        { key: 'size',        min: 0.80, max: 1.22, kind: 'lin' },   // body size
        { key: 'aspect',      min: 1.20, max: 1.95, kind: 'lin' },   // length / height
        { key: 'head',        min: 0.10, max: 0.42, kind: 'lin' },   // head bulge
        { key: 'spine',       min: 3,    max: 7,    kind: 'int' },   // spine segments
        { key: 'nubs',        min: 2,    max: 4,    kind: 'int' },   // limb nub count
        { key: 'nubLen',      min: 0.20, max: 0.46, kind: 'lin' },   // nub length / half-height
        { key: 'boneSoft',    min: 0.5,  max: 2.0,  kind: 'log' },   // compliance multipliers
        { key: 'meatSoft',    min: 0.45, max: 2.4,  kind: 'log' },
        { key: 'skinSoft',    min: 0.45, max: 2.4,  kind: 'log' },
        { key: 'blood',       min: 0.65, max: 1.45, kind: 'lin' },   // blood volume
        { key: 'hue',         min: 0,    max: 360,  kind: 'lin' },
        { key: 'sat',         min: 0.35, max: 0.9,  kind: 'lin' },
        { key: 'pattern',     min: 0,    max: 2,    kind: 'cat' },   // solid, spots, stripes
        { key: 'eyeSize',     min: 0.75, max: 1.5,  kind: 'lin' },
        { key: 'eyeGap',      min: 0.7,  max: 1.35, kind: 'lin' },
        { key: 'gait',        min: 0,    max: 1,    kind: 'cat' },   // inchworm, hop
        { key: 'gaitFreq',    min: 0.9,  max: 1.9,  kind: 'lin' },   // Hz
        { key: 'gaitAmp',     min: 0.7,  max: 1.3,  kind: 'lin' },
        { key: 'metabolism',  min: 0.72, max: 1.45, kind: 'log' },   // heat out, hunger in
        { key: 'comfort',     min: 33,   max: 40,   kind: 'lin' },   // comfort centre, deg C
        { key: 'comfortW',    min: 2.5,  max: 6,    kind: 'lin' },   // comfort half-width
        { key: 'radSens',     min: 0.6,  max: 1.6,  kind: 'log' },
        { key: 'lifespan',    min: 1500, max: 3600, kind: 'lin' },   // seconds awake
        { key: 'curious',     min: 0,    max: 1,    kind: 'lin' },   // temperament
        { key: 'timid',       min: 0,    max: 1,    kind: 'lin' },
        { key: 'lazy',        min: 0,    max: 1,    kind: 'lin' },
        { key: 'patternHue',  min: 25,   max: 200,  kind: 'lin' },   // second colour offset
        { key: 'patternSize', min: 0.7,  max: 1.5,  kind: 'lin' },
    ],

    GENETICS: {
        SIGMA_BASE: 0.035,      // per-gene Gaussian noise in an unirradiated egg
        SIGMA_PER_DOSE: 0.0009, // extra sigma per unit of the parent's dose
        SIGMA_MAX: 0.3,
        MACRO_CHANCE: 0.06,     // chance of one gene being re-rolled outright
        MACRO_PER_DOSE: 0.0012,
        LINEAGE_MAX: 60,
    },

    // -------------------------------------------------------------- lifecycle
    LIFE: {
        // growth scale: 1 is the genome's adult rest shape
        SCALE_EMBRYO: 0.32,
        SCALE_BABY: 0.56,       // caps per stage; food is what gets you there
        SCALE_CHILD: 0.78,
        SCALE_ADULT: 1.12,      // above 1.0 is stored mass
        SCALE_HATCH: 0.48,      // free growth just after hatching
        HATCH_GRACE: 4,         // seconds after hatching when nothing can injure it
        // stage boundaries as fractions of the lifespan gene
        AGE_CHILD: 0.07,
        AGE_ADULT: 0.22,
        AGE_ELDER: 0.78,
        FOOD_HUNGER: 1.6,       // hunger restored per food cell
        FOOD_MASS: 0.0042,      // growth budget per food cell (mass = scale^2)
        GROW_RATE: 0.012,       // budget turned into mass per second
        SCALE_LERP: 1.2,        // 1/s, how fast the rest shape follows the mass
        EGG_READY_SCALE: 1.085, // an adult this big can lay
        EGG_MASS: 0.2,          // what laying costs
        EGG_HUNGER: 65,
        EGG_HEALTH: 65,
        EGG_COOLDOWN: 60,
        ELDER_SPEED: 0.68,
        ELDER_MUSCLE: 0.72,
        ELDER_BONE_SOFT: 400,   // x compliance: an old spine visibly bends
        WASTE_PER_FOOD: 0.22,   // waste cells produced per food cell
        WASTE_INTERVAL: 9,      // seconds between visits, at steady intake
        TURN_RATE: 2.6,         // 1/s, how fast the face crosses the body
        BREATH_HZ: 0.42,
        BREATH_AMP: 0.035,
    },

    // ------------------------------------------------------------------ gait
    GAIT: {
        STRIDE: 1.25,           // cells, half the fore-aft foot sweep (x amp gene)
        LIFT: 1.15,             // cells a swinging foot is lifted
        PRESS: 0.45,            // cells a standing foot pushes down
        WAVE: 0.5,              // inchworm: phase lag tail->head, in cycles
        DUTY: 0.66,             // inchworm: share of the cycle a foot spends planted
        TRY_TIME: 2.0,          // seconds it gives a gait before judging it
        TRY_SPEED: 0.9,         // cells/s (adult) below which it tries something else
        HOP_CROUCH: 0.62,       // fraction of the hop cycle spent loading
        HOP_THRUST: 0.12,       // fraction spent letting go
        HOP_THRUST_MIN: 0.2,    // ...but at least this many seconds
        HOP_DEPTH: 1.0,         // cells the body sinks while loading
        HOP_KICK: 0.9,          // cells the feet throw down
        HOP_FREQ: 0.62,         // hop cadence relative to the gait gene
        FRICTION_GRIP: 2.4,     // a planted foot
        FRICTION_SLIP: 0.06,    // a swinging foot, and the belly while walking
        FRICTION_STAND: 0.9,
        SHIVER: 0.045,          // muscle noise amplitude when cold
        SLEEP_SPEED: 0.35,      // actuation rate while asleep
        YOUNG_STRIDE: 0.75,     // stride ~ scale^(1 - this): 0 shrinks with the body, 1 does not shrink
        STAND_TALL: 0,          // cells a (vanishingly small) animal holds its feet down by
        CROUCH: 0.8,            // share of leg length folded away when lying down
        EAT_TILT: 0.38,         // radians nose-down while eating
        RIGHT_GAIN: 9,          // righting reflex: rad/s^2 per rad off level
        RIGHT_DAMP: 2.2,        // ...and per rad/s of roll
        RIGHT_AIR: 2.2,         // x gain while a hop is airborne
    },

    // ----------------------------------------------------------------- stats
    STATS: {
        HUNGER_RATE: 0.15,      // per second at metabolism 1, thermally neutral
        HUNGER_WALK: 0.05,      // extra while walking
        HAPPY_RATE: 0.11,
        HAPPY_PLAY: 7,          // per second in contact with the ball
        HAPPY_EAT: 0.35,        // per food cell
        ENERGY_RATE: 0.085,
        ENERGY_WALK: 0.06,
        ENERGY_SLEEP: 0.95,     // recovery per second asleep
        HYGIENE_PER_WASTE: 0.4,
        HYGIENE_PER_SPECK: 6,
        HYGIENE_LERP: 0.4,
        HEALTH_REGEN: 0.22,
        HEALTH_STARVE: 0.28,
        HEALTH_BLOOD: 1.4,      // per second per missing blood fraction below 0.75
        HEALTH_WOUND: 0.05,     // per open skin edge
        HEALTH_HOT: 0.35,       // per second per comfort-width over
        HEALTH_COLD: 0.08,
        HEALTH_DIRTY: 0.05,
        HEALTH_SAD: 0.03,
        HEALTH_TIRED: 0.05,
        HEALTH_STRAIN: 0.6,     // per second per unit of over-threshold strain
        MEDICINE_HEAL: 35,
        MEDICINE_COOLDOWN: 45,
        MEDICINE_BOOST: 20,     // seconds of faster wound healing
        MEDICINE_BOOST_X: 4,
        MEDICINE_FLUSH: 0.5,    // share of internal contamination removed
        // offline floors: stat decay while the tab was closed never takes a
        // stat below these, which is what lets the pet survive a weekend
        OFFLINE_FLOOR: { hunger: 18, happiness: 12, energy: 25, hygiene: 20, health: 35 },
        OFFLINE_AGE_CAP: 180,   // seconds of ageing granted for time away
    },

    // ---------------------------------------------------------------- thermo
    THERMO: {
        START: 36,              // tissue temperature at hatching
        METAB_HEAT: 0.52,       // deg C per second per meat particle, at gene 1
        REG_GAIN: 1.3,          // thermoregulation: heat output vs comfort error
        REG_MIN: 0.35, REG_MAX: 3.2,
        SHIVER_AT: 1.5,         // regulation factor above which muscles shiver
        CONDUCT: 1.2,           // 1/s along a constraint
        BLOOD_MIX: 4.0,         // 1/s between blood and tissue it touches
        BLOOD_REACH: 2.6,       // cells
        SKIN_AIR: 0.085,        // 1/s exchange with what the skin touches
        SKIN_WATER: 0.75,
        SKIN_SOLID: 0.3,
        GRID_SHARE: 1.2,        // deg C a cell gains per deg C a skin particle loses
        HEAT_CAP: [1.4, 1.0, 1.0, 0.7],   // relative heat capacity by tissue
    },

    // ------------------------------------------------------------------ dose
    DOSE: {
        SCALE: 30,              // body-mean dose per unit of weighted energy / mass
        // quality factor by radiation column
        QUALITY: [3.0, 1.0, 1.0, 2.5, 1.2],
        // sensitivity by tissue (TISSUE order) and radiation type (RT order).
        // Skin shrugs off an external alpha, which is why an alpha emitter is
        // harmless on the bench and lethal in the gut.
        SENS: [
            [1.0, 0.8, 1.3, 1.4],     // bone (marrow)
            [1.0, 1.0, 1.0, 1.0],     // meat
            [1.0, 1.0, 1.2, 1.3],     // blood
            [0.004, 0.7, 0.8, 0.8],   // skin
        ],
        INTERNAL_ALPHA: 0.12,   // multiplier for alphas born inside the meat
        RATE_TAU: 5,            // seconds: how slowly the dose-rate reading recovers
        RATE_WINDOW: 1.2,       // seconds of hits averaged into the instantaneous rate
        LOW: 20,                // body-mean cumulative dose thresholds
        MODERATE: 100,
        HIGH: 300,
        LOCAL_GLOW: 60,         // per-particle dose where the glow starts
        LOCAL_BURN: 900,        // per-particle dose where skin edges fail
        HEALTH_LOW: 0.02,       // health per second, by tier
        HEALTH_MODERATE: 0.09,
        HEALTH_HIGH: 0.55,
        SICK_SOFTEN: 4,         // x meat compliance at full sickness
        FLEE_RATE: 0.12,        // dose rate that starts the AI running
        STICK_CHANCE: 0.05,     // per tick, per skin particle touching hot dust
        WASH_CHANCE: 0.12,      // per tick, per speck under water
        EAT_HOT_REACH: 2.2,     // radioactive dust this close to the mouth goes down too
        EXCRETE_SHARE: 0.35,    // share of internal contamination leaving per waste visit
        OFFLINE_CAP: 600,       // seconds of offline exposure that count at most
    },

    // ---------------------------------------------------------------- injury
    INJURY: {
        STRAIN_WEAKEN: 0.75,    // |strain| where a constraint starts taking damage
        STRAIN_BREAK: 1.7,      // stretch (not squash) where it tears outright
        MIN_REST: 1.8,          // cells (x growth scale): strain is measured against at least this
        DAMAGE_RATE: 3.0,       // damage per second per unit of excess strain
        DAMAGE_SOFTEN: 5,       // x compliance at damage = 1
        HEAL_RATE: 0.05,        // damage healed per second, well fed
        MEND_TIME: 22,          // seconds for a broken constraint to knit
        FED_BONUS: 2.0,         // healing multiplier at full hunger
        BLOOD_REGEN: 9,         // seconds per blood particle, well fed
        BLOOD_REGEN_HUNGER: 40, // ...and only above this hunger
        BLOOD_COST: 1.2,        // hunger per regenerated particle
    },

    // -------------------------------------------------------------------- AI
    AI: {
        SENSE_TICKS: 8,
        DECIDE_TICKS: 20,
        HUNGRY: 62,             // starts looking for food below this
        FULL: 96,               // stops eating above this
        SLEEP_AT: 14,           // dozes off below this energy
        WAKE_AT: 92,
        DISTRESS_HEALTH: 28,
        EAT_REACH: 3.0,         // cells from the mouth
        PROBE: 14,              // cells to each side the senses reach
        TEMP_DELTA: 1.5,        // deg C difference worth walking toward
        WANDER_MIN: 2.5, WANDER_MAX: 7,
        IDLE_MIN: 1.5, IDLE_MAX: 6,
        ARRIVE: 2.5,
        STUCK_TIME: 3.5,        // seconds without progress before giving up
    },

    // -------------------------------------------------------------- coupling
    COUPLING: {
        BFS_LIMIT: 6000,        // cells a displacement search may visit
        NORMAL_R: 2,            // occupancy gradient window radius (2 -> 5x5)
        LOAD_SCAN: 26,          // cells of overburden a skin particle looks up through
        LOAD_FORCE: 30,         // force per cell of density 1 resting on the skin
        LOAD_LIFT: 4,           // powder cover up to this deep yields to the animal
        PLOW_NORMAL: -0.8,      // surface normals pointing more upward than this are ground
        PLOW_KEEP: 0.6,         // share of a substep's motion kept while wading through powder
        BUOYANCY: 1.3,          // x body weight, upward, when every skin particle is wet
        WATER_DRAG: 5.5,        // 1/s
        BALL_KICK: 34,          // cells/s given to the ball on contact while playing
    },

    // ------------------------------------------------------------------- egg
    EGG: {
        RX: 7.5, RY: 9.5,
        SHELL: 1.6,             // thickness of the rind that becomes powder
        INCUBATE: 26,           // seconds
        TAP_BONUS: 0.045,       // incubation fraction per tap
        WOBBLE_EVERY: 3.2,      // seconds between wobbles
        WOBBLE_TIME: 0.9,
        WOBBLE_TILT: 0.2,       // radians
        CRACK_AT: 0.6,          // incubation fraction where cracks start
    },

    // ------------------------------------------------------------------ ball
    BALL: {
        RADIUS: 2.7,
        POINTS: 12,
        MASS: 0.35,
        ALPHA_EDGE: 6e-5,
        ALPHA_SPOKE: 2.5e-4,
        ALPHA_AREA: 1e-6,
        PRESSURE: 1.12,
        LIFE: 75,               // seconds before it is put away
        FRICTION: 0.35,
        DAMPING: 0.25,
        COLOR: [245, 96, 72],
    },

    // -------------------------------------------------------------------- UI
    UI: {
        FEED_TIME: 1.0,         // seconds a press of Feed pours for
        FEED_RATE: 34,          // cells per second
        CLEAN_TIME: 1.3,
        CLEAN_RATE: 70,
        BRUSH: 2,               // sandbox brush radius
        GRAB_REACH: 3,          // cells from a skin particle that still counts as a grab
        TOAST_MS: 2600,
    },

    AUDIO: {
        GEIGER_PER_RATE: 55,    // clicks per second per unit of dose rate
        GEIGER_FIELD: 0.45,     // clicks per second per unit of field, no pet present
        GEIGER_MAX: 90,
        SQUISH_THRESHOLD: 0.035,// strain change per tick below which it is silent
        SQUISH_GAIN: 2.2,
        SQUISH_GAP: 0.09,       // seconds between squish sounds
        VOLUME: 0.5,
    },

    SAVE: {
        KEY: 'powderpet.save',
        LINEAGE_KEY: 'powderpet.lineage',
        PREFS_KEY: 'powderpet.prefs',
        INTERVAL: 10,           // seconds
        TEMP_STEP: 0.25,        // deg C quantisation of the saved temperature field
    },
};
