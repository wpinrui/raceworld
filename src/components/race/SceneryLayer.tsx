import { Fragment } from 'react'
import type { Scenery, SceneryPart, SceneryRect } from '@/lib/ui/track-scenery'
import {
  mapPathPoints, partsPath, posts, rakedStand, ribbon, sideFacesX, sweptHull, wallWindows,
} from '@/lib/ui/extrude'
import {
  dirAt, lightDir, shadeFace, shadowFill, shadowOpacity, shadowReach, tintFace,
  type Lighting,
} from '@/lib/ui/lighting'

// Static scenery layer: generated once per circuit, transforms with the camera. The seat-stripe and
// crowd-dot patterns live in userSpace so they align with each rotated stand's local axes.
//
// Every solid obeys ONE fake light, supplied as four scalars (see lighting.ts): it is extruded away
// from the sun by its storey count, throws a cast shadow whose length is the real cot(altitude), and
// carries a tight contact shadow where it meets the ground. That last one is ambient rather than
// directional, so it survives overcast and is what actually makes things sit IN the world.

/** Metres of apparent height per storey. Diorama scale: tall enough that height is unmistakable. */
const STOREY_M = 4.6
/** Structural bay: how wide one window-and-pier module is on a wall. */
const WINDOW_BAY_M = 5.4
/** Wall depth as a fraction of height — how much of the side face the oblique view reveals. */
export const EXTRUDE = 0.62
/** A grandstand's front (trackside) and rear heights in metres. Real seating banks rake up away
 *  from the circuit; extruding one uniformly made them read as tall slabs beside the track.
 *
 *  These stay LOW on purpose. A stand is only 12-17 m deep, so displacing its rear edge by the full
 *  height of a real grandstand shears the deck by nearly half its own depth and the bank reads as a
 *  ski jump. The rake wants to be a gentle ramp; the height is carried by the roof and the shadow. */
const STAND_FRONT_M = 1.0
const STAND_REAR_M = 5.5
/** How much of the deck the rear roof canopy covers. */
const STAND_ROOF_FRAC = 0.3
/** Marshal hut height. */
const MARSHAL_H_M = 2.8
/** Trackside wall heights: armco/concrete, then the debris fencing standing behind it. */
const FENCE_H_M = 4
/** A stacked tyre barrier stands about as tall as the wall it fronts. */
const TYRE_H_M = 1.5
/** Tree shadow length as a multiple of the TRUNK's own length, so the two can never disagree: the
 *  trunk says how tall the tree is, and the shadow has to say the same thing. Still responds to the
 *  sun's height, just bounded so it stays tied to the trunk. */
const treeShadowRatio = (reachV: number) => Math.max(0.3, Math.min(0.8, reachV))

const deg = (r: number) => (r * 180) / Math.PI

const partsOf = (r: { w: number; h: number; parts?: SceneryPart[] }): SceneryPart[] =>
  r.parts ?? [{ dx: 0, dy: 0, w: r.w, h: r.h }]

const heightM = (r: { storeys?: number }) => (r.storeys ?? 1) * STOREY_M
/** A stand's effective height for shadow purposes: the rear, which is what casts. */
const isStand = (r: SceneryRect): r is Scenery['stands'][number] => 'facing' in r
const solidHeightM = (r: SceneryRect) => (isStand(r) ? STAND_REAR_M : heightM(r))

/** Rotate a world-space vector into a footprint's local frame. */
function toLocal(x: number, y: number, rot: number): { x: number; y: number } {
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  return { x: x * c - y * s, y: x * s + y * c }
}

export function SceneryLayer({ scenery, u, lighting, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const dir = lightDir(lighting)
  return (
    <g>
      <defs>
        <pattern id="tm-seats" width={u(2.4)} height={u(1.5)} patternUnits="userSpaceOnUse">
          <rect width={u(2.4)} height={u(1.5)} fill="#3E4552" />
          <rect y={u(0.95)} width={u(2.4)} height={u(0.55)} fill="#575F6E" />
        </pattern>
        <pattern id="tm-crowd" width={u(3.2)} height={u(3.2)} patternUnits="userSpaceOnUse">
          <circle cx={u(0.7)} cy={u(0.8)} r={u(0.3)} fill="#DC143C" opacity={0.5} />
          <circle cx={u(2.2)} cy={u(1.7)} r={u(0.3)} fill="#00D9FF" opacity={0.45} />
          <circle cx={u(1.3)} cy={u(2.6)} r={u(0.3)} fill="#E8B923" opacity={0.45} />
          <circle cx={u(2.7)} cy={u(0.5)} r={u(0.3)} fill="#FFFFFF" opacity={0.4} />
        </pattern>
        {/* Roof decking. A big roof plane is the largest flat area on the map and the one thing that
            still read as paper; seams give it a material without adding an object to the scene. */}
        <pattern id="tm-roof" width={u(3.6)} height={u(3.6)} patternUnits="userSpaceOnUse">
          <rect width={u(0.35)} height={u(3.6)} fill="#000000" opacity={0.055} />
          <rect x={u(0.35)} width={u(0.3)} height={u(3.6)} fill="#FFFFFF" opacity={0.04} />
        </pattern>
        <pattern id="tm-water" width={u(9)} height={u(6)} patternUnits="userSpaceOnUse">
          <path
            d={`M 0 ${u(2)} q ${u(2.2)} ${-u(1.4)} ${u(4.5)} 0 t ${u(4.5)} 0`}
            fill="none" stroke="#A8D4E6" strokeWidth={u(0.35)} opacity={0.3}
          />
          <path
            d={`M ${-u(2)} ${u(4.6)} q ${u(2.2)} ${-u(1.4)} ${u(4.5)} 0 t ${u(4.5)} 0`}
            fill="none" stroke="#A8D4E6" strokeWidth={u(0.35)} opacity={0.2}
          />
        </pattern>
        {/* The canopy's lit side IS the gradient's focal point, pulled toward the sun. It used to be
            a second path per tree, which cost an element for every tree on the circuit and was baked
            at generation time so it never moved when the light did. */}
        <radialGradient id="tm-tree0" fx={0.5 - dir.x * 0.3} fy={0.5 - dir.y * 0.3}>
          <stop offset="0%" stopColor="#8FB35F" />
          <stop offset="45%" stopColor="#4F7B3A" />
          <stop offset="100%" stopColor="#2C4B22" />
        </radialGradient>
        <radialGradient id="tm-tree1" fx={0.5 - dir.x * 0.3} fy={0.5 - dir.y * 0.3}>
          <stop offset="0%" stopColor="#A8B368" />
          <stop offset="45%" stopColor="#6B7A35" />
          <stop offset="100%" stopColor="#3D4A1E" />
        </radialGradient>
        <linearGradient
          id="tm-bevel" x1="0" y1="0" x2="1" y2="1"
          gradientTransform={`rotate(${deg(lighting.azimuth) - 45} 0.5 0.5)`}
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.16" />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </linearGradient>
        {/* Seating rake: pale at the back under the roof, darkening toward the trackside front, so
            which way a stand faces is legible at a glance rather than implied by a thin roof band. */}
        <linearGradient id="tm-rake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.30" />
        </linearGradient>
        <linearGradient id="tm-rake-flip" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.30" />
        </linearGradient>
        {/* Crop rows: enough texture to tell cultivated land from rough ground at a glance. */}
        <pattern id="tm-crop" width={u(11)} height={u(11)} patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <rect width={u(3.4)} height={u(11)} fill="#FFFFFF" opacity={0.05} />
        </pattern>
      </defs>

      {/* Relief, lowest band up. Each band gets a dark copy offset down-right underneath it, so the
          terrace steps catch the same top-left key light as every prop shadow. Big paths, few of
          them — they stay affordable at full zoom-out, which is where the flat plane showed. */}
      {scenery.bands.map((b, i) => (
        <path key={`hb${i}`} d={b.d} fillRule="evenodd" fill={b.fill} opacity={b.soft ? 0.30 : 1} />
      ))}

      {/* Field patchwork: the quilt of cultivated land a circuit sits in. A single flat green was
          the main reason the surround read as a runway extending forever. */}
      {scenery.fields.map((f, i) => (
        <g key={`fd${i}`}>
          <path d={f.d} fill={f.fill} opacity={0.75} />
          {/* Crop rows and hedgerows are per-field detail; zoomed out only the tint is legible, and
              this layer draws at BOTH tiers, so the extras come off at low LOD. */}
          {full && f.crop && <path d={f.d} fill="url(#tm-crop)" />}
          {full && <path d={f.d} fill="none" stroke="#1F3318" strokeWidth={u(2.2)} opacity={0.35} />}
        </g>
      ))}

      {scenery.terrain.map((b, i) => (
        <g key={`t${i}`}>
          <path d={b.d} fill={b.fill} />
          {b.water && <path d={b.d} fill="url(#tm-water)" />}
        </g>
      ))}
      {scenery.runoffs.map((b, i) => <path key={`r${i}`} d={b.d} fill={b.fill} />)}

    </g>
  )
}

/** Shadows, drawn AFTER the track ribbon. Everything scenery used to draw came before it, so the
 *  tarmac painted straight over every shadow and they stopped dead at the grass verge. Drawing them
 *  here is safe because the generator guarantees no prop overlaps the track — see
 *  track-scenery.test.ts — so nothing casting a shadow can be occluded by the road it falls on. */
export function SceneryShadowLayer({ scenery, u, lighting, view, cull, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; view: number
  cull?: Cull | null; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const structures: SceneryRect[] = [...scenery.stands, ...scenery.buildings]
  // Two bearings, deliberately: `dir` is the sun and sweeps the shadow, `vdir` is the camera and says
  // where the object's BASE was drawn. A shadow starts at the base and runs down-light, so it needs
  // both, and merging them makes the sun swing round with the player.
  const dir = lightDir(lighting)
  const vdir = dirAt(view)
  const reach = shadowReach(lighting)
  const shFill = shadowFill(lighting)
  const shOp = shadowOpacity(lighting)
  return (
    <g>

      {/* Cast shadow, swept along the ground FROM THE BASE so its near end tucks under the solid. */}
      {full && (
        <g fill={shFill} opacity={shOp}>
          {structures.map((r, i) => {
            const b = u(solidHeightM(r) * EXTRUDE)
            const t = u(solidHeightM(r) * reach)
            const o = toLocal(dir.x * t, dir.y * t, r.rot)
            return (
              <path
                key={`sh${i}`} d={sweptHull(partsOf(r), o.x, o.y)}
                transform={`translate(${r.x + vdir.x * b} ${r.y + vdir.y * b}) rotate(${deg(r.rot)})`}
              />
            )
          })}
        </g>
      )}

      {/* Tree shadows, STRETCHED from the trunk's base along the light rather than dropped as a
          loose blob at the far end of the cast. The blob was geometrically where a canopy's shadow
          lands, but with nothing joining it to the tree it read as litter on the grass — every other
          solid here has an attached shadow, and a tree has to match. One ellipse each, so the cost
          is the same as the blob it replaces.

          The shadow is the CANOPY'S OWN outline, stretched along the light — not an ellipse. A
          canopy is a lumpy blob, and a lumpy blob does not cast an elliptical shadow; the giveaway
          was a field of perfect ovals under irregular trees.

          Lighter than the solids' shadows: a grove's overlap heavily, and at full strength they
          merge into one dark mass rather than dappled shade. */}
      {full && (
        <path
          fill={shFill} opacity={shOp * 0.55}
          d={visibleTrees(scenery.trees, cull).map((t) => {
            const trunk = u(t.h * EXTRUDE)
            const len = trunk * treeShadowRatio(reach)
            // Stretch the canopy about its own centre along the light, then plant it at the base of
            // the trunk. Baked into the path data rather than applied as a transform: as one path
            // this is a single element for a whole circuit's trees instead of eleven hundred, each
            // of which the browser would otherwise resolve a matrix for every frame.
            const sx = (2 * t.r + len) / (2 * t.r)
            const cx = t.x + vdir.x * trunk + dir.x * (len / 2)
            const cy = t.y + vdir.y * trunk + dir.y * (len / 2)
            return mapPathPoints(t.d, (px, py) => {
              const vx = px - t.x
              const vy = py - t.y
              // Into the light's frame, stretch along it, back out again.
              const ax = vx * dir.x + vy * dir.y
              const ay = -vx * dir.y + vy * dir.x
              const bx = ax * sx
              return { x: cx + bx * dir.x - ay * dir.y, y: cy + bx * dir.y + ay * dir.x }
            })
          }).join(' ')}
        />
      )}
    </g>
  )
}

/** A disc of the drawn scene worth rendering: centre and radius in viewBox units. Null renders
 *  everything, which is what the preview and the static map want. */
export interface Cull { cx: number; cy: number; r: number }

/** Trees inside the cull disc. Their own radius is added so one straddling the edge is not dropped
 *  while half of it is still on screen. */
export function visibleTrees<T extends { x: number; y: number; r: number }>(trees: T[], cull?: Cull | null): T[] {
  if (!cull) return trees
  return trees.filter((t) => Math.hypot(t.x - cull.cx, t.y - cull.cy) <= cull.r + t.r)
}

/** The solids themselves: walls, roofs, stands and canopies, all above the shadows. */
export function ScenerySolidsLayer({ scenery, u, lighting, view, cull, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; view: number
  cull?: Cull | null; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const dir = dirAt(view)
  // Camera sits at +dir (raising a point pushes its image AWAY from the eye, so tops drawn at -dir
  // put the eye at +dir). A larger projection along dir is therefore NEARER: sort furthest-first and
  // the painter's order comes out right.
  const treesByDepth = visibleTrees(scenery.trees, cull)
    .map((t, i) => ({ ...t, i }))
    .sort((a, b) => (a.x * dir.x + a.y * dir.y) - (b.x * dir.x + b.y * dir.y))
  // Trees lean exactly as much as buildings do. Giving them their own, steeper lean put two
  // different cameras in one scene; the height variation belongs in each tree's own scale.
  const trunkOf = (t: { h: number }) => u(t.h * EXTRUDE)
  return (
    <g>
      {/* Walls: the swept band from roof outline to base outline, as one silhouette. The roof is
          painted over its near half below, leaving only the faces that actually face the camera. */}
      {full && scenery.buildings.map((r, i) => {
        const t = u(heightM(r) * EXTRUDE)
        const o = toLocal(dir.x * t, dir.y * t, r.rot)
        const parts = partsOf(r)
        const hull = sweptHull(parts, o.x, o.y)
        return (
          <g key={`wl${i}`} transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}>
            {/* The whole solid's silhouette, outlined once. */}
            <path d={hull} fill={shadeFace(r.fill, lighting)} />
            {/* The left/right height faces, a shade apart from the top/bottom ones so the two
                visible planes of the box are distinguishable. */}
            <path d={sideFacesX(parts, o.x, o.y)} fill={tintFace(r.fill, lighting, -0.45)} />
            {/* Glazing, gridded in each wall's own plane. */}
            <path
              d={wallWindows(parts, o.x, o.y, u(WINDOW_BAY_M), Math.max(1, Math.round(heightM(r) / STOREY_M)))}
              fill="#0E1319" opacity={0.42}
            />
          </g>
        )
      })}

      {/* Grandstands rake: the trackside front barely lifts, the rear lifts a long way, so the deck
          climbs away from the circuit like real seating. Extruded uniformly they read as office
          blocks parked beside the track — they are a bank of seats, not a building. */}
      {scenery.stands.map((s, i) => {
        const t = u(STAND_REAR_M * EXTRUDE)
        const o = toLocal(dir.x * t, dir.y * t, s.rot)
        const { hull, deck, roof } = rakedStand(
          s.w, s.h, s.facing, o, 1 - STAND_FRONT_M / STAND_REAR_M, STAND_ROOF_FRAC,
        )
        return (
          <g key={`s${i}`} transform={`translate(${s.x} ${s.y}) rotate(${deg(s.rot)})`}>
            {/* Structure below the deck: the exposed sides of the bank. */}
            <path d={hull} fill={shadeFace(s.fill, lighting)} />
            {/* The seating deck itself, patterned and raked. */}
            <path d={deck} fill="url(#tm-seats)" />
            {full && <path d={deck} fill="url(#tm-crowd)" />}
            {full && <path d={deck} fill={s.facing ? 'url(#tm-rake)' : 'url(#tm-rake-flip)'} />}
            {/* Roof over the rear rows only. */}
            <path d={roof} fill="#7B8494" />
            {full && <path d={deck} fill="url(#tm-bevel)" />}
          </g>
        )
      })}

      {scenery.buildings.map((b, i) => {
        const d = partsPath(partsOf(b))
        return (
          <g key={`b${i}`} transform={`translate(${b.x} ${b.y}) rotate(${deg(b.rot)})`}>
            <path d={d} fill={b.fill} />
            {/* One bevel over the whole silhouette. Filling the union path directly rather than
                clipping a rect to it drops three nodes per building for the same picture: an
                objectBoundingBox gradient already resolves against the path's own extent. Drawing it
                per PART is what has to be avoided — that gave every sub-rect its own full
                light-to-dark ramp, seaming at each internal edge. */}
            {full && <path d={d} fill="url(#tm-roof)" />}
            {full && <path d={d} fill="url(#tm-bevel)" />}
          </g>
        )
      })}

      {/* Canopies, DEPTH-SORTED so a nearer tree covers a further one. Drawn in array order they
          overlapped arbitrarily, which is the one thing that breaks a grove's read. Each tree's
          trunk goes with it rather than in a shared layer underneath, or a near trunk would be
          buried by a far canopy. Trunk width scales with the canopy it carries — a constant width
          made every tree a lollipop on a stick. */}
      {full && treesByDepth.map((t) => (
        <Fragment key={`v${t.i}`}>
          <path
            d={`M ${t.x.toFixed(1)} ${t.y.toFixed(1)} L ${(t.x + dir.x * trunkOf(t)).toFixed(1)} ${(t.y + dir.y * trunkOf(t)).toFixed(1)}`}
            fill="none" stroke={shadeFace('#6B5138', lighting)}
            strokeWidth={Math.max(u(0.8), t.r * 0.34)} strokeLinecap="round"
          />
          <path d={t.d} fill={`url(#tm-tree${t.variant})`} />
        </Fragment>
      ))}
    </g>
  )
}

/** Circuit furniture that belongs ON TOP of the tarmac: it lines the track edge, so drawing
 *  them with the rest of the scenery (which is painted before the ribbon) would bury them under it.
 *  All long polylines, so both LOD tiers can afford them — they are what makes the place read as a
 *  racing circuit rather than a road. */
export function TrackFurnitureLayer({ scenery, u, lighting, view, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; view: number; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const dir = dirAt(view)
  const ldir = lightDir(lighting)
  const reach = shadowReach(lighting)
  const shFill = shadowFill(lighting)
  const shOp = shadowOpacity(lighting)
  // Every piece of furniture casts from its BASE, like every other solid on the map.
  const tyreB = u(TYRE_H_M * EXTRUDE)
  const tyreT = u(TYRE_H_M * reach)
  const fenceB = u(FENCE_H_M * EXTRUDE)
  const fenceT = u(FENCE_H_M * reach)

  // Depth convention: raising a point pushes its image AWAY from the camera, exactly as a light
  // pushes a shadow away from itself. Tops are drawn displaced by -dir (a roof sits up-light of its
  // base), so "away" is -dir and the CAMERA sits at +dir. Nearer therefore means a LARGER projection
  // along dir, and nearer draws last.
  //
  // A tyre wall is inboard of the fencing, so where the outward normal points toward the camera the
  // fence is the nearer of the two and the tyres go under it; where it points away, the tyres are
  // nearer and go on top.
  const withIdx = scenery.tyreWalls.map((t, i) => ({ t, i }))
  const nearTyres = withIdx.filter(({ t }) => t.nOut.x * dir.x + t.nOut.y * dir.y <= 0)
  const farTyres = withIdx.filter(({ t }) => t.nOut.x * dir.x + t.nOut.y * dir.y > 0)
  const TyreWalls = (list: typeof withIdx) => list.map(({ t, i }) => (
    <g key={`tw${i}`}>
      <path d={t.d} fill="none" stroke="#1B1F26" strokeWidth={u(3.4)} strokeLinecap="round" />
      {full && t.bands.map((c, j) => (
        <path
          key={j} d={t.d} fill="none" stroke={c} strokeWidth={u(2.6)} strokeLinecap="butt"
          strokeDasharray={`${u(2.4)} ${u(4.8)}`} strokeDashoffset={u(2.4 * j)}
        />
      ))}
    </g>
  ))
  return (
    <g>
      {/* Furniture obeys the same light as the buildings. Without this the fencing reads as a painted
          line while everything behind it reads as solid, which breaks the whole illusion. */}
      {full && (
        <g fill={shFill} stroke={shFill} opacity={shOp} strokeLinejoin="round">
          {/* A shadow is SWEPT from the object's base, never a displaced copy of it. A stroked copy
              offset by the cast distance leaves a gap between the object and its own shadow, which
              reads as levitation — and implies something taller than the thing drawn. The fill covers
              the swept ground; the stroke dilates it to the object's real thickness. */}
          {scenery.tyreWalls.map((t, i) => (
            <path
              key={`ts${i}`} strokeWidth={u(3.4)}
              d={ribbon(
                t.pts.map((p) => ({ x: p.x + dir.x * tyreB, y: p.y + dir.y * tyreB })),
                ldir.x * tyreT, ldir.y * tyreT,
              )}
            />
          ))}
          {/* Debris fencing is tall, so leaving it shadowless makes it levitate too — but it is a
              mesh, so what it casts is faint. */}
          {full && scenery.fences.map((b, i) => (
            <path
              key={`fs${i}`} opacity={0.35} stroke="none"
              d={ribbon(
                b.pts.map((p) => ({ x: p.x + dir.x * fenceB, y: p.y + dir.y * fenceB })),
                ldir.x * fenceT, ldir.y * fenceT,
              )}
            />
          ))}
        </g>
      )}

      {/* Tyre walls FURTHER from the viewer than the fencing go under it. */}
      {TyreWalls(farTyres)}

      {/* Debris fencing is a solid on a curve. It needs the height face between its top line and its
          base, or it is a line plus a detached shadow and reads as floating above the ground. That
          face is a cage rather than a wall, so it is drawn see-through with its posts as verticals —
          one path for a whole circuit's worth. */}
      {full && scenery.fences.map((b, i) => {
        const ox = dir.x * fenceB
        const oy = dir.y * fenceB
        return (
          <g key={`bf${i}`}>
            {/* Mesh: you can see the circuit through debris fencing, so the face is barely there. */}
            <path d={ribbon(b.pts, ox, oy)} fill="#AEB6C2" opacity={0.13} />
            <path
              d={posts(b.pts, ox, oy, 2)} fill="none" stroke="#79808C"
              strokeWidth={u(0.35)} opacity={0.5}
            />
            <path d={b.d} fill="none" stroke="#79808C" strokeWidth={u(0.4)} opacity={0.6} />
          </g>
        )
      })}

      {/* Tyre walls NEARER than the fencing go over it. */}
      {TyreWalls(nearTyres)}

      {/* Marshal posts are solids too, so they get real height faces rather than a displaced copy of
          themselves — the same mistake the buildings started with. */}
      {full && scenery.marshals.map((m, i) => {
        const hut: SceneryPart[] = [{ dx: 0, dy: 0, w: u(4.4), h: u(3.2) }]
        const t = u(MARSHAL_H_M * EXTRUDE)
        const o = toLocal(dir.x * t, dir.y * t, m.rot)
        const sh = u(MARSHAL_H_M * reach)
        const so = toLocal(ldir.x * sh, ldir.y * sh, m.rot)
        const deg2 = (m.rot * 180) / Math.PI
        return (
          <g key={`mp${i}`} transform={`translate(${m.x} ${m.y}) rotate(${deg2})`}>
            <path
              d={sweptHull(hut, so.x, so.y)} fill={shFill} opacity={shOp}
              transform={`translate(${o.x} ${o.y})`}
            />
            <path d={sweptHull(hut, o.x, o.y)} fill={shadeFace('#3A4049', lighting)} />
            {/* Roof on top, with the orange marshal panel on its trackside edge. */}
            <rect x={-u(2.2)} y={-u(1.6)} width={u(4.4)} height={u(3.2)} rx={u(0.3)} fill="#3A4049" />
            <rect x={-u(2.2)} y={-u(1.6)} width={u(4.4)} height={u(1.0)} fill="#E8952B" />
          </g>
        )
      })}
    </g>
  )
}
