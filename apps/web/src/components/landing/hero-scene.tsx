'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useReducedMotion } from '@/lib/hooks/use-reduced-motion'

/**
 * The balance wire under a ceiling plane.
 *
 * One agent's running balance across a window: it starts at zero, dips below as
 * the agent spends, climbs above as it earns, and returns to zero at settlement.
 * Above it floats the ceiling — a hard limit the dip approaches and never crosses.
 * That is Tab's whole mechanism as one object, which is why the hero is this and
 * not a product shot.
 *
 * Deliberately matte: no metalness, no environment map, no glow, no particles.
 * A technical drawing that happens to have depth, not a crypto render.
 *
 * The SVG underneath is the real default — server-rendered, correct on its own,
 * and only hidden once WebGL is confirmed working. Reduced motion keeps it.
 */
export function HeroScene({ children }: { children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = host.current
    if (!el || reduced) return

    const width = el.clientWidth
    const height = el.clientHeight
    if (!width || !height) return

    const styles = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string) =>
      (styles.getPropertyValue(name) || fallback).trim() || fallback

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return // No WebGL. The SVG stays.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height)
    Object.assign(renderer.domElement.style, {
      display: 'block',
      width: '100%',
      height: '100%',
    })

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100)
    camera.position.set(0.6, 1.9, 11.4)
    camera.lookAt(0, -0.55, 0)

    const ink = new THREE.Color(token('--ink', '#14180F'))
    const debit = new THREE.Color(token('--debit', '#9E2B18'))
    const credit = new THREE.Color(token('--credit', '#17703F'))
    const pen = new THREE.Color(token('--pen', '#1F3A93'))
    const soft = new THREE.Color(token('--rule-soft', '#B9C2AC'))

    // Recessed greenbar grid, the ledger paper receding to a horizon.
    const grid = new THREE.GridHelper(34, 34, soft, soft)
    grid.position.set(0, -3.1, -4)
    const gridMat = grid.material as THREE.Material
    gridMat.transparent = true
    gridMat.opacity = 0
    scene.add(grid)

    const zeroLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-6.4, 0, 0),
        new THREE.Vector3(6.4, 0, 0),
      ]),
      new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0 }),
    )
    scene.add(zeroLine)

    // Colour by sign, on the geometry, so the meaning lives in the object.
    const points = (
      [
        [-6.2, 0], [-4.9, -0.55], [-3.6, -1.35], [-2.3, -1.72], [-1.0, -1.24],
        [0.35, -0.35], [1.7, 0.42], [3.0, 0.74], [4.4, 0.46], [5.5, 0.12], [6.2, 0],
      ] as [number, number][]
    ).map(([x, y]) => new THREE.Vector3(x, y, 0))
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4)
    const tube = new THREE.TubeGeometry(curve, 220, 0.06, 12, false)
    const position = tube.attributes.position!
    const colours = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      const c = position.getY(i) < 0 ? debit : credit
      colours[i * 3] = c.r
      colours[i * 3 + 1] = c.g
      colours[i * 3 + 2] = c.b
    }
    tube.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    const wire = new THREE.Mesh(tube, new THREE.MeshLambertMaterial({ vertexColors: true }))
    tube.setDrawRange(0, 0)
    scene.add(wire)

    // The ceiling: translucent plane, full-opacity edge, so it reads as a hard
    // limit rather than a haze.
    const ceiling = new THREE.Group()
    ceiling.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(12.8, 7),
        new THREE.MeshBasicMaterial({
          color: pen,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    )
    ;(ceiling.children[0] as THREE.Mesh).rotation.x = -Math.PI / 2
    ceiling.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-6.4, 0, 0),
          new THREE.Vector3(6.4, 0, 0),
        ]),
        new THREE.LineBasicMaterial({ color: pen }),
      ),
    )
    ceiling.position.y = 3.2
    scene.add(ceiling)

    scene.add(new THREE.AmbientLight(0xffffff, 0.62))
    const key = new THREE.DirectionalLight(0xffffff, 0.85)
    key.position.set(-5, 7, 6)
    scene.add(key)

    el.appendChild(renderer.domElement)
    const svg = el.querySelector('svg')
    if (svg) (svg as SVGElement).style.display = 'none'

    const total = tube.index ? tube.index.count : position.count
    const start = performance.now()
    const ease = (x: number) => 1 - Math.pow(1 - x, 3)
    let frame = 0

    const onResize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    // Load sequence: grid, then zero line draws, then the wire extrudes, then
    // the ceiling descends into place. Under 1.5s total.
    const loop = () => {
      const t = performance.now() - start
      gridMat.opacity = Math.min(1, t / 300) * 0.5
      ;(zeroLine.material as THREE.LineBasicMaterial).opacity = clamp((t - 200) / 700)
      tube.setDrawRange(0, Math.floor(total * ease(clamp((t - 320) / 900))))
      ceiling.position.y = 3.2 + (-2.35 - 3.2) * ease(clamp((t - 640) / 700))

      // ±3° drift on a 20s sine. Never user-orbitable: a hero the reader can
      // break is a hero that gets broken.
      const drift = Math.sin((t / 20000) * Math.PI * 2) * ((3 * Math.PI) / 180)
      camera.position.x = 0.6 + Math.sin(drift) * 11
      camera.position.z = 11.4 * Math.cos(drift)
      camera.lookAt(0, -0.55, 0)

      renderer.render(scene, camera)
      frame = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      tube.dispose()
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement)
      if (svg) (svg as SVGElement).style.display = 'block'
    }
  }, [reduced])

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0, zIndex: 0 }} aria-hidden="true">
      {children}
    </div>
  )
}

function clamp(x: number) {
  return Math.min(1, Math.max(0, x))
}
