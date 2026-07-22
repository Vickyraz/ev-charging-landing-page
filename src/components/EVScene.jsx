/**
 * EVScene — reusable Three.js scene for the EV Charging Display.
 *
 * mode="intro"  : full-screen cinematic intro with auto demo loop
 * mode="panel"  : compact panel driven by live snapshot + log
 */
import { useRef, useState, useEffect, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, RoundedBox, Text } from '@react-three/drei'
import * as THREE from 'three'
import Car, { CAR_VARIANTS } from './Car'

// ─── Easing helpers ───────────────────────────────────────────────────────────
const easeOutCubic = t => 1 - Math.pow(1 - t, 3)
// Deterministic PRNG (seeded) for stable procedural placement
const mulberry32 = seed => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const spring = (current, target, velocity, stiffness = 150, damping = 18, dt = 0.016) => {
  const force = (target - current) * stiffness - velocity * damping
  const newVel = velocity + force * dt
  const newPos = current + newVel * dt
  return [newPos, newVel]
}

// Procedural window textures for cityscape buildings.
// Returns a base `map` (white walls + gray glass panels — multiplies the
// building colour for daytime detail) and an `emissive` map (black except a
// few randomly-lit warm/cool windows). Cloned per-building for unique repeat.
const makeWindowTextures = () => {
  if (typeof document === 'undefined') return null
  const W = 256, H = 256, COLS = 4, ROWS = 4
  const rng = mulberry32(99173)
  const mapCv = document.createElement('canvas'); mapCv.width = W; mapCv.height = H
  const emCv  = document.createElement('canvas'); emCv.width  = W; emCv.height  = H
  const m = mapCv.getContext('2d'), e = emCv.getContext('2d')
  m.fillStyle = '#ffffff'; m.fillRect(0, 0, W, H)
  e.fillStyle = '#000000'; e.fillRect(0, 0, W, H)
  const cw = W / COLS, ch = H / ROWS, px = cw * 0.24, py = ch * 0.18
  // A few subtle sky-reflective glass tints — bright for daytime, varied but cohesive
  const glassTints = ['#cdd9e6', '#d6e2ee', '#c4d2e0', '#dfe8f2', '#cfdce8', '#bfd0e0']
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * cw + px, y = r * ch + py, w = cw - px * 2, h = ch - py * 2
      m.fillStyle = glassTints[Math.floor(rng() * glassTints.length)]  // glass panel (daytime)
      m.fillRect(x, y, w, h)
      m.strokeStyle = '#aeb6c2'; m.lineWidth = 1.5; m.strokeRect(x, y, w, h)
      // every pane catches a faint sky reflection; a few are warmly/coolly lit
      e.fillStyle = '#2c3a4a'
      e.fillRect(x, y, w, h)
      if (rng() < 0.30) {                                    // lit / strongly reflective window
        e.fillStyle = rng() < 0.55 ? '#d7ba88' : '#c4ddfa'
        e.fillRect(x, y, w, h)
      }
    }
  }
  const mk = cv => {
    const t = new THREE.CanvasTexture(cv)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    return t
  }
  return { map: mk(mapCv), emissive: mk(emCv) }
}

// Charge-port local offset on the truck (front fender, ahead of front wheel)
const PORT_LOCAL = { x: 1.0, y: 0.48, z: 0.48 }
// EVSE sits beside the driving lane (offset toward the camera in +Z so the
// car can drive straight past it without clipping the post)
const CHARGER_Z   = 1.05
// EVSE cable outlet (world); follows the charger's +Z offset
const EVSE_OUTLET = { x: 0.21, y: 0.96, z: CHARGER_Z + 0.13 }
const CSMS_GROUND = [5.0, 0, -6.8]
const CSMS_SCALE  = 2.0
// Message-packet endpoint near the building's lower front
const CSMS_LINK   = new THREE.Vector3(4.6, 1.9, -5.4)

// ─── Ground ───────────────────────────────────────────────────────────────────
function Ground({ chargingPad }) {
  return (
    <>
      {/* Asphalt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, -0.01, -30]} receiveShadow>
        <planeGeometry args={[90, 120]} />
        <meshStandardMaterial color="#4b5563" roughness={0.95} metalness={0.0} />
      </mesh>
      {/* Lane markers */}
      {[-1, 0, 1].map(z => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[-0.5, 0, z * 1.4]}>
          <planeGeometry args={[0.04, 8]} />
          <meshStandardMaterial color="#d1d5db" transparent opacity={0.5} />
        </mesh>
      ))}
      {/* Charging pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1.8, 0, 0]}>
        <planeGeometry args={[2.6, 1.2]} />
        <meshStandardMaterial
          color={chargingPad ? '#0ea5e9' : '#374151'}
          emissive={chargingPad ? '#0ea5e9' : '#000'}
          emissiveIntensity={chargingPad ? 0.3 : 0}
          transparent opacity={0.6}
        />
      </mesh>
      {/* Pad grid lines */}
      {chargingPad && [-0.8, -0.4, 0, 0.4, 0.8].map(x => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[-1.8 + x * 0.5, 0.001, 0]}>
          <planeGeometry args={[0.02, 1.1]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} transparent opacity={0.5} />
        </mesh>
      ))}
      {chargingPad && (
        <pointLight position={[-1.8, 0.1, 0]} color="#0ea5e9" intensity={2} distance={2.5} />
      )}
    </>
  )
}


// ─── Charging Station ─────────────────────────────────────────────────────────
function ChargingStation({ state }) {
  const tRef     = useRef(0)
  const ringRef  = useRef()
  const lightRef = useRef()

  const color = { Available:'#22c55e', Occupied:'#eab308', Charging:'#38bdf8', Faulted:'#ef4444', Inoperative:'#6b7280' }[state] ?? '#22c55e'

  useFrame((_, dt) => {
    tRef.current += dt
    if (ringRef.current) {
      ringRef.current.rotation.z += dt * (state === 'Charging' ? 2 : 0.5)
      ringRef.current.scale.setScalar(1 + Math.sin(tRef.current * 3) * (state === 'Charging' ? 0.08 : 0.02))
    }
    if (lightRef.current) {
      lightRef.current.intensity = (state === 'Inoperative' ? 0.4 : 2.5) * (1 + Math.sin(tRef.current * (state === 'Charging' ? 5 : 1.5)) * 0.2)
    }
  })

  return (
    <group position={[0, 0, CHARGER_Z]}>
      {/* Base slab */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.1, 12]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Post — shorter */}
      <mesh position={[0, 0.58, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.10, 0.96, 12]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.4} roughness={0.4} />
      </mesh>
      {/* Head unit */}
      <mesh position={[0, 1.18, 0]} castShadow>
        <RoundedBox args={[0.40, 0.46, 0.20]} radius={0.04} smoothness={4}>
          <meshStandardMaterial color="#f1f5f9" metalness={0.25} roughness={0.45} />
        </RoundedBox>
      </mesh>
      {/* Screen */}
      <mesh position={[0, 1.20, 0.11]}>
        <planeGeometry args={[0.26, 0.28]} />
        <meshStandardMaterial color="#0f172a" emissive={color} emissiveIntensity={0.5} />
      </mesh>
      {/* Status ring (torus, animated) */}
      <mesh ref={ringRef} position={[0, 1.48, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.10, 0.022, 8, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} />
      </mesh>
      {/* Status dome */}
      <mesh position={[0, 1.48, 0]}>
        <sphereGeometry args={[0.05, 10, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} />
      </mesh>
      {/* Cable outlet */}
      <mesh position={[0.21, 0.96, 0.09]}>
        <cylinderGeometry args={[0.028, 0.028, 0.09, 8]} />
        <meshStandardMaterial color="#334155" metalness={0.6} />
      </mesh>
      <pointLight ref={lightRef} position={[0, 1.4, 0.4]} color={color} distance={3.5} />
    </group>
  )
}

// ─── CSMS Server ──────────────────────────────────────────────────────────────
function Logo({ position }) {
  const glowRef = useRef()
  const t = useRef(0)

  // Real oval: ~2.2:1 width-to-height ratio
  const ovalGeom = useMemo(() => {
    const shape = new THREE.Shape()
    shape.absellipse(0, 0, 0.22, 0.12, 0, Math.PI * 2, false, 0)
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false })
    g.center()  // centers geometry so front face is at +z/2
    return g
  }, [])

  const rimGeom = useMemo(() => {
    const outer = new THREE.Shape()
    outer.absellipse(0, 0, 0.24, 0.14, 0, Math.PI * 2, false, 0)
    const hole = new THREE.Path()
    hole.absellipse(0, 0, 0.22, 0.12, 0, Math.PI * 2, false, 0)
    outer.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(outer, { depth: 0.04, bevelEnabled: false })
    g.center()
    return g
  }, [])

  useFrame((_, dt) => {
    t.current += dt
    if (glowRef.current) glowRef.current.intensity = 0.55 + Math.sin(t.current * 1.4) * 0.25
  })

  return (
    <group position={position}>
      {/* Blue oval body */}
      <mesh geometry={ovalGeom}>
        <meshStandardMaterial color="#003087" emissive="#003087" emissiveIntensity={0.6} metalness={0.2} roughness={0.45} />
      </mesh>
      {/* Silver ellipse rim — sits on top of blue oval */}
      <mesh geometry={rimGeom}>
        <meshStandardMaterial color="#d1d5db" metalness={0.95} roughness={0.06} />
      </mesh>
      {/* italic text — renderOrder ensures it draws on top */}
      <Text
        position={[0, 0, 0.032]}
        fontSize={0.075}
        color="white"
        anchorX="center"
        anchorY="middle"
        fontStyle="italic"
        fontWeight="bold"
        letterSpacing={0.04}
        renderOrder={10}
        depthOffset={-2}
      >
        Yaazh
      </Text>
      <pointLight ref={glowRef} position={[0, 0, 0.9]} color="#3b82f6" distance={3.5} intensity={0.7} />
    </group>
  )
}

function CSMSServer({ position = [3.5, 0, 0], scale = 1 }) {
  const FLOORS   = 7
  const FLOOR_H  = 0.28
  const BLDG_W   = 0.78
  const BLDG_D   = 0.54
  const TOTAL_H  = FLOORS * FLOOR_H
  const BASE_Y   = TOTAL_H / 2   // lift so bottom sits at y=0

  // Window blink refs
  const winRefs = useRef([])
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt
    winRefs.current.forEach((r, i) => {
      if (r) r.material.emissiveIntensity = 0.25 + Math.abs(Math.sin(t.current * 0.6 + i * 0.85)) * 0.6
    })
  })

  let winIdx = 0
  return (
    <group position={[position[0], position[1], position[2]]} scale={scale}>
      {/* ── Floors ─────────────────────────────────────────── */}
      {Array.from({ length: FLOORS }).map((_, f) => {
        const floorY = f * FLOOR_H + FLOOR_H / 2
        const isTopFloor = f === FLOORS - 1
        return (
          <group key={f}>
            {/* Floor body */}
            <mesh castShadow receiveShadow position={[0, floorY, 0]}>
              <boxGeometry args={[BLDG_W, FLOOR_H - 0.03, BLDG_D]} />
              <meshStandardMaterial
                color={isTopFloor ? '#0f172a' : f % 2 === 0 ? '#1e293b' : '#162032'}
                metalness={0.45} roughness={0.35}
              />
            </mesh>
            {/* Horizontal floor band */}
            <mesh position={[0, floorY + FLOOR_H / 2 - 0.015, 0]}>
              <boxGeometry args={[BLDG_W + 0.02, 0.03, BLDG_D + 0.02]} />
              <meshStandardMaterial color="#334155" metalness={0.65} roughness={0.25} />
            </mesh>
            {/* Front windows — skip top floor (logo lives there) */}
            {!isTopFloor && [-0.24, 0, 0.24].map((wx) => {
              const idx = winIdx++
              return (
                <mesh
                  key={wx}
                  ref={el => (winRefs.current[idx] = el)}
                  position={[wx, floorY, BLDG_D / 2 + 0.006]}
                >
                  <boxGeometry args={[0.11, 0.14, 0.01]} />
                  <meshStandardMaterial
                    color="#93c5fd"
                    emissive="#60a5fa"
                    emissiveIntensity={0.45}
                    transparent opacity={0.82}
                    metalness={0.1} roughness={0.05}
                  />
                </mesh>
              )
            })}
            {/* Side windows */}
            {!isTopFloor && [-0.07, 0.07].map((wz, wi) => (
              <mesh key={wi} position={[-BLDG_W / 2 - 0.004, floorY, wz]}>
                <boxGeometry args={[0.009, 0.13, 0.09]} />
                <meshStandardMaterial color="#bfdbfe" emissive="#60a5fa" emissiveIntensity={0.28} transparent opacity={0.7} />
              </mesh>
            ))}
          </group>
        )
      })}

      {/* ── Rooftop parapet ────────────────────────────────── */}
      <mesh position={[0, TOTAL_H + 0.025, 0]}>
        <boxGeometry args={[BLDG_W + 0.06, 0.05, BLDG_D + 0.06]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.3} />
      </mesh>
      {[[-1,-1],[-1,1],[1,-1],[1,1]].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * (BLDG_W / 2 + 0.01), TOTAL_H + 0.06, sz * (BLDG_D / 2 + 0.01)]}>
          <boxGeometry args={[0.055, 0.1, 0.055]} />
          <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.3} />
        </mesh>
      ))}

      {/* ── Logo on top-floor front wall ─────────────── */}
      <Logo position={[0, (FLOORS - 1) * FLOOR_H + FLOOR_H / 2, BLDG_D / 2 + 0.04]} />
    </group>
  )
}

// ─── Cable (dynamically connects EVSE outlet → car's live charge port) ────────
function ChargingCable({ visible, carXRef }) {
  const tubeRef = useRef()
  const connRef = useRef()
  const curve   = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ]), [])
  // Idle (unplugged): a longer cable that hangs in a U from the outlet down and
  // back up to a holster mounted on the EVSE post, opposite the outlet
  const idleCurve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(EVSE_OUTLET.x, EVSE_OUTLET.y, EVSE_OUTLET.z),
    new THREE.Vector3(0.10, 0.42, CHARGER_Z + 0.18),
    new THREE.Vector3(-0.14, 0.40, CHARGER_Z + 0.16),
    new THREE.Vector3(-0.18, 0.97, CHARGER_Z),
  ]), [])

  useFrame(() => {
    if (!visible || !tubeRef.current) return
    const carX = carXRef?.current ?? -1.8
    const sx = EVSE_OUTLET.x, sy = EVSE_OUTLET.y, sz = EVSE_OUTLET.z
    const ex = carX + PORT_LOCAL.x, ey = PORT_LOCAL.y, ez = PORT_LOCAL.z
    const p = curve.points
    p[0].set(sx, sy, sz)
    // two control points form a drooping catenary that bows out toward camera
    p[1].set(sx + (ex - sx) * 0.35, Math.min(sy, ey) - 0.30, Math.max(sz, ez) + 0.14)
    p[2].set(sx + (ex - sx) * 0.72, ey + 0.06, ez + 0.06)
    p[3].set(ex, ey, ez)
    curve.updateArcLengths?.()
    const geo = new THREE.TubeGeometry(curve, 36, 0.024, 10, false)
    tubeRef.current.geometry.dispose()
    tubeRef.current.geometry = geo
    if (connRef.current) {
      connRef.current.position.set(ex, ey, ez + 0.03)
    }
  })

  if (!visible) {
    // Holster mounted flush on the EVSE post, opposite the outlet
    return (
      <group>
        <mesh>
          <tubeGeometry args={[idleCurve, 30, 0.022, 10, false]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.3} />
        </mesh>
        {/* Holster bracket bridging post → connector */}
        <mesh position={[-0.13, 0.92, CHARGER_Z]}>
          <boxGeometry args={[0.12, 0.07, 0.10]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.5} />
        </mesh>
        {/* Connector seated nozzle-down in the holster */}
        <mesh position={[-0.18, 0.86, CHARGER_Z]}>
          <cylinderGeometry args={[0.045, 0.038, 0.12, 12]} />
          <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[-0.18, 0.77, CHARGER_Z]}>
          <cylinderGeometry args={[0.026, 0.026, 0.06, 10]} />
          <meshStandardMaterial color="#0b1220" metalness={0.5} roughness={0.4} />
        </mesh>
      </group>
    )
  }
  return (
    <>
      <mesh ref={tubeRef}>
        <tubeGeometry args={[curve, 36, 0.024, 10, false]} />
        <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Connector housing plugged into the car */}
      <mesh ref={connRef} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.038, 0.08, 12]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
      </mesh>
    </>
  )
}

// ─── Charging particles (flow along the live cable curve) ─────────────────────
function ChargingParticles({ active, carXRef }) {
  const meshRef = useRef()
  const dummy   = useMemo(() => new THREE.Object3D(), [])
  const count   = 14
  const prog    = useRef(Array.from({ length: count }, (_, i) => i / count))
  const curve   = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
  ]), [])

  useFrame((_, dt) => {
    if (!meshRef.current) return
    // rebuild curve to match cable route
    const carX = carXRef?.current ?? -1.8
    const sx = EVSE_OUTLET.x, sy = EVSE_OUTLET.y, sz = EVSE_OUTLET.z
    const ex = carX + PORT_LOCAL.x, ey = PORT_LOCAL.y, ez = PORT_LOCAL.z
    const p = curve.points
    p[0].set(sx, sy, sz)
    p[1].set(sx + (ex - sx) * 0.35, Math.min(sy, ey) - 0.30, Math.max(sz, ez) + 0.14)
    p[2].set(sx + (ex - sx) * 0.72, ey + 0.06, ez + 0.06)
    p[3].set(ex, ey, ez)

    for (let i = 0; i < count; i++) {
      if (active) prog.current[i] = (prog.current[i] + dt * 0.6) % 1
      const t  = prog.current[i]
      const pt = curve.getPoint(t)
      dummy.position.copy(pt)
      const fade = Math.sin(t * Math.PI)
      const s = active ? (0.45 + Math.sin(t * Math.PI * 6 + Date.now() * 0.003) * 0.28) * fade : 0
      dummy.scale.setScalar(Math.max(0, s))
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <sphereGeometry args={[0.05, 6, 6]} />
      <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={4} transparent opacity={0.92} />
    </instancedMesh>
  )
}

// ─── Message packet ───────────────────────────────────────────────────────────
function MessagePacket({ trigger, direction }) {
  const ref      = useRef()
  const tRef     = useRef(1)
  const prevTrig = useRef(trigger)

  useEffect(() => {
    if (trigger !== prevTrig.current) { tRef.current = 0; prevTrig.current = trigger }
  }, [trigger])

  const from = direction === 'recv' ? CSMS_LINK.clone()            : new THREE.Vector3(0, 1.9, 0)
  const to   = direction === 'recv' ? new THREE.Vector3(0, 1.9, 0) : CSMS_LINK.clone()

  useFrame((_, dt) => {
    if (!ref.current) return
    if (tRef.current >= 1) { ref.current.visible = false; return }
    tRef.current = Math.min(tRef.current + dt * 1.3, 1)
    ref.current.visible = true
    const t = easeOutCubic(tRef.current)
    ref.current.position.lerpVectors(from, to, t)
    ref.current.position.y += Math.sin(tRef.current * Math.PI) * 0.55
    const s = 0.4 + Math.sin(tRef.current * Math.PI) * 0.7
    ref.current.scale.setScalar(s)
  })

  const color = direction === 'recv' ? '#a78bfa' : '#34d399'
  return (
    <mesh ref={ref} visible={false}>
      <octahedronGeometry args={[0.1, 0]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={3.5} transparent opacity={0.9} />
      <pointLight color={color} intensity={1.5} distance={1.2} />
    </mesh>
  )
}

// ─── Intro animation: phase durations for the parked (charging) dwell ─────────
// Motion phases (arriving / leaving) are driven by the car itself — they advance
// the instant the car reaches the pad or vanishes — so there is no idle gap.
const OCCUPIED_MS = 900
const CHARGING_MS = 5000

function CameraDrift({ zoomOut = false, overrideRef }) {
  const t    = useRef(0)
  const mx   = useRef(0)
  const my   = useRef(0)
  const pull = useRef(0)
  useFrame(({ camera, pointer }, dt) => {
    t.current += dt * 0.12
    const k = 1 - Math.exp(-dt * 4)
    mx.current += (pointer.x - mx.current) * k
    my.current += (pointer.y - my.current) * k
    pull.current += ((zoomOut ? 1 : 0) - pull.current) * (1 - Math.exp(-dt * 3))
    if (overrideRef?.current?.enabled) return  // let CameraController handle it
    const p = pull.current
    camera.position.x = 1.5 + Math.sin(t.current) * 1.5 + mx.current * 1.6
    camera.position.y = 3.2 + Math.sin(t.current * 0.7) * 0.4 + my.current * 0.9 + p * 1.6
    camera.position.z = 8   + Math.cos(t.current * 0.5) * 1.0 + p * 6.0
    camera.lookAt(1.2, 0.8, 0)
  })
  return null
}

// Fixed camera for the panel — frames just the car + EVSE from a 3/4 angle
function FixedCamera({ position, target, fov }) {
  useFrame(({ camera }) => {
    camera.position.set(position[0], position[1], position[2])
    if (fov && camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix() }
    camera.lookAt(target[0], target[1], target[2])
  })
  return null
}

// ─── Sun backdrop body (high behind the camera, lights the scene warmly) ──────
function CelestialBody() {
  const glowRef = useRef()
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt
    if (glowRef.current) glowRef.current.material.opacity = 0.9 + Math.sin(t.current * 0.8) * 0.08
  })

  const pos = [40, 88, 112]
  const r = 12

  return (
    <group position={pos}>
      {/* Glowing core */}
      <mesh>
        <sphereGeometry args={[r, 32, 32]} />
        <meshBasicMaterial color="#ffd23f" fog={false} />
      </mesh>
      {/* Soft halo */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[r * 1.8, 32, 32]} />
        <meshBasicMaterial color="#ffcf33" transparent opacity={0.9} side={THREE.BackSide} fog={false} />
      </mesh>
      {/* Warm fill light cast toward the scene */}
      <pointLight color="#ffdb8a" intensity={3.2} distance={60} decay={1.1} />
      <directionalLight color="#ffd27a" intensity={0.6} target-position={[0, 0, 0]} />
    </group>
  )
}

// ─── Distant city skyline backdrop ────────────────────────────────────────────
function Cityscape() {
  const buildings = useMemo(() => {
    const rng = mulberry32(20260628)
    const palette = ['#6b7280', '#7b8794', '#566273', '#8a94a6', '#647084', '#9aa5b5']
    const base = makeWindowTextures()
    const arr = []

    // Jittered grid surrounding the scene, with a clear central "lot"
    const STEP = 4.4
    let n = 0
    for (let gx = -32; gx <= 36; gx += STEP) {
      for (let gz = -28; gz <= 12; gz += STEP) {
        const x = gx + (rng() - 0.5) * STEP * 0.6
        const z = gz + (rng() - 0.5) * STEP * 0.6
        // keep the parking lot / drive loop / building / camera corridor open
        if (x > -8 && x < 10 && z > -10 && z < 12) continue
        // keep the left entry lane clear so the car drives in between buildings
        if (x <= -8 && z > -4.5 && z < 2.0) continue
        // keep the northbound exit lane clear so the car drives between buildings
        if (x > 2.0 && x < 4.6 && z <= -10) continue
        // taller toward the back, with random variety
        const depthBoost = THREE.MathUtils.clamp((-z - 4) * 0.18, 0, 4)
        const h = 2.2 + rng() * 5 + depthBoost
        const w = 1.2 + rng() * 2.0
        const d = 1.2 + rng() * 2.0
        // Foreground buildings (nearest the camera) get window detail on all sides
        const fg = base && z > -11
        let glass = null
        if (fg) {
          const rowsH = Math.max(2, Math.round(h / 0.85))
          const colsW = Math.max(2, Math.round(w / 0.7))
          const colsD = Math.max(2, Math.round(d / 0.7))
          const ox = Math.floor(rng() * 4), oy = Math.floor(rng() * 4)
          const clone = (tex, cols) => {
            const t = tex.clone()
            t.needsUpdate = true
            t.repeat.set(cols / 4, rowsH / 4)
            t.offset.set(ox / 4, oy / 4)
            return t
          }
          glass = {
            mapW: clone(base.map, colsW), emW: clone(base.emissive, colsW),
            mapD: clone(base.map, colsD), emD: clone(base.emissive, colsD),
          }
        }
        arr.push({
          key: `b-${n++}`,
          pos: [x, h / 2, z],
          size: [w, h, d],
          color: palette[Math.floor(rng() * palette.length)],
          glass,
        })
      }
    }
    return arr
  }, [])

  return (
    <group>
      {buildings.map(b => (
        <mesh key={b.key} position={b.pos}>
          <boxGeometry args={b.size} />
          {b.glass ? (
            // face order: 0=+X 1=-X 2=+Y(top) 3=-Y(bottom) 4=+Z 5=-Z
            [
              { i: 0, map: b.glass.mapD, em: b.glass.emD },
              { i: 1, map: b.glass.mapD, em: b.glass.emD },
              { i: 4, map: b.glass.mapW, em: b.glass.emW },
              { i: 5, map: b.glass.mapW, em: b.glass.emW },
            ].map(f => (
              <meshStandardMaterial
                key={f.i}
                attach={`material-${f.i}`}
                color={b.color}
                map={f.map}
                emissive="#ffffff"
                emissiveMap={f.em}
                emissiveIntensity={0.9}
                roughness={0.5}
                metalness={0.1}
              />
            )).concat([2, 3].map(i => (
              <meshStandardMaterial
                key={i}
                attach={`material-${i}`}
                color={b.color}
                roughness={0.92}
                metalness={0.08}
              />
            )))
          ) : (
            <meshStandardMaterial color={b.color} roughness={0.92} metalness={0.08} />
          )}
        </mesh>
      ))}
    </group>
  )
}

// ─── Inner scene ─────────────────────────────────────────────────────────────
function Scene({ mode, snapshot, log, zoomOut, onInfo, cameraOverrideRef }) {
  const [introPhase, setIntroPhase] = useState('arriving')
  const [carVariant, setCarVariant] = useState(0)
  const [panelParked, setPanelParked] = useState(false)
  const [sendTrig, setSendTrig]     = useState(0)
  const [recvTrig, setRecvTrig]     = useState(0)
  const prevLogLen = useRef(0)
  const carXRef    = useRef(-7)

  useEffect(() => {
    if (mode !== 'panel') return
    if (log.length > prevLogLen.current) {
      const last = log[log.length - 1]
      if (last.direction === 'SEND') setSendTrig(t => t + 1)
      else                           setRecvTrig(t => t + 1)
    }
    prevLogLen.current = log.length
  }, [log, mode])

  // Parked dwell: once the car has arrived (occupied), hold briefly then charge,
  // then charge for a while before releasing the car to leave. Motion phases
  // (arriving / leaving) are advanced by the car via onArrived / onExited.
  useEffect(() => {
    if (mode !== 'intro') return
    let id
    if (introPhase === 'occupied') id = setTimeout(() => setIntroPhase('charging'), OCCUPIED_MS)
    else if (introPhase === 'charging') id = setTimeout(() => setIntroPhase('leaving'), CHARGING_MS)
    return () => clearTimeout(id)
  }, [introPhase, mode])

  let displayState, cableVisible, charging

  if (mode === 'panel') {
    displayState = snapshot.state ?? 'Available'
    const linked = displayState === 'Occupied' || displayState === 'Charging'
    // only attach the cable / show charging once the car has actually parked
    cableVisible = linked && panelParked
    charging     = displayState === 'Charging' && panelParked
  } else {
    const m = { arriving:'Available', occupied:'Occupied', charging:'Charging', leaving:'Available' }
    displayState = m[introPhase] ?? 'Available'
    cableVisible = ['occupied','charging'].includes(introPhase)
    charging     = introPhase === 'charging'
  }

  // Push debug info to EVScene overlay whenever relevant state changes
  useEffect(() => {
    if (!onInfo) return
    const variant = CAR_VARIANTS[carVariant]
    onInfo({
      type:      variant.type,
      body:      variant.body,
      variantN:  carVariant,
      total:     CAR_VARIANTS.length,
      phase:     mode === 'intro' ? introPhase : '—',
      evseState: displayState,
      cable:     cableVisible,
      charging,
    })
  }, [introPhase, carVariant, displayState, cableVisible, charging]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Warm daylight: golden sun key + sky fill */}
      <ambientLight intensity={0.55} color="#ffe7b3" />
      <hemisphereLight args={["#9ed3ff", "#6b5a36", 0.7]} />
      <directionalLight position={[5, 12, 12]} intensity={2.6} color="#ffd27a" castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-near={0.5} shadow-camera-far={40}
        shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
      <fog attach="fog" args={["#87ceeb", 22, 52]} />

      <CelestialBody />

      <Ground chargingPad={charging} />
      <Car mode={mode} phase={introPhase} state={displayState} carXRef={carXRef}
        variant={CAR_VARIANTS[carVariant]}
        onNewCar={mode === 'intro' ? () => setCarVariant(v => (v + 1) % CAR_VARIANTS.length) : undefined}
        onArrived={mode === 'intro' ? () => setIntroPhase('occupied') : undefined}
        onExited={mode === 'intro' ? () => setIntroPhase('arriving') : undefined}
        onParked={mode === 'panel' ? setPanelParked : undefined} />
      <ChargingStation state={displayState} />
      {mode === 'intro' && <Cityscape />}
      {mode === 'intro' && <CSMSServer position={CSMS_GROUND} scale={CSMS_SCALE} />}
      <ChargingCable visible={cableVisible} carXRef={carXRef} />
      <ChargingParticles active={charging} carXRef={carXRef} />
      <MessagePacket trigger={sendTrig} direction="send" />
      <MessagePacket trigger={recvTrig} direction="recv" />

      {mode === 'intro' && <CameraDrift zoomOut={zoomOut} overrideRef={cameraOverrideRef} />}
      {mode === 'panel' && (
        <FixedCamera position={[1.3, 1.55, 3.4]} target={[-0.99, 0.55, 0.45]} fov={40} />
      )}
    </>
  )
}

// Fires once the scene has painted a couple of frames (hides the load overlay)
function FirstFrame({ onReady }) {
  const n = useRef(0)
  useFrame(() => {
    n.current += 1
    if (n.current === 2) onReady()
  })
  return null
}

// ─── Camera tracker — reads live camera state every ~10 frames ────────────────
function CameraTracker({ onCam }) {
  const tick = useRef(0)
  useFrame(({ camera }) => {
    if (++tick.current % 10 !== 0) return
    const { x, y, z } = camera.position
    const hz  = Math.sqrt(x * x + z * z)
    onCam({
      x, y, z,
      fov:  camera.fov,
      dist: Math.sqrt(x * x + y * y + z * z),
      az:   Math.atan2(z, x)  * (180 / Math.PI),
      el:   Math.atan2(y, hz) * (180 / Math.PI),
    })
  })
  return null
}

// Applies manual override — CameraDrift skips when enabled, so no conflict
function CameraController({ overrideRef }) {
  useFrame(({ camera }) => {
    const o = overrideRef.current
    if (!o.enabled) return
    camera.position.set(o.x, o.y, o.z)
    if (camera.fov !== o.fov) { camera.fov = o.fov; camera.updateProjectionMatrix() }
    camera.lookAt(o.lx ?? 1.2, 0.8, o.lz ?? 0)
  })
  return null
}

function Row({ label, value, valueColor = '#e2e8f0', dot = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: valueColor }}>
        {dot && (
          <span style={{
            display: 'inline-block', width: '6px', height: '6px',
            borderRadius: '50%', background: valueColor,
          }} />
        )}
        {value}
      </span>
    </div>
  )
}
function Divider() {
  return <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '6px 0' }} />
}

// ─── Public component ─────────────────────────────────────────────────────────
export default function EVScene({ mode = 'intro', snapshot = {}, log = [], className = '', zoomOut = false }) {
  const [ready, setReady]   = useState(false)
  const [info,       setInfo]      = useState(null)
  const [cam,        setCam]       = useState(null)
  const [panelOpen,  setPanelOpen] = useState(true)

  // Spherical orbit controls — more intuitive than raw X/Y/Z
  // Az=azimuth (orbit), El=elevation, Dist=zoom, panX/panZ = strafe offset of lookAt
  const LOOK_AT = [1.2, 0.8, 0]
  const toXYZ = (az, el, dist, panX = 0, panZ = 0) => {
    const azR = az * (Math.PI / 180), elR = el * (Math.PI / 180)
    const lx = LOOK_AT[0] + panX, lz = LOOK_AT[2] + panZ
    return {
      x: lx + dist * Math.cos(elR) * Math.cos(azR),
      y: LOOK_AT[1] + dist * Math.sin(elR),
      z: lz + dist * Math.cos(elR) * Math.sin(azR),
      lx, lz,
    }
  }
  const fromXYZ = (cx, cy, cz, lx = LOOK_AT[0], lz = LOOK_AT[2]) => {
    const dx = cx - lx, dy = cy - LOOK_AT[1], dz = cz - lz
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz)
    return {
      dist,
      el:  parseFloat((Math.atan2(dy, Math.sqrt(dx*dx + dz*dz)) * 180 / Math.PI).toFixed(1)),
      az:  parseFloat((Math.atan2(dz, dx)                        * 180 / Math.PI).toFixed(1)),
    }
  }

  const camOverrideRef  = useRef({ enabled: false, x: 1.5, y: 4.5, z: 10, fov: 50, lx: 1.2, lz: 0 })
  const [camEdit, setCamEdit] = useState({ enabled: false, az: 88, el: 20, dist: 10.7, fov: 50, panX: 0, panZ: 0 })
  // Single interval ref at component level — survives re-renders so stopNudge always clears the right one
  const nudgeIntervalRef = useRef(null)

  const enableOverride = () => {
    if (camEdit.enabled) return
    const ref = camOverrideRef.current
    const lx = ref.lx ?? LOOK_AT[0], lz = ref.lz ?? LOOK_AT[2]
    const panX = lx - LOOK_AT[0], panZ = lz - LOOK_AT[2]
    const { az, el, dist } = fromXYZ(cam?.x ?? 1.5, cam?.y ?? 4.5, cam?.z ?? 10, lx, lz)
    const fov = Math.round(cam?.fov ?? 50)
    const next = { enabled: true, az, el, dist: parseFloat(dist.toFixed(2)), fov, panX, panZ }
    const pos = toXYZ(az, el, dist, panX, panZ)
    camOverrideRef.current = { enabled: true, fov, x: pos.x, y: pos.y, z: pos.z, lx: pos.lx, lz: pos.lz }
    setCamEdit(next)
  }
  const releaseCam = () => {
    clearInterval(nudgeIntervalRef.current)
    nudgeIntervalRef.current = null
    camOverrideRef.current = { ...camOverrideRef.current, enabled: false }
    setCamEdit(prev => ({ ...prev, enabled: false }))
  }
  const handleCamChange = (key, val) => {
    const next = { ...camEdit, [key]: val, enabled: true }
    const pos = toXYZ(next.az, next.el, next.dist, next.panX ?? 0, next.panZ ?? 0)
    camOverrideRef.current = { enabled: true, fov: next.fov, x: pos.x, y: pos.y, z: pos.z, lx: pos.lx, lz: pos.lz }
    setCamEdit(next)
    saveConfig(next)
  }
  const NUDGE_LIMITS = { az: [-180, 180], el: [2, 80], dist: [2, 22], fov: [15, 90] }
  const nudgeCam = (key, delta) => {
    const ref = camOverrideRef.current
    const lx = ref.lx ?? LOOK_AT[0], lz = ref.lz ?? LOOK_AT[2]
    const panX = lx - LOOK_AT[0], panZ = lz - LOOK_AT[2]
    const sph = (ref.enabled && ref.x != null)
      ? fromXYZ(ref.x, ref.y, ref.z, lx, lz)
      : fromXYZ(cam?.x ?? 1.5, cam?.y ?? 4.5, cam?.z ?? 10, lx, lz)
    const fov = ref.fov ?? Math.round(cam?.fov ?? 50)
    const base = { enabled: true, az: sph.az, el: sph.el, dist: parseFloat(sph.dist.toFixed(2)), fov, panX, panZ }
    const [mn, mx] = NUDGE_LIMITS[key] ?? [-Infinity, Infinity]
    const next = { ...base, [key]: Math.max(mn, Math.min(mx, base[key] + delta)) }
    const pos = toXYZ(next.az, next.el, next.dist, panX, panZ)
    camOverrideRef.current = { enabled: true, fov: next.fov, x: pos.x, y: pos.y, z: pos.z, lx: pos.lx, lz: pos.lz }
    setCamEdit(next)
    saveConfig(next)
  }
  // strafeCam: translate camera + lookAt together along the horizontal right vector
  const strafeCam = (delta) => {
    const ref = camOverrideRef.current
    const cx = ref.x ?? cam?.x ?? 1.5, cy = ref.y ?? cam?.y ?? 4.5, cz = ref.z ?? cam?.z ?? 10
    const lx = ref.lx ?? LOOK_AT[0], lz = ref.lz ?? LOOK_AT[2]
    const fov = ref.fov ?? Math.round(cam?.fov ?? 50)
    // right = cross(forward=(lx-cx,0,lz-cz), up=(0,1,0)) = (-fz, 0, fx) / len
    const fx = lx - cx, fz = lz - cz
    const len = Math.sqrt(fx*fx + fz*fz) || 1
    const rx = -fz / len, rz = fx / len
    const newCx = cx + rx * delta, newCz = cz + rz * delta
    const newLx = lx + rx * delta, newLz = lz + rz * delta
    camOverrideRef.current = { enabled: true, x: newCx, y: cy, z: newCz, fov, lx: newLx, lz: newLz }
    const sph = fromXYZ(newCx, cy, newCz, newLx, newLz)
    const next = { enabled: true, az: sph.az, el: sph.el, dist: parseFloat(sph.dist.toFixed(2)), fov, panX: newLx - LOOK_AT[0], panZ: newLz - LOOK_AT[2] }
    setCamEdit(next)
    saveConfig(next)
  }

  // Derive live spherical coords from camera tracker output
  const liveSph = cam ? fromXYZ(cam.x, cam.y, cam.z) : null

  const CAM_DEFAULTS = { az: 88, el: 20, dist: 10.7, fov: 50, panX: 0, panZ: 0 }
  const STORAGE_KEY  = 'ev-cam-config'
  const saveConfig = (edit) => {
    const { az, el, dist, fov, panX, panZ } = edit
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ az, el, dist, fov, panX: panX ?? 0, panZ: panZ ?? 0 })) } catch {}
  }
  const resetConfig = () => {
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    const pos = toXYZ(CAM_DEFAULTS.az, CAM_DEFAULTS.el, CAM_DEFAULTS.dist, 0, 0)
    camOverrideRef.current = { enabled: true, fov: CAM_DEFAULTS.fov, x: pos.x, y: pos.y, z: pos.z, lx: pos.lx, lz: pos.lz }
    setCamEdit({ ...CAM_DEFAULTS, enabled: true })
  }

  // Load saved config once on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (saved && typeof saved.az === 'number') {
        const { az, el, dist, fov, panX = 0, panZ = 0 } = saved
        const pos = toXYZ(az, el, dist, panX, panZ)
        camOverrideRef.current = { enabled: true, fov, x: pos.x, y: pos.y, z: pos.z, lx: pos.lx, lz: pos.lz }
        setCamEdit({ enabled: true, az, el, dist, fov, panX, panZ })
      }
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const PHASE_COLOR = {
    arriving: '#60a5fa', occupied: '#fbbf24', charging: '#34d399', leaving: '#a78bfa',
  }
  const STATE_COLOR = {
    Available: '#22c55e', Occupied: '#eab308', Charging: '#38bdf8',
    Faulted: '#ef4444', Inoperative: '#6b7280',
  }
  const TYPE_LABEL = { truck: 'F-150 Lightning', sedan: 'EV Sedan', suv: 'EV SUV', cybertruck: 'Cybertruck' }

  return (
    <div className={`relative ${className}`} style={{ height: '100%', background: '#080f1a' }}>
      <Canvas
        camera={mode === 'intro' ? { position:[1.5,4.5,10], fov:50 } : { position:[0.8,3.8,8], fov:52 }}
        shadows
        style={{ background: '#87ceeb', width: '100%', height: '100%' }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.4 }}
      >
        <Scene mode={mode} snapshot={snapshot} log={log} zoomOut={zoomOut} onInfo={setInfo} cameraOverrideRef={camOverrideRef} />
        <CameraTracker onCam={setCam} />
        <CameraController overrideRef={camOverrideRef} />
        <FirstFrame onReady={() => setReady(true)} />
      </Canvas>

      {/* Load overlay */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500
                    ${ready ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ background: '#080f1a' }}
      >
        <i className="fa-solid fa-spinner fa-spin text-blue-400 text-3xl" />
      </div>

      {/* ── Config panel ─────────────────────────────────────────────── */}
      {ready && cam && (
        <div
          className="absolute bottom-4 right-4 select-none"
          style={{
            background: 'rgba(8,15,26,0.80)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '10px',
            padding: panelOpen ? '10px 14px' : '6px 14px',
            width: '210px',
            fontFamily: 'monospace',
            fontSize: '11px',
            maxHeight: 'calc(100vh - 2rem)',
            overflowY: panelOpen ? 'auto' : 'hidden',
            transition: 'padding 0.15s ease',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: panelOpen ? '8px' : '0' }}>
            <span style={{ color: '#64748b', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Config</span>
            <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                onClick={resetConfig}
                style={{ background: 'none', border: 'none', color: '#475569', fontSize: '9px', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                title="Reset to defaults"
              >⟳ reset</button>
              <button
                onClick={() => setPanelOpen(o => !o)}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                title={panelOpen ? 'Collapse' : 'Expand'}
              >
                {panelOpen ? '▾' : '▸'}
              </button>
            </span>
          </div>

          {panelOpen && (<>

          {/* ── Camera — editable ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ color: '#64748b', fontSize: '9px', letterSpacing: '0.10em', textTransform: 'uppercase' }}>Camera</span>
            {camEdit.enabled
              ? <button onClick={releaseCam} style={{ background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: '4px', color: '#60a5fa', fontSize: '9px', padding: '1px 6px', cursor: 'pointer' }}>↺ Auto</button>
              : <span style={{ color: '#374151', fontSize: '9px' }}>drag to override</span>
            }
          </div>

          {[
            { key: 'az',   label: '← Orbit →', min: -180, max: 180, step: 1,   suffix: '°' },
            { key: 'el',   label: 'Elevation',  min: 2,    max: 80,  step: 0.5, suffix: '°' },
            { key: 'dist', label: 'Distance',   min: 2,    max: 22,  step: 0.2, suffix: ''  },
            { key: 'fov',  label: 'FOV',        min: 15,   max: 90,  step: 1,   suffix: '°' },
          ].map(({ key, label, min, max, step, suffix }) => {
            const lv  = liveSph?.[key] ?? (cam?.fov && key === 'fov' ? cam.fov : { az:88, el:20, dist:10.7, fov:50 }[key])
            const val = camEdit.enabled ? camEdit[key] : lv
            const fmt = v => step < 1 ? Number(v).toFixed(1) : Number(v).toFixed(0)
            return (
              <div key={key} style={{ marginBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span style={{ color: '#64748b' }}>{label}</span>
                  <span style={{ color: camEdit.enabled ? '#e2e8f0' : '#94a3b8' }}>{fmt(val)}{suffix}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={val ?? min}
                  style={{ width: '100%', accentColor: camEdit.enabled ? '#60a5fa' : '#334155', cursor: 'pointer' }}
                  onPointerDown={enableOverride}
                  onChange={e => handleCamChange(key, step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
                />
              </div>
            )
          })}

          {/* Read-only live position */}
          {cam && (<>
            <Divider />
            {/* D-pad: ◀/▶ strafe (translate), ▲/▼ elevation */}
            {(() => {
              const btnStyle = (active) => ({
                background: active ? '#1e3a5f' : '#0f1f35',
                border: `1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,0.10)'}`,
                borderRadius: '5px',
                color: active ? '#93c5fd' : '#475569',
                fontSize: '13px',
                width: '32px', height: '28px',
                cursor: 'pointer', lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                userSelect: 'none',
              })
              const startNudge = (fn) => {
                fn()
                clearInterval(nudgeIntervalRef.current)
                nudgeIntervalRef.current = setInterval(fn, 120)
              }
              const stopNudge = () => {
                clearInterval(nudgeIntervalRef.current)
                nudgeIntervalRef.current = null
              }
              const btn = (label, fn) => (
                <button key={label} style={btnStyle(camEdit.enabled)}
                  onMouseDown={() => startNudge(fn)} onMouseUp={stopNudge} onMouseLeave={stopNudge}
                  onTouchStart={e => { e.preventDefault(); startNudge(fn) }} onTouchEnd={stopNudge}
                >{label}</button>
              )
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '32px 32px 32px', gridTemplateRows: '28px 28px 28px', gap: '4px', margin: '6px auto 4px', width: 'fit-content' }}>
                  <div />
                  {btn('▲', () => nudgeCam('el', 5))}
                  <div />
                  {btn('◀', () => strafeCam(-0.3))}
                  <button style={{ ...btnStyle(false), fontSize: '9px', color: '#374151' }} onClick={releaseCam} title="Reset to auto">⊙</button>
                  {btn('▶', () => strafeCam(0.3))}
                  <div />
                  {btn('▼', () => nudgeCam('el', -5))}
                  <div />
                </div>
              )
            })()}
          </>)}

          </>)} {/* end panelOpen */}
        </div>
      )}
    </div>
  )
}

