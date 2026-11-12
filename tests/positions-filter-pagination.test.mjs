import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { columnFiltersForRequest, matchesColumnFilter, matchesColumnFilters, sortRowsByColumn } from '../src/utils/columnFilters.js'
import { formatTime as apiFormatTime, apiTimeSecond } from '../src/utils/dateFormatter.js'
import { applyCumulativeFilters, applySearchFilter } from '../src/utils/mobileFilters.js'

// Execute the component's real helpers and render-boundary code, not copies.
const source = readFileSync(new URL('../src/components/PositionModule.jsx', import.meta.url), 'utf8')
const extract = (start, end) => {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first)
  assert.ok(first >= 0 && last > first, `Source section not found: ${start}`)
  return source.slice(first, last)
}
const helpers = extract('const POSITION_TEXT_COLUMNS', 'const formatNum')
const { positionRawValue, positionFilterRows, positionRequestFilters, positionTimeDisplay, fetchPositionResults } = new Function(
  'columnFiltersForRequest', 'matchesColumnFilter', 'apiFormatTime', 'apiTimeSecond',
  `${helpers}; return { positionRawValue, positionFilterRows, positionRequestFilters, positionTimeDisplay, fetchPositionResults }`,
)(columnFiltersForRequest, matchesColumnFilter, apiFormatTime, apiTimeSecond)
const displayCode = extract('  // Only unfiltered queries display', '  // Pagination calculations for Client NET')
const display = new Function('hasCurrentServerPositions', 'hasRegularColumnFilters', 'serverPositions',
  'filteredPositions', 'currentPage', 'itemsPerPage', 'serverPositionsTotal', 'positionColumns', 'positionFilterRows', 'positionRawValue',
  `${displayCode}; return { rows: mobileRegularDisplayedPositions, totalPages: mobileRegularTotalPages }`)
const epoch = Date.parse('2026-11-06T22:54:59Z') / 1000
const wrongEpoch = Date.parse('2026-11-10T07:31:13Z') / 1000
const equal = { updated_custom: { type: 'equal', value1: epoch } }
const row = (position, timeUpdate = epoch) => ({ position, login: 100, symbol: 'EURUSD', timeUpdate })
const filtered = (rows, filters = equal) => positionFilterRows(rows, filters, positionRawValue)
const render = (rows, { current = true, filters = equal, candidates = rows, page = 1, total = 75 } = {}) => (
  display(current, Object.keys(filters).length > 0, rows, candidates, page, 15, total,
    { filters }, positionFilterRows, positionRawValue)
)
const fetchResults = (api, filters = equal, params = {}, signal = new AbortController().signal, isCurrent = () => true) => (
  fetchPositionResults(api, { page: 1, limit: 15, ...params }, filters, signal, isCurrent)
)

test('screenshot exact second excludes 10/11/2026 07:31:13 and adjacent seconds', () => {
  const rows = [row(1, epoch - 1), row(2), row(3, epoch + 1), row(4, wrongEpoch), row(5, epoch * 1000)]
  assert.equal(apiFormatTime(epoch), '06/11/2026 22:54:59')
  assert.equal(apiFormatTime(wrongEpoch), '10/11/2026 07:31:13')
  assert.deepEqual(filtered(rows).map(r => r.position), [2, 5])
  assert.deepEqual(positionRequestFilters(equal), [{ field: 'timeUpdate', operator: 'equal', value: String(epoch) }])
})

test('predicate agrees with displayed wall clock for all supported Time string formats', () => {
  const values = ['2026.11.06 22:54:59', '2026/11/06 22:54:59', '06/11/2026 22:54:59',
    '06.11.2026 22:54:59', '2026-11-06T22:54:59Z', '2026-11-06T22:54:59+05:30', epoch * 1000 + 999]
  for (const value of values) {
    assert.equal(apiFormatTime(value), '06/11/2026 22:54:59')
    assert.equal(positionRawValue(row(1, value), 'updated'), epoch, String(value))
    assert.equal(filtered([row(1, value)]).length, 1, String(value))
  }
})

test('Time fallback precedence is update, create, update string, create string', () => {
  const rows = [
    { position: 1, timeUpdate: wrongEpoch, timeCreate: epoch },
    { position: 2, timeCreate: epoch, timeUpdateStr: '2026.11.10 07:31:13' },
    { position: 3, timeUpdate: 0, timeUpdateStr: '2026.11.06 22:54:59' },
    { position: 4, timeCreateStr: '06/11/2026 22:54:59' },
  ]
  assert.deepEqual(filtered(rows).map(r => r.position), [2, 3, 4])
  for (const item of rows) {
    const raw = item.timeUpdate || item.timeCreate || item.timeUpdateStr || item.timeCreateStr
    assert.equal(apiFormatTime(positionRawValue(item, 'updated')), apiFormatTime(raw))
  }
})

test('rendered Time cell uses the same getter as the predicate, not a separate create/update preference', () => {
  const cellCode = extract("      case 'updated':", "      case 'firstName':")
  assert.match(cellCode, /const formattedTime = positionTimeDisplay\(pos\)/)
  const item = { ...row(1, wrongEpoch), timeCreate: epoch }
  assert.equal(positionTimeDisplay(item), '10/11/2026 07:31:13')
  assert.equal(filtered([item]).length, 0)
})

test('real column hook commits updated_custom, leaves active filters unchanged while menu is open, and clears the same key', () => {
  const hookSource = readFileSync(new URL('../src/hooks/useColumnFilters.js', import.meta.url), 'utf8')
  const hookBody = hookSource.slice(hookSource.indexOf('export default function')).replace('export default ', '')
  const state = []
  let index = 0
  const useState = initial => {
    const slot = index++
    if (!(slot in state)) state[slot] = initial
    return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next }]
  }
  const hook = new Function('useState', 'useCallback', 'useMemo', 'columnFiltersForRequest', 'matchesColumnFilters', 'sortRowsByColumn',
    `${hookBody}; return useColumnFilters`)(useState, fn => fn, fn => fn(), columnFiltersForRequest, matchesColumnFilters, sortRowsByColumn)
  const rerender = () => { index = 0; return hook() }
  let columns = rerender()
  columns.openMenu('updated')
  columns = rerender()
  assert.deepEqual(columns.filters, {})
  columns.setFilter('updated', equal.updated_custom)
  columns = rerender()
  assert.deepEqual(columns.filters, equal)
  assert.equal(columns.openColumn, null)
  columns.openMenu('updated')
  columns = rerender()
  assert.deepEqual(columns.filters, equal)
  assert.deepEqual(positionRequestFilters(columns.filters), [{ field: 'timeUpdate', operator: 'equal', value: String(epoch) }])
  columns.clearFilter('updated')
  assert.deepEqual(rerender().filters, {})
})

test('missing/invalid Time fails closed even for notEqual and lessThan', () => {
  const rows = [{ position: 1 }, row(2, 'invalid'), row(3, '2026-02-31 22:54:59')]
  for (const type of ['equal', 'notEqual', 'lessThan', 'between']) {
    assert.deepEqual(filtered(rows, { updated_custom: { type, value1: epoch, value2: epoch + 1 } }), [])
  }
})

test('raw number/action aliases stay unformatted and text operators normalize', () => {
  const item = { ...row(1), action: 0, volume: 12345, profit: 12345, storage: 500, commission: 200, symbol: 'EURUSDc', priceSL: 1.25, priceTP: 2.5 }
  for (const [key, expected] of Object.entries({ netType: 'Buy', netVolume: 12345, totalProfit: 123.45, storage: 5, commission: 2, sl: 1.25, tp: 2.5 })) {
    assert.equal(positionRawValue(item, key), expected)
  }
  assert.equal(filtered([item], { symbol_custom: { type: 'doesNotContain', value1: 'GBP' } }).length, 1)
})

test('between bounds are inclusive to the second', () => {
  const filters = { updated_custom: { type: 'between', value1: epoch, value2: epoch + 2 } }
  assert.deepEqual(filtered(Array.from({ length: 5 }, (_, i) => row(i, epoch + i - 1)), filters).map(r => r.position), [1, 2, 3])
  assert.deepEqual(positionRequestFilters(filters).map(f => f.operator), ['greater_than_or_equal', 'less_than_or_equal'])
})

test('server ignoring conditions: collect across pages, globally sort, count only matching rows', async () => {
  const rows = Array.from({ length: 61 }, (_, i) => row(i + 1, i % 2 ? epoch : wrongEpoch))
  const calls = []
  const result = await fetchResults(async (params, options) => {
    calls.push(params.page)
    assert.ok(options.signal)
    assert.equal(params.filters, undefined, 'Candidate scan must not send Time conditions')
    return { data: { positions: rows.slice((params.page - 1) * 15, params.page * 15), total: 61, totals: { profit: 999 } } }
  }, equal, { page: 4, filters: positionRequestFilters(equal) })
  assert.deepEqual(calls, [1, 2, 3, 4, 5])
  assert.equal(result.total, null)
  assert.equal(result.totals, null)
  assert.equal(result.rows.length, 30)
  const sorted = sortRowsByColumn(result.rows, positionRawValue, 'position', 'desc')
  const page = render(result.rows, { candidates: sorted, page: 2 })
  assert.equal(page.totalPages, 2)
  assert.deepEqual(page.rows.map(r => r.position), Array.from({ length: 15 }, (_, i) => 30 - i * 2))
})

test('last render boundary rejects mismatches before slicing AND counting', () => {
  const candidates = Array.from({ length: 31 }, (_, i) => row(i + 1, i < 16 ? epoch : wrongEpoch))
  const result = render(candidates, { page: 2 })
  assert.equal(result.totalPages, 2)
  assert.deepEqual(result.rows.map(r => r.position), [16])
  assert.deepEqual(render(candidates, { page: 8 }), result)
})

test('stale result keys never render old candidates or server pagination', () => {
  const guard = source.match(/const hasCurrentServerPositions = ([^\n]+)/)[1]
  const isCurrent = new Function('hasFetchedServerPositions', 'serverPositionsResultKey', 'regularResultKey', `return ${guard}`)
  assert.equal(isCurrent(true, 'old query', 'new filters'), false)
  assert.equal(isCurrent(false, 'same', 'same'), false)
  assert.equal(isCurrent(true, 'same', 'same'), true)
  assert.deepEqual(render([row(1), row(2, wrongEpoch)], { current: false }), { rows: [], totalPages: 1 })
  const keyCode = extract('  const regularResultKey =', '  const hasFetchedServerPositionsRef')
  const key = new Function('positionColumns', 'currentPage', 'hasRegularColumnFilters', `
    const debouncedSearch = '', filters = {}, activeGroupFilters = {}, groups = [], sortColumn = null,
      sortDirection = 'asc', displayMode = 'value', dateFilter = null, showClientNet = false,
      showExchangeView = false, hasFetchedServerPositions = false, serverPositionsResultKey = null;
    ${keyCode}; return regularResultKey`)
  assert.equal(key({ filters: equal }, 1, true), key({ filters: equal }, 5, true))
  assert.notEqual(key({ filters: equal }, 1, true), key({ filters: {} }, 1, false))
  assert.notEqual(key({ filters: {} }, 1, false), key({ filters: {} }, 2, false))
})

test('existing upstream guard excludes stale server/WS rows and bypasses stale deferred rows with active conditions', () => {
  const selectionCode = extract('  const mobileRegularSourcePositions =', '  // Calculate summary statistics')
  const select = new Function('useMemo', 'useDeferredValue', 'applyCumulativeFilters', 'hasCurrentServerPositions', 'serverPositions',
    `const hasRegularColumnFilters = true, displayPositions = [{ position: 999 }], filters = {},
      filterByActiveGroup = rows => rows, activeGroupFilters = {};
    ${selectionCode}; return dateFilteredPositions`)
  const staleDeferred = () => [row(999, wrongEpoch)]
  assert.deepEqual(select(fn => fn(), staleDeferred, applyCumulativeFilters, false, [row(1)]), [])
  assert.deepEqual(select(fn => fn(), staleDeferred, applyCumulativeFilters, true, [row(1)]), [row(1)])
})

test('actual regular pipeline applies cumulative filters, search and global sorting before pagination', () => {
  const pipelineCode = extract('  const filteredPositions =', '  // Handle column sorting')
  const pipeline = new Function('useMemo', 'applySearchFilter', 'positionFilterRows', 'positionRawValue', 'sortPositionRows',
    'dateFilteredPositions', 'positionColumns', `${pipelineCode.replace('  const filteredPositions', `
    const debouncedSearch = 'eur', sortColumn = 'position', sortDirection = 'desc', hasRegularColumnFilters = true;
    const filteredPositions`)}; return filteredPositions`)
  const rows = Array.from({ length: 42 }, (_, i) => ({ ...row(i + 1), login: i % 2 ? 200 : 100,
    profit: i === 0 ? 0 : 1, symbol: i === 2 ? 'GBPUSD' : 'EURUSD' }))
  const cumulative = applyCumulativeFilters(rows, { customizeFilters: { hasFloating: true },
    filterByActiveGroup: items => items.filter(r => r.login === 100), loginField: 'login', moduleName: 'positions' })
  const matches = pipeline(fn => fn(), applySearchFilter, positionFilterRows, positionRawValue, sortRowsByColumn,
    cumulative, { filters: equal })
  assert.equal(matches.length, 19)
  assert.deepEqual(render(rows, { candidates: matches, page: 2 }).rows.map(r => r.position), [11, 9, 7, 5])
})

test('no column filters preserve requested server page and reported pagination', async () => {
  const result = await fetchResults(async params => {
    assert.equal(params.page, 3)
    return { positions: [row(31)], total: 80, totals: { profit: 123 } }
  }, {}, { page: 3 })
  assert.equal(result.total, 80)
  assert.equal(result.totals.profit, 123)
  assert.deepEqual(render(result.rows, { filters: {}, page: 3, total: result.total }), { rows: [row(31)], totalPages: 6 })
})

test('unknown totals scan through short capped pages to empty; known totals follow server-capped pages', async () => {
  let calls = 0
  const result = await fetchResults(async () => ({ positions: ++calls === 1 ? [row(1), row(2)] : calls === 2 ? [row(3)] : [] }), equal, { limit: 15 })
  assert.equal(calls, 3)
  assert.equal(result.rows.length, 3)
  calls = 0
  const capped = await fetchResults(async () => ({ positions: [row(++calls)], total: 3 }))
  assert.equal(calls, 3)
  assert.equal(capped.rows.length, 3)
})

test('malformed, incomplete, duplicate pages and later errors never publish partial matches', async () => {
  for (const positions of [{}, [null], [[]]]) {
    await assert.rejects(fetchResults(async () => ({ positions })), /Invalid positions response/)
  }
  await assert.rejects(fetchResults(async () => ({ positions: [row(1)], total: 30 })), /did not advance/)
  let calls = 0
  await assert.rejects(fetchResults(async () => ({ positions: ++calls === 1 ? [row(1)] : [], total: 3 })), /incomplete/)
  calls = 0
  await assert.rejects(fetchResults(async () => {
    if (++calls === 2) throw new Error('later page failed')
    return { positions: [row(1)], total: 3 }
  }), /later page failed/)
})

test('cancelled or superseded collection stops without publishing or fetching another page', async () => {
  for (const abort of [true, false]) {
    const controller = new AbortController()
    let current = true
    let calls = 0
    const result = await fetchResults(async () => {
      calls++
      if (abort) controller.abort()
      else current = false
      return { positions: [row(1)], total: 30 }
    }, equal, {}, controller.signal, () => current)
    assert.equal(result, null)
    assert.equal(calls, 1)
  }
})

test('Time predicate matches rendered seconds for numeric strings, fractional sec/ms, DMY and offset strings', () => {
  const values = [epoch, String(epoch), epoch + 0.999, String(epoch + 0.999), epoch * 1000 + 999,
    String(epoch * 1000 + 999), '2026.11.06 22:54:59', '06/11/2026 22:54:59',
    '2026-11-06T22:54:59.999+05:30']
  for (const value of values) {
    assert.equal(apiFormatTime(value), '06/11/2026 22:54:59')
    assert.deepEqual(filtered([row(1, value)]).map(row => row.position), [1], String(value))
  }
  assert.deepEqual(filtered([{ position: 2, timeUpdate: 0, timeCreate: epoch }]).map(row => row.position), [2])
  for (const type of ['equal', 'notEqual', 'lessThanOrEqual', 'greaterThanOrEqual', 'between']) {
    assert.deepEqual(filtered([row(1, 'invalid'), row(2, '2026-02-31 04:08:24'), { position: 3 }],
      { updated_custom: { type, value1: epoch, value2: epoch + 1 } }), [])
  }
})

test('rejecting backend: all Time operators stay local while period/search/group constraints survive every page', async () => {
  const rows = [row(1, epoch - 1), row(2), row(3, epoch + 0.999), row(4, epoch + 1)]
  const group = { field: 'login', operator: 'in', value: [100] }
  for (const [type, ids] of [['equal', [2, 3]], ['notEqual', [1, 4]], ['lessThanOrEqual', [1, 2, 3]],
    ['greaterThanOrEqual', [2, 3, 4]], ['between', [2, 3, 4]]]) {
    const filters = { updated_custom: { type, value1: epoch, value2: epoch + 1 } }
    let calls = 0
    const result = await fetchResults(async params => {
      calls++
      assert.deepEqual(params.filters, [group], 'Backend rejects unsupported Time fields')
      assert.equal(params.search, 'EUR')
      assert.equal(params.dateFrom, epoch - 100)
      assert.equal(params.dateTo, epoch + 100)
      return { positions: rows.slice((params.page - 1) * 2, params.page * 2), total: rows.length }
    }, filters, { limit: 2, search: 'EUR', dateFrom: epoch - 100, dateTo: epoch + 100,
      filters: [...positionRequestFilters(filters), group] })
    assert.equal(calls, 2)
    assert.deepEqual(result.rows.map(row => row.position), ids, type)
  }
})