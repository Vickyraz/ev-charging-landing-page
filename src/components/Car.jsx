import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { useMemo } from 'react'

/* ─── Motion helpers ─────────────────────────────────────────────────────── */
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
const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2)
  if (d >  Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/* ─── Drive path ─────────────────────────────────────────────────────────── */
const PAD_POINT = new THREE.Vector3(-1.8, 0, 0)
const ENTRY_POINTS = [
  new THREE.Vector3(-18.5, 0, -2.5),
  new THREE.Vector3( -7.5, 0, -1.6),
  new THREE.Vector3( -5.6, 0, -0.6),
  new THREE.Vector3( -4.6, 0,  0.0),
  PAD_POINT.clone(),
]
const EXIT_POINTS = [
  PAD_POINT.clone(),
  new THREE.Vector3(  1.2, 0,  0.0),
  new THREE.Vector3(  2.9, 0, -1.3),
  new THREE.Vector3(  3.3, 0, -4.5),
  new THREE.Vector3(  3.3, 0, -9.0),
  new THREE.Vector3(  3.2, 0, -16.0),
  new THREE.Vector3(  3.2, 0, -26.0),
  new THREE.Vector3(  2.2, 0, -36.0),
  new THREE.Vector3(  0,   0, -46.0),
]
export const ENTRY_CURVE = new THREE.CatmullRomCurve3(ENTRY_POINTS, false, 'centripetal', 0.5)
export const EXIT_CURVE  = new THREE.CatmullRomCurve3(EXIT_POINTS,  false, 'centripetal', 0.5)
const ENTRY_LEN   = ENTRY_CURVE.getLength()
const EXIT_LEN    = EXIT_CURVE.getLength()
const CONNECT_DELAY = 2

/* ─── Per-type dimension configs ─────────────────────────────────────────── */
// WFX/WRX = front and rear wheel axle X positions
const V = {
  truck:      { WR: 0.24, TW: 0.94, GND: 0.18, FRONT:  1.18, REAR: -1.18, WFX:  0.72, WRX: -0.78 },
  sedan:      { WR: 0.20, TW: 0.84, GND: 0.15, FRONT:  1.15, REAR: -1.15, WFX:  0.72, WRX: -0.75 },
  suv:        { WR: 0.23, TW: 0.92, GND: 0.20, FRONT:  1.12, REAR: -1.12, WFX:  0.65, WRX: -0.70 },
  cybertruck: { WR: 0.26, TW: 0.98, GND: 0.20, FRONT:  1.22, REAR: -1.18, WFX:  0.76, WRX: -0.84 },
}

/* ─── Car variants (type + body colour) ──────────────────────────────────── */
export const CAR_VARIANTS = [
  { type: 'truck',      body: '#2f6fc4' },
  { type: 'sedan',      body: '#c0392b' },
  { type: 'suv',        body: '#2e7d52' },
  // { type: 'cybertruck', body: '#c3c8ce' },
  { type: 'truck',      body: '#e9ebee' },
  { type: 'sedan',      body: '#7b2d8b' },
  { type: 'suv',        body: '#e0902f' },
  // { type: 'cybertruck', body: '#9ba4ae' }
]

/* ═══════════════════════════════════════════════════════════════════════════
   BODY COMPONENTS  — each renders only body meshes (no wheels, no charge port)
═══════════════════════════════════════════════════════════════════════════ */

/* ─── Truck body (F-150 Lightning style) ─────────────────────────────────── */
function TruckBody({ bodyMat, glassMat, TRIM_BLACK, isConnected }) {
  const { GND, TW, FRONT, REAR } = V.truck
  const HOOD_X0 = 0.52, CAB_X1 = -0.34
  const BELT    = GND + 0.42
  const ROOF    = GND + 0.80
  const BED_TOP = GND + 0.40
  const span = (x0, x1, y0, y1, z = TW) => ({
    pos:  [(x0 + x1) / 2, (y0 + y1) / 2, 0],
    args: [Math.abs(x1 - x0), Math.abs(y1 - y0), z],
  })
  const lowerBody = span(REAR, FRONT, GND + 0.02, GND + 0.24)
  const hood      = span(HOOD_X0, FRONT - 0.02, GND + 0.24, GND + 0.40)
  const cabLower  = span(CAB_X1, HOOD_X0, GND + 0.24, BELT)
  return (
    <>
      <mesh position={lowerBody.pos} castShadow>
        <boxGeometry args={lowerBody.args} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>
      <mesh position={hood.pos} castShadow>
        <RoundedBox args={hood.args} radius={0.04} smoothness={4}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>
      <mesh position={cabLower.pos} castShadow>
        <boxGeometry args={cabLower.args} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>
      {/* Greenhouse */}
      <mesh position={[(CAB_X1 + HOOD_X0) / 2, (BELT + ROOF) / 2, 0]} castShadow>
        <RoundedBox args={[Math.abs(HOOD_X0 - CAB_X1) - 0.06, ROOF - BELT, TW - 0.10]} radius={0.05} smoothness={4}>
          <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
        </RoundedBox>
      </mesh>
      {/* Roof cap */}
      <mesh position={[(CAB_X1 + HOOD_X0) / 2 + 0.02, ROOF, 0]} castShadow>
        <RoundedBox args={[Math.abs(HOOD_X0 - CAB_X1) - 0.10, 0.05, TW - 0.06]} radius={0.025} smoothness={4}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>
      {/* A / B / C pillars — Z matches greenhouse edge (TW-0.10)/2 */}
      {[TW / 2 - 0.025, -(TW / 2 - 0.025)].map((z, i) => (
        <group key={i}>
          <mesh position={[HOOD_X0 - 0.04, (BELT + ROOF) / 2, z]} rotation={[0, 0, 0.20]}>
            <boxGeometry args={[0.05, ROOF - BELT + 0.04, 0.05]} />
            <meshStandardMaterial {...bodyMat} />
          </mesh>
          <mesh position={[0.10, (BELT + ROOF) / 2, z]}>
            <boxGeometry args={[0.045, ROOF - BELT, 0.05]} />
            <meshStandardMaterial color={TRIM_BLACK} metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[CAB_X1 + 0.04, (BELT + ROOF) / 2, z]} rotation={[0, 0, -0.12]}>
            <boxGeometry args={[0.06, ROOF - BELT + 0.04, 0.05]} />
            <meshStandardMaterial {...bodyMat} />
          </mesh>
        </group>
      ))}
      {/* Bed side walls */}
      {[TW / 2 - 0.05, -(TW / 2 - 0.05)].map((z, i) => (
        <mesh key={i} position={[(REAR + CAB_X1) / 2, (GND + 0.24 + BED_TOP) / 2, z]} castShadow>
          <boxGeometry args={[Math.abs(CAB_X1 - REAR) - 0.04, BED_TOP - (GND + 0.24), 0.06]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>
      ))}
      <mesh position={[CAB_X1 - 0.02, (GND + 0.24 + BED_TOP) / 2, 0]}>
        <boxGeometry args={[0.05, BED_TOP - (GND + 0.24), TW - 0.10]} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>
      <mesh position={[(REAR + CAB_X1) / 2, GND + 0.245, 0]}>
        <boxGeometry args={[Math.abs(CAB_X1 - REAR) - 0.06, 0.02, TW - 0.14]} />
        <meshStandardMaterial color={TRIM_BLACK} roughness={0.85} metalness={0.1} />
      </mesh>
      {/* Tonneau cover */}
      <mesh position={[(REAR + CAB_X1) / 2 + 0.02, BED_TOP, 0]} castShadow>
        <RoundedBox args={[Math.abs(CAB_X1 - REAR) - 0.10, 0.03, TW - 0.10]} radius={0.015} smoothness={3}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>
      {/* Fender flares */}
      {[[ 0.72, TW/2+0.005], [ 0.72, -(TW/2+0.005)],
        [-0.78, TW/2+0.005], [-0.78, -(TW/2+0.005)]].map(([x, z], i) => (
        <mesh key={i} position={[x, GND + 0.16, z]}>
          <boxGeometry args={[0.24 * 2.3, 0.24 * 1.7, 0.07]} />
          <meshStandardMaterial color={TRIM_BLACK} metalness={0.3} roughness={0.7} />
        </mesh>
      ))}
      {/* Running boards */}
      {[TW / 2 + 0.03, -(TW / 2 + 0.03)].map((z, i) => (
        <mesh key={i} position={[-0.05, GND - 0.02, z]}>
          <boxGeometry args={[1.10, 0.04, 0.09]} />
          <meshStandardMaterial color={TRIM_BLACK} metalness={0.75} roughness={0.5} />
        </mesh>
      ))}
      {/* Front LED bar */}
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
      {/* EV grille panel */}
      <mesh position={[FRONT - 0.01, GND + 0.18, 0]}>
        <boxGeometry args={[0.035, 0.13, TW - 0.18]} />
        <meshStandardMaterial color="#09111f" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[FRONT + 0.005, GND + 0.18, 0]}>
        <boxGeometry args={[0.012, 0.04, 0.24]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.04} />
      </mesh>
      {/* Rear LED bar */}
      <mesh position={[REAR + 0.005, GND + 0.30, 0]}>
        <boxGeometry args={[0.035, 0.03, TW + 0.01]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.2} />
      </mesh>
    </>
  )
}

/* ─── Sedan body (Model 3-style EV sedan) ────────────────────────────────── */
function SedanBody({ bodyMat, glassMat, TRIM_BLACK, isConnected }) {
  const { GND, TW, FRONT, REAR } = V.sedan
  const BELT   = GND + 0.28
  const ROOF   = GND + 0.54
  const CAB_F  = 0.46
  const CAB_R  = -0.72
  const CAB_MX = (CAB_F + CAB_R) / 2

  // ── Windshield rake (47° from vertical, Model 3-style) ──
  const WS_TOP_X = CAB_F - 0.28                                  // where screen meets roofline
  const WS_CX    = (CAB_F + WS_TOP_X) / 2
  const WS_DX    = CAB_F - WS_TOP_X                             // horizontal run = 0.28
  const WS_DY    = ROOF - BELT                                   // vertical rise  = 0.26
  const WS_LEN   = Math.sqrt(WS_DX * WS_DX + WS_DY * WS_DY)   // ≈ 0.382
  const WS_ANG   = Math.atan2(WS_DX, WS_DY)                    // ≈ 0.82 rad

  // ── Rear window rake (40° from vertical, fastback) ──
  const RW_TOP_X = CAB_R + 0.22
  const RW_CX    = (CAB_R + RW_TOP_X) / 2
  const RW_DX    = RW_TOP_X - CAB_R                             // = 0.22
  const RW_DY    = ROOF - BELT
  const RW_LEN   = Math.sqrt(RW_DX * RW_DX + RW_DY * RW_DY)   // ≈ 0.341
  const RW_ANG   = Math.atan2(RW_DX, RW_DY)                    // ≈ 0.70 rad

  const ROOF_MX  = (WS_TOP_X + RW_TOP_X) / 2
  const CY       = (BELT + ROOF) / 2
  const PZ       = TW / 2 - 0.03                                // pillar Z centre

  return (
    <>
      {/* Chassis slab */}
      <mesh position={[0, GND + 0.11, 0]} castShadow>
        <boxGeometry args={[FRONT - REAR, 0.20, TW]} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>
      {/* Lower door section */}
      <mesh position={[0, (GND + 0.22 + BELT) / 2, 0]} castShadow>
        <boxGeometry args={[FRONT - REAR, BELT - (GND + 0.22) + 0.01, TW - 0.04]} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>
      {/* Hood deck */}
      <mesh position={[(CAB_F + FRONT) / 2, BELT, 0]} castShadow>
        <RoundedBox args={[FRONT - CAB_F, 0.04, TW - 0.08]} radius={0.02} smoothness={3}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>
      {/* Rear trunk deck */}
      <mesh position={[(CAB_R + REAR) / 2, BELT - 0.02, 0]}>
        <RoundedBox args={[CAB_R - REAR, 0.04, TW - 0.08]} radius={0.02} smoothness={3}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>

      {/* ──── Greenhouse ──── */}
      {/* Windshield glass — raked at WS_ANG */}
      <mesh position={[WS_CX, CY, 0]} rotation={[0, 0, WS_ANG]}>
        <boxGeometry args={[0.022, WS_LEN, TW - 0.14]} />
        <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
      </mesh>
      {/* Rear window glass — raked at RW_ANG */}
      <mesh position={[RW_CX, CY, 0]} rotation={[0, 0, -RW_ANG]}>
        <boxGeometry args={[0.022, RW_LEN, TW - 0.14]} />
        <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
      </mesh>
      {/* Side door glass panels — X-span matches roof (WS_TOP_X → RW_TOP_X) so they stay inside the pillar frame */}
      {[TW / 2 - 0.04, -(TW / 2 - 0.04)].map((z, i) => (
        <mesh key={i} position={[ROOF_MX, CY, z]}>
          <boxGeometry args={[WS_TOP_X - RW_TOP_X, ROOF - BELT - 0.01, 0.015]} />
          <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Flat roof panel (spans WS top → RW top) */}
      <mesh position={[ROOF_MX, ROOF, 0]}>
        <RoundedBox args={[WS_TOP_X - RW_TOP_X + 0.06, 0.032, TW - 0.08]} radius={0.016} smoothness={3}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>
      {/* A-pillars — same rotation as windshield: perfect alignment guaranteed */}
      {[PZ, -PZ].map((z, i) => (
        <mesh key={i} position={[WS_CX, CY, z]} rotation={[0, 0, WS_ANG]}>
          <boxGeometry args={[0.06, WS_LEN + 0.04, 0.08]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>
      ))}
      {/* C-pillars — same rotation as rear window */}
      {[PZ, -PZ].map((z, i) => (
        <mesh key={i} position={[RW_CX, CY, z]} rotation={[0, 0, -RW_ANG]}>
          <boxGeometry args={[0.06, RW_LEN + 0.04, 0.08]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>
      ))}
      {/* Fender arches */}
      {[[ 0.72, TW/2+0.004], [ 0.72, -(TW/2+0.004)],
        [-0.75, TW/2+0.004], [-0.75, -(TW/2+0.004)]].map(([x, z], i) => (
        <mesh key={i} position={[x, GND + 0.12, z]}>
          <boxGeometry args={[0.20 * 2.2, 0.20 * 1.5, 0.06]} />
          <meshStandardMaterial color={TRIM_BLACK} metalness={0.3} roughness={0.7} />
        </mesh>
      ))}
      {/* Front full-width LED strip */}
      <mesh position={[FRONT - 0.005, GND + 0.22, 0]}>
        <boxGeometry args={[0.03, 0.024, TW + 0.01]} />
        <meshStandardMaterial color="#e8f4ff" emissive="#e8f4ff" emissiveIntensity={isConnected ? 0.5 : 3.0} />
      </mesh>
      {/* Slim headlights */}
      {[TW / 2 - 0.14, -(TW / 2 - 0.14)].map((z, i) => (
        <group key={i}>
          <mesh position={[FRONT - 0.03, GND + 0.18, z]}>
            <boxGeometry args={[0.04, 0.09, 0.24]} />
            <meshStandardMaterial color="#e8f4ff" emissive="#e8f4ff" emissiveIntensity={isConnected ? 0.3 : 1.8} />
          </mesh>
          {!isConnected && <pointLight position={[FRONT + 0.12, GND + 0.22, z * 1.5]} color="#ffffff" intensity={0.7} distance={3.0} />}
        </group>
      ))}
      {/* Lower front bumper */}
      <mesh position={[FRONT - 0.01, GND + 0.09, 0]}>
        <boxGeometry args={[0.025, 0.16, TW - 0.10]} />
        <meshStandardMaterial color="#09111f" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Rear full-width LED strip */}
      <mesh position={[REAR + 0.005, GND + 0.22, 0]}>
        <boxGeometry args={[0.028, 0.024, TW + 0.01]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.5} />
      </mesh>
    </>
  )
}

/* ─── SUV body (Model X / Rivian R1S style) ──────────────────────────────── */
function SUVBody({ bodyMat, glassMat, TRIM_BLACK, isConnected }) {
  const { GND, TW, FRONT, REAR } = V.suv
  const BELT  = GND + 0.44
  const ROOF  = GND + 0.88   // tall boxy roof
  const CAB_F = 0.36         // short hood
  const CAB_R = -0.90        // greenhouse runs almost to tail
  const CAB_MX = (CAB_F + CAB_R) / 2
  return (
    <>
      {/* Chassis slab */}
      <mesh position={[0, GND + 0.13, 0]} castShadow>
        <boxGeometry args={[FRONT - REAR, 0.24, TW]} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>
      {/* Lower body sides */}
      <mesh position={[0, (GND + 0.26 + BELT) / 2, 0]} castShadow>
        <boxGeometry args={[FRONT - REAR, BELT - (GND + 0.26) + 0.01, TW - 0.04]} />
        <meshStandardMaterial {...bodyMat} />
      </mesh>
      {/* Short hood */}
      <mesh position={[(CAB_F + FRONT) / 2, BELT, 0]} castShadow>
        <RoundedBox args={[FRONT - CAB_F, 0.05, TW - 0.06]} radius={0.02} smoothness={3}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>
      {/* Tall boxy greenhouse */}
      <mesh position={[CAB_MX, (BELT + ROOF) / 2, 0]} castShadow>
        <RoundedBox args={[CAB_F - CAB_R - 0.02, ROOF - BELT, TW - 0.10]} radius={0.035} smoothness={4}>
          <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
        </RoundedBox>
      </mesh>
      {/* Flat roof */}
      <mesh position={[CAB_MX, ROOF, 0]} castShadow>
        <RoundedBox args={[CAB_F - CAB_R - 0.06, 0.05, TW - 0.06]} radius={0.025} smoothness={3}>
          <meshStandardMaterial {...bodyMat} />
        </RoundedBox>
      </mesh>
      {/* Roof rack rails */}
      {[TW / 2 - 0.09, -(TW / 2 - 0.09)].map((z, i) => (
        <mesh key={i} position={[CAB_MX, ROOF + 0.04, z]}>
          <boxGeometry args={[CAB_F - CAB_R - 0.16, 0.028, 0.04]} />
          <meshStandardMaterial color={TRIM_BLACK} metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {/* A-pillar — Z at greenhouse edge (TW-0.10)/2, depth bridges body→glass */}
      {[TW / 2 - 0.025, -(TW / 2 - 0.025)].map((z, i) => (
        <mesh key={i} position={[CAB_F - 0.02, BELT + (ROOF - BELT) * 0.5, z]} rotation={[0, 0, 0.22]}>
          <boxGeometry args={[0.05, ROOF - BELT + 0.04, 0.05]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>
      ))}
      {/* D-pillar (near-vertical rear) — same Z fix */}
      {[TW / 2 - 0.025, -(TW / 2 - 0.025)].map((z, i) => (
        <mesh key={i} position={[CAB_R + 0.03, BELT + (ROOF - BELT) * 0.5, z]}>
          <boxGeometry args={[0.06, ROOF - BELT, 0.05]} />
          <meshStandardMaterial {...bodyMat} />
        </mesh>
      ))}
      {/* Fender flares */}
      {[[ 0.65, TW/2+0.005], [ 0.65, -(TW/2+0.005)],
        [-0.70, TW/2+0.005], [-0.70, -(TW/2+0.005)]].map(([x, z], i) => (
        <mesh key={i} position={[x, GND + 0.15, z]}>
          <boxGeometry args={[0.23 * 2.3, 0.23 * 1.6, 0.07]} />
          <meshStandardMaterial color={TRIM_BLACK} metalness={0.3} roughness={0.7} />
        </mesh>
      ))}
      {/* Running boards */}
      {[TW / 2 + 0.03, -(TW / 2 + 0.03)].map((z, i) => (
        <mesh key={i} position={[-0.10, GND - 0.02, z]}>
          <boxGeometry args={[1.20, 0.04, 0.10]} />
          <meshStandardMaterial color={TRIM_BLACK} metalness={0.75} roughness={0.5} />
        </mesh>
      ))}
      {/* Front LED bar */}
      <mesh position={[FRONT - 0.005, GND + 0.38, 0]}>
        <boxGeometry args={[0.04, 0.032, TW + 0.02]} />
        <meshStandardMaterial color="#e0f2fe" emissive="#e0f2fe" emissiveIntensity={isConnected ? 0.5 : 3.0} />
      </mesh>
      {/* Headlight pods */}
      {[TW / 2 - 0.12, -(TW / 2 - 0.12)].map((z, i) => (
        <group key={i}>
          <mesh position={[FRONT - 0.04, GND + 0.30, z]}>
            <boxGeometry args={[0.06, 0.14, 0.22]} />
            <meshStandardMaterial color="#dff0ff" emissive="#dff0ff" emissiveIntensity={isConnected ? 0.3 : 1.8} />
          </mesh>
          {!isConnected && <pointLight position={[FRONT + 0.14, GND + 0.32, z * 1.5]} color="#fff8dc" intensity={0.9} distance={3.4} />}
        </group>
      ))}
      {/* Front lower skid plate */}
      <mesh position={[FRONT - 0.01, GND + 0.14, 0]}>
        <boxGeometry args={[0.035, 0.22, TW - 0.14]} />
        <meshStandardMaterial color="#374151" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* Rear LED bar */}
      <mesh position={[REAR + 0.005, GND + 0.35, 0]}>
        <boxGeometry args={[0.035, 0.03, TW + 0.01]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.2} />
      </mesh>
    </>
  )
}

/* ─── Cybertruck body (angular stainless-steel pickup) ───────────────────── */
function CybertruckBody({ bodyMat, glassMat, TRIM_BLACK, isConnected }) {
    const { GND, TW, FRONT, REAR } = V.cybertruck

    // ── Side-profile key points ──
    const SILL   = GND + 0.22
    const APEX_Y = GND + 0.92
    const APEX_X = FRONT - 0.95
    const NOSE_Y = GND + 0.30
    const TAIL_Y = GND + 0.46

    const bodyShape = useMemo(() => {
        const s = new THREE.Shape()
        s.moveTo(REAR,   SILL)
        s.lineTo(FRONT,  SILL)
        s.lineTo(FRONT,  NOSE_Y)
        s.lineTo(APEX_X, APEX_Y)   // front sweep
        s.lineTo(REAR,   TAIL_Y)   // rear slope
        s.closePath()
        return s
    }, [])

    const extrude = { depth: TW, bevelEnabled: true, bevelThickness: 0.02,
        bevelSize: 0.02, bevelSegments: 1 }

    // ── Front sweep geometry (apex → nose) ──
    const SW_DX  = FRONT - APEX_X                      // 0.95
    const SW_DY  = APEX_Y - NOSE_Y                     // 0.62
    const SW_LEN = Math.hypot(SW_DX, SW_DY)            // ≈1.13
    const SW_ANG = Math.atan2(SW_DX, SW_DY)            // rotation about Z
    // outward (forward-up) normal of the sweep face, normalised
    const nx = SW_DY / SW_LEN, ny = SW_DX / SW_LEN

    // Windshield = upper ~50% of the sweep, pushed 0.03 proud of the face
    const WS_LEN = SW_LEN * 0.50
    const dirx = SW_DX / SW_LEN, diry = -SW_DY / SW_LEN  // apex→nose unit
    const WS_CX = APEX_X + (WS_LEN / 2) * dirx + 0.03 * nx
    const WS_CY = APEX_Y + (WS_LEN / 2) * diry + 0.03 * ny

    // Side-glass band sits just outside the body sides
    const SG_X0 = -0.55, SG_X1 = 0.18
    const SG_Y0 = GND + 0.42, SG_Y1 = GND + 0.60

    return (
        <>
            {/* One-piece angular body */}
            <mesh position={[0, 0, -TW / 2]} castShadow receiveShadow>
                <extrudeGeometry args={[bodyShape, extrude]} />
                <meshStandardMaterial {...bodyMat} flatShading />
            </mesh>

            {/* Windshield — proud of the front sweep */}
            <mesh position={[WS_CX, WS_CY, 0]} rotation={[0, 0, SW_ANG]}>
                <boxGeometry args={[0.03, WS_LEN, TW - 0.16]} />
                <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
            </mesh>

            {/* Side windows — pushed OUTSIDE the body sides so they're visible */}
            {[TW / 2 + 0.006, -(TW / 2 + 0.006)].map((z, i) => (
                <mesh key={i} position={[(SG_X0 + SG_X1) / 2, (SG_Y0 + SG_Y1) / 2, z]}>
                    <boxGeometry args={[SG_X1 - SG_X0, SG_Y1 - SG_Y0, 0.02]} />
                    <meshStandardMaterial {...glassMat} side={THREE.DoubleSide} />
                </mesh>
            ))}

            {/* Black wheel-arch trims (sharp CT-style) */}
            {[[0.76, 1], [0.76, -1], [-0.84, 1], [-0.84, -1]].map(([x, s], i) => (
                <mesh key={i} position={[x, GND + 0.02, s * (TW / 2 + 0.004)]}>
                    <boxGeometry args={[0.62, 0.30, 0.05]} />
                    <meshStandardMaterial color={TRIM_BLACK} metalness={0.2} roughness={0.8} />
                </mesh>
            ))}

            {/* Front full-width LED bar */}
            <mesh position={[FRONT - 0.005, GND + 0.28, 0]}>
                <boxGeometry args={[0.03, 0.028, TW + 0.02]} />
                <meshStandardMaterial color="#e8f8ff" emissive="#e8f8ff"
                                      emissiveIntensity={isConnected ? 0.5 : 3.2} />
            </mesh>
            {[TW / 2 - 0.16, -(TW / 2 - 0.16)].map((z, i) => (
                <group key={i}>
                    <mesh position={[FRONT - 0.02, GND + 0.28, z]}>
                        <boxGeometry args={[0.035, 0.036, 0.38]} />
                        <meshStandardMaterial color="#ffffff" emissive="#ffffff"
                                              emissiveIntensity={isConnected ? 0.4 : 2.8} />
                    </mesh>
                    {!isConnected && <pointLight position={[FRONT + 0.15, GND + 0.30, z * 1.5]}
                                                 color="#ffffff" intensity={1.0} distance={3.5} />}
                </group>
            ))}

            {/* Rear full-width LED strip */}
            <mesh position={[REAR + 0.005, TAIL_Y - 0.04, 0]}>
                <boxGeometry args={[0.03, 0.028, TW + 0.01]} />
                <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.4} />
            </mesh>
        </>
    )
}


/* ═══════════════════════════════════════════════════════════════════════════
   CAR — movement + wheels + charge port + body dispatch
═══════════════════════════════════════════════════════════════════════════ */
export default function Car({ mode, phase, state, carXRef, variant, onNewCar, onArrived, onExited, onParked }) {
  const groupRef     = useRef()
  const wheelRefs    = useRef([])
  const velRef       = useRef(0)
  const uRef         = useRef(0)
  const uVelRef      = useRef(0)
  const posRef       = useRef(new THREE.Vector3(-7, 0, 0))
  const headRef      = useRef(0)
  const steerRef     = useRef(0)
  const bobRef       = useRef(0)
  const phaseRef     = useRef(null)
  const doneRef      = useRef(false)
  const stopTimerRef = useRef(0)
  const panelParkRef = useRef(false)

  const type = variant?.type ?? 'truck'
  const cfg  = V[type] ?? V.truck
  const { WR, TW, GND } = cfg

  const isCharging  = state === 'Charging'
  const isConnected = state === 'Occupied' || isCharging

  // ── Movement ───────────────────────────────────────────────────────────────
  useFrame((_, dt) => {
    if (!groupRef.current) return
    const g = groupRef.current
    let px, pz, heading, speed = 0

    if (mode === 'intro') {
      if (phase !== phaseRef.current) {
        if (phase === 'arriving') {
          uRef.current = 0; uVelRef.current = 0; doneRef.current = false; stopTimerRef.current = 0
          if (onNewCar) onNewCar()
        } else if (phase === 'leaving') {
          uRef.current = 0; uVelRef.current = 0; doneRef.current = false
        }
        phaseRef.current = phase
      }
      let curve, len
      if (phase === 'arriving') {
        curve = ENTRY_CURVE; len = ENTRY_LEN
        uRef.current = smoothDamp(uRef.current, 1, uVelRef, 0.6, dt, 0.34)
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
        if (!doneRef.current && uRef.current > 0.97) {
          doneRef.current = true
          if (onExited) onExited()
        }
      } else {
        curve = ENTRY_CURVE; len = ENTRY_LEN
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
      const parked = connected && Math.abs(px - (-1.8)) < 0.06
      if (onParked && parked !== panelParkRef.current) {
        panelParkRef.current = parked
        onParked(parked)
      }
    }

    const prevHead = headRef.current
    headRef.current = lerpAngle(prevHead, heading, 1 - Math.exp(-dt * 9))
    const angVel = (headRef.current - prevHead) / Math.max(dt, 0.001)

    g.position.x = px
    g.position.z = pz
    g.rotation.y = headRef.current

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

    const dTheta = (speed * dt) / WR
    const targetSteer = THREE.MathUtils.clamp(angVel * 0.20, -0.5, 0.5)
    steerRef.current = THREE.MathUtils.lerp(steerRef.current, targetSteer, dt * 8)
    wheelRefs.current.forEach((r, i) => {
      if (!r) return
      r.rotation.z -= dTheta
      r.rotation.y = i < 2 ? steerRef.current : 0
    })
  })

  // ── Wheel positions ────────────────────────────────────────────────────────
  const WHEEL_POSITIONS = [
    [ cfg.WFX, WR,  TW / 2 + 0.03], [ cfg.WFX, WR, -(TW / 2 + 0.03)],
    [ cfg.WRX, WR,  TW / 2 + 0.03], [ cfg.WRX, WR, -(TW / 2 + 0.03)],
  ]

  // ── Materials ──────────────────────────────────────────────────────────────
  const BODY_COLOR = variant?.body ?? '#2f6fc4'
  const TRIM_BLACK = '#0b1220'
  const isCybertruck = type === 'cybertruck'
  const bodyMat = isCybertruck
    ? { color: BODY_COLOR, metalness: 0.96, roughness: 0.10, envMapIntensity: 2.2 }
    : { color: BODY_COLOR, metalness: 0.70, roughness: 0.22, envMapIntensity: 1.3 }
  const glassMat = { color: '#0e1c2b', transparent: true, opacity: 0.55, metalness: 0.2, roughness: 0.05 }

  const BodyComponent = { truck: TruckBody, sedan: SedanBody, suv: SUVBody, cybertruck: CybertruckBody }[type] ?? TruckBody

  return (
    <group ref={groupRef}>

      {/* ── Vehicle body ────────────────────────────────────────────────── */}
      <BodyComponent bodyMat={bodyMat} glassMat={glassMat} TRIM_BLACK={TRIM_BLACK} isConnected={isConnected} isCharging={isCharging} />

      {/* ── Wheels (5-spoke alloy) ───────────────────────────────────────── */}
      {WHEEL_POSITIONS.map((p, i) => {
        const outer = p[2] > 0 ? 1 : -1
        const faceZ = outer * 0.105
        return (
          <group key={i} position={p}>
            <group ref={el => (wheelRefs.current[i] = el)}>
              {/* Tyre */}
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[WR, WR, 0.20, 28]} />
                <meshStandardMaterial color={isCybertruck ? '#1a1a1a' : '#111827'} roughness={0.9} metalness={0.05} />
              </mesh>
              {/* Tread blocks */}
              {Array.from({ length: 16 }).map((_, j) => {
                const a = (j / 16) * Math.PI * 2
                return (
                  <mesh key={j} position={[Math.cos(a) * WR * 0.99, Math.sin(a) * WR * 0.99, 0]} rotation={[0, 0, a]}>
                    <boxGeometry args={[0.045, 0.05, 0.205]} />
                    <meshStandardMaterial color="#1f2937" roughness={1} />
                  </mesh>
                )
              })}
              {/* Alloy face */}
              <group position={[0, 0, faceZ]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[WR - 0.03, WR - 0.03, 0.02, 28]} />
                  <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.35} />
                </mesh>
                {[0, 1, 2, 3, 4].map(j => (
                  <mesh key={j} rotation={[0, 0, (j / 5) * Math.PI * 2]} position={[0, 0, 0.005 * outer]}>
                    <boxGeometry args={[WR * 1.3, 0.045, 0.03]} />
                    <meshStandardMaterial color={isCybertruck ? '#e2e8f0' : '#cbd5e1'} metalness={0.96} roughness={0.06} />
                  </mesh>
                ))}
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.012 * outer]}>
                  <cylinderGeometry args={[0.06, 0.06, 0.02, 12]} />
                  <meshStandardMaterial color="#94a3b8" metalness={0.98} roughness={0.04} />
                </mesh>
              </group>
            </group>
          </group>
        )
      })}

      {/* ── Charge port — fixed at PORT_LOCAL position for all types ────── */}
      <mesh position={[1.0, 0.48, TW / 2 + 0.01]}>
        <boxGeometry args={[0.12, 0.10, 0.04]} />
        <meshStandardMaterial
          color="#1e293b"
          emissive={isCharging ? '#38bdf8' : isConnected ? '#94a3b8' : '#111'}
          emissiveIntensity={isCharging ? 2.5 : 0.22}
        />
      </mesh>
      {isCharging && <pointLight position={[1.0, 0.58, TW / 2 + 0.28]} color="#38bdf8" intensity={2} distance={1.5} />}
    </group>
  )
}
