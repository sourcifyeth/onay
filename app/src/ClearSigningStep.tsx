// Step 3 of the review: what the request asks to sign, in words. An
// ERC-7730 descriptor renders the intent and the fields; one that no
// trusted auditor attested shows as a preview with a warning. A second
// tab shows the calldata as the verified ABI (Application Binary
// Interface) decodes it, and a third the raw request. Taken from the
// mock's transaction card.

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { DisplayField, DisplayFieldGroup, DisplayModel, Warning } from '@ethereum-sourcify/clear-signing'
import { isFieldGroup } from '@ethereum-sourcify/clear-signing'
import { chainById } from './chains.ts'
import type { Decoded } from './clear-signing/decode.ts'
import { REGISTRY_URL } from './clear-signing/registry.ts'
import {
  formatAmount,
  reasonOf,
  rendered,
  type Call,
  type DescriptorSource,
  type Rendering,
} from './clear-signing/render.ts'
import { chainInfoOf, clearSigningFor, type ClearSigning } from './clear-signing/store.ts'
import { ExternalLink } from './ExternalLink.tsx'
import { ThirdPartyIcon } from './Icons.tsx'
import type { Verification } from './gates/verification.ts'
import { CollapsibleLog, Cursor } from './Log.tsx'
import type { Hex, SigningRequest } from './messages.ts'
import { Step } from './Step.tsx'
import { Tabs } from './Tabs.tsx'

// The native currency of the chain, for the amounts of the request.
type Currency = { symbol: string; decimals: number } | null

function amountText(value: bigint | null, currency: Currency): string {
  if (value === null) return 'not a quantity'
  if (!currency) return `${value.toString()} in the smallest unit`
  return `${formatAmount(value, currency.decimals)} ${currency.symbol}`
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-cerulean-blue-100 px-2.5 py-0.5 text-sm font-medium text-cerulean-blue-700">
      {children}
    </span>
  )
}

function Notice({ tone, children }: { tone: 'amber' | 'gray'; children: ReactNode }) {
  const color =
    tone === 'amber' ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-300 bg-gray-50 text-gray-600'
  return <p className={`rounded-lg border-l-2 px-3 py-2 text-xs leading-relaxed ${color}`}>{children}</p>
}

// The intent of a descriptor: a sentence, or labels with values.
function intentText(intent: DisplayModel['intent']): string {
  if (typeof intent === 'string') return intent
  if (!intent) return ''
  return Object.entries(intent)
    .map(([label, value]) => `${label}: ${value}`)
    .join(' · ')
}

// The values of each field, for the bold parts of the sentence.
function valuesOf(fields: DisplayModel['fields']): string[] {
  const values: string[] = []
  for (const item of fields ?? []) {
    if (isFieldGroup(item)) values.push(...valuesOf(item.fields))
    else if (item.value !== '') values.push(item.value)
  }
  return values
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The sentence with the field values in bold, as the first row.
function Interpolated({ text, values }: { text: string; values: string[] }) {
  const sorted = [...new Set(values)].sort((a, b) => b.length - a.length)
  const parts = sorted.length === 0 ? [text] : text.split(new RegExp(`(${sorted.map(escape).join('|')})`))
  return (
    <p className="rounded-lg bg-cerulean-blue-100/50 px-4 py-3 text-[15px] leading-relaxed text-gray-700">
      {parts.map((part, index) =>
        sorted.includes(part) ? (
          <strong key={index} className="font-semibold text-gray-900">
            {part}
          </strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  )
}

// A label on the left and a value on the right, as the wallets show it.
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  )
}

function Details({ open, onToggle, label = 'details' }: { open: boolean; onToggle: () => void; label?: string }) {
  return (
    <button onClick={onToggle} className="font-mono text-xs text-gray-400 transition-colors hover:text-gray-600">
      {open ? `hide ${label} ▴` : `${label} ▾`}
    </button>
  )
}

function IntentToggle({ pill, open, onToggle }: { pill: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <p className="flex items-center justify-between gap-4 pb-2">
      <span className="min-w-0">{pill}</span>
      <button
        onClick={onToggle}
        className="shrink-0 font-mono text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {open ? 'hide intent ▴' : 'show intent ▾'}
      </button>
    </p>
  )
}

// A warning of one field. An address without a name is no warning: the
// address shows as it is.
function FieldWarning({ warning }: { warning: Warning | undefined }) {
  if (!warning || warning.code === 'UNKNOWN_ADDRESS') return null
  return <p className="pt-0.5 text-right text-xs text-amber-700">⚠ {warning.message}</p>
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// A value with a tooltip that shows what is behind it. A click copies
// the tooltip's text.
function Hint({
  what,
  text,
  className,
  children,
}: {
  what: string
  text: string
  className: string
  children: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!(await copyText(text))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <span className="group/hint relative inline-block">
      <button
        onClick={copy}
        className={`cursor-copy text-left underline decoration-gray-300 decoration-dotted underline-offset-4 ${className}`}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 bottom-full z-20 mb-1.5 w-max max-w-[22rem] rounded-md bg-gray-800 px-2.5 py-1.5 text-left font-mono text-[11px] leading-relaxed break-all whitespace-normal text-white opacity-0 shadow-lg transition-opacity group-hover/hint:visible group-hover/hint:opacity-100"
      >
        <span className="block text-gray-400">{copied ? 'copied' : `${what} · click to copy`}</span>
        {text}
      </span>
    </span>
  )
}

function FieldValue({ field }: { field: DisplayField }) {
  const value = field.value
  if (field.fieldType === 'bytes') {
    return (
      <Hint what="bytes" text={value} className="font-mono text-xs break-all text-gray-700">
        {value.length > 66 ? `${value.slice(0, 34)}…${value.slice(-30)}` : value}
      </Hint>
    )
  }
  if (field.fieldType === 'address') {
    const named = field.rawAddress !== undefined && field.rawAddress !== value
    return (
      <Hint
        what={named ? 'address behind the name' : 'address'}
        text={field.rawAddress ?? value}
        className={`text-sm font-medium text-gray-800 ${named ? '' : 'font-mono text-[13px] break-all'}`}
      >
        {value}
      </Hint>
    )
  }
  if (field.rawEncryptedValue && field.warning?.code === 'DECRYPTION_FAILED') {
    return (
      <Hint what="encrypted value" text={field.rawEncryptedValue} className="text-sm font-medium text-gray-800">
        {value}
      </Hint>
    )
  }
  if (field.tokenAddress) {
    return (
      <Hint what="token contract" text={field.tokenAddress} className="text-sm font-medium text-gray-800">
        {value}
      </Hint>
    )
  }
  return <span className="text-sm font-medium text-gray-800">{value}</span>
}

// A call inside a call: the field holds calldata for another contract.
// The intent shows in the row; the fields open on request.
function Embedded({ field }: { field: DisplayField }) {
  const [open, setOpen] = useState(false)
  const embedded = field.embeddedCalldata!
  const { display, callee } = embedded
  const chain = embedded.chainId !== undefined ? ` on chain ${embedded.chainId}` : ''
  const target = `${display.metadata?.contractName ?? 'contract'}${callee ? ` ${short(callee)}` : ''}${chain}`
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-6">
        <dt className="shrink-0 text-sm text-gray-500">
          {field.label}
          <span className="ml-2 rounded-full border border-cerulean-blue-200 px-2 py-0.5 text-xs text-cerulean-blue-700">
            embedded call
          </span>
        </dt>
        <dd className="min-w-0 text-right">
          {rendered(display) ? (
            <span className="text-sm font-medium text-gray-800">
              {display.interpolatedIntent ?? intentText(display.intent)}
            </span>
          ) : (
            <span className="text-sm text-amber-700">no descriptor for this call</span>
          )}
          <span className="block text-xs text-gray-400">→ {target}</span>
          <FieldWarning warning={field.warning} />
          <span className="block pt-1">
            <Details open={open} onToggle={() => setOpen((v) => !v)} />
          </span>
        </dd>
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-gray-200 px-3 py-1">
          {rendered(display) ? (
            <dl className="divide-y divide-gray-100">
              <Row label="Intent">
                <span className="text-sm font-semibold text-gray-900">{intentText(display.intent)}</span>
              </Row>
              <FieldRows fields={display.fields} />
            </dl>
          ) : (
            <p className="py-2 font-mono text-xs break-all text-gray-500">{field.value}</p>
          )}
        </div>
      )}
    </div>
  )
}

function FieldRow({ field }: { field: DisplayField }) {
  if (field.embeddedCalldata) return <Embedded field={field} />
  return (
    <div className="py-2.5">
      {field.separator && <p className="pb-1 font-mono text-xs text-gray-500">{field.separator}</p>}
      <div className="flex items-baseline justify-between gap-6">
        <dt className="shrink-0 text-sm text-gray-500">{field.label}</dt>
        <dd className="min-w-0 text-right">
          <FieldValue field={field} />
          <FieldWarning warning={field.warning} />
        </dd>
      </div>
    </div>
  )
}

function FieldGroupView({ group }: { group: DisplayFieldGroup }) {
  const empty = group.warning?.code === 'EMPTY_ARRAY'
  return (
    <div className="py-2.5">
      {group.label && <p className="pb-1 text-sm font-medium text-gray-700">{group.label}</p>}
      {empty ? (
        <p className="text-xs text-gray-400">empty</p>
      ) : (
        <>
          <FieldWarning warning={group.warning} />
          <div className="border-l-2 border-gray-200 pl-3">
            <FieldList fields={group.fields} />
          </div>
        </>
      )}
    </div>
  )
}

function FieldRows({ fields }: { fields: DisplayModel['fields'] }) {
  return (fields ?? []).map((item, index) =>
    isFieldGroup(item) ? <FieldGroupView key={index} group={item} /> : <FieldRow key={index} field={item} />,
  )
}

function FieldList({ fields }: { fields: DisplayModel['fields'] }) {
  if (!fields || fields.length === 0) return null
  return (
    <dl className="divide-y divide-gray-100">
      <FieldRows fields={fields} />
    </dl>
  )
}

function Warnings({ warnings }: { warnings: Warning[] | undefined }) {
  const shown = warnings?.filter((warning) => warning.code !== 'UNKNOWN_ADDRESS') ?? []
  if (shown.length === 0) return null
  return (
    <div className="flex flex-col gap-2 pt-3">
      {shown.map((warning) => (
        <Notice key={warning.code + warning.message} tone="amber">
          {warning.message}
        </Notice>
      ))}
    </div>
  )
}

function Provenance({
  source,
  display,
  attested,
}: {
  source: DescriptorSource | null
  display: DisplayModel
  attested: boolean
}) {
  const owner = display.metadata?.owner
  if (source?.kind === 'template') {
    return (
      <p className="flex items-start gap-1.5 pt-3 font-mono text-[11px] leading-relaxed text-gray-400">
        <ThirdPartyIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" title="From a third party, not checked here" />
        <span>
          standard ERC-20 template · listed as a token by {source.lists.join(', ')}, a claim of the list, not checked
          here · the name and symbol of the token are its own claims, read from the chain
        </span>
      </p>
    )
  }
  const path = source?.kind === 'registry' ? source.path : null
  return (
    <p className="pt-3 font-mono text-[11px] leading-relaxed text-gray-400">
      <ExternalLink
        href={path ? `${REGISTRY_URL}/blob/master/${path}` : REGISTRY_URL}
        className="hover:text-cerulean-blue-600"
      >
        ERC-7730 descriptor{owner ? ` by ${owner}` : ''} from the registry ·{' '}
        {attested ? 'attested by an auditor you trust' : 'not attested by an auditor you trust'} ↗
      </ExternalLink>
    </p>
  )
}

// A descriptor that no trusted auditor attested rendered the data.
function Unattested({ state }: { state: ClearSigning }) {
  return (
    <Notice tone="amber">
      {state.attesters.length === 0
        ? 'Preview: you trust no auditor yet, so no one has checked this description for you. Anyone can submit a descriptor to the registry. Choose auditors under settings → Clear Signing.'
        : 'Preview: no auditor you trust has attested this descriptor, so no one has checked this description for you. Anyone can submit a descriptor to the registry.'}
    </Notice>
  )
}

// What else the descriptor says about the contract.
function MetadataRows({ display }: { display: DisplayModel }) {
  const { owner, info } = display.metadata ?? {}
  return (
    <>
      {owner && (
        <Row label="Owner">
          <span className="text-sm text-gray-800">{owner}</span>
        </Row>
      )}
      {info?.url && (
        <Row label="Website">
          <span className="font-mono text-[13px] break-all text-gray-800">{info.url}</span>
        </Row>
      )}
      {info?.deploymentDate && (
        <Row label="Deployed">
          <span className="text-sm text-gray-800">{info.deploymentDate}</span>
        </Row>
      )}
    </>
  )
}

// A descriptor rendered the data: intent, sentence, fields.
function DisplayPane({
  display,
  source,
  attested,
  state,
}: {
  display: DisplayModel
  source: DescriptorSource | null
  attested: boolean
  state: ClearSigning
}) {
  const [open, setOpen] = useState(false)
  // The template has no metadata: the name is the token's own, from the
  // chain.
  const contractName = display.metadata?.contractName ?? (source?.kind === 'template' ? source.name : undefined)
  const owner = display.metadata?.owner
  const intent = intentText(display.intent)
  const sentence = display.interpolatedIntent
  // Without a sentence the fields are the intent, so they show at once.
  const fields = sentence ? open : true
  return (
    <div>
      {!attested && (
        <div className="pb-3">
          <Unattested state={state} />
        </div>
      )}
      <p className="pb-2 text-sm leading-relaxed text-gray-600">
        {contractName ? (
          <>
            Interacting with <span className="font-medium text-gray-800">{contractName}</span>
            {owner && (
              <>
                {' '}
                by <span className="font-medium text-gray-800">{owner}</span>
              </>
            )}
          </>
        ) : (
          'The descriptor does not name the contract.'
        )}
      </p>
      <Interpolated text={sentence ?? intent} values={sentence ? valuesOf(display.fields) : []} />
      {sentence && (
        <p className="pt-2">
          <Details open={open} onToggle={() => setOpen((v) => !v)} />
        </p>
      )}
      {fields && (
        <dl className="mt-2 divide-y divide-gray-100 border-t border-gray-100 px-4">
          {sentence && (
            <Row label="Intent">
              <span className="text-sm font-semibold text-gray-900">{intent}</span>
            </Row>
          )}
          <FieldRows fields={display.fields} />
          <MetadataRows display={display} />
        </dl>
      )}
      <Warnings warnings={display.warnings} />
      <Provenance source={source} display={display} attested={attested} />
    </div>
  )
}

// Why no descriptor rendered the data.
function notRenderedText(display: DisplayModel, state: ClearSigning): string {
  const reason = reasonOf(display)
  switch (reason?.code) {
    case 'NO_DESCRIPTOR':
      return state.registryError
        ? `The index of the registry could not be fetched (${state.registryError}), so no descriptor was looked up.`
        : 'No ERC-7730 descriptor is registered for this contract, so there is no reviewed description of what this call does.'
    case 'NO_TRUSTED_ATTESTATION':
      // The preview failed too, so the descriptor cannot render this call.
      return 'The registry has a descriptor for this contract, but it does not render this call.'
    case 'DESCRIPTOR_FETCH_ERROR':
      return `The registry could not be reached, so no descriptor was checked. ${reason.message}`
    default:
      return reason?.message ?? 'The descriptor did not render this call.'
  }
}

function NotRendered({ display, state }: { display: DisplayModel; state: ClearSigning }) {
  return <Notice tone="amber">{notRenderedText(display, state)}</Notice>
}

function RawWords({ display }: { display: DisplayModel }) {
  const fallback = display.rawCalldataFallback
  if (!fallback) return null
  return (
    <dl className="mt-3 divide-y divide-gray-100">
      <div className="flex items-baseline justify-between gap-6 py-1">
        <dt className="shrink-0 font-mono text-sm text-gray-500">selector</dt>
        <dd className="text-right font-mono text-sm text-gray-800">{fallback.selector}</dd>
      </div>
      {fallback.args.map((word, index) => (
        <div key={index} className="flex items-baseline justify-between gap-6 py-1">
          <dt className="shrink-0 font-mono text-sm text-gray-500">word {index}</dt>
          <dd className="text-right font-mono text-xs break-all text-gray-800">{word}</dd>
        </div>
      ))}
    </dl>
  )
}

const ABI_SOURCE =
  'The ABI (Application Binary Interface) comes from the source code verified in step 2: fetched from sourcify.dev, compiled on this machine, and matched to the code on the chain.'

// The calldata as the verified ABI decodes it, with the reason why no
// descriptor rendered it.
function CallDecoded({ call, state }: { call: Call; state: ClearSigning }) {
  const { display, decoded } = call
  if (call.data === '0x') return <Notice tone="gray">A plain value transfer: no calldata, nothing to decode.</Notice>
  if (call.to === null) return <Creation />
  const why = display && !rendered(display) ? notRenderedText(display, state) : null
  if (!decoded) {
    return (
      <div className="flex flex-col gap-2">
        <Notice tone="amber">
          {why && `${why} `}The source code of the contract is not verified, so the calldata cannot be decoded. It shows
          raw.
        </Notice>
        {display && <RawWords display={display} />}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {why ? (
        <Notice tone="amber">
          {why} The call is decoded with the verified ABI instead. The function and parameter names come from the ABI,
          not from a Clear Signing descriptor. {ABI_SOURCE}
        </Notice>
      ) : (
        <Notice tone="gray">
          The function and parameter names come from the ABI, not from the Clear Signing descriptor. {ABI_SOURCE}
        </Notice>
      )}
      <DecodedBlock decoded={decoded} />
    </div>
  )
}

function Creation() {
  return (
    <Notice tone="amber">
      This transaction creates a contract: the calldata is its creation code. Nothing describes what the code does.
    </Notice>
  )
}

// A transfer of the native currency: no calldata, nothing to decode.
function Transfer({ call, currency }: { call: Call; currency: Currency }) {
  const amount = amountText(call.value, currency)
  const to = call.to ?? 'a new contract'
  return (
    <div>
      <Interpolated text={`Send ${amount} to ${to}`} values={[amount, to]} />
      <dl className="mt-2 divide-y divide-gray-100">
        <Row label="Amount">
          <span className="text-sm font-medium text-gray-800">{amount}</span>
        </Row>
        <Row label="To">
          {call.to ? (
            <Hint what="address" text={call.to} className="font-mono text-[13px] font-medium break-all text-gray-800">
              {call.to}
            </Hint>
          ) : (
            <span className="text-sm font-medium text-gray-800">{to}</span>
          )}
        </Row>
      </dl>
      <p className="pt-3 font-mono text-[11px] leading-relaxed text-gray-400">
        plain value transfer · no calldata · rendered by Onay
      </p>
    </div>
  )
}

function CallPane({ call, currency, state }: { call: Call; currency: Currency; state: ClearSigning }) {
  if (call.data === '0x') return <Transfer call={call} currency={currency} />
  if (call.to === null) return <Creation />
  if (rendered(call.display)) {
    return <DisplayPane display={call.display!} source={call.source} attested={call.attested} state={state} />
  }
  // A call of a batch that no descriptor rendered. The decoding is in
  // the ABI tab.
  return <CallDecoded call={call} state={state} />
}

function BatchPane({
  rendering,
  currency,
  state,
}: {
  rendering: Rendering & { kind: 'batch' }
  currency: Currency
  state: ClearSigning
}) {
  const [showIntent, setShowIntent] = useState(false)
  const values = rendering.calls.flatMap((call) => valuesOf(call.display?.fields))
  return (
    <div>
      <IntentToggle
        pill={<Pill>Batch · {rendering.calls.length} calls</Pill>}
        open={showIntent}
        onToggle={() => setShowIntent((v) => !v)}
      />
      {showIntent &&
        (rendering.intent ? (
          <div className="pb-3">
            <Interpolated text={rendering.intent} values={values} />
          </div>
        ) : (
          <Notice tone="gray">Not every call has a reviewed sentence, so there is none for the batch.</Notice>
        ))}
      <div className="flex flex-col gap-2">
        {rendering.calls.map((call, index) => (
          <div key={index} className="rounded-lg border border-gray-200 p-3">
            <p className="pb-1 font-mono text-xs text-gray-400">
              call {index + 1} · {call.to ?? 'a new contract'}
            </p>
            <CallPane call={call} currency={currency} state={state} />
          </div>
        ))}
      </div>
    </div>
  )
}

// A value of a typed-data message, as a tree.
function MessageTree({ value }: { value: unknown }) {
  if (typeof value !== 'object' || value === null) {
    return <span className="font-mono text-sm break-all text-gray-800">{String(value)}</span>
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value)
  return (
    <dl className="divide-y divide-gray-100">
      {entries.map(([key, item]) => (
        <div key={key} className="py-1">
          {typeof item === 'object' && item !== null ? (
            <>
              <dt className="font-mono text-sm text-gray-500">{key}</dt>
              <dd className="border-l-2 border-gray-200 pl-3">
                <MessageTree value={item} />
              </dd>
            </>
          ) : (
            <div className="flex items-baseline justify-between gap-6">
              <dt className="shrink-0 font-mono text-sm text-gray-500">{key}</dt>
              <dd className="text-right">
                <MessageTree value={item} />
              </dd>
            </div>
          )}
        </div>
      ))}
    </dl>
  )
}

function TypedDataPane({ rendering, state }: { rendering: Rendering & { kind: 'typedData' }; state: ClearSigning }) {
  if (rendered(rendering.display)) {
    return (
      <DisplayPane display={rendering.display} source={rendering.source} attested={rendering.attested} state={state} />
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <NotRendered display={rendering.display} state={state} />
      <Notice tone="gray">
        The message below shows as the site sent it. The names come from the site, not from a reviewed descriptor. Its
        type is <span className="font-mono">{rendering.typed.primaryType}</span>.
      </Notice>
      <MessageTree value={rendering.typed.message} />
    </div>
  )
}

function ClearSigningPane({ state, currency }: { state: ClearSigning; currency: Currency }) {
  const { rendering } = state
  if (state.status === 'running') {
    return (
      <p className="font-mono text-xs text-gray-500">
        rendering <Cursor />
      </p>
    )
  }
  if (!rendering) return <Notice tone="amber">The rendering failed. The log below says why.</Notice>
  switch (rendering.kind) {
    case 'transaction':
      return <CallPane call={rendering.call} currency={currency} state={state} />
    case 'batch':
      return <BatchPane rendering={rendering} currency={currency} state={state} />
    case 'typedData':
      return <TypedDataPane rendering={rendering} state={state} />
    case 'none':
      return <Notice tone="gray">Nothing to render: {rendering.reason}.</Notice>
  }
}

function RawRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5 font-mono text-xs">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="text-right break-all text-gray-800">{children}</dd>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="pt-3 pb-1 font-mono text-xs text-gray-500">{children}</p>
}

function CalldataBlock({ data }: { data: Hex }) {
  return (
    <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed break-all text-gray-700">
      {data === '0x' ? '0x (empty)' : data}
    </p>
  )
}

function DecodedBlock({ decoded }: { decoded: Decoded }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <dl className="divide-y divide-gray-200/70">
        <div className="pb-1.5 font-mono text-xs">
          <dt className="text-gray-500">function</dt>
          <dd className="pt-0.5 break-all text-gray-800">
            <span className="font-medium">{decoded.name}</span>
            <span className="text-gray-400"> · </span>
            <ExternalLink
              href={`https://4byte.sourcify.dev/?q=${decoded.selector}`}
              title="Look up this selector on 4byte.sourcify.dev"
              className="text-cerulean-blue-600 hover:underline"
            >
              {decoded.selector} ↗
            </ExternalLink>
          </dd>
        </div>
        {decoded.params.length === 0 && <p className="pt-1.5 font-mono text-xs text-gray-500">no parameters</p>}
        {decoded.params.map((param, index) => (
          <div key={index} className="py-1.5 font-mono text-xs">
            <dt className="text-gray-500">
              {param.name} <span className="text-gray-400">{param.type}</span>
            </dt>
            <dd className="pt-0.5 break-all text-gray-800">{param.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function DecodedPane({ state }: { state: ClearSigning }) {
  const { rendering } = state
  if (state.status === 'running') {
    return (
      <p className="font-mono text-xs text-gray-500">
        rendering <Cursor />
      </p>
    )
  }
  if (!rendering || rendering.kind === 'none' || rendering.kind === 'typedData') {
    return <Notice tone="gray">Nothing to decode.</Notice>
  }
  if (rendering.kind === 'transaction') return <CallDecoded call={rendering.call} state={state} />
  return (
    <div className="flex flex-col gap-2">
      {rendering.calls.map((call, index) => (
        <div key={index} className="rounded-lg border border-gray-200 p-3">
          <p className="pb-1 font-mono text-xs text-gray-400">
            call {index + 1} · {call.to ?? 'a new contract'}
          </p>
          <CallDecoded call={call} state={state} />
        </div>
      ))}
    </div>
  )
}

function CallRaw({ call, currency }: { call: Call; currency: Currency }) {
  return (
    <>
      <dl className="divide-y divide-gray-100">
        <RawRow label="to">{call.to ?? 'none · creates a contract'}</RawRow>
        <RawRow label="value">{amountText(call.value, currency)}</RawRow>
      </dl>
      <SectionLabel>calldata</SectionLabel>
      <CalldataBlock data={call.data} />
    </>
  )
}

function RawPane({ state, chainId, currency }: { state: ClearSigning; chainId: number; currency: Currency }) {
  const { rendering } = state
  if (!rendering || rendering.kind === 'none') return <Notice tone="gray">Nothing to show.</Notice>
  switch (rendering.kind) {
    case 'transaction':
      return (
        <div>
          <dl className="divide-y divide-gray-100">
            <RawRow label="chainId">{chainId}</RawRow>
            <RawRow label="from">{rendering.from ?? 'not given'}</RawRow>
          </dl>
          <CallRaw call={rendering.call} currency={currency} />
        </div>
      )
    case 'batch':
      return (
        <div>
          <dl className="divide-y divide-gray-100">
            <RawRow label="chainId">{chainId}</RawRow>
            <RawRow label="from">{rendering.from ?? 'not given'}</RawRow>
            <RawRow label="calls">{rendering.calls.length}</RawRow>
          </dl>
          {rendering.calls.map((call, index) => (
            <div key={index}>
              <SectionLabel>call {index + 1}</SectionLabel>
              <div className="rounded-lg border border-gray-200 p-3">
                <CallRaw call={call} currency={currency} />
              </div>
            </div>
          ))}
        </div>
      )
    case 'typedData': {
      const { account, ...typed } = rendering.typed
      return (
        <div>
          <dl className="divide-y divide-gray-100">
            <RawRow label="signer">{account}</RawRow>
            <RawRow label="verifying contract">{String(typed.domain.verifyingContract ?? 'none')}</RawRow>
            <RawRow label="chainId">{String(typed.domain.chainId ?? 'none')}</RawRow>
            <RawRow label="primaryType">{typed.primaryType}</RawRow>
          </dl>
          <SectionLabel>typed data</SectionLabel>
          <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
            {JSON.stringify(typed, null, 2)}
          </pre>
        </div>
      )
    }
  }
}

type Tab = { label: string; content: ReactNode }

// The clear-signing tab shows only when a descriptor rendered at least
// one call, or until the rendering is done. The ABI tab shows for every
// transaction, the raw tab always.
function tabsOf(state: ClearSigning, chainId: number, currency: Currency): Tab[] {
  const { rendering } = state
  const clear = { label: 'Clear Signing', content: <ClearSigningPane state={state} currency={currency} /> }
  const raw = { label: 'Raw', content: <RawPane state={state} chainId={chainId} currency={currency} /> }
  if (state.status === 'running' || !rendering || rendering.kind === 'none') return [clear, raw]
  if (rendering.kind === 'typedData') {
    return [{ ...clear, label: rendered(rendering.display) ? 'Clear Signing' : 'Message' }, raw]
  }
  const calls = rendering.kind === 'batch' ? rendering.calls : [rendering.call]
  const withData = calls.filter((call) => call.to !== null && call.data !== '0x')
  const decoded = {
    label: withData.some((call) => call.decoded) || withData.length === 0 ? 'ABI-Decoded' : 'Not decoded',
    content: <DecodedPane state={state} />,
  }
  const anyRendered = withData.length === 0 || withData.some((call) => rendered(call.display))
  return anyRendered ? [clear, decoded, raw] : [decoded, raw]
}

const EXPLAINER =
  'An ERC-7730 descriptor explains a call in plain words: what it does, and what each value means. A descriptor counts as reviewed only after an auditor you trust attested it; one that none did shows as a preview with a warning, since a wrong description can hide what you sign. The ABI-Decoded tab shows the call as the verified source code decodes it, with or without a descriptor.'

export function ClearSigningStep({ request, verification }: { request: SigningRequest; verification: Verification }) {
  const store = clearSigningFor(request, verification)
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const chainId = verification.chainId ?? 0
  const currency = chainInfoOf(chainById(chainId))?.nativeCurrency ?? null
  return (
    <Step number={3} title="Clear Signing" explainer={EXPLAINER}>
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <Tabs tabs={tabsOf(state, chainId, currency)} />
        <div className="pt-3">
          <CollapsibleLog lines={state.lines} />
        </div>
      </section>
    </Step>
  )
}
