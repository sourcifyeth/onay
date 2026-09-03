import type { MockRequest } from '../data/mockRequest'
import { Tabs } from './Tabs'

function IntentPane({ request }: { request: MockRequest }) {
  return (
    <p className="rounded-lg border-l-4 border-cerulean-blue-400 bg-cerulean-blue-100/60 px-4 py-3 text-sm text-gray-800">
      {request.intent}
    </p>
  )
}

function FieldsPane({ request }: { request: MockRequest }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-gray-100">
        {request.fields.map((f) => (
          <tr key={f.name}>
            <td className="w-36 py-1.5 pr-4 align-top font-mono text-xs text-gray-500">{f.name}</td>
            <td className="py-1.5 text-gray-800">{f.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ClearSigningCard({ request }: { request: MockRequest }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="pb-3 text-xs font-mono uppercase tracking-widest text-gray-500">Clear signing</h2>
      <Tabs
        tabs={[
          { label: 'Intent', content: <IntentPane request={request} /> },
          { label: 'Fields', content: <FieldsPane request={request} /> },
        ]}
      />
    </section>
  )
}
