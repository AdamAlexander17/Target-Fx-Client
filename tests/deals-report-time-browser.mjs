import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, extname, sep } from 'node:path'

// Run after npm run build. Real /reports/deals, synthetic auth, no live API.
const root = resolve('dist')
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
  if (!path.startsWith(root + sep)) return void res.writeHead(403).end()
  try {
    const file = extname(path) ? path : join(root, 'index.html')
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': { '.js': 'application/javascript', '.css': 'text/css' }[extname(file)] || 'text/html' }).end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(join(tmpdir(), 'deals-report-time-'))
const browser = spawn(process.env.TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(done => setTimeout(done, ms))
const epoch = Date.parse('2026-11-12T17:49:30Z') / 1000
const representations = [epoch, String(epoch), epoch * 1000 + 999, String(epoch * 1000 + 999),
  '2026.11.12 17:49:30', '12/11/2026 17:49:30', '2026-11-12T17:49:30+05:30']
const fixtures = Array.from({ length: 44 }, (_, i) => ({
  deal: 10000 + i, login: 810000 + i, symbol: 'EURUSD', action: 'BUY', volume: 1, price: 1.2,
  name: i < 20 ? (i % 2 ? 'DEMO120' : 'DEMO 123') : i === 36 || i === 37 ? 'Other' : i % 2 ? ' demo 12 ' : 'DEMO 12',
  time: i < 20 ? epoch - 120 : i < 37 ? representations[(i - 20) % representations.length] : i === 37 ? epoch - 1 : epoch + 1,
}))
const rawSecond = value => {
  if (Number.isFinite(Number(value))) return Math.floor(Number(value) >= 1e10 ? Number(value) / 1000 : Number(value))
  if (/^12\/11\//.test(value)) return epoch
  return Date.parse(value.slice(0, 19).replaceAll('.', '-').replace(' ', 'T') + 'Z') / 1000
}
const calls = [], exceptions = [], held = []
let hold = false, ws, send
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
      const isDeals = url.pathname.endsWith('/deals/search') && request.method === 'POST'
      let result = { clients: [], groups: [], positions: [], orders: [], exchanges: [], total: 0 }
      if (url.pathname.endsWith('/credit')) result = { credit_limit: 100000, available_credit: 57000 }
      if (isDeals) {
        calls.push(body)
        let rows = fixtures.filter(row => rawSecond(row.time) >= body.from && rawSecond(row.time) <= body.to)
        // Ignore Name conditions (the reported failure); reject other unsupported
        // column conditions. Only base search/login/module controls are reliable.
        if (body.filters?.some(f => !['login', 'action', 'name'].includes(f.field))) rows = []
        if (body.search) rows = rows.filter(r => r.symbol.includes(body.search))
        for (const f of body.filters || []) {
          if (f.field === 'login') rows = rows.filter(r => f.operator === 'in' ? f.value.includes(r.login) : r.login === f.value)
          if (f.field === 'action') rows = rows.filter(r => f.operator === 'in' ? f.value.includes(r.action) : r.action !== f.value)
        }
        const limit = Math.min(7, body.limit)
        result = { deals: rows.slice((body.page - 1) * limit, body.page * limit), pagination: { total: rows.length } }
      }
      const fulfill = () => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
        { name: 'Content-Type', value: isApi ? 'application/json' : 'application/javascript' },
        { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, OPTIONS' },
      ], body: Buffer.from(isApi ? JSON.stringify({ status: 'success', data: result }) : '').toString('base64') })
      if (hold && isDeals) held.push(fulfill)
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
    localStorage.setItem('access_token', 'synthetic-report-test');
    localStorage.setItem('user_data', JSON.stringify({id:14, username:'report-test', rights:[]}));
    globalThis.exportedBlobs = [];
    const createURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { blob.text().then(text => exportedBlobs.push(text)); return createURL(blob); };
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { if (!this.download) anchorClick.call(this); };
  ` })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const waitFor = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(50) }
    throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-2500)')}\n${JSON.stringify(calls.slice(-3))}`)
  }
  const click = async expression => {
    const point = await evaluate(`(async () => {
      const el = ${expression}; if (!el || el.disabled) throw new Error('Missing/disabled: '+${JSON.stringify(expression)});
      el.scrollIntoView({block:'center', inline:'center'}); await new Promise(requestAnimationFrame);
      const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
  const selector = css => `document.querySelector(${JSON.stringify(css)})`
  const byText = (css, text) => `Array.from(document.querySelectorAll(${JSON.stringify(css)})).find(el => el.textContent.replace('✓', '').trim() === ${JSON.stringify(text)})`
  const rows = `Array.from(document.querySelectorAll('[data-mobile-data-row="body"]')).filter(r => r.textContent.trim())`
  const times = `${rows}.map(r => r.children[2].textContent.trim())`
  const names = `${rows}.map(r => r.children[3].textContent.trim().toLowerCase())`
  const pageInput = selector('input[aria-label="Current page"]')
  const openTime = async () => {
    await click(selector('[data-mobile-data-row="header"] [aria-label="Filter Time"]'))
    await waitFor(`document.querySelector('[aria-label="Time filter menu"]')`)
  }
  const pickSecond = async second => {
    await click(selector('[aria-label^="FROM second:"]'))
    await click(byText('[aria-label="Select from second"] button', second))
  }
  const apply = () => click(byText('[aria-label="Time filter menu"] button', 'Apply'))
  const openName = async () => {
    await click(selector('[data-mobile-data-row="header"] [aria-label="Filter Name"]'))
    await waitFor(`document.querySelector('[aria-label="Name filter menu"]')`)
  }
  const setName = async (label, value) => {
    await openName()
    await click(selector('#mobile-column-filter-condition'))
    await waitFor(byText('[role="option"] button', label))
    await click(byText('[role="option"] button', label))
    await evaluate(`(() => {
      const input = document.querySelector('[aria-label="Name filter menu"] input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    await click(byText('[aria-label="Name filter menu"] button', 'Apply'))
  }
  const resetName = async () => {
    await openName()
    await click(byText('[aria-label="Name filter menu"] button', 'Reset'))
  }
  const waitHeld = async count => {
    for (let i = 0; i < 100 && held.length < count; i++) await delay(30)
    assert.ok(held.length >= count)
  }
  await send('Page.navigate', { url: origin + '/reports/deals' })
  await waitFor(`${rows}.length === 7 && ${pageInput}.max === '3'`)
  const overall = calls.at(-1)
  assert.equal(overall.from, Date.parse('2026-11-12T00:00:00Z') / 1000)
  assert.equal(overall.to, Date.parse('2026-11-12T23:59:59Z') / 1000)
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${pageInput}.value === '2' && ${rows}.some(r => r.textContent.includes('810007'))`)
  const nameStart = calls.length
  await setName('Equal', ' DEMO 12 ')
  await waitFor(`${rows}.length === 15 && ${pageInput}.value === '1' && ${pageInput}.max === '2'`)
  assert.deepEqual(await evaluate(names), Array(15).fill('demo 12'))
  assert.deepEqual(calls.slice(nameStart).map(c => c.page), [1, 2, 3, 4, 5, 6, 7])
  for (const body of calls.slice(nameStart)) {
    assert.equal(body.filters, undefined, 'No unsupported column conditions sent')
    assert.equal(body.from, overall.from); assert.equal(body.to, overall.to)
  }
  const nameLocalStart = calls.length
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${rows}.length === 7 && ${pageInput}.value === '2'`)
  assert.deepEqual(await evaluate(names), Array(7).fill('demo 12'))
  assert.equal(calls.length, nameLocalStart)
  await click(selector('[aria-label="Export deals"]'))
  await waitFor('globalThis.exportedBlobs.length === 1')
  const nameCsv = await evaluate('globalThis.exportedBlobs.at(-1)')
  assert.equal(nameCsv.trim().split(/\r?\n/).length - 2, 22)
  assert.ok(!nameCsv.includes('DEMO120') && !nameCsv.includes('DEMO 123') && !nameCsv.includes('Other'))
  await resetName()
  await waitFor(`${rows}.length === 7 && ${pageInput}.value === '1' && ${pageInput}.max === '3'`)
  assert.equal(calls.at(-1).limit, 15)
  console.log('PASS Name Equal alone: only trimmed case-insensitive DEMO 12, 22 late-page matches, local pages, full CSV, Reset')
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
  for (const [part, choice] of [['hour', '17'], ['minute', '49'], ['second', '30']]) {
    await click(selector(`[aria-label^="FROM ${part}:"]`))
    await click(byText(`[aria-label="Select from ${part}"] button`, choice))
  }
  hold = true
  const start = calls.length
  await apply()
  await waitHeld(1)
  assert.equal(await evaluate(`${pageInput}.value`), '1')
  assert.deepEqual(await evaluate(times), [], 'No obsolete rows while loading')
  hold = false
  for (const fulfill of held.splice(0)) await fulfill().catch(() => {})
  await waitFor(`${rows}.length === 15 && ${pageInput}.max === '2'`)
  assert.deepEqual(await evaluate(times), Array(15).fill('12/11/2026 17:49:30'))
  const scan = calls.slice(start)
  assert.deepEqual(scan.map(c => c.page), [1, 2, 3, 4, 5, 6, 7])
  for (const body of scan) {
    assert.equal(body.from, overall.from); assert.equal(body.to, overall.to)
    assert.equal(body.filters, undefined)
  }
  const localStart = calls.length
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${pageInput}.value === '2' && ${rows}.length === 2`)
  assert.equal(calls.length, localStart, 'Local page changes do not refetch')
  assert.deepEqual(await evaluate(times), Array(2).fill('12/11/2026 17:49:30'))
  console.log('PASS /reports/deals exact selected second, late matches across seven capped API pages, 15+2 local pages, unchanged period')

  await setName('Equal', 'demo 12')
  await waitFor(`${rows}.length === 15 && ${pageInput}.value === '1' && ${pageInput}.max === '2'`)
  assert.deepEqual(await evaluate(names), Array(15).fill('demo 12'))
  assert.deepEqual(await evaluate(times), Array(15).fill('12/11/2026 17:49:30'))
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${rows}.length === 1 && ${pageInput}.value === '2'`)
  assert.deepEqual(await evaluate(names), ['demo 12'])
  assert.deepEqual(await evaluate(times), ['12/11/2026 17:49:30'])
  const combinedExports = await evaluate('globalThis.exportedBlobs.length')
  await click(selector('[aria-label="Export deals"]'))
  await waitFor(`globalThis.exportedBlobs.length > ${combinedExports}`)
  const combinedCsv = await evaluate('globalThis.exportedBlobs.at(-1)')
  assert.equal(combinedCsv.trim().split(/\r?\n/).length - 2, 16)
  assert.equal((combinedCsv.match(/17:49:30/g) || []).length, 16)
  await resetName()
  await waitFor(`${rows}.length === 15 && ${pageInput}.value === '1'`)
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${rows}.length === 2 && ${pageInput}.value === '2'`)
  console.log('PASS cumulative Time + Name, 16 exact matches, complete filtered CSV, individual Reset retains Time')

  // Export while on local page 2: the CSV must contain all 17 matching rows.
  const exportStart = calls.length
  const timeExports = await evaluate('globalThis.exportedBlobs.length')
  await click(selector('[aria-label="Export deals"]'))
  await waitFor(`globalThis.exportedBlobs.length > ${timeExports}`)
  const csv = await evaluate('globalThis.exportedBlobs.at(-1)')
  assert.equal((csv.match(/17:49:30/g) || []).length, 17)
  assert.ok(!csv.includes('17:49:29') && !csv.includes('17:49:31'))
  assert.deepEqual(calls.slice(exportStart).map(c => c.page), [1, 2, 3, 4, 5, 6, 7])
  console.log('PASS actual CSV export includes all 17 matches, not just current page')

  const search = async text => {
    await evaluate(`(() => {
      const input = document.querySelector('[aria-label="Search deals"]');
      input.removeAttribute('readonly');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    for (let i = 0; i < 100; i++) {
      const body = calls.at(-1)
      if (/^\d+$/.test(text) ? body?.filters?.some(f => f.field === 'login' && f.value === Number(text))
        : text ? body?.search === text : body?.search == null) return
      await delay(30)
    }
    throw new Error('Search did not reach API: ' + text)
  }
  await search('810020')
  await waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes('810020')`)
  assert.deepEqual(calls.at(-1).filters, [{ field: 'login', operator: 'equal', value: 810020 }])
  await search('NO_MATCH')
  await waitFor(`document.body.textContent.includes('No deals found') && document.querySelector('[aria-label="Export deals"]').disabled`)
  assert.equal(calls.at(-1).search, 'NO_MATCH')
  await search('EUR')
  await waitFor(`${rows}.length === 15 && ${pageInput}.max === '2'`)
  assert.equal(calls.at(-1).search, 'EUR')
  await click(byText('button', 'Money'))
  await waitFor(`document.body.textContent.includes('No deals found')`)
  assert.deepEqual(calls.at(-1).filters.map(f => f.value), ['BUY', 'SELL'])
  await click(byText('button', 'Deal'))
  await waitFor(`${rows}.length === 15 && ${pageInput}.max === '2'`)
  assert.deepEqual(calls.at(-1).filters, [{ field: 'action', operator: 'in', value: ['BUY', 'SELL'] }])
  await click(byText('button', 'Both'))
  await search('')
  await waitFor(`${rows}.length === 15 && ${pageInput}.max === '2'`)
  console.log('PASS Time intersects numeric login search, symbol search and Deal/Money controls')

  await openTime()
  await pickSecond('29')
  hold = true
  await apply()
  await waitHeld(1)
  await openTime()
  await pickSecond('31')
  await apply()
  await waitHeld(2)
  hold = false
  await held.pop()()
  await waitFor(`${rows}.length === 6 && ${rows}.every(r => r.textContent.includes('17:49:31'))`)
  for (const fulfill of held.splice(0)) await fulfill().catch(() => {})
  await delay(200)
  assert.deepEqual(await evaluate(times), Array(6).fill('12/11/2026 17:49:31'))
  console.log('PASS newer Time filter wins over delayed obsolete scan')

  const condition = async label => {
    await click(selector('#mobile-column-filter-condition'))
    await click(byText('[role="option"] button', label))
  }
  for (const [label, count, pages] of [['Not Equal', 27, '2'], ['Before Or At', 38, '3'], ['After Or At', 23, '2']]) {
    await openTime()
    await condition(label)
    await pickSecond('30')
    await apply()
    await waitFor(`${rows}.length === 15 && ${pageInput}.max === '${pages}'`)
    const visible = await evaluate(times)
    assert.ok(visible.every(t => label === 'Not Equal' ? t !== '12/11/2026 17:49:30'
      : label === 'Before Or At' ? t <= '12/11/2026 17:49:30' : t >= '12/11/2026 17:49:30'))
    // CSV verifies the full count, independently of table page size.
    const exported = await evaluate('globalThis.exportedBlobs.length')
    await click(selector('[aria-label="Export deals"]'))
    await waitFor(`globalThis.exportedBlobs.length > ${exported}`)
    const text = await evaluate('globalThis.exportedBlobs.at(-1)')
    assert.equal(text.trim().split(/\r?\n/).length - 2, count, label)
  }
  await openTime()
  await condition('Between')
  await pickSecond('30')
  await click(selector('#column-filter-TO'))
  for (let i = 0; i < 120; i++) {
    const heading = await evaluate(`document.querySelector('#column-filter-calendar-TO p').textContent`)
    if (heading === 'November 2026') break
    const direction = Date.parse('1 ' + heading) > Date.parse('2026-11-01') ? 'Previous' : 'Next'
    await click(selector(`#column-filter-calendar-TO [aria-label="${direction} month"]`))
  }
  await click(byText('#column-filter-calendar-TO button', '12'))
  for (const [part, choice] of [['hour', '17'], ['minute', '49'], ['second', '31']]) {
    await click(selector(`[aria-label^="TO ${part}:"]`))
    await click(byText(`[aria-label="Select to ${part}"] button`, choice))
  }
  await apply()
  await waitFor(`${rows}.length === 15 && ${pageInput}.max === '2'`)
  assert.deepEqual(await evaluate(times), [...Array(6).fill('12/11/2026 17:49:31'), ...Array(9).fill('12/11/2026 17:49:30')])
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${rows}.length === 8 && ${pageInput}.value === '2'`)
  assert.deepEqual(await evaluate(times), Array(8).fill('12/11/2026 17:49:30'))
  console.log('PASS Not Equal, Before/After Or At and inclusive Between; full filtered export counts')

  await openTime()
  await condition('Equal')
  await pickSecond('28')
  await apply()
  await waitFor(`document.body.textContent.includes('No deals found') && ${pageInput}.max === '1'`)
  await openTime()
  await click(byText('[aria-label="Time filter menu"] button', 'Reset'))
  await waitFor(`${rows}.length === 7 && ${pageInput}.max === '3'`)
  assert.equal(calls.at(-1).limit, 15)

  for (const [label, predicate] of [
    ['Contains', name => name.includes('demo 12')],
    ['Starts With', name => name.startsWith('demo 12')],
    ['Ends With', name => name.endsWith('demo 12')],
    ['Does Not Contain', name => !name.includes('demo 12')],
  ]) {
    await setName(label, 'demo 12')
    const expected = fixtures.filter(r => predicate(r.name.trim().toLowerCase()))
    await waitFor(`${rows}.length === ${Math.min(15, expected.length)} && ${pageInput}.max === '${Math.ceil(expected.length / 15)}'`)
    assert.ok((await evaluate(names)).every(predicate), label)
    const before = await evaluate('globalThis.exportedBlobs.length')
    await click(selector('[aria-label="Export deals"]'))
    await waitFor(`globalThis.exportedBlobs.length > ${before}`)
    assert.equal((await evaluate('globalThis.exportedBlobs.at(-1)')).trim().split(/\r?\n/).length - 2, expected.length, label)
  }
  await resetName()
  await waitFor(`${rows}.length === 7 && ${pageInput}.max === '3'`)
  console.log('PASS Name Contains/Starts/Ends/Does Not Contain and full export counts; Reset restores server pages')
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions))
  console.log('PASS zero count and Reset restores ordinary server pagination; no uncaught exceptions')
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {})
  ws?.close(); browser.kill()
  await new Promise(done => server.close(done))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}