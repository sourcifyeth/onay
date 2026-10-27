// The words of the profile card, and the links that it opens.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { ageText, agoText, dateText, provenanceText, searchLinks, summaryState } from '../src/context/card.ts'
import { linkable, LINK_PREFIXES } from '../src/context/explorers.ts'
import { ERC7730_REPOSITORY, LIST_SOURCES } from '../src/context/lists.ts'
import type { AccountProfile, Profile } from '../src/context/profile.ts'
import type { Hex } from '../src/messages.ts'

const ADDRESS: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const NOW = Date.parse('2026-10-27T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

test('ageText and agoText say the time in words', () => {
  assert.equal(ageText(NOW - DAY / 2, NOW), 'today')
  assert.equal(ageText(NOW - DAY, NOW), '1 day ago')
  assert.equal(ageText(NOW - 3 * DAY, NOW), '3 days ago')
  assert.equal(ageText(NOW - 90 * DAY, NOW), '3 months ago')
  assert.equal(ageText(NOW - 3 * 365 * DAY, NOW), '3 years ago')
  assert.equal(agoText(NOW - 10_000, NOW), 'just now')
  assert.equal(agoText(NOW - 5 * 60_000, NOW), '5 min ago')
  assert.equal(agoText(NOW - 3 * 3_600_000, NOW), '3 h ago')
  assert.equal(agoText(NOW - 2 * DAY, NOW), '2 d ago')
  assert.equal(dateText(Date.parse('2017-11-28T00:41:21Z')), 'Nov 28, 2017')
})

test('searchLinks quote the address for the search engines', () => {
  const links = searchLinks(ADDRESS)
  assert.deepEqual(
    links.map((link) => link.name),
    ['Google', 'DuckDuckGo', 'GitHub', 'X'],
  )
  assert.equal(links[0].url, `https://www.google.com/search?q=%22${ADDRESS}%22`)
  assert.equal(links[1].url, `https://duckduckgo.com/?q=%22${ADDRESS}%22`)
})

test('each link of the card is linkable and in the allowlist of open_url in Rust', () => {
  const rust = readFileSync(new URL('../src-tauri/src/browser.rs', import.meta.url), 'utf8')
  const allowed = [...rust.matchAll(/^ {4}"(https:\/\/[^"]+)",$/gm)].map((match) => match[1])
  assert.deepEqual([...allowed].sort(), [...LINK_PREFIXES, 'https://4byte.sourcify.dev/'].sort())
  const links = [
    ...searchLinks(ADDRESS).map((link) => link.url),
    ...LIST_SOURCES.map((source) => source.repository),
    `${ERC7730_REPOSITORY}/tree/master/registry/uniswap`,
  ]
  for (const link of links) assert.ok(linkable(link), link)
  assert.ok(!linkable('https://tokens.uniswap.org'))
  assert.ok(!linkable('https://www.google.com/url?q=https://evil.com'))
})

const known = <T>(value: T) => ({ state: 'known' as const, value, proof: false, source: 'x' })

const account = (change: Partial<AccountProfile> = {}): AccountProfile => ({
  address: ADDRESS,
  chainId: 1,
  lists: known({ hits: [], missing: [] }),
  blocked: [],
  goPlus: { state: 'off' },
  sources: [],
  ...change,
})

const profile = (change: Partial<Profile> = {}): Profile =>
  ({
    ...account(),
    young: null,
    explorer: 'eth.blockscout.com',
    ...change,
  }) as Profile

test('summaryState puts a block-list hit first', () => {
  const blocked = [{ value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' as const }]
  assert.deepEqual(summaryState(account({ blocked }), true), { text: 'on a block list', tone: 'coral' })
  assert.deepEqual(summaryState(profile({ blocked, young: { days: 3, transactions: null } }), false), {
    text: 'on a block list',
    tone: 'coral',
  })
})

test('summaryState says young, lists, looking up, or no explorer', () => {
  assert.deepEqual(summaryState(profile({ young: { days: 3, transactions: 5 } }), false), {
    text: 'deployed 3 days ago',
    tone: 'amber',
  })
  assert.deepEqual(summaryState(profile({ young: { days: null, transactions: 1 } }), false), {
    text: '1 transaction',
    tone: 'amber',
  })
  const hit = { list: 'Safe deployments', kind: 'allow' as const, label: 'Safe v1.4.1', link: null }
  assert.deepEqual(summaryState(profile({ lists: known({ hits: [hit, hit], missing: [] }) }), false), {
    text: 'on 2 lists',
    tone: 'green',
  })
  assert.deepEqual(summaryState(profile(), true), { text: 'looking up', tone: 'gray' })
  assert.deepEqual(summaryState(profile({ explorer: null }), false), { text: 'no explorer data', tone: 'gray' })
  assert.deepEqual(summaryState(account(), false), { text: 'not on any list', tone: 'gray' })
  const missing = [{ list: 'OFAC sanctions', reason: 'not fetched yet' }]
  assert.deepEqual(summaryState(account({ lists: known({ hits: [], missing }) }), false), {
    text: 'on no loaded list',
    tone: 'gray',
  })
})

test('provenanceText parts the checked sources from the claims', () => {
  assert.deepEqual(provenanceText(['Helios', 'Blockscout', 'eth.drpc.org without proof', 'OFAC sanctions']), {
    checked: ['Helios'],
    claims: ['Blockscout', 'eth.drpc.org without proof', 'OFAC sanctions'],
  })
})
