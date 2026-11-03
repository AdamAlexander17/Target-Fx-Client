import { serverNowDate, serverEpochFromParts } from './dateFormatter.js'

// Same presets (and ranges) as the Deals tab in the login details modal
export const QUICK_FILTERS = [
  { value: 'today', label: 'Today' },
  { value: 'lastweek', label: 'Last Week' },
  { value: 'lastmonth', label: 'Last Month' },
  { value: 'last3months', label: 'Last 3 Months' },
  { value: 'last6months', label: 'Last 6 Months' },
  { value: 'allhistory', label: 'All History' }
]
// All ranges are in server (MT5) time: they start at 00:00:00 of the first day and run until now.
// "Today" is the current server calendar day; "Last Week" is today plus the 6 days before it, etc.
const PRESET_DAYS = { today: 1, lastweek: 7, lastmonth: 30, last3months: 90, last6months: 180 }
export const getPresetRange = (preset) => {
  const today = serverNowDate()
  const startOfDay = (date) => serverEpochFromParts(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0)
  // End of the selected range is 23:59:59 of the last day, matching the custom date
  // range — using "now" would drop deals created later on the final day.
  const to = serverEpochFromParts(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)
  if (PRESET_DAYS[preset]) {
    const first = new Date(today)
    first.setDate(today.getDate() - (PRESET_DAYS[preset] - 1))
    return { from: startOfDay(first), to }
  }
  if (preset === 'allhistory') return { from: serverEpochFromParts(today.getFullYear() - 2, 0, 1, 0, 0, 0), to }
  return null
}

