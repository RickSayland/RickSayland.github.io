'use strict';
var combat = (function () {

  var STRIKE_RANGE = 2.2;
  var GRAPPLE_RANGE = 1.6;
  var PIN_RANGE = 2.0;
  var GRAPPLE_BAR_SPEED = 1.3;

  var WEAK_DMG  = [5, 9];
  var STRONG_DMG = [12, 18];
  var FINISHER_DMG = [28, 35];

  function strikeCheck(a, b) {
    return core.dist(a.x, a.z, b.x, b.z) < STRIKE_RANGE &&
           canAct(a) && canBeHit(b);
  }

  function grappleCheck(a, b) {
    return core.dist(a.x, a.z, b.x, b.z) < GRAPPLE_RANGE &&
           canAct(a) && canBeHit(b);
  }

  function canAct(w) {
    return w.state === 'idle' || w.state === 'walking' || w.state === 'running';
  }
  function canBeHit(w) {
    return w.state !== 'down' && w.state !== 'pinned' && w.state !== 'falling' &&
           w.state !== 'gettingUp' && w.state !== 'receiving' && w.state !== 'celebrating';
  }

  function doStrike(attacker, defender) {
    wrestler.faceOpponent(attacker, defender);
    wrestler.setState(attacker, 'striking');
    attacker.stamina = Math.max(0, attacker.stamina - 5);

    var baseDmg = core.randI(3, 5) + attacker.power * 0.3;
    if (attacker.state === 'running') baseDmg *= 1.4;
    applyDamage(defender, baseDmg, attacker);
    attacker.spirit = Math.min(100, attacker.spirit + 3);

    core.addShake(3 + baseDmg * 0.3);
    core.addFlash(0.08);
    core.playImpact(0.4 + baseDmg * 0.02);

    return { type: 'strike', damage: baseDmg };
  }

  function applyDamage(target, amount, source) {
    target.health = Math.max(0, target.health - amount);
    target.lastHitBy = source;
    target.spirit = Math.min(100, target.spirit + amount * 0.3);

    if (amount >= 10 || target.health < 20) {
      wrestler.setState(target, 'hurt');
      target.vx = (target.x - source.x) * 1.5;
      target.vz = (target.z - source.z) * 1.5;
    } else {
      wrestler.setState(target, 'hurt');
    }
  }

  // --- grapple ---
  function createGrapple(attacker, defender) {
    wrestler.faceOpponent(attacker, defender);
    wrestler.faceOpponent(defender, attacker);
    wrestler.setState(attacker, 'grappling');
    wrestler.setState(defender, 'grappling');
    attacker.stamina = Math.max(0, attacker.stamina - 8);

    var midX = (attacker.x + defender.x) / 2;
    var midZ = (attacker.z + defender.z) / 2;
    attacker.x = midX - attacker.facing * 0.7;
    defender.x = midX + attacker.facing * 0.7;
    attacker.z = midZ; defender.z = midZ;
    attacker.vx = attacker.vz = defender.vx = defender.vz = 0;

    var sweetSpot = 0.35 + Math.random() * 0.3;
    var sweetWidth = 0.12 + (attacker.health + defender.health) / 200 * 0.06;

    return {
      attacker: attacker, defender: defender,
      cursor: 0, speed: GRAPPLE_BAR_SPEED,
      sweetSpot: sweetSpot, sweetWidth: sweetWidth,
      attackerLock: -1, defenderLock: -1,
      resolved: false, winner: null, loser: null,
      resultTimer: 0,
      moveName: '',
    };
  }

  function updateGrapple(g, dt) {
    if (g.resolved) {
      g.resultTimer += dt;
      return g.resultTimer > 0.6;
    }
    g.cursor += g.speed * dt;
    if (g.cursor >= 1) {
      if (g.attackerLock < 0) g.attackerLock = 1;
      if (g.defenderLock < 0) g.defenderLock = 1;
    }
    if (g.attackerLock >= 0 && g.defenderLock >= 0) resolveGrapple(g);
    return false;
  }

  function lockGrapple(g, who) {
    if (g.resolved) return;
    if (who === g.attacker && g.attackerLock < 0) g.attackerLock = g.cursor;
    if (who === g.defender && g.defenderLock < 0) g.defenderLock = g.cursor;
  }

  function resolveGrapple(g) {
    g.resolved = true;
    var aDist = Math.abs(g.attackerLock - g.sweetSpot);
    var dDist = Math.abs(g.defenderLock - g.sweetSpot);
    // attacker advantage
    aDist *= 0.85;
    // tech bonus
    aDist *= 1 - g.attacker.tech * 0.015;
    dDist *= 1 - g.defender.tech * 0.015;

    if (aDist <= dDist) {
      g.winner = g.attacker; g.loser = g.defender;
    } else {
      g.winner = g.defender; g.loser = g.attacker;
    }

    var moveInfo = pickMove(g.winner, g.loser);
    g.moveName = moveInfo.name;
    var dmg = moveInfo.damage;

    wrestler.setState(g.winner, 'executing', { duration: moveInfo.duration, knockdown: true });
    wrestler.setState(g.loser, 'receiving', { duration: moveInfo.duration, knockdown: moveInfo.knockdown });

    g.loser.health = Math.max(0, g.loser.health - dmg);
    g.loser.lastHitBy = g.winner;
    g.winner.spirit = Math.min(100, g.winner.spirit + dmg * 0.4);
    g.loser.spirit = Math.min(100, g.loser.spirit + dmg * 0.25);
    g.winner.stamina = Math.max(0, g.winner.stamina - dmg * 0.4);

    var shakeAmt = 4 + dmg * 0.5;
    core.addShake(shakeAmt);
    core.addFlash(0.12 + dmg * 0.005);
    core.addFreeze(Math.min(6, Math.floor(dmg * 0.2)));
    if (dmg > 15) core.playSlam(); else core.playImpact(0.5 + dmg * 0.03);
  }

  function pickMove(winner, loser) {
    var isFinisher = winner.spirit >= 95 && loser.health < 40;
    if (isFinisher) {
      winner.spirit = 0;
      return { name: winner.finisher, damage: core.randI(FINISHER_DMG[0], FINISHER_DMG[1]), knockdown: true, duration: 1.3 };
    }
    var isStrong = loser.health < 55;
    if (isStrong) {
      var move = core.pick(winner.strongMoves);
      return { name: move, damage: core.randI(STRONG_DMG[0], STRONG_DMG[1]), knockdown: true, duration: 0.9 };
    }
    var move = core.pick(winner.weakMoves);
    return { name: move, damage: core.randI(WEAK_DMG[0], WEAK_DMG[1]), knockdown: Math.random() < 0.5, duration: 0.7 };
  }

  // --- pin ---
  function canPin(attacker, defender) {
    return (defender.state === 'down' || defender.state === 'falling') &&
           canAct(attacker) &&
           core.dist(attacker.x, attacker.z, defender.x, defender.z) < PIN_RANGE;
  }

  function createPin(attacker, defender) {
    wrestler.setState(attacker, 'pinning');
    wrestler.setState(defender, 'pinned', { stayDown: true });
    attacker.x = defender.x + attacker.facing * 0.5;
    attacker.z = defender.z;
    attacker.vx = attacker.vz = defender.vx = defender.vz = 0;

    return {
      attacker: attacker, defender: defender,
      count: 0, countTimer: 0,
      kickedOut: false, success: false,
      mashCount: 0,
    };
  }

  function updatePin(pin, dt) {
    if (pin.kickedOut || pin.success) return true;
    pin.countTimer += dt;
    if (pin.countTimer >= 0.85) {
      pin.count++;
      pin.countTimer = 0;
      core.playCount();
      core.addShake(2);
      core.playCrowd();

      if (pin.count >= 3) {
        pin.success = true;
        return true;
      }

      var kickChance = getKickoutChance(pin.defender, pin.count);
      kickChance += pin.mashCount * 0.03;
      if (Math.random() < kickChance) {
        pin.kickedOut = true;
        wrestler.setState(pin.defender, 'gettingUp');
        wrestler.setState(pin.attacker, 'idle');
        pin.defender.stateData = null;
        core.addShake(5);
        return true;
      }
    }
    return false;
  }

  function mashPin(pin) {
    pin.mashCount++;
  }

  function getKickoutChance(defender, count) {
    var hpFrac = defender.health / defender.maxHealth;
    if (count === 1) return 0.6 + hpFrac * 0.35;
    if (count === 2) return 0.2 + hpFrac * 0.5;
    return 0.05 + hpFrac * 0.3;
  }

  // separation
  function separate(a, b) {
    if (a.state === 'grappling' || a.state === 'pinning' || a.state === 'pinned' ||
        a.state === 'executing' || a.state === 'receiving') return;
    var dx = b.x - a.x, dz = b.z - a.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    var minD = 1.2;
    if (d < minD && d > 0.01) {
      var push = (minD - d) * 0.4;
      var nx = dx / d, nz = dz / d;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
    }
  }

  return {
    strikeCheck: strikeCheck, grappleCheck: grappleCheck,
    doStrike: doStrike, canAct: canAct, canBeHit: canBeHit,
    createGrapple: createGrapple, updateGrapple: updateGrapple,
    lockGrapple: lockGrapple,
    canPin: canPin, createPin: createPin, updatePin: updatePin, mashPin: mashPin,
    separate: separate,
    STRIKE_RANGE: STRIKE_RANGE, GRAPPLE_RANGE: GRAPPLE_RANGE,
  };
})();
