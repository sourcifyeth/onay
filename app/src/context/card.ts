// The words of the profile card: ages, the search links, the short state
// of the summary line, and the provenance line. No React, no browser, so
// the tests run them.

import type { Hex } from '../messages.ts'
import type { AccountProfile, Profile } from './profile.ts'

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

// The short state on the summary line of a card. A block-list hit comes
// first, so that it shows when the card is folded.
export function summaryState(profile: Profile | AccountProfile, running: boolean): { text: string; tone: Tone } {
  if (profile.blocked.length > 0) return { text: 'on a block list', tone: 'coral' }
  if ('young' in profile && profile.young) {
    const { days, transactions } = profile.young
    const text =
      days !== null
        ? `deployed ${days === 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'} ago`}`
        : `${transactions} ${transactions === 1 ? 'transaction' : 'transactions'}`
    return { text, tone: 'amber' }
  }
  const lists = profile.lists.state === 'known' ? profile.lists.value.hits.length : 0
  if (lists > 0) return { text: `on ${lists} ${lists === 1 ? 'list' : 'lists'}`, tone: 'green' }
  if (running) return { text: 'looking up', tone: 'gray' }
  if ('explorer' in profile && profile.explorer === null) return { text: 'no explorer data', tone: 'gray' }
  if (profile.lists.state === 'known' && profile.lists.value.missing.length > 0) {
    return { text: 'on no loaded list', tone: 'gray' }
  }
  return { text: 'not on any list', tone: 'gray' }
}

// The sources of a profile in words: what was read with a proof, and
// what is a claim.
export function provenanceText(sources: string[]): { checked: string[]; claims: string[] } {
  return {
    checked: sources.filter((source) => source === 'Helios'),
    claims: sources.filter((source) => source !== 'Helios'),
  }
}
