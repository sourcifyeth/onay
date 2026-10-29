// The words of the profile card: ages, the search links, the short state
// of the summary line, and the provenance line. No React, no browser, so
// the tests run them.

import type { Hex } from '../messages.ts'
import type { GoPlusResult } from './goplus.ts'
import {
  YOUNG_DAYS,
  type AccountProfile,
  type Blocked,
  type GoPlusFact,
  type Profile,
  type TokenHolding,
} from './profile.ts'
import { amountText } from './run.ts'

const DAY = 24 * 60 * 60 * 1000

// The age of a time in words, for example "3 days ago".
export function ageText(at: number, now: number): string {
  const days = Math.floor((now - at) / DAY)
  if (days < 1) return 'today'
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

export const dateText = (at: number) =>
  new Date(at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

// A short time since an event, for the settings: "3 h ago".
export function agoText(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

// The search engines get the address in quotes, so that they match it
// exactly. GitHub finds it in the repositories of protocols.
export function searchLinks(address: Hex): { name: string; url: string }[] {
  const quoted = encodeURIComponent(`"${address}"`)
  return [
    { name: 'Google', url: `https://www.google.com/search?q=${quoted}` },
    { name: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${quoted}` },
    { name: 'GitHub', url: `https://github.com/search?q=${address}&type=code` },
    { name: 'X', url: `https://x.com/search?q=${address}&f=live` },
  ]
}

export type Tone = 'green' | 'coral' | 'amber' | 'gray'

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`

const deployedText = (days: number) => `deployed ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}`

// The tooltip of the warning on a young contract.
export const youngText = (days: number) =>
  `This contract was ${deployedText(days)}. A contract under ${YOUNG_DAYS} days old deserves more care. This is a hint, not a verdict.`

// The tooltip of the nonce of a contract.
export const CONTRACT_NONCE =
  'A contract sends no transactions. Its nonce counts the contracts that it created, so the profile does not show it.'

// An amount of a token in its unit, or in the smallest unit when no
// source names the decimals.
export const tokenAmountText = (value: bigint, decimals: TokenHolding['decimals']) =>
  decimals === null ? `${amountText(value, 0)} units` : amountText(value, decimals.value)

// The mark of an amount. The amount shows through its decimals, so it
// gets the green mark only when the chain gave both.
export function amountMark({ amount, decimals }: Pick<TokenHolding, 'amount' | 'decimals'>): {
  proof: boolean
  source: string
} {
  const source =
    decimals === null || decimals.source === amount.source
      ? amount.source
      : `${amount.source}, decimals from ${decimals.source}`
  return { proof: amount.proof && (decimals?.proof ?? true), source }
}

// The amount that Blockscout claims, when it differs from the one of the
// chain in the text too. The balance changes with each block, so a
// small difference can round away.
export function claimedText({ amount, decimals, claimed }: TokenHolding): string | null {
  if (claimed === null) return null
  const text = tokenAmountText(claimed, decimals)
  return text === tokenAmountText(amount.value, decimals) ? null : text
}

const goPlusOf = (profile: Profile | AccountProfile): GoPlusFact =>
  'security' in profile ? profile.security.goPlus : profile.goPlus

// The answer of GoPlus when it set a flag, else null.
export function goPlusFlags(profile: Profile | AccountProfile): GoPlusResult | null {
  const fact = goPlusOf(profile)
  return fact.state === 'known' && fact.value.flags.length > 0 ? fact.value : null
}

// GoPlus in words, with the sources that it names.
export function goPlusSource(result: GoPlusResult): string {
  const named = result.sources.filter((source) => source !== 'GoPlus')
  return named.length > 0 ? `GoPlus, according to ${named.join(', ')}` : 'GoPlus'
}

// The lines of the block-list notice: one for each hit, with the name of
// its list, and one for the flags of GoPlus.
export function blockLines(
  blocked: Blocked[],
  goPlus: GoPlusResult | null,
): { text: string; proof: boolean; source: string }[] {
  const lines = blocked.map((hit) => ({
    text: `${hit.of === 'deployer' ? 'Its deployer, on ' : ''}${hit.source}: ${hit.value}`,
    proof: hit.proof,
    source: hit.source,
  }))
  if (goPlus) {
    const text = `GoPlus: ${goPlus.flags.map((flag) => flag.text).join(', ')}`
    lines.push({ text, proof: false, source: goPlusSource(goPlus) })
  }
  return lines
}

// The short state on the summary line of a card. A block-list hit comes
// first, so that it shows when the card is folded.
export function summaryState(profile: Profile | AccountProfile, running: boolean): { text: string; tone: Tone } {
  if (profile.blocked.length > 0) return { text: 'on a block list', tone: 'coral' }
  if (goPlusFlags(profile)) return { text: 'flagged by GoPlus', tone: 'coral' }
  if ('young' in profile && profile.young !== null) return { text: deployedText(profile.young), tone: 'amber' }
  const lists = profile.lists.state === 'known' ? profile.lists.value.hits.length : 0
  if (lists > 0) return { text: `on ${lists} ${lists === 1 ? 'list' : 'lists'}`, tone: 'green' }
  if (running) return { text: 'looking up', tone: 'gray' }
  if (profile.lists.state !== 'known') return { text: 'lists unknown', tone: 'gray' }
  if ('explorer' in profile && profile.explorer === null) return { text: 'no explorer data', tone: 'gray' }
  if (profile.lists.value.missing.length > 0) return { text: 'on no loaded list', tone: 'gray' }
  return { text: 'not on any list', tone: 'gray' }
}
