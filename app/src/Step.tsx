// The pieces of the review: a numbered step, a card that opens, an info
// tip. Taken from the mock.

import { useState, type ReactNode } from 'react'

export function Step({
  number,
  title,
  explainer,
  children,
}: {
  number: number
  title: string
  explainer: string
  children: ReactNode
}) {
  return (
    <section className="animate-fade-up">
      <h2 className="flex items-center gap-2 pb-3 text-base font-semibold text-gray-900">
        {number}. {title}
        <InfoTip>{explainer}</InfoTip>
      </h2>
      {children}
    </section>
  )
}

// A card whose summary always shows. The details open with the chevron.
export function CollapsibleCard({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left"
      >
        <div className="min-w-0 flex-1">{summary}</div>
        <span className="shrink-0 text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
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
      <span className="min-w-0 text-right text-sm text-gray-800">{children}</span>
    </div>
  )
}
