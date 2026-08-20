// ============ GEOPOLITICS SIMULATOR — BOOT ============
// Plain scripts, so load order is the <script> order in index.html.
// Everything is wired here rather than self-booting, because nations.js has to
// register its overlay before the globe's first frame.

globe.init('globeCanvas');
nations.init();
budget.init();
