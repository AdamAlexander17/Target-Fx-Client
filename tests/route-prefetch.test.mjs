import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function PreloadRoutes()'))
const start = component.indexOf('useEffect(() => {') + 'useEffect(() => {'.length
const end = component.indexOf('\n  }, [', start)
assert.ok(start > 0 && end > start)
// Execute the real effect with controlled module imports and browser scheduling.
const body = component.slice(start, end).replace(/import\(('.*?')\)/g, 'load($1)')
const runEffect = new Function('window', 'navigator', 'load', 'isAuthenticated', 'initializing', body)
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function setup({ idle = true, connection, authenticated = true, initializing = false } = {}) {
  const callbacks = new Map()
  const requests = []
  let nextId = 0
  const schedule = callback => { const id = nextId++; callbacks.set(id, callback); return id }
  const cancel = id => callbacks.delete(id)
  const window = { setTimeout: schedule, clearTimeout: cancel }
  if (idle) Object.assign(window, { requestIdleCallback: schedule, cancelIdleCallback: cancel })
  const navigator = { connection }
  const load = path => new Promise((resolve, reject) => requests.push({ path, resolve, reject }))
  const cleanup = runEffect(window, navigator, load, authenticated, initializing)
  return {
    callbacks, requests, cleanup, navigator,
    tick() {
      assert.equal(callbacks.size, 1, 'only one callback may be queued')
      const [id, callback] = callbacks.entries().next().value
      callbacks.delete(id)
      return callback()
    },
  }
}

for (const idle of [true, false]) {
  test(`${idle ? 'idle' : 'timer'}: prioritized imports are sequential and failures are handled`, async () => {
    const env = setup({ idle })
    assert.equal(env.requests.length, 0, 'no eager import burst')
    env.tick()
    assert.equal(env.requests[0].path, './pages/Client2Page')
    assert.equal(env.callbacks.size, 0, 'wait for import settlement before scheduling again')
    env.requests[0].reject(new Error('offline'))
    await flush()
    env.tick()
    assert.equal(env.requests[1].path, './pages/PositionsPage')
    env.requests[1].resolve({})
    await flush()
    env.tick()
    assert.equal(env.requests[2].path, './pages/PendingOrdersPage')
    env.cleanup()
    env.requests[2].resolve({})
    await flush()
    assert.equal(env.callbacks.size, 0, 'in-flight completion cannot restart after cleanup')
  })

  test(`${idle ? 'idle' : 'timer'}: cleanup cancels scheduled work, including handle zero`, async () => {
    const env = setup({ idle })
    const staleCallback = [...env.callbacks.values()][0]
    env.cleanup()
    assert.equal(env.callbacks.size, 0)
    await staleCallback()
    assert.equal(env.requests.length, 0)
  })
}

for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
  test(`constrained connection skips prefetch: ${JSON.stringify(connection)}`, () => {
    const env = setup({ connection })
    assert.equal(env.requests.length, 0)
    assert.equal(env.callbacks.size, 0)
  })
}

test('connection is checked again before an idle import and after in-flight completion', async () => {
  const env = setup({ connection: { effectiveType: '4g' } })
  env.navigator.connection.saveData = true
  await env.tick()
  assert.equal(env.requests.length, 0)
  assert.equal(env.callbacks.size, 0)

  const active = setup()
  active.tick()
  active.navigator.connection = { effectiveType: '2g' }
  active.requests[0].resolve({})
  await flush()
  assert.equal(active.callbacks.size, 0)
  active.cleanup()
})

test('auth initialization and logout do not schedule imports; auth changes clean up the effect', () => {
  for (const options of [{ authenticated: false }, { initializing: true }]) {
    const env = setup(options)
    assert.equal(env.callbacks.size, 0)
    assert.equal(env.requests.length, 0)
  }
  assert.match(component, /}, \[isAuthenticated, initializing\]\)/)
})

test('queue drains without overlap and includes all previously prefetched screens plus Positions', async () => {
  const env = setup()
  while (env.callbacks.size) {
    env.tick()
    assert.equal(env.callbacks.size, 0)
    env.requests.at(-1).resolve({})
    await flush()
  }
  const paths = env.requests.map(request => request.path)
  assert.equal(paths.length, 18)
  assert.equal(new Set(paths).size, 18)
  assert.ok(paths.includes('./pages/PositionsPage'))
  assert.ok(paths.includes('./pages/ClientDashboardDesignC'))
  env.cleanup()
})