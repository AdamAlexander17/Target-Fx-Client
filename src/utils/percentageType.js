import { reportPayload } from './reportPagination.js'

export const PERCENTAGE_TYPES = ['Default', 'Custom', 'Auto']

export const percentageSearchType = query => {
  const normalized = query.trim().toLowerCase()
  if (normalized === 'autofill') return 'Auto'
  return PERCENTAGE_TYPES.find(type => type.toLowerCase() === normalized) || null
}

export const filterPercentageTypes = (rows, selectedTypes) =>
  selectedTypes.length ? rows.filter(row => selectedTypes.includes(getPercentageType(row))) : rows

// The percentage endpoint has no documented Auto/multi-type filter.
// Load every page before applying the same classification used by the badges.
export async function loadPercentageClients(fetchPage, params, isCurrent) {
  let firstPayload
  const clients = []
  const logins = new Set()
  let expectedTotal
  // Existing percentage exports request 1000. Use a conservative 500 for scans;
  // keep the same requested limit when a backend silently caps its pages.
  for (let page = 1; page <= 10000; page += 1) {
    if (!isCurrent()) throw new Error('Percentage request superseded')
    const payload = reportPayload(await fetchPage({ ...params, page, limit: 500, page_size: undefined }))
    if (!isCurrent()) throw new Error('Percentage request superseded')
    if (page === 1) firstPayload = payload
    const batch = payload.clients
    if (!Array.isArray(batch)) throw new Error('Invalid clients response')
    const pagination = payload.pagination ?? payload
    const rawTotal = pagination.total ?? pagination.totalItems ?? pagination.total_items
    const total = rawTotal == null ? (expectedTotal ?? null) : Number(rawTotal)
    if (total !== null) {
      if (expectedTotal !== undefined && expectedTotal !== total) throw new Error('Incomplete client percentage results: changing total')
      expectedTotal = total
    }
    const rawPages = pagination.totalPages ?? pagination.total_pages
    const pages = rawPages == null ? null : Number(rawPages)
    if ((total !== null && (!Number.isInteger(total) || total < 0)) ||
        (pages !== null && (!Number.isInteger(pages) || pages < 0))) throw new Error('Invalid percentage pagination')
    for (const row of batch) {
      const login = row.client_login ?? row.login
      if (login == null || logins.has(String(login))) throw new Error('Incomplete client percentage results: duplicate or missing login')
      logins.add(String(login))
      clients.push(row)
    }
    if (total !== null && clients.length > total) throw new Error('Incomplete client percentage results: inconsistent total')
    if (!batch.length || (total !== null && clients.length === total) || (pages !== null && page >= pages)) {
      if (total !== null && clients.length !== total) throw new Error('Incomplete client percentage results. Please refresh and try again.')
      return { ...firstPayload, total: clients.length, clients }
    }
    // Unknown totals must reach an empty page, not merely a capped short page.
  }
  throw new Error('Incomplete client percentage results: page safety limit reached')
}

// Component-owned, bounded cache: never persisted or shared between accounts/views.
// Local predicates are deliberately absent from the key: they consume the same
// validated complete candidate collection. Remote pages can never satisfy it.
export function createPercentageLoader(fetchPage) {
  const cache = new Map()
  const pending = new Map()
  let owner
  let generation = 0
  const clear = () => { generation += 1; cache.clear(); pending.clear() }
  return {
    clear,
    async load(params, complete, scope, force = false) {
      if (owner !== scope) { clear(); owner = scope }
      const key = JSON.stringify([complete, complete ? { ...params, page: 1, limit: undefined, page_size: undefined } : params])
      if (pending.has(key)) return pending.get(key)
      // A manual/mutation refresh also invalidates other page/snapshot entries.
      if (force) cache.clear()
      const cached = cache.get(key)
      if (!force && cached && Date.now() - cached.at < 30000) return cached.payload
      const version = generation
      const request = (async () => {
        const payload = complete
          ? await loadPercentageClients(fetchPage, params, () => version === generation)
          : reportPayload(await fetchPage(params))
        if (version !== generation) throw new Error('Percentage request superseded')
        if (!Array.isArray(payload.clients)) throw new Error('Invalid clients response')
        cache.delete(key)
        cache.set(key, { payload, at: Date.now() })
        if (cache.size > 6) cache.delete(cache.keys().next().value)
        return payload
      })()
      pending.set(key, request)
      try { return await request } finally { if (pending.get(key) === request) pending.delete(key) }
    }
  }
}

// Shared helper for deriving the "Type" of a client percentage row.
// Priority: Auto (is_autofill) -> Custom (is_custom) -> Default
export const getPercentageType = (item) => {
  if (!item) return 'Default'
  if (item.is_autofill) return 'Auto'
  if (item.is_custom) return 'Custom'
  return 'Default'
}

// Tailwind badge classes per type.
export const getPercentageTypeBadgeClass = (item) => {
  const type = getPercentageType(item)
  if (type === 'Auto') return 'bg-amber-100 text-amber-800'
  if (type === 'Custom') return 'bg-blue-100 text-blue-800'
  return 'bg-gray-100 text-gray-600'
}
