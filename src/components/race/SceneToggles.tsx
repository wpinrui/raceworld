'use client'

// The scene, switchable a population at a time, next to the frame counter that answers it.
//
// The fps readout says what the picture costs; it cannot say what any PART of it costs. This does:
// switch the wood off, read the counter, switch it back. The whole point is that the answer comes off
// the real scene on the real machine at the real camera, rather than off a probe's guess at all three.
//
// Nothing here changes what the game draws by default. Every row starts on, and a row is a `visible`
// flag on objects the scene builders NAME (`tree:near`, `seats`, `crowd`, `stands`, ...), restored
// exactly as it was found: the panel remembers what it hid and puts back only that, so it can never
// reveal something another part of the app is deliberately holding back.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Aperture, Armchair, Boxes, Building2, Car, ChevronDown, ChevronUp, Container, Fence, Gauge,
  HardHat, Image as ImageIcon, Layers, Mountain, Repeat, Shapes, Sparkles, Sun, TreePine, Users,
  Warehouse, Wrench, type LucideIcon,
} from 'lucide-react'
import * as THREE from 'three'
import type { Post } from '@/lib/scene3d/post3d'

/** One switchable population, addressed by the `name`s its builders stamp on it. A list rather than
 *  one name because a population is not always one subtree: the pit complex and its garage boards
 *  are built by two hands and mounted side by side, and they are still one thing to switch. */
interface Part {
  key: string
  label: string
  icon: LucideIcon
  names: string[]
  /** Held INSIDE the row above it, and counted inside that row's total too. Indented so the
   *  containment reads: switching the parent off takes the child with it. */
  within?: boolean
}

/** Ordered as the question is usually asked: the two big populations first, then what each is made
 *  of, then everything else standing in the world, then the passes over the whole frame. */
const PARTS: Part[] = [
  { key: 'tree:near', label: 'Trees near', icon: TreePine, names: ['tree:near'] },
  { key: 'tree:far', label: 'Trees far', icon: TreePine, names: ['tree:far'] },
  { key: 'stands', label: 'Stands', icon: Warehouse, names: ['stands'] },
  { key: 'seats', label: 'Seats', icon: Armchair, names: ['seats'], within: true },
  { key: 'crowd', label: 'Crowd', icon: Users, names: ['crowd'], within: true },
  { key: 'pits', label: 'Pits', icon: Container, names: ['pits', 'pit-signs'] },
  { key: 'buildings', label: 'Buildings', icon: Building2, names: ['buildings'] },
  { key: 'fences', label: 'Fences', icon: Fence, names: ['fences'] },
  { key: 'marshals', label: 'Marshals', icon: HardHat, names: ['marshals'] },
  { key: 'ground', label: 'Ground', icon: Layers, names: ['ground'] },
  { key: 'farland', label: 'Far land', icon: Mountain, names: ['farland'] },
  { key: 'cars', label: 'Cars', icon: Car, names: ['cars'] },
  { key: 'crew', label: 'Crew', icon: Wrench, names: ['crew'] },
]

/** The whole-frame switches: not populations, so they are held apart and applied differently. */
const PASSES = [
  { key: 'textures', label: 'Textures', icon: ImageIcon },
  { key: 'shadows', label: 'Shadows', icon: Sun },
  { key: 'ao', label: 'Occlusion', icon: Aperture },
  { key: 'bloom', label: 'Bloom', icon: Sparkles },
] as const

type PassKey = (typeof PASSES)[number]['key']

export interface SceneParts {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  post: Post
}

/** The flat stand-in for a skinned material: the same surface with every map taken off it.
 *
 *  Swapping the whole material rather than nulling the maps on the one that is there, because the
 *  skinned surfaces carry hand-written shader patches (the stochastic sampler, the two-scan blend,
 *  the tiling break) that are wired to uniforms those maps supply. Nulling `map` leaves that code
 *  compiled against nothing. A different material has none of it.
 *
 *  What survives is everything the picture's STRUCTURE depends on: sidedness, blending, the painter
 *  stack's depth bias, the cutout threshold. What goes is the sampling, which is the question. */
function flatten(source: THREE.Material): THREE.Material {
  const flat = new THREE.MeshStandardMaterial()
  const lit = source as THREE.MeshStandardMaterial
  if (lit.color) flat.color.copy(lit.color)
  if (lit.roughness !== undefined) flat.roughness = lit.roughness
  if (lit.metalness !== undefined) flat.metalness = lit.metalness
  if (lit.emissive) flat.emissive.copy(lit.emissive)
  flat.side = source.side
  flat.transparent = source.transparent
  flat.opacity = source.opacity
  flat.alphaTest = source.alphaTest
  flat.depthWrite = source.depthWrite
  flat.depthTest = source.depthTest
  flat.blending = source.blending
  flat.polygonOffset = source.polygonOffset
  flat.polygonOffsetFactor = source.polygonOffsetFactor
  flat.polygonOffsetUnits = source.polygonOffsetUnits
  return flat
}

/** Every object carrying one of these names, wherever it stands. Populations are scattered (a stand
 *  per footprint, a tree buffer per species), so a name is a set and never a single object. */
function named(scene: THREE.Object3D, names: readonly string[]): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse((o) => {
    if (names.includes(o.name)) found.push(o)
  })
  return found
}

/** What a population is submitting right now: one entry per mesh, since a mesh is a draw call, and
 *  triangles with instanced meshes counted at their LIVE count. Only the levels of a detail ladder
 *  that are actually up, and invisible branches skipped, for the same reason: the numbers have to be
 *  what this frame pays, not what the scene holds.
 *
 *  Collected into a Set rather than counted, because the populations NEST (seats and the crowd live
 *  inside the stands) and a scene-wide remainder has to be a union, not a sum. */
function submittedBy(roots: readonly THREE.Object3D[], into: Set<THREE.Mesh>): void {
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return
    if (o instanceof THREE.Mesh) into.add(o)
    for (const child of o.children) walk(child)
  }
  for (const root of roots) walk(root)
}

function trianglesIn(meshes: Iterable<THREE.Mesh>): number {
  let total = 0
  for (const o of meshes) {
    const g = o.geometry as THREE.BufferGeometry
    const per = (g.index ? g.index.count : g.attributes.position.count) / 3
    total += o instanceof THREE.InstancedMesh ? per * o.count : per
  }
  return Math.round(total)
}

export function SceneToggles({ gl, repaint, world, fpsRef, costRef, frames }: {
  /** The live GL trio, read on demand: the renderer effect owns it and it outlives no world. */
  gl: () => SceneParts | null
  /** Redraw with the switches as they now stand. */
  repaint: () => void
  /** The mounted world. Changes when the circuit is rebuilt, which invalidates every object this
   *  panel is holding, so the hides are laid on again against the new scene. */
  world: unknown
  /** The frame counter's node. The painter writes into it directly, outside React, because a
   *  counter that re-renders on every frame it measures is measuring itself. */
  fpsRef: React.RefObject<HTMLSpanElement | null>
  /** Draw calls and triangles for the whole chain, written the same way and for the same reason. */
  costRef: React.RefObject<HTMLSpanElement | null>
  /** The painter's running tally, for Spin to tell a frame nobody drew from one already drawn. */
  frames: React.RefObject<{ total: number }>
}) {
  const [open, setOpen] = useState(false)
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set())
  // Occlusion starts OFF, as the chain builds it (`post3d`). The switch reports what is actually
  // running, so its initial state has to agree with that rather than with a tidier default.
  const [passOff, setPassOff] = useState<ReadonlySet<PassKey>>(() => new Set<PassKey>(['ao']))
  const [cost, setCost] = useState<Record<string, { draws: number; tris: number }>>({})
  const [spin, setSpin] = useState(false)
  // What this panel hid, so it can restore exactly that and nothing else.
  const held = useRef(new Map<string, THREE.Object3D[]>())
  // The world the held objects came out of. A rebuild replaces every one of them, so the record has
  // to be thrown away and taken again rather than restored onto a scene that no longer exists.
  const heldFrom = useRef(world)
  // The skinned materials this panel swapped out, and the flat stand-ins it made, so both can be put
  // back and freed rather than leaked one toggle at a time.
  const skins = useRef(new Map<THREE.Mesh, THREE.Material | THREE.Material[]>())
  // Its own record of which world the swap was made against. It cannot share the hides' one: that is
  // updated by the effect above, which runs first, so by the time this reads it the rebuild has
  // already been marked as handled.
  const skinsFrom = useRef(world)

  const measure = useCallback(() => {
    const parts = gl()
    if (!parts) return
    const counts: Record<string, { draws: number; tris: number }> = {}
    const attributed = new Set<THREE.Mesh>()
    for (const p of PARTS) {
      const mine = new Set<THREE.Mesh>()
      submittedBy(named(parts.scene, p.names), mine)
      counts[p.key] = { draws: mine.size, tris: trianglesIn(mine) }
      for (const m of mine) attributed.add(m)
    }
    // Whatever no row owns: the ground stack's paint layers, the road ribbons, the compiled ink, the
    // kerbs, the start line. Named as a residual on purpose, because a breakdown that quietly leaves
    // half the scene out of the total is how you end up optimising the wrong half.
    const all = new Set<THREE.Mesh>()
    submittedBy([parts.scene], all)
    const rest = [...all].filter((m) => !attributed.has(m))
    counts.rest = { draws: rest.length, tris: trianglesIn(rest) }
    counts.all = { draws: all.size, tris: trianglesIn(all) }
    setCost(counts)
  }, [gl])

  // Lay the current switch positions on the scene. Runs on a toggle and on a world swap alike: after
  // a rebuild the held objects belong to a scene that is gone, so the set is re-collected from
  // whatever is mounted now.
  useEffect(() => {
    const parts = gl()
    if (!parts) return
    if (heldFrom.current !== world) {
      held.current.clear()
      heldFrom.current = world
    }
    for (const [key, objects] of held.current) {
      if (off.has(key)) continue
      for (const o of objects) o.visible = true
      held.current.delete(key)
    }
    for (const key of off) {
      // Collected ONCE per key per world: a second pass would find everything already hidden, take
      // an empty set, and lose what it has to put back.
      if (held.current.has(key)) continue
      const part = PARTS.find((p) => p.key === key)
      if (!part) continue
      const objects = named(parts.scene, part.names).filter((o) => o.visible)
      for (const o of objects) o.visible = false
      held.current.set(key, objects)
    }
    repaint()
    // Counted on the far side of the paint, not inside this effect: the numbers describe what the
    // frame just drew, and taking them here would both precede that frame and set state mid-effect.
    const raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [off, world, gl, repaint, measure])

  useEffect(() => {
    const parts = gl()
    if (!parts) return
    const flatten_ = passOff.has('textures')
    // Re-taken after a world swap for the same reason the hides are: these meshes are gone.
    const rebuilt = skinsFrom.current !== world
    skinsFrom.current = world
    if (skins.current.size > 0 && (!flatten_ || rebuilt)) {
      for (const [mesh, original] of skins.current) {
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose()
        // A rebuilt world's meshes are detached, so this puts the skins back onto nothing. Harmless,
        // and the alternative is holding a dead scene's materials alive to be tidy about it.
        mesh.material = original
      }
      skins.current.clear()
    }
    if (flatten_ && skins.current.size === 0) {
      parts.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        skins.current.set(o, o.material)
        o.material = Array.isArray(o.material) ? o.material.map(flatten) : flatten(o.material)
      })
    }
    const shadows = !passOff.has('shadows')
    if (parts.renderer.shadowMap.enabled !== shadows) {
      parts.renderer.shadowMap.enabled = shadows
      // Shadow reception is compiled into every lit material, so the whole scene needs rebuilding
      // when the map comes and goes. Without this the world keeps the shading it was built with and
      // the switch does nothing visible while still costing the map.
      parts.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true
      })
    }
    parts.post.setPass('ao', !passOff.has('ao'))
    parts.post.setPass('bloom', !passOff.has('bloom'))
    repaint()
  }, [passOff, world, gl, repaint])

  // A paint loop, for reading the counter while nothing moves. The counter only ticks on a paint,
  // and outside a running race the map paints when the camera does, so a standing measurement has
  // nothing to count. This gives it something.
  //
  // It FILLS IN rather than adds: a display refresh that the race loop or a camera drag has already
  // painted is left alone. Painting it twice would put two frames into the counter's window for one
  // frame on screen, and the readout would come back at double, which is worse than no readout.
  useEffect(() => {
    if (!spin) return
    let raf = 0
    let seen = -1
    const tick = () => {
      if (frames.current.total === seen) repaint()
      seen = frames.current.total
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [spin, repaint, frames])

  const flip = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }

  const row = (
    key: string, label: string, Icon: LucideIcon, on: boolean, click: () => void,
    spend?: { draws: number; tris: number }, within?: boolean,
  ) => (
    <button
      key={key}
      type="button"
      onClick={click}
      className={`flex w-full items-center gap-2 rounded py-0.5 pr-1.5 text-left text-white hover:bg-white/10 ${within ? 'pl-4' : 'pl-1.5'}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${on ? 'text-[#00D9FF]' : 'text-[#6B7280]'}`} />
      <span className="flex-1">{label}</span>
      {spend && spend.draws > 0 && (
        <>
          <span className="w-10 text-right tabular-nums text-white">{spend.draws}</span>
          <span className="w-10 text-right tabular-nums text-white">
            {spend.tris >= 1000 ? `${Math.round(spend.tris / 1000)}k` : spend.tris}
          </span>
        </>
      )}
    </button>
  )

  return (
    // Top LEFT: the map's own controls own the right-hand side (driver card and map view at the top,
    // the zoom readout and reset at the bottom), and a debug panel does not get to sit on them.
    <div className="pointer-events-none absolute left-2 top-2 flex w-56 flex-col items-stretch gap-1 font-mono text-xs">
      <button
        type="button"
        onClick={() => { setOpen(!open); measure() }}
        className="pointer-events-auto flex items-center gap-1.5 self-start rounded bg-black/55 px-2 py-1 text-white"
      >
        <Gauge className="h-3.5 w-3.5" />
        <span ref={fpsRef}>--</span>
        <span>fps</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <span
          ref={costRef}
          className="pointer-events-auto self-start whitespace-nowrap rounded bg-black/55 px-2 py-1 text-white"
        />
      )}
      {open && (
        <div className="pointer-events-auto flex flex-col rounded bg-black/70 p-1">
          {PARTS.map((p) => row(
            p.key, p.label, p.icon, !off.has(p.key),
            () => setOff((s) => flip(s, p.key)), cost[p.key], p.within,
          ))}
          <div className="my-1 h-px bg-white/20" />
          {row('rest', 'Unlisted', Shapes, true, measure, cost.rest)}
          {row('all', 'Scene', Boxes, true, measure, cost.all)}
          <div className="my-1 h-px bg-white/20" />
          {PASSES.map((p) => row(
            p.key, p.label, p.icon, !passOff.has(p.key),
            () => setPassOff((s) => flip(s, p.key) as ReadonlySet<PassKey>),
          ))}
          {row('spin', 'Spin', Repeat, spin, () => setSpin((s) => !s))}
        </div>
      )}
    </div>
  )
}
