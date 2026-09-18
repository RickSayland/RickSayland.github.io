// ============ CRITICALITY — THE BENCH VIEW ============
// Owns `bench`. No simulation of any kind in here.
//
// Two layers, for the same reason SocietySim has two: the cells are painted
// one pixel per centimetre into a 240x150 offscreen canvas and blown up with
// smoothing off, so a 36,000-cell world costs one putImageData and one
// drawImage; the neutrons are drawn over the top in screen space, because they
// live at sub-cell positions and a track is a line, not a pixel.

const bench = {
    canvas: null, ctx: null,
    off: null, octx: null, img: null, data: null,
    view: { s: 1, ox: 0, oy: 0, dpr: 1 },
    cursor: { x: 0, y: 0, r: 4, show: false, erase: false },
    flashAmt: 0,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.off = document.createElement('canvas');
        this.off.width = grid.W; this.off.height = grid.H;
        this.octx = this.off.getContext('2d');
        this.img = this.octx.createImageData(grid.W, grid.H);
        this.data = this.img.data;
        for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
        this.resize();
    },

    resize() {
        const c = this.canvas, r = c.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        c.width = Math.max(1, Math.round(r.width * dpr));
        c.height = Math.max(1, Math.round(r.height * dpr));
        const s = Math.min(c.width / grid.W, c.height / grid.H);
        this.view = {
            s, dpr,
            ox: (c.width - grid.W * s) / 2,
            oy: (c.height - grid.H * s) / 2
        };
        this.ctx.imageSmoothingEnabled = false;
    },

    // cell coords -> screen pixels, and back for the pointer
    toScreen(x, y) { const v = this.view; return [v.ox + x * v.s, v.oy + y * v.s]; },
    toCell(px, py) {
        const v = this.view, d = v.dpr;
        return [(px * d - v.ox) / v.s, (py * d - v.oy) / v.s];
    },

    // Incandescence. Nothing about this is a colour ramp chosen to look nice:
    // it is the sequence a real hot solid goes through, and it is the only
    // readout of cell temperature there is on the bench itself.
    glow(T, out) {
        if (T < 620) { out[0] = out[1] = out[2] = 0; return; }
        const t = Math.min(1, (T - 620) / 2600);
        const e = t * t * (1.6 - 0.6 * t);
        out[0] = 255 * e;
        out[1] = 235 * e * e;
        out[2] = 255 * e * e * e * e;
    },
    _g: [0, 0, 0],

    paintCells() {
        const d = this.data, W = grid.W, n = grid.n;
        const type = grid.type, temp = grid.temp, tint = grid.tint, fp = grid.fp, mass = grid.mass;
        const els = elements.list, g = this._g;
        for (let c = 0; c < n; c++) {
            const e = els[type[c]];
            const col = e.color;
            let r = col[0], gg = col[1], b = col[2];
            if (!e.empty) {
                // Grain. A dust with no per-cell variation reads as a flat
                // block of colour and stops looking like powder.
                const v = ((tint[c] & 31) - 15) * (e.grain || 6) / 15;
                r += v; gg += v; b += v;
                // A part-empty cell (dissolving dust, a coalescing puddle) is
                // genuinely thinner, so it is drawn darker.
                const fill = mass[c] / e.massG;
                if (fill < 0.95) { const f = 0.35 + 0.65 * fill; r *= f; gg *= f; b *= f; }
                if (fp[c] > 1e12) {
                    // Fission products. Enough of them and the material is
                    // visibly not what you put down any more.
                    const s = Math.min(0.5, Math.log10(fp[c] / 1e12) * 0.1);
                    r += (150 - r) * s; gg += (110 - gg) * s; b += (40 - b) * s;
                }
                const T = temp[c];
                if (T > 620) {
                    this.glow(T, g);
                    r += g[0]; gg += g[1]; b += g[2];
                }
            }
            const o = c << 2;
            d[o] = r > 255 ? 255 : r < 0 ? 0 : r;
            d[o + 1] = gg > 255 ? 255 : gg < 0 ? 0 : gg;
            d[o + 2] = b > 255 ? 255 : b < 0 ? 0 : b;
        }
        this.octx.putImageData(this.img, 0, 0);
    },

    draw() {
        const ctx = this.ctx, v = this.view;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#04060a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.paintCells();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.off, v.ox, v.oy, grid.W * v.s, grid.H * v.s);

        this.drawTracks();
        this.drawFlashes();
        this.drawProbe();
        this.drawCursor();
    },

    // Neutron flights, coloured by energy. Watching violet tracks turn cyan
    // inside water is the whole of moderation, on screen, with nothing
    // explaining it.
    drawTracks() {
        const ctx = this.ctx, v = this.view, seg = neutrons.seg, n = neutrons.segN;
        if (!n) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // Thin and nearly transparent, drawn additively. Thousands of flights a
        // frame all radiating from one core saturate to a white starburst at
        // any honest opacity; at this one, density reads as brightness and the
        // material underneath stays visible.
        ctx.lineWidth = Math.max(0.5, v.s * 0.10);

        // Three buckets rather than a stroke per segment: a path per colour is
        // three state changes instead of four thousand.
        const buckets = [[], [], []];
        for (let i = 0; i < n; i++) {
            const o = i * 5, E = seg[o + 4];
            const b = E > 1e5 ? 0 : E > 1 ? 1 : 2;
            buckets[b].push(o);
        }
        const cols = ['rgba(200,190,255,0.085)', 'rgba(110,180,255,0.075)', 'rgba(70,220,255,0.07)'];
        for (let b = 0; b < 3; b++) {
            const list = buckets[b];
            if (!list.length) continue;
            ctx.strokeStyle = cols[b];
            ctx.beginPath();
            for (const o of list) {
                ctx.moveTo(v.ox + seg[o] * v.s, v.oy + seg[o + 1] * v.s);
                ctx.lineTo(v.ox + seg[o + 2] * v.s, v.oy + seg[o + 3] * v.s);
            }
            ctx.stroke();
        }
        ctx.restore();
    },

    drawFlashes() {
        const ctx = this.ctx, v = this.view, f = neutrons.flash, n = neutrons.flashN;
        if (!n) return;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,240,190,0.30)';
        const r = Math.max(0.8, v.s * 0.38);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const o = i * 3;
            ctx.moveTo(v.ox + f[o] * v.s + r, v.oy + f[o + 1] * v.s);
            ctx.arc(v.ox + f[o] * v.s, v.oy + f[o + 1] * v.s, r, 0, 6.2832);
        }
        ctx.fill();
        ctx.restore();
    },

    drawProbe() {
        const ctx = this.ctx, v = this.view, p = neutrons.probe;
        const [x, y] = this.toScreen(p.x, p.y);
        const s = Math.max(5, v.s * 3);
        ctx.save();
        ctx.strokeStyle = '#57e0c8';
        ctx.lineWidth = Math.max(1, v.s * 0.2);
        ctx.beginPath();
        ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
        ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, s * 0.55, 0, 6.2832);
        ctx.stroke();
        ctx.fillStyle = 'rgba(87,224,200,0.75)';
        ctx.font = `${Math.max(9, v.s * 2.4)}px ui-monospace, monospace`;
        ctx.fillText('dosimeter', x + s * 1.3, y - s * 0.4);
        ctx.restore();
    },

    drawCursor() {
        if (!this.cursor.show) return;
        const ctx = this.ctx, v = this.view, c = this.cursor;
        const [x, y] = this.toScreen(c.x, c.y);
        ctx.save();
        ctx.strokeStyle = c.erase ? 'rgba(255,120,90,0.8)' : 'rgba(210,230,245,0.65)';
        ctx.lineWidth = Math.max(1, v.s * 0.14);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, c.r * v.s), 0, 6.2832);
        ctx.stroke();
        ctx.restore();
    }
};
