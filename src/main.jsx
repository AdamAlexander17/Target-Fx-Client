import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initializeAppViewport } from './utils/appViewport'

const cleanupViewport = initializeAppViewport()
if (import.meta.hot) import.meta.hot.dispose(cleanupViewport)

// Recover from stale cached chunks after app updates (common on mobile reopen).
const CHUNK_RELOAD_KEY = 'chunk-reload-once'
const maybeRecoverFromChunkError = (errLike) => {
  const message = String(errLike?.message || errLike?.reason?.message || errLike || '')
  const isChunkLoadError =
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message)

  if (!isChunkLoadError) return

  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  } catch {
    // If storage fails, still attempt a single reload path.
  }

  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => maybeRecoverFromChunkError(event?.error || event?.message))
  window.addEventListener('unhandledrejection', (event) => maybeRecoverFromChunkError(event?.reason))
}

// Unregister any existing service workers in development
if (import.meta.env.DEV) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let registration of registrations) {
        registration.unregister()
        console.log('Service Worker unregistered:', registration.scope)
      }
    })
  }
} else {
  // Root-cause guard for "new modules missing until a hard refresh": compare this app's build id with
  // the deployed /version.json (never cached). If the server has a newer build, the page is running
  // old code (typically from a service worker installed by an earlier deploy), so drop every service
  // worker and cache and reload once. Independent of the service-worker update flow below.
  const ensureLatestBuild = async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL || '/'}version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) return
      const { build } = await response.json()
      if (!build || build === import.meta.env.VITE_APP_BUILD) return
      const reloadKey = `build-reload:${build}`
      if (sessionStorage.getItem(reloadKey)) return // already tried for this build; avoid a loop
      sessionStorage.setItem(reloadKey, '1')
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map(registration => registration.unregister()))
      }
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys()
        await Promise.all(keys.map(key => caches.delete(key)))
      }
      window.location.reload()
    } catch { /* offline or storage blocked: keep running */ }
  }
  ensureLatestBuild()
  setInterval(ensureLatestBuild, 5 * 60 * 1000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureLatestBuild()
  })

  // A new deploy ships a new sw.js with a different precache manifest (new JS/CSS hashes). Without
  // this, a returning visitor's browser keeps the OLD service worker controlling the page — so a
  // fresh navigation can get served a stale index.html that points at JS/CSS files which no longer
  // exist on the server (404s, or the app never mounts) until they happen to hard-refresh. This
  // registers the new worker, tells it to activate immediately (skipWaiting, already set workbox-
  // side) and reloads once it actually takes control, so the stale version is never left on screen.
  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() { updateSW(true) },
      // Browsers only re-check sw.js on navigation, so a tab or installed app that stays open (or is
      // reopened from the background) would never notice a deploy. Check again periodically and
      // whenever the app comes back to the foreground.
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return
        const checkForUpdate = () => { registration.update().catch(() => {}) }
        setInterval(checkForUpdate, 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate()
        })
      }
    })
    // The workbox config uses skipWaiting + clientsClaim, so a new worker activates WITHOUT a
    // "waiting" state — meaning onNeedRefresh may never fire and the first page after a deploy
    // stays stale until a manual refresh. Reload the moment the new worker takes control. We only
    // reload when a worker was ALREADY controlling the page (i.e. this is an update, not the very
    // first install), and guard against reload loops.
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller
      let reloaded = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || !hadController) return
        reloaded = true
        window.location.reload()
      })
    }
  }).catch(() => { /* PWA plugin not active (e.g. this build has it disabled) */ })
}

createRoot(document.getElementById('root')).render(
  <App />
)
