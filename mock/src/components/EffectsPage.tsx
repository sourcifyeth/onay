// The cards of every case of the effects preview, with a chip for each
// case. The case in the URL opens first.
import { useState } from 'react'
import { effectsCases } from '../data/effects'
import { EffectsCard } from './SimulationStep'

const YOU = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'

export function EffectsPage() {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get('case') ?? effectsCases[0].id)
  const current = effectsCases.find((c) => c.id === id) ?? effectsCases[0]
  const pick = (next: string) => {
    setId(next)
    history.replaceState(null, '', `?case=${next}`)
  }
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <span className="font-vt323 text-3xl text-cerulean-blue-500">Onay</span>
        <span className="font-mono text-xs text-gray-400">UX mock · fake data</span>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 py-6">
        <h1 className="text-base font-semibold text-gray-900">Transaction Simulation</h1>
        <div className="flex flex-wrap gap-1.5">
          {effectsCases.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors ${
                c.id === current.id
                  ? 'border-cerulean-blue-500 bg-cerulean-blue-500 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-cerulean-blue-300'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500">{current.note}</p>
        {/* the key starts the clock of the card again for each case */}
        <EffectsCard key={current.id} effects={current.effects} you={YOU} helios={!current.rpc} />
      </main>
    </div>
  )
}
