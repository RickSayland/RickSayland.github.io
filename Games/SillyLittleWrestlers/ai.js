'use strict';
var ai = (function () {

  var thinkTimer = 0;
  var action = 'approach';
  var actionTimer = 0;

  function reset() {
    thinkTimer = 0; action = 'approach'; actionTimer = 0;
  }

  function update(w, opp, match, dt) {
    thinkTimer -= dt;
    actionTimer += dt;

    if (thinkTimer <= 0) {
      thinkTimer = 0.15 + Math.random() * 0.25;
      action = decide(w, opp, match);
      if (action === 'approach' || action === 'circle') actionTimer = 0;
    }

    executeAction(w, opp, match, dt);
  }

  function decide(w, opp, match) {
    var d = core.dist(w.x, w.z, opp.x, opp.z);

    // pin opportunity
    if (combat.canPin(w, opp) && opp.health < 60) return 'pin';

    // grapple if close
    if (d < combat.GRAPPLE_RANGE * 1.1 && combat.canAct(w) && combat.canBeHit(opp)) {
      if (Math.random() < 0.55) return 'grapple';
      return 'strike';
    }

    // strike if in range
    if (d < combat.STRIKE_RANGE * 1.05 && combat.canAct(w) && combat.canBeHit(opp)) {
      if (Math.random() < 0.4) return 'strike';
    }

    // approach or circle
    if (d > 4) return 'approach';
    if (Math.random() < 0.3) return 'circle';
    return 'approach';
  }

  function executeAction(w, opp, match, dt) {
    if (!combat.canAct(w)) return;

    switch (action) {
      case 'approach': {
        var dx = opp.x - w.x, dz = opp.z - w.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.5) {
          var run = d > 5 && w.stamina > 30;
          wrestler.moveWrestler(w, dx, dz, run);
        }
        break;
      }
      case 'circle': {
        var ang = core.angle(w.x, w.z, opp.x, opp.z) + Math.PI / 2;
        wrestler.moveWrestler(w, Math.sin(ang), Math.cos(ang), false);
        wrestler.faceOpponent(w, opp);
        if (actionTimer > 1.2) action = 'approach';
        break;
      }
      case 'strike': {
        if (combat.strikeCheck(w, opp)) {
          combat.doStrike(w, opp);
          match.lastMoveName = 'Strike!';
          match.moveFlashTimer = 0.8;
        } else {
          action = 'approach';
        }
        break;
      }
      case 'grapple': {
        if (combat.grappleCheck(w, opp)) {
          match.grapple = combat.createGrapple(w, opp);
          match.state = 'grapple';
          // AI will lock timing after a delay
          var accuracy = 0.6 + w.tech * 0.03;
          var aiTarget = match.grapple.sweetSpot + (Math.random() - 0.5) * (1 - accuracy) * 0.4;
          match.grapple._aiTarget = core.clamp(aiTarget, 0.05, 0.95);
        } else {
          action = 'approach';
        }
        break;
      }
      case 'pin': {
        if (combat.canPin(w, opp)) {
          match.pin = combat.createPin(w, opp);
          match.state = 'pin';
        } else {
          action = 'approach';
        }
        break;
      }
    }
  }

  function aiGrappleTick(grapple) {
    if (!grapple || grapple.resolved) return;
    if (grapple._aiTarget !== undefined) {
      var who = grapple.attacker.isPlayer ? grapple.defender : grapple.attacker;
      if (who === grapple.attacker && grapple.attackerLock < 0 && grapple.cursor >= grapple._aiTarget) {
        combat.lockGrapple(grapple, who);
      }
      if (who === grapple.defender && grapple.defenderLock < 0 && grapple.cursor >= grapple._aiTarget) {
        combat.lockGrapple(grapple, who);
      }
    }
  }

  function aiPinMash(pin, dt) {
    if (!pin || pin.kickedOut || pin.success) return;
    var mashChance = 0.3 + pin.defender.tough * 0.04;
    if (Math.random() < mashChance * dt * 10) {
      combat.mashPin(pin);
    }
  }

  return {
    reset: reset, update: update,
    aiGrappleTick: aiGrappleTick,
    aiPinMash: aiPinMash,
  };
})();
