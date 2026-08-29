# Intergalactic Traffic Simulator — design notes

A client-only incremental game. The player is a **route authority**: a logistics
regulator who owns nothing and licenses everything. They survey endpoints,
charter routes between them, assign fungible tonnage, and watch the physics
decide what any of it is worth.

The conceit is that every wall in the game is a *physical* one. The player is
meant to feel the rocket equation, then special relativity, then the exotic
matter budget, then cosmological expansion — each personally, each as a number
that stops responding to money.

---

## 1. The open decisions, decided

The brief left four calls open. Here they are, with reasons.

### React vs. plain TS

**Plain TypeScript with hand-written DOM updates.** No framework, no signals
library.

The UI is a table of numbers that changes 12 times a second, and up to 500 rows
of it. A virtual DOM's job is to work out *what* changed; here the answer is
"every number in every visible row, every frame", so the diff is pure overhead.
The views instead build their nodes once and hold direct references, and
`update()` walks that array calling `setText`/`setClass`, both of which no-op
when the value is unchanged (`src/ui/dom.ts`). That is the entire reactivity
system and it fits in forty lines.

The discipline this buys has to be enforced by convention: **`update()` may
never create or destroy a DOM node.** Structure changes go through
`rebuild()`, which fires only when `sim.structureVersion` bumps.

### Ship classes: ladder or sidegrades

**Sidegrades within tiers**, and they balance themselves.

Each era offers a bulk hull and a fast hull. What makes this cost nothing to
tune is that the payload formula already discriminates between them:

```
payloadFraction = exp(-Δv / vₑ) - structuralFraction
```

A Bulk Hauler carries 6.5× a lighter's mass at 2× its structural fraction. On
the Luna run, `exp(-Δv/vₑ)` is around 0.19 and losing 0.155 to structure still
leaves something; the hauler wins on raw tonnage. On the Callisto run
`exp(-Δv/vₑ)` has fallen below 0.155 and the hauler's payload fraction goes
*negative* — it cannot carry itself there — while the Fast Courier, at 0.042
structure, still delivers. So bulk wins the short hops and couriers win the hard
ones, **and the crossover moves outward every time the engine line advances**,
with no per-class balancing pass. The `rttMult` field is the second axis:
couriers cycle at 0.55× the round trip, which matters enormously while transfer
windows still gate income and much less afterwards.

Re-hulling a route **retires its tonnage** rather than converting it. Without
that, every certification would be a free fleet-wide upgrade and the choice
would be meaningless.

### Does Interdiction exist in every era

**Yes, in all five.** It is not replaced by exotic matter scarcity; they do
different jobs.

Interdiction is the "you cannot only build economy" pressure, and that pressure
is not era-specific. Exotic matter is a *supply chain* — science routes make it,
warp routes burn it, and running dry throttles the network — which is a
different shape of constraint and would leave a hole if it replaced Interdiction
in era 3.

The formula is deliberately scale-free, which is what lets one mechanic serve
thirty orders of magnitude:

```
I_target = max(0, log10(grossCredits/s) - log10(security/s) - freeDecades) * 0.95
penalty  = 1 / (1 + I)
```

Because it compares *logs*, a player who keeps roughly 5% of throughput on
military routes stays clear forever, and one who ignores military routes pays a
penalty that grows by about one order of magnitude of income per order of
magnitude of neglect. `I` eases toward its target over ~40 sim days rather than
snapping, so the meter reads like a consequence and not a light switch.

### How many Sol nodes

**Eighteen** (`src/sim/data/solNodes.ts`), at the top of the brief's 12–18 range.

The count is set by the Δv ladder, not by taste. Era 1 needs enough rungs that
each engine certification visibly opens new ground: chemical reaches Luna and
the near-Earth rocks, NTR opens Mars and Phobos, ion opens the belt, VASIMR the
Jovian and Saturnian systems, and the fusion torch everything else. Five engines
× roughly three or four newly-viable endpoints each is eighteen. Fewer and an
engine purchase unlocks one thing; more and the survey list becomes list
management before the player has filters.

---

## 2. Architecture

```
src/
  core/      num.ts (Decimal + geometric-cost algebra), format.ts, rng.ts, — no game knowledge
  sim/       constants, types, nodes, routeMath, modifiers, engine, actions, state
  sim/data/  solNodes, ships, upgrades, tech      — content, no logic
  save/      save.ts, migrations.ts               — persistence, no game knowledge
  ui/        app, ctx, dom, icons, art, and one file per view
  main.ts    boot, the fixed-timestep loop, autosave, offline
```

The dependency direction is strictly `ui → sim → core`. Nothing in `sim/`
touches the DOM; nothing in `core/` knows what a route is. `save/` deliberately
knows nothing about defaults — it rehydrates what is in the file and
`state.ts:hydrateDefaults` fills the shape in, so there is exactly one place
that knows what a new charter looks like.

### The tick is a pure function of `(state, dt)`

`engine.ts:tick(sim, dt)` takes **real** seconds and advances everything.
Offline progress calls the identical function with a larger `dt`
(`actions.ts:applyOffline`). This is not an optimisation — it is the only way
the two can be guaranteed to agree, because there is no second implementation to
drift out of step.

`dt` is fixed at 1/20 s online. `main.ts` accumulates real elapsed time and
runs whole ticks, capped at `MAX_CATCHUP_STEPS` per frame so a backgrounded tab
cannot return and try to simulate a minute inside one frame. A gap longer than
two seconds is not made up at 20 Hz at all: it is routed through the same
coarse catch-up loop offline uses.

### What is cached and what is not

Solving a route is ~40 floating-point operations and a handful of `Decimal`
multiplies. Doing that 500 times, 20 times a second, would be most of the frame
budget for numbers that only change when the player buys something.

So `refresh(sim)` solves every route into a parallel `RouteCache[]` and is called
only when `sim.dirty` is set — by a purchase, a tech, an era change. The tick
itself does one `Decimal` multiply and one add per route, plus one multiply per
region. Every action goes through `markDirty` / `markStructure`; forgetting one
is the failure mode to watch for, and it presents as a purchase that appears to
do nothing until the next one.

`structureVersion` is separate from `dirty` because the UI needs to know the
difference between "a number changed" (repaint text) and "the route list
changed" (rebuild rows).

### Determinism

Every random draw goes through `core/rng.ts` (mulberry32) seeded from the save.
There is no `Math.random()` in `sim/`. The procedural galaxy, Local Group and
multiverse are generated from `state.seed` at boot, so the same save always gets
the same universe — including node names, distances, hazards, and the rolled
physical constants of era 5.

### Persistence

`state → JSON (Decimals as strings) → version stamp → lz-string → base64 →
localStorage`. Decimal fields are enumerated in an explicit table
(`ROOT_DECIMALS`, `STATS_DECIMALS`, and `routes[].ships`) rather than discovered
by walking the object, so adding a Decimal field without registering it is a
compile error rather than a save that silently writes `[object Object]`.

`migrations[n]` takes a save at version `n` and returns one at `n+1`, applied in
a chain. The chain is empty today; it exists now so that the first schema change
is a five-line addition rather than an archaeology project. Import accepts both
a compressed blob and raw JSON, because players paste both.

---

## 3. The route model

Everything in the game is a modifier on one object.

```
payloadFraction = exp(-Δv / vₑ) - structuralFraction
payloadPerShip  = wetMass * max(0, payloadFraction)
throughput      = payloadPerShip * shipCount / roundTripTime
income          = throughput * valueDensity(kind) * multipliers
```

**Why this formula carries the whole game.** `exp(-Δv/vₑ)` means an engine
upgrade is worth an order of magnitude where `Δv/vₑ` is large and almost nothing
where it is small. So the same purchase transforms the Kuiper charter and does
nothing perceptible to the Luna one — automatically, with no per-route tuning
and no scripted "this unlock reveals that content" table. The player discovers
which purchases matter by looking at their own routes.

Route Δv is `|dv(a) - dv(b)| + 1500`, where `dv` is each endpoint's budget from
LEO. A pleasant consequence: chaining outward hops is cheaper than one long
jump, so hub-building is rewarded without a tutorial saying so.

Route distance is the law of cosines over the two endpoints' map directions, so
the length the map draws and the length the physics uses are the same number.

### Era 1 — transfer windows, and the arc out of them

Round-trip time is a real conjunction-class mission profile:

```
t_transfer = π √((a₁+a₂)³ / 8μ☉)
T_syn      = 1 / |1/T₁ - 1/T₂|
wait       = (T_syn - 2·t_transfer) mod T_syn
rtt        = 2·t_transfer + wait·(1 - continuity) + overhead
```

Earth–Mars comes out at 259 days each way, a 780-day synodic period, and a
782-day round trip — which is the real answer, and at 10 sim-days per second of
play it is a 78-second cycle. Luna is under a second. The Kuiper belt is 110
years, and **no engine upgrade fixes that**, which is era 1's wall.

Two orthogonal upgrade lines act on this and they do genuinely different things:

- **Continuity** (`Continuous-Thrust Trajectories`, then `Cycler
  Infrastructure`) removes the *wait*. It raises average income.
- **Smoothness** (`Departure Staggering`, `Unified Traffic Control`, and the
  repeatable `Fleet Staggering`) does **not** change average income at all. It
  changes how the income arrives.

The tick pays out `smoothness · dt + (1 - smoothness) · rtt · completions`.
At smoothness 0 a route pays a lump when a round trip closes; at 1 it pays
continuously; over a full cycle the two integrate to exactly the same total.
That transition from spiky to idle-smooth is the emotional arc of era 1 and it
costs the model nothing to express.

Note that a *faster ship does not escape the window* — the wait is recomputed
from the actual transit, so arriving early just means waiting longer. That is
correct orbital mechanics and it is the thing that makes Cycler Infrastructure
feel like a revelation rather than a percentage.

### Era 2 — an actual optimum velocity

Windows cease to exist. Distance becomes the cost, and the player gets one real
decision per route: a velocity slider.

```
lossCrew = CREW_K · (1/γ) / β      crew are paid in proper time τ = t/γ
lossFuel = FUEL_K · (γ - 1)        fuel is (γ-1)mc² per trip
netMult  = max(0, 1 - lossCrew - lossFuel)
income   ∝ β · netMult
```

Both terms are expressed **per unit of throughput**, which is what keeps them
meaningful across thirty orders of magnitude of economy — an absolute crew wage
would be irrelevant within an hour. At the default coefficients the optimum sits
near β ≈ 0.99, `netMult` peaks around 0.87, and by β = 0.9999 the fuel term has
eaten the entire route. There is a genuine interior maximum, it moves when the
player buys `Reaction Mass Contracts` or `Crew Rotation Scheme`, and
`optimalBeta()` finds it by a geometric scan dense near c.

The wall is that γ diverges and the velocity cap approaches c asymptotically and
never arrives: `betaCap = 1 - 0.65·0.86^level`.

### Era 3 — the exotic matter budget

Apparent velocity is unbounded because nothing moves through space. Upkeep is
not:

```
exoticDraw = EXOTIC_K · w³ · bubbleVolume · ships     (per hull on station)
```

Charged **per hull, not per delivery** — a bubble held open by an empty ship
costs exactly what a full one costs. Science routes are the only source. If draw
exceeds production plus stock, `sim.throttle` falls below 1 and every route in
the network scales down together, which is the correct behaviour for a shared
resource and reads immediately as a supply crisis.

`w³` is what makes the velocity slider interesting again: doubling warp factor
octuples the bill.

### Era 4 — the expansion

```
v_rec   = H₀ · d · recFactor
closing = w·c - v_rec
```

Beyond the Hubble radius (about 14.4 billion light years, and the node list runs
out to 46) comoving targets recede faster than warp closes the gap, and the
route reports `RECEDING` and earns nothing until the warp cap is raised. This
is the intended grind era, and it is made legible rather than mysterious: the
route table states the reason, the survey list is ordered by distance so the
next affordable endpoint is always the next one out, and the warp cap upgrade
says exactly what it buys.

`recFactor` is the one honest abstraction in the model. Comoving station-keeping
and route pre-positioning do not slow the expansion; they stop you paying for it
twice. It is a game knob wearing a plausible hat, and it is the only one.

### Era 5 — rolled constants

Each universe node carries `{c, α, G}` drawn log-normally, and they act as
multipliers on the *existing* build rather than as a new subsystem: `c` scales
exhaust velocity and apparent warp factor, `α` scales value and research
density, `G` scales structural fraction. So a slow-light, heavy universe
punishes the propulsion line and rewards structures, and the era-1-through-4
build has to be re-evaluated per destination. That is the endgame's replay
value, and it required no new mechanics — only three numbers threaded into
`solveRoute`.

`terminus` is the ending milestone. It concludes the charter and the game
continues afterwards.

---

## 4. Economy and pacing

### Value densities

Set in `constants.ts` and quoted in credits per kilogram **per sim second**.
They look tiny because throughput does not: one Standard Lighter on the Luna run
moves about 5 tonnes per real second, so `TRADE_DENSITY = 1e-4` makes it worth
roughly 0.6 credits/s. That is the anchor the whole curve is built from — the
first additional hull costs 19 and is therefore about thirty seconds away, which
is the target opening cadence.

```
trade    1.0e-4    science  0.3e-4 credits + 1.2e-5 research
military 0.2e-4 credits + 2.0e-5 security
```

Science pays about a third of trade in credits, which is the price of Research —
the only currency a Recharter does not take away.

### Cost curves

Repeatables use `cost(n) = base · r^n` with `r` between 1.108 and 1.19. Ship
ladders sit at 1.055–1.078 so hull counts reach the hundreds rather than the
tens. `Charter Ceiling` is deliberately steep at 1.36: it gates how wide the
network can get, and width is the strongest multiplier in the game.

Buy-max is solved in closed form (`core/num.ts:geomBuyMax`) rather than looped,
because a loop is what makes a late-game "buy max" button hitch.

**Cost growth must exceed benefit growth.** Two upgrades shipped violating that
and were caught by the pacing harness, not by reading the table: `Tariff
Schedule Revision` gave +13% income for a 1.125 price step, and `Metric Gradient
Licence` gave +35% throughput for a 1.185 step. An upgrade whose benefit
outruns its own price is not an expensive upgrade, it is a free one, and the
naive-player run reached 1e28 credits inside thirty minutes. They are now 1.17
and 1.45. The one deliberate exception is `Specific Impulse Program`: its
*nominal* +8% is under its 1.115 step, but because it moves the exponent in
`exp(-Δv/vₑ)` its *effective* return is far larger while `Δv/vₑ` is large — a
bounded runaway that switches itself off as vₑ rises, which is the entire
intended shape of era 1.

### Prestige

```
mandate = floor(0.08 · lifetimeCredits^(1/3) · precedentMultiplier)
```

Cube root, per the brief, and the reason is worth restating: with a `Decimal`
economy spanning thirty-plus orders of magnitude, a square root produces a
meta-currency that is itself unmanageable.

`MANDATE_K` is **fitted, not guessed.** `tools/check.ts` drives a naive player
to the era-2 authorisation and reports lifetime credits at that moment: about
1.8e7. The cube root is ~264, so 0.08 makes a first Recharter worth **21
Mandate** — enough to buy several Institutions at once, few enough to stay a
number a person can hold in their head. The first version used 0.0022 against a
guessed 1e12 charter and would have paid out **zero**.

A Recharter **keeps** Research, technology, era unlocks, Mandate and
Institutions; it **loses** routes, tonnage, credits, credit-bought upgrades and
Interdiction. The Stats view lists both columns explicitly before asking for
confirmation, because a prestige that surprises the player is a bug.

### Offline

Base cap 8 hours, raised 4 hours per level of `Continuity of Operations` to a
ceiling of 72. Computed by running `tick` in a fast-forward loop of at most
12,000 steps, and reported in an explicit "while you were away" modal — players
distrust silent offline gains, correctly.

---

## 5. Verification

`npm run check` bundles `tools/check.ts` with esbuild and runs it under Node. It
is not a test framework; it prints numbers and exits non-zero when a hard
invariant breaks. It covers the things a screenshot cannot show, and it has
already caught three real bugs (a `Date.now()` in route-id generation that broke
determinism, and the two runaway cost curves above).

Current output, on this build:

```
determinism      same seed + same inputs = identical state after 4000 ticks
offline          60 s at 20 Hz vs 0.5 s steps agree to 0.000%
era 1            chemical reaches Luna (0.111) and cannot reach Callisto (-0.047)
                 hauler beats courier to Luna (4.0 t vs 2.1 t)
                 hauler is dead to Ceres while the courier still carries
                 Mars round trip 782 d = 78 s of play
                 Kuiper round trip 110 yr = 67 min of play   <- the era 1 wall
                 cycler infrastructure cuts Mars to 520 d
era 2            optimum beta 0.96738c, interior; cheaper fuel moves it to 0.98811c
era 4            Hubble radius 14.0 Gly, furthest node 45.9 Gly and receding
                 60 levels of warp licence make it viable again
save             round trip exact, including a 1.2345e678 balance, 860-char blob
performance      tick 0.091 ms at 486 charters (budget 2 ms), refresh 0.53 ms
pacing           era 2 authorised at 8.8 min, 1.8e7 lifetime, 21 Mandate
```

The pacing figure deserves a caveat: that bot buys the cheapest useful thing
every single second and never hesitates, so 8.8 minutes is a **floor** on era 1,
not an estimate of how long a person takes. It is the number to watch if the
curve is retuned.

## 6. Performance

Target: 60 fps render, under 2 ms per sim tick at 500 routes. Measured: **0.091
ms at 486 charters**, twenty-two times under budget.

- **The tick does no route solving.** See §2. Per route per tick: one `Decimal`
  multiply, one add, and a phase advance in plain floats.
- **The route table is paginated at 50 rows**, and rows are recycled rather than
  rebuilt. Sort order is resolved when the structure changes, not every frame —
  re-sorting live income at 12 Hz would make rows swap under the cursor.
- **Views repaint at 12 Hz, the resource bar at frame rate.** A 500-row table at
  60 Hz is 30,000 DOM writes a second for digits nobody can read that fast.
- **Views mount lazily.** The map builds a canvas and the network view builds a
  page of cards; neither happens before the tab is opened.
- **The map is one canvas.** Ships are decorative particles, capped at ~12 per
  route and ~600 total, drawn in batched paths by style. Unsurveyed nodes are a
  culled point cloud. There is never a DOM node per ship.
- Numbers are `Decimal` (`break_infinity.js`) for every currency, cost and
  production value, from the first commit. Time, positions and physics constants
  are native `number`, because none of them needs the range and all of them are
  in hot loops.

---

## 7. Accessibility

- Full keyboard navigation: `1`–`7` switch views, `S` saves, every control is a
  real `<button>`/`<input>`/`<select>`, and the modal traps and restores focus.
- `prefers-reduced-motion` is honoured by the stylesheet and by the map, which
  draws its particles stationary rather than animating them. There is also an
  in-game toggle, because the OS setting is not always the whole answer.
- **No information is conveyed by colour alone.** Route kinds carry text tags
  and, on the map, distinct dash patterns. Affordability, locked/owned state,
  sort direction, and dead routes all carry a glyph or a word.
- Number formatting offers scientific, engineering and short-scale notation.
  Physical quantities get SI prefixes (`fmtSI`) because "12.4 km/s" means
  something to this audience; masses are quoted in tonnes rather than megagrams
  for the same reason.

---

## 8. Build and deployment

```
npm install
npm run dev      # vite dev server
npm run build    # tsc --noEmit && vite build  -> dist/
npm run check    # headless determinism / physics / perf / pacing checks
```

`base` is `'./'` in `vite.config.ts`, so the bundle works from the domain root,
from `/<repo-name>/`, and from any subdirectory with no rebuild. `dist/` is
committed, matching the JellyDrift convention in this repository — it is what
the live site actually loads. Never hand-edit it.

**The live URL is `/Games/IntergalacticTraffic/dist/`**, not the project root.
Unlike the tsc-only projects here, Vite treats the root `index.html` as a source
file — it references `/src/main.ts` and only works under the dev server. The
built page, with hashed asset names, is the one inside `dist/`. The landing page
links there directly rather than to a redirect stub, because a stub is a second
thing to keep in step and this is a URL nobody types by hand.

No backend, no accounts, no network calls at runtime. The stylesheet, the icons
and all art are inline or bundled; nothing is fetched.

---

## 9. Milestone status

| | |
|---|---|
| **M0** vertical slice | done — LEO/Luna/Mars, throughput formula, tick loop, save/load |
| **M1** Era 1 complete | done — 18 Sol nodes, five-engine line, window→continuous arc, three route kinds, Interdiction |
| **M2** prestige + Era 2 | done — Recharter, Mandate, relativistic routes with the velocity slider |
| **M3** automation + Era 3 | done — procedural galaxy, exotic matter, filtered/paginated bulk UI |
| **M4** Eras 4 and 5 | done — expansion mechanics, rolled constants, ending |

### Known soft spots, honestly

- **The mid-era-3 curve is the least playtested stretch.** The exotic matter
  ratio (roughly one science hull per thirty warp hulls at default coefficients)
  was derived arithmetically rather than found by playing, and is the first
  number to check if era 3 feels either trivial or airless.
- **Automation is deliberately modest.** `auto-assign` buys one hull per pass on
  the best marginal-income-per-credit route; `auto-charter` and `templates` are
  researched but their effect is currently limited to velocity optimisation and
  assignment. Full policy-level automation is the obvious next increment and the
  hooks (`mods.autoCharter`, `mods.autoOptimise`, `runAutomation`) are in place
  for it.
- **Era 5 currency arbitrage is present as drifting per-universe value
  multipliers, not as an active trading layer.** The brief marked that layer
  optional; `state.fx` exists and is unused, which is where it would go.
