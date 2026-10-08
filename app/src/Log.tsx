// Log lines, as the gate page and the review cards show them.

import { useState } from 'react'
import type { TimedLine } from './gates/verification.ts'
import { LocallyVerifiedIcon, ThirdPartyIcon } from './Icons.tsx'

// The trust icon of a line, or a blank of the same width.
function Proof({ proof }: { proof: boolean | undefined }) {
  const className = 'mr-1.5 inline-block h-3 w-3 align-[-1.5px]'
  if (proof === true) return <LocallyVerifiedIcon className={className} title="Checked on this machine" />
  if (proof === false) return <ThirdPartyIcon className={className} title="From a third party, not checked here" />
  return <span className={className} />
}

// The stamp and the icon keep their place: a long text wraps under its
// own first word, not under them.
export function LogLineView({ line, tag = false }: { line: TimedLine; tag?: boolean }) {
  return (
    <p className="flex items-start">
      <span className="shrink-0 whitespace-pre text-gray-300">[{(line.at / 1000).toFixed(6).padStart(10)}] </span>
      <span className="shrink-0">
        <Proof proof={line.proof} />
      </span>
      <span className="min-w-0 break-all">
        {tag && <span className="text-gray-400">{line.source} </span>}
        <span className="text-gray-500">{line.text}</span>
        {line.ok === true && <span className="text-green-600"> ✓</span>}
        {line.ok === false && <span className="text-light-coral-700"> ✕</span>}
      </span>
    </p>
  )
}

export function Cursor() {
  return <span className="animate-pulse text-cerulean-blue-500">▍</span>
}

export function CollapsibleLog({ lines }: { lines: TimedLine[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 font-mono text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {open ? 'hide logs ▴' : 'show logs ▾'}
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed">
          {lines.map((line, index) => (
            <LogLineView key={index} line={line} />
          ))}
        </div>
      )}
    </>
  )
}
