import { useState } from 'react'
import { MONTHS, parseIsoDate, toIsoDate } from '../utils/isoDate'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Themed month calendar (native date pickers are drawn by the OS and can't be styled).
// value / min / max / rangeStart / rangeEnd are 'YYYY-MM-DD' strings, onChange receives the same format.
export default function MobileCalendar({ value, onChange, min, max, rangeStart, rangeEnd }) {
  const initial = parseIsoDate(value) || parseIsoDate(min) || new Date()
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() })
  const today = toIsoDate(new Date())

  const first = new Date(view.year, view.month, 1)
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(view.year, view.month, i + 1))]
  const shift = delta => setView(current => {
    const next = new Date(current.year, current.month + delta, 1)
    return { year: next.getFullYear(), month: next.getMonth() }
  })

  return <div className="select-none">
    <div className="mb-1 flex items-center justify-between">
      <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="flex h-6 w-6 items-center justify-center rounded-md border border-[#D5DEEA] text-[#475569]">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12 14L8 10L12 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <p className="text-[12.5px] font-bold text-[#0F172A]">{MONTHS[view.month]} {view.year}</p>
      <button type="button" onClick={() => shift(1)} aria-label="Next month" className="flex h-6 w-6 items-center justify-center rounded-md border border-[#D5DEEA] text-[#475569]">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8 6L12 10L8 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    <div className="grid grid-cols-7 text-center text-[9px] font-semibold uppercase tracking-wider text-[#94A3B8]">
      {WEEKDAYS.map(day => <span key={day} className="py-0.5">{day}</span>)}
    </div>
    <div className="grid grid-cols-7 text-center">
      {cells.map((date, index) => {
        if (!date) return <span key={`blank-${index}`} />
        const iso = toIsoDate(date)
        const disabled = (!!min && iso < min) || (!!max && iso > max)
        const selected = iso === value
        const inRange = rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd
        return <button key={iso} type="button" disabled={disabled} onClick={() => onChange(iso)}
          className={`mx-auto flex h-[26px] w-[26px] items-center justify-center rounded-md text-[11.5px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:text-[#CBD5E1]
            ${selected ? 'bg-[#2563EB] font-semibold text-white shadow-[0_4px_10px_rgba(37,99,235,0.3)]' : inRange ? 'bg-[#2563EB]/10 text-[#1D4ED8]' : iso === today ? 'font-semibold text-[#2563EB] ring-1 ring-[#2563EB]/40' : 'text-[#1F2937] active:bg-white'}`}>
          {date.getDate()}
        </button>
      })}
    </div>
  </div>
}
