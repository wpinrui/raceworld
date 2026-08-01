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
import type { ViewBox } from '@/lib/ui/geom'
import type { Lighting } from '@/lib/ui/lighting'
import { applyOrbitCam, type OrbitCam } from '@/lib/scene3d/camera3d'
import { refitShadow } from '@/lib/scene3d/lighting3d'
import {
  applyToneMapping, buildSky, refitFog, type SkyEnv,
} from '@/lib/scene3d/sky3d'
import { GROUND_PAD, type World3D } from '@/lib/scene3d/world3d'

export function Scene3DCanvas({ world, carsGroup, crewGroup, base, lighting, night, skySeed, vb, ppu, metresPerUnit, camRef, camera, paintRef, className }: {
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
  vb: ViewBox
  /** Stage pixels per viewBox unit at zoom 1: half of the camera's scale, the stage's letterbox fit. */
  ppu: number
  /** The circuit's real scale, so the haze can hold one visibility in METRES across every track. */
  metresPerUnit: number
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
  const glRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
  } | null>(null)
  // Read by the painter, which runs outside React: always the last committed props, never a
  // closure's snapshot of them. Synced by the dependency-less effect below, which commits before
  // any later effect (here or in the parent) can call the painter.
  const stateRef = useRef({ world, base, vb, ppu, metresPerUnit })

  const paint = useCallback(() => {
    const gl = glRef.current
    const cam = camRef.current
    const canvas = canvasRef.current
    const { world, vb, ppu, metresPerUnit } = stateRef.current
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
      // Haze follows the camera for the same reason the shadow box does: it is fitted to the shot,
      // not to the circuit. The radius is the ground plane's INSCRIBED reach, the nearest distance
      // at which the world can stop, so the fog is finished before any edge of it can show.
      if (gl.scene.fog instanceof THREE.Fog) {
        refitFog(gl.scene.fog, camera, {
          x: vb.x + vb.w / 2, z: vb.y + vb.h / 2,
          radius: Math.min(vb.w, vb.h) / 2 + GROUND_PAD, metresPerUnit,
        })
      }
      gl.renderer.render(gl.scene, camera)
    }
  }, [camRef, camera])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    applyToneMapping(renderer)
    const scene = new THREE.Scene()
    glRef.current = { renderer, scene }
    // The same console handle the probe viewer exposes, on the live map.
    ;(window as unknown as { __scene3d?: THREE.Scene }).__scene3d = scene
    return () => {
      renderer.dispose()
      glRef.current = null
    }
  }, [])

  // The sky is baked, not drawn: it changes when the MOOD changes and never on a camera move. The
  // fog is born with it, carrying the sky's own measured horizon colour, and is refitted per paint.
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
    // Near and far are placeholders: every paint refits them to what the camera can see.
    gl.scene.fog = env ? new THREE.Fog(env.horizon, 1, 2) : null
    paint()
    return () => {
      env?.dispose()
      gl.scene.background = null
      gl.scene.fog = null
    }
  }, [lighting, night, skySeed, base, paint])

  useEffect(() => {
    stateRef.current = { world, base, vb, ppu, metresPerUnit }
  })

  // The world swaps only when the WORLD does: a new circuit, the lap's ink arriving, the grid being
  // painted. The camera never touches it.
  useEffect(() => {
    const gl = glRef.current
    if (!gl) return
    gl.scene.clear()
    if (world) gl.scene.add(world.group)
    if (carsGroup) gl.scene.add(carsGroup)
    if (crewGroup) gl.scene.add(crewGroup)
    paint()
  }, [world, carsGroup, crewGroup, paint])

  useEffect(() => {
    paintRef.current = paint
    return () => {
      paintRef.current = () => {}
    }
  }, [paintRef, paint])

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
    </div>
  )
}
