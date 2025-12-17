import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Plugin to add COOP/COEP headers for editor pages (enables SharedArrayBuffer for @jsquash/avif multithreading)
function crossOriginIsolationPlugin(): Plugin {
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      // Add middleware for page-specific headers
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        // Editor pages need COOP/COEP for SharedArrayBuffer
        if (url === '/new' || url.startsWith('/edit/')) {
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        }
        // Worker files need COEP too since they create their own execution context
        if (url.includes('.worker.js') || url.includes('worker_file')) {
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        }
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
