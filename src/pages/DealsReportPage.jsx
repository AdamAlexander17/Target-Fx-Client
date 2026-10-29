import BrokerCreditSummary from '../components/BrokerCreditSummary'
import QuickTimeFilter from '../components/QuickTimeFilter'
import { getPresetRange, QUICK_FILTERS } from '../utils/dealTimePresets'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { brokerAPI } from '../services/api'
import { useAuth } from '../contexts/authContextStore'
import Sidebar from '../components/Sidebar'
import MobileBottomNav from '../components/MobileBottomNav'
import MobileCalendar from '../components/MobileCalendar'
import MobileSelect from '../components/MobileSelect'
import { formatIsoDate } from '../utils/isoDate'
import GroupSelector from '../components/GroupSelector'
import GroupModal from '../components/GroupModal'
import CustomizeViewModal from '../components/CustomizeViewModal'
import LoginGroupsModal from '../components/LoginGroupsModal'
import LoginGroupModal from '../components/LoginGroupModal'
import { useGroups } from '../contexts/groupContextStore'
import ClientPositionsModal from '../components/ClientPositionsModal'
import ClientDetailsMobileModal from '../components/ClientDetailsMobileModal'
import PageSizeSelect from '../components/PageSizeSelect'
import LoadingSpinner from '../components/LoadingSpinner'
import ColumnChooserList from '../components/ColumnChooserList'
import { formatTime as apiFormatTime, serverNowDate, serverEpochFromParts, fromServerEpoch } from '../utils/dateFormatter'
import DateInputDMY from '../components/DateInputDMY'
import { exportStyledExcel, actionColor } from '../utils/exportStyledExcel'

const EMPTY_CLIENT_CACHE = []
const ignoreClientUpdate = () => {}
const EXPORT_CHUNK = 500
const PAGE_SIZE_OPTIONS = [50, 100, 250, 500]
const MOBILE_PAGE_SIZE = 15

const formatNumber = (value, digits = 2) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0.00'
  return number.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const formatTime = (value) => apiFormatTime(value, '-')

const toYmd = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 'YYYY-MM-DD' -> server epoch (seconds); endOfDay covers the whole "to" day
const ymdToEpoch = (value, endOfDay = false) => {
  const [year, month, day] = value.split('-').map(Number)
  return endOfDay
    ? serverEpochFromParts(year, month - 1, day, 23, 59, 59)
    : serverEpochFromParts(year, month - 1, day, 0, 0, 0)
}


const DEAL_ACTIONS = {
  0: 'Buy', 1: 'Sell', 2: 'Balance', 3: 'Credit', 4: 'Charge', 5: 'Correction', 6: 'Bonus',
  7: 'Commission', 8: 'Daily Commission', 9: 'Monthly Commission', 10: 'Agent Daily',
  11: 'Agent Monthly', 12: 'Intergroup Agent'
}
const getDealActionLabel = (action) => {
  if (action === null || action === undefined || action === '') return '-'
  const numeric = Number(action)
  if (Number.isInteger(numeric) && DEAL_ACTIONS[numeric]) return DEAL_ACTIONS[numeric]
  return String(action).toUpperCase()
}
const getDealActionClass = (label) => {
  const text = String(label).toUpperCase()
  if (text === 'BUY') return 'bg-green-100 text-green-800'
  if (text === 'SELL') return 'bg-red-100 text-red-800'
  return 'bg-blue-50 text-blue-700'
}

const COLUMNS = [
  { key: 'deal', label: 'Deal', get: d => d.deal ?? d.id ?? '-' },
  { key: 'time', label: 'Time', get: d => formatTime(d.time ?? d.timeStr) },
  { key: 'login', label: 'Login', get: d => d.login ?? '-' },
  { key: 'name', label: 'Name', get: d => d.name || '-' },
  { key: 'action', label: 'Action', get: d => getDealActionLabel(d.action) },
  { key: 'symbol', label: 'Symbol', get: d => d.symbol || '-' },
  { key: 'volume', label: 'Volume', numeric: true, get: d => Number(d.volume || 0) },
  { key: 'price', label: 'Price', numeric: true, get: d => Number(d.price || 0) },
  { key: 'profit', label: 'Profit', numeric: true, get: d => Number(d.profit || 0) },
  { key: 'commission', label: 'Commission', numeric: true, get: d => Number(d.commission || 0) },
  { key: 'storage', label: 'Swap', numeric: true, get: d => Number(d.storage || 0) },
  { key: 'order', label: 'Order', get: d => Number(d.order) > 0 ? d.order : '-' },
  { key: 'position', label: 'Position', get: d => Number(d.position) > 0 ? d.position : '-' },
  { key: 'comment', label: 'Comment', get: d => d.comment || '' }
]

// Mobile grid: Login first and sticky, like the other mobile modules
const MOBILE_WIDTHS = { login: 72, time: 118, deal: 72, name: 90, action: 64, symbol: 110, volume: 64, price: 80, profit: 84, commission: 76, storage: 64, order: 72, position: 72, comment: 120 }
const MOBILE_COLUMNS = [
  COLUMNS.find(c => c.key === 'login'),
  ...COLUMNS.filter(c => c.key !== 'login')
]
const mobileGridFor = (columns) => columns.map(c => `${MOBILE_WIDTHS[c.key] || 80}px`).join(' ')

// Column picker: these are on by default; Commission, Swap, Order, Position and Comment start off
const DEFAULT_VISIBLE_KEYS = ['deal', 'time', 'login', 'name', 'action', 'symbol', 'volume', 'price', 'profit']
const getDefaultVisibleColumns = () => Object.fromEntries(COLUMNS.map(c => [c.key, DEFAULT_VISIBLE_KEYS.includes(c.key)]))
const VISIBLE_COLUMNS_STORAGE_KEY = 'dealsReportVisibleColumns'

const formatPrice =(value) => formatNumber(value, value !== 0 && Math.abs(value) < 10 ? 5 : 2)

const DealsReportPage = () => {
  const { groups, getActiveGroupFilter, getGroupLogins, setActiveGroupFilter, deleteGroup } = useGroups()
  const activeGroupName = getActiveGroupFilter('deals-report')
  const activeGroup = groups.find(group => group.name === activeGroupName) || null
  const groupKey = JSON.stringify(activeGroup)
  const previousGroupKey = useRef(groupKey)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [mobileFilterView, setMobileFilterView] = useState(null)
  const [pendingGroupName, setPendingGroupName] = useState(null)
  const openMobileFilters = () => {
    setPendingGroupName(activeGroupName)
    setMobileFilterView('customize')
  }
  const applyMobileGroup = (name) => {
    setActiveGroupFilter('deals-report', name)
    setPage(1)
    setMobileFilterView(null)
  }
  const exportControllerRef = useRef(null)
  useEffect(() => () => exportControllerRef.current?.abort(), [])
  const cancelExport = () => {
    exportControllerRef.current?.abort()
    exportControllerRef.current = null
    setExportProgress(null)
  }
  const [moduleFilter, setModuleFilter] = useState('both')
  const [selectedClient, setSelectedClient] = useState(null)
  const { isAuthenticated } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.innerWidth < 1024) return false
      const value = localStorage.getItem('sidebarOpen')
      return value === null ? true : JSON.parse(value)
    } catch { return true }
  })
  const [preset, setPreset] = useState('today')
  const [range, setRange] = useState(() => getPresetRange('today'))
  const [customFrom, setCustomFrom] = useState(() => toYmd(serverNowDate()))
  const [customTo, setCustomTo] = useState(() => toYmd(serverNowDate()))
  const [activeDateField, setActiveDateField] = useState(null) // 'from' | 'to' | null — mobile date panel
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY) || 'null')
      if (saved && typeof saved === 'object') return { ...getDefaultVisibleColumns(), ...saved }
    } catch { /* Retain the fallback when this operation is unavailable. */ }
    return getDefaultVisibleColumns()
  })
  const [columnPickerOpen, setColumnPickerOpen] = useState(false)
  useEffect(() => {
    try { localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [visibleColumns])
  const toggleColumn = (key) => setVisibleColumns(value => {
    const next = { ...value, [key]: !value[key] }
    // keep at least one column visible
    return Object.values(next).some(Boolean) ? next : value
  })
  // Column order (drag to reorder in the picker) - persisted, same as Live Dealing
  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dealsReportColumnOrder') || 'null')
      return Array.isArray(saved) ? saved : null
    } catch { return null }
  })
  useEffect(() => {
    try {
      if (columnOrder) localStorage.setItem('dealsReportColumnOrder', JSON.stringify(columnOrder))
      else localStorage.removeItem('dealsReportColumnOrder')
    } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [columnOrder])
  const orderedColumns = (() => {
    if (!Array.isArray(columnOrder) || !columnOrder.length) return COLUMNS
    const map = new Map(COLUMNS.map(c => [c.key, c]))
    const out = []
    columnOrder.forEach(k => { if (map.has(k)) { out.push(map.get(k)); map.delete(k) } })
    map.forEach(c => out.push(c))
    return out
  })()

  // Pinned (frozen) columns - persisted
  const [pinnedColumns, setPinnedColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dealsReportPinnedColumns') || '[]')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('dealsReportPinnedColumns', JSON.stringify(pinnedColumns)) } catch { /* Retain the fallback when this operation is unavailable. */ }
  }, [pinnedColumns])
  const togglePinColumn = (key) => setPinnedColumns(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  const resetColumns = () => {
    setColumnOrder(null)
    setPinnedColumns([])
    setVisibleColumns(getDefaultVisibleColumns())
  }

  const shownColumns = orderedColumns.filter(c => visibleColumns[c.key])
  // Mobile: pinned columns (Login always) render first and stay fixed while sliding sideways
  const isMobilePinned = (column) => column.key === 'login' || pinnedColumns.includes(column.key)
  const shownMobileColumns = (() => {
    const visible = orderedColumns.filter(c => visibleColumns[c.key])
    const login = visible.filter(c => c.key === 'login')
    return [...login, ...visible.filter(c => c.key !== 'login' && isMobilePinned(c)), ...visible.filter(c => !isMobilePinned(c))]
  })()
  const mobilePinnedLeft = {}
  shownMobileColumns.reduce((offset, c) => {
    if (!isMobilePinned(c)) return offset
    mobilePinnedLeft[c.key] = offset
    return offset + (MOBILE_WIDTHS[c.key] || 80)
  }, 0)
  const mobilePinStyle = (column) => isMobilePinned(column) ? { left: mobilePinnedLeft[column.key], boxShadow: '2px 0 4px rgba(0,0,0,0.05)' } : undefined

  // Sticky offsets for pinned columns (pinned cells get a fixed width)
  const PINNED_WIDTH = 150
  const pinnedOffsets = {}
  shownColumns.reduce((offset, c) => {
    if (!pinnedColumns.includes(c.key)) return offset
    pinnedOffsets[c.key] = offset
    return offset + PINNED_WIDTH
  }, 0)
  const pinStyle = (key, isHeader, background) => {
    if (!pinnedColumns.includes(key)) return undefined
    return {
      position: 'sticky',
      left: pinnedOffsets[key] || 0,
      zIndex: isHeader ? 21 : 5,
      width: PINNED_WIDTH,
      minWidth: PINNED_WIDTH,
      maxWidth: PINNED_WIDTH,
      backgroundColor: isHeader ? '#2563eb' : background,
      boxShadow: '2px 0 4px -2px rgba(0,0,0,0.1)'
    }
  }
  const mobileGrid = mobileGridFor(shownMobileColumns)

  // Close the desktop column picker on outside click
  useEffect(() => {
    if (!columnPickerOpen) return undefined
    const handlePointerDown = (event) => {
      if (!event.target.closest?.('[data-deals-column-picker]')) setColumnPickerOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [columnPickerOpen])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  // Mobile view (below md) always shows MOBILE_PAGE_SIZE rows per page
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { setPage(1) }, [isMobile])
  const effectivePageSize = isMobile ? MOBILE_PAGE_SIZE : pageSize
  const [sortBy, setSortBy] = useState('time')
  const [sortOrder, setSortOrder] = useState('desc')
  const [deals, setDeals] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [exportProgress, setExportProgress] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const exporting = exportProgress !== null

  useEffect(() => {
    if (!datePickerOpen) return undefined
    const handlePointerDown = (event) => {
      if (!event.target.closest?.('[data-deals-datepicker]')) setDatePickerOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [datePickerOpen])

  // Search as you type on mobile and desktop.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim()
      if (next !== search) {
        setSearch(next)
        setPage(1)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput, search])

  const submitSearch = () => {
    const next = searchInput.trim()
    if (next === search) setReloadKey(value => value + 1)
    else setSearch(next)
    setPage(1)
  }

  // POST /api/broker/deals/search: `search` is an ILIKE match on symbol and comment only,
  // so a numeric query is sent as a login filter instead. The time column sorts as `deal_time`.
  const buildExtraBody = () => {
    const body = { sortBy: sortBy === 'time' ? 'deal_time' : sortBy, sortOrder }
    const filters = []
    let logins = activeGroup ? [...new Set(getGroupLogins(activeGroup.name).map(Number).filter(Number.isFinite))] : null
    if (/^\d+$/.test(search)) {
      const login = Number(search)
      logins = logins === null ? [login] : logins.filter(value => value === login)
    } else if (search) body.search = search
    if (logins !== null) filters.push(logins.length === 1
      ? { field: 'login', operator: 'equal', value: logins[0] }
      : { field: 'login', operator: 'in', value: logins })
    if (moduleFilter === 'deal') filters.push({ field: 'action', operator: 'in', value: ['BUY', 'SELL'] })
    if (moduleFilter === 'money') {
      filters.push({ field: 'action', operator: 'not_equal', value: 'BUY' })
      filters.push({ field: 'action', operator: 'not_equal', value: 'SELL' })
    }
    if (filters.length) body.filters = filters
    return body
  }

  useEffect(() => {
    if (!isAuthenticated) return undefined
    if (previousGroupKey.current !== groupKey) {
      previousGroupKey.current = groupKey
      if (page !== 1) {
        setPage(1)
        return undefined
      }
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await brokerAPI.getAllDeals(range.from, range.to, effectivePageSize, page, buildExtraBody())
        if (cancelled) return
        const payload = response?.data ?? response ?? {}
        const rows = payload?.deals || payload?.items || []
        const apiTotal = payload?.pagination?.total ?? payload?.total ?? payload?.totalCount ?? payload?.total_count
        setDeals(Array.isArray(rows) ? rows : [])
        setTotal(apiTotal != null ? Number(apiTotal) || 0 : rows.length)
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.response?.data?.message || requestError?.message || 'Failed to load deals')
          setDeals([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, search, moduleFilter, isAuthenticated, page, effectivePageSize, sortBy, sortOrder, reloadKey, groupKey])

  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize))

  const handleSort = (key) => {
    if (sortBy === key) setSortOrder(value => value === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortOrder('desc') }
    setPage(1)
  }

  const handlePreset = (value) => {
    const next = getPresetRange(value)
    if (!next) return
    setPreset(value)
    setRange(next)
    // Keep the custom date fields in sync with the chosen preset
    setCustomFrom(toYmd(fromServerEpoch(next.from)))
    setCustomTo(toYmd(fromServerEpoch(next.to)))
    setPage(1)
    setError('')
  }

  // Refresh: presets end at "now", so recompute the range to include new deals
  const refreshDeals = () => {
    const next = getPresetRange(preset)
    if (next) setRange(next)
    else setReloadKey(value => value + 1)
  }

  const applyCustomDates = () => {
    if (!customFrom || !customTo || customFrom > customTo) {
      setError('Choose a valid date range before applying dates.')
      return
    }
    setError('')
    setDatePickerOpen(false)
    setPreset('custom')
    setRange({ from: ymdToEpoch(customFrom), to: ymdToEpoch(customTo, true) })
    setPage(1)
  }

  // Export every deal in the current range/search, fetched in chunks of 500
  const handleExport = async () => {
    if (exportControllerRef.current) return
    const controller = new AbortController()
    exportControllerRef.current = controller
    setExportProgress({ done: 0, total })
    try {
      const extra = buildExtraBody()
      const getPayload = (res) => res?.data ?? res ?? {}
      const first = getPayload(await brokerAPI.getAllDeals(range.from, range.to, EXPORT_CHUNK, 1, extra, { signal: controller.signal }))
      if (controller.signal.aborted) return
      let rows = first?.deals || first?.items || []
      const exportTotal = Number(first?.pagination?.total ?? first?.total ?? first?.totalCount ?? first?.total_count ?? rows.length) || rows.length
      const pages = Math.ceil(exportTotal / EXPORT_CHUNK)
      setExportProgress({ done: rows.length, total: exportTotal })
      for (let p = 2; p <= pages; p++) {
        const payload = getPayload(await brokerAPI.getAllDeals(range.from, range.to, EXPORT_CHUNK, p, extra, { signal: controller.signal }))
        if (controller.signal.aborted) return
        const chunk = payload?.deals || payload?.items || []
        if (!chunk.length) break
        rows = rows.concat(chunk)
        setExportProgress({ done: rows.length, total: exportTotal })
      }
      if (controller.signal.aborted || !rows.length) return
      const stamp = toYmd(serverNowDate())
      // Excel columns follow the visible table columns; Time is split into Date + Time
      const SIGNED = new Set(['profit', 'commission', 'storage'])
      const priceDigits = Math.min(5, Math.max(2, ...rows.map(d => (String(d.price ?? '').split('.')[1] || '').length)))
      const excelColumns = shownColumns.flatMap(c => {
        if (c.key === 'time') {
          const parts = (d) => String(c.get(d) || '').split(' ')
          return [
            { key: 'date', label: 'Date', value: d => parts(d)[0] || '', align: 'center' },
            { key: 'time', label: 'Time', value: d => parts(d)[1] || '', align: 'center' }
          ]
        }
        if (c.key === 'action') return [{ key: c.key, label: c.label, value: c.get, align: 'center', colorFor: actionColor }]
        if (c.numeric) return [{ key: c.key, label: c.label, value: c.key, type: 'number', digits: c.key === 'price' ? priceDigits : 2, signed: SIGNED.has(c.key) }]
        return [{ key: c.key, label: c.label, value: c.get }]
      })
      const sum = (key) => rows.reduce((total, d) => total + (Number(d[key]) || 0), 0)
      exportStyledExcel({
        showTitle: false,
        columns: excelColumns,
        sections: [{
          rows,
          totals: { label: 'TOTAL', values: { volume: sum('volume'), profit: sum('profit'), commission: sum('commission'), storage: sum('storage') } }
        }],
        sheetName: 'Deals',
        fileName: `deals_${preset}_${stamp}.csv`
      })
    } catch (exportError) {
      if (controller.signal.aborted) return
      setError(exportError?.response?.data?.message || exportError?.message || 'Failed to export deals')
    } finally {
      if (exportControllerRef.current === controller) {
        exportControllerRef.current = null
        setExportProgress(null)
      }
    }
  }

  const renderCell = (column, deal) => {
    const value = column.get(deal)
    if (column.key === 'login' && deal.login != null && String(deal.login).trim() !== '' && deal.login !== '-') {
      return (
        <button
          type="button"
          onClick={() => setSelectedClient({ login: deal.login, name: deal.name || '' })}
          className="text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 rounded-sm"
          aria-label={`Open client details for ${deal.login}`}
        >
          {value}
        </button>
      )
    }
    if (column.key === 'action') {
      return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${getDealActionClass(value)}`}>{value}</span>
    }
    if (column.key === 'profit') {
      return <span className={value >= 0 ? 'text-green-600' : 'text-red-600'}>{formatNumber(value)}</span>
    }
    if (column.key === 'price') return formatPrice(value)
    if (column.numeric) return formatNumber(value)
    return value
  }

  const iconButton = 'h-8 w-8 shrink-0 rounded-md border border-[#E5E7EB] bg-white text-[#374151] shadow-sm flex items-center justify-center transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50'

  // Clear custom dates and go back to the default quick filter (Today)
  const clearCustomDates = () => {
    const today = toYmd(serverNowDate())
    setCustomFrom(today)
    setCustomTo(today)
    setDatePickerOpen(false)
    handlePreset('today')
  }

  const mobileDatePicker = (
    <div data-deals-datepicker="" role="dialog" aria-label="Custom date range" onKeyDown={event => { if (event.key === 'Escape') setDatePickerOpen(false) }} className="fixed left-1/2 top-28 z-[100] w-[calc(100vw-2rem)] max-w-[300px] -translate-x-1/2 max-h-[calc(100dvh-124px)] overflow-y-auto rounded-xl border border-[#D5DEEA] bg-white p-4 text-left shadow-[0_12px_32px_rgba(15,23,42,0.18)]">
      <p className="text-[14px] font-extrabold tracking-tight text-[#0F172A]">Custom date range</p>
      <p className="mt-0.5 text-[10.5px] leading-4 text-[#64748B]">Filter deals for the selected period.</p>
      {/* From / To open the themed calendar inline (native date pickers can't be styled) */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[['from', 'From', customFrom], ['to', 'To', customTo]].map(([key, label, date]) => (
          <button key={key} type="button" onClick={() => setActiveDateField(field => field === key ? null : key)}
            className={`rounded-lg border px-2.5 py-1.5 text-left ${activeDateField === key ? 'border-[#2563EB] bg-[#2563EB]/[0.06]' : 'border-[#D5DEEA] bg-white/60'}`}>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">{label}</span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <svg className={`h-3.5 w-3.5 shrink-0 ${activeDateField === key || date ? 'text-[#2563EB]' : 'text-[#94A3B8]'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
              <span className={`min-w-0 truncate text-[13px] font-semibold ${date ? 'text-[#0F172A]' : 'text-[#9CA3AF]'}`}>{date ? formatIsoDate(date) : 'Select date'}</span>
            </span>
          </button>
        ))}
      </div>
      {activeDateField && (
        <div className="mt-2 rounded-lg border border-[#D5DEEA] bg-white/70 p-2">
          <MobileCalendar
            key={activeDateField}
            value={activeDateField === 'from' ? customFrom : customTo}
            min={activeDateField === 'to' ? customFrom || undefined : undefined}
            max={activeDateField === 'from' ? (customTo || toYmd(serverNowDate())) : toYmd(serverNowDate())}
            rangeStart={customFrom}
            rangeEnd={customTo}
            onChange={iso => {
              if (activeDateField === 'from') {
                setCustomFrom(iso)
                if (customTo && customTo < iso) setCustomTo('')
                setActiveDateField('to')
              } else {
                setCustomTo(iso)
                setActiveDateField(null)
              }
            }}
          />
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => { setCustomFrom(''); setCustomTo('') }} disabled={!customFrom && !customTo} className="h-9 flex-1 rounded-lg border border-[#D5DEEA] bg-transparent text-[13px] font-semibold text-[#334155] disabled:cursor-not-allowed disabled:opacity-50">Clear</button>
        <button type="button" onClick={applyCustomDates} disabled={!customFrom || !customTo || customFrom > customTo || customTo > toYmd(serverNowDate())} className="h-9 flex-1 rounded-lg bg-[#2563EB] text-[13px] font-semibold text-white shadow-[0_4px_10px_rgba(37,99,235,0.3)] disabled:opacity-50">Apply dates</button>
      </div>
    </div>
  )

  const datePickerPopover = datePickerOpen && (isMobile ? mobileDatePicker : (
    <div data-deals-datepicker="" className={`${isMobile ? 'fixed inset-x-3 top-28 z-[100] max-h-[calc(100dvh-124px)] overflow-y-auto' : 'absolute right-0 top-10 z-50 w-[360px]'} overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-[0_12px_40px_rgba(15,23,42,0.16)]`} role="dialog" aria-label="Date range" onKeyDown={event => { if (event.key === 'Escape') setDatePickerOpen(false) }}>
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="2" /><path strokeLinecap="round" d="M16 3v4M8 3v4M3 11h18" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">Date range</h3>
          <p className="mt-0.5 text-xs text-slate-500">Choose the period for your deals</p>
        </div>
        <button type="button" onClick={() => setDatePickerOpen(false)} aria-label="Close date picker" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-blue-600">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-4 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-600">From date</p>
          <DateInputDMY className="mt-2 [&>input[type=text]]:h-11 [&>input[type=text]]:font-medium [&>button]:h-10 [&>button]:w-8 [&>button]:right-0.5" value={customFrom} max={customTo || undefined} onChange={setCustomFrom} ariaLabel="From date" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-600">To date</p>
          <DateInputDMY className="mt-2 [&>input[type=text]]:h-11 [&>input[type=text]]:font-medium [&>button]:h-10 [&>button]:w-8 [&>button]:right-0.5" value={customTo} min={customFrom || undefined} max={toYmd(serverNowDate())} onChange={setCustomTo} ariaLabel="To date" />
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
        <button type="button" onClick={clearCustomDates} className="h-11 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-blue-600">Reset to today</button>
        <button type="button" onClick={applyCustomDates} className="h-11 flex-1 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-blue-600">Apply dates</button>
      </div>
    </div>
  ))

  const moduleFilterButtons = (
    <div className="flex shrink-0 items-center h-8 bg-[#F3F4F6] rounded-md p-0.5 shadow-inner" role="group" aria-label="Transaction type">
      {['deal', 'money', 'both'].map(value => (
        <button key={value} type="button" aria-pressed={moduleFilter === value} onClick={() => { setModuleFilter(value); setPage(1) }} className={`h-full px-2 md:px-3 text-xs font-semibold rounded transition-colors ${moduleFilter === value ? 'bg-[#3B5BDB] text-white shadow-sm' : 'text-[#374151] hover:bg-white/70'}`}>
          {value === 'deal' ? 'Deal' : value === 'money' ? 'Money' : 'Both'}
        </button>
      ))}
    </div>
  )

  const groupSelector = <GroupSelector
    moduleName="deals-report"
    onCreateClick={() => { setEditingGroup(null); setShowGroupModal(true) }}
    onEditClick={(group) => { setEditingGroup(group); setShowGroupModal(true) }}
  />

  const actionButtons = (
    <>
      <QuickTimeFilter value={preset} onChange={value => { handlePreset(value); setDatePickerOpen(false) }} />
      <div className="relative" data-deals-datepicker="">
        <button type="button" onClick={() => { if (isMobile && !datePickerOpen && preset !== 'custom') { setCustomFrom(''); setCustomTo('') } setActiveDateField(null); setDatePickerOpen(value => !value) }} className={iconButton} aria-expanded={datePickerOpen} aria-haspopup="dialog" aria-label="Choose custom dates">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
        </button>
        {!isMobile && datePickerPopover}
      </div>
      <button type="button" onClick={handleExport} disabled={exporting || loading || !total} className={iconButton} aria-label="Export deals" title={exporting ? `Exporting ${exportProgress.done} / ${exportProgress.total}...` : 'Export all deals in this range to CSV'}>
        <svg className={`h-4 w-4 ${exporting ? 'animate-pulse text-blue-600' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
      </button>
      {isMobile && moduleFilterButtons}
      <button type="button" onClick={refreshDeals} disabled={loading} className={iconButton} aria-label="Refresh deals" title="Refresh deals">
        <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      </button>
    </>
  )

  // Full-screen export dialog (same as Bills export), shown in both mobile and desktop views
  const exportingNote = exporting && (
    <LoadingSpinner
      onCancel={cancelExport}
      message="Exporting all deals…"
      subtitle={exportProgress.total ? `${exportProgress.done.toLocaleString('en-IN')} / ${exportProgress.total.toLocaleString('en-IN')} deals · Please wait` : 'Please wait'}
      progress={exportProgress.total ? Math.round((exportProgress.done / exportProgress.total) * 100) : null}
    />
  )

  const emptyOrError = error
    ? <div className="flex min-h-[200px] items-center justify-center px-5 text-center text-sm text-red-600">{error}</div>
    : (
      <div className="flex min-h-[200px] flex-col items-center justify-center px-5 text-center">
        <p className="text-sm font-semibold text-slate-700">No deals found</p>
        <p className="mt-1 text-xs text-slate-500">{search ? 'Try a different search.' : 'Try a wider date range from Time Period.'}</p>
      </div>
    )

  const prevDisabled = page <= 1
  const nextDisabled = page >= totalPages
  const onPageInput = (event) => {
    const next = Number(event.target.value)
    if (Number.isInteger(next) && next >= 1 && next <= totalPages) setPage(next)
  }

  return (
    <div className="mobile-responsive-page h-screen flex bg-[#F8F8F8] md:bg-gradient-to-br md:from-blue-50 md:via-white md:to-blue-50 overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => { setSidebarOpen(false); try { localStorage.setItem('sidebarOpen', JSON.stringify(false)) } catch { /* Retain the fallback when this operation is unavailable. */ } }}
        onToggle={() => setSidebarOpen(value => { const next = !value; try { localStorage.setItem('sidebarOpen', JSON.stringify(next)) } catch { /* Retain the fallback when this operation is unavailable. */ }; return next })}
      />

      <main className={`report-mobile-theme report-white flex-1 min-w-0 p-0 md:p-4 lg:p-6 transition-all duration-300 ${sidebarOpen ? 'lg:ml-60' : 'lg:ml-16'} flex flex-col overflow-hidden`}>
        {/* ───────── Mobile (matches the other mobile modules) ───────── */}
        <div className="md:hidden flex flex-1 flex-col overflow-hidden">
          <div className="flex-wrap relative flex items-center gap-3 px-4 pt-4 pb-2 bg-transparent">
            <button type="button" onClick={() => setSidebarOpen(true)} className="w-12 h-12 flex-shrink-0 rounded-2xl bg-transparent border border-[#D5DEEA] flex items-center justify-center" aria-label="Open menu">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="#000000" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-[#0F172A]">Deals</h1>
                <p className="truncate text-[12px] text-[#64748B]">All deals across all accounts</p>
              </div>
              <BrokerCreditSummary variant="header" />
            </div>
          


<BrokerCreditSummary variant="desktop-header" />
</div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {/* Toolbar */}
            <div className="pt-1 pb-2 px-4">
              {/* One row, nothing hidden or sliding: Filter · period · Deal/Money/Both · dates · export · refresh.
                  actionButtons is shared with desktop, so sizes and order are set from this wrapper. */}
              <div className="flex w-full flex-nowrap items-center gap-1 py-1 [&>select]:hidden [&>button:not([aria-haspopup])]:order-5 [&>button:not([aria-haspopup])]:h-9 [&>button:not([aria-haspopup])]:w-8 [&>button:not([aria-haspopup])]:shrink-0 [&>button:not([aria-haspopup])]:rounded-xl [&>div[data-deals-datepicker]]:order-4 [&>div[data-deals-datepicker]]:shrink-0 [&>div[data-deals-datepicker]>button]:h-9 [&>div[data-deals-datepicker]>button]:w-8 [&>div[data-deals-datepicker]>button]:rounded-xl [&>div[role=group]]:order-2 [&>div[role=group]]:min-w-0 [&>div[role=group]]:flex-1 [&>div[role=group]]:h-9 [&>div[role=group]]:rounded-xl [&>div[role=group]]:border [&>div[role=group]]:border-[#D5DEEA] [&>div[role=group]]:!bg-transparent [&>div[role=group]]:!shadow-none [&>div[role=group]]:p-[3px] [&>div[role=group]>button]:flex-1 [&>div[role=group]>button]:rounded-lg [&>div[role=group]>button]:!px-0 [&>div[role=group]>button]:text-[10px] [&>div[role=group]>button[aria-pressed=true]]:!bg-[#2563EB]">
                <MobileSelect ariaLabel="Time period" title="Time period" className="order-1 !h-9 w-[66px] shrink-0 !gap-0.5 !px-2 !text-[11px] !font-semibold" value={preset}
                  buttonLabel={QUICK_FILTERS.find(option => option.value === preset)?.label || (preset === 'custom' ? 'Custom' : 'Period')}
                  onChange={value => { handlePreset(value); setDatePickerOpen(false) }}
                  options={QUICK_FILTERS} />
                <div className="order-first shrink-0">
                  <button type="button" onClick={openMobileFilters} aria-haspopup="dialog" aria-expanded={mobileFilterView !== null} title={activeGroupName ? `Group filter: ${activeGroupName}` : 'Customize view'} aria-label="Filter" className={`relative flex h-9 items-center justify-center gap-1 rounded-xl border px-2 text-[10px] font-semibold shadow-sm ${activeGroupName ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-[#E5E7EB] bg-white text-[#374151]'}`}>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h14M4 6h10M6 9h6" /></svg>
                    Filter
                    {activeGroupName && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#2563EB] ring-2 ring-white" />}
                  </button>
                </div>
                {actionButtons}
              </div>
              {exportingNote}
            </div>

            {/* Search + pagination */}
            <div className="mx-4 mb-3">
              <div className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0 h-10 bg-transparent border border-[#D5DEEA] rounded-xl px-3 flex items-center gap-2">
                  <svg width="15" height="15" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 text-[#9CA3AF]"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="M13 13L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <input
                  type="search" name="no-autofill-search" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-form-type="other" readOnly onPointerDown={e => e.currentTarget.removeAttribute('readonly')} onFocus={e => e.currentTarget.removeAttribute('readonly')} placeholder="Search by login, deal, symbol..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="report-plain-input flex-1 min-w-0 text-[13px] text-[#1F2937] placeholder-[#9CA3AF] outline-none bg-transparent font-outfit" aria-label="Search deals" />
                </div>
                <button type="button" onClick={() => { setColumnPickerOpen(true) }} className="h-10 w-10 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center flex-shrink-0" title="Show/Hide Columns" aria-label="Show or hide columns">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="4" height="10" rx="1" stroke="#4B5563" strokeWidth="1.2" /><rect x="8" y="3" width="6" height="10" rx="1" stroke="#4B5563" strokeWidth="1.2" /></svg>
                </button>
                <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={prevDisabled} className={`h-10 w-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center flex-shrink-0 ${prevDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'}`} aria-label="Previous page">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M12 14L8 10L12 6" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <div className="flex items-center gap-1 text-[13px] font-medium text-[#475569]">
                  <input type="number" min="1" max={totalPages} value={page} onChange={onPageInput} className="report-page-box w-10 h-10 rounded-xl text-center text-[13px] font-semibold focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" aria-label="Current page" />
                  <span className="text-[#9CA3AF]">/</span>
                  <span>{totalPages}</span>
                </div>
                <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={nextDisabled} className={`h-10 w-9 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center flex-shrink-0 ${nextDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'}`} aria-label="Next page">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M8 6L12 10L8 14" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="bg-transparent border-y border-blue-100 max-md:border-b-0 overflow-hidden">
              <div className="mobile-table-scroll w-full overflow-x-auto overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', maxHeight: 'max(152px, calc(var(--app-viewport-height, 100dvh) - 230px))' }}>
                <div className="relative" style={{ minWidth: 'max-content' }}>
                  <div data-mobile-data-row="header" className="grid bg-blue-500 text-white text-[10px] font-semibold font-outfit sticky -top-px z-20 shadow-[0_2px_6px_rgba(37,99,235,0.25)] [transform:translateZ(0)] [backface-visibility:hidden]" style={{ gridTemplateColumns: mobileGrid }}>
                    {shownMobileColumns.map(column => (
                      <div key={column.key} onClick={() => handleSort(column.key)} className={`h-[32px] flex items-center px-1 cursor-pointer select-none ${isMobilePinned(column) ? 'sticky z-30 bg-blue-500 px-2' : ''}`} style={mobilePinStyle(column)}>
                        <span className="truncate">{column.label}</span>
                        {sortBy === column.key && <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    ))}
                  </div>

                  {loading ? (
                    Array.from({ length: MOBILE_PAGE_SIZE }, (_, row) => (
                      <div data-mobile-data-row="body" key={`sk-${row}`} className="grid bg-transparent border-b border-[#E1E1E1]" style={{ gridTemplateColumns: mobileGrid }}>
                        {shownMobileColumns.map(column => (
                          <div key={column.key} className={`h-[38px] flex items-center px-1 ${isMobilePinned(column) ? 'sticky bg-white z-10' : ''}`} style={mobilePinStyle(column)}>
                            <div className="h-3 w-full max-w-[80%] rounded bg-gray-200 animate-pulse" />
                          </div>
                        ))}
                      </div>
                    ))
                  ) : deals.length ? (
                    deals.map((deal, index) => (
                      <div data-mobile-data-row="body" key={`${deal.deal ?? deal.id ?? 'd'}-m-${index}`} className={`grid text-[10px] text-[#4B4B4B] font-outfit bg-transparent border-b border-[#E1E1E1]`} style={{ gridTemplateColumns: mobileGrid }}>
                        {shownMobileColumns.map(column => (
                          <div
                            key={column.key}
                            className={`h-[38px] flex items-center px-1 min-w-0 ${isMobilePinned(column) ? 'sticky bg-white z-10 px-2' : ''} ${column.key === 'login' ? 'text-[#1A63BC] font-semibold' : ''}`}
                            style={mobilePinStyle(column)}
                          >
                            <span className="truncate">{renderCell(column, deal)}</span>
                          </div>
                        ))}
                      </div>
                    ))
                  ) : null}
                  <div aria-hidden="true" className="mobile-table-end" />
                </div>
                {!loading && !deals.length && emptyOrError}
              </div>
            </div>
          </div>
        </div>

        {/* ───────── Tablet / desktop (matches Live Dealing) ───────── */}
        <div className="hidden md:flex max-w-full mx-auto w-full flex-col flex-1 overflow-hidden">
          <div className="bg-white rounded-2xl shadow-sm px-6 py-3 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" onClick={() => setSidebarOpen(true)} className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F8F8F8] text-slate-900" aria-label="Open menu">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25}><path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3"><h1 className="truncate text-xl font-bold text-[#1A1A1A] min-w-0 max-sm:text-sm">Deals</h1><BrokerCreditSummary variant="header" /></div>
                  <p className="text-xs text-[#6B7280] mt-0.5">All deals across all accounts</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {groupSelector}
                {moduleFilterButtons}
                {actionButtons}
              </div>
            </div>
            {exportingNote}
          


<BrokerCreditSummary variant="desktop-header" />
</div>

          <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="border-b border-[#E5E7EB] p-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-md">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') submitSearch() }}
                    placeholder="Search login, symbol, comment"
                    className="w-full h-10 pl-4 pr-20 text-sm border border-[#E5E7EB] rounded-lg bg-[#F9FAFB] text-[#1F2937] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                    aria-label="Search deals"
                  />
                  {searchInput && (
                    <button type="button" onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }} className="absolute right-12 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#4B5563]" title="Clear search">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                  <button type="button" onClick={submitSearch} className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-9 rounded-md bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors shadow-sm" title="Search" aria-label="Search">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 18 18"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="M13 13L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                </div>
                <div className="relative mr-auto" data-deals-column-picker="">
                  <button type="button" onClick={() => { setColumnPickerOpen(value => !value) }} className="h-10 w-10 rounded-lg bg-white border border-[#E5E7EB] shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors" title="Show/Hide Columns" aria-label="Show or hide columns" aria-expanded={columnPickerOpen}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <line x1="2" y1="4" x2="14" y2="4" stroke="#4B5563" strokeWidth="1.5" strokeLinecap="round" /><circle cx="6" cy="4" r="1.5" fill="white" stroke="#4B5563" strokeWidth="1.5" />
                      <line x1="2" y1="8" x2="14" y2="8" stroke="#4B5563" strokeWidth="1.5" strokeLinecap="round" /><circle cx="11" cy="8" r="1.5" fill="white" stroke="#4B5563" strokeWidth="1.5" />
                      <line x1="2" y1="12" x2="14" y2="12" stroke="#4B5563" strokeWidth="1.5" strokeLinecap="round" /><circle cx="7" cy="12" r="1.5" fill="white" stroke="#4B5563" strokeWidth="1.5" />
                    </svg>
                  </button>
                  {columnPickerOpen && (
                    <div className="hidden md:flex absolute left-0 top-full mt-2 bg-white rounded-lg shadow-lg border border-[#E5E7EB] py-0 z-50 flex-col" style={{ width: 280, maxHeight: '60vh' }}>
                      <div className="px-3 py-2 border-b border-[#F3F4F6] flex items-center justify-between">
                        <p className="text-xs font-semibold text-[#1F2937] uppercase">Show/Hide & Reorder</p>
                        <div className="relative group">
                          <button type="button" onClick={resetColumns} className="p-1 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors" aria-label="Reset columns">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 20v-6h-6" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 10a8 8 0 0114-3m2 7a8 8 0 01-14 3" />
                            </svg>
                          </button>
                          <span className="absolute right-0 top-full mt-1 hidden group-hover:block bg-gray-900 text-white text-[10px] font-medium px-2 py-1 rounded whitespace-nowrap z-50 pointer-events-none shadow">Reset Columns</span>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 flex flex-col">
                        <ColumnChooserList
                          columns={COLUMNS}
                          visibleColumns={visibleColumns}
                          onToggle={toggleColumn}
                          columnOrder={columnOrder}
                          onReorder={(newOrder) => setColumnOrder(newOrder)}
                          accent="blue"
                          title={null}
                          pinnedColumns={pinnedColumns}
                          onPinToggle={togglePinColumn}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <PageSizeSelect value={pageSize} onChange={(value) => { setPageSize(Number(value)); setPage(1) }} options={PAGE_SIZE_OPTIONS} />
                  <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={prevDisabled} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${prevDisabled ? 'text-[#D1D5DB] bg-[#F9FAFB] cursor-not-allowed' : 'text-[#374151] bg-white border border-[#E5E7EB] hover:bg-gray-50'}`} aria-label="Previous page">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <div className="flex items-center gap-1 text-sm font-medium text-[#374151]">
                    <input type="number" min="1" max={totalPages} value={page} onChange={onPageInput} className="w-12 h-7 border border-[#E5E7EB] rounded-lg text-center text-sm font-semibold text-[#1F2937]" aria-label="Current page" />
                    <span className="text-[#9CA3AF]">/</span>
                    <span className="text-[#6B7280]">{totalPages}</span>
                  </div>
                  <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={nextDisabled} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${nextDisabled ? 'text-[#D1D5DB] bg-[#F9FAFB] cursor-not-allowed' : 'text-[#374151] bg-white border border-[#E5E7EB] hover:bg-gray-50'}`} aria-label="Next page">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-auto flex-1 min-h-0" style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #e5e7eb' }}>
              {(
                  <table className="min-w-full text-xs border-separate border-spacing-0">
                    <thead className="bg-blue-600 sticky top-0 shadow-md" style={{ zIndex: 10 }}>
                      <tr>
                        {shownColumns.map(column => (
                          <th key={column.key} style={pinStyle(column.key, true)} className="px-3 py-2.5 text-left text-[11px] font-bold text-white uppercase tracking-wider whitespace-nowrap bg-blue-600 hover:bg-blue-700 transition-colors select-none border-r border-blue-400 last:border-r-0">
                            <button type="button" onClick={() => handleSort(column.key)} className="inline-flex items-center gap-1 uppercase">
                              {column.label}
                              {sortBy === column.key && <span className="text-[9px]" aria-hidden="true">{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody aria-busy={loading}>
                      {loading ? Array.from({ length: Math.min(effectivePageSize, 20) }, (_, row) => (
                        <tr key={`sk-${row}`} className={row % 2 ? 'bg-[#F9FAFB]' : 'bg-white'}>
                          {shownColumns.map(column => (
                            <td key={column.key} style={pinStyle(column.key, false, row % 2 ? '#F9FAFB' : '#ffffff')} className="px-3 py-3 border-b border-r border-[#E5E7EB] last:border-r-0">
                              <div className="h-3.5 min-w-[48px] rounded bg-gray-200 animate-pulse" style={{ width: column.key === 'comment' || column.key === 'time' ? 110 : 64 }} />
                            </td>
                          ))}
                        </tr>
                      )) : !deals.length ? <tr><td colSpan={shownColumns.length}>{emptyOrError}</td></tr> : deals.map((deal, index) => (
                        <tr key={`${deal.deal ?? deal.id ?? 'd'}-${index}`} className={`${index % 2 ? 'bg-[#F9FAFB]' : 'bg-white'} hover:bg-blue-50`}>
                          {shownColumns.map(column => (
                            <td
                              key={column.key}
                              style={pinStyle(column.key, false, index % 2 ? '#F9FAFB' : '#ffffff')}
                              className={`px-3 py-2.5 whitespace-nowrap text-sm border-b border-r border-[#E5E7EB] last:border-r-0 ${column.key === 'login' ? 'text-blue-600' : column.key === 'deal' || column.key === 'symbol' || column.key === 'name' ? 'text-gray-900' : 'text-gray-700'} ${column.key === 'comment' ? 'max-w-[220px] truncate' : ''}`}
                              title={column.key === 'comment' ? column.get(deal) : undefined}
                            >
                              {renderCell(column, deal)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        </div>
        {/* Bottom Navigation (mobile only) */}
        <div className="flex-shrink-0 md:hidden">
          <MobileBottomNav onMore={() => setSidebarOpen(true)} />
        </div>
      </main>

      {selectedClient && (isMobile ? (
        <ClientDetailsMobileModal
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          allPositionsCache={EMPTY_CLIENT_CACHE}
          allOrdersCache={EMPTY_CLIENT_CACHE}
        />
      ) : (
        <ClientPositionsModal
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onClientUpdate={ignoreClientUpdate}
          allPositionsCache={EMPTY_CLIENT_CACHE}
          allOrdersCache={EMPTY_CLIENT_CACHE}
          onCacheUpdate={ignoreClientUpdate}
        />
      ))}

      {isMobile && datePickerOpen && createPortal(datePickerPopover, document.body)}
      {isMobile && (
        <>
          <CustomizeViewModal
            isOpen={mobileFilterView === 'customize'}
            onClose={() => setMobileFilterView(null)}
            onGroupsClick={() => setMobileFilterView('groups')}
            onReset={() => applyMobileGroup(null)}
            onApply={() => applyMobileGroup(pendingGroupName)}
            hasPendingChanges={pendingGroupName !== activeGroupName}
          />
          <LoginGroupsModal
            isOpen={mobileFilterView === 'groups'}
            onClose={() => setMobileFilterView(view => view === 'groups' ? null : view)}
            onBack={() => setMobileFilterView('customize')}
            groups={groups.map(group => ({ ...group, loginCount: group.range ? Number(group.range.to) - Number(group.range.from) + 1 : (group.loginIds?.length || 0) }))}
            activeGroupName={activeGroupName}
            onSelectGroup={group => applyMobileGroup(group?.name || null)}
            onPendingChange={(_hasPending, name) => setPendingGroupName(name || null)}
            onCreateGroup={() => { setEditingGroup(null); setMobileFilterView('edit') }}
            onEditGroup={group => { setEditingGroup(group); setMobileFilterView('edit') }}
            onDeleteGroup={group => deleteGroup(group.name)}
          />
          <LoginGroupModal
            isOpen={mobileFilterView === 'edit'}
            editGroup={editingGroup}
            onClose={() => { setEditingGroup(null); setMobileFilterView('groups') }}
            onBack={() => { setEditingGroup(null); setMobileFilterView('groups') }}
            onSave={() => { setEditingGroup(null); setMobileFilterView('groups') }}
          />
        </>
      )}

      {/* Mobile column picker (bottom sheet, same as Live Dealing mobile) */}
      {columnPickerOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setColumnPickerOpen(false)}>
          {/* Scoped restyle of the shared ColumnChooserList to match the mobile theme */}
          <style>{`
            .c2-col-chooser > div > div { border-color: #D5DEEA !important; }
            .c2-col-chooser input[type="text"] { background: transparent !important; border-color: #D5DEEA !important; border-radius: 12px !important; height: 40px; font-size: 13px !important; }
            .c2-col-chooser input[type="checkbox"] { width: 16px !important; height: 16px !important; accent-color: #2563EB; border-radius: 4px; }
            .c2-col-chooser .overscroll-contain > [data-col-key] { padding-top: 10px; padding-bottom: 10px; margin-left: 12px; margin-right: 12px; border-radius: 0; border-bottom: 1px solid rgba(213, 222, 234, 0.6); }
            .c2-col-chooser .overscroll-contain > [data-col-key] label span { font-size: 13px !important; color: #1F2937 !important; }
          `}</style>
          <div data-deals-column-picker="" className="bg-white w-full rounded-t-[28px] flex flex-col overflow-hidden shadow-[0_-8px_30px_rgba(15,23,42,0.12)]" style={{ maxHeight: '85dvh' }} onClick={(event) => event.stopPropagation()}>
            <div className="pt-2.5 flex justify-center flex-shrink-0"><span className="w-10 h-1 rounded-full bg-[#CBD5E1]" /></div>
            <div className="px-5 pt-3 pb-3 border-b border-[#D5DEEA] flex items-center justify-between gap-3 flex-shrink-0">
              <div className="min-w-0">
                <h3 className="text-[18px] leading-6 font-extrabold tracking-tight text-[#0F172A] truncate">Columns</h3>
                <p className="text-[12px] text-[#64748B] truncate">Show, hide, pin & reorder columns</p>
              </div>
              <button type="button" onClick={() => setColumnPickerOpen(false)} aria-label="Close" className="w-10 h-10 flex-shrink-0 rounded-xl bg-transparent border border-[#D5DEEA] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="c2-col-chooser flex-1 min-h-0 flex flex-col">
              <ColumnChooserList
                columns={COLUMNS}
                visibleColumns={visibleColumns}
                onToggle={toggleColumn}
                columnOrder={columnOrder}
                onReorder={(newOrder) => setColumnOrder(newOrder)}
                onResetOrder={() => setColumnOrder(null)}
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
      <GroupModal
        isOpen={showGroupModal}
        onClose={() => { setShowGroupModal(false); setEditingGroup(null) }}
        availableItems={deals}
        loginField="login"
        displayField="name"
        editGroup={editingGroup}
      />
    </div>
  )
}

export default DealsReportPage
