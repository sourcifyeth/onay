import { useEffect, useMemo, useState } from 'react'
import type { MockRequest } from '../data/mockRequest'

type Tag = 'helios' | 'sourcify' | 'gate'

interface LogLine {
  tag: Tag
  text: string
  delay: number // ms after previous line
  stamp?: string // dmesg-style boot time, filled in by buildLog
}

const TAG_STYLE: Record<Tag, string> = {
  helios: 'text-cerulean-blue-500',
  sourcify: 'text-light-coral-600',
  gate: 'text-green-600',
}

function buildLog(request: MockRequest): LogLine[] {
  const lines: LogLine[] = [
    { tag: 'gate', text: `request received · ${request.method} · via ${request.via}`, delay: 200 },
    { tag: 'helios', text: `starting light client · network=${request.chain}`, delay: 250 },
    { tag: 'helios', text: 'checkpoint 0xa41c…9be2 · age 3h · within weak subjectivity window', delay: 300 },
    { tag: 'helios', text: 'sync committee verified · 512/512 signatures', delay: 350 },
    { tag: 'helios', text: 'finalized head · slot 9,214,336 · in sync', delay: 250 },
    { tag: 'helios', text: `eth_getCode ${request.contractAddress} · merkle proof verified`, delay: 300 },
    { tag: 'sourcify', text: `fetching sources for ${request.contractAddress} · ${request.sources.length} files`, delay: 300 },
    { tag: 'sourcify', text: 'solc 0.8.24+commit.e11b9ed9 · wasm · hash verified against solc-bin', delay: 300 },
    { tag: 'sourcify', text: 'compiling…', delay: 500 },
    { tag: 'sourcify', text: 'runtime bytecode compare · exact match', delay: 300 },
    { tag: 'gate', text: `contract ${request.contractName} verified · opening`, delay: 350 },
  ]
  let acc = 0
  for (const line of lines) {
    acc += line.delay
    line.stamp = `[${(acc / 1000 + Math.random() * 0.001).toFixed(6).padStart(10, ' ')}]`
  }
  return lines
}

interface GateLogProps {
  request: MockRequest
  running: boolean
  onDone: () => void
}

export function GateLog({ request, running, onDone }: GateLogProps) {
  const lines = useMemo(() => buildLog(request), [request])
  const [visible, setVisible] = useState(0)
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    if (!running) return
    setVisible(0)
    setShowLogs(false)
    const timers: ReturnType<typeof setTimeout>[] = []
    let acc = 0
    lines.forEach((line, i) => {
      acc += line.delay
      timers.push(setTimeout(() => setVisible(i + 1), acc))
    })
    timers.push(setTimeout(onDone, acc + 600))
    return () => timers.forEach(clearTimeout)
  }, [running, lines, onDone])

  const expanded = running || showLogs

  return (
    <div className="font-mono text-xs">
      <div className="flex items-center gap-2 text-gray-500">
        {running ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cerulean-blue-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cerulean-blue-500" />
            </span>
            <span>
              verification gate · {request.contractAddress} on {request.chain}
            </span>
          </>
        ) : (
          <>
            <span className="text-green-600">✓ gate passed</span>
            <span className="text-gray-400">Helios + lib-sourcify</span>
            <button
              onClick={() => setShowLogs((v) => !v)}
              className="ml-auto rounded px-2 py-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              {showLogs ? 'hide logs ▴' : 'show logs ▾'}
            </button>
          </>
        )}
      </div>
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-700 ease-in-out ${
          expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="pt-2 leading-relaxed">
          {lines.slice(0, visible).map((line) => (
            <p key={line.stamp}>
              <span className="text-gray-300">{line.stamp}</span>{' '}
              <span className={TAG_STYLE[line.tag]}>{line.tag}</span>{' '}
              <span className="text-gray-500">{line.text}</span>
              {(line.text.includes('verified') || line.text.includes('match')) && (
                <span className="text-green-600"> ✓</span>
              )}
            </p>
          ))}
          {running && <span className="animate-pulse text-cerulean-blue-500">▍</span>}
        </div>
      </div>
    </div>
  )
}
