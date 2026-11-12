import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildColumnFilter, COLUMN_FILTER_OPTIONS } from '../utils/columnFilters'
import { fromServerEpoch } from '../utils/dateFormatter'
import MobileCalendar from './MobileCalendar'

const ArrowUp = () => <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
const ArrowDown = () => <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" /></svg>
const CloseIcon = ({ className = 'h-3.5 w-3.5' }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
const ChevronDown = () => <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
const dateInputValue = (raw, kind) => {
  if (raw == null || raw === '') return ''
  if (kind !== 'date') return String(raw)
  const date = fromServerEpoch(raw)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

// Shared report table header menu: sort, clear, and a condition/value filter.
// The caller owns where the resulting filter goes (API request or local row filtering).
export default function ColumnFilterMenu({
  label,
  kind = 'text',
  value = null,
  sortDirection = null,
  onSort,
  onClear,
  onApply,
  onClose,
  anchorRef,
  initialRect = null,
  inputType,
  inputMode,
}) {
  const [type, setType] = useState(value?.type || (kind === 'date' ? 'between' : 'equal'))
  const [value1, setValue1] = useState('')
  const [value2, setValue2] = useState('')
  const [error, setError] = useState('')
  const [position, setPosition] = useState(null)
  const [conditionOpen, setConditionOpen] = useState(false)
  const [conditionPos, setConditionPos] = useState(null)
  const [calendarField, setCalendarField] = useState(null)
  const [timeField, setTimeField] = useState(null)
  const panelRef = useRef(null)
  const firstInputRef = useRef(null)
  const conditionRef = useRef(null)
  const conditionPopupRef = useRef(null)
  const conditionButtonRef = useRef(null)
  const options = COLUMN_FILTER_OPTIONS[kind] || COLUMN_FILTER_OPTIONS.text
  const selectedLabel = options.find(([option]) => option === type)?.[1] || options[0]?.[1] || ''
  const isPositioned = position !== null
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!isMobile) return undefined
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [isMobile, isPositioned])
  // Resolve the anchor node live each time — callers may pass a ref object whose
  // .current is only assigned after the column button mounts, so a frozen snapshot
  // would measure nothing and pin the menu to the top-left corner.
  const getAnchorNode = useCallback(() => (typeof anchorRef === 'function' ? anchorRef() : anchorRef?.current) || null, [anchorRef])

  useEffect(() => {
    setType(value?.type || (kind === 'date' ? 'between' : 'equal'))
    setValue1(value?.value1 == null ? '' : dateInputValue(value.value1, kind))
    setValue2(value?.value2 == null ? '' : dateInputValue(value.value2, kind))
    setError('')
  }, [value, kind])

  useLayoutEffect(() => {
    let frame
    let retries = 0
    const place = () => {
      if (isMobile) {
        const viewport = window.visualViewport
        const height = viewport?.height || window.innerHeight
        const bottom = Math.max(0, window.innerHeight - (viewport?.offsetTop || 0) - height)
        setPosition({ bottom, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 412, maxHeight: Math.max(0, height - 12) })
        return
      }
      // Prefer the rect captured at click time — ref measurement can race layout on
      // sticky/scrollable table headers, which is what dropped the menu to the center.
      const rect = initialRect || getAnchorNode()?.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        retries += 1
        if (retries <= 6) { frame = requestAnimationFrame(place); return }
        const width = isMobile ? Math.min(window.innerWidth - 24, 320) : 288
        setPosition({ top: 60, left: Math.max(12, (window.innerWidth - width) / 2), width, maxHeight: 340 })
        return
      }
      retries = 0
      const width = isMobile ? Math.min(window.innerWidth - 24, 320) : 288
      const estimatedHeight = isMobile
        ? (kind === 'date' && type === 'between' ? 380 : kind === 'number' && type === 'between' ? 320 : 280)
        : (kind === 'date' && type === 'between' ? 460 : kind === 'number' && type === 'between' ? 390 : 340)
      const gap = 8
      const margin = 12
      // Always open below the column header. Cap the height to the space available
      // below and let the content scroll, instead of flipping the menu above.
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop || 0
      const viewportBottom = viewportTop + (viewport?.height || window.innerHeight)
      const spaceBelow = viewportBottom - rect.bottom - gap - margin
      const spaceAbove = rect.top - viewportTop - gap - margin
      const useAbove = isMobile && spaceBelow < Math.min(estimatedHeight, 240) && spaceAbove > spaceBelow
      const available = useAbove ? spaceAbove : spaceBelow
      const constrainedViewport = isMobile && available < 160
      const maxHeight = isMobile
        ? Math.max(0, Math.min(estimatedHeight, constrainedViewport ? viewportBottom - viewportTop - margin * 2 : available))
        : Math.max(200, Math.min(estimatedHeight, spaceBelow))
      const top = constrainedViewport ? viewportTop + margin : useAbove ? Math.max(viewportTop + margin, rect.top - gap - maxHeight) : rect.bottom + gap
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
      setPosition({ top, left, width, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
    // anchorRef is an inline getter on the pages (new identity each render); the node
    // is read live inside place(), so we only re-place when layout-affecting inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, kind, type, initialRect])

  useEffect(() => {
    if (!isMobile) firstInputRef.current?.focus()
    const onPointerDown = event => {
      const anchorNode = getAnchorNode()
      const inCondition = conditionRef.current?.contains(event.target) || conditionPopupRef.current?.contains(event.target)
      const inTrigger = event.target.closest?.('[data-column-filter-trigger]')
      if (!panelRef.current?.contains(event.target) && !anchorNode?.contains(event.target) && !inCondition && !inTrigger) onClose()
    }
    const onKey = event => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && panelRef.current) {
        const controls = [...panelRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
        if (!controls.length) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [getAnchorNode, isMobile, onClose])

  useEffect(() => {
    if (!conditionOpen) return undefined
    const close = event => { if (!conditionRef.current?.contains(event.target) && !conditionPopupRef.current?.contains(event.target)) setConditionOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [conditionOpen])

  const apply = () => {
    try {
      const filter = buildColumnFilter({ type, value1, value2, kind })
      onApply(filter)
      setError('')
      onClose()
    } catch (failure) {
      setError(failure.message || 'Enter a valid filter value.')
    }
  }
  const inputClass = isMobile
    ? 'h-12 w-full min-w-0 rounded-xl border border-[#D5DEEA] bg-white px-3 text-base text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
    : 'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100'
  const valueInput = (current, setCurrent, label, required = true) => {
    if (isMobile && kind === 'date') {
      const [date = '', time = '00:00:00'] = current.split('T')
      const [hours = '00', minutes = '00', seconds = '00'] = time.split(':')
      const setTime = (part, raw) => {
        if (!date) return
        const number = Math.max(0, Math.min(part === 'hours' ? 23 : 59, Number(raw) || 0))
        const next = String(number).padStart(2, '0')
        setCurrent(`${date}T${part === 'hours' ? next : hours}:${part === 'minutes' ? next : minutes}:${part === 'seconds' ? next : seconds}`)
        setError('')
        setTimeField(null)
      }
      const open = calendarField === label
      return (
        <div className="min-w-0 space-y-2">
          <label className="block text-xs font-semibold text-slate-600" htmlFor={`column-filter-${label}`}>{label === 'FROM' ? 'From date and time' : 'To date and time'}</label>
          <button type="button" id={`column-filter-${label}`} aria-expanded={open} aria-controls={`column-filter-calendar-${label}`} onClick={() => { setCalendarField(open ? null : label); setConditionOpen(false); setTimeField(null) }} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
            <span className={date ? 'text-slate-900' : 'text-slate-400'}>{date ? date.split('-').reverse().join('/') : 'Select date'}</span>
            <svg className="h-4 w-4 shrink-0 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
          </button>
          {open && <div id={`column-filter-calendar-${label}`} className="w-full min-w-0 rounded-xl border border-[#D5DEEA] bg-slate-50 p-3 [&_button]:min-h-8 [&_button]:min-w-8">
            <MobileCalendar key={`${label}-${date}`} value={date} onChange={next => { setCurrent(`${next}T${time}`); setCalendarField(null); setError('') }} />
          </div>}
          <div className="grid grid-cols-3 gap-2">
            {[['hours', 'Hour', hours], ['minutes', 'Minute', minutes], ['seconds', 'Second', seconds]].map(([part, title, selected]) => (
              <div key={part} className="min-w-0">
                <span className="mb-1 block text-xs font-medium text-slate-500">{title}</span>
                <button type="button" disabled={!date} aria-label={`${label} ${title.toLowerCase()}: ${selected}`} aria-expanded={timeField === `${label}-${part}`} aria-controls={`column-filter-time-${label}`} onClick={() => { setTimeField(timeField === `${label}-${part}` ? null : `${label}-${part}`); setCalendarField(null); setConditionOpen(false) }} className={`${inputClass} flex items-center justify-between gap-2 tabular-nums disabled:bg-slate-50 disabled:text-slate-400`}>
                  <span className="flex-1 text-center font-semibold">{selected}</span><ChevronDown />
                </button>
              </div>
            ))}
          </div>
          {date && ['hours', 'minutes', 'seconds'].map(part => timeField === `${label}-${part}` && (
            <div key={part} id={`column-filter-time-${label}`} role="group" aria-label={`Select ${label.toLowerCase()} ${part === 'hours' ? 'hour' : part === 'minutes' ? 'minute' : 'second'}`} className="rounded-xl border border-[#D5DEEA] bg-slate-50 p-2">
              <p className="mb-2 px-1 text-xs font-semibold text-slate-600">{part === 'hours' ? 'Select hour (24-hour clock)' : part === 'minutes' ? 'Select minute' : 'Select second'}</p>
              <div className="grid max-h-40 grid-cols-5 gap-1 overflow-y-auto overscroll-contain">
                {Array.from({ length: part === 'hours' ? 24 : 60 }, (_, index) => {
                  const choice = String(index).padStart(2, '0')
                  const selected = choice === (part === 'hours' ? hours : part === 'minutes' ? minutes : seconds)
                  return <button key={choice} type="button" aria-pressed={selected} onClick={() => setTime(part, choice)} className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${selected ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-blue-50'}`}>{choice}</button>
                })}
              </div>
            </div>
          ))}
        </div>
      )
    }
    return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor={`column-filter-${label}`}>{label}</label>
      <input
        ref={label === 'VALUE' ? firstInputRef : undefined}
        id={`column-filter-${label}`}
        type={inputType || (kind === 'date' ? 'datetime-local' : kind === 'number' ? 'number' : 'text')}
        inputMode={inputMode || (kind === 'number' ? 'decimal' : undefined)}
        step={kind === 'date' ? '1' : kind === 'number' ? 'any' : undefined}
        placeholder={kind === 'date' ? 'Select date and time' : kind === 'number' ? 'Enter value' : 'Enter text'}
        value={current}
        onChange={event => { setCurrent(event.target.value); setError('') }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (required) apply()
          }
        }}
        className={inputClass}
      />
    </div>
    )
  }

  if (!position) return null

  if (isMobile) return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-slate-900/45" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} filter menu`}
        tabIndex={-1}
        className="fixed z-[9999] flex flex-col overflow-hidden rounded-t-[28px] bg-white font-outfit text-slate-900 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] outline-none"
        style={position}
        onClick={event => event.stopPropagation()}
      >
        <div className="mx-auto mb-2 mt-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        <div className="grid shrink-0 grid-cols-[36px_1fr_36px] items-center gap-3 border-b border-[#D5DEEA] px-5 pb-4 pt-1">
          <button type="button" onClick={onClose} aria-label="Close filter menu" className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#D5DEEA] text-slate-600 focus-visible:ring-2 focus-visible:ring-blue-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" /></svg>
          </button>
          <div className="min-w-0 text-center"><h2 className="text-lg font-extrabold tracking-tight">Column filter</h2><p className="truncate text-xs text-slate-500" title={label}>{label}</p></div>
          <span aria-hidden="true" />
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
          <section aria-label="Sort order" className="overflow-hidden rounded-2xl border border-[#D5DEEA]">
            {[['asc', kind === 'text' ? 'Sort A to Z' : kind === 'date' ? 'Oldest to newest' : 'Smallest to largest'], ['desc', kind === 'text' ? 'Sort Z to A' : kind === 'date' ? 'Newest to oldest' : 'Largest to smallest']].map(([direction, text], index) => (
              <button key={direction} type="button" aria-pressed={sortDirection === direction} onClick={() => { onSort(direction); onClose() }} className={`flex min-h-12 w-full items-center gap-3 px-3.5 py-3 text-left text-sm font-semibold ${index ? 'border-t border-slate-100' : ''} ${sortDirection === direction ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-blue-100">{direction === 'asc' ? <ArrowUp /> : <ArrowDown />}</span>
                <span className="flex-1">{text}</span>
                {sortDirection === direction && <span aria-hidden="true" className="text-blue-600">✓</span>}
              </button>
            ))}
          </section>
          <div className="space-y-4">
            <div ref={conditionRef}>
              <label htmlFor="mobile-column-filter-condition" className="mb-1.5 block text-xs font-semibold text-slate-600">Condition</label>
              <button
                id="mobile-column-filter-condition"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={conditionOpen}
                aria-controls="mobile-column-filter-options"
                onClick={() => { setConditionOpen(open => !open); setCalendarField(null); setTimeField(null) }}
                onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setConditionOpen(true) } }}
                className={`${inputClass} flex items-center justify-between gap-3 text-left`}
              >
                <span className="min-w-0 flex-1 truncate">{selectedLabel.replace(/\.\.\.$/, '')}</span>
                <span className={`shrink-0 transition-transform ${conditionOpen ? 'rotate-180' : ''}`}><ChevronDown /></span>
              </button>
              {conditionOpen && (
                <ul id="mobile-column-filter-options" role="listbox" aria-label="Condition" className="mt-2 max-h-44 w-full overflow-y-auto overscroll-contain rounded-xl border border-[#D5DEEA] bg-white p-1">
                  {options.map(([option, text]) => (
                    <li key={option} role="option" aria-selected={option === type}>
                      <button type="button" onClick={() => { setType(option); setError(''); setConditionOpen(false); document.getElementById('mobile-column-filter-condition')?.focus({ preventScroll: true }) }} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${option === type ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                        <span>{text.replace(/\.\.\.$/, '')}</span>
                        {option === type && <span aria-hidden="true">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {valueInput(value1, setValue1, kind === 'date' ? 'FROM' : 'VALUE')}
            {type === 'between' && valueInput(value2, setValue2, kind === 'date' ? 'TO' : 'AND')}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-[#D5DEEA] bg-white px-5 pt-4" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={() => { onClear(); onClose() }} className="h-12 rounded-[14px] border border-[#D5DEEA] bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">Reset</button>
          <button type="button" onClick={apply} className="h-12 rounded-[14px] bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700">Apply</button>
        </div>
      </div>
    </>, document.body,
  )

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${label} filter menu`}
      className="fixed z-[9999] flex flex-col overflow-visible rounded-xl border-2 border-slate-300 bg-white shadow-2xl"
      style={position}
      onClick={event => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 max-sm:py-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-700">Filter Menu</span>
        <button type="button" onClick={onClose} aria-label="Close filter menu" className="text-gray-400 hover:text-gray-600"><CloseIcon /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-slate-200 py-1">
        <button type="button" onClick={() => { onSort('asc'); onClose() }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-slate-50 max-sm:py-1 ${sortDirection === 'asc' ? 'bg-blue-50 text-blue-700' : 'text-slate-700'}`}>
          <ArrowUp /> {kind === 'text' ? 'Sort A to Z' : 'Sort Smallest to Largest'}
        </button>
        <button type="button" onClick={() => { onSort('desc'); onClose() }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-slate-50 max-sm:py-1 ${sortDirection === 'desc' ? 'bg-blue-50 text-blue-700' : 'text-slate-700'}`}>
          <ArrowDown /> {kind === 'text' ? 'Sort Z to A' : 'Sort Largest to Smallest'}
        </button>
      </div>
      <div className="border-b border-slate-200 py-1">
        <button type="button" onClick={() => { onClear(); onClose() }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50">
          <CloseIcon className="h-4 w-4" /> Clear Filter
        </button>
      </div>
      <div className="space-y-2 px-3 py-2">
        <div ref={conditionRef} className="relative">
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="column-filter-condition">CONDITION</label>
          <button
            ref={conditionButtonRef}
            type="button"
            id="column-filter-condition"
            aria-haspopup="listbox"
            aria-expanded={conditionOpen}
            onClick={() => {
              if (!conditionOpen) {
                const rect = conditionButtonRef.current?.getBoundingClientRect()
                if (rect) {
                  const maxHeight = 224
                  const spaceBelow = window.innerHeight - rect.bottom - 8
                  const dropUp = spaceBelow < 140 && rect.top > spaceBelow
                  setConditionPos({
                    left: rect.left,
                    width: rect.width,
                    ...(dropUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
                    maxHeight,
                  })
                }
              }
              setConditionOpen(open => !open)
            }}
            className={`${inputClass} flex items-center justify-between gap-2 text-left`}
          >
            <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
            <ChevronDown />
          </button>
          {conditionOpen && conditionPos && createPortal(
            <div ref={conditionPopupRef} className="fixed z-[10000]">
              <ul role="listbox" aria-label="Condition" style={{ ...conditionPos, position: 'fixed' }} className="overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                {options.map(([option, optionLabel]) => (
                  <li key={option} role="option" aria-selected={option === type}>
                    <button
                      type="button"
                      onClick={() => { setType(option); setError(''); setConditionOpen(false) }}
                      className={`block w-full px-2.5 py-2 text-left text-xs transition-colors hover:bg-slate-50 ${option === type ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-800'}`}
                    >
                      {optionLabel}
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )}
        </div>
        {valueInput(value1, setValue1, kind === 'date' ? 'FROM' : 'VALUE')}
        {type === 'between' && valueInput(value2, setValue2, kind === 'date' ? 'TO' : 'AND')}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}
      </div>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-slate-200 bg-slate-50 p-2.5 max-sm:p-2">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 max-sm:py-1.5">Close</button>
        <button type="button" onClick={apply} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 max-sm:py-1.5">OK</button>
      </div>
    </div>,
    document.body,
  )
}

