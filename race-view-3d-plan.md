# Fake 3D and lighting for the 2D race view

> Authored in plan mode 2026-07-24 and approved then. Increment A landed; the canvas port and the
> frame-rate campaign then took the branch for a day. Revised 2026-07-25 to re-point the remaining
> increments at the canvas renderer, which did not exist when this was written. Revised again
> 2026-07-31: the frame-rate campaign has been **reverted in full** ahead of a WebGL port, so every
> rule and every probe it left behind is gone from this document too.

## Status

| Increment | State |
|---|---|
| **A** — one light, obeyed by everything | **Done.** `da38030`, `8870014`, `dbffd49`, `53d3079`, `bdbe467` |
| **B** — cars in 3D | **Done.** `e035d57` + this commit. Preview: `npx tsx scripts/car-preview.ts` |
| **C** — the track surface tells a story | **Done** for the circuit (`f6f52fc`) and the pit lane (`51b401a`), both restored 2026-07-31 |
| **D** — the track has form | Not started |
| **E** — moods | Not started (`MOODS` exists, nothing selects between them) |

## Context

The scenery overhaul landed a world with real geometry, and Increment A gave it one fake sun:
[lighting.ts](src/lib/ui/lighting.ts) holds four scalars (`azimuth`, `elevation`, `warmth`,
`ambient`) plus the `MOODS` presets, and every solid in the static world now derives its shadow
vector, shadow tint, wall shade and bevel angle from them. Structures, trees, barriers, tyre walls
and marshal posts all obey the same convention.

Two things the simulation already computes and the renderer still throws away:

- The **racing line** is solved with a Gauss-Seidel minimum-curvature pass and then drawn with
  `stroke="none"` ([RaceTrackMap.tsx:2157](src/components/race/RaceTrackMap.tsx#L2157)) — it exists
  only as a path to sample positions from.
- **`gradeToTrack`** computes a smoothed elevation profile along the centreline
  ([terrain-field.ts](src/lib/ui/terrain-field.ts)) and discards it after the contour bands.

And two things the light does not reach yet: **the cars**, which are the flattest object on a screen
the player watches for two hours, and **the track surface itself**, which is a flat grey ribbon with
no rubber, no camber and no edge.

Goal, unchanged: one coherent fake light and one coherent fake camera, obeyed by *everything*, plus
the depth cues a top-down view can actually carry. No new art assets — every effect is procedural.

**Working mode: iterative.** Each increment ends with a rendered preview to look at before the next
one starts.

---

## What changed underneath this plan

The static world is no longer SVG. It is described **once** as plain data and painted to a canvas:

- [scenery-draw.ts](src/lib/ui/scenery-draw.ts) — `DrawOp` / `DrawGroup` (a path string plus how to
  paint it), and `sceneryScene()` at [line 625](src/lib/ui/scenery-draw.ts#L625) which composes the
  whole world in one ordered stream: ground → garage floors → road → pit complex → kerbs → shadows →
  solids → trees → furniture.
- [scenery-paint.ts](src/lib/ui/scenery-paint.ts) + [SceneryCanvas.tsx](src/components/race/SceneryCanvas.tsx)
  — `drawScene()` walks that stream into a `CanvasRenderingContext2D`.

There is now exactly ONE renderer. The SVG world layer, the level-of-detail ladder, the cull discs,
the geometry and path caches, the group batching, the warmed scene swap, the node budget, the frame
cap, the baked bitmap and the whole perf lab are **gone** — reverted 2026-07-31 ahead of a WebGL
port. The 2D renderer's remaining job is to be the clearest possible statement of what the picture
IS, drawn at full fidelity, so the port has one thing to read.

**Three rules this imposes on every increment below.**

1. **Anything in the static world is a `DrawOp`, not JSX.** Add it in `scenery-draw.ts`. The two
   exceptions are the garage name boards and the pit crews, which carry real text, real flag artwork
   and per-frame DOM animation, and none of that survives a `DrawOp`.
2. **Gradients and patterns are symbolic**, `ref:NAME`, resolved by the renderer that paints them.
   That is what keeps paint out of the geometry, and it is what a WebGL backend will resolve to a
   texture or a shader uniform.
3. **No SVG filters** (`feGaussianBlur`, `feDropShadow`), and none is needed: soft shadows and soft
   marks come from stacked opaque fills. A blur is a raster effect and the picture is described in
   vectors.

**Do not re-introduce a mitigation here.** If the 2D renderer is too slow, that is an argument for
finishing the WebGL port, not for putting the ladder back.

**Cars are still SVG.** [`CarSprite`](src/components/race/RaceTrackMap.tsx#L290) renders as an SVG
sprite over the canvas, as do the garage signs (benched innocent). Increment B is therefore
unchanged from the original plan: it stays in the SVG/CSS-variable world.

---

## The core abstraction (landed)

[lighting.ts](src/lib/ui/lighting.ts), pure and testable, no React:

```ts
export interface Lighting {
  /** Radians: the direction light TRAVELS, so shadows point this way. */
  azimuth: number
  /** 0..1. 1 = overhead (short shadows), 0.15 = low sun (long raking shadows). */
  elevation: number
  /** -1 cool/blue .. +1 golden. Tints lit faces one way and shadows the other. */
  warmth: number
  /** 0..1. Overcast fills shadows in: high ambient = faint, soft, low-contrast. */
  ambient: number
}
```

with `shadowOffset`, `shadowReach`, `shadowFill`, `shadowOpacity`, `tintFace`, `shadeFace`, `dirAt`,
`lightDir` and `MOODS`. Real shadows are lit by the sky, so `shadowFill` returns a desaturated
blue-violet, not black — that single change was most of the difference between "CAD render" and
"photograph".

The dry-race default is a low afternoon sun (long raking shadows, warm lit faces, cool shadows, high
contrast), currently hardcoded at
[RaceTrackMap.tsx:494](src/components/race/RaceTrackMap.tsx#L494) with its azimuth swung to suit the
pit straight. Increment E is what turns that into data.

The target is **diorama, not broadcast graphic**: where a parameter is a judgement call, take the
bolder value. The one guard is zoom-out — the whole circuit in one shot still has to read cleanly,
so extrusion depth and shadow length are chosen to work there as well as at racing zoom
and shrunk.

---

## Increment B — cars in 3D

The thing the player watches for two hours, currently the flattest object on screen. Entirely SVG and
CSS, so none of the canvas rules apply; the only shared piece is reading `lighting` for the light
direction so the cars agree with the world they sit in.

- **Contact shadow** under each car: a soft ellipse offset along the world light. Cars stop being
  stickers.
- **Counter-rotated specular highlight.** The sprite is rotated whole (`rotate(heading + π/2)`), so
  anything painted on it turns with it, which is exactly what reads as flat. Add a highlight overlay
  *inside* the sprite counter-rotated by the same angle so it stays aligned to the world light, and
  it slides around the bodywork as the car corners. Follows the existing `--cam-rot` /
  `--cam-zoom-inv` CSS-variable pattern already used for the counter-rotated labels: the rAF loop
  writes a `--car-rot` var where it already writes the sprite transform.
- **Wheels** darkened and offset slightly along the light so they read as sitting below the body.
- **Body roll and brake dive**: a degree or two of `skewX` under cornering load and a slight vertical
  squash under braking, from curvature and the speed profile the loop already has.

*Watch:* ~20 cars × a few extra nodes each is a per-frame SVG cost on the one layer that genuinely
changes every frame. The sprites are the last un-ported layer, and the first thing the WebGL port
should take.

**Pause: preview with a handful of cars at different headings, to check the highlight tracks.**

### What actually shipped, and where it left the plan

- **SVG `transform` attributes, not the `--car-rot` CSS variable.** Measured: the preview rasteriser
  (sharp/librsvg) never resolves `var()` and ignores `transform-origin` on a CSS `transform`, so a
  CSS-variable highlight would have rendered at rotation zero in every still — i.e. the preview would
  have lied about the one thing it exists to check. The rAF loop writes `[data-car-shadow]`,
  `[data-car-body]` and `[data-car-sheen]` transform attributes instead, which is the same direct-DOM
  idiom the loop already used for the sprite itself.
- **Roll and dive come from the LAP, not from screen motion.** Differentiating sprite movement against
  the wall clock reports four times the cornering load at 4x race speed. `buildTimeProfile` already
  computed speed and curvature per station and discarded both, so it became
  [lap-dynamics.ts](src/lib/ui/lap-dynamics.ts), which returns signed lateral and longitudinal
  acceleration in arc space. Increment C's brake-zone skid marks want exactly this array.
- **Wheels: contact patches, not a per-wheel offset.** Offsetting each wheel along the world light
  inside a rotated sprite needs a counter-rotation per wheel for a sub-pixel cue. The four tyres are in
  the shadow's footprint path instead, so each wheel sits on its own shadow.
- **Body roll moves the highlight, not just the body.** Measured: 10 sprite units of body shift is 1.8%
  of the car, invisible at racing zoom. The sheen now slides across the bodywork with roll, which is
  the cue that actually reads; body travel went to 4% of the car's length alongside it.
- **Cost: 104 elements per sprite, up from ~83**, and one CSS `filter` per car removed (the old
  `drop-shadow` turned with the car, so it could never be a contact shadow). ~+420 document nodes at
  20 cars.

### Sprite corrections that followed (same branch)

- **Suspension was drawn inside out.** A wishbone is an A-arm: two mounts spread wide on the chassis,
  meeting at a point on the upright, so from above each side is a V with the sharp end AT THE WHEEL. It
  was drawn apex-inboard on both axles. Redrawn, thicker, and in carbon dark (`#0B0D10`) because the old
  `#2E3138` sat 6 of 255 from `#33383E` tarmac and the arms were invisible against the road.
- **The front wheels steer.** Ackermann from the path's own geometry: `atan(L / R)` per wheel with the
  inner on the tighter radius, off a new geometric `curvature` output. Wheelbase and track are measured
  off the artwork, so it is the DRAWN car whose corner has to be possible.
- **Plus the understeer term**, which is what made it read. Kinematic lock alone is only true at walking
  pace and vanishes in exactly the fast corners that load the car hardest. Real lock is
  `atan(L / R) + K * lateral g`; at `K = 2.4` deg/g a hairpin runs 20 degrees and a 400m sweep 5, where
  geometry alone gave 13 and 0.4. Bolder than a real car's 1 to 1.5, on the same grounds as the roll.
- Compound bands moved inside their wheel groups so they turn with the tyre. They are also the clearest
  read on steering angle, since a rounded pill hides its own rotation.
- Pit-lane and grid cars keep their wheels straight: the crew's tyre props pixel-match the wheels in the
  box, and a steered wheel would break that match on the one car being watched closely.

---

## Increment C — the track surface tells a story

All from data that already exists. **All of it goes on the canvas**, as ops appended to the `track`
list that `sceneryScene` places between the road and the kerbs — built where `trackDrawOps` is built
today ([RaceTrackMap.tsx:1600](src/components/race/RaceTrackMap.tsx#L1600)), ideally lifted into its
own module rather than growing that file further.

- **Rubber in the racing line.** The solved line is already in the document as an invisible path for
  sampling; sample it to a path string and draw it as a wide soft dark stroke on the tarmac, with a
  second narrower pass at the apexes. A circuit with a worn line through it stops looking like a
  drawing of a track.
- **Brake-zone skid marks.** `buildTimeProfile` gives speed at 256 points round the lap; take the
  hardest decelerations and draw short dark streaks into those corners. Per-corner ops, each with its
  own `clip` disc, so only the corners in shot cost anything.
- **Marbles off-line**: a lighter speckled band outside the racing line through corners. Speckle is
  the expensive shape here — one dashed stroke, not N dots.
- **A tarmac edge**: a thin dark drop from asphalt into the verge plus a soft shadow beyond it, so
  the ribbon reads as a slab laid *on* the ground rather than a line drawn into it.

**Pause: preview before moving on.**

### What shipped, and the pit lane's answer

The circuit's half landed as [track-surface.ts](src/lib/ui/track-surface.ts) (`f6f52fc`), with one addition
the plan did not call for: **surface grain**, a barely-perceptible mottling over the whole road, because a
ribbon of constant colour turned out to be a bigger tell than any missing mark.

**The pit lane does not get this treatment, and that is now a decision rather than an oversight.** It was
built (apron and fade, grain, a band worn down the fast lane, grime and a swing-out scuff per box) and taken
straight back out: 93 extra ops and ~19k m² of paint per frame, all of it on the pit straight, which is the
one stretch this branch has already measured itself out of raster budget on. The picture was right and the
frame budget was not there to buy it. **Do not re-propose it without first buying back the pit straight.**

What survives from that attempt, because it is free and stands on its own:

- [surface-ink.ts](src/lib/ui/surface-ink.ts) — the ink itself (opaque pre-blended colour, softness by
  nested strokes, layer-major ordering, the asphalt-into-verge fade), split out of `track-surface.ts` and
  taking it back under the 500-line cap.
- `LANE_WIDTH_M` / `LANE_TARMAC_M` / `LANE_LINE_M` in [track-path.ts](src/lib/ui/track-path.ts), replacing
  the lane's cross-section magic numbers in both renderers and both preview scripts.
- `fastPts` on `PitLane`, which let `pit-zone.ts` delete its own copy of the path parser.

---

## Increment D — the track has form

Same placement as C: track ops on the canvas, before the kerbs.

- **Banking and camber.** Shade a gradient across the ribbon width through corners, dark on the low
  edge, light on the high edge, driven by the existing corner detector and curvature. A banked corner
  rendered flat is the biggest missed depth cue on the map. Cross-ribbon gradients need a `bbox` on
  the op — `Path2D` cannot report one, and without it the ramp lands somewhere else entirely.
- **Raised kerbs**: side face and a shadow on the light's far side, so they become physical objects.
  Kerbs are already built as filled geometry and culled to the disc (`1ef1503`, `4b9f227`), so this
  extends an existing op list rather than adding a layer.
- **Elevation along the lap**: modulate tarmac brightness from the `gradeToTrack` profile, so climbs
  catch light and descents fall into shade. Cheapest of the three: it is a fill colour per road
  segment, no new geometry.

**Pause: preview on a banked circuit and a hilly one (Zandvoort, Spa).**

---

## Increment E — moods

Because lighting is data, this is mostly wiring plus one new layer.

- Replace the hardcoded `MOODS.afternoon` at
  [RaceTrackMap.tsx:494](src/components/race/RaceTrackMap.tsx#L494) with a selection from circuit and
  session: a `night` flag on the night races, and **weather drives ambient** so a wet race genuinely
  looks overcast (high ambient, low contrast, desaturated).
- **Night**: dark ground, the track as a bright ribbon, warm window dots reusing the existing
  building pattern, floodlight pools, and headlight/brake glow on the cars.

Two things to settle before starting E, both consequences of the canvas port rather than of the
original design:

- **Blend modes.** The night floodlight pools were specified as a `mix-blend-mode: screen` group of
  radial gradients. Canvas has `ctx.globalCompositeOperation`, so the effect is available, but
  `DrawOp` has no field for it and the SVG reference renderer would need the matching property to
  stay in parity. One new optional field on `DrawOp`, set on both sides, or drop the pools.
- **Mood is a scene rebuild, not a per-frame value.** Changing mood invalidates every cached
  gradient and the composed scene. Fine for a race that picks its mood once at the start; a live
  dusk-to-night transition is a different feature and is not in this plan.

**Pause: preview of night and wet.**

---

## Deliberately not doing

- **Parallax** on decorative layers. It is the classic 2.5D height cue, but a true top-down
  orthographic camera produces none, it can look wrong at follow-zoom, and it cannot be judged from a
  still image. Revisit live, after the rest lands, and never apply it to anything a car must align
  with.
- Anything per-pixel: no shaders, no normal maps, no depth buffer, no real inter-object occlusion.
- A tilted/perspective camera. Committing to top-down with strong oblique cues is coherent; a
  half-perspective view would not be.
- Reopening the pit-straight raster residual. It is measured, attributed and banked.

---

## Files

| File | Change |
|---|---|
| `src/lib/ui/lighting.ts` | **landed** — the four scalars, derived helpers, `MOODS` |
| `src/lib/ui/lighting.test.ts` | **landed** — shadow vector/length/tint, mood invariants |
| `src/lib/ui/scenery-draw.ts` | C, D: track-surface ops (rubber, skids, marbles, edge, camber, kerb faces) placed in `sceneryScene`'s order; E: a composite-mode field on `DrawOp` if the night pools stay |
| `src/lib/ui/scenery-paint.ts` | E: honour the composite mode; any new `ref:` paint |
| **new** `src/lib/ui/track-surface.ts` | **landed** — C, for the circuit |
| **new** `src/lib/ui/surface-ink.ts` | **landed** — the ink it is painted with |
| `src/components/race/RaceTrackMap.tsx` | B: car shadow, `--car-rot`, roll/dive; E: mood selection replacing the hardcoded afternoon |
| `src/lib/ui/track-scenery.ts` | expose corner/camber and the elevation profile for the renderer |
| `src/lib/ui/biomes.ts` | default mood per biome |
| `scripts/scenery-preview.ts` | render cars and the racing line (already takes `--mood`) |

**`RaceTrackMap.tsx` is ~128 KB and far over the 500-line cap** — it was over before this branch and
grew further. Nothing in C or D should land in it; a reviewer will raise the file either way.

---

## Verification

Per increment:

- `npm run test`, `npx tsc --noEmit`, `npm run lint`, `/loc`.
- `npx tsx scripts/scenery-check.ts` at **ALL SCENERY CHECKS PASS** and
  `npx tsx scripts/pit-geometry-check.ts` at **ALL GEOMETRY CHECKS PASS** — the regression net for
  the geometry underneath all of this.
- `npx tsx scripts/scenery-preview.ts [--mood=X] [--zoom=N] [--at=fx,fy] [--cars] <circuits>` for the
  still image to actually look at. It builds the scene through `sceneryScene` and `roadOps` — the
  same calls the map makes — so what it renders is what ships. Run it on anything that touches
  `scenery-draw.ts`.
- `npx tsx scripts/scenery-check.ts` for placement (clearance, overlaps) and
  `npx tsx scripts/pit-geometry-check.ts` for the lane's paint geometry.
