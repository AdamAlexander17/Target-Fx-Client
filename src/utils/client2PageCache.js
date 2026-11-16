// Desktop Clients only. Short-lived, bounded, in-memory snapshots, never persisted.
// Changing the auth session evicts every old entry (including on token rotation).
export function createClient2PageCache({ maxEntries = 8, ttl = 60000, now = Date.now } = {}) {
  let session = null
  const entries = new Map()
  const selectSession = value => {
    if (session !== value) {
      entries.clear()
      session = value
    }
    return !!value
  }
  return {
    get(sessionKey, queryKey) {
      if (!selectSession(sessionKey)) return null
      const entry = entries.get(queryKey)
      if (!entry) return null
      if (now() - entry.at >= ttl) {
        entries.delete(queryKey)
        return null
      }
      return entry.snapshot
    },
    set(sessionKey, queryKey, snapshot) {
      if (!selectSession(sessionKey)) return
      entries.delete(queryKey)
      entries.set(queryKey, { snapshot, at: now() })
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
    },
    clear() {
      entries.clear()
      session = null
    },
  }
}

export const client2PageCache = createClient2PageCache()