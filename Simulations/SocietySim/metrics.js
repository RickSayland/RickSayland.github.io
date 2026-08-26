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

    /* Class bands, in units of stored capital. These are absolute, not
       quantiles: with quantile bands a society of identical paupers still reads
       as having an upper class, which is exactly the wrong answer. The cuts are
       pinned to things an agent can actually do — birthCapital is the price of
       a child, so "Settled" means able to afford one, and "Landed" means able
       to afford several without ever going hungry. */
    const CLASSES = [
        { name: 'Destitute', min: 0,    color: '#b4694a' },
        { name: 'Subsisting', min: 0.8,  color: '#c9a06a' },
        { name: 'Settled',   min: 3.2,  color: '#f2b56b' },
        { name: 'Landed',    min: 8.0,  color: '#ffe6a8' }
    ];
    const HUNGRY_COLOR = '#e2603c';   /* a condition, not a class */
    const HUNGRY_FOOD = 0.6;

    /* Settlement detection works on blocks of land cells, not single cells: one
       cell is 10 world units and a farmer crosses it in four steps, so at cell
       resolution every transient knot of walkers reads as a town. */
    const BLOCK = 4;
    const BW = Math.ceil(160 / BLOCK);
    const BH = Math.ceil(100 / BLOCK);

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

        series: {
            pop: ring(SERIES_LEN),
            birthRate: ring(SERIES_LEN),
            deathRate: ring(SERIES_LEN),
            starveShare: ring(SERIES_LEN),
            meanCapital: ring(SERIES_LEN),
            gini: ring(SERIES_LEN),
            giniAdult: ring(SERIES_LEN),
            meanMet: ring(SERIES_LEN),
            crop: ring(SERIES_LEN),
            top10: ring(SERIES_LEN)
        },

        /* latest snapshot, read by the UI */
        now: {
            pop: 0, year: 0,
            births: 0, deaths: 0, starved: 0, aged: 0,   /* per year */
            replacement: 1,
            meanFood: 0, meanCapital: 0, medianCapital: 0, meanMet: 0,
            gini: 0, giniAdult: 0, adults: 0, top10: 0, totalCapital: 0,
            classCount: [0, 0, 0, 0],
            classWealth: [0, 0, 0, 0],
            hungry: 0,
            lorenz: new Float32Array(33),
            settlements: 0, largest: 0, urbanShare: 0, crowding: 0,
            capacity: 0
        },

        _lastTick: -1,
        _prevBirths: 0, _prevStarved: 0, _prevAged: 0,
        _caps: new Float32Array(10000),
        _capsA: new Float32Array(10000),
        _dens: new Int32Array(BW * BH),
        _label: new Int32Array(BW * BH),
        _stack: new Int32Array(BW * BH),
        _landBlocks: 0,
        _chartsAt: 0,

        /* --------------------------------------------------------- reset -- */

        reset(s) {
            for (const k in this.series) {
                const r = this.series[k];
                r.n = 0; r.head = 0; r.buf.fill(0);
            }
            this._lastTick = -1;
            this._prevBirths = 0;
            this._prevStarved = 0;
            this._prevAged = 0;
            this._landBlocks = 0;
            this.now.capacity = s.carryingCapacity();
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

            /* --- wealth distribution --- */
            const caps = this._caps, capsA = this._capsA;
            let k = 0, ka = 0, hungry = 0;
            const cc = n.classCount, cw = n.classWealth;
            cc[0] = cc[1] = cc[2] = cc[3] = 0;
            cw[0] = cw[1] = cw[2] = cw[3] = 0;

            const maturity = s.P.maturity;
            for (let i = 0; i < s.MAX_AGENTS; i++) {
                if (s.alive[i] === 0) continue;
                const c = s.capital[i];
                caps[k++] = c;
                if (s.age[i] >= maturity) capsA[ka++] = c;
                if (s.food[i] < HUNGRY_FOOD) hungry++;
                const b = c >= CLASSES[3].min ? 3 : c >= CLASSES[2].min ? 2
                        : c >= CLASSES[1].min ? 1 : 0;
                cc[b]++; cw[b] += c;
            }
            n.hungry = hungry;
            n.adults = ka;

            const view = caps.subarray(0, k);
            view.sort();                       /* Float32Array sorts numerically */

            let total = 0;
            for (let i = 0; i < k; i++) total += view[i];
            n.totalCapital = total;
            n.medianCapital = k ? (k & 1 ? view[k >> 1]
                                         : 0.5 * (view[k >> 1] + view[(k >> 1) - 1])) : 0;
            n.gini = giniOf(view, k, total);

            /* The same measure over grown agents only. Most of the headline
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

            /* Share held by the richest tenth. */
            if (k > 0 && total > 0) {
                let top = 0;
                for (let i = Math.floor(k * 0.9); i < k; i++) top += view[i];
                n.top10 = top / total;
            } else n.top10 = 0;

            /* --- how the population is arranged on the ground --- */
            this._settlements(s);

            /* --- series --- */
            const S = this.series;
            push(S.pop, pop);
            push(S.birthRate, n.births);
            push(S.deathRate, n.deaths);
            push(S.starveShare, n.deaths > 0 ? n.starved / n.deaths : 0);
            push(S.meanCapital, n.meanCapital);
            push(S.gini, n.gini);
            push(S.giniAdult, n.giniAdult);
            push(S.meanMet, n.meanMet);
            push(S.crop, s.cropTotal);
            push(S.top10, n.top10);

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

            /* Peak crowding is reported alongside the count because at v0.1.0
               the count is honestly zero — farmers have to spread out to eat,
               and nothing yet holds them together. A ratio still moves, and it
               is the number that will climb once something does. */
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

            /* line of perfect equality */
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
            for (let i = 0; i <= 32; i++) {
                ctx.lineTo(x0 + (i / 32) * sx, y0 - L[i] * sy);
            }
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
        if (hi - lo < 1e-9) { hi = lo + 1; }
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
