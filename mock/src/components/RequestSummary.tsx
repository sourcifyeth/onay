import type { ReactNode } from 'react'
import { getContractInfo, type MockRequest } from '../data/mockRequest'

function Headline({ request, pasted }: { request: MockRequest; pasted: boolean }) {
  if (pasted) return <>You pasted a transaction</>
  const site = (
    <>
      Website{' '}
      <a
        href={`https://${request.origin}`}
        target="_blank"
        rel="noreferrer"
        className="text-cerulean-blue-600 underline decoration-cerulean-blue-200 underline-offset-2 hover:decoration-cerulean-blue-500"
      >
        {request.origin}
      </a>
    </>
  )
  if (request.typedData) return <>{site} created a message for you to sign</>
  if (request.batch) {
    return (
      <>
        {site} created {request.batch.calls.length} transactions for you to sign and execute
      </>
    )
  }
  return <>{site} created a transaction for you to sign and execute</>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-1">
      <dt className="w-24 shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-sm text-gray-800">{children}</dd>
    </div>
  )
}

function Address({ value }: { value: string }) {
  return <span className="break-all font-mono text-[13px] text-gray-900">{value}</span>
}

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

// placeholder rows, to be refined: which facts to show, and where they come from
function ContractInfoRows({ address }: { address: string }) {
  const info = getContractInfo(address)
  if (!info) return null
  const date = new Date(info.deployedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return (
    <>
      <Row label="Deployed">
        {date} · {age(info.deployedAt)}
        <span className="text-gray-400"> · block {info.deployBlock.toLocaleString('en-US')}</span>
      </Row>
      <Row label="Transactions">{info.txCount.toLocaleString('en-US')}</Row>
      <Row label="Labels">
        {info.labels.length === 0 ? (
          <span className="text-gray-400">none</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {info.labels.map((l) => (
              <span
                key={l}
                className="rounded-full bg-gray-200/70 px-2 py-0.5 text-xs font-medium text-gray-700"
              >
                {l}
              </span>
            ))}
          </span>
        )}
      </Row>
    </>
  )
}

function TargetRows({ request }: { request: MockRequest }) {
  if (request.batch) {
    const targets = [
      ...new Set(request.batch.calls.map((c) => c.raw.find((f) => f.name === 'to')?.value ?? '')),
    ]
    return (
      <Row label="Contracts">
        {targets.map((t) => (
          <p key={t}>
            <Address value={t} />
          </p>
        ))}
      </Row>
    )
  }
  const target =
    request.contracts[0]?.address ?? request.raw.find((f) => f.name === 'to')?.value ?? ''
  return (
    <>
      <Row label={request.contracts.length === 0 ? 'Recipient' : 'Contract'}>
        <Address value={target} />
      </Row>
      <ContractInfoRows address={target} />
    </>
  )
}

export function RequestSummary({ request }: { request: MockRequest }) {
  const pasted = request.via === 'manual input'
  return (
    <section className="animate-fade-up">
      <p className="text-base font-medium text-gray-900">
        <Headline request={request} pasted={pasted} />
      </p>
      <p className="pt-1 text-sm text-gray-500">
        Nothing is signed or sent yet.
        {!pasted && ' If you confirm, your wallet opens as usual.'}
      </p>
      <dl className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
        <TargetRows request={request} />
        <Row label="Chain">{request.chain}</Row>
      </dl>
    </section>
  )
}
