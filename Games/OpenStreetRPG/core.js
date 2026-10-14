// ============ OPENSTREETRPG — CORE ============
// Shared runtime state every other script reads: the canvas, the view size and
// the camera. Depends on nothing. Bump GAME_VERSION together with the ?v=
// queries in index.html.

const GAME_VERSION = '0.1.1';

const TAU = Math.PI * 2;

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

// CSS-pixel size of the viewport and the device pixel ratio. Everything is laid
// out in CSS pixels; only the tile layer draws in device pixels, so it can snap
// tile edges to whole pixels and never show a seam between two tiles.
const view = { w: 0, h: 0, dpr: 1 };

// The camera looks at a point in normalised Web Mercator (see geo.js) at a
// fractional display zoom. `zoomTarget` is the integer level tiles are fetched
// at, and `zoom` eases towards it, so a zoom step animates instead of jumping.
const camera = { x: 0.5, y: 0.5, zoom: 18, zoomTarget: 18 };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function resizeCanvas() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 3);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
}
