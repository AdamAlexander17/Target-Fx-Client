import assert from 'node:assert/strict'
import test from 'node:test'
import { serverEpochFromParts } from '../src/utils/dateFormatter.js'

// The bug report requires quick filters to send the start of the first day and the
// end of the last day, computed with Date.UTC exactly like the custom date range.
// For the reported case (25/10/2026 -> 01/11/2026) the expected epochs are fixed.

test('custom-range style boundaries match the reported expected epochs', () => {
  const from = serverEpochFromParts(2026, 9, 25, 0, 0, 0) // 25-10 00:00:00
  const to = serverEpochFromParts(2026, 10, 1, 23, 59, 59) // 01-11 23:59:59
  assert.equal(from, 1792886400)
  assert.equal(to, 1793577599)
})

test('end of day boundary includes deals created late on the final day', () => {
  const to = serverEpochFromParts(2026, 10, 1, 23, 59, 59)
  // A deal at 01/11 22:52:57 must fall inside the range (the old code cut off at "now").
  const lateDeal = serverEpochFromParts(2026, 10, 1, 22, 52, 57)
  assert.ok(lateDeal <= to, 'deal late on the final day must be within range')
  // End of day is start of day + 86399, matching the custom range's +86399.
  assert.equal(to - serverEpochFromParts(2026, 10, 1, 0, 0, 0), 86399)
})

test('start of day boundary includes early deals on the first day', () => {
  const from = serverEpochFromParts(2026, 9, 25, 0, 0, 0)
  // Deals at 25/10 15:03 and 15:58 (the missing ones) must be >= from.
  assert.ok(serverEpochFromParts(2026, 9, 25, 15, 3, 0) >= from)
  assert.ok(serverEpochFromParts(2026, 9, 25, 15, 58, 0) >= from)
})
