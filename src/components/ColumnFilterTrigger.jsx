// Compact filter button for a report table header. The caller renders ColumnFilterMenu
// and passes the same ref so the menu anchors to this button.
export default function ColumnFilterTrigger({ columnKey, label, filterRef, active = false, onClick, className = '' }) {
  return (
    <button
      ref={filterRef}
      type="button"
      onClick={event => { event.stopPropagation(); onClick(columnKey) }}
      aria-haspopup="dialog"
      aria-label={`Filter ${label}`}
      title={`Filter ${label}`}
      className={`relative inline-flex h-5 w-5 flex-none shrink-0 items-center justify-center rounded transition hover:bg-blue-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${active ? 'bg-yellow-300 text-blue-900' : 'text-white/85'} ${className}`}
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.586a1 1 0 0 1-.293.707l-6.414 6.414a1 1 0 0 0-.293.707V17l-4 4v-6.586a1 1 0 0 0-.293-.707L3.293 7.293A1 1 0 0 1 3 6.586V4Z" />
      </svg>
      {active && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-yellow-300 ring-1 ring-blue-700" />}
    </button>
  )
}
