import { useEffect, useRef, useState } from 'react'
import EVScene from '../components/EVScene'

const REPO_URL = 'https://github.com/ford-innersource/fccs-wig2026-hackathon'

export default function LandingPage() {
  const [leaving, setLeaving] = useState(false)
  const [fading,  setFading]  = useState(false)
  const [showFeatures, setShowFeatures] = useState(false)
  const leavingRef  = useRef(false)
  const touchStartY = useRef(null)
  const featuresRef = useRef(null)

  function launch() {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    setTimeout(() => setFading(true), 800)
    setTimeout(() => {
      setShowFeatures(true)
      featuresRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 800 + 700)
  }

  useEffect(() => {
    if (!showFeatures) {
      const onWheel = e => { if (e.deltaY > 12) launch() }
      const onKey   = e => { if (['ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) launch() }
      window.addEventListener('wheel',   onWheel, { passive: true })
      window.addEventListener('keydown', onKey)
      return () => {
        window.removeEventListener('wheel',   onWheel)
        window.removeEventListener('keydown', onKey)
      }
    }
  }, [showFeatures]) // eslint-disable-line react-hooks/exhaustive-deps

  function onTouchStart(e) { touchStartY.current = e.touches[0]?.clientY ?? null }
  function onTouchEnd(e) {
    if (touchStartY.current == null) return
    const endY = e.changedTouches[0]?.clientY ?? touchStartY.current
    if (touchStartY.current - endY > 40) launch()
    touchStartY.current = null
  }

  return (
    <div style={{ background: '#080f1a', minHeight: '100vh' }}>

      {/* ── Hero (full-screen 3D) ─────────────────────────────────── */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`relative w-screen h-screen overflow-hidden transition-all duration-700 ease-in-out
                    ${fading ? 'opacity-0 scale-105' : 'opacity-100 scale-100'}`}
      >
        <EVScene mode="intro" zoomOut={leaving} className="absolute inset-0 w-full h-full" />

        <div className="absolute inset-0 flex flex-col items-center justify-between pointer-events-none"
             style={{ background: 'linear-gradient(to bottom, rgba(8,15,26,0.55) 0%, transparent 35%, transparent 65%, rgba(8,15,26,0.75) 100%)' }}>

          {/* Top — hero title */}
          <div className="text-center pt-6 px-4 flex flex-col items-center">
            <div className="mb-5 inline-flex items-center gap-3 px-7 py-3 rounded-full
                            bg-white/10 backdrop-blur-md ring-1 ring-white/15 shadow-lg">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-lg sm:text-xl font-semibold tracking-[0.2em] text-emerald-200 uppercase">
                OCPP 2.0.1 EVSE Simulator
              </span>
            </div>
          </div>

          {/* Bottom — scroll affordance */}
          <button
            onClick={launch}
            className="pb-12 flex flex-col items-center gap-2 pointer-events-auto group focus:outline-none"
            aria-label="Scroll to learn more"
          >
            <span className="text-gray-300 text-sm font-medium tracking-wide group-hover:text-white transition-colors">
              Scroll to learn more
            </span>
            <span className="flex flex-col items-center -space-y-2 text-blue-400 group-hover:text-blue-300">
              <i className="fa-solid fa-chevron-down text-xl animate-bounce" />
              <i className="fa-solid fa-chevron-down text-xl animate-bounce" style={{ animationDelay: '0.15s', opacity: 0.5 }} />
            </span>
          </button>
        </div>
      </div>

      {/* ── Features / Info section ───────────────────────────────── */}
      <div
        ref={featuresRef}
        className={`transition-opacity duration-700 ${showFeatures ? 'opacity-100' : 'opacity-0'}`}
        style={{ pointerEvents: showFeatures ? 'auto' : 'none' }}
      >
        <section className="max-w-5xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
            WIG 2026 Hackathon Project
          </h2>
          <p className="text-gray-400 text-base sm:text-lg max-w-2xl mx-auto mb-12 leading-relaxed">
            A full-stack OCPP 2.0.1 Electric Vehicle Supply Equipment simulator built for the
            Ford WIG 2026 Hackathon. Test, visualise, and control EV charging stations without
            physical hardware.
          </p>

          {/* Feature cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-left mb-16">
            {[
              {
                icon: 'fa-bolt',
                color: 'text-yellow-400',
                title: 'OCPP 2.0.1 Compliant',
                desc: 'Full support for BootNotification, Authorize, Transaction events, MeterValues, and remote CSMS commands.',
              },
              {
                icon: 'fa-cube',
                color: 'text-blue-400',
                title: '3D Live Visualisation',
                desc: 'Real-time Three.js scene showing the EV charger state — idle, charging, faulted — with animated power flow.',
              },
              {
                icon: 'fa-robot',
                color: 'text-emerald-400',
                title: 'Autonomous Mode',
                desc: 'Drive the simulator hands-free through a configurable EV charge cycle with randomised meter values.',
              },
              {
                icon: 'fa-terminal',
                color: 'text-purple-400',
                title: 'Live Message Log',
                desc: 'Inspect every OCPP message sent and received in real time with colour-coded direction and type labels.',
              },
              {
                icon: 'fa-sliders',
                color: 'text-pink-400',
                title: 'Manual Controls',
                desc: 'Trigger individual OCPP actions — plug/unplug, start/stop transaction, send heartbeat — with a single click.',
              },
              {
                icon: 'fa-cloud',
                color: 'text-sky-400',
                title: 'Cloud Ready',
                desc: 'Dockerised backend deployable to Google Cloud Run with optional IAP authentication and CSMS integration.',
              },
            ].map(({ icon, color, title, desc }) => (
              <div key={title}
                   className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-colors">
                <i className={`fa-solid ${icon} ${color} text-2xl mb-3`} />
                <h3 className="text-white font-semibold mb-2">{title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-3 rounded-full
                       bg-blue-600 hover:bg-blue-500 text-white font-semibold
                       transition-colors shadow-lg shadow-blue-900/40 text-base"
          >
            <i className="fa-brands fa-github text-lg" />
            View on GitHub
          </a>
        </section>

        <footer className="text-center py-8 text-gray-600 text-xs">
          Ford WIG 2026 Hackathon · OCPP 2.0.1 EVSE Simulator
        </footer>
      </div>

    </div>
  )
}
