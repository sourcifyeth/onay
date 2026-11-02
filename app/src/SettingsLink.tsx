import { useContext, type ReactNode } from 'react'
import { OpenSettings, type SettingsField } from './openSettings.ts'

export function SettingsLink({ field, children }: { field: SettingsField; children: ReactNode }) {
  const open = useContext(OpenSettings)
  return (
    <button onClick={() => open(field)} className="text-cerulean-blue-600 hover:underline">
      {children}
    </button>
  )
}
