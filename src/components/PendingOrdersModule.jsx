import Sidebar from './Sidebar'
import BrokerCreditSummary from './BrokerCreditSummary'
import MobileBottomNav from './MobileBottomNav'
import { createLatestRequest } from '../utils/latestRequest'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { AskAiIcon, ReportsIcon, ReportSubIcon, TutorialIcon, BrokerageCalcIcon } from './ReportIcons'
import { useData } from '../contexts/dataContextStore'
import { brokerAPI } from '../services/api'
import CustomizeViewModal from './CustomizeViewModal'
import FilterModal from './FilterModal'
import GroupModal from './GroupModal'
import LoginGroupsModal from './LoginGroupsModal'
import LoginGroupModal from './LoginGroupModal'
import ClientDetailsMobileModal from './ClientDetailsMobileModal'
import ColumnChooserList from './ColumnChooserList'
import { useGroups } from '../contexts/groupContextStore'
import { applyCumulativeFilters } from '../utils/mobileFilters'
import { formatTime as apiFormatTime } from '../utils/dateFormatter'

const formatNum = (n, decimals = 2) => {
  const v = Number(n || 0)
  if (!isFinite(v)) return '0.00'
  return v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// Match the API precision per order, including zero-decimal instruments.
const getOrderPriceDigits = (order) => {
  const raw = order.digits ?? order.digit ?? order.priceDigits
  if (raw == null || String(raw).trim() === '') return 3
  const digits = Number(raw)
  return Number.isInteger(digits) && digits >= 0 && digits <= 20 ? digits : 3
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

const formatTime = (ts) => apiFormatTime(ts, '-')

export default function PendingOrdersModule() {
  const { orders, clients, rawClients, loading, positions } = useData()
  const { groups, deleteGroup, getActiveGroupFilter, setActiveGroupFilter, filterByActiveGroup, getGroupLogins, activeGroupFilters } = useGroups()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [numericMode, setNumericMode] = useState(() => { try { const s = localStorage.getItem('globalDisplayMode'); return s === 'full' ? 'full' : 'compact' } catch { return 'compact' } })

  const [searchInput, setSearchInput] = useState('')
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isGroupOpen, setIsGroupOpen] = useState(false)
  const [isLoginGroupsOpen, setIsLoginGroupsOpen] = useState(false)
  const [isLoginGroupModalOpen, setIsLoginGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [filters, setFilters] = useState({ hasFloating: false, hasCredit: false, noDeposit: false })
    // Pending apply tracking
    const [hasPendingGroupChanges, setHasPendingGroupChanges] = useState(false)
    const [pendingGroupDraft, setPendingGroupDraft] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  // Ref so polling closure can skip while the client detail modal is open
  const selectedClientRef = useRef(null)
  useEffect(() => { selectedClientRef.current = selectedClient }, [selectedClient])
  const carouselRef = useRef(null)
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [isPageChanging, setIsPageChanging] = useState(false)
  const pageChangeTimeoutRef = useRef(null)
  const itemsPerPage = 15
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')

  // Server totals from API (for face cards — same approach as desktop)
  const [serverTotals, setServerTotals] = useState({ totalOrders: 0, uniqueLogins: 0, volumeCurrent: 0, volumeInitial: 0 })
  const hasFetchedServerTotalsRef = useRef(false)
  const [serverOrders, setServerOrders] = useState([])
  const [serverTotalOrders, setServerTotalOrders] = useState(0)
  const [hasFetchedOrders, setHasFetchedOrders] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const initialLoadDoneRef = useRef(false)
  const minTimerDoneRef = useRef(false)
  const [visibleColumns, setVisibleColumns] = useState({
    login: true,
    timeSetup: true,
    order: true,
    symbol: true,
    type: true,
    volume: true,
    priceOrder: true,
    priceTrigger: false,
    priceSL: false,
    priceTP: false,
    state: false
  })

  // Column order (persisted) — same key as desktop Pending Orders page so both stay in sync
  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pendingOrdersPageColumnOrder'))
      if (Array.isArray(saved)) return saved
    } catch { /* Retain the fallback when this operation is unavailable. */ }
    return null
  })
  useEffect(() => {
    try { if (columnOrder) localStorage.setItem('pendingOrdersPageColumnOrder', JSON.stringify(columnOrder)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [columnOrder])
  const resetColumnOrder = () => {
    setColumnOrder(null)
    try { localStorage.removeItem('pendingOrdersPageColumnOrder') } catch { /* Retain the fallback when this operation is unavailable. */ }
  }

  // Pinned (frozen) columns — persisted, default keeps Login frozen like desktop
  const [pinnedColumns, setPinnedColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pendingOrdersPagePinnedColumns'))
      return Array.isArray(saved) ? saved : ['login']
    } catch { return ['login'] }
  })
  useEffect(() => {
    try { localStorage.setItem('pendingOrdersPagePinnedColumns', JSON.stringify(pinnedColumns)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [pinnedColumns])
  const togglePinColumn = (key) =>
    setPinnedColumns(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  // Clear all filters on component mount (when navigating to this module)
  useEffect(() => {
    setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
    setActiveGroupFilter('pendingorders', null)
    setSearchInput('')
  }, [])

  // Minimum 600ms skeleton on initial load
  useEffect(() => {
    const timer = setTimeout(() => {
      minTimerDoneRef.current = true
      if (initialLoadDoneRef.current) setIsInitialLoading(false)
    }, 600)
    return () => clearTimeout(timer)
  }, [])

  // Reset pagination when active group changes
  useEffect(() => {
    setCurrentPage(1)
  }, [getActiveGroupFilter('pendingorders')])

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

  const fmtCount = (v) => {
    const n = Number(v)
    if (!isFinite(n)) return '0'
    if (numericMode === 'compact') return formatCompactIndian(n)
    return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  }



  // Listen for global request to open Customize View from child modals
  useEffect(() => {
    const handler = () => {
      setIsFilterOpen(false)
      setIsLoginGroupsOpen(false)
      setIsLoginGroupModalOpen(false)
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

  // Poll server every 2s — mirrors PendingOrdersPage.jsx desktop behaviour exactly
  useEffect(() => {
    let isCancelled = false
    let timer = null
    let controller = new AbortController()

    const requestGate = createLatestRequest()
    const poll = async () => {
      const isCurrent = requestGate.start()
      if (isCancelled || !isCurrent()) return
      // Pause polling while client detail modal is open
      if (selectedClientRef.current) { if (!isCancelled && isCurrent()) timer = setTimeout(poll, 2000); return }
      try {
        const params = {
          page: currentPage,
          limit: itemsPerPage,
          sortBy: sortColumn || 'timeSetup',
          sortOrder: sortDirection || 'desc'
        }
        if (searchInput && searchInput.trim()) params.search = searchInput.trim()

        // Apply active group filter as a server-side login filter (works across pages)
        const activeGroupName = getActiveGroupFilter('pendingorders')
        if (activeGroupName) {
          const groupLogins = getGroupLogins(activeGroupName).map(l => Number(l)).filter(n => !Number.isNaN(n))
          params.filters = [
            { field: 'login', operator: 'in', value: groupLogins.length > 0 ? groupLogins : [-1] }
          ]
        }

        const response = await brokerAPI.searchOrders(params, { signal: controller.signal })
        if (isCancelled || !isCurrent()) return
        const data = response?.data?.orders || response?.data?.positions || response?.orders || []
        const total = response?.data?.total || response?.total || 0
        const totals = response?.data?.totals || response?.totals || null
        if (Array.isArray(data)) {
          setServerOrders(data)
          setServerTotalOrders(total)
          if (totals) {
            setServerTotals({
              totalOrders: total,
              uniqueLogins: totals.uniqueLogins ?? 0,
              volumeCurrent: totals.volumeCurrent ?? 0,
              volumeInitial: totals.volumeInitial ?? 0
            })
            hasFetchedServerTotalsRef.current = true
          }
          setHasFetchedOrders(true)
          if (!initialLoadDoneRef.current) {
            initialLoadDoneRef.current = true
            if (minTimerDoneRef.current) setIsInitialLoading(false)
          }
        }
      } catch (err) {
        if ((!isCancelled && isCurrent()) && err?.code !== 'ERR_CANCELED' && err?.message !== 'canceled') {
          console.warn('[PendingOrdersModule] Polling error:', err?.message)
        }
      }
      if (!isCancelled && isCurrent()) timer = setTimeout(poll, 2000)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') { if (!timer && !isCancelled) poll() }
      else if (timer) { clearTimeout(timer); timer = null }
    }

    if (document.visibilityState === 'visible') poll()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      isCancelled = true
      controller.abort()
      if (timer) { clearTimeout(timer); timer = null }
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [currentPage, itemsPerPage, sortColumn, sortDirection, searchInput, activeGroupFilters, getActiveGroupFilter, getGroupLogins])

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

  // Build a login→client map from all available sources so name shows immediately on click
  const clientNameMap = useMemo(() => {
    const map = new Map()
    rawClients.forEach(c => { if (c?.login) map.set(String(c.login), c) })
    clients.forEach(c => { if (c?.login && (c.name || c.fullName)) map.set(String(c.login), c) })
    return map
  }, [rawClients, clients])

  // Apply cumulative filters: Customize View -> IB -> Group
  const ibFilteredOrders = useMemo(() => {
    return applyCumulativeFilters(orders, {
      customizeFilters: filters,
      filterByActiveGroup,
      loginField: 'login',
      moduleName: 'pendingorders'
    })
  }, [orders, filters, filterByActiveGroup, activeGroupFilters])

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const totalOrders = ibFilteredOrders.length
    const uniqueLogins = new Set(ibFilteredOrders.map(o => o.login)).size
    const uniqueSymbols = new Set(ibFilteredOrders.map(o => o.symbol)).size
    const totalVolume = ibFilteredOrders.reduce((sum, o) => sum + (o.volumeCurrent || o.volume || 0), 0)
    const volumeCurrent = ibFilteredOrders.reduce((sum, o) => sum + (o.volumeCurrent || o.volume || 0), 0)
    const volumeInitial = ibFilteredOrders.reduce((sum, o) => sum + (o.volumeInitial || o.volumeCurrent || o.volume || 0), 0)

    return {
      totalOrders,
      uniqueLogins,
      uniqueSymbols,
      totalVolume,
      volumeCurrent,
      volumeInitial
    }
  }, [ibFilteredOrders])

  // Filter orders based on search
  const filteredOrders = useMemo(() => {
    let filtered = ibFilteredOrders.filter(order => {
      if (!searchInput.trim()) return true
      const query = searchInput.toLowerCase()
      return (
        String(order.login || '').toLowerCase().includes(query) ||
        String(order.symbol || '').toLowerCase().includes(query) ||
        String(order.order || order.ticket || '').toLowerCase().includes(query)
      )
    })

    // Apply sorting
    if (sortColumn) {
      // Map column keys to actual data fields for sorting
      const columnKeyMapping = {
        'volume': 'volumeCurrent',
        'priceOrder': 'priceOrder',
        'priceTrigger': 'priceTrigger',
        'priceSL': 'priceSL',
        'priceTP': 'priceTP',
        'timeSetup': 'timeSetup'
      }

      const sortKey = columnKeyMapping[sortColumn] || sortColumn

      filtered.sort((a, b) => {
        // Get values with fallbacks for certain fields
        let aVal, bVal

        if (sortColumn === 'volume') {
          aVal = a.volumeCurrent || a.volume
          bVal = b.volumeCurrent || b.volume
        } else if (sortColumn === 'priceOrder') {
          aVal = a.priceOrder || a.price
          bVal = b.priceOrder || b.price
        } else if (sortColumn === 'priceTrigger') {
          aVal = a.priceTrigger || a.trigger
          bVal = b.priceTrigger || b.trigger
        } else if (sortColumn === 'priceSL') {
          aVal = a.priceSL || a.sl
          bVal = b.priceSL || b.sl
        } else if (sortColumn === 'priceTP') {
          aVal = a.priceTP || a.tp
          bVal = b.priceTP || b.tp
        } else if (sortColumn === 'timeSetup') {
          aVal = a.timeSetup || a.timeUpdate || a.timeCreate
          bVal = b.timeSetup || b.timeUpdate || b.timeCreate
        } else {
          aVal = a[sortKey]
          bVal = b[sortKey]
        }

        if (aVal == null && bVal == null) return 0
        if (aVal == null) return 1
        if (bVal == null) return -1

        const aNum = Number(aVal)
        const bNum = Number(bVal)
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
        }

        const aStr = String(aVal).toLowerCase()
        const bStr = String(bVal).toLowerCase()
        if (sortDirection === 'asc') {
          return aStr.localeCompare(bStr)
        } else {
          return bStr.localeCompare(aStr)
        }
      })
    }

    return filtered
  }, [ibFilteredOrders, searchInput, sortColumn, sortDirection])

  const handleSort = (columnKey) => {
    if (sortColumn === columnKey) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(columnKey)
      setSortDirection('asc')
    }
  }

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [ibFilteredOrders.length, searchInput])

  // Use server-polled orders for table when available (same as desktop), fallback to WS cache
  const displayOrders = hasFetchedOrders ? serverOrders : filteredOrders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
  const totalPages = hasFetchedOrders
    ? Math.max(1, Math.ceil(serverTotalOrders / itemsPerPage))
    : Math.max(1, Math.ceil(filteredOrders.length / itemsPerPage))

  // Face cards data - matching desktop layout with persistent state
  const [cards, setCards] = useState([])

  // Map card labels to icon file paths
  const getCardIcon = (label) => {
    const baseUrl = import.meta.env.BASE_URL || '/'
    const iconMap = {
      'TOTAL ORDERS': `${baseUrl}mobile-icons/Total Orders.svg`,
      'UNIQUE LOGINS': `${baseUrl}mobile-icons/Unique Logins.svg`,
      'VOLUME CURRENT': `${baseUrl}mobile-icons/Volume Current.svg`,
      'VOLUME INITIAL': `${baseUrl}mobile-icons/Volume Initial.svg`
    }
    return iconMap[label] || `${baseUrl}mobile-icons/Clients.svg`
  }

  // Update cards when summary stats change
  useEffect(() => {
    // Prefer server totals (API) when available, fall back to client-side sums
    const totalOrders = hasFetchedServerTotalsRef.current ? serverTotals.totalOrders : summaryStats.totalOrders
    const uniqueLogins = hasFetchedServerTotalsRef.current ? serverTotals.uniqueLogins : summaryStats.uniqueLogins
    const volumeCurrent = hasFetchedServerTotalsRef.current ? serverTotals.volumeCurrent : summaryStats.volumeCurrent
    const volumeInitial = hasFetchedServerTotalsRef.current ? serverTotals.volumeInitial : summaryStats.volumeInitial

    const newCards = [
      { label: 'TOTAL ORDERS', value: fmtCount(totalOrders) },
      { label: 'UNIQUE LOGINS', value: fmtCount(uniqueLogins) },
      { label: 'VOLUME CURRENT', value: fmtMoney(volumeCurrent) },
      { label: 'VOLUME INITIAL', value: fmtMoney(volumeInitial) }
    ]

    // Only update if cards length is different (initial load) or keep existing order
    if (cards.length === 0) {
      setCards(newCards)
    } else {
      // Update values while preserving order
      setCards(prevCards => {
        return prevCards.map(prevCard => {
          const updated = newCards.find(c => c.label === prevCard.label)
          return updated || prevCard
        })
      })
    }
  }, [summaryStats, serverTotals, numericMode])

  // Get visible columns
  const allColumns = [
    { key: 'login', label: 'Login', width: '80px', sticky: true },
    { key: 'timeSetup', label: 'Time', width: '140px' },
    { key: 'order', label: 'Order', width: '80px' },
    { key: 'symbol', label: 'Symbol', width: '100px' },
    { key: 'type', label: 'Type', width: '80px' },
    { key: 'volume', label: 'Volume', width: '80px' },
    { key: 'priceOrder', label: 'Price', width: '100px' },
    { key: 'priceTrigger', label: 'Trigger', width: '100px' },
    { key: 'priceSL', label: 'S/L', width: '100px' },
    { key: 'priceTP', label: 'T/P', width: '100px' },
    { key: 'state', label: 'State', width: '80px' }
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

  const renderCellValue = (order, key, isSticky = false, stickyLeft = 0) => {
    let value = '-'

    switch (key) {
      case 'login':
        value = order.login || '-'
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
              const fullClient = clientNameMap.get(String(order.login)) || clients.find(c => String(c.login) === String(order.login))
              setSelectedClient(fullClient || { login: order.login, email: order.email || '', name: '' })
            }}
          >
            <span className="truncate">{value}</span>
          </div>
        )
      case 'order':
        value = order.order || order.ticket || '-'
        break
      case 'symbol':
        value = order.symbol || '-'
        break
      case 'type':
        {
value = order.type || '-'
        const isBuy = value.toUpperCase().includes('BUY')
        const isSell = value.toUpperCase().includes('SELL')
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
            <span className={`px-2 py-0.5 text-[9px] font-semibold ${
              isBuy ? 'bg-green-100 text-green-700' : 
              isSell ? 'bg-red-100 text-red-700' : 
              'bg-gray-100 text-gray-700'
            }`}>
              {value}
            </span>
          </div>
        )
}
      case 'volume':
        value = fmtMoney(order.volumeCurrent || order.volume || 0)
        break
      case 'priceOrder':
        value = formatNum(order.priceOrder ?? order.price ?? 0, getOrderPriceDigits(order))
        break
      case 'priceTrigger':
        value = formatNum(order.priceTrigger ?? order.trigger ?? 0, getOrderPriceDigits(order))
        break
      case 'priceSL':
        value = formatNum(order.priceSL ?? order.sl ?? 0, getOrderPriceDigits(order))
        break
      case 'priceTP':
        value = formatNum(order.priceTP ?? order.tp ?? 0, getOrderPriceDigits(order))
        break
      case 'timeSetup':
        value = formatTime(order.timeSetup || order.timeUpdate || order.timeCreate || order.timeSetupStr || order.timeUpdateStr || order.timeCreateStr)
        break
      case 'state':
        value = order.state || '-'
        break
      default:
        value = order[key] || '-'
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
            <h1 className="text-[22px] leading-7 font-extrabold tracking-tight text-[#0F172A] truncate">Pending Orders</h1>
            <p className="text-[12px] text-[#64748B] truncate">Monitor all pending orders</p>
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
        {/* Face Cards Carousel */}
        <div className="pt-3 pb-1 pl-4">
          <div 
            ref={carouselRef}
            className="flex gap-[10px] overflow-x-auto scrollbar-hide snap-x snap-mandatory pr-4 pb-2"
          >
            {cards.map((card, i) => (
              <div 
                key={i}
                draggable="true"
                onDragStart={(e) => {
                  e.dataTransfer.setData('cardIndex', i)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const fromIndex = parseInt(e.dataTransfer.getData('cardIndex'))
                  if (fromIndex !== i && !isNaN(fromIndex)) {
                    const newCards = [...cards]
                    const [movedCard] = newCards.splice(fromIndex, 1)
                    newCards.splice(i, 0, movedCard)
                    setCards(newCards)
                  }
                }}
                style={{
                  boxSizing: 'border-box',
                  minWidth: '132px',
                  width: '132px',
                  height: '72px',
                  background: 'transparent',
                  border: '1px solid #D5DEEA',
                  boxShadow: 'none',
                  borderRadius: '14px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  scrollSnapAlign: 'start',
                  flexShrink: 0,
                  flex: 'none',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  touchAction: 'pan-x'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: card.isProfit ? (card.profitValue > 0 ? '#DCFCE7' : card.profitValue < 0 ? '#FEE2E2' : '#DBEAFE') : '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: '5px' }}>
                    <img src={getCardIcon(card.label)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'brightness(0) saturate(100%) invert(27%) sepia(97%) saturate(1500%) hue-rotate(213deg) brightness(100%)' }} onError={(e) => { e.target.style.display = 'none' }} />
                  </div>
                  <span style={{ color: '#334155', fontSize: '11px', fontWeight: 500, lineHeight: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minHeight: '16px', pointerEvents: 'none' }}>
                  <span style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    lineHeight: '18px',
                    letterSpacing: '-0.01em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: card.isProfit ? (card.profitValue >= 0 ? '#16A34A' : '#DC2626') : '#000000'
                  }}>
                    {card.value === '' || card.value === undefined ? '0.00' : card.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons row */}
        <div className="pt-2 pb-3 px-4">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsCustomizeOpen(true)} 
              className={`h-9 px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-all relative ${
                (filters.hasFloating || filters.hasCredit || filters.noDeposit || getActiveGroupFilter('pendingorders'))
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
                  getActiveGroupFilter('pendingorders')
                ].filter(Boolean).length;
                return filterCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {filterCount}
                  </span>
                ) : null;
              })()}
            </button>
            <button 
              onClick={() => window.location.reload()}
              disabled={loading.orders}
              className="w-9 h-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="#4B4B4B" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search and navigation */}
        <div className="mx-4 mb-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex-1 min-w-0 h-10 bg-transparent border border-[#D5DEEA] rounded-xl px-3 flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 text-[#9CA3AF]">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M13 13L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input
                  type="search" name="no-autofill-search" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-form-type="other" readOnly onPointerDown={e => e.currentTarget.removeAttribute('readonly')} onFocus={e => e.currentTarget.removeAttribute('readonly')} 
                placeholder="Search by login, order, symbol..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="flex-1 min-w-0 text-[13px] sm:text-sm text-[#1F2937] placeholder-[#9CA3AF] outline-none bg-transparent font-outfit focus:ring-0"
              />
            </div>
            <button 
              onClick={() => setIsColumnSelectorOpen(true)}
              className="h-10 w-10 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-colors"
              title="Show/Hide Columns">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="4" height="10" rx="1" stroke="#4B5563" strokeWidth="1.2"/>
                <rect x="8" y="3" width="6" height="10" rx="1" stroke="#4B5563" strokeWidth="1.2"/>
              </svg>
            </button>
            <button 
              onClick={() => handlePageChange(currentPage - 1, totalPages)}
              disabled={currentPage === 1}
              className="h-10 w-9 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path d="M12 14L8 10L12 6" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                  if (!isNaN(n) && n >= 1 && n <= totalPages) {
                    handlePageChange(n, totalPages)
                  }
                }}
                className="w-10 h-10 bg-[#2563EB] text-white font-semibold border border-[#2563EB] rounded-xl text-center text-[13px] shadow-[0_4px_10px_rgba(37,99,235,0.3)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label="Current page"
              />
              <span className="text-[#9CA3AF]">/</span>
              <span className="text-[#6B7280]">{totalPages}</span>
            </div>
            <button 
              onClick={() => handlePageChange(currentPage + 1, totalPages)}
              disabled={currentPage >= totalPages}
              className="h-10 w-9 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path d="M8 6L12 10L8 14" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="">
          <div className="bg-transparent border border-blue-100 max-md:border-b-0 overflow-hidden">
            <div className="mobile-table-scroll w-full overflow-x-auto overflow-y-auto scrollbar-hide" style={{
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              paddingRight: '8px',
              paddingBottom: '8px',
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
                      className={`h-[28px] flex items-center justify-start px-1 cursor-pointer ${isColPinned(col) ? 'sticky bg-blue-500 z-30' : ''}`}
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
                {isInitialLoading || (loading && loading.orders) || isPageChanging ? (
                  // YouTube-style skeleton loading
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
                            className={`h-[38px] flex items-center justify-center px-1 ${isColPinned(col) ? 'sticky bg-white z-10' : ''}`}
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
                  displayOrders.map((order, idx) => (
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
                        {renderCellValue(order, col.key, isColPinned(col), pinnedOffsets[col.key] || 0)}
                      </React.Fragment>
                    ))}
                  </div>
                  ))
                )}

                {/* Total Row removed for mobile view */}

                {/* Empty state */}
                {displayOrders.length === 0 && !loading?.orders && !isInitialLoading && (
                  <div className="text-center py-8 text-[#9CA3AF] text-sm">
                    No pending orders found
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
        onGroupsClick={() => {
          setIsCustomizeOpen(false)
          setIsLoginGroupsOpen(true)
        }}
        onReset={() => {
          setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
          setActiveGroupFilter('pendingorders', null)
          setHasPendingGroupChanges(false)
          setPendingGroupDraft(null)
        }}
        onApply={() => {
          if (hasPendingGroupChanges) {
            setActiveGroupFilter('pendingorders', pendingGroupDraft ? pendingGroupDraft.name : null)
          }
          setIsCustomizeOpen(false)
          setHasPendingGroupChanges(false)
          setPendingGroupDraft(null)
        }}
        hasPendingChanges={hasPendingGroupChanges}
      />

      {/* Filter Modal */}
      <FilterModal
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        onApply={(newFilters) => {
          setFilters(newFilters)
          setIsFilterOpen(false)
        }}
        filters={filters}
      />

      {/* Group Modal */}
      <GroupModal
        isOpen={isGroupOpen}
        onClose={() => setIsGroupOpen(false)}
        availableItems={ibFilteredOrders}
        loginField="login"
        displayField="symbol"
      />

      {/* Login Groups Modal */}
      <LoginGroupsModal
        isOpen={isLoginGroupsOpen}
        onClose={() => setIsLoginGroupsOpen(false)}
        groups={groups.map(g => ({
          ...g,
          loginCount: g.range 
            ? (g.range.to - g.range.from + 1) 
            : g.loginIds.length
        }))}
        activeGroupName={getActiveGroupFilter('pendingorders')}
        onSelectGroup={(group) => {
          if (group === null) {
            setActiveGroupFilter('pendingorders', null)
          } else {
            setActiveGroupFilter('pendingorders', group.name)
          }
          setIsLoginGroupsOpen(false)
          setHasPendingGroupChanges(false)
          setPendingGroupDraft(null)
        }}
        onCreateGroup={() => {
          setIsLoginGroupsOpen(false)
          setEditingGroup(null)
          setIsLoginGroupModalOpen(true)
        }}
        onEditGroup={(group) => {
          setIsLoginGroupsOpen(false)
          setEditingGroup(group)
          setIsLoginGroupModalOpen(true)
        }}
        onDeleteGroup={(group) => {
          deleteGroup(group.name)
        }}
        onPendingChange={(hasPending, draftName) => {
          setHasPendingGroupChanges(hasPending)
          setPendingGroupDraft(draftName ? { name: draftName } : null)
        }}
      />

      {/* Login Group Modal */}
      <LoginGroupModal
        isOpen={isLoginGroupModalOpen}
        onClose={() => {
          setIsLoginGroupModalOpen(false)
          setEditingGroup(null)
        }}
        onSave={() => {
          setIsLoginGroupModalOpen(false)
          setEditingGroup(null)
          setIsLoginGroupsOpen(true)
        }}
        onBack={() => {
          setIsLoginGroupsOpen(true)
        }}
        editGroup={editingGroup}
      />

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
