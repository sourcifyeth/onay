// A page with only the simulation step of the swap example, to share the effects preview (issue #34).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { mockRequest } from './data/mockRequest'
import { SimulationCard } from './components/SimulationStep'

const intent = mockRequest.clearSigning?.interpolatedIntent.map((part) => part.text).join('')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <span className="font-vt323 text-3xl text-cerulean-blue-500">Onay</span>
        <span className="font-mono text-xs text-gray-400">UX mock · fake data</span>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 py-6">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Transaction Simulation</h1>
          {intent && (
            <p className="pt-1 text-sm text-gray-500">
              {mockRequest.origin} asks: {intent}
            </p>
          )}
        </div>
        <SimulationCard request={mockRequest} />
      </main>
    </div>
  </StrictMode>,
)
