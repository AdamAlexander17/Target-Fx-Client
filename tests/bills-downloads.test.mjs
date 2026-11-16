import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import {
  createBillDownloadBatch, telegramWebApp,
  saveBillFile, openBillPreview, billShareFile, saveBrowserBill,
} from '../src/utils/billDownloads.js'

const original = Object.getOwnPropertyDescriptors(globalThis)
test.afterEach(() => {
  for (const key of ['window', 'document', 'localStorage', 'fetch', 'navigator', 'setTimeout', 'clearTimeout', 'URL']) {
    if (original[key]) Object.defineProperty(globalThis, key, original[key])
    else delete globalThis[key]
  }
})
function telegram(platform = 'android', version = true, downloadFile = (_params, cb) => cb(true)) {
  globalThis.window = { location: { origin: 'https://app.example.test' }, Telegram: { WebApp: {
    initData: 'synthetic-launch', platform, isVersionAtLeast: v => v === '8.0' && version, downloadFile,
  } } }
  return window.Telegram.WebApp
}
const blob = new Blob(['%PDF-test'], { type: 'application/pdf' })

test('ordinary browser with unloaded launch data is not Telegram; modern desktop and mobile are', () => {
  globalThis.window = { Telegram: { WebApp: { initData: '', platform: 'unknown', downloadFile() {} } } }
  assert.equal(telegramWebApp(), null)
  for (const platform of ['android', 'ios', 'tdesktop', 'macos', 'web', 'weba']) {
    telegram(platform)
    assert.ok(telegramWebApp())
  }
})

test('browser save clicks the named blob and delays revocation, including ZIP', async () => {
  const calls = []
  const link = { click() { calls.push(['click', this.download, this.href]) }, remove() { calls.push(['remove']) } }
  globalThis.document = { createElement: () => link, body: { appendChild() {} } }
  globalThis.URL = { createObjectURL: () => 'blob:local', revokeObjectURL: url => calls.push(['revoke', url]) }
  globalThis.setTimeout = (fn, delay) => { calls.push(['delay', delay]); if (delay === 150) fn(); else calls.push(['cleanup', fn]) }
  const batch = createBillDownloadBatch(() => assert.fail('browser must not open Telegram dialog'))
  await batch.add(blob, 'bill.pdf')
  await batch.add(new Blob(['PK']), 'bills.zip')
  batch.finish()
  assert.deepEqual(calls.filter(c => c[0] === 'click').map(c => c.slice(1)), [['bill.pdf', 'blob:local'], ['bills.zip', 'blob:local']])
  assert.equal(calls.some(c => c[0] === 'revoke'), false)
  for (const [, fn] of calls.filter(c => c[0] === 'cleanup')) fn()
  assert.equal(calls.filter(c => c[0] === 'revoke').length, 2)
})

test('browser click failure is propagated, not silently reported as a save', () => {
  globalThis.setTimeout = () => 1
  globalThis.document = { createElement: () => ({ click() { throw new Error('blocked') }, remove() {} }), body: { appendChild() {} } }
  assert.throws(() => saveBrowserBill(blob, 'bill.pdf'), /blocked/)
})

test('Telegram stages individual PDFs/ZIPs without any hidden browser downloads', async () => {
  telegram()
  let ready
  const batch = createBillDownloadBatch(files => { ready = files })
  await batch.add(blob, 'one.pdf')
  await batch.add(new Blob(['PK']), 'selected.zip')
  assert.equal(ready, undefined)
  batch.finish()
  assert.deepEqual(ready.map(file => file.filename), ['one.pdf', 'selected.zip'])
})

test('local picker is invoked synchronously, writes and closes without network or sharing', async () => {
  telegram()
  globalThis.fetch = () => assert.fail('no network')
  globalThis.localStorage = { getItem: () => assert.fail('no auth access') }
  const calls = []
  window.showSaveFilePicker = options => {
    calls.push(options.suggestedName)
    return Promise.resolve({ createWritable: async () => ({
      write: async value => calls.push(value), close: async () => calls.push('close'),
    }) })
  }
  const saving = saveBillFile(blob, 'bill.pdf')
  assert.deepEqual(calls, ['bill.pdf'], 'picker called before first await')
  assert.equal(await saving, 'File saved.')
  assert.deepEqual(calls, ['bill.pdf', blob, 'close'])
})

test('picker cancellation or failure does not start another save; failed write/close aborts', async () => {
  telegram()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { share: () => assert.fail('no fallback') } })
  for (const name of ['AbortError', 'NotAllowedError']) {
    window.showSaveFilePicker = () => { throw new DOMException('blocked', name) }
    await assert.rejects(saveBillFile(blob, 'bill.pdf'), { name })
  }
  for (const stage of ['createWritable', 'write', 'close']) {
    const calls = []
    window.showSaveFilePicker = async () => ({ createWritable: async () => {
      if (stage === 'createWritable') throw new Error(stage)
      return {
        write: async () => { calls.push('write'); if (stage === 'write') throw new Error(stage) },
        close: async () => { calls.push('close'); throw new Error(stage) },
        abort: async () => { calls.push('abort'); throw new Error('cleanup') },
      }
    } })
    await assert.rejects(saveBillFile(blob, 'bill.pdf'), new RegExp(stage))
    assert.equal(calls.includes('abort'), stage !== 'createWritable')
  }
})

test('file sharing runs synchronously from save and cancellation propagates without fallback', async () => {
  telegram()
  let shared = false
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    canShare: () => true,
    share: ({ files }) => { shared = true; assert.equal(files[0].name, 'bill.pdf'); return Promise.resolve() },
  } })
  const saving = saveBillFile(blob, 'bill.pdf')
  assert.equal(shared, true)
  assert.match(await saving, /Shared.*Save it there/)
  navigator.share = () => Promise.reject(new DOMException('cancelled', 'AbortError'))
  await assert.rejects(saveBillFile(blob, 'bill.pdf'), { name: 'AbortError' })
})

test('nonsharing ZIP uses delayed-revoke blob download; PDF preview opens only local new tab', async () => {
  telegram()
  globalThis.fetch = () => assert.fail('no network')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  const links = [], cleanup = []
  globalThis.URL = { createObjectURL: () => 'blob:private', revokeObjectURL: url => cleanup.push(url) }
  globalThis.setTimeout = (fn, delay) => { assert.equal(delay, 60_000); cleanup.push(fn) }
  globalThis.document = { createElement: () => ({ click() { links.push({ ...this }) }, remove() {} }), body: { appendChild() {} } }
  assert.match(await saveBillFile(new Blob(['PK']), 'bills.zip'), /Download requested.*may block/)
  openBillPreview(blob)
  assert.equal(links[0].download, 'bills.zip')
  assert.equal(links[1].target, '_blank')
  assert.equal(links[1].download, undefined)
  assert.ok(links.every(link => link.href === 'blob:private' && link.rel.includes('noopener')))
  assert.equal(cleanup.length, 2)
  cleanup.slice().forEach(fn => fn())
  assert.equal(cleanup.filter(value => value === 'blob:private').length, 2)
})

test('blob creation and anchor failure propagate, including preview and save fallback', async () => {
  telegram()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  globalThis.URL = { createObjectURL: () => { throw new Error('blob failed') } }
  await assert.rejects(saveBillFile(blob, 'bill.pdf'), /blob failed/)
  assert.throws(() => openBillPreview(blob), /blob failed/)
  let cleanup
  globalThis.URL = { createObjectURL: () => 'blob:private', revokeObjectURL() {} }
  globalThis.setTimeout = fn => { cleanup = fn }
  globalThis.document = { createElement: () => { throw new Error('anchor failed') } }
  await assert.rejects(saveBillFile(blob, 'bill.pdf'), /anchor failed/)
  assert.equal(typeof cleanup, 'function')
})

test('frontend download sources contain no relay, upload, network, storage or Telegram native link APIs', () => {
  for (const path of ['../src/utils/billDownloads.js', '../src/components/BillDownloadDialog.jsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /prepareTelegramBill|requestTelegramBill|supportsTelegramDownload|fetch\s*\(|XMLHttpRequest|axios|localStorage|access_token|\/ai\/|\.openLink\(|\.downloadFile\(/)
  }
})

test('file sharing requires canShare files, not share text/URL support alone', () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { share() {}, canShare: ({ files }) => files[0].name.endsWith('.pdf') } })
  assert.equal(billShareFile(blob, 'bill.pdf').name, 'bill.pdf')
  assert.equal(billShareFile(blob, 'bills.zip'), null)
  navigator.canShare = () => { throw new Error('policy') }
  assert.equal(billShareFile(blob, 'bill.pdf'), null)
})

// Exercise the actual page handlers, not copies of their loops, with synthetic bills.
const source = readFileSync(new URL('../src/pages/BillsPage.jsx', import.meta.url), 'utf8')
const handlers = source.slice(source.indexOf('  // Download bill (PDF) for a single login'), source.indexOf('  const SortIcon ='))
function pageHandlers({ allRows, total = allRows.length, selected = new Set([1, 2]), fail = false }) {
  const saved = [], calls = [], errors = [], flags = []
  const context = {
    selectedWeekId: 7, selectedWeek: { name: 'Test week' }, selected, rows: allRows,
    pagination: { total }, search: 'test search', groupMt5Accounts: [1, 2],
    setDownloadFiles() {}, setBusyLogin: v => flags.push(v), setBulkDownloading: v => flags.push(v), setExportingAll: v => flags.push(v),
    createBillDownloadBatch: () => ({ add: async (blob, filename) => saved.push({ blob, filename }), finish: () => calls.push('finish') }),
    brokerAPI: {
      getBillsDetails: async (week, logins) => { calls.push({ week, logins }); if (fail) throw new Error('test fetch failure'); return { Bills: logins.map(Login => ({ Login, TotalNetAmount: Login === 2 ? 0 : 10 })) } },
      getBillsSummary: async payload => { calls.push(payload); return { Bills: allRows } },
    },
    buildBillPdf: bill => ({ output: () => new Blob([String(bill.Login)]) }),
    buildBillsPdf: bills => ({ output: () => new Blob([JSON.stringify(bills)]) }),
    computeBillNet: bill => bill.TotalNetAmount,
    JSZip: class { entries = []; file(name) { this.entries.push(name) } async generateAsync() { return new Blob([JSON.stringify(this.entries)], { type: 'application/zip' }) } },
    alert: msg => errors.push(msg), Blob,
  }
  const result = vm.runInNewContext(`(function() { ${handlers}; return {downloadOne, downloadSelected, exportAll} })()`, context)
  return { ...result, saved, calls, errors, flags }
}
for (const action of ['downloadOne', 'downloadSelected', 'exportAll']) {
  for (const mode of action === 'downloadOne' ? ['individual'] : ['individual', 'zip']) {
    test(`Bills page ${action} ${mode}: correct file(s), skips zero-net bulk, finishes batch`, async () => {
      const page = pageHandlers({ allRows: [{ Login: 1, Name: 'A', TotalNetAmount: 10 }, { Login: 2, TotalNetAmount: 0 }] })
      await page[action](action === 'downloadOne' ? 1 : mode)
      assert.equal(page.errors.length, 0)
      assert.equal(page.saved.length, 1)
      assert.match(page.saved[0].filename, mode === 'zip' ? /\.zip$/ : /^bill_1_.*\.pdf$/)
      assert.equal(page.calls.at(-1), 'finish')
      assert.ok(page.flags.at(-1) === false || page.flags.at(-1) === null)
    })
  }
}
test('selected bills retain 300-login detail chunks; all fetch uses search/group filters', async () => {
  const allRows = Array.from({ length: 301 }, (_, i) => ({ Login: i + 1, TotalNetAmount: 10 }))
  const page = pageHandlers({ allRows, total: 999, selected: new Set(allRows.map(r => r.Login)) })
  await page.downloadSelected()
  assert.deepEqual(page.calls.filter(c => c.logins).map(c => c.logins.length), [300, 1])
  await page.exportAll('zip')
  assert.ok(page.calls.some(c => c.search === 'test search' && c.mt5Accounts.join() === '1,2' && c.week_id === 7))
})
test('fetch failure is shown and loading clears; empty selection produces no save', async () => {
  const page = pageHandlers({ allRows: [{ Login: 1, TotalNetAmount: 10 }], fail: true })
  await page.downloadSelected()
  assert.deepEqual(page.errors, ['test fetch failure'])
  assert.equal(page.flags.at(-1), false)
  assert.equal(page.saved.length, 0)
  const empty = pageHandlers({ allRows: [], selected: new Set() })
  await empty.downloadSelected('zip')
  assert.equal(empty.saved.length, 0)
})