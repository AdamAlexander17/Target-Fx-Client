import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import BrokerCreditSummary from '../components/BrokerCreditSummary'
import MobileSelect from '../components/MobileSelect'
import MobileBottomNav from '../components/MobileBottomNav'
import GroupSelector from '../components/GroupSelector'
import GroupModal from '../components/GroupModal'
import LoginGroupsModal from '../components/LoginGroupsModal'
import LoginGroupModal from '../components/LoginGroupModal'
import ColumnChooserList from '../components/ColumnChooserList'
import { useGroups } from '../contexts/groupContextStore'
import { brokerAPI, brokerageCalcAPI } from '../services/api'
import {
  calculatorNumber, calculatorData, calculatorReport, changedCalculatorRates,
  calculatorUsdRate, calculatorExportView, changedGroupRates, calculatorRateRows, calculatorClientRateScope,
} from '../utils/brokerageCalculator'

const format = (value, decimals = 2) => {
  const number = calculatorNumber(value)
  return number == null ? '—' : number.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
const formatCompactIndian = value => {
  const number = calculatorNumber(value)
  if (number == null) return '—'
  const absolute = Math.abs(number)
  const sign = number < 0 ? '-' : ''
  if (absolute >= 1e7) return `${sign}${(absolute / 1e7).toFixed(2)}Cr`
  if (absolute >= 1e5) return `${sign}${(absolute / 1e5).toFixed(2)}L`
  if (absolute >= 1e3) return `${sign}${(absolute / 1e3).toFixed(2)}K`
  return `${sign}${absolute.toFixed(2)}`
}
// Compact week label for the mobile toolbar: "WEEK 24 OCTOBER" -> "24 Oct"
const shortWeekName = week => {
  const name = week.name || `Week ${week.id}`
  return name.replace(/^week\s*/i, '').toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()).replace(/\b([A-Z][a-z]{2})[a-z]+\b/, '$1')
}
const errorMessage = error => error?.response?.data?.message || error.message || 'Request failed. Please retry.'
const buttonBaseCls = 'rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50'
const buttonCls = `${buttonBaseCls} border-[#E5E7EB] bg-white text-[#374151] hover:bg-blue-50`
const primaryCls = `${buttonBaseCls} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`
const toolSelectCls = 'h-9 shrink-0 truncate rounded-lg border border-[#E5E7EB] bg-white px-2 font-outfit text-xs font-medium text-[#374151] outline-none hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
const toolIconCls = 'flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 font-outfit text-xs font-medium border-[#E5E7EB] bg-white text-[#374151] outline-none hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
const toolTextCls = 'flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 font-outfit text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
const mobileIconCls = 'flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 text-[12px] font-semibold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
const mobileIconButtonCls = `${mobileIconCls} border-[#D5DEEA] bg-transparent text-[#1F2937] hover:bg-white/60`
const mobileIconPrimaryCls = `${mobileIconCls} border-[#2563EB] bg-[#2563EB] text-white shadow-[0_4px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700`
const stickyRateTdCls = 'sticky left-0 z-[5] bg-white shadow-[2px_0_0_#ECECEC]'
const rateInputCls = 'rounded-lg border border-[#E5E7EB] bg-white px-2 font-outfit text-xs font-medium text-[#1F2937] placeholder:text-[#9CA3AF] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 h-9 min-w-0 sm:h-10 sm:px-2.5 sm:text-sm max-sm:h-10 max-sm:rounded-xl max-sm:border-[#D5DEEA] max-sm:bg-transparent max-sm:px-3 max-sm:text-[13px]'
const rateButtonCls = `${buttonCls} inline-flex h-9 items-center justify-center whitespace-nowrap !px-2 text-[11px] sm:h-10 sm:!px-3 sm:text-xs`
const ratePrimaryCls = `${primaryCls} inline-flex h-9 items-center justify-center whitespace-nowrap !px-2 text-[11px] sm:h-10 sm:!px-3 sm:text-xs`
const cellCls = 'whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums sm:px-3 sm:py-2.5 sm:text-sm max-sm:h-11 max-sm:py-0'
const tdCls = 'px-2 py-1.5 align-middle text-xs sm:px-3 sm:py-2 sm:text-sm max-sm:h-11 max-sm:whitespace-nowrap max-sm:py-0'
const compactButtonCls = '!px-2 !py-1 !text-[10px] sm:!px-3 sm:!py-2 sm:!text-xs'
const stickyThCls = 'sticky left-0 z-[5] bg-blue-600 max-sm:bg-blue-500 max-sm:shadow-[2px_0_4px_rgba(0,0,0,0.08)]'
const stickyTdCls = 'sticky left-0 z-[5] bg-white max-sm:bg-white font-semibold text-[#1A63BC] shadow-[2px_0_0_#ECECEC] max-sm:shadow-[2px_0_4px_rgba(0,0,0,0.05)]'
const stickySecondThCls = 'sticky left-[41px] z-[5] bg-blue-600 max-sm:bg-blue-500 max-sm:shadow-[2px_0_4px_rgba(0,0,0,0.08)]'
// Column chooser: per tab, columns can be shown, hidden, reordered and pinned (Login always stays first)
const LOGIN_WIDTH = 96
const PIN_WIDTH = 150
const COLUMN_PREFS_KEY = 'brokerageCalculatorColumns.v2'
const loadColumnPrefs = () => {
  try { const saved = JSON.parse(localStorage.getItem(COLUMN_PREFS_KEY) || 'null'); return saved && typeof saved === 'object' ? saved : {} } catch { return {} }
}
// Saved prefs merged with the columns that exist now (Exchange View columns depend on the week's exchanges)
const columnPrefsFor = (saved = {}, columns) => {
  const known = columns.map(column => column.key)
  const order = [...(saved.order || []).filter(key => known.includes(key)), ...known.filter(key => !(saved.order || []).includes(key))]
  return { order, hidden: (saved.hidden || []).filter(key => known.includes(key)), pinned: (saved.pinned || []).filter(key => known.includes(key)) }
}
const STATUS_LABELS = { all: 'All', ready: 'Ready', pending: 'Pending' }
const TABS = [
  { id: 'logins', label: 'Final Report' },
  { id: 'exchanges', label: 'Exchange Detail' },
  { id: 'pivot', label: 'Exchange View' },
  { id: 'pending', label: 'Pending' },
]
const ISSUE_LABELS = {
  method_missing: 'Method missing',
  rate_missing: 'Rate missing',
  usd_inr_missing: 'USD-INR missing',
  account_currency_unsupported: 'Unsupported account currency',
  group_rate_conflict: 'Group rates conflict',
}
const RATE_SOURCE_LABELS = { client: 'Client', group: 'Group', broker: 'Exchange', none: '—' }
const rateSourceLabel = row => {
  const label = RATE_SOURCE_LABELS[row.rate_source] || row.rate_source || '—'
  return row.rate_source === 'group' && row.rate_groups?.length ? `${label}: ${row.rate_groups.join(', ')}` : label
}
const currencyBadge = currency => <span className="inline-flex h-6 items-center rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-slate-700">{currency || 'INR'}</span>

function StatusBadge({ status }) {
  return <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase sm:px-2 sm:py-1 sm:text-xs ${status === 'pending' ? 'bg-amber-50 text-amber-700' : status === 'ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{status || '—'}</span>
}

function Flags({ row }) {
  return <>{(row.flags || []).map(flag => <span key={flag} className="ml-1 inline-block rounded bg-red-50 px-1 py-0.5 text-[9px] text-red-700 sm:px-1.5 sm:text-xs" title={flag === 'commission_refund' ? 'MT5 paid commission back on some deals; check before paying.' : flag.replace(/_/g, ' ')}>
    {flag === 'commission_refund' ? 'Commission refund' : flag.replace(/_/g, ' ')}
  </span>)}</>
}

function Amount({ row, field }) {
  const warning = ['our_brokerage_inr', 'balance_inr'].includes(field) && row.flags?.includes('our_brokerage_exceeds_charged')
  return <td className={`${cellCls} ${warning ? 'bg-red-50 text-red-700' : 'text-[#374151]'}`}>{format(row[field])}</td>
}

function Table({ headers, children, label, columnWidths, stickySecond = false, stickySecondTh = stickySecondThCls, headerStyle }) {
  return <div className="scrollbar-hide max-h-[60vh] overflow-auto sm:max-h-[65vh]">
    <table aria-label={label} className={`w-full border-collapse bg-white max-sm:bg-transparent max-sm:border-separate max-sm:border-spacing-0 max-sm:[&_tbody_td]:border-b max-sm:[&_tbody_td]:border-[#E1E1E1] font-outfit text-sm text-[#374151] [&_tbody]:text-[#374151] [&_tfoot]:text-[#374151] ${columnWidths ? 'min-w-[800px] table-fixed' : ''}`}>
      {columnWidths && <colgroup>{columnWidths.map((width, index) => <col key={headers[index]} style={{ width }} />)}</colgroup>}
      <thead className="sticky top-0 z-10 shadow-[0_1px_0_#E5E7EB] max-sm:shadow-[0_2px_6px_rgba(37,99,235,0.25)] max-sm:[transform:translateZ(0)]"><tr className="bg-blue-600 text-left max-sm:bg-blue-500">{headers.map((header, index) => <th key={header} style={headerStyle?.(index)} className={`whitespace-nowrap bg-blue-600 max-sm:bg-blue-500 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-white sm:px-3 sm:py-2.5 sm:text-[11px] ${index === 0 ? stickyThCls : ''} ${index === 1 && stickySecond ? stickySecondTh : ''}`}>{header}</th>)}</tr></thead>
      {children}
    </table>
  </div>
}

function RateSettings({ client = false, selection = {}, onClose, onSaved }) {
  const [rows, setRows] = useState(null)
  const [original, setOriginal] = useState([])
  const [exchanges, setExchanges] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  const filters = useMemo(() => (selection.login ? { login: selection.login } : {}), [selection.login])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = event => { if (event.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey) }
  }, [onClose, saving])

  useEffect(() => {
    let active = true
    setRows(null); setError('')
    const load = async () => {
      try {
        const [exchangeResponse, clientResponse] = await Promise.all([
          brokerageCalcAPI.getExchanges(),
          client ? brokerageCalcAPI.getClientRates(filters) : Promise.resolve(null),
        ])
        const exchangeRows = calculatorData(exchangeResponse).exchanges
        const saved = client ? calculatorData(clientResponse).client_rates : exchangeRows
        if (!Array.isArray(exchangeRows) || !Array.isArray(saved)) throw new Error('Invalid rate settings response. Please retry.')
        if (client && filters.login && Array.isArray(selection.exchanges)) {
          const scoped = calculatorClientRateScope(exchangeRows, saved, filters.login, selection.exchanges)
          if (active) { setExchanges(scoped.exchanges); setOriginal(scoped.original); setRows(scoped.rows) }
          return
        }
        const editable = saved.map(row => ({ ...row, method: row.method ?? '', rate: row.rate ?? '' }))
        // A client's rates: one row per exchange, so every exchange can be set directly
        if (client && filters.login) {
          for (const item of exchangeRows) {
            if (!editable.some(row => row.exchange === item.exchange)) editable.push({ login: filters.login, exchange: item.exchange, method: '', rate: '', fixed: true })
          }
          editable.sort((x, y) => exchangeRows.findIndex(item => item.exchange === x.exchange) - exchangeRows.findIndex(item => item.exchange === y.exchange))
        }
        if (active) { setExchanges(exchangeRows); setOriginal(saved); setRows(editable) }
      } catch (failure) { if (active) setError(errorMessage(failure)) }
    }
    load()
    return () => { active = false }
  }, [client, filters, reload, selection.exchanges])

  const update = (index, key, value) => setRows(current => current.map((row, i) => i === index ? { ...row, [key]: value } : row))
  const resetRow = index => setRows(current => current.map((row, i) => i === index ? { ...row, method: '', rate: '' } : row))
  const save = async () => {
    setError('')
    try {
      const isBlank = row => !row.method && String(row.rate ?? '').trim() === ''
      const changes = changedCalculatorRates(client ? rows.filter(row => !(row.fixed && isBlank(row))) : rows, original, client)
      if (!changes.length) { onClose(); return }
      setSaving(true)
      calculatorData(await (client ? brokerageCalcAPI.setClientRates(changes) : brokerageCalcAPI.setExchanges(changes)))
      onSaved(client ? 'Brokerage saved' : 'Default exchange brokerage saved')
      onClose()
    } catch (failure) { setError(errorMessage(failure)) } finally { setSaving(false) }
  }

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-2 sm:p-3 max-sm:items-end max-sm:bg-black/40 max-sm:p-0">
    <section role="dialog" aria-modal="true" aria-labelledby="rate-settings-title" className="flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white font-outfit text-sm text-[#374151] shadow-xl [color-scheme:light] sm:max-h-[78dvh] max-sm:max-h-[90dvh] max-sm:rounded-b-none max-sm:rounded-t-[28px] max-sm:bg-white max-sm:shadow-[0_-8px_30px_rgba(15,23,42,0.12)]">
      <div className="flex shrink-0 justify-center pt-2.5 sm:hidden"><span className="h-1 w-10 rounded-full bg-[#CBD5E1]" /></div>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E5E7EB] p-3 sm:gap-4 sm:px-5 sm:py-3.5 max-sm:items-center max-sm:border-[#D5DEEA] max-sm:px-5 max-sm:pb-3 max-sm:pt-3">
        <div><h2 id="rate-settings-title" className="text-base font-semibold text-[#1A1A1A] sm:text-lg max-sm:text-[18px] max-sm:font-extrabold max-sm:tracking-tight max-sm:text-[#0F172A]">{client ? `Set Brokerage${selection.login ? ` · ${selection.login}` : ''}` : 'Default Exchange Brokerage'}</h2>
          <p className="mt-0.5 text-[10px] text-slate-600 sm:mt-1 sm:text-xs max-sm:text-[12px] max-sm:text-[#64748B]">{client ? `${Array.isArray(selection.exchanges) ? 'Only exchanges in this client’s report are shown.' : 'Set a rate for any exchange.'} Leave it blank to use the group or default exchange rate.` : 'Set rates by exchange. Zero is valid.'}</p>
        </div>
        <button type="button" disabled={saving} onClick={onClose} className={`${rateButtonCls} w-10 shrink-0 !p-0 max-sm:h-10 max-sm:rounded-xl max-sm:border-[#D5DEEA] max-sm:bg-transparent`} aria-label="Close rate settings" title="Close">
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="min-h-0 overflow-auto p-3 sm:px-5 sm:py-4 max-sm:px-4 max-sm:pt-4">
        {error && <p role="alert" className="mb-3 rounded bg-red-50 p-2.5 text-xs text-red-700 sm:p-3 sm:text-sm">{error} {!rows && <button type="button" className={buttonCls} onClick={() => setReload(value => value + 1)}>Retry</button>}</p>}
        {!rows ? !error && <p role="status">Loading rates...</p> : <>
          {/* Mobile: one card per rate (a wide table doesn't fit a phone). Same fields and handlers as the table. */}
          <div className="space-y-2.5 sm:hidden">
            {rows.map((row, index) => {
              const persisted = row.fixed || original.some(item => item.exchange === row.exchange && (!client || String(item.login) === String(row.login)))
              const currency = client ? exchanges.find(item => item.exchange === row.exchange)?.currency : row.currency
              return <div key={index} className={`rounded-2xl border p-3 ${selection.exchange === row.exchange ? 'border-[#2563EB] bg-[#2563EB]/[0.06]' : 'border-[#D5DEEA]'}`}>
                <div className="mb-2.5 flex items-center gap-2">
                  {client && (persisted
                    ? <span className="text-[14px] font-bold tabular-nums text-[#1D4ED8]">{row.login}</span>
                    : <input aria-label={`Login ${index + 1}`} disabled={saving} inputMode="numeric" placeholder="Login" className={`${rateInputCls} w-24 tabular-nums`} value={row.login} onChange={event => update(index, 'login', event.target.value)} />)}
                  {client && !persisted
                    ? <MobileSelect ariaLabel={`Exchange ${index + 1}`} title="Exchange" placeholder="Choose exchange" disabled={saving} className="flex-1" value={row.exchange} onChange={value => update(index, 'exchange', value)}
                      options={exchanges.map(item => ({ value: item.exchange, label: item.exchange }))} />
                    : <span className="rounded-full bg-[#2563EB]/10 px-2.5 py-1 text-[12px] font-semibold text-[#2563EB]">{row.exchange}</span>}
                  <button type="button" disabled={saving} className="ml-auto shrink-0 text-[12px] font-semibold text-[#2563EB] disabled:opacity-50" onClick={() => client && !persisted ? setRows(current => current.filter((_, i) => i !== index)) : resetRow(index)}>{client ? persisted ? 'Reset' : 'Remove' : 'Clear'}</button>
                </div>
                <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-end gap-2">
                  <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Method</span>
                    <MobileSelect ariaLabel={`Method ${index + 1}`} title="Method" disabled={saving} className="w-full" value={row.method} onChange={value => update(index, 'method', value)}
                      options={[{ value: '', label: client ? 'Default' : 'Not set' }, { value: 'lot', label: 'Per Lot' }, { value: 'crore', label: 'Per Crore' }]} /></label>
                  <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Rate</span>
                    <input aria-label={`Rate ${index + 1}`} disabled={saving} inputMode="decimal" className={`${rateInputCls} w-full tabular-nums`} placeholder={client ? 'Default' : 'Not set'} value={row.rate} onChange={event => update(index, 'rate', event.target.value)} /></label>
                  <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Currency</span>
                    <span className="flex h-10 items-center">{currencyBadge(currency)}</span></label>
                </div>
                {!client && <p className={`mt-2 text-[11px] font-medium ${row.configured ? 'text-emerald-700' : 'text-[#64748B]'}`}>{row.configured ? 'Set' : 'Not set'}</p>}
              </div>
            })}
          </div>
          <div className="scrollbar-hide hidden overflow-x-auto rounded-lg border border-[#E5E7EB] sm:block">
          <Table label={client ? 'Client rate settings' : 'Exchange rate settings'} stickySecond={false} headers={[...(client && !selection.login ? ['Login'] : []), 'Exchange', 'Method', 'Rate', 'Currency', 'Status', 'Actions']}>
            <tbody>{rows.map((row, index) => {
              const persisted = row.fixed || original.some(item => item.exchange === row.exchange && (!client || String(item.login) === String(row.login)))
              const currency = client ? exchanges.find(item => item.exchange === row.exchange)?.currency : row.currency
              const custom = client && (row.method || String(row.rate ?? '').trim() !== '')
              return <tr key={index} className={`border-b border-[#E5E7EB] last:border-b-0 ${selection.exchange === row.exchange ? 'bg-blue-50' : custom ? 'bg-[#F8FAFF]' : ''}`}>
                {client && !selection.login && <td className={`px-1.5 py-2 sm:px-3 sm:py-1.5 ${stickyRateTdCls}`}><input aria-label={`Login ${index + 1}`} readOnly={persisted} disabled={saving} inputMode="numeric" className={`${rateInputCls} w-20 tabular-nums read-only:border-transparent read-only:bg-transparent read-only:px-0 read-only:shadow-none sm:w-24`} value={row.login} onChange={event => update(index, 'login', event.target.value)} /></td>}
                <td className={`whitespace-nowrap px-1.5 py-2 text-xs sm:px-3 sm:py-1.5 sm:text-[13px] ${client ? '' : stickyRateTdCls}`}>{client && !persisted ? <select aria-label={`Exchange ${index + 1}`} disabled={saving} className={`${rateInputCls} w-28 sm:w-36`} value={row.exchange} onChange={event => update(index, 'exchange', event.target.value)}>
                  <option value="">Choose exchange</option>{exchanges.map(item => <option key={item.exchange}>{item.exchange}</option>)}
                </select> : <span className="font-semibold text-[#0F172A]">{row.exchange}</span>}</td>
                <td className="px-1.5 py-2 sm:px-3 sm:py-1.5"><select aria-label={`Method ${index + 1}`} disabled={saving} className={`${rateInputCls} w-[138px] sm:!h-8 sm:w-32 sm:!text-[13px]`} value={row.method} onChange={event => update(index, 'method', event.target.value)}>
                  <option value="">{client ? 'Default' : 'Not set'}</option><option value="lot">Per Lot</option><option value="crore">Per Crore</option>
                </select></td>
                <td className="px-1.5 py-2 sm:px-3 sm:py-1.5"><input aria-label={`Rate ${index + 1}`} disabled={saving} inputMode="decimal" className={`${rateInputCls} w-28 tabular-nums sm:!h-8 sm:w-24 sm:!text-[13px]`} placeholder={client ? 'Default' : 'Not set'} value={row.rate} onChange={event => update(index, 'rate', event.target.value)} /></td>
                <td className="px-1.5 py-2 sm:px-3 sm:py-1.5">{currencyBadge(currency)}</td>
                <td className="whitespace-nowrap px-1.5 py-2 sm:px-3 sm:py-1.5">{(client ? custom : row.configured)
                  ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-[#2563EB]">{client ? 'Custom' : 'Set'}</span>
                  : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">{client ? 'Default' : 'Not set'}</span>}</td>
                <td className="px-1.5 py-2 sm:px-3 sm:py-1.5"><button type="button" title={client && persisted && !custom ? 'Already using the default rate' : undefined} disabled={saving || (client && persisted && !custom)} className={client && persisted ? 'whitespace-nowrap rounded-lg border border-[#E5E7EB] px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#E5E7EB] disabled:hover:text-[#475569] sm:text-xs' : `${rateButtonCls} !whitespace-nowrap`} onClick={() => client && !persisted ? setRows(current => current.filter((_, i) => i !== index)) : resetRow(index)}>{client ? persisted ? 'Reset' : 'Remove' : 'Clear setting'}</button></td>
              </tr>
            })}</tbody>
          </Table>
          </div>
          {!client && rows.length > 0 && <p className="mt-3 text-[11px] text-[#64748B] sm:text-xs">The rate is in the exchange's currency shown here.</p>}
          {!rows.length && <p className="py-3 text-xs text-slate-500 sm:py-4 sm:text-sm max-sm:rounded-2xl max-sm:border max-sm:border-dashed max-sm:border-[#D5DEEA] max-sm:py-6 max-sm:text-center max-sm:text-[13px]">No {client ? 'client overrides' : 'exchanges'} found.</p>}
        </>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#E5E7EB] bg-[#F9FAFB] p-3 sm:gap-3 sm:px-5 sm:py-3 max-sm:border-[#D5DEEA] max-sm:bg-transparent max-sm:px-4 max-sm:pb-[calc(16px+env(safe-area-inset-bottom,0px))]">
        <div className="ml-auto flex gap-2 sm:gap-3">
          <button type="button" className={`${rateButtonCls} min-w-16 sm:min-w-28 max-sm:h-11 max-sm:rounded-[14px] max-sm:border-[#D5DEEA] max-sm:bg-transparent max-sm:text-[13px] max-sm:text-[#334155]`} disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className={`${ratePrimaryCls} min-w-20 sm:min-w-28 max-sm:h-11 max-sm:rounded-[14px] max-sm:bg-[#2563EB] max-sm:text-[13px] max-sm:shadow-[0_4px_10px_rgba(37,99,235,0.3)]`} disabled={saving || !rows} onClick={save}>{saving ? 'Saving...' : 'Save rates'}</button>
        </div>
      </footer>
    </section>
  </div>
}

// Rates for one login group (opened from the Groups menu). Precedence in the report is
// client override → group rate → exchange rate.
function GroupRates({ groupName, onClose, onSaved }) {
  const [group, setGroup] = useState(null)
  const [exchanges, setExchanges] = useState([])
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = event => { if (event.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey) }
  }, [onClose, saving])

  useEffect(() => {
    let active = true
    setRows(null); setError('')
    const load = async () => {
      try {
        const [groupResponse, exchangeResponse] = await Promise.all([brokerageCalcAPI.getGroupRates({ group: groupName }), brokerageCalcAPI.getExchanges()])
        const list = calculatorData(groupResponse).groups
        const exchangeRows = calculatorData(exchangeResponse).exchanges
        if (!Array.isArray(list) || !Array.isArray(exchangeRows)) throw new Error('Invalid group rates response. Please retry.')
        const found = list.find(item => item.group === groupName) || null
        const saved = new Map((found?.rates || []).map(rate => [rate.exchange, rate]))
        const names = [...new Set([...exchangeRows.map(item => item.exchange), ...saved.keys()])]
        if (!active) return
        setGroup(found); setExchanges(exchangeRows)
        setRows(names.map(exchange => ({ group: groupName, exchange, method: saved.get(exchange)?.method ?? '', rate: saved.get(exchange)?.rate ?? '' })))
      } catch (failure) { if (active) setError(errorMessage(failure)) }
    }
    load()
    return () => { active = false }
  }, [groupName, reload])

  const original = (group?.rates || []).map(rate => ({ group: groupName, ...rate }))
  const update = (index, values) => setRows(current => current.map((row, i) => i === index ? { ...row, ...values } : row))
  const save = async () => {
    setError('')
    try {
      const changes = changedGroupRates(rows, original)
      if (!changes.length) { onClose(); return }
      setSaving(true)
      calculatorData(await brokerageCalcAPI.setGroupRates(changes))
      onSaved(`Rates saved for ${groupName}`)
      onClose()
    } catch (failure) { setError(errorMessage(failure)) } finally { setSaving(false) }
  }
  const currencyOf = exchange => exchanges.find(item => item.exchange === exchange)?.currency
  const loginSummary = group?.range ? `Logins ${group.range.from}–${group.range.to}` : group ? `${group.login_count} login${group.login_count === 1 ? '' : 's'}` : ''

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-2 sm:p-3 max-sm:items-end max-sm:bg-black/40 max-sm:p-0">
    <section role="dialog" aria-modal="true" aria-labelledby="group-rates-title" className="flex max-h-[85dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white font-outfit text-sm text-[#374151] shadow-xl [color-scheme:light] sm:max-h-[92dvh] max-sm:max-h-[90dvh] max-sm:rounded-b-none max-sm:rounded-t-[28px] max-sm:shadow-[0_-8px_30px_rgba(15,23,42,0.12)]">
      <div className="flex shrink-0 justify-center pt-2.5 sm:hidden"><span className="h-1 w-10 rounded-full bg-[#CBD5E1]" /></div>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] p-3 sm:px-6 sm:py-5 max-sm:border-[#D5DEEA] max-sm:px-5">
        <div className="min-w-0"><h2 id="group-rates-title" className="truncate text-base font-semibold text-[#1A1A1A] sm:text-lg max-sm:text-[18px] max-sm:font-extrabold max-sm:tracking-tight max-sm:text-[#0F172A]">Rates · {groupName}</h2>
          <p className="mt-0.5 text-[10px] text-slate-600 sm:mt-1 sm:text-xs max-sm:text-[12px] max-sm:text-[#64748B]">{loginSummary ? `${loginSummary}. ` : ''}Blank = use the exchange rate. A client rate beats the group rate.</p>
        </div>
        <button type="button" disabled={saving} onClick={onClose} className={`${rateButtonCls} w-10 shrink-0 !p-0 max-sm:h-10 max-sm:rounded-xl max-sm:border-[#D5DEEA] max-sm:bg-transparent`} aria-label="Close group rates" title="Close">
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="min-h-0 overflow-auto p-3 sm:p-6 max-sm:px-4 max-sm:pt-4">
        {error && <p role="alert" className="mb-3 rounded bg-red-50 p-2.5 text-xs text-red-700 sm:p-3 sm:text-sm">{error} {!rows && <button type="button" className={buttonCls} onClick={() => setReload(value => value + 1)}>Retry</button>}</p>}
        {!rows ? !error && <p role="status">Loading rates...</p> : <>
          {/* Mobile: one card per exchange */}
          <div className="space-y-2.5 sm:hidden">
            {rows.map((row, index) => <div key={row.exchange} className="rounded-2xl border border-[#D5DEEA] p-3">
              <div className="mb-2.5 flex items-center gap-2">
                <span className="rounded-full bg-[#2563EB]/10 px-2.5 py-1 text-[12px] font-semibold text-[#2563EB]">{row.exchange}</span>
                {currencyBadge(currencyOf(row.exchange))}
                <button type="button" disabled={saving} className="ml-auto text-[12px] font-semibold text-[#2563EB] disabled:opacity-50" onClick={() => update(index, { method: '', rate: '' })}>Use exchange rate</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Method</span>
                  <MobileSelect ariaLabel={`Method ${row.exchange}`} title="Method" disabled={saving} className="w-full" value={row.method} onChange={value => update(index, { method: value })}
                    options={[{ value: '', label: 'Exchange value' }, { value: 'lot', label: 'Per Lot' }, { value: 'crore', label: 'Per Crore' }]} /></label>
                <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Rate</span>
                  <input aria-label={`Rate ${row.exchange}`} disabled={saving} inputMode="decimal" className={`${rateInputCls} w-full tabular-nums`} placeholder="Inherit" value={row.rate} onChange={event => update(index, { rate: event.target.value })} /></label>
              </div>
            </div>)}
          </div>
          <div className="scrollbar-hide hidden overflow-x-auto rounded-lg border border-[#E5E7EB] sm:block">
            <Table label="Group rate settings" headers={['Exchange', 'Method', 'Rate', 'Currency', 'Actions']}>
              <tbody>{rows.map((row, index) => <tr key={row.exchange} className="border-b border-[#E5E7EB] last:border-b-0">
                <td className={`whitespace-nowrap px-3 py-3 text-sm ${stickyRateTdCls}`}>{row.exchange}</td>
                <td className="px-3 py-3"><select aria-label={`Method ${row.exchange}`} disabled={saving} className={`${rateInputCls} w-44`} value={row.method} onChange={event => update(index, { method: event.target.value })}>
                  <option value="">Use exchange value</option><option value="lot">Per Lot</option><option value="crore">Per Crore</option>
                </select></td>
                <td className="px-3 py-3"><input aria-label={`Rate ${row.exchange}`} disabled={saving} inputMode="decimal" className={`${rateInputCls} w-32 tabular-nums`} placeholder="Inherit" value={row.rate} onChange={event => update(index, { rate: event.target.value })} /></td>
                <td className="px-3 py-3">{currencyBadge(currencyOf(row.exchange))}</td>
                <td className="px-3 py-3"><button type="button" disabled={saving} className="whitespace-nowrap text-xs font-medium text-blue-600 hover:underline disabled:opacity-50" onClick={() => update(index, { method: '', rate: '' })}>Use exchange rate</button></td>
              </tr>)}</tbody>
            </Table>
          </div>
          {!rows.length && <p className="rounded-2xl border border-dashed border-[#D5DEEA] py-6 text-center text-[13px] text-slate-500">No exchanges found.</p>}
          <p className="mt-3 text-[11px] text-[#64748B] sm:text-xs">The rate is in the exchange's currency. If a login is in two groups with different rates, it stays pending until you set a client rate.</p>
        </>}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E5E7EB] bg-[#F9FAFB] p-3 sm:gap-3 sm:px-6 sm:py-4 max-sm:border-[#D5DEEA] max-sm:bg-transparent max-sm:px-4 max-sm:pb-[calc(16px+env(safe-area-inset-bottom,0px))]">
        <button type="button" className={`${rateButtonCls} min-w-20 sm:min-w-28 max-sm:h-11 max-sm:flex-1 max-sm:rounded-[14px] max-sm:border-[#D5DEEA] max-sm:bg-transparent max-sm:text-[13px] max-sm:text-[#334155]`} disabled={saving} onClick={onClose}>Cancel</button>
        <button type="button" className={`${ratePrimaryCls} min-w-20 sm:min-w-28 max-sm:h-11 max-sm:flex-1 max-sm:rounded-[14px] max-sm:bg-[#2563EB] max-sm:text-[13px] max-sm:shadow-[0_4px_10px_rgba(37,99,235,0.3)]`} disabled={saving || !rows} onClick={save}>{saving ? 'Saving...' : 'Save rates'}</button>
      </footer>
    </section>
  </div>
}

// Import rates from Excel / CSV: client rates (Login, Exchange, Method, Rate) or default exchange
// rates (Exchange, Method, Rate). Rows are validated, previewed, then saved with the rate APIs.
const IMPORT_TYPES = {
  client: { label: 'Client rates', columns: ['Login', 'Exchange', 'Method', 'Rate'], sample: [[90010, 'MCX', 'Per Lot', 5], [90010, 'NSE', 'Per Crore', 500]] },
  exchange: { label: 'Default exchange rates', columns: ['Exchange', 'Method', 'Rate'], sample: [['MCX', 'Per Lot', 5], ['NSE', 'Per Crore', 500]] },
}
const importMethod = value => {
  const text = String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  if (!text || text === 'default' || text === 'notset') return ''
  if (['lot', 'perlot'].includes(text)) return 'lot'
  if (['crore', 'percrore'].includes(text)) return 'crore'
  return String(value)
}

function ImportRates({ onClose, onSaved }) {
  const [type, setType] = useState('client')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef(null)
  const config = IMPORT_TYPES[type]

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = event => { if (event.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey) }
  }, [onClose, saving])

  const reset = nextType => { setType(nextType); setRows(null); setFileName(''); setError(''); if (fileInput.current) fileInput.current.value = '' }
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([config.columns, ...config.sample])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Rates')
    XLSX.writeFile(book, `${type === 'client' ? 'client' : 'default_exchange'}_rates_template.xlsx`)
  }
  const readFile = async file => {
    setError(''); setRows(null); setFileName(file?.name || '')
    if (!file) return
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer())
      const records = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' })
      // Match headers loosely ("Login", "login ", "LOGIN")
      const pick = (record, name) => {
        const key = Object.keys(record).find(item => item.trim().toLowerCase() === name.toLowerCase())
        return key == null ? '' : record[key]
      }
      const parsed = records
        .map(record => ({
          ...(type === 'client' ? { login: String(pick(record, 'Login')).trim() } : {}),
          exchange: String(pick(record, 'Exchange')).trim(),
          method: importMethod(pick(record, 'Method')),
          rate: String(pick(record, 'Rate')).trim(),
        }))
        .filter(row => Object.values(row).some(value => value !== ''))
      if (!parsed.length) throw new Error(`No rows found. Use the columns: ${config.columns.join(', ')}.`)
      if (parsed.length > 1000) throw new Error('Import up to 1,000 rows at a time.')
      calculatorRateRows(parsed, type === 'client') // validates every row; throws with the first problem
      setRows(parsed)
    } catch (failure) { setError(errorMessage(failure)) }
  }
  const save = async () => {
    setError(''); setSaving(true)
    try {
      const payload = calculatorRateRows(rows, type === 'client')
      calculatorData(await (type === 'client' ? brokerageCalcAPI.setClientRates(payload) : brokerageCalcAPI.setExchanges(payload)))
      onSaved(`${payload.length} ${config.label.toLowerCase()} imported`)
      onClose()
    } catch (failure) { setError(errorMessage(failure)) } finally { setSaving(false) }
  }
  const methodLabel = method => method === 'lot' ? 'Per Lot' : method === 'crore' ? 'Per Crore' : 'Default'

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-2 sm:p-3 max-sm:items-end max-sm:bg-black/40 max-sm:p-0">
    <section role="dialog" aria-modal="true" aria-labelledby="import-rates-title" className="flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white font-outfit text-sm text-[#374151] shadow-xl [color-scheme:light] sm:max-h-[80dvh] max-sm:rounded-b-none max-sm:rounded-t-[28px]">
      <div className="flex shrink-0 justify-center pt-2.5 sm:hidden"><span className="h-1 w-10 rounded-full bg-[#CBD5E1]" /></div>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] px-5 py-3.5">
        <div><h2 id="import-rates-title" className="text-[17px] font-bold text-[#0F172A]">Import rates</h2>
          <p className="mt-0.5 text-xs text-[#64748B]">Upload an Excel or CSV file. Existing rates for the same rows are replaced.</p></div>
        <button type="button" disabled={saving} onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#475569] hover:bg-gray-50" aria-label="Close import" title="Close">
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
          {Object.entries(IMPORT_TYPES).map(([key, item]) => <button key={key} type="button" disabled={saving} onClick={() => reset(key)}
            className={`h-8 rounded-lg text-[12px] font-semibold transition-colors ${type === key ? 'bg-white text-[#2563EB] shadow-sm' : 'text-[#64748B] hover:text-[#0F172A]'}`}>{item.label}</button>)}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] px-3 py-2.5">
          <p className="min-w-0 text-[12px] text-[#475569]">Columns: <span className="font-semibold text-[#0F172A]">{config.columns.join(', ')}</span>. Method: Per Lot, Per Crore or blank.</p>
          <button type="button" onClick={downloadTemplate} className="shrink-0 text-[12px] font-semibold text-[#2563EB] hover:underline">Template</button>
        </div>
        <label className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${fileName ? 'border-[#2563EB]/40 bg-blue-50/40' : 'border-[#D5DEEA] hover:border-[#2563EB]/40 hover:bg-blue-50/30'}`}>
          <svg aria-hidden="true" className="h-7 w-7 text-[#2563EB]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m-4 4 4-4 4 4M5 15v4h14v-4" /></svg>
          <span className="text-[13px] font-semibold text-[#0F172A]">{fileName || 'Choose a file'}</span>
          <span className="text-[11px] text-[#64748B]">.xlsx, .xls or .csv · up to 1,000 rows</span>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={saving} onChange={event => readFile(event.target.files?.[0])} />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        {rows && <div>
          <p className="mb-2 text-[12px] font-semibold text-[#0F172A]">{rows.length} row{rows.length === 1 ? '' : 's'} ready to import</p>
          <div className="max-h-56 overflow-auto rounded-xl border border-[#E5E7EB]">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-[#64748B]"><tr>{config.columns.map(column => <th key={column} className="px-3 py-2 font-semibold">{column}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 200).map((row, index) => <tr key={index} className="border-t border-[#F1F5F9]">
                {type === 'client' && <td className="px-3 py-1.5 tabular-nums">{row.login}</td>}
                <td className="px-3 py-1.5 font-semibold text-[#0F172A]">{row.exchange}</td>
                <td className="px-3 py-1.5">{methodLabel(row.method)}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.rate === '' ? 'Default' : row.rate}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="mt-1 text-[11px] text-[#64748B]">Showing the first 200 rows.</p>}
        </div>}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E5E7EB] bg-[#F9FAFB] px-5 py-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
        <button type="button" className={`${rateButtonCls} min-w-24`} disabled={saving} onClick={onClose}>Cancel</button>
        <button type="button" className={`${ratePrimaryCls} min-w-24`} disabled={saving || !rows?.length} onClick={save}>{saving ? 'Importing...' : `Import${rows ? ` ${rows.length}` : ''}`}</button>
      </footer>
    </section>
  </div>
}

// One login's brokerage, opened by clicking its login in the Final Report: totals plus a card per exchange
const ldTd = 'px-2.5 py-1.5 align-middle text-[12px]'
const ldNum = 'whitespace-nowrap px-2.5 py-1.5 text-right text-[12px] tabular-nums'
function LoginDetail({ row, onClose, onClientRates }) {
  const exchangeRows = row.exchanges || []
  const total = field => {
    if (!exchangeRows.length) return null
    const values = exchangeRows.map(item => calculatorNumber(item[field]))
    return values.some(value => value == null) ? null : values.reduce((sum, value) => sum + value, 0)
  }
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey) }
  }, [onClose])
  const money = (item, field) => {
    const value = calculatorNumber(item[field])
    if (value == null) return <span className="text-slate-400">—</span>
    return <span className={value < 0 ? 'text-red-600' : 'text-[#0F172A]'}>{format(value)}</span>
  }
  const method = item => item.method === 'lot' ? 'Per Lot' : item.method === 'crore' ? 'Per Crore' : '—'

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-3 max-sm:items-end max-sm:p-0" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="login-detail-title" className="flex max-h-[85dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white font-outfit text-sm text-[#374151] shadow-xl [color-scheme:light] max-sm:max-h-[90dvh] max-sm:rounded-b-none max-sm:rounded-t-[28px]">
      <div className="flex shrink-0 justify-center pt-2.5 sm:hidden"><span className="h-1 w-10 rounded-full bg-[#CBD5E1]" /></div>
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[#E5E7EB] px-4 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2563EB] text-[13px] font-bold text-white">{String(row.name || row.login)[0].toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <h2 id="login-detail-title" className="truncate text-[14px] font-bold text-[#0F172A]">{row.login} · {row.name || '—'}</h2>
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#64748B]">
            <span>{row.currency || 'INR'}</span><span>·</span>
            <span>LD {row.ld_percent == null ? '—' : `${format(row.ld_percent)}%`}{row.ld_is_custom ? ' (custom)' : ''}</span>
            <StatusBadge status={row.status} />
          </p>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#475569] hover:bg-gray-50" aria-label="Close" title="Close">
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="min-h-0 space-y-3 overflow-auto px-4 py-3">
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
          {[['Charged · INR', 'charged_inr'], ['Our brokerage · INR', 'our_brokerage_inr'], ['Rebate INR %', 'rebate_inr']].map(([label, field]) => (
            <div key={field} className={`rounded-xl border px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${field === 'rebate_inr' ? 'border-blue-200 bg-blue-50/60' : 'border-[#E5E7EB] bg-white'}`}>
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#94A3B8]">{label}</p>
              <p className="text-[14px] font-bold tabular-nums">{money(row, field)}</p>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2"><p className="text-[12px] font-bold text-[#0F172A]">By exchange <span className="font-medium text-[#64748B]">({(row.exchanges || []).length})</span></p>{row.flags?.length > 0 && <Flags row={row} />}</div>
          <div className="scrollbar-hide overflow-x-auto rounded-xl border border-[#E5E7EB]">
            <Table label={`Exchange detail for ${row.login}`} headers={['Exchange', 'Lots', 'Turnover', 'Charged (source)', 'Method', 'Rate', 'Rate source', 'Charged INR', 'Our INR', 'Rebate INR', 'Rebate INR %', 'Status', 'Issues / flags']}>
              <tbody>{(row.exchanges || []).map(item => <tr key={item.exchange} className="border-b border-[#ECECEC] last:border-b-0">
                <td className={`${ldTd} ${stickyTdCls} whitespace-nowrap`}>{item.exchange}</td>
                <td className={ldNum}>{format(item.lots, 2)}</td>
                <td className={ldNum}>{format(item.turnover)}</td>
                <td className={ldNum}>{format(item.charged)} {item.charged_currency}</td>
                <td className={`${ldTd} whitespace-nowrap`}>{method(item)}</td>
                <td className={ldNum}>{item.rate == null ? '—' : `${format(item.rate)} ${item.rate_currency || ''}`}</td>
                <td className={`${ldTd} whitespace-nowrap`}>{rateSourceLabel(item)}</td>
                {['charged_inr', 'our_brokerage_inr', 'balance_inr', 'rebate_inr'].map(field => { const value = calculatorNumber(item[field]); const exceeds = item.flags?.includes('our_brokerage_exceeds_charged') && ['our_brokerage_inr', 'balance_inr'].includes(field); return <td key={field} className={`${ldNum} ${exceeds ? 'bg-red-50' : ''} ${value != null && value < 0 ? 'text-red-600' : ''}`}>{format(value)}</td> })}
                <td className={ldTd}><StatusBadge status={item.status} /></td>
                <td className={`${ldTd} min-w-[150px] !text-[11px] leading-snug text-amber-700`}>{(item.issues || []).map(issue => ISSUE_LABELS[issue] || issue).join(', ')}<Flags row={item} /></td>
              </tr>)}</tbody>
              {exchangeRows.length > 0 && <tfoot><tr className="border-t border-blue-100 bg-blue-50 font-semibold">
                <td className={`${ldTd} sticky left-0 z-[5] bg-blue-50 text-[#1A63BC]`}>Total</td>
                <td className={ldNum}>{format(total('lots'))}</td>
                <td className={ldNum}>{format(total('turnover'))}</td>
                <td colSpan={4} className={ldTd}>—</td>
                {['charged_inr', 'our_brokerage_inr', 'balance_inr', 'rebate_inr'].map(field => <td key={field} className={ldNum}>{money(row, field)}</td>)}
                <td colSpan={2} />
              </tr></tfoot>}
            </Table>
          </div>
          {!(row.exchanges || []).length && <p className="rounded-xl border border-dashed border-[#D5DEEA] py-6 text-center text-[13px] text-slate-500">No exchange data.</p>}
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2.5 max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
        <button type="button" className={`${rateButtonCls} min-w-24`} onClick={onClose}>Close</button>
        <button type="button" className={`${ratePrimaryCls} min-w-24`} onClick={onClientRates}>Set Brokerage</button>
      </footer>
    </section>
  </div>
}

export default function BrokerageCalculatorPage() {
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('sidebarOpen') !== 'false')
  const [numericMode, setNumericMode] = useState(() => {
    try { return localStorage.getItem('globalDisplayMode') === 'full' ? 'full' : 'compact' } catch { return 'compact' }
  })
  useEffect(() => {
    const onChange = event => {
      const mode = event?.detail || localStorage.getItem('globalDisplayMode')
      if (mode === 'compact' || mode === 'full') setNumericMode(mode)
    }
    window.addEventListener('globalDisplayModeChanged', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('globalDisplayModeChanged', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])
  const formatKpiMoney = value => numericMode === 'compact' ? formatCompactIndian(value) : format(value)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [weeks, setWeeks] = useState([])
  const [weeksError, setWeeksError] = useState('')
  const [weeksReload, setWeeksReload] = useState(0)
  const [query, setQuery] = useState({ week_id: null, search: '', status: 'all', page: 1, limit: 100 })
  const [search, setSearch] = useState('')
  const [report, setReport] = useState(null)
  const [usd, setUsd] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [tab, setTab] = useState('logins')
  const [detailRow, setDetailRow] = useState(null) // login whose exchange breakdown is open
  const [columnPrefs, setColumnPrefs] = useState(loadColumnPrefs) // { [tab]: { order, hidden, pinned } }
  const [columnPicker, setColumnPicker] = useState(null) // desktop anchor position, or 'sheet' on mobile
  const columnButtonRef = useRef(null)
  const columnPickerRef = useRef(null)
  useEffect(() => { try { localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(columnPrefs)) } catch { /* storage unavailable */ } }, [columnPrefs])
  useEffect(() => {
    if (!columnPicker || columnPicker === 'sheet') return
    const close = event => { if (!columnPickerRef.current?.contains(event.target) && !columnButtonRef.current?.contains(event.target)) setColumnPicker(null) }
    const key = event => { if (event.key === 'Escape') setColumnPicker(null) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', () => setColumnPicker(null), { once: true })
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) }
  }, [columnPicker])
  const toggleColumnPicker = () => {
    if (columnPicker) { setColumnPicker(null); return }
    if (window.innerWidth < 640) { setColumnPicker('sheet'); return }
    const rect = columnButtonRef.current.getBoundingClientRect()
    setColumnPicker({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), maxHeight: Math.min(window.innerHeight * 0.6, window.innerHeight - rect.bottom - 16) })
  }
  const [settings, setSettings] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [staleGroupRates, setStaleGroupRates] = useState([]) // rates whose saved filter group no longer exists
  const [removingStale, setRemovingStale] = useState(false)
  const [ratesGroup, setRatesGroup] = useState(null) // group name whose brokerage rates are being edited
  // Login group filter: the same saved groups and selector as the other modules
  const { groups, getActiveGroupFilter, setActiveGroupFilter, deleteGroup } = useGroups()
  const groupName = getActiveGroupFilter('brokerage-calculator')
  const activeGroup = groupName ? groups.find(group => group.name === groupName) ?? null : null
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [isLoginGroupsOpen, setIsLoginGroupsOpen] = useState(false)
  const [isLoginGroupModalOpen, setIsLoginGroupModalOpen] = useState(false)
  const groupKey = JSON.stringify(activeGroup ? (activeGroup.range ? { range: activeGroup.range } : { logins: activeGroup.loginIds }) : null)
  const [usdDraft, setUsdDraft] = useState('')
  const [usdError, setUsdError] = useState('')
  const [editingUsd, setEditingUsd] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(null) // 'week' | 'status' | null — mobile toolbar dropdowns
  const [savingUsd, setSavingUsd] = useState(false)
  const [exporting, setExporting] = useState('')
  const [toast, setToast] = useState('')
  const [pendingIssue, setPendingIssue] = useState('')
  const [pendingPage, setPendingPage] = useState(1)
  const usdInput = useRef(null)
  const refresh = () => setReload(value => value + 1)

  useEffect(() => {
    let active = true
    setWeeksError('')
    brokerAPI.getSettlementWeeks({ page: 1, limit: 100 }).then(response => {
      const list = response?.data?.weeks ?? response?.weeks
      if (!Array.isArray(list)) throw new Error('Invalid settlement weeks response.')
      if (active) {
        setWeeks(list)
        setQuery(current => ({ ...current, week_id: current.week_id ?? list[0]?.id ?? null }))
      }
    }).catch(failure => { if (active) setWeeksError(errorMessage(failure)) })
    return () => { active = false }
  }, [weeksReload])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(current => current.search === search ? current : { ...current, search, page: 1 }), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let active = true
    brokerageCalcAPI.getGroupRates().then(response => {
      const list = calculatorData(response).groups
      if (active && Array.isArray(list)) setStaleGroupRates(list.filter(group => !group.group_exists && group.rates?.length))
    }).catch(() => { if (active) setStaleGroupRates([]) })
    return () => { active = false }
  }, [reload, groups])
  const removeStaleGroupRates = async () => {
    setRemovingStale(true); setError('')
    try {
      calculatorData(await brokerageCalcAPI.setGroupRates(staleGroupRates.flatMap(group => group.rates.map(rate => ({ group: group.group, exchange: rate.exchange, method: null, rate: null })))))
      setToast('Unused group rates removed'); refresh()
    } catch (failure) { setError(errorMessage(failure)) } finally { setRemovingStale(false) }
  }
  // A group is sent as a login range or a list of logins
  const groupFields = () => {
    const group = JSON.parse(groupKey)
    if (!group) return {}
    if (group.range) return { accountRangeMin: Number(group.range.from), accountRangeMax: Number(group.range.to) }
    const logins = [...new Set((group.logins || []).map(Number).filter(value => Number.isSafeInteger(value) && value > 0))]
    return logins.length ? { logins } : {}
  }
  const previousGroupKey = useRef(groupKey)
  useEffect(() => {
    if (previousGroupKey.current === groupKey) return
    previousGroupKey.current = groupKey
    setQuery(current => current.page === 1 ? current : { ...current, page: 1 })
  }, [groupKey])

  useEffect(() => {
    if (query.week_id == null) return
    const controller = new AbortController()
    setLoading(true); setError(''); setReport(null); setUsd(null); setDetailRow(null); setEditingUsd(false); setPendingPage(1)
    Promise.all([
      brokerageCalcAPI.calculate({ ...query, ...groupFields() }, { signal: controller.signal }),
      brokerageCalcAPI.getUsdInr(query.week_id, { signal: controller.signal }),
    ]).then(([response, usdResponse]) => {
      const data = calculatorReport(response)
      const weeklyUsd = calculatorData(usdResponse)
      if (!controller.signal.aborted) {
        setReport(data)
        setUsd(weeklyUsd)
        setUsdDraft(weeklyUsd.rate == null ? '' : String(weeklyUsd.rate))
      }
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- groupFields only reads groupKey
  }, [query, reload, groupKey])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!editingUsd) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    usdInput.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [editingUsd])

  const saveUsd = async () => {
    setUsdError('')
    try {
      const rate = calculatorUsdRate(usdDraft)
      setSavingUsd(true)
      calculatorData(await brokerageCalcAPI.setUsdInr(query.week_id, rate))
      setEditingUsd(false); setToast(rate == null ? 'Weekly rate removed; the previous week may now apply.' : 'Weekly USD-INR saved'); refresh()
    } catch (failure) { setUsdError(errorMessage(failure)) } finally { setSavingUsd(false) }
  }

  const [exportMenu, setExportMenu] = useState(null) // desktop anchor position, or 'sheet' on mobile
  const exportView = calculatorExportView(tab)
  const doExport = async (view, fileFormat) => {
    setExportMenu(null); setExporting(fileFormat); setError('')
    try {
      await brokerageCalcAPI.exportFile({ ...query, ...groupFields(), format: fileFormat, view }, `brokerage_${query.week_id}_${view}.${fileFormat}`)
      setToast('All matching records downloaded')
    } catch (failure) { setError(errorMessage(failure)) } finally { setExporting('') }
  }
  const openExportMenu = event => {
    if (exportMenu) { setExportMenu(null); return }
    if (window.innerWidth < 640) { setExportMenu('sheet'); return }
    const rect = event.currentTarget.getBoundingClientRect()
    setExportMenu({ top: rect.bottom + 8, left: Math.max(8, rect.right - 272) })
  }

  const openUsd = () => { setUsdDraft(usd?.rate == null ? '' : String(usd.rate)); setUsdError(''); setEditingUsd(true) }
  const [fixRow, setFixRow] = useState(null) // pending row whose rate can be set at client, group or exchange level
  const fix = row => {
    if (row.issue === 'usd_inr_missing') { openUsd(); return }
    if (['method_missing', 'rate_missing'].includes(row.issue)) { setFixRow(row); return }
    openClientRates(row)
  }
  const openClientRates = row => {
    const clientRow = row.exchanges ? row : report?.logins?.find(item => String(item.login) === String(row.login))
    setSettings({ client: true, selection: { login: row.login, exchange: row.exchange, exchanges: clientRow?.exchanges || (row.exchange ? [row.exchange] : []) } })
  }
  const toggleSidebar = () => setSidebarOpen(current => {
    localStorage.setItem('sidebarOpen', String(!current))
    return !current
  })
  const rows = report?.logins || []
  const summary = report?.summary
  const pages = report?.pagination.total_pages || 1
  const pending = (report?.pending || []).filter(row => !pendingIssue || row.issue === pendingIssue)
  const pendingPages = Math.max(1, Math.ceil(pending.length / 250))
  const entries = rows.flatMap(row => (row.exchanges || []).map(exchange => ({ login: row.login, name: row.name, exchange })))
  const busy = loading || savingUsd || query.week_id == null

  // Column definitions per tab: { key, label, numeric?, render(row), cls?(row) }
  const amountColumn = (key, label, pick = row => row) => ({
    key, label, numeric: true, render: row => format(pick(row)[key]),
    cls: row => ['our_brokerage_inr', 'balance_inr'].includes(key) && pick(row).flags?.includes('our_brokerage_exceeds_charged') ? 'bg-red-50 text-red-700' : '',
  })
  const nameColumn = { key: 'name', label: 'Client', render: row => <span className="block truncate max-sm:max-w-[112px]" title={row.name || undefined}>{row.name || '—'}</span> }
  const methodName = method => method === 'lot' ? 'Per Lot' : method === 'crore' ? 'Per Crore' : '—'
  const tabColumns = {
    logins: [
      nameColumn,
      { key: 'ld_percent', label: 'LD%', numeric: true, render: row => <>{row.ld_percent == null ? '—' : `${format(row.ld_percent)}%`}{row.ld_is_custom && <span className="ml-1 text-[9px] text-blue-600 sm:text-xs max-sm:ml-1.5 max-sm:rounded-full max-sm:bg-[#2563EB]/10 max-sm:px-1.5 max-sm:py-0.5 max-sm:font-semibold">custom</span>}</> },
      amountColumn('charged_inr', 'Charged INR'), amountColumn('our_brokerage_inr', 'Our INR'), amountColumn('balance_inr', 'Rebate INR'), amountColumn('rebate_inr', 'Rebate INR %'),
      { key: 'status', label: 'Status / flags', render: row => <><StatusBadge status={row.status} /><Flags row={row} /></> },
      { key: 'actions', label: 'Actions', render: row => <button type="button" className={`${buttonCls} whitespace-nowrap ${compactButtonCls} max-sm:h-7 max-sm:rounded-lg max-sm:border-[#2563EB]/40 max-sm:bg-transparent max-sm:!px-2.5 max-sm:!text-[11px] max-sm:text-[#2563EB]`} onClick={event => { event.stopPropagation(); openClientRates(row) }}>Set Brokerage</button> },
    ],
    exchanges: [
      nameColumn,
      { key: 'exchange', label: 'Exchange', render: entry => <span className="whitespace-nowrap">{entry.exchange.exchange}</span> },
      { key: 'lots', label: 'Lots', numeric: true, render: entry => format(entry.exchange.lots, 4) },
      { key: 'turnover', label: 'Turnover', numeric: true, render: entry => format(entry.exchange.turnover) },
      { key: 'charged', label: 'Charged (source)', numeric: true, render: entry => `${format(entry.exchange.charged)} ${entry.exchange.charged_currency || ''}` },
      { key: 'method', label: 'Method', render: entry => <span className="whitespace-nowrap">{methodName(entry.exchange.method)}</span> },
      { key: 'rate', label: 'Rate', numeric: true, render: entry => format(entry.exchange.rate) },
      { key: 'rate_currency', label: 'Rate currency', render: entry => entry.exchange.rate_currency || '—' },
      { key: 'rate_source', label: 'Rate source', render: entry => <span className="whitespace-nowrap">{rateSourceLabel(entry.exchange)}</span> },
      amountColumn('charged_inr', 'Charged INR', entry => entry.exchange), amountColumn('our_brokerage_inr', 'Our INR', entry => entry.exchange),
      amountColumn('balance_inr', 'Rebate INR', entry => entry.exchange), amountColumn('rebate_inr', 'Rebate INR %', entry => entry.exchange),
      { key: 'status', label: 'Status', render: entry => <StatusBadge status={entry.exchange.status} /> },
      { key: 'issues', label: 'Issues / flags', render: entry => <span className="block min-w-[140px] text-[10px] text-amber-700 sm:min-w-[160px] sm:text-xs">{(entry.exchange.issues || []).map(issue => ISSUE_LABELS[issue] || issue).join(', ')}<Flags row={entry.exchange} /></span> },
    ],
    pivot: [
      nameColumn,
      ...(report?.exchanges || []).map(exchange => ({ key: `exchange:${exchange}`, label: exchange, numeric: true, render: row => format(row.exchanges?.find(item => item.exchange === exchange)?.rebate_inr) })),
      { ...amountColumn('rebate_inr', 'Total rebate INR'), key: 'total' , render: row => format(row.rebate_inr) },
      { key: 'status', label: 'Status', render: row => <StatusBadge status={row.status} /> },
    ],
    pending: [
      nameColumn,
      { key: 'exchange', label: 'Exchange', render: row => <span className="whitespace-nowrap">{row.exchange}</span> },
      { key: 'issue', label: 'Issue', render: row => <span className="whitespace-nowrap font-medium text-amber-700">{ISSUE_LABELS[row.issue] || row.issue}</span> },
      { key: 'detail', label: 'Detail', render: row => <span className="block min-w-[160px] whitespace-normal leading-snug sm:min-w-[200px]">{row.detail}</span> },
      { key: 'action', label: 'Action', render: row => ['method_missing', 'rate_missing', 'usd_inr_missing', 'group_rate_conflict'].includes(row.issue)
        ? <button type="button" className={`${buttonCls} ${compactButtonCls} max-sm:h-7 max-sm:rounded-lg max-sm:border-[#2563EB] max-sm:bg-[#2563EB] max-sm:!px-3.5 max-sm:!text-[11px] max-sm:text-white max-sm:shadow-[0_2px_6px_rgba(37,99,235,0.3)]`} onClick={() => fix(row)}>Fix</button>
        : <span className="block min-w-[180px] whitespace-normal text-[10px] text-slate-600 sm:text-xs">Contact support with this login, exchange and detail.</span> },
    ],
  }
  const chooserColumns = tabColumns[tab] || []
  const prefsFor = key => columnPrefsFor(columnPrefs[key], tabColumns[key] || [])
  const updatePrefs = (key, change) => setColumnPrefs(current => ({ ...current, [key]: change(columnPrefsFor(current[key], tabColumns[key] || [])) }))
  const renderColumnTable = (key, { label, rows: items, rowKey, onRowClick, footer }) => {
    const columns = tabColumns[key]
    const prefs = prefsFor(key)
    const ordered = prefs.order.map(item => columns.find(column => column.key === item)).filter(column => column && !prefs.hidden.includes(column.key))
    const shown = [...ordered.filter(column => prefs.pinned.includes(column.key)), ...ordered.filter(column => !prefs.pinned.includes(column.key))]
    const pinStyle = (columnKey, header = false) => {
      const index = shown.filter(column => prefs.pinned.includes(column.key)).findIndex(column => column.key === columnKey)
      if (index < 0) return undefined
      return { position: 'sticky', left: LOGIN_WIDTH + index * PIN_WIDTH, width: PIN_WIDTH, minWidth: PIN_WIDTH, maxWidth: PIN_WIDTH, zIndex: header ? 6 : 4, boxShadow: '2px 0 4px -2px rgba(15,23,42,0.12)' }
    }
    return <Table label={label} headers={['Login', ...shown.map(column => column.label)]}
      headerStyle={index => index === 0 ? { width: LOGIN_WIDTH, minWidth: LOGIN_WIDTH } : pinStyle(shown[index - 1].key, true)}>
      <tbody>{items.map((item, index) => <tr key={rowKey(item, index)} className={`border-b border-[#ECECEC] max-sm:border-[#E1E1E1] ${onRowClick ? 'cursor-pointer hover:bg-slate-50 max-sm:hover:bg-white/50' : ''}`} onClick={onRowClick ? () => onRowClick(item) : undefined}>
        <td className={`${tdCls} ${stickyTdCls}`} style={{ width: LOGIN_WIDTH, minWidth: LOGIN_WIDTH }}>{onRowClick
          ? <button type="button" title="Show exchange breakdown" className="font-semibold text-[#1A63BC] underline-offset-2 hover:underline" onClick={event => { event.stopPropagation(); onRowClick(item) }}>{item.login}</button>
          : item.login}</td>
        {shown.map(column => {
          const style = pinStyle(column.key)
          const extra = column.cls?.(item) || ''
          return <td key={column.key} style={style} className={`${column.numeric ? cellCls : tdCls} ${extra || (style ? 'bg-white' : '')}`}>{column.render(item)}</td>
        })}
      </tr>)}</tbody>
      {footer && <tfoot><tr className="bg-blue-50 font-semibold">
        <td className={`${stickyTdCls} !bg-blue-50 whitespace-nowrap p-2 text-xs sm:p-3 sm:text-sm`}>TOTAL</td>
        {shown.map(column => <td key={column.key} style={pinStyle(column.key)} className={`${column.numeric ? cellCls : ''} bg-blue-50`}>{footer[column.key] ?? ''}</td>)}
      </tr></tfoot>}
    </Table>
  }
  const switchTab = value => { setTab(value); setPendingPage(1) }
  const tablePage = tab === 'pending' ? pendingPage : query.page
  const tablePages = tab === 'pending' ? pendingPages : pages
  const changeTablePage = value => {
    if (tab === 'pending') setPendingPage(value)
    else setQuery(current => ({ ...current, page: value }))
  }

  return <div className="flex h-[100dvh] overflow-hidden bg-[#F8FAFC] max-sm:bg-white font-outfit text-sm text-[#374151] [color-scheme:light]">
    <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onToggle={toggleSidebar} desktopOnly />
    <Sidebar isOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} mobileOnly />
    <div className={`scrollbar-hide flex min-w-0 flex-1 flex-col overflow-y-auto max-sm:overflow-x-hidden ${sidebarOpen ? 'lg:ml-60' : 'lg:ml-16'}`}>
      <header className="mx-0 mb-4 mt-0 rounded-none bg-white px-3 py-5 shadow-sm sm:m-5 sm:rounded-xl sm:px-4 sm:py-4 max-sm:sticky max-sm:top-0 max-sm:z-30 max-sm:mb-1 max-sm:bg-white max-sm:px-4 max-sm:pt-4 max-sm:pb-2 max-sm:shadow-none">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="min-w-0 w-auto shrink-0 max-w-full sm:max-w-64"><div className="flex items-center gap-2">
            <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F1F5FB] text-[#4B4B4B] shadow-inner lg:hidden max-sm:h-12 max-sm:w-12 max-sm:rounded-2xl max-sm:bg-transparent max-sm:border max-sm:border-[#D5DEEA] max-sm:text-black max-sm:shadow-none" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect y="3.75" width="20" height="2.5" rx="1.25" fill="currentColor"/><rect y="8.75" width="20" height="2.5" rx="1.25" fill="currentColor"/><rect y="13.75" width="20" height="2.5" rx="1.25" fill="currentColor"/></svg>
            </button>
            <div className="min-w-0 flex-1 sm:flex-none">
              <h1 className="min-w-0 text-left text-base font-semibold text-[#4B4B4B] sm:text-xl sm:font-bold sm:text-[#1A1A1A] max-sm:text-[22px] max-sm:leading-7 max-sm:font-extrabold max-sm:tracking-tight max-sm:text-[#0F172A]">Brokerage Calculator</h1>
              <p className="truncate text-[12px] text-[#64748B] sm:hidden">Weekly brokerage and rebates</p>
            </div>
            <span className="sm:hidden"><BrokerCreditSummary variant="header" /></span>
          </div></div>

          {/* Desktop controls: nowrap so USD-INR never drops to a second line */}
        <div aria-label="Calculator controls" className="hidden min-w-0 flex-1 basis-[620px] flex-wrap items-center gap-1 overflow-visible lg:flex min-[1700px]:gap-2">
          <select aria-label="Settlement week" title="Settlement week" className={`${toolSelectCls} w-[112px] px-1.5 min-[1700px]:w-[132px] min-[1700px]:px-2`} value={query.week_id ?? ''} disabled={savingUsd} onChange={event => { setQuery(current => ({ ...current, week_id: Number(event.target.value), page: 1 })); setPendingIssue('') }}>
            {!weeks.length && <option value="">No weeks available</option>}{weeks.map(week => <option key={week.id} value={week.id}>{week.name || `Week ${week.id}`}</option>)}
          </select>
          <select aria-label="Status" title="Status" className={`${toolSelectCls} w-[68px] px-1.5 min-[1700px]:w-[88px] min-[1700px]:px-2`} value={query.status} onChange={event => setQuery(current => ({ ...current, status: event.target.value, page: 1 }))}>
            <option value="all">All</option><option value="ready">Ready</option><option value="pending">Pending</option>
          </select>
          <span className="mx-0.5 h-6 w-px shrink-0 bg-[#E5E7EB]" aria-hidden="true" />
          <button type="button" className={`${toolIconCls} !h-9 !gap-1 !px-1.5 text-[11px] min-[1700px]:!gap-1.5 min-[1700px]:!px-2.5 min-[1700px]:text-xs`} onClick={refresh} disabled={busy} title="Recalculate" aria-label="Recalculate">
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            <span>Recalculate</span>
          </button>
          <button type="button" className={`${toolIconCls} !h-9 !gap-1 !px-1.5 text-[11px] min-[1700px]:!gap-1.5 min-[1700px]:!px-2.5 min-[1700px]:text-xs`} onClick={() => setSettings({ client: false })} title="Default Exchange Brokerage" aria-label="Default Exchange Brokerage">
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21v-8M9.5 21v-8M14.5 21v-8M19 21v-8"/><path d="M12 3l9 6H3l9-6z"/></svg>
            <span className="whitespace-nowrap">Default Exchange Brokerage</span>
          </button>
          <Link className={`${toolIconCls} !h-9 !gap-1 !px-1.5 text-[11px] min-[1700px]:!gap-1.5 min-[1700px]:!px-2.5 min-[1700px]:text-xs`} to="/client-percentage" title="Manage LD%" aria-label="Manage LD%">
            <span>Manage LD%</span>
          </Link>
          <button type="button" className={`flex h-9 shrink-0 items-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 min-[1700px]:gap-1.5 min-[1700px]:px-2.5 min-[1700px]:text-xs ${usd?.source === 'none' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-[#E5E7EB] bg-white text-[#374151] hover:bg-gray-50'}`} disabled={busy || !report} onClick={openUsd} aria-label="Edit USD-INR rate" aria-haspopup="dialog" aria-expanded={editingUsd} title="Edit USD-INR rate">
            <span>USD-INR</span><span className="font-semibold tabular-nums">{usd?.rate == null ? 'Set' : format(usd.rate)}</span>
          </button>
        </div>
          <div className="ml-auto hidden min-w-0 flex-wrap items-center justify-end gap-1 lg:flex min-[1700px]:gap-2">
            <span className="hidden min-[1700px]:block"><GroupSelector refreshOnOpen moduleName="brokerage-calculator" onRatesClick={group => setRatesGroup(group.name)} onCreateClick={() => { setEditingGroup(null); setShowGroupModal(true) }} onEditClick={group => { setEditingGroup(group); setShowGroupModal(true) }} /></span>
            <span className="min-[1700px]:hidden"><GroupSelector compact refreshOnOpen moduleName="brokerage-calculator" onRatesClick={group => setRatesGroup(group.name)} onCreateClick={() => { setEditingGroup(null); setShowGroupModal(true) }} onEditClick={group => { setEditingGroup(group); setShowGroupModal(true) }} /></span>
            <button type="button" className={`${toolTextCls} !h-9 !gap-1 !px-1.5 text-[11px] min-[1700px]:!gap-1.5 min-[1700px]:!px-3 min-[1700px]:text-xs border-[#E5E7EB] bg-white text-[#374151] hover:bg-gray-50`} onClick={() => setImportOpen(true)} title="Import rates from Excel or CSV" aria-label="Import rates">
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" /></svg>
              <span>Import</span>
            </button>
            <button type="button" className={`${toolTextCls} !h-9 !gap-1 !px-1.5 text-[11px] min-[1700px]:!gap-1.5 min-[1700px]:!px-3 min-[1700px]:text-xs border-blue-600 bg-blue-600 text-white hover:bg-blue-700`} disabled={busy || !report || !!exporting || search !== query.search} onClick={openExportMenu} aria-haspopup="menu" aria-expanded={!!exportMenu} title="Export matching records as CSV" aria-label="Export matching records">
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m-4 4 4-4 4 4M5 17v4h14v-4" /></svg>
              <span>{exporting ? 'Exporting...' : 'Export'}</span>
            </button>
          </div>
        </div>
      </header>
      <main className="min-w-0 px-3 pb-8 sm:px-5">
        {/* Mobile: controls sit in their own row below the header bar, like the Clients module */}
        {/* Mobile toolbar: one row that may slide sideways. The week/status menus are rendered outside the
            sliding row (anchored to this wrapper) so the scroll container can't clip them. */}
        <div className="relative mb-3 lg:hidden">
          <div aria-label="Calculator controls" className="scrollbar-hide flex items-center gap-2 overflow-x-auto px-1 pb-0.5">
            <button
              type="button"
              aria-label="Settlement week"
              aria-expanded={mobileMenu === 'week'}
              onClick={() => setMobileMenu(menu => menu === 'week' ? null : 'week')}
              className="flex h-9 w-[118px] shrink-0 items-center gap-1.5 rounded-xl border border-[#D5DEEA] bg-transparent px-2.5 text-left"
            >
              <svg className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#0F172A]">
                {(() => { const week = weeks.find(item => Number(item.id) === Number(query.week_id)); return week ? shortWeekName(week) : (weeks.length ? 'Week' : 'No weeks') })()}
              </span>
              <svg className={`h-3 w-3 shrink-0 transition-transform ${mobileMenu === 'week' ? 'rotate-180' : ''}`} viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button
              type="button"
              aria-label="Status"
              aria-expanded={mobileMenu === 'status'}
              onClick={() => setMobileMenu(menu => menu === 'status' ? null : 'status')}
              className={`flex h-9 w-[86px] shrink-0 items-center gap-1 rounded-xl border px-2.5 text-left ${query.status !== 'all' ? 'border-blue-200 bg-blue-50' : 'border-[#D5DEEA] bg-transparent'}`}
            >
              <span className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${query.status !== 'all' ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>{STATUS_LABELS[query.status] || 'All'}</span>
              <svg className={`h-3 w-3 shrink-0 transition-transform ${mobileMenu === 'status' ? 'rotate-180' : ''}`} viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => setIsLoginGroupsOpen(true)} aria-haspopup="dialog" aria-expanded={isLoginGroupsOpen} aria-label="Login groups" title={groupName ? `Group filter: ${groupName}` : 'Login groups'} className={`${mobileIconCls} relative ${groupName ? 'border-blue-200 bg-blue-50 text-[#2563EB]' : 'border-[#D5DEEA] bg-transparent text-[#1F2937]'}`}>
              <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 3h14M4 7.5h10M6.5 12h5" /></svg>
              <span>Groups</span>
              {groupName && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#2563EB] ring-2 ring-white" />}
            </button>
            <button type="button" className={mobileIconButtonCls} onClick={refresh} disabled={busy} title="Recalculate" aria-label="Recalculate">
              <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
              <span>Recalculate</span>
            </button>
            <button type="button" className={mobileIconButtonCls} onClick={() => setSettings({ client: false })} title="Default Exchange Brokerage" aria-label="Default Exchange Brokerage">
              <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21v-8M9.5 21v-8M14.5 21v-8M19 21v-8"/><path d="M12 3l9 6H3l9-6z"/></svg>
              <span>Default Brokerage</span>
            </button>
            <Link className={mobileIconButtonCls} to="/client-percentage" title="Manage LD%" aria-label="Manage LD%">
              <span>LD%</span>
            </Link>
            <button type="button" className={`${mobileIconButtonCls} ${usd?.source === 'none' ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : ''}`} disabled={busy || !report} onClick={openUsd} title={usd?.rate == null ? 'Set USD-INR rate' : `USD-INR: ${format(usd.rate)}`} aria-label="Edit USD-INR rate" aria-haspopup="dialog" aria-expanded={editingUsd}>
              <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <span>USD-INR</span>
            </button>
            <button type="button" className={mobileIconButtonCls} onClick={() => setImportOpen(true)} title="Import rates" aria-label="Import rates">
              <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" /></svg>
              <span>Import</span>
            </button>
            <button type="button" className={mobileIconPrimaryCls} disabled={busy || !report || !!exporting || search !== query.search} onClick={openExportMenu} aria-haspopup="menu" aria-expanded={!!exportMenu} title="Export matching records as CSV" aria-label="Export">
              {exporting ? <svg aria-hidden="true" className="h-[18px] w-[18px] animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m-4 4 4-4 4 4M5 17v4h14v-4"/></svg>}
              <span>{exporting ? 'Exporting…' : 'Export'}</span>
            </button>
            </div>
          </div>
          {mobileMenu && <div className="fixed inset-0 z-40" onClick={() => setMobileMenu(null)} />}
          {mobileMenu === 'week' && <div className="absolute left-1 top-full z-50 mt-1.5 w-[230px] rounded-2xl border border-[#D5DEEA] bg-white p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur">
            <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Settlement Week</p>
            <div className="max-h-[45vh] overflow-y-auto">
              {!weeks.length && <p className="px-2.5 py-2 text-[12px] text-[#64748B]">No weeks available</p>}
              {weeks.map(week => {
                const active = Number(week.id) === Number(query.week_id)
                return <button key={week.id} type="button" disabled={savingUsd}
                  onClick={() => { setQuery(current => ({ ...current, week_id: Number(week.id), page: 1 })); setPendingIssue(''); setMobileMenu(null) }}
                  className={`flex h-10 w-full items-center justify-between rounded-xl px-3 text-left text-[13px] disabled:opacity-50 ${active ? 'bg-[#2563EB] font-semibold text-white' : 'text-[#1F2937] active:bg-white/70'}`}>
                  <span className="truncate">{week.name || `Week ${week.id}`}</span>
                  {active && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              })}
            </div>
          </div>}
          {mobileMenu === 'status' && <div className="absolute left-[134px] top-full z-50 mt-1.5 w-[150px] rounded-2xl border border-[#D5DEEA] bg-white p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur">
            <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">Status</p>
            {Object.entries(STATUS_LABELS).map(([value, label]) => {
              const active = query.status === value
              return <button key={value} type="button"
                onClick={() => { setQuery(current => ({ ...current, status: value, page: 1 })); setMobileMenu(null) }}
                className={`flex h-10 w-full items-center justify-between rounded-xl px-3 text-left text-[13px] ${active ? 'bg-[#2563EB] font-semibold text-white' : 'text-[#1F2937] active:bg-white/70'}`}>
                {label}
                {active && <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
            })}
          </div>}
        </div>
        {weeksError && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-red-700">{weeksError} <button type="button" className={buttonCls} onClick={() => setWeeksReload(value => value + 1)}>Retry weeks</button></div>}
        {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-red-700">{error} <button type="button" className={buttonCls} onClick={refresh}>Retry report</button></div>}
        {report?.skipped_logins?.length > 0 && <p role="alert" className="mb-3 bg-amber-50 p-3 text-amber-800">Logins outside your client scope were skipped: {report.skipped_logins.join(', ')}.</p>}
        {summary && <div className="scrollbar-hide mb-4 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 lg:grid lg:snap-none lg:grid-cols-6 lg:overflow-visible lg:pb-0">
          {[
            ['Charged 100% · INR', formatKpiMoney(summary.charged_inr)],
            ['Our brokerage · INR', formatKpiMoney(summary.our_brokerage_inr)],
            ['Rebate INR (100%)', formatKpiMoney(summary.balance_inr)],
            ['Rebate INR % (at LD%)', formatKpiMoney(summary.rebate_inr)],
            ['Average login %', summary.average_login_percent == null ? '—' : `${format(summary.average_login_percent)}%`],
          ].map(([label, value]) => <div key={label} className="w-[168px] shrink-0 snap-start rounded-xl border bg-white p-3 lg:w-auto lg:shrink"><p className="text-[10px] text-[#4B5563] sm:text-xs">{label}</p><p className="mt-1 text-sm font-semibold tabular-nums text-[#1A1A1A] sm:text-base">{value}</p></div>)}
          <button type="button" onClick={() => { setPendingIssue(''); switchTab('pending') }} className="w-[168px] shrink-0 snap-start rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-amber-800 lg:w-auto lg:shrink"><span className="block text-[10px] sm:text-xs">Pending</span><span className="mt-1 block text-sm font-semibold tabular-nums sm:text-base">{format(summary.pending_logins, 0)} clients · {format(summary.pending_issues, 0)} issues</span></button>
        </div>}
        {groupName && <div className="mb-3 flex items-center gap-2 text-[11px] text-[#475569] sm:text-xs">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-[#2563EB]">Group: {groupName}</span>
          <button type="button" className="rounded-lg border border-blue-200 px-2.5 py-1 font-semibold text-[#2563EB] hover:bg-blue-50" onClick={() => setRatesGroup(groupName)}>Group rates</button>
          <button type="button" className="font-semibold text-[#2563EB] hover:underline" onClick={() => setActiveGroupFilter('brokerage-calculator', null)}>Show all logins</button>
        </div>}
        {staleGroupRates.length > 0 && <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 sm:text-xs">
          <span className="min-w-0 flex-1">Unused rates from renamed or deleted groups: <span className="font-semibold">{staleGroupRates.map(group => `${group.group} (${group.rates.map(rate => rate.exchange).join(', ')})`).join(' · ')}</span>. These are not used.</span>
          <button type="button" disabled={removingStale} className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 disabled:opacity-50" onClick={removeStaleGroupRates}>{removingStale ? 'Removing...' : 'Remove'}</button>
        </div>}
        {summary?.pending_logins > 0 && <p className="mb-3 text-[11px] text-amber-700 sm:text-xs">Pending rows are not included in the totals.</p>}
        {usd?.source === 'previous_week' && <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 sm:text-xs">
          <span className="min-w-0 flex-1">USD-INR {format(usd.rate)} is from {usd.source_week_name || `week ${usd.source_week_id}`}: confirm or change it for this week.</span>
          <button type="button" className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold" onClick={openUsd}>Review</button>
        </div>}
        {usd?.source === 'none' && <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 sm:text-xs">
          <span className="min-w-0 flex-1">No USD-INR rate for this week. USD rows stay pending until it is set.</span>
          <button type="button" className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold" onClick={openUsd}>Set rate</button>
        </div>}
        <div className="-mx-3 overflow-hidden border-y bg-white sm:mx-0 sm:rounded-xl sm:border max-sm:bg-transparent max-sm:border-blue-100">
          <div role="tablist" aria-label="Calculator reports" className="scrollbar-hide flex overflow-x-auto border-b max-sm:border-[#D5DEEA] max-sm:gap-1.5 max-sm:px-3 max-sm:py-2">
            {TABS.map(item => <button key={item.id} id={`calculator-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls="calculator-panel" type="button" className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-xs font-semibold sm:px-4 sm:py-3 sm:text-sm max-sm:h-9 max-sm:py-0 max-sm:rounded-xl max-sm:border ${tab === item.id ? 'border-b-2 border-blue-600 text-blue-700 max-sm:border-[#2563EB] max-sm:bg-[#2563EB] max-sm:text-white max-sm:shadow-[0_4px_10px_rgba(37,99,235,0.3)]' : 'text-[#4B5563] max-sm:border-[#D5DEEA] max-sm:text-[#1F2937]'}`} onClick={() => switchTab(item.id)}>{item.label}</button>)}
          </div>
          <div id="calculator-panel" role="tabpanel" aria-labelledby={`calculator-tab-${tab}`} aria-busy={loading}>
            <div aria-label="Table controls" className="flex items-center gap-1 border-b border-[#E5E7EB] p-2 sm:gap-3 sm:p-4 max-sm:gap-1.5 max-sm:px-3 max-sm:pb-3 max-sm:pt-1 max-sm:border-[#D5DEEA]">
              <form className="relative min-w-0 flex-1 sm:max-w-md" role="search" onSubmit={event => { event.preventDefault(); setQuery(current => ({ ...current, search, page: 1 })) }}>
                <input
                  type="search" name="no-autofill-search" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-form-type="other" readOnly onPointerDown={e => e.currentTarget.removeAttribute('readonly')} onFocus={e => e.currentTarget.removeAttribute('readonly')} aria-label="Search login or name" placeholder="Search by login, name..." className="h-9 w-full rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] pl-2.5 pr-8 text-xs text-[#1F2937] max-sm:h-10 max-sm:rounded-xl max-sm:border-[#D5DEEA] max-sm:bg-transparent max-sm:pl-9 max-sm:pr-3 max-sm:text-[13px] max-sm:focus:ring-blue-200 placeholder:text-[#9CA3AF] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:h-10 sm:pl-4 sm:pr-12 sm:text-sm" value={search} onChange={event => setSearch(event.target.value)} />
                <button type="submit" aria-label="Search calculator report" className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 sm:h-8 sm:w-9 max-sm:left-1 max-sm:right-auto max-sm:h-8 max-sm:w-8 max-sm:bg-transparent max-sm:text-[#9CA3AF] max-sm:hover:bg-transparent">
                  <svg aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="M13 13L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              </form>
              {report && <button ref={columnButtonRef} type="button" onClick={toggleColumnPicker} aria-haspopup="dialog" aria-expanded={!!columnPicker} title="Show, hide, pin and reorder columns" aria-label="Columns"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-xs font-medium text-[#374151] hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 sm:h-10 sm:w-10 max-sm:h-10 max-sm:w-10 max-sm:justify-center max-sm:rounded-xl max-sm:border-[#D5DEEA] max-sm:bg-transparent max-sm:px-0">
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="8" y="3" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>
              </button>}
              {tab === 'pending' && report && <select aria-label="Pending issue" title="All matching logins, not just this page" className="hidden h-9 w-[68px] shrink-0 sm:block rounded-lg border border-[#E5E7EB] bg-white px-1 font-outfit text-[11px] text-[#1F2937] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:w-36 sm:px-2 sm:text-xs" value={pendingIssue} onChange={event => { setPendingIssue(event.target.value); setPendingPage(1) }}>
                <option value="">All issues</option>{[...new Set(report.pending.map(row => row.issue))].map(issue => <option key={issue} value={issue}>{ISSUE_LABELS[issue] || issue}</option>)}
              </select>}
              {tab === 'pending' && report && <MobileSelect ariaLabel="Pending issue" title="Issue type" iconOnly className={`relative w-10 shrink-0 justify-center !px-0 sm:hidden ${pendingIssue ? '!border-blue-200 !bg-blue-50' : ''}`}
                buttonLabel={<>
                  <svg className={`h-4 w-4 ${pendingIssue ? 'text-[#2563EB]' : 'text-[#475569]'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" /></svg>
                  {pendingIssue && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#2563EB] ring-2 ring-white" />}
                </>} value={pendingIssue}
                onChange={value => { setPendingIssue(value); setPendingPage(1) }}
                options={[{ value: '', label: 'All issues' }, ...[...new Set(report.pending.map(row => row.issue))].map(issue => ({ value: issue, label: ISSUE_LABELS[issue] || issue }))]} />}
              <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-3 max-sm:gap-1.5">
                <button type="button" aria-label="Previous page" className={`${buttonCls} !p-1 sm:!p-2 max-sm:flex max-sm:h-10 max-sm:w-9 max-sm:items-center max-sm:justify-center max-sm:rounded-xl max-sm:border-[#D5DEEA] max-sm:bg-transparent`} disabled={busy || !report || tablePage <= 1} onClick={() => changeTablePage(tablePage - 1)}>
                  <svg aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <span className="flex items-center gap-0.5 whitespace-nowrap text-[11px] text-[#374151] sm:gap-2 sm:text-sm"><span className="min-w-5 rounded-md border border-[#E5E7EB] px-1 py-0.5 text-center font-semibold sm:min-w-8 sm:rounded-lg sm:px-2 sm:py-1 max-sm:flex max-sm:h-10 max-sm:w-10 max-sm:items-center max-sm:justify-center max-sm:rounded-xl max-sm:border-[#2563EB] max-sm:bg-[#2563EB] max-sm:text-[13px] max-sm:text-white max-sm:shadow-[0_4px_10px_rgba(37,99,235,0.3)]">{tablePage}</span><span className="text-[#6B7280] max-sm:text-[13px] max-sm:font-medium max-sm:text-[#475569]">/ {tablePages}</span></span>
                <button type="button" aria-label="Next page" className={`${buttonCls} !p-1 sm:!p-2 max-sm:flex max-sm:h-10 max-sm:w-9 max-sm:items-center max-sm:justify-center max-sm:rounded-xl max-sm:border-[#D5DEEA] max-sm:bg-transparent`} disabled={busy || !report || tablePage >= tablePages} onClick={() => changeTablePage(tablePage + 1)}>
                  <svg aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>
            {loading ? <p role="status" className="p-6 text-center text-xs text-slate-500 sm:p-10 sm:text-sm">Calculating brokerage...</p> : !report ? <p className="p-6 text-center text-xs text-slate-500 sm:p-10 sm:text-sm">{error ? 'The report could not be loaded.' : 'Select a settlement week to calculate.'}</p> : <>
              {tab === 'logins' && renderColumnTable('logins', { label: 'Final Report', rows, rowKey: row => row.login, onRowClick: setDetailRow,
                footer: summary && Object.fromEntries(['charged_inr', 'our_brokerage_inr', 'balance_inr', 'rebate_inr'].map(key => [key, format(summary[key])])) })}
              {tab === 'exchanges' && renderColumnTable('exchanges', { label: 'Exchange Detail', rows: entries, rowKey: (entry, index) => `${entry.login}:${entry.exchange.exchange}:${index}` })}
              {tab === 'pivot' && renderColumnTable('pivot', { label: 'Exchange View', rows, rowKey: row => row.login })}
              {tab === 'pending' && <>
                {report.pending_truncated && <p role="alert" className="mx-2 mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800 sm:mx-3 sm:mb-3 sm:p-3 sm:text-sm">Only the first 1,000 issues are shown. Use Export in the header to download every matching pending issue.</p>}
                {renderColumnTable('pending', { label: 'Pending issues', rows: pending.slice((pendingPage - 1) * 250, pendingPage * 250), rowKey: (row, index) => `${row.login}:${row.exchange}:${row.issue}:${index}` })}
                {!pending.length && <p className="p-6 text-center text-xs text-slate-500 sm:p-8 sm:text-sm">No matching pending issues.</p>}
                <div className="border-t p-2 text-[10px] sm:p-3 sm:text-xs max-sm:border-[#D5DEEA] max-sm:px-4 max-sm:text-[11px] max-sm:text-[#64748B]">{pending.length} issues · page {pendingPage} of {pendingPages}</div>
              </>}
              {tab !== 'pending' && !rows.length && <p className="p-6 text-center text-xs text-slate-500 sm:p-8 sm:text-sm">No brokerage data matches this week and filters.</p>}
            </>}
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-[#64748B] sm:text-xs">Please verify all amounts before settlement or payment.</p>
      </main>
      {/* Bottom Navigation (mobile only); sticks to the bottom of the scrolling column */}
      <div className="sticky bottom-0 z-20 mt-auto sm:hidden">
        <MobileBottomNav onMore={() => setMobileSidebarOpen(true)} />
      </div>
    </div>
    <LoginGroupsModal
      isOpen={isLoginGroupsOpen}
      onClose={() => setIsLoginGroupsOpen(false)}
      onBack={() => setIsLoginGroupsOpen(false)}
      groups={groups.map(group => ({
        ...group,
        loginCount: group.range ? Number(group.range.to) - Number(group.range.from) + 1 : (group.loginIds?.length || 0),
      }))}
      activeGroupName={groupName}
      onSelectGroup={group => {
        setActiveGroupFilter('brokerage-calculator', group?.name || null)
        setIsLoginGroupsOpen(false)
      }}
      onRatesClick={group => { setIsLoginGroupsOpen(false); setRatesGroup(group.name) }}
      onCreateGroup={() => { setIsLoginGroupsOpen(false); setEditingGroup(null); setIsLoginGroupModalOpen(true) }}
      onEditGroup={group => { setIsLoginGroupsOpen(false); setEditingGroup(group); setIsLoginGroupModalOpen(true) }}
      onDeleteGroup={group => deleteGroup(group.name)}
    />
    <LoginGroupModal
      isOpen={isLoginGroupModalOpen}
      editGroup={editingGroup}
      onClose={() => { setIsLoginGroupModalOpen(false); setEditingGroup(null) }}
      onBack={() => { setIsLoginGroupModalOpen(false); setIsLoginGroupsOpen(true) }}
      onSave={() => { setIsLoginGroupModalOpen(false); setEditingGroup(null); setIsLoginGroupsOpen(true) }}
    />
    <GroupModal isOpen={showGroupModal} onClose={() => setShowGroupModal(false)} editGroup={editingGroup} />
    {columnPicker && (() => {
      const prefs = prefsFor(tab)
      const resetColumns = () => setColumnPrefs(current => ({ ...current, [tab]: undefined }))
      const chooser = <ColumnChooserList
        columns={chooserColumns.map(({ key, label }) => ({ key, label }))}
        visibleColumns={Object.fromEntries(chooserColumns.map(({ key }) => [key, !prefs.hidden.includes(key)]))}
        onToggle={key => updatePrefs(tab, current => ({ ...current, hidden: current.hidden.includes(key) ? current.hidden.filter(value => value !== key) : current.hidden.length < chooserColumns.length - 1 ? [...current.hidden, key] : current.hidden }))}
        columnOrder={prefs.order}
        onReorder={order => updatePrefs(tab, current => ({ ...current, order }))}
        onResetOrder={resetColumns}
        accent="blue"
        title={null}
        pinnedColumns={prefs.pinned}
        onPinToggle={key => updatePrefs(tab, current => ({ ...current, pinned: current.pinned.includes(key) ? current.pinned.filter(value => value !== key) : [...current.pinned, key] }))}
        reorderMode={columnPicker === 'sheet' ? 'touch' : 'drag'}
      />
      return columnPicker === 'sheet'
        ? <div className="fixed inset-0 z-[80] flex items-end bg-black/40" onClick={() => setColumnPicker(null)}>
          <style>{`
            .c2-col-chooser input[type="text"] { background: transparent !important; border-color: #D5DEEA !important; border-radius: 12px !important; height: 40px; font-size: 13px !important; }
            .c2-col-chooser input[type="checkbox"] { width: 16px !important; height: 16px !important; accent-color: #2563EB; }
            .c2-col-chooser .overscroll-contain > [data-col-key] { padding-top: 10px; padding-bottom: 10px; margin-left: 12px; margin-right: 12px; border-bottom: 1px solid rgba(213, 222, 234, 0.6); }
          `}</style>
          <div role="dialog" aria-label="Columns" className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.12)]" onClick={event => event.stopPropagation()}>
            <div className="flex shrink-0 justify-center pt-2.5"><span className="h-1 w-10 rounded-full bg-[#CBD5E1]" /></div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#D5DEEA] px-5 pb-3 pt-3">
              <div><h3 className="text-[18px] font-extrabold tracking-tight text-[#0F172A]">Columns</h3><p className="text-[12px] text-[#64748B]">Show, hide, pin & reorder columns</p></div>
              <button type="button" onClick={() => setColumnPicker(null)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#D5DEEA] text-[#0F172A]"><svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
            </div>
            <div className="c2-col-chooser flex min-h-0 flex-1 flex-col">{chooser}</div>
          </div>
        </div>
        : <div ref={columnPickerRef} role="dialog" aria-label="Show, hide and reorder columns" className="fixed z-[60] flex w-[288px] flex-col rounded-xl border border-[#E5E7EB] bg-white shadow-lg" style={columnPicker}>
          <div className="flex items-center justify-between border-b border-[#F3F4F6] px-3 py-2">
            <p className="text-xs font-semibold uppercase text-[#1F2937]">Show/Hide &amp; Reorder</p>
            <button type="button" onClick={resetColumns} className="rounded px-1.5 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50">Reset</button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{chooser}</div>
        </div>
    })()}
    {exportMenu && <div className={exportMenu === 'sheet' ? 'fixed inset-0 z-[80] flex items-end bg-black/40' : 'fixed inset-0 z-[60]'} onClick={() => setExportMenu(null)}>
      <div role="menu" aria-label="Export" onClick={event => event.stopPropagation()} style={exportMenu === 'sheet' ? undefined : exportMenu}
        className={exportMenu === 'sheet' ? 'w-full rounded-t-[28px] bg-white px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2.5 shadow-[0_-8px_30px_rgba(15,23,42,0.12)]' : 'fixed w-[264px] rounded-xl border border-[#E5E7EB] bg-white p-1.5 shadow-lg'}>
        {exportMenu === 'sheet' && <div className="mb-2 flex justify-center"><span className="h-1 w-10 rounded-full bg-[#CBD5E1]" /></div>}
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">Export all matching records</p>
        {[['logins', 'Final Report'], ['exchanges', 'Exchange Detail'], ['pending', 'Pending']].map(([view, label]) => <div key={view} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${exportView === view ? 'bg-blue-50/60' : ''}`}>
          <span className="min-w-0 flex-1 text-[13px] font-medium text-[#0F172A]">{label}</span>
          {['xlsx', 'csv'].map(fileFormat => <button key={fileFormat} type="button" role="menuitem" onClick={() => doExport(view, fileFormat)} className="h-7 rounded-md border border-[#E5E7EB] bg-white px-2.5 text-[11px] font-semibold text-[#374151] hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600">{fileFormat === 'xlsx' ? 'Excel' : 'CSV'}</button>)}
        </div>)}
      </div>
    </div>}
    {fixRow && (() => {
      const login = Number(fixRow.login)
      const loginGroups = groups.filter(group => group.range ? login >= Number(group.range.from) && login <= Number(group.range.to) : (group.loginIds || []).map(Number).includes(login))
      const option = (label, hint, onClick) => <button type="button" onClick={() => { setFixRow(null); onClick() }} className="flex w-full items-center gap-3 rounded-xl border border-[#E5E7EB] px-3 py-2.5 text-left hover:border-blue-200 hover:bg-blue-50">
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-[#0F172A]">{label}</span><span className="block text-[11px] text-[#64748B]">{hint}</span></span>
        <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[#94A3B8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 6 6 6-6 6" /></svg>
      </button>
      return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-3 max-sm:items-end max-sm:p-0" onClick={() => setFixRow(null)}>
        <section role="dialog" aria-modal="true" aria-labelledby="fix-title" onClick={event => event.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-2xl bg-white font-outfit shadow-xl max-sm:rounded-b-none max-sm:rounded-t-[28px]">
          <header className="border-b border-[#E5E7EB] px-5 py-3.5">
            <h2 id="fix-title" className="text-[16px] font-bold text-[#0F172A]">Set the {fixRow.exchange} rate</h2>
            <p className="mt-0.5 text-xs text-[#64748B]">{fixRow.login} · {ISSUE_LABELS[fixRow.issue] || fixRow.issue}. Choose where to set it.</p>
          </header>
          <div className="space-y-2 px-5 py-4 max-sm:pb-[calc(16px+env(safe-area-inset-bottom,0px))]">
            {option('This client only', `Set Brokerage for ${fixRow.login}`, () => openClientRates(fixRow))}
            {loginGroups.map(group => <Fragment key={group.name}>{option(`Group: ${group.name}`, 'Rates for every login in this group', () => setRatesGroup(group.name))}</Fragment>)}
            {option('All clients', 'Default Exchange Brokerage', () => setSettings({ client: false, selection: { exchange: fixRow.exchange } }))}
          </div>
        </section>
      </div>
    })()}
    {detailRow && <LoginDetail row={detailRow} onClose={() => setDetailRow(null)} onClientRates={() => { openClientRates(detailRow); setDetailRow(null) }} />}
    {importOpen && <ImportRates onClose={() => setImportOpen(false)} onSaved={message => { setToast(message); refresh() }} />}
    {ratesGroup && <GroupRates key={ratesGroup} groupName={ratesGroup} onClose={() => setRatesGroup(null)} onSaved={message => { setToast(message); refresh() }} />}
    {settings && <RateSettings {...settings} onClose={() => setSettings(null)} onSaved={message => { setToast(message); refresh() }} />}
    {editingUsd && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-3">
      <form role="dialog" aria-modal="true" aria-labelledby="usd-rate-title" aria-describedby="usd-rate-help" className="w-full max-w-sm overflow-hidden rounded-xl bg-white font-outfit text-sm text-[#374151] shadow-xl"
        onSubmit={event => { event.preventDefault(); if (!busy) saveUsd() }}
        onKeyDown={event => {
          if (event.key === 'Escape' && !savingUsd) { event.preventDefault(); setEditingUsd(false) }
          if (event.key === 'Tab') {
            const controls = Array.from(event.currentTarget.querySelectorAll('input:not(:disabled), button:not(:disabled)'))
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}>
        <div className="border-b border-[#E5E7EB] px-6 py-4">
          <h2 id="usd-rate-title" className="text-lg font-semibold text-[#1A1A1A]">Edit USD-INR rate</h2>
          <p className="mt-1 text-xs text-[#6B7280]">{weeks.find(week => week.id === query.week_id)?.name || `Week ${query.week_id}`}</p>
        </div>
        <div className="space-y-3 p-6">
          <label className="grid gap-1.5 text-xs font-medium">1 USD in INR
            <input ref={usdInput} aria-label="USD-INR rate" aria-invalid={!!usdError} aria-describedby={usdError ? 'usd-rate-help usd-rate-error' : 'usd-rate-help'} className={`${rateInputCls} tabular-nums`} value={usdDraft} disabled={savingUsd} inputMode="decimal" onChange={event => setUsdDraft(event.target.value)} />
          </label>
          <p id="usd-rate-help" className="text-xs text-[#6B7280]">Enter a positive rate. Leave blank to remove this week's saved rate; a previous week's rate may then apply.</p>
          {usdError && <p id="usd-rate-error" role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{usdError}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-[#E5E7EB] bg-[#F9FAFB] px-6 py-4">
          <button type="button" className={`${rateButtonCls} min-w-28`} disabled={savingUsd} onClick={() => setEditingUsd(false)}>Cancel</button>
          <button type="submit" className={`${ratePrimaryCls} min-w-28`} disabled={busy}>{savingUsd ? 'Saving...' : 'Save USD-INR'}</button>
        </div>
      </form>
    </div>}
    {toast && <div role="status" className="pointer-events-none fixed inset-x-3 bottom-5 z-[100] mx-auto w-fit rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">{toast}</div>}
  </div>
}
