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

/** a card whose summary always shows; the details open with the chevron */
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

/** a small "i" icon; the text opens in a popup on hover or keyboard focus */
export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <span
        tabIndex={0}
        aria-label="More information"
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 font-serif text-[10px] font-semibold italic text-gray-400 outline-none group-hover:border-cerulean-blue-400 group-hover:text-cerulean-blue-600 group-focus-within:border-cerulean-blue-400"
      >
        i
      </span>
      <span
        role="tooltip"
        className="invisible absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs font-normal leading-relaxed text-gray-600 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  )
}
