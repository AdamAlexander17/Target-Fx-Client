import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, extname, sep } from 'node:path'
import { apiTimeSecond } from '../src/utils/dateFormatter.js'

// Built application, actual Credit route/menu/service; synthetic auth and API only.
const root = resolve('dist')
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
  if (!path.startsWith(root + sep)) return void res.writeHead(403).end()
  try {
    const file = extname(path) ? path : join(root, 'index.html')
    res.writeHead(200, { 'Content-Type': { '.js': 'application/javascript', '.css': 'text/css' }[extname(file)] || 'text/html' }).end(await readFile(file))
  } catch { res.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(join(tmpdir(), 'credit-report-time-'))
const browser = spawn(process.env.TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(done => setTimeout(done, ms))
const second = Date.parse('2026-11-12T09:32:24Z') / 1000
const representations = [second, String(second), second * 1000 + 999, String(second * 1000 + 700),
  '2026.11.12 09:32:24', '12/11/2026 09:32:24', '2026-11-12T09:32:24+05:30', '2026-11-12T09:32:24Z']
const aliases = ['time', 'Time', 'timeStr', 'dealTime', 'deal_time', 'timestamp', 'timestampStr', 'date']
const fixtures = Array.from({ length: 144 }, (_, i) => ({
  login: 810000 + i, deal: 10000 + i, name: 'Alice', amount: 10, comment: 'credit',
  [aliases[i % aliases.length]]: i < 20 ? second - 120 : i < 127 ? representations[(i - 20) % representations.length]
    : i === 127 ? second - 1 : second + 1,
}))
const rowSecond = row => apiTimeSecond(aliases.map(key => row[key]).find(value => value != null))
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
      const call = pending.get(message.id); pending.delete(message.id)
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const url = new URL(request.url)
      if (request.url.startsWith(origin) && !url.pathname.startsWith('/api/')) return void send('Fetch.continueRequest', { requestId })
      const body = request.postData ? JSON.parse(request.postData) : {}
      const isApi = url.pathname.startsWith('/api/')
      const isCredit = url.pathname.endsWith('/reports/credit') && request.method === 'POST'
      let result = { clients: [], groups: [], positions: [], orders: [], exchanges: [], total: 0 }
      if (url.pathname.endsWith('/saved-filters')) result = { filters: [{ name: 'Credit candidates', loginIds: ['810020', '810128'] }] }
      if (url.pathname.endsWith('/credit') && !isCredit) result = { credit_limit: 100000, available_credit: 57000 }
      if (isCredit) {
        calls.push(body)
        let rows = fixtures.filter(row => rowSecond(row) >= body.from && rowSecond(row) <= body.to)
        if (body.filters?.some(f => f.field === 'time')) rows = []
        if (body.search) rows = rows.filter(r => `${r.login} ${r.name}`.includes(body.search))
        if (body.accountRangeMin) rows = rows.filter(r => r.login >= body.accountRangeMin && r.login <= body.accountRangeMax)
        for (const f of body.filters || []) {
          if (f.field === 'login') rows = rows.filter(r => f.operator === 'in' ? f.value.includes(r.login) : r.login === f.value)
          if (f.field === 'name') rows = rows.filter(r => r.name === f.value)
        }
        const limit = Math.min(7, body.limit)
        result = { credits: rows.slice((body.page - 1) * limit, body.page * limit), pagination: { total: rows.length } }
      }
      const fulfill = () => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
        { name: 'Content-Type', value: isApi ? 'application/json' : 'application/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, OPTIONS' },
      ], body: Buffer.from(isApi ? JSON.stringify({ status: 'success', data: result }) : '').toString('base64') })
      if (hold && isCredit) held.push(fulfill)
      else await fulfill()
    }
  })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTimezoneOverride', { timezoneId: process.env.TEST_TIMEZONE || 'Asia/Kolkata' })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    Date.now = () => Date.parse('2026-11-12T12:00:00Z');
    localStorage.setItem('access_token', 'synthetic-credit-test');
    localStorage.setItem('user_data', JSON.stringify({id:14, username:'credit-test', rights:[]}));
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
    for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(50) }
    throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-2000)')}\n${JSON.stringify(calls.slice(-2))}`)
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
  const byText = (css, text) => `Array.from(document.querySelectorAll(${JSON.stringify(css)})).find(el => el.textContent.trim() === ${JSON.stringify(text)} && el.getBoundingClientRect().width > 0)`
  const mobile = '.mobile-table-scroll'
  const rows = `Array.from(document.querySelectorAll('${mobile} tbody tr')).filter(r => r.children.length === 6 && r.textContent.trim())`
  const times = `${rows}.map(r => r.children[1].textContent.trim())`
  const pageInput = selector('input[aria-label="Current page"]')
  const exportButton = `Array.from(document.querySelectorAll('[aria-label="Export all pages"]')).find(el => el.getBoundingClientRect().width > 0)`
  const openTime = async () => {
    await click(selector(`${mobile} [aria-label="Filter Time"]`))
    await waitFor(`document.querySelector('[aria-label="Time filter menu"]')`)
  }
  const condition = async label => {
    await click(selector('#mobile-column-filter-condition'))
    await click(byText('[role="option"] button', label))
  }
  const part = async (side, name, value) => {
    await click(selector(`[aria-label^="${side} ${name}:"]`))
    await click(byText(`[aria-label="Select ${side.toLowerCase()} ${name}"] button`, value))
  }
  const date = async side => {
    await click(selector(`#column-filter-${side}`))
    for (let i = 0; i < 120; i++) {
      const heading = await evaluate(`document.querySelector('#column-filter-calendar-${side} p').textContent`)
      if (heading === 'November 2026') break
      const direction = Date.parse('1 ' + heading) > Date.parse('2026-11-01') ? 'Previous' : 'Next'
      await click(selector(`#column-filter-calendar-${side} [aria-label="${direction} month"]`))
    }
    await click(byText(`#column-filter-calendar-${side} button`, '12'))
    for (const [name, value] of [['hour', '09'], ['minute', '32'], ['second', side === 'FROM' ? '24' : '25']]) await part(side, name, value)
  }
  const apply = () => click(byText('[aria-label="Time filter menu"] button', 'Apply'))
  const exportCsv = async count => {
    const start = await evaluate('exportedBlobs.length')
    await click(exportButton)
    await waitFor(`exportedBlobs.length > ${start}`)
    const csv = await evaluate('exportedBlobs.at(-1)')
    assert.equal(csv.trim().split(/\r?\n/).length - 1, count)
    return csv
  }
  const waitHeld = async count => {
    for (let i = 0; i < 100 && held.length < count; i++) await delay(30)
    assert.ok(held.length >= count)
  }
  await send('Page.navigate', { url: origin + '/reports/credit' })
  await waitFor(`${rows}.length === 7 && ${pageInput}.max === '2'`)
  const overall = calls.at(-1)
  assert.equal(overall.limit, 100)
  assert.equal(overall.from, Date.parse('2026-11-12T00:00:00Z') / 1000)
  assert.equal(overall.to, Date.parse('2026-11-12T23:59:59Z') / 1000)
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${pageInput}.value === '2' && ${rows}.some(r => r.textContent.includes('810007'))`)
  await openTime(); await condition('Equal'); await date('FROM')
  hold = true
  const start = calls.length
  await apply(); await waitHeld(1)
  assert.equal(await evaluate(`${pageInput}.value`), '1')
  assert.deepEqual(await evaluate(times), [], 'No obsolete rows while loading')
  hold = false
  for (const fulfill of held.splice(0)) await fulfill().catch(() => {})
  await waitFor(`${rows}.length === 100 && ${pageInput}.max === '2'`)
  assert.deepEqual(await evaluate(times), Array(100).fill('12/11/2026 09:32:24'))
  assert.deepEqual(calls.slice(start).map(c => c.page), Array.from({ length: 21 }, (_, i) => i + 1))
  for (const body of calls.slice(start)) {
    assert.equal(body.from, overall.from); assert.equal(body.to, overall.to); assert.equal(body.filters, undefined)
  }
  const localStart = calls.length
  await click(selector('[aria-label="Next page"]'))
  await waitFor(`${pageInput}.value === '2' && ${rows}.length === 7`)
  assert.equal(calls.length, localStart)
  const csv = await exportCsv(107)
  assert.equal((csv.match(/09:32:24/g) || []).length, 107)
  console.log('PASS actual Credit route Equal 09:32:24: aliases, 21 capped pages, 100+7 local pages and complete CSV')

  const search = async text => {
    await evaluate(`(() => {
      const el = document.querySelector('[aria-label="Search credit records"]'); el.removeAttribute('readonly');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
  }
  await search('810020')
  await waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes('810020')`)
  assert.equal(calls.at(-1).search, '810020')
  await exportCsv(1)
  await search('NO_MATCH'); await waitFor(`document.body.textContent.includes('No credit records found')`)
  await search('Alice'); await waitFor(`${rows}.length === 100`)
  assert.equal(calls.at(-1).search, 'Alice')
  await search(''); await waitFor(`${rows}.length === 100 && !${selector('[aria-label="Export all pages"]')}.disabled`)

  // Other column conditions must survive both candidate requests and exports.
  await click(selector(`${mobile} [aria-label="Filter Name"]`))
  await waitFor(`document.querySelector('[aria-label="Name filter menu"] input')`)
  await evaluate(`(() => {
    const el = document.querySelector('[aria-label="Name filter menu"] input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Alice');
    el.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await click(byText('[aria-label="Name filter menu"] button', 'Apply'))
  await waitFor(`${rows}.length === 100 && !${exportButton}.disabled`)
  assert.deepEqual(calls.at(-1).filters, [{ field: 'name', operator: 'equal', value: 'Alice' }])
  const columnExportStart = calls.length
  await exportCsv(107)
  assert.ok(calls.slice(columnExportStart).every(c => c.filters?.some(f => f.field === 'name' && f.value === 'Alice')))
  await click(selector(`${mobile} [aria-label="Filter Name"]`))
  await click(byText('[aria-label="Name filter menu"] button', 'Reset'))
  await waitFor(`${rows}.length === 100 && !${exportButton}.disabled`)

  await click(byText('button', 'Filter')); await click(byText('button', 'Groups'))
  await waitFor(`Array.from(document.querySelectorAll('div')).some(el => el.textContent.trim() === 'Credit candidates')`)
  await click(byText('div', 'Credit candidates')); await click(byText('button', 'Apply'))
  await waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes('810020')`)
  assert.deepEqual(calls.at(-1).filters, [{ field: 'login', operator: 'in', value: [810020, 810128] }])
  assert.equal(calls.at(-1).from, overall.from); assert.equal(calls.at(-1).to, overall.to)
  await exportCsv(1)
  await click(byText('button', 'Filter')); await click(byText('button', 'Groups'))
  await waitFor(`Array.from(document.querySelectorAll('h2')).some(el => el.textContent.trim() === 'Login Groups' && el.getBoundingClientRect().width > 0)`)
  await click(byText('button', 'Clear'))
  await waitFor(`${rows}.length === 100 && !${exportButton}.disabled`)
  console.log('PASS saved mobile group and non-Time column intersections retained by candidate collection and CSV')

  await openTime(); await part('FROM', 'second', '23')
  hold = true; await apply(); await waitHeld(1)
  await openTime(); await part('FROM', 'second', '25'); await apply(); await waitHeld(2)
  hold = false; await held.pop()()
  await waitFor(`${rows}.length === 16 && ${rows}.every(r => r.textContent.includes('09:32:25'))`)
  for (const fulfill of held.splice(0)) await fulfill().catch(() => {})
  await delay(200)
  assert.deepEqual(await evaluate(times), Array(16).fill('12/11/2026 09:32:25'))

  // An obsolete export must not download after a query change.
  const exported = await evaluate('exportedBlobs.length')
  hold = true; await click(exportButton); await waitHeld(1)
  // The global export overlay blocks pointer controls; exercise an incoming
  // controlled-input change without pretending the overlay is click-through.
  await search('810128'); await waitHeld(2)
  hold = false; await held.pop()()
  await waitFor(`${rows}.length === 1 && ${rows}[0].textContent.includes('810128')`)
  for (const fulfill of held.splice(0)) await fulfill().catch(() => {})
  await delay(200)
  assert.equal(await evaluate('exportedBlobs.length'), exported)
  await search(''); await waitFor(`${rows}.length === 16`)
  await openTime(); await part('FROM', 'second', '24'); await apply()
  await waitFor(`${rows}.length === 100`)
  console.log('PASS search intersections, delayed scan and export cannot overwrite/download a stale query')

  for (const [label, count] of [['Not Equal', 37], ['Before Or At', 128], ['After Or At', 123]]) {
    await openTime(); await condition(label); await apply()
    await waitFor(`${rows}.length === ${Math.min(count, 100)} && !${selector('[aria-label="Export all pages"]')}.disabled`)
    const text = await exportCsv(count)
    const matches = text.match(/09:32:24/g) || []
    assert.equal(matches.length, label === 'Not Equal' ? 0 : 107)
  }
  await openTime(); await condition('Between'); await date('TO'); await apply()
  await waitFor(`${rows}.length === 100 && ${pageInput}.max === '2'`)
  const between = await exportCsv(123)
  assert.equal((between.match(/09:32:24/g) || []).length, 107)
  assert.equal((between.match(/09:32:25/g) || []).length, 16)
  assert.deepEqual((await evaluate(times)).slice(0, 16), Array(16).fill('12/11/2026 09:32:25'))
  await openTime(); await condition('Equal'); await part('FROM', 'second', '22'); await apply()
  await waitFor(`document.body.textContent.includes('No credit records found') && ${pageInput}.max === '1'`)
  await openTime(); await click(byText('[aria-label="Time filter menu"] button', 'Reset'))
  await waitFor(`${rows}.length === 7 && ${pageInput}.max === '2'`)
  assert.equal(calls.at(-1).limit, 100)
  const resetStart = calls.length
  await click(selector('[aria-label="Next page"]')); await waitFor(`${pageInput}.value === '2' && ${rows}.length === 7`)
  assert.equal(calls.length, resetStart + 1); assert.equal(calls.at(-1).page, 2)
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions))
  console.log('PASS all Time operators, inclusive Between, zero count and Reset to ordinary server pagination; no runtime exceptions')
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {})
  ws?.close(); browser.kill()
  await new Promise(done => server.close(done))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}