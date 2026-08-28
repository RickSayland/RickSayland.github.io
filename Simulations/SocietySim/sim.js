/* SocietySim — the simulation core.
 *
 * Pure logic. No DOM, no canvas, no timers, no rendering. Everything in here is
 * a function of (seed, params, tick count) and nothing else, so the same seed
 * and the same parameters replay the same society down to the last agent.
 *
 * Agent storage is struct-of-arrays over fixed-size typed arrays. The arrays
 * never grow: MAX_AGENTS slots are allocated once and recycled through a free
 * list, so a birth is a pop and a death is a push. That is what keeps 10,000
 * agents in cache and off the garbage collector.
 *
 * v0.2 adds property. Cells can be owned; owners are Lords; farmers working an
 * owned cell hand over a share of what they lift. See "The bargain" below.
 */
'use strict';

const SIM_VERSION = '0.7.0';

/* ----------------------------------------------------------- Dimensions --- */

const WORLD_W = 2200;
const WORLD_H = 1400;
const CELL = 10;                       // world units per land cell
const GW = (WORLD_W / CELL) | 0;       // 220
const GH = (WORLD_H / CELL) | 0;       // 140
const NCELL = GW * GH;                 // 30,800
const INV_CELL = 1 / CELL;
const XMAX = WORLD_W - 0.001;
const YMAX = WORLD_H - 0.001;

/* The population ceiling has to stay well clear of what the land can actually
   feed, or the array becomes the limit and a plateau that is really an
   allocation shows up on the chart as a result. Raising it means a bigger
   world, not a denser one: doubling the map keeps the per-cell economy exactly
   as it was and simply gives it more room, whereas doubling the yield would
   have made the whole thing more forgiving and quietly killed the famines. */
const MAX_AGENTS = 20000;
const MAX_ESTATES = 384;
const MAX_STATES = 384;      // every manor is a state of one until it isn't
const TPY = 64;                        // ticks per year
const MAX_AGE = 120 * TPY;             // hazard table length; nobody gets here

/* Headings are integer indices into a trig table rather than radians. Turning
   becomes integer addition and the whole movement step is table lookups — no
   Math.cos in a loop that runs ten thousand times a tick. */
const DIRS = 1024;
const DMASK = DIRS - 1;
const DIR_PER_RAD = DIRS / 6.283185307179586;
const COS = new Float32Array(DIRS);
const SIN = new Float32Array(DIRS);
for (let i = 0; i < DIRS; i++) {
    const a = (i / DIRS) * 6.283185307179586;
    COS[i] = Math.cos(a);
    SIN[i] = Math.sin(a);
}

const ROLES = ['Farmer', 'Lord', 'Soldier', 'Townsfolk', 'Official'];
const ROLE_FARMER = 0;
const ROLE_LORD = 1;
const ROLE_SOLDIER = 2;
const ROLE_CITIZEN = 3;
const ROLE_OFFICIAL = 4;

/* Terrain. Only PLAIN and FOREST grow anything; MARSH and the shallows feed
   people too, but by fishing rather than farming, which is why the harvestable
   stock is one array and the reason it is stocked is another. */
const T_WATER = 0, T_PLAIN = 1, T_FOREST = 2, T_DESERT = 3, T_MOUNTAIN = 4;
const TERRAIN_NAMES = ['Water', 'Plain', 'Forest', 'Desert', 'Mountain'];

/* Deposits. Four fields, each with its own geography and its own effect on the
   estate sitting over it — which is how the map ends up deciding who is strong
   enough to take whose land. */
const R_MIN = 0, R_OIL = 1, R_ENERGY = 2, R_FERT = 3;
const NRES = 4;
const RES_NAMES = ['Minerals', 'Oil', 'Energy', 'Fertiliser'];

/* ------------------------------------------------------------- Tunables --- */

const P = {
    seed: 20260826,
    startPop: 2600,

    /* Land. Standing crop in a cell relaxes toward that cell's fertility, which
       is its carrying capacity. Total food the world produces per tick, once
       grazing has flattened the crop, is regrow x (sum of fertility) — which is
       what actually sets the population ceiling. */
    /* Retuned for the v0.4 map. A third of the world is now sea and a quarter
       of the rest is rock or desert, so the same rate over far less farmable
       ground fed a very different number of people. */
    regrow: 0.024,
    harvestMax: 0.075,     // what an average-metabolism farmer lifts per tick
    harvestFloor: 0.015,   // below this a cell is not worth stopping for

    /* ---- The map (v0.4) ----
     * Shares, not absolute noise cutoffs — see percentile(). Water is a third
     * of the world and is not walkable; mountain and desert are walkable but
     * grow nothing, so the farmable fraction is well under half the map and
     * the good ground is worth enclosing. */
    seaLevel: 0.34,        // fraction of the map that is water
    mountainShare: 0.10,   // fraction that is bare rock
    desertShare: 0.26,     // share of habitable ground too dry to farm
    forestShare: 0.20,     // share under trees — farmable, but less
    fishYield: 0.55,       // what the shallows add to a shore cell's capacity
    depositCut: 0.62,      // noise below this carries no deposit at all

    /* What a deposit is worth to the lord standing on it. Each acts through a
       channel the simulation already has, so none of them is a special case:
       fertiliser feeds more tenants, ore arms more men, fuel makes ground
       cheaper to hold, and oil is the odd one — an income that does not care
       how many tenants you have, which is exactly why it distorts everything
       around it. Densities are per-cell averages, so a big poor estate is not
       automatically richer than a small rich one. */
    fertBoost: 1.6,        // multiplier on improvement where fertiliser is
    mineralDiscount: 0.6,  // fraction off the cost of a soldier
    energyDiscount: 0.6,   // fraction off estate upkeep
    oilIncome: 0.9,        // capital per tick per unit of oil density
    covet: 0.55,           // how far a rich neighbour lowers the bar for war

    /* Movement. Three probes ahead, steer toward the best — the same sensor
       trick slime moulds are simulated with. It costs six array reads and makes
       the swarm find and crowd the good ground on its own. */
    speed: 2.3,
    workSpeed: 0.22,       // speed multiplier while working a cell
    senseDist: 17,
    senseSpread: 96,       // trig-table steps between probes (~34 degrees)
    turnStep: 44,          // steer authority per tick (~15 degrees)
    wanderStep: 26,        // random heading jitter per tick

    /* Gregariousness. The probe scores a cell as crop + social x neighbours, so
       this is priced in crop: a grazed cell holds about 0.07, so social = 0.006
       means ten neighbours are worth roughly one cell's worth of food. Company
       is genuinely valuable to nobody here — it is a taste, and it costs, since
       a crowd eats the ground out from under itself. Turn it up and watch them
       clump hard enough to starve. */
    social: 0.006,

    /* Metabolism, drawn at birth and inherited with drift. This is the only
       heritable trait so far, and it is under real selection — but not in one
       direction, because how much a farmer burns also sets how much they can
       lift (see hScale in tick). A big body outworks a small one on rich
       ground and starves beside it on poor ground. */
    metMean: 0.022,
    metSigma: 0.22,
    metMutate: 0.055,
    /* metMin is a basal rate, not a knob to taste: a body cannot run on
       nothing. It is also what stops the population ceiling running away —
       capacity is production divided by metabolism, so a trait that only ever
       got cheaper would push the ceiling up without bound until the agent
       array, rather than the land, became the limit. */
    metMin: 0.012,
    metMax: 0.050,

    /* Food is the perishable belly. Capital is the granary: surplus above
       storeAbove is set aside at a loss, and drawn back down when the belly
       runs low. Deferred consumption is the whole seed of an economy. */
    bellyMax: 4.0,
    storeAbove: 2.0,
    storeRate: 0.055,
    storeEff: 0.85,
    drawBelow: 0.9,
    drawRate: 0.07,

    /* Life. Reproduction is paid for out of capital, which is what makes stored
       wealth worth anything and puts the poor at a fertility disadvantage.
       birthGap is load-bearing once anybody gets rich: without it a lord
       drawing half a unit of rent per tick buys a child every six ticks and
       floods the world inside a generation. */
    maturity: 15 * TPY,
    birthCapital: 3.2,
    birthFood: 1.6,
    birthEndow: 1.3,
    birthGap: 2 * TPY,

    /* Gompertz mortality: flat until mortStart, then doubling every mortScale
       ticks. No per-agent lifespan array needed. */
    mortStart: 30 * TPY,
    mortBase: 2.0e-5,
    mortScale: 6 * TPY,

    /* ---- Property (v0.2) ----
     *
     * The bargain. A lord's cells regrow (1 + improve) times faster — drainage,
     * irrigation, a granary, whatever you like — and a farmer working them
     * hands over rentShare of every load. Improvement is real: the land does
     * produce more. Whether a tenant is better off than a free farmer depends
     * on whether improve beats rentShare *after* the crowd that the richer
     * ground attracts has eaten its share, and that is not a question the
     * parameters answer on their own — it is what the run is for.
     *
     * Nothing tells a farmer to seek out a manor. The existing three-probe
     * sensor sees more crop on improved ground and walks toward it. Tenancy is
     * emergent; so are the borders, which sit where the crowding cancels the
     * improvement out.
     */
    claimMin: 8.0,         // capital a farmer must hold to enclose at all
    claimCost: 3.0,        // what enclosure costs. The gap is a working reserve:
                           // charge a new lord the lot and the first upkeep bill
                           // bankrupts him before a single rent is collected.
    claimFert: 0.30,       // won't enclose ground not worth owning
    claimRadius: 55,       // world units
    maxRadius: 110,
    /* Manors do not overlap. A domain may grow to half the distance to its
       nearest neighbouring seat and no further, so discs meet tangentially and
       every cell has exactly one owner. seatGap must therefore leave room for
       two claimRadius discs side by side, or a new manor is born already
       hemmed in and can never expand. */
    seatGap: 118,          // floor on spacing; see _enclose for the real test
    expandCost: 28,
    expandStep: 8,
    rentShare: 0.30,
    improve: 0.9,
    upkeep: 0.0015,        // capital per owned cell per tick
    lordSpeed: 0.5,
    seatHold: 18,          // a lord mills about within this of the manor
    lordLuxury: 2.5,       // a lord burns this multiple of their metabolism
    /* Wealth bleeds proportionally: station has to be maintained, and without
       it a solvent lord's capital grows without bound and the wealth panel
       becomes a graph of one number. Equilibrium is net income / lordDecay. */
    lordDecay: 0.0025,

    /* ---- Armies (v0.2) ----
     *
     * A title on its own collects nothing. Rent actually taken is rentShare x
     * enforcement, and enforcement is what the garrison can cover:
     *
     *     enforce = min(1, enforceBase + soldiers / (tenants x perTenant))
     *
     * enforceBase is deference — the share that comes in through custom, with
     * nobody standing over it. It is small, and it is also what lets a brand
     * new manor earn anything at all before it can afford a single soldier.
     *
     * Soldiers are recruited from the poorest grown farmer standing on the
     * estate, which is who takes a shilling in every century. They do not farm.
     * The wage is set just above what a body costs to run, so enlisting beats
     * subsistence — that is the whole reason anyone accepts — but it does not
     * make a soldier rich. An estate that cannot make payroll is marked broke
     * and its garrison walks, which is how a lord loses his grip in one season.
     *
     * The garrison also caps how much ground a lord can hold: you cannot
     * enforce a border you cannot walk. */
    enforceBase: 0.35,
    perTenant: 0.05,       // soldiers needed per tenant working the land
    /* What the lord pays and what the soldier receives are deliberately
       different numbers. The gap is arms, mounts and provisions: burned, not
       transferred. Keeping them equal makes one of two things impossible —
       either an army costs the lord too little to ever constrain him, or the
       wage is high enough that the garrison becomes the richest class in the
       country. Split, a company is genuinely expensive to keep and a soldier
       still only earns a living. */
    soldierCost: 0.10,     // capital per soldier per tick, out of the lord
    soldierWage: 0.022,    // capital per soldier per tick, into the soldier
    recruitBonus: 1.0,     // signing payment
    radiusPerSoldier: 6,   // ground a single soldier lets you hold
    soldierSpeed: 0.85,
    lordReserve: 2.5,      // kept back before taking on another mouth

    /* ---- States (v0.3) ----
     *
     * Every manor is founded as a sovereign state of one. Two states whose
     * domains touch have to settle what they are to each other, and there are
     * only two answers in the model: they merge, or they fight.
     *
     * Which one depends on how evenly matched they are. A lopsided pair
     * produces a war, because conquest is cheap for the stronger; an even pair
     * produces a union, because it is not. That single rule is enough to give
     * the map a plausible history — small neighbours federate, big ones eat
     * small ones, and equals circle each other warily.
     *
     * Both outcomes end in the same structure, a larger state, and differ only
     * in the terms. A partner in a union pays a levy; a conquered estate pays
     * tribute, which is higher. That is what makes war worth starting.
     */
    contactSlack: 14,      // how close two borders must be to count as touching
    diploInterval: 64,     // ticks between diplomacy passes (one year)
    diploCooldown: 6 * TPY,
    foundingGrace: 10 * TPY,
    aggression: 2.2,       // strength ratio above which the stronger attacks
    unionChance: 0.6,      // chance an evenly matched pair federates instead
    battleInterval: 8,     // ticks between rounds of a war
    warEnforce: 0.6,       // rent enforcement suffers while the men are fighting
    warPeaceYears: 12,     // after this a stalemate can be called off
    peaceChance: 0.25,
    levyShare: 0.12,       // a partner's rent, paid up to the state's capital
    tributeShare: 0.28,    // a conquered estate's rent — the price of losing

    /* ---- Cities (v0.5) ----
     *
     * A city is people eating grain that grew somewhere else. Everything here
     * follows from that one sentence.
     *
     * Rent already moves food off the land and into a lord's hands; until now
     * it evaporated into capital. Now half of it piles up as a physical
     * granary at the manor, and that stock is the only thing a town can live
     * on. Nobody is fed for free: townsfolk draw a wage for working the lord's
     * town and BUY their grain out of the granary at foodPrice. The lord's
     * profit is the spread — craftValue is the worth of what a townsman makes,
     * cityWage is what he is paid for making it, and the difference plus the
     * grain sales is why a lord wants a town at all.
     *
     * Both sides have to come out ahead or the arrangement is not a city:
     *   townsman:  cityWage  >  foodPrice x metabolism
     *   lord:      craftValue > cityWage - foodPrice x metabolism
     * craftValue is the value added, and the two inequalities are how it gets
     * split. Set craftValue to zero and the town is a pure drain that starves.
     *
     * The whole thing is self-limiting without any cap on city size: too many
     * townsfolk drain the granary, grain runs out, and they go back to the
     * land. A city is exactly as large as the surplus feeding it.
     */
    granaryShare: 0.9,     // of rent food held as grain rather than sold at once
    /* A working stock, not a strategic reserve. The cap has to be small enough
       that it fills in weeks, because everything above it is sold and that sale
       is the lord's cash. At 600 the silo swallowed a lord's entire income for
       six hundred ticks while it filled, and the manors went bankrupt one after
       another before a single town existed. The stock only has to buffer a
       town's daily bread — the binding constraint on a city is the rent
       flowing in, never the size of the barn. */
    granaryCap: 120,
    foodPrice: 1.0,        // capital per unit of grain at market
    cityWage: 0.026,       // what a townsman earns per tick
    craftValue: 0.05,      // what a townsman's work is worth to the lord
    ration: 0.05,          // most grain a townsman buys in one tick
    cityStock: 1.6,        // the larder a townsman keeps; must stay < storeAbove
    cityRadius: 46,
    cityMinGranary: 4,     // no grain in store, no town
    cityDraw: 0.004,       // chance per tick a farmer in town takes up a trade
    levyFood: 0.15,        // grain a member town sends up the road to the capital
    roadSpeed: 1.7,        // how much faster the going is on a made road

    /* ---- Government (v0.6) ----
     *
     * Three manors under one crown and the arrangement stops being personal.
     * That is the whole transition: up to this point a state's money IS the
     * king's money — a levy paid by one lord into another lord's purse. A
     * government has a TREASURY, which belongs to the state and not to anyone
     * in it, and the levy becomes a tax.
     *
     * A tax has to be assessed and collected by somebody, so a government
     * needs Officials, and they are drawn from townsfolk because that is where
     * literate people who are not needed in a field can be found. Administration
     * works exactly the way a garrison's enforcement does: without officials
     * only the customary dues come in (govAdminBase); with enough of them the
     * state collects what it is owed.
     *
     * What the treasury buys is the reason any of this beats feudalism:
     *   - it pays a share of every member's payroll, so a nation fields an army
     *     larger than the sum of the retinues it replaced;
     *   - it runs a national grain reserve, taking from towns in surplus and
     *     giving to towns in want, which is the difference between a bad
     *     harvest and a famine.
     * Both are things no single lord can do for himself, and both are why a
     * government out-competes the feudal states around it.
     *
     * Fall below three manors and it all unwinds: the officials go back to
     * their trades and the survivors are lords again.
     */
    govMinEstates: 3,
    taxRate: 0.22,
    govAdminBase: 0.30,
    officialsPerEstate: 1.6,
    officialSalary: 0.05,
    armyShare: 0.35,       // of a member's payroll, met from the treasury
    reserveTarget: 10,     // the granary level the state tries to hold everywhere
    reserveRate: 0.05,
    treasuryReserve: 15,   // kept back before appointing anyone
    /* Public works — drainage, irrigation, terracing. The treasury's main
       expense and the reason a nation feeds more people than the manors it was
       made of. It is charged per cell held, so it scales with the country and
       a large state cannot simply hoard: a treasury with nothing to spend on
       grows without bound and the whole fiscal side stops meaning anything. */
    /* Contiguity. A manor holds a disc; a country holds a map. Territory is
       allowed to reach this far past what a manor could garrison on its own,
       which is exactly enough for neighbouring members to meet in the middle
       and close the gap between them. A lone manor gets none of it and stays a
       disc in a commons — the patchwork is what feudalism looks like, and the
       filled-in border is what a state looks like. */
    fillBonus: 34,         // reach past the garrisoned radius, for any state
    govFillBonus: 78,      // a government reaches a great deal further
    consolidateInterval: 32,

    govArmyBonus: 0.8,     // extra men per subject a state keeps over a manor
    /* ---- Ordnance and empire (v0.7) ----
     *
     * Until now a war needed a shared border: two states could only fight if
     * their territories touched, so the map's politics were entirely local.
     * Long-range weapons break that. A state with an arsenal can reach
     * strikeRange beyond its own border, which means it can pick a quarrel with
     * a country it has never bordered — and, for the first time, fight over
     * ground it does not adjoin.
     *
     * Ordnance is the first thing in the model that genuinely REQUIRES the
     * minerals and fuel that have been sitting unwanted in the mountains since
     * v0.4. Production is the lesser of the two endowments, so a state with ore
     * and no fuel builds nothing, and a state with neither is defenceless
     * against one that has both. Only governments build it: an arsenal needs a
     * treasury and an administration, which is one more thing feudalism cannot
     * do.
     *
     * How a war at range ends is different from how a war at a border ends. An
     * army that marches over a border takes the ground and the estates change
     * hands. Guns that reach across three hundred leagues cannot occupy
     * anything, so the beaten state keeps its territory, its lord and its
     * government, and pays tribute instead: a VASSAL rather than a conquest.
     * That is also what keeps the map's borders contiguous — an empire built by
     * bombardment is a web of tributaries, not a patchwork of exclaves.
     */
    strikeRange: 420,          // how far ordnance reaches past a border
    ordnanceCost: 2.5,         // treasury per shell
    ordnanceBudget: 0.35,      // share of spendable treasury put to munitions
    ordnancePerDeposit: 0.02,  // ceiling set by the ore and fuel actually held
    ordnanceCap: 60,
    salvoSize: 1.0,            // shells spent per bombardment
    strikeCasualties: 2,       // soldiers killed by a salvo
    strikeCivilians: 3,        // townsfolk killed by a salvo
    strikeGranary: 0.35,       // share of the target town's grain destroyed
    vassalTribute: 0.30,       // of a vassal's tax take, paid up to its overlord
    rebelRatio: 1.8,           // how much stronger a vassal must be to break free

    worksCost: 0.008,      // per owned cell per tick
    worksBonus: 0.6,       // added to the improvement multiplier when fully funded
    /* Peculation, and the cost of being a state. Without it a solvent treasury
       grows without bound and the figure stops carrying any information. */
    treasuryWaste: 0.003
};

/* ----------------------------------------------------------------- Land --- */

function smoothstep(t) { return t * t * (3 - 2 * t); }

function addOctave(out, s, fx, fy, amp) {
    const lw = fx + 1;
    const lat = new Float32Array(lw * (fy + 1));
    for (let i = 0; i < lat.length; i++) lat[i] = s.rand();

    const sx = fx / GW, sy = fy / GH;
    for (let gy = 0; gy < GH; gy++) {
        const v = gy * sy;
        let y0 = v | 0; if (y0 > fy - 1) y0 = fy - 1;
        const ty = smoothstep(v - y0);
        const r0 = y0 * lw, r1 = r0 + lw;
        for (let gx = 0; gx < GW; gx++) {
            const u = gx * sx;
            let x0 = u | 0; if (x0 > fx - 1) x0 = fx - 1;
            const tx = smoothstep(u - x0);
            const a = lat[r0 + x0], b = lat[r0 + x0 + 1];
            const c = lat[r1 + x0], d = lat[r1 + x0 + 1];
            const top = a + (b - a) * tx;
            const bot = c + (d - c) * tx;
            out[gy * GW + gx] += amp * (top + (bot - top) * ty);
        }
    }
}

function noiseField(s, octaves) {
    const out = new Float32Array(NCELL);
    let amp = 1, norm = 0;
    for (let o = 0; o < octaves.length; o++) {
        addOctave(out, s, octaves[o][0], octaves[o][1], amp);
        norm += amp;
        amp *= 0.5;
    }
    for (let c = 0; c < NCELL; c++) out[c] /= norm;
    return out;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/* Thresholds are taken as percentiles of the field itself rather than as fixed
   values. Noise does not promise a given distribution, so a hard cutoff gives
   one seed an archipelago and the next a single unbroken continent; a
   percentile gives every world the same amount of sea and the same amount of
   rock, and lets the seed decide only their shape. */
function percentile(src, frac) {
    const copy = Float32Array.from(src);
    copy.sort();
    let i = Math.floor(frac * (copy.length - 1));
    if (i < 0) i = 0; else if (i >= copy.length) i = copy.length - 1;
    return copy[i];
}

function buildWorld(w, s) {
    const P0 = w.P;
    const elev = noiseField(s, [[3, 2], [6, 4], [12, 8], [24, 16]]);
    const moist = noiseField(s, [[4, 3], [9, 6], [18, 12]]);

    /* Push the elevation down towards the edges so the map is a landmass in an
       ocean rather than land running off all four sides. */
    for (let gy = 0, c = 0; gy < GH; gy++) {
        const ny = Math.abs(gy / (GH - 1) - 0.5) * 2;
        for (let gx = 0; gx < GW; gx++, c++) {
            const nx = Math.abs(gx / (GW - 1) - 0.5) * 2;
            const edge = nx > ny ? nx : ny;
            const fall = 1 - smoothstep(clamp01((edge - 0.52) / 0.48)) * 0.9;
            elev[c] *= fall;
        }
    }

    const sea = percentile(elev, P0.seaLevel);
    const rock = percentile(elev, 1 - P0.mountainShare);
    const terrain = w.terrain, walk = w.walk, fert = w.fert, depth = w.depth;

    /* Desert and forest are shares of the *habitable* ground, so the moisture
       cuts have to be taken over that subset rather than over the whole map —
       otherwise the sea, which has no business having a climate, drags the
       percentiles around and one seed comes out with no forest at all. */
    let nHab = 0;
    for (let c = 0; c < NCELL; c++) if (elev[c] >= sea && elev[c] <= rock) nHab++;
    const habMoist = new Float32Array(Math.max(nHab, 1));
    for (let c = 0, k = 0; c < NCELL; c++) {
        if (elev[c] >= sea && elev[c] <= rock) habMoist[k++] = moist[c];
    }
    habMoist.sort();
    const pick = f => habMoist[Math.min(habMoist.length - 1,
        Math.max(0, Math.floor(f * (habMoist.length - 1))))];
    const dryCut = pick(P0.desertShare);
    const wetCut = pick(1 - P0.forestShare);
    const span = Math.max(wetCut - dryCut, 1e-6);

    for (let c = 0; c < NCELL; c++) {
        const e = elev[c], m = moist[c];
        let t;
        if (e < sea) t = T_WATER;
        else if (e > rock) t = T_MOUNTAIN;
        else if (m < dryCut) t = T_DESERT;
        else if (m > wetCut) t = T_FOREST;
        else t = T_PLAIN;
        terrain[c] = t;
        walk[c] = t === T_WATER ? 0 : 1;
        depth[c] = t === T_WATER ? clamp01((sea - e) / Math.max(sea, 1e-6)) : 0;

        /* Soil. Wet lowland is the best of it; forest grows food but has to be
           cleared first, so it yields less. Desert and rock yield nothing. */
        let f = 0;
        if (t === T_PLAIN || t === T_FOREST) {
            const wet = smoothstep(clamp01((m - dryCut) / span));
            const high = clamp01((e - sea) / Math.max(rock - sea, 1e-6));
            f = (0.5 + 0.5 * wet) * (1 - high * 0.35);
            if (t === T_FOREST) f *= 0.7;
        }
        fert[c] = f;
    }

    /* The shallows. Water is not walkable, so nobody farms it — but a cell on
       the shore draws on what is swimming next to it, and that is stocked into
       the same harvestable array the farmers already read. It costs the hot
       loop nothing and it makes a coastline worth living on even where the
       soil behind it is poor. */
    const fish = P0.fishYield;
    for (let gy = 0, c = 0; gy < GH; gy++) {
        for (let gx = 0; gx < GW; gx++, c++) {
            if (walk[c] === 0) continue;
            let water = 0, seen = 0;
            for (let dy = -2; dy <= 2; dy++) {
                const yy = gy + dy;
                if (yy < 0 || yy >= GH) continue;
                for (let dx = -2; dx <= 2; dx++) {
                    const xx = gx + dx;
                    if (xx < 0 || xx >= GW) continue;
                    seen++;
                    if (terrain[yy * GW + xx] === T_WATER) water++;
                }
            }
            if (water === 0) continue;
            const frac = water / seen;
            fert[c] += fish * clamp01(frac * 3);
            if (fert[c] > 1) fert[c] = 1;
        }
    }

    buildResources(w, s, elev, moist, sea, rock);
}

/* Each deposit gets its own patchy field and its own habitat, so the four are
   not four names for the same map: ore sits in the high ground, oil under
   desert and offshore shelf, fuel in the forests and coal measures, and
   fertiliser on the silt and guano of the coast. Where they overlap is what
   makes a particular valley worth fighting over. */
function buildResources(w, s, elev, moist, sea, rock) {
    const P0 = w.P, terrain = w.terrain, res = w.res;
    const raw = [
        noiseField(s, [[7, 5], [15, 10]]),
        noiseField(s, [[5, 4], [11, 7]]),
        noiseField(s, [[8, 5], [16, 11]]),
        noiseField(s, [[6, 4], [13, 9]])
    ];
    const cut = P0.depositCut;

    for (let c = 0; c < NCELL; c++) {
        const t = terrain[c];
        const e = elev[c], m = moist[c];
        const high = clamp01((e - sea) / Math.max(rock - sea, 1e-6));
        const shore = t === T_WATER ? 1 - w.depth[c] : 0;

        let habitat;
        habitat = t === T_MOUNTAIN ? 1 : 0.15 + high * 0.7;
        res[R_MIN][c] = clamp01((raw[0][c] - cut) / (1 - cut)) * habitat;

        habitat = t === T_DESERT ? 1 : t === T_WATER ? shore * 0.9 : 0.12;
        res[R_OIL][c] = clamp01((raw[1][c] - cut) / (1 - cut)) * habitat;

        habitat = t === T_FOREST ? 1 : t === T_MOUNTAIN ? 0.7 : 0.2 + high * 0.4;
        res[R_ENERGY][c] = clamp01((raw[2][c] - cut) / (1 - cut)) * habitat;

        habitat = t === T_WATER ? 0 : (m > 0.5 ? 0.5 + m * 0.5 : 0.25);
        res[R_FERT][c] = clamp01((raw[3][c] - cut) / (1 - cut)) * habitat;
    }
}

/* ------------------------------------------------------------------ Sim --- */

const sim = {
    VERSION: SIM_VERSION,
    W: WORLD_W, H: WORLD_H,
    GW: GW, GH: GH, CELL: CELL, NCELL: NCELL,
    MAX_AGENTS: MAX_AGENTS,
    MAX_ESTATES: MAX_ESTATES,
    MAX_STATES: MAX_STATES,
    TPY: TPY,
    ROLES: ROLES,
    P: P,

    TERRAIN_NAMES: TERRAIN_NAMES,
    RES_NAMES: RES_NAMES,
    NRES: NRES,

    /* land */
    fert: new Float32Array(NCELL),       // harvestable capacity, farmed or fished
    crop: new Float32Array(NCELL),
    terrain: new Uint8Array(NCELL),
    walk: new Uint8Array(NCELL),         // 0 = water; nobody walks on it
    depth: new Float32Array(NCELL),
    road: new Uint8Array(NCELL),         // made road; the going is faster on it
    city: new Int16Array(NCELL),         // town whose walls this cell is inside
    /* Held is not the same as worked. A manor's core is drained and irrigated;
       the frontier a state fills in to make its border contiguous is held,
       taxed and defended, but nobody has improved it. Without this distinction
       drawing a modern border doubled the country's food supply overnight. */
    improved: new Uint8Array(NCELL),
    res: [new Float32Array(NCELL), new Float32Array(NCELL),
          new Float32Array(NCELL), new Float32Array(NCELL)],
    owner: new Int16Array(NCELL),        // estate id, or -1

    /* Neighbour counts, double-buffered: the sensor reads last tick's field
       while this tick's is being written. One tick stale is invisible and it
       saves a whole extra pass over the population. */
    densR: new Int32Array(NCELL),
    densW: new Int32Array(NCELL),

    /* agents, struct-of-arrays */
    x: new Float32Array(MAX_AGENTS),
    y: new Float32Array(MAX_AGENTS),
    dir: new Int16Array(MAX_AGENTS),
    food: new Float32Array(MAX_AGENTS),
    capital: new Float32Array(MAX_AGENTS),
    met: new Float32Array(MAX_AGENTS),
    age: new Int32Array(MAX_AGENTS),
    role: new Uint8Array(MAX_AGENTS),
    alive: new Uint8Array(MAX_AGENTS),
    lastBirth: new Int32Array(MAX_AGENTS),
    estateOf: new Int16Array(MAX_AGENTS),   // if a Lord, which estate; else -1

    /* estates, struct-of-arrays. Cells store an estate id rather than an agent
       slot on purpose: slots are recycled, and a newborn dropped into a dead
       lord's slot would otherwise inherit a county. */
    eAlive: new Uint8Array(MAX_ESTATES),
    eLord: new Int32Array(MAX_ESTATES),
    eSeatX: new Float32Array(MAX_ESTATES),
    eSeatY: new Float32Array(MAX_ESTATES),
    eRadius: new Float32Array(MAX_ESTATES),
    eCells: new Int32Array(MAX_ESTATES),
    eRent: new Float32Array(MAX_ESTATES),      // accruing this tick
    eRentLast: new Float32Array(MAX_ESTATES),  // settled last tick
    eTenants: new Int32Array(MAX_ESTATES),
    eTenantsLast: new Int32Array(MAX_ESTATES),
    eBorn: new Int32Array(MAX_ESTATES),        // tick the manor was founded
    eSoldiers: new Int32Array(MAX_ESTATES),    // counted fresh each tick
    eGarrison: new Int32Array(MAX_ESTATES),    // last settled count
    eEnforce: new Float32Array(MAX_ESTATES),   // 0..1, applied to next tick's rent
    eBroke: new Uint8Array(MAX_ESTATES),       // in arrears
    /* Men still owed their discharge. A lord who misses payroll sheds only as
       many as the shortfall requires, one per soldier reached in slot order.
       Losing the whole company over a single bad season made the garrison
       oscillate — hire to strength, miss payroll, lose everyone, collect
       nothing, rehire — and that limit cycle is an artefact of the rule, not
       anything about armies. */
    eShed: new Int32Array(MAX_ESTATES),
    /* Best recruit seen this tick, filled opportunistically as farmers walk
       over owned ground. Free: the estate is owner[cell], so spotting a
       candidate is an array read inside a loop already running. */
    eCand: new Int32Array(MAX_ESTATES),
    eCandCap: new Float32Array(MAX_ESTATES),
    eState: new Int16Array(MAX_ESTATES),       // never -1 while the estate lives
    eSubject: new Uint8Array(MAX_ESTATES),     // joined by conquest, not consent
    /* Deposits under an estate, summed as cells are stamped, plus the four
       multipliers they buy. Derived once per tick in _settleEstates so a slider
       change takes effect immediately rather than at the next enclosure. */
    eRes: new Float32Array(MAX_ESTATES * NRES),
    eResDens: new Float32Array(MAX_ESTATES * NRES),
    eRegrow: new Float32Array(MAX_ESTATES),    // read by the land loop
    /* The town. eGranary is a physical stock of grain, not a number of coins —
       it is what the townsfolk buy from and the only thing keeping them off
       the land. */
    eGranary: new Float32Array(MAX_ESTATES),
    eCitizens: new Int32Array(MAX_ESTATES),    // counted fresh each tick
    eTownPop: new Int32Array(MAX_ESTATES),     // last settled count
    eFoodSold: new Float32Array(MAX_ESTATES),
    eGrainIn: new Float32Array(MAX_ESTATES),
    eStrike: new Int32Array(MAX_ESTATES),      // townsfolk a bombardment has killed
    eSoldierCost: new Float32Array(MAX_ESTATES),
    eUpkeep: new Float32Array(MAX_ESTATES),
    eOilIncome: new Float32Array(MAX_ESTATES),

    /* states, struct-of-arrays */
    stAlive: new Uint8Array(MAX_STATES),
    stLead: new Int32Array(MAX_STATES),        // the capital estate
    stMembers: new Int32Array(MAX_STATES),
    stWar: new Int16Array(MAX_STATES),         // opposing state, or -1
    stWarSince: new Int32Array(MAX_STATES),
    stCd: new Int32Array(MAX_STATES),          // diplomatic cooldown, in ticks
    stBattles: new Int32Array(MAX_STATES),
    stBorn: new Int32Array(MAX_STATES),
    /* Men owed as casualties. A battle is settled between states, but somebody
       has to actually die; the debt is paid off in the agent loop in slot
       order, the same trick eShed uses for discharges. */
    stCasualties: new Int32Array(MAX_STATES),
    /* Government. stTreasury is the state's money and belongs to nobody in it —
       that distinction is the whole of v0.6. */
    stGov: new Uint8Array(MAX_STATES),
    stTreasury: new Float32Array(MAX_STATES),
    stReserve: new Float32Array(MAX_STATES),    // national grain store
    stOfficials: new Int32Array(MAX_STATES),    // counted fresh each tick
    stOffLast: new Int32Array(MAX_STATES),
    stAdmin: new Float32Array(MAX_STATES),      // 0..1, how much tax arrives
    stShedOff: new Int32Array(MAX_STATES),      // posts the treasury cannot fund
    stGovSince: new Int32Array(MAX_STATES),
    stTaxTake: new Float32Array(MAX_STATES),
    stWantOff: new Int32Array(MAX_STATES),
    stWorks: new Float32Array(MAX_STATES),      // 0..1, how much of the works are paid for
    stOrdnance: new Float32Array(MAX_STATES),   // shells in the arsenal
    stIndustry: new Float32Array(MAX_STATES),   // what its ore and fuel can sustain
    stOverlord: new Int16Array(MAX_STATES),     // the state it pays tribute to, or -1
    stVassals: new Int32Array(MAX_STATES),

    /* bookkeeping */
    tickCount: 0,
    pop: 0,
    lords: 0,
    totalBirths: 0,
    totalStarved: 0,
    totalAged: 0,
    births: 0,          // this tick
    starved: 0,
    aged: 0,
    denied: 0,          // births the slot cap refused
    capped: false,
    harvested: 0,
    cropTotal: 0,
    sumFood: 0,
    sumCapital: 0,
    sumMet: 0,
    /* property */
    estateCount: 0,
    ownedCells: 0,
    tenantCount: 0,
    rentFlow: 0,
    oilFlow: 0,
    /* Bumped whenever the ownership map or the state assignment changes. The
       renderer traces borders off it and can skip that whole scan otherwise —
       territory changes a few times a century, not sixty times a second. */
    ownerVersion: 0,
    roadVersion: -1,
    townPop: 0,
    granaryTotal: 0,
    craftFlow: 0,
    grainMoved: 0,
    enclosures: 0,
    successions: 0,
    dissolutions: 0,
    soldiers: 0,
    citizens: 0,
    officials: 0,
    govCount: 0,
    governments: 0,      // cumulative, for the chronicle
    collapses: 0,
    treasuryTotal: 0,
    reserveTotal: 0,
    arsenalTotal: 0,
    munitionsFlow: 0,
    tributeFlow: 0,
    vassalCount: 0,
    vassalages: 0,
    rebellions: 0,
    strikes: 0,
    civilianDead: 0,
    impacts: [],
    taxFlow: 0,
    taxPaid: 0,
    armySubsidy: 0,
    garrisonTotal: 0,
    wageFlow: 0,
    recruits: 0,
    desertions: 0,
    meanEnforce: 0,
    /* states */
    stateCount: 0,
    largestState: 0,
    warCount: 0,
    unions: 0,
    warsDeclared: 0,
    annexations: 0,
    battles: 0,
    warDead: 0,
    levyFlow: 0,
    subjectEstates: 0,
    log: [],

    /* mulberry32, held as a single integer so the hot loop can inline the
       recurrence instead of paying for a closure call twice per agent. Every
       draw in the simulation — land, founders, wander, mortality, birth —
       comes off this one stream, in slot order, so the run is reproducible. */
    _rs: 0,
    _seed: P.seed,

    _free: new Int32Array(MAX_AGENTS),
    _freeN: 0,
    _bq: new Int32Array(MAX_AGENTS),
    _bqN: 0,
    _cq: new Int32Array(256),
    _cqN: 0,
    _eFree: new Int32Array(MAX_ESTATES),
    _eFreeN: 0,
    _stFree: new Int32Array(MAX_STATES),
    _stFreeN: 0,
    _liveE: new Int32Array(MAX_ESTATES),   // compact list, rebuilt each tick
    _liveN: 0,
    _fillQ: new Int32Array(NCELL),         // BFS queue for consolidation
    _fillSeen: new Uint8Array(NCELL),
    /* Gompertz hazard, precomputed per age in ticks. The curve depends on
       nothing but age, and evaluating Math.exp for every agent every tick cost
       more than the land update and the movement put together. */
    _hazard: new Float32Array(MAX_AGE),

    rand() {
        let a = (this._rs + 0x6D2B79F5) | 0;
        this._rs = a;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },

    /* Box-Muller, second variate discarded. Cold path only — births and
       founders — so the waste costs nothing and the draw count stays fixed. */
    gauss() {
        const u = 1 - this.rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * this.rand());
    },

    /* ------------------------------------------------------------ reset -- */

    reset(seed) {
        if (seed !== undefined) this._seed = seed | 0;
        this._rs = this._seed | 0;

        buildWorld(this, this);
        this.crop.set(this.fert);
        this._buildHazard();
        this.eRes.fill(0);
        this.eResDens.fill(0);
        this.eRegrow.fill(P.regrow);
        this.eSoldierCost.fill(P.soldierCost);
        this.eUpkeep.fill(P.upkeep);
        this.eOilIncome.fill(0);

        this.owner.fill(-1);
        this.improved.fill(0);
        this.road.fill(0);
        this.city.fill(-1);
        this.eGranary.fill(0);
        this.eCitizens.fill(0);
        this.eTownPop.fill(0);
        this.eFoodSold.fill(0);
        this.eGrainIn.fill(0);
        this.ownerVersion = 0;
        this.roadVersion = -1;
        this.townPop = this.granaryTotal = this.craftFlow = this.grainMoved = 0;
        this.densR.fill(0);
        this.densW.fill(0);
        this.alive.fill(0);
        this.estateOf.fill(-1);
        this.eAlive.fill(0);
        this.eCells.fill(0);
        this.eRent.fill(0);
        this.eRentLast.fill(0);
        this.eTenants.fill(0);
        this.eTenantsLast.fill(0);
        this.eSoldiers.fill(0);
        this.eGarrison.fill(0);
        this.eEnforce.fill(0);
        this.eBroke.fill(0);
        this.eShed.fill(0);
        this.eCand.fill(-1);
        this.eCandCap.fill(0);
        this.eState.fill(-1);
        this.eSubject.fill(0);

        this.stAlive.fill(0);
        this.stLead.fill(-1);
        this.stMembers.fill(0);
        this.stWar.fill(-1);
        this.stCd.fill(0);
        this.stCasualties.fill(0);
        this.stBattles.fill(0);
        this.stGov.fill(0);
        this.stTreasury.fill(0);
        this.stReserve.fill(0);
        this.stOfficials.fill(0);
        this.stOffLast.fill(0);
        this.stAdmin.fill(0);
        this.stShedOff.fill(0);
        this.stTaxTake.fill(0);
        this.stWantOff.fill(0);
        this.stWorks.fill(0);
        this.stOrdnance.fill(0);
        this.stIndustry.fill(0);
        this.stOverlord.fill(-1);
        this.stVassals.fill(0);
        this.eStrike.fill(0);
        this.worksFlow = 0;
        this.arsenalTotal = this.munitionsFlow = this.tributeFlow = 0;
        this.vassalCount = this.vassalages = this.rebellions = 0;
        this.strikes = this.civilianDead = 0;
        this.impacts = [];
        this.officials = this.govCount = 0;
        this.governments = this.collapses = 0;
        this.treasuryTotal = this.reserveTotal = 0;
        this.taxFlow = this.taxPaid = this.armySubsidy = 0;
        this._stFreeN = 0;
        for (let s = MAX_STATES - 1; s >= 0; s--) this._stFree[this._stFreeN++] = s;

        this.log = [];
        this.stateCount = this.largestState = this.warCount = 0;
        this.unions = this.warsDeclared = this.annexations = 0;
        this.battles = this.warDead = 0;
        this.levyFlow = 0;
        this.subjectEstates = 0;
        this._liveN = 0;

        this.tickCount = 0;
        this.totalBirths = 0;
        this.totalStarved = 0;
        this.totalAged = 0;
        this.births = this.starved = this.aged = this.denied = 0;
        this.capped = false;
        this.harvested = 0;
        this.lords = 0;
        this.estateCount = this.ownedCells = this.tenantCount = 0;
        this.rentFlow = 0;
        this.oilFlow = 0;
        this.enclosures = this.successions = this.dissolutions = 0;
        this.soldiers = 0;
        this.garrisonTotal = 0;
        this.wageFlow = 0;
        this.recruits = this.desertions = 0;
        this.meanEnforce = 0;

        this._eFreeN = 0;
        for (let e = MAX_ESTATES - 1; e >= 0; e--) this._eFree[this._eFreeN++] = e;

        /* Free list holds every slot, high index first, so the first births
           come off the low end and the array stays packed early on. */
        this._freeN = 0;
        for (let i = MAX_AGENTS - 1; i >= 0; i--) this._free[this._freeN++] = i;

        const n = Math.min(P.startPop, MAX_AGENTS);
        for (let k = 0; k < n; k++) {
            const i = this._free[--this._freeN];
            /* Rejection-sample onto ground worth farming. A founder dropped in
               a desert is a fair outcome; a whole cohort of them is not. */
            let px = 0, py = 0;
            for (let t = 0; t < 24; t++) {
                px = this.rand() * XMAX;
                py = this.rand() * YMAX;
                const c = ((py * INV_CELL) | 0) * GW + ((px * INV_CELL) | 0);
                /* Walkable is the hard requirement — a founder in the sea has
                   nowhere to go. Fertile is the preference. */
                if (this.walk[c] === 1 && this.fert[c] > 0.25) break;
                if (t === 23) {
                    for (let g = 0; g < NCELL; g++) {
                        if (this.walk[g] === 1) {
                            px = (g % GW + 0.5) * CELL;
                            py = ((g / GW) | 0) * CELL + CELL * 0.5;
                            break;
                        }
                    }
                }
            }
            this.x[i] = px;
            this.y[i] = py;
            this.dir[i] = (this.rand() * DIRS) | 0;
            this.food[i] = 1.4 + this.rand() * 1.4;
            this.capital[i] = this.rand() * 1.2;
            let m = P.metMean * Math.exp(this.gauss() * P.metSigma);
            if (m < P.metMin) m = P.metMin; else if (m > P.metMax) m = P.metMax;
            this.met[i] = m;
            /* Ages spread across the working span so the founders do not all
               reach the grave in the same decade. */
            this.age[i] = (this.rand() * 30 * TPY) | 0;
            this.role[i] = ROLE_FARMER;
            this.estateOf[i] = -1;
            this.lastBirth[i] = -P.birthGap;
            this.alive[i] = 1;
        }
        this.pop = n;
        this._recount();
        return this;
    },

    /* ------------------------------------------------------------- tick -- */

    tick() {
        const p = this.P;
        const fert = this.fert, crop = this.crop, own = this.owner, walk = this.walk;
        const X = this.x, Y = this.y, D = this.dir;
        const F = this.food, C = this.capital, M = this.met, A = this.age;
        const AL = this.alive, RO = this.role, EST = this.estateOf;
        const haz = this._hazard;
        const densR = this.densR, densW = this.densW;
        const eRent = this.eRent, eTenants = this.eTenants, eLord = this.eLord;
        const eSeatX = this.eSeatX, eSeatY = this.eSeatY;
        const eAlive = this.eAlive, eShed = this.eShed, eEnforce = this.eEnforce;
        const eState = this.eState, stCasualties = this.stCasualties;
        let warDead = 0;
        const eSoldiers = this.eSoldiers, eRadius = this.eRadius;
        const eCand = this.eCand, eCandCap = this.eCandCap;

        /* --- the land regrows, faster where somebody has improved it. The
           per-estate rate carries the fertiliser bonus, so a manor sitting on
           nitrate genuinely grows more food than one that is not. --- */
        const rg = p.regrow;
        const eRegrow = this.eRegrow, improved = this.improved;
        let cropTotal = 0;
        for (let c = 0; c < NCELL; c++) {
            const o = own[c];
            const rate = (o >= 0 && improved[c] === 1) ? eRegrow[o] : rg;
            const v = crop[c] + rate * (fert[c] - crop[c]);
            crop[c] = v;
            cropTotal += v;
            densW[c] = 0;
        }
        this.cropTotal = cropTotal;

        const sd = p.senseDist, spread = p.senseSpread;
        const turn = p.turnStep, wob = p.wanderStep;
        const spd = p.speed, wspd = p.speed * p.workSpeed, lspd = p.speed * p.lordSpeed;
        const hFloor = p.harvestFloor;
        /* What a farmer can lift scales with what they burn. This is the price
           of a cheap metabolism and the reason it does not simply fall forever. */
        const hScale = p.harvestMax / p.metMean;
        const socialW = p.social;
        const rentShare = p.rentShare;
        const above = p.storeAbove, sRate = p.storeRate, sEff = p.storeEff;
        const below = p.drawBelow, dRate = p.drawRate, belly = p.bellyMax;
        const lux = p.lordLuxury;
        const hold2 = p.seatHold * p.seatHold;
        const claimFert = p.claimFert;
        const maturity = p.maturity, birthGap = p.birthGap;
        const now = this.tickCount;

        const claimMin = p.claimMin;
        const lspdS = p.speed * p.soldierSpeed;
        const wage = p.soldierWage;
        const road = this.road, city = this.city;
        const eGranary = this.eGranary, eCitizens = this.eCitizens;
        const eFoodSold = this.eFoodSold, eGrainIn = this.eGrainIn;
        const cityR2 = p.cityRadius * p.cityRadius;
        const cspd = p.speed * 0.5;
        const cityWage = p.cityWage, price = p.foodPrice, ration = p.ration;
        const cityStock = p.cityStock;
        const eStrike = this.eStrike;
        let civDead = 0;
        const stGov = this.stGov, stOfficials = this.stOfficials;
        const stShedOff = this.stShedOff, offSalary = p.officialSalary;
        const stWantOff = this.stWantOff;
        const minGrain = p.cityMinGranary, draw = p.cityDraw;
        const roadSpeed = p.roadSpeed;
        let desertions = 0;

        let pop = 0, lords = 0, soldiers = 0, citizens = 0, officials = 0;
        let sf = 0, sc = 0, sm = 0, harvested = 0;
        let starved = 0, aged = 0;
        this._bqN = 0;
        this._cqN = 0;
        for (let e = 0; e < MAX_ESTATES; e++) { eCand[e] = -1; eCandCap[e] = 1e30; }

        let rs = this._rs;      /* PRNG state, inlined below */

        for (let i = 0; i < MAX_AGENTS; i++) {
            if (AL[i] === 0) continue;

            let x = X[i], y = Y[i], d = D[i];

            /* An estate that folded, or one that missed payroll, no longer has
               anybody in its service. Both cases land here as the same check. */
            let ro = RO[i];
            if (ro !== ROLE_FARMER) {
                const e = EST[i];
                let quit = false;
                if (e < 0 || eAlive[e] === 0) quit = true;
                else if (ro === ROLE_SOLDIER) {
                    /* Somebody has to be the casualty a battle already decided. */
                    const st = eState[e];
                    if (st >= 0 && stCasualties[st] > 0) {
                        stCasualties[st]--;
                        this._kill(i);
                        warDead++;
                        continue;
                    }
                    if (eShed[e] > 0) { eShed[e]--; quit = true; }
                }
                if (quit) {
                    if (ro === ROLE_SOLDIER) desertions++;
                    ro = ROLE_FARMER;
                    RO[i] = ROLE_FARMER;
                    EST[i] = -1;
                }
            }
            const isLord = ro === ROLE_LORD;
            const isSoldier = ro === ROLE_SOLDIER;
            const isCitizen = ro === ROLE_CITIZEN;
            const isOfficial = ro === ROLE_OFFICIAL;
            let speed;

            if (isOfficial) {
                /* An official lives a townsman's life — same walls, same
                   market — but is paid by the state rather than by a lord, and
                   what he produces is administration rather than goods. */
                const e = EST[i];
                const st = eState[e];
                if (st < 0 || stGov[st] === 0 || stShedOff[st] > 0) {
                    if (st >= 0 && stShedOff[st] > 0) stShedOff[st]--;
                    RO[i] = ROLE_CITIZEN;
                } else {
                    const seatDX = eSeatX[e] - x, seatDY = eSeatY[e] - y;
                    if (seatDX * seatDX + seatDY * seatDY > cityR2) {
                        const wantD = ((Math.atan2(seatDY, seatDX) * DIR_PER_RAD) | 0) & DMASK;
                        let diff = (wantD - d) & DMASK;
                        if (diff > 512) diff -= DIRS;
                        if (diff > turn) diff = turn; else if (diff < -turn) diff = -turn;
                        d = (d + diff) & DMASK;
                    }
                    stOfficials[st]++;
                    C[i] += offSalary;

                    const stock = eGranary[e];
                    let want = cityStock - F[i];
                    if (want > ration) want = ration;
                    if (want > stock) want = stock;
                    const afford = C[i] / price;
                    if (want > afford) want = afford;
                    if (want > 0) {
                        eGranary[e] = stock - want;
                        eFoodSold[e] += want;
                        C[i] -= want * price;
                        F[i] += want;
                    } else if (F[i] < 0.6) {
                        RO[i] = ROLE_CITIZEN;
                    }
                }
                speed = cspd;

                rs = (rs + 0x6D2B79F5) | 0;
                let to = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                to = (to + Math.imul(to ^ (to >>> 7), 61 | to)) ^ to;
                const ro2 = ((to ^ (to >>> 14)) >>> 0) / 4294967296;
                d = (d + (((ro2 * 2 - 1) * wob) | 0)) & DMASK;

            } else if (isCitizen) {
                /* Keep to the town, draw the wage, buy the day's grain. A
                   townsman with no granary to buy from, or no coin to buy
                   with, goes back to the land rather than dying in the street. */
                const e = EST[i];
                const seatDX = eSeatX[e] - x, seatDY = eSeatY[e] - y;
                if (seatDX * seatDX + seatDY * seatDY > cityR2) {
                    const want = ((Math.atan2(seatDY, seatDX) * DIR_PER_RAD) | 0) & DMASK;
                    let diff = (want - d) & DMASK;
                    if (diff > 512) diff -= DIRS;
                    if (diff > turn) diff = turn; else if (diff < -turn) diff = -turn;
                    d = (d + diff) & DMASK;
                }
                speed = cspd;

                rs = (rs + 0x6D2B79F5) | 0;
                let tc = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                tc = (tc + Math.imul(tc ^ (tc >>> 7), 61 | tc)) ^ tc;
                const rc = ((tc ^ (tc >>> 14)) >>> 0) / 4294967296;
                d = (d + (((rc * 2 - 1) * wob) | 0)) & DMASK;

                C[i] += cityWage;
                eCitizens[e]++;

                /* A townsman buys to keep a larder, not to speculate. The
                   target is deliberately BELOW storeAbove: buying past that
                   point would push the surplus straight into the storage rule,
                   which converts food to capital at a loss — so townsfolk sat
                   there laundering the granary into coin, never satiating, and
                   drained every town below the stock a newcomer needs to see
                   before moving in. The whole urban population was pinned at a
                   quarter of what the grain could feed by that one line. */
                /* Shells landed here. Somebody in the street was under them. */
                if (eStrike[e] > 0) {
                    eStrike[e]--;
                    this._kill(i);
                    civDead++;
                    continue;
                }

                const stock = eGranary[e];
                let want = cityStock - F[i];
                if (want > ration) want = ration;
                if (want > stock) want = stock;
                const afford = C[i] / price;
                if (want > afford) want = afford;
                if (want > 0) {
                    eGranary[e] = stock - want;
                    eFoodSold[e] += want;
                    C[i] -= want * price;
                    F[i] += want;
                }
                /* Leaving town is a decision about your own belly, not about
                   the state of the market this instant. A granary running
                   hand-to-mouth hits zero most days; reverting everyone the
                   moment it did emptied every town in the country on a
                   rounding error and pinned the urban population at a quarter
                   of what the grain could actually feed. A townsman with food
                   in hand simply waits for the next cart. */
                else if (F[i] < 0.6) {
                    RO[i] = ROLE_FARMER; EST[i] = -1;
                }

                /* Officials are drawn from townsfolk, because that is where
                   literate people not needed in a field are to be found. One
                   appointment per state per tick, the same pacing a lord uses
                   to raise men. */
                if (RO[i] === ROLE_CITIZEN) {
                    const st2 = eState[e];
                    if (st2 >= 0 && stGov[st2] === 1 && stWantOff[st2] > 0) {
                        stWantOff[st2]--;
                        RO[i] = ROLE_OFFICIAL;
                    }
                }

            } else if (isSoldier) {
                /* Patrol: keep inside the domain, otherwise drift. A garrison
                   is a presence spread over ground, not a formation. */
                const e = EST[i];
                const dx = eSeatX[e] - x, dy = eSeatY[e] - y;
                const patrol = eRadius[e] * 0.8;
                if (dx * dx + dy * dy > patrol * patrol) {
                    const want = ((Math.atan2(dy, dx) * DIR_PER_RAD) | 0) & DMASK;
                    let diff = (want - d) & DMASK;
                    if (diff > 512) diff -= DIRS;
                    if (diff > turn) diff = turn; else if (diff < -turn) diff = -turn;
                    d = (d + diff) & DMASK;
                }
                speed = lspdS;
                eSoldiers[e]++;
                /* Paid here, on the agent's own side of the ledger; the lord is
                   debited wage x troops in _settleEstates off the same count,
                   so the two halves cannot drift apart. */
                C[i] += wage;

                rs = (rs + 0x6D2B79F5) | 0;
                let ts = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                ts = (ts + Math.imul(ts ^ (ts >>> 7), 61 | ts)) ^ ts;
                const rsv = ((ts ^ (ts >>> 14)) >>> 0) / 4294967296;
                d = (d + (((rsv * 2 - 1) * wob) | 0)) & DMASK;

            } else if (isLord) {
                /* A lord does not forage. They keep to the manor and live on
                   rent, which is exactly why an estate with no tenants kills
                   its owner. */
                const e = EST[i];
                if (e >= 0) {
                    const dx = eSeatX[e] - x, dy = eSeatY[e] - y;
                    if (dx * dx + dy * dy > hold2) {
                        const want = ((Math.atan2(dy, dx) * DIR_PER_RAD) | 0) & DMASK;
                        let diff = (want - d) & DMASK;
                        if (diff > 512) diff -= DIRS;
                        if (diff > turn) diff = turn; else if (diff < -turn) diff = -turn;
                        d = (d + diff) & DMASK;
                    }
                }
                speed = lspd;

                rs = (rs + 0x6D2B79F5) | 0;
                let tl = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                tl = (tl + Math.imul(tl ^ (tl >>> 7), 61 | tl)) ^ tl;
                const rl = ((tl ^ (tl >>> 14)) >>> 0) / 4294967296;
                d = (d + (((rl * 2 - 1) * wob) | 0)) & DMASK;

            } else {
                /* --- look ahead: left, straight, right. The score is food plus
                   a taste for company; neither term alone produces a village. */
                const dl = (d - spread) & DMASK, dr = (d + spread) & DMASK;

                let px = x + COS[d] * sd, py = y + SIN[d] * sd;
                let cx = (px * INV_CELL) | 0, cy = (py * INV_CELL) | 0;
                if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
                if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
                let q = cy * GW + cx;
                const sC = crop[q] + socialW * densR[q];

                px = x + COS[dl] * sd; py = y + SIN[dl] * sd;
                cx = (px * INV_CELL) | 0; cy = (py * INV_CELL) | 0;
                if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
                if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
                q = cy * GW + cx;
                const sL = crop[q] + socialW * densR[q];

                px = x + COS[dr] * sd; py = y + SIN[dr] * sd;
                cx = (px * INV_CELL) | 0; cy = (py * INV_CELL) | 0;
                if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
                if (cy < 0) cy = 0; else if (cy >= GH) cy = GH - 1;
                q = cy * GW + cx;
                const sR = crop[q] + socialW * densR[q];

                if (sL > sC && sL >= sR) d = (d - turn) & DMASK;
                else if (sR > sC && sR > sL) d = (d + turn) & DMASK;

                /* mulberry32, inlined */
                rs = (rs + 0x6D2B79F5) | 0;
                let tw = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                tw = (tw + Math.imul(tw ^ (tw >>> 7), 61 | tw)) ^ tw;
                const r1 = ((tw ^ (tw >>> 14)) >>> 0) / 4294967296;
                d = (d + (((r1 * 2 - 1) * wob) | 0)) & DMASK;

                /* --- work the ground underfoot, and pay the landlord --- */
                const ci = ((y * INV_CELL) | 0) * GW + ((x * INV_CELL) | 0);
                const standing = crop[ci];
                speed = spd;
                if (standing > hFloor) {
                    const lift = hScale * M[i];
                    const take = standing < lift ? standing : lift;
                    crop[ci] = standing - take;
                    harvested += take;
                    const o = own[ci];
                    if (o >= 0) {
                        /* Only what the garrison can actually collect. The
                           grain is real and goes somewhere: half of it into
                           the town's granary, the rest sold at once. */
                        const rent = take * rentShare * eEnforce[o];
                        eRent[o] += rent;         /* credited after the loop */
                        eGrainIn[o] += rent;
                        eTenants[o]++;
                        F[i] += take - rent;
                    } else {
                        F[i] += take;
                    }
                    speed = wspd;   /* a farmer working a rich cell lingers */
                }

                /* Inside a town with grain in store, a farmer may take up a
                   trade. Slowly — this is a working life changing, not a
                   crowd flowing downhill. */
                const ce = city[ci];
                if (ce >= 0 && eGranary[ce] > minGrain) {
                    rs = (rs + 0x6D2B79F5) | 0;
                    let tt = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                    tt = (tt + Math.imul(tt ^ (tt >>> 7), 61 | tt)) ^ tt;
                    if (((tt ^ (tt >>> 14)) >>> 0) / 4294967296 < draw) {
                        RO[i] = ROLE_CITIZEN;
                        EST[i] = ce;
                    }
                }

                const oc = own[ci];
                if (oc >= 0) {
                    /* Spotted while walking the lord's ground: the poorest
                       grown man on the estate is who takes the shilling. */
                    if (A[i] >= maturity && C[i] < eCandCap[oc]) {
                        eCandCap[oc] = C[i];
                        eCand[oc] = i;
                    }
                } else if (C[i] >= claimMin && A[i] >= maturity &&
                           fert[ci] > claimFert && this._cqN < 256) {
                    /* --- enclosure. Queued, because taking land changes the
                       field every later agent this tick is walking over. --- */
                    this._cq[this._cqN++] = i;
                }
            }

            /* --- move, bouncing off the edges of the world and off water --- */
            const fromX = x, fromY = y;
            if (road[((y * INV_CELL) | 0) * GW + ((x * INV_CELL) | 0)] === 1) speed *= roadSpeed;
            x += COS[d] * speed;
            y += SIN[d] * speed;
            if (x < 0) { x = 0; d = (512 - d) & DMASK; }
            else if (x > XMAX) { x = XMAX; d = (512 - d) & DMASK; }
            if (y < 0) { y = 0; d = (-d) & DMASK; }
            else if (y > YMAX) { y = YMAX; d = (-d) & DMASK; }
            /* Nobody swims. Refusing the step rather than sliding along the
               shore is what keeps the coastline a hard edge; agents pile up on
               it, which is the point — the fish are on the other side. */
            if (walk[((y * INV_CELL) | 0) * GW + ((x * INV_CELL) | 0)] === 0) {
                x = fromX; y = fromY;
                d = (d + 512) & DMASK;
            }
            X[i] = x; Y[i] = y; D[i] = d;

            densW[((y * INV_CELL) | 0) * GW + ((x * INV_CELL) | 0)]++;

            /* --- eat, then bank or draw down --- */
            let f = F[i] - (isLord ? M[i] * lux : M[i]);
            let cap = C[i];
            if (f > above) {
                let mv = f - above;
                if (mv > sRate) mv = sRate;
                f -= mv;
                cap += mv * sEff;
            } else if (f < below && cap > 0) {
                const mv = cap < dRate ? cap : dRate;
                cap -= mv;
                f += mv;
            }
            if (f > belly) f = belly;

            if (f <= 0) { this._kill(i); starved++; continue; }

            let age = A[i] + 1;
            if (age >= MAX_AGE) age = MAX_AGE - 1;
            const h = haz[age];
            if (h > 0) {
                rs = (rs + 0x6D2B79F5) | 0;
                let tm = Math.imul(rs ^ (rs >>> 15), 1 | rs);
                tm = (tm + Math.imul(tm ^ (tm >>> 7), 61 | tm)) ^ tm;
                if (((tm ^ (tm >>> 14)) >>> 0) / 4294967296 < h) {
                    this._kill(i); aged++; continue;
                }
            }

            F[i] = f; C[i] = cap; A[i] = age;

            /* Births are queued, not spawned here: a child dropped into a slot
               above i would otherwise be updated again in the same tick. */
            if (age >= maturity && cap >= p.birthCapital && f >= p.birthFood &&
                now - this.lastBirth[i] >= birthGap) {
                this._bq[this._bqN++] = i;
            }

            pop++; sf += f; sc += cap; sm += M[i];
            if (isLord) lords++;
            else if (isSoldier) soldiers++;
            else if (isCitizen) citizens++;
            else if (isOfficial) officials++;
        }

        this._rs = rs;   /* hand the stream back before any cold-path draws */

        /* Order matters from here. Enclosure first, so a new manor is on the
           map before rents settle. Estates next, so a dead lord's succession is
           resolved while his slot still reads as dead — births recycle slots,
           and a newborn must never wake up owning a county. */
        this._enclose();
        this._settleEstates();
        this._settleStates();
        if (this.tickCount % p.consolidateInterval === 0) this._consolidate();
        /* Diplomacy is annual and battles are fought every few days, both off
           the compact live list _settleEstates just rebuilt. Neither is in the
           per-agent path, so a map of twenty states costs a few hundred ops. */
        if (this.tickCount % p.diploInterval === 0) { this._diplomacy(); this._rebellions(); }
        if (this.tickCount % p.battleInterval === 0) this._wars();

        /* --- births --- */
        let born = 0, denied = 0;
        for (let k = 0; k < this._bqN; k++) {
            if (this._freeN === 0) { denied = this._bqN - k; break; }
            const par = this._bq[k];
            if (C[par] < p.birthCapital) continue;   /* spent it enclosing */
            const j = this._free[--this._freeN];
            C[par] -= p.birthCapital;
            this.lastBirth[par] = now;

            X[j] = X[par]; Y[j] = Y[par];
            D[j] = (this.rand() * DIRS) | 0;
            F[j] = p.birthEndow;
            C[j] = 0;
            let m = M[par] * Math.exp(this.gauss() * p.metMutate);
            if (m < p.metMin) m = p.metMin; else if (m > p.metMax) m = p.metMax;
            M[j] = m;
            A[j] = 0;
            RO[j] = ROLE_FARMER;      /* nobody is born a lord */
            EST[j] = -1;
            this.lastBirth[j] = now;
            AL[j] = 1;

            born++; pop++; sf += F[j]; sm += m;
        }

        /* swap the neighbour field: what was written is what the sensor reads */
        this.densR = densW;
        this.densW = densR;

        this.pop = pop;
        this.lords = lords;
        this.soldiers = soldiers;
        this.citizens = citizens;
        this.officials = officials;
        this.desertions += desertions;
        this.warDead += warDead;
        this.civilianDead += civDead;
        this.births = born;
        this.starved = starved;
        this.aged = aged;
        this.denied = denied;
        this.capped = denied > 0;
        this.harvested = harvested;
        this.sumFood = sf;
        this.sumCapital = sc;
        this.sumMet = sm;
        this.totalBirths += born;
        this.totalStarved += starved;
        this.totalAged += aged;
        this.tickCount++;
    },

    /* ------------------------------------------------------- property --- */

    _enclose() {
        const p = this.P, gap2 = p.seatGap * p.seatGap;
        for (let k = 0; k < this._cqN; k++) {
            if (this._eFreeN === 0 || this._stFreeN === 0) break;
            const i = this._cq[k];
            if (this.alive[i] === 0 || this.role[i] !== ROLE_FARMER) continue;
            if (this.capital[i] < p.claimMin) continue;
            const px = this.x[i], py = this.y[i];
            const ci = ((py * INV_CELL) | 0) * GW + ((px * INV_CELL) | 0);
            if (this.owner[ci] >= 0) continue;    /* claimed since queueing */

            /* Two tests, and the second is the one that keeps domains apart.
               seatGap is a floor for spacing; the real rule is that the new
               disc must clear every existing disc as it stands *now* — a manor
               that has grown to maxRadius pushes newcomers correspondingly
               further out. Testing only the fixed gap let a fresh 55-unit claim
               be founded inside a grown neighbour's 110, and the two overlapped
               permanently, because cells are stamped once and never released. */
            let clear = true;
            for (let e = 0; e < MAX_ESTATES; e++) {
                if (this.eAlive[e] === 0) continue;
                const dx = this.eSeatX[e] - px, dy = this.eSeatY[e] - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < gap2) { clear = false; break; }
                const need = this.eRadius[e] + p.claimRadius;
                if (d2 < need * need) { clear = false; break; }
            }
            if (!clear) continue;

            const e = this._eFree[--this._eFreeN];
            this.eAlive[e] = 1;
            this.eLord[e] = i;
            this.eSeatX[e] = px;
            this.eSeatY[e] = py;
            this.eRadius[e] = p.claimRadius;
            this.eCells[e] = 0;
            for (let k = 0; k < NRES; k++) this.eRes[e * NRES + k] = 0;
            this.eRegrow[e] = p.regrow * (1 + p.improve);
            this.eSoldierCost[e] = p.soldierCost;
            this.eUpkeep[e] = p.upkeep;
            this.eOilIncome[e] = 0;
            this.eRent[e] = 0;
            this.eRentLast[e] = 0;
            this.eTenants[e] = 0;
            this.eTenantsLast[e] = 0;
            this.eBorn[e] = this.tickCount;
            this.eSoldiers[e] = 0;
            this.eGarrison[e] = 0;
            this.eBroke[e] = 0;
            this.eShed[e] = 0;
            /* Deference only, until he can afford a man. */
            this.eEnforce[e] = p.enforceBase;

            /* Born sovereign: a state of one, answering to nobody until a
               neighbour's border reaches it. */
            const st = this._stFree[--this._stFreeN];
            this.stAlive[st] = 1;
            this.stLead[st] = e;
            this.stMembers[st] = 1;
            this.stWar[st] = -1;
            this.stWarSince[st] = 0;
            /* A founding grace. Without it a manor that has not yet hired its
               first soldier meets a neighbour, loses the opening battle, and is
               annexed eight ticks later — every new state died in infancy and
               nothing ever federated. */
            this.stCd[st] = p.foundingGrace;
            this.stCasualties[st] = 0;
            this.stBattles[st] = 0;
            this.stBorn[st] = this.tickCount;
            this.eState[e] = st;
            this.eSubject[e] = 0;

            this.capital[i] -= p.claimCost;
            this.role[i] = ROLE_LORD;
            this.estateOf[i] = e;
            this._stamp(e);
            this.enclosures++;
            this._logEvent('found', e, st, 0);
        }
    },

    /* Claim every unowned cell whose centre falls inside the domain. Cells are
       never released except on dissolution, so the running count only grows. */
    _stamp(e) {
        const sx = this.eSeatX[e], sy = this.eSeatY[e], r = this.eRadius[e];
        const r2 = r * r, own = this.owner;
        let x0 = ((sx - r) * INV_CELL) | 0, x1 = ((sx + r) * INV_CELL) | 0;
        let y0 = ((sy - r) * INV_CELL) | 0, y1 = ((sy + r) * INV_CELL) | 0;
        if (x0 < 0) x0 = 0; if (x1 >= GW) x1 = GW - 1;
        if (y0 < 0) y0 = 0; if (y1 >= GH) y1 = GH - 1;
        const res = this.res, eRes = this.eRes, base = e * NRES;
        let added = 0;
        for (let cy = y0; cy <= y1; cy++) {
            const dy = (cy + 0.5) * CELL - sy;
            const dy2 = dy * dy;
            const row = cy * GW;
            for (let cx = x0; cx <= x1; cx++) {
                const dx = (cx + 0.5) * CELL - sx;
                if (dx * dx + dy2 > r2) continue;
                const c = row + cx;
                if (own[c] >= 0) continue;
                /* Open water is nobody's: a lord can hold the shore but not the
                   sea, so a coastal domain is genuinely smaller than its radius
                   suggests and pays upkeep only on what it actually holds. */
                if (this.walk[c] === 0) continue;
                own[c] = e;
                this.improved[c] = 1;      /* the manor's own worked ground */
                added++;
                for (let k = 0; k < NRES; k++) eRes[base + k] += res[k][c];
            }
        }
        this.eCells[e] += added;
        if (added > 0) this.ownerVersion++;
    },

    /* Towns and the roads between them. Rebuilt whole rather than patched,
       because it only runs when the ownership map or a state's membership has
       actually changed — a few times a century — and a full rebuild cannot
       drift out of step with the estates the way incremental edits would.

       A road runs from every manor to the capital of its own state. That is
       also, deliberately, the route the grain levy travels: the reason a
       capital outgrows its own farmland is that it is at the end of every
       road. */
    _rebuildInfrastructure() {
        const p = this.P;
        this.road.fill(0);
        this.city.fill(-1);

        const live = this._liveE, n = this._liveN;
        for (let i = 0; i < n; i++) {
            const e = live[i];
            if (this.eAlive[e] === 0) continue;

            this._stampCity(e, p.cityRadius);

            const st = this.eState[e];
            if (st < 0) continue;
            const lead = this.stLead[st];
            if (lead < 0 || lead === e || this.eAlive[lead] === 0) continue;
            this._stampRoad(this.eSeatX[e], this.eSeatY[e],
                            this.eSeatX[lead], this.eSeatY[lead]);
        }
        this.roadVersion = this.ownerVersion;
    },

    _stampCity(e, r) {
        const sx = this.eSeatX[e], sy = this.eSeatY[e], r2 = r * r;
        const city = this.city, walk = this.walk;
        let x0 = ((sx - r) * INV_CELL) | 0, x1 = ((sx + r) * INV_CELL) | 0;
        let y0 = ((sy - r) * INV_CELL) | 0, y1 = ((sy + r) * INV_CELL) | 0;
        if (x0 < 0) x0 = 0; if (x1 >= GW) x1 = GW - 1;
        if (y0 < 0) y0 = 0; if (y1 >= GH) y1 = GH - 1;
        for (let cy = y0; cy <= y1; cy++) {
            const dy = (cy + 0.5) * CELL - sy, dy2 = dy * dy;
            const row = cy * GW;
            for (let cx = x0; cx <= x1; cx++) {
                const dx = (cx + 0.5) * CELL - sx;
                if (dx * dx + dy2 > r2) continue;
                const c = row + cx;
                if (walk[c] === 1) city[c] = e;
            }
        }
    },

    /* Bresenham, two cells wide so a walker actually lands on it. Water is
       skipped rather than bridged, so a road across a bay simply is not there —
       which is the right answer and costs nothing to say. */
    _stampRoad(wx0, wy0, wx1, wy1) {
        const road = this.road, walk = this.walk;
        let x0 = (wx0 * INV_CELL) | 0, y0 = (wy0 * INV_CELL) | 0;
        const x1 = (wx1 * INV_CELL) | 0, y1 = (wy1 * INV_CELL) | 0;
        const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let guard = 0; guard < 4096; guard++) {
            const c = y0 * GW + x0;
            if (walk[c] === 1) road[c] = 1;
            if (x0 + 1 < GW && walk[c + 1] === 1) road[c + 1] = 1;
            if (y0 + 1 < GH && walk[c + GW] === 1) road[c + GW] = 1;
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; x0 += sx; }
            if (e2 <= dx) { err += dx; y0 += sy; }
            if (x0 < 0 || x0 >= GW || y0 < 0 || y0 >= GH) break;
        }
    },

    _settleEstates() {
        const p = this.P, C = this.capital, AL = this.alive;
        let dissolved = false;
        let count = 0, cells = 0, tenants = 0, rent = 0, wages = 0, levy = 0;
        let garrison = 0, enforceSum = 0, subjects = 0, oilTotal = 0;
        let townPop = 0, granaryTotal = 0, craftTotal = 0, grainMoved = 0;
        let taxPaid = 0, subsidy = 0;

        /* Compact list of the living, rebuilt once and reused by the radius
           cap below and by diplomacy and war after. */
        const live = this._liveE;
        let ln = 0;
        for (let e = 0; e < MAX_ESTATES; e++) if (this.eAlive[e] === 1) live[ln++] = e;
        this._liveN = ln;

        for (let li = 0; li < ln; li++) {
            const e = live[li];
            if (this.eAlive[e] === 0) continue;      /* folded earlier this pass */

            let lord = this.eLord[e];
            if (AL[lord] === 0) {
                lord = this._succeed(e);
                if (lord < 0) { this._dissolve(e); dissolved = true; continue; }
            }

            /* --- what the ground under this estate is worth --- */
            const base = e * NRES, nCells = this.eCells[e] || 1;
            const dens = this.eResDens;
            for (let k = 0; k < NRES; k++) dens[base + k] = this.eRes[base + k] / nCells;
            const dMin = dens[base + R_MIN], dOil = dens[base + R_OIL];
            const dEnergy = dens[base + R_ENERGY], dFert = dens[base + R_FERT];

            /* A lord improves his own ground; a government drains and irrigates
               a whole country. The works bonus is what a nation-state actually
               buys its farmers, and it is why one out-feeds the manors it was
               assembled from. */
            const stNow = this.eState[e];
            const works = (stNow >= 0 && this.stGov[stNow] === 1)
                ? p.worksBonus * this.stWorks[stNow] : 0;
            this.eRegrow[e] = p.regrow * (1 + p.improve * (1 + p.fertBoost * dFert) + works);
            const sCost = p.soldierCost * (1 - p.mineralDiscount * dMin);
            const upk = p.upkeep * (1 - p.energyDiscount * dEnergy);
            const oil = p.oilIncome * dOil * nCells / 100;
            this.eSoldierCost[e] = sCost;
            this.eUpkeep[e] = upk;
            this.eOilIncome[e] = oil;

            const troops = this.eSoldiers[e];
            const tn = this.eTenants[e];
            const income = this.eRent[e];
            const payroll = sCost * troops;

            /* --- the granary and the market --------------------------------
               The rent is booked at market value the moment it arrives, exactly
               as it was before there were towns — so a lord with no town is
               precisely as well off as he used to be, and the older economy is
               untouched underneath this one. An earlier version credited him
               only for the portion not put into store, and the granary then
               swallowed a new lord's entire income for the sixty-odd ticks it
               took to fill: every manor founded went bankrupt before its town
               existed, and the map fell to two estates.

               Crediting both the rent and the townsfolk's payments is not
               double counting. The grain is valued once; the coin the townsman
               hands over is the wage the lord paid him a moment earlier,
               circulating back. The only thing actually created is craft, which
               is the whole point of a town. */
            const grain = this.eGrainIn[e];
            this.eGrainIn[e] = 0;
            const grainValue = grain * p.foodPrice;
            let store = this.eGranary[e] + grain * p.granaryShare;
            if (store > p.granaryCap) store = p.granaryCap;   /* the rest spoils */
            this.eGranary[e] = store;

            const cz = this.eCitizens[e];
            const market = this.eFoodSold[e] * p.foodPrice;   /* grain sold to townsfolk */
            const cityWages = p.cityWage * cz;
            const craft = p.craftValue * cz;
            this.eTownPop[e] = cz;
            this.eCitizens[e] = 0;
            this.eFoodSold[e] = 0;
            townPop += cz;
            granaryTotal += store;
            craftTotal += craft;

            const revenue = grainValue + market + craft;
            C[lord] += revenue + oil - cityWages - upk * this.eCells[e] - payroll;
            C[lord] -= C[lord] * p.lordDecay;      /* the cost of station */
            oilTotal += oil;

            this.eRentLast[e] = income;
            this.eTenantsLast[e] = tn;
            this.eGarrison[e] = troops;
            rent += income;
            wages += payroll;
            tenants += tn;
            garrison += troops;
            this.eRent[e] = 0;
            this.eTenants[e] = 0;
            this.eSoldiers[e] = 0;

            /* Payroll missed. The garrison walks at the top of next tick, and
               with it goes the enforcement that was collecting the rent — a
               lord in arrears unravels in a season, not a generation. */
            if (C[lord] < 0) {
                const short = -C[lord];
                C[lord] = 0;
                if (troops > 0) {
                    let shed = Math.ceil(short / Math.max(1e-6, sCost));
                    if (shed > troops) shed = troops;
                    this.eShed[e] = shed;
                    this.eBroke[e] = 1;
                } else {
                    /* No army left to shed and still short: the manor folds and
                       the land returns to the commons. This is the only thing
                       stopping the map ending up quietly owned end to end. */
                    this._dissolve(e);
                    dissolved = true;
                    continue;
                }
            } else {
                this.eBroke[e] = 0;
            }

            /* The levy: a partner's share, or a subject's tribute, paid up to
               whoever holds the capital of the state. This is the first income
               in the model that scales with how many *manors* answer to you
               rather than how much land you personally hold — which is what
               makes a king a different animal from a rich lord. */
            const st = this.eState[e];
            if (st >= 0 && this.stGov[st] === 1) {
                /* A government taxes. The money goes to the treasury, which
                   belongs to the state and not to whoever holds the capital —
                   that is the entire difference between this and a levy. What
                   arrives is the assessment times how far the administration
                   actually reaches. */
                const due = revenue * p.taxRate * this.stAdmin[st];
                C[lord] -= due;
                this.stTreasury[st] += due;
                this.stTaxTake[st] += due;
                taxPaid += due;

                /* And the state meets part of his payroll — but never out of
                   the standing reserve, which is spoken for by the civil
                   service. A bigger national army made this bill large enough
                   to swallow the treasury whole, the officials went unpaid and
                   were dismissed, administration fell back to its customary
                   base, and the tax that funded the army fell with it. */
                const help = payroll * p.armyShare;
                if (this.stTreasury[st] - help >= p.treasuryReserve) {
                    this.stTreasury[st] -= help;
                    C[lord] += help;
                    subsidy += help;
                }
            } else if (st >= 0) {
                const lead = this.stLead[st];
                if (lead >= 0 && lead !== e && this.eAlive[lead] === 1) {
                    const king = this.eLord[lead];
                    if (king >= 0 && AL[king] === 1) {
                        /* Coin on what was actually realised, not on the rent
                           statistic — grain still sitting in the granary has
                           not been sold and cannot be taxed. */
                        const due = revenue * (this.eSubject[e] ? p.tributeShare : p.levyShare);
                        C[lord] -= due;
                        C[king] += due;
                        levy += due;

                        /* And grain itself goes up the road. This is why a
                           capital outgrows its own farmland: it eats the
                           surplus of every manor that answers to it. */
                        const cart = this.eGranary[e] * p.levyFood;
                        if (cart > 0) {
                            this.eGranary[e] -= cart;
                            const room = p.granaryCap - this.eGranary[lead];
                            this.eGranary[lead] += cart < room ? cart : (room > 0 ? room : 0);
                            grainMoved += cart;
                        }
                    }
                }
                if (this.eSubject[e]) subjects++;
            }

            /* What the garrison can hold, applied to next tick's collections.
               Men in the field are not men standing over a harvest.

               A government keeps more men under arms per subject than a manor
               does — that, not the subsidy, is what makes a nation militarily
               heavier. Paying half of a lord's payroll only made him richer,
               because his garrison was sized by how many tenants he had to
               watch and never by what he could afford: subsidised and
               unsubsidised estates fielded the same 7 men apiece. */
            const isGov = st >= 0 && this.stGov[st] === 1;
            const want = tn * p.perTenant * (isGov ? 1 + p.govArmyBonus : 1);
            let enf = p.enforceBase + (want > 0 ? troops / want : 1);
            if (enf > 1) enf = 1;
            if (st >= 0 && this.stWar[st] >= 0) enf *= p.warEnforce;
            this.eEnforce[e] = enf;
            enforceSum += enf;

            /* Pay a signing bonus and take on the poorest man on the ground. */
            if (this.eBroke[e] === 0 && troops < Math.ceil(want) &&
                C[lord] >= p.lordReserve + p.recruitBonus) {
                const cand = this.eCand[e];
                if (cand >= 0 && AL[cand] === 1 && this.role[cand] === ROLE_FARMER) {
                    C[lord] -= p.recruitBonus;
                    C[cand] += p.recruitBonus;
                    this.role[cand] = ROLE_SOLDIER;
                    this.estateOf[cand] = e;
                    this.recruits++;
                }
            }

            /* A border is only as wide as the men who can walk it — and never
               wider than half the way to the next manor, so domains meet edge
               to edge instead of growing through one another. */
            /* Room left is the distance to a neighbour minus what that
               neighbour already holds — not half the distance between them.
               Halving is only correct when both discs are the same size; a
               grown manor beside a small one leaves the small one far less
               than half, and assuming otherwise let them overlap. Whichever
               lord expands first takes the ground, which is the right kind of
               unfairness. */
            let room = p.maxRadius;
            for (let lj = 0; lj < ln; lj++) {
                const f = live[lj];
                if (f === e || this.eAlive[f] === 0) continue;
                const dx = this.eSeatX[f] - this.eSeatX[e];
                const dy = this.eSeatY[f] - this.eSeatY[e];
                const gap = Math.sqrt(dx * dx + dy * dy) - this.eRadius[f];
                if (gap < room) room = gap;
            }
            const allowed = Math.min(p.maxRadius, room,
                p.claimRadius + troops * p.radiusPerSoldier);
            if (this.eBroke[e] === 0 && C[lord] >= p.expandCost + p.lordReserve &&
                this.eRadius[e] < allowed) {
                C[lord] -= p.expandCost;
                const r = this.eRadius[e] + p.expandStep;
                this.eRadius[e] = r > allowed ? allowed : r;
                this._stamp(e);
            }

            count++;
            cells += this.eCells[e];
        }

        if (dissolved) {
            const own = this.owner, eAlive = this.eAlive, improved = this.improved;
            for (let c = 0; c < NCELL; c++) {
                const o = own[c];
                if (o >= 0 && eAlive[o] === 0) { own[c] = -1; improved[c] = 0; }
            }
            this.ownerVersion++;
        }

        if (this.roadVersion !== this.ownerVersion) this._rebuildInfrastructure();

        this.townPop = townPop;
        this.granaryTotal = granaryTotal;
        this.craftFlow = craftTotal;
        this.grainMoved = grainMoved;
        this.taxPaid = taxPaid;
        this.armySubsidy = subsidy;
        this.estateCount = count;
        this.ownedCells = cells;
        this.tenantCount = tenants;
        this.rentFlow = rent;
        this.wageFlow = wages;
        this.levyFlow = levy;
        this.oilFlow = oilTotal;
        this.garrisonTotal = garrison;
        this.subjectEstates = subjects;
        this.meanEnforce = count > 0 ? enforceSum / count : 0;

        let states = 0, biggest = 0, wars = 0;
        for (let s = 0; s < MAX_STATES; s++) {
            if (this.stAlive[s] === 0) continue;
            states++;
            if (this.stMembers[s] > biggest) biggest = this.stMembers[s];
            if (this.stWar[s] >= 0) wars++;
            if (this.stCd[s] > 0) this.stCd[s]--;
        }
        this.stateCount = states;
        this.largestState = biggest;
        this.warCount = wars >> 1;      /* counted from both sides */
    },

    /* ---------------------------------------------------- consolidation --- */

    /* Fills the gaps between the manors of one state, so a country reads as a
       country rather than as beads on a road.
     *
     * A breadth-first sweep outward from every cell already held, nearest
     * holder first — so an unclaimed cell goes to whichever manor is closest to
     * it, and where two states meet the border falls halfway between them
     * instead of leaving a strip of nobody's land. Bounding it by distance from
     * the SEAT rather than by how many steps the sweep has taken is what makes
     * it converge: the reachable set is fixed, so once it is claimed, later
     * passes find nothing to do. Bounding by sweep depth instead would dilate
     * the same territory outward a little further every time it ran, and the
     * map would slowly be eaten.
     *
     * Only states with more than one manor consolidate. That is the whole
     * point — a lone lord holds a disc with commons around it, and joining a
     * state is what turns a holding into a territory. It also, incidentally,
     * hands states the wasteland between their manors, which is where the ore
     * and the oil have been sitting untouched since v0.4.
     */
    _consolidate() {
        const p = this.P;
        const own = this.owner, walk = this.walk, res = this.res;
        const q = this._fillQ, seen = this._fillSeen;
        const eState = this.eState, stGov = this.stGov, stMembers = this.stMembers;
        let head = 0, tail = 0;

        for (let c = 0; c < NCELL; c++) {
            const o = own[c];
            if (o < 0) { seen[c] = 0; continue; }
            seen[c] = 1;
            const s = eState[o];
            if (s < 0 || stMembers[s] < 2) continue;
            q[tail++] = c;
        }

        let claimed = 0;
        while (head < tail) {
            const c = q[head++];
            const o = own[c];
            if (o < 0 || this.eAlive[o] === 0) continue;
            const s = eState[o];
            if (s < 0) continue;
            const reach = this.eRadius[o] +
                (stGov[s] === 1 ? p.govFillBonus : p.fillBonus);
            const r2 = reach * reach;
            const sx = this.eSeatX[o], sy = this.eSeatY[o];
            const cx = c % GW, cy = (c / GW) | 0;

            for (let k = 0; k < 4; k++) {
                let nx = cx, ny = cy;
                if (k === 0) { if (cx === 0) continue; nx--; }
                else if (k === 1) { if (cx === GW - 1) continue; nx++; }
                else if (k === 2) { if (cy === 0) continue; ny--; }
                else { if (cy === GH - 1) continue; ny++; }

                const nb = ny * GW + nx;
                if (seen[nb] === 1 || walk[nb] === 0 || own[nb] >= 0) continue;
                const dx = (nx + 0.5) * CELL - sx, dy = (ny + 0.5) * CELL - sy;
                if (dx * dx + dy * dy > r2) continue;

                seen[nb] = 1;
                own[nb] = o;
                this.eCells[o]++;
                const base = o * NRES;
                for (let j = 0; j < NRES; j++) this.eRes[base + j] += res[j][nb];
                q[tail++] = nb;
                claimed++;
            }
        }

        if (claimed > 0) this.ownerVersion++;
        return claimed;
    },

    /* ------------------------------------------------------- government --- */

    /* Runs after the estates have settled, because the tax it collects is
       assessed on revenue those estates have only just realised. */
    _settleStates() {
        const p = this.P;
        const live = this._liveE, n = this._liveN;
        let govs = 0, treasury = 0, reserve = 0, tax = 0, officials = 0, works = 0;
        let munitions = 0, tribute = 0, arsenal = 0, vassals = 0;

        for (let s = 0; s < MAX_STATES; s++) {
            if (this.stAlive[s] === 0) continue;
            const members = this.stMembers[s];

            if (this.stGov[s] === 0 && members >= p.govMinEstates) {
                this.stGov[s] = 1;
                this.stGovSince[s] = this.tickCount;
                this.stAdmin[s] = p.govAdminBase;
                this.governments++;
                this._logEvent('gov', s, members, 0);
            } else if (this.stGov[s] === 1 && members < p.govMinEstates) {
                /* Too few manors left to be a state rather than a household.
                   The offices are abolished and the survivors are lords again. */
                this.stGov[s] = 0;
                this.stShedOff[s] = this.stOffLast[s];
                this.stAdmin[s] = 0;
                this.collapses++;
                this._logEvent('collapse', s, members, 0);
            }

            const off = this.stOfficials[s];
            this.stOffLast[s] = off;
            this.stOfficials[s] = 0;
            this.stWantOff[s] = 0;

            if (this.stGov[s] === 0) {
                this.stAdmin[s] = 0;
                this.stTaxTake[s] = 0;
                continue;
            }

            /* Officials paid themselves in the agent loop off this same count,
               so debiting the treasury here keeps the two halves exact. */
            this.stTreasury[s] -= p.officialSalary * off;

            if (this.stTreasury[s] < 0) {
                const short = -this.stTreasury[s];
                this.stTreasury[s] = 0;
                let shed = Math.ceil(short / Math.max(1e-6, p.officialSalary));
                if (shed > off) shed = off;
                this.stShedOff[s] = shed;
            }

            /* What the state can actually collect. Without officials only the
               customary dues come in; with enough of them it collects its due. */
            const wantOff = members * p.officialsPerEstate;
            let admin = p.govAdminBase + (wantOff > 0 ? off / wantOff : 1);
            if (admin > 1) admin = 1;
            this.stAdmin[s] = admin;

            if (off < Math.ceil(wantOff) && this.stTreasury[s] > p.treasuryReserve) {
                this.stWantOff[s] = 1;    /* one appointment a tick, like a levy of men */
            }

            /* Public works, charged on the ground held. Partly funded is
               partly built — the bonus follows the money. */
            let held = 0;
            for (let i = 0; i < n; i++) {
                const e = live[i];
                if (this.eAlive[e] === 1 && this.eState[e] === s) held += this.eCells[e];
            }
            /* Works and munitions draw on one pot, split by ordnanceBudget.
               They must be allocated together: with works taking everything
               above the reserve first, there was never anything left for an
               arsenal and not one shell was ever built. Nothing is ever spent
               out of the standing reserve, which is the civil service's. */
            const spendable = Math.max(0, this.stTreasury[s] - p.treasuryReserve);
            const gunPurse = spendable * p.ordnanceBudget;
            const worksPurse = spendable - gunPurse;

            const bill = held * p.worksCost;
            if (bill > 0) {
                const afford = worksPurse < bill ? worksPurse : bill;
                this.stTreasury[s] -= afford;
                this.stWorks[s] = afford / bill;
                works += afford;
            } else {
                this.stWorks[s] = 0;
            }

            /* --- the arsenal -------------------------------------------------
               Guns need ore and they need fuel, and the ceiling is the LESSER
               of the two: a country with mountains full of iron and nothing to
               fire the forges builds nothing at all. This is the first demand
               in the model for the barren ground everyone has been ignoring. */
            let ore = 0, fuel = 0;
            for (let i = 0; i < n; i++) {
                const e = live[i];
                if (this.eAlive[e] === 0 || this.eState[e] !== s) continue;
                ore += this.eRes[e * NRES + R_MIN];
                fuel += this.eRes[e * NRES + R_ENERGY];
            }
            /* Geometric mean, not the lesser of the two. Both are still
               strictly required — no ore or no fuel and the forges are cold —
               but taking the minimum meant only the single best-endowed country
               on the map could build anything at all, and artillery was a
               monopoly rather than an arms race. */
            const industry = Math.sqrt(ore * fuel) * p.ordnancePerDeposit;
            this.stIndustry[s] = industry;
            if (industry > 0 && this.stOrdnance[s] < p.ordnanceCap && gunPurse > 0) {
                let made = gunPurse / p.ordnanceCost;
                if (made > industry) made = industry;
                const room = p.ordnanceCap - this.stOrdnance[s];
                if (made > room) made = room;
                if (made > 0) {
                    this.stTreasury[s] -= made * p.ordnanceCost;
                    this.stOrdnance[s] += made;
                    munitions += made;
                }
            }

            /* --- tribute from vassals ---------------------------------------
               A country beaten from beyond its own borders keeps everything it
               had except its independence. */
            const over = this.stOverlord[s];
            if (over >= 0) {
                if (this.stAlive[over] === 0) {
                    this.stOverlord[s] = -1;
                    this._logEvent('freed', s, over, 0);
                } else {
                    const due = this.stTaxTake[s] * p.vassalTribute;
                    if (due > 0 && this.stTreasury[s] >= due) {
                        this.stTreasury[s] -= due;
                        this.stTreasury[over] += due;
                        tribute += due;
                    }
                }
            }

            this.stTreasury[s] -= this.stTreasury[s] * p.treasuryWaste;

            govs++;
            treasury += this.stTreasury[s];
            reserve += this.stReserve[s];
            tax += this.stTaxTake[s];
            arsenal += this.stOrdnance[s];
            officials += off;
            this.stTaxTake[s] = 0;
        }

        /* The national granary. Towns in surplus give, towns in want draw —
           which is the difference between a bad harvest and a famine, and the
           one thing here no single lord could do for himself. */
        const target = p.reserveTarget, rate = p.reserveRate;
        for (let i = 0; i < n; i++) {
            const e = live[i];
            if (this.eAlive[e] === 0) continue;
            const s = this.eState[e];
            if (s < 0 || this.stGov[s] === 0) continue;
            const g = this.eGranary[e];
            if (g > target) {
                const take = (g - target) * rate;
                this.eGranary[e] = g - take;
                this.stReserve[s] += take;
            } else if (this.stReserve[s] > 0) {
                let give = (target - g) * rate;
                if (give > this.stReserve[s]) give = this.stReserve[s];
                this.eGranary[e] = g + give;
                this.stReserve[s] -= give;
            }
        }

        /* Counted over every living state, not only the governments: losing
           its government does not release a country from tribute, and counting
           inside the government branch reported one vassal where there were
           five. */
        let biggestEmpire = 0;
        this.stVassals.fill(0);
        for (let s = 0; s < MAX_STATES; s++) {
            if (this.stAlive[s] === 0) continue;
            const over = this.stOverlord[s];
            if (over >= 0 && this.stAlive[over] === 1) {
                vassals++;
                this.stVassals[over]++;
            }
        }
        for (let s = 0; s < MAX_STATES; s++) {
            if (this.stAlive[s] === 1 && this.stVassals[s] > biggestEmpire) {
                biggestEmpire = this.stVassals[s];
            }
        }
        this.biggestEmpire = biggestEmpire;

        this.govCount = govs;
        this.treasuryTotal = treasury;
        this.reserveTotal = reserve;
        this.taxFlow = tax;
        this.worksFlow = works;
        this.munitionsFlow = munitions;
        this.tributeFlow = tribute;
        this.arsenalTotal = arsenal;
        this.vassalCount = vassals;
        this.officialsEmployed = officials;
    },

    /* ---------------------------------------------------- states & wars --- */

    /* Fighting strength. The lord counts for one, so a state is never worth
       zero and a ratio never divides by nothing. */
    _stateStrength(s) {
        const live = this._liveE, n = this._liveN;
        let v = 0;
        for (let i = 0; i < n; i++) {
            const e = live[i];
            if (this.eAlive[e] === 1 && this.eState[e] === s) v += this.eGarrison[e] + 1;
        }
        return v;
    },

    /* How rich a state's ground is, 0..1, as the mean deposit density across
       its estates. Deliberately a density and not a total: a large poor state
       should not read as a prize simply for being large. */
    _statePrize(s) {
        const live = this._liveE, n = this._liveN;
        let sum = 0, k = 0;
        for (let i = 0; i < n; i++) {
            const e = live[i];
            if (this.eAlive[e] === 0 || this.eState[e] !== s) continue;
            const base = e * NRES;
            sum += this.eResDens[base] + this.eResDens[base + 1] +
                   this.eResDens[base + 2] + this.eResDens[base + 3];
            k++;
        }
        if (k === 0) return 0;
        const v = sum / (k * NRES);
        return v > 1 ? 1 : v;
    },

    _stateGarrison(s) {
        const live = this._liveE, n = this._liveN;
        let v = 0;
        for (let i = 0; i < n; i++) {
            const e = live[i];
            if (this.eAlive[e] === 1 && this.eState[e] === s) v += this.eGarrison[e];
        }
        return v;
    },

    /* Neighbours have to settle what they are to each other. Evenly matched
       states federate; lopsided ones go to war, because conquest is only worth
       starting when you expect to win it. */
    _diplomacy() {
        const p = this.P;
        const live = this._liveE, n = this._liveN;

        for (let ia = 0; ia < n; ia++) {
            const a = live[ia];
            if (this.eAlive[a] === 0) continue;

            for (let ib = ia + 1; ib < n; ib++) {
                const b = live[ib];
                if (this.eAlive[b] === 0) continue;

                /* Re-read every time: an earlier pair this pass may already
                   have merged one of these into somebody else's state. */
                const sa = this.eState[a], sb = this.eState[b];
                if (sa < 0 || sb < 0 || sa === sb) continue;
                if (this.stWar[sa] >= 0 || this.stWar[sb] >= 0) continue;
                if (this.stCd[sa] > 0 || this.stCd[sb] > 0) continue;
                /* A vassal does not make war on its own overlord by treaty —
                   it throws the treaty off instead, and that is decided by
                   strength, below. */
                if (this.stOverlord[sa] === sb || this.stOverlord[sb] === sa) continue;

                /* A shared border is no longer the only way to reach somebody.
                   Either side holding an arsenal extends how far a quarrel can
                   be picked, which is what lets two countries that have never
                   met fight over what the other one is sitting on. */
                const dx = this.eSeatX[b] - this.eSeatX[a];
                const dy = this.eSeatY[b] - this.eSeatY[a];
                const d = Math.sqrt(dx * dx + dy * dy);
                const border = this.eRadius[a] + this.eRadius[b];
                const guns = (this.stOrdnance[sa] >= 1 || this.stOrdnance[sb] >= 1)
                    ? p.strikeRange : 0;
                if (d > border + p.contactSlack + guns) continue;

                const strA = this._stateStrength(sa);
                const strB = this._stateStrength(sb);
                const ratio = strA / strB;

                /* A neighbour worth taking is taken on thinner odds. This is
                   the whole channel by which the map decides who fights whom:
                   an ordinary border settles down, a border with ore or oil on
                   the far side of it does not. */
                const barAB = p.aggression * (1 - p.covet * this._statePrize(sb));
                const barBA = p.aggression * (1 - p.covet * this._statePrize(sa));

                if (ratio > barAB) this._declareWar(sa, sb);
                else if (ratio < 1 / barBA) this._declareWar(sb, sa);
                else if (this.rand() < p.unionChance) this._unite(sa, sb);
                else { this.stCd[sa] = p.diploCooldown; this.stCd[sb] = p.diploCooldown; }
                break;   /* one decision per estate per pass */
            }
        }
    },

    /* A tributary that has outgrown the power that beat it stops paying. Run
       with diplomacy, on the same annual clock. */
    _rebellions() {
        const p = this.P;
        for (let s = 0; s < MAX_STATES; s++) {
            if (this.stAlive[s] === 0) continue;
            const over = this.stOverlord[s];
            if (over < 0) continue;
            if (this.stAlive[over] === 0) {
                this.stOverlord[s] = -1;
                this._logEvent('freed', s, over, 0);
                continue;
            }
            if (this.stCd[s] > 0) continue;
            const mine = this._stateStrength(s), theirs = this._stateStrength(over);
            if (mine > theirs * p.rebelRatio) {
                this.stOverlord[s] = -1;
                this.stCd[s] = p.diploCooldown;
                this.rebellions++;
                this._logEvent('freed', s, over, 1);
            }
        }
    },

    _declareWar(agg, def) {
        this.stWar[agg] = def;
        this.stWar[def] = agg;
        this.stWarSince[agg] = this.stWarSince[def] = this.tickCount;
        this.warsDeclared++;
        this._logEvent('war', agg, def, 0);
    },

    /* The stronger partner's capital becomes the capital of the union; the
       other's estates keep their lords and pay a levy. */
    _unite(sa, sb) {
        const A = this._stateStrength(sa) >= this._stateStrength(sb) ? sa : sb;
        const B = A === sa ? sb : sa;
        const moved = this._absorb(A, B, 0);
        this.unions++;
        this.stCd[A] = this.P.diploCooldown;
        this._logEvent('union', A, B, moved);
    },

    /* Conquest. Same structure as a union, harsher terms. */
    _annex(win, lose) {
        const moved = this._absorb(win, lose, 1);
        this.annexations++;
        this.stWar[win] = -1;
        this.stCd[win] = this.P.diploCooldown;
        this._logEvent('annex', win, lose, moved);
    },

    /* Move every estate of `from` into `into` and retire the empty state. */
    _absorb(into, from, subject) {
        let moved = 0;
        for (let e = 0; e < MAX_ESTATES; e++) {
            if (this.eAlive[e] === 0 || this.eState[e] !== from) continue;
            this.eState[e] = into;
            if (subject) this.eSubject[e] = 1;
            this.stMembers[into]++;
            moved++;
        }
        /* The treasury, the grain reserve and the arsenal are seized with the
           country — and so are whatever tributaries it had. */
        this.stTreasury[into] += this.stTreasury[from];
        this.stReserve[into] += this.stReserve[from];
        this.stOrdnance[into] += this.stOrdnance[from];
        for (let v = 0; v < MAX_STATES; v++) {
            if (this.stOverlord[v] === from) this.stOverlord[v] = (v === into ? -1 : into);
        }
        const other = this.stWar[from];
        if (other >= 0 && other !== into) this.stWar[other] = -1;
        this._retireState(from);
        this.ownerVersion++;      /* the map is recoloured by state */
        return moved;
    },

    _retireState(s) {
        this.stAlive[s] = 0;
        this.stMembers[s] = 0;
        this.stWar[s] = -1;
        this.stCasualties[s] = 0;
        this.stLead[s] = -1;
        /* Everything the state owned goes with it. The officials find out at
           the top of next tick, when their state no longer answers. */
        this.stGov[s] = 0;
        this.stTreasury[s] = 0;
        this.stReserve[s] = 0;
        this.stOrdnance[s] = 0;
        this.stOverlord[s] = -1;
        /* Anyone who answered to this state answers to nobody now. */
        for (let v = 0; v < MAX_STATES; v++) if (this.stOverlord[v] === s) this.stOverlord[v] = -1;
        this.stAdmin[s] = 0;
        this.stShedOff[s] = this.stOffLast[s];
        this.stOfficials[s] = 0;
        this.stWantOff[s] = 0;
        this._stFree[this._stFreeN++] = s;
    },

    _peace(a, b) {
        this.stWar[a] = -1;
        this.stWar[b] = -1;
        this.stCd[a] = this.P.diploCooldown;
        this.stCd[b] = this.P.diploCooldown;
        this._logEvent('peace', a, b, 0);
    },

    /* One round per warring pair. The loser of the round owes a man, paid out
       of the garrison in the agent loop. A state with nobody left under arms
       is annexed by the other. */
    _wars() {
        const p = this.P;
        for (let s = 0; s < MAX_STATES; s++) {
            if (this.stAlive[s] === 0) continue;
            const t = this.stWar[s];
            if (t < 0 || t < s) continue;          /* settle each pair once */
            if (this.stAlive[t] === 0) { this.stWar[s] = -1; continue; }

            const strA = this._stateStrength(s), strB = this._stateStrength(t);

            /* Men can only fight what they can walk to. If the two countries
               share no border this is a war of bombardment alone, and the
               garrisons never meet. */
            const touching = this._adjacent(s, t);
            if (touching) {
                /* The loser of a round takes casualties in proportion to how
                   badly it is outmatched. With a flat one-per-round, evenly
                   matched powers ground each other down at exactly the same
                   rate, no garrison ever reached zero, and forty-four wars
                   produced not one conquest. */
                let loser, ratio;
                if (this.rand() < strA / (strA + strB)) { loser = t; ratio = strA / strB; }
                else { loser = s; ratio = strB / strA; }
                let toll = 1 + Math.floor(ratio - 1);
                if (toll > 4) toll = 4; else if (toll < 1) toll = 1;
                this.stCasualties[loser] += toll;
                this.stBattles[s]++; this.stBattles[t]++;
                this.battles++;
            }

            this._bombard(s, t);
            this._bombard(t, s);

            const garA = this._stateGarrison(s), garB = this._stateGarrison(t);
            if (garB === 0 && garA > 0) this._defeat(s, t, touching);
            else if (garA === 0 && garB > 0) this._defeat(t, s, touching);
            else if (this.tickCount - this.stWarSince[s] > p.warPeaceYears * TPY &&
                     this.rand() < p.peaceChance) {
                this._peace(s, t);
            }
        }
    },

    /* Do these two countries share a border anywhere? Only then can their
       armies actually reach one another. */
    _adjacent(s, t) {
        const p = this.P, live = this._liveE, n = this._liveN;
        for (let i = 0; i < n; i++) {
            const a = live[i];
            if (this.eAlive[a] === 0 || this.eState[a] !== s) continue;
            for (let j = 0; j < n; j++) {
                const b = live[j];
                if (this.eAlive[b] === 0 || this.eState[b] !== t) continue;
                const dx = this.eSeatX[b] - this.eSeatX[a];
                const dy = this.eSeatY[b] - this.eSeatY[a];
                const reach = this.eRadius[a] + this.eRadius[b] + p.contactSlack;
                if (dx * dx + dy * dy <= reach * reach) return true;
            }
        }
        return false;
    },

    /* A salvo from s onto t. Guns pick the richest thing in range — the biggest
       town — because that is what breaks a country fastest: soldiers dead,
       civilians dead, and the granary that was feeding the place on fire. */
    _bombard(s, t) {
        const p = this.P;
        if (this.stOrdnance[s] < p.salvoSize) return;

        const live = this._liveE, n = this._liveN;
        let best = -1, bestVal = -1;
        for (let i = 0; i < n; i++) {
            const e = live[i];
            if (this.eAlive[e] === 0 || this.eState[e] !== t) continue;
            const base = e * NRES;
            const val = this.eTownPop[e] * 2 + this.eGranary[e] * 0.5 +
                (this.eRes[base + R_MIN] + this.eRes[base + R_OIL]) * 3;
            if (val > bestVal) { bestVal = val; best = e; }
        }
        if (best < 0) return;

        this.stOrdnance[s] -= p.salvoSize;
        this.stCasualties[t] += p.strikeCasualties;
        this.eStrike[best] += p.strikeCivilians;
        this.eGranary[best] *= (1 - p.strikeGranary);
        this.strikes++;

        /* Remembered only so the map can show where the shells landed. */
        this.impacts.push({ x: this.eSeatX[best], y: this.eSeatY[best], t: this.tickCount });
        if (this.impacts.length > 48) this.impacts.shift();
    },

    /* How a war ends depends entirely on whether the winner could walk there.
       Over a shared border the estates change hands; from beyond one, the guns
       cannot occupy anything, so the beaten state keeps everything it had
       except its independence. */
    _defeat(win, lose, touching) {
        if (touching) { this._annex(win, lose); return; }
        this.stWar[win] = -1;
        this.stWar[lose] = -1;
        this.stCd[win] = this.P.diploCooldown;
        this.stCd[lose] = this.P.diploCooldown;
        /* An overlord's own overlord does not inherit; a vassal answers to
           whoever beat it, and a chain that loops would deadlock the tribute. */
        if (this.stOverlord[win] === lose) this.stOverlord[win] = -1;
        this.stOverlord[lose] = win;
        this.vassalages++;
        this._logEvent('vassal', win, lose, 0);
    },

    _logEvent(type, a, b, n) {
        this.log.push({ t: this.tickCount, type: type, a: a, b: b, n: n });
        if (this.log.length > 64) this.log.shift();
    },

    /* The wealthiest grown commoner standing on the estate takes it over. Not
       an heir — there is no lineage in the model yet — but it keeps a manor
       alive across its owner's death, which is what lets an estate outlast a
       person and start behaving like an institution. */
    _succeed(e) {
        const sx = this.eSeatX[e], sy = this.eSeatY[e];
        const r = this.eRadius[e], r2 = r * r;
        const maturity = this.P.maturity;
        let best = -1, bestCap = -1;
        for (let i = 0; i < MAX_AGENTS; i++) {
            if (this.alive[i] === 0 || this.role[i] !== ROLE_FARMER) continue;
            if (this.age[i] < maturity) continue;
            const dx = this.x[i] - sx, dy = this.y[i] - sy;
            if (dx * dx + dy * dy > r2) continue;
            if (this.capital[i] > bestCap) { bestCap = this.capital[i]; best = i; }
        }
        if (best < 0) return -1;
        this.role[best] = ROLE_LORD;
        this.estateOf[best] = e;
        this.eLord[e] = best;
        this.successions++;
        return best;
    },

    _dissolve(e) {
        const lord = this.eLord[e];
        if (lord >= 0 && this.alive[lord] === 1 && this.estateOf[lord] === e) {
            this.role[lord] = ROLE_FARMER;
            this.estateOf[lord] = -1;
        }
        this.eAlive[e] = 0;      /* set first, so the successor search skips it */
        for (let k = 0; k < NRES; k++) { this.eRes[e * NRES + k] = 0; this.eResDens[e * NRES + k] = 0; }
        this.eRegrow[e] = this.P.regrow;
        this.eOilIncome[e] = 0;

        /* If this manor held the capital, the state has to find another seat —
           the largest remaining member. A state with no members left retires,
           and any war it was fighting ends with it. */
        const s = this.eState[e];
        if (s >= 0 && this.stAlive[s] === 1) {
            this.stMembers[s]--;
            if (this.stLead[s] === e) {
                let best = -1, bestCells = -1;
                for (let f = 0; f < MAX_ESTATES; f++) {
                    if (this.eAlive[f] === 0 || this.eState[f] !== s) continue;
                    if (this.eCells[f] > bestCells) { bestCells = this.eCells[f]; best = f; }
                }
                if (best >= 0) {
                    this.stLead[s] = best;
                } else {
                    const other = this.stWar[s];
                    if (other >= 0) this.stWar[other] = -1;
                    this._retireState(s);
                }
            }
        }
        this.eState[e] = -1;
        this.eSubject[e] = 0;

        this.eCells[e] = 0;
        this.eRent[e] = 0;
        this.eTenants[e] = 0;
        this.eSoldiers[e] = 0;
        this.eShed[e] = 0;
        this.eGranary[e] = 0;
        this.eCitizens[e] = 0;
        this.eTownPop[e] = 0;
        this.eFoodSold[e] = 0;
        this.eGrainIn[e] = 0;
        this.eStrike[e] = 0;
        this._eFree[this._eFreeN++] = e;
        this.dissolutions++;
    },

    /* ----------------------------------------------------------- helpers -- */

    _kill(i) {
        this.alive[i] = 0;
        this._free[this._freeN++] = i;
    },

    _buildHazard() {
        const p = this.P, h = this._hazard;
        for (let a = 0; a < MAX_AGE; a++) {
            if (a <= p.mortStart) { h[a] = 0; continue; }
            const v = p.mortBase * Math.exp((a - p.mortStart) / p.mortScale);
            h[a] = v > 1 ? 1 : v;
        }
    },

    _recount() {
        let n = 0, lords = 0, soldiers = 0, citizens = 0, officials = 0;
        let sf = 0, sc = 0, sm = 0, ct = 0;
        for (let i = 0; i < MAX_AGENTS; i++) {
            if (this.alive[i] === 0) continue;
            n++; sf += this.food[i]; sc += this.capital[i]; sm += this.met[i];
            if (this.role[i] === ROLE_LORD) lords++;
            else if (this.role[i] === ROLE_SOLDIER) soldiers++;
            else if (this.role[i] === ROLE_CITIZEN) citizens++;
            else if (this.role[i] === ROLE_OFFICIAL) officials++;
        }
        for (let c = 0; c < NCELL; c++) ct += this.crop[c];
        this.pop = n; this.lords = lords; this.soldiers = soldiers;
        this.citizens = citizens; this.officials = officials;
        this.sumFood = sf; this.sumCapital = sc; this.sumMet = sm;
        this.cropTotal = ct;
    },

    year() { return this.tickCount / TPY; },

    /* What the land can support, in agents: total food produced per tick once
       grazing has flattened the standing crop, divided by what one mouth costs.
       Improved ground counts for more, so enclosure genuinely raises the
       ceiling — the question the run answers is who gets the difference. */
    carryingCapacity() {
        const p = this.P, own = this.owner, fert = this.fert, eRegrow = this.eRegrow;
        const improved = this.improved;
        let prod = 0;
        for (let c = 0; c < NCELL; c++) {
            const o = own[c];
            prod += ((o >= 0 && improved[c] === 1) ? eRegrow[o] : p.regrow) * fert[c];
        }
        const met = this.pop > 0 ? this.sumMet / this.pop : p.metMean;
        return prod / met;
    },

    /* Nearest living agent to a world point, or -1. */
    agentAt(wx, wy, radius) {
        const r2 = radius * radius;
        let best = -1, bestD = r2;
        for (let i = 0; i < MAX_AGENTS; i++) {
            if (this.alive[i] === 0) continue;
            const dx = this.x[i] - wx, dy = this.y[i] - wy;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = i; }
        }
        return best;
    }
};
