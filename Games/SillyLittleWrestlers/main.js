'use strict';

var GAME_VERSION = '0.1.0';

var main = (function () {
  var gameState = 'title';
  var time = 0;

  // character select
  var selectedChar = 0;
  var charConfirmed = false;
  var confirmTimer = 0;

  // match
  var match = null;

  function init() {
    core.init();
    gameState = 'title';
  }

  function createMatch(playerIndex) {
    var oppIndex;
    do { oppIndex = core.randI(0, wrestler.ROSTER.length - 1); } while (oppIndex === playerIndex);

    var p1 = wrestler.create(playerIndex, { x: -3, z: 0, facing: 1, isPlayer: true });
    var p2 = wrestler.create(oppIndex, { x: 3, z: 0, facing: -1 });

    match = {
      p1: p1, p2: p2,
      timer: 0,
      state: 'intro',       // intro, wrestling, grapple, pin, result
      introTimer: 0,
      grapple: null,
      pin: null,
      winner: null,
      lastMoveName: '',
      moveFlashTimer: 0,
      bellRung: false,
    };
    ai.reset();
    gameState = 'match';
  }

  // --- input helpers ---
  function moveKey() {
    var dx = 0, dz = 0;
    var k = core.keys;
    if (k.ArrowLeft  || k.KeyA) dx -= 1;
    if (k.ArrowRight || k.KeyD) dx += 1;
    if (k.ArrowUp    || k.KeyW) dz += 1;
    if (k.ArrowDown  || k.KeyS) dz -= 1;
    return { x: dx, z: dz };
  }
  function runKey() { return core.keys.KeyL || core.keys.KeyC; }
  function strikeKey() { return core.just.KeyJ || core.just.KeyZ; }
  function grappleKey() { return core.just.KeyK || core.just.KeyX; }
  function pinKey() { return core.just.Space; }
  function anyActionKey() {
    return core.just.KeyJ || core.just.KeyZ || core.just.KeyK || core.just.KeyX || core.just.Space;
  }

  // --- update ---
  function update(dt) {
    time += dt;
    core.updateInput();

    switch (gameState) {
      case 'title':
        if (core.just.Enter || core.just.Space) {
          core.ensureAudio();
          gameState = 'charSelect';
          selectedChar = 0;
          charConfirmed = false;
        }
        break;

      case 'charSelect':
        if (!charConfirmed) {
          if (core.just.ArrowRight || core.just.KeyD) selectedChar = (selectedChar + 1) % wrestler.ROSTER.length;
          if (core.just.ArrowLeft  || core.just.KeyA) selectedChar = (selectedChar - 1 + wrestler.ROSTER.length) % wrestler.ROSTER.length;
          if (core.just.ArrowDown  || core.just.KeyS) selectedChar = Math.min(selectedChar + 5, wrestler.ROSTER.length - 1);
          if (core.just.ArrowUp    || core.just.KeyW) selectedChar = Math.max(selectedChar - 5, 0);
          if (core.just.Enter) {
            charConfirmed = true;
            confirmTimer = 0;
            core.playCrowd();
          }
        } else {
          confirmTimer += dt;
          if (confirmTimer > 1.2) createMatch(selectedChar);
        }
        break;

      case 'match':
        updateMatch(dt);
        break;

      case 'result':
        if (core.just.Enter || core.just.Space) {
          gameState = 'charSelect';
          charConfirmed = false;
        }
        break;
    }
  }

  function updateMatch(dt) {
    var p1 = match.p1, p2 = match.p2;

    switch (match.state) {
      case 'intro':
        match.introTimer += dt;
        // walk wrestlers toward center
        if (p1.x < -1) wrestler.moveWrestler(p1, 1, 0, false);
        if (p2.x > 1) wrestler.moveWrestler(p2, -1, 0, false);
        if (match.introTimer > 1.5 && !match.bellRung) {
          core.playBell();
          match.bellRung = true;
        }
        if (match.introTimer > 2.2) {
          match.state = 'wrestling';
          wrestler.setState(p1, 'idle');
          wrestler.setState(p2, 'idle');
        }
        wrestler.update(p1, dt); wrestler.update(p2, dt);
        break;

      case 'wrestling':
        match.timer += dt;
        match.moveFlashTimer -= dt;

        // player input
        var mv = moveKey();
        if (mv.x !== 0 || mv.z !== 0) {
          wrestler.moveWrestler(p1, mv.x, mv.z, runKey());
        } else if (combat.canAct(p1)) {
          if (p1.state !== 'idle') wrestler.setState(p1, 'idle');
        }

        if (strikeKey() && combat.strikeCheck(p1, p2)) {
          var result = combat.doStrike(p1, p2);
          match.lastMoveName = 'Strike!';
          match.moveFlashTimer = 0.6;
        }
        if (grappleKey() && combat.grappleCheck(p1, p2)) {
          match.grapple = combat.createGrapple(p1, p2);
          match.state = 'grapple';
          var accuracy = 0.5 + p2.tech * 0.04;
          var aiTarget = match.grapple.sweetSpot + (Math.random() - 0.5) * (1 - accuracy) * 0.5;
          match.grapple._aiTarget = core.clamp(aiTarget, 0.05, 0.95);
        }
        if (pinKey() && combat.canPin(p1, p2)) {
          match.pin = combat.createPin(p1, p2);
          match.state = 'pin';
        }

        // AI
        ai.update(p2, p1, match, dt);

        // separation
        combat.separate(p1, p2);

        // check for KO
        if (p1.health <= 0 && p1.state === 'down') {
          endMatch(p2);
        }
        if (p2.health <= 0 && p2.state === 'down') {
          endMatch(p1);
        }

        wrestler.update(p1, dt); wrestler.update(p2, dt);
        break;

      case 'grapple':
        match.timer += dt;
        var g = match.grapple;

        // player lock
        if (anyActionKey()) {
          var playerW = p1.isPlayer ? p1 : p2;
          combat.lockGrapple(g, playerW);
        }
        // AI lock
        ai.aiGrappleTick(g);

        var done = combat.updateGrapple(g, dt);
        if (done) {
          match.state = 'wrestling';
          if (g.moveName) {
            match.lastMoveName = g.moveName;
            match.moveFlashTimer = 1.2;
          }
          match.grapple = null;
        }

        wrestler.update(p1, dt); wrestler.update(p2, dt);
        break;

      case 'pin':
        match.timer += dt;
        var pin = match.pin;

        // player mash (if being pinned)
        if (pin.defender.isPlayer) {
          if (anyActionKey() || strikeKey() || grappleKey()) {
            combat.mashPin(pin);
          }
        } else {
          ai.aiPinMash(pin, dt);
        }

        var pinDone = combat.updatePin(pin, dt);
        if (pinDone) {
          if (pin.success) {
            endMatch(pin.attacker);
          } else {
            match.state = 'wrestling';
            match.pin = null;
          }
        }
        wrestler.update(p1, dt); wrestler.update(p2, dt);
        break;
    }

    core.updateEffects();
  }

  function endMatch(winner) {
    match.winner = winner;
    match.state = 'result';
    wrestler.setState(winner, 'celebrating');
    var loser = winner === match.p1 ? match.p2 : match.p1;
    wrestler.setState(loser, 'down', { stayDown: true });
    core.playBell();
    core.playCrowd();
    core.addShake(8);
    setTimeout(function () { gameState = 'result'; }, 1500);
  }

  // --- render ---
  function render() {
    var ctx = core.ctx;
    ctx.clearRect(0, 0, core.W, core.H);

    switch (gameState) {
      case 'title':
        ui.drawTitle(ctx, time);
        break;

      case 'charSelect':
        ui.drawCharSelect(ctx, time, wrestler.ROSTER, selectedChar, charConfirmed);
        break;

      case 'match':
        renderMatch(ctx);
        break;

      case 'result':
        renderMatch(ctx);
        ui.drawResult(ctx, match, time);
        break;
    }
  }

  function renderMatch(ctx) {
    // background
    var grd = ctx.createLinearGradient(0, 0, 0, core.H);
    grd.addColorStop(0, '#0a0a14'); grd.addColorStop(0.5, '#12121e'); grd.addColorStop(1, '#0a0a10');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, core.W, core.H);

    // crowd suggestion (subtle dots in background)
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (var i = 0; i < 60; i++) {
      var cx = ((i * 137 + 50) % core.W);
      var cy = core.H * 0.05 + ((i * 73 + 30) % (core.H * 0.15));
      ctx.beginPath(); ctx.arc(cx, cy, 2 + (i % 3), 0, Math.PI * 2); ctx.fill();
    }

    ctx.save();
    ctx.translate(core.shakeX, core.shakeY);

    // ring back (mat, far ropes, far posts)
    ring.drawBack(ctx);

    // wrestlers sorted by depth (far first)
    var p1 = match.p1, p2 = match.p2;
    var sortedW = p1.z > p2.z ? [p1, p2] : [p2, p1];
    sortedW.forEach(function (w) { wrestler.draw(ctx, w, time); });

    // ring front (near ropes, near posts)
    ring.drawFront(ctx);

    ctx.restore();

    // flash
    if (core.flashA > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + core.flashA + ')';
      ctx.fillRect(0, 0, core.W, core.H);
    }

    // HUD
    if (match.state !== 'intro') {
      ui.drawHUD(ctx, match);
    }

    // grapple bar
    if (match.state === 'grapple' && match.grapple) {
      ui.drawGrappleBar(ctx, match.grapple);
    }

    // pin count
    if (match.state === 'pin' && match.pin) {
      ui.drawPinCount(ctx, match.pin);
    }

    // move flash
    if (match.moveFlashTimer > 0) {
      ui.drawMoveFlash(ctx, match.lastMoveName, match.moveFlashTimer);
    }

    // intro overlay
    if (match.state === 'intro') {
      var p = Math.min(match.introTimer / 2, 1);
      if (p < 0.8) {
        ctx.fillStyle = 'rgba(0,0,0,' + (1 - p * 1.2) + ')';
        ctx.fillRect(0, 0, core.W, core.H);
      }
      var sz = Math.min(core.W * 0.04, 28);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.round(sz) + 'px Impact, sans-serif';
      ctx.fillText(match.p1.name, core.W * 0.25, core.H * 0.45);
      ctx.fillStyle = '#888';
      ctx.font = Math.round(sz * 0.7) + 'px sans-serif';
      ctx.fillText('VS', core.W * 0.5, core.H * 0.45);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.round(sz) + 'px Impact, sans-serif';
      ctx.fillText(match.p2.name, core.W * 0.75, core.H * 0.45);
    }
  }

  // --- game loop ---
  var lastT = 0;
  function loop(ts) {
    var dt = Math.min((ts - lastT) / 1000, 0.05);
    lastT = ts;

    if (core.freezeFrames > 0) {
      core.freezeFrames--;
    } else {
      update(dt);
    }
    render();
    requestAnimationFrame(loop);
  }

  function boot() {
    init();
    requestAnimationFrame(function (ts) { lastT = ts; loop(ts); });
  }

  return { boot: boot };
})();

main.boot();
