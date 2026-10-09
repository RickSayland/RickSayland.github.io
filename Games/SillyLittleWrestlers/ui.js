'use strict';
var ui = (function () {
  var W, H;

  function drawTitle(ctx, time) {
    W = core.W; H = core.H;
    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, W, H);

    // ring ropes bg
    ctx.strokeStyle = 'rgba(122,47,54,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, H * 0.82); ctx.lineTo(W, H * 0.82); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * 0.88); ctx.lineTo(W, H * 0.88); ctx.stroke();

    // title
    var sz1 = Math.min(W * 0.06, 52);
    var sz2 = Math.min(W * 0.04, 34);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    ctx.fillStyle = '#f0574a';
    ctx.font = 'bold ' + Math.round(sz1) + 'px Impact, Arial Narrow, sans-serif';
    ctx.fillText('SILLY LITTLE', W / 2, H * 0.3);
    ctx.fillText('WRESTLING FEDERATION', W / 2, H * 0.3 + sz1 * 1.15);

    ctx.fillStyle = '#f2a35e';
    ctx.font = 'italic ' + Math.round(sz2) + 'px Georgia, serif';
    ctx.fillText('The Game', W / 2, H * 0.3 + sz1 * 2.4);

    // prompt
    var pulse = 0.4 + Math.sin(time * 3) * 0.4;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(sz2 * 0.7) + 'px sans-serif';
    ctx.fillText('PRESS ENTER TO START', W / 2, H * 0.72);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#555';
    ctx.font = Math.round(sz2 * 0.45) + 'px sans-serif';
    ctx.fillText('WASD/Arrows = Move  |  J/Z = Strike  |  K/X = Grapple  |  L/C = Run  |  Space = Pin', W / 2, H * 0.93);
  }

  function drawCharSelect(ctx, time, roster, selected, confirmed) {
    W = core.W; H = core.H;
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0574a';
    var titleSz = Math.min(W * 0.04, 36);
    ctx.font = 'bold ' + Math.round(titleSz) + 'px Impact, sans-serif';
    ctx.fillText('SELECT YOUR WRESTLER', W / 2, H * 0.08);

    var cols = Math.min(5, roster.length);
    var rows = Math.ceil(roster.length / cols);
    var cellW = Math.min(W * 0.16, 140);
    var cellH = Math.min(H * 0.28, 150);
    var gap = 10;
    var startX = W / 2 - (cols * (cellW + gap) - gap) / 2;
    var startY = H * 0.16;

    roster.forEach(function (r, i) {
      var col = i % cols, row = Math.floor(i / cols);
      var cx = startX + col * (cellW + gap) + cellW / 2;
      var cy = startY + row * (cellH + gap) + cellH / 2;

      var isSel = i === selected;
      ctx.fillStyle = isSel ? 'rgba(240,87,74,0.25)' : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = isSel ? '#f0574a' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = isSel ? 2.5 : 1;
      ctx.beginPath();
      ctx.roundRect(cx - cellW / 2, cy - cellH / 2, cellW, cellH, 8);
      ctx.fill(); ctx.stroke();

      // draw mini wrestler preview
      drawMiniWrestler(ctx, r, cx, cy + cellH * 0.05, cellH * 0.42, time);

      // name
      ctx.fillStyle = isSel ? '#fff' : '#aaa';
      ctx.font = 'bold ' + Math.round(cellH * 0.11) + 'px sans-serif';
      ctx.fillText(r.name, cx, cy + cellH * 0.38);
    });

    // instructions
    ctx.fillStyle = '#888';
    ctx.font = Math.round(titleSz * 0.55) + 'px sans-serif';
    ctx.fillText('Arrow Keys to Select  |  Enter to Confirm', W / 2, H * 0.92);

    if (confirmed) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold ' + Math.round(titleSz * 1.2) + 'px Impact, sans-serif';
      ctx.fillText(roster[selected].name + ' IS READY!', W / 2, H / 2);
    }
  }

  function drawMiniWrestler(ctx, r, cx, cy, h, time) {
    var bw = h * 0.35;
    var bodyScale = r.body === 0 ? 0.85 : r.body === 2 ? 1.15 : 1;
    bw *= bodyScale;

    // body
    ctx.fillStyle = r.trunk;
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.5, cy - h * 0.2);
    ctx.lineTo(cx + bw * 0.5, cy - h * 0.2);
    ctx.lineTo(cx + bw * 0.38, cy + h * 0.15);
    ctx.lineTo(cx - bw * 0.38, cy + h * 0.15);
    ctx.closePath(); ctx.fill();

    // legs
    ctx.strokeStyle = r.boot; ctx.lineWidth = h * 0.08; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - bw * 0.2, cy + h * 0.15); ctx.lineTo(cx - bw * 0.25, cy + h * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + bw * 0.2, cy + h * 0.15); ctx.lineTo(cx + bw * 0.25, cy + h * 0.45); ctx.stroke();

    // arms
    ctx.strokeStyle = r.skin; ctx.lineWidth = h * 0.07;
    var armA = Math.sin(time * 2) * 0.15;
    ctx.beginPath(); ctx.moveTo(cx - bw * 0.4, cy - h * 0.15); ctx.lineTo(cx - bw * 0.55, cy + h * 0.1 + Math.sin(armA) * h * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + bw * 0.4, cy - h * 0.15); ctx.lineTo(cx + bw * 0.55, cy + h * 0.1 - Math.sin(armA) * h * 0.05); ctx.stroke();

    // head
    var headR = h * 0.15;
    ctx.fillStyle = r.skin;
    ctx.beginPath(); ctx.arc(cx, cy - h * 0.35, headR, 0, Math.PI * 2); ctx.fill();

    // hair
    ctx.fillStyle = r.hair;
    if (r.hairStyle >= 1) {
      ctx.beginPath(); ctx.arc(cx, cy - h * 0.37, headR * 1.05, Math.PI, 0); ctx.fill();
    }

    // eyes
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx - headR * 0.25, cy - h * 0.36, headR * 0.1, 0, Math.PI * 2);
    ctx.arc(cx + headR * 0.25, cy - h * 0.36, headR * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHUD(ctx, match) {
    W = core.W; H = core.H;
    var p1 = match.p1, p2 = match.p2;
    var barW = Math.min(W * 0.28, 260);
    var barH = 10;
    var padX = W * 0.04;
    var topY = 16;

    // P1 (left)
    drawHealthBar(ctx, padX, topY, barW, barH, p1, false);
    // P2 (right)
    drawHealthBar(ctx, W - padX - barW, topY, barW, barH, p2, true);

    // timer
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(formatTime(match.timer), W / 2, topY);

    // VS
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.fillText('VS', W / 2, topY + 22);
  }

  function drawHealthBar(ctx, x, y, w, h, wr, flip) {
    var nameSz = Math.min(14, w * 0.06);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.round(nameSz) + 'px sans-serif';
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(wr.name, flip ? x + w : x, y);

    var barY = y + nameSz + 4;
    // bg
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, barY, w, h);
    // health fill
    var hpFrac = wr.health / wr.maxHealth;
    var hpColor = hpFrac > 0.5 ? '#4caf50' : hpFrac > 0.25 ? '#ff9800' : '#f44336';
    var fillW = w * hpFrac;
    ctx.fillStyle = hpColor;
    if (flip) ctx.fillRect(x + w - fillW, barY, fillW, h);
    else ctx.fillRect(x, barY, fillW, h);

    // stamina bar (thin, below health)
    var stY = barY + h + 2;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, stY, w, 3);
    ctx.fillStyle = '#2196f3';
    var stFrac = wr.stamina / wr.maxStamina;
    var stW = w * stFrac;
    if (flip) ctx.fillRect(x + w - stW, stY, stW, 3);
    else ctx.fillRect(x, stY, stW, 3);

    // spirit meter (dots)
    var spiritY = stY + 6;
    var dots = 5;
    var filled = Math.floor(wr.spirit / 100 * dots);
    var dotR = 3;
    for (var i = 0; i < dots; i++) {
      var dx = flip ? x + w - i * (dotR * 3) - dotR : x + i * (dotR * 3) + dotR;
      ctx.fillStyle = i < filled ? '#ffd700' : 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(dx, spiritY + dotR, dotR, 0, Math.PI * 2); ctx.fill();
    }
    if (wr.spirit >= 95) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillText('FINISHER!', flip ? x + w : x, spiritY + dotR * 2 + 4);
    }
  }

  function drawGrappleBar(ctx, g) {
    W = core.W; H = core.H;
    var barW = Math.min(W * 0.4, 350);
    var barH = 12;
    var x = (W - barW) / 2;
    var y = H * 0.12;

    // label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('GRAPPLE!', W / 2, y - 6);

    // bar bg
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);
    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, barW, barH);

    // sweet spot
    var ssX = x + g.sweetSpot * barW - g.sweetWidth * barW / 2;
    var ssW = g.sweetWidth * barW;
    ctx.fillStyle = 'rgba(255,215,0,0.35)';
    ctx.fillRect(ssX, y, ssW, barH);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1;
    ctx.strokeRect(ssX, y, ssW, barH);

    // cursor
    if (!g.resolved) {
      var curX = x + g.cursor * barW;
      ctx.fillStyle = '#fff';
      ctx.fillRect(curX - 1.5, y - 3, 3, barH + 6);
    }

    // lock markers
    if (g.attackerLock >= 0) {
      var aX = x + g.attackerLock * barW;
      ctx.fillStyle = g.attacker.isPlayer ? '#4caf50' : '#f44336';
      ctx.beginPath(); ctx.moveTo(aX, y + barH + 3); ctx.lineTo(aX - 5, y + barH + 10); ctx.lineTo(aX + 5, y + barH + 10); ctx.fill();
    }
    if (g.defenderLock >= 0) {
      var dX = x + g.defenderLock * barW;
      ctx.fillStyle = g.defender.isPlayer ? '#4caf50' : '#f44336';
      ctx.beginPath(); ctx.moveTo(dX, y - 3); ctx.lineTo(dX - 5, y - 10); ctx.lineTo(dX + 5, y - 10); ctx.fill();
    }

    // result
    if (g.resolved && g.moveName) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 20px Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.winner.name + ' hits ' + g.moveName + '!', W / 2, y + barH + 28);
    }
  }

  function drawPinCount(ctx, pin) {
    W = core.W; H = core.H;
    var centerX = W / 2, centerY = H * 0.45;

    // big count number
    if (pin.count > 0 && !pin.kickedOut && !pin.success) {
      var sz = Math.min(W * 0.15, 120);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, centerY - sz * 0.7, W, sz * 1.4);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.round(sz) + 'px Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pin.count + '!', centerX, centerY);
    }

    // kickout
    if (pin.kickedOut) {
      var sz = Math.min(W * 0.06, 48);
      ctx.fillStyle = '#ff6600';
      ctx.font = 'bold ' + Math.round(sz) + 'px Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('KICKOUT AT ' + pin.count + '!', centerX, centerY);
    }

    // mash prompt for player
    if (pin.defender.isPlayer && !pin.kickedOut && !pin.success) {
      ctx.fillStyle = '#fff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('MASH BUTTONS TO KICK OUT!', centerX, centerY + 50);
    }
  }

  function drawMoveFlash(ctx, name, timer) {
    W = core.W; H = core.H;
    if (timer <= 0) return;
    var alpha = Math.min(1, timer * 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffd700';
    var sz = Math.min(W * 0.04, 32);
    ctx.font = 'bold ' + Math.round(sz) + 'px Impact, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, W / 2, H * 0.3);
    ctx.globalAlpha = 1;
  }

  function drawResult(ctx, match, time) {
    W = core.W; H = core.H;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);

    var sz1 = Math.min(W * 0.06, 48);
    var sz2 = Math.min(W * 0.08, 64);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#aaa';
    ctx.font = sz1 + 'px Impact, sans-serif';
    ctx.fillText('WINNER', W / 2, H * 0.3);

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold ' + Math.round(sz2) + 'px Impact, sans-serif';
    ctx.fillText(match.winner.name + '!', W / 2, H * 0.42);

    ctx.fillStyle = '#888';
    ctx.font = Math.round(sz1 * 0.5) + 'px sans-serif';
    ctx.fillText('Match time: ' + formatTime(match.timer), W / 2, H * 0.55);

    var pulse = 0.3 + Math.sin(time * 3) * 0.3;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(sz1 * 0.5) + 'px sans-serif';
    ctx.fillText('PRESS ENTER TO CONTINUE', W / 2, H * 0.72);
    ctx.globalAlpha = 1;
  }

  function formatTime(s) {
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  return {
    drawTitle: drawTitle, drawCharSelect: drawCharSelect,
    drawHUD: drawHUD, drawGrappleBar: drawGrappleBar,
    drawPinCount: drawPinCount, drawMoveFlash: drawMoveFlash,
    drawResult: drawResult,
  };
})();
