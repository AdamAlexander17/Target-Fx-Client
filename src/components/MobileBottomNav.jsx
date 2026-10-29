import { useNavigate, useLocation } from 'react-router-dom'
import { AskAiIcon } from './ReportIcons'

// Shared mobile bottom navigation bar (Clients, Positions, Ask AI, Margin Level, More).
// Ask AI sits in the middle: its logo rests in an upward curve of the bar's border; "More" opens the module's sidebar.
const MobileBottomNav = ({ onMore }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const items = [
    { label: 'Clients', path: '/client2', icon: 'Clients' },
    { label: 'Positions', path: '/positions', icon: 'Positions' },
    { label: 'Ask AI', path: '/ai', ai: true },
    { label: 'Margin Level', path: '/margin-level', icon: 'Margin-Level' },
    { label: 'More', path: null },
  ]
  return (
    <nav aria-label="Mobile navigation" className="flex-shrink-0 pt-2 bg-transparent">
      {/* Ask AI lives in this bar on phones, so hide the floating button there; on wider screens keep it above the bar */}
      <style>{'@media (max-width: 639px) { .ask-ai-fab { display: none !important; } } @media (min-width: 640px) and (max-width: 1023px) { .ask-ai-fab { bottom: calc(72px + var(--app-safe-bottom, 0px)) !important; background: #FFFFFF !important; border-color: #D5DEEA !important; } .ask-ai-fab > span > span:last-child { background: #FFFFFF !important; } }'}</style>
      <div className="flex items-stretch justify-between gap-0.5 bg-white rounded-t-2xl border-t border-[#BFCADB] shadow-[0_-4px_16px_rgba(15,23,42,0.08)] px-2 pt-1" style={{ paddingBottom: 'calc(8px + var(--app-safe-bottom, 0px))' }}>
        {items.map((item) => {
          const active = item.ai ? location.pathname.startsWith('/ai') : item.path === location.pathname
          if (item.ai) {
            return (
              <button
                key={item.label}
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label="Ask AI"
                onClick={() => navigate('/ai', { state: { newChat: Date.now() } })}
                className="relative flex-1 min-w-0 h-11 flex flex-col items-center justify-end pb-[3px] focus-visible:outline-none"
              >
                {/* The bar's own top border rises in a smooth curve around the logo. The curve's ends are flat,
                    so they join the bar's border line; the white fill hides the straight border underneath. */}
                <svg aria-hidden="true" className="pointer-events-none absolute left-1/2 -top-[27px] -translate-x-1/2 overflow-visible" width="88" height="27" viewBox="0 0 88 27">
                  <path d="M0 27 L0 22.5 C18 22.5 20 1 44 1 C68 1 70 22.5 88 22.5 L88 27 Z" fill="#FFFFFF" />
                  <path d="M0 22.5 C18 22.5 20 1 44 1 C68 1 70 22.5 88 22.5" fill="none" stroke="#BFCADB" strokeWidth="1" />
                </svg>
                {/* Same logo as the floating Ask AI button: gradient ring, white centre, colour icon */}
                <span className="absolute left-1/2 -top-[17px] -translate-x-1/2 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 p-[2px] shadow-[0_4px_12px_rgba(37,99,235,0.35)] transition-transform active:scale-95">
                  <span className="ask-ai-fab-halo pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" />
                  <span className="relative flex h-full w-full items-center justify-center rounded-full bg-white">
                    <AskAiIcon className="h-[21px] w-[21px]" />
                  </span>
                </span>
                <span className="text-[10px] leading-3 whitespace-nowrap font-semibold text-[#2563EB]">Ask AI</span>
              </button>
            )
          }
          return (
            <button
              key={item.label}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => (item.path ? navigate(item.path) : onMore && onMore())}
              className={`flex-1 min-w-0 h-11 rounded-xl flex flex-col items-center justify-center gap-[2px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                active ? 'bg-[#2563EB] text-white shadow-[0_2px_6px_rgba(37,99,235,0.2)]' : 'text-[#64748B] active:bg-[#F1F5F9]'
              }`}
            >
              {item.path ? (
                <img
                  src={`${import.meta.env.BASE_URL || '/'}sidebar-icons/${item.icon}.svg`}
                  alt=""
                  className="w-4 h-4 shrink-0"
                  style={{ filter: active ? 'brightness(0) invert(1)' : 'brightness(0) opacity(0.55)' }}
                />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/>
                  <circle cx="8" cy="12" r="1.2" fill="currentColor"/>
                  <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
                  <circle cx="16" cy="12" r="1.2" fill="currentColor"/>
                </svg>
              )}
              <span className={`text-[10px] leading-3 whitespace-nowrap max-w-full ${active ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default MobileBottomNav
