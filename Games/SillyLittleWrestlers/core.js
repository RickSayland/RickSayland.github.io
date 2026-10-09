'use strict';
var core = (function () {
  var canvas, ctx, W, H, dpr;

  var RING_HALF  = 8;
  var APRON_W    = 1.5;
  var ROPE_H     = [0.8, 1.6, 2.4];
  var POST_H     = 2.8;
  var PERSP      = 0.35;
  var SCREEN_TOP = 0.20;
  var SCREEN_BOT = 0.78;

  var shakeX = 0, shakeY = 0, shakeI = 0;
  var flashA = 0;
  var freezeFrames = 0;

  function init() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    initInput();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    var r = canvas.parentElement.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function project(wx, wy, wz) {
    var t = (wz + RING_HALF) / (2 * RING_HALF);
    var s = 1 - t * PERSP;
    var baseU = Math.min(W, H * 1.6) / (2 * RING_HALF + 8);
    var u = baseU * s;
    var sx = W * 0.5 + wx * u;
    var sy = lerp(H * SCREEN_BOT, H * SCREEN_TOP, t) - wy * u;
    return { x: sx, y: sy, s: s, u: u };
  }

  // --- input ---
  var keys = {}, pressed = {}, just = {};
  function initInput() {
    var block = ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
                 'KeyJ','KeyK','KeyL','KeyZ','KeyX','KeyC','Enter'];
    window.addEventListener('keydown', function (e) {
      keys[e.code] = true;
      if (!e.repeat) pressed[e.code] = true;
      if (block.indexOf(e.code) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { keys = {}; pressed = {}; });
  }
  function updateInput() {
    just = pressed;
    pressed = {};
  }

  // --- effects ---
  function addShake(v) { shakeI = Math.max(shakeI, v); }
  function addFlash(v) { flashA = Math.max(flashA, v); }
  function addFreeze(n) { freezeFrames = Math.max(freezeFrames, n); }
  function updateEffects() {
    if (shakeI > 0.3) {
      shakeX = (Math.random() - 0.5) * shakeI;
      shakeY = (Math.random() - 0.5) * shakeI;
      shakeI *= 0.8;
    } else shakeX = shakeY = shakeI = 0;
    if (flashA > 0.01) flashA *= 0.65; else flashA = 0;
  }

  // --- audio ---
  var ac = null;
  function audio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function playImpact(str) {
    var a = audio(), t = a.currentTime;
    var o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(60 + str * 40, t);
    o.frequency.exponentialRampToValueAtTime(25, t + 0.12);
    g.gain.setValueAtTime(0.25 * str, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(a.destination); o.start(); o.stop(t + 0.12);
    var n = a.createBuffer(1, a.sampleRate * 0.06 | 0, a.sampleRate);
    var d = n.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.12));
    var bs = a.createBufferSource(), ng = a.createGain();
    bs.buffer = n; ng.gain.setValueAtTime(0.12 * str, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    bs.connect(ng).connect(a.destination); bs.start();
  }
  function playBell() {
    var a = audio(), t = a.currentTime;
    [620, 930, 1240].forEach(function (f) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      o.connect(g).connect(a.destination); o.start(); o.stop(t + 1.8);
    });
  }
  function playSlam() {
    var a = audio(), t = a.currentTime;
    var n = a.createBuffer(1, a.sampleRate * 0.25 | 0, a.sampleRate);
    var d = n.getChannelData(0);
    for (var i = 0; i < d.length; i++) {
      var s = i / a.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-s * 14) * 0.4 +
             Math.sin(s * 100 * Math.PI) * Math.exp(-s * 12) * 0.25;
    }
    var bs = a.createBufferSource(); bs.buffer = n;
    bs.connect(a.destination); bs.start();
  }
  function playCount() {
    var a = audio(), t = a.currentTime;
    var o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = 500;
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(a.destination); o.start(); o.stop(t + 0.08);
  }
  function playCrowd() {
    var a = audio(), t = a.currentTime;
    var n = a.createBuffer(1, a.sampleRate * 0.6 | 0, a.sampleRate);
    var d = n.getChannelData(0);
    for (var i = 0; i < d.length; i++) {
      var s = i / a.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.sin(s * Math.PI / 0.6) * 0.06;
    }
    var bs = a.createBufferSource(), g = a.createGain();
    bs.buffer = n; g.gain.value = 1;
    bs.connect(g).connect(a.destination); bs.start();
  }

  // --- util ---
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist(x1, z1, x2, z2) { var dx = x2 - x1, dz = z2 - z1; return Math.sqrt(dx * dx + dz * dz); }
  function angle(x1, z1, x2, z2) { return Math.atan2(x2 - x1, z2 - z1); }
  function randF(lo, hi) { return lo + Math.random() * (hi - lo); }
  function randI(lo, hi) { return Math.floor(lo + Math.random() * (hi - lo + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  return {
    init: init, resize: resize,
    get canvas() { return canvas; }, get ctx() { return ctx; },
    get W() { return W; }, get H() { return H; },
    project: project,
    RING_HALF: RING_HALF, APRON_W: APRON_W, ROPE_H: ROPE_H, POST_H: POST_H,
    get keys() { return keys; }, get just() { return just; },
    updateInput: updateInput,
    addShake: addShake, addFlash: addFlash, addFreeze: addFreeze,
    updateEffects: updateEffects,
    get shakeX() { return shakeX; }, get shakeY() { return shakeY; },
    get flashA() { return flashA; },
    get freezeFrames() { return freezeFrames; },
    set freezeFrames(v) { freezeFrames = v; },
    ensureAudio: audio, playImpact: playImpact, playBell: playBell,
    playSlam: playSlam, playCount: playCount, playCrowd: playCrowd,
    lerp: lerp, clamp: clamp, dist: dist, angle: angle,
    randF: randF, randI: randI, pick: pick,
  };
})();
