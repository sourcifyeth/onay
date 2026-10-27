// What the tests run inside the window, as scripts, and how they judge
// the review. The page has no test hooks: the reader takes each step by
// its numbered heading and its visible text, as a user reads it. The
// scripts are strings, so this module has no browser calls and the unit
// tests run it.

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
    const closed = [...document.querySelectorAll('main button')].filter((b) => /▾$/.test(b.textContent.trim()))
    if (closed.length === 0) return
    for (const button of closed) button.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
`

// Clicks the button with this exact text: a tab, or "← all requests".
export const CLICK = `
  const label = arguments[0]
  const button = [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === label)
  if (!button) throw new Error('no button "' + label + '"')
  button.click()
`

// The first entry of the request list: the newest request, with its
// verdict. Null while the list is not shown.
export const READ_FIRST_REQUEST = `
  const heading = [...document.querySelectorAll('main h2')].find((h) => h.textContent === 'Signing requests')
  const entry = heading?.parentElement?.querySelector(':scope > div')
  return entry ? entry.innerText : null
`

// Removes the first entry of the request list.
export const DISMISS_FIRST_REQUEST = `
  const heading = [...document.querySelectorAll('main h2')].find((h) => h.textContent === 'Signing requests')
  const button = [...heading.parentElement.querySelectorAll(':scope > div button')].find((b) => b.textContent === 'Dismiss')
  button.click()
`

export type Review = {
  // The visible text of each step, by its number.
  steps: Record<number, { title: string; text: string }>
  // True once the last step rendered its tabs: the review is complete.
  done: boolean
}

// The steps of the review are the sections with a numbered heading. The
// heading's own text nodes give the number and the title; the info tip
// inside it does not count.
export const READ_REVIEW = `
  const steps = {}
  for (const section of document.querySelectorAll('main section')) {
    const heading = section.querySelector(':scope > h2')
    if (!heading) continue
    const own = [...heading.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('')
    const match = /^(\\d+)\\. (.+)$/.exec(own.trim())
    if (!match) continue
    steps[Number(match[1])] = { title: match[2].trim(), text: section.innerText }
  }
  const last = steps[4]
  return { steps, done: last !== undefined && /ABI-Decod/.test(last.text) }
`

// The numbered steps of the review page.
export const STEPS = { chain: 1, simulation: 2, verification: 3, clearSigning: 4 } as const

// What a transaction can check: the four steps with their first tab, the two
// other tabs of the last step, and the entry of the request on the list,
// which carries the verdict.
export type SectionName = keyof typeof STEPS | 'decoded' | 'raw' | 'verdict'

export const SECTIONS: SectionName[] = [
  'chain',
  'simulation',
  'verification',
  'clearSigning',
  'decoded',
  'raw',
  'verdict',
]

export type Sections = Partial<Record<SectionName, string>>

// Text that each section must show. A section that is not named is only
// checked for the forbidden text. A line that holds one of the `allow`
// texts may show forbidden text: a preview, for example, logs its
// missing attestation as a failed check.
export type Expectation = Partial<Record<SectionName, string[]>> & { allow?: string[] }

// Text that no section of a passing review shows.
export const FORBIDDEN = ['✕', '⚠ The transaction', 'could not be', 'rendering failed', 'A check failed']

export function chainExpectation(mode: 'helios' | 'rpc'): string {
  return mode === 'helios' ? '✓ Chain data verified by Helios' : '⚠ Chain data is not verified'
}

// The sections of a review, by name.
export function sectionsOf(review: Review, rest: Omit<Sections, keyof typeof STEPS>): Sections {
  const sections: Sections = { ...rest }
  for (const [name, number] of Object.entries(STEPS)) {
    const step = review.steps[number]
    if (step) sections[name as SectionName] = step.text
  }
  return sections
}

// The problems of a review against what the transaction expects. Empty if it
// passes.
export function check(sections: Sections, expected: Expectation, forbidden = FORBIDDEN): string[] {
  const problems: string[] = []
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
