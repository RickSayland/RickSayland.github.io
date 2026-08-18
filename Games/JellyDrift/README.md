# JellyDrift

A 2D sidescroller where you drift the seas as a jellyfish. Written in
**TypeScript**, compiled to plain ES modules that GitHub Pages serves statically.

## Layout

```
JellyDrift/
  index.html        loads dist/main.js as a module
  game.css          full-screen canvas
  src/*.ts          TypeScript source (edit these)
  dist/*.js         compiled output (committed — Pages serves it)
  content/logo.svg  library card art
  tsconfig.json     tsc config: src -> dist, strict, ES2020 modules
  package.json      typescript devDependency + build/dev scripts
```

## Develop

```bash
npm install      # one time — installs the TypeScript compiler locally
npm run dev      # tsc --watch: recompiles src -> dist on save
```

Then serve the repo root and open the game over http (ES modules won't load
over `file://`):

```bash
# from the repo root
python -m http.server 8000
# open http://localhost:8000/Games/JellyDrift/
```

`npm run build` does a one-shot compile. **Commit the `dist/` output** — it's
what the live site loads.

## Architecture

- `core.ts` — canvas, drawing context, viewport metrics, and shared `world`
  state (camera + bounds). Root of the module graph; imports nothing.
- `input.ts` — keyboard (WASD/arrows) + touch, normalized into an `input`
  intent object read each frame.
- `jellyfish.ts` — the player. Buoyancy + rhythmic "pulse" propulsion, a
  contracting bell, and swaying tentacles, all drawn procedurally.
- `main.ts` — entry/orchestrator: boots the canvas, wires input, runs the
  `requestAnimationFrame` loop, draws the ocean background + HUD.

## Cache-busting

`index.html` loads `dist/main.js?v=<GAME_VERSION>`. Bump `GAME_VERSION` in
`core.ts` and the `?v=` query together on each release.

## Controls

- **WASD / arrow keys** — steer
- **Space** — pulse (a burst of propulsion, on a short cooldown)
- **Touch** — tap to pulse
