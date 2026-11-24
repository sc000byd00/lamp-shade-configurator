/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  // Lithophane meshes have about a million triangles; give slow or busy machines room.
  test: { testTimeout: 60000 },
})
