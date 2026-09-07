import type { Scenario } from '../data/mockRequest'

interface DebugBarProps {
  phase: string
  extensionInstalled: boolean
  scenarios: Scenario[]
  scenarioId: string
  onScenarioChange: (id: string) => void
  onSimulateInterception: () => void
  onToggleExtension: () => void
  onReset: () => void
}

const btn =
  'rounded px-2 py-1 hover:bg-white/15 transition-colors text-left whitespace-nowrap'

export function DebugBar({
  phase,
  extensionInstalled,
  scenarios,
  scenarioId,
  onScenarioChange,
  onSimulateInterception,
  onToggleExtension,
  onReset,
}: DebugBarProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-xl bg-gray-900/90 px-2 py-1.5 font-mono text-xs text-gray-300 shadow-lg backdrop-blur">
      <span className="px-2 text-gray-500">debug</span>
      <span className="px-2 text-cerulean-blue-200">{phase}</span>
      <select
        value={scenarioId}
        onChange={(e) => onScenarioChange(e.target.value)}
        className="max-w-44 rounded bg-white/10 px-1.5 py-1 text-gray-300 outline-none hover:bg-white/15"
      >
        {scenarios.map((s) => (
          <option key={s.id} value={s.id} className="bg-gray-900">
            {s.label}
          </option>
        ))}
      </select>
      <button className={btn} onClick={onSimulateInterception}>
        ⚡ intercept
      </button>
      <button className={btn} onClick={onToggleExtension}>
        {extensionInstalled ? '⛔ uninstall ext' : '✔ install ext'}
      </button>
      <button className={btn} onClick={onReset}>
        ↺ reset
      </button>
    </div>
  )
}
