// The last step of the review: the values to find in the wallet before
// you confirm there. A page can show Onay one request and the wallet
// another, and a value that differs gives it away. The ERC-8213 digest
// stands for the data; the fields around it are what it does not cover.

import { Fragment, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { chainById, chainName } from './chains.ts'
import { formatAmount } from './clear-signing/render.ts'
import { chainInfoOf, clearSigningFor } from './clear-signing/store.ts'
import { fieldsOf, type CallFields, type Delegation, type Fields } from './compare/fields.ts'
import { ExternalLink } from './ExternalLink.tsx'
import type { Verification } from './gates/verification.ts'
import { LocallyVerifiedIcon } from './Icons.tsx'
import type { Hex, SigningRequest } from './messages.ts'
import { Step } from './Step.tsx'

const ERC_8213 = 'https://github.com/ethereum/ERCs/pull/1639'

type Currency = { symbol: string; decimals: number } | null

function Row({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right">
        {children}
        {note && <p className="pt-0.5 text-xs text-gray-400">{note}</p>}
      </dd>
    </div>
  )
}

function Address({ value }: { value: string }) {
  return <span className="font-mono text-[13px] font-medium break-all text-gray-800">{value}</span>
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
// groups. A copy gives the plain string, as ERC-8213 has it.
function DigestValue({ value }: { value: Hex }) {
  const groups = value.slice(2).match(/.{1,4}/g) ?? []
  return (
    <p className="pt-1 font-mono text-xs leading-relaxed text-gray-800">
      0x
      {groups.map((group, index) => (
        <Fragment key={index}>
          <wbr />
          <span className="ml-[0.5em]">{group}</span>
        </Fragment>
      ))}
    </p>
  )
}

// The labels that other wallets give each value, from their source code
// on 2026-10-26: Trezor firmware 2.13.0 (core/src/apps/ethereum/helpers.py,
// sign_typed_data.py), Keycard Shell 1.3.0 (app/ui/english.c), Ledger
// app-ethereum 1.23.0 (src/nbgl/ui_approve_tx.c, ui_sign_message.c,
// src/features/sign_message_eip712_common/common_712.c), and Safe{Wallet}
// (apps/web/src/components/tx/ConfirmTxDetails/Receipt.tsx).
const NAMES = {
  calldata:
    'ERC-8213 digest on Trezor Safe 5 and Safe 7, Datahash on Keycard Shell. The Transaction hash of a Ledger is another value: it also covers the nonce and the fees.',
  typedData: 'Hash on Keycard Shell',
  safeTx: 'safeTxHash in Safe',
  domainHash: 'Domain hash on Ledger, in capital letters',
  messageHash: 'Message hash on Ledger, in capital letters, and Confirm message hash on Trezor',
  message: 'Message hash on Ledger, with its Transaction hash setting on',
}

function OtherNames({ names }: { names: string }) {
  return <p className="pt-1 text-xs leading-relaxed text-gray-400">Other names: {names}</p>
}

// One ERC-8213 digest, as the mock shows it. `parts` are the hashes that
// make up the digest, which some wallets show in its place.
function DigestBox({
  label,
  value,
  names,
  children,
  parts = [],
}: {
  label: string
  value: Hex
  names: string
  children: ReactNode
  parts?: { label: string; value: Hex; names: string }[]
}) {
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="flex items-baseline justify-between font-mono text-xs text-gray-500">
        <span>{label}</span>
        <ExternalLink href={ERC_8213} className="text-gray-400 hover:text-cerulean-blue-600">
          ERC-8213 ↗
        </ExternalLink>
      </p>
      <DigestValue value={value} />
      <p className="pt-2 text-xs leading-relaxed text-gray-500">{children}</p>
      <OtherNames names={names} />
      {parts.map((part) => (
        <div key={part.label} className="pt-3">
          <p className="font-mono text-xs text-gray-500">{part.label}</p>
          <DigestValue value={part.value} />
          <OtherNames names={part.names} />
        </div>
      ))}
    </div>
  )
}

function amountText(value: bigint | null, currency: Currency): string {
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
      <Row label="To">
        {call.to ? (
          <Address value={call.to} />
        ) : (
          <span className="text-sm text-gray-800">none · creates a contract</span>
        )}
      </Row>
      <Row label="Amount">
        <span className="text-sm font-medium text-gray-800">{amountText(call.value, currency)}</span>
      </Row>
      <Row label="Calldata">
        <span className="font-mono text-[13px] text-gray-800">
          {call.length === 0 ? (
            'none'
          ) : (
            <>
              {call.selector && verification.chain && (
                <FunctionName request={request} verification={verification} index={index} />
              )}
              {call.selector && `${call.selector} · `}
              {call.length} bytes
            </>
          )}
        </span>
      </Row>
    </>
  )
}

function CalldataDigest({ call }: { call: CallFields }) {
  if (!call.digest) return null
  return (
    <DigestBox label="Calldata Digest" value={call.digest} names={NAMES.calldata}>
      If your wallet shows this digest, it must be the same. It covers only the calldata, so also compare the fields
      above.
    </DigestBox>
  )
}

function DelegationRow({ delegation }: { delegation: Delegation }) {
  const every = delegation.chainId === 0n
  const name = chainById(Number(delegation.chainId))?.name
  return (
    <Row
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
    </Row>
  )
}

function Notice({
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
          <dl className="divide-y divide-gray-100">
            <Row label="Network">
              <Chain chainId={chainId} />
            </Row>
            <CallRows call={fields.call} index={0} currency={currency} request={request} verification={verification} />
            <Row label="From">
              {fields.from ? <Address value={fields.from} /> : <span className="text-sm">not given</span>}
            </Row>
            {fields.delegations.map((delegation, index) => (
              <DelegationRow key={index} delegation={delegation} />
            ))}
          </dl>
          <CalldataDigest call={fields.call} />
        </div>
      )
    case 'batch':
      return (
        <div>
          <dl className="divide-y divide-gray-100">
            <Row label="Network">
              <Chain chainId={chainId} />
            </Row>
            <Row label="From">
              {fields.from ? <Address value={fields.from} /> : <span className="text-sm">not given</span>}
            </Row>
          </dl>
          <div className="flex flex-col gap-2 pt-2">
            {fields.calls.map((call, index) => (
              <div key={index} className="rounded-lg border border-gray-200 p-3">
                <p className="font-mono text-xs text-gray-400">call {index + 1}</p>
                <dl className="divide-y divide-gray-100">
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
            <Notice tone="gray">
              Your wallet can run the batch as one transaction whose calldata holds all the calls, for example through
              an EIP-7702 smart account or a Safe MultiSend. A device then shows the Calldata Digest of that
              transaction. The wallet builds it, so Onay cannot compute it. Compare each call where your wallet lists
              the calls.
            </Notice>
          </div>
        </div>
      )
    case 'typedData': {
      const { domain, digests } = fields
      return (
        <div>
          <dl className="divide-y divide-gray-100">
            <Row label="Network">
              {domain.hasChain ? (
                <Chain chainId={domain.chainId} />
              ) : (
                <span className="text-sm text-amber-700">none · the signature holds on every chain</span>
              )}
            </Row>
            <Row label="Domain">
              <span className="text-sm font-medium text-gray-800">
                {domain.name ?? 'no name'}
                {domain.version !== null && <span className="text-gray-500"> · version {domain.version}</span>}
              </span>
            </Row>
            <Row label="Verifying contract">
              {domain.verifyingContract ? (
                <Address value={domain.verifyingContract} />
              ) : (
                <span className="text-sm">none</span>
              )}
            </Row>
            <Row label="Primary type">
              <span className="font-mono text-[13px] text-gray-800">{fields.primaryType}</span>
            </Row>
            <Row label="Signer">
              <Address value={fields.signer} />
            </Row>
          </dl>
          {digests ? (
            <DigestBox
              label="EIP-712 Digest"
              value={digests.digest}
              names={fields.primaryType === 'SafeTx' ? `${NAMES.typedData}, ${NAMES.safeTx}` : NAMES.typedData}
              parts={[
                { label: 'Domain Hash', value: digests.domainHash, names: NAMES.domainHash },
                { label: 'Message Hash', value: digests.messageHash, names: NAMES.messageHash },
              ]}
            >
              If your wallet shows this digest, it must be the same. A match proves that your wallet signs the same
              typed data. Some wallets show its two parts below in its place.
            </DigestBox>
          ) : (
            <Notice tone="amber" className="mt-2">
              No digest: {fields.reason}.
            </Notice>
          )}
        </div>
      )
    }
    case 'message':
      return (
        <div>
          <p className="pt-1 pb-1 text-sm text-gray-500">Message</p>
          <MessageBlock>{fields.text ?? hexOf(fields.bytes)}</MessageBlock>
          {fields.hidden && (
            <>
              <p className="pt-2 pb-1 text-sm text-gray-500">As bytes</p>
              <MessageBlock>{hexOf(fields.bytes)}</MessageBlock>
            </>
          )}
          <div className="flex flex-col gap-2 pt-2">
            {fields.text === null && <Notice tone="gray">The message is not text, so it shows as hex.</Notice>}
            {fields.hidden && (
              <Notice tone="amber">
                The message has characters that do not show, or that change how the text shows, such as a zero-width
                space or a change of direction. Compare the bytes, not the text.
              </Notice>
            )}
            {fields.nonAscii && !fields.hidden && (
              <Notice tone="gray">
                The message has letters outside ASCII, which can look like other letters.
                {fields.digest && ' The ERC-191 Digest tells them apart.'}
              </Notice>
            )}
          </div>
          <dl className="divide-y divide-gray-100 pt-1">
            <Row label="Signer">
              {fields.signer ? <Address value={fields.signer} /> : <span className="text-sm">not given</span>}
            </Row>
          </dl>
          {fields.digest ? (
            <DigestBox label="ERC-191 Digest" value={fields.digest} names={NAMES.message}>
              If your wallet shows this digest, it must be the same. A match proves that your wallet signs the same
              message.
            </DigestBox>
          ) : (
            <Notice tone="amber" className="mt-2">
              No digest: {fields.reason}.
            </Notice>
          )}
        </div>
      )
    case 'none':
      return <Notice tone="amber">Nothing to compare: {fields.reason}.</Notice>
  }
}

function MessageBlock({ children }: { children: string }) {
  return (
    <pre className="max-h-60 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-gray-800">
      {children}
    </pre>
  )
}

function hexOf(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const EXPLAINER =
  'A page can show Onay one request and your wallet another. Find each value here on the confirmation screen of your wallet: one that differs gives the page away. Under each digest, Onay names the wallets that show it with another label. MetaMask and Rabby show no digest. The case of hex letters does not matter.'

export function CompareStep({
  request,
  verification,
  number,
}: {
  request: SigningRequest
  verification: Verification
  number: number
}) {
  const fields = useMemo(() => fieldsOf(request), [request])
  return (
    <Step number={number} title="Compare with your wallet" explainer={EXPLAINER}>
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="pb-2 text-sm leading-relaxed text-gray-600">
          Before you confirm in your wallet, check that it shows these values. Compare every character of each address
          and digest: wallets can shorten an address, and a page can make a digest that starts and ends the same. If one
          value differs, reject the request there.
        </p>
        <FieldsView fields={fields} request={request} verification={verification} />
        <p className="flex items-start gap-1.5 pt-3 font-mono text-[11px] leading-relaxed text-gray-400">
          <LocallyVerifiedIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" title="Computed on this machine" />
          computed here from the request
        </p>
      </section>
    </Step>
  )
}
