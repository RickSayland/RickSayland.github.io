/* ============================================================
   coreview.js — the window into the vessel.

   A side cross-section drawn on a 2D canvas: fuel assemblies
   coloured by local temperature, four rod banks physically
   descending from the upper plate, coolant rising between the
   assemblies, Cherenkov glow scaled by flux, and a camera that
   degrades as the radiation field climbs.

   Reads reactor.state; owns no simulation of its own.
   ============================================================ */
const coreView = (function () {
  'use strict';

  const COLS = 15;      // fuel assembly columns
  const ROWS = 22;      // axial nodes per assembly

  /* Which bank drives which column. Rods sit in every other lattice
     position, cycling through the four banks. -1 means no rod. */
  const BANK_OF = [];
  for (let c = 0, n = 0; c < COLS; c++) {
    BANK_OF[c] = (c % 2 === 1) ? (n++ % 4) : -1;
  }

  let cv, ctx, W = 0, H = 0, dpr = 1;
  let geo = null;
  let scanCache = null, vignette = null;
  let particles = [], bubbles = [];
  let flash = 0;             // white/red bloom on a trip
  let lastScram = false;
  let t = 0;

  /* deterministic per-cell jitter so the lattice does not shimmer */
  const cellNoise = [];
  for (let i = 0; i < COLS * ROWS; i++) cellNoise[i] = Math.random();

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    seedParticles();
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    scanCache = null;
    vignette = null;
  }

  function layout() {
    const pad = 14;
    geo = {
      vx: pad, vy: pad, vw: W - pad * 2, vh: H - pad * 2,
    };
    geo.cx = geo.vx + geo.vw * 0.17;
    geo.cw = geo.vw * 0.66;
    geo.cy = geo.vy + geo.vh * 0.30;
    geo.ch = geo.vh * 0.50;
    geo.colW = geo.cw / COLS;
    geo.rowH = geo.ch / ROWS;
  }

  function seedParticles() {
    particles = [];
    for (let i = 0; i < 150; i++) {
      particles.push({
        x: Math.random(), y: Math.random(),
        v: 0.35 + Math.random() * 0.5,
        len: 4 + Math.random() * 10,
      });
    }
    bubbles = [];
  }

  /* ---------- power shape ----------------------------------- */
  /* Local relative power for a cell, including the flux depression
     under an inserted rod. Cheap, but it reads correctly: the top of
     the core goes dark first and the peak pushes downward. */
  function localPower(c, r, rodIns) {
    const radial = 0.42 + 0.58 * Math.cos((c / (COLS - 1) - 0.5) * Math.PI * 0.92);
    const axial = Math.sin(Math.PI * (r + 0.5) / ROWS);
    let shape = radial * axial;

    const depth = (r + 0.5) / ROWS;   // 0 at top of core
    let shadow = 1;
    for (let c2 = Math.max(0, c - 1); c2 <= Math.min(COLS - 1, c + 1); c2++) {
      const b = BANK_OF[c2];
      if (b < 0) continue;
      if (depth < rodIns[b]) shadow *= (c2 === c) ? 0.12 : 0.55;
    }
    return shape * shadow;
  }

  /* ---------- colour ramps ---------------------------------- */
  const HEAT = [
    [200,  20,  30,  26],
    [500,  60,  26,  22],
    [850, 150,  44,  16],
    [1250, 224, 108,  20],
    [1700, 255, 176,  54],
    [2300, 255, 232, 168],
    [3200, 255, 255, 245],
  ];
  function heatColor(temp) {
    if (temp <= HEAT[0][0]) return HEAT[0];
    for (let i = 1; i < HEAT.length; i++) {
      if (temp <= HEAT[i][0]) {
        const a = HEAT[i - 1], b = HEAT[i];
        const f = (temp - a[0]) / (b[0] - a[0]);
        return [0,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f,
          a[3] + (b[3] - a[3]) * f];
      }
    }
    return HEAT[HEAT.length - 1];
  }

  /* ---------- static overlays (cached) ----------------------- */
  function buildScanlines() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.20)';
    for (let y = 0; y < c.height; y += 3 * dpr) g.fillRect(0, y, c.width, dpr);
    return c;
  }
  function buildVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2,
                                       W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.72)');
    return g;
  }

  /* ---------- draw ------------------------------------------ */
  function render(dt) {
    if (!ctx || !geo) return;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    const s = reactor.state;
    t += dt;

    if (s.scram && !lastScram) flash = 1;
    lastScram = s.scram;
    flash = Math.max(0, flash - dt * 1.2);

    const rodIns = s.rodPos.map(p => 1 - p / 100);   // fraction inserted from the top
    const power = s.power;

    ctx.clearRect(0, 0, W, H);

    drawWater();
    drawVessel();
    drawInternals();
    drawFuel(rodIns, s);
    drawRods(rodIns, s);
    drawGlow(power, s);
    drawCoolant(dt, s);
    drawCamera(s);
  }

  function drawWater() {
    const g = ctx.createLinearGradient(0, geo.vy, 0, geo.vy + geo.vh);
    g.addColorStop(0, '#05131c');
    g.addColorStop(0.5, '#04222e');
    g.addColorStop(1, '#020c12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawVessel() {
    const { vx, vy, vw, vh } = geo;
    ctx.save();
    /* vessel wall: a thick steel shell with domed heads */
    ctx.lineWidth = 10;
    const wall = ctx.createLinearGradient(vx, 0, vx + vw, 0);
    wall.addColorStop(0, '#2b302c');
    wall.addColorStop(0.18, '#5d635b');
    wall.addColorStop(0.5, '#3a403a');
    wall.addColorStop(0.82, '#5d635b');
    wall.addColorStop(1, '#2b302c');
    ctx.strokeStyle = wall;
    ctx.beginPath();
    roundedVessel(vx + 6, vy + 6, vw - 12, vh - 12);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.restore();
  }

  function roundedVessel(x, y, w, h) {
    const r = w * 0.34;
    ctx.moveTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + w / 2, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w / 2, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.closePath();
  }

  function drawInternals() {
    const { cx, cy, cw, ch } = geo;
    /* upper and lower core plates */
    ctx.fillStyle = '#2e332e';
    ctx.fillRect(cx - 8, cy - 12, cw + 16, 9);
    ctx.fillRect(cx - 8, cy + ch + 3, cw + 16, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(cx - 8, cy - 12, cw + 16, 2);
    ctx.fillRect(cx - 8, cy + ch + 3, cw + 16, 2);

    /* core barrel */
    ctx.strokeStyle = 'rgba(140,150,140,0.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - 8, cy - 12, cw + 16, ch + 24);
  }

  function drawFuel(rodIns, s) {
    const { cx, cy, colW, rowH } = geo;
    const gap = Math.max(0.6, colW * 0.14);
    const vgap = Math.max(0.4, rowH * 0.10);

    /* Local temperature: coolant temperature plus the fuel-to-coolant
       gap weighted by how hard this cell is actually running. */
    const dT = Math.max(0, s.fuelTemp - s.coolTemp);

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const lp = localPower(c, r, rodIns);
        const n = cellNoise[c * ROWS + r];
        const temp = s.coolTemp + dT * lp * (0.9 + n * 0.2);
        const col = heatColor(temp);

        const x = cx + c * colW + gap / 2;
        const y = cy + r * rowH + vgap / 2;
        const w = colW - gap;
        const h = rowH - vgap;

        ctx.fillStyle = `rgb(${col[1] | 0},${col[2] | 0},${col[3] | 0})`;
        ctx.fillRect(x, y, w, h);

        /* hot cells bloom; damaged fuel flickers and slumps */
        if (temp > 1100) {
          const a = Math.min(0.85, (temp - 1100) / 1600);
          const flick = damageFlicker(s, n);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(${col[1] | 0},${col[2] | 0},${col[3] | 0},${a * flick})`;
          ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
          ctx.restore();
        }
      }
    }

    /* assembly seams */
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      const x = Math.round(cx + c * colW) + 0.5;
      ctx.moveTo(x, cy); ctx.lineTo(x, cy + geo.ch);
    }
    ctx.stroke();
  }

  function damageFlicker(s, n) {
    if (s.fuelDamage <= 0) return 1;
    return 1 + Math.sin(t * (7 + n * 9) + n * 20) * 0.5 * s.fuelDamage;
  }

  function drawRods(rodIns, s) {
    const { cx, cy, ch, colW } = geo;
    const rodW = Math.max(2.5, colW * 0.42);

    for (let c = 0; c < COLS; c++) {
      const b = BANK_OF[c];
      if (b < 0) continue;
      const ins = rodIns[b];
      const x = cx + (c + 0.5) * colW - rodW / 2;
      const tipY = cy + ch * ins;
      const topY = geo.vy + geo.vh * 0.10;

      /* drive shaft above the core */
      ctx.fillStyle = '#20241f';
      ctx.fillRect(x + rodW * 0.25, topY, rodW * 0.5, cy - topY);

      /* the absorber itself */
      const g = ctx.createLinearGradient(x, 0, x + rodW, 0);
      g.addColorStop(0, '#3c423c');
      g.addColorStop(0.35, '#9aa39a');
      g.addColorStop(0.7, '#5a625a');
      g.addColorStop(1, '#2a2f2a');
      ctx.fillStyle = g;
      ctx.fillRect(x, cy - 4, rodW, (tipY - cy) + 4);

      /* tip */
      ctx.fillStyle = '#c9d2c9';
      ctx.fillRect(x, tipY - 2.5, rodW, 2.5);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x + rodW - 1, cy - 4, 1, (tipY - cy) + 4);
    }

    /* bank spiders riding above the vessel head */
    for (let b = 0; b < 4; b++) {
      const cols = [];
      for (let c = 0; c < COLS; c++) if (BANK_OF[c] === b) cols.push(c);
      if (!cols.length) continue;
      const y = geo.vy + geo.vh * 0.10 - 6 - b * 5;
      const x0 = cx + (cols[0] + 0.5) * colW;
      const x1 = cx + (cols[cols.length - 1] + 0.5) * colW;
      ctx.strokeStyle = s.scram ? 'rgba(255,90,70,0.75)' : 'rgba(150,160,150,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      ctx.stroke();
    }
  }

  function drawGlow(power, s) {
    const { cx, cy, cw, ch } = geo;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    /* Cherenkov blue, driven by neutron flux. Guard the base of the pow():
       a negative or non-finite power yields NaN, and an "rgba(...,NaN)"
       colour stop throws, which would kill the animation frame. */
    const p = Number.isFinite(power) ? Math.max(0, Math.min(power, 3)) : 0;
    const a = Math.min(0.75, 0.03 + Math.pow(p, 0.6) * 0.34);
    const g = ctx.createRadialGradient(cx + cw / 2, cy + ch / 2, 4,
                                       cx + cw / 2, cy + ch / 2, cw * 0.95);
    g.addColorStop(0, `rgba(150,215,255,${a})`);
    g.addColorStop(0.4, `rgba(70,150,255,${a * 0.5})`);
    g.addColorStop(1, 'rgba(20,60,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* thermal red once the fuel is genuinely hot */
    if (s.fuelTemp > 1500) {
      const ha = Math.max(0, Math.min(0.5, (s.fuelTemp - 1500) / 2600));
      const hg = ctx.createRadialGradient(cx + cw / 2, cy + ch / 2, 4,
                                          cx + cw / 2, cy + ch / 2, cw * 0.8);
      hg.addColorStop(0, `rgba(255,150,60,${ha})`);
      hg.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, W, H);
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,60,50,${flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function drawCoolant(dt, s) {
    const { cx, cy, cw, ch } = geo;
    const speed = s.flowFrac;
    const warm = Math.min(1, Math.max(0, (s.coolTemp - 300) / 350));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.2;
    for (const p of particles) {
      p.y -= p.v * speed * dt * 0.55;
      if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
      const px = cx + p.x * cw;
      const py = cy - ch * 0.25 + p.y * ch * 1.5;
      const R = 90 + warm * 165, G = 170 - warm * 60, B = 255 - warm * 120;
      ctx.strokeStyle = `rgba(${R | 0},${G | 0},${B | 0},${0.10 + speed * 0.16})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + p.len * (0.4 + speed));
      ctx.stroke();
    }

    /* boiling */
    if (s.voidFrac > 0.001) {
      const want = Math.round(s.voidFrac * 90);
      while (bubbles.length < want) {
        bubbles.push({ x: Math.random(), y: 1, v: 0.4 + Math.random() * 0.8, r: 1 + Math.random() * 2.6, ph: Math.random() * 6.28 });
      }
      while (bubbles.length > want) bubbles.pop();
      for (const b of bubbles) {
        b.y -= b.v * dt * 0.7;
        if (b.y < -0.05) { b.y = 1.02; b.x = Math.random(); }
        const px = cx + b.x * cw + Math.sin(t * 3 + b.ph) * 3;
        const py = cy + b.y * ch;
        ctx.fillStyle = 'rgba(220,240,255,0.5)';
        ctx.beginPath();
        ctx.arc(px, py, b.r, 0, 6.283);
        ctx.fill();
      }
    } else if (bubbles.length) {
      bubbles.length = 0;
    }
    ctx.restore();
  }

  /* ---------- the camera itself ------------------------------ */
  function drawCamera(s) {
    if (!vignette) vignette = buildVignette();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    if (!scanCache) scanCache = buildScanlines();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(scanCache, 0, 0);
    ctx.restore();

    /* Radiation eats the camera: speckle first, then tearing. */
    const rad = s.radiation;
    if (rad > 1) {
      const sev = Math.min(1, Math.log10(rad) / 3.6);
      const n = Math.round(sev * 700);
      ctx.save();
      for (let i = 0; i < n; i++) {
        const x = Math.random() * W, y = Math.random() * H;
        ctx.fillStyle = Math.random() < 0.5
          ? `rgba(255,255,255,${0.15 + Math.random() * 0.55})`
          : `rgba(0,0,0,${0.2 + Math.random() * 0.5})`;
        ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 1.5);
      }
      if (Math.random() < sev * 0.4) {
        const y = Math.random() * H, h = 2 + Math.random() * 10;
        ctx.globalAlpha = 0.5;
        ctx.drawImage(cv, 0, y * dpr, cv.width, h * dpr,
                      (Math.random() - 0.5) * 24, y, W, h);
      }
      ctx.restore();
    }

    /* HUD */
    ctx.save();
    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.textBaseline = 'top';
    const hud = s.fuelDamage > 0.05 ? 'rgba(255,120,90,0.9)' : 'rgba(120,255,190,0.75)';
    ctx.fillStyle = hud;
    ctx.fillText('CORE CAM 01 · CH A', 12, 10);

    const tc = new Date(Date.now());
    const p2 = n => String(n).padStart(2, '0');
    const stamp = `${p2(tc.getHours())}:${p2(tc.getMinutes())}:${p2(tc.getSeconds())}`;
    ctx.textAlign = 'right';
    ctx.fillText(stamp, W - 12, 10);
    ctx.textAlign = 'left';

    ctx.fillText(`FLUX ${(s.power * 100).toFixed(1)}%`, 12, H - 34);
    ctx.fillText(`T-FUEL ${Math.round(s.fuelTemp)}°F`, 12, H - 21);
    ctx.textAlign = 'right';
    ctx.fillText(`ROD AVG ${s.rodAvg.toFixed(0)}%`, W - 12, H - 34);
    ctx.fillText(`VOID ${(s.voidFrac * 100).toFixed(0)}%`, W - 12, H - 21);
    ctx.textAlign = 'left';

    /* rec dot */
    if (Math.floor(t * 1.5) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,70,70,0.9)';
      ctx.beginPath(); ctx.arc(W - 92, 15, 3.5, 0, 6.283); ctx.fill();
    }

    /* corner brackets */
    ctx.strokeStyle = 'rgba(140,255,200,0.22)';
    ctx.lineWidth = 1;
    const b = 16, m = 8;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]
      .forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + b * sx, y); ctx.lineTo(x, y); ctx.lineTo(x, y + b * sy);
        ctx.stroke();
      });

    /* status stamp */
    let stampText = null, stampCol = null;
    if (s.fuelDamage > 0.02) { stampText = 'FUEL DAMAGE'; stampCol = 'rgba(255,80,60,'; }
    else if (s.scram) { stampText = 'REACTOR TRIP'; stampCol = 'rgba(255,180,40,'; }
    else if (s.promptCritical) { stampText = 'PROMPT CRITICAL'; stampCol = 'rgba(255,80,60,'; }
    if (stampText) {
      const pulse = 0.45 + 0.35 * Math.sin(t * 6);
      ctx.font = '600 15px Oswald, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = stampCol + pulse + ')';
      ctx.fillText(stampText, W / 2, 12);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  return { init, render, resize, COLS, ROWS, BANK_OF };
})();
