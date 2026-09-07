import { useEffect, useMemo, useState } from 'react'
import type { MockRequest } from '../data/mockRequest'

type Tag = 'helios' | 'sourcify' | 'verifier'

interface LogLine {
  tag: Tag
  text: string
  delay: number // ms after previous line
  /** true renders a green check, false a coral cross */
  ok?: boolean
  stamp?: string // dmesg-style boot time, filled in by buildLog
}

const TAG_STYLE: Record<Tag, string> = {
  helios: 'text-cerulean-blue-500',
  sourcify: 'text-light-coral-600',
  verifier: 'text-green-600',
}

function buildLog(request: MockRequest): LogLine[] {
  const target =
    request.contracts[0]?.address ?? request.raw.find((f) => f.name === 'to')?.value ?? ''
  const lines: LogLine[] = [
    { tag: 'verifier', text: `request received · ${request.method} · via ${request.via}`, delay: 200 },
  ]

  if (request.chainMode === 'helios') {
    lines.push(
      { tag: 'helios', text: `starting light client · network=${request.chain}`, delay: 250 },
      { tag: 'helios', text: 'checkpoint 0xa41c…9be2 · age 3h · within weak subjectivity window', delay: 300 },
      { tag: 'helios', text: 'sync committee verified · 512/512 signatures', delay: 350, ok: true },
      { tag: 'helios', text: 'finalized head · slot 9,214,336 · in sync', delay: 250 },
    )
  } else {
    lines.push(
      { tag: 'verifier', text: `rpc mode · ${request.chain} has no Helios support`, delay: 250 },
      { tag: 'verifier', text: 'chain state comes from the configured endpoint, unverified', delay: 300 },
    )
  }

  if (request.contracts.length === 0) {
    lines.push(
      { tag: 'helios', text: `eth_getCode ${target} · empty · recipient is not a contract`, delay: 300 },
      { tag: 'verifier', text: 'no calldata · plain value transfer', delay: 300 },
      { tag: 'verifier', text: 'nothing to compile · opening', delay: 350, ok: true },
    )
  } else {
    lines.push({
      tag: 'helios',
      text:
        request.chainMode === 'helios'
          ? `eth_getCode ${target} · merkle proof verified`
          : `eth_getCode ${target}`,
      delay: 300,
      ok: request.chainMode === 'helios',
    })

    if (request.outcome === 'reverted') {
      lines.push(
        {
          tag: 'verifier',
          text: `simulated call trace · reverted: ${request.revertReason}`,
          delay: 500,
          ok: false,
        },
        { tag: 'verifier', text: 'halting · this transaction would revert on chain', delay: 350, ok: false },
      )
    } else {
      if (request.typedData) {
        const primaryType = request.raw.find((f) => f.name === 'primaryType')?.value ?? 'message'
        lines.push({
          tag: 'verifier',
          text: `typed data · ${primaryType} · signature only, nothing executes until it is used`,
          delay: 350,
        })
      } else if (request.batch) {
        lines.push({
          tag: 'verifier',
          text: `simulated batch · ${request.batch.calls.length} calls · ${request.contracts.length} contracts touched`,
          delay: 350,
        })
      } else {
        lines.push({
          tag: 'verifier',
          text: `simulated call trace · ${request.contracts.length} contracts touched`,
          delay: 350,
        })
      }

      const [first, ...rest] = request.contracts
      if (request.outcome === 'unverified') {
        lines.push(
          { tag: 'sourcify', text: `looking up ${first.address}`, delay: 300 },
          { tag: 'sourcify', text: 'no match found on Sourcify · nothing to compile', delay: 500, ok: false },
          { tag: 'verifier', text: `0/${request.contracts.length} contracts verified · halting`, delay: 350, ok: false },
        )
      } else {
        lines.push(
          { tag: 'sourcify', text: `fetching sources for ${first.address} · ${first.sources.length} files`, delay: 300 },
          { tag: 'sourcify', text: 'solc 0.8.24+commit.e11b9ed9 · wasm · hash verified against solc-bin', delay: 300, ok: true },
          { tag: 'sourcify', text: 'compiling…', delay: 500 },
          { tag: 'sourcify', text: `runtime bytecode compare · ${first.matchType}`, delay: 300, ok: true },
          ...rest.map(
            (c): LogLine => ({
              tag: 'sourcify',
              text: `${c.address} · recompiled · ${c.matchType}`,
              delay: 350,
              ok: true,
            }),
          ),
          {
            tag: 'verifier',
            text: `${request.contracts.length}/${request.contracts.length} contracts verified · opening`,
            delay: 350,
            ok: true,
          },
        )
      }
    }
  }

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
  const target =
    request.contracts[0]?.address ?? request.raw.find((f) => f.name === 'to')?.value ?? ''
  const doneLabel =
    request.outcome === 'verified'
      ? '✓ verification passed'
      : request.outcome === 'reverted'
        ? '✕ simulation reverted'
        : '✕ verification failed'

  return (
    <div className="font-mono text-xs">
      <div className="flex items-center gap-2 text-gray-500">
        {running ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cerulean-blue-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cerulean-blue-500" />
            </span>
            <span className="truncate">
              verification · {target} on {request.chain}
            </span>
          </>
        ) : (
          <>
            <span className={request.outcome === 'verified' ? 'text-green-600' : 'text-light-coral-700'}>
              {doneLabel}
            </span>
            <span className="text-gray-400">
              {request.chainMode === 'helios' ? 'Helios + lib-sourcify' : 'RPC + lib-sourcify'}
            </span>
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
            <p key={line.stamp} className="break-all">
              <span className="text-gray-300">{line.stamp}</span>{' '}
              <span className={TAG_STYLE[line.tag]}>{line.tag}</span>{' '}
              <span className="text-gray-500">{line.text}</span>
              {line.ok === true && <span className="text-green-600"> ✓</span>}
              {line.ok === false && <span className="text-light-coral-700"> ✕</span>}
            </p>
          ))}
          {running && <span className="animate-pulse text-cerulean-blue-500">▍</span>}
        </div>
      </div>
    </div>
  )
}
