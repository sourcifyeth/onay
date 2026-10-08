// Step 1 of the review: how the chain was read. Helios checks each
// answer with a proof. An RPC endpoint is taken on trust.

import type { Contract } from './gates/contracts.ts'
import type { Verification } from './gates/verification.ts'
import { CollapsibleLog } from './Log.tsx'
import { CollapsibleCard, Row, Step } from './Step.tsx'

const ok = <span className="text-green-700"> ✓</span>

function short(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function CodeRead({ contract, helios }: { contract: Contract; helios: boolean }) {
  const { address } = contract
  const state = contract.helios
  let result
  if (state.status === 'passed') {
    const empty = state.value.code === '0x' ? 'no code · ' : ''
    result = helios ? (
      <span className="shrink-0 text-sm text-green-700">✓ {empty}proof checked</span>
    ) : (
      <span className="shrink-0 text-sm text-amber-700">{empty}no proof</span>
    )
  } else if (state.status === 'failed') {
    result = <span className="shrink-0 text-sm text-light-coral-700">✕ {state.reason}</span>
  } else {
    result = <span className="shrink-0 text-sm text-gray-400">not read</span>
  }
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <p className="min-w-0">
        <span className="font-mono text-[13px] break-all text-gray-700">{address}</span>
      </p>
      {result}
    </div>
  )
}

function CodeReads({ contracts, helios }: { contracts: Contract[]; helios: boolean }) {
  if (contracts.length === 0) return null
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-sm font-medium text-gray-800">Contract code read from the chain</p>
      <div className="divide-y divide-gray-100">
        {contracts.map((contract) => (
          <CodeRead key={contract.address} contract={contract} helios={helios} />
        ))}
      </div>
    </div>
  )
}

function HeliosCard({ verification }: { verification: Verification }) {
  const { head, contracts } = verification
  const lines = verification.lines.filter((line) => line.source === 'helios')
  return (
    <CollapsibleCard summary={<p className="text-sm font-medium text-green-700">✓ Chain data verified by Helios</p>}>
      <div className="divide-y divide-gray-100">
        <Row label="Finalized checkpoint">
          {head?.checkpoint ? (
            <span className="font-mono text-[13px]" title={head.checkpoint}>
              {short(head.checkpoint)}
            </span>
          ) : (
            'unknown'
          )}
          {ok}
        </Row>
        <Row label="Block read">
          {head ? head.block.toLocaleString('en-US') : '…'}
          {ok}
        </Row>
      </div>
      <CodeReads contracts={contracts} helios />
      <CollapsibleLog lines={lines} />
    </CollapsibleCard>
  )
}

function RpcCard({ verification }: { verification: Verification }) {
  const { chain, head, contracts } = verification
  const lines = verification.lines.filter((line) => line.source === 'rpc')
  return (
    <CollapsibleCard
      summary={
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-4">
          <p className="text-lg font-semibold text-amber-800">⚠ Chain data is not verified</p>
          <p className="pt-1 text-sm leading-relaxed text-gray-700">
            Helios does not support {chain?.name ?? 'this chain'}. Every answer comes straight from the RPC endpoint,
            with no proof. Only use RPC endpoints you fully trust.
          </p>
        </div>
      }
    >
      <Row label="RPC endpoint">
        <span className="font-mono text-[13px] break-all">{chain?.executionRpc ?? 'not configured'}</span>
      </Row>
      <Row label="Block read">{head ? head.block.toLocaleString('en-US') : '…'}</Row>
      <CodeReads contracts={contracts} helios={false} />
      <CollapsibleLog lines={lines} />
    </CollapsibleCard>
  )
}

export function ChainDataStep({ verification }: { verification: Verification }) {
  return (
    <Step
      number={1}
      title="Chain Data Verification"
      explainer="Onay reads contract code and state from the blockchain through an RPC server. Helios, a light client built into Onay, checks every answer with a cryptographic proof, so a dishonest server cannot give you fake data."
    >
      {verification.chain?.mode === 'helios' ? (
        <HeliosCard verification={verification} />
      ) : (
        <RpcCard verification={verification} />
      )}
    </Step>
  )
}
