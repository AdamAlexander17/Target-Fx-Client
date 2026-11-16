import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createLatestRequest } from '../src/utils/latestRequest.js'

const read = path => readFileSync(new URL(`../src/${path}.jsx`, import.meta.url), 'utf8')
const client2 = read('components/Client2Module')
const orders = read('components/PendingOrdersModule')
const positions = read('components/PositionModule')
const ordersPage = read('pages/PendingOrdersPage')
const percentagePage = read('pages/ClientPercentagePage')

// Execute the actual effect callback, not a copied implementation. Dependencies
// and JSX are excluded; requests, visibility and clocks are deterministic fakes.
const effectBody = (source, marker) => {
  const start = source.indexOf('useEffect(() => {', source.indexOf(marker))
  assert.ok(start >= 0, marker)
  const end = source.indexOf('\n  }, [', start)
  assert.ok(end > start, marker)
  return source.slice(start + 'useEffect(() => {'.length, end)
}
const execute = (body, scope) => new Function(...Object.keys(scope), body)(...Object.values(scope))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const environment = () => {
  const timers = new Map()
  const listeners = new Map()
  return {
    timers, listeners,
    scope: {
      createLatestRequest, AbortController,
      console: { warn() {} },
      document: {
        visibilityState: 'visible',
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: name => listeners.delete(name),
      },
      setTimeout: (fn, delay) => { const id = {}; timers.set(id, { fn, delay }); return id },
      clearTimeout: id => timers.delete(id),
    },
  }
}

test('only artificial skeleton gates are removed; debounce and page animations remain', () => {
  for (const source of [client2, orders, positions]) {
    assert.doesNotMatch(source, /minTimer|initialLoadDoneRef|Minimum 600ms|setTimeout\([^\n]*600/)
  }
  assert.match(client2, /}, 300\)/)
  assert.match(orders, /}, 180\)/)
  assert.match(positions, /}, 180\)/)
  assert.match(client2, /clearInterval\(interval\)/)
})

for (const [label, source] of [['pending orders', ordersPage], ['client percentages', percentagePage]]) {
  test(`${label}: first-render viewport matches resize breakpoint, including 768px`, () => {
    const initializer = source.match(/const \[isMobile, setIsMobile\] = useState\(([^\n]+)\)/)[1]
    for (const width of [375, 767, 768, 1280]) {
      const detect = execute(`return ${initializer}`, { window: { innerWidth: width } })
      assert.equal(detect(), width < 768)
    }
    assert.equal(execute(`return (${initializer})()`, { window: undefined }), false)
    assert.match(source, /setIsMobile\(window.innerWidth < 768\)/)
    assert.match(source, /window.addEventListener\('resize', checkMobile\)/)
    assert.match(source, /window.removeEventListener\('resize', checkMobile\)/)
  })
}

for (const [label, source, marker, helper] of [
  ['pending orders', orders, '// Poll server every 2s', 'fetchOrderResults'],
  ['positions', positions, '// Poll server every 2s for regular positions', 'fetchPositionResults'],
]) {
  for (const outcome of ['success', 'failure', 'cancel']) {
    test(`${label}: initial loading waits only for actual ${outcome}, with stale cleanup protection`, async () => {
      const env = environment()
      const request = deferred()
      const loading = []
      let signal
      const noop = () => {}
      const scope = {
        ...env.scope,
        selectedClientRef: { current: null }, currentPage: 1, requestPage: 1, itemsPerPage: 15,
        getGroupLoginsRef: { current: () => [] },
        sortColumn: null, sortDirection: 'asc', searchInput: '', debouncedSearch: '',
        getActiveGroupFilter: () => null, getGroupLogins: () => [],
        columnFilters: { filters: {} }, positionColumns: { filters: {} },
        orderRequestFilters: () => [], regularRequestFilters: [],
        POSITION_FIELD_ALIASES: {}, showClientNet: false, showExchangeView: false,
        displayMode: 'full', dateFilter: null, regularResultKey: 'positions', orderResultKey: 'orders',
        hasFetchedServerPositionsRef: { current: false }, hasFetchedServerTotalsRef: { current: false },
        brokerAPI: {},
        [helper]: (_api, _params, _filters, requestSignal) => { signal = requestSignal; return request.promise },
        setServerOrders: noop, setServerTotalOrders: noop, setServerResultKey: noop,
        setServerTotals: noop, setHasFetchedOrders: noop, setServerPositions: noop,
        setServerPositionsTotal: noop, setServerPositionsResultKey: noop,
        setServerPositionsTotals: noop, setHasFetchedServerPositions: noop,
        setIsServerPositionsLoading: noop, setIsInitialLoading: value => loading.push(value),
      }
      const cleanup = execute(effectBody(source, marker), scope)
      assert.deepEqual(loading, [], 'still loading while request is unresolved')
      assert.equal(env.timers.size, 0, 'no minimum-duration timer')
      if (outcome === 'cancel') cleanup()
      if (outcome === 'failure') request.reject(new Error('offline'))
      else request.resolve({ rows: [], total: 0, totals: {} })
      await flush()
      assert.deepEqual(loading, outcome === 'cancel' ? [] : [false])
      assert.deepEqual([...env.timers.values()].map(timer => timer.delay), outcome === 'cancel' ? [] : [2000])
      cleanup()
      assert.equal(signal.aborted, true)
      assert.equal(env.timers.size, 0)
      assert.equal(env.listeners.size, 0)
    })
  }
}

test('Client2 awaits the existing complete-result collector directly, without a clock gate', async () => {
  const body = client2.slice(client2.indexOf('      const signal = abortControllerRef.current.signal'),
    client2.indexOf('      const t = data.totals || {}'))
  const request = deferred()
  const controller = new AbortController()
  let completed = false
  const result = execute(`return (async () => { ${body}; return data })()`, {
    abortControllerRef: { current: controller }, currentRequestId: 1,
    requestIdRef: { current: 1 }, latestResultKeyRef: { current: 'query' }, clientResultKey: 'query',
    brokerAPI: {}, payload: { page: 1 }, columnFilters: { filters: {} },
    fetchClient2Results: () => request.promise,
  }).then(data => { completed = true; return data })
  await flush()
  assert.equal(completed, false)
  request.resolve({ clients: [] })
  await flush()
  assert.equal(completed, true)
  assert.deepEqual(await result, { clients: [] })
})

test('desktop pending poll is absent on mobile; resize aborts old request and desktop return restarts it', async () => {
  const body = effectBody(ordersPage, '// REST polling with server-side')
  assert.match(ordersPage, /}, \[isMobile, currentPage/)
  const env = environment()
  const requests = []
  const updates = []
  const noop = () => {}
  const scope = {
    ...env.scope, isMobile: true, selectedLogin: null, currentPage: 1, itemsPerPage: 100,
    sortColumn: 'timeSetup', sortDirection: 'desc', activeSearch: '', columnFilters: {},
    getActiveGroupFilter: () => null, getGroupLogins: () => [],
    brokerAPI: { searchOrders: (_params, options) => {
      const pending = deferred(); requests.push({ ...pending, signal: options.signal }); return pending.promise
    } },
    setError: noop, setPolledOrders: rows => updates.push(rows), setServerTotalOrders: noop,
    setServerTotals: noop, setIsPageLoading: noop, setHasFetchedOrders: noop,
  }
  assert.equal(execute(body, scope), undefined)
  assert.equal(requests.length, 0)
  assert.equal(env.listeners.size, 0)
  scope.isMobile = false
  const cleanup = execute(body, scope)
  assert.equal(requests.length, 1)
  cleanup() // Desktop -> mobile effect cleanup.
  assert.equal(requests[0].signal.aborted, true)
  scope.isMobile = true
  execute(body, scope)
  requests[0].resolve({ orders: [{ order: 'stale' }], total: 1 })
  await flush()
  assert.deepEqual(updates, [])
  assert.equal(env.timers.size, 0)
  scope.isMobile = false
  const cleanupAgain = execute(body, scope)
  requests[1].resolve({ orders: [], total: 0 })
  await flush()
  assert.deepEqual(updates, [[]])
  assert.equal(env.timers.size, 1)
  cleanupAgain()
  assert.equal(env.timers.size, 0)
  assert.equal(env.listeners.size, 0)
})

test('percentage desktop effect skips mobile and invalidates collectors on resize before restarting', () => {
  const body = effectBody(percentagePage, '// One fetch path')
  assert.match(percentagePage, /}, \[isMobile, searchQuery/)
  const requests = createLatestRequest()
  const active = []
  const scope = {
    percentageRequests: { current: requests }, document: { visibilityState: 'visible' },
    isMobile: true, isAuthenticated: true, unauthorized: false, serverPage: 1,
    fetchAllClientPercentages: () => active.push(requests.start()),
  }
  assert.equal(execute(body, scope), undefined)
  assert.equal(active.length, 0)
  scope.isMobile = false
  const cleanup = execute(body, scope)
  assert.equal(active[0](), true)
  cleanup()
  scope.isMobile = true
  execute(body, scope)
  assert.equal(active[0](), false, 'late results and collector next pages are obsolete')
  assert.equal(active.length, 1)
  scope.isMobile = false
  const cleanupAgain = execute(body, scope)
  assert.equal(active[1](), true)
  cleanupAgain()
})