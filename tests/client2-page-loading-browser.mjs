import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, extname, sep } from 'node:path'

// Actual built desktop route and API service. All account data is synthetic.
const root = resolve('dist')
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
  if (!path.startsWith(root + sep)) return void res.writeHead(403).end()
  try {
    const file = extname(path) ? path : join(root, 'index.html')
    const contents = await readFile(file)
    res.writeHead(200, { 'Content-Type': { '.js': 'application/javascript', '.css': 'text/css' }[extname(file)] || 'text/html' }).end(contents)
  } catch { res.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(join(tmpdir(), 'client2-page-loading-'))
const browser = spawn(process.env.TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(done => setTimeout(done, ms))
const calls = [], secondary = [], heldPrimary = [], exceptions = []
let ws, send, holdMetadata = true
try {
  let port
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await delay(100) }
  }
  assert.ok(port, 'Browser debugging endpoint started')
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise(done => ws.addEventListener('open', done, { once: true }))
  let id = 0
  const pending = new Map()
  send = (method, params = {}) => new Promise((resolveCall, reject) => {
    const next = ++id
    pending.set(next, { resolve: resolveCall, reject })
    ws.send(JSON.stringify({ id: next, method, params }))
  })
  ws.addEventListener('message', async ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id)
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      if (request.url.startsWith(origin) && !url.pathname.startsWith('/api/')) return void send('Fetch.continueRequest', { requestId })
      const isApi = url.pathname.startsWith('/api/')
      const isPrimary = url.pathname.endsWith('/clients/search') && request.method === 'POST'
      const payload = request.postData ? JSON.parse(request.postData) : {}
      const result = isPrimary
        ? { clients: [{ login: 810042, pnl: -25, profit: -5, equity: 100, lifetimePnL: -20 }], total: 250, pages: 3, totals: { pnl: -25, floating: -5 } }
        : url.pathname.endsWith('/me') ? { broker: { id: 14, username: 'client2-test', rights: [] } }
        : { clients: [], groups: [], positions: [], orders: [], total: 0 }
      const fulfill = () => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
        { name: 'Content-Type', value: isApi ? 'application/json' : 'application/javascript' },
        { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, OPTIONS' },
      ], body: Buffer.from(isApi ? JSON.stringify({ status: 'success', data: result }) : '').toString('base64') })
      if (isPrimary) { calls.push(payload); heldPrimary.push(fulfill) }
      else if (isApi && request.method !== 'OPTIONS' && (holdMetadata || url.pathname.endsWith('/clients/fields'))) secondary.push({ path: url.pathname, fulfill })
      else await fulfill()
    }
  })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('access_token', 'synthetic-client2-session');
    localStorage.setItem('user_data', JSON.stringify({id:14, username:'client2-test', rights:[]}));
  ` })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const until = async (check, label, timeout = 10000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await check()) return
      await delay(50)
    }
    throw new Error(`Timed out: ${label}; ${JSON.stringify({ calls, secondary: secondary.map(r => r.path), exceptions })}`)
  }
  const rowsVisible = () => evaluate(`!!document.querySelector('tbody')?.innerText.includes('810042')`)
  const navigate = path => evaluate(`history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate'))`)
  await send('Page.navigate', { url: `${origin}/client2` })
  await until(() => calls.length > 0, 'first paginated request')
  assert.equal(await evaluate(`!!document.querySelector('input[placeholder="Search"]') && !!document.querySelector('thead')`), true, 'real shell is immediately usable')
  assert.equal(await rowsVisible(), false, 'no fabricated rows before primary response')
  // Longer than the production polling cadence: this used to cancel the initial request.
  await delay(2500)
  assert.equal(calls.length, 1, 'polling does not replace slow primary request')
  assert.deepEqual(calls[0], { page: 1, limit: 100, currency: 'Combined' })
  assert.ok(secondary.length > 0, 'secondary metadata requests really are held unresolved')
  const releasedAt = Date.now()
  await heldPrimary.shift()()
  await until(rowsVisible, 'primary rows render without secondary metadata')
  const primaryRenderMs = Date.now() - releasedAt
  assert.equal(await evaluate(`document.querySelector('tbody').innerText.includes('-25.00')`), true, 'negative P&L stays signed')
  assert.equal(await evaluate(`document.querySelectorAll('tbody .skeleton-shimmer').length`), 0)
  assert.ok(!secondary.some(r => r.path.includes('commission-totals')), 'unused rebate request removed')

  // Release startup metadata after proving independence, so HTTP/1 connection
  // limits do not queue the next request behind intentionally stalled sockets.
  holdMetadata = false
  for (const request of secondary) await request.fulfill().catch(() => {})
  await until(rowsVisible, 'rows remain after metadata settles')

  // A genuinely delayed fields request must not blank existing table data.
  await evaluate(`document.querySelector('th button[title="Filter column"]').click()`)
  await until(() => secondary.some(r => r.path.endsWith('/clients/fields')), 'held filter fields request')
  assert.equal(await rowsVisible(), true)
  await evaluate(`document.body.click()`)

  await navigate('/positions')
  await until(async () => await evaluate(`location.pathname === '/positions'`) && !await rowsVisible(), 'leave Client2 route')
  const beforeRevisit = calls.length
  await navigate('/client2')
  await until(() => calls.length > beforeRevisit, 'revisit background revalidation')
  assert.equal(await rowsVisible(), true, 'session/query matching cache is visible while revalidation is held')
  assert.equal(await evaluate(`document.querySelectorAll('tbody .skeleton-shimmer').length`), 0)

  // Different currency must not display cached Combined rows.
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'INR').click()`)
  await until(() => calls.at(-1)?.currency === 'INR', 'currency-scoped request')
  assert.equal(await rowsVisible(), false, 'no mismatched cached query rows')
  await heldPrimary.at(-1)()
  await until(rowsVisible, 'new currency rows')
  assert.deepEqual(exceptions, [])
  console.log(JSON.stringify({ result: 'PASS', primaryRenderMs, heldSecondaryRequests: secondary.map(r => r.path), primaryCalls: calls.length,
    checks: ['slow-primary polling survival', 'shell before rows', 'secondary independence', 'signed P&L', 'fields nonblocking', 'cached revisit', 'currency isolation'] }, null, 2))
} finally {
  ws?.close()
  browser.kill()
  server.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {})
}