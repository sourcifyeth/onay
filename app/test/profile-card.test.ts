// The words of the profile card, and the links that it opens.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  ageText,
  agoText,
  amountMark,
  blockLines,
  claimedText,
  dateText,
  goPlusFlags,
  goPlusSource,
  searchLinks,
  summaryState,
  tokenAmountText,
  youngText,
} from '../src/context/card.ts'
import { linkable, LINK_PREFIXES, SEARCH_SHAPES } from '../src/context/explorers.ts'
import { ERC7730_REPOSITORY, LIST_SOURCES } from '../src/context/lists.ts'
import type { ListAnswer } from '../src/context/lists.ts'
import type { AccountProfile, Profile, TokenHolding } from '../src/context/profile.ts'
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
  const searches = [...rust.matchAll(/^ {4}\("(https:\/\/[^"]+)", "([^"]+)"\),$/gm)].map((match) => [
    match[1],
    match[2],
  ])
  assert.deepEqual(searches, SEARCH_SHAPES)
  const links = [
    ...searchLinks(ADDRESS).map((link) => link.url),
    ...LIST_SOURCES.map((source) => source.repository),
    `${ERC7730_REPOSITORY}/tree/master/registry/uniswap`,
  ]
  for (const link of links) assert.ok(linkable(link), link)
  assert.ok(!linkable('https://tokens.uniswap.org'))
  assert.ok(!linkable('https://www.google.com/url?q=https://evil.com'))
})

test('linkable takes a search link only in its one shape, as open_url in Rust', () => {
  const quoted = `%22${ADDRESS}%22`
  for (const url of [
    `https://www.google.com/search?q=${quoted}&btnI=1`,
    `https://www.google.com/search?btnI=1&q=${quoted}`,
    `https://duckduckgo.com/?q=!ducky+${quoted}`,
    'https://duckduckgo.com/?q=%5Csite:evil.com',
    `https://duckduckgo.com/?q=${quoted}&kp=1`,
    `https://github.com/search?q=${ADDRESS}&type=code&x=1`,
    'https://github.com/search?q=evil&type=code',
    `https://x.com/search?q=${ADDRESS}&f=live&x=1`,
    `https://x.com/search#q=${ADDRESS}&f=live`,
  ]) {
    assert.ok(!linkable(url), url)
  }
})

const known = <T>(value: T) => ({ state: 'known' as const, value, proof: false, source: 'x' })
const answer = (change: Partial<ListAnswer> = {}): ListAnswer => ({ hits: [], missing: [], asked: [], ...change })

const account = (change: Partial<AccountProfile> = {}): AccountProfile => ({
  address: ADDRESS,
  chainId: 1,
  lists: known(answer()),
  blocked: [],
  blockscout: known('ok' as const),
  goPlus: { state: 'off' },
  nonce: known(1n),
  firstTransaction: known(null),
  eth: known(0n),
  tokens: known({ tokens: [], more: false, checked: true }),
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

test('blockLines: one line for each hit, with the name of its list', () => {
  const blocked = [
    { value: 'sanctioned', proof: false, source: 'OFAC sanctions', of: 'address' as const },
    { value: 'marked as scam', proof: false, source: 'Blockscout', of: 'address' as const },
    { value: 'sanctioned', proof: false, source: 'OFAC sanctions', of: 'deployer' as const },
  ]
  const flags = [
    { id: 'phishing_activities', text: 'phishing' },
    { id: 'mixer', text: 'mixer' },
  ]
  assert.deepEqual(blockLines(blocked, { flags, sources: ['GoPlus', 'SlowMist'] }), [
    { text: 'OFAC sanctions: sanctioned', proof: false, source: 'OFAC sanctions' },
    { text: 'Blockscout: marked as scam', proof: false, source: 'Blockscout' },
    { text: 'Its deployer, on OFAC sanctions: sanctioned', proof: false, source: 'OFAC sanctions' },
    { text: 'GoPlus: phishing, mixer', proof: false, source: 'GoPlus, according to SlowMist' },
  ])
  assert.deepEqual(blockLines([], null), [])
})

test('summaryState puts a block-list hit first', () => {
  const blocked = [{ value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' as const }]
  assert.deepEqual(summaryState(account({ blocked }), true), { text: 'on a block list', tone: 'coral' })
  assert.deepEqual(summaryState(profile({ blocked, young: 3 }), false), {
    text: 'on a block list',
    tone: 'coral',
  })
})

test('summaryState says young, lists, looking up, or no explorer', () => {
  assert.deepEqual(summaryState(profile({ young: 3 }), false), { text: 'deployed 3 days ago', tone: 'amber' })
  assert.deepEqual(summaryState(profile({ young: 0 }), false), { text: 'deployed today', tone: 'amber' })
  const hit = { list: 'Safe deployments', kind: 'allow' as const, label: 'Safe v1.4.1', link: null }
  assert.deepEqual(summaryState(profile({ lists: known(answer({ hits: [hit, hit] })) }), false), {
    text: 'on 2 lists',
    tone: 'green',
  })
  assert.deepEqual(summaryState(profile(), true), { text: 'looking up', tone: 'gray' })
  assert.deepEqual(summaryState(profile({ explorer: null }), false), { text: 'no explorer data', tone: 'gray' })
  assert.deepEqual(summaryState(account(), false), { text: 'not on any list', tone: 'gray' })
  const missing = [{ list: 'OFAC sanctions', reason: 'not fetched yet' }]
  assert.deepEqual(summaryState(account({ lists: known(answer({ missing })) }), false), {
    text: 'on no loaded list',
    tone: 'gray',
  })
})

test('summaryState says lists unknown when the lists gave no answer', () => {
  const failed = { state: 'unknown' as const, reason: 'HTTP 503' }
  assert.deepEqual(summaryState(account({ lists: failed }), false), { text: 'lists unknown', tone: 'gray' })
  assert.deepEqual(summaryState(profile({ lists: failed, explorer: null }), false), {
    text: 'lists unknown',
    tone: 'gray',
  })
  assert.deepEqual(summaryState(account({ lists: failed }), true), { text: 'looking up', tone: 'gray' })
})

test('summaryState and goPlusFlags show the flags of GoPlus after a block-list hit', () => {
  const flagged = known({ flags: [{ id: 'phishing_activities', text: 'phishing' }], sources: ['SlowMist'] })
  const flaggedAccount = account({ goPlus: flagged })
  assert.deepEqual(summaryState(flaggedAccount, false), { text: 'flagged by GoPlus', tone: 'coral' })
  assert.equal(goPlusFlags(flaggedAccount), flagged.value)
  const flaggedProfile = profile({ security: { blockscout: known('ok' as const), goPlus: flagged } })
  assert.deepEqual(summaryState(flaggedProfile, false), { text: 'flagged by GoPlus', tone: 'coral' })
  const blocked = [{ value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' as const }]
  assert.deepEqual(summaryState(account({ goPlus: flagged, blocked }), false).text, 'on a block list')
  assert.equal(goPlusFlags(account({ goPlus: known({ flags: [], sources: ['GoPlus'] }) })), null)
  assert.equal(goPlusFlags(account()), null)
  assert.equal(goPlusSource(flagged.value), 'GoPlus, according to SlowMist')
  assert.equal(goPlusSource({ flags: [], sources: ['GoPlus'] }), 'GoPlus')
})

test('youngText says the age and the limit', () => {
  const rest = 'A contract under 30 days old deserves more care. This is a hint, not a verdict.'
  assert.equal(youngText(3), `This contract was deployed 3 days ago. ${rest}`)
  assert.equal(youngText(1), `This contract was deployed 1 day ago. ${rest}`)
  assert.equal(youngText(0), `This contract was deployed today. ${rest}`)
})

const holding = (change: Partial<TokenHolding> = {}): TokenHolding => ({
  token: ADDRESS,
  symbol: { value: 'USDC', proof: false, source: 'Blockscout' },
  decimals: { value: 6, proof: true, source: 'Helios' },
  amount: { value: 25_000_000n, proof: true, source: 'Helios' },
  claimed: null,
  ...change,
})

test('amountMark: green only when the chain gave the amount and the decimals', () => {
  assert.deepEqual(amountMark(holding()), { proof: true, source: 'Helios' })
  const listed = { value: 6, proof: false, source: 'Uniswap Labs Default' }
  assert.deepEqual(amountMark(holding({ decimals: listed })), {
    proof: false,
    source: 'Helios, decimals from Uniswap Labs Default',
  })
  // No decimals: the amount shows in the smallest unit, as the chain gave it.
  assert.deepEqual(amountMark(holding({ decimals: null })), { proof: true, source: 'Helios' })
  const claimed = { value: 1n, proof: false, source: 'Blockscout' }
  assert.deepEqual(amountMark(holding({ amount: claimed, decimals: { ...listed, source: 'Blockscout' } })), {
    proof: false,
    source: 'Blockscout',
  })
})

test('tokenAmountText: the unit of the decimals, else the smallest unit', () => {
  assert.equal(tokenAmountText(25_000_000n, { value: 6, proof: true, source: 'Helios' }), '25')
  assert.equal(tokenAmountText(25_000_000n, null), '25,000,000 units')
})

test('claimedText: only a difference that the text shows', () => {
  const decimals = { value: 18, proof: true, source: 'Helios' }
  const amount = { value: 1_000_000_000_000_000_000n, proof: true, source: 'Helios' }
  // A difference under the sixth decimal rounds away.
  assert.equal(claimedText(holding({ decimals, amount, claimed: amount.value + 1n })), null)
  assert.equal(claimedText(holding({ decimals, amount, claimed: 2n * amount.value })), '2')
  assert.equal(claimedText(holding()), null)
})
