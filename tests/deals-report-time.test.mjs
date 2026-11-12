import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { apiTimeSecond, formatTime as apiFormatTime, toApiEpoch } from '../src/utils/dateFormatter.js'
import { matchesColumnFilter, columnFiltersForRequest, rowFieldValue, sortRowsByColumn } from '../src/utils/columnFilters.js'

const source = readFileSync(new URL('../src/pages/DealsReportPage.jsx', import.meta.url), 'utf8')
const section = (start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first)
  assert.ok(first >= 0 && last > first, start)
  return source.slice(first, last)
}
const { reportTimeValue, reportRawValue, reportSortValue, filterReportRows, fetchReportDeals } = new Function(
  'apiTimeSecond', 'matchesColumnFilter', 'rowFieldValue',
  `${section('const DEAL_ACTIONS', 'const COLUMNS')}; return { reportTimeValue, reportRawValue, reportSortValue, filterReportRows, fetchReportDeals }`,
)(apiTimeSecond, matchesColumnFilter, rowFieldValue)
const filterReportTime = (rows, filter) => filterReportRows(rows, filter ? { time_custom: filter } : {})
const epoch = Date.parse('2026-11-12T17:49:30Z') / 1000
const row = (deal, time = epoch) => ({ deal, login: 100, time })
const equal = { type: 'equal', value1: epoch }
const query = { from: epoch - 86400, to: epoch + 86400, page: 3, limit: 500, extra: {} }
const fetchAll = (api, q = query, signal = new AbortController().signal, current = () => true) => fetchReportDeals(api, q, true, signal, current)
const buildExtra = (options = {}) => new Function(`
  const {sortBy='time', sortOrder='desc', activeGroup=null, search='', moduleFilter='both', logins=[]} = arguments[0];
  const getGroupLogins = () => logins;
  ${section('  const buildExtraBody', '  // Key results')}
  return buildExtraBody();
`)(options)

test('actual report getter/predicate matches displayed 12/11/2026 17:49:30, not offset instants', () => {
  for (const time of [epoch, String(epoch), epoch * 1000 + 999, String(epoch * 1000 + 700),
    '2026.11.12 17:49:30', '12/11/2026 17:49:30', '2026-11-12T17:49:30+05:30', '2026-11-12T17:49:30Z']) {
    for (const field of ['time', 'timeStr', 'dealTime', 'deal_time', 'timestamp', 'timestampStr', 'date', 'Time']) {
      const item = { deal: 1, [field]: time }
      assert.equal(apiFormatTime(reportTimeValue(item)), '12/11/2026 17:49:30')
      assert.equal(reportSortValue(item, 'time'), epoch)
      assert.deepEqual(filterReportTime([item], equal), [item])
    }
  }
  assert.match(source, /get: d => formatTime\(reportTimeValue\(d\)\)/)
  assert.equal(filterReportTime([row(1, toApiEpoch(epoch))], equal).length, 0)
})

test('all Time operators are second-level and Between is inclusive; invalid dates never match', () => {
  const rows = [row(1, epoch - 1), row(2, epoch * 1000 + 999), row(3, epoch + 1)]
  for (const [type, ids] of Object.entries({ equal: [2], notEqual: [1, 3], lessThanOrEqual: [1, 2],
    greaterThanOrEqual: [2, 3], between: [2, 3] })) {
    const filter = { type, value1: epoch, value2: epoch + 1 }
    assert.deepEqual(filterReportTime(rows, filter).map(r => r.deal), ids, type)
    assert.deepEqual(filterReportTime([{}, row(4, 'bad'), row(5, '2026-02-31 17:49:30'), row(6, 0)], filter), [])
  }
})

test('actual Apply/Reset do not rewrite overall range; request excludes ALL columns, preserves controls', () => {
  const handlers = section('  const applyColumnFilter =', '  const hasColumnFilters =')
  assert.doesNotMatch(handlers, /setRange|toApiEpoch/)
  assert.doesNotMatch(source, /columnRequestFilters|filters.push\(\.\.\.column/)
  const extra = buildExtra({ activeGroup: { name: 'A' }, logins: [100, 101], search: '100', moduleFilter: 'deal',
    columnRequestFilters: [{ field: 'symbol', operator: 'equal', value: 'EURUSD' }] })
  assert.deepEqual(extra, { sortBy: 'deal_time', sortOrder: 'desc', filters: [
    { field: 'login', operator: 'equal', value: 100 }, { field: 'action', operator: 'in', value: ['BUY', 'SELL'] },
  ] })
  assert.equal(buildExtra({ search: 'EUR' }).search, 'EUR')
  assert.deepEqual(buildExtra({ moduleFilter: 'money' }).filters.map(f => f.value), ['BUY', 'SELL'])
  assert.deepEqual(buildExtra({ activeGroup: { name: 'A' }, logins: [101], search: '100' }).filters,
    [{ field: 'login', operator: 'in', value: [] }])
})

test('all capped candidate pages collected before local sort/count/page; later matches retained', async () => {
  const rows = Array.from({ length: 44 }, (_, i) => row(i + 1, i < 20 ? epoch - 1 : epoch))
  const calls = []
  const result = await fetchAll(async (from, to, limit, page, extra) => {
    calls.push({ from, to, limit, page, extra })
    return { data: { deals: rows.slice((page - 1) * 7, page * 7), pagination: { total: 44 } } }
  })
  assert.equal(result.rows.length, 44)
  assert.deepEqual(calls.map(c => c.page), [1, 2, 3, 4, 5, 6, 7])
  for (const call of calls) { assert.equal(call.from, query.from); assert.equal(call.to, query.to); assert.deepEqual(call.extra, {}) }
  const matches = sortRowsByColumn(filterReportTime(result.rows, equal), reportSortValue, 'deal', 'desc')
  assert.equal(matches.length, 24)
  assert.deepEqual(matches.slice(15, 30).map(r => r.deal), [29, 28, 27, 26, 25, 24, 23, 22, 21])
})

test('unknown totals scan until empty; incomplete/repeated/malformed pages reject', async () => {
  const calls = []
  const result = await fetchAll(async (_f, _t, _l, page) => {
    calls.push(page)
    return { items: page < 4 ? [row(page)] : [] }
  })
  assert.equal(result.rows.length, 3)
  assert.deepEqual(calls, [1, 2, 3, 4])
  await assert.rejects(fetchAll(async () => ({ deals: [row(1)], total: 5 })), /did not advance/)
  await assert.rejects(fetchAll(async () => ({ deals: [], total: 5 })), /incomplete/)
  await assert.rejects(fetchAll(async () => ({ deals: 'bad' })), /Invalid deals/)
})

test('normal mode requests just selected server page and preserves server total', async () => {
  let calls = 0
  const result = await fetchReportDeals(async (_f, _t, limit, page) => {
    calls++; assert.equal(page, 3); assert.equal(limit, 15)
    return { deals: [row(3)], total: 100 }
  }, { ...query, limit: 15 }, false, new AbortController().signal, () => true)
  assert.equal(calls, 1)
  assert.equal(result.total, 100)
})

test('stale/aborted scans stop before additional pages or publishing results', async () => {
  for (const abort of [true, false]) {
    const controller = new AbortController()
    let current = true, calls = 0
    const result = await fetchAll(async () => {
      calls++
      if (abort) controller.abort(); else current = false
      return { deals: [row(1)], total: 5 }
    }, query, controller.signal, () => current)
    assert.equal(result, null); assert.equal(calls, 1)
  }
  assert.match(source, /result\?\.key === queryKey/)
  assert.match(source, /return \(\) => controller.abort\(\)/)
  assert.doesNotMatch(source, /setInterval/)
})

test('actual export uses same complete collector, predicate and sort with stale guards', () => {
  const exportCode = section('  const handleExport =', '  const renderCell =')
  assert.match(exportCode, /fetchReportDeals\(brokerAPI.getAllDeals/)
  assert.match(exportCode, /filterReportRows\(next.rows, columnFilters\)/)
  assert.match(exportCode, /sortRowsByColumn\(filtered, reportSortValue, sortBy, sortOrder\)/)
  assert.match(exportCode, /currentQueryRef.current === queryKey/)
})

test('Name Equal is whole-name, trimmed, case-insensitive text; all text conditions work', () => {
  const rows = ['DEMO 12', ' demo 12 ', 'DEMO120', 'DEMO 123', 'x DEMO 12', 'Other'].map((name, i) => ({ deal: i + 1, name }))
  const expected = { equal: [1, 2], notEqual: [3, 4, 5, 6], contains: [1, 2, 4, 5],
    startsWith: [1, 2, 4], endsWith: [1, 2, 5], doesNotContain: [3, 6], notContains: [3, 6] }
  for (const [type, ids] of Object.entries(expected)) {
    assert.deepEqual(filterReportRows(rows, { name_custom: { type, value1: ' DEMO 12 ' } }).map(r => r.deal), ids, type)
  }
  assert.equal(filterReportRows([{ name: '0012' }], { name_custom: { type: 'equal', value1: '12' } }).length, 0)
  for (const type of ['doesNotContain', 'notContains']) {
    assert.equal(matchesColumnFilter('Other', { type, value1: 'demo' }), true)
    assert.equal(matchesColumnFilter('DEMO 12', { type, value1: 'demo' }), false)
    assert.deepEqual(columnFiltersForRequest({ name_custom: { type, value1: 'demo' } }),
      [{ field: 'name', operator: 'not_contains', value: 'demo' }])
  }
})

test('raw alias getters, derived action and numeric fields agree with display/export', () => {
  const item = { ID: 123, AccountLogin: 456, Full_Name: ' Demo 12 ', Type: 0, Instrument: '0012',
    Lots: '1.23456', DealPrice: '0.98765', Pnl: '-1234.567', Commission: '-0.25', Swap: '-12.345',
    OrderId: 55, PositionId: 66, Comments: 'Test' }
  for (const [key, value] of Object.entries({ deal: 123, login: 456, name: ' Demo 12 ', action: 'Buy', symbol: '0012',
    volume: '1.23456', price: '0.98765', profit: '-1234.567', commission: '-0.25', storage: '-12.345',
    order: 55, position: 66, comment: 'Test' })) assert.equal(reportRawValue(item, key), value, key)
  const columns = new Function('reportRawValue', 'formatTime', 'reportTimeValue',
    `${section('const COLUMNS =', '// Mobile grid')}; return COLUMNS`)(reportRawValue, String, reportTimeValue)
  for (const column of columns.filter(c => c.key !== 'time')) {
    assert.equal(column.get(item), column.numeric ? Number(reportRawValue(item, column.key)) : reportRawValue(item, column.key), column.key)
  }
  const filters = { action_custom: { type: 'equal', value1: 'BUY' }, storage_custom: { type: 'lessThan', value1: -12 },
    profit_custom: { type: 'between', value1: -1235, value2: -1234.56 }, symbol_custom: { type: 'equal', value1: '0012' } }
  assert.deepEqual(filterReportRows([item], filters), [item])
  assert.equal(filterReportRows([item], { ...filters, symbol_custom: { type: 'equal', value1: '12' } }).length, 0)
  assert.equal(reportRawValue({ storage: 0, swap: 10 }, 'storage'), 0)
  assert.equal(reportRawValue({ order: 0, position: -1 }, 'order'), '')
  assert.equal(filterReportRows([{}], { profit_custom: { type: 'equal', value1: 0 } }).length, 0)
})

test('all numeric operators use raw precision and reject absent/invalid numbers', () => {
  const rows = [-1.23456, 0, 1.23456].map((profit, i) => ({ deal: i + 1, profit }))
  for (const [type, ids] of Object.entries({ equal: [2], notEqual: [1, 3], lessThan: [1], lessThanOrEqual: [1, 2],
    greaterThan: [3], greaterThanOrEqual: [2, 3], between: [2, 3] })) {
    const filters = { profit_custom: { type, value1: 0, value2: 1.23456 } }
    assert.deepEqual(filterReportRows(rows, filters).map(r => r.deal), ids, type)
    assert.deepEqual(filterReportRows([{}, { profit: 'bad' }], filters), [])
  }
})

test('Name-only and cumulative columns validate later-page candidates before count/sort/page; reset stays remote', async () => {
  const rows = Array.from({ length: 44 }, (_, i) => ({ ...row(i + 1, i < 30 ? epoch : epoch + 1),
    name: i < 20 ? 'DEMO120' : ' demo 12 ', action: i % 2, swap: -i }))
  const calls = []
  const result = await fetchAll(async (_f, _t, _l, page, extra) => {
    calls.push({ page, extra })
    return { deals: rows.slice((page - 1) * 7, page * 7), total: rows.length }
  })
  const filters = { name_custom: { type: 'equal', value1: 'DEMO 12' } }
  assert.equal(filterReportRows(result.rows, filters).length, 24)
  const combined = { ...filters, time_custom: equal, action_custom: { type: 'equal', value1: 'Buy' },
    storage_custom: { type: 'lessThan', value1: -20 } }
  assert.deepEqual(sortRowsByColumn(filterReportRows(result.rows, combined), reportSortValue, 'deal', 'desc').map(r => r.deal), [29, 27, 25, 23])
  assert.equal(calls.length, 7)
  assert.match(source, /page: hasColumnFilters \? 1 : page, limit: hasColumnFilters \? EXPORT_CHUNK : effectivePageSize/)
  assert.match(source, /columnFilters, hasColumnFilters, reloadKey/)
  assert.match(source, /query.hasColumnFilters \? rows.length : next.total/)
})