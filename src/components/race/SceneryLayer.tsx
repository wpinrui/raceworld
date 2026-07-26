import type { Scenery, SceneryRect, SceneryTree } from '@/lib/ui/track-scenery'
import {
  buildingRoofGroups, buildingWallGroups, depthSorted, fenceOps, groundOps, marshalGroups, refName,
  runShadowOp,
  standGroups, structureShadowGroups, treeShadowOp, treeSolidOps,
} from '@/lib/ui/scenery-draw'
import { dirAt, lightDir, shadowFill, shadowOpacity, type Lighting } from '@/lib/ui/lighting'

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
/** Wall depth as a fraction of height — how much of the side face the oblique view reveals, and so
 *  how far from straight down the camera is pretending to be.
 *
 *  This is the whole of the map's perspective, in one number. At 0.62 the view sat well off vertical
 *  and every solid leaned a long way up the screen, which reads as a diorama shot from a corner of the
 *  room. Lower is closer to overhead: the same objects, less of their sides, less lean. Kept above zero
 *  because a true plan view has no depth cue at all and the map goes back to being a diagram. */
export const EXTRUDE = 0.4
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
/** Its hut's footprint, in metres. */
const MARSHAL_W_M = 4.4
const MARSHAL_D_M = 3.2
/** Height of the debris fencing standing behind the barrier. */
const FENCE_H_M = 4

const deg = (r: number) => (r * 180) / Math.PI

const heightM = (r: { storeys?: number }) => (r.storeys ?? 1) * STOREY_M
/** A stand's effective height for shadow purposes: the rear, which is what casts. */
const isStand = (r: SceneryRect): r is Scenery['stands'][number] => 'facing' in r
const solidHeightM = (r: SceneryRect) => (isStand(r) ? STAND_REAR_M : heightM(r))

export function SceneryLayer({ scenery, u, lighting, hide, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; hide?: Hidden
  detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const dir = lightDir(lighting)
  const noGround = hide?.has('ground') ?? false
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

      {groundOps(scenery, u, { full, ground: !noGround }).map((op, i) => (
        <path
          key={`g${i}`} d={op.d} fill={op.fill ? paint(op.fill) : 'none'} stroke={op.stroke}
          strokeWidth={op.width} opacity={op.alpha} fillRule={op.evenOdd ? 'evenodd' : undefined}
        />
      ))}

    </g>
  )
}

/** Shadows, drawn AFTER the track ribbon. Everything scenery used to draw came before it, so the
 *  tarmac painted straight over every shadow and they stopped dead at the grass verge. Drawing them
 *  here is safe because the generator guarantees no prop overlaps the track — see
 *  track-scenery.test.ts — so nothing casting a shadow can be occluded by the road it falls on. */
export function SceneryShadowLayer({ scenery, u, lighting, view, cull, maxTrees, hide, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; view: number
  cull?: Cull | null; maxTrees?: number; hide?: Hidden; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const structures: SceneryRect[] = [...scenery.stands, ...scenery.buildings]
  const shadowOpts = { u, extrude: EXTRUDE, lighting, view, heightM: solidHeightM }
  const shFill = shadowFill(lighting)
  const shOp = shadowOpacity(lighting)
  if (hide?.has('shadows')) return null
  return (
    <g>

      {/* Cast shadow, swept along the ground FROM THE BASE so its near end tucks under the solid. */}
      {full && (
        <g fill={shFill} opacity={shOp}>
          {structureShadowGroups(structures, shadowOpts).map((g, i) => (
            <path
              key={`sh${i}`} d={g.ops[0].d}
              transform={`translate(${g.x} ${g.y}) rotate(${deg(g.rot)})`}
            />
          ))}
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
      {full && treeShadowOp(
        hide?.has('trees') ? [] : visibleTrees(scenery.trees, cull, maxTrees),
        { u, extrude: EXTRUDE, lighting, view },
      ).map((op, i) => (
        <path key={`ts${i}`} d={op.d} fill={op.fill} opacity={op.alpha} />
      ))}
    </g>
  )
}

/** A symbolic fill names a shared gradient or pattern; anything else is a plain colour. */
const paint = (v: string): string => {
  const ref = refName(v)
  return ref ? `url(#${ref})` : v
}

/** A disc of the drawn scene worth rendering: centre and radius in viewBox units. Null renders
 *  everything, which is what the preview and the static map want. */
export interface Cull { cx: number; cy: number; r: number }

/** Categories the diagnostic hotkeys can switch off. Rendering is SKIPPED rather than hidden, so the
 *  node count moves with the toggle and the experiment measures what it claims to. */
export type SceneryPiece = 'trees' | 'shadows' | 'buildings' | 'stands' | 'furniture' | 'ground'
export type Hidden = ReadonlySet<SceneryPiece>

/** Trees inside the cull disc, capped at a budget. Their own radius is added to the test so one
 *  straddling the edge is not dropped while half of it is still on screen.
 *
 *  The cap keeps the NEAREST trees rather than the first ones found: shedding under budget should take
 *  the horizon off, not punch holes in the grove you are driving past. */
export function visibleTrees<T extends { x: number; y: number; r: number }>(
  trees: T[], cull?: Cull | null, max = Infinity,
): T[] {
  const near = cull
    ? trees.filter((t) => Math.hypot(t.x - cull.cx, t.y - cull.cy) <= cull.r + t.r)
    : trees
  if (near.length <= max) return near
  if (!cull) return near.slice(0, max)
  return near
    .map((t) => ({ t, d: Math.hypot(t.x - cull.cx, t.y - cull.cy) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((e) => e.t)
}

/** Walk trees and marshal posts together in one depth order, furthest first, handing each renderer the
 *  runs it should draw between posts. Posts are solids standing among the trees, so they cannot simply be
 *  drawn after them; this is the same interleave `sceneryScene` performs for the canvas. */
function depthInterleaved(
  trees: SceneryTree[], marshals: Scenery['marshals'], view: number,
  drawTrees: (chunk: SceneryTree[], key: string) => React.ReactNode,
  drawPosts: (posts: Scenery['marshals'], key: string) => React.ReactNode,
): React.ReactNode[] {
  const dir = dirAt(view)
  const depth = (p: { x: number; y: number }) => p.x * dir.x + p.y * dir.y
  const sorted = depthSorted(trees, dir)
  const posts = depthSorted(marshals, dir)
  const out: React.ReactNode[] = []
  let ti = 0
  posts.forEach((post, pi) => {
    let j = ti
    while (j < sorted.length && depth(sorted[j]) <= depth(post)) j++
    if (j > ti) out.push(drawTrees(sorted.slice(ti, j), `t${pi}`))
    ti = j
    out.push(drawPosts([post], `p${pi}`))
  })
  if (ti < sorted.length) out.push(drawTrees(sorted.slice(ti), 'tz'))
  return out
}

/** The solids themselves: walls, roofs, stands and canopies, all above the shadows. */
export function ScenerySolidsLayer({ scenery, u, lighting, view, cull, maxTrees, hide, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; view: number
  cull?: Cull | null; maxTrees?: number; hide?: Hidden; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  // Camera sits at +dir (raising a point pushes its image AWAY from the eye, so tops drawn at -dir
  // put the eye at +dir). A larger projection along dir is therefore NEARER: sort furthest-first and
  // the painter's order comes out right.
  const treesByDepth = hide?.has('trees') ? [] : visibleTrees(scenery.trees, cull, maxTrees)
  const solidOpts = { u, extrude: EXTRUDE, lighting, view, storeyM: STOREY_M, bayM: WINDOW_BAY_M }
  const standOpts = {
    u, extrude: EXTRUDE, lighting, view,
    frontM: STAND_FRONT_M, rearM: STAND_REAR_M, roofFrac: STAND_ROOF_FRAC,
  }
  // Trees lean exactly as much as buildings do. Giving them their own, steeper lean put two
  // different cameras in one scene; the height variation belongs in each tree's own scale.
  return (
    <g>
      {/* Walls: the swept band from roof outline to base outline, as one silhouette. The roof is
          painted over its near half below, leaving only the faces that actually face the camera. */}
      {full && !hide?.has('buildings') && buildingWallGroups(scenery.buildings, solidOpts).map((g, i) => (
        <g key={`wl${i}`} transform={`translate(${g.x} ${g.y}) rotate(${deg(g.rot)})`}>
          {g.ops.map((op, j) => (
            <path key={j} d={op.d} fill={op.fill ? paint(op.fill) : 'none'} opacity={op.alpha} />
          ))}
        </g>
      ))}

      {/* Grandstands rake: the trackside front barely lifts, the rear lifts a long way, so the deck
          climbs away from the circuit like real seating. Extruded uniformly they read as office
          blocks parked beside the track — they are a bank of seats, not a building. */}
      {!hide?.has('stands') && standGroups(scenery.stands, standOpts, full).map((g, i) => (
        <g key={`s${i}`} transform={`translate(${g.x} ${g.y}) rotate(${deg(g.rot)})`}>
          {g.ops.map((op, j) => <path key={j} d={op.d} fill={paint(op.fill!)} />)}
        </g>
      ))}

      {!hide?.has('buildings') && buildingRoofGroups(scenery.buildings, full).map((g, i) => (
        <g key={`b${i}`} transform={`translate(${g.x} ${g.y}) rotate(${deg(g.rot)})`}>
          {g.ops.map((op, j) => <path key={j} d={op.d} fill={paint(op.fill!)} />)}
        </g>
      ))}

      {/* Canopies and MARSHAL POSTS in ONE depth order, so a nearer tree covers a further one and a
          hut standing behind a tree goes behind it. Drawn in array order the canopies overlapped
          arbitrarily, which is the one thing that breaks a grove's read; drawn after every tree, a
          2.8m hut painted over a 12m tree in front of it. Each tree's trunk goes with it rather than
          in a shared layer underneath, or a near trunk would be buried by a far canopy. */}
      {full && depthInterleaved(
        treesByDepth, scenery.marshals, view,
        (chunk, key) => treeSolidOps(chunk, { u, extrude: EXTRUDE, lighting, view }).map((op, i) => (
          <path
            key={`${key}v${i}`} d={op.d} fill={op.fill ? paint(op.fill) : 'none'}
            stroke={op.stroke} strokeWidth={op.width} strokeLinecap={op.cap}
          />
        )),
        (posts, key) => marshalGroups(posts, {
          u, extrude: EXTRUDE, lighting, view, hutM: MARSHAL_H_M, hutW: MARSHAL_W_M, hutH: MARSHAL_D_M,
        }).map((g, i) => (
          <g key={`${key}mp${i}`} transform={`translate(${g.x} ${g.y}) rotate(${deg(g.rot)})`}>
            {g.shadow.map((op, k) => (
              <path key={`ms${k}`} d={op.d} fill={op.fill} opacity={op.alpha} />
            ))}
            {g.ops.map((op, j) => <path key={j} d={op.d} fill={op.fill} />)}
          </g>
        )),
      )}
    </g>
  )
}

/** Circuit furniture that belongs ON TOP of the tarmac: it lines the track edge, so drawing
 *  them with the rest of the scenery (which is painted before the ribbon) would bury them under it.
 *  All long polylines, so both LOD tiers can afford them — they are what makes the place read as a
 *  racing circuit rather than a road. */
export function TrackFurnitureLayer({ scenery, u, lighting, view, hide, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; view: number; hide?: Hidden
  detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const shFill = shadowFill(lighting)
  const shOp = shadowOpacity(lighting)
  // Every piece of furniture casts from its BASE, like every other solid on the map.
  const furnOpts = { u, extrude: EXTRUDE, lighting, view }

  // Depth convention: raising a point pushes its image AWAY from the camera, exactly as a light
  // pushes a shadow away from itself. Tops are drawn displaced by -dir (a roof sits up-light of its
  // base), so "away" is -dir and the CAMERA sits at +dir. Nearer therefore means a LARGER projection
  // along dir, and nearer draws last.
  //
  if (hide?.has('furniture')) return null
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
          {/* Debris fencing is tall, so leaving it shadowless makes it levitate too — but it is a
              mesh, so what it casts is faint. */}
          {full && scenery.fences.flatMap((b, i) => (
            runShadowOp(b.pts, FENCE_H_M, furnOpts).map((op, k) => (
              <path key={`fs${i}-${k}`} opacity={op.alpha} fill={op.fill} stroke="none" d={op.d} />
            ))
          ))}
        </g>
      )}

      {/* Debris fencing is a solid on a curve. It needs the height face between its top line and its
          base, or it is a line plus a detached shadow and reads as floating above the ground. That
          face is a cage rather than a wall, so it is drawn see-through with its posts as verticals —
          one path for a whole circuit's worth. */}
      {full && fenceOps(scenery.fences, { ...furnOpts, fenceM: FENCE_H_M }).map((ops, i) => (
        <g key={`bf${i}`}>
          {ops.map((op, j) => (
            <path
              key={j} d={op.d} fill={op.fill ?? 'none'} stroke={op.stroke}
              strokeWidth={op.width} opacity={op.alpha}
            />
          ))}
        </g>
      ))}

    </g>
  )
}
