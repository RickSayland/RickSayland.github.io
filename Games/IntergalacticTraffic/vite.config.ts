import { defineConfig } from 'vite';

// Relative base: the bundle works from the domain root, from /<repo-name>/,
// and from /Games/IntergalacticTraffic/ on the Pages site, with no rebuild.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsDir: 'assets',
  },
});
