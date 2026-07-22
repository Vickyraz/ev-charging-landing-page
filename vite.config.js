import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path for GitHub Pages deployment (/<repo-name>/).
// Change to '/' if using a custom domain.
export default defineConfig({
  base: '/ev-charging-landing-page/',
  plugins: [react()],
})
