import { useState, useSyncExternalStore } from 'react'
import { chainStore, heliosStarted, saveChains, type ChainConfig } from './chains.ts'
import { errorText } from './gates/gate.ts'

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
  const valid = isUrl(draft.executionRpc) && (!helios || isUrl(draft.consensusRpc ?? ''))

  const save = async () => {
    onChange(draft)
    setResult(null)
    if (!helios) return setResult({ ok: true, text: 'saved' })
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
      </div>
      <div className="flex items-center gap-3 pt-3">
        {dirty && (
          <button
            onClick={save}
            disabled={!valid}
            className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600 disabled:opacity-40"
          >
            Save{helios ? ' · restarts Helios' : ''}
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

export function SettingsPage({ onBack }: { onBack: () => void }) {
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
    </div>
  )
}
