import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createPercentageLoader, loadPercentageClients, filterPercentageTypes } from '../src/utils/percentageType.js'
import { createLatestRequest } from '../src/utils/latestRequest.js'

const rows = Array.from({ length: 1201 }, (_, index) => ({
  client_login: index + 1, is_custom: index >= 1100, is_autofill: index >= 1190
}))
const deferred = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const api = (calls, cap = Infinity) => async params => {
  calls.push(params)
  const limit = Math.min(cap, params.limit ?? params.page_size)
  return { data: { clients: rows.slice((params.page - 1) * limit, params.page * limit), total: rows.length } }
}

for (const [label, path, mobile] of [
  ['desktop', 'pages/ClientPercentagePage.jsx', false],
  ['mobile', 'components/ClientPercentageModule.jsx', true]
]) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
  test(`${label}: actual fetch path paints first API page without scanning and retains rows during refresh`, async () => {
    const calls = []
    const pending = deferred()
    const fetch = api(calls)
    let delay = false
    const loader = createPercentageLoader(async params => { if (delay) await pending.promise; return fetch(params) })
    const loading = [], paints = []
    const scope = {
      isAuthenticated: true, unauthorized: false, user: { id: 'account-a' }, serverPage: 1,
      percentageRequests: { current: createLatestRequest() }, percentageLoader: { current: loader },
      displayedQuery: { current: null }, itemsPerPage: 100, sortColumn: 'client_login', sortDirection: 'asc',
      searchQuery: '', searchType: null, useLocalTypeFiltering: false, useLocalFiltering: false,
      isMobileView: mobile, setLoading: value => loading.push(value), setError() {},
      setClients: value => paints.push(value), setAllClients() {}, setStats() {}, setUnauthorized() {},
      console: { log() {}, error() {} }
    }
    const start = source.indexOf('const fetchAllClientPercentages = ')
    const end = source.indexOf(mobile ? '\n  }, [isMobileView' : '\n  const handleEditClick', start)
    const declaration = source.slice(start, end) + (mobile ? '\n  })' : '')
    const fetchActual = new Function(...Object.keys(scope), `const useCallback = fn => fn; ${declaration}; return fetchAllClientPercentages`)(...Object.values(scope))
    await fetchActual(1, false)
    assert.equal(calls.length, 1)
    assert.equal(paints.at(-1).length, mobile ? 15 : 100)
    assert.deepEqual(loading, [true, false])
    const paintCount = paints.length
    delay = true
    const refresh = fetchActual(1)
    const overlap = fetchActual(1)
    assert.equal(paints.length, paintCount, 'refresh must not clear matching real rows')
    assert.equal(loading.at(-1), false, 'no replacement skeleton')
    pending.resolve()
    await Promise.all([refresh, overlap])
    assert.equal(calls.length, 2, 'overlapping refreshes share one request')
  })
}

test('complete local snapshot uses 3 requests, includes late exact types/groups and pages locally', async () => {
  const calls = [], owner = {}
  const loader = createPercentageLoader(api(calls))
  const params = { page: 1, limit: 15, sort_by: 'login', sort_order: 'asc' }
  const result = await loader.load(params, true, owner)
  assert.equal(calls.length, 3)
  assert.ok(calls.every(call => call.limit === 500))
  const custom = filterPercentageTypes(result.clients, ['Custom'])
  assert.equal(custom.length, 90, 'Auto takes precedence over Custom')
  assert.equal(filterPercentageTypes(result.clients, ['Default']).length, 1100)
  const group = new Set(['1191', '1201'])
  const matches = filterPercentageTypes(result.clients, ['Auto']).filter(row => group.has(String(row.client_login)))
  assert.deepEqual(matches.map(row => row.client_login), [1191, 1201])
  assert.equal(custom.slice(75, 90).length, 15)
  assert.equal(await loader.load({ ...params, page: 4, limit: 100 }, true, owner), result)
  assert.equal(calls.length, 3)
})

test('remote page cache is not a complete collection; account switches, clear and force require fresh data', async () => {
  const calls = [], first = {}, second = {}
  const loader = createPercentageLoader(api(calls))
  const params = { page: 1, limit: 15 }
  await loader.load(params, false, first)
  await loader.load(params, false, first)
  assert.equal(calls.length, 1)
  await loader.load(params, true, first)
  assert.equal(calls.length, 4)
  await loader.load(params, false, second)
  assert.equal(calls.length, 5)
  loader.clear()
  await loader.load(params, false, second)
  await loader.load(params, false, second, true)
  assert.equal(calls.length, 7)
})

test('bounded cache evicts old pages and preserves independent query/login scopes', async () => {
  const calls = [], owner = {}, loader = createPercentageLoader(api(calls))
  for (let page = 1; page <= 7; page++) await loader.load({ page, limit: 15 }, false, owner)
  await loader.load({ page: 1, limit: 15 }, false, owner)
  assert.equal(calls.length, 8)
  await loader.load({ page: 1, limit: 15, login: '90' }, false, owner)
  assert.equal(calls.length, 9)
})

test('unknown totals walk past short server-capped pages to empty; nested pagination counts correctly', async () => {
  let calls = 0
  const result = await loadPercentageClients(async ({ page }) => {
    calls++
    return { clients: rows.slice((page - 1) * 100, page * 100) }
  }, {}, () => true)
  assert.equal(result.clients.length, 1201)
  assert.equal(calls, 14)
  const nested = await loadPercentageClients(async ({ page }) => ({ clients: rows.slice((page - 1) * 500, page * 500), pagination: { total: 1201, total_pages: 3 } }), {}, () => true)
  assert.equal(nested.total, 1201)
})

test('incomplete/duplicate/changing totals fail rather than caching a false complete result', async () => {
  await assert.rejects(loadPercentageClients(async ({ page }) => ({ clients: page === 1 ? rows.slice(0, 10) : [], total: 1201 }), {}, () => true), /Incomplete/)
  await assert.rejects(loadPercentageClients(async () => ({ clients: rows.slice(0, 10), total: 1201 }), {}, () => true), /duplicate/)
  await assert.rejects(loadPercentageClients(async ({ page }) => ({ clients: rows.slice((page - 1) * 500, page * 500), total: page === 1 ? 1201 : 1200 }), {}, () => true), /changing total/)
  let calls = 0
  const loader = createPercentageLoader(async () => { calls++; throw new Error('offline') })
  const owner = {}
  await assert.rejects(loader.load({}, true, owner), /offline/)
  await assert.rejects(loader.load({}, true, owner), /offline/)
  assert.equal(calls, 2)
})

test('logout/account change during collection stops old pages and prevents late cache writes', async () => {
  const pending = deferred(), calls = []
  const loader = createPercentageLoader(async params => { calls.push(params); await pending.promise; return { clients: rows.slice(0, 500), total: 1201 } })
  const request = loader.load({}, true, {})
  loader.clear()
  pending.resolve()
  await assert.rejects(request, /superseded/)
  assert.equal(calls.length, 1)
})

test('known total cannot disappear on the empty last page to disguise an incomplete collection', async () => {
  await assert.rejects(loadPercentageClients(async ({ page }) => page === 1
    ? { clients: rows.slice(0, 100), total: 1201 }
    : { clients: [] }, {}, () => true), /Incomplete/)
})

test('cached snapshots expire after 30 seconds', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const calls = [], owner = {}, loader = createPercentageLoader(api(calls))
  const params = { page: 1, limit: 15 }
  await loader.load(params, false, owner)
  now = 29999
  await loader.load(params, false, owner)
  assert.equal(calls.length, 1)
  now = 30000
  await loader.load(params, false, owner)
  assert.equal(calls.length, 2)
})

test('desktop actual type/search/group predicates intersect before local pagination', () => {
  const source = readFileSync(new URL('../src/pages/ClientPercentagePage.jsx', import.meta.url), 'utf8')
  assert.match(source, /useLocalTypeFiltering = .*Boolean\(activeGroup\)/)
  const start = source.indexOf('const sortedClients = () => {')
  const end = source.indexOf('\n  // Pagination', start)
  const user = {}
  const run = new Function('clients', 'selectedTypes', 'searchType', 'filterPercentageTypes', 'filterByActiveGroup', 'user', 'displayedQuery',
    `const isAuthenticated = true, unauthorized = false; ${source.slice(start, end)}; return sortedClients()`)
  const group = list => list.filter(row => row.client_login >= 1190)
  const matches = run(rows, ['Custom', 'Auto'], 'Auto', filterPercentageTypes, group, user, { current: { user } })
  assert.deepEqual(matches.map(row => row.client_login), rows.slice(1190).map(row => row.client_login))
  assert.deepEqual(run(rows, ['Custom'], 'Auto', filterPercentageTypes, group, user, { current: { user } }), [])
  assert.deepEqual(run(rows, [], null, filterPercentageTypes, group, user, { current: { user: {} } }), [], 'different account rows are never rendered')
})