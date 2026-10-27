// Log lines, as the gate page and the review cards show them.

import { useEffect, useRef, useState } from 'react'
import type { Progress } from './gates/contracts.ts'
import type { TimedLine } from './gates/verification.ts'
import { LocallyVerifiedIcon, SpinnerIcon, ThirdPartyIcon } from './Icons.tsx'

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

// The state of a gate, in the header of its log. The icons of the ends
// are the ones of the review: the local check, the cross of a failed
// line, the warning sign of a notice.
const PROGRESS_TITLE: Record<Progress, string> = {
  waiting: 'Waiting',
  running: 'Running',
  passed: 'Passed',
  flagged: 'Passed, with a warning',
  failed: 'Failed',
  skipped: 'Skipped',
}

export function ProgressIcon({ progress }: { progress: Progress }) {
  const title = PROGRESS_TITLE[progress]
  const box = 'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center'
  switch (progress) {
    case 'waiting':
      return <span className={`${box} rounded-full border-2 border-gray-300`} title={title} />
    case 'running':
      return <SpinnerIcon className={box} title={title} />
    case 'passed':
      return <LocallyVerifiedIcon className={box} title={title} />
    case 'flagged':
      return (
        <span className={`${box} text-sm leading-none text-amber-600`} title={title}>
          ⚠
        </span>
      )
    case 'failed':
      return (
        <span className={`${box} text-sm leading-none text-light-coral-700`} title={title}>
          ✕
        </span>
      )
    case 'skipped':
      return (
        <span className={`${box} text-sm leading-none text-gray-400`} title={title}>
          –
        </span>
      )
  }
}

// The lines of one gate while it runs, in a box of five lines. The box
// follows the newest line until you scroll up, and follows again when
// you scroll back to the bottom.
const BOX_LINES = 5

export function LogBox({ lines }: { lines: TimedLine[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [follows, setFollows] = useState(true)
  useEffect(() => {
    const element = box.current
    if (follows && element) element.scrollTop = element.scrollHeight
  }, [follows, lines.length])
  const onScroll = () => {
    const element = box.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 2
    setFollows(atBottom)
  }
  return (
    <div
      ref={box}
      onScroll={onScroll}
      style={{ maxHeight: `calc(${BOX_LINES} * 1.625em)` }}
      className="mt-1 overflow-y-auto rounded-md bg-gray-50 px-2 leading-relaxed"
    >
      {lines.map((line, index) => (
        <LogLineView key={index} line={line} />
      ))}
      <Cursor />
    </div>
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
