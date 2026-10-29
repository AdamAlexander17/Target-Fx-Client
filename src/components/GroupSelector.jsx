import { useState, useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { useGroups } from '../contexts/groupContextStore'

const GroupSelector = ({ onCreateClick, onEditClick, onRatesClick, moduleName, compact = false, refreshOnOpen = false }) => {
  const { groups, getActiveGroupFilter, setActiveGroupFilter, deleteGroup, refreshGroups } = useGroups()
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  useEffect(() => {
    if (!showDropdown || !refreshOnOpen) return
    let cancelled = false
    setRefreshing(true)
    setRefreshError('')
    refreshGroups({ throwOnError: true })
      .catch(() => { if (!cancelled) setRefreshError('Could not refresh saved groups. Close and reopen to retry.') })
      .finally(() => { if (!cancelled) setRefreshing(false) })
    return () => { cancelled = true }
  }, [showDropdown, refreshOnOpen, refreshGroups])
  const dropdownRef = useRef(null)
  const dropdownMenuRef = useRef(null)
  const triggerRef = useRef(null)
  const dropdownId = useId()
  const selectGroup = (name) => {
    setActiveGroupFilter(moduleName, name)
    setShowDropdown(false)
    triggerRef.current?.focus()
  }

  const activeGroupFilter = getActiveGroupFilter(moduleName)

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!dropdownRef.current?.contains(event.target) && !dropdownMenuRef.current?.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        setShowDropdown(false)
        triggerRef.current?.focus()
      }
    }

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [showDropdown])

  const handleEdit = (group, e) => {
    e.stopPropagation()
    setShowDropdown(false)
    if (onEditClick) {
      console.log('[GroupSelector] Calling onEditClick with group:', group)
      onEditClick(group)
    } else {
      console.warn('[GroupSelector] onEditClick is not defined')
    }
  }

  const handleDelete = (groupName, e) => {
    e.stopPropagation()
    if (confirm(`Delete group "${groupName}"?`)) {
      deleteGroup(groupName)
    }
  }

  const toggleDropdown = () => {
    if (showDropdown) {
      setShowDropdown(false)
      return
    }
    if (compact && triggerRef.current) {
      if (window.innerWidth < 640) {
        setDropdownPosition({ mobile: true })
        setShowDropdown(true)
        return
      }
      const rect = triggerRef.current.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - 16)
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 240))
      setDropdownPosition({ left, top, width, maxHeight: window.innerHeight - top - 8 })
    }
    setShowDropdown(true)
  }

  return (
    <div className="relative max-w-full" ref={dropdownRef} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        setShowDropdown(false)
        triggerRef.current?.focus()
      }
    }}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          ref={triggerRef}
          aria-expanded={showDropdown}
          aria-controls={dropdownId}
          aria-label={compact ? `Login groups: ${activeGroupFilter || 'All logins'}` : undefined}
          title={activeGroupFilter ? `Group filter applied: ${activeGroupFilter}` : 'Choose a group filter'}
          onClick={toggleDropdown}
          className={`${compact ? 'px-2 h-9' : 'px-2.5 h-8'} py-1.5 rounded-md border transition-colors inline-flex items-center gap-1.5 text-xs font-medium shadow-sm min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${activeGroupFilter ? 'bg-gray-50 border-gray-300 text-gray-900 hover:bg-gray-100' : 'bg-white border-[#E5E7EB] text-[#374151] hover:bg-gray-50'}`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span className="shrink-0">Groups</span>
          <span className={`${compact ? 'max-w-[64px] text-[10px]' : 'max-w-[140px] text-[11px]'} truncate rounded px-1.5 py-0.5 ${activeGroupFilter ? 'bg-gray-200 text-gray-900 font-semibold' : 'bg-slate-100 text-slate-600'}`}>
            {activeGroupFilter || 'All logins'}
          </span>
          <svg aria-hidden="true" className={`h-3 w-3 shrink-0 transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {activeGroupFilter && !compact && (
          <button type="button" onClick={() => selectGroup(null)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            title="Clear group filter to include all logins"
            aria-label={`Clear group filter ${activeGroupFilter}`}>
            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="m6 6 12 12M6 18 18 6" />
            </svg>
            Clear
          </button>
        )}
      </div>
      <span className="sr-only" role="status">
        {activeGroupFilter ? `Group filter applied: ${activeGroupFilter}. Clear to include all logins.` : 'No group filter. All logins included.'}
      </span>

      {showDropdown && (() => {
        const mobileSheet = Boolean(dropdownPosition?.mobile)
        const panel = <div ref={dropdownMenuRef} id={dropdownId} role={mobileSheet ? 'dialog' : undefined} aria-modal={mobileSheet ? 'true' : undefined} aria-label={mobileSheet ? 'Login groups' : undefined} className={`${mobileSheet ? 'relative flex max-h-[min(78dvh,620px)] w-full max-w-none flex-col overflow-hidden rounded-t-[24px] border border-[#D5DEEA] bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-12px_36px_rgba(15,23,42,0.18)]' : `${compact ? 'fixed overflow-y-auto' : 'absolute right-0 top-full mt-2'} z-[9999] w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-[#D5DEEA] bg-white py-2 shadow-[0_12px_32px_rgba(15,23,42,0.14)]`}`} style={compact && !mobileSheet ? dropdownPosition : undefined}>
          {mobileSheet && <div className="flex shrink-0 justify-center pb-2 pt-2.5"><span className="h-1 w-10 rounded-full bg-slate-300" /></div>}
          <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 ${mobileSheet ? 'pb-3 pt-1' : 'py-2'}`}>
            <div className="min-w-0">
              <p className="text-[13px] font-bold uppercase tracking-wide text-[#1E293B]">Login groups</p>
              {mobileSheet && <p className="mt-0.5 text-[11px] text-[#64748B]">Filter calculator results by a saved group</p>}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowDropdown(false)
                onCreateClick()
              }}
              className="inline-flex h-9 shrink-0 items-center rounded-lg bg-[#2563EB] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              + New group
            </button>
          </div>

          <button type="button" onClick={() => selectGroup(null)} aria-pressed={!activeGroupFilter}
            className={`mx-2 mt-2 flex min-h-12 w-[calc(100%-1rem)] items-center justify-between gap-2 rounded-xl px-3 text-left text-xs transition ${!activeGroupFilter ? 'border border-blue-100 bg-blue-50 text-[#1E293B]' : 'text-slate-700 hover:bg-slate-50'}`}>
            <span><span className="block font-semibold">All logins</span><span className="mt-0.5 block text-[11px] text-slate-500">Clear group filter</span></span>
            {!activeGroupFilter && <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700">Selected</span>}
          </button>
          {refreshing && <p role="status" className="px-4 py-2 text-xs text-slate-500">Refreshing saved groups...</p>}
          {refreshError && <p role="alert" className="mx-3 my-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{refreshError}</p>}
          {groups.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              {refreshing ? 'Loading groups...' : refreshError ? 'Saved groups unavailable' : 'No groups created yet'}
            </div>
          ) : (
            <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain py-2 ${mobileSheet ? 'max-h-[55dvh]' : 'max-h-80'}`}>
              {groups.map((group) => (
                <div key={group.name} className={`mx-2 mb-1 flex items-center gap-1 rounded-xl border ${activeGroupFilter === group.name ? 'border-blue-100 bg-blue-50/70' : 'border-transparent hover:bg-slate-50'}`}>
                  <button
                    type="button"
                    aria-pressed={activeGroupFilter === group.name}
                    onClick={() => selectGroup(group.name)}
                    className={`min-h-12 min-w-0 flex-1 rounded-l-xl px-3 py-2 text-left text-xs transition-colors ${
                      activeGroupFilter === group.name
                        ? 'text-gray-900 font-bold'
                        : 'text-slate-700 font-medium'
                    }`}
                  >
                    <span className="block break-words">{group.name}</span>
                    {activeGroupFilter === group.name && <span className="block text-[10px] font-semibold text-gray-700">&#10003; Applied</span>}
                    {group.range && (
                      <span className="block mt-0.5 text-[11px] text-slate-500">
                        ({group.range.from}-{group.range.to})
                      </span>
                    )}
                    {!group.range && group.loginIds && (
                      <span className="block mt-0.5 text-[11px] text-slate-500">
                        ({group.loginIds.length} logins)
                      </span>
                    )}
                  </button>
                  {onRatesClick && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setShowDropdown(false); onRatesClick(group) }}
                      className="mr-0.5 inline-flex h-9 shrink-0 items-center rounded-lg border border-blue-200 bg-white px-2.5 text-[11px] font-semibold text-blue-600 transition hover:bg-blue-50"
                      title={`Brokerage rates for ${group.name}`}
                      aria-label={`Brokerage rates for ${group.name}`}
                    >
                      Rates
                    </button>
                  )}
                  <button
                    onClick={(e) => handleEdit(group, e)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-600 transition hover:bg-blue-50 hover:text-blue-700"
                    type="button"
                    title={`Edit group ${group.name}`}
                    aria-label={`Edit group ${group.name}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => handleDelete(group.name, e)}
                    className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 hover:text-red-700"
                    type="button"
                    title={`Delete group ${group.name}`}
                    aria-label={`Delete group ${group.name}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        const menu = mobileSheet
          ? <div className="fixed inset-0 z-[9998] flex items-end bg-slate-950/35" onMouseDown={event => { if (event.target === event.currentTarget) { setShowDropdown(false); triggerRef.current?.focus() } }}>
              {panel}
            </div>
          : panel
        return compact ? createPortal(menu, document.body) : menu
      })()}
    </div>
  )
}

export default GroupSelector
