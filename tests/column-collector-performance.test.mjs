import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { matchesColumnFilter, rowFieldValue, sortRowsByColumn, columnFiltersForRequest } from '../src/utils/columnFilters.js'
import { apiTimeSecond, formatTime as apiFormatTime } from '../src/utils/dateFormatter.js'
import { fetchCreditCandidates, filterCreditTime } from '../src/utils/creditReportTime.js'

const read = path => readFileSync(new URL(`../src/${path}.jsx`, import.meta.url), 'utf8')
const live = read('components/LiveDealingModule')
const deals = read('pages/DealsReportPage')
const credit = read('pages/CreditReportPage')
const positions = read('components/PositionModule')
const orders = read('components/PendingOrdersModule')
const clients = read('components/Client2Module')
const section = (source, start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first)
  assert.ok(first >= 0 && last > first, start)
  return source.slice(first, last)
}
const scope = { matchesColumnFilter, rowFieldValue, sortRowsByColumn, columnFiltersForRequest, apiTimeSecond, apiFormatTime }
const helpers = (source, start, end, names) => new Function(...Object.keys(scope),
  `${section(source, start, end)}; return { ${names} }`)(...Object.values(scope))
const liveHelpers = helpers(live, 'const DEAL_FIELDS', '// Labels for the quick time', 'fetchDealResults, dealFilterRows')
const dealHelpers = helpers(deals, 'const DEAL_ACTIONS', 'const COLUMNS', 'fetchReportDeals, filterReportRows')
const positionHelpers = helpers(positions, 'const POSITION_TEXT_COLUMNS', 'const formatNum', 'fetchPositionResults')
const clientHelpers = helpers(clients, 'const CLIENT2_NUMBER_COLUMNS', 'export default function', 'fetchClient2Results')
const second = Date.parse('2026-11-12T09:32:24Z') / 1000
const records = Array.from({ length: 1201 }, (_, index) => ({
  deal: index + 1, position: index + 1, login: index + 1,
  time: index < 1100 ? second - 1 : second, symbol: index < 1100 ? 'EARLY' : 'MATCH', name: index < 1100 ? 'EARLY' : 'MATCH',
}))
const signal = () => new AbortController().signal
const current = () => true

for (const name of ['Live', 'Deals', 'Credit', 'Positions', 'Client2']) {
  test(`${name}: 500-row batches reduce a 1201-row scan from 81 requests to 3, preserving later exact matches`, async () => {
    const calls = []
    const batch = (page, limit) => {
      calls.push({ page, limit })
      return records.slice((page - 1) * limit, page * limit)
    }
    let rows
    if (name === 'Live') {
      const next = await liveHelpers.fetchDealResults(async (from, to, limit, page) => ({ deals: batch(page, limit), total: records.length }),
        {}, true, 1, 15, signal(), current)
      rows = liveHelpers.dealFilterRows(next.rows, { time_custom: { type: 'equal', value1: second } })
    } else if (name === 'Deals') {
      const next = await dealHelpers.fetchReportDeals(async (from, to, limit, page) => ({ deals: batch(page, limit), total: records.length }),
        { page: 1, limit: 500 }, true, signal(), current)
      rows = dealHelpers.filterReportRows(next.rows, { time_custom: { type: 'equal', value1: second } })
    } else if (name === 'Credit') {
      const next = await fetchCreditCandidates(async ({ page, limit }) => ({ credits: batch(page, limit), total: records.length }),
        { page: 1, limit: 500 }, true, signal(), current)
      rows = filterCreditTime(next.rows, { type: 'equal', value1: second })
    } else if (name === 'Positions') {
      const next = await positionHelpers.fetchPositionResults(async ({ page, limit }) => ({ positions: batch(page, limit), total: records.length }),
        { page: 1, limit: 15 }, { symbol_custom: { type: 'equal', value1: 'MATCH' } }, signal(), current)
      rows = next.rows
    } else {
      const next = await clientHelpers.fetchClient2Results(async ({ page, limit }) => ({ clients: batch(page, limit), total: records.length }),
        { page: 1, limit: 15 }, { name_custom: { type: 'equal', value1: 'MATCH' } }, signal(), current)
      rows = next.clients
    }
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.limit === 500))
    assert.deepEqual(rows.map(row => row.deal), records.slice(1100).map(row => row.deal))
    // Paging the complete filtered snapshot must not request more candidates.
    assert.equal(rows.slice(15, 30).length, 15)
    assert.equal(rows.slice(90, 105).length, 11)
    assert.equal(calls.length, 3)
  })
}

test('actual fetch-effect dependencies reuse filtered pages but refetch remote pages and API sort changes', () => {
  for (const [source, marker, filteredName] of [
    [positions, '// Poll server every 2s for regular positions', 'hasRegularColumnFilters'],
    [orders, '// Poll server every 2s —', 'hasColumnFilters'],
  ]) {
    const effect = source.slice(source.indexOf(marker))
    const dependencies = effect.match(/\n  }, \[([^\]]+)\]\)/)[1]
    assert.ok(dependencies.split(',').map(value => value.trim()).includes('requestPage'))
    assert.ok(!dependencies.split(',').map(value => value.trim()).includes('currentPage'))
    assert.ok(!dependencies.split(',').map(value => value.trim()).includes('getGroupLogins'))
    assert.match(dependencies, /sortColumn, sortDirection/)
    const expression = source.match(new RegExp(`const requestPage = ${filteredName} \\? 1 : currentPage`))[0]
    const requestPage = (active, page) => new Function(filteredName, 'currentPage', `${expression}; return requestPage`)(active, page)
    assert.equal(requestPage(true, 1), requestPage(true, 2))
    assert.notEqual(requestPage(false, 1), requestPage(false, 2))
  }
  // Reports and Live already key complete results independently of local pages.
  assert.match(live, /hasColumnFilters \? null : currentPage/)
  assert.match(deals, /page: hasColumnFilters \? 1 : page, limit: hasColumnFilters \? EXPORT_CHUNK/)
  assert.match(credit, /page: timeFilter \? 1 : page/)
  assert.match(credit, /limit: timeFilter \? EXPORT_CHUNK_SIZE : limit/)
})

test('actual Live polling schedules 10s complete scans and 2s normal pages, retaining WS subscriptions', async () => {
  const effect = section(live, '  // Serial polling:', '  const hasColumnFiltersRef')
  const body = section(effect, '    const controller', '\n  }, [')
  for (const hasColumnFilters of [false, true]) {
    const delays = [], calls = []
    const cleanup = new Function('AbortController', 'fetchDeals', 'currentPageRef', 'setTimeout', 'clearTimeout',
      'dealsRequestRef', 'hasColumnFilters', body)(AbortController,
      async (...args) => calls.push(args), { current: 2 }, (fn, delay) => delays.push(delay), () => {}, { current: 0 }, hasColumnFilters)
    await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(delays, [hasColumnFilters ? 10000 : 2000])
    assert.equal(calls.length, 1)
    cleanup()
    assert.equal(calls[0][1].aborted, true)
  }
  assert.match(live, /const handleDealAdded =/)
  assert.match(live, /websocketService\.subscribe/)
})