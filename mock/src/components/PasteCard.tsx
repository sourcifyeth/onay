import { useState } from 'react'

const PLACEHOLDER = `0x02f8…  a raw transaction (RLP, signed or unsigned)
{ "chainId": 1, "to": "0x…", "data": "0x…" }  a transaction
{ "method": "eth_signTypedData_v4", "params": ["0x…", { "types": … }] }  typed data, with the account that signs`

// Mock: a raw transaction "decodes" to this sample.
const RAW_SAMPLE: PastedTx = {
  chainId: 1,
  to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  data: '0x38ed1739',
}

export interface PastedTx {
  chainId: number
  to: string
  data: string
  value?: string
  from?: string
}

function parsePastedTx(raw: string): { tx?: PastedTx; error?: string } {
  if (/^0x[0-9a-fA-F\s]+$/.test(raw.trim())) return { tx: RAW_SAMPLE }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw)
  } catch {
    return { error: 'Not a raw transaction or JSON.' }
  }
  if (typeof obj.method === 'string') {
    if (!Array.isArray(obj.params)) return { error: 'The params of a JSON-RPC request must be an array.' }
    if (obj.method === 'eth_sendRawTransaction') return { tx: RAW_SAMPLE }
    if (obj.method !== 'eth_sendTransaction') return { error: 'The mock checks transactions only.' }
    obj = (obj.params[0] ?? {}) as Record<string, unknown>
  }
  if (typeof obj.chainId !== 'number') return { error: 'Missing "chainId" (number).' }
  if (typeof obj.to !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(obj.to))
    return { error: 'Missing or invalid "to" (contract address).' }
  if (typeof obj.data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(obj.data))
    return { error: 'Missing or invalid "data" (hex calldata).' }
  return { tx: obj as unknown as PastedTx }
}

export function PasteCard({ onVerify }: { onVerify: (tx: PastedTx) => void }) {
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const { tx, error } = parsePastedTx(raw)
    if (error) {
      setError(error)
      return
    }
    setError(null)
    onVerify(tx!)
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="pb-1 text-xs font-mono uppercase tracking-widest text-gray-500">Check a request yourself</h2>
      <p className="pb-3 text-sm text-gray-500">
        Paste a raw transaction, or a transaction or a JSON-RPC request as JSON. Typed data goes in a JSON-RPC request,
        with the account that signs it.
      </p>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        rows={7}
        className="w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-800 placeholder:text-gray-400 focus:border-cerulean-blue-400 focus:outline-none"
      />
      {error && <p className="pt-2 text-xs text-light-coral-700">{error}</p>}
      <button
        onClick={submit}
        className="mt-3 rounded-lg bg-cerulean-blue-500 px-5 py-2 text-sm font-medium text-white hover:bg-cerulean-blue-600"
      >
        Verify
      </button>
    </section>
  )
}
