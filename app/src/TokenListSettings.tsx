// The token lists section of the settings: the lists whose tokens render
// with the ERC-20 template.

import { useState, useSyncExternalStore } from 'react'
import {
  acceptTokenListUpdate,
  addTokenList,
  DEFAULT_LIST_URL,
  isHttpsUrl,
  refreshTokenList,
  removeTokenList,
  SCHEMA_URL,
  summary,
  tokenListStore,
  versionText,
  type ListEntry,
} from './clear-signing/tokenLists.ts'
import { ExternalLink } from './ExternalLink.tsx'
import { ThirdPartyIcon } from './Icons.tsx'

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

function Action({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} className="shrink-0 font-mono text-xs text-gray-400 hover:text-cerulean-blue-600">
      {children}
    </button>
  )
}

function ListRow({ entry }: { entry: ListEntry }) {
  const { list, held } = entry
  const counts = list && summary(list)
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-gray-800">
            <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" title="From a third party, not checked here" />
            {list ? (
              <span>
                {list.name} <span className="text-gray-500">{versionText(list.version)}</span>
              </span>
            ) : (
              <span className="text-gray-500">{entry.error ? 'not fetched yet' : 'fetching…'}</span>
            )}
          </p>
          <p className="font-mono text-xs break-all text-gray-500">{entry.url}</p>
          {counts && (
            <p className="text-xs text-gray-500">
              {counts.tokens} tokens on {counts.chains} chains
              {entry.fetchedAt !== null && ` · fetched ${ago(entry.fetchedAt)}`}
            </p>
          )}
          {entry.error && <p className="text-xs text-amber-700">last fetch failed · {entry.error}</p>}
        </div>
        <div className="flex shrink-0 gap-3">
          <Action onClick={() => void refreshTokenList(entry.url)}>refresh</Action>
          <button
            onClick={() => removeTokenList(entry.url)}
            className="shrink-0 font-mono text-xs text-gray-400 hover:text-light-coral-700"
          >
            remove
          </button>
        </div>
      </div>
      {held && (
        <div className="mt-2 flex items-baseline justify-between gap-4 rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>
            {versionText(held.version)} is available. It removes or changes tokens, or goes back in version, so it waits
            for you. The current copy stays in use until you accept it.
          </span>
          <Action onClick={() => acceptTokenListUpdate(entry.url)}>accept</Action>
        </div>
      )}
    </div>
  )
}

export function TokenListSettings() {
  const entries = useSyncExternalStore(tokenListStore.subscribe, tokenListStore.getSnapshot)
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  const taken = entries.some((entry) => entry.url === trimmed)
  const valid = isHttpsUrl(trimmed) && !taken

  const add = () => {
    if (addTokenList(draft)) setDraft('')
  }

  return (
    <>
      <h3 className="flex items-center gap-1.5 pt-4 font-mono text-xs tracking-widest text-cerulean-blue-600 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-cerulean-blue-500" />
        Token lists
      </h3>
      <p className="text-xs leading-relaxed text-gray-500">
        A token list names the addresses that are ERC-20 tokens. A call to a listed token renders with the standard
        template, for example "Send 1.5 USDC", when no descriptor covers it. The tokens of all your lists count. A list
        is a claim of its publisher: Onay does not check it, so the data shows with the yellow third-party mark. Lists
        use the{' '}
        <ExternalLink href={SCHEMA_URL} className="text-cerulean-blue-600 hover:underline">
          Uniswap Token Lists format ↗
        </ExternalLink>
        , a JSON file served over HTTPS.
      </p>
      <p className="text-xs leading-relaxed text-gray-500">
        Onay starts with the Uniswap Labs Default list, since it has the highest barrier for a token to get in: only
        Uniswap Labs edits it, and a request does not guarantee a review. It is still untrusted data. Remove it if you
        prefer your own lists.
      </p>
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="pb-1 font-medium text-gray-800">Lists</p>
        {entries.length === 0 ? (
          <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No token list. No call renders with the token template; each shows as the verified ABI decodes it.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {entries.map((entry) => (
              <ListRow key={entry.url} entry={entry} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-3 pt-3">
          <label className="block min-w-0 flex-1">
            <span className="font-mono text-xs text-gray-500">list URL</span>
            <input
              value={draft}
              placeholder={DEFAULT_LIST_URL}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && add()}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-800 placeholder:text-gray-400 focus:border-cerulean-blue-400 focus:outline-none"
            />
          </label>
          <button
            onClick={add}
            disabled={!valid}
            className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {taken && <p className="pt-2 text-xs text-light-coral-700">This list is in the list already.</p>}
        {trimmed !== '' && !isHttpsUrl(trimmed) && (
          <p className="pt-2 text-xs text-light-coral-700">
            A list URL starts with https://. ENS names and IPFS are not supported.
          </p>
        )}
      </section>
    </>
  )
}
