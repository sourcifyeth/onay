import { useState } from 'react'

export interface ChainConfig {
  id: number
  name: string
  mode: 'helios' | 'rpc'
  /** which Helios implementation verifies this chain */
  family?: 'ethereum' | 'opstack' | 'linea'
  executionRpc: string
  consensusRpc?: string
  checkpoint?: string
  custom?: boolean
}

export const defaultChains: ChainConfig[] = [
  {
    id: 1,
    name: 'Ethereum mainnet',
    mode: 'helios',
    family: 'ethereum',
    executionRpc: 'https://ethereum-rpc.publicnode.com',
    consensusRpc: 'https://ethereum.operationsolarstorm.org',
    checkpoint: '(auto) checkpoint-sync fallback',
  },
  {
    id: 11155111,
    name: 'Sepolia',
    mode: 'helios',
    family: 'ethereum',
    executionRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    consensusRpc: '',
    checkpoint: '(auto) checkpoint-sync fallback',
  },
  {
    id: 10,
    name: 'OP Mainnet',
    mode: 'helios',
    family: 'opstack',
    executionRpc: 'https://optimism-rpc.publicnode.com',
    consensusRpc: 'https://op-mainnet.operationsolarstorm.org',
  },
  {
    id: 8453,
    name: 'Base',
    mode: 'helios',
    family: 'opstack',
    executionRpc: 'https://base-rpc.publicnode.com',
    consensusRpc: 'https://base.operationsolarstorm.org',
  },
  {
    id: 480,
    name: 'Worldchain',
    mode: 'helios',
    family: 'opstack',
    executionRpc: 'https://worldchain-mainnet.g.alchemy.com/public',
    consensusRpc: 'https://worldchain.operationsolarstorm.org',
  },
  {
    id: 7777777,
    name: 'Zora',
    mode: 'helios',
    family: 'opstack',
    executionRpc: 'https://rpc.zora.energy',
    consensusRpc: 'https://zora.operationsolarstorm.org',
  },
  {
    id: 130,
    name: 'Unichain',
    mode: 'helios',
    family: 'opstack',
    executionRpc: 'https://mainnet.unichain.org',
    consensusRpc: 'https://unichain.operationsolarstorm.org',
  },
  {
    id: 59144,
    name: 'Linea',
    mode: 'helios',
    family: 'linea',
    executionRpc: 'https://rpc.linea.build',
  },
  {
    id: 59141,
    name: 'Linea Sepolia',
    mode: 'helios',
    family: 'linea',
    executionRpc: 'https://rpc.sepolia.linea.build',
  },
  {
    id: 42161,
    name: 'Arbitrum One',
    mode: 'rpc',
    executionRpc: 'https://arb1.arbitrum.io/rpc',
  },
]

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="font-mono text-xs text-gray-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
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
  onChange: (c: ChainConfig) => void
  onRemove?: () => void
}) {
  const [draft, setDraft] = useState(chain)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(chain)

  const save = () => {
    onChange(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between pb-3">
        <p className="font-medium text-gray-800">{chain.name}</p>
        <p className="font-mono text-xs text-gray-400">chain id {chain.id}</p>
      </div>
      <div className="flex flex-col gap-3">
        <Field
          label={chain.mode === 'helios' ? 'execution RPC (eth_getProof required)' : 'RPC endpoint'}
          value={draft.executionRpc}
          onChange={(v) => setDraft({ ...draft, executionRpc: v })}
        />
        {chain.family === 'ethereum' && (
          <>
            <Field
              label="consensus RPC (beacon light-client API)"
              value={draft.consensusRpc ?? ''}
              placeholder="https://…"
              onChange={(v) => setDraft({ ...draft, consensusRpc: v })}
            />
            <Field
              label="checkpoint (weak subjectivity trust anchor)"
              value={draft.checkpoint ?? ''}
              onChange={(v) => setDraft({ ...draft, checkpoint: v })}
            />
          </>
        )}
        {chain.family === 'opstack' && (
          <Field
            label="consensus RPC (OP Stack preconf server)"
            value={draft.consensusRpc ?? ''}
            placeholder="https://…"
            onChange={(v) => setDraft({ ...draft, consensusRpc: v })}
          />
        )}
      </div>
      <div className="flex items-center gap-3 pt-3">
        {dirty && (
          <button
            onClick={save}
            className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600"
          >
            Save{chain.mode === 'helios' ? ' · restarts Helios' : ''}
          </button>
        )}
        {saved && <span className="font-mono text-xs text-green-600">saved ✓</span>}
        {onRemove && (
          <button
            onClick={onRemove}
            className="ml-auto font-mono text-xs text-gray-400 hover:text-light-coral-700"
          >
            remove chain
          </button>
        )}
      </div>
    </section>
  )
}

function AddChain({ onAdd }: { onAdd: (c: ChainConfig) => void }) {
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

  const valid = name.trim() !== '' && /^\d+$/.test(id) && rpc.startsWith('http')

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="pb-3 text-xs font-mono uppercase tracking-widest text-gray-500">Add chain</p>
      <div className="flex flex-col gap-3">
        <Field label="name" value={name} placeholder="My L2" onChange={setName} />
        <Field label="chain id" value={id} placeholder="42161" onChange={setId} />
        <Field label="RPC endpoint" value={rpc} placeholder="https://…" onChange={setRpc} />
      </div>
      <div className="flex gap-3 pt-3">
        <button
          disabled={!valid}
          onClick={() => {
            onAdd({ id: Number(id), name: name.trim(), mode: 'rpc', executionRpc: rpc, custom: true })
            setOpen(false)
            setName('')
            setId('')
            setRpc('')
          }}
          className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600 disabled:opacity-40"
        >
          Add
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}

export function SettingsPage({
  chains,
  onChainsChange,
  onBack,
}: {
  chains: ChainConfig[]
  onChainsChange: (chains: ChainConfig[]) => void
  onBack: () => void
}) {
  const update = (target: ChainConfig, next: ChainConfig) =>
    onChainsChange(chains.map((c) => (c === target ? next : c)))
  const remove = (target: ChainConfig) => onChainsChange(chains.filter((c) => c !== target))

  const helios = chains.filter((c) => c.mode === 'helios')
  const rpc = chains.filter((c) => c.mode === 'rpc')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="font-mono text-xs text-gray-500 hover:text-gray-700">
          ← back
        </button>
        <h1 className="text-lg font-medium text-gray-900">Settings</h1>
      </div>

      <h2 className="flex items-center gap-1.5 pt-2 font-mono text-xs uppercase tracking-widest text-cerulean-blue-600">
        <span className="h-1.5 w-1.5 rounded-full bg-cerulean-blue-500" />
        Helios native
      </h2>
      <p className="text-xs leading-relaxed text-gray-500">
        Helios is a light client: it never trusts these endpoints, it checks them. Every piece of
        chain state used in a review is verified against a cryptographic proof, so a lying RPC
        (Remote Procedure Call) endpoint gets caught instead of believed. What each chain needs
        depends on how its blocks can be verified. Ethereum chains need a consensus RPC serving
        beacon light client updates, plus a checkpoint: a recent block hash you trust as the
        starting point, from which Helios follows the sync committee signatures on its own. OP
        Stack chains have no light client protocol yet, so Helios only accepts blocks signed by the
        chain&apos;s sequencer, fetched from the preconf server. Linea carries the sequencer
        signature inside every block header, so the execution RPC alone is enough.
      </p>
      {helios.map((chain) => (
        <ChainCard key={chain.id} chain={chain} onChange={(c) => update(chain, c)} />
      ))}

      <h2 className="flex items-center gap-1.5 pt-4 font-mono text-xs uppercase tracking-widest text-amber-600">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        RPC
      </h2>
      <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        These chains are not verified by Helios: chain state comes straight from the RPC endpoint.
        Only use RPC endpoints you fully trust; your own node is the safest choice.
      </p>
      {rpc.map((chain) => (
        <ChainCard
          key={chain.id}
          chain={chain}
          onChange={(c) => update(chain, c)}
          onRemove={chain.custom ? () => remove(chain) : undefined}
        />
      ))}
      <AddChain onAdd={(c) => onChainsChange([...chains, c])} />
    </div>
  )
}
