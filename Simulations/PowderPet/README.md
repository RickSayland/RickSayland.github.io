# Powder Pet

A Tamagotchi-style virtual pet that lives inside a falling-sand simulation.

The pet is not a sprite. Its body is 60 to 150 particles of four tissues held
together by physical constraints, so it is rigid where it has bone, squishy
where it has meat and sloshy where it has blood. The sand it stands on is a
cellular automaton with a temperature field. Radiation is a third layer of
individual alphas, betas, gammas and neutrons ray-marched through both, in the
manner of The Powder Toy. And every animal is built from a genome it passes
on, mutated, to the one egg it lays, with a mutation rate that climbs with the
dose its parent absorbed.

## Running it

It is a static page: plain HTML, CSS and vanilla JavaScript ES modules, with no
build step, no dependencies and no external assets. Every path is relative,
so it works from any subpath (`username.github.io/repo/Simulations/PowderPet/`).

ES modules do not load over `file://`, so opening `index.html` by
double-clicking it shows a blank tank and a CORS error in the console. Serve
the folder over http instead:

```bash
python -m http.server 8000
```

then open `http://localhost:8000/`. Any static server does the same job.

## Playing

| | |
|---|---|
| **Feed** | pours food for about a second, a little ahead of the pet |
| **Clean** | pours water: dissolves waste, washes radioactive dust off the skin |
| **Play** | drops a bouncy ball (the same soft-body solver) for it to chase |
| **Share** | copies a link carrying this pet's genome |
| **Lights** | lights out: the pet lies down and sleeps, and you can see what glows |
| **Medicine** | restores health, speeds healing, flushes some swallowed contamination; has a cooldown |
| **Sandbox** | paint materials with the pointer: Basic / Nuclear / Tissue tabs |
| **Lineage** | every ancestor, drawn from its genome; also *Breed with link* |
| **Debug** | particles by tissue, constraints by strain, dose-rate and temperature maps, counts, fps |

Drag the pet to pick it up by the skin on a spring. Tap an incubating egg to
hurry it. The speaker button turns on the Geiger counter and the squish
sounds; it starts muted.

Things worth trying:

- Pour sand on its back and watch it flatten; bury it properly and it gets hurt.
- Paint **Polonium** next to it: nothing happens, an alpha cannot get through
  skin. Mix a few grains into its food and it will not survive the day.
- Paint **Radium** and turn on Debug: the gammas go straight through it. Put a
  wall of **Lead** between them.
- Pour **Uranium** in a heap: it sits there. Pour the same heap into a deep
  pool of water and stand back. Paint **Absorber** into it to shut it down.
- **Plutonium** needs no water, only enough of itself in one place.
- Irradiate an adult a little before it lays, then look at what hatches.

## How it is put together

Three coupled layers, stepped at a fixed 30 Hz and drawn at the display rate.

```
js/config.js      every tunable constant
js/materials.js   the material table (data-driven)
js/grid.js        ENVIRONMENT: the falling-sand automaton
js/heat.js        ENVIRONMENT: the temperature field
js/radiation.js   RADIATION: the energy-particle pool and its transport
js/softbody.js    CREATURE: the XPBD constraint solver
js/genome.js      encoding, mutation, genome -> body plan
js/creature.js    tissues, muscles, AI, stats, lifecycle; the egg and the ball
js/coupling.js    everything that crosses between the grid and a soft body
js/ui.js          buttons, overlays, pointer input, audio
js/save.js        localStorage persistence and offline fast-forward
js/main.js        bootstrap and the game loop
```

The dependency direction is `main -> ui / save -> coupling -> creature ->
softbody / genome`, with `grid`, `heat`, `radiation` and `materials`
underneath. Only `ui.js` and `main.js` touch the DOM.

### Environment

A 200x150 grid of material ids in typed arrays, updated bottom-to-top with the
horizontal scan direction alternating each tick. One rule moves everything: a
grain may enter an empty cell or swap with a lighter liquid or gas, which is
why sand sinks through water and steam bubbles up through it. Temperature
diffuses by pairwise exchange between neighbours (conserving energy, with the
smaller of the two conductivities), and every cell relaxes toward ambient at
its material's own rate. Hot cells glow.

A material is one row in `materials.js`: how it behaves as sand, how it
carries heat, and what each kind of radiation does in it. Adding a material is
adding a row, plus an `update` function only if it reacts with its neighbours.

### Creature

`softbody.js` is XPBD in the small-steps form: eight substeps a tick, one
constraint projection each. Stiffness is a compliance (alpha = 1/k) and the
solver is stable at any value of it, including zero, so the four tissues are
the same code with different numbers:

- **Bone**: near-zero-compliance links plus stiff shape matching (best-fit
  rotation by polar decomposition), a rigid core that still moves freely.
- **Meat**: a lattice between bone and skin on medium-compliance links, with a
  much weaker shape match, so it jiggles and recovers. It makes the body heat.
- **Blood**: loose particles with repulsion and mild cohesion, projected back
  inside the skin, except across a broken skin edge, where it leaks out and
  becomes BLOOD cells.
- **Skin**: a closed ring with stretchy edges, soft spokes to the flesh, and a
  2D area constraint, so the body squashes without deflating.

Locomotion is muscle and nothing else. Each foot pad hangs off the two ends of
the spine by two constraints whose rest lengths are driven rhythmically, a
planted foot grips and a swinging one slides, and the animal moves because the
solver would rather move the skeleton than the foot. No position is ever set.

### Coupling

Each tick the skin polygon is scanline-filled into the grid as `BODY` cells,
and whatever loose material it now covers is moved to the nearest empty cell
by breadth-first search, never deleted. Skin in a solid cell is pushed out
along the occupancy gradient with Coulomb friction. Powder lying on the animal
weighs on it; water lifts and chills it; its skin warms what it touches.

### Radiation

Up to 4000 particles in a struct-of-arrays pool. Each carries the optical
depth it has left before its next interaction (`tau = -ln U`), spends it at
`mu` per cell of path along a DDA ray-march, and where it runs out the
material's branching ratios decide between absorption, scatter, fission,
thermalisation and activation. Criticality is not scripted anywhere: a chain
reaction happens when the neutrons from one fission cause more than one more
before leaking or being captured, and whether they do depends on the geometry
you built. If the pool fills, every source in the tank is throttled together
rather than frames being dropped.

A hit inside a `BODY` cell goes to the nearest particle of a tissue that type
can reach: an alpha stops in skin, a beta gets to meat, gammas and neutrons
reach bone and blood.

### Genome

A fixed array of 28 genes, each a float in [0,1] mapped onto a physical range
in `config.js`: size, proportions, spine and limb counts, tissue compliances,
blood volume, colours and pattern, eyes, gait, metabolism, comfort
temperature, radiation sensitivity, lifespan and temperament. The same genome
always builds the same animal.

A share code is the genes quantised to 6 bits each, packed and written as
base64url after a format version: `1.` followed by 28 characters. `Share`
copies `...#g=<code>`; opening such a link offers to hatch it or to breed
your pet with it.

One animal at a time. A well-fed adult with stored mass lays one egg (and
visibly shrinks). The egg lies dormant until its parent dies, then incubates.
Its genome is the parent's (uniformly crossed with a mate's, if you gave it
one) plus Gaussian noise per gene whose sigma is a base rate plus a term
proportional to the parent's cumulative dose at laying, with an occasional
single-gene jump.

### Persistence

Everything is saved to `localStorage` every ten seconds and when the tab is
hidden: the grid (run-length encoded), the temperature field, energy particles
in flight, the whole animal down to per-particle dose, the dormant egg, the
lineage, and a timestamp. On load the time away is fast-forwarded: stats decay
but never past a floor (a pet survives a weekend), radioactive cells decay
analytically (each survives with probability `2^(-t/T)`), and the animal keeps
accumulating dose from the rate it was in, dying away with the half-life of
the sources. Saves are versioned; one from another version is discarded.

## Tuning

Every number that changes how the toy plays is in `js/config.js`, with units
at the top of the file. The material table is in `js/materials.js`.

## Checks

```bash
node tools/check.mjs            # everything, about a minute
node tools/check.mjs dose       # one section (or several: "soft body,save")
```

`tools/check.mjs` loads the real modules behind a stub DOM, drives the real
game loop, and measures what happened: genome round-trips and determinism,
conservation of sand, Beer-Lambert attenuation, cell half-lives, which piles
go critical and which do not, whether random animals can stand, walk both ways
and survive a fall, what radiation reaches which tissue, the whole life cycle
from egg to grandchild, and that a save comes back particle for particle.
Re-run it after touching the solver, the gait, a cross section or the tick.

`window.powderpet` in the browser console is a development handle:
`powderpet.step(n)` advances the same tick and render the loop does, by hand,
and `powderpet.wipe()` clears the save.

## Honest limits

- Half-lives, cross sections and doses are gameplay numbers chosen so things
  happen in seconds and minutes. The mechanisms are real; the magnitudes are not.
- The world is two-dimensional, so a "critical mass" here is a critical area.
- The animal cannot turn round in two dimensions, so it does not flip: the
  rest shape morphs head-to-tail and the face slides across.
- A few body plans walk badly, especially as hatchlings. The animal notices
  and tries a different gait, which usually but not always helps.
- Ageing only runs while the page is open, apart from a small allowance for
  time away.
