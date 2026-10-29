import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Every build gets its own id. It is compiled into the app and written to /version.json, so a
// running app can tell when it is older than what is deployed (see ensureLatestBuild in main.jsx).
const BUILD_ID = String(Date.now())
const versionFile = () => ({
  name: 'app-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
  }
})

// https://vite.dev/config/
export default defineConfig({
  // Set base path for htdocs root deployment
  base: '/',
  define: {
    'import.meta.env.VITE_APP_BUILD': JSON.stringify(BUILD_ID)
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  plugins: [
    react(),
    versionFile(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered manually in main.jsx via virtual:pwa-register, so a new deploy reloads the
      // page itself instead of leaving a stale cached index.html/JS bundle until a manual refresh.
      injectRegister: false,
      devOptions: {
        enabled: false // Disable PWA in development
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // index.html is deliberately NOT precached: a precached shell keeps serving the previous
        // build's HTML (and therefore its JS) after a deploy until the user hard-refreshes. Hashed
        // JS/CSS are safe to precache because every build gets new filenames.
        globPatterns: ['**/*.{js,css,ico,png,svg}'],
        navigateFallback: null, // Prevent service worker from intercepting navigation
        manifestTransforms: [
          async (entries) => {
            // Filter out assets whose filenames contain spaces or '%'. These
            // produce malformed precache URLs (e.g. a bare '%' not followed by
            // two hex digits) that the server rejects with 400, which aborts
            // the whole service-worker install (bad-precaching-response).
            const filtered = entries.filter((e) => {
              const url = e.url || ''
              if (/%| /.test(url)) return false
              return true
            })
            return { manifest: filtered }
          }
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.brokereye\.app\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300 // 5 minutes
              }
            }
          }
        ]
      },
      manifest: process.env.NODE_ENV === 'production' ? {
        name: 'Broker Eye',
        short_name: 'BrokerEye',
        description: 'Professional trading platform with advanced authentication',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        // Use relative scope/start_url so builds work under subpaths (e.g., /amari-capital or /broker)
        scope: '.',
        start_url: '.',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      } : false
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 3001,
    proxy: {
      '/ai': {
        target: 'http://57.129.87.192:8090',
        changeOrigin: true,
        secure: false,
        // '/ai' is both the React Router page route and the API prefix (/ai/me, /ai/conversations,
        // ...). A direct page load of /ai sends Accept: text/html — bypass the proxy for that so
        // Vite serves the SPA instead of forwarding the page request itself to the AI backend,
        // which has no route literally called "/ai" and would 404.
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html'
        },
      },
      '/health': {
        target: 'http://57.129.87.192:8090',
        changeOrigin: true,
        secure: false,
      },
      // IB endpoints use the same API domain as other broker endpoints
      '/api/amari/ib': {
        target: 'https://api.brokereye.app',
        changeOrigin: true,
        secure: false,
        ws: false,
        rewrite: (path) => path,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('IB Proxy error:', err)
          })
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('IB Proxying request:', req.method, req.url)
          })
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('IB Proxy response:', proxyRes.statusCode, req.url)
          })
        }
      },
      '/api': {
        target: 'https://api.brokereye.app',
        changeOrigin: true,
        secure: false, // Disable SSL verification for development (avoid certificate issues)
        ws: true, // Enable WebSocket proxying
        rewrite: (path) => path,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('Proxy error:', err)
          })
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Proxying request:', req.method, req.url)
          })
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('Proxy response:', proxyRes.statusCode, req.url)
          })
        }
      }
    }
  }
})
