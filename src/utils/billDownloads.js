// Telegram's SDK is loaded in ordinary browsers too. Its presence alone is not detection.
export const telegramWebApp = () => {
  const app = globalThis.window?.Telegram?.WebApp
  return app && (app.initData || (app.platform && app.platform !== 'unknown')) ? app : null
}

function openBillBlob(blob, filename, preview = false) {
  const url = URL.createObjectURL(blob)
  let link
  try {
    link = document.createElement('a')
    link.href = url
    if (preview) link.target = '_blank'
    else link.download = filename
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
  } finally {
    link?.remove()
    // Immediate revocation races the browser's download, especially for ZIPs.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

export function saveBrowserBill(blob, filename) {
  openBillBlob(blob, filename)
}

export function openBillPreview(blob) {
  openBillBlob(blob, undefined, true)
}

export function createBillDownloadBatch(onReady) {
  const inTelegram = Boolean(telegramWebApp())
  const files = []
  return {
    async add(blob, filename) {
      if (inTelegram) files.push({ blob, filename })
      else {
        saveBrowserBill(blob, filename)
        await new Promise(resolve => setTimeout(resolve, 150))
      }
    },
    finish() { if (files.length) onReady(files) },
  }
}

export function billShareFile(blob, filename) {
  if (typeof File === 'undefined') return null
  const file = new File([blob], filename, { type: blob.type || (filename.endsWith('.zip') ? 'application/zip' : 'application/pdf') })
  try {
    return navigator.share && navigator.canShare?.({ files: [file] }) ? file : null
  } catch { return null }
}

// Invoke directly from a fresh click, before any asynchronous work consumes activation.
export async function saveBillFile(blob, filename) {
  if (typeof window.showSaveFilePicker === 'function') {
    const handle = await window.showSaveFilePicker({ suggestedName: filename })
    const writable = await handle.createWritable()
    try {
      await writable.write(blob)
      await writable.close()
    } catch (error) {
      try { await writable.abort() } catch { /* Preserve the original write/close error. */ }
      throw error
    }
    return 'File saved.'
  }
  const file = billShareFile(blob, filename)
  if (file) {
    await navigator.share({ files: [file] })
    return 'Shared with the selected app. Save it there if needed.'
  }
  saveBrowserBill(blob, filename)
  return 'Download requested; this Telegram client may block it. Check Downloads. If missing, use PDF preview or open Bills in a browser.'
}