import Sidebar from './Sidebar'
import BrokerCreditSummary from './BrokerCreditSummary'
import MobileBottomNav from './MobileBottomNav'
import ColumnChooserList from './ColumnChooserList'
import { createLatestRequest } from '../utils/latestRequest'
import React, { useState, useRef, useEffect, useMemo, useDeferredValue, startTransition } from 'react'
import { AskAiIcon, ReportsIcon, ReportSubIcon, TutorialIcon, BrokerageCalcIcon } from './ReportIcons'
import { useData } from '../contexts/dataContextStore'
import CustomizeViewModal from './CustomizeViewModal'
import FilterModal from './FilterModal'
import DateFilterModal from './DateFilterModal'
import GroupModal from './GroupModal'
import LoginGroupsModal from './LoginGroupsModal'
import LoginGroupModal from './LoginGroupModal'
import ClientDetailsMobileModal from './ClientDetailsMobileModal'
import { useGroups } from '../contexts/groupContextStore'
import { applyCumulativeFilters, applySearchFilter, applySorting } from '../utils/mobileFilters'
import { normalizePositions } from '../utils/currencyNormalization'
import { formatTime as apiFormatTime, serverNowEpoch } from '../utils/dateFormatter'
import { brokerAPI } from '../services/api'
import LoadingSpinner from './LoadingSpinner'
import ExchangeNetPositions from './ExchangeNetPositions'
import NetTypeChip from './NetTypeChip'
import { exportStyledExcel, styledColumnsFromHeaders, sumColumns } from '../utils/exportStyledExcel'

const formatNum = (n) => {
  const v = Number(n || 0)
  if (!isFinite(v)) return '0.00'
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PositionModule() {
  const { positions, clients, loading, orders, rawClients } = useData()
  const { groups, deleteGroup, getActiveGroupFilter, setActiveGroupFilter, filterByActiveGroup, getGroupLogins, activeGroupFilters } = useGroups()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [, setActiveCardIndex] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isGroupOpen, setIsGroupOpen] = useState(false)
  const [isLoginGroupsOpen, setIsLoginGroupsOpen] = useState(false)
  const [isLoginGroupModalOpen, setIsLoginGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [filters, setFilters] = useState({ hasFloating: false, hasCredit: false, noDeposit: false })
  const [dateFilter, setDateFilter] = useState(null) // null, 3, 5, or 7 for days
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false)
  const [hasPendingDateChanges, setHasPendingDateChanges] = useState(false)
  const [pendingDateDraft, setPendingDateDraft] = useState(null)
  const [isMobileView, setIsMobileView] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false)
    // Pending apply tracking for Customize View
    const [hasPendingGroupChanges, setHasPendingGroupChanges] = useState(false)
    const [pendingGroupDraft, setPendingGroupDraft] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  // Ref so polling closures can skip while the client detail modal is open
  const selectedClientRef = useRef(null)
  useEffect(() => { selectedClientRef.current = selectedClient }, [selectedClient])

  // Build client currency map from rawClients for USC detection
  const clientCurrencyMap = useMemo(() => {
    if (!rawClients || rawClients.length === 0) return {}
    const map = {}
    rawClients.forEach(client => {
      if (client && client.login && client.currency) {
        map[client.login] = client.currency
      }
    })
    return map
  }, [rawClients])

  // Apply USD normalization to all positions automatically with USC handling
  const displayPositions = useMemo(() => {
    if (!positions || positions.length === 0) return positions
    return normalizePositions(positions, clientCurrencyMap)
  }, [positions, clientCurrencyMap])


  const carouselRef = useRef(null)
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [isPageChanging, setIsPageChanging] = useState(false)
  const pageChangeTimeoutRef = useRef(null)
  const itemsPerPage = 15
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')
  const [showClientNet, setShowClientNet] = useState(false)
  // Exchange view: NET positions segregated by exchange (mutually exclusive with NET Position)
  const [showExchangeView, setShowExchangeView] = useState(true)
  const [exchangeCardTotals, setExchangeCardTotals] = useState({ positionCount: 0, floatingCombined: 0, floatingINR: 0, floatingUSD: 0 })
  const exchangeViewRef = useRef(null)
  const [groupByBaseSymbol] = useState(false)
  const [displayMode, setDisplayMode] = useState('value') // 'value' or 'percentage'
  const [isExporting, setIsExporting] = useState(false)
  const [numericMode, setNumericMode] = useState(() => { try { const saved = localStorage.getItem('globalDisplayMode'); return saved === 'full' ? 'full' : 'compact' } catch { return 'compact' } })

  // Client NET states
  const [clientNetCurrentPage, setClientNetCurrentPage] = useState(1)
  const [isClientNetPageChanging, setIsClientNetPageChanging] = useState(false)
  const clientNetPageChangeTimeoutRef = useRef(null)
  const clientNetItemsPerPage = 15
  const [clientNetSortColumn, setClientNetSortColumn] = useState(null)
  const [clientNetSortDirection, setClientNetSortDirection] = useState('asc')

  const [, setClientNetCardFilterOpen] = useState(false)
  const clientNetCardFilterRef = useRef(null)
  const [clientNetVisibleColumns, setClientNetVisibleColumns] = useState({
    symbol: true,
    netType: true,
    netVolume: true,
    avgPrice: true,
    currentPrice: true,
    totalProfit: true,
    totalStorage: true,
    loginCount: true,
    totalPositions: true,
    // Optional extras (hidden by default; still available via column chooser)
    totalCommission: false
  })
  const [clientNetShowColumnSelector, setClientNetShowColumnSelector] = useState(false)
  // Saved column order for the mobile tables (drag to reorder in the column chooser)
  const loadColumnOrder = (storageKey) => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      return Array.isArray(saved) ? saved : null
    } catch { return null }
  }
  const [positionsColumnOrder, setPositionsColumnOrder] = useState(() => loadColumnOrder('positionsMobileColumnOrder'))
  const [clientNetColumnOrder, setClientNetColumnOrder] = useState(() => loadColumnOrder('positionsNetColumnOrder'))
  useEffect(() => {
    try { if (positionsColumnOrder) localStorage.setItem('positionsMobileColumnOrder', JSON.stringify(positionsColumnOrder)); else localStorage.removeItem('positionsMobileColumnOrder') } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [positionsColumnOrder])
  useEffect(() => {
    try { if (clientNetColumnOrder) localStorage.setItem('positionsNetColumnOrder', JSON.stringify(clientNetColumnOrder)); else localStorage.removeItem('positionsNetColumnOrder') } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [clientNetColumnOrder])
  const [clientNetSearchInput, setClientNetSearchInput] = useState('')

  // Server-side NET positions (fetched when NET Position tab is active)
  const [serverNetPositions, setServerNetPositions] = useState([])
  const [serverNetTotal, setServerNetTotal] = useState(0)
  const [hasFetchedServerNet, setHasFetchedServerNet] = useState(false)
  const hasFetchedServerNetRef = useRef(false)
  const [isServerNetLoading, setIsServerNetLoading] = useState(false)

  // Server-side positions (fetched when regular Positions tab is active on mobile)
  const [serverPositions, setServerPositions] = useState([])
  const [serverPositionsTotal, setServerPositionsTotal] = useState(0)
  const [serverPositionsTotals, setServerPositionsTotals] = useState({ profit: 0, volume: 0, uniqueLogins: 0, floatingCombined: 0, floatingINR: 0, floatingUSD: 0 })
  const [hasFetchedServerPositions, setHasFetchedServerPositions] = useState(false)
  const hasFetchedServerPositionsRef = useRef(false)
  const [, setIsServerPositionsLoading] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const initialLoadDoneRef = useRef(false)
  const minTimerDoneRef = useRef(false)

  const [visibleColumns, setVisibleColumns] = useState({
    login: true,
    firstName: false,
    middleName: false,
    lastName: false,
    email: false,
    phone: false,
    position: false,
    symbol: true,
    action: false,
    netType: true,
    volume: false,
    volumePercentage: false,
    priceOpen: true,
    priceCurrent: false,
    netVolume: true,
    sl: false,
    tp: false,
    profit: false,
    totalProfit: true,
    profitPercentage: false,
    storage: false,
    storagePercentage: false,
    appliedPercentage: false,
    reason: false,
    comment: false,
    commission: false,
    updated: true
  })

  // Listen for global request to open Customize View from child modals
  // Clear all filters on component mount (when navigating to this module)
  useEffect(() => {
    setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
    setActiveGroupFilter('positions', null)
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
    setClientNetCurrentPage(1)
  }, [getActiveGroupFilter('positions')])

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
      if (clientNetPageChangeTimeoutRef.current) {
        clearTimeout(clientNetPageChangeTimeoutRef.current)
      }
    }
  }, [])

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

  const handleClientNetPageChange = (nextPage, maxPage) => {
    const safeMaxPage = Math.max(1, maxPage)
    const clampedPage = Math.min(safeMaxPage, Math.max(1, nextPage))
    if (clampedPage === clientNetCurrentPage) return

    setIsClientNetPageChanging(true)
    setClientNetCurrentPage(clampedPage)

    if (clientNetPageChangeTimeoutRef.current) {
      clearTimeout(clientNetPageChangeTimeoutRef.current)
    }
    clientNetPageChangeTimeoutRef.current = setTimeout(() => {
      setIsClientNetPageChanging(false)
    }, 180)
  }

  // Detect mobile view
  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const mobileRegularSourcePositions = displayPositions

  // Apply filters in cumulative order: Customize View -> Group
  const ibFilteredPositions = useMemo(() => {
    return applyCumulativeFilters(mobileRegularSourcePositions, {
      customizeFilters: filters,
      filterByActiveGroup,
      loginField: 'login',
      moduleName: 'positions'
    })
  }, [mobileRegularSourcePositions, filters, filterByActiveGroup, activeGroupFilters])

  // Defer heavy calculations to allow navigation to be responsive
  const deferredIbFilteredPositions = useDeferredValue(ibFilteredPositions)

  // Apply date filter to positions before calculating summary stats
  // Note: date filter is applied server-side via dateFrom/dateTo params in the polling effect
  const dateFilteredPositions = deferredIbFilteredPositions

  // Calculate summary statistics (use deferred value to prevent blocking navigation)


  // Calculate Client NET positions (group by login then symbol)




  // Poll server every 2s for regular positions (mirrors PositionsPage.jsx desktop behaviour)
  useEffect(() => {
    if (showClientNet || showExchangeView) return

    let timer = null
    let isCancelled = false
    let controller = new AbortController()

    const requestGate = createLatestRequest()
    const poll = async () => {
      const isCurrent = requestGate.start()
      if (isCancelled || !isCurrent()) return
      // Pause polling while client detail modal is open
      if (selectedClientRef.current) { if (!isCancelled && isCurrent()) timer = setTimeout(poll, 2000); return }
      try {
        if (!hasFetchedServerPositionsRef.current) setIsServerPositionsLoading(true)
        const params = {
          page: currentPage,
          limit: itemsPerPage,
          sortBy: sortColumn || 'timeCreate',
          sortOrder: sortDirection || 'desc'
        }
        if (debouncedSearch && debouncedSearch.trim()) params.search = debouncedSearch.trim()
        if (displayMode === 'percentage') params.percentage = true
        if (dateFilter) {
          const now = serverNowEpoch()
          params.dateFrom = now - dateFilter * 24 * 60 * 60
          params.dateTo = now
        }

        // Apply active group filter as a server-side login filter (works across pages)
        const activeGroupName = getActiveGroupFilter('positions')
        if (activeGroupName) {
          const groupLogins = getGroupLogins(activeGroupName).map(l => Number(l)).filter(n => !Number.isNaN(n))
          params.filters = [
            { field: 'login', operator: 'in', value: groupLogins.length > 0 ? groupLogins : [-1] }
          ]
        }

        const response = await brokerAPI.searchPositions(params, { signal: controller.signal })
        if (isCancelled || !isCurrent()) return
        const data = response?.data?.positions || response?.positions || []
        const total = response?.data?.total || response?.total || 0
        const totals = response?.data?.totals || response?.totals || null
        if (Array.isArray(data)) {
          setServerPositions(data)
          setServerPositionsTotal(total)
          if (totals) setServerPositionsTotals({
            profit: totals.profit ?? totals.totalProfit ?? 0,
            volume: totals.volume ?? totals.netVolume ?? 0,
            uniqueLogins: totals.uniqueLogins ?? 0,
            floatingCombined: totals.floatingCombined ?? 0,
            floatingINR: totals.floatingINR ?? 0,
            floatingUSD: totals.floatingUSD ?? 0
          })
          setHasFetchedServerPositions(true)
          hasFetchedServerPositionsRef.current = true
          setIsServerPositionsLoading(false)
          if (!initialLoadDoneRef.current) {
            initialLoadDoneRef.current = true
            if (minTimerDoneRef.current) setIsInitialLoading(false)
          }
        }
      } catch (err) {
        if ((!isCancelled && isCurrent()) && err?.code !== 'ERR_CANCELED' && err?.message !== 'canceled') {
          console.warn('[PositionModule] Regular poll error:', err?.message)
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
  }, [showClientNet, showExchangeView, currentPage, itemsPerPage, sortColumn, sortDirection, debouncedSearch, displayMode, dateFilter, activeGroupFilters, getActiveGroupFilter, getGroupLogins])

  const normalizeNetTypeLabel = (action) => {
    if (action === 'BUY') return 'Buy'
    if (action === 'SELL') return 'Sell'
    if (action === 'FLAT') return 'Flat'
    if (action === 0 || action === '0') return 'Buy'
    if (action === 1 || action === '1') return 'Sell'
    if (typeof action === 'string') {
      const lower = action.toLowerCase()
      if (lower.includes('buy')) return 'Buy'
      if (lower.includes('sell')) return 'Sell'
      if (lower.includes('flat')) return 'Flat'
      return action
    }
    return 'Flat'
  }

  const resolveLoginCount = (item) => {
    const raw =
      item?.clientCount ??
      item?.loginCount ??
      item?.loginsCount ??
      item?.uniqueLogins ??
      item?.logins
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }

  // Poll server every 2s for NET positions (mirrors PositionsPage.jsx desktop NET behaviour)
  useEffect(() => {
    if (!showClientNet) return

    let timer = null
    let isCancelled = false
    let controller = new AbortController()

    const requestGate = createLatestRequest()
    const poll = async () => {
      const isCurrent = requestGate.start()
      if (isCancelled || !isCurrent()) return
      // Pause polling while client detail modal is open
      if (selectedClientRef.current) { if (!isCancelled && isCurrent()) timer = setTimeout(poll, 2000); return }
      try {
        if (!hasFetchedServerNetRef.current) setIsServerNetLoading(true)
        const params = {
          page: clientNetCurrentPage,
          limit: clientNetItemsPerPage,
          netPosition: true,
          sortBy: clientNetSortColumn || 'netVolume',
          sortOrder: clientNetSortDirection || 'desc'
        }
        if (groupByBaseSymbol) params.groupBaseSymbol = true
        if (displayMode === 'percentage') params.percentage = true
        if (clientNetSearchInput.trim()) params.search = clientNetSearchInput.trim()

        // Apply active group filter as a server-side login filter (works across pages)
        const activeGroupName = getActiveGroupFilter('positions')
        if (activeGroupName) {
          const groupLogins = getGroupLogins(activeGroupName).map(l => Number(l)).filter(n => !Number.isNaN(n))
          params.filters = [
            { field: 'login', operator: 'in', value: groupLogins.length > 0 ? groupLogins : [-1] }
          ]
        }

        const response = await brokerAPI.searchPositions(params, { signal: controller.signal })
        if (isCancelled || !isCurrent()) return
        const data = response?.data?.positions || response?.positions || []
        const total = response?.data?.total || response?.total || 0
        const totals = response?.data?.totals || response?.totals || null
        if (Array.isArray(data)) {
          const mapped = data.map(item => ({
            symbol: item.symbol || item.baseSymbol || '-',
            netType: normalizeNetTypeLabel(item.action),
            netVolume: item.netVolume || 0,
            avgPrice: item.averagePrice ?? item.avgPrice ?? 0,
            currentPrice: item.currentPrice ?? item.priceCurrent ?? 0,
            totalProfit: item.totalProfit || 0,
            totalStorage: item.totalStorage || 0,
            totalCommission: item.totalCommission || 0,
            loginCount: resolveLoginCount(item),
            totalPositions: item.positionCount || item.totalPositions || 0
          }))
          setServerNetPositions(mapped)
          setServerNetTotal(total)
          if (totals) setServerPositionsTotals({
            profit: totals.totalProfit ?? totals.profit ?? 0,
            volume: totals.netVolume ?? totals.volume ?? 0,
            uniqueLogins: totals.uniqueLogins ?? 0
          })
          setHasFetchedServerNet(true)
          hasFetchedServerNetRef.current = true
          setIsServerNetLoading(false)
        }
      } catch (err) {
        if ((!isCancelled && isCurrent()) && err?.code !== 'ERR_CANCELED' && err?.message !== 'canceled') {
          console.warn('[PositionModule] NET poll error:', err?.message)
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
  }, [showClientNet, groupByBaseSymbol, displayMode, clientNetSearchInput, clientNetCurrentPage, clientNetItemsPerPage, clientNetSortColumn, clientNetSortDirection, activeGroupFilters, getActiveGroupFilter, getGroupLogins])

  // Mobile NET tab mirrors desktop NET Position: symbol-aggregated rows from server.
  // Until the first server response arrives, show empty (skeleton handles the loading UI).
  const mobileNetSourcePositions = hasFetchedServerNet ? serverNetPositions : []

  // Filter NET positions based on search
  const filteredClientNetPositions = useMemo(() => {
    let filtered = mobileNetSourcePositions
    if (clientNetSearchInput.trim()) {
      const query = clientNetSearchInput.toLowerCase()
      filtered = filtered.filter(pos =>
        String(pos.symbol || '').toLowerCase().includes(query) ||
        String(pos.netType || '').toLowerCase().includes(query)
      )
    }
    // Apply sorting
    filtered = applySorting(filtered, clientNetSortColumn, clientNetSortDirection)
    return filtered
  }, [mobileNetSourcePositions, clientNetSearchInput, clientNetSortColumn, clientNetSortDirection])

  // Apply search and sorting (use deferred value to prevent blocking navigation)
  const filteredPositions = useMemo(() => {
    // Apply search filter (date filter already applied in dateFilteredPositions)
    let filtered = applySearchFilter(dateFilteredPositions, debouncedSearch, ['symbol', 'login'])

    // Map column keys to actual data fields for sorting
    const columnKeyMapping = {
      'updated': 'timeUpdate',
      'netType': 'type',
      'action': 'type',
      'netVolume': 'volume',
      'totalProfit': 'profit'
    }
    const sortKey = columnKeyMapping[sortColumn] || sortColumn

    // Apply sorting
    filtered = applySorting(filtered, sortKey, sortDirection)

    return filtered
  }, [dateFilteredPositions, debouncedSearch, sortColumn, sortDirection])

  // Handle column sorting
  const handleSort = (columnKey) => {
    if (sortColumn === columnKey) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to ascending
      setSortColumn(columnKey)
      setSortDirection('asc')
    }
  }

  // Handle Client NET column sorting
  const handleClientNetSort = (columnKey) => {
    if (clientNetSortColumn === columnKey) {
      setClientNetSortDirection(clientNetSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setClientNetSortColumn(columnKey)
      setClientNetSortDirection('asc')
    }
  }

  // Calculate totals (memoized to prevent recalculation)


  // Mobile now uses server-polled data (same as desktop). isMobileRegularServerMode = true once first poll done.
  const isMobileRegularServerMode = hasFetchedServerPositions
  const mobileRegularTotalPages = isMobileRegularServerMode
    ? Math.max(1, Math.ceil(serverPositionsTotal / itemsPerPage))
    : Math.max(1, Math.ceil(filteredPositions.length / itemsPerPage))
  // When server mode active, serverPositions are already paged — display directly
  const mobileRegularDisplayedPositions = isMobileRegularServerMode
    ? serverPositions
    : filteredPositions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  // Pagination calculations for Client NET (server-side paginated)
  // Server returns one page of results at a time; total pages derived from serverNetTotal.
  const clientNetTotalPages = useMemo(() =>
    Math.max(1, Math.ceil((serverNetTotal || 0) / clientNetItemsPerPage)),
    [serverNetTotal, clientNetItemsPerPage]
  )
  // Server already returns only the current page's rows — do not slice again on the client.
  const clientNetPaginatedPositions = filteredClientNetPositions

  // Click outside handlers
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (clientNetCardFilterRef.current && !clientNetCardFilterRef.current.contains(e.target)) {
        setClientNetCardFilterOpen(false)
      }    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Get active columns for dynamic table rendering
  const activeColumns = useMemo(() => {
    const columnDefs = [
      { key: 'login', label: 'Login', width: '70px', sticky: true },
      { key: 'updated', label: 'Time', width: '130px' },
      { key: 'firstName', label: 'First Name', width: '85px' },
      { key: 'middleName', label: 'Middle Name', width: '85px' },
      { key: 'lastName', label: 'Last Name', width: '85px' },
      { key: 'email', label: 'Email', width: '120px' },
      { key: 'phone', label: 'Phone', width: '85px' },
      { key: 'position', label: 'Position', width: '70px' },
      { key: 'symbol', label: 'Symbol', width: '70px' },
      ...(isMobileView
        ? [{ key: 'netType', label: 'Action', width: '60px' }]
        : [
            { key: 'action', label: 'Action', width: '60px' },
            { key: 'netType', label: 'Action', width: '60px' }
          ]),
      { key: 'volume', label: 'Volume', width: '70px' },
      { key: 'volumePercentage', label: 'Volume %', width: '75px' },
      { key: 'priceOpen', label: 'Open Price', width: '80px' },
      { key: 'priceCurrent', label: 'Price Current', width: '90px' },
      { key: 'netVolume', label: 'Net Volume', width: '80px' },
      { key: 'sl', label: 'S/L', width: '70px' },
      { key: 'tp', label: 'T/P', width: '70px' },
      { key: 'profit', label: 'Profit', width: '70px' },
      { key: 'totalProfit', label: 'Total Profit', width: '80px' },
      { key: 'profitPercentage', label: 'Profit %', width: '75px' },
      { key: 'storage', label: 'Swap', width: '70px' },
      { key: 'storagePercentage', label: 'Swap %', width: '80px' },
      { key: 'appliedPercentage', label: 'Applied %', width: '80px' },
      { key: 'reason', label: 'Reason', width: '85px' },
      { key: 'comment', label: 'Comment', width: '90px' },
      { key: 'commission', label: 'Commission', width: '80px' },
    ]
    const filtered = columnDefs.filter(col => visibleColumns[col.key])
    // Apply the saved drag-and-drop order; columns not in it keep their default position at the end
    let ordered = filtered
    if (Array.isArray(positionsColumnOrder) && positionsColumnOrder.length) {
      const byKey = new Map(filtered.map(col => [col.key, col]))
      ordered = []
      positionsColumnOrder.forEach(key => { if (byKey.has(key)) { ordered.push(byKey.get(key)); byKey.delete(key) } })
      byKey.forEach(col => ordered.push(col))
    }
    // Only the first column is pinned (sticky) so it stays at the left edge when sliding
    return ordered.map((col, index) => ({ ...col, sticky: index === 0 }))
  }, [visibleColumns, isMobileView, positionsColumnOrder])

  // NET table columns. Cells are written out per column in JSX, so reordering uses CSS grid `order`
  // (each cell carries data-col) plus a matching width template; Symbol always stays first (pinned).
  const CLIENT_NET_COLUMNS = [
    { key: 'symbol', label: 'Symbol', width: 'minmax(140px, 2fr)' },
    { key: 'netType', label: 'NET Type', width: 'minmax(60px, 1fr)' },
    { key: 'netVolume', label: 'NET Volume', width: 'minmax(80px, 1fr)' },
    { key: 'avgPrice', label: 'Avg Price', width: 'minmax(80px, 1fr)' },
    { key: 'currentPrice', label: 'Current Price', width: 'minmax(90px, 1fr)' },
    { key: 'totalProfit', label: 'Total Profit', width: 'minmax(90px, 1fr)' },
    { key: 'totalStorage', label: 'Swap', width: 'minmax(80px, 1fr)' },
    { key: 'totalCommission', label: 'Total Commission', width: 'minmax(80px, 1fr)' },
    { key: 'loginCount', label: 'Logins', width: 'minmax(70px, 1fr)' },
    { key: 'totalPositions', label: 'Positions', width: 'minmax(80px, 1fr)' }
  ]
  const clientNetOrderedColumns = useMemo(() => {
    const byKey = new Map(CLIENT_NET_COLUMNS.map(col => [col.key, col]))
    const ordered = []
    ;(clientNetColumnOrder || []).forEach(key => { if (byKey.has(key)) { ordered.push(byKey.get(key)); byKey.delete(key) } })
    byKey.forEach(col => ordered.push(col))
    return [...ordered.filter(col => col.key === 'symbol'), ...ordered.filter(col => col.key !== 'symbol')]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientNetColumnOrder])
  const clientNetGridTemplate = clientNetOrderedColumns.filter(col => clientNetVisibleColumns[col.key]).map(col => col.width).join(' ')
  const clientNetOrderCss = clientNetOrderedColumns.map((col, index) => `[data-net-table] [data-col="${col.key}"]{order:${index}}`).join('')

  // Generate grid template columns for the table
  const gridTemplateColumns = useMemo(() => {
    // Widths scaled up 20% for the 12px table text
    return activeColumns.map(col => {
      const px = /^(\d+)px$/.exec(col.width || '')
      return px ? `${Math.round(Number(px[1]) * 1.2)}px` : (col.width || '1fr')
    }).join(' ')
  }, [activeColumns])

  // Compact/full numeric format helpers
  const formatCompactIndian = (n) => {
    const num = Number(n)
    if (!Number.isFinite(num)) return '0'
    const abs = Math.abs(num)
    const sign = num < 0 ? '-' : ''
    if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`
    if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`
    return `${sign}${abs.toFixed(2)}`
  }
  const fmtMoney = (n) => {
    const num = Number(n)
    if (Number.isNaN(num)) return '-'
    if (numericMode === 'compact') return formatCompactIndian(num)
    return formatNum(num)
  }
  const fmtMoneyFull = (n) => {
    const num = Number(n)
    if (Number.isNaN(num)) return '-'
    return formatNum(num)
  }
  const fmtCount = (n) => {
    const num = Number(n)
    if (!Number.isFinite(num)) return '0'
    return String(Math.trunc(num))
  }

  // Render cell value based on column key
  const renderCellValue = (pos, columnKey, isSticky = false) => {
    const stickyClass = isSticky ? 'sticky left-0 bg-white z-10' : ''
    const stickyStyle = isSticky ? { boxShadow: '2px 0 4px rgba(0,0,0,0.05)' } : {}

    switch(columnKey) {
      case 'symbol':
        return <div className={`h-[38px] flex items-center justify-start px-2 overflow-hidden text-ellipsis whitespace-nowrap text-black font-semibold ${stickyClass}`} style={stickyStyle}>{pos.symbol || '-'}</div>
      case 'netType':
      case 'action': {
        const rawAction = pos.action ?? pos.type
        const isBuy = rawAction === 0 || rawAction === '0' || rawAction === 'BUY' || rawAction === 'Buy'
        return (
          <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              isBuy 
                ? 'bg-green-100 text-green-700' 
                : 'bg-red-100 text-red-700'
            }`}>
              {isBuy ? 'Buy' : 'Sell'}
            </span>
          </div>
        )
      }
      case 'totalProfit':
      case 'profit': {
        const rawProfit = pos.profit || 0
        const isCentSym = /[cC]$/.test(String(pos.symbol || ''))
        const displayProfit = isCentSym ? rawProfit / 100 : rawProfit
        return (
          <div title={numericMode === 'compact' ? fmtMoneyFull(displayProfit) : undefined} className={`h-[38px] flex items-center justify-start px-2 font-medium ${
            displayProfit >= 0 ? 'text-green-600' : 'text-red-600'
          } ${stickyClass}`} style={stickyStyle}>
            {fmtMoney(displayProfit)}
          </div>
        )
      }
      case 'priceOpen':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.priceOpen || 0, 5)}</div>
      case 'priceCurrent':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.priceCurrent || 0, 5)}</div>
      case 'volume':
      case 'netVolume':
        return <div title={numericMode === 'compact' ? fmtMoneyFull(pos.volume || 0) : undefined} className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{fmtMoney(pos.volume || 0)}</div>
      case 'volumePercentage':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.volumePercentage || 0)}%</div>
      case 'profitPercentage':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.profitPercentage || 0)}%</div>
      case 'storage': {
        const isCentSym = /[cC]$/.test(String(pos.symbol || ''))
        const displayStorage = isCentSym ? (pos.storage || 0) / 100 : (pos.storage || 0)
        return <div title={numericMode === 'compact' ? fmtMoneyFull(displayStorage) : undefined} className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{fmtMoney(displayStorage)}</div>
      }
      case 'storagePercentage':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.storagePercentage || 0)}%</div>
      case 'appliedPercentage':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.appliedPercentage || 0)}%</div>
      case 'sl':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.sl || 0, 5)}</div>
      case 'tp':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formatNum(pos.tp || 0, 5)}</div>
      case 'commission': {
        const isCentSym = /[cC]$/.test(String(pos.symbol || ''))
        const displayCommission = isCentSym ? (pos.commission || 0) / 100 : (pos.commission || 0)
        return <div title={numericMode === 'compact' ? fmtMoneyFull(displayCommission) : undefined} className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{fmtMoney(displayCommission)}</div>
      }
      case 'login':
        {
const handleLoginClick = () => {
          const fullClient = clients.find(c => String(c.login) === String(pos.login))
            || rawClients.find(c => String(c.login) === String(pos.login))
          const derivedName = [pos.firstName, pos.lastName].filter(Boolean).join(' ') || pos.name || ''
          setSelectedClient(fullClient || { login: pos.login, email: pos.email || '', name: derivedName })
        }
        return (
          <div 
            className={`h-[38px] flex items-center justify-start px-2 text-[#1A63BC] font-semibold ${stickyClass} cursor-pointer hover:underline`} 
            style={stickyStyle}
            onClick={handleLoginClick}
          >
            {pos.login || '-'}
          </div>
        )
}
      case 'updated':
        {
const formattedTime = apiFormatTime(pos.timeUpdate || pos.timeCreate || pos.timeUpdateStr || pos.timeCreateStr, '-')
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{formattedTime}</div>
}
      case 'firstName':
      case 'middleName':
      case 'lastName':
      case 'email':
      case 'phone':
      case 'position':
      case 'reason':
      case 'comment':
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>{pos[columnKey] || '-'}</div>
      default:
        return <div className={`h-[38px] flex items-center justify-start px-2 ${stickyClass}`} style={stickyStyle}>-</div>
    }
  }


  // Map card labels to icon file paths (updated for NET view)


  // Face cards for NET view: use server totals once available (same as desktop)

  const netTotals = useMemo(() => {
    if (showClientNet && hasFetchedServerNet) {
      const loginSet = new Set(serverNetPositions.map(p => p.login).filter(Boolean))
      return {
        total: serverNetTotal,
        netVolume: serverPositionsTotals.volume,
        totalProfit: serverPositionsTotals.profit,
        uniqueLogins: serverPositionsTotals.uniqueLogins || loginSet.size
      }
    }
    if (!showClientNet && hasFetchedServerPositions) {
      return {
        total: serverPositionsTotal,
        netVolume: serverPositionsTotals.volume,
        totalProfit: serverPositionsTotals.profit,
        uniqueLogins: serverPositionsTotals.uniqueLogins
      }
    }
    // Fallback to client-side WS cache totals
    return {
      total: filteredPositions.length,
      netVolume: filteredPositions.reduce((sum, p) => sum + (Number(p.volume) || 0), 0),
      totalProfit: filteredPositions.reduce((sum, p) => sum + (Number(p.profit) || 0), 0),
      uniqueLogins: new Set(filteredPositions.map(p => p.login)).size
    }
  }, [showClientNet, hasFetchedServerNet, serverNetPositions, serverNetTotal, serverPositionsTotals, hasFetchedServerPositions, serverPositionsTotal, filteredPositions])



  // Card carousel scroll tracking
  useEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) return

    const handleScroll = () => {
      const cardWidth = 125 + 8
      const scrollLeft = carousel.scrollLeft
      const index = Math.round(scrollLeft / cardWidth)
      setActiveCardIndex(index)
    }

    carousel.addEventListener('scroll', handleScroll)
    return () => carousel.removeEventListener('scroll', handleScroll)
  }, [])

  // CSV export helpers




  const handleMobileExport = async () => {
    if (isExporting) return
    if (showExchangeView) {
      exchangeViewRef.current?.exportData()
      return
    }
    setIsExporting(true)
    const EXPORT_LIMIT = 1000
    const CONCURRENCY = 5

    const formatTime = (ts) => apiFormatTime(ts, '-')

    try {
      if (showClientNet) {
        // ── NET positions export (mirrors desktop handleExportNetPositions) ──
        const baseParams = {
          netPosition: true,
          sortBy: 'netVolume',
          sortOrder: 'desc',
        }
        if (groupByBaseSymbol) baseParams.groupBaseSymbol = true
        if (displayMode === 'percentage') baseParams.percentage = true
        if (debouncedSearch.trim()) baseParams.search = debouncedSearch.trim()
        // Apply group filter
        const _netExportGroupName = getActiveGroupFilter('positions')
        if (_netExportGroupName) {
          const _netExportGroupLogins = getGroupLogins(_netExportGroupName).map(l => Number(l)).filter(n => !Number.isNaN(n))
          const _netExportApiFilters = [{ field: 'login', operator: 'in', value: _netExportGroupLogins.length > 0 ? _netExportGroupLogins : [-1] }]
          baseParams.filters = _netExportApiFilters
        }
        if (dateFilter) {
          const now = serverNowEpoch()
          baseParams.dateFrom = now - dateFilter * 24 * 60 * 60
          baseParams.dateTo = now
        }

        const ACTION_LABEL = { BUY: 'Buy', SELL: 'Sell', FLAT: 'Flat' }
        const mapItems = (data) => data.map(item => ({
          symbol: item.symbol || item.baseSymbol || '-',
          netType: ACTION_LABEL[item.action] ?? item.action ?? 'Flat',
          netVolume: item.netVolume ?? 0,
          avgPrice: item.averagePrice ?? item.avgPrice ?? 0,
          currentPrice: item.currentPrice ?? item.priceCurrent ?? 0,
          totalProfit: item.totalProfit ?? 0,
          totalStorage: item.totalStorage ?? 0,
          totalCommission: item.totalCommission ?? 0,
          loginCount: resolveLoginCount(item),
          totalPositions: item.positionCount ?? item.totalPositions ?? 0,
        }))

        // Page 1 to get total/pages
        const first = await brokerAPI.searchPositions({ ...baseParams, page: 1, limit: EXPORT_LIMIT })
        const firstData = first?.data?.positions ?? first?.positions ?? []
        const total = first?.data?.total ?? first?.total ?? 0
        const apiPages = first?.data?.pages ?? first?.pages ?? 0
        const totalPages = apiPages || Math.ceil(total / EXPORT_LIMIT)

        let allRows = mapItems(firstData)

        for (let start = 2; start <= totalPages; start += CONCURRENCY) {
          const chunk = []
          for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) {
            chunk.push(brokerAPI.searchPositions({ ...baseParams, page: p, limit: EXPORT_LIMIT }))
          }
          const results = await Promise.all(chunk)
          results.forEach(res => {
            allRows = allRows.concat(mapItems(res?.data?.positions ?? res?.positions ?? []))
          })
        }

        const pct = displayMode === 'percentage'
        const headers = [
          { key: 'symbol',         label: 'Symbol',                                     accessor: r => r.symbol },
          { key: 'netType',        label: 'NET Type',                                   accessor: r => r.netType },
          { key: 'netVolume',      label: pct ? 'NET Volume %'    : 'NET Volume',       accessor: r => r.netVolume },
          { key: 'avgPrice',       label: 'Avg Price',                                  accessor: r => r.avgPrice },
          { key: 'currentPrice',   label: 'Current Price',                              accessor: r => r.currentPrice },
          { key: 'totalProfit',    label: pct ? 'Total Profit %'  : 'Total Profit',     accessor: r => r.totalProfit },
          { key: 'totalStorage',   label: pct ? 'Swap %' : 'Swap',                      accessor: r => r.totalStorage },
          { key: 'totalCommission',label: 'Commission',                                 accessor: r => r.totalCommission },
          { key: 'loginCount',     label: 'Logins',                                     accessor: r => r.loginCount },
          { key: 'totalPositions', label: 'Positions',                                  accessor: r => r.totalPositions },
        ]
        const netColumns = styledColumnsFromHeaders(headers.filter(column => clientNetVisibleColumns[column.key]))
        exportStyledExcel({
          showTitle: false,
          title: 'NET Position',
          columns: netColumns,
          sections: [{ rows: allRows, totals: { label: 'TOTAL', values: sumColumns(allRows, netColumns, ['netVolume', 'totalProfit', 'totalStorage', 'totalCommission', 'totalPositions']) } }],
          sheetName: 'NET Position',
          fileName: `net_positions_${new Date().toISOString().slice(0, 10)}.csv`
        })

      } else {
        // ── Regular positions export (mirrors desktop handleExportPositions) ──
        const baseParams = {
          sortBy: sortColumn || 'timeCreate',
          sortOrder: sortDirection || 'desc',
        }
        if (debouncedSearch.trim()) baseParams.search = debouncedSearch.trim()
        if (displayMode === 'percentage') baseParams.percentage = true
        // Apply group filter
        const _regExportGroupName = getActiveGroupFilter('positions')
        if (_regExportGroupName) {
          const _regExportGroupLogins = getGroupLogins(_regExportGroupName).map(l => Number(l)).filter(n => !Number.isNaN(n))
          const _regExportApiFilters = [{ field: 'login', operator: 'in', value: _regExportGroupLogins.length > 0 ? _regExportGroupLogins : [-1] }]
          baseParams.filters = _regExportApiFilters
        }
        if (dateFilter) {
          const now = serverNowEpoch()
          baseParams.dateFrom = now - dateFilter * 24 * 60 * 60
          baseParams.dateTo = now
        }

        // Page 1 to get total/pages
        const first = await brokerAPI.searchPositions({ ...baseParams, page: 1, limit: EXPORT_LIMIT })
        const firstData = first?.data?.positions ?? first?.positions ?? []
        const total = first?.data?.total ?? first?.total ?? 0
        const apiPages = first?.data?.pages ?? first?.pages ?? 0
        const totalPages = apiPages || Math.ceil(total / EXPORT_LIMIT)

        let allPositions = [...firstData]

        for (let start = 2; start <= totalPages; start += CONCURRENCY) {
          const chunk = []
          for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) {
            chunk.push(brokerAPI.searchPositions({ ...baseParams, page: p, limit: EXPORT_LIMIT }))
          }
          const results = await Promise.all(chunk)
          results.forEach(res => {
            allPositions = allPositions.concat(res?.data?.positions ?? res?.positions ?? [])
          })
        }

        // Client-side safety net for group filter
        allPositions = filterByActiveGroup(allPositions, 'login', 'positions')

        const exportValue = (row, key) => {
          if (key === 'updated') return formatTime(row.timeUpdate || row.timeCreate || row.timeUpdateStr || row.timeCreateStr)
          if (key === 'action' || key === 'netType') return row.action ?? row.type
          if (key === 'netVolume') return row.volume ?? 0
          if (key === 'sl') return row.sl ?? row.priceSL ?? 0
          if (key === 'tp') return row.tp ?? row.priceTP ?? 0
          if (['profit', 'totalProfit', 'storage', 'commission'].includes(key)) {
            const value = row[key === 'totalProfit' ? 'profit' : key] ?? 0
            return /[cC]$/.test(String(row.symbol || '')) ? value / 100 : value
          }
          return row[key]
        }
        const posColumns = styledColumnsFromHeaders(activeColumns.map(column => ({
          key: column.key,
          label: column.label,
          accessor: row => exportValue(row, column.key)
        })))
        exportStyledExcel({
          showTitle: false,
          title: 'Positions',
          columns: posColumns,
          sections: [{ rows: allPositions, totals: { label: 'TOTAL', values: sumColumns(allPositions, posColumns, ['volume', 'volumePercentage', 'netVolume', 'profit', 'profitPercentage', 'totalProfit', 'storage', 'storagePercentage', 'commission']) } }],
          sheetName: 'Positions',
          fileName: `positions_${new Date().toISOString().slice(0, 10)}.csv`
        })
      }
    } catch (e) {
      console.error('Mobile export failed:', e)
      alert('Export failed. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // Reset to page 1 when date filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [dateFilter])

  // Fix mobile viewport height on actual devices
  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01
      document.documentElement.style.setProperty('--vh', `${vh}px`)
    }

    setVH()
    window.addEventListener('resize', setVH)
    window.addEventListener('orientationchange', setVH)

    return () => {
      window.removeEventListener('resize', setVH)
      window.removeEventListener('orientationchange', setVH)
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden" style={{ height: 'var(--app-viewport-height, 100dvh)' }}>
      {/* Header */}
      <div className="flex-wrap flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2 bg-transparent">
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
            <h1 className="text-[22px] leading-7 font-extrabold tracking-tight text-[#0F172A] truncate">Positions</h1>
            <p className="text-[12px] text-[#64748B] truncate">Track and monitor open positions</p>
          </div>
          <BrokerCreditSummary variant="header" />
        </div>

        
      


<BrokerCreditSummary variant="desktop-header" />
</div>

      {/* Sidebar Overlay */}
      {/* Shared mobile navigation drawer — one menu for every module (components/Sidebar.jsx) */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} onToggle={() => setIsSidebarOpen(value => !value)} mobileOnly />

      {/* Main Content */}
      <div className="mobile-position-content flex-1 min-h-0 flex flex-col overflow-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Face Cards Carousel - matching desktop: Total Positions, Floating Combined, Floating INR, Floating USD */}
        {isMobileView && !showClientNet && (() => {
          const cardStyle = {
            boxSizing: 'border-box', minWidth: '132px', width: '132px', height: '72px',
            background: 'transparent', border: '1px solid #D5DEEA',
            boxShadow: 'none', borderRadius: '14px',
            padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            scrollSnapAlign: 'start', flexShrink: 0, flex: 'none',
            userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'pan-x'
          }
          const icon = (name) => `${import.meta.env.BASE_URL || '/'}mobile-icons/${name}.svg`
          const fc = showExchangeView ? exchangeCardTotals : serverPositionsTotals
          const mobileCards = [
            {
              label: 'Total Positions',
              icon: icon('Total Positions'),
              value: fmtCount(showExchangeView ? exchangeCardTotals.positionCount : netTotals?.total || 0),
              fullValue: showExchangeView ? exchangeCardTotals.positionCount : netTotals?.total || 0,
              color: '#000000',
              arrow: null
            },
            {
              label: 'Floating Combined',
              icon: icon('Floating Combined'),
              value: fmtMoney(fc.floatingCombined),
              fullValue: fc.floatingCombined,
              color: fc.floatingCombined >= 0 ? '#16A34A' : '#DC2626',
              arrow: fc.floatingCombined >= 0 ? '▲' : '▼'
            },
            {
              label: 'Floating INR',
              icon: icon('Floating INR'),
              value: fmtMoney(fc.floatingINR),
              fullValue: fc.floatingINR,
              color: fc.floatingINR >= 0 ? '#16A34A' : '#DC2626',
              arrow: fc.floatingINR >= 0 ? '▲' : '▼'
            },
            {
              label: 'Floating USD',
              icon: icon('Floating USD'),
              value: fmtMoney(fc.floatingUSD),
              fullValue: fc.floatingUSD,
              color: fc.floatingUSD >= 0 ? '#16A34A' : '#DC2626',
              arrow: fc.floatingUSD >= 0 ? '▲' : '▼'
            },
          ]
          return (
            <div className="pt-3 pb-1 pl-4">
              <div className="flex gap-[10px] overflow-x-auto scrollbar-hide snap-x snap-mandatory pr-4 pb-2">
                {mobileCards.map((card) => (
                  <div key={card.label} style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: card.arrow ? (card.fullValue > 0 ? '#DCFCE7' : card.fullValue < 0 ? '#FEE2E2' : '#DBEAFE') : '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: '5px' }}>
                        <img src={card.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'brightness(0) saturate(100%) invert(27%) sepia(97%) saturate(1500%) hue-rotate(213deg) brightness(100%)' }} onError={(e) => { e.target.style.display = 'none' }} />
                      </div>
                      <span style={{ color: '#334155', fontSize: '11px', fontWeight: 500, lineHeight: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minHeight: '16px', pointerEvents: 'none' }}>
                      {card.arrow && <span style={{ fontSize: '10px', color: card.color, lineHeight: 1, flexShrink: 0 }}>{card.arrow}</span>}
                      <span title={numericMode === 'compact' ? fmtMoneyFull(card.fullValue) : undefined} style={{ fontSize: '14px', fontWeight: 700, lineHeight: '18px', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: card.color }}>{card.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Action buttons row */}
        <div className="pt-2 pb-3 px-3">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            <button 
              onClick={() => setIsCustomizeOpen(true)}
              className={`h-9 px-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all relative flex-shrink-0 ${
                (filters.hasFloating || filters.hasCredit || filters.noDeposit || getActiveGroupFilter('positions'))
                  ? 'bg-blue-50 border-blue-200' 
                  : 'bg-transparent border-[#D5DEEA] hover:bg-white/60'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4.5 6H9.5M2.5 3.5H11.5M5.5 9.5H8.5" stroke="#4B4B4B" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span className="text-[#1F2937] text-[11px] font-medium font-outfit">Filter</span>
              {(() => {
                const filterCount = [
                  filters.hasFloating,
                  filters.hasCredit,
                  filters.noDeposit,
                  getActiveGroupFilter('positions')
                ].filter(Boolean).length;
                return filterCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {filterCount}
                  </span>
                ) : null;
              })()}
            </button>
            <button 
              onClick={() => {
                startTransition(() => {
                  setShowClientNet((v) => {
                    const next = !v
                    if (next) {
                      setClientNetCurrentPage(1)
                    }
                    return next
                  })
                  if (!showClientNet) setShowExchangeView(false)
                })
              }}
              style={{ minWidth: '110px', width: '110px', flexShrink: 0 }}
              className={`h-9 rounded-xl ${showClientNet ? 'bg-[#2563EB] border-[#2563EB]' : 'bg-transparent border-[#D5DEEA]'} border flex items-center justify-center gap-1.5 hover:opacity-90 transition-all`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 10h10M10 14h7M13 18h4" stroke={showClientNet ? "#ffffff" : "#666666"} />
              </svg>
              <span className={`${showClientNet ? 'text-white' : 'text-[#1F2937]'} text-[11px] font-medium font-outfit`}>NET Position</span>
            </button>
            <button
              onClick={() => {
                startTransition(() => {
                  const next = !showExchangeView
                  setShowExchangeView(next)
                  if (next) setShowClientNet(false)
                })
              }}
              style={{ flexShrink: 0 }}
              className={`h-9 px-2.5 rounded-xl ${showExchangeView ? 'bg-[#2563EB] border-[#2563EB]' : 'bg-transparent border-[#D5DEEA]'} border flex items-center justify-center gap-1.5 hover:opacity-90 transition-all`}
              title="Exchange-wise NET Position"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M5 21V10m4 11V10m6 11V10m4 11V10M12 3l9 5H3l9-5z" stroke={showExchangeView ? '#ffffff' : '#666666'} />
              </svg>
              <span className={`${showExchangeView ? 'text-white' : 'text-[#1F2937]'} text-[11px] font-medium font-outfit`}>Exchange</span>
            </button>
            {/* Percentage toggle icon button */}
            <button
              onClick={() => startTransition(() => setDisplayMode(m => m === 'percentage' ? 'value' : 'percentage'))}
              title={displayMode === 'percentage' ? 'Switch to value view' : 'Switch to percentage view'}
              className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 transition-all ${
                displayMode === 'percentage'
                  ? 'bg-[#2563EB] border-[#2563EB]'
                  : 'bg-transparent border-[#D5DEEA] hover:bg-white/60'
              }`}
            >
              <span className={`text-[13px] font-bold leading-none ${displayMode === 'percentage' ? 'text-white' : 'text-[#4B4B4B]'}`}>%</span>
            </button>

            {/* Download button */}
            <button
              onClick={handleMobileExport}
              disabled={isExporting}
              title={isExporting ? 'Exporting...' : showClientNet ? 'Export NET positions to CSV' : 'Export positions to CSV'}
              className="w-9 h-9 rounded-xl border border-[#D5DEEA] bg-transparent flex items-center justify-center hover:bg-gray-50 transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting
                ? <svg className="w-4 h-4 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                : <svg className="w-4 h-4" fill="none" stroke="#4B4B4B" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-3-3m3 3l3-3M4 20h16"/></svg>
              }
            </button>

            <button 
              onClick={() => window.location.reload()}
              disabled={loading.positions}
              className="w-9 h-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="#4B4B4B" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>


        {/* Search and navigation */}
        {!showClientNet && !showExchangeView && (
        <div className="mx-4 mb-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex-1 min-w-0 h-10 bg-transparent border border-[#D5DEEA] rounded-xl px-3 flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 text-[#9CA3AF]">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M13 13L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input
                  type="search" name="no-autofill-search" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-form-type="other" readOnly onPointerDown={e => e.currentTarget.removeAttribute('readonly')} onFocus={e => e.currentTarget.removeAttribute('readonly')} 
                placeholder="Search by symbol, login..."
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
              onClick={() => handlePageChange(currentPage - 1, mobileRegularTotalPages)}
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
                max={mobileRegularTotalPages}
                value={currentPage}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  const maxPage = mobileRegularTotalPages
                  if (!isNaN(n) && n >= 1 && n <= maxPage) {
                    handlePageChange(n, maxPage)
                  }
                }}
                className="w-10 h-10 bg-[#2563EB] text-white font-semibold border border-[#2563EB] rounded-xl text-center text-[13px] shadow-[0_4px_10px_rgba(37,99,235,0.3)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label="Current page"
              />
              <span className="text-[#9CA3AF]">/</span>
              <span className="text-[#6B7280]">{mobileRegularTotalPages}</span>
            </div>
            <button 
              onClick={() => handlePageChange(currentPage + 1, mobileRegularTotalPages)}
              disabled={currentPage >= mobileRegularTotalPages}
              className="h-10 w-9 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center hover:bg-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path d="M8 6L12 10L8 14" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        )}

        {/* Table - full width, remove outer padding */}
        {!showClientNet && !showExchangeView && (
        <div className="flex-1 min-h-0 flex flex-col" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
          <div className="flex-1 min-h-0 flex flex-col bg-transparent border border-blue-100 max-md:border-b-0 overflow-hidden">
            {/* Single scroll container with sticky header */}
            <div className="mobile-table-scroll w-full flex-1 min-h-0 overflow-x-auto overflow-y-auto scrollbar-hide" style={{
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              paddingRight: '8px',
              paddingBottom: '8px',
              overscrollBehavior: 'contain'
            }}>
                <div className="relative" style={{ minWidth: 'max-content' }}>
                  {/* Table Header - Sticky */}
                  <div data-mobile-data-row="header" 
                    className="grid bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wide shadow-[0_2px_4px_rgba(0,0,0,0.1)] sticky top-0 z-20"
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
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSort(col.key)
                        }}
                        className={`h-[28px] flex items-center justify-start px-1 cursor-pointer ${col.sticky ? 'sticky left-0 bg-blue-500 z-30' : ''}`}
                        style={{
                          border: 'none', 
                          outline: 'none', 
                          boxShadow: 'none',
                          WebkitTapHighlightColor: 'transparent',
                          userSelect: 'none',
                          touchAction: 'manipulation',
                          pointerEvents: 'auto'
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
                  {isInitialLoading || (loading && loading.positions) || isPageChanging ? (
                    // YouTube-style skeleton loading
                  <>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                      <div data-mobile-data-row="body" 
                        key={`skeleton-row-${i}`}
                        className="grid text-[12px] text-[#374151] tabular-nums bg-transparent border-b border-[#E1E1E1]"
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
                            className={`h-[38px] flex items-center justify-center px-1 ${col.sticky ? 'sticky left-0 bg-white z-10' : ''}`}
                            style={{border: 'none', outline: 'none', boxShadow: col.sticky ? '2px 0 4px rgba(0,0,0,0.05)' : 'none'}}
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
                ) : filteredPositions.length === 0 && !isInitialLoading ? (
                  <div className="text-center py-8 text-[#6B7280] text-sm">
                    {(filters.hasFloating || filters.hasCredit || filters.noDeposit || getActiveGroupFilter('positions')) 
                      ? 'No positions match the applied filters' 
                      : 'No positions found'}
                  </div>
                ) : (
                  mobileRegularDisplayedPositions.map((pos, idx) => (
                    <div data-mobile-data-row="body" 
                      key={idx} 
                      className="grid text-[12px] text-[#374151] tabular-nums bg-transparent border-b border-[#E1E1E1] hover:bg-white/50 transition-colors"
                      style={{
                        gap: '0px', 
                        gridGap: '0px', 
                        columnGap: '0px',
                        gridTemplateColumns
                      }}
                    >
                      {activeColumns.map(col => (
                        <React.Fragment key={col.key}>
                          {renderCellValue(pos, col.key, col.sticky)}
                        </React.Fragment>
                      ))}
                    </div>
                  ))
                )}

                {/* Table Footer removed for mobile view */}
                <div aria-hidden="true" className="mobile-table-end" />
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Export loading overlay (same dialog as Bills export) */}
        {isExporting && <LoadingSpinner message={showClientNet ? 'Exporting NET positions…' : 'Exporting positions…'} subtitle="Preparing your CSV download" />}

        {/* Exchange View - NET positions segregated by exchange */}
        {showExchangeView && isMobileView && (
          <ExchangeNetPositions
            ref={exchangeViewRef}
            variant="mobile"
            onTotals={totals => setExchangeCardTotals({
              positionCount: Number(totals?.positionCount) || 0,
              floatingCombined: Number(totals?.floatingCombined) || 0,
              floatingINR: Number(totals?.floatingINR) || 0,
              floatingUSD: Number(totals?.floatingUSD) || 0
            })}
            displayMode={displayMode}
            masterLabel={getActiveGroupFilter('positions') || 'ALL'}
            loginFilter={(() => {
              const activeGroupName = getActiveGroupFilter('positions')
              return activeGroupName ? getGroupLogins(activeGroupName).map(Number).filter(n => !Number.isNaN(n)) : null
            })()}
          />
        )}

        {/* Client NET View */}

        {showClientNet && isMobileView && (
          <div className="bg-transparent flex flex-col flex-1 min-h-0">
            {/* Face Cards Carousel removed from NET Position mobile view per request */}

            {/* Controls with Search - SYMMETRICAL with regular Positions tab */}
            <div className="pb-3 px-4">
              <div className="flex items-center gap-1">
                <div className="flex-1 min-w-0 h-[32px] bg-transparent border border-[#D5DEEA] rounded-[10px] px-2 flex items-center gap-1.5">
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
                    <circle cx="8" cy="8" r="6.5" stroke="#4B4B4B" strokeWidth="1.5"/>
                    <path d="M13 13L16 16" stroke="#4B4B4B" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <input
                  type="search" name="no-autofill-search" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-form-type="other" readOnly onPointerDown={e => e.currentTarget.removeAttribute('readonly')} onFocus={e => e.currentTarget.removeAttribute('readonly')} 
                    placeholder="Search" 
                    value={clientNetSearchInput}
                    onChange={(e) => setClientNetSearchInput(e.target.value)}
                    className="flex-1 min-w-0 text-[11px] text-[#000000] placeholder-[#9CA3AF] outline-none bg-transparent font-outfit"
                  />
                </div>
                <button 
                  onClick={() => setClientNetShowColumnSelector(true)}
                  className="w-[28px] h-[28px] bg-transparent border border-[#D5DEEA] rounded-[10px] flex items-center justify-center transition-colors flex-shrink-0 hover:bg-gray-50">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                    <rect x="3" y="5" width="4" height="10" stroke="#4B4B4B" strokeWidth="1.5" rx="1"/>
                    <rect x="8.5" y="5" width="4" height="10" stroke="#4B4B4B" strokeWidth="1.5" rx="1"/>
                    <rect x="14" y="5" width="3" height="10" stroke="#4B4B4B" strokeWidth="1.5" rx="1"/>
                  </svg>
                </button>
                <button 
                  onClick={() => handleClientNetPageChange(clientNetCurrentPage - 1, clientNetTotalPages)}
                  disabled={clientNetCurrentPage === 1}
                  className="w-[28px] h-[28px] bg-transparent border border-[#D5DEEA] rounded-[10px] flex items-center justify-center transition-colors flex-shrink-0 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M12 14L8 10L12 6" stroke="#4B4B4B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <div className="px-2 text-[10px] font-medium text-[#4B4B4B] flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={clientNetTotalPages}
                    value={clientNetCurrentPage}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!isNaN(n) && n >= 1 && n <= clientNetTotalPages) {
                        handleClientNetPageChange(n, clientNetTotalPages)
                      }
                    }}
                    className="w-10 h-6 border border-[#D5DEEA] rounded-[8px] bg-transparent text-center text-[10px]"
                    aria-label="Current page"
                  />
                  <span className="text-[#9CA3AF]">/</span>
                  <span>{clientNetTotalPages}</span>
                </div>
                <button 
                  onClick={() => handleClientNetPageChange(clientNetCurrentPage + 1, clientNetTotalPages)}
                  disabled={clientNetCurrentPage === clientNetTotalPages}
                  className="w-[28px] h-[28px] bg-transparent border border-[#D5DEEA] rounded-[10px] flex items-center justify-center transition-colors flex-shrink-0 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M8 6L12 10L8 14" stroke="#4B4B4B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Client NET Table - FIXED GRID ALIGNMENT */}
            <div className="flex-1 min-h-0 flex flex-col" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
              <style>{clientNetOrderCss}</style>
              <div className="bg-transparent border border-blue-100 max-md:border-b-0 overflow-hidden flex-1 min-h-0 flex flex-col">
                {/* Table - single scroll container */}
                <div data-net-table className="mobile-table-scroll overflow-x-auto overflow-y-auto scrollbar-hide flex-1 min-h-0" style={{
                  paddingRight: '8px',
                  paddingBottom: '0px',
                  overflowY: 'auto'
                }}>
                  {/* Header - Sticky */}
                  <div data-mobile-data-row="header"
                    className="grid bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wide h-[30px] sticky top-0 z-30"
                    style={{
                      minWidth: 'max-content',
                      gridTemplateColumns: clientNetGridTemplate,
                      gap: '0px',
                      columnGap: '0px'
                    }}
                  >
                    {clientNetVisibleColumns.symbol && (
                      <div data-col="symbol"
                        className="flex items-center justify-start px-1 cursor-pointer sticky left-0 z-50 bg-blue-500"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('symbol'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto', boxShadow: '2px 0 4px rgba(0,0,0,0.08)' }}
                      >
                        Symbol
                        {clientNetSortColumn === 'symbol' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.netType && (
                      <div data-col="netType"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('netType'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Type
                        {clientNetSortColumn === 'netType' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.netVolume && (
                      <div data-col="netVolume"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('netVolume'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        NET Vol
                        {clientNetSortColumn === 'netVolume' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.avgPrice && (
                      <div data-col="avgPrice"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('avgPrice'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Avg Price
                        {clientNetSortColumn === 'avgPrice' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.currentPrice && (
                      <div data-col="currentPrice"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('currentPrice'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Current Price
                        {clientNetSortColumn === 'currentPrice' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.totalProfit && (
                      <div data-col="totalProfit"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('totalProfit'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Total Profit
                        {clientNetSortColumn === 'totalProfit' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.totalStorage && (
                      <div data-col="totalStorage"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('totalStorage'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Swap
                        {clientNetSortColumn === 'totalStorage' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.totalCommission && (
                      <div data-col="totalCommission"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('totalCommission'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Comm
                        {clientNetSortColumn === 'totalCommission' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.loginCount && (
                      <div data-col="loginCount"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('loginCount'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Logins
                        {clientNetSortColumn === 'loginCount' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                    {clientNetVisibleColumns.totalPositions && (
                      <div data-col="totalPositions"
                        className="flex items-center justify-start px-1 cursor-pointer bg-blue-500 text-white"
                        onClick={(e) => { e.stopPropagation(); handleClientNetSort('totalPositions'); }}
                        style={{ userSelect: 'none', touchAction: 'manipulation', pointerEvents: 'auto' }}
                      >
                        Positions
                        {clientNetSortColumn === 'totalPositions' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="ml-1">
                            <path d={clientNetSortDirection === 'asc' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Table Rows */}
                  {(isServerNetLoading || isClientNetPageChanging) && filteredClientNetPositions.length === 0 ? (
                    <>
                      {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div data-mobile-data-row="body" key={`client-net-skeleton-${i}`} className="grid text-[12px] text-[#374151] tabular-nums bg-transparent border-b border-[#E1E1E1]" style={{
                          minWidth: 'max-content',
                          gridTemplateColumns: clientNetGridTemplate
                        }}>
                          {clientNetVisibleColumns.symbol && <div data-col="symbol" className="h-[40px] flex items-center px-1 bg-white sticky left-0 z-10 border-b border-[#E1E1E1]" style={{boxShadow:'2px 0 4px rgba(0,0,0,0.05)'}}><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.netType && <div data-col="netType" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.netVolume && <div data-col="netVolume" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.avgPrice && <div data-col="avgPrice" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.currentPrice && <div data-col="currentPrice" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.totalProfit && <div data-col="totalProfit" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.totalStorage && <div data-col="totalStorage" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.totalCommission && <div data-col="totalCommission" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[70%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.loginCount && <div data-col="loginCount" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[60%] bg-gray-200 rounded animate-pulse" /></div>}
                          {clientNetVisibleColumns.totalPositions && <div data-col="totalPositions" className="h-[40px] flex items-center px-1 bg-transparent border-b border-[#E1E1E1]"><div className="h-3 w-[60%] bg-gray-200 rounded animate-pulse" /></div>}
                        </div>
                      ))}
                    </>
                  ) : clientNetPaginatedPositions.length === 0 ? (
                    <div className="text-center py-8 text-[#6B7280] text-sm">No NET positions found</div>
                  ) : (
                    clientNetPaginatedPositions.map((pos, idx) => (
                      <div data-mobile-data-row="body" key={idx} className="grid text-[12px] text-[#374151] tabular-nums hover:bg-[#F8FAFC]" style={{
                        minWidth: 'max-content',
                        gridTemplateColumns: clientNetGridTemplate
                      }}>
                        {clientNetVisibleColumns.symbol && (
                          <div data-col="symbol"
                            className="flex items-center justify-start px-1 h-[40px] font-semibold bg-white text-black sticky left-0 z-20 border-b border-[#E1E1E1]"
                            style={{boxShadow: '2px 0 4px rgba(0,0,0,0.05)'}}
                          >
                            {pos.symbol || '-'}
                          </div>
                        )}
                        {clientNetVisibleColumns.netType && <div data-col="netType" className="flex items-center justify-start px-1 h-[40px] bg-transparent border-b border-[#E1E1E1]"><NetTypeChip type={pos.netType} compact /></div>}
                        {clientNetVisibleColumns.netVolume && <div data-col="netVolume" title={numericMode === 'compact' ? fmtMoneyFull(pos.netVolume) : undefined} className="flex items-center justify-start px-1 h-[40px] bg-transparent text-[#374151] border-b border-[#E1E1E1]">{fmtMoney(pos.netVolume)}</div>}
                        {clientNetVisibleColumns.avgPrice && <div data-col="avgPrice" title={fmtMoneyFull(pos.avgPrice)} className="flex items-center justify-start px-1 h-[40px] bg-transparent text-[#374151] border-b border-[#E1E1E1]">{fmtMoneyFull(pos.avgPrice)}</div>}
                        {clientNetVisibleColumns.currentPrice && <div data-col="currentPrice" title={fmtMoneyFull(pos.currentPrice)} className="flex items-center justify-start px-1 h-[40px] bg-transparent text-[#374151] border-b border-[#E1E1E1]">{fmtMoneyFull(pos.currentPrice)}</div>}
                        {clientNetVisibleColumns.totalProfit && <div data-col="totalProfit" title={numericMode === 'compact' ? fmtMoneyFull(pos.totalProfit) : undefined} className={`flex items-center justify-start px-1 h-[40px] font-semibold bg-transparent border-b border-[#E1E1E1] ${
                          pos.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>{fmtMoney(pos.totalProfit)}</div>}
                        {clientNetVisibleColumns.totalStorage && <div data-col="totalStorage" title={numericMode === 'compact' ? fmtMoneyFull(pos.totalStorage || 0) : undefined} className="flex items-center justify-start px-1 h-[40px] bg-transparent text-[#374151] border-b border-[#E1E1E1]">{fmtMoney(pos.totalStorage || 0)}</div>}
                        {clientNetVisibleColumns.totalCommission && <div data-col="totalCommission" title={numericMode === 'compact' ? fmtMoneyFull(pos.totalCommission || 0) : undefined} className="flex items-center justify-start px-1 h-[40px] bg-transparent text-[#374151] border-b border-[#E1E1E1]">{fmtMoney(pos.totalCommission || 0)}</div>}
                        {clientNetVisibleColumns.loginCount && <div data-col="loginCount" className="flex items-center justify-start px-1 h-[40px] bg-transparent text-[#374151] border-b border-[#E1E1E1]">{Number(pos.loginCount || 0)}</div>}
                        {clientNetVisibleColumns.totalPositions && <div data-col="totalPositions" className="flex items-center justify-start px-1 h-[40px] bg-transparent text-[#374151] border-b border-[#E1E1E1]">{pos.totalPositions}</div>}
                      </div>
                    ))
                  )}

                  {/* Footer removed for mobile view */}
                  <div aria-hidden="true" className="mobile-table-end" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <MobileBottomNav onMore={() => setIsSidebarOpen(true)} />

      {/* CustomizeView Modal */}
      <CustomizeViewModal
        isOpen={isCustomizeOpen}
        onClose={() => setIsCustomizeOpen(false)}
        onDateFilterClick={() => {
          setIsCustomizeOpen(false)
          setIsDateFilterOpen(true)
        }}
        onGroupsClick={() => {
          setIsCustomizeOpen(false)
          setIsLoginGroupsOpen(true)
        }}
        onReset={() => {
          setFilters({ hasFloating: false, hasCredit: false, noDeposit: false })
          setDateFilter(null)
          setActiveGroupFilter('positions', null)
          setHasPendingGroupChanges(false)
          setHasPendingDateChanges(false)
          setPendingGroupDraft(null)
          setPendingDateDraft(null)
        }}
        onApply={() => {
          if (hasPendingGroupChanges) {
            setActiveGroupFilter('positions', pendingGroupDraft ? pendingGroupDraft.name : null)
          }
          if (hasPendingDateChanges) {
            setDateFilter(pendingDateDraft)
          }
          setIsCustomizeOpen(false)
          setHasPendingGroupChanges(false)
          setHasPendingDateChanges(false)
          setPendingGroupDraft(null)
          setPendingDateDraft(null)
        }}
        hasPendingChanges={hasPendingGroupChanges || hasPendingDateChanges}
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

      {/* Date Filter Modal */}
      <DateFilterModal
        isOpen={isDateFilterOpen}
        onClose={() => setIsDateFilterOpen(false)}
        onApply={(days) => {
          setDateFilter(days)
          setIsDateFilterOpen(false)
        }}
        currentFilter={dateFilter}
        onPendingChange={(hasPending, draft) => {
          setHasPendingDateChanges(hasPending)
          setPendingDateDraft(draft)
        }}
      />

      {/* Group Modal */}
      <GroupModal
        isOpen={isGroupOpen}
        onClose={() => setIsGroupOpen(false)}
        availableItems={ibFilteredPositions}
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
        activeGroupName={getActiveGroupFilter('positions')}
        onSelectGroup={(group) => {
          if (group === null) {
            setActiveGroupFilter('positions', null)
          } else {
            setActiveGroupFilter('positions', group.name)
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
          if (window.confirm(`Delete group "${group.name}"?`)) {
            deleteGroup(group.name)
          }
        }}
        onPendingChange={(hasPending, draftName) => {
          setHasPendingGroupChanges(hasPending)
          setPendingGroupDraft(draftName ? { name: draftName } : null)
        }}
      />

      {/* Login Group Modal (Create/Edit) */}
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

      {/* Column Selector Modal */}
      {isColumnSelectorOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setIsColumnSelectorOpen(false)}>
          <div 
            className="bg-white w-full rounded-t-[28px] max-h-[85dvh] flex flex-col overflow-hidden shadow-[0_-8px_30px_rgba(15,23,42,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pt-2.5 flex justify-center flex-shrink-0"><span className="w-10 h-1 rounded-full bg-[#CBD5E1]" /></div>
            <div className="px-5 pt-3 pb-3 border-b border-[#D5DEEA] flex items-center justify-between gap-3 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-[18px] leading-6 font-extrabold tracking-tight text-[#0F172A] truncate">Columns</h3>
                <p className="text-[12px] text-[#64748B] truncate">Show, hide & reorder columns</p>
              </div>
              <button onClick={() => setIsColumnSelectorOpen(false)} aria-label="Close" className="w-10 h-10 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="#0F172A" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Scoped restyle of the shared ColumnChooserList to match the mobile theme */}
            <style>{`
              .c2-col-chooser > div > div { border-color: #D5DEEA !important; }
              .c2-col-chooser input[type="text"] { background: transparent !important; border-color: #D5DEEA !important; border-radius: 12px !important; height: 40px; font-size: 13px !important; }
              .c2-col-chooser input[type="checkbox"] { width: 16px !important; height: 16px !important; accent-color: #2563EB; border-radius: 4px; }
              .c2-col-chooser .overscroll-contain > [data-col-key] { padding-top: 10px; padding-bottom: 10px; margin-left: 12px; margin-right: 12px; border-radius: 0; border-bottom: 1px solid rgba(213, 222, 234, 0.6); }
              .c2-col-chooser .overscroll-contain > [data-col-key] label span { font-size: 13px !important; color: #1F2937 !important; }
            `}</style>
            <div className="c2-col-chooser flex-1 min-h-0 flex flex-col">
              <ColumnChooserList
                columns={(() => {
                  const allColumns = [ { label: 'Login', key: 'login' }, { label: 'Time', key: 'updated' }, { label: 'First Name', key: 'firstName' }, { label: 'Middle Name', key: 'middleName' }, { label: 'Last Name', key: 'lastName' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Position', key: 'position' }, { label: 'Symbol', key: 'symbol' }, ...(isMobileView ? [{ label: 'Action', key: 'netType' }] : [ { label: 'Action', key: 'action' }, { label: 'Action', key: 'netType' } ]), { label: 'Volume', key: 'volume' }, { label: 'Volume %', key: 'volumePercentage' }, { label: 'Open Price', key: 'priceOpen' }, { label: 'Price Current', key: 'priceCurrent' }, { label: 'Net Volume', key: 'netVolume' }, { label: 'S/L', key: 'sl' }, { label: 'T/P', key: 'tp' }, { label: 'Profit', key: 'profit' }, { label: 'Total Profit', key: 'totalProfit' }, { label: 'Profit %', key: 'profitPercentage' }, { label: 'Swap', key: 'storage' }, { label: 'Swap %', key: 'storagePercentage' }, { label: 'Applied %', key: 'appliedPercentage' }, { label: 'Reason', key: 'reason' }, { label: 'Comment', key: 'comment' }, { label: 'Commission', key: 'commission' } ]
                  const excludedOnMobile = new Set(['firstName','middleName','lastName','email','phone'])
                  return allColumns.filter(col => !isMobileView || !excludedOnMobile.has(col.key))
                })()}
                visibleColumns={visibleColumns}
                onToggle={(key) => setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))}
                columnOrder={positionsColumnOrder}
                onReorder={setPositionsColumnOrder}
                onResetOrder={() => setPositionsColumnOrder(null)}
                accent="blue"
                title={null}
                reorderMode="touch"
              />
            </div>
          </div>
        </div>
      )}

      {/* Client Net Column Selector Modal */}
      {clientNetShowColumnSelector && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setClientNetShowColumnSelector(false)}>
          <div 
            className="bg-white w-full rounded-t-[28px] max-h-[85dvh] flex flex-col overflow-hidden shadow-[0_-8px_30px_rgba(15,23,42,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pt-2.5 flex justify-center flex-shrink-0"><span className="w-10 h-1 rounded-full bg-[#CBD5E1]" /></div>
            <div className="px-5 pt-3 pb-3 border-b border-[#D5DEEA] flex items-center justify-between gap-3 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-[18px] leading-6 font-extrabold tracking-tight text-[#0F172A] truncate">Columns</h3>
                <p className="text-[12px] text-[#64748B] truncate">Show, hide & reorder columns</p>
              </div>
              <button onClick={() => setClientNetShowColumnSelector(false)} aria-label="Close" className="w-10 h-10 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="#0F172A" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Scoped restyle of the shared ColumnChooserList to match the mobile theme */}
            <style>{`
              .c2-col-chooser > div > div { border-color: #D5DEEA !important; }
              .c2-col-chooser input[type="text"] { background: transparent !important; border-color: #D5DEEA !important; border-radius: 12px !important; height: 40px; font-size: 13px !important; }
              .c2-col-chooser input[type="checkbox"] { width: 16px !important; height: 16px !important; accent-color: #2563EB; border-radius: 4px; }
              .c2-col-chooser .overscroll-contain > [data-col-key] { padding-top: 10px; padding-bottom: 10px; margin-left: 12px; margin-right: 12px; border-radius: 0; border-bottom: 1px solid rgba(213, 222, 234, 0.6); }
              .c2-col-chooser .overscroll-contain > [data-col-key] label span { font-size: 13px !important; color: #1F2937 !important; }
            `}</style>
            <div className="c2-col-chooser flex-1 min-h-0 flex flex-col">
              <ColumnChooserList
                columns={CLIENT_NET_COLUMNS.map(({ key, label }) => ({ key, label }))}
                visibleColumns={clientNetVisibleColumns}
                onToggle={(key) => setClientNetVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))}
                columnOrder={clientNetColumnOrder}
                onReorder={setClientNetColumnOrder}
                onResetOrder={() => setClientNetColumnOrder(null)}
                accent="blue"
                title={null}
                reorderMode="touch"
              />
            </div>
          </div>
        </div>
      )}

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
  );
}
