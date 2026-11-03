import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildColumnFilter, COLUMN_FILTER_OPTIONS } from '../utils/columnFilters'
import { fromServerEpoch } from '../utils/dateFormatter'

const ArrowUp = () => <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
const ArrowDown = () => <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" /></svg>
const CloseIcon = ({ className = 'h-3.5 w-3.5' }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
const ChevronDown = () => <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
const dateInputValue = (raw, kind) => {
  if (raw == null || raw === '') return ''
  if (kind !== 'date') return String(raw)
  const date = fromServerEpoch(raw)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
  const panelRef = useRef(null)
  const firstInputRef = useRef(null)
  const conditionRef = useRef(null)
  const conditionButtonRef = useRef(null)
  const options = COLUMN_FILTER_OPTIONS[kind] || COLUMN_FILTER_OPTIONS.text
  const selectedLabel = options.find(([option]) => option === type)?.[1] || options[0]?.[1] || ''
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
  // Resolve the anchor node live each time — callers may pass a ref object whose
  // .current is only assigned after the column button mounts, so a frozen snapshot
  // would measure nothing and pin the menu to the top-left corner.
  const getAnchorNode = () => (typeof anchorRef === 'function' ? anchorRef() : anchorRef?.current) || null

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
      // Prefer the rect captured at click time — ref measurement can race layout on
      // sticky/scrollable table headers, which is what dropped the menu to the center.
      const rect = initialRect || getAnchorNode()?.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        retries += 1
        if (retries <= 6) { frame = requestAnimationFrame(place); return }
        const width = isMobile ? Math.min(Math.round(window.innerWidth * 0.6), 288) : 288
        setPosition({ top: 60, left: Math.max(12, (window.innerWidth - width) / 2), width, maxHeight: 340 })
        return
      }
      retries = 0
      const width = isMobile ? Math.min(Math.round(window.innerWidth * 0.6), 288) : 288
      const estimatedHeight = isMobile
        ? (kind === 'date' && type === 'between' ? 380 : kind === 'number' && type === 'between' ? 320 : 280)
        : (kind === 'date' && type === 'between' ? 460 : kind === 'number' && type === 'between' ? 390 : 340)
      const gap = 8
      const margin = 12
      // Always open below the column header. Cap the height to the space available
      // below and let the content scroll, instead of flipping the menu above.
      const spaceBelow = window.innerHeight - rect.bottom - margin
      const top = rect.bottom + gap
      const maxHeight = Math.max(200, Math.min(estimatedHeight, spaceBelow))
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
      setPosition({ top, left, width, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
    // anchorRef is an inline getter on the pages (new identity each render); the node
    // is read live inside place(), so we only re-place when layout-affecting inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, kind, type, initialRect])

  useEffect(() => {
    firstInputRef.current?.focus()
    const onPointerDown = event => {
      const anchorNode = getAnchorNode()
      const inCondition = conditionRef.current?.contains(event.target)
      if (!panelRef.current?.contains(event.target) && !anchorNode?.contains(event.target) && !inCondition) onClose()
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
  }, [anchorRef, onClose])

  useEffect(() => {
    if (!conditionOpen) return undefined
    const close = event => { if (!conditionRef.current?.contains(event.target)) setConditionOpen(false) }
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
  const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100'
  const valueInput = (current, setCurrent, label, required = true) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor={`column-filter-${label}`}>{label}</label>
      <input
        ref={label === 'VALUE' ? firstInputRef : undefined}
        id={`column-filter-${label}`}
        type={inputType || (kind === 'date' ? 'datetime-local' : kind === 'number' ? 'number' : 'text')}
        inputMode={inputMode || (kind === 'number' ? 'decimal' : undefined)}
        step={kind === 'date' ? '60' : kind === 'number' ? 'any' : undefined}
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

  if (!position) return null

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
            <div ref={conditionRef} className="fixed z-[10000]">
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

