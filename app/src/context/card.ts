// The words of the profile card: ages, the search links, the short state
// of the summary line, and the provenance line. No React, no browser, so
// the tests run them.

import type { Hex } from '../messages.ts'
import type { GoPlusResult } from './goplus.ts'
import type { AccountProfile, GoPlusFact, Profile, Young } from './profile.ts'

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

// The sentence of the young notice.
export function youngText({ days, transactions }: Young): string {
  if (days !== null && transactions !== null) {
    return `This contract was ${deployedText(days)} and has ${plural(transactions, 'transaction')}.`
  }
  if (days !== null) return `This contract was ${deployedText(days)}.`
  return `This contract has only ${plural(transactions ?? 0, 'transaction')}.`
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

// The short state on the summary line of a card. A block-list hit comes
// first, so that it shows when the card is folded.
export function summaryState(profile: Profile | AccountProfile, running: boolean): { text: string; tone: Tone } {
  if (profile.blocked.length > 0) return { text: 'on a block list', tone: 'coral' }
  if (goPlusFlags(profile)) return { text: 'flagged by GoPlus', tone: 'coral' }
  if ('young' in profile && profile.young) {
    const { days, transactions } = profile.young
    const text = days !== null ? deployedText(days) : plural(transactions ?? 0, 'transaction')
    return { text, tone: 'amber' }
  }
  const lists = profile.lists.state === 'known' ? profile.lists.value.hits.length : 0
  if (lists > 0) return { text: `on ${lists} ${lists === 1 ? 'list' : 'lists'}`, tone: 'green' }
  if (running) return { text: 'looking up', tone: 'gray' }
  if (profile.lists.state !== 'known') return { text: 'lists unknown', tone: 'gray' }
  if ('explorer' in profile && profile.explorer === null) return { text: 'no explorer data', tone: 'gray' }
  if (profile.lists.value.missing.length > 0) return { text: 'on no loaded list', tone: 'gray' }
  return { text: 'not on any list', tone: 'gray' }
}
