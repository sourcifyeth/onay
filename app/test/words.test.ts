import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import { count, formatEther, revertText } from '../src/gates/words.ts'

test('revertText: the message of Error, the code of Panic, the selector of a custom error', () => {
  const error = `0x08c379a0${'00'.repeat(31)}20${'00'.repeat(31)}04${Buffer.from('nope').toString('hex')}${'00'.repeat(28)}`
  assert.equal(revertText(error as Hex), 'nope')
  assert.equal(revertText(`0x4e487b71${'00'.repeat(31)}11`), 'panic 0x11 · arithmetic overflow')
  assert.equal(revertText(`0x4e487b71${'00'.repeat(31)}ff`), 'panic 0xff')
  assert.equal(revertText('0x12345678'), 'custom error 0x12345678')
  assert.equal(revertText('0x'), 'reverted without a reason')
  assert.equal(revertText('0x08c379a0'), 'custom error 0x08c379a0')
})

test('revertText: data in the shape of Error(string) that lies is a custom error, never an exception', () => {
  const word = (n: number | bigint) => n.toString(16).padStart(64, '0')
  // An offset past the data, an offset that is not a word, a length past
  // the data, and an offset too large for a number.
  for (const words of [
    `${word(0x1000)}${word(4)}`,
    `${word(0x21)}${word(4)}${'6e6f7065'}${'00'.repeat(28)}`,
    `${word(0x20)}${word(0x1000)}${'6e6f7065'}${'00'.repeat(28)}`,
    `${word(2n ** 255n)}${word(4)}`,
    word(0x20),
  ]) {
    assert.equal(revertText(`0x08c379a0${words}`), 'custom error 0x08c379a0', words)
  }
})

test('formatEther: up to six decimals', () => {
  assert.equal(formatEther(0n), '0')
  assert.equal(formatEther(10n ** 18n), '1')
  assert.equal(formatEther(1_500_000_000_000_000_000n), '1.5')
  assert.equal(formatEther(1n), '<0.000001')
  assert.equal(formatEther(123_456_789_000_000n), '0.000123')
})

test('count: the noun takes an s except for one', () => {
  assert.equal(count(1, 'storage slot'), '1 storage slot')
  assert.equal(count(0, 'account'), '0 accounts')
  assert.equal(count(1234, 'contract'), '1,234 contracts')
})
