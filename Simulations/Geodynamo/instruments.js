// ============ GEODYNAMO — THE INSTRUMENTS ============
// Two readouts, both of which exist in the real world, which is the point of
// drawing them rather than a generic line chart:
//
//   THE RECORD is what a marine magnetic survey produces — dipole strength
//   through time above a barcode of polarity chrons. The stripes on the ocean
//   floor either side of a spreading ridge are this exact figure, printed into
//   basalt as it cools.
//
//   THE DIP CIRCLE is the instrument that measures inclination: a magnetised
//   needle free to swing in the vertical plane. It is the oldest way to find
//   your latitude magnetically, and it is what stops working during a reversal.

const instruments = {
    CAP: 900,                 // samples held in the record
    KYR_PER_SAMPLE: 1.2,

    t: null, m: null, pol: null, n: 0, head: 0,
    lastSample: -1e9,

    init(recordCanvas, dipCanvas) {
        this.rec = recordCanvas;
        this.recCtx = recordCanvas.getContext('2d');
        this.dip = dipCanvas;
        this.dipCtx = dipCanvas.getContext('2d');

        this.t = new Float64Array(this.CAP);
        this.m = new Float32Array(this.CAP);
        this.pol = new Int8Array(this.CAP);
        this.resize();
    },

    resize() {
        for (const [c, ctx] of [[this.rec, this.recCtx], [this.dip, this.dipCtx]]) {
            const rect = c.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.max(120, Math.round(rect.width));
            const h = Math.max(60, Math.round(rect.height));
            c.width = Math.round(w * dpr);
            c.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (c === this.rec) { this.rw = w; this.rh = h; } else { this.dw = w; this.dh = h; }
        }
    },

    clear() { this.n = 0; this.head = 0; this.lastSample = -1e9; },

    // Sampled on MODEL time, not on frames, so the record reads the same whether
    // it was watched at one speed or another.
    push(tKyr, moment, polarity) {
        if (tKyr - this.lastSample < this.KYR_PER_SAMPLE) return;
        this.lastSample = tKyr;
        this.t[this.head] = tKyr;
        this.m[this.head] = moment;
        this.pol[this.head] = polarity;
        this.head = (this.head + 1) % this.CAP;
        if (this.n < this.CAP) this.n++;
    },

    at(k) { return (this.head - this.n + k + this.CAP * 2) % this.CAP; },

    // ---- The record ----

    drawRecord() {
        const ctx = this.recCtx, w = this.rw, h = this.rh;
        const barH = 20, gap = 6, footer = 13;
        const chartH = h - barH - gap - footer;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0a0d16';
        ctx.fillRect(0, 0, w, chartH);

        if (this.n < 2) {
            ctx.fillStyle = '#3d4a5e';
            ctx.font = '10px ui-monospace, Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('recording…', w / 2, chartH / 2);
            return;
        }

        let mx = 4;
        for (let k = 0; k < this.n; k++) mx = Math.max(mx, Math.abs(this.m[this.at(k)]));
        mx *= 1.12;
        const mid = chartH / 2;
        const sy = v => mid - v / mx * (mid - 3);
        // Always spans the full width. The record stretches as it accumulates
        // and then scrolls once it is at capacity, rather than sitting as a
        // sliver against the left edge for the first minute of the run.
        const sx = k => k / Math.max(1, this.n - 1) * w;

        // Zero line, and a marker at Earth's present dipole moment so the trace
        // has something real to be compared against.
        ctx.strokeStyle = 'rgba(120, 145, 175, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(150, 180, 210, 0.22)';
        ctx.beginPath(); ctx.moveTo(0, sy(7.9)); ctx.lineTo(w, sy(7.9)); ctx.stroke();
        ctx.setLineDash([]);

        // Filled to the zero line, split by sign, so a reversal is the block of
        // colour crossing over rather than a line that happens to dip.
        for (const sign of [1, -1]) {
            ctx.beginPath();
            ctx.moveTo(sx(0), mid);
            for (let k = 0; k < this.n; k++) {
                const v = this.m[this.at(k)];
                ctx.lineTo(sx(k), sy(sign > 0 ? Math.max(0, v) : Math.min(0, v)));
            }
            ctx.lineTo(sx(this.n - 1), mid);
            ctx.closePath();
            ctx.fillStyle = sign > 0 ? 'rgba(255, 186, 92, 0.30)' : 'rgba(96, 190, 255, 0.30)';
            ctx.fill();
        }

        ctx.beginPath();
        for (let k = 0; k < this.n; k++) {
            const x = sx(k), y = sy(this.m[this.at(k)]);
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(226, 236, 248, 0.8)';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.font = '9px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(150, 175, 205, 0.55)';
        ctx.fillText(mx.toFixed(0), 3, 9);
        ctx.fillText('-' + mx.toFixed(0), 3, chartH - 3);
        ctx.textAlign = 'right';
        ctx.fillText('10²² A m²', w - 3, 9);

        // ---- Polarity barcode ----
        const by = chartH + gap;
        ctx.fillStyle = '#0a0d16';
        ctx.fillRect(0, by, w, barH);
        let k0 = 0;
        for (let k = 1; k <= this.n; k++) {
            const changed = k === this.n || this.pol[this.at(k)] !== this.pol[this.at(k0)];
            if (!changed) continue;
            const p = this.pol[this.at(k0)];
            ctx.fillStyle = p >= 0 ? '#f0b45c' : '#16283c';
            ctx.fillRect(sx(k0), by, Math.max(1, sx(k) - sx(k0)), barH);
            k0 = k;
        }
        ctx.strokeStyle = 'rgba(120, 145, 175, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, by + 0.5, w - 1, barH - 1);

        const span = (this.t[this.at(this.n - 1)] - this.t[this.at(0)]);
        ctx.font = '9px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(150, 175, 205, 0.5)';
        ctx.fillText('◀ ' + Math.round(span) + ' kyr', 2, by + barH + 10);
        ctx.textAlign = 'right';
        ctx.fillText('now', w - 2, by + barH + 10);
    },

    // ---- The dip circle ----

    drawDip(inc, intensity) {
        const ctx = this.dipCtx, w = this.dw, h = this.dh;
        const cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) / 2 - 13;

        ctx.clearRect(0, 0, w, h);

        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fillStyle = '#0a0d16';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 145, 175, 0.32)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Horizon and vertical, with ticks every 30 degrees.
        ctx.strokeStyle = 'rgba(120, 145, 175, 0.18)';
        ctx.beginPath();
        ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
        ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(120, 145, 175, 0.28)';
        ctx.beginPath();
        for (let a = 0; a < 360; a += 15) {
            const rad = a * Math.PI / 180;
            const rr = a % 45 === 0 ? R - 6 : R - 3;
            ctx.moveTo(cx + Math.cos(rad) * rr, cy + Math.sin(rad) * rr);
            ctx.lineTo(cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
        }
        ctx.stroke();

        // The needle. Screen right is geographic north, screen down is down, so
        // the drawn angle IS the inclination — no mapping to explain away.
        const rad = inc * Math.PI / 180;
        const nx = Math.cos(rad), ny = Math.sin(rad);
        const strength = Math.max(0.18, Math.min(1, intensity / 55));
        const len = R - 8;

        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(120, 140, 165, ' + (0.30 + 0.35 * strength).toFixed(2) + ')';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - nx * len, cy - ny * len);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 122, 92, ' + (0.45 + 0.55 * strength).toFixed(2) + ')';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + nx * len, cy + ny * len);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#c8d6e6';
        ctx.fill();

        ctx.font = '600 9px ui-monospace, Consolas, monospace';
        ctx.fillStyle = 'rgba(150, 175, 205, 0.6)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', cx + R + 7, cy);
        ctx.fillText('S', cx - R - 7, cy);
        ctx.fillText('DOWN', cx, cy + R + 7);
    }
};
