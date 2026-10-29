import { useEffect, useId, useState } from 'react'

// Styled replacement for a native <select> on mobile. Native option lists are drawn by the OS and
// can't be themed, and a dropdown under the button gets clipped inside scrolling sheets — so the
// options open as a small bottom sheet instead. Same contract as a select: value + onChange(value).
export default function MobileSelect({ value, onChange, options, title, placeholder = 'Select', disabled = false, className = '', ariaLabel, buttonLabel, iconOnly = false }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const selected = options.find(option => String(option.value) === String(value))

  useEffect(() => {
    if (!open) return
    const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  return <>
    <button
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen(true)}
      className={`flex h-10 min-w-0 items-center gap-1.5 rounded-xl border border-[#D5DEEA] bg-transparent px-3 text-left text-[13px] font-medium text-[#1F2937] disabled:opacity-50 ${className}`}
    >
      {/* iconOnly: caller passes an icon as buttonLabel; no text or chevron (compact toolbar button) */}
      {iconOnly ? buttonLabel : <>
        <span className={`min-w-0 flex-1 truncate ${selected || buttonLabel ? '' : 'text-[#9CA3AF]'}`}>{buttonLabel || (selected ? selected.label : placeholder)}</span>
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </>}
    </button>
    {open && <div className="fixed inset-0 z-[90] flex items-end bg-black/30" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full rounded-t-[24px] bg-white pb-[calc(12px+env(safe-area-inset-bottom,0px))] font-outfit shadow-[0_-8px_30px_rgba(15,23,42,0.14)]" onClick={event => event.stopPropagation()}>
        <div className="flex justify-center pt-2.5"><span className="h-1 w-10 rounded-full bg-[#CBD5E1]" /></div>
        <p id={titleId} className="px-5 pb-2 pt-3 text-[15px] font-extrabold tracking-tight text-[#0F172A]">{title}</p>
        <div className="max-h-[50dvh] overflow-y-auto px-3">
          {options.map(option => {
            const active = String(option.value) === String(value)
            return <button key={option.value} type="button"
              onClick={() => { onChange(option.value); setOpen(false) }}
              className={`mb-1 flex h-11 w-full items-center justify-between rounded-xl px-3.5 text-left text-[14px] ${active ? 'bg-[#2563EB] font-semibold text-white shadow-[0_4px_10px_rgba(37,99,235,0.3)]' : 'text-[#1F2937] active:bg-white/70'}`}>
              <span className="truncate">{option.label}</span>
              {active && <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          })}
        </div>
      </div>
    </div>}
  </>
}
