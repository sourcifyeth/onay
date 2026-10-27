// A request that does not come through the extension: the user pastes it.

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AddRequestArgs } from './messages.ts'
import { errorText } from './gates/gate.ts'
import { EXAMPLES } from './examples.ts'
import { readPaste } from './paste.ts'

const PLACEHOLDER = `0x02f8…  a raw transaction (RLP, signed or unsigned)
{ "chainId": 1, "to": "0x…", "data": "0x…" }  a transaction
{ "method": "eth_signTypedData_v4", "params": ["0x…", { "types": … }] }  typed data, with the account that signs`

export function PasteCard() {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    try {
      await invoke('add_request', readPaste(text) satisfies AddRequestArgs)
      setError(null)
      setText('')
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  return (
    <section className="mt-6">
      <h2 className="font-semibold">Check a request yourself</h2>
      <p className="mt-1 text-gray-600">
        Paste a raw transaction (RLP-encoded, signed or unsigned, as <code>cast mktx</code> gives it), or a transaction
        or a JSON-RPC request as JSON. Typed data goes in a JSON-RPC request, with the account that signs it.
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        Examples:
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => {
              setText(example.text)
              setError(null)
            }}
            className="rounded-full border border-gray-300 px-2.5 py-0.5 text-gray-700 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600"
          >
            {example.label}
          </button>
        ))}
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        rows={5}
        className="mt-2 w-full resize-y rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs placeholder:text-gray-400 focus:border-cerulean-blue-400 focus:outline-none"
      />
      {error && <p className="mt-1 text-red-700">{error}</p>}
      <button
        className="mt-2 rounded bg-cerulean-blue-500 px-3 py-1 text-white disabled:opacity-50"
        disabled={!text.trim()}
        onClick={submit}
      >
        Check
      </button>
    </section>
  )
}
