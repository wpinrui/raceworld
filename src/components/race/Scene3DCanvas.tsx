'use client'

// #3d-port increment 5 — the world on a WebGL canvas, replacing the 2D SceneryCanvas behind the same
// camera machinery. The canvas is viewport-sized at device resolution, exactly as its predecessor
// was, and the orthographic camera reproduces the map's own pan/zoom/rotate transform to the pixel
// (`applyLiveCam`, pinned by test), so the DOM overlay of cars, crews and signs keeps sitting on the
// world it always sat on.
//
// The component owns the renderer and assigns its painter into the map's `paintRef`, so a camera
// move never goes near React: `applyCam` calls the painter the same way it always has. The sun's
// shadow map refits to the framed extent on every paint, which is what keeps afternoon's two-metre
// shadows real at racing zoom.

import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Lighting } from '@/lib/ui/lighting'
import { applyOrbitCam, type OrbitCam } from '@/lib/scene3d/camera3d'
import { balanceAmbient, refitShadow } from '@/lib/scene3d/lighting3d'
import {
  applyToneMapping, buildSky, refitFog, type SkyEnv,
} from '@/lib/scene3d/sky3d'
import { bakeWorldEnv, type WorldEnv } from '@/lib/scene3d/env3d'
import { buildPost, type Post } from '@/lib/scene3d/post3d'
import { type World3D } from '@/lib/scene3d/world3d'
import { SceneToggles, type SceneParts } from './SceneToggles'

export function Scene3DCanvas({ world, carsGroup, crewGroup, base, lighting, night, skySeed, ppu, unitsPerMetre, camRef, camera, paintRef, className }: {
  world: World3D | null
  /** The live car field, mounted beside the world so a circuit rebuild never drops the cars. */
  carsGroup?: THREE.Group | null
  /** The pit crews, likewise. */
  crewGroup?: THREE.Group | null
  /** The ground's own colour, the fallback clear if a sky cannot be baked on this machine. */
  base: string
  /** The race's light: the sky is baked from the same four scalars the rig is built from. */
  lighting: Lighting
  night?: boolean
  /** Freezes the sky's cloud field, so each circuit wears its own weather. */
  skySeed?: number
  /** Stage pixels per viewBox unit at zoom 1: half of the camera's scale, the stage's letterbox fit. */
  ppu: number
  /** The circuit's own scale, for sizing the occlusion radius in metres rather than in units. */
  unitsPerMetre: number
  /** The map's orbit state, read imperatively on every paint. */
  camRef: React.RefObject<OrbitCam>
  /** The one perspective camera, owned by the map so its loop can project the DOM overlay with it. */
  camera: THREE.PerspectiveCamera
  /** The map's painter slot: assigned here, called from `applyCam` outside React. */
  paintRef: React.MutableRefObject<() => void>
  className?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The frame counter writes straight into its own node. Through React state it would set state on
  // every frame it measures, re-render the canvas host, and be reporting the cost of reporting.
  const fpsRef = useRef<HTMLSpanElement>(null)
  const costRef = useRef<HTMLSpanElement>(null)
  // `n` and `since` are the counter's own window, reset twice a second. `total` never resets: it is
  // how anything else can tell whether a paint has happened, which is what keeps a second painter
  // from adding frames to a display refresh that already had one.
  const frames = useRef({ n: 0, since: 0, total: 0 })
  const glRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    post: Post
  } | null>(null)
  // Read by the painter, which runs outside React: always the last committed props, never a
  // closure's snapshot of them. Synced by the dependency-less effect below, which commits before
  // any later effect (here or in the parent) can call the painter.
  const stateRef = useRef({ world, ppu, carsGroup, crewGroup })
  // Whether the mounted environment carries the sky's share of the light, read by the scene-swap
  // effect below. A ref, because the world and the sky are swapped by two independent effects and
  // whichever runs second has to see the other's answer.
  const envRef = useRef(false)

  const paint = useCallback(() => {
    const gl = glRef.current
    const cam = camRef.current
    const canvas = canvasRef.current
    const { world, ppu } = stateRef.current
    if (!gl || !cam || !canvas) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    if (world) {
      const frame = applyOrbitCam(camera, cam, { w, h }, ppu)
      // The shadow box wraps the framed extent with roll slack: a rotated viewport's world
      // footprint is its diagonal, and a box fitted to the unrotated frame clips corner shadows.
      const half = Math.hypot(frame.halfW, frame.halfH)
      refitShadow(world.sun, {
        x: frame.cx - half, y: frame.cz - half, w: 2 * half, h: 2 * half,
      })
      // The wood's detail tiers are camera-relative, so they refit exactly where the shadow box and
      // the haze do: on the camera MOVING, never per frame.
      world.trees.update(camera.position)
      // Haze follows the camera for the same reason the shadow box does: it is fitted to the shot,
      // not to the circuit. It is fitted against the world's OWN ground plane, so the fog is
      // finished before any edge of it can show.
      if (gl.scene.fog instanceof THREE.Fog) refitFog(gl.scene.fog, camera, world.ground)
      // Counted across the WHOLE chain, not just the beauty pass. `autoReset` is off (set with the
      // renderer), so every pass adds to one tally: the shadow map, the occlusion buffer's depth and
      // normals, the beauty draw, the bloom pyramid. That total is what the frame actually submits,
      // and submitting is a per-draw cost that no amount of shrinking the window touches.
      gl.renderer.info.reset()
      gl.post.render()
      // Counted HERE rather than off a rAF loop of its own: this is the app's only render, so its
      // rate is the frame rate. A separate loop would report how often the browser offered a frame,
      // which is 60 whatever the scene costs.
      const f = frames.current
      const now = performance.now()
      f.n++
      f.total++
      if (f.since === 0) {
        f.since = now
      } else if (now - f.since >= 500) {
        if (fpsRef.current) fpsRef.current.textContent = ((f.n * 1000) / (now - f.since)).toFixed(0)
        if (costRef.current) {
          const { calls, triangles } = gl.renderer.info.render
          costRef.current.textContent = `${calls} draws  ${(triangles / 1e6).toFixed(1)}M tris`
        }
        f.n = 0
        f.since = now
      }
    }
  }, [camRef, camera])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // The painter resets this itself, once per frame, so one tally covers every pass in the chain.
    renderer.info.autoReset = false
    applyToneMapping(renderer)
    const scene = new THREE.Scene()
    // MSAA moves to the composer's target: `antialias` above applies to the default framebuffer,
    // which the composer no longer draws to.
    glRef.current = { renderer, scene, post: buildPost(renderer, scene, camera, unitsPerMetre) }
    // The same console handle the probe viewer exposes, on the live map.
    ;(window as unknown as { __scene3d?: THREE.Scene }).__scene3d = scene
    return () => {
      glRef.current?.post.dispose()
      renderer.dispose()
      glRef.current = null
    }
  }, [camera, unitsPerMetre])

  useEffect(() => {
    stateRef.current = { world, ppu, carsGroup, crewGroup }
  })

  // The world swaps only when the WORLD does: a new circuit, the lap's ink arriving, the grid being
  // painted. The camera never touches it.
  //
  // DECLARED BEFORE THE SKY, and it has to stay that way: the sky effect below shoots this scene
  // into a reflection probe, so the world it is meant to reflect must already be in it. React runs
  // effects in declaration order, and both re-run when the world does.
  useEffect(() => {
    const gl = glRef.current
    if (!gl) return
    gl.scene.clear()
    // The environment map IS the sky light, so the rig's own hemisphere stands down to it.
    if (world) balanceAmbient(world.sky, envRef.current)
    if (world) gl.scene.add(world.group)
    if (carsGroup) gl.scene.add(carsGroup)
    if (crewGroup) gl.scene.add(crewGroup)
    paint()
  }, [world, carsGroup, crewGroup, paint])

  // The sky is baked, not drawn: it changes when the MOOD changes and never on a camera move. The
  // fog is born with it, carrying the sky's own measured horizon colour, and is refitted per paint.
  // The world's own reflection probe is baked here too, off the sky this run just mounted.
  useEffect(() => {
    const gl = glRef.current
    if (!gl) return
    let env: SkyEnv | null = null
    try {
      env = buildSky(gl.renderer, lighting, { night, seed: skySeed })
    } catch {
      // A machine that cannot bake one still gets its race, against the ground's own colour as
      // before. Nothing else in the scene depends on the sky existing.
    }
    gl.scene.background = env ? env.texture : new THREE.Color(base)
    gl.scene.backgroundIntensity = env ? env.intensity : 1
    // The sky LIGHTS the world, not just backs it: every standard material reads its ambient and
    // its reflections out of this. Same intensity as the background, because it is the same sky.
    gl.scene.environment = env?.environment ?? null
    gl.scene.environmentIntensity = env ? env.lightIntensity : 1
    envRef.current = !!env?.lightsScene
    // The world may already be mounted (a mood change swaps only the sky), so re-balance it here
    // too rather than waiting for a world that is not going to be rebuilt.
    if (world) balanceAmbient(world.sky, envRef.current)
    // Near and far are placeholders: every paint refits them to what the camera can see.
    gl.scene.fog = env ? new THREE.Fog(env.horizon, 1, 2) : null
    // ...and now the world goes in front of that sky, from a probe over the start straight, and
    // THAT is what everything reflects. A sky-only environment is why paint read as vinyl: a flank
    // is nearly all horizon and almost no sky. Once per world and once per mood, never per frame.
    let worldEnv: WorldEnv | null = null
    if (world) {
      // The wood packs its detail tiers to whoever is looking, and for six faces that is the probe.
      // The `paint()` below hands them straight back to the live camera.
      world.trees.update(world.probe)
      worldEnv = bakeWorldEnv(gl.renderer, gl.scene, {
        at: world.probe,
        ground: world.ground,
        // Off the ref, not the props: the movers are hidden for the bake either way, so their
        // arriving is no reason to re-shoot the sky and the probe.
        hide: [stateRef.current.carsGroup, stateRef.current.crewGroup],
      })
      if (worldEnv) {
        gl.scene.environment = worldEnv.environment
        gl.scene.environmentIntensity = worldEnv.intensity
      }
    }
    paint()
    return () => {
      // Only while the context is still alive. React runs effect cleanups in DECLARATION order, so
      // on unmount the renderer effect above has already called `renderer.dispose()` by the time
      // this runs, and three then tries to free the cube's six framebuffers out of the per-target
      // property map that `dispose()` just emptied: `__webglFramebuffer[0]` of undefined, a hard
      // throw on every StrictMode remount. Nothing leaks by skipping it, because disposing the
      // renderer released the whole context the cube lived in. The path that DOES need freeing, a
      // mood change, re-runs this with the renderer alive and frees normally.
      if (!glRef.current) return
      worldEnv?.dispose()
      env?.dispose()
      envRef.current = false
      gl.scene.background = null
      gl.scene.environment = null
      gl.scene.fog = null
    }
  }, [lighting, night, skySeed, base, world, paint])

  useEffect(() => {
    paintRef.current = paint
    return () => {
      paintRef.current = () => {}
    }
  }, [paintRef, paint])

  // The GL trio, handed to the switch panel as a getter rather than as a value: the renderer effect
  // above owns it, it is null until that effect has run, and the panel reads it per action.
  const glParts = useCallback((): SceneParts | null => glRef.current, [])

  useEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas) return
    const fit = () => {
      const gl = glRef.current
      if (!gl) return
      const dpr = window.devicePixelRatio || 1
      const { width, height } = box.getBoundingClientRect()
      gl.renderer.setPixelRatio(dpr)
      gl.renderer.setSize(Math.round(width), Math.round(height), true)
      gl.post.setSize(Math.round(width), Math.round(height), dpr)
      paint()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [paint])

  return (
    <div ref={boxRef} className={className}>
      <canvas ref={canvasRef} className="absolute inset-0" />
      <SceneToggles
        gl={glParts} repaint={paint} world={world}
        fpsRef={fpsRef} costRef={costRef} frames={frames}
      />
    </div>
  )
}
