// Tabs inside a card. Taken from the mock.

import { useState, type ReactNode } from 'react'

// The id names the tab for the end-to-end tests; the label can change
// with the content.
export type Tab = { id: string; label: string; content: ReactNode }

// The selection is the label, so that a list that changes keeps it when
// it can, and falls back to the first tab when it cannot.
export function Tabs({ tabs }: { tabs: Tab[] }) {
  const [chosen, setChosen] = useState(tabs[0].label)
  const current = Math.max(
    tabs.findIndex((tab) => tab.label === chosen),
    0,
  )
  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            data-tab={tab.id}
            onClick={() => setChosen(tab.label)}
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
