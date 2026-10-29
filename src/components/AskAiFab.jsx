import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AskAiIcon } from './ReportIcons'

const POSITION_KEY = 'askAiFabPosition'
const DRAG_THRESHOLD = 6 // px of movement before a press counts as a drag rather than a click
const EDGE = 8 // keep this far from the window edges

const loadPosition = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null')
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null
  } catch { return null }
}

// Global floating "Ask AI" button. Sits bottom-right on every authenticated page
// except the Ask AI page itself. Clicking it always opens a FRESH chat session
// (state.newChat), matching the sidebar's "Ask AI" behaviour. Compact pill on both
// tablet and desktop; phones use the Ask AI button in the bottom nav instead.
// z-40 keeps it above page content but below modals (z-50+).
// It can be dragged anywhere on screen; the position is remembered in this browser.
export default function AskAiFab() {
  const location = useLocation()
  const navigate = useNavigate()
  const buttonRef = useRef(null)
  const drag = useRef(null)
  const justDragged = useRef(false) // the click that follows a drag must not open the chat
  const [position, setPosition] = useState(loadPosition) // { x, y } = left/top in px, or null for the default corner
  const [dragging, setDragging] = useState(false)

  const clamp = (x, y) => {
    const rect = buttonRef.current?.getBoundingClientRect()
    const width = rect?.width || 120
    const height = rect?.height || 48
    return {
      x: Math.min(Math.max(EDGE, x), window.innerWidth - width - EDGE),
      y: Math.min(Math.max(EDGE, y), window.innerHeight - height - EDGE),
    }
  }

  // A dragged position overrides the corner placement (including the mobile nav's !important lift)
  useEffect(() => {
    const node = buttonRef.current
    if (!node) return
    const props = position
      ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' }
      : { left: '', top: '', right: '', bottom: '' }
    Object.entries(props).forEach(([key, value]) => {
      if (value) node.style.setProperty(key, value, 'important')
      else node.style.removeProperty(key)
    })
  }, [position, location.pathname])

  // Keep it on screen when the window size changes
  useEffect(() => {
    if (!position) return undefined
    const onResize = () => setPosition(current => current && clamp(current.x, current.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [position])

  if (location.pathname.startsWith('/ai')) return null

  const onPointerDown = event => {
    if (event.button !== undefined && event.button !== 0) return
    const rect = buttonRef.current.getBoundingClientRect()
    drag.current = { startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, moved: false }
    buttonRef.current.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = event => {
    const state = drag.current
    if (!state) return
    if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < DRAG_THRESHOLD) return
    state.moved = true
    setDragging(true)
    setPosition(clamp(event.clientX - state.offsetX, event.clientY - state.offsetY))
  }
  const onPointerUp = event => {
    const state = drag.current
    drag.current = null
    buttonRef.current?.releasePointerCapture?.(event.pointerId)
    if (state?.moved) {
      justDragged.current = true
      setDragging(false)
      setPosition(current => {
        try { if (current) localStorage.setItem(POSITION_KEY, JSON.stringify(current)) } catch { /* storage unavailable */ }
        return current
      })
    }
  }
  const onClick = () => {
    // A drag ends with a click event too; only a real press opens the chat
    if (justDragged.current) { justDragged.current = false; return }
    navigate('/ai', { state: { newChat: Date.now() } })
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; setDragging(false) }}
      onClick={onClick}
      aria-label="Ask AI"
      title="Ask BrokerEye AI · drag to move"
      className={`ask-ai-fab group fixed bottom-6 right-0 z-40 flex max-sm:!hidden touch-none select-none items-center gap-1.5 rounded-full border-2 border-slate-200/70 bg-white py-1 pl-1 pr-3.5 shadow-[-6px_8px_22px_-8px_rgba(37,99,235,0.45)] backdrop-blur hover:border-blue-500 active:translate-y-0 md:bottom-6 md:right-5 md:shadow-[0_8px_24px_-6px_rgba(37,99,235,0.40)] ${dragging ? 'cursor-grabbing scale-105 shadow-[0_14px_32px_-8px_rgba(37,99,235,0.55)]' : 'cursor-grab transition-[border-color,box-shadow,transform] duration-200'} ${position ? 'md:shadow-[0_8px_24px_-6px_rgba(37,99,235,0.40)] shadow-[0_8px_24px_-6px_rgba(37,99,235,0.40)]' : ''}`}
      style={{ marginBottom: position ? 0 : 'env(safe-area-inset-bottom)' }}
    >
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 p-[2px] transition-colors duration-200 group-hover:bg-none group-hover:bg-white">
        <span className="ask-ai-fab-halo pointer-events-none absolute inset-0 rounded-full group-hover:animate-none group-hover:shadow-none" aria-hidden="true" />
        <span className="flex h-full w-full items-center justify-center rounded-full bg-white">
          <AskAiIcon className="h-[23px] w-[23px]" />
        </span>
      </span>
      <span className="text-[13px] font-bold tracking-tight text-slate-900">Ask AI</span>
    </button>
  )
}
