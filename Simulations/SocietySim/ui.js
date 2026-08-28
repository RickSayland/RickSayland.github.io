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
    /* Ceiling on how long one frame may spend simulating. Without it a machine
       that cannot keep up at high speed keeps piling on catch-up steps — at x16
       with twelve thousand agents the loop was running sixty-four ticks a frame
       and the page rendered at ten. The budget does not change the timestep or
       how many ticks a speed setting asks for; it just stops a frame that has
       already overrun from taking another whole base step. */
    const FRAME_BUDGET_MS = 20;

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
        render.worldChanged(sim);
        foundingMet = sim.pop ? sim.sumMet / sim.pop : sim.P.metMean;
        chronLen = -1;
        acc = 0;
        last = performance.now();
        buildClassRows();
        buildRoleRows();
        buildTerrainRows();
        buildResRows();
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
            const deadline = now + FRAME_BUDGET_MS;
            while (acc >= STEP_MS && steps < MAX_STEPS) {
                for (let k = 0; k < speed; k++) sim.tick();
                tickAcc += speed;
                acc -= STEP_MS;
                steps++;
                if (performance.now() >= deadline) { acc = 0; break; }
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

        /* --- the map --- */
        for (let t = 0; t < 5; t++) {
            const seg = $('terSeg' + t);
            if (seg) seg.style.width = (n.terrain[t] * 100).toFixed(2) + '%';
            set('terP' + t, num(n.terrain[t] * 100, 1) + '%');
        }
        set('statFarmable', num(n.farmable * 100, 0) + '% of the map');

        /* --- deposits --- */
        for (let k = 0; k < 4; k++) {
            set('resTot' + k, num(n.resTotal[k], 0));
            set('resHeld' + k, n.resTotal[k] > 0
                ? num(n.resHeld[k] / n.resTotal[k] * 100, 0) + '%' : '—');
            const ratio = n.resMapDens[k] > 0 ? n.resHeldDens[k] / n.resMapDens[k] : 0;
            set('resRel' + k, ratio > 0 ? num(ratio, 2) + '×' : '—');
            const el = $('resRel' + k);
            if (el) el.className = 'n ' + (ratio > 1.08 ? 'good' : ratio < 0.92 ? 'poor' : '');
        }
        set('statOilYear', num(n.oilYear, 1) + ' / yr');

        /* --- property --- */
        set('statEstates', String(n.estates));
        set('statOwned', num(n.ownedShare * 100, 1) + '%');
        set('statTenantShare', num(n.tenantShare * 100, 0) + '%');
        set('statWorked', num(n.workedShare * 100, 0) + '% — the rest is frontier');
        set('statRent', num(n.rentYear, 0) + ' / yr');
        set('statLargestEstate', n.largestEstate.toLocaleString() + ' cells');
        set('statEnclosures', sim.enclosures + ' / ' + sim.dissolutions);

        set('statTenantEdge', n.freeCap > 0 ? num(n.tenantEdge, 2) + '×' : '—');
        $('statTenantEdge').className = 'headline-val ' +
            (n.estates === 0 ? '' : n.tenantEdge > 1.03 ? 'ok' : n.tenantEdge < 0.97 ? 'bad' : 'warn');
        set('statTenantCap', num(n.tenantCap, 2));
        set('statFreeCap', num(n.freeCap, 2));
        set('statSoldierCap', num(n.soldierCap, 2));
        set('statBargain', bargainWord(n));

        /* --- arms --- */
        set('statSoldiers', n.soldiers.toLocaleString());
        set('statGarrisonMax', String(n.garrisonMax));
        set('statEnforce', num(n.enforcement * 100, 0) + '%');
        $('barEnforce').style.width = (n.enforcement * 100).toFixed(1) + '%';
        set('statRecruits', sim.recruits + ' / ' + sim.desertions);
        set('statArmsShare', sim.pop ? num(n.soldiers / sim.pop * 100, 2) + '% of everyone' : '—');

        /* --- towns --- */
        set('statUrbanPct', num(n.urbanShareRole * 100, 1) + '%');
        set('statTownsfolk', n.townsfolk.toLocaleString());
        set('statTowns', String(n.towns));
        set('statBiggestTown', Math.round(n.biggestTown).toLocaleString());
        set('statCapitalTown', num(n.meanCapitalTown, 0));
        set('statOtherTown', num(n.meanOtherTown, 0));
        set('statGranary', num(n.granary, 0));
        set('statCraft', num(n.craftYear, 0) + ' / yr');
        set('statRoads', Math.round(n.roadCells * sim.CELL / 100) + ' leagues');
        set('statTownVsFarm', n.farmCap > 0 ? num(n.townCap / n.farmCap, 1) + '×' : '—');

        /* --- government --- */
        set('statGovs', String(n.govs));
        set('statGovWord', govWord(n));
        set('statOfficials', n.officials.toLocaleString());
        set('statAdmin', num(n.admin * 100, 0) + '%');
        set('statTreasury', num(n.treasury, 0));
        set('statGarrisonGov', num(n.garrisonGov, 1));
        set('statGarrisonFeud', num(n.garrisonFeudal, 1));
        $('statGarrisonGov').className = 'stat-value ' +
            (n.garrisonGov > n.garrisonFeudal * 1.15 ? 'ok' : '');
        set('statGovLand', num(n.govLandShare * 100, 0) + '% of what is enclosed');
        set('statBiggestGov', n.biggestGov + (n.biggestGov === 1 ? ' manor' : ' manors'));
        set('statTax', num(n.taxYear, 0) + ' / yr');
        set('statWorks', num(n.worksYear, 0) + ' / yr · ' + num(n.worksFunded * 100, 0) + '% funded');
        set('statGovEvents', sim.governments + ' / ' + sim.collapses);

        /* --- ordnance & empire --- */
        set('statArmed', String(n.armedStates));
        set('statArsenal', num(n.arsenal, 0));
        set('statStrikes', n.strikes.toLocaleString());
        set('statVassals', String(n.vassals));
        set('statEmpire', n.biggestEmpire + (n.biggestEmpire === 1 ? ' tributary' : ' tributaries'));
        set('statCivDead', n.civilianDead.toLocaleString());
        set('statWarDead', n.warDead.toLocaleString());
        const totalDead = n.civilianDead + n.warDead;
        const civShare = totalDead > 0 ? n.civilianDead / totalDead : 0;
        $('barCivilian').style.width = (civShare * 100).toFixed(1) + '%';
        set('statBombNote', n.strikes === 0
            ? 'Nobody has an arsenal yet. Every war so far has been fought at a border.'
            : num(civShare * 100, 0) + '% of everyone killed in war was a townsman, ' +
              'not a soldier — guns pick the biggest town because that is what breaks a country fastest.');
        set('statTribute', num(n.tributeYear, 1) + ' / yr');
        set('statVassalEvents', sim.vassalages + ' / ' + sim.rebellions);

        /* --- states --- */
        set('statStates', String(n.states));
        set('statLargestState', String(n.largestState));
        set('statWars', String(n.wars));
        $('statWars').className = 'stat-value ' + (n.wars > 0 ? 'bad' : '');
        set('statSovereign', n.sovereign + ' of ' + n.states);
        set('statSubjects', sim.subjectEstates + ' estates · ' + num(n.subjectShare * 100, 0) + '%');
        set('statLevy', num(n.levyYear, 1) + ' / yr');
        set('statCapitalCap', num(n.capitalCap, 0));
        set('statDiplo', sim.unions + ' / ' + sim.warsDeclared + ' / ' + sim.annexations);
        set('statWarDead', sim.warDead.toLocaleString());
        chronicle();

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

    /* The chronicle re-renders only when something new has happened — it is a
       dozen DOM nodes rebuilt from a list that changes a few times a century,
       and rebuilding it six times a second for nothing is pure waste. */
    let chronLen = -1;
    function chronicle() {
        const log = sim.log;
        if (log.length === chronLen) return;
        chronLen = log.length;
        const el = $('chronicle');
        if (log.length === 0) {
            el.innerHTML = '<div class="chron-empty">Nothing has happened yet.</div>';
            return;
        }
        const rows = [];
        for (let i = log.length - 1; i >= 0 && rows.length < 14; i--) {
            const ev = log[i];
            const yr = Math.floor(ev.t / sim.TPY);
            let cls = 'ev', text;
            switch (ev.type) {
                case 'found':
                    text = 'Manor #' + ev.a + ' enclosed, sovereign.';
                    break;
                case 'union':
                    cls = 'ev union';
                    text = 'State #' + ev.b + ' joins #' + ev.a + ' — ' +
                           ev.n + (ev.n === 1 ? ' manor' : ' manors') + ', by agreement.';
                    break;
                case 'war':
                    cls = 'ev war';
                    text = 'State #' + ev.a + ' declares war on #' + ev.b + '.';
                    break;
                case 'annex':
                    cls = 'ev annex';
                    text = 'State #' + ev.a + ' annexes #' + ev.b + ' — ' +
                           ev.n + (ev.n === 1 ? ' manor' : ' manors') + ' held as subject.';
                    break;
                case 'peace':
                    cls = 'ev peace';
                    text = 'State #' + ev.a + ' and #' + ev.b + ' break off the war.';
                    break;
                case 'gov':
                    cls = 'ev gov';
                    text = 'State #' + ev.a + ' takes a government — ' + ev.b +
                           ' manors, a treasury, and offices to run it.';
                    break;
                case 'collapse':
                    cls = 'ev collapse';
                    text = 'State #' + ev.a + ' falls to ' + ev.b +
                           ' manors; the offices are abolished.';
                    break;
                case 'vassal':
                    cls = 'ev vassal';
                    text = 'State #' + ev.b + ' is beaten from beyond its borders ' +
                           'and pays tribute to #' + ev.a + '.';
                    break;
                case 'freed':
                    cls = 'ev freed';
                    text = ev.n === 1
                        ? 'State #' + ev.a + ' has outgrown #' + ev.b + ' and stops paying tribute.'
                        : 'State #' + ev.a + ' is released — #' + ev.b + ' is gone.';
                    break;
                default:
                    text = ev.type;
            }
            rows.push('<div class="' + cls + '"><span class="ev-yr">' + yr + '</span>' + text + '</div>');
        }
        el.innerHTML = rows.join('');
    }

    function govWord(n) {
        if (n.govs === 0) return 'none yet — every crown still a household';
        if (n.admin < 0.45) return 'paper states, living on customary dues';
        if (n.govLandShare < 0.3) return 'a few, among many feudal neighbours';
        if (n.govLandShare < 0.6) return 'the coming thing';
        return 'the age of the nation-state';
    }

    function bargainWord(n) {
        if (n.estates === 0) return 'Nobody owns anything yet. Every farmer works the commons.';
        if (n.freeCap <= 0) return 'No freeholders left to compare against.';
        const e = n.tenantEdge;
        if (e > 1.15) return 'The improvement is worth more than the rent, comfortably. Expect the commons to keep emptying.';
        if (e > 1.03) return 'Tenants are modestly ahead. The bargain holds, but not by much.';
        if (e > 0.97) return 'A wash. Tenants pay in rent almost exactly what the better ground gives back.';
        return 'Tenants are worse off than freeholders — the rent has overtaken the improvement, and the borders will start to bleed.';
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

        const ci = ((sim.y[i] / sim.CELL) | 0) * sim.GW + ((sim.x[i] / sim.CELL) | 0);
        const under = sim.owner[ci];
        set('insGround', under >= 0 ? 'estate #' + under : 'the commons');

        /* A lord's own estate if he has one, otherwise whatever he is standing
           on — which for a soldier is the ground he is being paid to hold. */
        let e = sim.estateOf[i];
        if (e < 0) e = under;
        const estBox = $('insEstate');
        if (e >= 0 && sim.eAlive[e] === 1) {
            estBox.hidden = false;
            set('insEstId', '#' + e + (sim.eBroke[e] ? ' — in arrears' : ''));
            set('insEstCells', sim.eCells[e] + ' cells / ' + sim.eGarrison[e] + ' men');
            set('insEstTen', sim.eTenantsLast[e] + ' / ' + num(sim.eEnforce[e] * 100, 0) + '%');
            set('insEstRent', num(sim.eRentLast[e] * sim.TPY, 1));
            set('insEstAge', num((sim.tickCount - sim.eBorn[e]) / sim.TPY, 0) + ' yr ago');
        } else {
            estBox.hidden = true;
        }
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

    const TERRAIN_COLORS = ['#1a3a52', '#3a5a3e', '#2a4a34', '#7a6a4a', '#66666c'];
    const RES_COLORS = ['#b0becc', '#a86cdc', '#f2c14e', '#7ad06c'];

    function buildTerrainRows() {
        const bar = $('terrainBar'), rows = $('terrainRows');
        if (bar.childElementCount) return;
        sim.TERRAIN_NAMES.forEach((name, t) => {
            const seg = document.createElement('i');
            seg.id = 'terSeg' + t;
            seg.style.background = TERRAIN_COLORS[t];
            seg.title = name;
            bar.appendChild(seg);

            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td><i class="dot" style="background:' + TERRAIN_COLORS[t] + '"></i>' + name + '</td>' +
                '<td class="n" id="terP' + t + '">—</td>';
            rows.appendChild(tr);
        });
    }

    function buildResRows() {
        const rows = $('resRows');
        if (rows.childElementCount) return;
        sim.RES_NAMES.forEach((name, k) => {
            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td><i class="dot" style="background:' + RES_COLORS[k] + '"></i>' + name + '</td>' +
                '<td class="n" id="resTot' + k + '">—</td>' +
                '<td class="n" id="resHeld' + k + '">—</td>' +
                '<td class="n" id="resRel' + k + '">—</td>';
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
        const row = (color, label) =>
            '<span class="lg"><i class="sw" style="background:' + color + '"></i>' + label + '</span>';
        metrics.CLASSES.forEach(c => el.insertAdjacentHTML('beforeend', row(c.color, c.name)));
        el.insertAdjacentHTML('beforeend', row(metrics.HUNGRY_COLOR, 'going hungry'));
        el.insertAdjacentHTML('beforeend', row(metrics.SOLDIER_COLOR, 'soldier'));
        el.insertAdjacentHTML('beforeend', row(metrics.CITIZEN_COLOR, 'townsfolk'));
        el.insertAdjacentHTML('beforeend', row(metrics.OFFICIAL_COLOR, 'official'));
        el.insertAdjacentHTML('beforeend', row(metrics.LORD_COLOR, 'lord · manor'));
    }

    /* --------------------------------------------------------- controls -- */

    /* These write straight into sim.P, which means a run whose sliders were
       touched is only reproducible from seed *plus* the parameters they ended
       on. Leave them alone and the seed alone determines everything. */
    const KNOBS = [
        { key: 'regrow',      id: 'knobRegrow',  fmt: v => (v * 100).toFixed(1) + '%/tick' },
        { key: 'harvestMax',  id: 'knobHarvest', fmt: v => v.toFixed(3) },
        { key: 'storeEff',    id: 'knobStore',   fmt: v => (v * 100).toFixed(0) + '%' },
        { key: 'metMutate',   id: 'knobMutate',  fmt: v => (v * 100).toFixed(1) + '%' },
        { key: 'social',      id: 'knobSocial',  fmt: v => v.toFixed(4) },
        { key: 'rentShare',   id: 'knobRent',    fmt: v => (v * 100).toFixed(0) + '%' },
        { key: 'improve',     id: 'knobImprove', fmt: v => '+' + (v * 100).toFixed(0) + '%' },
        { key: 'claimMin',    id: 'knobClaim',   fmt: v => v.toFixed(1) },
        { key: 'soldierCost', id: 'knobSoldier', fmt: v => v.toFixed(3) },
        { key: 'granaryShare', id: 'knobGranary',  fmt: v => (v * 100).toFixed(0) + '%' },
        { key: 'foodPrice',    id: 'knobPrice',    fmt: v => v.toFixed(2) },
        { key: 'cityWage',     id: 'knobWage',     fmt: v => v.toFixed(3) },
        { key: 'craftValue',   id: 'knobCraft',    fmt: v => v.toFixed(3) },
        { key: 'levyFood',     id: 'knobLevyFood', fmt: v => (v * 100).toFixed(0) + '%' },
        { key: 'govMinEstates',    id: 'knobGovMin',  fmt: v => String(Math.round(v)) },
        { key: 'taxRate',          id: 'knobTax',     fmt: v => (v * 100).toFixed(0) + '%' },
        { key: 'officialsPerEstate', id: 'knobOffPer', fmt: v => v.toFixed(1) },
        { key: 'worksBonus',       id: 'knobWorks',   fmt: v => '+' + (v * 100).toFixed(0) + '%' },
        { key: 'govArmyBonus',     id: 'knobGovArmy', fmt: v => '+' + (v * 100).toFixed(0) + '%' }
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

        $('estToggle').addEventListener('change', e => {
            render.showEstates = e.target.checked;
        });

        $('depToggle').addEventListener('change', e => {
            render.showDeposits = e.target.checked;
        });

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
