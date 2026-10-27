import { useState, useSyncExternalStore } from 'react'
import { AttesterSettings } from './AttesterSettings.tsx'
import { ProfileSettings } from './ProfileSettings.tsx'
import { TokenListSettings } from './TokenListSettings.tsx'
import { EXPLORER_FIELDS, isExplorerField } from './chainList.ts'
import { chainStore, heliosKey, heliosStarted, saveChains, type ChainConfig } from './chains.ts'
import { EXPLORER_HOSTS, explorersOf } from './context/explorers.ts'
import { contextSettingsStore, isEtherscanKey, saveContextSettings } from './context/settings.ts'
import { ExternalLink } from './ExternalLink.tsx'
import { errorText } from './gates/gate.ts'
import type { Snapshot } from './messages.ts'
import { CollapsibleCard } from './Step.tsx'

const isUrl = (value: string) => /^https?:\/\/\S+$/.test(value)

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="font-mono text-xs text-gray-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-800 placeholder:text-gray-400 focus:border-cerulean-blue-400 focus:outline-none"
      />
    </label>
  )
}

// The explorer fields of a chain card. A field shows the built-in host
// until the user changes it. An empty field turns that explorer off.
function ExplorerFields({ draft, onChange }: { draft: ChainConfig; onChange: (chain: ChainConfig) => void }) {
  const table = EXPLORER_HOSTS[draft.id] as (typeof EXPLORER_HOSTS)[number] | undefined
  const effective = explorersOf(draft)
  const invalid = EXPLORER_FIELDS.some((field) => draft[field] !== undefined && !isExplorerField(draft[field]))
  return (
    <div className="flex flex-col gap-3 border-t border-gray-100 pt-3">
      <p className="font-mono text-xs text-gray-500">explorers</p>
      <Field
        label="Etherscan"
        value={draft.etherscan ?? table?.etherscan ?? ''}
        placeholder="none"
        onChange={(etherscan) => onChange({ ...draft, etherscan })}
      />
      <Field
        label="Blockscout"
        value={draft.blockscout ?? table?.blockscout ?? ''}
        placeholder="none"
        onChange={(blockscout) => onChange({ ...draft, blockscout })}
      />
      {effective.blockscout && (
        <Field
          label="Blockscout API, if on another host"
          value={draft.blockscoutApi ?? ''}
          placeholder={effective.blockscoutApi ?? ''}
          onChange={(blockscoutApi) => onChange({ ...draft, blockscoutApi })}
        />
      )}
      {invalid && (
        <p className="text-xs text-light-coral-700">An explorer URL starts with https://. Leave it empty for none.</p>
      )}
    </div>
  )
}

function ChainCard({
  chain,
  onChange,
  onRemove,
}: {
  chain: ChainConfig
  onChange: (chain: ChainConfig) => void
  onRemove?: () => void
}) {
  const [draft, setDraft] = useState(chain)
  // The result of the last save.
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const helios = chain.mode === 'helios'
  const dirty = JSON.stringify(draft) !== JSON.stringify(chain)
  const valid =
    isUrl(draft.executionRpc) &&
    (!helios || isUrl(draft.consensusRpc ?? '')) &&
    EXPLORER_FIELDS.every((field) => draft[field] === undefined || isExplorerField(draft[field]))
  const restarts = helios && heliosKey(draft) !== heliosKey(chain)

  const save = async () => {
    onChange(draft)
    setResult(null)
    if (!restarts) return setResult({ ok: true, text: 'saved' })
    try {
      await heliosStarted(chain.id)
      setResult({ ok: true, text: 'saved · Helios restarted' })
    } catch (error) {
      setResult({ ok: false, text: `Helios did not start: ${errorText(error)}` })
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between pb-3">
        <p className="font-medium text-gray-800">{chain.name}</p>
        <p className="font-mono text-xs text-gray-400">chain id {chain.id}</p>
      </div>
      <div className="flex flex-col gap-3">
        <Field
          label={helios ? 'execution RPC (eth_getProof required)' : 'RPC endpoint'}
          value={draft.executionRpc}
          onChange={(executionRpc) => setDraft({ ...draft, executionRpc })}
        />
        {helios && (
          <Field
            label="consensus RPC (beacon light client API)"
            value={draft.consensusRpc ?? ''}
            placeholder="https://…"
            onChange={(consensusRpc) => setDraft({ ...draft, consensusRpc })}
          />
        )}
        <ExplorerFields draft={draft} onChange={setDraft} />
      </div>
      <div className="flex items-center gap-3 pt-3">
        {dirty && (
          <button
            onClick={save}
            disabled={!valid}
            className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600 disabled:opacity-40"
          >
            Save{restarts ? ' · restarts Helios' : ''}
          </button>
        )}
        {result && (
          <span className={`font-mono text-xs ${result.ok ? 'text-green-600' : 'text-light-coral-700'}`}>
            {result.text} {result.ok ? '✓' : '✕'}
          </span>
        )}
        {onRemove && (
          <button onClick={onRemove} className="ml-auto font-mono text-xs text-gray-400 hover:text-light-coral-700">
            remove chain
          </button>
        )}
      </div>
    </section>
  )
}

function AddChain({ chains, onAdd }: { chains: ChainConfig[]; onAdd: (chain: ChainConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [rpc, setRpc] = useState('')

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-dashed border-gray-300 px-5 py-3 text-left text-sm text-gray-500 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600"
      >
        + Add chain
      </button>
    )
  }

  const taken = chains.some((chain) => String(chain.id) === id)
  const valid = name.trim() !== '' && /^[1-9]\d*$/.test(id) && !taken && isUrl(rpc)
  const close = () => {
    setOpen(false)
    setName('')
    setId('')
    setRpc('')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="pb-3 font-mono text-xs tracking-widest text-gray-500 uppercase">Add chain</p>
      <div className="flex flex-col gap-3">
        <Field label="name" value={name} placeholder="My L2" onChange={setName} />
        <Field label="chain id" value={id} placeholder="42161" onChange={setId} />
        <Field label="RPC endpoint" value={rpc} placeholder="https://…" onChange={setRpc} />
      </div>
      {taken && <p className="pt-2 text-xs text-light-coral-700">A chain with this id is already in the list.</p>}
      <p className="pt-2 text-xs text-gray-500">
        A node of your own must allow requests from this app (CORS), for example with <code>--http.corsdomain</code> in
        geth.
      </p>
      <div className="flex gap-3 pt-3">
        <button
          disabled={!valid}
          onClick={() => {
            onAdd({ id: Number(id), name: name.trim(), mode: 'rpc', executionRpc: rpc, custom: true })
            close()
          }}
          className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600 disabled:opacity-40"
        >
          Add
        </button>
        <button
          onClick={close}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}

// The parts of the link to the browser extension, for diagnosis.
function BrowserLink({ snapshot }: { snapshot: Snapshot }) {
  const paired = snapshot.connections.filter((c) => c.pairingCode === null).length
  return (
    <>
      <h3 className="flex items-center gap-1.5 pt-4 font-mono text-xs tracking-widest text-gray-500 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        Browser link
      </h3>
      <CollapsibleCard
        summary={
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-medium text-gray-800">Socket, relay, and connections</p>
            <p className="font-mono text-xs text-gray-400">{paired === 0 ? 'not connected' : `${paired} connected`}</p>
          </div>
        }
      >
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs break-all text-gray-800">
          <dt className="text-gray-500">socket</dt>
          <dd>{snapshot.socket}</dd>
          <dt className="text-gray-500">relay</dt>
          <dd>{snapshot.relay ?? 'not found'}</dd>
          <dt className="text-gray-500">host manifests</dt>
          <dd>
            {snapshot.manifests.length === 0 && 'no supported browser found'}
            {snapshot.manifests.map((m) => (
              <div key={m.path}>
                {m.path} {m.error ? `(failed: ${m.error})` : '(written)'}
              </div>
            ))}
          </dd>
          <dt className="text-gray-500">connections</dt>
          <dd>
            {snapshot.connections.length === 0 && 'none'}
            {snapshot.connections.map((c) => (
              <div key={c.id}>
                {c.browser} ({c.pairingCode ? 'waits for pairing' : 'paired'})
              </div>
            ))}
          </dd>
          {snapshot.rejected.length > 0 && (
            <>
              <dt className="text-gray-500">refused</dt>
              <dd>
                {snapshot.rejected.map((reason, i) => (
                  <div key={i}>{reason}</div>
                ))}
              </dd>
            </>
          )}
        </dl>
      </CollapsibleCard>
    </>
  )
}

// The Etherscan key, and what each explorer learns from a lookup.
function ExplorerSettings() {
  const settings = useSyncExternalStore(contextSettingsStore.subscribe, contextSettingsStore.getSnapshot)
  const [draft, setDraft] = useState(settings.etherscanKey)
  const [saved, setSaved] = useState(false)
  const key = draft.trim()
  const valid = isEtherscanKey(key)
  const dirty = key !== settings.etherscanKey

  const save = () => {
    saveContextSettings({ ...settings, etherscanKey: key })
    setSaved(true)
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="pb-1 font-medium text-gray-800">Explorers</p>
      <p className="pb-2 text-xs leading-relaxed text-gray-500">
        The review shows what Etherscan and Blockscout claim about the source code of each contract, next to the
        Sourcify result. Onay does not check these claims, so they show with the yellow third-party mark, and they do
        not change the result of the checks. Each chain card above holds the explorer URLs of its chain.
      </p>
      <p className="pb-2 text-xs leading-relaxed text-gray-500">
        Optional. Etherscan needs a key for every request; get a free one at{' '}
        <ExternalLink href="https://etherscan.io/apis" className="text-cerulean-blue-600 hover:underline">
          etherscan.io/apis ↗
        </ExternalLink>
        . Without a key, Onay does not ask Etherscan and the row in the review says so. The key is saved in the app's
        local storage, a plain file that other programs of your user can read; a free key is fine there. Each lookup
        tells Etherscan which contract you check, as the Sourcify lookup does today. Powered by Etherscan.io APIs.
      </p>
      <p className="pb-3 text-xs leading-relaxed text-gray-500">
        Blockscout needs no key. Set the URL of your own instance in the chain card to use it. Each lookup tells the
        instance which contract you check.
      </p>
      <div className="flex items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="font-mono text-xs text-gray-500">Etherscan API key</span>
          <input
            value={draft}
            type="password"
            placeholder="none"
            autoComplete="off"
            onChange={(event) => {
              setDraft(event.target.value)
              setSaved(false)
            }}
            onKeyDown={(event) => event.key === 'Enter' && valid && dirty && save()}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-800 placeholder:text-gray-400 focus:border-cerulean-blue-400 focus:outline-none"
          />
        </label>
        {dirty ? (
          <button
            onClick={save}
            disabled={!valid}
            className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600 disabled:opacity-40"
          >
            {key === '' ? 'Remove' : 'Save'}
          </button>
        ) : (
          saved && <span className="pb-1.5 font-mono text-xs text-green-600">saved ✓</span>
        )}
      </div>
      {!valid && <p className="pt-2 text-xs text-light-coral-700">An Etherscan key has only letters and digits.</p>}
    </section>
  )
}

export function SettingsPage({ snapshot, onBack }: { snapshot: Snapshot | null; onBack: () => void }) {
  const chains = useSyncExternalStore(chainStore.subscribe, chainStore.getSnapshot)
  const update = (next: ChainConfig) => saveChains(chains.map((chain) => (chain.id === next.id ? next : chain)))
  const remove = (id: number) => saveChains(chains.filter((chain) => chain.id !== id))

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 py-2">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="font-mono text-xs text-gray-400 hover:text-gray-600">
          ← back
        </button>
        <h2 className="text-lg font-medium text-gray-900">Settings</h2>
      </div>

      <h3 className="flex items-center gap-1.5 pt-2 font-mono text-xs tracking-widest text-cerulean-blue-600 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-cerulean-blue-500" />
        Helios
      </h3>
      <p className="text-xs leading-relaxed text-gray-500">
        Helios is a light client: it never trusts these endpoints, it checks them. Each piece of chain state is checked
        against a cryptographic proof, so a lying RPC (Remote Procedure Call) endpoint gets caught instead of believed.
        The consensus RPC serves the beacon chain light client updates, and Helios follows the sync committee signatures
        from there.
      </p>
      {chains
        .filter((chain) => chain.mode === 'helios')
        .map((chain) => (
          <ChainCard key={chain.id} chain={chain} onChange={update} />
        ))}

      <h3 className="flex items-center gap-1.5 pt-4 font-mono text-xs tracking-widest text-amber-600 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        RPC
      </h3>
      <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Helios does not check these chains: chain state comes straight from the RPC endpoint. Only use RPC endpoints you
        fully trust. Your own node is the safest choice.
      </p>
      {chains
        .filter((chain) => chain.mode === 'rpc')
        .map((chain) => (
          <ChainCard
            key={chain.id}
            chain={chain}
            onChange={update}
            onRemove={chain.custom ? () => remove(chain.id) : undefined}
          />
        ))}
      <AddChain chains={chains} onAdd={(chain) => saveChains([...chains, chain])} />

      <ExplorerSettings />
      <ProfileSettings />
      <AttesterSettings />
      <TokenListSettings />
      {snapshot && <BrowserLink snapshot={snapshot} />}
    </div>
  )
}
