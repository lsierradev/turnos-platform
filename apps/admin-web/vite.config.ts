import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React, router y TanStack Query en su propio archivo: cambian mucho
        // menos que la app, asi que el navegador los reusa entre despliegues.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@tanstack)[\\/]/.test(id)) {
            return 'vendor'
          }
        },
      },
    },
  },
})
