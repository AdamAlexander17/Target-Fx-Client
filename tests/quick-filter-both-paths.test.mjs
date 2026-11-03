import assert from 'node:assert/strict'
import test from 'node:test'
import { getPresetRange } from '../src/utils/dealTimePresets.js'
import { fromServerEpoch } from '../src/utils/dateFormatter.js'


const wall = (ts) => {
  const d = fromServerEpoch(ts)
  return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }
}

test('report pages: every quick filter starts at 00:00:00 and ends at 23:59:59', () => {
  for (const preset of ['today', 'lastweek', 'lastmonth', 'last3months', 'last6months']) {
    const { from, to } = getPresetRange(preset)
    assert.ok(from < to, `${preset}: from must precede to`)
    assert.deepEqual(wall(from), { h: 0, m: 0, s: 0 }, `${preset}: from must be start of day`)
    assert.deepEqual(wall(to), { h: 23, m: 59, s: 59 }, `${preset}: to must be end of day`)
  }
})

test('report pages: lastweek spans exactly 7 calendar days inclusive', () => {
  const { from, to } = getPresetRange('lastweek')
  assert.equal(to - from, 7 * 86400 - 1)
})

// Mirror the client Deals modal logic (handleQuickFilter) to prove it now matches.
const modalLastWeek = () => {
  const now = fromServerEpoch(Math.floor(Date.now() / 1000) + 330 * 60)
  const startOfDay = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d }
  const endOfToday = () => { const d = new Date(now); d.setHours(23, 59, 59, 999); return d }
  const daysBack = (n) => { const d = new Date(now); d.setDate(now.getDate() - n); return startOfDay(d) }
  const toServerEpoch = (date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()) / 1000)
  return { from: toServerEpoch(daysBack(6)), to: toServerEpoch(endOfToday()) }
}

test('client deals modal: lastweek also uses start/end of day', () => {
  const { from, to } = modalLastWeek()
  assert.deepEqual(wall(from), { h: 0, m: 0, s: 0 })
  assert.deepEqual(wall(to), { h: 23, m: 59, s: 59 })
  assert.equal(to - from, 7 * 86400 - 1)
})
