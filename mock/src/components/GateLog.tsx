import { useEffect, useMemo, useState } from 'react'
import type { MockRequest } from '../data/mockRequest'
import {
  codeReadLog,
  heliosSyncLog,
  localVerificationLog,
  type LogLine,
  type Tag,
} from '../data/verificationLog'

const TAG_STYLE: Record<Tag, string> = {
  helios: 'text-cerulean-blue-500',
  rpc: 'text-amber-600',
  sourcify: 'text-light-coral-600',
  verifier: 'text-green-600',
}

export function LogLineView({ line }: { line: LogLine }) {
  return (
    <p className="break-all">
      {line.stamp && <span className="text-gray-300">{line.stamp} </span>}
      <span className={TAG_STYLE[line.tag]}>{line.tag}</span>{' '}
      <span className="text-gray-500">{line.text}</span>
      {line.ok === true && <span className="text-green-600"> ✓</span>}
      {line.ok === false && <span className="text-light-coral-700"> ✕</span>}
    </p>
  )
}

/** a "show logs" toggle over a fixed list of lines, used inside the step cards */
export function CollapsibleLog({ lines }: { lines: LogLine[] }) {
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
          {lines.map((line) => (
            <LogLineView key={line.text} line={line} />
          ))}
        </div>
      )}
    </>
  )
}

function buildLog(request: MockRequest): LogLine[] {
  const target =
    request.contracts[0]?.address ?? request.raw.find((f) => f.name === 'to')?.value ?? ''
  const lines: LogLine[] = [
    { tag: 'verifier', text: `request received · ${request.method} · via ${request.via}`, delay: 200 },
  ]

  if (request.chainMode === 'helios') {
    lines.push(...heliosSyncLog(request.chain))
  } else {
    lines.push(
      { tag: 'verifier', text: `rpc mode · ${request.chain} has no Helios support`, delay: 250 },
      { tag: 'verifier', text: 'chain state comes from the configured endpoint, unverified', delay: 300 },
    )
  }

  if (request.contracts.length === 0) {
    lines.push(
      codeReadLog(target, request.chainMode === 'helios', true),
      { tag: 'verifier', text: 'no calldata · plain value transfer', delay: 300 },
      { tag: 'verifier', text: 'nothing to compile · opening', delay: 350, ok: true },
    )
  } else {
    lines.push(codeReadLog(target, request.chainMode === 'helios'))

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
          ...localVerificationLog(first),
          { tag: 'verifier', text: `0/${request.contracts.length} contracts verified · halting`, delay: 350, ok: false },
        )
      } else {
        lines.push(
          ...localVerificationLog(first),
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
  onDone: () => void
}

/** the live log while the checks run; the parent unmounts it when they finish */
export function GateLog({ request, onDone }: GateLogProps) {
  const lines = useMemo(() => buildLog(request), [request])
  const [visible, setVisible] = useState(0)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    let acc = 0
    lines.forEach((line, i) => {
      acc += line.delay
      timers.push(setTimeout(() => setVisible(i + 1), acc))
    })
    timers.push(setTimeout(onDone, acc + 600))
    return () => timers.forEach(clearTimeout)
  }, [lines, onDone])

  const target =
    request.contracts[0]?.address ?? request.raw.find((f) => f.name === 'to')?.value ?? ''

  return (
    <div className="font-mono text-xs">
      <div className="flex items-center gap-2 text-gray-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cerulean-blue-300 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-cerulean-blue-500" />
        </span>
        <span className="truncate">
          verification · {target} on {request.chain}
        </span>
      </div>
      <div className="pt-2 leading-relaxed">
        {lines.slice(0, visible).map((line) => (
          <LogLineView key={line.stamp} line={line} />
        ))}
        <span className="animate-pulse text-cerulean-blue-500">▍</span>
      </div>
    </div>
  )
}
