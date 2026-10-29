// The lists and GoPlus, in the address profile group of the settings.

import { useState, useSyncExternalStore } from 'react'
import { chainStore } from './chains.ts'
import { agoText } from './context/card.ts'
import { addressListStore, LIST_SOURCES, type ListSource, type ListState } from './context/lists.ts'
import { contextSettingsStore, saveContextSettings } from './context/settings.ts'
import { ExternalLink } from './ExternalLink.tsx'
import { ThirdPartyIcon } from './Icons.tsx'

function Switch({
  id,
  on,
  label,
  onChange,
}: {
  id?: string
  on: boolean
  label: string
  onChange: (on: boolean) => void
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-cerulean-blue-500' : 'bg-gray-300'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4.5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

function SourceRow({ source, state }: { source: ListSource; state: ListState }) {
  const chains = useSyncExternalStore(chainStore.subscribe, chainStore.getSnapshot)
  const [now] = useState(() => Date.now())
  const refresh = () =>
    void addressListStore.refresh(
      source.id,
      chains.map((chain) => chain.id),
    )
  return (
    <div className="flex items-start gap-3 py-2">
      <Switch
        on={state.enabled}
        label={`Use ${source.name}`}
        onChange={(on) => addressListStore.setEnabled(source.id, on)}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-gray-800">
          <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" title={`A claim of ${source.name}, not checked here`} />
          {source.name}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${source.kind === 'block' ? 'bg-light-coral-100 text-light-coral-700' : 'bg-green-50 text-green-700'}`}
          >
            {source.kind} list
          </span>
          <span className="text-xs text-gray-500">license {source.license}</span>
        </p>
        {source.note && <p className="text-xs text-gray-500">{source.note}</p>}
        <p className="text-xs text-gray-500">
          {state.fetchedAt !== null
            ? `${state.entries.length.toLocaleString('en-US')} addresses · fetched ${agoText(state.fetchedAt, now)}`
            : 'not fetched yet'}
          {' · '}
          <ExternalLink href={source.repository} className="text-cerulean-blue-600 hover:underline">
            repository ↗
          </ExternalLink>
        </p>
        {state.error && <p className="text-xs text-amber-700">last fetch failed · {state.error}</p>}
      </div>
      <button onClick={refresh} className="shrink-0 font-mono text-xs text-gray-400 hover:text-cerulean-blue-600">
        refresh
      </button>
    </div>
  )
}

export function ProfileSettings() {
  const states = useSyncExternalStore(addressListStore.subscribe, addressListStore.getSnapshot)
  const settings = useSyncExternalStore(contextSettingsStore.subscribe, contextSettingsStore.getSnapshot)
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="pb-1 font-medium text-gray-800">Lists and GoPlus</p>
      <p className="pb-2 text-xs leading-relaxed text-gray-500">
        The review shows the lists that know each address the request names. An allow list names known contracts; a
        block list names sanctioned or scam addresses, and a hit shows a loud notice. Each list is a claim of its
        publisher: Onay does not check it, so it shows with the yellow third-party mark, and a hit does not change the
        result of the checks. Onay fetches each list from GitHub once a day and keeps the last good copy. The profile
        also reads the ERC-7730 registry of Clear Signing and your token lists below, with no extra fetch.
      </p>
      <div className="divide-y divide-gray-100">
        {LIST_SOURCES.map((source) => {
          const state = states.find((item) => item.id === source.id)
          return state ? <SourceRow key={source.id} source={source} state={state} /> : null
        })}
        <div className="flex items-start gap-3 py-2">
          <Switch
            id="goplus"
            on={settings.goPlus}
            label="Ask GoPlus"
            onChange={(goPlus) => saveContextSettings({ ...settings, goPlus })}
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm text-gray-800">
              <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" title="A claim of GoPlus, not checked here" />
              GoPlus
            </p>
            <p className="text-xs leading-relaxed text-gray-500">
              GoPlus is a closed service that answers without a key. The lookups tell it each address that the request
              names. Its answer shows with the yellow mark.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
