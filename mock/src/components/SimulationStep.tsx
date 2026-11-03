import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MockRequest } from '../data/mockRequest'
import type {
  BalanceChange,
  ContractChanges,
  CrossSource,
  Display,
  Effects,
  EventRow,
  Formatter,
  Segment,
  SourceState,
  StorageDescriptor,
  StorageRow,
} from '../data/effects'
import { LocallyVerifiedIcon, ThirdPartyIcon, WarningIcon } from './Icons'
import { Step } from './Step'

// Generic rules only: nothing below knows a token standard or a protocol. A change is shown by
// the name of its variable, and "yours" means that your address is a key or a value of the slot.
// Labels and units come only from a storage layout descriptor (ERC-8317), which is data.

const MAX_UINT = (1n << 256n) - 1n
const short = (hex: string) => (hex.length > 14 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex)
const blockText = (n: number) => n.toLocaleString('en-US')
const isInt = (type: string) => /^u?int\d*$/.test(type)
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

type Labels = Record<string, string>
type Tokens = Record<string, { ticker: string; decimals: number }>

/** what every row needs: names, token claims, the icons of the services, and the raw view */
interface Ctx {
  labels: Labels
  tokens: Tokens
  icons: Record<string, string>
  /** raw: variable names, raw values and slots; otherwise the labels and units of the descriptors */
  raw: boolean
}

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

/* ERC-8317 */

/** the displays on the path of a row: its variable, then each struct member that has one */
function displaysOf(descriptor: StorageDescriptor | undefined, row: StorageRow): Display[] {
  const top = row.path?.[0]
  if (!descriptor || !row.path || !top || !('name' in top)) return []
  const entry = descriptor.storage.find((e) => e.label === top.name)
  if (!entry) return []
  const found = entry.display ? [entry.display] : []
  const members: string[] = []
  for (const segment of row.path.slice(1)) {
    if (!('member' in segment)) continue
    members.push(segment.member)
    const member = entry.members?.[members.join('.')]
    if (member) found.push(member)
  }
  return found
}

/** a key or a value, formatted with an ERC-7730 formatter */
function applyFormat(f: Partial<Formatter> | null | undefined, raw: string, type: string, ctx: Ctx): string {
  switch (f?.format) {
    case 'addressName': {
      const address = addressOf(raw, type === 'address' ? 'address' : 'bytes32') ?? raw.toLowerCase()
      return ctx.labels[address] ?? short(address)
    }
    case 'tokenAmount': {
      const token = f.params?.token ? ctx.tokens[f.params.token] : undefined
      if (!token) break
      const value = BigInt(raw)
      if (f.params?.threshold && value >= BigInt(f.params.threshold)) {
        return `${f.params.message ?? 'Unlimited'} ${token.ticker}`
      }
      return `${units(value, token.decimals)} ${token.ticker}`
    }
    case 'nftName': {
      const token = f.params?.collection ? ctx.tokens[f.params.collection] : undefined
      const id = BigInt(raw)
      if (!token || id === 0n) break
      return `${token.ticker} #${id}`
    }
    case 'date':
      return `${new Date(Number(raw) * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`
  }
  return formatValue(raw, type, ctx.labels)
}

/** a label with {key[N]} and {index[N]} resolved; null when the path has no such key */
function resolve(display: Display, path: Segment[], ctx: Ctx): string | null {
  if (!display.label) return null
  const keys = path.filter((s) => 'key' in s)
  const indexes = path.filter((s) => 'index' in s)
  const missing = { any: false }
  const text = display.label.replace(/\{(key|index)\[(\d+)\]\}/g, (_, kind: string, n: string) => {
    const i = Number(n)
    const segment = kind === 'key' ? keys[i] : indexes[i]
    if (!segment) {
      missing.any = true
      return ''
    }
    const [raw, type] = 'key' in segment ? [segment.key, segment.type] : [String(segment.index), 'uint256']
    return applyFormat(display.keyFormats?.[i], raw, type, ctx)
  })
  return missing.any ? null : text
}

/** the signed change in the unit of the format */
function changeOf(format: Display | undefined, row: StorageRow, ctx: Ctx): string | null {
  const token = format?.format === 'tokenAmount' && format.params?.token ? ctx.tokens[format.params.token] : undefined
  if (token) {
    const a = BigInt(row.before)
    const b = BigInt(row.after)
    const limit = format?.params?.threshold ? BigInt(format.params.threshold) : MAX_UINT + 1n
    if (a >= limit || b >= limit || a === b) return null
    return `${b > a ? '+' : '−'} ${units(b > a ? b - a : a - b, token.decimals)} ${token.ticker}`
  }
  if (format?.format === 'date') {
    const d = Number(row.after) - Number(row.before)
    return d === 0 ? null : `${d > 0 ? '+' : '−'} ${Math.abs(d)} s`
  }
  if (format?.format === 'nftName' || format?.format === 'addressName') return null
  return deltaOf(row.before, row.after, row.type)
}

/** "1,250 USDC → 5,121.5 USDC" reads as "1,250 → 5,121.5 USDC" */
function shareUnit(before: string, after: string): [string, string] {
  const unit = / [A-Za-z]+$/.exec(after)?.[0]
  return unit && before.endsWith(unit) ? [before.slice(0, -unit.length), after] : [before, after]
}

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

/** a panel that opens on click and closes on a click outside or on Escape */
function Popover({
  trigger,
  label,
  align = 'right',
  children,
}: {
  trigger: ReactNode
  label: string
  align?: 'left' | 'right'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-cerulean-blue-300"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full z-30 mt-2 w-80 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-gray-600 shadow-lg`}
        >
          {children}
        </div>
      )}
    </span>
  )
}

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

function ServiceIcon({ src }: { src: string | undefined }) {
  if (!src) return null
  return <img src={src} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
}

function AddressLabel({ address, labels }: { address: string; labels: Labels }) {
  const label = labels[address]
  return (
    <span title={address} className={label === 'you' ? 'font-semibold' : undefined}>
      {label ?? short(address)}
    </span>
  )
}

function PathView({ path, labels, small }: { path: Segment[]; labels: Labels; small?: boolean }) {
  return (
    <span className={`break-all font-mono ${small ? 'text-[11px] text-gray-500' : 'text-[13px] text-gray-900'}`}>
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

/** the two views of the slots: the descriptors' labels and units, or the raw storage */
function ViewSwitch({ raw, onChange }: { raw: boolean; onChange: (raw: boolean) => void }) {
  const options: [string, boolean][] = [
    ['ERC-8317', false],
    ['raw', true],
  ]
  return (
    <div
      role="radiogroup"
      aria-label="View"
      className="inline-flex rounded-full bg-gray-100 p-0.5 font-mono text-[11px]"
    >
      {options.map(([text, value]) => (
        <button
          key={text}
          type="button"
          role="radio"
          aria-checked={raw === value}
          onClick={() => onChange(value)}
          className={`rounded-full px-2.5 py-0.5 transition-colors ${
            raw === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/* storage */

type Tone = 'plain' | 'mine' | 'muted'

const toneClass: Record<Tone, string> = {
  plain: 'py-2',
  mine: 'border-l-2 border-l-cerulean-blue-400 py-2 pl-2.5',
  muted: 'py-2 pl-3 opacity-60',
}

function StorageRowView({ row, displays, tone, ctx }: { row: StorageRow; displays: Display[]; tone: Tone; ctx: Ctx }) {
  const path = row.path
  // a display whose label needs a key or an index that this row lacks does not apply to it,
  // for example "item {index[0]}" of an array to the length of the array
  const applies =
    path && !ctx.raw
      ? displays.map((d) => ({ d, text: resolve(d, path, ctx) })).filter(({ d, text }) => !d.label || text !== null)
      : []
  const label = applies
    .map(({ text }) => text)
    .filter((t) => t !== null)
    .join(' · ')
  const format = applies.map(({ d }) => d).findLast((d) => d.format)
  const show = (value: string) => applyFormat(format, value, row.type, ctx)
  const [before, after] = shareUnit(show(row.before), show(row.after))
  const hashed = row.slot.length > 10
  // a row that a simulator disputes stays in full color
  return (
    <div className={toneClass[tone === 'muted' && row.other ? 'plain' : tone]}>
      <p className="text-sm text-gray-900">
        {label ||
          (path ? (
            <>
              <PathView path={path} labels={ctx.labels} />
              {ctx.raw && <span className="pl-2 font-mono text-[11px] text-gray-400">{row.type}</span>}
            </>
          ) : (
            <span className="font-mono text-[13px] text-gray-500">slot {short(row.slot)}</span>
          ))}
      </p>
      <p className="font-mono text-xs text-gray-500">
        <span title={row.before}>{before}</span> <Muted>→</Muted>{' '}
        <span className="text-gray-900" title={row.after}>
          {after}
        </span>
        <Delta text={changeOf(format, row, ctx)} />
      </p>
      {row.other && (
        <p className="flex items-center gap-1.5 pt-0.5 text-xs text-amber-800">
          <WarningIcon className="h-3.5 w-3.5 shrink-0" title="The simulators disagree" />
          <ServiceIcon src={ctx.icons[row.other.source]} />
          {row.other.source} gets <span className="font-mono">{show(row.other.after)}</span>
        </p>
      )}
      {ctx.raw && (
        <div className="break-all pt-1 font-mono text-[11px] leading-relaxed text-gray-400">
          {hashed && <p>slot {row.slot}</p>}
          <p>
            {hashed ? '= ' : ''}
            {row.derivation}
          </p>
        </div>
      )}
    </div>
  )
}

function DescriptorInfo({ contract }: { contract: ContractChanges }) {
  const descriptor = contract.descriptor!
  const attested = descriptor.attestedBy.length > 0
  return (
    <Popover
      label="Where the labels come from"
      trigger={
        attested ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 font-serif text-[10px] font-semibold italic text-gray-400 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600">
            i
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800">
            <WarningIcon className="h-3.5 w-3.5" />
            unreviewed
          </span>
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <p className="flex items-start gap-1.5">
          <LocallyVerifiedIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" title="Checked on this machine" />
          <span>Variable names: {contract.layout}, recompiled here.</span>
        </p>
        <p className="flex items-start gap-1.5">
          <span className="w-3.5 shrink-0" />
          <span>
            Labels and units: ERC-8317 descriptor <span className="break-all font-mono">{descriptor.file}</span> from
            the registry. Its slots match the recompile.
          </span>
        </p>
        <p className="flex items-start gap-1.5">
          {attested ? (
            <>
              <span className="w-3.5 shrink-0" />
              <span>Attested by {descriptor.attestedBy.join(', ')}.</span>
            </>
          ) : (
            <>
              <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="text-amber-800">No auditor you trust attested it.</span>
            </>
          )}
        </p>
      </div>
    </Popover>
  )
}

type MarkedContract = Omit<ContractChanges, 'rows'> & { rows: (StorageRow & { mine: boolean })[] }

function ContractView({ contract, yours, ctx }: { contract: MarkedContract; yours: boolean; ctx: Ctx }) {
  return (
    <div className="pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-medium text-gray-800">{contract.name}</span>
          <span className="font-mono text-xs text-gray-400" title={contract.address}>
            {short(contract.address)}
          </span>
        </p>
        {contract.descriptor && !ctx.raw && <DescriptorInfo contract={contract} />}
      </div>
      <div className="divide-y divide-gray-100">
        {contract.rows.map((row) => (
          <StorageRowView
            key={row.slot + row.derivation}
            row={row}
            displays={displaysOf(contract.descriptor, row)}
            tone={!yours ? 'plain' : row.mine ? 'mine' : 'muted'}
            ctx={ctx}
          />
        ))}
      </div>
    </div>
  )
}

function BalanceRow({ change, labels }: { change: BalanceChange; labels: Labels }) {
  const d = BigInt(change.after) - BigInt(change.before)
  return (
    <div className="py-2">
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

/** a contract goes to your section when one of its slots names your address; your slots come first */
function split(storage: ContractChanges[], you: string) {
  const marked: MarkedContract[] = storage.map((contract) => {
    const rows = contract.rows.map((row) => ({ ...row, mine: namesYou(row, you) }))
    return { ...contract, rows: [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)] }
  })
  const isYours = (contract: MarkedContract) => contract.rows.some((row) => row.mine)
  return { yours: marked.filter(isYours), others: marked.filter((c) => !isYours(c)) }
}

/* other simulators */

function stateText(state: SourceState, seconds: number): ReactNode {
  switch (state.kind) {
    case 'same':
      return <span className="text-gray-500">= same</span>
    case 'differs':
      return (
        <span className="flex items-center gap-1 font-medium text-amber-700">
          <WarningIcon className="h-3.5 w-3.5" />
          differs
        </span>
      )
    case 'running':
      return <Muted>… {state.since + seconds} s</Muted>
    case 'failed':
      return <Muted>failed</Muted>
    case 'off':
      return <Muted>off</Muted>
    case 'other-block':
      return <Muted>other block</Muted>
    case 'verdict':
      return <span className="text-gray-500">{state.text}</span>
  }
}

function stateDetail(state: SourceState, block: number): string {
  switch (state.kind) {
    case 'same':
      return `Same result at block ${blockText(block)}.`
    case 'differs':
      return `${count(state.count, 'other value')} at the same block.`
    case 'running':
      return 'No answer yet. The review does not wait.'
    case 'failed':
      return `Failed: ${state.reason}.`
    case 'off':
      return 'Off. Add your key in the settings.'
    case 'other-block':
      return `Answered for block ${blockText(state.block)}, so not compared.`
    case 'verdict':
      return `Verdict only: ${state.text}. No state diff to compare.`
  }
}

function chipClass(state: SourceState): string {
  if (state.kind === 'differs') return 'border-amber-300 bg-amber-50 hover:border-amber-400'
  if (state.kind === 'off') return 'border-gray-200 opacity-50 hover:opacity-80'
  return 'border-gray-200 bg-white hover:border-cerulean-blue-300 hover:bg-cerulean-blue-100'
}

/** a simulator in the row; a click opens its answer */
function SourceChip({ source, block, seconds }: { source: CrossSource; block: number; seconds: number }) {
  return (
    <Popover
      label={source.name}
      align="left"
      trigger={
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-1.5 transition-colors ${chipClass(source.state)}`}
        >
          <ServiceIcon src={source.icon} />
          <span className="text-gray-700">{source.name}</span>
          {stateText(source.state, seconds)}
          <span aria-hidden className="text-[10px] text-gray-400">
            ▾
          </span>
        </span>
      }
    >
      <SourceDetail source={source} block={block} />
    </Popover>
  )
}

function SourceDetail({ source, block }: { source: CrossSource; block: number }) {
  const off = source.state.kind === 'off'
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5">
        <ServiceIcon src={source.icon} />
        <span className="font-medium text-gray-800">{source.name}</span>
        <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" title="Not checked by Onay" />
        <span className="ml-auto text-gray-400">{source.via}</span>
      </p>
      <p className={source.state.kind === 'differs' ? 'font-medium text-amber-800' : 'text-gray-700'}>
        {stateDetail(source.state, block)}
      </p>
      {source.compared && !off && <p className="text-gray-400">Compares {source.compared}.</p>}
      {source.received && <p className="text-gray-400">Receives {source.received}.</p>}
      {source.link && !off && (
        <a href={source.link.url} target="_blank" rel="noreferrer" className="text-cerulean-blue-600 hover:underline">
          {source.link.text}
        </a>
      )}
      <p className="mt-1 border-t border-gray-100 pt-2 text-gray-500">
        Its answer is a claim. Only the local run is verified.
      </p>
    </div>
  )
}

/* events */

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

/* the card */

function EffectsCard({ effects, you, helios }: { effects: Effects; you: string; helios: boolean }) {
  const seconds = useSeconds()
  const [raw, setRaw] = useState(false)
  const age = (FIRST_AGE + seconds) % BLOCK_TIME
  const reruns = Math.floor((FIRST_AGE + seconds) / BLOCK_TIME)
  const ctx: Ctx = {
    labels: effects.labels,
    tokens: effects.tokens ?? {},
    icons: Object.fromEntries(effects.sources.map((s) => [s.name, s.icon])),
    raw,
  }
  const { yours, others } = split(effects.storage, you)
  const yourBalance = effects.balances.find((b) => b.address === you)
  const otherBalances = effects.balances.filter((b) => b.address !== you)
  const otherSlots = others.reduce((n, c) => n + c.rows.length, 0)
  const otherCount = [
    others.length > 0 && count(others.length, 'contract'),
    otherSlots > 0 && count(otherSlots, 'slot'),
    otherBalances.length > 0 && count(otherBalances.length, 'ETH balance'),
  ].filter(Boolean)
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <p className={`flex items-center gap-2 text-sm font-medium ${helios ? 'text-green-700' : 'text-amber-700'}`}>
          {helios && <LocallyVerifiedIcon className="h-4 w-4 shrink-0" title="Checked on this machine" />}
          Simulated on {helios ? 'verified' : 'unverified'} state
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <p
            className="font-mono text-xs text-gray-400"
            title={reruns === 0 ? 'Runs again at each new block' : `${reruns + 1} runs, the same result each time`}
          >
            block {blockText(effects.block + reruns)} · {age} s ago
          </p>
          <ViewSwitch raw={raw} onChange={setRaw} />
        </div>
      </div>

      {effects.notice && (
        <div className="mt-3 flex gap-2.5 rounded-lg bg-amber-50 px-3 py-2.5 ring-1 ring-amber-300">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-900">{effects.notice.title}</p>
            <p className="text-xs text-amber-900/80">{effects.notice.text}</p>
          </div>
        </div>
      )}

      <div className="pt-1" />
      {yourBalance && <BalanceRow change={yourBalance} labels={effects.labels} />}
      {yours.map((contract) => (
        <ContractView key={contract.address} contract={contract} yours ctx={ctx} />
      ))}
      {!yourBalance && yours.length === 0 && (
        <p className="pt-2 text-sm text-gray-500">Nothing that names your address changes.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-gray-100 pt-3 text-xs">
        <Muted>Other simulators</Muted>
        {effects.sources.map((source) => (
          <SourceChip key={source.name} source={source} block={effects.block} seconds={seconds} />
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {otherCount.length > 0 && (
          <Disclosure
            label={
              <>
                Other changes <Muted>· {otherCount.join(' · ')}</Muted>
              </>
            }
          >
            {otherBalances.map((change) => (
              <BalanceRow key={change.address} change={change} labels={effects.labels} />
            ))}
            {others.map((contract) => (
              <ContractView key={contract.address} contract={contract} yours={false} ctx={ctx} />
            ))}
            {effects.restored.length > 0 && (
              <div className="pt-3 font-mono text-[11px] text-gray-400">
                <p className="font-sans text-xs text-gray-500">Written, then set back</p>
                {effects.restored.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </Disclosure>
        )}
        <Disclosure
          label={
            <>
              Events <Muted>· {effects.events.length}</Muted>
            </>
          }
        >
          <Events events={effects.events} you={you} labels={effects.labels} />
        </Disclosure>
      </div>
    </div>
  )
}

const youOf = (request: MockRequest) => (request.raw.find((field) => field.name === 'from')?.value ?? '').toLowerCase()

/** the card alone, for the page that shows only the simulation */
export function SimulationCard({ request }: { request: MockRequest }) {
  if (!request.effects) return null
  return <EffectsCard effects={request.effects} you={youOf(request)} helios={request.chainMode === 'helios'} />
}

export function SimulationStep({ request }: { request: MockRequest }) {
  return (
    <Step
      number={2}
      title="Transaction Simulation"
      explainer="Onay runs the transaction in a local EVM on the verified state of step 1, and shows each change by its variable name. Other simulators give a second opinion."
    >
      {request.effects ? (
        <SimulationCard request={request} />
      ) : (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-500 shadow-sm">
          No simulation mock for this scenario. Try swap, swap · simulators disagree, approve, or NFT transfer.
        </p>
      )}
    </Step>
  )
}
