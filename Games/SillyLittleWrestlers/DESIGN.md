# SLWF — Silly Little Wrestling Federation

A wrestling game built to early-1990s Sega Genesis / Mega Drive hardware limits,
in the WrestleFest elevated-camera style, with Fire Pro's match pacing and
Wrestling Empire's willingness to let a match end because somebody's leg broke.

This document is the **contract between modules**. The renderer emulates real VDP
constraints, so almost every decision downstream is forced by them. Read the
"Hardware model" section before touching anything that draws.

---

## Hardware model (hard rules)

| Constraint | Value | Where enforced |
|---|---|---|
| Internal resolution | 320x224 (NTSC H40) | `core.VW/VH`, `gfx` framebuffer |
| Scaling | integer only, nearest-neighbour, letterboxed | `gfx.resize` |
| Colour depth | 9-bit RGB, 3 bits/channel, 512 possible | `pal.set` quantizes |
| Palettes | 4 x 16 colours, index 0 transparent | `pal.LUT` |
| Tiles | 8x8, indexed 4bpp | `gfx.tiles` |
| Planes | two scrolling (A, B) + non-scrolling window (W) | `gfx.planeA/B/W` |
| Sprites | <=80 on screen, <=20 per scanline | `gfx.MAX_SPRITES`, `gfx.MAX_PER_LINE` |
| Sprite size | 1..4 tiles each axis (so <=32x32 px) | `gfx.sprite` asserts |
| Timestep | fixed 60 Hz logic, decoupled render | `core.clock` |
| Positions | 8.8 fixed point integers | `core.FP`, all of `ring`/`wrestler` |

**There is no sprite scaling.** The Genesis cannot scale a sprite, which is why
WrestleFest's wrestlers are the same size at the back of the ring as the front —
depth is a vertical offset and a draw-order sort, nothing else. Do not add
scaling to fake perspective; the ring floor trapezoid on plane B sells the angle
on its own.

**Priority is a real bit, not a layer hack.** Draw order is
`planeB -> planeA(low) -> sprites(low) -> planeA(high) -> sprites(high) -> planeW`.
The near ropes are high-priority plane A cells, which is how a wrestler walks
*behind* them without any special case in the entity code.

---

## Load order

Plain classic scripts, no modules, no build step — same convention as GeoSim,
ControlPanel, GutSim, Geodynamo, SocietySim, Criticality, WarpField and
AtomViewer. Load order **is** the `<script>` order in `index.html`:

```
core -> palette -> gfx -> font -> art -> poser -> roster -> moves
     -> ring -> wrestler -> combat -> ai -> audio -> match -> ui -> main
```

Only `main.js` boots. Everything else defines its global and waits. Cache-busting
is a `?v=` query on the stylesheet and every script — bump them together with
`GAME_VERSION` in `core.js` on each release.

One global per file:

| File | Global | Owns | DOM? |
|---|---|---|---|
| `core.js` | `core` | constants, fixed point, RNG, input, clock, screen FX | canvas only |
| `palette.js` | `pal` | 4x16 colour CRAM, 9-bit quantization, fades/flashes | no |
| `gfx.js` | `gfx` | tile VRAM, planes, sprite list, scanline budget, blit | canvas |
| `font.js` | `font` | 8x8 glyphs, text into planes or sprites | no |
| `art.js` | `art` | procedural arena/crowd/FX/weapon tiles | no |
| `poser.js` | `poser` | wrestler frame pixel generation | no |
| `roster.js` | `roster` | the 9 characters, random generation, customization, save | no |
| `moves.js` | `moves` | the frame-data table, move selection by direction+button | no |
| `ring.js` | `ring` | pseudo-3D geometry, collision, ropes, physics integration | no |
| `wrestler.js` | `wrestlers` | entity factory + state machine + animation | no |
| `combat.js` | `combat` | grapples, pins, submissions, injuries, weapons, blood | no |
| `ai.js` | `ai` | CPU state machine, difficulty | no |
| `audio.js` | `sound` | YM2612-style FM music, SN76489-style PSG SFX | no |
| `match.js` | `match` | stipulations, referee, counts, win conditions | no |
| `ui.js` | `ui` | title, select, VS, entrance, HUD, pause, results | no |
| `main.js` | — | scene manager, loop, boot | no |

Import discipline: cross-module references happen **inside functions called after
boot**, never at parse time. `art.init()` needs `gfx` to exist; `main.js` is what
guarantees ordering by calling each `init()` itself.

---

## Fixed point

`core.FP = 8` — one pixel is 256 units. Positions, velocities and the ring's
geometry are all `|0` integers in this space. `core.px(v)` shifts back to a pixel
for drawing. Never store a fractional position as a float "just for this one
thing": the whole point is that a 60 Hz integer sim is bit-reproducible, which is
what makes a desync or a jitter bug findable.

Angles are in 1/256 of a turn (`core.ANG`), sin/cos from a 256-entry table in
8.8. No `Math.sin` in the hot path.

RNG is a seeded mulberry32 (`core.rng`). Match outcomes draw from it, so a seed
reproduces a match. `core.rnd(n)` returns `0..n-1`.

---

## Palette allocation

Four palettes, and they are all spoken for. This is the single tightest budget in
the project and the reason wrestler art is **one shared tileset recoloured per
character** rather than per-character pixels.

- **Palette 0 — arena.** Ring, ropes, posts, apron, floor, crowd, referee.
- **Palette 1 — wrestler A.**
- **Palette 2 — wrestler B.**
- **Palette 3 — UI / FX.** Font, HUD, weapons, blood spray, impact stars.

With more than two wrestlers on screen (3-way, rumble) palettes 1 and 2 are
shared and characters past the second are drawn with the nearest of the two —
an authentic compromise, and the reason the roster's palettes are grouped.

### Wrestler palette index map (indices are a contract — poser writes these)

```
 0 transparent      8 trunk
 1 outline          9 trunkLight
 2 skinShadow      10 bootShadow
 3 skin            11 boot
 4 skinLight       12 accent      (tape, mask trim, logo)
 5 hairShadow      13 bloodDark
 6 hair            14 blood
 7 trunkShadow     15 white       (eyes, teeth, highlight)
```

`roster.applyPalette(palId, char)` fills those 16 slots from a character's five
base colours, deriving the shadow/light ramps. A character is therefore five
quantized colours plus a body description, not a spritesheet.

### Arena palette (0)

```
 0 transparent      8 yellow        (turnbuckles, SLWF apron text)
 1 black            9 floorDark
 2 canvasShadow    10 floorMid
 3 canvasWhite     11 crowdDark
 4 apronBlueDark   12 crowdMid
 5 apronBlue       13 crowdLight
 6 apronBlueLight  14 bloodDark
 7 yellowDark      15 blood
```

The ring is specified: **vibrant blue apron with SLWF in yellow facing camera,
white canvas, black ropes and posts, yellow turnbuckle pads.** The white canvas
exists so blood shows on it.

### UI/FX palette (3)

```
 0 transparent      8 yellow
 1 black            9 green
 2 uiDark          10 cyan
 3 uiMid           11 blue
 4 uiLight         12 magenta
 5 white           13 wood        (tables)
 6 red             14 steel       (chairs, pipes)
 7 orange          15 steelLight
```

---

## Pseudo-3D ring

Three world axes, all in 8.8 fixed point:

- `x` — horizontal, 0 at ring centre, negative left.
- `y` — **depth**. 0 is the centre of the ring; negative is away from camera
  (far), positive is toward camera (near).
- `z` — height off the floor. 0 is standing on the surface the wrestler is on.

Screen projection, and this is the whole of it:

```
sx = px(x) - camX + VW/2
sy = HORIZON + (px(y) * PERSP >> 8) - px(z)
```

`PERSP` is 0.45 in 8.8. No scaling. Draw order is a stable sort on `y` each
frame, so a wrestler nearer the camera occludes one further back.

The ring's playable bounds **narrow with depth** (`ring.bounds(y)` returns
`{minX, maxX}`) so the floor trapezoid and the collision agree. Outside the ring
there is apron, then floor, then the barricade; the floor is a wider box with its
own bounds and a `z` of `-FLOOR_DROP` relative to the ring.

Ropes are four spans per side at three heights. `ring.ropeHit(w)` reports which
rope a moving wrestler crossed; running into one rebounds with velocity reversed
and scaled by `ROPE_BOUNCE`. An Irish whip is the same code path with the
thrower's power folded into the launch velocity.

---

## Frame data

Everything tunable about a move lives in **one table**, `moves.TABLE`, keyed by
move id. Nothing else in the codebase may hardcode damage or timing.

```js
jab: {
  name: 'Jab',          // shown in the move-name flash
  pose: 'jabA',         // poser pose id; its frame count drives animation
  kind: 'strike',       // strike | grapple | run | aerial | ground | sub | weapon | pin
  startup: 4,           // frames before the hitbox exists
  active: 3,            // frames the hitbox is live
  recovery: 7,          // frames before another action is accepted
  dmg: 3,               // health damage
  stun: 10,             // frames of hitstun inflicted
  knock: 0,             // 0 none | 1 stagger | 2 knockdown | 3 launch
  hit: {x:14, y:-30, w:16, h:10},  // hitbox rel. to feet anchor, facing +x
  reach: 20,            // AI's idea of its own range, in pixels
  cost: 2,              // stamina
  part: 'head',         // body part struck — feeds the injury model
  sfx: 'punch',
  fx: 'impactS'
}
```

Frames are 60 Hz integers. `startup + active + recovery` is the total commitment,
which is the only thing that makes a strike readable and a finisher risky.

### Control mapping (Genesis 3-button)

- **A** strike, **B** grapple, **C** run. Direction modifies everything.
- `A` + neutral/forward/back/up/down are five distinct strikes.
- `B` in grapple range enters the tie-up; direction + button picks the move out
  of the winner's table.
- `B+C` on a held opponent is an Irish whip. `C` into a corner or the ropes
  climbs the turnbuckle or steps to the apron.
- 6-button mode adds X (taunt), Y (pick up / use weapon), Z (signature).
- Keyboard P1: arrows + Z/X/C, Enter = Start. P2: WASD + J/K/L, Space.

---

## Poses

The pose name list is the contract between `poser.js` and `moves.js` — a move
names a pose, and the pose's frame count drives its animation. Views are
`front`, `back`, `side`; the eight facings map onto those three with horizontal
flip, which is what the hardware would do.

`poser.render(pose, view, frameIndex)` returns a `Uint8Array(48*48)` of palette
indices 0..15, anchored so the feet are at (24, 47). It is a **pure pixel
function** — it knows nothing about `gfx`. `gfx.defineFrame()` turns that into
tiles, skips blank ones, and splits the 6x6 tile box into at most four hardware
sprites.

Required poses and frame counts:

```
idle 4        walk 6        run 6         limp 4        block 1
jabA 3        jabB 3        kick 3        bigStrike 4   runAttack 3
tieup 2       holdFront 1   holdRear 1    throwWhip 3
suplex 4      slam 4        powerbomb 4   ddt 4         chop 3
heldFront 1   heldRear 1    heldUp 1      heldInverted 1
hurtHi 2      hurtLo 2      stagger 2     knockdown 3
downFace 1    downBack 1    getUp 4
pinTop 2      pinBottom 2   subApply 2    subTaken 2
climb 3       turnbuckleTop 1  diveAir 2  diveLand 1
taunt 3       celebrate 4    entrance 6   dead 1
grabWeapon 2  weaponSwing 3
```

Generation is chunked across frames behind a loading bar — ~100 pose-frames x 3
views is a one-time cost paid at boot, not per match.

---

## Entities and state

A wrestler is one object from `wrestlers.create(charIndex, side)`. Its state
machine is a single `st` string plus a frame counter; `combat.js` is the only
thing allowed to move two wrestlers into a paired state (tie-up, hold, pin,
submission), because paired states are where desyncs live.

States: `idle walking running striking whipped grappling held executing
receiving hurt stagger falling down gettingUp pinning pinned applying
submitted climbing airborne landing taunting celebrating entrance dead`.

Health, stamina and spirit are three separate numbers and they do different jobs:

- **Health** 0..1000. Visible only if the player turns bars on.
- **Stamina** 0..1000, **never shown**. Running and big moves burn it; standing
  still refills it. Low stamina shows as the `limp` walk, slower getups and lost
  grapple contests. This is the Fire Pro feel — the player reads the body, not a
  meter.
- **Spirit** 0..1000. Fills by taking and landing punishment; a finisher needs it
  full. This is what makes a comeback legible.

The match clock counts **up** from zero and is always visible, because with bars
off it is the only way to know how deep into a match you are — exactly how Fire
Pro communicates pacing.

### Injuries

Each limb carries damage (`inj.head/arm/leg/back`). A submission on an
already-damaged limb can break it: the match ends on the spot, the crowd gasps,
and the `bone` SFX plays. This is the one Wrestling Empire mechanic worth
stealing wholesale, and it is why `part` is in the frame-data table.

---

## Stipulations

`match.wrestlers` is an **array**, never `p1`/`p2`. Three-ways and rumbles then
cost almost nothing beyond the palette-sharing compromise noted above.

Exhibition, Hardcore (weapons live, no DQ), Tables, Ladder, Cage, 3-Way Dance,
Royal Rumble. Weapons are *found*, not modelled as inventory: `combat.weapons`
spawns from under the ring or over the barricade — chair, pipe, hockey stick,
beer bottle, trash can, kendo stick, barbed bat, tacks, table, ladder.

---

## Verification

`tools/check.mjs` loads the browser scripts into a node `vm` and checks the
things that are easy to break silently: every colour is on the 3-bit grid, every
palette index referenced by generated art is in range, the sprite-per-scanline
budget is actually enforced, every `moves.TABLE` entry names a pose that exists
with enough frames, every pose renders in-range indices, fixed-point round trips,
and that a seeded match replays identically. Re-run it after touching the
renderer, the pose list or the move table.

---

## Current state

Everything in this document is built and running. `tools/check.mjs` passes 93
checks, including a full CPU-vs-CPU match that replays identically from a seed.
Matches between two hard CPUs finish by pinfall in about three to four minutes
with near-falls; an easy pair can go ten with blood and a knockout.

### What the 0.2.0 polish pass changed, and why

- **Input is buffered.** A press during hitstun or the tail of a move is
  remembered for eight frames (fourteen for grapple) and fires the instant the
  wrestler can act. Nothing else about the controls mattered as much: before
  it, every input that landed a frame early was simply discarded.
- **Grapple lunges.** Pressing grapple from just outside range steps you in
  and the buffered press completes the tie-up when the gap closes, instead of
  doing nothing at all.
- **Strikes square up first.** The facing snaps to the opponent *before* the
  direction is read, so "toward them" always means the same move.
- **Double-tap a direction to run**, as well as holding C.
- **Depth movement was a quarter of the horizontal rate on screen** and felt
  like wading; `DEPTH_SCALE` went 150 → 210.
- **Shadows.** Three sizes, picked by height off the ground, because the
  hardware cannot scale a sprite and without one a jump and a step toward the
  camera look identical. Drawn in the UI palette: the arena's only mid grey is
  the tone the canvas weave uses, so an arena-palette shadow is invisible on
  the surface it most needs to show up on.
- **Eighteen of twenty-eight named effects did not exist**, and eleven of
  sixteen named sounds did not either. `moves.js`, `art.js` and `audio.js` were
  written against each other by string equality and nothing checked it, so
  most hits landed silently and invisibly. Both files now carry an alias table
  and the harness asserts every name resolves.
- **Crowd pops** on a big move and a near-fall, via three palette entries.
- A **white frame** on anything over 45 damage, a **shock ring** on every
  knockdown, dust on landings and run starts, and sweat when a wrestler is
  spent.
- **The CPU knows to beat the count.** Two CPUs who spilled outside used to
  brawl there until the referee counted them both out, which is a real finish
  and a dreadful one to get every match.
- **Going over the ropes requires pushing into them**, not merely sliding
  along them, for a full 26 frames.

### Known rough edges, in the order they are worth looking at

1. **The entrance is thin.** The wrestler walks in under player control and
   their name and taunt appear; there is no per-character entrance animation
   yet, and `char.entranceAnim` is carried through the roster but unused.
2. **Stipulations past Exhibition and Hardcore are only partly exercised.**
   Tables, Ladder, Cage, 3-Way and Rumble all start and run, but the table and
   ladder props are scenery and nothing yet puts a wrestler *through* one.
3. **The roster editor cannot really type a name.** It appends and deletes
   characters rather than letting you pick each one, which is worse than the
   console-era wheel it is imitating.
4. **Blood is still rare** outside long matches. `BLEED_AT` is 340 in
   `wrestler.js` against roughly 300 head damage in a three-minute match.
5. **No rope flex.** A wrestler rebounding off the ropes gets a sound and a
   velocity reversal but the ropes themselves do not move; doing it properly
   means swapping tile content the way the crowd animation does.
