// ============ ATOM VIEWER — BOOT, STATE, LOOP ============
// Plain scripts, so load order is the <script> order in index.html:
// elements → nuclides → nucleus → scf → orbitals → volume → nucleusview →
// panels → main. Only this file boots, because the solver, the volume view
// and the rail widgets all have to exist before the first atom is requested.
//
// Two scheduling rules matter:
//
// - **Nothing expensive runs on the event.** Changing protons or electrons
//   queues a solver job; the loop gives it ~12 ms a frame, then the volume
//   bake gets ~10 ms a frame, first at 56³ for a quick look and then at
//   128³. A heavy atom takes a few hundred milliseconds end to end and the
//   page never stalls for it. Solutions are cached by (Z, electrons), and
//   neutrons do not enter the electronic problem at all (the isotope shift is
//   ~10⁻⁵ of anything drawn), so walking through isotopes costs nothing.
// - **The selection is stored by quantum numbers, not by index**, so "2p"
//   stays selected when you step from carbon to silicon, and falls back to
//   "All electrons" only when the new atom has no such subshell.

const ATOM_VERSION = '1.0';
const BAKE_SIZES = [56, 128];
const HA_EV = scf.HA_EV;
const PM = 52.917721;

const app = {
    Z: 6, N: 6, E: 6,
    view: 'atom',
    sel: { kind: 'all' },
    style: 'cloud', scale: 'true', cut: false, spin: true,
    cache: new Map(),
    pending: null,
    job: null,
    shownE: 0,
    requestedE: 0,
    ionPending: null,
    ie: null,
    scene: null,
    bake: null,
    bakeLevel: 0,
    map: null,
    ticks: [],
    decayNote: null,
    dragging: false, lastX: 0, lastY: 0, lastInteract: -1e9,
    time: 0, lastFrame: 0,
    frameAvg: 16,
    glOK: false,
    railDirty: true,
};

const $ = id => document.getElementById(id);
const sup = n => nucleus.sup(n);

// ---- Electrons ----

function watsonRadius(Z) {
    // Bohr. Roughly the ionic radius of an oxide/sulfide-like dianion, growing
    // with the period; only the tail outside it is affected.
    const period = Z <= 2 ? 1 : Z <= 10 ? 2 : Z <= 18 ? 3 : Z <= 36 ? 4 : Z <= 54 ? 5 : Z <= 86 ? 6 : 7;
    return 2.6 + 0.6 * Math.max(0, period - 2);
}

function electronOpts(Z, E) {
    const o = {};
    if (E > Z) o.latter = true;
    if (E >= Z + 2) o.watson = { q: E - Z, R: watsonRadius(Z) };
    return o;
}

function requestElectrons() {
    app.requestedE = app.E;
    app.ie = null;
    app.ionPending = null;
    if (app.E === 0) {
        app.pending = null;
        app.job = null;
        app.shownE = 0;
        buildScene();
        app.railDirty = true;
        return;
    }
    startJob(app.Z, app.E);
}

function startJob(Z, E) {
    const key = Z + ':' + E;
    const hit = app.cache.get(key);
    if (hit) { app.pending = null; finishJob(hit, Z, E); return; }
    app.pending = { key, Z, E, job: scf.create(Z, configs.build(Z, E), electronOpts(Z, E)) };
    app.railDirty = true;
}

function finishJob(job, Z, E) {
    if (Z !== app.Z || app.requestedE !== app.E) return;          // stale
    app.job = job;
    app.shownE = E;
    buildScene();
    app.railDirty = true;
    // Ionisation energy by ΔSCF, for neutral atoms and cations.
    if (E === 1) app.ie = -job.shells[0].e;
    else if (E >= 2 && E <= Z && E === app.E) {
        const k = Z + ':' + (E - 1);
        const ion = app.cache.get(k);
        if (ion) app.ie = ion.Etot - job.Etot;
        else app.ionPending = { key: k, Z, E: E - 1, parent: job, job: scf.create(Z, configs.build(Z, E - 1), electronOpts(Z, E - 1)) };
    }
}

function pumpSolver() {
    const p = app.pending;
    if (p) {
        scf.work(p.job, 12);
        if (!p.job.done) return;
        app.pending = null;
        if (p.job.failed) {
            // An extra electron the model cannot hold: show the atom with one fewer.
            if (p.E > p.Z) { startJob(p.Z, p.E - 1); return; }
            app.railDirty = true;
            return;
        }
        app.cache.set(p.key, p.job);
        finishJob(p.job, p.Z, p.E);
        return;
    }
    const q = app.ionPending;
    if (q && (!app.bake || app.bake.done)) {
        scf.work(q.job, 8);
        if (!q.job.done) return;
        app.ionPending = null;
        if (!q.job.failed) {
            app.cache.set(q.key, q.job);
            if (app.job === q.parent) { app.ie = q.job.Etot - q.parent.Etot; app.railDirty = true; }
        }
    }
}

// ---- Selection ----

function resolveSel() {
    const job = app.job;
    if (!job || app.sel.kind === 'all') return { kind: 'all' };
    const i = job.shells.findIndex(s => s.n === app.sel.n && s.l === app.sel.l);
    if (i < 0) return { kind: 'all' };
    if (app.sel.kind === 'shell' || job.shells[i].l === 0) return { kind: 'shell', shell: i };
    return { kind: 'orb', shell: i, m: app.sel.m };
}

function select(s) {
    if (s.kind === 'all' || !app.job) app.sel = { kind: 'all' };
    else {
        const sh = app.job.shells[s.shell];
        app.sel = { kind: s.kind, n: sh.n, l: sh.l, m: s.m };
    }
    if (app.view !== 'atom') setView('atom');
    queueBake();
    app.railDirty = true;
}

// ---- Scene & volume ----

function buildScene() {
    app.scene = app.job ? orbitals.atomScene(app.job) : null;
    queueBake();
}

function niceTicks() {
    const out = [];
    for (let e = -2; e <= 4; e++) for (const m of [1, 2, 5]) {
        const pm = m * 10 ** e;
        out.push({ r: pm / PM, label: pm >= 1000 ? pm / 1000 + ' nm' : +pm.toPrecision(3) + ' pm' });
    }
    return out;
}

function queueBake() {
    app.bake = null;
    if (!app.scene) { if (app.glOK) volumeView.clearVolume(); return; }
    const sel = resolveSel();
    const R = orbitals.extentFor(app.scene, sel);
    app.map = orbitals.makeMap(app.scale, R, orbitals.coreScale(app.job));
    app.ticks = niceTicks();
    app.bakeLevel = 0;
    if (app.glOK) app.bake = orbitals.createBake(app.scene, sel, app.style, app.map, BAKE_SIZES[0]);
}

function pumpBake() {
    const b = app.bake;
    if (!b || b.done) return;
    if (app.pending) return;
    orbitals.stepBake(b, 10);
    if (!b.done) return;
    volumeView.setVolume(b.data, b.G);
    if (++app.bakeLevel < BAKE_SIZES.length) {
        app.bake = orbitals.createBake(app.scene, resolveSel(), app.style, app.map, BAKE_SIZES[app.bakeLevel]);
    }
}

// ---- Nucleus ----

function setNucleus() {
    nucleusView.setNucleus(nucleus.packing(app.Z, app.N));
    chartView.setCurrent(app.Z, app.N);
}

function doDecay(v) {
    if (!v.daughter || nucleusView.busy) return;
    const [dZ, dN] = v.daughter;
    const nz = app.Z + dZ, nn = app.N + dN;
    if (nz < 1) return;
    if (app.view !== 'nucleus') setView('nucleus');
    const from = ELEMENTS[app.Z].sym + '-' + (app.Z + app.N);
    const ok = nucleusView.decay(v.mode, () => {
        const zChanged = nz !== app.Z;
        app.Z = nz; app.N = Math.max(0, nn);
        // The atom keeps its electrons, so a decay leaves an ion behind —
        // except that no atom can hold two extra electrons, so after an
        // alpha decay the surplus pair wanders off and the atom is neutral.
        const surplus = app.E - app.Z;
        app.decayNote = { from, shed: surplus >= 2 ? surplus : 0 };
        if (surplus >= 2) app.E = app.Z;
        if (zChanged) requestElectrons();
        setNucleus();
        syncInputs();
        app.railDirty = true;
    });
    if (!ok) return;
    app.railDirty = true;
}

// ---- Changes from the controls ----

function setZ(z) {
    z = Math.max(1, Math.min(118, Math.round(z) || 1));
    if (z === app.Z) return;
    const wasDefaultN = app.N === nucleus.defaultN(app.Z);
    const wasNeutral = app.E === app.Z;
    app.Z = z;
    if (wasDefaultN) app.N = nucleus.defaultN(z);
    if (wasNeutral) app.E = z;
    app.E = Math.min(app.E, z + 2);
    changed(true);
}
function setN(n) {
    n = Math.max(0, Math.min(250, Math.round(n) || 0));
    if (n === app.N) return;
    app.N = n;
    changed(false);
}
function setE(e) {
    e = Math.max(0, Math.min(app.Z + 2, Math.round(e) || 0));
    if (e === app.E) return;
    app.E = e;
    app.decayNote = null;
    requestElectrons();
    syncInputs();
}
function pickElement(z) {
    app.Z = z;
    app.N = nucleus.defaultN(z);
    app.E = z;
    changed(true);
}
function changed(electrons) {
    app.decayNote = null;
    if (electrons) requestElectrons();
    setNucleus();
    syncInputs();
    app.railDirty = true;
}

function syncInputs() {
    $('inZ').value = app.Z;
    $('inN').value = app.N;
    $('inE').value = app.E;
    $('inE').max = app.Z + 2;
    $('elSelect').value = String(app.Z);
    $('neutralBtn').disabled = app.E === app.Z;
}

function setView(v) {
    app.view = v;
    document.body.dataset.view = v;
    for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.view === v);
    app.railDirty = true;
}

// ---- Rail ----

function fmtLen(bohr) {
    const pm = bohr * PM;
    if (pm >= 1000) return (pm / 1000).toPrecision(3) + ' nm';
    if (pm >= 10) return Math.round(pm) + ' pm';
    return pm.toPrecision(2) + ' pm';
}
const fmtNum = x => x.toLocaleString('en-US');
function ionLabel(Z, E) {
    const q = Z - E;
    if (!q) return '';
    return (Math.abs(q) > 1 ? sup(Math.abs(q)) : '') + (q > 0 ? '⁺' : '⁻');
}
function nuclideName(Z, N) { return ELEMENTS[Z].name + '-' + (Z + N); }
function atomRadius(job) {
    if (!job || !job.shells.length) return 0;
    let r = 0;
    for (const sh of job.shells) r = Math.max(r, scf.meanRadius(job, sh));
    return r;
}

function renderIdent() {
    const el = ELEMENTS[app.Z], A = app.Z + app.N, q = app.Z - app.E;
    $('identSym').innerHTML = `<span class="iso"><span class="a">${A}</span><span class="z">${app.Z}</span></span>${el.sym}` +
        (q ? `<span class="chg">${Math.abs(q) > 1 ? Math.abs(q) : ''}${q > 0 ? '+' : '−'}</span>` : '');
    $('identName').textContent = nuclideName(app.Z, app.N);
    const kind = q === 0 ? 'neutral atom' : app.E === 0 ? 'bare nucleus' : q > 0 ? `ion, ${q}+ (cation)` : `ion, ${-q}− (anion)`;
    $('identSub').textContent = `${app.Z} p · ${app.N} n · ${app.E} e — ${kind}`;
    $('hdrId').innerHTML = `<b>${sup(A)}${el.sym}${ionLabel(app.Z, app.E)}</b> &nbsp;${nuclideName(app.Z, app.N)}`;
}

function renderNucleus() {
    const v = nucleus.verdict(app.Z, app.N);
    app.verdict = v;
    const el = ELEMENTS[app.Z];
    const rec = v.rec;
    const name = nuclideName(app.Z, app.N);
    const dName = () => {
        if (!v.daughter) return '';
        const z = app.Z + v.daughter[0], n = app.N + v.daughter[1];
        return z >= 1 ? ` → ${ELEMENTS[z].sym}-${z + n}` : '';
    };
    const branches = rec && rec.modes.length > 1
        ? '<p class="src">Branches: ' + rec.modes.map(m => `${nucleus.modeText(m.mode)} ${m.pct == null ? '(?)' : +m.pct.toPrecision(3) + '%'}`).join(' · ') + '</p>' : '';
    let cls = v.kind, h = '', body = '';
    const limit = rec && rec.limit ? (rec.limit === '>' ? 'more than ' : rec.limit === '<' ? 'under ' : 'about ') : '';

    if (v.kind === 'stable') {
        h = 'Stable';
        body = rec.abund != null
            ? `<p>${+rec.abund.toPrecision(4)}% of natural ${el.name.toLowerCase()}. ${el.name} has ${v.context.stableCount} stable isotope${v.context.stableCount === 1 ? '' : 's'}.</p>`
            : `<p>Stable, but not found in nature.</p>`;
    } else if (v.kind === 'radioactive') {
        h = 'Radioactive';
        body = `<p>Half-life <b>${limit}${nucleus.fmtTime(v.hl)}</b>. Decays by ${nucleus.modeText(v.mode)}${dName()}.</p>`;
        if (rec.abund) body += `<p>Still here from before the Earth formed: ${+rec.abund.toPrecision(3)}% of natural ${el.name.toLowerCase()}.</p>`;
        body += branches;
    } else if (v.kind === 'unbound') {
        h = 'Unbound';
        if (v.source === 'data') {
            body = `<p>Falls apart in <b>${v.hl ? nucleus.fmtTime(v.hl) : 'far less than a nanosecond'}</b> by ${nucleus.modeText(v.mode)}${dName()}. That is about how long a nucleon takes to cross a nucleus, so it never properly forms: it is seen only as a resonance.</p>`;
        } else {
            const side = v.side === 'neutron';
            const one = side ? v.sep.Sn : v.sep.Sp, two = side ? v.sep.S2n : v.sep.S2p;
            const pair = !(one < 0);
            const what = (pair ? 'last two ' : 'last ') + (side ? 'neutron' : 'proton') + (pair ? 's are' : ' is');
            body = `<p>Never observed, and it could not hold together: with ${app.Z} proton${app.Z > 1 ? 's' : ''} and ${app.N} neutron${app.N === 1 ? '' : 's'} the ${what} unbound by about <b>${(-(pair ? two : one)).toFixed(1)} MeV</b>. ${pair ? 'They' : 'It'} would simply fall off, in ~10⁻²² s.</p>`;
            body += `<p>The ${side ? 'heaviest' : 'lightest'} ${el.name.toLowerCase()} ever seen is ${el.sym}-${side ? v.context.heaviest : v.context.lightest}.</p>`;
        }
    } else if (v.kind === 'predicted') {
        h = 'Never observed';
        body = `<p>Nobody has made ${name}. The liquid-drop model says it should hold together, then decay by ${nucleus.modeText(v.mode)}${dName()} with a half-life of very roughly <b>${nucleus.fmtTime(v.hl)}</b>.</p>` +
            `<p class="src">An order-of-magnitude estimate from extrapolated masses.</p>`;
    } else {
        h = 'Observed';
        body = `<p>${name} has been seen, but its lifetime has not been measured.</p>`;
    }
    const canDecay = v.daughter && nucleusView.canDecay(v.mode) && app.Z + v.daughter[0] >= 1;
    $('nucVerdict').className = 'verdict ' + cls;
    $('nucVerdict').innerHTML = `<h3>${h}</h3>${body}` + (canDecay ? `<button class="decay-btn" id="decayBtn">Watch it decay ▸</button>` : '');
    if (canDecay) $('decayBtn').onclick = () => doDecay(v);
    $('nucSource').textContent = v.source === 'data' ? 'IAEA chart (measured)' : 'liquid-drop model (estimate)';

    const inN = $('inN');
    inN.classList.toggle('bad', v.kind === 'unbound');
    inN.classList.toggle('warn', v.kind === 'predicted');

    // Stats.
    const A = app.Z + app.N;
    const rows = [];
    const beA = rec && rec.be != null ? rec.be : nucleus.binding(app.Z, app.N) / A;
    rows.push(['Binding energy / nucleon', `${beA.toFixed(3)} MeV${rec && rec.be != null ? (rec.extrapolated ? ' <small>extrapolated</small>' : '') : ' <small>estimate</small>'}`]);
    rows.push(['N / Z', app.Z ? (app.N / app.Z).toFixed(3) : '—']);
    const R = nucleus.radius(app.Z, app.N);
    rows.push([rec && rec.radius ? 'Charge radius (rms)' : 'Radius', rec && rec.radius ? rec.radius.toFixed(3) + ' fm' : '~' + R.toFixed(2) + ' fm <small>1.2·A^⅓</small>']);
    const beta = nucleus.deformation(app.Z, app.N);
    rows.push(['Shape', beta < 0.05 ? 'near spherical' : `prolate, β₂ ≈ ${beta.toFixed(2)} <small>estimated</small>`]);
    if (rec && rec.jp) rows.push(['Spin & parity', rec.jp]);
    if (rec && rec.year) rows.push(['First observed', String(rec.year)]);
    if (app.job && app.job.shells.some(s => s.l === 0)) {
        const rb = R / (PM * 1000);                 // fm → bohr
        const inside = scf.densityAtNucleus(app.job) * (4 / 3) * Math.PI * rb * rb * rb;
        rows.push(['Electrons inside it, on average', inside.toExponential(1).replace('e', '×10^').replace(/\^([-+]?\d+)/, (m, e) => sup(+e))]);
    }
    $('nucStats').innerHTML = rows.map(([k, v2]) => `<dt>${k}</dt><dd>${v2}</dd>`).join('');
}

function renderElectrons() {
    const Z = app.Z, E = app.E, q = Z - E, el = ELEMENTS[Z];
    const job = app.job;
    let cls = 'neutral', h = '', body = '';
    if (E === 0) {
        h = 'Bare nucleus';
        body = '<p>Every electron stripped away. Bare nuclei exist in stars, plasmas and particle accelerators; there is no cloud to draw.</p>';
    } else if (q === 0) {
        h = 'Neutral atom';
        body = `<p>${Z} electron${Z > 1 ? 's' : ''} balancing ${Z} proton${Z > 1 ? 's' : ''}.</p>`;
    } else if (q > 0) {
        h = `Cation, ${q}+`;
        body = `<p>${q} electron${q > 1 ? 's' : ''} short. The rest are pulled in tighter: the same nucleus with less screening.</p>`;
    } else if (q === -1) {
        const ea = el.ea;
        if (ea != null && ea <= 0) {
            cls = 'unbound'; h = 'Anion — not bound';
            body = `<p>${el.sym}⁻ does not survive on its own: ${el.name.toLowerCase()} has no positive electron affinity, so the extra electron drifts away within nanoseconds.${app.shownE === E ? ' Drawn as the model holds it.' : ''}</p>`;
        } else {
            h = 'Anion, 1−';
            body = ea != null
                ? `<p>${el.name} holds one extra electron, bound by its electron affinity of <b>${ea} eV</b> (measured).</p>`
                : `<p>${el.name}'s electron affinity is not well measured; most elements hold one extra electron weakly.</p>`;
        }
    } else {
        cls = 'unbound'; h = `Dianion, ${-q}− — needs a crystal`;
        body = `<p>No atom holds two extra electrons by itself: every multiply charged atomic anion falls apart in the gas phase. ${el.sym}${ionLabel(Z, E)} exists only inside crystals, where the surrounding positive ions hold it together.</p>` +
            `<p class="src">Here a Watson sphere, a shell of +${-q} charge ${fmtLen(watsonRadius(Z))} out, stands in for that lattice.</p>`;
    }
    if (app.shownE !== app.requestedE && job) {
        body += `<p class="src">Even so, the model cannot bind ${app.requestedE - app.shownE === 1 ? 'the extra electron' : 'the extra electrons'} here; drawing ${el.sym}${ionLabel(Z, app.shownE)} instead.</p>`;
    }
    const dn = app.decayNote;
    if (dn && dn.shed) {
        body += `<p class="src">Fresh from the decay of ${dn.from}: the nucleus lost charge but kept its ${dn.shed} surplus electrons for a moment. No atom can hold that many extra, so they drift away and it settles neutral.</p>`;
    } else if (dn && q !== 0) {
        body += `<p class="src">Fresh from the decay of ${dn.from}: the nucleus changed but the electrons did not, so the atom is left as an ion.</p>`;
    }
    $('elVerdict').className = 'verdict ' + cls;
    $('elVerdict').innerHTML = `<h3>${h}</h3>${body}`;

    $('config').innerHTML = job ? configs.describe(job.shells, k => `<sup>${k}</sup>`) : '';
    const rows = [];
    if (job) {
        const pureLDA = app.shownE <= Z && job.interacting;
        if (app.ie != null) rows.push(['Ionisation energy', `${(app.ie * HA_EV).toFixed(2)} eV <small>${job.interacting ? 'computed' : 'exact'}</small>`]);
        else if (app.ionPending) rows.push(['Ionisation energy', '<small>computing…</small>']);
        const outer = job.shells.reduce((a, b) => (b.e > a.e ? b : a));
        rows.push(['Outermost electron', `${outer.n}${orbitals.L[outer.l]}, bound by ${(-outer.e * HA_EV).toFixed(2)} eV`]);
        rows.push(['Typical radius ⟨r⟩', fmtLen(atomRadius(job))]);
        let unpaired = 0;
        for (const sh of job.shells) for (const b of orbitals.boxes(sh)) if (b.up && !b.down) unpaired++;
        rows.push(['Unpaired electrons', unpaired ? `${unpaired} <small>paramagnetic</small>` : '0 <small>diamagnetic</small>']);
        if (pureLDA) rows.push(['Total electronic energy', `${fmtNum(+(job.Etot * HA_EV).toPrecision(6))} eV`]);
    }
    $('elStats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const p = app.pending;
    $('scfStatus').textContent = p ? `solving… iteration ${p.job.iter}` : job ? `LDA, ${job.iter || 1} iteration${job.iter === 1 ? '' : 's'}` : '';
    boxDiagram.draw(job, resolveSel());
    radialPlot.draw(job, resolveSel());
}

function renderChips() {
    const job = app.job;
    const chips = $('chips'), sub = $('subchips');
    chips.innerHTML = ''; sub.innerHTML = '';
    if (!job) return;
    const sel = resolveSel();
    const mk = (html, on, fn, cls) => {
        const b = document.createElement('button');
        b.innerHTML = html;
        if (on) b.classList.add('on');
        if (cls) b.classList.add(cls);
        b.onclick = fn;
        return b;
    };
    chips.appendChild(mk('All electrons', sel.kind === 'all', () => select({ kind: 'all' }), 'all'));
    job.shells.forEach((sh, si) => {
        const col = orbitals.css(orbitals.shellColor(sh));
        chips.appendChild(mk(`<span class="dot" style="background:${col}"></span>${sh.n}${orbitals.L[sh.l]}<sup>${sh.occ}</sup>`,
            sel.kind !== 'all' && sel.shell === si, () => select({ kind: 'shell', shell: si })));
    });
    if (sel.kind !== 'all' && job.shells[sel.shell].l > 0) {
        const sh = job.shells[sel.shell];
        for (const b of orbitals.boxes(sh)) {
            const H = orbitals.HARM[sh.l][b.m];
            sub.appendChild(mk(sh.n + H.html + (b.occ ? '' : ' ∅'), sel.kind === 'orb' && sel.m === b.m,
                () => select({ kind: 'orb', shell: sel.shell, m: b.m }), b.occ ? '' : 'empty'));
        }
    }
}

function renderLegend() {
    const lg = $('legend');
    if (!app.scene) { lg.innerHTML = ''; return; }
    const sel = resolveSel();
    const surface = app.style === 'surface';
    let html = '';
    if (sel.kind === 'orb') {
        const sh = app.job.shells[sel.shell];
        const b = orbitals.boxes(sh).find(x => x.m === sel.m);
        const pos = orbitals.css(orbitals.PHASE_POS), neg = orbitals.css(orbitals.PHASE_NEG);
        html = `<div class="lg-title">${sh.n}${orbitals.HARM[sh.l][sel.m].html} · ${b.occ ? b.occ + ' e⁻' : 'empty'}</div>` +
            `<div class="lg"><i style="background:${pos}"></i>ψ positive</div><div class="lg"><i style="background:${neg}"></i>ψ negative</div>`;
    } else {
        const items = orbitals.legend(app.scene, sel);
        html = `<div class="lg-title">${sel.kind === 'all' ? 'Subshells' : 'Orbitals'}${surface ? ' · 90% surfaces' : ''}</div>` +
            // Heavy atoms list up to 19 subshells: columns instead of a tower.
            `<div class="${items.length > 8 ? 'lg-list' : ''}">` +
            items.map(it => `<div class="lg${it.ghost ? ' ghost' : ''}"><i style="background:${it.color}"></i>${it.html}${it.ghost && items.length <= 8 ? ' (empty)' : ''}</div>`).join('') + '</div>' +
            (sel.kind === 'all' ? '<div class="lg-hint">The whole atom is round. Pick a subshell above to see its orbitals.</div>' : '');
    }
    lg.innerHTML = html;
}

function renderScaleNote() {
    const note = $('scaleNote');
    const job = app.job;
    const Rn = nucleus.radius(app.Z, app.N);        // fm
    const nucD = 2 * Rn;
    if (app.view === 'atom') {
        if (!job || !app.map) { note.innerHTML = ''; return; }
        const atomD = 2 * atomRadius(job) * PM * 1000;  // fm
        note.innerHTML = `Box <b>${fmtLen(2 * app.map.R)}</b> across${app.map.kind === 'shells' ? ' (radius compressed)' : ''}.<br>` +
            `The nucleus is <b>${nucD.toFixed(1)} fm</b> wide, 1/${fmtNum(Math.round(atomD / nucD))} of the atom: far smaller than one pixel here. <a id="toNuc">See it ▸</a>`;
        $('toNuc').onclick = () => setView('nucleus');
    } else {
        if (!job) { note.innerHTML = `<b>${nucD.toFixed(1)} fm</b> across, and no electrons around it.`; return; }
        const atomD = 2 * atomRadius(job) * PM * 1000;
        const metres = atomD * nucleusView.pxPerFm * 0.0002646;
        const far = metres >= 1000 ? (metres / 1000).toFixed(metres >= 1e4 ? 0 : 1) + ' km' : Math.round(metres) + ' m';
        note.innerHTML = `The atom around this nucleus is <b>${fmtNum(Math.round(atomD / nucD))}×</b> wider.<br>At this magnification it would be about <b>${far}</b> across. <a id="toAtom">Back to the atom ▸</a>`;
        $('toAtom').onclick = () => setView('atom');
    }
}

function renderNucLegend() {
    const A = app.Z + app.N;
    const beta = nucleus.deformation(app.Z, app.N);
    const R = nucleus.radius(app.Z, app.N);
    $('nucLegend').innerHTML = `<b>${sup(A)}${ELEMENTS[app.Z].sym} nucleus</b><br>` +
        `<span><i style="background:var(--proton)"></i>${app.Z} proton${app.Z === 1 ? '' : 's'}</span>` +
        `<span><i style="background:var(--neutron)"></i>${app.N} neutron${app.N === 1 ? '' : 's'}</span><br>` +
        `<small>radius ≈ ${R.toFixed(2)} fm · ${beta < 0.05 ? 'near spherical' : 'prolate, β₂ ≈ ' + beta.toFixed(2) + ' (estimated)'}</small>`;
}

function renderRail() {
    renderIdent();
    renderNucLegend();
    renderNucleus();
    renderElectrons();
    renderChips();
    renderLegend();
    renderScaleNote();
    chartView.draw();
}

// ---- Status line ----

function status() {
    const p = app.pending;
    if (p) return `Solving ${ELEMENTS[p.Z].sym}${ionLabel(p.Z, p.E)} · SCF iteration ${p.job.iter} · residual ${isFinite(p.job.err) ? p.job.err.toExponential(1) : '—'}`;
    if (app.bake && !app.bake.done) return `Baking the volume · ${Math.round(100 * app.bake.z / app.bake.G)}% at ${app.bake.G}³`;
    return '';
}

// ---- Loop ----

function loop(t) {
    const dt = Math.min(0.1, (t - (app.lastFrame || t)) / 1000);
    app.lastFrame = t;
    app.time += dt;
    // Only frames that did no solver or bake work say anything about the GPU.
    if (!app.wasBusy) app.frameAvg += (dt * 1000 - app.frameAvg) * 0.05;

    const wasPending = !!app.pending || !!app.ionPending;
    const busy = wasPending || (app.bake && !app.bake.done);
    pumpSolver();
    pumpBake();
    if (wasPending && !app.pending) app.railDirty = true;
    if (app.pending && Math.floor(app.time * 4) !== Math.floor((app.time - dt) * 4)) $('scfStatus').textContent = `solving… iteration ${app.pending.job.iter}`;

    const idle = !app.dragging && t - app.lastInteract > 2500;
    if (app.spin && idle) volumeView.cam.yaw += dt * 0.18;

    if (app.view === 'atom' && app.glOK) {
        // Keep the frame rate up on slow GPUs by trading resolution; a
        // display locked at 60 Hz sits at ~16.7 ms, which counts as keeping up.
        if (app.frameAvg > 30 && volumeView.renderScale > 0.5) { volumeView.renderScale = Math.max(0.5, volumeView.renderScale * 0.85); app.frameAvg = 17; }
        else if (app.frameAvg < 20 && volumeView.renderScale < 1) volumeView.renderScale = Math.min(1, volumeView.renderScale * 1.02);
        volumeView.render({ style: app.style, cut: app.cut, exposure: 2.6 });
        // The ruler must stay above the control strip, which wraps on a phone.
        const ctl = app.controlsEl || (app.controlsEl = document.querySelector('.controls.atom-only'));
        volumeView.drawOverlay({ map: app.map, ticks: app.ticks, rulerMax: ctl.offsetTop - 24,
                                 showNucleus: !!app.job && (app.style === 'cloud' || app.cut) });
    } else if (app.view === 'nucleus') {
        nucleusView.render(dt, app.time, volumeView.rotation());
    }

    app.wasBusy = busy;
    const st = status();
    if ($('status').textContent !== st) $('status').textContent = st;
    if (app.railDirty) { app.railDirty = false; renderRail(); }
    requestAnimationFrame(loop);
}

// ---- Boot ----

function bindControls() {
    const sel = $('elSelect');
    for (let z = 1; z < ELEMENTS.length; z++) {
        const o = document.createElement('option');
        o.value = String(z);
        o.textContent = `${z}  ${ELEMENTS[z].sym} — ${ELEMENTS[z].name}`;
        sel.appendChild(o);
    }
    sel.onchange = () => pickElement(+sel.value);

    for (const st of document.querySelectorAll('.stepper')) {
        const k = st.dataset.k;
        const set = k === 'Z' ? setZ : k === 'N' ? setN : setE;
        const get = () => app[k];
        for (const b of st.querySelectorAll('button[data-d]')) b.onclick = () => set(get() + +b.dataset.d);
        const inp = st.querySelector('input');
        inp.onchange = () => set(+inp.value);
    }
    $('neutralBtn').onclick = () => setE(app.Z);

    for (const b of document.querySelectorAll('#views button')) b.onclick = () => setView(b.dataset.view);
    const seg = (id, key, attr) => {
        for (const b of document.querySelectorAll(`#${id} button`)) {
            b.onclick = () => {
                app[key] = b.dataset[attr];
                for (const x of document.querySelectorAll(`#${id} button`)) x.classList.toggle('on', x === b);
                queueBake();
                app.railDirty = true;
            };
        }
    };
    seg('styleSeg', 'style', 'style');
    seg('scaleSeg', 'scale', 'scale');
    $('cutBtn').onclick = () => { app.cut = !app.cut; $('cutBtn').classList.toggle('on', app.cut); };
    const spin = () => {
        app.spin = !app.spin;
        $('spinBtn').classList.toggle('on', app.spin);
        $('spinBtn2').classList.toggle('on', app.spin);
    };
    $('spinBtn').onclick = spin;
    $('spinBtn2').onclick = spin;

    const view = $('view');
    view.addEventListener('pointerdown', e => {
        if (e.target.closest('button, a, .legend')) return;
        app.dragging = true;
        app.lastX = e.clientX; app.lastY = e.clientY;
        view.setPointerCapture(e.pointerId);
        view.classList.add('dragging');
    });
    view.addEventListener('pointermove', e => {
        if (!app.dragging) return;
        volumeView.orbit(e.clientX - app.lastX, e.clientY - app.lastY);
        app.lastX = e.clientX; app.lastY = e.clientY;
        app.lastInteract = performance.now();
    });
    const up = () => { app.dragging = false; view.classList.remove('dragging'); app.lastInteract = performance.now(); };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
    view.addEventListener('wheel', e => {
        e.preventDefault();
        const f = Math.exp(e.deltaY * 0.0012);
        if (app.view === 'atom') volumeView.zoom(f); else nucleusView.zoomBy(1 / f);
        app.lastInteract = performance.now();
    }, { passive: false });

    window.addEventListener('resize', () => { app.railDirty = true; });
}

function boot() {
    try {
        app.glOK = volumeView.init($('glCanvas'), $('overlayCanvas'));
    } catch (err) {
        console.error(err);
        app.glOK = false;
    }
    if (!app.glOK) $('noGL').hidden = false;
    nucleusView.init($('nucCanvas'));
    chartView.init($('chartCanvas'),
        (Z, N) => {
            const wasNeutral = app.E === app.Z;
            const zChanged = Z !== app.Z;
            app.Z = Z; app.N = N;
            if (wasNeutral) app.E = Z;
            app.E = Math.min(app.E, Z + 2);
            changed(zChanged);
        },
        h => {
            const el = $('chartHover');
            if (!h) { el.textContent = 'Click any square to build that nucleus.'; return; }
            const v = nucleus.verdict(h.Z, h.N);
            const what = v.kind === 'stable' ? 'stable' : v.kind === 'unbound' ? 'unbound'
                : v.kind === 'predicted' ? 'never observed' : v.hl != null ? nucleus.fmtTime(v.hl) : 'lifetime unknown';
            el.textContent = `${ELEMENTS[h.Z].sym}-${h.Z + h.N} (Z ${h.Z}, N ${h.N}) — ${what}`;
        });
    radialPlot.init($('radialCanvas'));
    boxDiagram.init($('boxDiagram'), select);
    bindControls();

    pickElement(6);
    requestAnimationFrame(loop);
}

boot();
