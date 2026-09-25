import type { MockRequest } from '../data/mockRequest'

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

function BigAddress({ value }: { value: string }) {
  return <p className="break-all font-mono text-lg font-medium text-gray-900">{value}</p>
}

function Target({ request }: { request: MockRequest }) {
  if (request.batch) {
    const targets = [
      ...new Set(request.batch.calls.map((c) => c.raw.find((f) => f.name === 'to')?.value ?? '')),
    ]
    return (
      <>
        <p className="text-xs text-gray-500">Contracts</p>
        {targets.map((t) => (
          <BigAddress key={t} value={t} />
        ))}
      </>
    )
  }
  const target =
    request.contracts[0]?.address ?? request.raw.find((f) => f.name === 'to')?.value ?? ''
  const label =
    request.contracts.length === 0
      ? 'Recipient · not a contract'
      : request.typedData
        ? 'Verifying contract'
        : 'Contract'
  return (
    <>
      <p className="text-xs text-gray-500">{label}</p>
      <BigAddress value={target} />
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
      <div className="pt-5">
        <Target request={request} />
        <p className="pt-1 text-base text-gray-700">
          {request.chain} - chainId: {request.chainId}
        </p>
      </div>
    </section>
  )
}
