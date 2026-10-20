import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fetchProfile, isAddress, parseAttesters, profileUrl, withAttester } from '../src/clear-signing/attesters.ts'
import type { Hex } from '../src/messages.ts'

const A = '0x3846c3A30E62075Fa916216b35EF04B8F53931f6'
const a = A.toLowerCase() as Hex
const B: Hex = '0x1111111111111111111111111111111111111111'

test('isAddress accepts 20 hex bytes with a prefix and nothing else', () => {
  assert.equal(isAddress(A), true)
  assert.equal(isAddress(a), true)
  for (const value of ['', '0x', A.slice(0, 41), `${A}0`, A.slice(2), 42, null, undefined, {}]) {
    assert.equal(isAddress(value), false, String(value))
  }
})

test('parseAttesters keeps the addresses, in lowercase, each once', () => {
  assert.deepEqual(parseAttesters([A, 'junk', a, B, 7]), [a, B])
  assert.deepEqual(parseAttesters(null), [])
  assert.deepEqual(parseAttesters('0x'), [])
})

test('withAttester adds an address in lowercase, and refuses a repeat or a non-address', () => {
  assert.deepEqual(withAttester([], ` ${A} `), [a])
  assert.deepEqual(withAttester([a], B), [a, B])
  assert.equal(withAttester([a], A), null)
  assert.equal(withAttester([], 'vitalik.eth'), null)
})

test('profileUrl names the folder of the auditor with the checksummed address', () => {
  assert.equal(
    profileUrl(a),
    `https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/master/auditors/eip155-1-${A}/profile.json`,
  )
})

test('fetchProfile reads the name, and gives null when the registry has no profile', async () => {
  const profile = { id: `eip155:1:${A}`, name: 'Patrick Collins', organization: 'Cyfrin' }
  const found = async () => Response.json(profile)
  assert.deepEqual(await fetchProfile(a, found), { name: 'Patrick Collins', organization: 'Cyfrin' })
  const missing = async () => new Response('404: Not Found', { status: 404 })
  assert.equal(await fetchProfile(a, missing), null)
  const broken = async () => Response.json({ id: 'x' })
  await assert.rejects(fetchProfile(a, broken), /no name/)
  const down = async () => new Response('', { status: 503 })
  await assert.rejects(fetchProfile(a, down), /HTTP 503/)
})
