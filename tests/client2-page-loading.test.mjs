import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createClient2PageCache } from '../src/utils/client2PageCache.js'

const source = readFileSync(new URL('../src/pages/Client2Page.jsx', import.meta.url), 'utf8')
const start = source.indexOf('  const fetchClients = useCallback(async (silent = false) => {')
const end = source.indexOf('\n  }, [queryKey,', start)
const body = source.slice(start + '  const fetchClients = useCallback(async (silent = false) => {'.length, end)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const harness = (overrides = {}) => {
  const calls = [], writes = [], loading = [], errors = []
  const cache = createClient2PageCache()
  const noop = () => {}
  const scope = {
    queryKey: 'query', session: 'session', latestQueryKeyRef: { current: 'query' },
    isFetchingRef: { current: false }, activeRequestRef: { current: null },
    requestIdRef: { current: 0 }, abortControllerRef: { current: null },
    AbortController, initialLoad: true, DEBUG_LOGS: false,
    console: { log: noop, warn: noop, error: noop, debug: noop },
    currentPage: 1, itemsPerPage: 100, currencyMode: 'Combined', debouncedSearchQuery: '',
    quickFilters: {}, filters: [], columnFilters: {}, columnValues: {}, columnValueSearch: {},
    mt5Accounts: [], accountRangeMin: '', accountRangeMax: '', selectedIB: null, ibMT5Accounts: [],
    activeGroup: null, sortBy: '', sortOrder: 'asc', percentModeActive: false,
    client2PageCache: cache, setResult: value => writes.push(value),
    setInitialLoad: value => loading.push(['initial', value]),
    setLoading: value => loading.push(['loading', value]),
    setError: value => errors.push(value), setUnauthorized: noop, setIsSorting: noop, setProgressActive: noop,
    brokerAPI: { searchClients: async (payload, options) => {
      calls.push({ payload, options })
      return { data: { clients: [{ login: 42, pnl: -25 }], total: 1000, pages: 10, totals: { pnl: -25 } } }
    } },
    ...overrides,
  }
  const fetch = silent => new Function(...Object.keys(scope), 'silent', `return (async () => {${body}\n})()`)(...Object.values(scope), silent)
  return { scope, fetch, calls, writes, loading, errors, cache }
}

test('ordinary first page is one paginated request; no fields, all-accounts, or secondary awaits', async () => {
  const h = harness()
  await h.fetch(false)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0].payload, { page: 1, limit: 100, currency: 'Combined' })
  assert.equal(h.writes[0].clients[0].pnl, -25, 'negative financial values stay signed')
  assert.equal(h.writes[0].totalPages, 10)
  assert.deepEqual(h.loading.slice(-2), [['initial', false], ['loading', false]])
  assert.equal(h.cache.get('session', 'query'), h.writes[0])
  assert.doesNotMatch(source, /fetchRebateTotals|getIBCommissionTotals|refetchTimerRef/)
})

test('slow first page survives polling and visibility refresh without replacement or starvation', async () => {
  const pending = deferred(), calls = []
  const h = harness({ brokerAPI: { searchClients: (payload, options) => {
    calls.push({ payload, options }); return pending.promise
  } } })
  const first = h.fetch(false)
  for (let i = 0; i < 10; i++) await h.fetch(true)
  await h.fetch(false) // Equivalent provider/query re-render also joins existing owner.
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.signal.aborted, false)
  assert.deepEqual(h.writes, [])
  pending.resolve({ data: { clients: [{ login: 42 }], total: 1 } })
  await first
  assert.equal(h.writes.length, 1)
  assert.equal(h.scope.isFetchingRef.current, false)
})

test('new query replaces old owner; stale success/finally cannot release newer loading', async () => {
  const requests = []
  const h = harness({ brokerAPI: { searchClients: (_payload, options) => {
    const request = deferred(); requests.push({ ...request, options }); return request.promise
  } } })
  const first = h.fetch(false)
  h.scope.queryKey = 'filtered'
  h.scope.latestQueryKeyRef.current = 'filtered'
  h.scope.debouncedSearchQuery = 'Alice'
  const second = h.fetch(false)
  assert.equal(requests[0].options.signal.aborted, true)
  const before = h.loading.length
  requests[0].resolve({ data: { clients: [{ login: 999 }] } })
  await first
  assert.equal(h.loading.length, before)
  assert.deepEqual(h.writes, [])
  requests[1].resolve({ data: { clients: [], total: 0, pages: 1 } })
  await second
  assert.equal(h.writes[0].key, 'filtered')
  assert.deepEqual(h.writes[0].clients, [])
})

test('server search, currency, sorting, filters, account union and IB/group intersections remain intact', async () => {
  const h = harness({ currentPage: 3, itemsPerPage: 50, currencyMode: 'INR',
    debouncedSearchQuery: ' Alice ', quickFilters: { hasFloating: true },
    filters: [{ field: 'accountEnabled', operator: 'equal', value: 'Enabled' }],
    columnFilters: { login_checkbox: { values: ['102', '104'] }, pnl_number: { operator: 'less_than', value1: -10 } },
    mt5Accounts: [101, 103], selectedIB: { email: 'ib@test' }, ibMT5Accounts: [102, 103, 104],
    activeGroup: { loginIds: [103, 104] }, sortBy: 'pnl', sortOrder: 'desc' })
  await h.fetch(false)
  const payload = h.calls[0].payload
  assert.equal(payload.page, 3)
  assert.equal(payload.limit, 50)
  assert.equal(payload.currency, 'INR')
  assert.equal(payload.search, 'Alice')
  assert.deepEqual(payload.mt5Accounts, ['103', '104'])
  assert.equal(payload.sortBy, 'pnl')
  assert.equal(payload.sortOrder, 'desc')
  assert.deepEqual(payload.filters, [
    { field: 'floating', operator: 'not_equal', value: '0' },
    { field: 'accountEnabled', operator: 'equal', value: 'true' },
    { field: 'pnl', operator: 'less_than', value: '-10' },
  ])
  const empty = harness({ selectedIB: {}, ibMT5Accounts: [101], activeGroup: { loginIds: [102] } })
  await empty.fetch(false)
  assert.deepEqual(empty.calls[0].payload.mt5Accounts, ['0'])
  const range = harness({ activeGroup: { range: { from: 100, to: 200 } } })
  await range.fetch(false)
  assert.equal(range.calls[0].payload.accountRangeMin, 100)
  assert.equal(range.calls[0].payload.accountRangeMax, 200)
})

test('large checkbox collection ends initial loading after complete merged result', async () => {
  const h = harness({ columnFilters: { name_checkbox: { values: Array.from({ length: 21 }, (_, i) => `Name ${i}`) } } })
  await h.fetch(false)
  assert.equal(h.calls.length, 20, 'two chunks, ten response pages each')
  assert.equal(h.writes.length, 1, 'no partial rows or fabricated first page')
  assert.equal(h.writes[0].clients.length, 1, 'deduplication retained')
  assert.equal(h.writes[0].totals.pnl, -25)
  assert.deepEqual(h.loading.slice(-2), [['initial', false], ['loading', false]])
})

test('primary failure ends skeleton and allows retry; no fabricated rows are cached', async () => {
  const h = harness({ brokerAPI: { searchClients: async () => { throw new Error('offline') } } })
  await h.fetch(false)
  assert.equal(h.errors.at(-1), 'offline')
  assert.deepEqual(h.loading.slice(-2), [['initial', false], ['loading', false]])
  assert.equal(h.cache.get('session', 'query'), null)
  assert.deepEqual(h.writes, [])
})

test('cache is query/session exact, bounded, expires, accepts empty results and clears on logout', () => {
  let time = 0
  const cache = createClient2PageCache({ maxEntries: 2, ttl: 100, now: () => time })
  const snapshot = { clients: [], totalClients: 0 }
  cache.set('A', 'page1:INR:group1', snapshot)
  assert.equal(cache.get('A', 'page1:INR:group1'), snapshot)
  for (const key of ['page2:INR:group1', 'page1:USD:group1', 'page1:INR:group2']) assert.equal(cache.get('A', key), null)
  cache.set('A', 'two', snapshot)
  cache.set('A', 'three', snapshot)
  assert.equal(cache.get('A', 'page1:INR:group1'), null)
  time = 100
  assert.equal(cache.get('A', 'two'), null)
  cache.set('A', 'three', snapshot)
  assert.equal(cache.get('B', 'three'), null)
  assert.equal(cache.get('A', 'three'), null, 'switching back never resurrects old session')
  cache.set('A', 'three', snapshot)
  cache.clear()
  assert.equal(cache.get('A', 'three'), null)
  cache.set('', 'anonymous', snapshot)
  assert.equal(cache.get('', 'anonymous'), null)
})

test('one semantic-query effect owns cancellation, including unmount and StrictMode replay', () => {
  const marker = source.indexOf('// One initial/query fetch.')
  const effectStart = source.indexOf('useEffect(() => {', marker)
  const effectEnd = source.indexOf('\n  }, [queryKey,', effectStart)
  const effect = source.slice(effectStart + 'useEffect(() => {'.length, effectEnd)
  const h = harness()
  let starts = 0
  h.scope.fetchClientsRef = { current: () => starts++ }
  h.scope.isMobile = false; h.scope.isAuthenticated = true; h.scope.unauthorized = false
  const run = () => new Function(...Object.keys(h.scope), effect)(...Object.values(h.scope))
  h.scope.abortControllerRef.current = new AbortController()
  const cleanup = run()
  assert.equal(starts, 1)
  cleanup()
  assert.equal(h.scope.abortControllerRef.current.signal.aborted, true)
  assert.equal(h.scope.isFetchingRef.current, false)
  const replayCleanup = run()
  assert.equal(starts, 2)
  replayCleanup()
  h.scope.isMobile = true
  assert.equal(run(), undefined)
  assert.equal(starts, 2)
})