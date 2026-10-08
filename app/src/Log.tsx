// Log lines, as the gate page and the review cards show them.

import { useState } from 'react'
import type { TimedLine } from './gates/verification.ts'

export function LogLineView({ line, tag = false }: { line: TimedLine; tag?: boolean }) {
  return (
    <p className="break-all">
      <span className="whitespace-pre text-gray-300">[{(line.at / 1000).toFixed(6).padStart(10)}] </span>
      {tag && <span className="text-gray-400">{line.source} </span>}
      <span className="text-gray-500">{line.text}</span>
      {line.ok === true && <span className="text-green-600"> ✓</span>}
      {line.ok === false && <span className="text-light-coral-700"> ✕</span>}
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
