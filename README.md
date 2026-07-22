# EV Charging Display

A cinematic, interactive 3D landing page showcasing electric vehicles at a charging station. Built with React, Three.js, and React Three Fiber.

![EV Charging Display](public/favicon.svg)

## Features

- **3D Vehicle Scene** — Procedurally generated EV models (Sedan, SUV, Truck, Cybertruck) cycle through the charging station with smooth animations
- **Dynamic Lighting** — Warm daylight with a distant sun, hemisphere sky light, and ambient glow from the charging pad
- **City Skyline Backdrop** — Randomised building silhouettes with lit windows
- **Interactive Config Panel** — Live camera controls accessible via a collapsible panel in the bottom-right corner
- **Persistent Settings** — Camera config is saved to `localStorage` and restored on page reload

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
npm run preview   # preview the production build locally
```

## Camera Controls (Config Panel)

Open the **Config** panel (bottom-right corner) to control the camera live:

| Control | Description |
|---|---|
| **← Orbit →** slider | Rotate the camera left or right around the scene |
| **Elevation** slider | Raise or lower the camera |
| **Distance** slider | Zoom in or out |
| **FOV** slider | Adjust field of view |
| **◀ / ▶** buttons | Strafe (translate) the camera left or right |
| **▲ / ▼** buttons | Raise or lower elevation in steps |
| **⊙** button | Release override — resume auto camera drift |
| **↺ Auto** button | Same as ⊙ — appears when override is active |
| **⟳ reset** | Reset all camera settings to defaults and clear saved config |
| **▾ / ▸** | Collapse or expand the panel |

Settings are saved automatically to `localStorage` (`ev-cam-config`) and restored on next load.

## Project Structure

```
src/
├── components/
│   ├── EVScene.jsx   # Main 3D scene — camera, lighting, environment, config panel
│   └── Car.jsx       # Vehicle components (Truck, Sedan, SUV, Cybertruck) + variants
├── pages/
│   └── LandingPage.jsx
├── App.jsx
└── main.jsx
```

## Tech Stack

- [React 18](https://react.dev/)
- [Three.js](https://threejs.org/)
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- [@react-three/drei](https://github.com/pmndrs/drei)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)

## Adding / Changing Vehicles

Edit `CAR_VARIANTS` in `src/components/Car.jsx`. Each entry picks a vehicle type and colour:

```js
const CAR_VARIANTS = [
  { type: 'cybertruck', body: '#c0c0c0', trim: '#888888' },
  { type: 'sedan',      body: '#1a1a2e', trim: '#e94560' },
  // ...
]
```

Available types: `truck` · `sedan` · `suv` · `cybertruck`

## License

MIT
