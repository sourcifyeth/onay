// The step of the review that runs the calls of the request on the
// state of the chain. The card shows what the transaction does to your
// assets: what you send, what you receive, and what you allow others to
// spend. The advanced view holds the state changes, the events and the
// call tree. Taken from the mock.

import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { listedOn, tokenListStore } from './clear-signing/tokenLists.ts'
import { dollars, hasPrices, NATIVE, PRICE_SOURCE, priceCache, type PriceState } from './context/prices.ts'
import { amountText } from './context/run.ts'
import { contextSettingsStore } from './context/settings.ts'
import type { Hex } from './messages.ts'
import type { Contract } from './gates/contracts.ts'
import type { AssetChange, Effects, Permission } from './gates/effects.ts'
import { errorText, type GateState } from './gates/gate.ts'
import { valueText } from './gates/layout.ts'
import { claimOf } from './gates/sourcify.ts'
import { reverted, UNKNOWN, type Frame, type Simulation } from './gates/simulation.ts'
import type { StepInfo } from './gates/verdict.ts'
import type { Verification } from './gates/verification.ts'
import { formatEther, short } from './gates/words.ts'
import { LocallyVerifiedIcon, ThirdPartyIcon, WarningIcon } from './Icons.tsx'
import { CollapsibleLog } from './Log.tsx'
import { Notice, Row, Step } from './Step.tsx'
import { Tooltip } from './Tooltip.tsx'
import {
  allowanceText,
  assetText,
  balanceText,
  eventRows,
  feeNote,
  feeOf,
  isUnlimited,
  nameOf,
  otherContracts,
  sourceOf,
  stateChanges,
  warningText,
} from './simulationCard.ts'

const cachedPrices = priceCache((url, init) => fetch(url, init), Date.now)

const count = (n: number, what: string) => `${n.toLocaleString('en-US')} ${what}${n === 1 ? '' : 's'}`

// The prices of the native coin and of the tokens that you send or
// receive. Nothing goes to the price source while the switch is off.
function usePrices(chainId: number | null, effects: Effects | null): PriceState {
  const { prices: on } = useSyncExternalStore(contextSettingsStore.subscribe, contextSettingsStore.getSnapshot)
  const tokens: Hex[] = [NATIVE]
  for (const { asset } of effects?.assets ?? []) if (asset.kind === 'erc20') tokens.push(asset.token)
  const key = tokens.join(',')
  const [state, setState] = useState<PriceState>({ status: 'loading' })
  const wanted = !on ? 'off' : chainId === null || !hasPrices(chainId) || !effects ? 'unsupported' : 'fetch'
  useEffect(() => {
    if (wanted !== 'fetch' || chainId === null) return
    let live = true
    cachedPrices(chainId, key.split(',') as Hex[]).then(
      (prices) => live && setState({ status: 'passed', prices }),
      (error) => live && setState({ status: 'failed', reason: errorText(error) }),
    )
    return () => {
      live = false
    }
  }, [wanted, chainId, key])
  if (wanted === 'off') return { status: 'off' }
  if (wanted === 'unsupported') return { status: 'unsupported' }
  return state
}

// Seconds since a time in seconds, and a tick each second.
function useAge(timestamp: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.floor(now / 1000 - timestamp))
}

function ageText(seconds: number): string {
  if (seconds < 120) return `${seconds} s ago`
  if (seconds < 7200) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3600)} h ago`
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-gray-400">{children}</span>

// A name if Onay has one, and the address always.
function Account({ address, name }: { address: Hex; name: string | null }) {
  return (
    <span title={address}>
      {name && <span className="font-medium text-gray-900">{name} </span>}
      <span className="font-mono text-xs text-gray-500">{short(address)}</span>
    </span>
  )
}

// A dollar value. It is a claim of the price source, so the tooltip says
// so; the value itself carries no mark.
function Usd({
  amount,
  decimals,
  price,
  prices,
}: {
  amount: bigint
  decimals: number
  price?: number
  prices: PriceState
}) {
  if (prices.status !== 'passed') return null
  if (price === undefined) {
    return (
      <Tooltip
        tip={`${PRICE_SOURCE} has no recent price for this token. A token with no price is often new or little traded.`}
      >
        <span className="text-xs text-gray-400">no price</span>
      </Tooltip>
    )
  }
  const value = Math.abs(dollars(amount, decimals, price))
  return (
    <Tooltip
      tip={
        <span className="flex items-start gap-1.5">
          <ThirdPartyIcon className="mt-0.5 h-3 w-3 shrink-0" title="Not checked by Onay" />
          The amount times the price from {PRICE_SOURCE}, a third party. Onay does not check the price. It can be wrong
          or old.
        </span>
      }
    >
      <span className="text-xs text-gray-500">
        ≈ ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </Tooltip>
  )
}

/* the rows */

type Context = {
  effects: Effects
  contracts: Contract[]
  listed: Map<Hex, string[]>
  prices: PriceState
}

// One line of the card: the label on the left, the content on the right.
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5">
      <p className="w-24 shrink-0 pt-px text-sm text-gray-500">{label}</p>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  )
}

// Who says what about a token: the token itself, your token lists, and
// the Sourcify gate.
// Token lists hold ERC-20 tokens only, so an NFT gets no remark about
// them.
function TokenFacts({ token, fungible, context }: { token: Hex; fungible: boolean; context: Context }) {
  const facts = context.effects.tokens[token]
  const lists = context.listed.get(token) ?? []
  const source = sourceOf(token, context.contracts)
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
      {facts?.name && (
        <Tooltip tip="What the token says its name is: a claim of its own code.">
          <span>{facts.name}</span>
        </Tooltip>
      )}
      <span className="font-mono" title={token}>
        {short(token)}
      </span>
      {lists.length > 0 && (
        <span className="flex items-center gap-1" title="On your token list: a claim of its publisher">
          <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" />
          {lists.join(', ')}
        </span>
      )}
      {lists.length === 0 && fungible && <span className="text-amber-700">on none of your token lists</span>}
      {source === 'unverified' && (
        <span className="flex items-center gap-1 text-amber-700">
          <WarningIcon className="h-3.5 w-3.5 shrink-0" />
          sources not verified
        </span>
      )}
    </span>
  )
}

function AssetRow({ change, context }: { change: AssetChange; context: Context }) {
  const out = change.delta < 0n
  const { asset } = change
  const { tokens, you } = context.effects
  const prices = context.prices
  const price = (token: Hex) => (prices.status === 'passed' ? prices.prices.get(token) : undefined)
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <Tooltip tip="The change of your balance: the balance after the run, minus the balance before. The token's own code answers.">
          <span className={`font-mono font-medium ${out ? 'text-light-coral-700' : 'text-green-700'}`}>
            {out ? '−' : '+'} {assetText(change, tokens)}
          </span>
        </Tooltip>
        {asset.kind === 'native' && <Usd amount={change.delta} decimals={18} price={price(NATIVE)} prices={prices} />}
        {/* Without decimals, an amount has no size in whole tokens. */}
        {asset.kind === 'erc20' && tokens[asset.token]?.decimals != null && (
          <Usd
            amount={change.delta}
            decimals={tokens[asset.token]?.decimals as number}
            price={price(asset.token)}
            prices={prices}
          />
        )}
        {change.counterparty && (
          <span className="text-gray-500">
            {out ? 'to' : 'from'}{' '}
            <Account address={change.counterparty} name={nameOf(change.counterparty, context.contracts, you)} />
          </span>
        )}
      </p>
      {asset.kind !== 'native' && (
        <TokenFacts token={asset.token} fungible={asset.kind === 'erc20'} context={context} />
      )}
    </div>
  )
}

function PermissionRow({ permission, context }: { permission: Permission; context: Context }) {
  const { tokens, you } = context.effects
  const revoked = permission.after === 0n
  const loud = isUnlimited(permission) && !revoked
  const balance = balanceText(permission, tokens)
  // An allowance that a spender used in part, or that you changed.
  const earlier =
    permission.kind === 'amount' && permission.before > 0n && !revoked
      ? allowanceText({ ...permission, after: permission.before }, tokens)
      : null
  return (
    <div className={loud ? 'rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-300' : undefined}>
      <p className="text-sm text-gray-700">
        <Account address={permission.spender} name={nameOf(permission.spender, context.contracts, you)} />{' '}
        {revoked ? 'can no longer spend' : 'to spend'}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <Tooltip tip="The allowance after the run, as the token answers it.">
          <span className={`font-mono font-medium ${loud ? 'text-amber-900' : 'text-gray-900'}`}>
            {allowanceText(permission, tokens)}
          </span>
        </Tooltip>
        {earlier && <span className="text-xs text-gray-500">was {earlier}</span>}
        {balance && !revoked && <span className="text-xs text-gray-500">your balance: {balance}</span>}
      </p>
      {loud && (
        <p className="pt-0.5 text-xs text-amber-900/80">
          {permission.kind === 'all'
            ? 'The spender can take each one, now and later, with no new signature of yours.'
            : 'The spender can take all you have, now and later, with no new signature of yours.'}
        </p>
      )}
      <TokenFacts token={permission.token} fungible={permission.kind === 'amount'} context={context} />
    </div>
  )
}

/* the advanced view */

function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 py-0.5 text-left text-sm text-gray-700 hover:text-gray-900"
      >
        <span>{label}</span>
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="pt-1 pb-2">{children}</div>}
    </div>
  )
}

const HEADING = 'pt-4 text-[11px] font-medium tracking-wide text-gray-400 uppercase'

function signed(before: bigint, after: bigint, text: (value: bigint) => string): string | null {
  if (before === after) return null
  return after > before ? `+ ${text(after - before)}` : `− ${text(before - after)}`
}

function Delta({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <span className="ml-2 rounded bg-gray-100 px-1.5 py-px font-mono text-[11px] font-medium whitespace-nowrap text-gray-700">
      {text}
    </span>
  )
}

function StateChanges({ simulation, contracts, you }: { simulation: Simulation; contracts: Contract[]; you: Hex }) {
  const name = (address: Hex) => nameOf(address, contracts, you)
  // An address in a value shows by its name, if Onay has one.
  const shown = (value: string, type: string) =>
    type === 'address' && name(value.toLowerCase() as Hex)
      ? `${name(value.toLowerCase() as Hex)} ${short(value)}`
      : value
  return (
    <>
      <p className={HEADING}>State changes</p>
      <p className="pt-1 text-xs text-gray-500">
        Each balance, nonce and storage slot that the run changed. A plain variable shows by its name, from the storage
        layout of the recompile. A slot of a mapping or an array shows raw.
      </p>
      {simulation.diff.accounts.map((account) => (
        <div key={account.address} className="py-2 pl-3">
          <p className="text-sm text-gray-900">
            <Account address={account.address} name={name(account.address)} />
          </p>
          {account.balance.before !== account.balance.after && (
            <p className="font-mono text-xs text-gray-500">
              ETH balance {formatEther(account.balance.before)} <Muted>→</Muted>{' '}
              <span className="text-gray-900">{formatEther(account.balance.after)}</span>
              <Delta text={signed(account.balance.before, account.balance.after, (v) => `${formatEther(v)} ETH`)} />
            </p>
          )}
          {account.nonce.before !== account.nonce.after && (
            <p className="font-mono text-xs text-gray-500">
              nonce {account.nonce.before.toString()} <Muted>→</Muted>{' '}
              <span className="text-gray-900">{account.nonce.after.toString()}</span>
            </p>
          )}
        </div>
      ))}
      {stateChanges(simulation, contracts).map((group) => (
        <div key={group.address} className="pt-3">
          <p className="text-sm">
            <Account address={group.address} name={name(group.address)} />
          </p>
          <div className="divide-y divide-gray-100">
            {group.slots.map((slot) =>
              slot.variables.length > 0 ? (
                slot.variables.map((variable) => (
                  <div key={`${slot.slot} ${variable.name}`} className="py-2 pl-3">
                    <p className="text-sm text-gray-900">
                      <span className="font-mono text-[13px]">{variable.name}</span>
                      <span className="pl-2 font-mono text-[11px] text-gray-400">{variable.type}</span>
                    </p>
                    <p className="font-mono text-xs break-all text-gray-500">
                      {shown(variable.before, variable.type)} <Muted>→</Muted>{' '}
                      <span className="text-gray-900">{shown(variable.after, variable.type)}</span>
                      {/^u?int/.test(variable.type) && (
                        <Delta
                          text={signed(BigInt(variable.before), BigInt(variable.after), (v) =>
                            v.toLocaleString('en-US'),
                          )}
                        />
                      )}
                    </p>
                    <p className="pt-0.5 font-mono text-[11px] break-all text-gray-400">
                      slot {BigInt(slot.slot).toString()}
                    </p>
                  </div>
                ))
              ) : (
                <div key={slot.slot} className="py-2 pl-3">
                  <p className="font-mono text-[13px] break-all text-gray-500">slot {slot.slot}</p>
                  <p className="font-mono text-xs break-all text-gray-500">
                    {valueText(BigInt(slot.before), 'bytes32', 32)} <Muted>→</Muted>{' '}
                    <span className="text-gray-900">{valueText(BigInt(slot.after), 'bytes32', 32)}</span>
                  </p>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </>
  )
}

function Events({ simulation, contracts, you }: { simulation: Simulation; contracts: Contract[]; you: Hex }) {
  const rows = eventRows(simulation, contracts)
  return (
    <>
      <p className={`${HEADING} pb-1`}>Events</p>
      <div className="divide-y divide-gray-100">
        {rows.map(({ log, decoded, standard }, index) => (
          <div key={index} className="flex gap-3 py-1.5 text-xs">
            <span className="w-32 shrink-0 truncate text-gray-500" title={log.address}>
              {nameOf(log.address, contracts, you) ?? short(log.address)}
            </span>
            {decoded ? (
              <span className="min-w-0 font-mono break-words text-gray-800">
                {decoded.name}(
                {decoded.params.map((param, at) => (
                  <span key={at}>
                    {at > 0 && ', '}
                    <Muted>{param.name}: </Muted>
                    {param.type === 'address' && param.value.toLowerCase() === you ? 'you' : param.value}
                  </span>
                ))}
                ){standard && <Muted> · standard event, no verified ABI</Muted>}
              </span>
            ) : (
              <span className="min-w-0 font-mono break-all text-gray-500">
                {log.topics.map((topic, at) => (
                  <span key={at} className="block">
                    topic {at}: {topic}
                  </span>
                ))}
                <span className="block">data: {log.data === '0x' ? '0x (empty)' : log.data}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function FrameRow({ frame, contracts }: { frame: Frame; contracts: Contract[] }) {
  const contract = contracts.find((candidate) => candidate.address === frame.address)
  const name = contract ? claimOf(contract.sourcify)?.name : undefined
  // A create that failed never got its address.
  const known = frame.kind !== 'create' || frame.address !== UNKNOWN
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 py-1 text-[13px]" style={{ paddingLeft: frame.depth * 20 }}>
      <span className="font-mono text-xs text-gray-400">{frame.kind}</span>
      {known && (
        <span className="font-mono break-all text-gray-700" title={frame.address}>
          {short(frame.address)}
        </span>
      )}
      {name && <span className="text-xs text-gray-500">{name}</span>}
      {frame.selector && <span className="font-mono text-xs text-gray-400">{frame.selector}</span>}
      {frame.value > 0n && <span className="text-xs text-gray-500">{formatEther(frame.value)} ETH</span>}
      {frame.error && <span className="text-xs text-light-coral-700">✕ {frame.error}</span>}
    </div>
  )
}

function CallTree({ simulation, contracts }: { simulation: Simulation; contracts: Contract[] }) {
  return (
    <>
      <p className={HEADING}>Call tree</p>
      {simulation.calls.map((call, index) => (
        <Fragment key={index}>
          {simulation.calls.length > 1 && (
            <p className="pt-2 text-xs text-gray-500">
              call {index + 1} of {simulation.calls.length}
            </p>
          )}
          {call.frames.map((frame, at) => (
            <FrameRow key={at} frame={frame} contracts={contracts} />
          ))}
        </Fragment>
      ))}
    </>
  )
}

function Advanced({
  simulation,
  effects,
  contracts,
  helios,
}: {
  simulation: Simulation
  effects: Effects | null
  contracts: Contract[]
  helios: boolean
}) {
  const you = simulation.calls[0]?.call.from ?? UNKNOWN
  const slots = simulation.diff.slots.length
  const events = simulation.calls.reduce((n, call) => n + call.logs.length, 0)
  const others = otherContracts(simulation, effects)
  const shown = (effects?.assets.length ?? 0) + (effects?.permissions.length ?? 0) > 0
  const parts = [
    slots > 0 && count(slots, 'storage slot'),
    events > 0 && count(events, 'event'),
    count(simulation.touched.length, 'contract'),
  ].filter(Boolean)
  return (
    <Disclosure
      label={
        <>
          Advanced view <Muted>· {parts.join(' · ')}</Muted>
        </>
      }
    >
      {others.length > 0 && (
        <p className="pt-1 text-xs text-gray-600">
          {shown
            ? `The transaction also changes data in ${count(others.length, 'other contract')}: `
            : `The transaction changes data in ${count(others.length, 'contract')}: `}
          {others.map((address) => nameOf(address, contracts, you) ?? short(address)).join(', ')}.
        </p>
      )}
      <div className="divide-y divide-gray-100 pt-2">
        <Row label="Block">{simulation.header.number.toLocaleString('en-US')}</Row>
        <Row label="State read">
          {count(simulation.reads.accounts, 'account')} · {count(simulation.reads.slots, 'storage slot')}
          {helios ? (
            <span className="text-green-700"> ✓ merkle proofs</span>
          ) : (
            <span className="text-amber-700"> no proof</span>
          )}
        </Row>
      </div>
      {(slots > 0 || simulation.diff.accounts.length > 0) && (
        <StateChanges simulation={simulation} contracts={contracts} you={you} />
      )}
      {events > 0 && <Events simulation={simulation} contracts={contracts} you={you} />}
      <CallTree simulation={simulation} contracts={contracts} />
    </Disclosure>
  )
}

/* the card */

function Changes({ simulation, context }: { simulation: Simulation; context: Context }) {
  const { effects, prices } = context
  const sent = effects.assets.filter((change) => change.delta < 0n)
  const received = effects.assets.filter((change) => change.delta > 0n)
  const nothing = effects.assets.length === 0 && effects.permissions.length === 0
  const others = otherContracts(simulation, effects)
  const fee = feeOf(simulation)
  const ethPrice = prices.status === 'passed' ? prices.prices.get(NATIVE) : undefined
  return (
    <>
      {effects.warnings.map((warning) => (
        <Notice
          key={`${warning.token} ${warning.direction}`}
          tone="amber"
          title={`⚠ ${warningText(warning, effects.tokens)}`}
          className="mt-3"
        >
          The contract {short(warning.token)} emitted the event
          {sourceOf(warning.token, context.contracts) === 'unverified' ? ', and its sources are not verified' : ''}. Its
          own answer shows no change for you. A contract can emit any event: an event alone is no proof.
        </Notice>
      ))}
      <div className="mt-2 divide-y divide-gray-100">
        {sent.length > 0 && (
          <Line label="You send">
            {sent.map((change, index) => (
              <AssetRow key={index} change={change} context={context} />
            ))}
          </Line>
        )}
        {received.length > 0 && (
          <Line label="You receive">
            {received.map((change, index) => (
              <AssetRow key={index} change={change} context={context} />
            ))}
          </Line>
        )}
        {effects.permissions.length > 0 && (
          <Line label="You allow">
            {effects.permissions.map((permission, index) => (
              <PermissionRow key={index} permission={permission} context={context} />
            ))}
          </Line>
        )}
        {nothing && (
          <div className="py-2.5 text-sm">
            <p className="font-medium text-gray-900">No asset of yours moves, and no allowance changes.</p>
            <p className="text-gray-600">
              {others.length > 0
                ? `The transaction changes data in ${count(others.length, 'contract')}. The advanced view shows it.`
                : 'The transaction changes no storage.'}
            </p>
          </div>
        )}
        <Line label="Network fee">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <Tooltip tip={feeNote(simulation)}>
              <span className="font-mono text-gray-700">− {amountText(fee, 18)} ETH</span>
            </Tooltip>
            <Usd amount={fee} decimals={18} price={ethPrice} prices={prices} />
            <span className="text-xs text-gray-400">estimate</span>
          </p>
        </Line>
      </div>
      {prices.status === 'failed' && (
        <p className="pb-1 text-xs text-amber-700">
          No dollar values: {prices.reason}. The amounts above do not depend on {PRICE_SOURCE}.
        </p>
      )}
      <p className="text-xs text-gray-400">
        Estimated on the state of block {simulation.header.number.toLocaleString('en-US')}. The result can differ when
        the transaction is mined.
      </p>
    </>
  )
}

// A run that did not give effects: not simulated, failed, or running.
function Summary({ state, runs }: { state: GateState<Simulation>; runs: boolean }) {
  if (state.status === 'skipped') {
    if (!runs) return <Notice tone="gray" title={`Not simulated · ${state.reason}`} />
    return (
      <Notice tone="amber" title="⚠ The transaction was not simulated">
        {`${state.reason}. Its effects, and the contracts it calls on the way, are unknown.`}
      </Notice>
    )
  }
  if (state.status === 'failed') {
    return (
      <Notice tone="coral" title="⚠ The transaction could not be simulated">
        {`${state.reason}. Its effects, and the contracts it calls on the way, are unknown.`}
      </Notice>
    )
  }
  return <p className="text-sm font-medium text-gray-500">Simulation is running…</p>
}

function Header({ simulation, helios }: { simulation: Simulation; helios: boolean }) {
  const age = useAge(simulation.header.timestamp)
  return (
    <div className="flex items-center justify-between gap-4">
      <p className={`flex items-center gap-2 text-sm font-medium ${helios ? 'text-green-700' : 'text-amber-700'}`}>
        {helios && <LocallyVerifiedIcon className="h-4 w-4 shrink-0" title="Checked on this machine" />}
        Simulated on {helios ? 'verified' : 'unverified'} state
      </p>
      <p className="shrink-0 font-mono text-xs text-gray-400" title="The block whose state the run used">
        block {simulation.header.number.toLocaleString('en-US')} · {ageText(age)}
      </p>
    </div>
  )
}

export function SimulationStep({ step, verification }: { step: StepInfo; verification: Verification }) {
  const { simulation, contracts, chain, chainId } = verification
  const helios = chain?.mode === 'helios'
  const lines = verification.lines.filter((line) => line.source === 'evm')
  const passed = simulation.status === 'passed' ? simulation.value : null
  const effects = passed?.effects.status === 'passed' ? passed.effects.value : null
  const prices = usePrices(chainId, effects)
  const entries = useSyncExternalStore(tokenListStore.subscribe, tokenListStore.getSnapshot)
  const listed = chainId === null ? new Map<Hex, string[]>() : listedOn(entries, chainId)
  return (
    <Step
      step={step}
      explainer="Onay runs the transaction in a local EVM on the chain state that the step before read. It shows what you send, what you receive, and what you allow others to spend. Each amount is the change of your balance as the token answers it, before and after the run, not the amount that an event claims. The advanced view shows every state change, every event, and every contract that the transaction calls, so that the next step can check each of them."
    >
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
        {passed ? (
          <>
            <Header simulation={passed} helios={helios} />
            {reverted(passed) ? (
              <Notice
                tone="coral"
                title="⚠ The transaction reverts in simulation"
                detail={passed.calls.find((call) => call.error)?.error ?? undefined}
                className="mt-3"
              >
                {`Run on the ${helios ? 'latest verified' : 'latest'} chain state. Nothing changes, and sending it would only waste gas. Do not sign it.`}
              </Notice>
            ) : passed.effects.status === 'failed' ? (
              <Notice tone="amber" title="⚠ The effects could not be read" className="mt-3">
                {`${passed.effects.reason}. The run ended, and the contracts it calls are checked, but what it does to your assets is unknown.`}
              </Notice>
            ) : (
              effects && <Changes simulation={passed} context={{ effects, contracts, listed, prices }} />
            )}
            <Advanced simulation={passed} effects={effects} contracts={contracts} helios={helios} />
          </>
        ) : (
          <Summary state={simulation} runs={verification.runs} />
        )}
        <CollapsibleLog lines={lines} />
      </div>
    </Step>
  )
}
