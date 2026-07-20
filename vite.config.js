import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path matches the GitHub repository name for Pages deployment.
// When deploying to a custom domain, change base to '/'
export default defineConfig({
  base: '/fccs-wig2026-hackathon/',
  plugins: [react()],
})
