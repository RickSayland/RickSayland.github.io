// ============ ATOM VIEWER — RAIL WIDGETS ============
// Owns `chartView` (the chart of nuclides), `radialPlot` (where the electrons
// are, shell by shell) and `boxDiagram` (the configuration as boxes and
// arrows). Each reads state handed to it and reports clicks through a
// callback; none of them owns any.

const DECAY_COLORS = {
    stable: '#e6ebf2', 'B-': '#3f82e8', 'B+': '#e5527d', EC: '#e5527d', 'EC+B+': '#e5527d', '2EC': '#e5527d', '2B+': '#e5527d',
    ECP: '#e5527d', 'B+P': '#e5527d', ECSF: '#e5527d', A: '#e9c43b', SF: '#3fc07a', P: '#f08c3c', '2P': '#f08c3c',
    N: '#9b6dff', '2N': '#9b6dff', 'B-N': '#3f82e8', 'B-2N': '#3f82e8', 'B-A': '#3f82e8', '2B-': '#3f82e8', IT: '#8b95a5',
    unbound: '#3b2f4d', unknown: '#4a5566',
};

function nuclideColor(rec) {
    if (rec.stable) return DECAY_COLORS.stable;
    const mode = nucleus.primaryMode(rec);
    if ((rec.hl != null && rec.hl < 1e-12) || (rec.hl == null && mode && 'N 2N P 2P'.includes(mode))) return DECAY_COLORS.unbound;
    if (!mode) return DECAY_COLORS.unknown;
    return DECAY_COLORS[mode] || DECAY_COLORS.unknown;
}

// ---- Chart of nuclides ----
const chartView = (() => {
    let canvas, ctx, onPick, onHover;
    let cur = { Z: 1, N: 0 };
    let view = null;               // last layout, for hit-testing
    let overview = null;
    const COLS = 27, ROWS = 17;
    const MAX_N = 180, MAX_Z = 118;

    function buildOverview() {
        overview = document.createElement('canvas');
        overview.width = MAX_N + 1; overview.height = MAX_Z + 1;
        const g = overview.getContext('2d');
        g.fillStyle = '#0b1019';
        g.fillRect(0, 0, overview.width, overview.height);
        for (const rec of nucleus.table.values()) {
            if (rec.Z < 1 || rec.N > MAX_N) continue;
            g.fillStyle = nuclideColor(rec);
            g.fillRect(rec.N, MAX_Z - rec.Z, 1, 1);
        }
    }

    function init(c, pick, hover) {
        canvas = c; ctx = c.getContext('2d'); onPick = pick; onHover = hover;
        buildOverview();
        canvas.addEventListener('click', e => {
            const hit = hitTest(e);
            if (hit) onPick(hit.Z, hit.N);
        });
        canvas.addEventListener('mousemove', e => { const h = hitTest(e); onHover(h); canvas.style.cursor = h ? 'pointer' : 'default'; });
        canvas.addEventListener('mouseleave', () => onHover(null));
    }

    function hitTest(e) {
        if (!view) return null;
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
        const o = view.ov;
        if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) {
            const N = Math.round((x - o.x) / o.w * MAX_N);
            const Z = Math.round(MAX_Z - (y - o.y) / o.h * MAX_Z);
            // Snap to the nearest observed isotope of that element.
            const list = nucleus.observed(Math.max(1, Z));
            if (!list.length) return null;
            let best = list[0];
            for (const n of list) if (Math.abs(n - N) < Math.abs(best - N)) best = n;
            return { Z: Math.max(1, Z), N: best, overview: true };
        }
        const col = Math.floor((x - view.x0) / view.cell), row = Math.floor((y - view.y0) / view.cell);
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
        const N = view.n0 + col, Z = view.z0 + (ROWS - 1 - row);
        if (Z < 1 || Z > MAX_Z || N < 0) return null;
        return { Z, N };
    }

    function setCurrent(Z, N) { cur = { Z, N }; }

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        ctx.clearRect(0, 0, W, H);
        const padL = 26 * dpr, padB = 16 * dpr;
        const cell = Math.floor(Math.min((W - padL) / COLS, (H - padB) / ROWS));
        const x0 = padL, y0 = 0;
        const n0 = Math.max(0, cur.N - (COLS >> 1));
        const z0 = Math.max(1, Math.min(MAX_Z - ROWS + 1, cur.Z - (ROWS >> 1)));
        view = { x0, y0, cell, n0, z0 };

        // Magic numbers as guide lines.
        ctx.fillStyle = 'rgba(95,212,255,0.06)';
        for (const m of nucleus.MAGIC) {
            if (m >= n0 && m < n0 + COLS) ctx.fillRect(x0 + (m - n0) * cell, y0, cell, ROWS * cell);
            if (m >= z0 && m < z0 + ROWS) ctx.fillRect(x0, y0 + (ROWS - 1 - (m - z0)) * cell, COLS * cell, cell);
        }

        for (let row = 0; row < ROWS; row++) {
            const Z = z0 + (ROWS - 1 - row);
            for (let col = 0; col < COLS; col++) {
                const N = n0 + col;
                const rec = nucleus.lookup(Z, N);
                const x = x0 + col * cell, y = y0 + row * cell;
                if (rec) {
                    ctx.fillStyle = nuclideColor(rec);
                    ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
                }
            }
        }

        // The current nuclide, observed or not.
        const cx = x0 + (cur.N - n0) * cell, cy = y0 + (ROWS - 1 - (cur.Z - z0)) * cell;
        if (cur.N >= n0 && cur.N < n0 + COLS) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * dpr;
            ctx.strokeRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1);
            if (!nucleus.lookup(cur.Z, cur.N)) {
                ctx.setLineDash([2 * dpr, 2 * dpr]);
                ctx.strokeStyle = '#ff6b6b';
                ctx.strokeRect(cx + 3 * dpr, cy + 3 * dpr, cell - 6 * dpr, cell - 6 * dpr);
                ctx.setLineDash([]);
            }
        }

        // Axes: element symbols up the side, N along the bottom.
        ctx.fillStyle = '#6d7f98';
        ctx.font = `${9 * dpr}px "Share Tech Mono", monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let row = 0; row < ROWS; row++) {
            const Z = z0 + (ROWS - 1 - row);
            if (Z > MAX_Z) continue;
            ctx.fillStyle = Z === cur.Z ? '#dbe6f5' : '#6d7f98';
            ctx.fillText(ELEMENTS[Z].sym, x0 - 4 * dpr, y0 + row * cell + cell / 2);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let col = 0; col < COLS; col++) {
            const N = n0 + col;
            if (N % 5 && N !== cur.N) continue;
            ctx.fillStyle = N === cur.N ? '#dbe6f5' : '#6d7f98';
            ctx.fillText(String(N), x0 + col * cell + cell / 2, y0 + ROWS * cell + 3 * dpr);
        }

        // Whole chart, bottom-right, with the window marked.
        const ow = Math.round(W * 0.3), oh = Math.round(ow * (MAX_Z + 1) / (MAX_N + 1));
        const ox = W - ow - 2 * dpr, oy = ROWS * cell - oh - 2 * dpr;
        ctx.fillStyle = 'rgba(6,9,15,0.9)';
        ctx.fillRect(ox - 3 * dpr, oy - 3 * dpr, ow + 6 * dpr, oh + 6 * dpr);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(overview, ox, oy, ow, oh);
        ctx.imageSmoothingEnabled = true;
        const fx = ow / (MAX_N + 1), fy = oh / (MAX_Z + 1);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = dpr;
        ctx.strokeRect(ox + n0 * fx, oy + (MAX_Z - (z0 + ROWS - 1)) * fy, COLS * fx, ROWS * fy);
        view.ov = { x: ox, y: oy, w: ow, h: oh };
    }

    return { init, draw, setCurrent };
})();

// ---- Radial distribution ----
const radialPlot = (() => {
    let canvas, ctx;
    const PM = 52.917721;        // pm per bohr

    function init(c) { canvas = c; ctx = c.getContext('2d'); }

    // job: solver result; sel: current selection.
    function draw(job, sel) {
        const dpr = window.devicePixelRatio || 1;
        const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        ctx.clearRect(0, 0, W, H);
        if (!job || !job.shells.length) {
            ctx.fillStyle = '#5d6e85';
            ctx.font = `${11 * dpr}px "Segoe UI", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('no electrons', W / 2, H / 2);
            return;
        }
        const g = job.grid;
        const padL = 8 * dpr, padB = 16 * dpr, padT = 6 * dpr;
        const inner = job.shells.reduce((m, s) => Math.min(m, scf.meanRadius(job, s)), Infinity);
        const outer = job.shells.reduce((m, s) => Math.max(m, orbitals.enclosing(job, s, 0.995)), 0);
        const lx0 = Math.log10(inner * 0.12), lx1 = Math.log10(outer * 1.3);
        const X = r => padL + (Math.log10(r) - lx0) / (lx1 - lx0) * (W - 2 * padL);
        // Probability per ln r: r·(r²R²)·occ = r·u²·occ.
        const curves = job.shells.map(sh => {
            const pts = [];
            let peak = 0;
            for (let i = 0; i < g.M; i += 2) {
                const r = g.r[i];
                if (r < inner * 0.12 || r > outer * 1.3) continue;
                const v = sh.occ * g.r2[i] * sh.y[i] * sh.y[i];
                pts.push([r, v]);
                if (v > peak) peak = v;
            }
            return { sh, pts, peak };
        });
        const total = [];
        for (let i = 0; i < g.M; i += 2) {
            const r = g.r[i];
            if (r < inner * 0.12 || r > outer * 1.3) continue;
            let v = 0;
            for (const sh of job.shells) v += sh.occ * g.r2[i] * sh.y[i] * sh.y[i];
            total.push([r, v]);
        }
        const top = Math.max(...total.map(p => p[1])) || 1;
        const Y = v => H - padB - v / top * (H - padB - padT);

        const selShell = sel.kind === 'all' ? -1 : sel.shell;
        curves.forEach((c, si) => {
            const col = orbitals.shellColor(c.sh);
            const on = selShell === -1 || selShell === si;
            ctx.beginPath();
            ctx.moveTo(X(c.pts[0][0]), Y(0));
            for (const [r, v] of c.pts) ctx.lineTo(X(r), Y(v));
            ctx.lineTo(X(c.pts[c.pts.length - 1][0]), Y(0));
            ctx.closePath();
            ctx.fillStyle = `rgba(${col.map(v => Math.round(v * 255)).join(',')},${on ? 0.28 : 0.07})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${col.map(v => Math.round(v * 255)).join(',')},${on ? 0.95 : 0.25})`;
            ctx.lineWidth = (selShell === si ? 2 : 1) * dpr;
            ctx.stroke();
        });
        ctx.beginPath();
        total.forEach(([r, v], i) => (i ? ctx.lineTo(X(r), Y(v)) : ctx.moveTo(X(r), Y(v))));
        ctx.strokeStyle = 'rgba(235,240,248,0.7)';
        ctx.lineWidth = dpr;
        ctx.stroke();

        // Decade ticks in pm.
        ctx.fillStyle = '#6d7f98';
        ctx.strokeStyle = 'rgba(109,127,152,0.35)';
        ctx.font = `${9 * dpr}px "Share Tech Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let e = -3; e <= 4; e++) {
            for (const m of [1, 2, 5]) {
                const pm = m * 10 ** e, r = pm / PM;
                const x = X(r);
                if (x < padL || x > W - padL) continue;
                ctx.beginPath(); ctx.moveTo(x, H - padB); ctx.lineTo(x, H - padB + (m === 1 ? 4 : 2) * dpr); ctx.stroke();
                if (m === 1) ctx.fillText(pm >= 1 ? pm + ' pm' : pm + '', x, H - padB + 4 * dpr);
            }
        }
        ctx.beginPath(); ctx.moveTo(padL, H - padB); ctx.lineTo(W - padL, H - padB); ctx.stroke();
    }

    return { init, draw, PM };
})();

// ---- Box diagram ----
const boxDiagram = (() => {
    let root, onSelect;

    function init(el, select) { root = el; onSelect = select; }

    function fmtE(eV) {
        const a = Math.abs(eV);
        if (a >= 1000) return (eV / 1000).toFixed(a >= 1e4 ? 1 : 2) + ' keV';
        return eV.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2) + ' eV';
    }
    function fmtR(pm) { return pm >= 10 ? Math.round(pm) + ' pm' : pm.toFixed(pm >= 1 ? 1 : 2) + ' pm'; }

    function draw(job, sel) {
        root.innerHTML = '';
        if (!job || !job.shells.length) {
            root.innerHTML = '<div class="empty">No electrons — a bare nucleus.</div>';
            return;
        }
        const order = job.shells.map((sh, i) => i).sort((a, b) => job.shells[b].e - job.shells[a].e);
        for (const si of order) {
            const sh = job.shells[si];
            const row = document.createElement('div');
            row.className = 'box-row' + (sel.kind !== 'all' && sel.shell === si ? ' on' : '');
            const col = orbitals.css(orbitals.shellColor(sh));
            const lab = document.createElement('button');
            lab.className = 'box-label';
            lab.innerHTML = `<span class="dot" style="background:${col}"></span>${sh.n}${orbitals.L[sh.l]}<sup>${sh.occ}</sup>`;
            lab.title = 'Show the whole ' + sh.n + orbitals.L[sh.l] + ' subshell';
            lab.onclick = () => onSelect({ kind: 'shell', shell: si });
            row.appendChild(lab);
            const bx = document.createElement('div');
            bx.className = 'boxes';
            for (const b of orbitals.boxes(sh)) {
                const cell = document.createElement('button');
                const on = sel.kind === 'orb' && sel.shell === si && sel.m === b.m;
                cell.className = 'box' + (on ? ' on' : '');
                cell.innerHTML = (b.up ? '<i>↑</i>' : '<i class="no">↑</i>') + (b.down ? '<i>↓</i>' : '<i class="no">↓</i>');
                cell.title = sh.n + orbitals.HARM[sh.l][b.m].name + ' — ' + (b.occ ? b.occ + ' electron' + (b.occ > 1 ? 's' : '') : 'empty');
                cell.onclick = () => onSelect({ kind: 'orb', shell: si, m: b.m });
                bx.appendChild(cell);
            }
            row.appendChild(bx);
            const nums = document.createElement('div');
            nums.className = 'box-nums';
            nums.innerHTML = `<b>${fmtE(sh.e * scf.HA_EV)}</b><span>${fmtR(scf.meanRadius(job, sh) * radialPlot.PM)}</span>`;
            row.appendChild(nums);
            root.appendChild(row);
        }
    }

    return { init, draw, fmtE, fmtR };
})();
