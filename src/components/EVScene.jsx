/**
 * EVScene — reusable Three.js scene for the OCPP EVSE Simulator.
 *
 * mode="intro"  : full-screen cinematic intro with auto demo loop
 * mode="panel"  : compact panel driven by live snapshot + log
 */
import { useRef, useState, useEffect, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, RoundedBox, Text } from '@react-three/drei'
import * as THREE from 'three'

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

// Unity-style critically-damped SmoothDamp — buttery arrival, no overshoot snap.
// velRef is a mutable ref holding current velocity; returns the new position.
const smoothDamp = (current, target, velRef, smoothTime, dt, maxSpeed = Infinity) => {
  smoothTime = Math.max(0.0001, smoothTime)
  const omega = 2 / smoothTime
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const maxChange = maxSpeed * smoothTime
  let change = current - target
  change = Math.max(-maxChange, Math.min(change, maxChange))
  const originalTo = target
  const tgt = current - change
  const temp = (velRef.current + omega * change) * dt
  velRef.current = (velRef.current - omega * temp) * exp
  let output = tgt + (change + temp) * exp
  if ((originalTo - current > 0) === (output > originalTo)) {
    output = originalTo
    velRef.current = (output - originalTo) / dt
  }
  return output
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
// CSMS (Ford building) set back behind the charging station, clear of the loop
const CSMS_GROUND = [5.0, 0, -6.8]
const CSMS_SCALE  = 2.0
// Message-packet endpoint near the building's lower front
const CSMS_LINK   = new THREE.Vector3(4.6, 1.9, -5.4)

// ─── Drive path (intro) ───────────────────────────────────────────────────────
// Open path (no longer a loop): a fresh car enters from the far left, approaches
// the charging pad heading EAST so its front charge-port faces the EVSE. After
// charging it pulls forward (east), turns left to head north, drives straight
// past the Ford building and up between the building gaps, and vanishes. Next
// cycle a new car arrives.
const PAD_POINT = new THREE.Vector3(-1.8, 0, 0.0)   // charging pad, heading east

const ENTRY_POINTS = [
  new THREE.Vector3(-18.5, 0, -2.5),   // far left, off-screen among buildings
  new THREE.Vector3( -7.5, 0, -1.6),
  new THREE.Vector3( -5.6, 0, -0.6),   // curve onto the near lane
  new THREE.Vector3( -4.6, 0,  0.0),   // settle onto z=0 lane, heading east
  PAD_POINT.clone(),                   // arrive at pad heading east
]
const EXIT_POINTS = [
  PAD_POINT.clone(),                   // depart the pad heading east
  new THREE.Vector3(  1.2, 0,  0.0),   // pull forward (east)
  new THREE.Vector3(  2.9, 0, -1.3),   // turn left → north
  new THREE.Vector3(  3.3, 0, -4.5),   // north, passing left of the Ford office
  new THREE.Vector3(  3.3, 0, -9.0),
  new THREE.Vector3(  3.2, 0, -16.0),  // between the building gaps
  new THREE.Vector3(  3.2, 0, -26.0),  // vanish into the distance
  new THREE.Vector3(  2.2, 0, -36.0),  // vanish into the distance
  new THREE.Vector3(  0, 0, -46.0),  // vanish into the distance
]
const ENTRY_CURVE = new THREE.CatmullRomCurve3(ENTRY_POINTS, false, 'centripetal', 0.5)
const EXIT_CURVE  = new THREE.CatmullRomCurve3(EXIT_POINTS,  false, 'centripetal', 0.5)
const ENTRY_LEN   = ENTRY_CURVE.getLength()
const EXIT_LEN    = EXIT_CURVE.getLength()
// Pause (seconds) after the car stops at the pad before the connector plugs in
const CONNECT_DELAY = 2

// Shortest-arc angle interpolation (handles ±π wrap)
const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI)  d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// Truck colour variants — a fresh car arrives at the pad each charging session
const CAR_VARIANTS = [
  { body: '#2f6fc4' },   // Atlas blue
  { body: '#c0392b' },   // racing red
  { body: '#c3c8ce' },   // silver
  { body: '#10243f' },   // midnight navy
  { body: '#e9ebee' },   // oxford white
  { body: '#2e7d52' },   // forest green
  { body: '#e0902f' },   // amber orange
]

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

// ─── Car (Ford F-150 Lightning — composite volume build) ──────────────────────
function Car({ mode, phase, state, carXRef, variant, onNewCar, onArrived, onExited, onParked }) {
  const groupRef   = useRef()
  const wheelRefs  = useRef([])
  const velRef     = useRef(0)                          // panel x velocity (smoothDamp)
  const uRef       = useRef(0)                          // intro path progress 0..1
  const uVelRef    = useRef(0)
  const posRef     = useRef(new THREE.Vector3(-7, 0, 0))
  const headRef    = useRef(0)                          // smoothed heading (rad)
  const steerRef   = useRef(0)                          // front-wheel steer
  const bobRef     = useRef(0)
  const phaseRef   = useRef(null)
  const doneRef    = useRef(false)                      // arrived/exited reported?
  const stopTimerRef = useRef(0)                        // dwell after car stops
  const panelParkRef = useRef(false)                    // panel: car settled at pad?

  const isCharging  = state === 'Charging'
  const isConnected = state === 'Occupied' || isCharging

  // ── Scale constants ────────────────────────────────────────────────────────
  const GND = 0.18   // ground clearance
  const WR  = 0.24   // wheel radius (truck-sized)
  const TW  = 0.94   // body width (Z)

  // ── Key longitudinal landmarks (X: front = +X) ──────────────────────────────
  const FRONT   =  1.18   // front bumper face
  const REAR    = -1.18   // rear bumper face
  const HOOD_X0 =  0.52   // hood / cab split
  const CAB_X1  = -0.34   // cab / bed split
  const BELT    = GND + 0.42   // beltline (top of doors / hood height)
  const ROOF    = GND + 0.80   // roof height
  const BED_TOP = GND + 0.40   // bed wall height

  const BODY_COLOR  = variant?.body ?? '#2f6fc4'   // per-lap truck colour
  const TRIM_BLACK  = '#0b1220'
  const GLASS_COLOR = '#0e1c2b'

  const bodyMat  = { color: BODY_COLOR, metalness: 0.7, roughness: 0.22, envMapIntensity: 1.3 }
  const glassMat = { color: GLASS_COLOR, transparent: true, opacity: 0.55, metalness: 0.2, roughness: 0.05 }

  // ── Movement ───────────────────────────────────────────────────────────────
  // intro: open path — enter from far right → park at pad (charge) → exit north
  // panel: ease along x to/from the pad based on connection state
  useFrame((_, dt) => {
    if (!groupRef.current) return
    const g = groupRef.current
    let px, pz, heading, speed = 0

    if (mode === 'intro') {
      // phase changes: arriving = drive entry curve (new car), leaving = exit curve
      if (phase !== phaseRef.current) {
        if (phase === 'arriving') {
          uRef.current = 0; uVelRef.current = 0; doneRef.current = false; stopTimerRef.current = 0
          if (onNewCar) onNewCar()           // swap to the next car off-screen
        } else if (phase === 'leaving') {
          uRef.current = 0; uVelRef.current = 0; doneRef.current = false
        }
        phaseRef.current = phase
      }
      let curve, len
      if (phase === 'arriving') {
        curve = ENTRY_CURVE; len = ENTRY_LEN
        uRef.current = smoothDamp(uRef.current, 1, uVelRef, 0.6, dt, 0.34)
        // wait a short beat after the car has stopped, then connect
        if (uRef.current > 0.97 && Math.abs(uVelRef.current) < 0.02) {
          stopTimerRef.current += dt
          if (!doneRef.current && stopTimerRef.current >= CONNECT_DELAY) {
            doneRef.current = true
            if (onArrived) onArrived()
          }
        } else {
          stopTimerRef.current = 0
        }
      } else if (phase === 'leaving') {
        curve = EXIT_CURVE; len = EXIT_LEN
        uRef.current = smoothDamp(uRef.current, 1, uVelRef, 0.9, dt, 0.3)
        // vanished into the fog → immediately start the next car's arrival
        if (!doneRef.current && uRef.current > 0.97) {
          doneRef.current = true
          if (onExited) onExited()
        }
      } else {
        curve = ENTRY_CURVE; len = ENTRY_LEN
        // ease the final sliver to the exact pad (no snap), then hold
        uRef.current = smoothDamp(uRef.current, 1, uVelRef, 0.4, dt, 0.6)
      }
      const u   = THREE.MathUtils.clamp(uRef.current, 0, 1)
      const pt  = curve.getPointAt(u)
      const tan = curve.getTangentAt(u)
      px = pt.x; pz = pt.z
      heading = Math.atan2(-tan.z, tan.x)
      speed   = uVelRef.current * len
    } else {
      const connected = state === 'Occupied' || state === 'Charging'
      const targetX = connected ? -1.8 : -7
      const prev = posRef.current.x
      px = smoothDamp(prev, targetX, velRef, 0.9, dt, 12)
      pz = 0
      heading = 0
      speed = (px - prev) / Math.max(dt, 0.001)
      // report parked state so the cable only attaches once the car has settled
      const parked = connected && Math.abs(px - (-1.8)) < 0.06
      if (onParked && parked !== panelParkRef.current) {
        panelParkRef.current = parked
        onParked(parked)
      }
    }

    // Heading (smoothed, shortest-arc)
    const prevHead = headRef.current
    headRef.current = lerpAngle(prevHead, heading, 1 - Math.exp(-dt * 9))
    const angVel = (headRef.current - prevHead) / Math.max(dt, 0.001)

    g.position.x = px
    g.position.z = pz
    g.rotation.y = headRef.current

    // Lean into turns; settle bob when parked
    const targetRoll = THREE.MathUtils.clamp(-angVel * 0.06, -0.05, 0.05)
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, targetRoll, dt * 6)
    if (Math.abs(speed) < 0.05) {
      bobRef.current += dt * 3
      g.position.y = Math.sin(bobRef.current) * 0.004 * Math.exp(-bobRef.current * 0.25)
      if (bobRef.current > 6) bobRef.current = 0
    } else {
      bobRef.current = 0
      g.position.y = 0
    }

    posRef.current.set(px, 0, pz)
    if (carXRef) carXRef.current = px

    // Wheels: roll about the axle (Z); front pair steers about vertical (Y)
    const dTheta = (speed * dt) / WR
    const targetSteer = THREE.MathUtils.clamp(angVel * 0.20, -0.5, 0.5)
    steerRef.current = THREE.MathUtils.lerp(steerRef.current, targetSteer, dt * 8)
    wheelRefs.current.forEach((r, i) => {
      if (!r) return
      r.rotation.z -= dTheta
      r.rotation.y = i < 2 ? steerRef.current : 0
    })
  })

  const WHEEL_POSITIONS = [
    [ 0.72, WR,  TW / 2 + 0.03], [ 0.72, WR, -(TW / 2 + 0.03)],
    [-0.78, WR,  TW / 2 + 0.03], [-0.78, WR, -(TW / 2 + 0.03)],
  ]

  // Helper for box centers/sizes from x-range
  const span = (x0, x1, y0, y1, z = TW) => ({
    pos:  [(x0 + x1) / 2, (y0 + y1) / 2, 0],
    args: [Math.abs(x1 - x0), Math.abs(y1 - y0), z],
  })

  const lowerBody = span(REAR, FRONT, GND + 0.02, GND + 0.24)
  const hood      = span(HOOD_X0, FRONT - 0.02, GND + 0.24, GND + 0.40)
  const cabLower  = span(CAB_X1, HOOD_X0, GND + 0.24, BELT)
  const bedFloor  = span(REAR + 0.04, CAB_X1, GND + 0.24, BED_TOP)

  return (
      <group ref={groupRef}>

        {/* ── Lower body / chassis (full length) ──────────────────────────── */}
        <mesh position={lowerBody.pos} castShadow>
          <boxGeometry args={lowerBody.args} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>

        {/* ── Hood / front clip (lower than cab) ──────────────────────────── */}
        <mesh position={hood.pos} castShadow>
          <RoundedBox args={hood.args} radius={0.04} smoothness={4}>
            <meshStandardMaterial {...bodyMat} />
          </RoundedBox>
        </mesh>

        {/* ── Cab lower (doors region up to beltline) ─────────────────────── */}
        <mesh position={cabLower.pos} castShadow>
          <boxGeometry args={cabLower.args} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>

        {/* ── Crew-cab greenhouse (glass box, inset) ──────────────────────── */}
        <mesh position={[(CAB_X1 + HOOD_X0) / 2, (BELT + ROOF) / 2, 0]} castShadow>
          <RoundedBox args={[Math.abs(HOOD_X0 - CAB_X1) - 0.06, ROOF - BELT, TW - 0.10]} radius={0.05} smoothness={4}>
            <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
          </RoundedBox>
        </mesh>

        {/* ── Roof cap (body-color, sits on greenhouse) ───────────────────── */}
        <mesh position={[(CAB_X1 + HOOD_X0) / 2 + 0.02, ROOF, 0]} castShadow>
          <RoundedBox args={[Math.abs(HOOD_X0 - CAB_X1) - 0.10, 0.05, TW - 0.06]} radius={0.025} smoothness={4}>
            <meshStandardMaterial {...bodyMat} />
          </RoundedBox>
        </mesh>

        {/* ── A & C pillars + door split (subtle body-color posts) ─────────── */}
        {[TW / 2 - 0.02, -(TW / 2 - 0.02)].map((z, i) => (
            <group key={i}>
              {/* A-pillar */}
              <mesh position={[HOOD_X0 - 0.04, (BELT + ROOF) / 2, z]} rotation={[0, 0, 0.20]}>
                <boxGeometry args={[0.05, ROOF - BELT + 0.04, 0.03]} />
                <meshStandardMaterial {...bodyMat} />
              </mesh>
              {/* B-pillar */}
              <mesh position={[0.10, (BELT + ROOF) / 2, z]}>
                <boxGeometry args={[0.045, ROOF - BELT, 0.03]} />
                <meshStandardMaterial color={TRIM_BLACK} metalness={0.4} roughness={0.5} />
              </mesh>
              {/* C-pillar */}
              <mesh position={[CAB_X1 + 0.04, (BELT + ROOF) / 2, z]} rotation={[0, 0, -0.12]}>
                <boxGeometry args={[0.06, ROOF - BELT + 0.04, 0.03]} />
                <meshStandardMaterial {...bodyMat} />
              </mesh>
            </group>
        ))}

        {/* ── Bed walls (open-top box behind cab) ─────────────────────────── */}
        {[TW / 2 - 0.05, -(TW / 2 - 0.05)].map((z, i) => (
            <mesh key={i} position={[(REAR + CAB_X1) / 2, (GND + 0.24 + BED_TOP) / 2, z]} castShadow>
              <boxGeometry args={[Math.abs(CAB_X1 - REAR) - 0.04, BED_TOP - (GND + 0.24), 0.06]} />
              <meshStandardMaterial {...bodyMat} />
            </mesh>
        ))}
        {/* Bed front wall (against cab) */}
        <mesh position={[CAB_X1 - 0.02, (GND + 0.24 + BED_TOP) / 2, 0]}>
          <boxGeometry args={[0.05, BED_TOP - (GND + 0.24), TW - 0.10]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>
        {/* Bed inner floor (dark liner) */}
        <mesh position={[(REAR + CAB_X1) / 2, GND + 0.245, 0]}>
          <boxGeometry args={[Math.abs(CAB_X1 - REAR) - 0.06, 0.02, TW - 0.14]} />
          <meshStandardMaterial color={TRIM_BLACK} roughness={0.85} metalness={0.1} />
        </mesh>

        {/* ── Tonneau cover (closed bed lid, flush with rail) ─────────────── */}
        <mesh position={[(REAR + CAB_X1) / 2 + 0.02, BED_TOP, 0]} castShadow>
          <RoundedBox args={[Math.abs(CAB_X1 - REAR) - 0.10, 0.03, TW - 0.10]} radius={0.015} smoothness={3}>
            <meshStandardMaterial {...bodyMat} />
          </RoundedBox>
        </mesh>

        {/* ── Squared fender flares (signature truck cue) ─────────────────── */}
        {WHEEL_POSITIONS.map((p, i) => (
            <mesh key={i} position={[p[0], GND + 0.16, p[2] > 0 ? TW / 2 + 0.005 : -(TW / 2 + 0.005)]}>
              <boxGeometry args={[WR * 2.3, WR * 1.7, 0.07]} />
              <meshStandardMaterial color={TRIM_BLACK} metalness={0.3} roughness={0.7} />
            </mesh>
        ))}

        {/* ── Running boards ──────────────────────────────────────────────── */}
        {[TW / 2 + 0.03, -(TW / 2 + 0.03)].map((z, i) => (
            <mesh key={i} position={[-0.05, GND - 0.02, z]}>
              <boxGeometry args={[1.10, 0.04, 0.09]} />
              <meshStandardMaterial color={TRIM_BLACK} metalness={0.75} roughness={0.5} />
            </mesh>
        ))}

        {/* ── Wheels (5-spoke alloy) — axle along Z, spin about Z ─────────── */}
        {WHEEL_POSITIONS.map((p, i) => {
          const outer = p[2] > 0 ? 1 : -1
          const faceZ = outer * (0.105)
          return (
            <group key={i} position={p}>
              {/* spin group — rotates about the axle (Z) */}
              <group ref={el => (wheelRefs.current[i] = el)}>
                {/* Tyre (axis along Z) */}
                <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[WR, WR, 0.20, 28]} />
                  <meshStandardMaterial color="#111827" roughness={0.9} metalness={0.05} />
                </mesh>
                {/* Tread blocks around the circumference (XY plane) */}
                {Array.from({ length: 16 }).map((_, j) => {
                  const a = (j / 16) * Math.PI * 2
                  return (
                    <mesh key={j} position={[Math.cos(a) * WR * 0.99, Math.sin(a) * WR * 0.99, 0]} rotation={[0, 0, a]}>
                      <boxGeometry args={[0.045, 0.05, 0.205]} />
                      <meshStandardMaterial color="#1f2937" roughness={1} />
                    </mesh>
                  )
                })}
                {/* Outer alloy face (rim + spokes + cap) */}
                <group position={[0, 0, faceZ]}>
                  {/* Rim disc (axis along Z) */}
                  <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[WR - 0.03, WR - 0.03, 0.02, 28]} />
                    <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.35} />
                  </mesh>
                  {/* 5 spokes radiating in the XY plane */}
                  {[0, 1, 2, 3, 4].map(j => (
                    <mesh key={j} rotation={[0, 0, (j / 5) * Math.PI * 2]} position={[0, 0, 0.005 * outer]}>
                      <boxGeometry args={[WR * 1.3, 0.045, 0.03]} />
                      <meshStandardMaterial color="#cbd5e1" metalness={0.96} roughness={0.06} />
                    </mesh>
                  ))}
                  {/* Centre cap */}
                  <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.012 * outer]}>
                    <cylinderGeometry args={[0.06, 0.06, 0.02, 12]} />
                    <meshStandardMaterial color="#94a3b8" metalness={0.98} roughness={0.04} />
                  </mesh>
                </group>
              </group>
            </group>
          )
        })}

        {/* ── Full-width front LED bar (Lightning signature) ──────────────── */}
        <mesh position={[FRONT - 0.005, GND + 0.34, 0]}>
          <boxGeometry args={[0.04, 0.035, TW + 0.02]} />
          <meshStandardMaterial color="#e0f2fe" emissive="#e0f2fe" emissiveIntensity={isConnected ? 0.6 : 3.2} />
        </mesh>
        {/* Headlight pods */}
        {[TW / 2 - 0.13, -(TW / 2 - 0.13)].map((z, i) => (
            <group key={i}>
              <mesh position={[FRONT - 0.04, GND + 0.26, z]}>
                <boxGeometry args={[0.05, 0.13, 0.22]} />
                <meshStandardMaterial color="#fef9c3" emissive="#fef9c3" emissiveIntensity={isConnected ? 0.4 : 2.0} />
              </mesh>
              {!isConnected && <pointLight position={[FRONT + 0.15, GND + 0.30, z * 1.6]} color="#fff8dc" intensity={0.8} distance={3.2} />}
            </group>
        ))}
        {/* Sealed EV grille panel */}
        <mesh position={[FRONT - 0.01, GND + 0.18, 0]}>
          <boxGeometry args={[0.035, 0.13, TW - 0.18]} />
          <meshStandardMaterial color="#09111f" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* FORD badge bar */}
        <mesh position={[FRONT + 0.005, GND + 0.18, 0]}>
          <boxGeometry args={[0.012, 0.04, 0.24]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.04} />
        </mesh>

        {/* ── Full-width rear LED bar ──────────────────────────────────────── */}
        <mesh position={[REAR + 0.005, GND + 0.30, 0]}>
          <boxGeometry args={[0.035, 0.03, TW + 0.01]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.2} />
        </mesh>

        {/* ── Charge port (front fender, ahead of front wheel) ─────────────── */}
        <mesh position={[1.0, GND + 0.30, TW / 2 + 0.01]}>
          <boxGeometry args={[0.12, 0.10, 0.04]} />
          <meshStandardMaterial
              color="#1e293b"
              emissive={isCharging ? '#38bdf8' : isConnected ? '#94a3b8' : '#111'}
              emissiveIntensity={isCharging ? 2.5 : 0.22}
          />
        </mesh>
        {isCharging && <pointLight position={[1.0, GND + 0.40, TW / 2 + 0.28]} color="#38bdf8" intensity={2} distance={1.5} />}
      </group>
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
// Ford oval badge — real horizontal ellipse shape via ExtrudeGeometry
function FordLogo({ position }) {
  const glowRef = useRef()
  const t = useRef(0)

  // Real Ford oval: ~2.2:1 width-to-height ratio
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
      {/* FORD italic text — renderOrder ensures it draws on top */}
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
        FORD
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

      {/* ── Ford logo on top-floor front wall ─────────────── */}
      <FordLogo position={[0, (FLOORS - 1) * FLOOR_H + FLOOR_H / 2, BLDG_D / 2 + 0.04]} />
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

function CameraDrift({ zoomOut = false }) {
  const t    = useRef(0)
  const mx   = useRef(0)
  const my   = useRef(0)
  const pull = useRef(0)   // 0 → 1 dolly-back amount during the launch transition
  useFrame(({ camera, pointer }, dt) => {
    t.current += dt * 0.12
    // Smoothly ease toward the pointer for a gentle parallax (low drag)
    const k = 1 - Math.exp(-dt * 4)
    mx.current += (pointer.x - mx.current) * k
    my.current += (pointer.y - my.current) * k
    // Ease the dolly-back when launching (pull camera up and away)
    pull.current += ((zoomOut ? 1 : 0) - pull.current) * (1 - Math.exp(-dt * 3))
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

  const pos = [5, 11, 14]
  const r = 1.5

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
function Scene({ mode, snapshot, log, zoomOut }) {
  const [introPhase, setIntroPhase] = useState('arriving')
  const [carVariant, setCarVariant] = useState(0)
  const [panelParked, setPanelParked] = useState(false)   // panel: car settled at pad?
  const [sendTrig, setSendTrig]     = useState(0)
  const [recvTrig, setRecvTrig]     = useState(0)
  const prevLogLen = useRef(0)
  const carXRef    = useRef(-7)   // shared live car x — read by cable + particles

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

      {mode === 'intro' && <CameraDrift zoomOut={zoomOut} />}
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

// ─── Public component ─────────────────────────────────────────────────────────
export default function EVScene({ mode = 'intro', snapshot = {}, log = [], className = '', zoomOut = false }) {
  const [ready, setReady] = useState(false)
  return (
    <div className={`relative ${className}`} style={{ height: '100%', background: '#080f1a' }}>
      <Canvas
        camera={mode === 'intro' ? { position:[1.5,4.5,10], fov:50 } : { position:[0.8,3.8,8], fov:52 }}
        shadows
        style={{ background: '#87ceeb', width: '100%', height: '100%' }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.4 }}
      >
        <Scene mode={mode} snapshot={snapshot} log={log} zoomOut={zoomOut} />
        <FirstFrame onReady={() => setReady(true)} />
      </Canvas>

      {/* Load overlay — masks the canvas clear colour until the first frame paints */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500
                    ${ready ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ background: '#080f1a' }}
      >
        <i className="fa-solid fa-spinner fa-spin text-blue-400 text-3xl" />
      </div>
    </div>
  )
}

