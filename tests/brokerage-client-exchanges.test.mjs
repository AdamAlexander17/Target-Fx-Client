import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatorClientRateScope, changedCalculatorRates } from '../src/utils/brokerageCalculator.js'

const exchanges = ['MCX', 'NSE', 'MCX MINI', 'COMEX'].map(exchange => ({ exchange, currency: 'INR' }))
const saved = [
  { login: 90010, exchange: 'NSE', method: 'crore', rate: 400 },
  { login: 90010, exchange: 'COMEX', method: 'lot', rate: 5 },
  { login: 90011, exchange: 'MCX', method: 'lot', rate: 8 },
]

test('client settings show exactly the three exchanges in the client report', () => {
  const result = calculatorClientRateScope(exchanges, saved, 90010, [
    { exchange: 'MCX' }, { exchange: 'NSE' }, { exchange: 'MCX MINI' },
  ])
  assert.deepEqual(result.rows.map(row => row.exchange), ['MCX', 'NSE', 'MCX MINI'])
  assert.deepEqual(result.exchanges.map(row => row.exchange), ['MCX', 'NSE', 'MCX MINI'])
  assert.equal(result.rows[0].rate, '')
  assert.equal(result.rows[1].rate, 400)
  assert.deepEqual(result.original, [saved[0]])
  const reset = result.rows.filter(row => row.exchange === 'NSE').map(row => ({ ...row, method: '', rate: '' }))
  assert.deepEqual(changedCalculatorRates(reset, result.original, true), [
    { login: 90010, exchange: 'NSE', method: null, rate: null },
  ])
  assert.equal(saved[1].rate, 5, 'unrelated exchange override is untouched')
})

test('empty scope shows no unrelated exchanges and names are deduplicated', () => {
  assert.deepEqual(calculatorClientRateScope(exchanges, saved, 90010, []).rows, [])
  const result = calculatorClientRateScope(exchanges, saved, '90010', ['NSE', 'NSE', 'NEW'])
  assert.deepEqual(result.rows.map(row => row.exchange), ['NSE', 'NEW'])
  assert.equal(result.rows[0].rate, 400)
  assert.equal(result.rows[1].fixed, true)
})