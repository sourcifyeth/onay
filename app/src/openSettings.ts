import { createContext } from 'react'

// A field of the settings that a link can open.
export type SettingsField = 'etherscan-key' | 'goplus'

// The way to open the settings at a field. The app gives it, so that a
// card deep in the review needs no prop for it.
export const OpenSettings = createContext<(field: SettingsField) => void>(() => {})
