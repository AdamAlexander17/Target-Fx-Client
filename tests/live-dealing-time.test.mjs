import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { matchesColumnFilter, rowFieldValue, sortRowsByColumn } from '../src/utils/columnFilters.js'
import { formatTime as apiFormatTime, serverNowEpoch, toApiEpoch } from '../src/utils/dateFormatter.js'
import { getPresetRange } from '../src/utils/dealTimePresets.js'
import { applyCumulativeFilters } from '../src/utils/mobileFilters.js'

// Execute the actual JSX module's non-JSX helpers/request/render pipeline.
const source = readFileSync(new URL('../src/components/LiveDealingModule.jsx', import.meta.url), 'utf8')
const section = (start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first)
  assert.ok(first >= 0 && last > first, start)
  return source.slice(first, last)
}
const { dealRawValue, dealFilterRows, dealSortValue, fetchDealResults } = new Function(
  'matchesColumnFilter', 'rowFieldValue', 'apiFormatTime',
  `${section('const DEAL_FIELDS', '// Labels for the quick time')}; return { dealRawValue, dealFilterRows, dealSortValue, fetchDealResults }`,
)(matchesColumnFilter, rowFieldValue, apiFormatTime)
const epoch = Date.parse('2026-11-12T17:06:16Z') / 1000
const equal = { time_custom: { type: 'equal', value1: epoch } }
const row = (deal, time = epoch) => ({ deal, login: 100, symbol: 'EURUSD', action: 'BUY', time })
const query = { from: epoch - 86400, to: epoch + 86400, extraBody: {} }
const fetchResults = (api, collect = true, signal = new AbortController().signal, current = () => true) => (
  fetchDealResults(api, query, collect, 3, 15, signal, current)
)
const buildRequest = options => new Function('useCallback', 'getPresetRange', 'serverNowEpoch', `
  const {timeFilter = 'custom', appliedFromDate = '2026-11-01', appliedToDate = '2026-11-12',
    activeColumnFilters = {}, appliedSearch = '', moduleFilter = 'both', group = null, logins = [],
    sortColumn = 'time', sortDirection = 'desc'} = arguments[3];
  const getActiveGroupFilter = () => group, getGroupLoginsRef = {current: () => logins}, groups = [];
  ${section('  // Shared by list/export.', '  // Dynamic preset')}
  return buildDealsRequest();
`)(fn => fn, getPresetRange, serverNowEpoch, options)

test('12/11/2026 17:06:16 matches the exact displayed second in every API representation', () => {
  const formats = [epoch, String(epoch), epoch * 1000 + 999, '2026.11.12 17:06:16',
    '12/11/2026 17:06:16', '2026-11-12T17:06:16+05:30', '2026-11-12T17:06:16Z']
  for (const time of formats) {
    assert.equal(apiFormatTime(time), '12/11/2026 17:06:16')
    assert.equal(dealRawValue(row(1, time), 'time'), epoch)
    assert.equal(dealFilterRows([row(1, time)], equal).length, 1, String(time))
  }
  assert.deepEqual(dealFilterRows([row(1, epoch - 1), row(2), row(3, epoch + 1)], equal).map(r => r.deal), [2])
  assert.match(section("      case 'time':", "      case 'login':"), /formatTime\(dealRawValue\(deal, 'time'\)\)/)
})

test('all date comparisons are second-level and Between includes both endpoints; invalid times fail closed', () => {
  const rows = [row(1, epoch - 1), row(2, epoch * 1000 + 999), row(3, epoch + 1)]
  for (const [type, ids] of Object.entries({ equal: [2], notEqual: [1, 3], lessThan: [1], lessThanOrEqual: [1, 2],
    greaterThan: [3], greaterThanOrEqual: [2, 3], between: [2, 3] })) {
    const filter = { time_custom: { type, value1: epoch, value2: epoch + 1 } }
    assert.deepEqual(dealFilterRows(rows, filter).map(r => r.deal), ids, type)
    assert.deepEqual(dealFilterRows([{}, row(4, 'bad'), row(5, '2026-02-31 17:06:16')], filter), [], type)
  }
  assert.equal(dealRawValue({ time: 0, timestampStr: '12/11/2026 17:06:16' }, 'time'), epoch)
})

test('actual request preserves overall period; sends NO column filters or offset, including unsupported operators', () => {
  const base = buildRequest({})
  assert.equal(base.from, Date.parse('2026-11-01T00:00:00Z') / 1000)
  assert.equal(base.to, Date.parse('2026-11-12T23:59:59Z') / 1000)
  assert.equal(base.extraBody.sortBy, 'deal_time')
  for (const type of ['equal', 'notEqual', 'lessThanOrEqual', 'greaterThanOrEqual', 'between']) {
    assert.deepEqual(buildRequest({ activeColumnFilters: { time_custom: { type, value1: epoch, value2: epoch + 1 },
      symbol_custom: { type: 'doesNotContain', value1: 'GBP' } } }), base)
  }
  // Reproduce why a local guard cannot repair a pre-narrowed API request.
  const honorBounds = ({ from, to }) => [row(1)].filter(r => r.time >= from && r.time <= to)
  assert.equal(honorBounds({ from: toApiEpoch(epoch), to: toApiEpoch(epoch) }).length, 0)
  assert.equal(honorBounds(base).length, 1)
  const scoped = buildRequest({ group: 'A', logins: [100, 101], appliedSearch: '100', moduleFilter: 'deal', activeColumnFilters: equal })
  assert.deepEqual(scoped.extraBody.filters, [
    { field: 'action', operator: 'in', value: ['BUY', 'SELL'] }, { field: 'login', operator: 'equal', value: 100 },
  ])
  assert.deepEqual(buildRequest({ group: 'A', logins: [101], appliedSearch: '100' }).extraBody.filters,
    [{ field: 'login', operator: 'in', value: [-1] }])
  assert.equal(buildRequest({ appliedSearch: 'EUR' }).extraBody.search, 'EUR')
  for (const timeFilter of ['today', 'lastweek', 'lastmonth', 'last3months', 'last6months', 'allhistory']) {
    const request = buildRequest({ timeFilter, activeColumnFilters: equal })
    assert.deepEqual({ from: request.from, to: request.to }, getPresetRange(timeFilter))
  }
})

test('all numeric/text conditions intersect locally on raw values, not formatted cells', () => {
  const rows = [row(1), { ...row(2), volume: 12345, profit: -20, entry: '001' }, { ...row(3), symbol: 'GBPUSD' }]
  for (const [type, first, second] of [['equal', 12345], ['notEqual', 10], ['lessThan', 12346],
    ['lessThanOrEqual', 12345], ['greaterThan', 12344], ['greaterThanOrEqual', 12345], ['between', 12345, 12345]]) {
    assert.deepEqual(dealFilterRows(rows, { ...equal, netVolume_custom: { type, value1: first, value2: second },
      totalProfit_custom: { type: 'equal', value1: -20 } }).map(r => r.deal), [2], type)
  }
  for (const [type, value1] of [['equal', 'eurusd'], ['notEqual', 'GBPUSD'], ['startsWith', 'EUR'],
    ['endsWith', 'USD'], ['contains', 'RUS'], ['doesNotContain', 'GBP']]) {
    assert.deepEqual(dealFilterRows(rows, { symbol_custom: { type, value1 },
      entry_custom: { type: 'equal', value1: '001' } }).map(r => r.deal), [2], type)
  }
  assert.deepEqual(dealFilterRows(rows, { entry_custom: { type: 'equal', value1: '1' } }), [])
})

test('collect capped pages beyond page one, nested total, global sort and local pagination/count', async () => {
  const rows = Array.from({ length: 44 }, (_, i) => row(i + 1, i < 17 ? epoch * 1000 + 999 : epoch + 1))
  const calls = []
  const result = await fetchResults(async (from, to, limit, page, body, config) => {
    calls.push({ page, limit })
    assert.equal(from, query.from); assert.equal(to, query.to)
    assert.deepEqual(body, {}); assert.ok(config.signal)
    return { data: { deals: rows.slice((page - 1) * 7, page * 7), pagination: { total: rows.length } } }
  })
  assert.deepEqual(calls.map(c => c.page), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(calls.map(c => c.limit), [500, 7, 7, 7, 7, 7, 7])
  const matches = sortRowsByColumn(dealFilterRows(result.rows, equal), dealSortValue, 'deal', 'desc')
  assert.equal(matches.length, 17)
  assert.deepEqual(matches.slice(15, 30).map(r => r.deal), [2, 1])
  const render = new Function('hasCurrentDeals', 'hasColumnFilters', 'sortedDeals', 'currentPage', `
    const serverDealsCount = 44, itemsPerPage = 15, useEffect = () => {};
    ${section('  // All local conditions', '  // Calculate summary statistics')}
    return { rows: displayDeals, total: totalDealsCount, pages: totalDealsPages };
  `)
  assert.deepEqual(render(true, true, matches, 2), { rows: matches.slice(15), total: 17, pages: 2 })
  assert.deepEqual(render(true, true, matches, 8), { rows: matches.slice(15), total: 17, pages: 2 })
  assert.deepEqual(render(false, true, [], 1), { rows: [], total: 0, pages: 1 })
})

test('actual pipeline preserves period, symbol/comment search, module, cumulative group and column intersections', () => {
  const pipeline = new Function('useMemo', 'buildDealsRequest', 'deals', 'hasCurrentDeals', 'appliedSearch', 'moduleFilter',
    'applyCumulativeFilters', 'dealRawValue', 'dealFilterRows', 'sortRowsByColumn', 'dealSortValue', `
      const filters = {}, filterByActiveGroup = rows => rows.filter(r => r.login === 100), activeGroupFilters = {},
        activeColumnFilters = arguments[11], sortColumn = 'deal', sortDirection = 'desc';
      ${section('  // Repeat conditions locally', '  // All local conditions')}
      return sortedDeals;
    `)
  const rows = [row(1), row(2, epoch + 1), { ...row(3), login: 101 }, { ...row(4), symbol: 'GBPUSD' },
    { ...row(5), action: 'BALANCE' }, row(6, epoch - 999999), { ...row(7), symbol: 'GBPUSD', comment: 'eur match' }]
    .map(rawData => ({ id: rawData.deal, login: rawData.login, rawData }))
  assert.deepEqual(pipeline(fn => fn(), () => query, rows, true, 'eur', 'deal', applyCumulativeFilters,
    dealRawValue, dealFilterRows, sortRowsByColumn, dealSortValue, equal).map(r => r.id), [7, 1])
  assert.deepEqual(pipeline(fn => fn(), () => query, rows, false, '', 'both', applyCumulativeFilters,
    dealRawValue, dealFilterRows, sortRowsByColumn, dealSortValue, equal), [])
})

test('unfiltered requests retain remote page/total; no-total capped scans continue until empty', async () => {
  const unfiltered = await fetchResults(async (from, to, limit, page) => {
    assert.equal(page, 3)
    return { items: [row(31)], total_count: 80 }
  }, false)
  assert.equal(unfiltered.total, 80)
  let calls = 0
  const scanned = await fetchResults(async () => ({ deals: ++calls <= 3 ? [row(calls)] : [] }))
  assert.equal(calls, 4)
  assert.equal(scanned.rows.length, 3)
})

test('malformed, incomplete, duplicate pages and later errors never publish partial candidates', async () => {
  for (const deals of [null, {}, [null], [[]]]) await assert.rejects(fetchResults(async () => ({ deals })), /Invalid deals/)
  await assert.rejects(fetchResults(async () => ({ deals: [row(1)], total: 30 })), /did not advance/)
  let calls = 0
  await assert.rejects(fetchResults(async () => ({ deals: ++calls === 1 ? [row(1)] : [], total: 30 })), /incomplete/)
  calls = 0
  await assert.rejects(fetchResults(async () => {
    if (++calls === 2) throw new Error('later page failed')
    return { deals: [row(1)], total: 30 }
  }), /later page failed/)
})

test('aborted/superseded scans stop; query keys, serial poll and error paths guard stale display', async () => {
  for (const abort of [true, false]) {
    const controller = new AbortController()
    let current = true, calls = 0
    const result = await fetchResults(async () => {
      calls++
      if (abort) controller.abort(); else current = false
      return { deals: [row(1)], total: 30 }
    }, true, controller.signal, () => current)
    assert.equal(result, null); assert.equal(calls, 1)
  }
  assert.match(source, /const hasCurrentDeals = dealsResultKey === dealsQueryKey/)
  assert.match(source, /hasColumnFilters \? null : currentPage/)
  assert.match(source, /await fetchDeals\(currentPageRef.current, controller.signal, background\)/)
  assert.match(source, /controller.abort\(\); clearTimeout\(timer\)/)
  assert.match(source, /latestDealsQueryRef.current === dealsQueryKey/)
})