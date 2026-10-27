// The pieces of the review: a numbered step, a card that opens, a
// notice, an info tip, a row of a list, a value that copies. Taken from
// the mock.

import { useState, type ReactNode } from 'react'
import type { StepInfo } from './gates/verdict.ts'

// The number and the title come from the list of the steps.
export function Step({ step, explainer, children }: { step: StepInfo; explainer: string; children: ReactNode }) {
  return (
    <section className="animate-fade-up">
      <h2 className="flex items-center gap-2 pb-3 text-base font-semibold text-gray-900">
        {step.number}. {step.title}
        <InfoTip>{explainer}</InfoTip>
      </h2>
      {children}
    </section>
  )
}

// A card whose summary always shows. The details open with the chevron,
// or from the start.
// `inset` gives the title and the body more room from the border.
export function CollapsibleCard({
  summary,
  open: initial = false,
  inset = false,
  children,
}: {
  summary: ReactNode
  open?: boolean
  inset?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(initial)
  const side = inset ? 'px-7' : 'px-5'
  const top = inset ? 'py-5' : 'py-3'
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-4 ${side} ${top} text-left`}
      >
        <div className="min-w-0 flex-1">{summary}</div>
        <span className="shrink-0 text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className={`${side} pb-5`}>{children}</div>}
    </div>
  )
}

// A box with a title: coral for a result that fails the request, amber
// for a warning, gray for something that did not happen. The detail is
// a value on its own line, such as the reason of a revert.
export function Notice({
  tone,
  title,
  detail,
  className = '',
  children,
}: {
  tone: 'coral' | 'amber' | 'gray'
  title: string
  detail?: string
  className?: string
  children?: ReactNode
}) {
  const colors = {
    coral: 'border-light-coral-500 bg-light-coral-100 text-light-coral-700',
    amber: 'border-amber-400 bg-amber-50 text-amber-800',
    gray: 'border-gray-200 text-gray-600',
  }[tone]
  return (
    <div className={`rounded-lg border-2 px-4 py-4 ${colors} ${className}`}>
      <p className="text-lg font-semibold">{title}</p>
      {detail && <p className="pt-1 font-mono text-sm break-all text-gray-800">{detail}</p>}
      {children && <div className="pt-1 text-sm leading-relaxed text-gray-700">{children}</div>}
    </div>
  )
}

// A small "i". The text opens on hover or keyboard focus.
export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <span
        tabIndex={0}
        aria-label="More information"
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 font-serif text-[10px] font-semibold text-gray-400 italic outline-none group-focus-within:border-cerulean-blue-400 group-hover:border-cerulean-blue-400 group-hover:text-cerulean-blue-600"
      >
        i
      </span>
      <span
        role="tooltip"
        className="invisible absolute top-full left-0 z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed font-normal text-gray-600 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-gray-500">{label}</span>
      <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere] text-gray-800">{children}</span>
    </div>
  )
}

// One row of a `dl`: a label on the left and a value on the right, as
// the wallets show it. The note shows under the value.
export function ListRow({ label, note, children }: { label: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right">
        {children}
        {note && <p className="pt-0.5 text-xs text-gray-400">{note}</p>}
      </dd>
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// A value with a tooltip that shows what is behind it. A click copies
// the text. If the value shows the whole text (`full`), the tooltip does
// not show it again.
export function Hint({
  what,
  text,
  full = false,
  className,
  children,
}: {
  what: string
  text: string
  full?: boolean
  className: string
  children: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!(await copyText(text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <span className="group/hint relative inline-block">
      <button
        onClick={copy}
        className={`cursor-copy text-left underline decoration-gray-300 decoration-dotted underline-offset-4 ${className}`}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 bottom-full z-20 mb-1.5 w-max max-w-[22rem] rounded-md bg-gray-800 px-2.5 py-1.5 text-left font-mono text-[11px] leading-relaxed break-all whitespace-normal text-white opacity-0 shadow-lg transition-opacity group-hover/hint:visible group-hover/hint:opacity-100"
      >
        <span className="block text-gray-400">{copied ? 'copied' : `${what} · click to copy`}</span>
        {!full && text}
      </span>
    </span>
  )
}
