import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildColumnFilter, COLUMN_FILTER_OPTIONS } from '../utils/columnFilters'
import { fromServerEpoch } from '../utils/dateFormatter'

const ArrowUp = () => <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
const ArrowDown = () => <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" /></svg>
const CloseIcon = ({ className = 'h-3.5 w-3.5' }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
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
  inputType,
  inputMode,
}) {
  const [type, setType] = useState(value?.type || (kind === 'date' ? 'between' : 'equal'))
  const [value1, setValue1] = useState('')
  const [value2, setValue2] = useState('')
  const [error, setError] = useState('')
  const [position, setPosition] = useState(null)
  const panelRef = useRef(null)
  const firstInputRef = useRef(null)
  const options = COLUMN_FILTER_OPTIONS[kind] || COLUMN_FILTER_OPTIONS.text
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640

  useEffect(() => {
    setType(value?.type || (kind === 'date' ? 'between' : 'equal'))
    setValue1(value?.value1 == null ? '' : dateInputValue(value.value1, kind))
    setValue2(value?.value2 == null ? '' : dateInputValue(value.value2, kind))
    setError('')
  }, [value, kind])

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchorRef?.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(isMobile ? window.innerWidth - 24 : 288, window.innerWidth - 16)
      const estimatedHeight = kind === 'date' && type === 'between' ? 460 : kind === 'number' && type === 'between' ? 390 : 340
      const top = isMobile
        ? Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - Math.min(window.innerHeight, estimatedHeight) - 12))
        : Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - 12))
      const left = isMobile
        ? (window.innerWidth - width) / 2
        : Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      setPosition({ top, left, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef, isMobile, kind, type])

  useEffect(() => {
    firstInputRef.current?.focus()
    const onPointerDown = event => {
      if (!panelRef.current?.contains(event.target) && !anchorRef?.current?.contains(event.target)) onClose()
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
      className="fixed z-[9999] overflow-hidden rounded-xl border-2 border-slate-300 bg-white shadow-2xl"
      style={position}
      onClick={event => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-700">Filter Menu</span>
        <button type="button" onClick={onClose} aria-label="Close filter menu" className="text-gray-400 hover:text-gray-600"><CloseIcon /></button>
      </div>
      <div className="border-b border-slate-200 py-1">
        <button type="button" onClick={() => { onSort('asc'); onClose() }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-slate-50 ${sortDirection === 'asc' ? 'bg-blue-50 text-blue-700' : 'text-slate-700'}`}>
          <ArrowUp /> {kind === 'text' ? 'Sort A to Z' : 'Sort Smallest to Largest'}
        </button>
        <button type="button" onClick={() => { onSort('desc'); onClose() }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-slate-50 ${sortDirection === 'desc' ? 'bg-blue-50 text-blue-700' : 'text-slate-700'}`}>
          <ArrowDown /> {kind === 'text' ? 'Sort Z to A' : 'Sort Largest to Smallest'}
        </button>
      </div>
      <div className="border-b border-slate-200 py-1">
        <button type="button" onClick={() => { onClear(); onClose() }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50">
          <CloseIcon className="h-4 w-4" /> Clear Filter
        </button>
      </div>
      <div className="space-y-2 px-3 py-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="column-filter-condition">CONDITION</label>
          <select id="column-filter-condition" value={type} onChange={event => { setType(event.target.value); setError('') }} className={inputClass}>
            {options.map(([option, optionLabel]) => <option key={option} value={option}>{optionLabel}</option>)}
          </select>
        </div>
        {valueInput(value1, setValue1, kind === 'date' ? 'FROM' : 'VALUE')}
        {type === 'between' && valueInput(value2, setValue2, kind === 'date' ? 'TO' : 'AND')}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}
      </div>
      <div className="flex gap-2 border-t border-slate-200 bg-slate-50 p-2.5">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Close</button>
        <button type="button" onClick={apply} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">OK</button>
      </div>
    </div>,
    document.body,
  )
}

