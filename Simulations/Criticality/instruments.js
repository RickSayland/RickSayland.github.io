// ============ CRITICALITY — INSTRUMENTS ============
// Owns `instruments`: the two strip charts, the Geiger audio, and the number
// formatting. Reads the simulation, never writes to it.

const instruments = {
    power: null, pctx: null, geiger: null, gctx: null,
    hist: [], HIST: 300,
    gHist: [], GHIST: 160,

    audio: null, gain: null, on: false, clickDebt: 0, lastClick: 0,

    init(powerCanvas, geigerCanvas) {
        this.power = powerCanvas; this.pctx = powerCanvas.getContext('2d');
        this.geiger = geigerCanvas; this.gctx = geigerCanvas.getContext('2d');
        this.resize();
    },

    resize() {
        for (const c of [this.power, this.geiger]) {
            const r = c.getBoundingClientRect();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            c.width = Math.max(1, Math.round(r.width * dpr));
            c.height = Math.max(1, Math.round(r.height * dpr));
        }
    },

    clear() { this.hist.length = 0; this.gHist.length = 0; },

    push(power, k, cps) {
        this.hist.push({ p: power, k });
        if (this.hist.length > this.HIST) this.hist.shift();
        this.gHist.push(cps);
        if (this.gHist.length > this.GHIST) this.gHist.shift();
    },

    // Power spans twenty orders of magnitude between a source-driven pile and
    // a burst, so the trace is logarithmic and the axis is labelled rather
    // than scaled — a linear plot of a burst is a vertical line with nothing
    // before it.
    drawPower() {
        const c = this.power, x = this.pctx, W = c.width, H = c.height;
        x.clearRect(0, 0, W, H);
        x.fillStyle = '#0a0f17';
        x.fillRect(0, 0, W, H);
        const LO = -6, HI = 14;            // log10 watts
        x.strokeStyle = '#141d29';
        x.lineWidth = 1;
        for (let e = LO; e <= HI; e += 5) {
            const y = H - (e - LO) / (HI - LO) * H;
            x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
        }
        if (this.hist.length > 1) {
            const n = this.hist.length, dx = W / (this.HIST - 1);
            x.strokeStyle = '#57e0c8';
            x.lineWidth = Math.max(1, W / 400);
            x.beginPath();
            for (let i = 0; i < n; i++) {
                const p = Math.max(1e-7, this.hist[i].p);
                const e = Math.max(LO, Math.min(HI, Math.log10(p)));
                const px = i * dx, py = H - (e - LO) / (HI - LO) * H;
                if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
            }
            x.stroke();
        }
        x.fillStyle = '#3d4a5c';
        x.font = `${Math.max(8, W / 34)}px ui-monospace, monospace`;
        x.fillText('1 GW', 3, H - (9 - LO) / (HI - LO) * H - 2);
        x.fillText('1 W', 3, H - (0 - LO) / (HI - LO) * H - 2);
        x.fillText('power', W - W / 6, 10);
    },

    // The count rate, drawn as a bar per sample. A Geiger trace is not a
    // smooth curve — the raggedness is the measurement.
    drawGeiger() {
        const c = this.geiger, x = this.gctx, W = c.width, H = c.height;
        x.clearRect(0, 0, W, H);
        x.fillStyle = '#0a0f17';
        x.fillRect(0, 0, W, H);
        const n = this.gHist.length;
        if (!n) return;
        const dx = W / this.GHIST;
        x.fillStyle = '#7fe8d4';
        for (let i = 0; i < n; i++) {
            const v = Math.max(0.1, this.gHist[i]);
            const h = Math.min(1, Math.log10(v + 1) / 5) * H;
            x.fillRect(i * dx, H - h, Math.max(1, dx * 0.8), h);
        }
    },

    // ---- Geiger audio ----
    // A short filtered pulse per count, rate limited. Muted until the user
    // asks for it, because a page that starts clicking on load is a page
    // people close.
    toggleSound() {
        if (!this.audio) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            this.audio = new AC();
            this.gain = this.audio.createGain();
            this.gain.gain.value = 0.16;
            this.gain.connect(this.audio.destination);
        }
        this.on = !this.on;
        if (this.on && this.audio.state === 'suspended') this.audio.resume();
        return this.on;
    },

    tick(cps, wallDt) {
        if (!this.on || !this.audio) return;
        // At a few hundred counts a second the ear hears a hiss, not clicks,
        // so the rate saturates the same way a real tube's dead time does.
        const heard = Math.min(60, cps);
        this.clickDebt += heard * wallDt;
        let fired = 0;
        while (this.clickDebt >= 1 && fired < 6) {
            this.clickDebt -= 1;
            this.click();
            fired++;
        }
        if (this.clickDebt > 4) this.clickDebt = 4;
    },

    click() {
        const a = this.audio, t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'square';
        o.frequency.value = 1400 + Math.random() * 900;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.9, t + 0.0012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
        o.connect(g); g.connect(this.gain);
        o.start(t); o.stop(t + 0.02);
    },

    // ---- formatting ----

    si(v, unit, dp) {
        if (!isFinite(v)) return '—';
        const a = Math.abs(v);
        if (a === 0) return '0 ' + unit;
        const pre = [
            [1e24, 'Y'], [1e21, 'Z'], [1e18, 'E'], [1e15, 'P'], [1e12, 'T'],
            [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'],
            [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']
        ];
        for (const [s, p] of pre) {
            if (a >= s) {
                const x = v / s;
                return x.toFixed(dp === undefined ? (Math.abs(x) < 10 ? 1 : 0) : dp) + ' ' + p + unit;
            }
        }
        return v.toExponential(1) + ' ' + unit;
    },

    time(s) {
        const a = Math.abs(s);
        if (a < 1e-6) return (s * 1e9).toFixed(a < 1e-8 ? 2 : 0) + ' ns';
        if (a < 1e-3) return (s * 1e6).toFixed(a < 1e-5 ? 2 : 0) + ' µs';
        if (a < 1) return (s * 1e3).toFixed(a < 1e-2 ? 2 : 0) + ' ms';
        if (a < 90) return s.toFixed(a < 10 ? 2 : 1) + ' s';
        if (a < 5400) return (s / 60).toFixed(1) + ' min';
        if (a < 172800) return (s / 3600).toFixed(1) + ' h';
        if (a < 3.15e7) return (s / 86400).toFixed(1) + ' d';
        return (s / 3.156e7).toFixed(1) + ' y';
    },

    sv(v) {
        // Sieverts, and the range that matters runs from a background of
        // nanosieverts an hour to tens of sieverts in a second.
        return this.si(v, 'Sv');
    }
};
