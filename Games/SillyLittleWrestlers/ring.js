'use strict';
var ring = (function () {
  var RH = core.RING_HALF;
  var A  = core.APRON_W;

  function drawBack(ctx) {
    var nL = core.project(-RH - A, 0, -RH - A);
    var nR = core.project( RH + A, 0, -RH - A);
    var fL = core.project(-RH - A, 0,  RH + A);
    var fR = core.project( RH + A, 0,  RH + A);

    // apron side faces (left, right, near)
    var drop = 20 * nL.s;
    ctx.fillStyle = '#1a4b8c';
    // near face
    ctx.beginPath();
    ctx.moveTo(nL.x, nL.y); ctx.lineTo(nR.x, nR.y);
    ctx.lineTo(nR.x, nR.y + drop); ctx.lineTo(nL.x, nL.y + drop);
    ctx.closePath(); ctx.fill();
    // left face
    ctx.beginPath();
    ctx.moveTo(fL.x, fL.y); ctx.lineTo(nL.x, nL.y);
    ctx.lineTo(nL.x, nL.y + drop); ctx.lineTo(fL.x, fL.y + drop * fL.s);
    ctx.closePath(); ctx.fill();
    // right face
    ctx.beginPath();
    ctx.moveTo(nR.x, nR.y); ctx.lineTo(fR.x, fR.y);
    ctx.lineTo(fR.x, fR.y + drop * fR.s); ctx.lineTo(nR.x, nR.y + drop);
    ctx.closePath(); ctx.fill();

    // SLWF on near apron
    ctx.save();
    var midX = (nL.x + nR.x) / 2;
    var midY = nL.y + drop * 0.5;
    ctx.font = 'bold ' + Math.round(drop * 0.65) + 'px Impact, Arial Narrow, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SLWF', midX, midY);
    ctx.restore();

    // apron top
    ctx.fillStyle = '#1a4b8c';
    ctx.beginPath();
    ctx.moveTo(nL.x, nL.y); ctx.lineTo(nR.x, nR.y);
    ctx.lineTo(fR.x, fR.y); ctx.lineTo(fL.x, fL.y);
    ctx.closePath(); ctx.fill();

    // mat canvas (white)
    var mnL = core.project(-RH, 0, -RH), mnR = core.project(RH, 0, -RH);
    var mfL = core.project(-RH, 0,  RH), mfR = core.project(RH, 0,  RH);
    ctx.fillStyle = '#eeeee8';
    ctx.beginPath();
    ctx.moveTo(mnL.x, mnL.y); ctx.lineTo(mnR.x, mnR.y);
    ctx.lineTo(mfR.x, mfR.y); ctx.lineTo(mfL.x, mfL.y);
    ctx.closePath(); ctx.fill();

    // subtle mat texture
    ctx.strokeStyle = 'rgba(0,0,0,0.03)'; ctx.lineWidth = 0.5;
    for (var i = -RH + 2; i < RH; i += 2) {
      var a = core.project(i, 0, -RH), b = core.project(i, 0, RH);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      a = core.project(-RH, 0, i); b = core.project(RH, 0, i);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // far ropes + side ropes
    drawRopeSet(ctx, 'back');
    // far posts
    drawPost(ctx, -RH, RH); drawPost(ctx, RH, RH);
  }

  function drawFront(ctx) {
    drawRopeSet(ctx, 'front');
    drawPost(ctx, -RH, -RH); drawPost(ctx, RH, -RH);
  }

  function drawRopeSet(ctx, layer) {
    var corners = [[-RH,-RH],[RH,-RH],[-RH,RH],[RH,RH]];
    core.ROPE_H.forEach(function (h, ri) {
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.5 - ri * 0.4;
      if (layer === 'back') {
        // far
        var fl = core.project(-RH, h, RH), fr = core.project(RH, h, RH);
        ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.stroke();
        // sides
        var nl = core.project(-RH, h, -RH), nr = core.project(RH, h, -RH);
        ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(nl.x, nl.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y); ctx.stroke();
      } else {
        // near
        var nl = core.project(-RH, h, -RH), nr = core.project(RH, h, -RH);
        ctx.beginPath(); ctx.moveTo(nl.x, nl.y); ctx.lineTo(nr.x, nr.y); ctx.stroke();
      }
    });
  }

  function drawPost(ctx, px, pz) {
    var base = core.project(px, 0, pz);
    var top  = core.project(px, core.POST_H, pz);
    var w = 5 * base.s;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(base.x - w / 2, top.y, w, base.y - top.y);
    core.ROPE_H.forEach(function (h) {
      var p = core.project(px, h, pz);
      var pw = 7 * base.s, ph = 6 * base.s;
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(p.x - pw / 2, p.y - ph / 2, pw, ph);
    });
  }

  function clampToRing(x, z) {
    return { x: core.clamp(x, -RH + 0.6, RH - 0.6), z: core.clamp(z, -RH + 0.6, RH - 0.6) };
  }
  function isNearRopes(x, z, m) {
    m = m || 1.5;
    return Math.abs(x) > RH - m || Math.abs(z) > RH - m;
  }
  function isInCorner(x, z, m) {
    m = m || 2.5;
    return Math.abs(x) > RH - m && Math.abs(z) > RH - m;
  }

  return {
    drawBack: drawBack, drawFront: drawFront,
    clampToRing: clampToRing, isNearRopes: isNearRopes, isInCorner: isInCorner,
  };
})();
