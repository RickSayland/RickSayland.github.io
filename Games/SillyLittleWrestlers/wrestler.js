'use strict';
var wrestler = (function () {

  var ROSTER = [
    { name: 'Quasar',          skin: '#e8c4a0', hair: '#6b1fb3', trunk: '#5c16a8', boot: '#2a0a4e', accent: '#e0d0ff', body: 1, hairStyle: 3, power: 6, speed: 5, tech: 7, tough: 6 },
    { name: 'DKS',             skin: '#8d5524', hair: '#111',    trunk: '#222',    boot: '#111',    accent: '#cc0000', body: 2, hairStyle: 0, power: 8, speed: 4, tech: 5, tough: 8 },
    { name: 'FLYE',            skin: '#deb887', hair: '#ffd700', trunk: '#00aaff', boot: '#fff',    accent: '#ffd700', body: 0, hairStyle: 2, power: 4, speed: 9, tech: 6, tough: 4 },
    { name: 'Samantha',        skin: '#f5d0a9', hair: '#8b2500', trunk: '#cc0000', boot: '#222',    accent: '#ffd700', body: 1, hairStyle: 4, power: 6, speed: 6, tech: 7, tough: 6 },
    { name: 'Scorp',           skin: '#c68642', hair: '#2d4a1e', trunk: '#1a4a2e', boot: '#111',    accent: '#88cc44', body: 1, hairStyle: 1, power: 5, speed: 6, tech: 8, tough: 5 },
    { name: 'Sharon',          skin: '#ffdbac', hair: '#1a1a44', trunk: '#1a3a8c', boot: '#fff',    accent: '#aaccff', body: 0, hairStyle: 4, power: 5, speed: 7, tech: 7, tough: 5 },
    { name: 'Spoopy',          skin: '#e0d8cc', hair: '#111',    trunk: '#ff6600', boot: '#111',    accent: '#000',    body: 1, hairStyle: 5, power: 7, speed: 5, tech: 5, tough: 7 },
    { name: 'Bree',            skin: '#cd853f', hair: '#ff69b4', trunk: '#ff1493', boot: '#00cccc', accent: '#fff',    body: 0, hairStyle: 2, power: 4, speed: 8, tech: 7, tough: 5 },
    { name: 'RickityCricket',  skin: '#e0ac69', hair: '#b8860b', trunk: '#228b22', boot: '#8b4513', accent: '#ffd700', body: 0, hairStyle: 1, power: 5, speed: 7, tech: 5, tough: 6 },
  ];

  var WEAK_MOVES  = ['Arm Drag','Hip Toss','Snapmare','Scoop Slam','Headlock Takedown','Side Headlock'];
  var STRONG_MOVES = ['Suplex','DDT','Powerbomb','Backbreaker','Piledriver','Brainbuster','Fisherman Suplex','Falcon Arrow'];

  var FINISHERS = [
    'Cosmic Crush', 'The DKS Driver', 'Fly By Night', 'Sam Slam',
    'Scorp Lock', 'Sharon Shooter', 'Spoop-plex', 'Bree-ze Kick', 'Cricket Cutter'
  ];

  function create(index, opts) {
    opts = opts || {};
    var r = ROSTER[index % ROSTER.length];
    var weakPool = [];
    for (var i = 0; i < 3; i++) weakPool.push(core.pick(WEAK_MOVES));
    var strongPool = [];
    for (var i = 0; i < 3; i++) strongPool.push(core.pick(STRONG_MOVES));

    return {
      name: r.name,
      rosterIndex: index,
      x: opts.x || 0, z: opts.z || 0, y: 0,
      vx: 0, vz: 0, vy: 0,
      facing: opts.facing || 1,

      skinColor:  r.skin, hairColor: r.hair, trunkColor: r.trunk,
      bootColor:  r.boot, accentColor: r.accent,
      bodyType:   r.body,   // 0 lean, 1 medium, 2 big
      hairStyle:  r.hairStyle,

      power: r.power, speed: r.speed, tech: r.tech, tough: r.tough,

      health: 100, maxHealth: 100,
      stamina: 100, maxStamina: 100,
      spirit: 0,

      state: 'idle',
      stateTimer: 0,
      stateData: null,
      animTime: 0,

      weakMoves: weakPool,
      strongMoves: strongPool,
      finisher: FINISHERS[index % FINISHERS.length],

      isPlayer: !!opts.isPlayer,
      knockdownCount: 0,
      lastHitBy: null,
    };
  }

  var WALK_SPD = 4.5;
  var RUN_SPD  = 9;

  function update(w, dt) {
    w.animTime += dt;
    w.stateTimer += dt;

    // stamina regen
    if (w.state === 'idle') w.stamina = Math.min(w.maxStamina, w.stamina + 12 * dt);
    else if (w.state === 'walking') w.stamina = Math.min(w.maxStamina, w.stamina + 4 * dt);

    // spirit gain over time
    if (w.state !== 'down' && w.state !== 'pinned') w.spirit = Math.min(100, w.spirit + 1.5 * dt);

    // state-specific updates
    switch (w.state) {
      case 'idle': case 'walking': case 'running':
        break;
      case 'striking':
        if (w.stateTimer > 0.25) setState(w, 'idle');
        break;
      case 'hurt':
        if (w.stateTimer > 0.3) setState(w, 'idle');
        break;
      case 'falling':
        if (w.stateTimer > 0.4) setState(w, 'down');
        break;
      case 'down':
        if (!w.stateData || !w.stateData.stayDown) {
          if (w.stateTimer > 1.0 + (100 - w.health) * 0.03) setState(w, 'gettingUp');
        }
        break;
      case 'gettingUp':
        if (w.stateTimer > 0.5) setState(w, 'idle');
        break;
      case 'executing':
        if (w.stateTimer > (w.stateData ? w.stateData.duration : 0.8)) setState(w, 'idle');
        break;
      case 'receiving':
        if (w.stateTimer > (w.stateData ? w.stateData.duration : 0.8)) {
          if (w.stateData && w.stateData.knockdown) setState(w, 'falling');
          else setState(w, 'hurt');
        }
        break;
      case 'grappling':
        break;
      case 'pinning': case 'pinned':
        break;
      case 'celebrating':
        break;
    }

    // physics
    w.x += w.vx * dt; w.z += w.vz * dt;
    var clamped = ring.clampToRing(w.x, w.z);
    w.x = clamped.x; w.z = clamped.z;
    w.vx *= 0.85; w.vz *= 0.85;
  }

  function setState(w, s, data) {
    w.state = s;
    w.stateTimer = 0;
    w.stateData = data || null;
  }

  function moveWrestler(w, dx, dz, running) {
    if (w.state !== 'idle' && w.state !== 'walking' && w.state !== 'running') return;
    var spd = running && w.stamina > 5 ? RUN_SPD * (0.7 + w.speed * 0.03) : WALK_SPD * (0.7 + w.speed * 0.03);
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) { dx /= len; dz /= len; }
    w.vx = dx * spd; w.vz = dz * spd;
    if (dx !== 0) w.facing = dx > 0 ? 1 : -1;
    var newState = running && w.stamina > 5 ? 'running' : (len > 0 ? 'walking' : 'idle');
    if (w.state !== newState) setState(w, newState);
    if (running && len > 0) w.stamina = Math.max(0, w.stamina - 15 * (1 / 60));
  }

  function faceOpponent(w, opp) {
    if (opp.x > w.x + 0.3) w.facing = 1;
    else if (opp.x < w.x - 0.3) w.facing = -1;
  }

  // --- drawing ---
  function drawLimb(ctx, x1, y1, x2, y2, w, color) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function draw(ctx, w, time) {
    if (w.state === 'down' || w.state === 'pinned') { drawDown(ctx, w, time); return; }

    var p = core.project(w.x, 0, w.z);
    var s = p.s;
    var cx = p.x, fy = p.y;
    var bodyScale = w.bodyType === 0 ? 0.85 : w.bodyType === 2 ? 1.18 : 1;
    var H = 62 * s;
    var bw = 20 * s * bodyScale;
    var f = w.facing;
    var t = w.animTime;

    // animation params
    var bob = 0, lean = 0, armFront = 0, armBack = 0, legFront = 0, legBack = 0;
    var armFrontExt = 0;

    switch (w.state) {
      case 'idle':
        bob = Math.sin(t * 2.5) * 1.5 * s;
        armFront = Math.sin(t * 1.2) * 0.08;
        armBack = -Math.sin(t * 1.2) * 0.08;
        break;
      case 'walking':
        bob = Math.abs(Math.sin(t * 5.5)) * 2 * s;
        legFront = Math.sin(t * 5.5) * 0.35;
        legBack = -Math.sin(t * 5.5) * 0.35;
        armFront = -Math.sin(t * 5.5) * 0.25;
        armBack = Math.sin(t * 5.5) * 0.25;
        break;
      case 'running':
        bob = Math.abs(Math.sin(t * 8)) * 3 * s;
        legFront = Math.sin(t * 8) * 0.55;
        legBack = -Math.sin(t * 8) * 0.55;
        armFront = -Math.sin(t * 8) * 0.45;
        armBack = Math.sin(t * 8) * 0.45;
        lean = f * 3 * s;
        break;
      case 'striking':
        var sp = Math.min(w.stateTimer / 0.12, 1);
        armFront = -1.3 * Math.sin(sp * Math.PI);
        armFrontExt = Math.sin(sp * Math.PI) * H * 0.15;
        lean = f * 4 * s * Math.sin(sp * Math.PI);
        break;
      case 'hurt':
        var hp = Math.min(w.stateTimer / 0.2, 1);
        lean = -f * 5 * s * Math.sin(hp * Math.PI);
        armFront = 0.6 * Math.sin(hp * Math.PI);
        armBack = 0.5 * Math.sin(hp * Math.PI);
        break;
      case 'grappling':
        armFront = -0.6; armBack = -0.6;
        lean = f * 2 * s;
        bob = Math.sin(t * 4) * s;
        break;
      case 'executing':
        var ep = Math.min(w.stateTimer / (w.stateData ? w.stateData.duration : 0.8), 1);
        armFront = -1.0 * Math.sin(ep * Math.PI);
        armBack = -0.5 * Math.sin(ep * Math.PI);
        bob = Math.sin(ep * Math.PI) * 6 * s;
        lean = f * 3 * s * Math.sin(ep * Math.PI);
        break;
      case 'receiving':
        var rp = Math.min(w.stateTimer / (w.stateData ? w.stateData.duration : 0.8), 1);
        lean = -f * 6 * s * Math.sin(rp * Math.PI);
        armFront = 0.8 * Math.sin(rp * Math.PI);
        armBack = 0.6 * Math.sin(rp * Math.PI);
        bob = -Math.sin(rp * Math.PI) * 4 * s;
        break;
      case 'gettingUp':
        var gp = Math.min(w.stateTimer / 0.5, 1);
        bob = (1 - gp) * H * 0.3;
        lean = (1 - gp) * f * 3 * s;
        break;
      case 'falling':
        var fp = Math.min(w.stateTimer / 0.4, 1);
        lean = -f * 8 * s * fp;
        bob = -fp * H * 0.1;
        armFront = fp * 0.8; armBack = fp * 0.6;
        break;
      case 'celebrating':
        bob = Math.abs(Math.sin(t * 4)) * 5 * s;
        armFront = -1.2 + Math.sin(t * 3) * 0.3;
        armBack = -1.0 + Math.sin(t * 3.5) * 0.3;
        break;
      case 'pinning':
        bob = -H * 0.2;
        armFront = -0.8; armBack = -0.3;
        break;
    }

    var by = fy - H * 0.5 - bob;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, fy + 1, bw * 0.9, H * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // positions
    var hipY = by + H * 0.1;
    var shY = by - H * 0.16;
    var headY = by - H * 0.3;
    var headR = H * 0.13;
    var limbW = 5 * s * bodyScale;
    var legLen = fy - hipY;
    var armLen = H * 0.28;

    // back leg
    var blKickX = Math.sin(legBack) * legLen * 0.5 * f;
    drawLimb(ctx, cx - f * bw * 0.2, hipY, cx - f * bw * 0.2 + blKickX, fy, limbW, w.bootColor);

    // back arm
    var baX = cx + lean - f * bw * 0.4;
    var baEndX = baX + Math.sin(armBack) * armLen * f;
    var baEndY = shY + Math.cos(armBack) * armLen;
    drawLimb(ctx, baX, shY, baEndX, Math.min(baEndY, fy - 4 * s), limbW * 0.9, w.skinColor);

    // torso
    ctx.fillStyle = w.trunkColor;
    ctx.save(); ctx.translate(lean, 0);
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.5, shY);
    ctx.lineTo(cx + bw * 0.5, shY);
    ctx.lineTo(cx + bw * 0.38, hipY);
    ctx.lineTo(cx - bw * 0.38, hipY);
    ctx.closePath(); ctx.fill();

    // accent stripe
    ctx.fillStyle = w.accentColor;
    var stripeY = shY + (hipY - shY) * 0.35;
    ctx.fillRect(cx - bw * 0.46, stripeY, bw * 0.92, (hipY - shY) * 0.08);

    // upper chest (skin)
    ctx.fillStyle = w.skinColor;
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.42, shY);
    ctx.lineTo(cx + bw * 0.42, shY);
    ctx.lineTo(cx + bw * 0.38, shY + (hipY - shY) * 0.2);
    ctx.lineTo(cx - bw * 0.38, shY + (hipY - shY) * 0.2);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // front leg
    var flKickX = Math.sin(legFront) * legLen * 0.5 * f;
    drawLimb(ctx, cx + f * bw * 0.2, hipY, cx + f * bw * 0.2 + flKickX, fy, limbW * 1.05, w.bootColor);

    // head
    ctx.fillStyle = w.skinColor;
    ctx.beginPath();
    ctx.arc(cx + lean, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // hair
    drawHair(ctx, w, cx + lean, headY, headR, s, f);

    // eyes
    ctx.fillStyle = '#111';
    var ey = headY - headR * 0.05;
    ctx.beginPath();
    ctx.arc(cx + lean + f * headR * 0.2, ey, headR * 0.1, 0, Math.PI * 2);
    ctx.arc(cx + lean + f * headR * 0.52, ey, headR * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // mouth
    if (w.state === 'hurt' || w.state === 'receiving' || w.state === 'falling') {
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.arc(cx + lean + f * headR * 0.35, headY + headR * 0.35, headR * 0.2, 0, Math.PI);
      ctx.stroke();
    }

    // front arm
    var faX = cx + lean + f * bw * 0.4;
    var faEndX = faX + Math.sin(armFront) * armLen * f + armFrontExt * f;
    var faEndY = shY + Math.cos(armFront) * armLen;
    drawLimb(ctx, faX, shY, faEndX, Math.min(faEndY, fy - 4 * s), limbW, w.skinColor);

    // health indicator - red tint when low
    if (w.health < 30) {
      var pulse = 0.08 + Math.sin(t * 6) * 0.04;
      ctx.fillStyle = 'rgba(255,0,0,' + pulse + ')';
      ctx.beginPath();
      ctx.ellipse(cx, by, bw * 1.2, H * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDown(ctx, w, time) {
    var p = core.project(w.x, 0, w.z);
    var s = p.s;
    var cx = p.x, fy = p.y;
    var bw = 18 * s;
    var f = w.facing;
    var blen = 50 * s;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(cx, fy + 1, blen * 0.5, bw * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    // body horizontal
    var bodyY = fy - 4 * s;
    // legs
    drawLimb(ctx, cx - f * blen * 0.1, bodyY + 2 * s, cx - f * blen * 0.45, bodyY + 4 * s, 5 * s, w.bootColor);
    drawLimb(ctx, cx - f * blen * 0.05, bodyY, cx - f * blen * 0.4, bodyY - 2 * s, 5 * s, w.bootColor);
    // torso
    ctx.fillStyle = w.trunkColor;
    ctx.save();
    ctx.translate(cx, bodyY);
    ctx.rotate(f * -0.15);
    ctx.fillRect(-blen * 0.18, -bw * 0.35, blen * 0.36, bw * 0.7);
    ctx.restore();
    // arms
    drawLimb(ctx, cx + f * blen * 0.1, bodyY - 3 * s, cx + f * blen * 0.35, bodyY - 6 * s, 4 * s, w.skinColor);
    drawLimb(ctx, cx + f * blen * 0.05, bodyY + 3 * s, cx + f * blen * 0.3, bodyY + 5 * s, 4 * s, w.skinColor);
    // head
    ctx.fillStyle = w.skinColor;
    ctx.beginPath();
    ctx.arc(cx + f * blen * 0.24, bodyY, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    drawHair(ctx, w, cx + f * blen * 0.24, bodyY, 8 * s, s, f);
  }

  function drawHair(ctx, w, hx, hy, hr, s, f) {
    ctx.fillStyle = w.hairColor;
    switch (w.hairStyle) {
      case 0: // bald - no hair
        break;
      case 1: // short
        ctx.beginPath();
        ctx.arc(hx, hy - hr * 0.15, hr * 1.05, Math.PI, 0);
        ctx.fill();
        break;
      case 2: // long
        ctx.beginPath();
        ctx.arc(hx, hy - hr * 0.1, hr * 1.08, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(hx - hr * 1.05, hy, hr * 0.45, hr * 1.4);
        ctx.fillRect(hx + hr * 0.6, hy, hr * 0.45, hr * 1.4);
        break;
      case 3: // mohawk
        ctx.fillRect(hx - hr * 0.15, hy - hr * 1.8, hr * 0.3, hr * 1.2);
        break;
      case 4: // ponytail
        ctx.beginPath();
        ctx.arc(hx, hy - hr * 0.1, hr * 1.05, Math.PI, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(hx - f * hr * 0.3, hy - hr * 0.3);
        ctx.quadraticCurveTo(hx - f * hr * 1.6, hy + hr * 0.2, hx - f * hr * 1.2, hy + hr * 1.2);
        ctx.lineWidth = hr * 0.35; ctx.strokeStyle = w.hairColor;
        ctx.stroke();
        break;
      case 5: // spiky
        for (var i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(hx + i * hr * 0.35, hy - hr * 0.5);
          ctx.lineTo(hx + i * hr * 0.35 + hr * 0.1, hy - hr * 1.6 - Math.abs(i) * hr * 0.2);
          ctx.lineTo(hx + i * hr * 0.35 + hr * 0.25, hy - hr * 0.5);
          ctx.fill();
        }
        break;
    }
  }

  return {
    ROSTER: ROSTER,
    create: create,
    update: update,
    setState: setState,
    moveWrestler: moveWrestler,
    faceOpponent: faceOpponent,
    draw: draw,
  };
})();
