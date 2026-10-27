// The settings of the context lookups: the Etherscan key of the user,
// and the switch of GoPlus. Saved in the webview. The pure parts have no
// browser calls, so the tests run them.

export const STORAGE_KEY = 'onay.context'

export type ContextSettings = {
  // Empty: Onay does not ask Etherscan.
  etherscanKey: string
  goPlus: boolean
}

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = { etherscanKey: '', goPlus: true }

// An Etherscan key is 34 letters and digits. The check is loose, so a
// key of a new format still works, but it keeps other text out of the
// URL of the request.
export const isEtherscanKey = (value: string) => /^[A-Za-z0-9]{0,64}$/.test(value)

// The saved settings. A field with a bad value gets its default.
export function parseContextSettings(value: unknown): ContextSettings {
  const saved = value as Partial<Record<keyof ContextSettings, unknown>> | null
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return DEFAULT_CONTEXT_SETTINGS
  const { etherscanKey, goPlus } = saved
  return {
    etherscanKey:
      typeof etherscanKey === 'string' && isEtherscanKey(etherscanKey.trim())
        ? etherscanKey.trim()
        : DEFAULT_CONTEXT_SETTINGS.etherscanKey,
    goPlus: typeof goPlus === 'boolean' ? goPlus : DEFAULT_CONTEXT_SETTINGS.goPlus,
  }
}

export function loadContextSettings(stored: string | null): ContextSettings {
  try {
    return parseContextSettings(JSON.parse(stored ?? 'null'))
  } catch {
    return DEFAULT_CONTEXT_SETTINGS
  }
}

let settings = load()
const listeners = new Set<() => void>()

export const contextSettingsStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => settings,
}

export function saveContextSettings(next: ContextSettings) {
  settings = parseContextSettings(next)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // The change stays until the app closes.
  }
  for (const listener of listeners) listener()
}

function load(): ContextSettings {
  try {
    return loadContextSettings(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_CONTEXT_SETTINGS
  }
}
