import Sidebar from './Sidebar'
import BrokerCreditSummary from './BrokerCreditSummary'
import MobileBottomNav from './MobileBottomNav'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { AskAiIcon, ReportsIcon, ReportSubIcon, TutorialIcon, BrokerageCalcIcon } from './ReportIcons'
import { useAuth } from '../contexts/authContextStore'
import { brokerAPI } from '../services/api'
import CustomizeViewModal from './CustomizeViewModal'
import FilterModal from './FilterModal'

import ClientDetailsMobileModal from './ClientDetailsMobileModal'
import ColumnChooserList from './ColumnChooserList'
import { useGroups } from '../contexts/groupContextStore'
import { applyCumulativeFilters, applySearchFilter, applySorting } from '../utils/mobileFilters'

const formatNum = (n, decimals = 2) => {
  const v = Number(n || 0)
  if (!isFinite(v)) return '0.00'
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

const formatCompactIndian = (v) => {
  const n = Number(v)
  if (!isFinite(n)) return '0.00'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e7) return sign + (abs / 1e7).toFixed(2) + 'Cr'
  if (abs >= 1e5) return sign + (abs / 1e5).toFixed(2) + 'L'
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(2) + 'K'
  return sign + abs.toFixed(2)
}

const getMarginLevelPercent = (obj) => {
  let val = obj?.margin_level ?? obj?.marginLevel ?? obj?.margin_percent ?? obj?.marginPercent ?? obj?.margin
  if (val === undefined || val === null) return undefined
  const n = Number(val)
  if (Number.isNaN(n)) return undefined
  if (n > 0 && n <= 1) return n * 100
  return n
}

export default function MarginLevelModule() {
  const { isAuthenticated } = useAuth()
  // Local state populated by polling /api/broker/clients/margin-call (replaces WebSocket-fed data)
  const [accounts, setAccounts] = useState([])
  const [marginCallLoaded, setMarginCallLoaded] = useState(false)
  const clients = accounts // alias for downstream code that referenced full client list
  const positions = []
  const orders = []
  const loading = { accounts: !marginCallLoaded, clients: !marginCallLoaded }
  const { filterByActiveGroup, activeGroupFilters, getActiveGroupFilter, setActiveGroupFilter } = useGroups()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [numericMode, setNumericMode] = useState(() => { try { const s = localStorage.getItem('globalDisplayMode'); return s === 'full' ? 'full' : 'compact' } catch { return 'compact' } })

  const [searchInput, setSearchInput] = useState('')
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  const [filters, setFilters] = useState({ hasFloating: false, hasCredit: false, noDeposit: false })
    // Pending apply tracking
    const [hasPendingFilterChanges, setHasPendingFilterChanges] = useState(false)
    const [pendingFilterDraft, setPendingFilterDraft] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)


  // Mirror selectedClient into a ref so the polling closure always reads the latest value
  const selectedClientRef = useRef(null)
  useEffect(() => { selectedClientRef.current = selectedClient }, [selectedClient])

  // Fetch margin-call clients from REST API
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')
  const marginRequestRef = useRef(0)
  const fetchMarginCallClients = async () => {
    const requestId = ++marginRequestRef.current
    try {
      const res = await brokerAPI.getMarginCallClients({ ...(sortColumn ? { sortBy: sortColumn, sortOrder: sortDirection } : {}) })
      if (requestId !== marginRequestRef.current) return
      const data = res?.data ?? res
      const list = Array.isArray(data)
        ? data
        : (data?.clients ?? data?.accounts ?? data?.results ?? [])
      if (Array.isArray(list)) setAccounts(list)
      setMarginCallLoaded(true)
    } catch (err) {
      console.error('[MarginLevelModule] Failed to fetch margin-call clients:', err)
      setMarginCallLoaded(true)
    }
  }

  // Initial fetch + 2s polling. Stops completely while client modal is open.
  useEffect(() => {
    if (!isAuthenticated) return
    if (selectedClient) return  // Modal is open — don't poll margin-call at all

    let cancelled = false
    let timer = null

    const loop = async () => {
      if (cancelled) return
      const tabHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      if (!tabHidden) {
        await fetchMarginCallClients()
      }
      if (!cancelled) timer = setTimeout(loop, 2000)
    }

    loop()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [isAuthenticated, selectedClient, sortColumn, sortDirection])
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [isPageChanging, setIsPageChanging] = useState(false)
  const pageChangeTimeoutRef = useRef(null)
  const itemsPerPage = 15
  const [visibleColumns, setVisibleColumns] = useState({
    login: true,
    name: true,
    equity: true,
    margin: true,
    marginFree: false,
    marginLevel: true,
    profit: true
  })

  // Column order (persisted) — same key as desktop Margin Level page so both stay in sync
  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('marginLevelPageColumnOrder'))
      if (Array.isArray(saved)) return saved
    } catch { /* Retain the fallback when this operation is unavailable. */ }
    return null
  })
  useEffect(() => {
    try { if (columnOrder) localStorage.setItem('marginLevelPageColumnOrder', JSON.stringify(columnOrder)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [columnOrder])
  const resetColumnOrder = () => {
    setColumnOrder(null)
    try { localStorage.removeItem('marginLevelPageColumnOrder') } catch { /* Retain the fallback when this operation is unavailable. */ }
  }

  // Pinned (frozen) columns — persisted, default keeps Login frozen like desktop
  const [pinnedColumns, setPinnedColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('marginLevelPagePinnedColumns'))
      return Array.isArray(saved) && saved.length ? saved : ['login']
    } catch { return ['login'] }
  })
  useEffect(() => {
    try { localStorage.setItem('marginLevelPagePinnedColumns', JSON.stringify(pinnedColumns)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [pinnedColumns])
  const togglePinColumn = (key) =>
    setPinnedColumns(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  // Clear all filters on component mount (when navigating to this module)
  useEffect(() => {
    setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
    setActiveGroupFilter('marginlevel', null)
    setSearchInput('')
  }, [])

  // Sync numericMode with global display mode events
  useEffect(() => {
    const onChange = (e) => {
      const v = (e && e.detail) || localStorage.getItem('globalDisplayMode')
      if (v === 'full' || v === 'compact') setNumericMode(v)
    }
    window.addEventListener('globalDisplayModeChanged', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('globalDisplayModeChanged', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const fmtMoney = (v) => {
    const n = Number(v)
    if (!isFinite(n)) return '0.00'
    if (numericMode === 'compact') return formatCompactIndian(n)
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Listen for global request to open Customize View from child modals
  useEffect(() => {
    const handler = () => {
      setIsFilterOpen(false)
      setIsCustomizeOpen(true)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('openCustomizeView', handler)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('openCustomizeView', handler)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (pageChangeTimeoutRef.current) {
        clearTimeout(pageChangeTimeoutRef.current)
      }
    }
  }, [])

  const handlePageChange = (nextPage, maxPage) => {
    const safeMaxPage = Math.max(1, maxPage)
    const clampedPage = Math.min(safeMaxPage, Math.max(1, nextPage))
    if (clampedPage === currentPage) return

    setIsPageChanging(true)
    setCurrentPage(clampedPage)

    if (pageChangeTimeoutRef.current) {
      clearTimeout(pageChangeTimeoutRef.current)
    }
    pageChangeTimeoutRef.current = setTimeout(() => {
      setIsPageChanging(false)
    }, 180)
  }

  // First filter: margin level < 50% and exclude zero margin levels (same as desktop)
  const filteredByMarginLevel = useMemo(() => {
    return accounts.filter((a) => {
      const ml = getMarginLevelPercent(a)
      // Filter out zero margin levels and only show margin level < 50
      return ml !== undefined && ml !== 0 && ml < 50
    })
  }, [accounts])

  // Apply cumulative filters: Customize View -> IB -> Group
  const cumulativeFilteredAccounts = useMemo(() => {
    return applyCumulativeFilters(filteredByMarginLevel, {
      customizeFilters: filters,
      filterByActiveGroup,
      loginField: 'login',
      moduleName: 'marginlevel'
    })
  }, [filteredByMarginLevel, filters, filterByActiveGroup, activeGroupFilters])

  // Apply search
  const searchedAccounts = useMemo(() => {
    return applySearchFilter(cumulativeFilteredAccounts, searchInput, ['login', 'name', 'group'])
  }, [cumulativeFilteredAccounts, searchInput])

  // Use searched accounts as ibFilteredAccounts for compatibility
  const ibFilteredAccounts = searchedAccounts

  // Calculate summary statistics from the fully filtered data
  const summaryStats = useMemo(() => {
    const totalUnder50 = ibFilteredAccounts.length
    const avgMarginLevel = ibFilteredAccounts.length > 0
      ? ibFilteredAccounts.reduce((sum, acc) => sum + (getMarginLevelPercent(acc) || 0), 0) / ibFilteredAccounts.length
      : 0
    const uniqueLogins = new Set(ibFilteredAccounts.map(a => a.login)).size
    const loginsUnder50 = uniqueLogins

    return {
      totalUnder50,
      avgMarginLevel,
      uniqueLogins,
      loginsUnder50
    }
  }, [ibFilteredAccounts])

  // Sort the filtered accounts
  const sortedAccounts = useMemo(() => {
    if (!sortColumn) return ibFilteredAccounts

    // Special handling for marginLevel column
    if (sortColumn === 'marginLevel') {
      return [...ibFilteredAccounts].sort((a, b) => {
        const aVal = getMarginLevelPercent(a) || 0
        const bVal = getMarginLevelPercent(b) || 0
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      })
    }

    // Map column keys to actual data fields for sorting
    const columnKeyMapping = {
      'marginFree': 'margin_free'
    }
    const sortKey = columnKeyMapping[sortColumn] || sortColumn

    return applySorting(ibFilteredAccounts, sortKey, sortDirection)
  }, [ibFilteredAccounts, sortColumn, sortDirection])

  const handleSort = (columnKey) => {
    if (sortColumn === columnKey) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(columnKey)
      setSortDirection('asc')
    }
  }

  const cards = [
    { label: 'BELOW 50%', value: String(summaryStats.totalUnder50) },
    { label: 'AVG MARGIN LEVEL', value: formatNum(summaryStats.avgMarginLevel, 2) + '%' }
  ]
  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / itemsPerPage))
  useEffect(() => { setCurrentPage(page => Math.min(page, totalPages)) }, [totalPages])

  // Get visible columns
  const allColumns = [
    { key: 'login', label: 'Login', width: '80px', sticky: true },
    { key: 'name', label: 'Name', width: '120px' },
    { key: 'equity', label: 'Equity', width: '100px' },
    { key: 'margin', label: 'Margin', width: '100px' },
    { key: 'marginFree', label: 'Margin Free', width: '100px' },
    { key: 'marginLevel', label: 'Margin Level', width: '110px' },
    { key: 'profit', label: 'Profit', width: '100px' }
  ]

  const activeColumns = useMemo(() => {
    const visible = allColumns.filter(col => visibleColumns[col.key])
    // Apply saved order if present
    let ordered = visible
    if (Array.isArray(columnOrder) && columnOrder.length) {
      const map = new Map(visible.map(c => [c.key, c]))
      const out = []
      columnOrder.forEach(k => { if (map.has(k)) { out.push(map.get(k)); map.delete(k) } })
      map.forEach(c => out.push(c))
      ordered = out
    }
    // Pinned columns always render first so they sit at the left edge when sliding
    const isPinned = (c) => c.sticky || pinnedColumns.includes(c.key)
    return [...ordered.filter(isPinned), ...ordered.filter(c => !isPinned(c))]
  }, [visibleColumns, columnOrder, pinnedColumns])
  const gridTemplateColumns = activeColumns.map(col => col.width).join(' ')

  // Sticky left offsets for pinned columns, in display order
  const pinnedOffsets = useMemo(() => {
    const map = {}
    let offset = 0
    for (const col of activeColumns) {
      if (col.sticky || pinnedColumns.includes(col.key)) {
        map[col.key] = offset
        offset += parseInt(col.width, 10) || 100
      }
    }
    return map
  }, [activeColumns, pinnedColumns])
  const isColPinned = (col) => col.sticky || pinnedColumns.includes(col.key)

  const renderCellValue = (account, key, isSticky = false, stickyLeft = 0) => {
    let value = '-'

    switch (key) {
      case 'login':
        value = account.login || '-'
        return (
          <div 
            className={`h-[28px] flex items-center justify-start px-2 cursor-pointer hover:underline text-blue-600 font-semibold ${isSticky ? 'sticky bg-white z-10' : ''}`}
            style={{
              border: 'none', 
              outline: 'none', 
              boxShadow: isSticky ? '2px 0 4px rgba(0,0,0,0.05)' : 'none',
              ...(isSticky ? { left: `${stickyLeft}px` } : {})
            }}
            onClick={() => {
              const fullClient = clients.find(c => String(c.login) === String(account.login))
              setSelectedClient(fullClient || { login: account.login, email: account.email || '', name: account.name || '' })
            }}
          >
            <span className="truncate">{value}</span>
          </div>
        )
      case 'name':
        value = account.name || '-'
        break
      case 'group':
        value = account.group || '-'
        break
      case 'balance':
        value = fmtMoney(account.balance || 0)
        break
      case 'equity':
        value = fmtMoney(account.equity || 0)
        break
      case 'margin':
        value = fmtMoney(account.margin || 0)
        break
      case 'marginFree':
        value = fmtMoney(account.margin_free || account.marginFree || 0)
        break
      case 'marginLevel':
        {
const ml = getMarginLevelPercent(account)
        value = ml !== undefined ? formatNum(ml, 2) + '%' : '-'
        break
}
      case 'profit':
        value = fmtMoney(account.profit || 0)
        break
      case 'credit':
        value = fmtMoney(account.credit || 0)
        break
      case 'leverage':
        value = account.leverage || '-'
        break
      case 'currency':
        value = account.currency || '-'
        break
      default:
        value = account[key] || '-'
    }

    return (
      <div 
        className={`h-[28px] flex items-center justify-start px-2 ${isSticky ? 'sticky bg-white z-10' : ''}`}
        style={{
          border: 'none', 
          outline: 'none', 
          boxShadow: isSticky ? '2px 0 4px rgba(0,0,0,0.05)' : 'none',
          ...(isSticky ? { left: `${stickyLeft}px` } : {})
        }}
      >
        <span className="truncate">{value}</span>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden" style={{ height: 'var(--app-viewport-height, 100dvh)' }}>
      {/* Header */}
      <div className="flex-wrap flex items-center gap-3 px-4 pt-4 pb-2 bg-transparent relative">
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="w-12 h-12 flex-shrink-0 rounded-2xl bg-transparent border border-[#D5DEEA] flex items-center justify-center"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="#000000" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] leading-7 font-extrabold tracking-tight text-[#0F172A] truncate">Margin Level</h1>
            <p className="text-[12px] text-[#64748B] truncate">Accounts below 50% margin level</p>
          </div>
          <BrokerCreditSummary variant="header" />
        </div>
        {/* Hide profile avatar on mobile widths */}
        <div className="hidden md:flex w-12 h-12 rounded-full bg-blue-600 items-center justify-center ml-auto">
          <span className="text-white text-sm font-semibold">U</span>
        </div>
      


<BrokerCreditSummary variant="desktop-header" />
</div>

      {/* Sidebar Overlay */}
      {/* Shared mobile navigation drawer — one menu for every module (components/Sidebar.jsx) */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} onToggle={() => setIsSidebarOpen(value => !value)} mobileOnly />


      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-[10px] px-4 pt-3 pb-3">
          {cards.map((card, index) => <div key={card.label} className="min-w-0 h-[72px] rounded-[14px] bg-transparent border border-[#D5DEEA] p-2.5 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-[#2563EB]" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={index === 0 ? 'M5 20V10m7 10V4m7 16v-7M3 20h18' : 'M12 3a9 9 0 1 0 9 9M12 3v9h9'} /></svg>
              </span>
              <div className="truncate text-[11px] font-medium text-[#334155]">{card.label}</div>
            </div>
            <div className="truncate text-[14px] font-bold leading-[18px] text-[#0F172A]">{card.value}</div>
          </div>)}
        </div>

        {/* Action buttons row */}
        <div className="pt-1 pb-3 px-4">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsCustomizeOpen(true)} 
              className={`h-9 px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-all relative ${
                (filters.hasFloating || filters.hasCredit || filters.noDeposit || getActiveGroupFilter('marginlevel'))
                  ? 'bg-blue-50 border-blue-200' 
                  : 'bg-transparent border-[#D5DEEA] hover:bg-white/60'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4.5 6.5H9.5M2.5 3.5H11.5M5.5 9.5H8.5" stroke="#4B4B4B" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span className="text-[#1F2937] text-[11px] font-medium font-outfit">Filter</span>
              {(() => {
                const filterCount = [
                  filters.hasFloating,
                  filters.hasCredit,
                  filters.noDeposit,
                  getActiveGroupFilter('marginlevel')
                ].filter(Boolean).length;
                return filterCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {filterCount}
                  </span>
                ) : null;
              })()}
            </button>
            <button
              onClick={fetchMarginCallClients}
              disabled={loading.accounts}
              className="w-9 h-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="#4B4B4B" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>


        {/* Navigation */}
        <div className="flex items-center gap-1.5 px-4 pb-3">
          <div className="relative min-w-[100px] flex-1">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>
            <input
                  type="search" name="no-autofill-search" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-form-type="other" readOnly onPointerDown={e => e.currentTarget.removeAttribute('readonly')} onFocus={e => e.currentTarget.removeAttribute('readonly')} aria-label="Search margin level accounts" placeholder="Search by login, name..." value={searchInput} onChange={event => { setSearchInput(event.target.value); setCurrentPage(1) }} className="h-10 w-full rounded-xl border border-[#D5DEEA] bg-transparent pl-9 pr-8 text-[13px] text-[#1F2937] placeholder-[#9CA3AF] outline-none" />
            {searchInput && <button type="button" aria-label="Clear search" onClick={() => { setSearchInput(''); setCurrentPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18"/></svg></button>}
          </div>
          <button type="button" aria-label="Show or hide columns" onClick={() => setIsColumnSelectorOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#D5DEEA] bg-transparent text-slate-500"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 4v16M15 4v16"/></svg></button>
          <div className="flex shrink-0 items-center gap-1.5">
            <button 
              onClick={() => handlePageChange(currentPage - 1, totalPages)}
              disabled={currentPage === 1}
              className="w-9 h-10 bg-transparent border border-[#D5DEEA] rounded-xl flex items-center justify-center transition-colors flex-shrink-0 hover:bg-white/60 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M12 14L8 10L12 6" stroke="#4B4B4B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div className="text-[13px] font-medium text-[#475569] flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={totalPages}
                value={currentPage}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  const maxPage = totalPages
                  if (!isNaN(n) && n >= 1 && n <= maxPage) {
                    handlePageChange(n, maxPage)
                  }
                }}
                className="w-10 h-10 bg-[#2563EB] text-white font-semibold border border-[#2563EB] rounded-xl text-center text-[13px] shadow-[0_4px_10px_rgba(37,99,235,0.3)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label="Current page"
              />
              <span className="text-[#9CA3AF]">/</span>
              <span>{totalPages}</span>
            </div>
            <button 
              onClick={() => handlePageChange(currentPage + 1, totalPages)}
              disabled={currentPage >= totalPages}
              className="w-9 h-10 bg-transparent border border-[#D5DEEA] rounded-xl flex items-center justify-center transition-colors flex-shrink-0 hover:bg-white/60 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M8 6L12 10L8 14" stroke="#4B4B4B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>



        {/* Table */}
        <div>
          <div className="bg-transparent border border-blue-100 max-md:border-b-0 overflow-hidden">
            <div className="mobile-table-scroll w-full overflow-x-auto overflow-y-auto scrollbar-hide" style={{
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              maxHeight: 'max(152px, calc(var(--app-viewport-height, 100dvh) - 280px))'
            }}>
              <div className="relative" style={{ minWidth: 'max-content' }}>
                {/* Table Header */}
                <div data-mobile-data-row="header" 
                  className="grid bg-blue-500 text-white text-[10px] font-semibold font-outfit sticky top-0 z-20 shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
                  style={{
                    gap: '0px', 
                    gridGap: '0px', 
                    columnGap: '0px',
                    gridTemplateColumns
                  }}
                >
                  {activeColumns.map(col => (
                    <div 
                      key={col.key} 
                      onClick={() => handleSort(col.key)}
                      className={`h-[28px] flex items-center justify-start px-2 cursor-pointer ${isColPinned(col) ? 'sticky bg-blue-500 z-30' : ''}`}
                      style={{
                        border: 'none', 
                        outline: 'none', 
                        boxShadow: isColPinned(col) ? '2px 0 4px rgba(0,0,0,0.08)' : 'none',
                        WebkitTapHighlightColor: 'transparent',
                        userSelect: 'none',
                        touchAction: 'manipulation',
                        ...(isColPinned(col) ? { left: `${pinnedOffsets[col.key] || 0}px` } : {})
                      }}
                    >
                      <span>{col.label}</span>
                      {sortColumn === col.key && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                          <path 
                            d={sortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} 
                            stroke="white" 
                            strokeWidth="2" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>

                {/* Table Rows */}
                {(loading && loading.clients && accounts.length === 0) || isPageChanging ? (
                  // YouTube-style skeleton loading (only on first load)
                  <>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                      <div data-mobile-data-row="body" 
                        key={`skeleton-row-${i}`}
                        className="grid text-[10px] text-[#4B4B4B] font-outfit bg-transparent border-b border-[#E1E1E1]"
                        style={{
                          gap: '0px', 
                          gridGap: '0px', 
                          columnGap: '0px',
                          gridTemplateColumns
                        }}
                      >
                        {activeColumns.map((col) => (
                          <div 
                            key={col.key}
                            className={`h-[28px] flex items-center justify-start px-2 ${isColPinned(col) ? 'sticky bg-white z-10' : ''}`}
                            style={{border: 'none', outline: 'none', boxShadow: isColPinned(col) ? '2px 0 4px rgba(0,0,0,0.05)' : 'none', ...(isColPinned(col) ? { left: `${pinnedOffsets[col.key] || 0}px` } : {})}}
                          >
                            <div 
                              className="h-3 w-full max-w-[80%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded"
                              style={{
                                backgroundSize: '200% 100%',
                                animation: 'shimmer 1.5s infinite'
                              }}
                            ></div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                ) : (
                  sortedAccounts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((account, idx) => (
                  <div data-mobile-data-row="body" 
                    key={idx} 
                    className="grid text-[10px] text-[#4B4B4B] font-outfit bg-transparent border-b border-[#E1E1E1] hover:bg-white/50 transition-colors"
                    style={{
                      gap: '0px', 
                      gridGap: '0px', 
                      columnGap: '0px',
                      gridTemplateColumns
                    }}
                  >
                    {activeColumns.map(col => (
                      <React.Fragment key={col.key}>
                        {renderCellValue(account, col.key, isColPinned(col), pinnedOffsets[col.key] || 0)}
                      </React.Fragment>
                    ))}
                  </div>
                  ))
                )}

                {/* Total Row removed for mobile view */}

                {/* Empty state */}
                {sortedAccounts.length === 0 && !loading?.clients && (
                  <div className="sticky left-0 w-[calc(100vw-2px)] whitespace-normal px-4 py-8 text-center text-xs text-[#9CA3AF]">
                    No accounts under 50% margin level
                  </div>
                )}
                <div aria-hidden="true" className="mobile-table-end" />
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Bottom Navigation */}
      <MobileBottomNav onMore={() => setIsSidebarOpen(true)} />

      {/* Column Selector Modal */}
      {isColumnSelectorOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setIsColumnSelectorOpen(false)}>
          {/* Scoped restyle of the shared ColumnChooserList to match the mobile theme */}
          <style>{`
            .c2-col-chooser > div > div { border-color: #D5DEEA !important; }
            .c2-col-chooser input[type="text"] { background: transparent !important; border-color: #D5DEEA !important; border-radius: 12px !important; height: 40px; font-size: 13px !important; }
            .c2-col-chooser input[type="checkbox"] { width: 16px !important; height: 16px !important; accent-color: #2563EB; border-radius: 4px; }
            .c2-col-chooser .overscroll-contain > [data-col-key] { padding-top: 10px; padding-bottom: 10px; margin-left: 12px; margin-right: 12px; border-radius: 0; border-bottom: 1px solid rgba(213, 222, 234, 0.6); }
            .c2-col-chooser .overscroll-contain > [data-col-key] label span { font-size: 13px !important; color: #1F2937 !important; }
          `}</style>
          <div
            className="bg-white w-full rounded-t-[28px] flex flex-col overflow-hidden shadow-[0_-8px_30px_rgba(15,23,42,0.12)]"
            style={{ maxHeight: '85dvh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pt-2.5 flex justify-center flex-shrink-0"><span className="w-10 h-1 rounded-full bg-[#CBD5E1]" /></div>
            <div className="px-5 pt-3 pb-3 border-b border-[#D5DEEA] flex items-center justify-between gap-3 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-[18px] leading-6 font-extrabold tracking-tight text-[#0F172A] truncate">Columns</h3>
                <p className="text-[12px] text-[#64748B] truncate">Show, hide, pin & reorder columns</p>
              </div>
              <button onClick={() => setIsColumnSelectorOpen(false)} aria-label="Close" className="w-10 h-10 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="#0F172A" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="c2-col-chooser flex-1 min-h-0 flex flex-col">
              <ColumnChooserList
                columns={allColumns.map(({ key, label }) => ({ key, label }))}
                visibleColumns={visibleColumns}
                onToggle={(key) => setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))}
                columnOrder={columnOrder}
                onReorder={setColumnOrder}
                onResetOrder={resetColumnOrder}
                accent="blue"
                title={null}
                pinnedColumns={pinnedColumns}
                onPinToggle={togglePinColumn}
                reorderMode="touch"
              />
            </div>
          </div>
        </div>
      )}

      {/* CustomizeView Modal */}
      <CustomizeViewModal
        isOpen={isCustomizeOpen}
        onClose={() => setIsCustomizeOpen(false)}
        onFilterClick={() => {
          setIsCustomizeOpen(false)
          setIsFilterOpen(true)
        }}
        onReset={() => {
          setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
          setHasPendingFilterChanges(false)
          setPendingFilterDraft(null)
        }}
        onApply={() => {
          if (hasPendingFilterChanges && pendingFilterDraft) {
            setFilters(pendingFilterDraft)
          }
          setIsCustomizeOpen(false)
          setHasPendingFilterChanges(false)
          setPendingFilterDraft(null)
        }}
        hasPendingChanges={hasPendingFilterChanges}
      />

      {/* Filter Modal */}
      <FilterModal
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        onApply={(newFilters) => {
          setFilters(newFilters)
          setIsFilterOpen(false)
          setHasPendingFilterChanges(false)
          setPendingFilterDraft(null)
        }}
        filters={filters}
        onPendingChange={(hasPending, draft) => {
          setHasPendingFilterChanges(hasPending)
          setPendingFilterDraft(draft || null)
        }}
      />

      {/* Group Modal */}
      {/* Client Details Modal */}
      {selectedClient && (
        <ClientDetailsMobileModal
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          allPositionsCache={positions}
          allOrdersCache={orders}
        />
      )}
    </div>
  )
}
