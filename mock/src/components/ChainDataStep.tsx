import type { ReactNode } from 'react'
import type { MockRequest } from '../data/mockRequest'
import { HELIOS_STATE, codeReadLog, heliosSyncLog, type LogLine } from '../data/verificationLog'
import { CollapsibleLog } from './GateLog'
import { CollapsibleCard, Step } from './Step'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-gray-500">{label}</span>
      <span className="min-w-0 text-right text-sm text-gray-800">{children}</span>
    </div>
  )
}

const ok = <span className="text-green-700"> ✓</span>

/** every address whose code the request reads: the call tree, or the plain recipient */
function readAddresses(request: MockRequest): { address: string; name?: string }[] {
  if (request.contracts.length === 0) {
    const to = request.raw.find((f) => f.name === 'to')?.value ?? ''
    return [{ address: to }]
  }
  return request.contracts.filter(
    (c, i, all) => all.findIndex((o) => o.address === c.address) === i,
  )
}

function CodeReads({ request, helios }: { request: MockRequest; helios: boolean }) {
  const empty = request.contracts.length === 0
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-sm font-medium text-gray-800">Contract code read from the chain</p>
      <div className="divide-y divide-gray-100">
        {readAddresses(request).map(({ address, name }) => (
          <div key={address} className="flex items-baseline justify-between gap-4 py-1.5">
            <p className="min-w-0">
              <span className="break-all font-mono text-[13px] text-gray-700">{address}</span>
              {name && <span className="pl-2 text-xs text-gray-500">{name}</span>}
            </p>
            {helios ? (
              <span className="shrink-0 text-sm text-green-700">
                ✓ {empty ? 'no code · proof checked' : 'proof checked'}
              </span>
            ) : (
              <span className="shrink-0 text-sm text-amber-700">no proof</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function HeliosCard({ request }: { request: MockRequest }) {
  const { checkpoint, checkpointAge, signatures, slot } = HELIOS_STATE
  const empty = request.contracts.length === 0
  const lines: LogLine[] = [
    ...heliosSyncLog(request.chain),
    ...readAddresses(request).map(({ address }) => codeReadLog(address, true, empty)),
  ]
  return (
    <CollapsibleCard
      summary={<p className="text-sm font-medium text-green-700">✓ Chain data verified by Helios</p>}
    >
      <div className="divide-y divide-gray-100">
        <Row label="Starting point">
          block <span className="font-mono text-[13px]">{checkpoint}</span> · {checkpointAge} old
          {ok}
        </Row>
        <Row label="Block signatures">
          {signatures} of {signatures} validators signed
          {ok}
        </Row>
        <Row label="Latest final block">slot {slot.toLocaleString('en-US')}</Row>
      </div>
      <CodeReads request={request} helios />
      <CollapsibleLog lines={lines} />
    </CollapsibleCard>
  )
}

function RpcCard({ request, rpcUrl }: { request: MockRequest; rpcUrl?: string }) {
  const empty = request.contracts.length === 0
  const lines: LogLine[] = readAddresses(request).map(({ address }) =>
    codeReadLog(address, false, empty),
  )
  return (
    <CollapsibleCard
      summary={
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-4">
          <p className="text-lg font-semibold text-amber-800">⚠ Chain data is not verified</p>
          <p className="pt-1 text-sm leading-relaxed text-gray-700">
            Helios does not support {request.chain}. Every answer comes straight from the RPC
            endpoint, with no proof. Only use RPC endpoints you fully trust.
          </p>
        </div>
      }
    >
      <Row label="RPC endpoint">
        <span className="break-all font-mono text-[13px]">{rpcUrl ?? 'not configured'}</span>
      </Row>
      <CodeReads request={request} helios={false} />
      <CollapsibleLog lines={lines} />
    </CollapsibleCard>
  )
}

export function ChainDataStep({ request, rpcUrl }: { request: MockRequest; rpcUrl?: string }) {
  return (
    <Step
      number={1}
      title="Chain Data Verification"
      explainer="Onay reads contract code and state from the blockchain through an RPC server. Helios, a light client built into Onay, checks every answer with a cryptographic proof, so a dishonest server cannot give you fake data."
    >
      {request.chainMode === 'helios' ? (
        <HeliosCard request={request} />
      ) : (
        <RpcCard request={request} rpcUrl={rpcUrl} />
      )}
    </Step>
  )
}
