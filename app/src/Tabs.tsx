// Tabs inside a card. Taken from the mock.

import { useState, type ReactNode } from 'react'

export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [current, setCurrent] = useState(0)
  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            onClick={() => setCurrent(index)}
            className={`-mb-px border-b-2 px-3 py-1.5 font-mono text-xs transition-colors ${
              index === current
                ? 'border-cerulean-blue-500 font-medium text-cerulean-blue-600'
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
