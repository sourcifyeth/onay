import type { MockRequest } from '../data/mockRequest'
import { Tabs } from './Tabs'

function SourcesPane({ request }: { request: MockRequest }) {
  return (
    <div>
      <div className="flex items-center justify-between pb-2">
        <span className="font-mono text-sm text-green-700">✓ {request.matchLabel}</span>
        <span className="font-mono text-xs text-gray-500">recompiled locally</span>
      </div>
      <div className="rounded-lg bg-cerulean-blue-100/60 px-3 py-2 font-mono text-xs text-cerulean-blue-800">
        fn {request.functionSignature}
      </div>
      <ul className="mt-2 divide-y divide-gray-100">
        {request.sources.map((file) => (
          <li key={file} className="py-1.5 font-mono text-xs text-gray-700">
            {file}
          </li>
        ))}
      </ul>
      <button
        onClick={() => alert('(mock) the verified sources would open in your editor')}
        className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600"
      >
        Open files in your editor
      </button>
    </div>
  )
}

function CompilerPane({ request }: { request: MockRequest }) {
  return (
    <dl className="divide-y divide-gray-100">
      {request.compilerSettings.map((s) => (
        <div key={s.name} className="flex justify-between gap-4 py-1.5 font-mono text-xs">
          <dt className="text-gray-500">{s.name}</dt>
          <dd className="text-gray-800">{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function VerificationCard({ request }: { request: MockRequest }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="pb-3 text-xs font-mono uppercase tracking-widest text-gray-500">
        Verification · {request.contractName}{' '}
        <span className="normal-case text-gray-400">{request.contractAddress}</span>
      </h2>
      <Tabs
        tabs={[
          { label: 'Sources', content: <SourcesPane request={request} /> },
          { label: 'Compiler settings', content: <CompilerPane request={request} /> },
        ]}
      />
    </section>
  )
}
