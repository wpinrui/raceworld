# The race view in real 3D

> Authored 2026-07-31, the day the frame-rate campaign was reverted in full. The decision it records:
> port the race view straight to real 3D (three.js), not to a faithful WebGL re-implementation of the
> 2D picture. The 2D canvas renderer stays untouched and keeps shipping until increment 5 swaps it out;
> until then it is the parity reference, through `scripts/scenery-preview.ts`.

## Status

| Increment | State |
|---|---|
| **1** — ground truth: the road on the ground, previewable | **Done.** `8066744` |
| **2** — the world stands up: structures, trees, light | **Done.** `5f59773` |
| **3** — the surface keeps its story: ink as decal geometry | **Done.** Compiled, not baked: the ops were already polyline strokes, and merged static ribbons are exact at every zoom with no bake pass and no texel budget. `roadInkUnder`/`roadInkOver` + `ops3d.ts` |
| **4** — cars: impostor, then the parametric loft | **In progress.** Impostors landed (`--cars` on the probe); the loft's first draft renders via `scripts/car-preview-3d.ts`, height profile now iterating on turntable stills |
| **5** — the live view swaps | **Done.** Everything visual is in-scene (world, ink, cars, boards, crews, pit furniture) and the camera is a free perspective orbit: left-drag tilts and turns (keeping the follow lock), middle-drag pans the free camera, wheel zooms at the pointer, ground clicks release the lock, and a px/m readout sits by the reset. At pitch 0 the projection matches the old orthographic transform exactly (pinned by test), so the DOM overlay (hit boxes, labels, cards) rides per-frame projection through the same camera the frame is drawn with. Loose end: `SceneryCanvas`/`drawScene` are unmounted but not yet deleted; retire with increment 6 |
| **6** — moods and night, with real lights | Not started |

## Why straight to 3D

The canvas renderer replays the whole op list every frame the camera moves: 2,889 to 7,362 items per
circuit (measured 2026-07-31 via `scenery-preview`), each op re-parsed through `new Path2D()`, every
gradient and pattern rebuilt per op per frame. That is the 24fps floor, and it is CPU work a GPU
renderer simply does not do.

A faithful WebGL port of the 2D picture would have to re-implement exactly the machinery a 3D port
deletes: the `viewAz`-baked oblique extrusion (and the 120ms `settleRot` rebuild on rotation), the
baked shadow polygons, the sheen counter-rotation on the cars, the order-critical painter batching.
Meanwhile everything underneath is already 3D-shaped: `extrude.ts` knows every footprint and height
and flattens them; `lighting.ts`'s four scalars are a directional-light spec; `lap-dynamics.ts`
already produces the accelerations the car fakes are driven by. Going straight to 3D un-flattens
instead of re-baking.

This is an art-direction change, accepted 2026-07-31: the old plan's "no tilted camera" rule was a
coherence rule for FAKE oblique cues, and it dies with them. Real geometry under a real camera is
coherent at any angle. The diorama target itself stands: bold, readable, procedural, no art assets.

## Decisions

- **three.js**, `WebGLRenderer`, plain imperative scene code. No react-three-fiber: the scene is
  built from data by pure builders, and the per-frame idiom stays direct writes from the rAF loop,
  exactly as the DOM layer does it today.
- **Coordinates**: viewBox (u, v) maps to three (x = u, z = v), y up, so every existing placement,
  width and `u(m)` conversion carries over untouched. One world unit stays one viewBox unit;
  physical sizes keep converting through `metresPerUnit`.
- **Flat materials first.** The 2D world is opaque pre-blended fills; increment 1 renders unlit flat
  colour for parity. The real `DirectionalLight` (driven by `lighting.ts`) arrives with the
  structures in increment 2, and replaces the baked shadow/shade/bevel system rather than joining it.
- **The ground is a painter's stack, everything else is real depth.** Coplanar road layers (casing,
  tarmac, ink, kerbs, painted marks) keep their 2D paint order as centimetre y-lifts; structures,
  trees, cars and camera get true 3D.
- **Ink is baked, not drawn.** The `track-surface` / `pit-surface` op layers render once per race
  into the road's albedo texture through the existing 2D canvas code. `surface-ink.ts` stays the
  single author of the ink; the pit lane's benched treatment comes back for free, since baking makes
  its per-frame cost zero.
- **Previews before integration.** `scripts/scene3d-preview.ts` bundles the same scene modules with
  esbuild and drives a headless system browser (playwright-core, Edge channel) to write PNG stills,
  plus a self-contained viewer HTML with orbit controls that can be opened from disk. No dev server,
  no persistent process, no browser download.
- **Cars arrive twice.** First as an impostor (the existing sprite rendered to a texture on a ground
  quad), so the world port never waits on the car. Then the real thing: a parametric loft that reads
  its plan view from the sprite's own geometry and adds an authored height profile. The loft is a
  design increment: turntable previews, iterated together.
- **The DOM overlay survives the transition.** At orthographic top-down the existing SVG cars, pit
  crews and garage signs align over the 3D canvas exactly as they do over the 2D one, so the live
  swap happens there first and banks the performance win. Perspective waits until cars, crews and
  signs live in-scene.

## Increments

### 1 — ground truth

The road on the ground, framed like the 2D preview: ground plane in the biome base colour, circuit
ribbon (casing then tarmac) along the densified trace, pit fast lane along `fastPts`, the working
apron ring, kerbs as white strips with red blocks, the start line. Orthographic camera, top-down and
a tilted diorama shot. The preview probe is built here and every later increment renders through it.

**Pause: stills beside `scenery-preview.ts`'s, same circuits, same framing.**

### 2 — the world stands up

Structures with real height: buildings, grandstands (raked for real), the pit building, fences,
marshal posts, tyre walls; trees as instanced geometry; terrain bands, runoffs, lakes and fields on
the ground stack. One `DirectionalLight` from `lighting.ts` with a shadow map, replacing every baked
shadow and wall shade. This is where the picture stops being a port and starts being the diorama lit
for real.

**Pause: stills on a forest and an urban circuit, top-down and tilted.**

### 3 — the surface keeps its story

The rubber line, brake marks, marbles, grain and edge fades bake into the road texture, UV-mapped
along the ribbon; the pit lane's grain, wear band and box grime return from the bench. Zoom stills to
judge the texture resolution budget.

**Pause: racing-zoom stills of a corner and the pit straight.**

### 4 — cars

The impostor first, wired to the live loop so the view is raceable. Then the loft: cross-sections
sampled from the sprite's drawn outline, an authored height curve, wings as thin plates, tyres as
cylinders with the compound band, the halo as a tube. Steering, roll, dive and wheel spin move from
transform fakes to real rotations; the sheen machinery is deleted in favour of the real light.

**Pause: turntable stills, iterated on the height profile together.**

### 5 — the live view swaps

`Race3DView` replaces `SceneryCanvas` behind the existing `view` toggle, orthographic top-down, DOM
overlay intact. Then the camera earns its freedom: perspective, follow/chase, wheel and drag mapped
to orbit, once cars, crews and signs are in-scene (billboards or in-world geometry, settled here).
The 2D renderer and its preview retire in this increment.

**Pause: live feel, judged in the running game.**

### 6 — moods and night

The old plan's increment E, now with real lights: mood selection from session and weather, night as
actual floodlight pools and emissive windows, headlight and brake glow on the cars. Old increment D
(banking, kerb faces, elevation) mostly falls out of real geometry and lands across 2 and 3.

**Pause: night and wet stills.**

## Files

| File | Change |
|---|---|
| **new** `src/lib/scene3d/road3d.ts` | ribbon, ring and kerb-block geometry from polylines |
| **new** `src/lib/scene3d/world3d.ts` | composes the world group from layout + scenery + pit zone |
| **new** `src/lib/scene3d/camera3d.ts` | orthographic framing from a viewBox, top-down and tilted |
| **new** `scripts/scene3d-preview.ts` | esbuild bundle, headless browser, PNG stills + orbit viewer |
| **new** `scripts/scene3d-preview-entry.ts` | the browser side of the probe |
| `src/lib/ui/track-scenery.ts` | kerbs carry their control points, not just the path string |
| `src/lib/ui/road-ops.ts` | export the road colours so the 3D road is painted from the same values |
| later: `src/lib/scene3d/structures3d.ts`, `trees3d.ts`, `bake-ink.ts`, `car-mesh.ts`, `src/components/race/Race3DView.tsx` | increments 2 through 5 |

## Verification

- `npm run test`, `npx tsc --noEmit`, `npm run lint`, `/loc` per increment.
- `npx tsx scripts/scenery-check.ts` and `npx tsx scripts/pit-geometry-check.ts` stay at ALL CHECKS
  PASS: the geometry underneath both renderers is shared, and nothing here may move it.
- `npx tsx scripts/scene3d-preview.ts <circuits>` for the picture, beside
  `npx tsx scripts/scenery-preview.ts` on the same circuits until the 2D renderer retires.
