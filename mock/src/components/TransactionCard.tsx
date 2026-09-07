import { useState, type ReactNode } from 'react'
import type { BatchCall, ClearSigning, IntentPart, MockRequest, TxField } from '../data/mockRequest'
import { Tabs } from './Tabs'

function Interpolated({ parts }: { parts: IntentPart[] }) {
  return (
    <p className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] leading-relaxed text-gray-700">
      {parts.map((part, i) =>
        part.value ? (
          <strong key={i} className="font-semibold text-gray-900">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  )
}

function IntentToggle({
  pill,
  open,
  onToggle,
}: {
  pill: ReactNode
  open: boolean
  onToggle: () => void
}) {
  return (
    <p className="flex items-center justify-between pb-2">
      {pill}
      <button
        onClick={onToggle}
        className="font-mono text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {open ? 'hide intent ▴' : 'show intent ▾'}
      </button>
    </p>
  )
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function FieldList({ fields }: { fields: TxField[] }) {
  return (
    <dl className="divide-y divide-gray-100">
      {fields.map((f) => (
        <div key={f.name} className="py-1">
          <div className="flex items-baseline justify-between gap-6">
            <dt className="shrink-0 text-sm text-gray-500">{f.name}</dt>
            {f.embedded ? (
              <dd className="text-right font-mono text-xs text-gray-400">{f.value}</dd>
            ) : (
              <dd className="text-right text-sm font-medium text-gray-800">{f.value}</dd>
            )}
          </div>
          {f.embedded && (
            <div className="mb-1 mt-1.5 border-l-2 border-cerulean-blue-200 pl-3">
              <p className="flex items-center gap-2 pb-1">
                <span className="rounded-full bg-cerulean-blue-100 px-2 py-0.5 text-xs font-medium text-cerulean-blue-700">
                  {f.embedded.intent}
                </span>
                <span className="font-mono text-xs text-gray-400">
                  → {f.embedded.calleeName} {shortAddress(f.embedded.callee)}
                </span>
              </p>
              <FieldList fields={f.embedded.fields} />
            </div>
          )}
        </div>
      ))}
    </dl>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-cerulean-blue-100 px-2.5 py-0.5 text-sm font-medium text-cerulean-blue-700">
      {children}
    </span>
  )
}

function Provenance({ cs }: { cs: ClearSigning }) {
  if (!cs.provenance) return null
  const { text, url } = cs.provenance
  return (
    <p className="pt-3 font-mono text-[11px] leading-relaxed text-gray-400">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="hover:text-cerulean-blue-600">
          {text} ↗
        </a>
      ) : (
        text
      )}
    </p>
  )
}

function Warnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null
  return (
    <>
      {warnings.map((w) => (
        <p
          key={w}
          className="mt-3 rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
        >
          {w}
        </p>
      ))}
    </>
  )
}

function BatchClearPane({ request }: { request: MockRequest }) {
  const [showIntent, setShowIntent] = useState(false)
  const batch = request.batch!
  return (
    <div>
      <IntentToggle
        pill={<Pill>Batch · {batch.calls.length} calls</Pill>}
        open={showIntent}
        onToggle={() => setShowIntent((v) => !v)}
      />
      {showIntent && <Interpolated parts={batch.interpolatedIntent} />}
      <div className="flex flex-col gap-2">
        {batch.calls.map((call, i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-3">
            <p className="flex items-center gap-2 pb-1">
              <span className="font-mono text-xs text-gray-400">call {i + 1}</span>
              <span className="rounded-full bg-cerulean-blue-100 px-2 py-0.5 text-xs font-medium text-cerulean-blue-700">
                {call.intent}
              </span>
            </p>
            <FieldList fields={call.fields} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ClearSigningPane({ request }: { request: MockRequest }) {
  const [showIntent, setShowIntent] = useState(false)
  const cs = request.clearSigning

  if (request.batch) return <BatchClearPane request={request} />

  if (!cs) {
    const unverifiedEntry = request.contracts[0]?.matchType === 'no match'
    return (
      <div>
        <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          No ERC-7730 clear signing descriptor is registered for this contract, so there is no
          reviewed description of what this transaction does.{' '}
          {unverifiedEntry
            ? 'The contract is not verified either: parameter names below are a signature database guess.'
            : 'The parameters below are decoded from the verified ABI; the names come from the source code, not from a reviewed descriptor.'}
        </p>
        {request.decoded && (
          <dl className="mt-3 divide-y divide-gray-100">
            {request.decoded.params.map((p) => (
              <div key={p.name} className="flex items-baseline justify-between gap-6 py-1">
                <dt className="shrink-0 font-mono text-sm text-gray-500">{p.name}</dt>
                <dd className="break-all text-right font-mono text-sm text-gray-800">{p.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    )
  }

  return (
    <div>
      <IntentToggle
        pill={<Pill>{cs.intent}</Pill>}
        open={showIntent}
        onToggle={() => setShowIntent((v) => !v)}
      />
      {showIntent && <Interpolated parts={cs.interpolatedIntent} />}
      <FieldList fields={cs.fields} />
      <Warnings warnings={cs.warnings} />
      <Provenance cs={cs} />
    </div>
  )
}

function RawList({ fields }: { fields: TxField[] }) {
  return (
    <dl className="divide-y divide-gray-100">
      {fields.map((f) => (
        <div key={f.name} className="flex items-baseline justify-between gap-6 py-1.5 font-mono text-xs">
          <dt className="shrink-0 text-gray-500">{f.name}</dt>
          <dd className="break-all text-right text-gray-800">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function CalldataBlock({ calldata }: { calldata: string }) {
  return (
    <p className="break-all rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
      {calldata === '0x' ? '0x (empty)' : calldata}
    </p>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="pb-1 pt-3 font-mono text-xs text-gray-500">{children}</p>
}

function BatchAdvanced({ calls }: { calls: BatchCall[] }) {
  return (
    <>
      {calls.map((call, i) => (
        <div key={i}>
          <SectionLabel>call {i + 1}</SectionLabel>
          <div className="rounded-lg border border-gray-200 p-3">
            <RawList fields={call.raw} />
            <p className="pb-1 pt-2 font-mono text-xs text-gray-500">calldata</p>
            <CalldataBlock calldata={call.calldata} />
          </div>
        </div>
      ))}
    </>
  )
}

function AdvancedPane({ request }: { request: MockRequest }) {
  const decoded = request.decoded
  return (
    <div>
      <RawList fields={request.raw} />

      {request.batch && <BatchAdvanced calls={request.batch.calls} />}

      {request.typedData && (
        <>
          <SectionLabel>typed data</SectionLabel>
          <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
            {request.typedData.json}
          </pre>
          <SectionLabel>digests · ERC-8213</SectionLabel>
          <RawList fields={request.typedData.digests} />
        </>
      )}

      {decoded && (
        <>
          <SectionLabel>decoded calldata</SectionLabel>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="font-mono text-xs leading-relaxed">
              <a
                href={`https://4byte.sourcify.dev/?q=${decoded.selector}`}
                target="_blank"
                rel="noreferrer"
                title="look up this selector on 4byte.sourcify.dev"
                className="text-cerulean-blue-600 hover:underline"
              >
                {decoded.selector} ↗
              </a>
              <span className="text-gray-400"> · </span>
              <span className="break-all text-gray-800">{decoded.signature}</span>
            </p>
            <dl className="mt-2 divide-y divide-gray-200/70">
              {decoded.params.map((p) => (
                <div key={p.name} className="py-1.5 font-mono text-xs">
                  <dt className="text-gray-500">
                    {p.name} <span className="text-gray-400">{p.type}</span>
                  </dt>
                  <dd className="break-all pt-0.5 text-gray-800">{p.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      {!request.typedData && !request.batch && (
        <>
          <SectionLabel>calldata</SectionLabel>
          <CalldataBlock calldata={request.calldata} />
        </>
      )}
    </div>
  )
}

export function TransactionCard({ request }: { request: MockRequest }) {
  const isTypedData = request.typedData !== undefined
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="pb-3 text-xs font-mono uppercase tracking-widest text-gray-500">
        {isTypedData ? 'Signature request' : 'Transaction'}
      </h2>
      <Tabs
        tabs={[
          { label: 'Clear signing', content: <ClearSigningPane request={request} /> },
          { label: 'Advanced', content: <AdvancedPane request={request} /> },
        ]}
      />
    </section>
  )
}
