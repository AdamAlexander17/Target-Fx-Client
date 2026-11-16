import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, extname, sep } from 'node:path'

// Run after npm run build. Real mobile /live-dealing route, synthetic auth,
// all API/external traffic intercepted. No production service is contacted.
const root = resolve('dist')
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return }
  try {
    const file = extname(path) ? path : join(root, 'index.html')
    const body = await readFile(file)
    const type = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] || 'text/html'
    res.writeHead(200, { 'Content-Type': type }).end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(join(tmpdir(), 'brokereye-deal-time-'))
const browser = spawn(process.env.TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(done => setTimeout(done, ms))
const epoch = Date.parse('2026-11-12T17:06:16Z') / 1000
const formats = [epoch, epoch * 1000 + 999, '2026.11.12 17:06:16', '12/11/2026 17:06:16', '2026-11-12T17:06:16+05:30']
const fixtures = Array.from({ length: 44 }, (_, i) => ({
  deal: 10000 + i, login: 810000 + i, symbol: 'EURUSD', action: 'BUY', volume: 1, price: 1.2,
  time: i < 17 ? formats[i % formats.length] : i === 17 ? epoch - 1 : i === 18 ? epoch + 1 : epoch - 120,
}))
const rawEpoch = value => {
  if (Number.isFinite(Number(value))) return Math.floor(Number(value) >= 1e10 ? Number(value) / 1000 : Number(value))
  // The mock has an independent wall-clock parser, not the implementation helper.
  if (/^12\/11\//.test(value)) return epoch
  return Date.parse(value.slice(0, 19).replaceAll('.', '-').replace(' ', 'T') + 'Z') / 1000
}
const calls = [], exceptions = [], held = []
let holdRequests = false, ws, send
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
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      if (request.url.startsWith(origin) && !url.pathname.startsWith('/api/')) return void send('Fetch.continueRequest', { requestId })
      const isApi = url.pathname.startsWith('/api/')
      const body = request.postData ? JSON.parse(request.postData) : {}
      calls.push({ path: url.pathname, body })
      let result = { clients: [], groups: [], positions: [], orders: [], exchanges: [], total: 0 }
      const isDeals = url.pathname.endsWith('/deals/search') && request.method === 'POST'
      if (url.pathname.endsWith('/credit')) result = { credit_limit: 100000, available_credit: 57000 }
      if (isDeals) {
        // HONOR from/to, unlike the positions mock. A shifted exact request loses
        // the visible record. Simulate an endpoint that does not support Time
        // column conditions; it must not receive them in candidate mode.
        let rows = fixtures.filter(row => rawEpoch(row.time) >= body.from && rawEpoch(row.time) <= body.to)
        if (body.filters?.some(filter => filter.field === 'time')) rows = []
        if (body.search) rows = rows.filter(row => row.symbol.toLowerCase().includes(body.search.toLowerCase()))
        for (const filter of body.filters || []) {
          if (filter.field === 'login') rows = rows.filter(row => filter.operator === 'in' ? filter.value.includes(row.login) : row.login === filter.value)
        }
        const limit = Math.min(7, body.limit || 15)
        result = { deals: rows.slice((body.page - 1) * limit, body.page * limit), pagination: { total: rows.length } }
      }
      const fulfill = () => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
        { name: 'Content-Type', value: isApi ? 'application/json' : 'application/javascript' },
        { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, OPTIONS' },
      ], body: Buffer.from(isApi ? JSON.stringify({ status: 'success', data: result }) : '').toString('base64') })
      if (holdRequests && isDeals) held.push(fulfill)
      else await fulfill()
    }
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTimezoneOverride', { timezoneId: process.env.TEST_TIMEZONE || 'Asia/Kolkata' })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    Date.now = () => Date.parse('2026-11-12T12:00:00Z');
    localStorage.setItem('access_token', 'synthetic-live-deal-test');
    localStorage.setItem('user_data', JSON.stringify({id:14, username:'deal-test', rights:[]}));
  ` })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const waitFor = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(50) }
    throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-2500)')}\nCalls: ${JSON.stringify(calls.slice(-5))}`)
  }
  const waitHeld = async count => {
    for (let i = 0; i < 100 && held.length < count; i++) await delay(30)
    assert.ok(held.length >= count, 'Applied query produced a held request')
  }
  const click = async expression => {
    const point = await evaluate(`(async () => {
      const element = ${expression};
      if (!element || element.disabled) throw new Error('Missing/disabled click target: ' + ${JSON.stringify(expression)});
      element.scrollIntoView({block:'center', inline:'center'});
      await new Promise(requestAnimationFrame);
      const r = element.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2};
    })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
  const selector = css => `document.querySelector(${JSON.stringify(css)})`
  const byText = (css, text) => `Array.from(document.querySelectorAll(${JSON.stringify(css)})).find(el => el.textContent.trim() === ${JSON.stringify(text)})`
  const pageInput = selector('input[aria-label="Current page"]')
  const bodyRows = `Array.from(document.querySelectorAll('[data-mobile-data-row="body"]')).filter(row => row.textContent.trim())`
  const times = `${bodyRows}.map(row => row.children[2].textContent.trim())`
  const logins = `${bodyRows}.map(row => Number(row.children[0].textContent.trim()))`
  const openTime = async () => {
    await click(selector('[data-mobile-data-row="header"] [aria-label="Filter Time"]'))
    await waitFor(`document.querySelector('[aria-label="Time filter menu"]')`)
  }
  const pickSecond = async second => {
    await click(selector('[aria-label^="FROM second:"]'))
    await click(byText('[aria-label="Select from second"] button', second))
  }
  const apply = () => click(byText('[aria-label="Time filter menu"] button', 'Apply'))
  const dealCalls = () => calls.filter(call => call.path.endsWith('/deals/search') && call.body.page)

  await send('Page.navigate', { url: origin + '/live-dealing' })
  await waitFor(`${bodyRows}.some(row => row.textContent.includes('810000'))`)
  assert.ok((await evaluate(times)).includes('12/11/2026 17:06:16'), 'Exact visible row before filtering')
  assert.equal(await evaluate(`${pageInput}.max`), '3')
  const overall = dealCalls().at(-1).body
  assert.equal(overall.from, Date.parse('2026-11-12T00:00:00Z') / 1000)
  assert.equal(overall.to, Date.parse('2026-11-12T23:59:59Z') / 1000)
  // Start on remote page 2; applying a condition must reset to local page 1.
  await click(`${pageInput}.parentElement.nextElementSibling`)
  await waitFor(`${pageInput}.value === '2' && ${bodyRows}.some(row => row.textContent.includes('810007'))`)
  await openTime()
  await click(selector('#mobile-column-filter-condition'))
  await click(byText('[role="option"] button', 'Equal'))
  await click(selector('#column-filter-FROM'))
  for (let i = 0; i < 120; i++) {
    const heading = await evaluate(`document.querySelector('#column-filter-calendar-FROM p').textContent`)
    if (heading === 'November 2026') break
    const direction = Date.parse('1 ' + heading) > Date.parse('2026-11-01') ? 'Previous' : 'Next'
    await click(selector(`#column-filter-calendar-FROM [aria-label="${direction} month"]`))
  }
  await click(byText('#column-filter-calendar-FROM button', '12'))
  for (const [part, choice] of [['hour', '17'], ['minute', '06'], ['second', '16']]) {
    await click(selector(`[aria-label^="FROM ${part}:"]`))
    await click(byText(`[aria-label="Select from ${part}"] button`, choice))
  }
  const beforePoll = dealCalls().length
  for (let i = 0; i < 100 && dealCalls().length === beforePoll; i++) await delay(30)
  assert.ok(dealCalls().length > beforePoll, 'Real poll rerender while draft is open')
  assert.equal(await evaluate(`document.querySelector('#column-filter-FROM').textContent.trim()`), '12/11/2026')
  assert.ok(await evaluate(`document.querySelector('[aria-label="FROM second: 16"]') !== null`))
  holdRequests = true
  const filterStart = calls.length
  await apply()
  await waitHeld(1)
  assert.equal(await evaluate(`${pageInput}.value`), '1')
  assert.deepEqual(await evaluate(times), [], 'No obsolete rows while candidate scan is pending')
  holdRequests = false
  for (const fulfill of held.splice(0)) await fulfill().catch(() => {})
  await waitFor(`${bodyRows}.length === 15 && ${pageInput}.max === '2'`)
  assert.deepEqual(await evaluate(times), Array(15).fill('12/11/2026 17:06:16'))
  assert.deepEqual(await evaluate(logins), fixtures.slice(0, 15).map(row => row.login))
  const filteredCalls = calls.slice(filterStart).filter(call => call.path.endsWith('/deals/search') && call.body.page)
  for (const { body } of filteredCalls) {
    assert.equal(body.from, overall.from); assert.equal(body.to, overall.to)
    assert.equal(body.filters, undefined, 'No unsupported Time condition sent')
  }
  assert.ok([1, 2, 3, 4, 5, 6, 7].every(page => filteredCalls.some(call => call.body.page === page)), 'All seven server-capped pages collected')
  assert.equal(filteredCalls.find(call => call.body.page === 1).body.limit, 500, 'Complete scan starts at verified larger batch size')
  const beforeLocalPage = dealCalls().length
  await click(`${pageInput}.parentElement.nextElementSibling`)
  await waitFor(`${pageInput}.value === '2' && ${bodyRows}.length === 2`)
  assert.deepEqual(await evaluate(logins), fixtures.slice(15, 17).map(row => row.login))
  assert.equal(dealCalls().length, beforeLocalPage, 'Local page change does not restart a candidate scan')
  console.log('PASS real mobile /live-dealing Equal 12/11/2026 17:06:16: 17 matches across seven API pages; 15+2 local pages; original period retained')

  // Hold one query, apply a newer query, then release the obsolete response last.
  await openTime()
  assert.equal(await evaluate(`document.querySelector('#mobile-column-filter-condition').textContent.trim()`), 'Equal')
  assert.ok(await evaluate(`document.querySelector('[aria-label="FROM second: 16"]') !== null`))
  await pickSecond('15')
  holdRequests = true
  await apply()
  await waitHeld(1)
  await openTime()
  await pickSecond('17')
  await apply()
  await waitHeld(2)
  holdRequests = false
  await held.pop()()
  await waitFor(`${bodyRows}.length === 1 && ${bodyRows}[0].textContent.includes('810018')`)
  for (const fulfill of held.splice(0)) await fulfill().catch(() => {})
  const pollStart = dealCalls().length
  await delay(2500)
  assert.equal(dealCalls().length, pollStart, 'Complete scans no longer repeat every two seconds')
  for (let i = 0; i < 400 && dealCalls().length === pollStart; i++) await delay(30)
  assert.ok(dealCalls().length > pollStart, 'Polling continues with latest condition')
  await waitFor(`${bodyRows}.length === 1 && ${bodyRows}[0].textContent.includes('810018')`)
  assert.deepEqual(await evaluate(times), ['12/11/2026 17:06:17'])
  console.log('PASS reopen preserves exact draft; newer filter beats delayed old response; polling uses latest predicate')

  await openTime()
  await pickSecond('14')
  await apply()
  await waitFor(`document.body.textContent.includes('No deals available') && ${pageInput}.max === '1'`)
  assert.deepEqual(await evaluate(times), [])
  await openTime()
  await click(byText('[aria-label="Time filter menu"] button', 'Reset'))
  await waitFor(`${bodyRows}.length === 7 && ${pageInput}.max === '3'`)
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions))
  console.log('PASS zero matches count 0/pages 1, Reset restores remote pagination; no uncaught browser exceptions')
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {})
  ws?.close()
  browser.kill()
  await new Promise(done => server.close(done))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}