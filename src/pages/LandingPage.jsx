import EVScene from '../components/EVScene'

export default function LandingPage() {
  return (
    <div style={{ background: '#080f1a', minHeight: '100vh' }}>

      {/* ── Hero (full-screen 3D) ─────────────────────────────────── */}
      <div className="relative w-screen h-screen overflow-hidden">
        <EVScene mode="intro" className="absolute inset-0 w-full h-full" />

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
             style={{ background: 'linear-gradient(to bottom, rgba(8,15,26,0.55) 0%, transparent 35%, transparent 65%, rgba(8,15,26,0.75) 100%)' }}>
        </div>
      </div>

    </div>
  )
}
