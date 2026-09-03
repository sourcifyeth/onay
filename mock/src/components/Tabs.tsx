import { useState, type ReactNode } from 'react'

interface TabsProps {
  tabs: { label: string; content: ReactNode }[]
  /** controlled mode: current tab index */
  active?: number
  onChange?: (index: number) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  const [internal, setInternal] = useState(0)
  const current = active ?? internal
  const select = (i: number) => {
    onChange?.(i)
    if (active === undefined) setInternal(i)
  }
  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => select(i)}
            className={`-mb-px px-3 py-1.5 font-mono text-xs border-b-2 transition-colors ${
              i === current
                ? 'border-cerulean-blue-500 text-cerulean-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-3">{tabs[current].content}</div>
    </div>
  )
}
