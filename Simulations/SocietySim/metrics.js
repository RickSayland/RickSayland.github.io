/* SocietySim — instrumentation.
 *
 * Everything the right-hand panel knows. Reads the sim, never writes to it.
 *
 * The expensive statistics (sorting capital, walking the density grid) run on a
 * sampling schedule, not every tick — half a simulated year apart — so the cost
 * is fixed no matter how fast the clock is running.
 */
'use strict';

const metrics = (function () {

    const SAMPLE_TICKS = 32;      // half a year
    const SERIES_LEN = 260;
    const RATE_WINDOW = 8;        // samples averaged for birth/death rates

    /* Wealth bands, in units of stored capital. These are absolute, not
       quantiles: with quantile bands a society of identical paupers still reads
       as having an upper class, which is exactly the wrong answer.
       They describe wealth and nothing else — a soldier and a small freeholder
       land in the same band on different terms, and the role census beside them
       is what separates the two. The cuts are pinned to things an agent can
       actually do: Subsisting is fed, Comfortable can afford a child, Wealthy
       can afford to enclose ground, Magnate can afford to hold it. */
    const CLASSES = [
        { name: 'Destitute',   min: 0,    color: '#a85a3f' },
        { name: 'Subsisting',  min: 0.8,  color: '#c9925e' },
        { name: 'Comfortable', min: 3.2,  color: '#e8a95e' },
        { name: 'Wealthy',     min: 8.0,  color: '#f6d089' },
        { name: 'Magnate',     min: 25.0, color: '#fdf0c8' }
    ];
    const NCLASS = CLASSES.length;

    /* Conditions and roles, which are not classes and are coloured separately
       on the map. */
    const HUNGRY_COLOR = '#e2603c';
    const HUNGRY_FOOD = 0.6;
    const LORD_COLOR = '#ffd76b';
    const SOLDIER_COLOR = '#7fb2d9';
    const CITIZEN_COLOR = '#d9a7f0';
    const OFFICIAL_COLOR = '#8ce8d0';

    /* Settlement detection works on blocks of land cells, not single cells: one
       cell is 10 world units and a farmer crosses it in four steps, so at cell
       resolution every transient knot of walkers reads as a town. */
    const BLOCK = 4;
    /* Sized from the sim's own grid at reset, not from constants baked in
       here — the world got half again as large in v0.4 and a hardcoded block
       grid would have silently indexed off the end of it. */
    let BW = 0, BH = 0;

    /* Gini off an ascending-sorted array: 1 - 2 x (area under the Lorenz
       curve), which reduces to one weighted pass once the values are in order. */
    function giniOf(view, k, total) {
        if (k <= 1 || total <= 0) return 0;
        let cum = 0, weighted = 0;
        for (let i = 0; i < k; i++) { cum += view[i]; weighted += cum; }
        return 1 - 2 * (weighted / (k * total)) + 1 / k;
    }

    function ring(len) { return { buf: new Float32Array(len), n: 0, head: 0 }; }

    function push(r, v) {
        r.buf[r.head] = v;
        r.head = (r.head + 1) % r.buf.length;
        if (r.n < r.buf.length) r.n++;
    }

    function at(r, k) {                       /* k = 0 is the oldest kept */
        const start = (r.head - r.n + r.buf.length) % r.buf.length;
        return r.buf[(start + k) % r.buf.length];
    }

    function last(r, back) {
        back = back || 0;
        if (r.n <= back) return 0;
        return at(r, r.n - 1 - back);
    }

    const m = {
        CLASSES: CLASSES,
        HUNGRY_COLOR: HUNGRY_COLOR,
        HUNGRY_FOOD: HUNGRY_FOOD,
        LORD_COLOR: LORD_COLOR,
        SOLDIER_COLOR: SOLDIER_COLOR,
        CITIZEN_COLOR: CITIZEN_COLOR,
        OFFICIAL_COLOR: OFFICIAL_COLOR,

        series: {
            pop: ring(SERIES_LEN),
            birthRate: ring(SERIES_LEN),
            deathRate: ring(SERIES_LEN),
            meanCapital: ring(SERIES_LEN),
            gini: ring(SERIES_LEN),
            giniAdult: ring(SERIES_LEN),
            meanMet: ring(SERIES_LEN),
            crop: ring(SERIES_LEN),
            top10: ring(SERIES_LEN),
            ownedShare: ring(SERIES_LEN),
            tenantShare: ring(SERIES_LEN),
            lordWealthShare: ring(SERIES_LEN),
            states: ring(SERIES_LEN),
            estates: ring(SERIES_LEN),
            largestState: ring(SERIES_LEN),
            urban: ring(SERIES_LEN),
            biggestTown: ring(SERIES_LEN),
            govLandShare: ring(SERIES_LEN),
            admin: ring(SERIES_LEN)
        },

        /* latest snapshot, read by the UI */
        now: {
            pop: 0, year: 0,
            births: 0, deaths: 0, starved: 0, aged: 0,   /* per year */
            replacement: 1,
            meanFood: 0, meanCapital: 0, medianCapital: 0, meanMet: 0,
            gini: 0, giniAdult: 0, adults: 0, top10: 0, totalCapital: 0,
            classCount: new Int32Array(NCLASS),
            classWealth: new Float64Array(NCLASS),
            hungry: 0,
            lorenz: new Float32Array(33),
            settlements: 0, largest: 0, urbanShare: 0, crowding: 0,
            capacity: 0,
            /* property + arms */
            estates: 0, ownedShare: 0, tenants: 0, tenantShare: 0,
            enforcement: 0, rentYear: 0, wageYear: 0,
            lordCap: 0, soldierCap: 0, tenantCap: 0, freeCap: 0,
            lordWealthShare: 0, tenantEdge: 0,
            lords: 0, soldiers: 0, garrisonMax: 0, largestEstate: 0,
            /* states */
            states: 0, largestState: 0, wars: 0, sovereign: 0,
            levyYear: 0, subjectShare: 0, biggestStateCells: 0, capitalCap: 0,
            /* the map */
            terrain: new Float32Array(5),
            resTotal: new Float32Array(4),
            resHeld: new Float32Array(4),
            resMapDens: new Float32Array(4),
            resHeldDens: new Float32Array(4),
            oilYear: 0, farmable: 0, fishing: 0,
            /* towns */
            townsfolk: 0, urbanShareRole: 0, towns: 0, biggestTown: 0,
            meanCapitalTown: 0, meanOtherTown: 0, granary: 0,
            craftYear: 0, roadCells: 0, townCap: 0, farmCap: 0,
            /* government */
            govs: 0, officials: 0, admin: 0, treasury: 0, taxYear: 0, worksYear: 0,
            govEstates: 0, govCells: 0, govLandShare: 0, biggestGov: 0,
            garrisonGov: 0, garrisonFeudal: 0, govPopShare: 0, worksFunded: 0
        },

        _lastTick: -1,
        _prevBirths: 0, _prevStarved: 0, _prevAged: 0,
        _caps: null,
        _capsA: null,
        _dens: null,
        _label: null,
        _stack: null,
        _landBlocks: 0,
        _chartsAt: 0,

        /* --------------------------------------------------------- reset -- */

        reset(s) {
            BW = Math.ceil(s.GW / BLOCK);
            BH = Math.ceil(s.GH / BLOCK);
            if (!this._dens || this._dens.length !== BW * BH) {
                this._dens = new Int32Array(BW * BH);
                this._label = new Int32Array(BW * BH);
                this._stack = new Int32Array(BW * BH);
            }
            if (!this._caps || this._caps.length !== s.MAX_AGENTS) {
                this._caps = new Float32Array(s.MAX_AGENTS);
                this._capsA = new Float32Array(s.MAX_AGENTS);
            }
            for (const k in this.series) {
                const r = this.series[k];
                r.n = 0; r.head = 0; r.buf.fill(0);
            }
            this._lastTick = -1;
            this._prevBirths = 0;
            this._prevStarved = 0;
            this._prevAged = 0;
            this._landBlocks = 0;

            /* Terrain and total deposits never change once a world is built,
               so they are measured once here rather than every sample. */
            const n = this.now;
            n.terrain.fill(0);
            n.resTotal.fill(0);
            let land = 0, farm = 0, shore = 0;
            for (let c = 0; c < s.NCELL; c++) {
                n.terrain[s.terrain[c]]++;
                for (let k = 0; k < 4; k++) n.resTotal[k] += s.res[k][c];
                if (s.walk[c] === 1) {
                    land++;
                    if (s.fert[c] > 0.05) farm++;
                    if (s.terrain[c] === 3 || s.terrain[c] === 4) {
                        /* dry or bare, yet it feeds people: that is the shallows */
                        if (s.fert[c] > 0.05) shore++;
                    }
                }
            }
            for (let t = 0; t < 5; t++) n.terrain[t] /= s.NCELL;
            for (let k = 0; k < 4; k++) n.resMapDens[k] = land ? n.resTotal[k] / land : 0;
            n.farmable = s.NCELL ? farm / s.NCELL : 0;
            n.fishing = s.NCELL ? shore / s.NCELL : 0;

            n.capacity = s.carryingCapacity();
            this.sample(s);
        },

        /* Called every frame; samples on its own schedule. */
        update(s) {
            if (this._lastTick < 0 || s.tickCount - this._lastTick >= SAMPLE_TICKS) {
                this.sample(s);
            }
        },

        /* --------------------------------------------------------- sample -- */

        sample(s) {
            const dTicks = this._lastTick < 0 ? SAMPLE_TICKS : (s.tickCount - this._lastTick);
            this._lastTick = s.tickCount;

            const n = this.now;
            const pop = s.pop;
            n.pop = pop;
            n.year = s.year();
            n.capacity = s.carryingCapacity();

            /* --- vital rates, per year, over the sampling window --- */
            const years = Math.max(dTicks, 1) / s.TPY;
            const dB = s.totalBirths - this._prevBirths;
            const dS = s.totalStarved - this._prevStarved;
            const dA = s.totalAged - this._prevAged;
            this._prevBirths = s.totalBirths;
            this._prevStarved = s.totalStarved;
            this._prevAged = s.totalAged;

            n.births = dB / years;
            n.starved = dS / years;
            n.aged = dA / years;
            n.deaths = n.starved + n.aged;

            n.meanFood = pop ? s.sumFood / pop : 0;
            n.meanCapital = pop ? s.sumCapital / pop : 0;
            n.meanMet = pop ? s.sumMet / pop : s.P.metMean;

            /* --- one pass: wealth bands, group means, tenancy --- */
            const caps = this._caps, capsA = this._capsA;
            let k = 0, ka = 0, hungry = 0;
            const cc = n.classCount, cw = n.classWealth;
            cc.fill(0); cw.fill(0);

            let lordCap = 0, nLord = 0, soldCap = 0, nSold = 0;
            let tenCap = 0, nTen = 0, freeCap = 0, nFree = 0;
            let townCap = 0, nTown = 0;

            const maturity = s.P.maturity, GWl = s.GW, cellInv = 1 / s.CELL;
            for (let i = 0; i < s.MAX_AGENTS; i++) {
                if (s.alive[i] === 0) continue;
                const c = s.capital[i];
                caps[k++] = c;
                if (s.age[i] >= maturity) capsA[ka++] = c;
                if (s.food[i] < HUNGRY_FOOD) hungry++;

                let b = 0;
                for (let q = NCLASS - 1; q >= 0; q--) {
                    if (c >= CLASSES[q].min) { b = q; break; }
                }
                cc[b]++; cw[b] += c;

                const role = s.role[i];
                if (role === 1) { lordCap += c; nLord++; }
                else if (role === 2) { soldCap += c; nSold++; }
                else if (role === 3) { townCap += c; nTown++; }
                else {
                    /* Tenant or freeholder is a question about the ground under
                       their feet this instant, not a status they carry. */
                    const ci = ((s.y[i] * cellInv) | 0) * GWl + ((s.x[i] * cellInv) | 0);
                    if (s.owner[ci] >= 0) { tenCap += c; nTen++; }
                    else { freeCap += c; nFree++; }
                }
            }
            n.hungry = hungry;
            n.adults = ka;

            n.lords = nLord;
            n.soldiers = nSold;
            n.lordCap = nLord ? lordCap / nLord : 0;
            n.soldierCap = nSold ? soldCap / nSold : 0;
            n.tenantCap = nTen ? tenCap / nTen : 0;
            n.freeCap = nFree ? freeCap / nFree : 0;
            n.tenants = nTen;
            n.tenantShare = (nTen + nFree) > 0 ? nTen / (nTen + nFree) : 0;
            /* How much better off a tenant is than a freeholder. Above 1 the
               bargain is worth taking even after the rent; below 1 the lord is
               extracting more than the improvement is worth. */
            n.tenantEdge = n.freeCap > 0 ? n.tenantCap / n.freeCap : 0;

            const view = caps.subarray(0, k);
            view.sort();                       /* Float32Array sorts numerically */

            let total = 0;
            for (let i = 0; i < k; i++) total += view[i];
            n.totalCapital = total;
            n.medianCapital = k ? (k & 1 ? view[k >> 1]
                                         : 0.5 * (view[k >> 1] + view[(k >> 1) - 1])) : 0;
            n.gini = giniOf(view, k, total);
            n.lordWealthShare = total > 0 ? lordCap / total : 0;

            /* The same measure over grown agents only. Much of the headline
               Gini is lifecycle, not class: a fifteen-year-old owns nothing
               because they have not had time to save, which is not the same
               society as one where a fifteen-year-old owns nothing because
               somebody else owns it. The gap between the two numbers is how
               much of the inequality is age and how much is structure. */
            const viewA = capsA.subarray(0, ka);
            viewA.sort();
            let totalA = 0;
            for (let i = 0; i < ka; i++) totalA += viewA[i];
            n.giniAdult = giniOf(viewA, ka, totalA);

            /* Lorenz curve, 32 segments, for the panel's inequality plot. */
            const L = n.lorenz;
            if (k > 0 && total > 0) {
                let idx = 0, run = 0;
                for (let seg = 0; seg <= 32; seg++) {
                    const upto = Math.round((seg / 32) * k);
                    while (idx < upto) run += view[idx++];
                    L[seg] = run / total;
                }
            } else {
                for (let seg = 0; seg <= 32; seg++) L[seg] = seg / 32;
            }

            if (k > 0 && total > 0) {
                let top = 0;
                for (let i = Math.floor(k * 0.9); i < k; i++) top += view[i];
                n.top10 = top / total;
            } else n.top10 = 0;

            /* --- property --- */
            n.estates = s.estateCount;
            n.ownedShare = s.ownedCells / s.NCELL;
            n.enforcement = s.meanEnforce;
            n.rentYear = s.rentFlow * s.TPY;
            n.wageYear = s.wageFlow * s.TPY;
            let gMax = 0, eMax = 0;
            for (let e = 0; e < s.MAX_ESTATES; e++) {
                if (s.eAlive[e] === 0) continue;
                if (s.eGarrison[e] > gMax) gMax = s.eGarrison[e];
                if (s.eCells[e] > eMax) eMax = s.eCells[e];
            }
            n.garrisonMax = gMax;
            n.largestEstate = eMax;
            n.oilYear = s.oilFlow * s.TPY;

            /* How much of each deposit lies inside somebody's border. The gap
               between held density and the map's own average is the answer to
               whether the lords ended up sitting on the good ground, or merely
               on the ground that grew food. */
            n.resHeld.fill(0);
            let heldCells = 0;
            for (let e = 0; e < s.MAX_ESTATES; e++) {
                if (s.eAlive[e] === 0) continue;
                heldCells += s.eCells[e];
                for (let k = 0; k < 4; k++) n.resHeld[k] += s.eRes[e * 4 + k];
            }
            for (let k = 0; k < 4; k++) {
                n.resHeldDens[k] = heldCells ? n.resHeld[k] / heldCells : 0;
            }

            /* --- states --- */
            n.states = s.stateCount;
            n.largestState = s.largestState;
            n.wars = s.warCount;
            n.levyYear = s.levyFlow * s.TPY;
            n.subjectShare = s.estateCount > 0 ? s.subjectEstates / s.estateCount : 0;

            /* Ground held by the largest state, and what its capital is worth —
               the number that separates a king from a merely rich lord. */
            let bigCells = 0, capCap = 0, sovereign = 0;
            for (let st = 0; st < s.MAX_STATES; st++) {
                if (s.stAlive[st] === 0) continue;
                if (s.stMembers[st] === 1) sovereign++;
                let cells = 0;
                for (let e = 0; e < s.MAX_ESTATES; e++) {
                    if (s.eAlive[e] === 1 && s.eState[e] === st) cells += s.eCells[e];
                }
                if (cells > bigCells) {
                    bigCells = cells;
                    const lead = s.stLead[st];
                    const king = lead >= 0 && s.eAlive[lead] === 1 ? s.eLord[lead] : -1;
                    capCap = king >= 0 && s.alive[king] === 1 ? s.capital[king] : 0;
                }
            }
            n.biggestStateCells = bigCells;
            n.capitalCap = capCap;
            n.sovereign = sovereign;

            /* --- towns --- */
            n.townsfolk = s.citizens;
            n.urbanShareRole = s.pop ? s.citizens / s.pop : 0;
            n.granary = s.granaryTotal;
            n.craftYear = s.craftFlow * s.TPY;
            n.townCap = nTown ? townCap / nTown : 0;
            n.farmCap = n.freeCap;

            let towns = 0, biggest = 0, capSum = 0, nCapT = 0, otherSum = 0, nOther = 0;
            for (let e = 0; e < s.MAX_ESTATES; e++) {
                if (s.eAlive[e] === 0) continue;
                const tp = s.eTownPop[e];
                if (tp > 10) towns++;
                if (tp > biggest) biggest = tp;
                const st = s.eState[e];
                if (st >= 0 && s.stLead[st] === e) { capSum += tp; nCapT++; }
                else { otherSum += tp; nOther++; }
            }
            n.towns = towns;
            n.biggestTown = biggest;
            n.meanCapitalTown = nCapT ? capSum / nCapT : 0;
            n.meanOtherTown = nOther ? otherSum / nOther : 0;

            let roadCells = 0;
            for (let c = 0; c < s.NCELL; c++) if (s.road[c] === 1) roadCells++;
            n.roadCells = roadCells;

            /* --- government --- */
            n.govs = s.govCount;
            n.officials = s.officials;
            n.treasury = s.treasuryTotal;
            n.taxYear = s.taxFlow * s.TPY;
            n.worksYear = s.worksFlow * s.TPY;

            let govEst = 0, govCells = 0, feudEst = 0, govGar = 0, feudGar = 0;
            let bigGov = 0, adminSum = 0, worksSum = 0, nGov = 0;
            for (let e = 0; e < s.MAX_ESTATES; e++) {
                if (s.eAlive[e] === 0) continue;
                const st = s.eState[e];
                if (st >= 0 && s.stGov[st] === 1) {
                    govEst++; govCells += s.eCells[e]; govGar += s.eGarrison[e];
                } else {
                    feudEst++; feudGar += s.eGarrison[e];
                }
            }
            for (let st = 0; st < s.MAX_STATES; st++) {
                if (s.stAlive[st] === 0 || s.stGov[st] === 0) continue;
                nGov++;
                adminSum += s.stAdmin[st];
                worksSum += s.stWorks[st];
                if (s.stMembers[st] > bigGov) bigGov = s.stMembers[st];
            }
            n.govEstates = govEst;
            n.govCells = govCells;
            n.govLandShare = s.ownedCells > 0 ? govCells / s.ownedCells : 0;
            n.biggestGov = bigGov;
            n.admin = nGov ? adminSum / nGov : 0;
            n.worksFunded = nGov ? worksSum / nGov : 0;
            /* The number that says whether a nation-state is worth being: how
               many men it keeps under arms per manor against what a lord
               managing his own affairs can field. */
            n.garrisonGov = govEst ? govGar / govEst : 0;
            n.garrisonFeudal = feudEst ? feudGar / feudEst : 0;

            /* --- how the population is arranged on the ground --- */
            this._settlements(s);

            /* --- series --- */
            const S = this.series;
            push(S.pop, pop);
            push(S.birthRate, n.births);
            push(S.deathRate, n.deaths);
            push(S.meanCapital, n.meanCapital);
            push(S.gini, n.gini);
            push(S.giniAdult, n.giniAdult);
            push(S.meanMet, n.meanMet);
            push(S.crop, s.cropTotal);
            push(S.top10, n.top10);
            push(S.ownedShare, n.ownedShare);
            push(S.tenantShare, n.tenantShare);
            push(S.lordWealthShare, n.lordWealthShare);
            push(S.states, n.states);
            push(S.estates, s.estateCount);
            push(S.largestState, n.largestState);
            push(S.urban, n.urbanShareRole);
            push(S.biggestTown, n.biggestTown);
            push(S.govLandShare, n.govLandShare);
            push(S.admin, n.admin);

            /* Replacement is births over deaths, smoothed — the instantaneous
               ratio at a half-year sample is mostly noise. */
            let b = 0, d = 0;
            const w = Math.min(RATE_WINDOW, S.birthRate.n);
            for (let i = 0; i < w; i++) { b += last(S.birthRate, i); d += last(S.deathRate, i); }
            n.replacement = d > 0 ? b / d : (b > 0 ? Infinity : 1);
        },

        /* Connected blocks of unusually dense ground. The threshold floats with
           population, so "settlement" always means crowded relative to how many
           people there are, not crowded by some fixed number that stops meaning
           anything once the population doubles. */
        _settlements(s) {
            const dens = this._dens, label = this._label, stack = this._stack;
            dens.fill(0);

            const inv = 1 / (s.CELL * BLOCK);
            for (let i = 0; i < s.MAX_AGENTS; i++) {
                if (s.alive[i] === 0) continue;
                const bx = (s.x[i] * inv) | 0, by = (s.y[i] * inv) | 0;
                dens[by * BW + bx]++;
            }

            if (this._landBlocks === 0) {
                let lb = 0;
                for (let by = 0; by < BH; by++) {
                    for (let bx = 0; bx < BW; bx++) {
                        let sum = 0, cnt = 0;
                        for (let dy = 0; dy < BLOCK; dy++) {
                            const gy = by * BLOCK + dy;
                            if (gy >= s.GH) break;
                            for (let dx = 0; dx < BLOCK; dx++) {
                                const gx = bx * BLOCK + dx;
                                if (gx >= s.GW) break;
                                sum += s.fert[gy * s.GW + gx]; cnt++;
                            }
                        }
                        if (cnt && sum / cnt > 0.25) lb++;
                    }
                }
                this._landBlocks = Math.max(1, lb);
            }

            /* A block counts as settled when it holds twice the mean density
               over farmable ground. The bar has to float with population or it
               stops meaning anything the moment the population doubles. */
            const mean = s.pop / this._landBlocks;
            const thresh = Math.max(4, Math.ceil(2 * mean));

            let peak = 0;
            for (let c = 0; c < BW * BH; c++) if (dens[c] > peak) peak = dens[c];
            this.now.crowding = mean > 0 ? peak / mean : 0;

            label.fill(0);
            let count = 0, largest = 0, urban = 0;
            for (let start = 0; start < BW * BH; start++) {
                if (label[start] !== 0 || dens[start] < thresh) continue;
                count++;
                let size = 0, sp = 0;
                stack[sp++] = start;
                label[start] = count;
                while (sp > 0) {
                    const c = stack[--sp];
                    size += dens[c];
                    const cx = c % BW, cy = (c / BW) | 0;
                    if (cx > 0 && label[c - 1] === 0 && dens[c - 1] >= thresh) {
                        label[c - 1] = count; stack[sp++] = c - 1;
                    }
                    if (cx < BW - 1 && label[c + 1] === 0 && dens[c + 1] >= thresh) {
                        label[c + 1] = count; stack[sp++] = c + 1;
                    }
                    if (cy > 0 && label[c - BW] === 0 && dens[c - BW] >= thresh) {
                        label[c - BW] = count; stack[sp++] = c - BW;
                    }
                    if (cy < BH - 1 && label[c + BW] === 0 && dens[c + BW] >= thresh) {
                        label[c + BW] = count; stack[sp++] = c + BW;
                    }
                }
                urban += size;
                if (size > largest) largest = size;
            }

            const n = this.now;
            n.settlements = count;
            n.largest = largest;
            n.urbanShare = s.pop > 0 ? urban / s.pop : 0;
        },

        /* ---------------------------------------------------------- charts -- */

        drawCharts(now) {
            if (now - this._chartsAt < 120) return;   /* ~8Hz is plenty */
            this._chartsAt = now;
            const S = this.series;

            spark('chartPop', [
                { r: S.pop, color: '#64d6bd' }
            ], { zero: true, refLine: this.now.capacity, refColor: '#3b5a56' });

            spark('chartVital', [
                { r: S.birthRate, color: '#8fe0c4' },
                { r: S.deathRate, color: '#e2603c' }
            ], { zero: true });

            spark('chartWealth', [
                { r: S.meanCapital, color: '#f2b56b' }
            ], { zero: true });

            spark('chartGini', [
                { r: S.gini, color: '#c9a0ff' },
                { r: S.giniAdult, color: '#6f8fd6' }
            ], { min: 0, max: 1 });

            spark('chartProperty', [
                { r: S.ownedShare, color: '#ffd76b' },
                { r: S.tenantShare, color: '#7fb2d9' },
                { r: S.lordWealthShare, color: '#e2603c' }
            ], { min: 0, max: 1 });

            /* The share of enclosed land under a government, against how far
               its administration actually reaches. */
            spark('chartGov', [
                { r: S.govLandShare, color: '#8ce8d0' },
                { r: S.admin, color: '#ffd76b' }
            ], { min: 0, max: 1 });

            spark('chartTowns', [
                { r: S.urban, color: '#d9a7f0' }
            ], { min: 0, max: 0.5 });

            /* Estates against states: while the two lines sit together every
               manor is its own sovereign, and the gap that opens between them
               is consolidation. */
            spark('chartStates', [
                { r: S.estates, color: '#ffd76b' },
                { r: S.states, color: '#e9eef0' },
                { r: S.largestState, color: '#e2603c' }
            ], { zero: true });

            this.drawLorenz();
        },

        drawLorenz() {
            const cv = document.getElementById('chartLorenz');
            if (!cv) return;
            const ctx = fit(cv);
            if (!ctx) return;
            const w = cv.clientWidth, h = cv.clientHeight;
            ctx.clearRect(0, 0, w, h);

            const pad = 3;
            const x0 = pad, y0 = h - pad, sx = w - pad * 2, sy = h - pad * 2;

            ctx.strokeStyle = '#2a3a3c';
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + sx, y0 - sy);
            ctx.stroke();
            ctx.setLineDash([]);

            const L = this.now.lorenz;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            for (let i = 0; i <= 32; i++) ctx.lineTo(x0 + (i / 32) * sx, y0 - L[i] * sy);
            ctx.lineTo(x0 + sx, y0);
            ctx.closePath();
            ctx.fillStyle = 'rgba(201,160,255,0.14)';
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(x0, y0);
            for (let i = 0; i <= 32; i++) ctx.lineTo(x0 + (i / 32) * sx, y0 - L[i] * sy);
            ctx.strokeStyle = '#c9a0ff';
            ctx.lineWidth = 1.4;
            ctx.stroke();
        }
    };

    /* ------------------------------------------------------------ drawing -- */

    /* Canvases are laid out by CSS, so the backing store is sized here from the
       measured box. Cheap to re-check and it survives a window resize without
       any resize plumbing. */
    function fit(cv) {
        const w = cv.clientWidth, h = cv.clientHeight;
        if (w === 0 || h === 0) return null;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return ctx;
    }

    function spark(id, lines, opt) {
        const cv = document.getElementById(id);
        if (!cv) return;
        const ctx = fit(cv);
        if (!ctx) return;
        const w = cv.clientWidth, h = cv.clientHeight;
        ctx.clearRect(0, 0, w, h);
        opt = opt || {};

        let lo = opt.min !== undefined ? opt.min : Infinity;
        let hi = opt.max !== undefined ? opt.max : -Infinity;
        let n = 0;
        for (const L of lines) {
            n = Math.max(n, L.r.n);
            if (opt.min === undefined || opt.max === undefined) {
                for (let i = 0; i < L.r.n; i++) {
                    const v = at(L.r, i);
                    if (opt.min === undefined && v < lo) lo = v;
                    if (opt.max === undefined && v > hi) hi = v;
                }
            }
        }
        if (n < 2) return;
        if (opt.zero) lo = 0;
        if (opt.refLine !== undefined && isFinite(opt.refLine)) hi = Math.max(hi, opt.refLine);
        if (!isFinite(lo) || !isFinite(hi)) return;
        if (hi - lo < 1e-9) hi = lo + 1;
        const span = hi - lo;
        const pad = 2;
        const sy = h - pad * 2;

        const yAt = v => (h - pad) - ((v - lo) / span) * sy;
        const xAt = i => (i / (n - 1)) * w;

        if (opt.refLine !== undefined && isFinite(opt.refLine)) {
            ctx.strokeStyle = opt.refColor || '#31413f';
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            const ry = yAt(opt.refLine);
            ctx.moveTo(0, ry); ctx.lineTo(w, ry);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        for (const L of lines) {
            if (L.r.n < 2) continue;
            const off = n - L.r.n;
            ctx.beginPath();
            for (let i = 0; i < L.r.n; i++) {
                const px = xAt(off + i), py = yAt(at(L.r, i));
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = L.color;
            ctx.lineWidth = 1.4;
            ctx.stroke();
        }
    }

    return m;
})();
