import type { MockRequest } from '../data/mockRequest'
import { Tabs } from './Tabs'

function ClearSigningPane({ request }: { request: MockRequest }) {
  return (
    <div>
      <p className="pb-2">
        <span className="rounded-full bg-cerulean-blue-100 px-2.5 py-0.5 text-sm font-medium text-cerulean-blue-700">
          {request.operation}
        </span>
      </p>
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[15px] leading-relaxed text-gray-700">
        {request.intent.map((part, i) =>
          part.value ? (
            <strong key={i} className="font-semibold text-gray-900">
              {part.text}
            </strong>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
      <dl className="mt-3 divide-y divide-gray-100">
        {request.fields.map((f) => (
          <div key={f.name} className="flex items-baseline justify-between gap-6 py-2">
            <dt className="shrink-0 text-sm text-gray-500">{f.name}</dt>
            <dd className="text-right text-sm font-medium text-gray-800">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function AdvancedPane({ request }: { request: MockRequest }) {
  return (
    <div>
      <dl className="divide-y divide-gray-100">
        {request.raw.map((f) => (
          <div key={f.name} className="flex items-baseline justify-between gap-6 py-1.5 font-mono text-xs">
            <dt className="shrink-0 text-gray-500">{f.name}</dt>
            <dd className="break-all text-right text-gray-800">{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="pb-1 pt-3 font-mono text-xs text-gray-500">calldata</p>
      <p className="break-all rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
        {request.calldata}
      </p>
    </div>
  )
}

export function TransactionCard({ request }: { request: MockRequest }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="pb-3 text-xs font-mono uppercase tracking-widest text-gray-500">Transaction</h2>
      <Tabs
        tabs={[
          { label: 'Clear signing', content: <ClearSigningPane request={request} /> },
          { label: 'Advanced', content: <AdvancedPane request={request} /> },
        ]}
      />
    </section>
  )
}
