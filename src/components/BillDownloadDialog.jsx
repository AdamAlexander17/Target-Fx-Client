import { useEffect, useRef, useState } from 'react'
import { openBillPreview, saveBillFile } from '../utils/billDownloads'

export default function BillDownloadDialog({ files, onClose }) {
  const [active, setActive] = useState(null)
  const [statuses, setStatuses] = useState({})
  const locked = useRef(false)
  const dialog = useRef(null)
  // Deliberately omit query/hash launch data and credentials from the ordinary app link.
  const browserUrl = `${window.location.origin}${window.location.pathname}`
  useEffect(() => {
    const previous = document.activeElement
    const panel = dialog.current
    panel.querySelector('button')?.focus()
    const focusable = () => [...panel.querySelectorAll('button:not(:disabled), a[href]')].filter(node => node.getAttribute('aria-disabled') !== 'true')
    const keepFocus = event => {
      if (!panel.contains(event.target)) (locked.current ? panel : focusable()[0] || panel).focus()
    }
    const keydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!locked.current) onClose()
      }
      if (event.key === 'Tab') {
        const nodes = focusable()
        const index = nodes.indexOf(document.activeElement)
        if (locked.current || index < 0 || (event.shiftKey ? index === 0 : index === nodes.length - 1)) {
          event.preventDefault()
          ;(locked.current ? panel : nodes[event.shiftKey ? nodes.length - 1 : 0] || panel).focus()
        }
      }
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', keepFocus)
      if (previous?.isConnected) previous.focus()
    }
  }, [onClose])
  const update = (index, text) => setStatuses(previous => ({ ...previous, [index]: text }))
  const run = async (index, preview = false) => {
    if (locked.current) return
    locked.current = true
    setActive(index)
    const { blob, filename } = files[index]
    try {
      if (preview) {
        openBillPreview(blob)
        update(index, 'PDF preview requested. If it opens, use the viewer’s Save or Share option. If blocked, open Bills in a browser.')
      } else {
        const saving = saveBillFile(blob, filename)
        dialog.current.focus()
        update(index, 'Follow your device’s save or share prompt…')
        update(index, await saving)
      }
    } catch (error) {
      update(index, error?.name === 'AbortError' ? 'Save or sharing cancelled. You can try again.' : 'Unable to save or open this file. Retry, use PDF preview, or open Bills in a browser.')
    } finally {
      locked.current = false
      setActive(null)
    }
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bill-download-title" aria-describedby="bill-download-help" aria-busy={active !== null} className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h2 id="bill-download-title" className="text-lg font-semibold text-slate-900">Save bills</h2>
        <p id="bill-download-help" className="mt-2 text-sm text-slate-600">{files.length} file(s) ready on this device; no download upload is needed. Save file opens your device’s file picker or sharing options when supported, otherwise requests a download.</p>
        <ul className="mt-4 space-y-3">
          {files.map(({ filename }, index) => (
            <li key={`${index}-${filename}`} className="rounded-lg border border-slate-200 p-3">
              <p className="break-all text-sm font-medium text-slate-900">{filename}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button disabled={active !== null} onClick={() => run(index)} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">Save file</button>
                {/\.pdf$/i.test(filename) && <button disabled={active !== null} onClick={() => run(index, true)} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:opacity-50">Open PDF preview</button>}
              </div>
              <p role="status" className="mt-2 text-sm text-slate-600">{statuses[index] || 'Ready to save'}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Some Telegram clients block saving or previews. For PDFs, try preview then save from the viewer. For ZIPs or if nothing opens, open this app in Chrome, Edge, or Safari, sign in, and download again from Bills.</p>
        <a href={browserUrl} target="_blank" rel="noopener noreferrer" aria-disabled={active !== null} tabIndex={active !== null ? -1 : 0} onClick={event => { if (locked.current) event.preventDefault() }} className="mt-3 block text-sm text-blue-600 underline">Open in browser</a>
        <button disabled={active !== null} onClick={onClose} className="mt-4 rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Close</button>
      </section>
    </div>
  )
}