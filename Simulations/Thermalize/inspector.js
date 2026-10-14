// ============ THERMALIZE — INSTRUMENTS ============
// The right rail: the followed neutron's card, the cross-section curve with
// the neutron's own energy marked on it, the slowing-down staircase, the
// census of what is in flight, and the tallies. Reads the simulation, never
// writes to it. Owns `inspector`.
//
// Text is repainted at 12 Hz, not 60. Nobody can read a counter faster than
// that, and setText is a no-op when the string has not changed.

const inspector = {

    acc: 1,
    selMat: 0,              // the palette's material, shown when nothing is followed
    el: {},
    _sig: { tot: 0, cap: 0, fis: 0 },
    _fate: '',
    _by: '',
    SUP: '⁰¹²³⁴⁵⁶⁷⁸⁹',

    init() {
        for (const id of ['nEnergy', 'nSpeed', 'nState', 'nCol', 'nPath', 'nAtoms', 'nFate',
            'xsMat', 'xsChart', 'xsMfp', 'xsAbs', 'stairChart', 'specChart', 'nAlive',
            'tFired', 'tBorn', 'tFis', 'tAbs', 'tLeak', 'byMat']) {
            this.el[id] = document.getElementById(id);
        }
    },

    setText(id, v) {
        const e = this.el[id];
        if (e.textContent !== v) e.textContent = v;
    },

    // Size a canvas to its box at device resolution and hand back a context
    // working in CSS pixels.
    prep(c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
            c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        }
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return { ctx, w, h };
    },

    sci(v) {
        if (v < 1000) return String(Math.round(v));
        const e = Math.floor(Math.log10(v)), m = v / Math.pow(10, e);
        let s = '';
        for (const ch of String(e)) s += this.SUP[+ch];
        return m.toFixed(1) + '×10' + s;
    },

    update(dt) {
        this.acc += dt;
        if (this.acc < 0.08) return;
        this.acc = 0;

        const f = neutrons.f, i = neutrons.fIdx, following = neutrons.follow !== 0;
        const E = i >= 0 ? neutrons.E[i] : f.E;

        // ---- the followed neutron ----
        if (!following) {
            this.setText('nEnergy', '—');
            this.setText('nSpeed', 'no neutron followed');
            this.state('IDLE', '');
            this.setText('nCol', '—'); this.setText('nPath', '—'); this.setText('nAtoms', '—');
            this.fate('Fire a neutron to follow it.', '');
        } else {
            this.setText('nEnergy', nuc.fmtE(E));
            const pc = nuc.kms(E) / 2997.92;
            this.setText('nSpeed', 'true speed ' + nuc.fmtKms(E) + (pc >= 0.1 ? ' · ' + pc.toFixed(1) + '% of light' : ''));
            this.setText('nCol', String(f.col));
            this.setText('nPath', nuc.fmtLen(f.path));
            this.setText('nAtoms', f.atoms > 0 ? this.sci(f.atoms) : '0');
            if (f.alive) {
                if (E > 1e5) this.state('FAST', 'fast');
                else if (E > 0.5) this.state('SLOWING DOWN', 'slowing');
                else this.state('THERMAL', 'thermal');
                const gen = f.gen ? 'Generation ' + (f.gen + 1) + ' of a chain. ' : '';
                const what = E > 1e5 ? 'Too fast for most nuclei to catch.'
                    : E > 0.5 ? 'Losing energy with every collision; its targets are growing.'
                    : 'As slow as the material around it. Absorbers are at their largest.';
                this.fate(gen + what, f.rx);
            } else {
                this.state(f.fate.indexOf('Left') === 0 ? 'OFF THE BENCH' : 'ABSORBED', f.fate.indexOf('Left') === 0 ? 'out' : 'gone');
                this.fate(f.fate + ' after ' + f.col + ' collision' + (f.col === 1 ? '' : 's') + ', at ' + nuc.fmtE(f.E) + '.', f.rx);
            }
        }

        // ---- which material the curve is for ----
        let m = 0;
        if (i >= 0) m = grid.get(neutrons.x[i], neutrons.y[i]) || f.mat;
        else if (following) m = f.mat;
        if (!m) m = this.selMat;
        const Ev = bench.viewE;
        if (m) {
            const M = materials.list[m];
            this.setText('xsMat', M.name + ' · ' + M.formula);
            materials.sigma(M, nuc.group(Ev), this._sig);
            this.setText('xsMfp', nuc.fmtLen(1 / this._sig.tot) + ' at ' + nuc.fmtE(Ev));
            const a = (this._sig.cap + this._sig.fis) / this._sig.tot;
            this.setText('xsAbs', a < 0.001 ? '<0.1%' : a > 0.999 ? '>99.9%' : (a * 100).toFixed(a < 0.1 ? 1 : 0) + '%');
        } else {
            this.setText('xsMat', '—'); this.setText('xsMfp', '—'); this.setText('xsAbs', '—');
        }
        this.drawXs(m, Ev);
        this.drawStair();
        this.drawSpec();

        // ---- tallies ----
        const t = neutrons.tally;
        this.setText('nAlive', String(neutrons.n));
        this.setText('tFired', t.fired.toLocaleString('en-US'));
        this.setText('tBorn', t.born.toLocaleString('en-US'));
        this.setText('tFis', t.fissions.toLocaleString('en-US'));
        this.setText('tAbs', t.absorbed.toLocaleString('en-US'));
        this.setText('tLeak', t.leaked.toLocaleString('en-US'));
        const top = [];
        for (let k = 1; k < t.byMat.length; k++) if (t.byMat[k] > 0) top.push([t.byMat[k], materials.list[k].name]);
        top.sort((a, b) => b[0] - a[0]);
        let html = '';
        for (const [n, name] of top.slice(0, 4)) {
            html += '<div class="row sub"><span>stopped in ' + name.toLowerCase() + '</span><b>' + n.toLocaleString('en-US') + '</b></div>';
        }
        if (html !== this._by) { this._by = html; this.el.byMat.innerHTML = html; }
    },

    state(text, cls) {
        const e = this.el.nState;
        if (e.textContent !== text) e.textContent = text;
        const want = 'state' + (cls ? ' ' + cls : '');
        if (e.className !== want) e.className = want;
    },

    fate(text, rx) {
        const key = text + '|' + rx;
        if (key === this._fate) return;
        this._fate = key;
        const e = this.el.nFate;
        e.textContent = text;
        if (rx) { const b = document.createElement('b'); b.textContent = rx; e.appendChild(b); }
    },

    // ---- sigma(E), log-log, with the neutron's energy marked ----
    //
    // Per formula unit, in barns: what one drawn cell's worth of nuclei
    // presents. The marker is the view energy, so it walks left along the
    // curve as the followed neutron loses energy, and climbs it.
    drawXs(m, Ev) {
        const { ctx, w, h } = this.prep(this.el.xsChart);
        const L = 30, R = 6, T = 7, B = 16;
        const lx0 = -3, lx1 = 7.3;
        const X = le => L + (le - lx0) / (lx1 - lx0) * (w - L - R);
        ctx.font = '9.5px ui-monospace, Consolas, monospace';
        if (!m) {
            ctx.fillStyle = '#4f5f73'; ctx.textAlign = 'center';
            ctx.fillText('pick a material', w / 2, h / 2);
            return;
        }
        const M = materials.list[m];
        const g0 = nuc.group(Math.pow(10, lx0)), n = Math.floor((nuc.NG - g0) / 2);
        const sc = new Float32Array(n), ab = new Float32Array(n), fi = new Float32Array(n);
        let max = 0, anyF = false;
        for (let k = 0; k < n; k++) {
            const g = g0 + k * 2;
            for (let s = 0; s < M.ns; s++) {
                const i = M.slotSp[s], mu = M.mult[s];
                sc[k] += mu * (nuc.el[i][g] + nuc.inel[i][g] + nuc.n2n[i][g]);
                ab[k] += mu * nuc.cap[i][g];
                fi[k] += mu * nuc.fis[i][g];
            }
            if (sc[k] > max) max = sc[k];
            if (ab[k] > max) max = ab[k];
            if (fi[k] > max) max = fi[k];
            if (fi[k] > 1e-6) anyF = true;
        }
        const top = Math.ceil(Math.log10(max) + 0.05), bot = top - 7;
        const Y = v => { const lv = v > 0 ? Math.log10(v) : bot; return T + (top - (lv < bot ? bot : lv)) / (top - bot) * (h - T - B); };

        ctx.lineWidth = 1; ctx.strokeStyle = '#131c28'; ctx.fillStyle = '#4f5f73';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let d = top; d >= bot; d--) {
            const y = Math.round(Y(Math.pow(10, d))) + 0.5;
            ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
            if ((top - d) % 2 === 0) {
                const v = Math.pow(10, d);
                ctx.fillText(v >= 1e6 ? v / 1e6 + 'M' : v >= 1e3 ? v / 1e3 + 'k' : v >= 1 ? String(v) : v.toPrecision(1), L - 4, y);
            }
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        for (const [le, lab] of [[-3, 'meV'], [0, '1 eV'], [3, '1 keV'], [6, '1 MeV']]) {
            const x = Math.round(X(le)) + 0.5;
            ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke();
            ctx.fillText(lab, Math.max(L + 12, x), h - 4);
        }
        // Thermal, so "how far has it got to go" is on the picture.
        ctx.strokeStyle = 'rgba(255,176,64,0.35)'; ctx.setLineDash([2, 3]);
        const xt = X(Math.log10(nuc.E_TH));
        ctx.beginPath(); ctx.moveTo(xt, T); ctx.lineTo(xt, h - B); ctx.stroke();
        ctx.setLineDash([]);

        const line = (arr, col) => {
            ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath();
            for (let k = 0; k < n; k++) {
                const x = X(nuc.LOG_MIN + (g0 + k * 2 + 0.5) / nuc.PER_DEC), y = Y(arr[k]);
                if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        };
        line(sc, '#378add');
        line(ab, '#e24b4a');
        if (anyF) line(fi, '#ffd65a');

        const le = Math.log10(Ev), xm = X(Math.max(lx0, Math.min(lx1, le)));
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xm, T); ctx.lineTo(xm, h - B); ctx.stroke();
        const k = Math.max(0, Math.min(n - 1, Math.round((nuc.group(Ev) - g0) / 2)));
        const dot = (v, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(xm, Y(v), 3, 0, 6.2831853); ctx.fill(); };
        dot(sc[k], '#378add'); dot(ab[k], '#e24b4a');
        if (anyF) dot(fi[k], '#ffd65a');
        ctx.fillStyle = bench.ecol(Ev);
        ctx.beginPath(); ctx.moveTo(xm - 4, T - 6); ctx.lineTo(xm + 4, T - 6); ctx.lineTo(xm, T + 1); ctx.closePath(); ctx.fill();
    },

    // ---- energy after every collision ----
    drawStair() {
        const { ctx, w, h } = this.prep(this.el.stairChart);
        const L = 44, R = 8, T = 8, B = 16;
        const hist = neutrons.hist, kind = neutrons.histK;
        const top = 7.2, bot = -2.4;
        const Y = E => T + (top - Math.max(bot, Math.min(top, Math.log10(E)))) / (top - bot) * (h - T - B);
        ctx.font = '9.5px ui-monospace, Consolas, monospace';
        ctx.lineWidth = 1; ctx.strokeStyle = '#131c28'; ctx.fillStyle = '#4f5f73';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (const [E, lab] of [[1e6, '1 MeV'], [1e3, '1 keV'], [1, '1 eV'], [nuc.E_TH, 'thermal']]) {
            const y = Math.round(Y(E)) + 0.5;
            ctx.strokeStyle = E === nuc.E_TH ? 'rgba(255,176,64,0.3)' : '#131c28';
            ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
            ctx.fillText(lab, L - 5, y);
        }
        const N = Math.max(30, hist.length - 1), dx = (w - L - R) / N;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(N + ' collisions', w - R, h - 4);
        ctx.textAlign = 'left'; ctx.fillText('0', L, h - 4);
        ctx.lineWidth = 1.5;
        for (let i = 1; i < hist.length; i++) {
            const x0 = L + (i - 1) * dx, x1 = L + i * dx, y0 = Y(hist[i - 1]), y1 = Y(hist[i]);
            ctx.strokeStyle = bench.ecol(hist[i - 1]);
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
            if (kind[i] === 1) {
                // Reborn from a fission: straight back up to MeV.
                ctx.strokeStyle = '#ffd65a'; ctx.setLineDash([2, 2]);
                ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke();
                ctx.setLineDash([]);
            } else {
                ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke();
            }
        }
        if (hist.length) {
            const i = hist.length - 1;
            ctx.fillStyle = bench.ecol(hist[i]);
            ctx.beginPath(); ctx.arc(L + i * dx, Y(hist[i]), 2.6, 0, 6.2831853); ctx.fill();
        }
    },

    // ---- everything in flight, by energy ----
    drawSpec() {
        const { ctx, w, h } = this.prep(this.el.specChart);
        const L = 6, R = 6, T = 6, B = 14, NB = 40;
        const bins = new Float32Array(NB);
        let max = 0;
        for (let i = 0; i < neutrons.n; i++) {
            let b = Math.floor((Math.log10(neutrons.E[i]) + 3) * 4);
            b = b < 0 ? 0 : b >= NB ? NB - 1 : b;
            if (++bins[b] > max) max = bins[b];
        }
        const bw = (w - L - R) / NB;
        ctx.font = '9.5px ui-monospace, Consolas, monospace';
        ctx.fillStyle = '#4f5f73'; ctx.textAlign = 'center';
        for (const [le, lab] of [[-1.6, 'thermal'], [0, '1 eV'], [3, '1 keV'], [6, '1 MeV']]) {
            ctx.fillText(lab, L + (le + 3) * 4 * bw, h - 3);
        }
        ctx.fillStyle = '#131c28';
        ctx.fillRect(L, h - B, w - L - R, 1);
        if (max === 0) return;
        for (let b = 0; b < NB; b++) {
            if (!bins[b]) continue;
            const bh = Math.max(2, bins[b] / max * (h - T - B));
            ctx.fillStyle = bench.ecol(Math.pow(10, (b + 0.5) / 4 - 3));
            ctx.fillRect(L + b * bw + 0.5, h - B - bh, Math.max(1, bw - 1), bh);
        }
    }
};
