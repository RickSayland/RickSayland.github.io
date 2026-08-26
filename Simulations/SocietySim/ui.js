/* SocietySim — controls, panels, and the loop that drives everything.
 *
 * The clock: the simulation runs on a fixed timestep and never on wall time.
 * Real elapsed milliseconds go into an accumulator; each whole base step that
 * comes due runs `speed` ticks. Speed therefore changes how many ticks happen
 * per frame and never the size of a tick, so a run at x16 is the same run as
 * one at x1, just further along. MAX_STEPS caps the catch-up so a backgrounded
 * tab cannot come back and try to simulate a minute in one frame.
 */
'use strict';

(function () {

    const SIM_HZ = 60;
    const STEP_MS = 1000 / SIM_HZ;
    const MAX_STEPS = 4;

    let running = true;
    let speed = 1;
    let acc = 0;
    let last = 0;

    let frames = 0, framesAt = 0, fps = 60;
    let tickAcc = 0, tickAt = 0, tps = 0;
    let hudAt = 0;

    let foundingMet = 0;

    const $ = id => document.getElementById(id);

    /* ------------------------------------------------------------- boot -- */

    function boot() {
        const seed = parseInt($('seedInput').value, 10);
        sim.P.startPop = clampInt($('popInput').value, 50, sim.MAX_AGENTS);
        sim.reset(isFinite(seed) ? seed : 1);
        metrics.reset(sim);
        foundingMet = sim.pop ? sim.sumMet / sim.pop : sim.P.metMean;
        render.selected = -1;
        acc = 0;
        last = performance.now();
        buildClassRows();
        buildRoleRows();
        buildLegend();
        hud(last, true);
    }

    function clampInt(v, lo, hi) {
        let n = parseInt(v, 10);
        if (!isFinite(n)) n = lo;
        return Math.max(lo, Math.min(hi, n));
    }

    /* ------------------------------------------------------------- loop -- */

    function frame(now) {
        requestAnimationFrame(frame);

        let dt = now - last;
        last = now;
        if (dt > 250) dt = 250;

        if (running && sim.pop > 0) {
            acc += dt;
            let steps = 0;
            while (acc >= STEP_MS && steps < MAX_STEPS) {
                for (let k = 0; k < speed; k++) sim.tick();
                tickAcc += speed;
                acc -= STEP_MS;
                steps++;
            }
            if (steps === MAX_STEPS) acc = 0;      /* shed the backlog */
        }

        render.draw(sim);
        metrics.update(sim);
        metrics.drawCharts(now);

        frames++;
        if (now - framesAt > 500) {
            fps = frames * 1000 / (now - framesAt);
            frames = 0; framesAt = now;
        }
        if (now - tickAt > 500) {
            tps = tickAcc * 1000 / (now - tickAt);
            tickAcc = 0; tickAt = now;
        }

        if (now - hudAt > 150) { hud(now); hudAt = now; }
    }

    /* -------------------------------------------------------------- HUD -- */

    function set(id, text) {
        const el = $(id);
        if (el && el.textContent !== text) el.textContent = text;
    }

    function num(v, d) {
        if (!isFinite(v)) return '—';
        return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    function hud() {
        const n = metrics.now;

        /* --- population --- */
        set('statPop', sim.pop.toLocaleString());
        set('statYear', 'year ' + Math.floor(sim.year()).toLocaleString());
        set('statCapacity', Math.round(n.capacity).toLocaleString());
        const crowd = n.capacity > 0 ? sim.pop / n.capacity : 0;
        set('statCrowd', num(crowd * 100, 0) + '%');
        $('statCrowd').className = 'stat-value ' + (crowd > 0.95 ? 'bad' : crowd > 0.75 ? 'warn' : 'ok');

        /* --- vitals --- */
        set('statBirths', num(n.births, 1));
        set('statDeaths', num(n.deaths, 1));
        set('statRepl', isFinite(n.replacement) ? num(n.replacement, 2) + '×' : '∞');
        $('statRepl').className = 'stat-value ' +
            (n.replacement < 0.97 ? 'bad' : n.replacement > 1.03 ? 'ok' : 'warn');
        set('statStarved', num(n.starved, 1));
        set('statAged', num(n.aged, 1));

        const starveShare = n.deaths > 0 ? n.starved / n.deaths : 0;
        $('barStarve').style.width = (starveShare * 100).toFixed(1) + '%';
        set('statStarveShare', num(starveShare * 100, 0) + '% of deaths are hunger');

        /* --- wealth --- */
        set('statMeanCap', num(n.meanCapital, 2));
        set('statMedCap', num(n.medianCapital, 2));
        set('statTotalCap', Math.round(n.totalCapital).toLocaleString());
        set('statHungry', n.hungry.toLocaleString());
        set('statMeanFood', num(n.meanFood, 2));

        set('statGini', num(n.gini, 3));
        $('statGini').className = 'headline-val ' +
            (n.gini > 0.5 ? 'bad' : n.gini > 0.32 ? 'warn' : 'ok');
        set('statGiniWord', giniWord(n.gini));
        set('statGiniAdult', num(n.giniAdult, 3));
        set('statTop10', num(n.top10 * 100, 1) + '%');
        set('statMedMeanGap', n.meanCapital > 0
            ? num(n.medianCapital / n.meanCapital, 2) + '×' : '—');

        /* --- classes --- */
        const CL = metrics.CLASSES;
        for (let i = 0; i < CL.length; i++) {
            const cnt = n.classCount[i];
            const share = sim.pop ? cnt / sim.pop : 0;
            const wshare = n.totalCapital > 0 ? n.classWealth[i] / n.totalCapital : 0;
            const seg = $('classSeg' + i);
            if (seg) seg.style.width = (share * 100).toFixed(2) + '%';
            set('classN' + i, cnt.toLocaleString());
            set('classP' + i, num(share * 100, 1) + '%');
            set('classW' + i, num(wshare * 100, 1) + '%');
        }

        /* --- organisation --- */
        set('statSettle', String(n.settlements));
        set('statLargest', n.largest.toLocaleString());
        set('statCrowding', num(n.crowding, 1) + '×');
        set('statUrban', num(n.urbanShare * 100, 0) + '%');

        const roleCounts = countRoles();
        let biggest = 0;
        for (let r = 0; r < roleCounts.length; r++) biggest = Math.max(biggest, roleCounts[r]);
        const spec = sim.pop ? 1 - biggest / sim.pop : 0;
        set('statSpec', num(spec, 2));
        set('statSpecWord', spec < 0.001 ? 'undifferentiated' : 'differentiating');
        for (let r = 0; r < sim.ROLES.length; r++) {
            set('roleN' + r, roleCounts[r].toLocaleString());
            set('roleP' + r, sim.pop ? num(roleCounts[r] / sim.pop * 100, 1) + '%' : '—');
        }

        /* --- heredity --- */
        set('statMet', num(n.meanMet * 1000, 2));
        const drift = foundingMet > 0 ? (n.meanMet / foundingMet - 1) * 100 : 0;
        set('statMetDrift', (drift >= 0 ? '+' : '') + num(drift, 1) + '%');
        $('statMetDrift').className = 'stat-value ' + (drift < -1 ? 'ok' : drift > 1 ? 'bad' : '');

        /* --- clock --- */
        set('statTps', Math.round(tps) + ' t/s');
        set('statFps', Math.round(fps) + ' fps');

        /* The agent array is a hard ceiling the land knows nothing about. With
           the shipped parameters it is never reached, but say so out loud if a
           slider ever takes the world there — otherwise births just stop and
           the plateau looks like a result. */
        const banner = $('extinct');
        if (sim.pop === 0) {
            banner.hidden = false;
            banner.textContent = 'Nobody left. The land is regrowing over them.';
        } else if (sim.capped) {
            banner.hidden = false;
            banner.textContent = 'All ' + sim.MAX_AGENTS.toLocaleString() +
                ' slots full — births refused. The array is the ceiling now, not the land.';
        } else {
            banner.hidden = true;
        }

        inspect();
    }

    function giniWord(g) {
        if (g < 0.2) return 'near-equal';
        if (g < 0.32) return 'mild spread';
        if (g < 0.45) return 'stratifying';
        if (g < 0.58) return 'sharply unequal';
        return 'oligarchic';
    }

    const _roleCounts = new Int32Array(8);
    function countRoles() {
        _roleCounts.fill(0);
        for (let i = 0; i < sim.MAX_AGENTS; i++) {
            if (sim.alive[i]) _roleCounts[sim.role[i]]++;
        }
        return _roleCounts;
    }

    /* ---------------------------------------------------------- inspect -- */

    function inspect() {
        const i = render.selected;
        const box = $('inspectBody');
        if (i < 0 || sim.alive[i] === 0) {
            box.classList.add('empty');
            set('insHint', i < 0 ? 'Click anyone on the map.' : 'This one has died.');
            return;
        }
        box.classList.remove('empty');
        const cap = sim.capital[i];
        const CL = metrics.CLASSES;
        let b = 0;
        for (let k = CL.length - 1; k >= 0; k--) if (cap >= CL[k].min) { b = k; break; }

        set('insId', '#' + i);
        set('insRole', sim.ROLES[sim.role[i]]);
        set('insClass', CL[b].name);
        $('insClass').style.color = CL[b].color;
        set('insAge', num(sim.age[i] / sim.TPY, 1) + ' yr');
        set('insFood', num(sim.food[i], 2));
        set('insCap', num(cap, 2));
        set('insMet', num(sim.met[i] * 1000, 2));
        const rel = (sim.met[i] / metrics.now.meanMet - 1) * 100;
        set('insMetRel', (rel >= 0 ? '+' : '') + num(rel, 0) + '% vs mean');
    }

    /* ----------------------------------------------------- panel scaffold -- */

    function buildClassRows() {
        const bar = $('classBar'), rows = $('classRows');
        if (bar.childElementCount) return;
        metrics.CLASSES.forEach((c, i) => {
            const seg = document.createElement('i');
            seg.id = 'classSeg' + i;
            seg.style.background = c.color;
            seg.title = c.name;
            bar.appendChild(seg);

            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td><i class="dot" style="background:' + c.color + '"></i>' + c.name + '</td>' +
                '<td class="n" id="classN' + i + '">0</td>' +
                '<td class="n" id="classP' + i + '">—</td>' +
                '<td class="n" id="classW' + i + '">—</td>';
            rows.appendChild(tr);
        });
    }

    function buildRoleRows() {
        const rows = $('roleRows');
        if (rows.childElementCount) return;
        sim.ROLES.forEach((name, r) => {
            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + name + '</td>' +
                '<td class="n" id="roleN' + r + '">0</td>' +
                '<td class="n" id="roleP' + r + '">—</td>';
            rows.appendChild(tr);
        });
    }

    function buildLegend() {
        const el = $('legend');
        if (el.childElementCount) return;
        metrics.CLASSES.forEach(c => {
            el.insertAdjacentHTML('beforeend',
                '<span class="lg"><i class="sw" style="background:' + c.color + '"></i>' + c.name + '</span>');
        });
        el.insertAdjacentHTML('beforeend',
            '<span class="lg"><i class="sw" style="background:' + metrics.HUNGRY_COLOR + '"></i>going hungry</span>');
    }

    /* --------------------------------------------------------- controls -- */

    /* These write straight into sim.P, which means a run whose sliders were
       touched is only reproducible from seed *plus* the parameters they ended
       on. Leave them alone and the seed alone determines everything. */
    const KNOBS = [
        { key: 'regrow',    id: 'knobRegrow',  fmt: v => (v * 100).toFixed(1) + '%/tick' },
        { key: 'harvestMax', id: 'knobHarvest', fmt: v => v.toFixed(3) },
        { key: 'storeEff',  id: 'knobStore',   fmt: v => (v * 100).toFixed(0) + '%' },
        { key: 'metMutate', id: 'knobMutate',  fmt: v => (v * 100).toFixed(1) + '%' }
    ];

    function wireKnobs() {
        KNOBS.forEach(k => {
            const wrap = $(k.id);
            const input = wrap.querySelector('input');
            const out = wrap.querySelector('.knob-val');
            input.min = wrap.dataset.min;
            input.max = wrap.dataset.max;
            input.step = wrap.dataset.step;
            input.value = sim.P[k.key];
            out.textContent = k.fmt(sim.P[k.key]);
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                sim.P[k.key] = v;
                out.textContent = k.fmt(v);
            });
        });
    }

    function wire() {
        $('playBtn').addEventListener('click', () => {
            running = !running;
            $('playBtn').textContent = running ? 'Pause' : 'Play';
            $('playBtn').classList.toggle('is-on', !running);
            if (running) last = performance.now();
        });

        document.querySelectorAll('.spd').forEach(b => {
            b.addEventListener('click', () => {
                document.querySelectorAll('.spd').forEach(o => o.classList.remove('is-on'));
                b.classList.add('is-on');
                speed = parseInt(b.dataset.speed, 10);
            });
        });

        $('resetBtn').addEventListener('click', boot);
        $('rollBtn').addEventListener('click', () => {
            $('seedInput').value = (Math.random() * 1e9) | 0;
            boot();
        });
        $('fitBtn').addEventListener('click', () => render.fit(sim));

        render.onPick = (wx, wy) => {
            const r = 14 / Math.max(render.cam.z, 0.2);
            render.selected = sim.agentAt(wx, wy, Math.max(6, r));
            inspect();
        };

        window.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT') return;
            if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
            if (e.key === 'f') render.fit(sim);
        });
    }

    /* --------------------------------------------------------------- go -- */

    $('version').textContent = 'v' + sim.VERSION;
    render.init($('worldCanvas'), sim);
    wire();
    boot();
    wireKnobs();
    render.fit(sim);
    requestAnimationFrame(frame);

})();
