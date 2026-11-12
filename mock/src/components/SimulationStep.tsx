import { useEffect, useState, type ReactNode } from 'react'
import type { MockRequest } from '../data/mockRequest'
import { PRICE_SOURCE } from '../data/effects'
import type {
  AssetChange,
  BalanceChange,
  ContractChanges,
  Effects,
  EventRow,
  Permission,
  Prices,
  Segment,
  StorageRow,
  TokenInfo,
} from '../data/effects'
import { LocallyVerifiedIcon, ThirdPartyIcon, WarningIcon } from './Icons'
import { Step } from './Step'

// The card answers three questions: does the transaction work, what do you send and receive, and
// what do you allow others to spend. The state changes and the events are the advanced view.

const MAX_UINT = (1n << 256n) - 1n
// an allowance above this is more than any supply: it shows as "Unlimited"
const UNLIMITED = 1n << 255n
const short = (hex: string) => (hex.length > 14 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex)
const blockText = (n: number) => n.toLocaleString('en-US')
const isInt = (type: string) => /^u?int\d*$/.test(type)
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

type Labels = Record<string, string>
type Tokens = Record<string, TokenInfo>

/** the address in a value: an address, or a bytes32 that holds one in its low 20 bytes */
function addressOf(value: string, type: string): string | null {
  if (type === 'address') return value.toLowerCase()
  if (type === 'bytes32' && /^0x0{24}[0-9a-fA-F]{40}$/.test(value) && BigInt(value) >= 1n << 64n) {
    return `0x${value.slice(26).toLowerCase()}`
  }
  return null
}

function namesYou(row: StorageRow, you: string): boolean {
  const inPath = (row.path ?? []).some((s) => 'key' in s && addressOf(s.key, s.type) === you)
  return inPath || addressOf(row.before, row.type) === you || addressOf(row.after, row.type) === you
}

function grouped(n: bigint): string {
  const text = n.toLocaleString('en-US')
  return text.length > 31 ? `${text.slice(0, 9)}…${text.slice(-8)}` : text
}

function formatValue(value: string, type: string, labels: Labels): string {
  if (isInt(type)) {
    const n = BigInt(value)
    return type === 'uint256' && n === MAX_UINT ? 'max uint256' : grouped(n)
  }
  const address = addressOf(value, type)
  if (address) return labels[address] ?? short(address)
  if (type === 'bytes32') {
    const n = BigInt(value)
    if (n === 0n) return '0x0'
    return n < 1n << 64n ? `0x${n.toString(16)} (${n})` : short(value)
  }
  return value
}

/** the signed change of an integer slot; none for max uint256, which reads as a limit */
function deltaOf(before: string, after: string, type: string): string | null {
  if (!isInt(type)) return null
  const a = BigInt(before)
  const b = BigInt(after)
  if (a === MAX_UINT || b === MAX_UINT || a === b) return null
  return b > a ? `+ ${grouped(b - a)}` : `− ${grouped(a - b)}`
}

function units(value: bigint, decimals: number): string {
  const one = 10n ** BigInt(decimals)
  const fraction = (value % one).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6)
  return `${(value / one).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`
}

const formatEth = (wei: bigint) => units(wei, 18)

/* small parts */

/** seconds since the review opened; drives the age of the result and the re-runs */
function useSeconds(): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return seconds
}

// the first run is 4 s old when the review opens; a new block comes every 12 s
const FIRST_AGE = 4
const BLOCK_TIME = 12

function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-gray-100 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 py-0.5 text-left text-sm text-gray-700 hover:text-gray-900"
      >
        <span>{label}</span>
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="pb-2 pt-1">{children}</div>}
    </div>
  )
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-gray-400">{children}</span>

function AddressLabel({ address, labels }: { address: string; labels: Labels }) {
  const label = labels[address]
  return (
    <span title={address} className={label === 'you' ? 'font-semibold' : undefined}>
      {label ?? short(address)}
    </span>
  )
}

/** a name if Onay has one, and the address always */
function Account({ address, labels }: { address: string; labels: Labels }) {
  const label = labels[address]
  return (
    <span title={address}>
      {label && <span className="font-medium text-gray-900">{label} </span>}
      <span className="font-mono text-xs text-gray-500">{short(address)}</span>
    </span>
  )
}

function Notice({ tone, title, children }: { tone: 'amber' | 'coral'; title: string; children: ReactNode }) {
  const box = tone === 'amber' ? 'bg-amber-50 ring-amber-300' : 'bg-light-coral-100/40 ring-light-coral-300'
  const head = tone === 'amber' ? 'text-amber-900' : 'text-light-coral-800'
  const body = tone === 'amber' ? 'text-amber-900/80' : 'text-light-coral-800/90'
  return (
    <div className={`mt-3 flex gap-2.5 rounded-lg px-3 py-2.5 ring-1 ${box}`}>
      <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className={`text-sm font-medium ${head}`}>{title}</p>
        <p className={`text-xs ${body}`}>{children}</p>
      </div>
    </div>
  )
}

/* the asset rows */

/** one line of the card: the label on the left, the content on the right */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5">
      <p className="w-24 shrink-0 pt-px text-sm text-gray-500">{label}</p>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  )
}

/** who says what about a token: the token itself, your token list, the Sourcify gate */
function TokenFacts({ address, token }: { address: string; token: TokenInfo | undefined }) {
  if (!token) return <span className="font-mono text-xs text-gray-500">{short(address)}</span>
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
      <span title="name(): the token's own claim">{token.name}</span>
      <span className="font-mono" title={address}>
        {short(address)}
      </span>
      {token.list && (
        <span className="flex items-center gap-1" title={`On your token list ${token.list}: a claim of its publisher`}>
          <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" />
          {token.list}
        </span>
      )}
      {!token.list && <span className="text-amber-700">on none of your token lists</span>}
      {!token.verified && (
        <span className="flex items-center gap-1 text-amber-700">
          <WarningIcon className="h-3.5 w-3.5 shrink-0" />
          sources not verified
        </span>
      )}
    </span>
  )
}

function assetAmount(change: AssetChange, tokens: Tokens): string {
  const delta = BigInt(change.delta)
  const size = delta < 0n ? -delta : delta
  const { asset } = change
  if (asset.kind === 'native') return `${formatEth(size)} ETH`
  const token = tokens[asset.token]
  if (asset.kind === 'nft') return `${token?.ticker ?? 'NFT'} #${asset.id}`
  return `${units(size, token?.decimals ?? 0)} ${token?.ticker ?? ''}`.trim()
}

/** a value with a popup on hover or keyboard focus, as the values of the contract profile have it */
function Hint({ children, text }: { children: ReactNode; text: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        className="cursor-help outline-none decoration-dotted underline-offset-2 group-hover:underline"
      >
        {children}
      </span>
      <span
        role="tooltip"
        className="invisible absolute left-0 top-full z-20 mt-1.5 flex w-72 items-start gap-1.5 rounded-lg border border-gray-200 bg-white p-3 font-sans text-xs font-normal leading-relaxed text-gray-600 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <ThirdPartyIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" title="Not checked by Onay" />
        <span>{text}</span>
      </span>
    </span>
  )
}

/** a dollar value: the amount times a price from the price source. The row shows no mark; the popup says whose claim it is. */
function Usd({ value, decimals, price, prices }: { value: bigint; decimals: number; price?: number; prices: Prices }) {
  // off, or the source did not answer: one line at the end of the card says so
  if (prices !== 'ok') return null
  if (price === undefined) {
    return (
      <Hint text={`${PRICE_SOURCE} has no price for this token. A token with no price is often new or little traded.`}>
        <span className="text-xs text-gray-400">no price</span>
      </Hint>
    )
  }
  const dollars = (Number(value) / 10 ** decimals) * price
  return (
    <Hint
      text={`The amount times the price from ${PRICE_SOURCE}, a third party. Onay did not check the price. It can be wrong or old.`}
    >
      <span className="text-xs text-gray-500">
        ≈ ${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </Hint>
  )
}

function AssetRow({
  change,
  labels,
  tokens,
  ethPrice,
  prices,
}: {
  change: AssetChange
  labels: Labels
  tokens: Tokens
  ethPrice: number | undefined
  prices: Prices
}) {
  const delta = BigInt(change.delta)
  const out = delta < 0n
  const size = out ? -delta : delta
  const { asset } = change
  const token = asset.kind === 'native' ? undefined : tokens[asset.token]
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span
          className={`font-mono font-medium ${out ? 'text-light-coral-700' : 'text-green-700'}`}
          title="The change of your balance: the balance after the run, minus the balance before"
        >
          {out ? '−' : '+'} {assetAmount(change, tokens)}
        </span>
        {asset.kind === 'native' && <Usd value={size} decimals={18} price={ethPrice} prices={prices} />}
        {asset.kind === 'erc20' && (
          <Usd value={size} decimals={token?.decimals ?? 0} price={token?.price} prices={prices} />
        )}
        {change.counterparty && (
          <span className="text-gray-500">
            {out ? 'to' : 'from'} <Account address={change.counterparty} labels={labels} />
          </span>
        )}
      </p>
      {asset.kind !== 'native' && <TokenFacts address={asset.token} token={token} />}
    </div>
  )
}

function PermissionRow({ permission, labels, tokens }: { permission: Permission; labels: Labels; tokens: Tokens }) {
  const token = tokens[permission.token]
  const ticker = token?.ticker ?? short(permission.token)
  const after = BigInt(permission.after)
  const revoked = after === 0n
  const unlimited = permission.kind === 'all' || (permission.kind === 'amount' && after >= UNLIMITED)
  const what =
    permission.kind === 'all'
      ? `All your ${ticker}`
      : permission.kind === 'one'
        ? `${ticker} #${permission.id}`
        : unlimited
          ? `Unlimited ${ticker}`
          : `${units(after, token?.decimals ?? 0)} ${ticker}`
  const balance =
    permission.balance === undefined
      ? null
      : permission.kind === 'amount'
        ? `${units(BigInt(permission.balance), token?.decimals ?? 0)} ${ticker}`
        : `${permission.balance} ${ticker}`
  return (
    <div className={unlimited && !revoked ? 'rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-300' : undefined}>
      <p className="text-sm text-gray-700">
        <Account address={permission.spender} labels={labels} /> {revoked ? 'can no longer spend' : 'to spend'}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span
          className={`font-mono font-medium ${unlimited && !revoked ? 'text-amber-900' : 'text-gray-900'}`}
          title="allowance after the run, read from the token"
        >
          {revoked ? ticker : what}
        </span>
        {balance && !revoked && <span className="text-xs text-gray-500">your balance: {balance}</span>}
      </p>
      {unlimited && !revoked && (
        <p className="pt-0.5 text-xs text-amber-900/80">
          {permission.kind === 'all'
            ? 'The spender can take each one, now and later, with no new signature of yours.'
            : 'The spender can take all you have, now and later, with no new signature of yours.'}
        </p>
      )}
      <TokenFacts address={permission.token} token={token} />
    </div>
  )
}

/* the advanced view: state changes */

function PathView({ path, labels }: { path: Segment[]; labels: Labels }) {
  return (
    <span className="break-all font-mono text-[13px] text-gray-900">
      {path.map((segment, i) => {
        if ('name' in segment) return <span key={i}>{segment.name}</span>
        if ('member' in segment) return <span key={i}>.{segment.member}</span>
        const key =
          'index' in segment
            ? String(segment.index)
            : (addressOf(segment.key, segment.type) ?? formatValue(segment.key, segment.type, labels))
        const address = 'key' in segment ? addressOf(segment.key, segment.type) : null
        return (
          <span key={i}>
            [
            <span className="text-cerulean-blue-600">
              {address ? <AddressLabel address={address} labels={labels} /> : key}
            </span>
            ]
          </span>
        )
      })}
    </span>
  )
}

/** the change, right after the new value */
function Delta({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <span className="ml-2 whitespace-nowrap rounded bg-gray-100 px-1.5 py-px font-mono text-[11px] font-medium text-gray-700">
      {text}
    </span>
  )
}

/** a plain variable: the layout gives its slot. A mapping or an array hashes its keys into the slot. */
const isPlain = (path: Segment[] | null): path is Segment[] =>
  path !== null && path.every((segment) => 'name' in segment || 'member' in segment)

/** a value as the 32 bytes of the slot hold it, without the leading zeros */
function rawWord(value: string, type: string): string {
  if (type === 'bool') return value === 'true' ? '0x1' : '0x0'
  return `0x${BigInt(value).toString(16)}`
}

function StorageRowView({ row, you, labels }: { row: StorageRow; you: string; labels: Labels }) {
  if (!isPlain(row.path)) {
    const mine = addressOf(row.before, row.type) === you || addressOf(row.after, row.type) === you
    return (
      <div className={mine ? 'border-l-2 border-l-cerulean-blue-400 py-2 pl-2.5' : 'py-2 pl-3'}>
        <p className="break-all font-mono text-[13px] text-gray-500">slot {row.slot}</p>
        <p className="break-all font-mono text-xs text-gray-500">
          {rawWord(row.before, row.type)} <Muted>→</Muted>{' '}
          <span className="text-gray-900">{rawWord(row.after, row.type)}</span>
        </p>
      </div>
    )
  }
  return (
    <div className={namesYou(row, you) ? 'border-l-2 border-l-cerulean-blue-400 py-2 pl-2.5' : 'py-2 pl-3'}>
      <p className="text-sm text-gray-900">
        <PathView path={row.path} labels={labels} />
        <span className="pl-2 font-mono text-[11px] text-gray-400">{row.type}</span>
      </p>
      <p className="font-mono text-xs text-gray-500">
        <span title={row.before}>{formatValue(row.before, row.type, labels)}</span> <Muted>→</Muted>{' '}
        <span className="text-gray-900" title={row.after}>
          {formatValue(row.after, row.type, labels)}
        </span>
        <Delta text={deltaOf(row.before, row.after, row.type)} />
      </p>
      <p className="break-all pt-1 font-mono text-[11px] leading-relaxed text-gray-400">{row.derivation}</p>
    </div>
  )
}

function ContractView({ contract, you, labels }: { contract: ContractChanges; you: string; labels: Labels }) {
  return (
    <div className="pt-3">
      <p className="flex min-w-0 items-baseline gap-2">
        <span className="text-sm font-medium text-gray-800">{contract.name}</span>
        <span className="font-mono text-xs text-gray-400" title={contract.address}>
          {short(contract.address)}
        </span>
      </p>
      <div className="divide-y divide-gray-100">
        {contract.rows.map((row) => (
          <StorageRowView key={row.slot + row.derivation} row={row} you={you} labels={labels} />
        ))}
      </div>
    </div>
  )
}

function BalanceRow({ change, labels }: { change: BalanceChange; labels: Labels }) {
  const d = BigInt(change.after) - BigInt(change.before)
  return (
    <div className="py-2 pl-3">
      <p className="text-sm text-gray-900">
        ETH balance of <AddressLabel address={change.address} labels={labels} />
      </p>
      <p className="font-mono text-xs text-gray-500">
        {formatEth(BigInt(change.before))} <Muted>→</Muted>{' '}
        <span className="text-gray-900">{formatEth(BigInt(change.after))} ETH</span>
        <Delta text={d >= 0n ? `+ ${formatEth(d)} ETH` : `− ${formatEth(-d)} ETH`} />
      </p>
    </div>
  )
}

function Events({ events, you, labels }: { events: EventRow[]; you: string; labels: Labels }) {
  return (
    <div className="divide-y divide-gray-100">
      {events.map((event, i) => {
        const mine = event.args.some(([, type, value]) => addressOf(value, type) === you)
        return (
          <div
            key={i}
            className={`flex gap-3 py-1.5 text-xs ${mine ? 'border-l-2 border-l-cerulean-blue-400 pl-2' : 'pl-2.5'}`}
          >
            <span className="w-28 shrink-0 truncate text-gray-500">{event.contract}</span>
            <span className="min-w-0 break-words font-mono text-gray-800">
              {event.name}(
              {event.args.map(([name, type, value], j) => {
                const address = addressOf(value, type)
                return (
                  <span key={name}>
                    {j > 0 && ', '}
                    <Muted>{name}: </Muted>
                    {address ? <AddressLabel address={address} labels={labels} /> : formatValue(value, type, labels)}
                  </span>
                )
              })}
              )
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** the contracts that the run wrote to, apart from the tokens whose change the card shows */
function unexplained(effects: Effects): ContractChanges[] {
  const shown = new Set<string>()
  for (const { asset } of effects.assets) if (asset.kind !== 'native') shown.add(asset.token)
  for (const permission of effects.permissions) shown.add(permission.token)
  return effects.storage.filter((contract) => !shown.has(contract.address))
}

function Advanced({ effects, you }: { effects: Effects; you: string }) {
  const slots = effects.storage.reduce((n, c) => n + c.rows.length, 0)
  const other = unexplained(effects)
  const parts = [
    slots > 0 && count(slots, 'storage slot'),
    effects.balances.length > 0 && count(effects.balances.length, 'ETH balance'),
    effects.events.length > 0 && count(effects.events.length, 'event'),
  ].filter(Boolean)
  if (parts.length === 0) return null
  const heading = 'pt-4 text-[11px] font-medium uppercase tracking-wide text-gray-400'
  return (
    <div className="mt-3">
      <Disclosure
        label={
          <>
            Advanced view <Muted>· {parts.join(' · ')}</Muted>
          </>
        }
      >
        {other.length > 0 && (
          <p className="pt-1 text-xs text-gray-600">
            {effects.assets.length + effects.permissions.length > 0
              ? `The transaction also changes data in ${count(other.length, 'other contract')}: `
              : `The transaction changes data in ${count(other.length, 'contract')}: `}
            {other.map((c) => c.name).join(', ')}.
          </p>
        )}
        {slots + effects.balances.length > 0 && (
          <>
            <p className={heading}>State changes</p>
            <p className="pt-1 text-xs text-gray-500">
              Each account balance and storage slot that the run changed. A plain variable shows by its name, from the
              storage layout of the recompile. A slot of a mapping or an array shows raw. A blue line marks a row that
              names your address.
            </p>
            {effects.balances.map((change) => (
              <BalanceRow key={change.address} change={change} labels={effects.labels} />
            ))}
            {effects.storage.map((contract) => (
              <ContractView key={contract.address} contract={contract} you={you} labels={effects.labels} />
            ))}
            {effects.restored.length > 0 && (
              <div className="pt-3 font-mono text-[11px] text-gray-400">
                <p className="font-sans text-xs text-gray-500">Written, then set back</p>
                {effects.restored.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </>
        )}
        {effects.events.length > 0 && (
          <>
            <p className={`${heading} pb-1`}>Events</p>
            <Events events={effects.events} you={you} labels={effects.labels} />
          </>
        )}
      </Disclosure>
    </div>
  )
}

/* the card */

function Changes({ effects, you }: { effects: Effects; you: string }) {
  const { labels, tokens } = effects
  const sent = effects.assets.filter((change) => BigInt(change.delta) < 0n)
  const received = effects.assets.filter((change) => BigInt(change.delta) > 0n)
  const other = unexplained(effects)
  const nothing = effects.assets.length === 0 && effects.permissions.length === 0
  return (
    <>
      {effects.warnings.map((warning) => (
        <Notice key={warning.title} tone="amber" title={warning.title}>
          {warning.text}
        </Notice>
      ))}
      <div className="mt-2 divide-y divide-gray-100">
        {sent.length > 0 && (
          <Line label="You send">
            {sent.map((change, i) => (
              <AssetRow
                key={i}
                change={change}
                labels={labels}
                tokens={tokens}
                ethPrice={effects.ethPrice}
                prices={effects.prices}
              />
            ))}
          </Line>
        )}
        {received.length > 0 && (
          <Line label="You receive">
            {received.map((change, i) => (
              <AssetRow
                key={i}
                change={change}
                labels={labels}
                tokens={tokens}
                ethPrice={effects.ethPrice}
                prices={effects.prices}
              />
            ))}
          </Line>
        )}
        {effects.permissions.length > 0 && (
          <Line label="You allow">
            {effects.permissions.map((permission, i) => (
              <PermissionRow key={i} permission={permission} labels={labels} tokens={tokens} />
            ))}
          </Line>
        )}
        {nothing && (
          <div className="py-2.5 text-sm">
            <p className="font-medium text-gray-900">No asset of yours moves, and no allowance changes.</p>
            <p className="text-gray-600">
              {other.length > 0
                ? `The transaction changes data in ${count(other.length, 'contract')}. The advanced view shows it.`
                : 'The transaction changes no storage.'}
            </p>
          </div>
        )}
        <Line label="Network fee">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-mono text-gray-700">− {formatEth(BigInt(effects.fee))} ETH</span>
            <Usd value={BigInt(effects.fee)} decimals={18} price={effects.ethPrice} prices={effects.prices} />
            <span className="text-xs text-gray-400">estimate</span>
          </p>
        </Line>
      </div>
      {typeof effects.prices === 'object' && (
        <p className="pb-1 text-xs text-amber-700">
          No dollar values: {PRICE_SOURCE} did not answer ({effects.prices.error}). The amounts above do not depend on
          it.
        </p>
      )}
      <p className="text-xs text-gray-400">
        Estimated on the state of block {blockText(effects.block)}. The result can differ when the transaction is mined.
      </p>
      <Advanced effects={effects} you={you} />
    </>
  )
}

export function EffectsCard({ effects, you, helios }: { effects: Effects; you: string; helios: boolean }) {
  const seconds = useSeconds()
  const age = (FIRST_AGE + seconds) % BLOCK_TIME
  const reruns = Math.floor((FIRST_AGE + seconds) / BLOCK_TIME)
  const { outcome } = effects
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        {outcome.kind === 'running' ? (
          <p className="text-sm font-medium text-gray-500">Simulation is running…</p>
        ) : outcome.kind === 'failed' ? (
          <p className="text-sm font-medium text-amber-700">Not simulated</p>
        ) : (
          <p className={`flex items-center gap-2 text-sm font-medium ${helios ? 'text-green-700' : 'text-amber-700'}`}>
            {helios && <LocallyVerifiedIcon className="h-4 w-4 shrink-0" title="Checked on this machine" />}
            Simulated on {helios ? 'verified' : 'unverified'} state
          </p>
        )}
        {(outcome.kind === 'done' || outcome.kind === 'reverted') && (
          <p
            className="shrink-0 font-mono text-xs text-gray-400"
            title={reruns === 0 ? 'Runs again at each new block' : `${reruns + 1} runs, the same result each time`}
          >
            block {blockText(effects.block + reruns)} · {age} s ago
          </p>
        )}
      </div>
      {outcome.kind === 'running' && (
        <p className="pt-2 text-sm text-gray-500">
          Onay runs the transaction in a local EVM. Each account and storage slot is read from the chain.
        </p>
      )}
      {outcome.kind === 'failed' && (
        <Notice tone="amber" title="The transaction was not simulated">
          {outcome.reason}. Its effects are unknown.
        </Notice>
      )}
      {outcome.kind === 'reverted' && (
        <Notice tone="coral" title="The transaction reverts in simulation">
          {outcome.where} reverts with “{outcome.reason}”. Nothing changes, and sending it would only waste gas. Do not
          sign it.
        </Notice>
      )}
      {outcome.kind === 'done' && <Changes effects={effects} you={you} />}
    </div>
  )
}

const youOf = (request: MockRequest) => (request.raw.find((field) => field.name === 'from')?.value ?? '').toLowerCase()

export function SimulationStep({ request }: { request: MockRequest }) {
  return (
    <Step
      number={2}
      title="Transaction Simulation"
      explainer="Onay runs the transaction in a local EVM on the chain state of step 1. The result shows what you send, what you receive, and what you allow others to spend. Each amount is the change of your balance, not the amount that an event claims."
    >
      {request.effects ? (
        <EffectsCard effects={request.effects} you={youOf(request)} helios={request.chainMode === 'helios'} />
      ) : (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-500 shadow-sm">
          No simulation mock for this scenario. The page of the simulation step shows every case.
        </p>
      )}
    </Step>
  )
}
