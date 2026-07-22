import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path for deployment. Change to '/' for custom domain.
export default defineConfig({
  base: '/',
  plugins: [react()],
})
