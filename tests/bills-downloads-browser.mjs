// Real React save panel + browser downloads, with synthetic local device capabilities.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bundle = await build({
  stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import Dialog from './src/components/BillDownloadDialog.jsx';
    import { createBillDownloadBatch } from './src/utils/billDownloads.js';
    const mode = new URLSearchParams(location.search).get('mode') || 'telegram';
    window.pickerCalls = []; window.shareCalls = []; window.networkCalls = []; window.writes = [];
    if (mode === 'telegram') window.Telegram = { WebApp: {
      initData: 'synthetic-launch', platform: 'tdesktop',
      openLink() { throw new Error('No Telegram blob links'); },
      downloadFile() { throw new Error('No native download URLs'); }
    }};
    else window.Telegram = { WebApp: { initData: '', platform: 'unknown', downloadFile() {} } };
    window.fetch = async url => { window.networkCalls.push(url); throw new Error('No download network'); };
    window.showSaveFilePicker = async options => {
      window.pickerCalls.push({ name: options.suggestedName, active: navigator.userActivation.isActive });
      if (window.cancelPicker) throw new DOMException('cancelled', 'AbortError');
      if (window.holdPicker) await new Promise(resolve => { window.releasePicker = resolve; });
      return { createWritable: async () => ({
        write: async blob => { window.writes.push(blob.size); if (window.failWrite) throw new Error('write failed'); },
        close: async () => { window.pickerClosed = true; },
        abort: async () => { window.aborted = true; }
      }) };
    };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => !window.noShare });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
      window.shareCalls.push({ name: files[0].name, active: navigator.userActivation.isActive });
      if (window.cancelShare) throw new DOMException('cancelled', 'AbortError');
    }});
    function App() {
      const [files, setFiles] = useState(null);
      return <><button onClick={async () => {
        const batch = createBillDownloadBatch(setFiles);
        await batch.add(new Blob(['%PDF-test'], { type: 'application/pdf' }), 'bill_test.pdf');
        await batch.add(new Blob(['PK-test'], { type: 'application/zip' }), 'bills_test.zip');
        batch.finish();
      }}>Prepare</button>{files && <Dialog files={files} onClose={() => setFiles(null)} />}</>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `, resolveDir: resolve('.'), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
})
const server = createServer((req, res) => {
  if (req.url.startsWith('/test.js')) res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].text)
  else res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/test.js"></script>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(join(tmpdir(), 'bills-downloads-'))
const browser = spawn(process.env.TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(done => setTimeout(done, ms))
let ws
try {
  let port
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await delay(50) }
  }
  assert.ok(port, 'Edge debugging endpoint started')
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise(done => ws.addEventListener('open', done, { once: true }))
  let id = 0
  const pending = new Map(), downloads = [], exceptions = []
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id)
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result)
    } else if (message.method === 'Browser.downloadWillBegin') downloads.push(message.params)
    else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
  })
  const send = (method, params = {}) => new Promise((resolveCall, reject) => {
    const next = ++id; pending.set(next, { resolve: resolveCall, reject }); ws.send(JSON.stringify({ id: next, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const until = async (expression, label) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(30) }
    throw new Error(`Timed out: ${label}`)
  }
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`)
  await send('Page.enable'); await send('Runtime.enable')
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: profile, eventsEnabled: true })
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
    await send('Page.navigate', { url: `${origin}/?mode=telegram&width=${width}&access_token=synthetic#tgWebAppData=synthetic` })
    await until(`!!document.querySelector('button')`, 'React mount')
    await click('Prepare')
    await until(`!!document.querySelector('[role=dialog]')`, 'save dialog')
    assert.equal(await evaluate(`document.querySelectorAll('[role=dialog] li').length`), 2)
    assert.equal(await evaluate('document.activeElement.textContent'), 'Save file', 'initial dialog focus')
    assert.equal(await evaluate(`document.querySelectorAll('[role=dialog] button').length`), 4, 'ZIP has no PDF preview')
    assert.equal(await evaluate(`document.querySelector('[role=dialog] a').href`), `${origin}/`, 'ordinary app URL only')
    await evaluate('window.holdPicker = true')
    await click('Save file')
    await until(`window.pickerCalls.length === 1`, 'picker invoked')
    assert.deepEqual(await evaluate('window.pickerCalls[0]'), { name: 'bill_test.pdf', active: true })
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('[role=dialog] button')).every(b => b.disabled)`), true)
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`), true, 'Escape locked during save')
    await click('Save file')
    assert.equal(await evaluate('window.pickerCalls.length'), 1, 'no double save')
    await evaluate('window.releasePicker(); window.holdPicker = false')
    await until(`document.body.innerText.includes('File saved.')`, 'picker write and close')
    assert.equal(await evaluate('window.pickerClosed'), true)
    await evaluate('window.cancelPicker = true')
    await click('Save file')
    await until(`document.body.innerText.includes('Save or sharing cancelled.')`, 'picker cancellation')
    await evaluate('window.cancelPicker = false; window.failWrite = true')
    await click('Save file')
    await until(`document.body.innerText.includes('Unable to save or open')`, 'write failure')
    assert.equal(await evaluate('window.aborted'), true)
    await evaluate('window.showSaveFilePicker = undefined')
    await click('Save file')
    await until(`window.shareCalls.length === 1`, 'explicit share fallback')
    assert.equal(await evaluate('window.shareCalls[0].active'), true, 'sharing keeps fresh user activation')
    await until(`document.body.innerText.includes('Shared with the selected app.')`, 'honest share status')
    await evaluate('window.cancelShare = true')
    await click('Save file')
    await until(`document.body.innerText.includes('Save or sharing cancelled.')`, 'share cancellation')
    await evaluate(`window.noShare = true; window.originalCreateURL = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('blob failed'); }`)
    await click('Save file')
    await until(`document.body.innerText.includes('Unable to save or open')`, 'blob failure status')
    await evaluate(`URL.createObjectURL = window.originalCreateURL; window.blobLinks = []; window.originalClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function() { window.blobLinks.push({ href: this.href, target: this.target, download: this.download, active: navigator.userActivation.isActive }); }`)
    await click('Open PDF preview')
    await until(`document.body.innerText.includes('PDF preview requested.')`, 'preview guidance')
    assert.deepEqual(await evaluate('({ ...window.blobLinks[0], href: window.blobLinks[0].href.startsWith("blob:") })'), { href: true, target: '_blank', download: '', active: true })
    await evaluate(`Array.from(document.querySelectorAll('[role=dialog] li'))[1].querySelector('button').click()`)
    await until(`document.body.innerText.includes('Download requested;')`, 'ZIP request not claimed saved')
    assert.equal(await evaluate('window.blobLinks[1].download'), 'bills_test.zip')
    assert.equal(await evaluate('window.blobLinks[1].active'), true)
    assert.deepEqual(await evaluate('window.networkCalls'), [])
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'bounded layout')
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Close').focus()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await evaluate('document.activeElement.textContent'), 'Save file', 'Tab wraps within dialog')
    await click('Close')
    assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`), false)
    await evaluate(`document.querySelector('button').focus()`)
    await click('Prepare')
    await until(`!!document.querySelector('[role=dialog]')`, 'dialog reopens')
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await until(`!document.querySelector('[role=dialog]')`, 'Escape closes idle dialog')
    assert.equal(await evaluate('document.activeElement.textContent'), 'Prepare', 'focus restored')
  }
  await send('Page.navigate', { url: `${origin}/?mode=browser` })
  await until(`!!document.querySelector('button')`, 'browser mount')
  await click('Prepare')
  for (let i = 0; i < 100 && downloads.length < 2; i++) await delay(30)
  assert.deepEqual(downloads.map(d => d.suggestedFilename), ['bill_test.pdf', 'bills_test.zip'])
  assert.equal(await evaluate(`!!document.querySelector('[role=dialog]')`), false)
  assert.deepEqual(exceptions, [])
  console.log('PASS: desktop/mobile local picker/share/cancellation, failure/preview/ZIP fallbacks, no network, focus/locking; ordinary browser PDF/ZIP downloads')
} finally {
  ws?.close()
  browser.kill()
  await new Promise(done => server.close(done))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {})
}