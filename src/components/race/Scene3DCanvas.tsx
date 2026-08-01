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
import { applyOrbitCam, type OrbitCam } from '@/lib/scene3d/camera3d'
import { refitShadow } from '@/lib/scene3d/lighting3d'
import type { World3D } from '@/lib/scene3d/world3d'

export function Scene3DCanvas({ world, carsGroup, crewGroup, base, vb, ppu, camRef, camera, paintRef, className }: {
  world: World3D | null
  /** The live car field, mounted beside the world so a circuit rebuild never drops the cars. */
  carsGroup?: THREE.Group | null
  /** The pit crews, likewise. */
  crewGroup?: THREE.Group | null
  /** The ground's own colour: the GL clear, exactly as the 2D filled before painting. */
  base: string
  vb: ViewBox
  /** Stage pixels per viewBox unit at zoom 1: half of the camera's scale, the stage's letterbox fit. */
  ppu: number
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
  const stateRef = useRef({ world, base, vb, ppu })

  const paint = useCallback(() => {
    const gl = glRef.current
    const cam = camRef.current
    const canvas = canvasRef.current
    const { world, base, ppu } = stateRef.current
    if (!gl || !cam || !canvas) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    gl.scene.background = new THREE.Color(base)
    if (world) {
      const frame = applyOrbitCam(camera, cam, { w, h }, ppu)
      // The shadow box wraps the framed extent with roll slack: a rotated viewport's world
      // footprint is its diagonal, and a box fitted to the unrotated frame clips corner shadows.
      const half = Math.hypot(frame.halfW, frame.halfH)
      refitShadow(world.sun, {
        x: frame.cx - half, y: frame.cz - half, w: 2 * half, h: 2 * half,
      })
      gl.renderer.render(gl.scene, camera)
    }
  }, [camRef, camera])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    glRef.current = { renderer, scene: new THREE.Scene() }
    return () => {
      renderer.dispose()
      glRef.current = null
    }
  }, [])

  useEffect(() => {
    stateRef.current = { world, base, vb, ppu }
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
