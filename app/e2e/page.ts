// What the tests run inside the window, as scripts, and how they judge
// the review. The page marks its structure for the tests: `data-step`
// on each step, `data-tab` on the tabs of the Clear Signing step,
// `data-request` on each entry of the request list, `data-action` on
// the back link and the dismiss button, and `aria-expanded` on what
// opens. The text inside is read as a user reads it. The scripts are
// strings, so this module has no browser calls and the unit tests run
// it.

import type { StepId } from '../src/gates/verdict.ts'

// The settings of the page, as it stores them: the chains and the
// trusted auditors. The Helios clients that the first load started stop
// first. The page reads the settings again on the next reload.
export const SEED_SETTINGS = `
  const [chains, attesters, stop] = arguments
  for (const chainId of stop) await window.__TAURI_INTERNALS__.invoke('stop_chain', { chainId })
  localStorage.setItem('onay.chains', JSON.stringify(chains))
  localStorage.setItem('onay.attesters', JSON.stringify(attesters))
`

export const PAGE_READY = `return document.querySelector('h1')?.textContent === 'Onay'`

// The command of the paste card, with `AddRequestArgs`. The request
// opens on its own page.
export const INJECT = `await window.__TAURI_INTERNALS__.invoke('add_request', arguments[0])`

// Opens every closed card and detail, so that the text of a step holds
// all of it. A card shows its log button only once it is open, so the
// passes go on until nothing is left to open.
export const OPEN_CARDS = `
  for (let pass = 0; pass < 5; pass++) {
    const closed = [...document.querySelectorAll('main button[aria-expanded="false"]')]
    if (closed.length === 0) return
    for (const button of closed) button.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
`

// Clicks the element of the page that matches the selector.
export const CLICK = `
  const selector = arguments[0]
  const element = document.querySelector('main ' + selector)
  if (!element) throw new Error('nothing matches ' + selector)
  element.click()
`

// The selectors of CLICK.
export const TAB = (id: 'decoded' | 'raw') => `[data-tab="${id}"]`
export const BACK = '[data-action="back"]'

// The first entry of the request list: the newest request, with its
// verdict. Null while the list is not shown.
export const READ_FIRST_REQUEST = `
  return document.querySelector('main [data-request]')?.innerText ?? null
`

// Removes the first entry of the request list.
export const DISMISS_FIRST_REQUEST = `
  document.querySelector('main [data-request] [data-action="dismiss"]').click()
`

export type Review = {
  // The visible text of each step, by its id.
  steps: Partial<Record<StepId, string>>
  // True once the Clear Signing step shows its tabs and the compare
  // step no longer waits: the review is complete.
  done: boolean
}

export const READ_REVIEW = `
  const steps = {}
  let tabs = false
  for (const section of document.querySelectorAll('main [data-step]')) {
    steps[section.dataset.step] = section.innerText
    if (section.querySelector('[data-tab="decoded"]')) tabs = true
  }
  const compare = steps.compare
  const compared = compare !== undefined && !/Wait for the review to end/.test(compare)
  return { steps, done: tabs && compared }
`

// What a transaction can check: the five steps with the first tab of the
// Clear Signing step, its two other tabs, and the entry of the request on
// the list, which carries the verdict.
export type SectionName = StepId | 'decoded' | 'raw' | 'verdict'

export const SECTIONS: SectionName[] = [
  'chain',
  'simulation',
  'verification',
  'clearSigning',
  'decoded',
  'raw',
  'compare',
  'verdict',
]

export type Sections = Partial<Record<SectionName, string>>

// Text that each section must show. A section that is not named is only
// checked for the forbidden text. A line that holds one of the `allow`
// texts may show forbidden text: a preview, for example, logs its
// missing attestation as a failed check. `fail` is why the review cannot
// pass yet, such as a contract without a descriptor: the check reports it
// first, so that the run names the problem of each contract. The compare
// step lists what the steps found, and any finding but the `allow` ones
// is a problem too.
export type Expectation = Partial<Record<SectionName, string[]>> & { allow?: string[]; fail?: string }

// The notices of the Clear Signing step that explain a missing rendering.
const NOTICES = [/^No ERC-7730 descriptor is registered/, /^The registry has a descriptor for this contract/]

// A line of the compare step that names what a step found.
const FINDING = /^(Step \d+, |Onay could not check)/

// Text that no section of a passing review shows.
export const FORBIDDEN = ['✕', '⚠ The transaction', 'could not be', 'rendering failed', 'A check failed']

// How the chain of the suite is read: Helios proves the data, an RPC
// endpoint does not.
export type Mode = 'helios' | 'rpc'

// The sections of a review: its steps, plus the rest.
export function sectionsOf(review: Review, rest: Omit<Sections, StepId>): Sections {
  return { ...review.steps, ...rest }
}

// The problems of a review against what the transaction expects. Empty if it
// passes.
export function check(sections: Sections, expected: Expectation, forbidden = FORBIDDEN): string[] {
  const problems: string[] = []
  if (expected.fail) {
    const notice = sections.clearSigning?.split('\n').find((line) => NOTICES.some((text) => text.test(line)))
    problems.push(notice ? `${expected.fail} · ${notice.split(/[,.] /)[0]}` : expected.fail)
  }
  const findings = (sections.compare ?? '').split('\n').filter((line) => FINDING.test(line))
  for (const finding of findings) {
    if (!expected.allow?.some((allowed) => finding.includes(allowed))) problems.push(`the review found: ${finding}`)
  }
  for (const name of SECTIONS) {
    const text = sections[name]
    if (text === undefined) {
      problems.push(`${name} is missing`)
      continue
    }
    for (const wanted of expected[name] ?? []) {
      if (!text.includes(wanted)) problems.push(`${name} does not show "${wanted}"`)
    }
    const lines = text.split('\n').filter((line) => !expected.allow?.some((allowed) => line.includes(allowed)))
    for (const bad of forbidden) {
      if (lines.some((line) => line.includes(bad))) problems.push(`${name} shows "${bad}"`)
    }
  }
  return problems
}

// The sections as text, for the report of a failure.
export function dump(sections: Sections): string {
  return SECTIONS.filter((name) => sections[name] !== undefined)
    .map((name) => `--- ${name}\n${sections[name]}`)
    .join('\n\n')
}
