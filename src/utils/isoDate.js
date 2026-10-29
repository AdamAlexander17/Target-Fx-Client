// Helpers for 'YYYY-MM-DD' date strings (used by MobileCalendar and the pages that host it)
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const pad = n => String(n).padStart(2, '0')
export const toIsoDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export const parseIsoDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}
// "2026-10-27" -> "27 Oct 2026"
export const formatIsoDate = value => {
  const date = parseIsoDate(value)
  return date ? `${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getFullYear()}` : ''
}
