import Sidebar from './Sidebar'
import BrokerCreditSummary from './BrokerCreditSummary'
import MobileBottomNav from './MobileBottomNav'
import { withExportLoading } from '../utils/exportLoading'
import { getPresetRange, QUICK_FILTERS } from '../utils/dealTimePresets'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { AskAiIcon, ReportsIcon, ReportSubIcon, TutorialIcon, BrokerageCalcIcon } from './ReportIcons'
import { useNavigate } from 'react-router-dom'
import { useData } from '../contexts/dataContextStore'
import CustomizeViewModal from './CustomizeViewModal'
import FilterModal from './FilterModal'
import GroupModal from './GroupModal'
import LoginGroupsModal from './LoginGroupsModal'
import LoginGroupModal from './LoginGroupModal'
import TimeFilterModal from './TimeFilterModal'
import DealsFilterModal from './DealsFilterModal'
import ClientDetailsMobileModal from './ClientDetailsMobileModal'
import ColumnChooserList from './ColumnChooserList'
import { useGroups } from '../contexts/groupContextStore'
import websocketService from '../services/websocket'
import { brokerAPI } from '../services/api'
import { applyCumulativeFilters } from '../utils/mobileFilters'
import useSearchAsYouType from '../hooks/useSearchAsYouType'
import { formatTime as apiFormatTime, serverNowEpoch } from '../utils/dateFormatter'

// Labels for the quick time filter button, including the presets set from the Filter sheet
const QUICK_TIME_LABELS = { ...Object.fromEntries(QUICK_FILTERS.map(o => [o.value, o.label])), custom: 'Custom', '24h': 'Last 24 Hours', '7d': 'Last 7 Days' }

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

const formatTime = (timestamp) => apiFormatTime(timestamp, '-')

export default function LiveDealingModule() {
  const navigate = useNavigate()
  const { positions: cachedPositions, clients, rawClients, orders } = useData()
  const { groups, deleteGroup, getActiveGroupFilter, setActiveGroupFilter, filterByActiveGroup, activeGroupFilters } = useGroups()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [numericMode, setNumericMode] = useState(() => { try { const s = localStorage.getItem('globalDisplayMode'); return s === 'full' ? 'full' : 'compact' } catch { return 'compact' } })

  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  // Only hit the API once the user pauses typing.
  useSearchAsYouType(searchInput, appliedSearch, setAppliedSearch)
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isTimeFilterOpen, setIsTimeFilterOpen] = useState(false)
  const [isQuickTimeOpen, setIsQuickTimeOpen] = useState(false)
  const [isDealsFilterOpen, setIsDealsFilterOpen] = useState(false)
  const [isGroupOpen, setIsGroupOpen] = useState(false)
  const [isLoginGroupsOpen, setIsLoginGroupsOpen] = useState(false)
  const [isLoginGroupModalOpen, setIsLoginGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  const [filters, setFilters] = useState({ hasFloating: false, hasCredit: false, noDeposit: false })

  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 15
  const [totalDealsCount, setTotalDealsCount] = useState(0)
  const [sortColumn, setSortColumn] = useState('time')
  const [sortDirection, setSortDirection] = useState('desc')
  const [isMobileView, setIsMobileView] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false)

  // Deals state
  const [deals, setDeals] = useState([])
  const [newDealIds, setNewDealIds] = useState(new Set()) // Track new deals for blinking
  const [, setConnectionState] = useState('disconnected')
  const [timeFilter, setTimeFilter] = useState('today')
  const [moduleFilter, setModuleFilter] = useState('both') // 'deal', 'money', 'both'
  const [customFromDate, setCustomFromDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [customToDate, setCustomToDate] = useState('')
  const [appliedFromDate, setAppliedFromDate] = useState('')
  const [appliedToDate, setAppliedToDate] = useState('')
  const [displayMode, setDisplayMode] = useState('value') // 'value' or 'percentage'

  // Pending change tracking for Customize View Apply
  const [hasPendingGroupChanges, setHasPendingGroupChanges] = useState(false)
  const [pendingGroupDraft, setPendingGroupDraft] = useState(null)
  const [hasPendingTimeChanges, setHasPendingTimeChanges] = useState(false)
  const [pendingTimeDraft, setPendingTimeDraft] = useState(null)
  const [hasPendingDealsChanges, setHasPendingDealsChanges] = useState(false)
  const [pendingDealsDraft, setPendingDealsDraft] = useState(null)

  const [visibleColumns, setVisibleColumns] = useState({
    time: true,
    login: true,
    symbol: true,
    netType: true,
    netVolume: true,
    averagePrice: true,
    totalProfit: false,
    commission: false,
    storage: false,
    appliedPercentage: false,
    action: false,
    deal: false,
    entry: false
  })

  // Column order (persisted) — same key as desktop Live Dealing page so both stay in sync
  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('liveDealingPageColumnOrder'))
      if (Array.isArray(saved)) return saved
    } catch { /* Retain the fallback when this operation is unavailable. */ }
    return null
  })
  useEffect(() => {
    try { if (columnOrder) localStorage.setItem('liveDealingPageColumnOrder', JSON.stringify(columnOrder)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [columnOrder])
  const resetColumnOrder = () => {
    setColumnOrder(null)
    try { localStorage.removeItem('liveDealingPageColumnOrder') } catch { /* Retain the fallback when this operation is unavailable. */ }
  }

  // Pinned (frozen) columns — persisted, default keeps Login frozen like desktop
  const [pinnedColumns, setPinnedColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('liveDealingPagePinnedColumns'))
      return Array.isArray(saved) && saved.length ? saved : ['login']
    } catch { return ['login'] }
  })
  useEffect(() => {
    try { localStorage.setItem('liveDealingPagePinnedColumns', JSON.stringify(pinnedColumns)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [pinnedColumns])
  const togglePinColumn = (key) =>
    setPinnedColumns(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  // Clear all filters on component mount (when navigating to this module)
  useEffect(() => {
    setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
    setActiveGroupFilter('livedealing', null)
    setSearchInput('')
    setAppliedSearch('')
    setTimeFilter('today')
    setModuleFilter('both')
    setCustomFromDate('')
    setCustomToDate('')
    setAppliedFromDate('')
    setAppliedToDate('')
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
      setIsTimeFilterOpen(false)
      setIsDealsFilterOpen(false)
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

  // Detect mobile view
  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Format request text from deal data


  // Load and save deals cache
  const WS_CACHE_KEY = 'liveDealsWsCache'

  const saveWsCache = (list) => {
    try {
      localStorage.setItem(WS_CACHE_KEY, JSON.stringify(list))
    } catch { /* Retain the fallback when this operation is unavailable. */ }
  }

  // Build a login→client map from all available sources so name shows immediately on click
  const clientNameMap = useMemo(() => {
    const map = new Map()
    rawClients.forEach(c => { if (c?.login) map.set(String(c.login), c) })
    clients.forEach(c => { if (c?.login && (c.name || c.fullName)) map.set(String(c.login), c) })
    return map
  }, [rawClients, clients])

  // Fetch deals from API — server-side pagination (100 per page)
  const fetchDeals = async (page = currentPage) => {
    try {
      // Every fetchDeals call follows a user action (search, filter, sort, page). Live WebSocket
      // arrivals update `deals` directly, so showing the skeleton here never interrupts them.
      setLoading(true)

      let from, to
      const presetRange = getPresetRange(timeFilter)
      if (presetRange) {
        from = presetRange.from
        to = presetRange.to
      } else if (timeFilter === '24h') {
        const now = serverNowEpoch()
        from = now - (24 * 60 * 60)
        to = now
      } else if (timeFilter === '7d') {
        const now = serverNowEpoch()
        from = now - (7 * 24 * 60 * 60)
        to = now
      } else if (timeFilter === 'custom' && appliedFromDate && appliedToDate) {
        // yyyy-mm-dd parses as UTC midnight = server-day start; include the whole "to" day
        from = Math.floor(new Date(appliedFromDate).getTime() / 1000)
        to = Math.floor(new Date(appliedToDate).getTime() / 1000) + 86399
      } else {
        const now = serverNowEpoch()
        from = now - (24 * 60 * 60)
        to = now
      }

      // Server-side filters — same as desktop
      const apiFilters = []
      if (moduleFilter === 'deal') {
        apiFilters.push({ field: 'action', operator: 'in', value: ['BUY', 'SELL'] })
      } else if (moduleFilter === 'money') {
        apiFilters.push({ field: 'action', operator: 'not_equal', value: 'BUY' })
        apiFilters.push({ field: 'action', operator: 'not_equal', value: 'SELL' })
      }
      const trimmedSearch = appliedSearch

      const extraBody = {
        sortBy: sortColumn || 'time',
        sortOrder: sortDirection || 'desc',
      }
      if (/^\d+$/.test(trimmedSearch)) {
        // The API search parameter matches symbol/comment; logins require a field filter.
        apiFilters.push({ field: 'login', operator: 'equal', value: Number(trimmedSearch) })
      } else if (trimmedSearch) {
        extraBody.search = trimmedSearch
      }
      if (apiFilters.length > 0) extraBody.filters = apiFilters

      const response = await brokerAPI.getAllDeals(from, to, itemsPerPage, page, extraBody)
      const payload = response?.data ?? response
      const dealsData = payload?.deals || payload?.items || []
      const apiTotal = payload?.total ?? payload?.totalCount ?? payload?.total_count ?? payload?.count ?? null
      const rawTotal = apiTotal != null ? Number(apiTotal) : dealsData.length
      setTotalDealsCount(rawTotal)

      const transformedDeals = dealsData.map(deal => ({
        id: deal.deal || deal.id,
        timestamp: deal.time || deal.timestamp,
        timestampStr: deal.timeStr || deal.timestampStr || null,
        login: deal.login,
        rawData: deal
      }))

      // On page 1 with no active filters: merge WS deals so live arrivals stay visible
      const hasActiveFilters = trimmedSearch.length > 0 || moduleFilter !== 'both'
      if (page === 1 && !hasActiveFilters) {
        setDeals(prevDeals => {
          const apiIds = new Set(transformedDeals.map(d => d.id))
          const wsExtras = prevDeals.filter(d => !apiIds.has(d.id))
          return [...wsExtras, ...transformedDeals]
        })
      } else {
        setDeals(transformedDeals)
      }
      setLoading(false)
    } catch (error) {
      console.error('[LiveDealingModule] Error fetching deals:', error)
      setLoading(false)
    }
  }

  // Re-fetch when filters or sort change — reset to page 1 (same as desktop)
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      fetchDeals(1)
      return
    }
    setCurrentPage(1)
    fetchDeals(1)
  }, [timeFilter, appliedFromDate, appliedToDate, moduleFilter, sortColumn, sortDirection, appliedSearch])

  // Re-fetch when page changes (server-side pagination — same as desktop)
  const isFirstPageEffect = useRef(true)
  useEffect(() => {
    if (isFirstPageEffect.current) { isFirstPageEffect.current = false; return }
    fetchDeals(currentPage)
  }, [currentPage])

  // WebSocket subscription
  useEffect(() => {
    // Subscribe to WebSocket updates
    const handleDealAdded = (data) => {
      const dealData = data.data || data
      const dealEntry = {
        id: dealData.deal || dealData.id || Date.now() + Math.random(),
        timestamp: dealData.time || dealData.timestamp || Math.floor(Date.now() / 1000),
        login: dealData.login,
        rawData: dealData // Preserve all fields: symbol, action, volume, price, profit, commission, etc.
      }

      setDeals(prevDeals => {
        if (prevDeals.some(d => d.id === dealEntry.id)) return prevDeals

        // Mark this deal as new for highlight effect
        setNewDealIds(prev => new Set(prev).add(dealEntry.id))

        // Remove the highlight effect after 6 seconds (matching animation duration)
        setTimeout(() => {
          setNewDealIds(prev => {
            const updated = new Set(prev)
            updated.delete(dealEntry.id)
            return updated
          })
        }, 6000)

        const updated = [dealEntry, ...prevDeals]
        saveWsCache(updated.slice(0, 200))
        return updated
      })
    }

    // Handle deal updates
    const handleDealUpdated = (data) => {
      const dealData = data.data || data
      const dealId = dealData.deal || dealData.id

      if (!dealId) return

      setDeals(prevDeals => {
        const index = prevDeals.findIndex(d => d.id === dealId)
        if (index === -1) return prevDeals

        const updatedDeals = [...prevDeals]
        updatedDeals[index] = {
          ...updatedDeals[index],
          timestamp: dealData.time || updatedDeals[index].timestamp,
          login: dealData.login || updatedDeals[index].login,
          rawData: { ...updatedDeals[index].rawData, ...dealData }
        }
        return updatedDeals
      })
    }

    // Handle deal deletions
    const handleDealDeleted = (data) => {
      const dealData = data.data || data
      const dealId = dealData.deal || dealData.id

      if (!dealId) return

      setDeals(prevDeals => prevDeals.filter(d => d.id !== dealId))
    }

    // Subscribe to all deal event types matching desktop implementation
    const unsubscribeDealAdded = websocketService.subscribe('DEAL_ADDED', handleDealAdded)
    const unsubscribeDealCreated = websocketService.subscribe('DEAL_CREATED', handleDealAdded)
    const unsubscribeNewDeal = websocketService.subscribe('NEW_DEAL', handleDealAdded)
    const unsubscribeDeal = websocketService.subscribe('deal', handleDealAdded)
    const unsubscribeLegacyDealAdded = websocketService.subscribe('deal_added', handleDealAdded)

    const unsubscribeDealUpdated = websocketService.subscribe('DEAL_UPDATED', handleDealUpdated)
    const unsubscribeDealUpdate = websocketService.subscribe('DEAL_UPDATE', handleDealUpdated)

    const unsubscribeDealDeleted = websocketService.subscribe('DEAL_DELETED', handleDealDeleted)
    const unsubscribeDealDelete = websocketService.subscribe('DEAL_DELETE', handleDealDeleted)

    // Get connection state
    const service = websocketService
    if (service.socket?.readyState === WebSocket.OPEN) {
      setConnectionState('connected')
    }

    const handleConnectionState = (event) => {
      setConnectionState(event.detail)
    }
    const unsubscribeConnectionState = websocketService.subscribe('connectionState', handleConnectionState)

    return () => {
      unsubscribeDealAdded()
      unsubscribeDealCreated()
      unsubscribeNewDeal()
      unsubscribeDeal()
      unsubscribeLegacyDealAdded()
      unsubscribeDealUpdated()
      unsubscribeDealUpdate()
      unsubscribeDealDeleted()
      unsubscribeDealDelete()
      unsubscribeConnectionState()
    }
  }, [])

  // Server handles time range, search, module filter, sort — just pass deals through
  const filteredByTime = useMemo(() => deals, [deals])

  // Client-side search is disabled (server handles it)
  const searchedDeals = useMemo(() => filteredByTime, [filteredByTime])

  // Server handles module filter
  const moduleFilteredDeals = useMemo(() => searchedDeals, [searchedDeals])

  // Apply cumulative filters: Customize View -> IB -> Group
  const ibFilteredDeals = useMemo(() => {
    return applyCumulativeFilters(moduleFilteredDeals, {
      customizeFilters: filters,
      filterByActiveGroup,
      loginField: 'login',
      moduleName: 'livedealing'
    })
  }, [moduleFilteredDeals, filters, filterByActiveGroup, activeGroupFilters])

  // Server handles sorting — pass through directly
  const sortedDeals = useMemo(() => ibFilteredDeals, [ibFilteredDeals])

  // Calculate summary statistics
  useMemo(() => {
    const totalDeals = totalDealsCount
    const uniqueLogins = new Set(deals.map(d => d.login)).size
    const uniqueSymbols = new Set(deals.map(d => d.rawData?.symbol)).size

    return {
      totalDeals,
      uniqueLogins,
      uniqueSymbols,
    }
  }, [sortedDeals]);

  const handleSort = (columnKey) => {
    if (sortColumn === columnKey) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(columnKey)
      setSortDirection('asc')
    }
  }

  // Map card labels to icon file paths


  // Face cards data - use useMemo to avoid infinite loop


  // Get visible columns
  const allColumns = [
    { key: 'login', label: 'Login', width: '80px', sticky: true },
    { key: 'symbol', label: 'Symbol', width: '90px' },
    { key: 'time', label: 'Time', width: '155px' },
    { key: 'netType', label: 'Net Type', width: '80px' },
    { key: 'netVolume', label: displayMode === 'percentage' ? 'Net Volume (%)' : displayMode === 'both' ? 'Net Volume (Both)' : 'Net Volume', width: '100px' },
    { key: 'averagePrice', label: 'Price', width: '110px' },
    { key: 'totalProfit', label: displayMode === 'percentage' ? 'Total Profit (%)' : displayMode === 'both' ? 'Total Profit (Both)' : 'Total Profit', width: '100px' },
    { key: 'commission', label: displayMode === 'percentage' ? 'Commission (%)' : displayMode === 'both' ? 'Commission (Both)' : 'Commission', width: '100px' },
    { key: 'storage', label: displayMode === 'percentage' ? 'Swap (%)' : displayMode === 'both' ? 'Swap (Both)' : 'Swap', width: '90px' },
    { key: 'appliedPercentage', label: 'Applied %', width: '90px' },
    { key: 'action', label: 'Action', width: '80px' },
    { key: 'deal', label: 'Deal', width: '80px' },
    { key: 'entry', label: 'Entry', width: '80px' }
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
  }, [visibleColumns, columnOrder, pinnedColumns, displayMode])
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
  const getAppliedPercentage = (raw) => Number(raw?.applied_percentage ?? raw?.appliedPercentage ?? 0)

  // Export to CSV
  const handleExportToCSV = withExportLoading(() => {
    try {
      const dataToExport = sortedDeals
      if (!dataToExport || dataToExport.length === 0) {
        alert('No data to export')
        return
      }

      const exportColumns = activeColumns
      const headers = exportColumns.map(col => col.label).join(',')

      const rows = dataToExport.map(deal => {
        return exportColumns.map(col => {
          let value = ''

          switch(col.key) {
            case 'time':
              value = formatTime(deal.rawData?.time)
              break
            case 'login':
              value = deal.login || '-'
              break
            case 'netType':
              value = deal.rawData?.action || '-'
              break
            case 'netVolume':
              value = displayMode === 'percentage' 
                ? (deal.rawData?.volume_percentage || 0)
                : (deal.rawData?.volume || 0)
              break
            case 'averagePrice':
              value = deal.rawData?.price || 0
              break
            case 'totalProfit':
              value = displayMode === 'percentage'
                ? (deal.rawData?.profit_percentage || 0)
                : (deal.rawData?.profit || 0)
              break
            case 'commission':
              value = displayMode === 'percentage'
                ? (deal.rawData?.commission_percentage || 0)
                : (deal.rawData?.commission || 0)
              break
            case 'storage':
              value = displayMode === 'percentage'
                ? (deal.rawData?.storage_percentage || 0)
                : (deal.rawData?.storage || 0)
              break
            case 'appliedPercentage':
              value = formatNum(getAppliedPercentage(deal.rawData), 2) + '%'
              break
            case 'symbol':
              value = deal.rawData?.symbol || '-'
              break
            case 'action':
              value = deal.rawData?.action || '-'
              break
            case 'deal':
              value = deal.rawData?.deal || deal.id || '-'
              break
            case 'entry':
              value = deal.rawData?.entry || '-'
              break
            default:
              value = deal.rawData?.[col.key] || '-'
          }

          if (typeof value === 'string') {
            value = value.replace(/"/g, '""')
            if (value.includes(',') || value.includes('"')) {
              value = `"${value}"`
            }
          }

          return value
        }).join(',')
      }).join('\n')

      const csvContent = headers + '\n' + rows
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `live_dealing_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[LiveDealingModule] Export failed:', error)
      alert('Export failed. Please try again.')
    }
  })

  const renderCellValue = (deal, key, isSticky = false, stickyLeft = 0) => {
    let value = '-'

    switch (key) {
      case 'time':
        value = formatTime(deal.timestamp || deal.timestampStr || deal.rawData?.timeStr)
        break
      case 'login':
        value = deal.login || '-'
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
              const fullClient = clientNameMap.get(String(deal.login)) || clients.find(c => String(c.login) === String(deal.login))
              setSelectedClient(fullClient || { login: deal.login, email: deal.email || '', name: '' })
            }}
          >
            <span className="truncate">{value}</span>
          </div>
        )
      case 'netType':
        {
const action = deal.rawData?.action || '-'
        const actionLower = action.toLowerCase()
        return (
          <div 
            className={`h-[28px] flex items-center justify-start px-1 ${isSticky ? 'sticky bg-white z-10' : ''}`}
            style={{
              border: 'none', 
              outline: 'none', 
              boxShadow: isSticky ? '2px 0 4px rgba(0,0,0,0.05)' : 'none',
              ...(isSticky ? { left: `${stickyLeft}px` } : {})
            }}
          >
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              actionLower === 'buy' ? 'text-green-600' : 
              actionLower === 'sell' ? 'text-red-600' : 
              actionLower === 'balance' ? 'text-blue-600' :
              actionLower === 'commission' ? 'text-yellow-600' :
              'text-gray-700'
            }`}>
              {action.toUpperCase()}
            </span>
          </div>
        )
}
      case 'netVolume':
        if (displayMode === 'both') {
          const volValue = fmtMoney(deal.rawData?.volume || 0)
          const volPercent = deal.rawData?.volume_percentage != null ? formatNum(deal.rawData.volume_percentage, 2) : '0.00'
          value = `${volValue} (${volPercent}%)`
        } else if (displayMode === 'percentage') {
          value = deal.rawData?.volume_percentage != null ? formatNum(deal.rawData.volume_percentage, 2) : '0.00'
        } else {
          value = fmtMoney(deal.rawData?.volume || 0)
        }
        break
      case 'averagePrice':
        value = formatNum(deal.rawData?.price || 0, 2)
        break
      case 'totalProfit':
        {
const profit = deal.rawData?.profit || 0
        let profitValue
        if (displayMode === 'both') {
          const profVal = fmtMoney(profit)
          const profPercent = deal.rawData?.profit_percentage != null ? formatNum(deal.rawData.profit_percentage, 2) : '0.00'
          profitValue = `${profVal} (${profPercent}%)`
        } else if (displayMode === 'percentage') {
          profitValue = deal.rawData?.profit_percentage != null ? formatNum(deal.rawData.profit_percentage, 2) : '0.00'
        } else {
          profitValue = fmtMoney(profit)
        }
        return (
          <div 
            className={`h-[28px] flex items-center justify-start px-1 ${isSticky ? 'sticky bg-white z-10' : ''}`}
            style={{
              border: 'none', 
              outline: 'none', 
              boxShadow: isSticky ? '2px 0 4px rgba(0,0,0,0.05)' : 'none',
              ...(isSticky ? { left: `${stickyLeft}px` } : {})
            }}
          >
            <span className={profit >= 0 ? 'text-green-600' : 'text-red-600'}>
              {profitValue}
            </span>
          </div>
        )
}
      case 'commission':
        if (displayMode === 'both') {
          const commValue = fmtMoney(deal.rawData?.commission || 0)
          const commPercent = deal.rawData?.commission_percentage != null ? formatNum(deal.rawData.commission_percentage, 2) : '0.00'
          value = `${commValue} (${commPercent}%)`
        } else if (displayMode === 'percentage') {
          value = deal.rawData?.commission_percentage != null ? formatNum(deal.rawData.commission_percentage, 2) : '0.00'
        } else {
          value = fmtMoney(deal.rawData?.commission || 0)
        }
        break
      case 'storage':
        if (displayMode === 'both') {
          const storValue = fmtMoney(deal.rawData?.storage || 0)
          const storPercent = deal.rawData?.storage_percentage != null ? formatNum(deal.rawData.storage_percentage, 2) : '0.00'
          value = `${storValue} (${storPercent}%)`
        } else if (displayMode === 'percentage') {
          value = deal.rawData?.storage_percentage != null ? formatNum(deal.rawData.storage_percentage, 2) : '0.00'
        } else {
          value = fmtMoney(deal.rawData?.storage || 0)
        }
        break
      case 'appliedPercentage':
        value = formatNum(getAppliedPercentage(deal.rawData), 2) + '%'
        break
      case 'symbol':
        value = deal.rawData?.symbol || '-'
        break
      case 'action':
        {
          const actionValue = String(deal.rawData?.action || '-').toLowerCase()
          const isBuy = actionValue === 'buy'
          const isSell = actionValue === 'sell'
          const chipText = isBuy ? 'BUY' : isSell ? 'SELL' : String(deal.rawData?.action || '-').toUpperCase()
          const chipClass = isBuy
            ? 'bg-green-100 text-green-700 border border-green-200'
            : isSell
              ? 'bg-red-100 text-red-700 border border-red-200'
              : 'bg-gray-100 text-gray-700 border border-gray-200'

          return (
            <div 
              className={`h-[28px] flex items-center justify-start px-1 ${isSticky ? 'sticky bg-white z-10' : ''}`}
              style={{
                border: 'none', 
                outline: 'none', 
                boxShadow: isSticky ? '2px 0 4px rgba(0,0,0,0.05)' : 'none',
                ...(isSticky ? { left: `${stickyLeft}px` } : {})
              }}
            >
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none ${chipClass}`}>
                {chipText}
              </span>
            </div>
          )
        }
      case 'deal':
        value = deal.rawData?.deal || deal.id || '-'
        break
      case 'entry':
        value = deal.rawData?.entry || '-'
        break
      default:
        value = deal.rawData?.[key] || '-'
    }

    return (
      <div 
        className={`h-[28px] flex items-center justify-start px-1 ${isSticky ? 'sticky bg-white z-10' : ''}`}
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
    <div className="h-screen flex flex-col bg-white overflow-x-hidden overflow-y-hidden max-w-full" style={{ height: 'var(--app-viewport-height, 100dvh)', width: '100vw', maxWidth: '100vw', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
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
            <h1 className="text-[22px] leading-7 font-extrabold tracking-tight text-[#0F172A] truncate">Live Dealing</h1>
            <p className="text-[12px] text-[#64748B] truncate">Real-time deals as they happen</p>
          </div>
          <BrokerCreditSummary variant="header" />
        </div>
        {!isMobileView && (
          <button 
            onClick={() => navigate('/profile')}
            className="w-12 h-12 rounded-full bg-[#1A63BC] flex items-center justify-center text-white font-semibold text-sm ml-auto"
          >
            U
          </button>
        )}
      


<BrokerCreditSummary variant="desktop-header" />
</div>

      {/* Sidebar Overlay */}
      {/* Shared mobile navigation drawer — one menu for every module (components/Sidebar.jsx) */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} onToggle={() => setIsSidebarOpen(value => !value)} mobileOnly />

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ maxWidth: '100vw' }}>
        {/* Action Buttons + View All */}
        <div className="pt-2 pb-1">
          <div className="flex items-center mb-2 px-3">
            <div className="flex w-full flex-nowrap items-center gap-1 min-[380px]:gap-1.5 [&>*]:shrink-0">
              {/* Quick time filter: custom dropdown (native select lists can't be styled), same presets as QuickTimeFilter */}
              <div className="relative min-w-0 flex-1 !shrink">
                <button
                  type="button"
                  aria-label="Quick time filters"
                  aria-expanded={isQuickTimeOpen}
                  onClick={() => setIsQuickTimeOpen(v => !v)}
                  className="h-9 w-full min-w-[64px] px-2.5 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-between gap-1 text-[12px] font-medium text-[#1F2937]"
                >
                  <span className="truncate">{QUICK_TIME_LABELS[timeFilter] || 'Quick Filters'}</span>
                  <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${isQuickTimeOpen ? 'rotate-180' : ''}`} viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {isQuickTimeOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsQuickTimeOpen(false)} />
                    <div className="absolute left-0 top-full mt-1.5 w-[168px] z-50 rounded-2xl border border-[#D5DEEA] bg-white backdrop-blur shadow-[0_10px_30px_rgba(15,23,42,0.14)] p-1.5">
                      <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Quick Filters</p>
                      {QUICK_FILTERS.map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => { setTimeFilter(option.value); setIsQuickTimeOpen(false) }}
                          className={`w-full h-9 px-2.5 rounded-xl flex items-center justify-between text-left text-[13px] ${timeFilter === option.value ? 'bg-[#2563EB] text-white font-semibold' : 'text-[#1F2937] active:bg-white/70'}`}
                        >
                          {option.label}
                          {timeFilter === option.value && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button type="button" onClick={() => setIsTimeFilterOpen(true)} aria-label="Choose custom dates" className="h-9 w-9 rounded-xl border border-[#D5DEEA] bg-transparent text-[#374151] flex items-center justify-center">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
              </button>
              <button 
                onClick={() => setIsCustomizeOpen(true)} 
                className={`h-9 px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-all relative ${
                  (timeFilter !== 'today' || moduleFilter !== 'both' || getActiveGroupFilter('livedealing'))
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-transparent border-[#D5DEEA] hover:bg-white/60'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M4.5 6.5H9.5M2.5 3.5H11.5M5.5 9.5H8.5" stroke="#4B4B4B" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span className="text-[#1F2937] text-[11px] font-medium font-outfit max-[359px]:hidden">Filter</span>
                {(() => {
                  const filterCount = [
                    timeFilter !== 'today',
                    moduleFilter !== 'both',
                    getActiveGroupFilter('livedealing')
                  ].filter(Boolean).length;
                  return filterCount > 0 ? (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                      {filterCount}
                    </span>
                  ) : null;
                })()}
              </button>
              <button 
                onClick={() => setDisplayMode(prev => prev === 'percentage' ? 'value' : 'percentage')}
                className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-all ${
                  displayMode === 'percentage' ? 'bg-blue-50 border-blue-200' : 'bg-transparent border-[#D5DEEA] hover:bg-white/60'
                }`}
              >
                <span className="text-[#4B4B4B] text-[12px] font-medium font-outfit">%</span>
              </button>
              <button 
                onClick={handleExportToCSV}
                className="h-9 w-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-colors"
                title="Export deals to CSV"
              >
                <svg className="w-4 h-4 text-[#374151]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-3-3m3 3l3-3M4 20h16"/>
                </svg>
              </button>
              <button
                onClick={() => window.location.reload()}
                disabled={loading}
                className="w-9 h-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="#4B4B4B"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Face Cards Carousel - removed on mobile per request */}

        {/* Search and Controls Bar - Separate from table */}
        <div className="mx-4 mt-1 mb-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Search box */}
              <div className="flex-1 min-w-0 h-10 bg-transparent border border-[#D5DEEA] rounded-xl px-3 flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 text-[#9CA3AF]">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M13 13L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <input
                  type="search" name="no-autofill-search" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-form-type="other" readOnly onPointerDown={e => e.currentTarget.removeAttribute('readonly')} onFocus={e => e.currentTarget.removeAttribute('readonly')} 
                  placeholder="Search by login, symbol..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="flex-1 min-w-0 text-[13px] sm:text-sm text-[#1F2937] placeholder-[#9CA3AF] outline-none bg-transparent font-outfit focus:ring-0" 
                />
              </div>

              {/* Column selector button */}
              <button 
                onClick={() => setIsColumnSelectorOpen(true)}
                className="h-10 w-10 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-colors"
                title="Show/Hide Columns">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="4" height="10" rx="1" stroke="#4B5563" strokeWidth="1.2"/>
                  <rect x="8" y="3" width="6" height="10" rx="1" stroke="#4B5563" strokeWidth="1.2"/>
                </svg>
              </button>

              {/* Previous button */}
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className={`h-10 w-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center transition-colors flex-shrink-0 ${
                  currentPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                  <path d="M12 14L8 10L12 6" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Page indicator */}
              <div className="flex items-center gap-1 text-[13px] text-[#475569] font-medium">
                <input
                  type="number"
                  min="1"
                  max={Math.ceil(totalDealsCount / itemsPerPage) || 1}
                  value={currentPage}
                  onChange={(e) => {
                    const page = Number(e.target.value);
                    const maxPage = Math.ceil(totalDealsCount / itemsPerPage) || 1;
                    if (!isNaN(page) && page >= 1 && page <= maxPage) {
                      setCurrentPage(page);
                    }
                  }}
                  className="w-10 h-10 bg-[#2563EB] text-white font-semibold border border-[#2563EB] rounded-xl text-center text-[13px] shadow-[0_4px_10px_rgba(37,99,235,0.3)] focus:outline-none focus:ring-2 focus:ring-blue-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  aria-label="Current page"
                />
                <span className="text-[#9CA3AF]">/</span>
                <span>{Math.ceil(totalDealsCount / itemsPerPage) || 1}</span>
              </div>

              {/* Next button */}
              <button 
                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalDealsCount / itemsPerPage) || 1, prev + 1))}
                disabled={currentPage >= (Math.ceil(totalDealsCount / itemsPerPage) || 1)}
                className={`h-10 w-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center transition-colors flex-shrink-0 ${
                  currentPage >= (Math.ceil(totalDealsCount / itemsPerPage) || 1) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                  <path d="M8 6L12 10L8 14" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
        </div>

        {/* Table Container - Separate from search */}
        <div className="bg-transparent border border-blue-100 max-md:border-b-0 overflow-hidden mx-1 sm:mx-4">

            {/* Table Data */}
            <div className="mobile-table-scroll w-full overflow-x-auto overflow-y-auto scrollbar-hide" style={{
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            paddingRight: '8px',
            paddingBottom: '8px',
            maxHeight: 'max(152px, calc(var(--app-viewport-height, 100dvh) - 280px))'
          }}>
            <div className="relative" style={{ minWidth: 'max-content' }}>
              <style>{`
                  @keyframes dealFadeOut {
                    0% { background-color: #60a5fa; }
                    30% { background-color: #93c5fd; }
                    60% { background-color: #dbeafe; }
                    100% { background-color: #ffffff; }
                  }
                  .new-deal-blink {
                    animation: dealFadeOut 6s ease-out forwards !important;
                  }
                `}</style>
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
                      className={`h-[32px] flex items-center justify-start px-1 cursor-pointer select-none ${
                        isColPinned(col) ? 'sticky z-30 bg-blue-500' : ''
                      }`}
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
                      <span className="truncate">{col.label}</span>
                      {sortColumn === col.key && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Table Rows */}
                {loading ? (
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
                            className={`h-[38px] flex items-center justify-start px-1 ${isColPinned(col) ? 'sticky bg-white z-10' : ''}`}
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
                  sortedDeals.map((deal) => (
                    <div data-mobile-data-row="body" 
                      key={deal.id} 
                      className={`grid text-[10px] text-[#4B4B4B] font-outfit bg-transparent border-b border-[#E1E1E1] ${currentPage === 1 && newDealIds.has(deal.id) ? 'new-deal-blink' : 'hover:bg-white/50 transition-colors'}`}
                      style={{
                        gap: '0px', 
                        gridGap: '0px', 
                        columnGap: '0px',
                        gridTemplateColumns
                      }}
                    >
                      {activeColumns.map(col => (
                        <React.Fragment key={`${col.key}-${displayMode}`}>
                          {renderCellValue(deal, col.key, isColPinned(col), pinnedOffsets[col.key] || 0)}
                        </React.Fragment>
                      ))}
                    </div>
                  ))
                )}

                {/* Total Row removed for mobile view */}

                {/* Empty state */}
                {sortedDeals.length === 0 && !loading && (
                  <div className="text-center py-8 text-[#9CA3AF] text-sm">
                    No deals available
                  </div>
                )}
                <div aria-hidden="true" className="mobile-table-end" />
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

      {/* Modals */}

      {/* CustomizeView Modal */}
      <CustomizeViewModal
        isOpen={isCustomizeOpen}
        onClose={() => setIsCustomizeOpen(false)}
        onGroupsClick={() => {
          setIsCustomizeOpen(false)
          setIsLoginGroupsOpen(true)
        }}
        onDealsClick={() => {
          setIsCustomizeOpen(false)
          setIsDealsFilterOpen(true)
        }}
        onReset={() => {
          setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
          setActiveGroupFilter('livedealing', null)
          setTimeFilter('today')
          setModuleFilter('both')
          setHasPendingGroupChanges(false)
          setHasPendingTimeChanges(false)
          setHasPendingDealsChanges(false)
          setPendingGroupDraft(null)
          setPendingTimeDraft(null)
          setPendingDealsDraft(null)
        }}
        onApply={() => {
          // Apply any pending drafts
          if (hasPendingGroupChanges) {
            setActiveGroupFilter('livedealing', pendingGroupDraft ? pendingGroupDraft.name : null)
          }
          if (hasPendingTimeChanges && pendingTimeDraft) {
            setTimeFilter(pendingTimeDraft.type)
            if (pendingTimeDraft.type === 'custom') {
              setCustomFromDate(pendingTimeDraft.from || '')
              setCustomToDate(pendingTimeDraft.to || '')
              setAppliedFromDate(pendingTimeDraft.from || '')
              setAppliedToDate(pendingTimeDraft.to || '')
            }
          }
          if (hasPendingDealsChanges && pendingDealsDraft) {
            setModuleFilter(pendingDealsDraft)
          }
          setIsCustomizeOpen(false)
          setHasPendingGroupChanges(false)
          setHasPendingTimeChanges(false)
          setHasPendingDealsChanges(false)
          setPendingGroupDraft(null)
          setPendingTimeDraft(null)
          setPendingDealsDraft(null)
        }}
        hasPendingChanges={
          hasPendingGroupChanges || hasPendingTimeChanges || hasPendingDealsChanges
        }
      />

      {/* Time Filter Modal */}
      <TimeFilterModal
        isOpen={isTimeFilterOpen}
        onClose={() => {
          setIsTimeFilterOpen(false)
          setIsCustomizeOpen(true)
        }}
        onBack={() => {
          setIsTimeFilterOpen(false)
          setIsCustomizeOpen(true)
        }}
        onApply={(newFilter) => {
          setTimeFilter(newFilter)
          setIsTimeFilterOpen(false)
        }}
        currentFilter={timeFilter}
        customFromDate={customFromDate}
        customToDate={customToDate}
        onCustomFromDateChange={setCustomFromDate}
        onCustomToDateChange={setCustomToDate}
        onApplyCustomDates={() => {
          setAppliedFromDate(customFromDate)
          setAppliedToDate(customToDate)
        }}
        onPendingChange={(hasPending, draft) => {
          setHasPendingTimeChanges(hasPending)
          setPendingTimeDraft(draft || null)
        }}
      />

      {/* Deals Filter Modal */}
      <DealsFilterModal
        isOpen={isDealsFilterOpen}
        onClose={() => {
          setIsDealsFilterOpen(false)
          setIsCustomizeOpen(true)
        }}
        onBack={() => {
          setIsDealsFilterOpen(false)
          setIsCustomizeOpen(true)
        }}
        onApply={(newFilter) => {
          setModuleFilter(newFilter)
          setIsDealsFilterOpen(false)
        }}
        currentFilter={moduleFilter}
        onPendingChange={(hasPending, draft) => {
          setHasPendingDealsChanges(hasPending)
          setPendingDealsDraft(draft || null)
        }}
      />

      {/* Filter Modal (hasFloating/hasCredit/noDeposit) */}
      <FilterModal
        isOpen={isFilterOpen}
        onClose={() => {
          setIsFilterOpen(false)
          setIsCustomizeOpen(true)
        }}
        onBack={() => {
          setIsFilterOpen(false)
          setIsCustomizeOpen(true)
        }}
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
        availableItems={ibFilteredDeals}
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
        activeGroupName={getActiveGroupFilter('livedealing')}
        onSelectGroup={(group) => {
          if (group === null) {
            setActiveGroupFilter('livedealing', null)
          } else {
            setActiveGroupFilter('livedealing', group.name)
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

      {/* Percentage toggle uses top bar button; modal removed */}

      {/* Client Details Modal */}
      {selectedClient && (
        <ClientDetailsMobileModal
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          allPositionsCache={cachedPositions}
          allOrdersCache={orders}
        />
      )}
    </div>
  )
}
