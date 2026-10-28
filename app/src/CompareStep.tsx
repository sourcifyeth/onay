// The last step of the review: the values to find in the wallet before
// you confirm there. A page can show Onay one request and the wallet
// another, and a value that differs gives it away. The ERC-8213 digest
// stands for the data; the fields around it are what it does not cover.

import { Fragment, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { hexlify } from 'ethers'
import { chainById, chainName } from './chains.ts'
import { formatAmount } from './clear-signing/render.ts'
import { chainInfoOf, clearSigningFor } from './clear-signing/store.ts'
import { fieldsOf, type CallFields, type Delegation, type Fields } from './compare/fields.ts'
import type { StepInfo, StepVerdict } from './gates/verdict.ts'
import type { Verification } from './gates/verification.ts'
import { LocallyVerifiedIcon } from './Icons.tsx'
import type { Hex, SigningRequest } from './messages.ts'
import { Hint, ListRow, Notice, Step } from './Step.tsx'

type Currency = { symbol: string; decimals: number } | null

const LIST = 'divide-y divide-gray-200/70'

function Address({ value }: { value: string }) {
  return (
    <Hint what="address" text={value} full className="font-mono text-[13px] font-medium break-all text-gray-800">
      {value}
    </Hint>
  )
}

function Chain({ chainId }: { chainId: number | null }) {
  if (chainId === null) return <span className="text-sm text-amber-700">unknown</span>
  return (
    <span className="text-sm font-medium text-gray-800">
      <span className="font-mono">{chainId}</span> · {chainName(chainId)}
    </span>
  )
}

// The digest in groups of four, for the eye. A line breaks only between
// groups. A click copies the plain string, as ERC-8213 has it.
function DigestValue({ value }: { value: Hex }) {
  const groups = value.slice(2).match(/.{1,4}/g) ?? []
  return (
    <p className="pt-1">
      <Hint what="digest" text={value} full className="font-mono text-xs leading-relaxed text-gray-800">
        0x
        {groups.map((group, index) => (
          <Fragment key={index}>
            <wbr />
            <span className="ml-[0.5em]">{group}</span>
          </Fragment>
        ))}
      </Hint>
    </p>
  )
}

// One ERC-8213 digest, as the mock shows it. `parts` are the hashes that
// make up the digest, which some wallets show in its place.
function DigestBox({
  label,
  value,
  children,
  parts = [],
}: {
  label: string
  value: Hex
  children: ReactNode
  parts?: { label: string; value: Hex }[]
}) {
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="font-mono text-xs text-gray-500">{label}</p>
      <DigestValue value={value} />
      <p className="pt-2 text-xs leading-relaxed text-gray-500">{children}</p>
      {parts.map((part) => (
        <div key={part.label} className="pt-3">
          <p className="font-mono text-xs text-gray-500">{part.label}</p>
          <DigestValue value={part.value} />
        </div>
      ))}
    </div>
  )
}

function valueText(value: bigint | null, currency: Currency): string {
  if (value === null) return 'not a quantity'
  if (!currency) return `${value.toString()} in the smallest unit`
  return `${formatAmount(value, currency.decimals)} ${currency.symbol}`
}

// The name of the function as the verified ABI decodes it, once the
// Clear Signing step has it.
function FunctionName({
  request,
  verification,
  index,
}: {
  request: SigningRequest
  verification: Verification
  index: number
}) {
  const store = clearSigningFor(request, verification)
  const { rendering } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const call =
    rendering?.kind === 'transaction' ? rendering.call : rendering?.kind === 'batch' ? rendering.calls[index] : null
  const name = call?.decoded?.name
  return name ? (
    <span className="font-medium" title="From the verified ABI">
      {name} ·{' '}
    </span>
  ) : null
}

// Many wallets show the calldata in full, so it opens here too.
function CalldataRow({
  call,
  index,
  request,
  verification,
}: {
  call: CallFields
  index: number
  request: SigningRequest
  verification: Verification
}) {
  const [open, setOpen] = useState(false)
  if (call.length === 0) {
    return (
      <ListRow label="Calldata">
        <span className="font-mono text-[13px] text-gray-800">none</span>
      </ListRow>
    )
  }
  return (
    <ListRow label="Calldata">
      <span className="font-mono text-[13px] text-gray-800">
        {call.selector && verification.chain && (
          <FunctionName request={request} verification={verification} index={index} />
        )}
        {call.selector && `${call.selector} · `}
        {call.length} bytes
      </span>
      <button
        onClick={() => setOpen((value) => !value)}
        className="ml-2 font-mono text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {open ? 'hide ▴' : 'show ▾'}
      </button>
      {open && (
        <span className="block pt-1.5 text-left">
          <Hint
            what="calldata"
            text={call.data}
            full
            className="block max-h-60 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed break-all text-gray-800"
          >
            {call.data}
          </Hint>
        </span>
      )}
    </ListRow>
  )
}

function CallRows({
  call,
  index,
  currency,
  request,
  verification,
}: {
  call: CallFields
  index: number
  currency: Currency
  request: SigningRequest
  verification: Verification
}) {
  return (
    <>
      <ListRow label="To">
        {call.to ? (
          <Address value={call.to} />
        ) : (
          <span className="text-sm text-gray-800">none · creates a contract</span>
        )}
      </ListRow>
      <ListRow label="Value">
        <span className="text-sm font-medium text-gray-800">{valueText(call.value, currency)}</span>
      </ListRow>
      <CalldataRow call={call} index={index} request={request} verification={verification} />
    </>
  )
}

function CalldataDigest({ call }: { call: CallFields }) {
  if (!call.digest) return null
  return (
    <DigestBox label="ERC-8213 Calldata Digest" value={call.digest}>
      If your wallet shows this digest, it must be the same. It covers only the calldata, so also compare the other
      fields.
    </DigestBox>
  )
}

function SignerRow({ signer }: { signer: string | null }) {
  return (
    <ListRow label="Signer">{signer ? <Address value={signer} /> : <span className="text-sm">not given</span>}</ListRow>
  )
}

function DelegationRow({ delegation }: { delegation: Delegation }) {
  const every = delegation.chainId === 0n
  const name = chainById(Number(delegation.chainId))?.name
  return (
    <ListRow
      label="Delegate to"
      note={
        every ? (
          <span className="text-amber-700">on every network (chain 0) · nonce {delegation.nonce.toString()}</span>
        ) : (
          `on network ${delegation.chainId}${name ? ` · ${name}` : ''} · nonce ${delegation.nonce}`
        )
      }
    >
      <Address value={delegation.address} />
    </ListRow>
  )
}

// A short note in the list. `Notice` in Step.tsx is the large box of a
// result.
function Callout({
  tone,
  className = '',
  children,
}: {
  tone: 'amber' | 'gray'
  className?: string
  children: ReactNode
}) {
  const colors =
    tone === 'amber' ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-300 bg-gray-50 text-gray-600'
  return <p className={`rounded-lg border-l-2 px-3 py-2 text-xs leading-relaxed ${colors} ${className}`}>{children}</p>
}

function FieldsView({
  fields,
  request,
  verification,
}: {
  fields: Fields
  request: SigningRequest
  verification: Verification
}) {
  const { chainId } = verification
  const currency = chainInfoOf(chainById(chainId ?? 0))?.nativeCurrency ?? null
  switch (fields.kind) {
    case 'transaction':
      return (
        <div>
          <dl className={LIST}>
            <ListRow label="Network">
              <Chain chainId={chainId} />
            </ListRow>
            <CallRows call={fields.call} index={0} currency={currency} request={request} verification={verification} />
          </dl>
          <CalldataDigest call={fields.call} />
          <dl className={`${LIST} pt-1`}>
            <SignerRow signer={fields.from} />
            {fields.delegations.map((delegation, index) => (
              <DelegationRow key={index} delegation={delegation} />
            ))}
          </dl>
        </div>
      )
    case 'batch':
      return (
        <div>
          <dl className={LIST}>
            <ListRow label="Network">
              <Chain chainId={chainId} />
            </ListRow>
            <SignerRow signer={fields.from} />
          </dl>
          <div className="flex flex-col gap-2 pt-2">
            {fields.calls.map((call, index) => (
              <div key={index} className="rounded-lg border border-gray-200 bg-white/70 p-3">
                <p className="font-mono text-xs text-gray-400">call {index + 1}</p>
                <dl className={LIST}>
                  <CallRows
                    call={call}
                    index={index}
                    currency={currency}
                    request={request}
                    verification={verification}
                  />
                </dl>
                <CalldataDigest call={call} />
              </div>
            ))}
            <Callout tone="gray">
              Your wallet can run the batch as one transaction whose calldata holds all the calls, for example through
              an EIP-7702 smart account or a Safe MultiSend. A device then shows the Calldata Digest of that
              transaction. The wallet builds it, so Onay cannot compute it. Compare each call where your wallet lists
              the calls.
            </Callout>
          </div>
        </div>
      )
    case 'typedData': {
      const { domain, digests } = fields
      return (
        <div>
          <dl className={LIST}>
            <ListRow label="Network">
              {domain.hasChain ? (
                <Chain chainId={domain.chainId} />
              ) : (
                <span className="text-sm text-amber-700">none · the signature holds on every chain</span>
              )}
            </ListRow>
            <ListRow label="Domain">
              <span className="text-sm font-medium text-gray-800">
                {domain.name ?? 'no name'}
                {domain.version !== null && <span className="text-gray-500"> · version {domain.version}</span>}
              </span>
            </ListRow>
            <ListRow label="Verifying contract">
              {domain.verifyingContract ? (
                <Address value={domain.verifyingContract} />
              ) : (
                <span className="text-sm">none</span>
              )}
            </ListRow>
            <ListRow label="Primary type">
              <span className="font-mono text-[13px] text-gray-800">{fields.primaryType}</span>
            </ListRow>
            <SignerRow signer={fields.signer} />
          </dl>
          {digests ? (
            <DigestBox
              label="EIP-712 Digest"
              value={digests.digest}
              parts={[
                { label: 'Domain Hash', value: digests.domainHash },
                { label: 'Message Hash', value: digests.messageHash },
              ]}
            >
              If your wallet shows this digest, it must be the same. A match proves that your wallet signs the same
              typed data. Some wallets show the two parts below instead. The Message Hash covers only the message: if
              your wallet shows only the Message Hash, also compare the Network, Domain, and Verifying contract rows.
            </DigestBox>
          ) : (
            <Callout tone="amber" className="mt-2">
              No digest: {fields.reason}.
            </Callout>
          )}
        </div>
      )
    }
    case 'message':
      return (
        <div>
          <p className="pt-1 pb-1 text-sm text-gray-500">Message</p>
          <MessageBlock>{fields.text ?? hexlify(fields.bytes)}</MessageBlock>
          {fields.hidden && (
            <>
              <p className="pt-2 pb-1 text-sm text-gray-500">As bytes</p>
              <MessageBlock>{hexlify(fields.bytes)}</MessageBlock>
            </>
          )}
          <div className="flex flex-col gap-2 pt-2">
            {fields.text === null && <Callout tone="gray">The message is not text, so it shows as hex.</Callout>}
            {fields.hidden && (
              <Callout tone="amber">
                The message has characters that do not show, or that change how the text shows, such as a zero-width
                space or a change of direction.{' '}
                {fields.digest
                  ? 'Compare the ERC-191 Digest, or the bytes, not the text.'
                  : 'Compare the bytes, not the text.'}
              </Callout>
            )}
            {fields.nonAscii && !fields.hidden && (
              <Callout tone="gray">
                The message has letters outside ASCII, which can look like other letters.
                {fields.digest && ' The ERC-191 Digest tells them apart.'}
              </Callout>
            )}
          </div>
          <dl className={`${LIST} pt-1`}>
            <SignerRow signer={fields.signer} />
          </dl>
          {fields.digest ? (
            <DigestBox label="ERC-191 Digest" value={fields.digest}>
              If your wallet shows this digest, it must be the same. A match proves that your wallet signs the same
              message.
            </DigestBox>
          ) : (
            <Callout tone="amber" className="mt-2">
              No digest: {fields.reason}.
            </Callout>
          )}
        </div>
      )
    case 'none':
      return <Callout tone="amber">Nothing to compare: {fields.reason}.</Callout>
  }
}

function MessageBlock({ children }: { children: string }) {
  return (
    <pre className="max-h-60 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-gray-800">
      {children}
    </pre>
  )
}

const EXPLAINER =
  'A page can show Onay one request and your wallet another. Find each value here on the confirmation screen of your wallet: one that differs gives the page away. MetaMask and Rabby show no digest. The case of hex letters does not matter. A click on an address or a digest copies it.'

// One line for each step: its number, its title, and the reason.
function verdictLine({ step, reason }: StepVerdict, steps: StepInfo[], verb: string | null): string {
  if (step === 'request') return `Onay could not check the request: ${reason}`
  const info = steps.find((candidate) => candidate.id === step)
  const name = info ? `Step ${info.number}, ${info.title}` : step
  const head = verb ? `${name}, ${verb}` : name
  return reason ? `${head}: ${reason}` : head
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

// What the steps before found: the steps that failed, else the ones that
// warn, else the ones that still run. Null when every step passed.
function Findings({ verdicts, steps }: { verdicts: StepVerdict[]; steps: StepInfo[] }) {
  const lines = (status: StepVerdict['status'], verb: string | null) =>
    verdicts.filter((verdict) => verdict.status === status).map((verdict) => verdictLine(verdict, steps, verb))
  const failed = lines('failed', 'failed')
  if (failed.length > 0) {
    return (
      <Notice tone="coral" title="Do not sign. Reject this request in your wallet." className="mb-3">
        <Lines lines={failed} />
        <p className="pt-2">The values below only show what the request asks for.</p>
      </Notice>
    )
  }
  const flagged = lines('flagged', null)
  if (flagged.length > 0) {
    return (
      <Notice tone="amber" title="⚠ Onay found warnings in this request" className="mb-3">
        <Lines lines={flagged} />
        <p className="pt-2">Read each warning in its step above. If one is not clear to you, reject the request.</p>
      </Notice>
    )
  }
  const running = lines('running', 'still runs')
  if (running.length > 0) {
    return (
      <Notice tone="gray" title="Wait for the review to end" className="mb-3">
        <Lines lines={running} />
      </Notice>
    )
  }
  return null
}

// The other steps check the request that Onay got. Only this comparison
// shows that the wallet signs the same request. The card stands out, with
// the text about how to confirm, only when every step passed. Otherwise
// it names each step that failed, warns, or still runs, with the reason.
export function CompareStep({
  step,
  steps,
  verdicts,
  request,
  verification,
}: {
  step: StepInfo
  steps: StepInfo[]
  verdicts: StepVerdict[]
  request: SigningRequest
  verification: Verification
}) {
  const fields = useMemo(() => fieldsOf(request), [request])
  const passed = verdicts.every(({ status }) => status === 'passed' || status === 'skipped')
  const card = passed ? 'border-2 border-cerulean-blue-300 bg-cerulean-blue-100/50' : 'border border-gray-200 bg-white'
  return (
    <Step step={step} explainer={EXPLAINER}>
      <section className={`rounded-xl p-5 shadow-sm ${card}`}>
        {passed ? (
          <div className="pb-2">
            <p className="text-sm font-semibold text-cerulean-blue-700">
              Check that your wallet shows the same values.
            </p>
            <p className="pt-1 text-sm leading-relaxed text-gray-600">
              {request.source === 'paste'
                ? 'Onay reviewed the request that you pasted. Your wallet must sign the same one.'
                : 'Onay reviewed the request that the page sent. The page can send your wallet another one.'}{' '}
              Compare every character of each address and digest: wallets can shorten an address, and a page can make a
              digest that starts and ends the same. If one value differs, reject the request in your wallet.
            </p>
          </div>
        ) : (
          <Findings verdicts={verdicts} steps={steps} />
        )}
        <FieldsView fields={fields} request={request} verification={verification} />
        <p className="flex items-start gap-1.5 pt-3 font-mono text-[11px] leading-relaxed text-gray-400">
          <LocallyVerifiedIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" title="Computed on this machine" />
          computed here from the request
        </p>
      </section>
    </Step>
  )
}
