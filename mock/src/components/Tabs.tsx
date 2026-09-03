import { useState, type ReactNode } from 'react'

interface TabsProps {
  tabs: { label: string; content: ReactNode }[]
}

export function Tabs({ tabs }: TabsProps) {
  const [active, setActive] = useState(0)
  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActive(i)}
            className={`-mb-px px-3 py-1.5 font-mono text-xs border-b-2 transition-colors ${
              i === active
                ? 'border-cerulean-blue-500 text-cerulean-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-3">{tabs[active].content}</div>
    </div>
  )
}
