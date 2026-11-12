import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { columnFiltersForRequest, matchesColumnFilter, rowFieldValue, sortRowsByColumn } from '../src/utils/columnFilters.js'
import { applyCumulativeFilters } from '../src/utils/mobileFilters.js'
import { apiTimeSecond, formatTime } from '../src/utils/dateFormatter.js'

// Exercise the real component helpers without a JSX transform or DOM dependency.
const source = readFileSync(new URL('../src/components/PendingOrdersModule.jsx', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('const orderFilterKind'), source.indexOf('const formatNum'))
const { orderFilterRows, orderRequestFilters, orderSortValue, fetchOrderResults } = new Function(
  'columnFiltersForRequest', 'matchesColumnFilter', 'rowFieldValue', 'apiTimeSecond',
  `${helpers}; return { orderFilterRows, orderRequestFilters, orderSortValue, fetchOrderResults }`,
)(columnFiltersForRequest, matchesColumnFilter, rowFieldValue, apiTimeSecond)

const displayCode = source.slice(source.indexOf('  const useServerPage ='), source.indexOf('  // Face cards data'))
const display = new Function('hasCurrentServerOrders', 'hasColumnFilters', 'serverOrders', 'filteredOrders', 'currentPage', 'itemsPerPage', 'serverTotalOrders',
  `${displayCode}; return { rows: displayOrders, totalPages }`)
const epoch = Date.parse('2026-11-12T04:08:24Z') / 1000
const equal = { timeSetup_custom: { type: 'equal', value1: epoch } }
const order = (id, timeSetup = epoch) => ({ order: id, login: 100, timeSetup, symbol: 'EURUSD' })
const fetchResults = (api, filters = equal, params = {}, signal = new AbortController().signal, isCurrent = () => true) => (
  fetchOrderResults(api, { page: 1, limit: 15, ...params }, filters, signal, isCurrent)
)

test('timeSetup equal matches exact seconds, epoch milliseconds and API date aliases only', () => {
  const rows = [order(1, epoch - 1), order(2), order(3, epoch + 1), order(4, epoch * 1000),
    { order: 5, timeSetupStr: '2026.11.12 04:08:24' }]
  assert.deepEqual(orderFilterRows(rows, equal).map(row => row.order), [2, 4, 5])
  assert.deepEqual(orderRequestFilters(equal), [{ field: 'timeSetup', operator: 'equal', value: String(epoch) }])
})

test('between includes both second-precise bounds', () => {
  const filters = { timeSetup_custom: { type: 'between', value1: epoch, value2: epoch + 2 } }
  assert.deepEqual(orderFilterRows(Array.from({ length: 5 }, (_, i) => order(i, epoch + i - 1)), filters).map(row => row.order), [1, 2, 3])
  assert.deepEqual(orderRequestFilters(filters).map(filter => filter.operator), ['greater_than_or_equal', 'less_than_or_equal'])
})

test('server ignoring filters: collect cross-page matches, sort before pagination and derive match count', async () => {
  const rows = Array.from({ length: 46 }, (_, i) => order(i + 1, i % 2 ? epoch : epoch + 1))
  const calls = []
  const result = await fetchResults(async (params, options) => {
    calls.push(params.page)
    assert.ok(options.signal)
    return { data: { orders: rows.slice((params.page - 1) * 15, params.page * 15), total: rows.length } }
  }, equal, { page: 2, filters: orderRequestFilters(equal) })
  assert.deepEqual(calls, [1, 2, 3, 4])
  const matches = sortRowsByColumn(orderFilterRows(result.rows, equal), orderSortValue, 'order', 'desc')
  assert.equal(matches.length, 23)
  const page = display(true, true, result.rows, matches, 2, 15, 46)
  assert.equal(page.totalPages, 2)
  assert.deepEqual(page.rows.map(row => row.order), [16, 14, 12, 10, 8, 6, 4, 2])
})

test('no column filters preserve requested server page and reported pagination', async () => {
  const result = await fetchResults(async params => {
    assert.equal(params.page, 3)
    return { data: { orders: [order(31)], total: 80, totals: { uniqueLogins: 1 } } }
  }, {}, { page: 3 })
  assert.equal(result.total, 80)
  assert.equal(result.totals.uniqueLogins, 1)
  assert.deepEqual(display(true, false, result.rows, [], 3, 15, result.total), { rows: [order(31)], totalPages: 6 })
})

test('collected server matches retain cumulative groups, customize filters, search and global sort before slicing', () => {
  const pipelineCode = source.slice(source.indexOf('  const ibFilteredOrders ='), source.indexOf('  const handleSort ='))
  const pipeline = new Function('useMemo', 'orderFilterRows', 'applyCumulativeFilters', 'sortRowsByColumn', 'orderSortValue',
    'serverOrders', 'orders', 'columnFilters', 'filters', 'filterByActiveGroup', 'searchInput',
    `const hasColumnFilters = true, hasCurrentServerOrders = true, activeGroupFilters = {}, sortColumn = 'order', sortDirection = 'desc';
    ${pipelineCode}; return filteredOrders`)
  const serverRows = Array.from({ length: 42 }, (_, i) => ({
    ...order(i + 1), login: i % 2 ? 200 : 100, profit: i === 0 ? 0 : 1,
    symbol: i === 2 ? 'GBPUSD' : 'EURUSD',
  }))
  const matches = pipeline(fn => fn(), orderFilterRows, applyCumulativeFilters, sortRowsByColumn, orderSortValue,
    serverRows, [order(999)], { filters: equal }, { hasFloating: true },
    rows => rows.filter(row => row.login === 100), 'eur')
  assert.equal(matches.length, 19)
  assert.equal(matches.some(row => row.order === 999), false)
  const page = display(true, true, serverRows, matches, 2, 15, 42)
  assert.equal(page.totalPages, 2)
  assert.deepEqual(page.rows.map(row => row.order), [11, 9, 7, 5])
})

test('filter apply cannot display a stale unfiltered server page, even before new fetch completes', () => {
  const serverOrders = [order(1, epoch - 1), order(2), order(3, epoch + 1)]
  const filteredOrders = orderFilterRows(serverOrders, equal)
  assert.deepEqual(display(false, true, serverOrders, filteredOrders, 1, 15, 100), { rows: [order(2)], totalPages: 1 })
  const guard = source.match(/const hasCurrentServerOrders = ([^\n]+)/)[1]
  const isCurrent = new Function('hasFetchedOrders', 'serverResultKey', 'orderResultKey', `return ${guard}`)
  assert.equal(isCurrent(true, 'old query', 'new filters'), false)
})

test('missing totals scan through short capped pages to empty; server-provided short pages still follow total', async () => {
  let pages = 0
  const result = await fetchResults(async () => ({ orders: ++pages === 1 ? [order(1), order(2)] : pages === 2 ? [order(3)] : [] }), equal, { limit: 15 })
  assert.equal(pages, 3)
  assert.equal(result.rows.length, 3)
  pages = 0
  const capped = await fetchResults(async () => ({ orders: [order(++pages)], total: 3 }))
  assert.equal(capped.rows.length, 3)
})

test('malformed or non-advancing responses fail closed rather than publish incomplete results', async () => {
  await assert.rejects(fetchResults(async () => ({ data: { orders: {} } })), /Invalid pending orders/)
  await assert.rejects(fetchResults(async () => ({ orders: [null] })), /Invalid pending orders/)
  await assert.rejects(fetchResults(async () => ({ orders: [order(1)], total: 30 })), /did not advance/)
})

test('cancelled or superseded collection never publishes or requests another page', async () => {
  for (const abort of [true, false]) {
    const controller = new AbortController()
    let current = true
    let calls = 0
    const result = await fetchResults(async () => {
      calls++
      if (abort) controller.abort()
      else current = false
      return { orders: [order(1)], total: 30 }
    }, equal, {}, controller.signal, () => current)
    assert.equal(result, null)
    assert.equal(calls, 1)
  }
})

test('rejecting backend: Time conditions never narrow candidates; period/group/search remain on every page', async () => {
  const rows = [order(1, epoch - 1), order(2), order(3, epoch * 1000 + 999), order(4, epoch + 1)]
  const group = { field: 'login', operator: 'in', value: [100] }
  for (const [type, ids] of [['equal', [2, 3]], ['notEqual', [1, 4]], ['lessThanOrEqual', [1, 2, 3]],
    ['greaterThanOrEqual', [2, 3, 4]], ['between', [2, 3, 4]]]) {
    const filters = { timeSetup_custom: { type, value1: epoch, value2: epoch + 1 } }
    let calls = 0
    const params = { limit: 2, dateFrom: epoch - 100, dateTo: epoch + 100, search: 'EUR',
      filters: [...orderRequestFilters(filters), group] }
    const result = await fetchResults(async query => {
      calls++
      assert.deepEqual(query.filters, [group], 'Backend rejects unsupported Time fields')
      for (const key of ['dateFrom', 'dateTo', 'search']) assert.equal(query[key], params[key])
      return { orders: rows.slice((query.page - 1) * 2, query.page * 2), total: rows.length }
    }, filters, params)
    assert.equal(calls, 2)
    assert.deepEqual(result.rows.map(row => row.order), ids, type)
  }
})

test('Time predicate matches displayed seconds across API formats and fallback fields', () => {
  const values = [epoch, String(epoch), epoch + 0.999, String(epoch + 0.999), epoch * 1000 + 999,
    String(epoch * 1000 + 999), '2026.11.12 04:08:24', '12/11/2026 04:08:24',
    '2026-11-12T04:08:24.999+05:30']
  for (const value of values) {
    assert.equal(formatTime(value), '12/11/2026 04:08:24')
    assert.deepEqual(orderFilterRows([order(1, value)], equal).map(row => row.order), [1], String(value))
  }
  assert.deepEqual(orderFilterRows([{ order: 2, timeSetup: 0, timeUpdate: epoch }], equal).map(row => row.order), [2])
  for (const type of ['equal', 'notEqual', 'lessThanOrEqual', 'greaterThanOrEqual', 'between']) {
    assert.deepEqual(orderFilterRows([order(1, 'invalid'), order(2, '2026-02-31 04:08:24'), { order: 3 }],
      { timeSetup_custom: { type, value1: epoch, value2: epoch + 1 } }), [])
  }
})