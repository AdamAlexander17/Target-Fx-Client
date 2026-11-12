import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, extname, sep } from 'node:path'

// Run after npm run build. Mount the real /positions route, not extracted helpers.
// Every API/external request is mocked; no production credentials/data are used.
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
const profile = await mkdtemp(join(tmpdir(), 'brokereye-position-time-'))
const browser = spawn(process.env.TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(done => setTimeout(done, ms))
const epoch = Date.parse('2026-11-06T22:54:59Z') / 1000
const wrongEpoch = Date.parse('2026-11-10T07:31:13Z') / 1000
const formats = [epoch, String(epoch), epoch + 0.999, String(epoch * 1000 + 999), '2026.11.06 22:54:59', '06/11/2026 22:54:59', '2026-11-06T22:54:59+05:30']
const fixtures = Array.from({ length: 40 }, (_, i) => ({
  position: 10000 + i, login: 810000 + i, symbol: 'EURUSD', action: 0,
  timeUpdate: i < 17 ? formats[i % formats.length] : i === 17 ? epoch - 1 : i === 18 ? epoch + 1 : i === 39 ? '2026.11.12 04:08:24' : wrongEpoch,
  timeCreate: wrongEpoch, volume: 1, priceOpen: 1.2, profit: 10,
}))
const calls = []
const exceptions = []
const held = []
let holdFiltered = false
let ws
let send

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
      calls.push({ path: url.pathname, body, method: request.method })
      let result = { clients: [], groups: [], positions: [], orders: [], exchanges: [], total: 0 }
      const regularSearch = request.method === 'POST' && url.pathname.endsWith('/positions/search') && !body.clientNet && !body.netPosition
      const unsupportedTime = regularSearch && body.filters?.some(filter => ['timeUpdate', 'timeCreate', 'updated'].includes(filter.field))
      if (url.pathname.endsWith('/credit')) result = { credit_limit: 100000, available_credit: 57000 }
      if (regularSearch) {
        // Reject unsupported Time conditions; ignore other conditions and cap pages.
        const limit = Math.min(7, body.limit || 15)
        result = { positions: fixtures.slice((body.page - 1) * limit, body.page * limit), total: fixtures.length }
      }
      const fulfill = () => send('Fetch.fulfillRequest', { requestId, responseCode: unsupportedTime ? 400 : 200, responseHeaders: [
        { name: 'Content-Type', value: isApi ? 'application/json' : 'application/javascript' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Access-Control-Allow-Headers', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, OPTIONS' },
      ], body: Buffer.from(isApi ? JSON.stringify({ status: 'success', data: result }) : '').toString('base64') })
      if (holdFiltered && regularSearch) held.push(fulfill)
      else await fulfill()
    }
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTimezoneOverride', { timezoneId: process.env.TEST_TIMEZONE || 'Asia/Kolkata' })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('access_token', 'synthetic-position-test');
    localStorage.setItem('user_data', JSON.stringify({id:14, username:'position-test', rights:[]}));
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
  // Scroll and dispatch real pointer/mouse events so outside-click handlers run too.
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
  const bodyRows = `Array.from(document.querySelectorAll('[data-mobile-data-row="body"]'))`
  const times = `${bodyRows}.map(row => row.children[1].textContent.trim())`
  const logins = `${bodyRows}.map(row => Number(row.children[0].textContent.trim()))`
  const readPage = () => evaluate(`({page:Number(${pageInput}.value), pages:Number(${pageInput}.max)})`)
  const openTime = async () => {
    await click(selector('[data-mobile-data-row="header"] [aria-label="Filter Time"]'))
    await waitFor(`document.querySelector('[aria-label="Time filter menu"]')`)
  }
  const pickSecond = async second => {
    await click(selector('[aria-label^="FROM second:"]'))
    await click(byText('[aria-label="Select from second"] button', second))
  }
  const apply = () => click(byText('[aria-label="Time filter menu"] button', 'Apply'))

  await send('Page.navigate', { url: origin + '/positions' })
  await waitFor(`document.querySelector('button[title="Exchange-wise NET Position"]')`)
  await click(selector('button[title="Exchange-wise NET Position"]'))
  await waitFor(`${bodyRows}.some(row => row.textContent.includes('810000'))`)
  assert.deepEqual(await readPage(), { page: 1, pages: 3 })
  // Begin on server page 2 to exercise page reset on Apply.
  await click(`${pageInput}.parentElement.nextElementSibling`)
  await waitFor(`${pageInput}.value === '2' && ${bodyRows}.some(row => row.textContent.includes('810007'))`)
  console.log('PASS real /positions route mounted regular mobile table (not NET), initial server pagination')

  await openTime()
  await click(selector('#mobile-column-filter-condition'))
  await click(byText('[role="option"] button', 'Equal'))
  await click(selector('#column-filter-FROM'))
  // Navigate the real calendar; independent of the day/month this test is run.
  for (let i = 0; i < 120; i++) {
    const heading = await evaluate(`document.querySelector('#column-filter-calendar-FROM p').textContent`)
    if (heading === 'November 2026') break
    const direction = Date.parse('1 ' + heading) > Date.parse('2026-11-01') ? 'Previous' : 'Next'
    await click(selector(`#column-filter-calendar-FROM [aria-label="${direction} month"]`))
  }
  await click(byText('#column-filter-calendar-FROM button', '6'))
  for (const [part, choice] of [['hour', '22'], ['minute', '54'], ['second', '59']]) {
    await click(selector(`[aria-label^="FROM ${part}:"]`))
    await click(byText(`[aria-label="Select from ${part}"] button`, choice))
  }
  // Allow at least one real 2-second poll/parent rerender while the draft is open.
  const beforePoll = calls.filter(call => call.path.endsWith('/positions/search')).length
  for (let i = 0; i < 80 && calls.filter(call => call.path.endsWith('/positions/search')).length === beforePoll; i++) await delay(50)
  assert.ok(calls.filter(call => call.path.endsWith('/positions/search')).length > beforePoll, 'A poll rerender occurred during editing')
  assert.equal(await evaluate(`document.querySelector('#column-filter-FROM').textContent.trim()`), '06/11/2026')
  assert.equal(await evaluate(`document.querySelector('[aria-label="FROM second: 59"]') !== null`), true)
  holdFiltered = true
  const filterStart = calls.length
  await apply()
  await waitFor(`!document.querySelector('[aria-label="Time filter menu"]') && ${pageInput}.value === '1'`)
  for (let i = 0; i < 100 && !held.length; i++) await delay(20)
  assert.ok(held.length, 'Real Apply produced an API request')
  assert.equal(calls.slice(filterStart).find(call => call.method === 'POST' && call.path.endsWith('/positions/search'))?.body.filters,
    undefined, 'Candidate request excludes unsupported Time conditions')
  assert.deepEqual(await evaluate(times), [], 'No obsolete unfiltered rows while filtered request is pending')
  holdFiltered = false
  for (const fulfill of held.splice(0)) await fulfill()
  await waitFor(`${bodyRows}.length === 15 && ${pageInput}.max === '2'`)
  assert.deepEqual(await evaluate(times), Array(15).fill('06/11/2026 22:54:59'))
  assert.deepEqual(await evaluate(logins), fixtures.slice(0, 15).map(row => row.login))
  assert.deepEqual(await readPage(), { page: 1, pages: 2 })
  const pages = calls.slice(filterStart).filter(call => call.method === 'POST' && call.path.endsWith('/positions/search')).map(call => call.body.page)
  assert.ok([1, 2, 3, 4, 5, 6].every(page => pages.includes(page)), 'Collected all six capped server pages')
  await click(`${pageInput}.parentElement.nextElementSibling`)
  await waitFor(`${pageInput}.value === '2' && ${bodyRows}.length === 2`)
  assert.deepEqual(await evaluate(logins), fixtures.slice(15, 17).map(row => row.login))
  assert.deepEqual(await evaluate(times), Array(2).fill('06/11/2026 22:54:59'))
  console.log('PASS Equal => all 17 duplicate-second matches, 15+2 rows; API rejects Time filters and caps at 7')

  await openTime()
  assert.equal(await evaluate(`document.querySelector('#mobile-column-filter-condition').textContent.trim()`), 'Equal')
  assert.equal(await evaluate(`document.querySelector('#column-filter-FROM').textContent.trim()`), '06/11/2026')
  assert.ok(await evaluate(`Boolean(document.querySelector('[aria-label="FROM hour: 22"]') && document.querySelector('[aria-label="FROM minute: 54"]') && document.querySelector('[aria-label="FROM second: 59"]'))`))
  await pickSecond('58')
  await apply()
  await waitFor(`${bodyRows}.length === 1 && ${bodyRows}[0].textContent.includes('810017')`)
  assert.deepEqual(await evaluate(times), ['06/11/2026 22:54:58'])
  assert.deepEqual(await readPage(), { page: 1, pages: 1 })
  console.log('PASS reopen preserves exact condition/date/hour/minute/second; editing second => one genuine match and 1/1 pagination')

  // Verify every condition through the real menu and compare ALL local pages.
  for (const [condition, indices] of [
    ['Not Equal', [17, 18, ...Array.from({ length: 21 }, (_, i) => i + 19)]],
    ['Before Or At', [17, ...Array.from({ length: 17 }, (_, i) => i)]],
    ['After Or At', [...Array.from({ length: 17 }, (_, i) => i), 18, ...Array.from({ length: 21 }, (_, i) => i + 19)]],
    ['Between', [...Array.from({ length: 17 }, (_, i) => i), 18]],
  ]) {
    await openTime()
    await click(selector('#mobile-column-filter-condition'))
    await click(byText('[role="option"] button', condition))
    await pickSecond('59')
    if (condition === 'Between') {
      await click(selector('#column-filter-TO'))
      for (let i = 0; i < 120; i++) {
        const heading = await evaluate(`document.querySelector('#column-filter-calendar-TO p').textContent`)
        if (heading === 'November 2026') break
        const direction = Date.parse('1 ' + heading) > Date.parse('2026-11-01') ? 'Previous' : 'Next'
        await click(selector(`#column-filter-calendar-TO [aria-label="${direction} month"]`))
      }
      await click(byText('#column-filter-calendar-TO button', '6'))
      for (const [part, choice] of [['hour', '22'], ['minute', '55'], ['second', '00']]) {
        await click(selector(`[aria-label^="TO ${part}:"]`))
        await click(byText(`[aria-label="Select to ${part}"] button`, choice))
      }
    }
    await apply()
    const expected = indices.map(i => fixtures[i].login)
    const pageCount = Math.ceil(expected.length / 15)
    await waitFor(`${pageInput}.value === '1' && ${pageInput}.max === '${pageCount}' && JSON.stringify(${logins}) === ${JSON.stringify(JSON.stringify(expected.slice(0, 15)))}`)
    const actual = await evaluate(logins)
    for (let page = 2; page <= pageCount; page++) {
      await click(`${pageInput}.parentElement.nextElementSibling`)
      await waitFor(`${pageInput}.value === '${page}' && JSON.stringify(${logins}) === ${JSON.stringify(JSON.stringify(expected.slice((page - 1) * 15, page * 15)))}`)
      actual.push(...await evaluate(logins))
    }
    assert.deepEqual(actual, expected, condition)
    console.log(`PASS ${condition}: ${expected.length} genuine matches across ${pageCount} local pages`)
  }

  await openTime()
  await click(selector('#mobile-column-filter-condition'))
  await click(byText('[role="option"] button', 'Equal'))
  await pickSecond('57')
  await apply()
  await waitFor(`document.body.textContent.includes('No positions match the applied filters')`)
  assert.deepEqual(await evaluate(times), [])
  assert.deepEqual(await readPage(), { page: 1, pages: 1 })
  await openTime()
  await click(byText('[aria-label="Time filter menu"] button', 'Reset'))
  await waitFor(`${bodyRows}.some(row => row.textContent.includes('810000')) && ${pageInput}.max === '3'`)
  assert.deepEqual(await readPage(), { page: 1, pages: 3 })
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
  for (const [part, choice] of [['hour', '04'], ['minute', '08'], ['second', '24']]) {
    await click(selector(`[aria-label^="FROM ${part}:"]`))
    await click(byText(`[aria-label="Select from ${part}"] button`, choice))
  }
  await apply()
  await waitFor(`${bodyRows}.length === 1 && ${bodyRows}[0].textContent.includes('810039')`)
  assert.deepEqual(await evaluate(times), ['12/11/2026 04:08:24'])
  assert.deepEqual(await readPage(), { page: 1, pages: 1 })
  console.log('PASS user example Equal 12/11/2026 04:08:24 => one genuine row')
  assert.equal(calls.some(call => call.method === 'POST' && call.path.endsWith('/positions/search')
    && call.body.filters?.some(filter => ['timeUpdate', 'timeCreate', 'updated'].includes(filter.field))), false)
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions))
  console.log('PASS zero matches fail closed, Reset restores server pagination, no uncaught browser exceptions')
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {})
  ws?.close()
  browser.kill()
  await new Promise(done => server.close(done))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}