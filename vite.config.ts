import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Plugin to add COOP/COEP headers for SharedArrayBuffer support (@jsquash/avif multithreading)
// These headers must be on ALL pages because SPA client-side routing doesn't trigger new document requests
function crossOriginIsolationPlugin(): Plugin {
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Apply COOP/COEP to all responses to support client-side navigation to editor pages
        // Use 'credentialless' instead of 'require-corp' to allow loading external images
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [crossOriginIsolationPlugin(), react(), tailwindcss()],
  server: {
    host: true,
    // Apply CORP header to ALL responses so resources can be loaded by COEP-enabled pages
    headers: {
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@jsquash/avif'],
  },
  worker: {
    format: 'es',
  },
})
