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
  Aperture, Armchair, Building2, Car, ChevronDown, ChevronUp, Fence, Gauge, HardHat, Mountain,
  Repeat, Sparkles, Sun, TreePine, Users, Warehouse, Wrench, type LucideIcon,
} from 'lucide-react'
import * as THREE from 'three'
import type { Post } from '@/lib/scene3d/post3d'

/** One switchable population, addressed by the `name` its builder stamps on it. */
interface Part {
  key: string
  label: string
  icon: LucideIcon
  /** Held INSIDE the row above it, and counted inside that row's total too. Indented so the
   *  containment reads: switching the parent off takes the child with it. */
  within?: boolean
}

/** Ordered as the question is usually asked: the two big populations first, then what each is made
 *  of, then everything else standing in the world, then the passes over the whole frame. */
const PARTS: Part[] = [
  { key: 'tree:near', label: 'Trees near', icon: TreePine },
  { key: 'tree:far', label: 'Trees far', icon: TreePine },
  { key: 'stands', label: 'Stands', icon: Warehouse },
  { key: 'seats', label: 'Seats', icon: Armchair, within: true },
  { key: 'crowd', label: 'Crowd', icon: Users, within: true },
  { key: 'buildings', label: 'Buildings', icon: Building2 },
  { key: 'fences', label: 'Fences', icon: Fence },
  { key: 'marshals', label: 'Marshals', icon: HardHat },
  { key: 'farland', label: 'Far land', icon: Mountain },
  { key: 'cars', label: 'Cars', icon: Car },
  { key: 'crew', label: 'Crew', icon: Wrench },
]

/** The whole-frame switches: not populations, so they are held apart and applied differently. */
const PASSES = [
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

/** Every object carrying this name, wherever it stands. Populations are scattered (a stand per
 *  footprint, a tree buffer per species), so a name is a set and never a single object. */
function named(scene: THREE.Object3D, key: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse((o) => {
    if (o.name === key) found.push(o)
  })
  return found
}

/** What a population is submitting right now: instanced draws at their LIVE count, and only the
 *  levels of a detail ladder that are actually up. Invisible branches are skipped for the same
 *  reason: the number has to be what this frame pays, not what the scene holds. */
function trianglesOf(roots: readonly THREE.Object3D[]): number {
  let total = 0
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry
      const per = (g.index ? g.index.count : g.attributes.position.count) / 3
      total += o instanceof THREE.InstancedMesh ? per * o.count : per
    }
    for (const child of o.children) walk(child)
  }
  for (const root of roots) walk(root)
  return Math.round(total)
}

export function SceneToggles({ gl, repaint, world, fpsRef }: {
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
}) {
  const [open, setOpen] = useState(false)
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set())
  const [passOff, setPassOff] = useState<ReadonlySet<PassKey>>(() => new Set())
  const [tris, setTris] = useState<Record<string, number>>({})
  const [spin, setSpin] = useState(false)
  // What this panel hid, so it can restore exactly that and nothing else.
  const held = useRef(new Map<string, THREE.Object3D[]>())
  // The world the held objects came out of. A rebuild replaces every one of them, so the record has
  // to be thrown away and taken again rather than restored onto a scene that no longer exists.
  const heldFrom = useRef(world)

  const measure = useCallback(() => {
    const parts = gl()
    if (!parts) return
    const counts: Record<string, number> = {}
    for (const p of PARTS) counts[p.key] = trianglesOf(named(parts.scene, p.key))
    setTris(counts)
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
      const objects = named(parts.scene, key).filter((o) => o.visible)
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
  useEffect(() => {
    if (!spin) return
    let raf = 0
    const tick = () => {
      repaint()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [spin, repaint])

  const flip = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }

  const row = (
    key: string, label: string, Icon: LucideIcon, on: boolean, click: () => void,
    count?: number, within?: boolean,
  ) => (
    <button
      key={key}
      type="button"
      onClick={click}
      className={`flex w-full items-center gap-2 rounded py-0.5 pr-1.5 text-left text-white hover:bg-white/10 ${within ? 'pl-4' : 'pl-1.5'}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${on ? 'text-[#00D9FF]' : 'text-[#6B7280]'}`} />
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="tabular-nums text-white">{Math.round(count / 1000)}k</span>
      )}
    </button>
  )

  return (
    <div className="pointer-events-none absolute right-2 top-2 flex w-40 flex-col items-stretch gap-1 font-mono text-xs">
      <button
        type="button"
        onClick={() => { setOpen(!open); measure() }}
        className="pointer-events-auto flex items-center gap-1.5 self-end rounded bg-black/55 px-2 py-1 text-white"
      >
        <Gauge className="h-3.5 w-3.5" />
        <span ref={fpsRef}>--</span>
        <span>fps</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="pointer-events-auto flex flex-col rounded bg-black/70 p-1">
          {PARTS.map((p) => row(
            p.key, p.label, p.icon, !off.has(p.key),
            () => setOff((s) => flip(s, p.key)), tris[p.key], p.within,
          ))}
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
