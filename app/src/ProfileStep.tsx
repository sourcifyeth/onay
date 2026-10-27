// Step 4 of the review: the profile of each address that the request
// names. Who deployed a contract and when, what it holds, and the lists
// that know it. A tooltip on each value shows its mark and names its
// source. Nothing here changes the
// status of the request.

import { useState, type ReactNode } from 'react'
import {
  ageText,
  dateText,
  goPlusFlags,
  goPlusSource,
  searchLinks,
  summaryState,
  youngText,
  type Tone,
} from './context/card.ts'
import { addressLink, explorersOf, linkable, type ChainExplorers } from './context/explorers.ts'
import type { GoPlusResult } from './context/goplus.ts'
import { missingText, type ListAnswer } from './context/lists.ts'
import type {
  AccountProfile,
  Activity,
  Blocked,
  DeployerProfile,
  Fact,
  GoPlusFact,
  Holdings,
  Profile,
} from './context/profile.ts'
import { accountsToCheck, amountText, contractsToProfile, type Context } from './context/run.ts'
import { ExternalLink } from './ExternalLink.tsx'
import type { Contract } from './gates/contracts.ts'
import { claimOf } from './gates/sourcify.ts'
import type { Verification } from './gates/verification.ts'
import type { StepInfo } from './gates/verdict.ts'
import { short } from './gates/words.ts'
import { LocallyVerifiedIcon, ThirdPartyIcon } from './Icons.tsx'
import { CollapsibleLog } from './Log.tsx'
import type { Hex } from './messages.ts'
import { CollapsibleCard, Notice, Step } from './Step.tsx'
import { Tooltip } from './Tooltip.tsx'

const TIP_ICON = 'mr-1 inline-block h-3 w-3 align-[-2px]'
const LINK = 'text-xs text-cerulean-blue-600 hover:underline'

const TONES: Record<Tone, string> = {
  green: 'text-green-700',
  coral: 'text-light-coral-700',
  amber: 'text-amber-700',
  gray: 'text-gray-400',
}

// A row of the card: the label in a fixed column, the value next to it,
// as in the mock. The shared Row puts the value at the far right, which
// reads badly with the short values of a profile.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-2">
      <span className="w-32 shrink-0 text-sm text-gray-500">{label}</span>
      <span className="min-w-0 text-sm [overflow-wrap:anywhere] text-gray-800">{children}</span>
    </div>
  )
}

// A value with its data source in a tooltip: the trust mark, the source,
// and whether it is verified. `detail` is a second line of the tooltip.
function Marked({
  proof,
  source,
  detail,
  hint,
  children,
}: {
  proof: boolean
  source: string
  detail?: ReactNode
  hint?: boolean
  children: ReactNode
}) {
  const tip = (
    <>
      {proof ? <LocallyVerifiedIcon className={TIP_ICON} /> : <ThirdPartyIcon className={TIP_ICON} />}
      Data source: {source} · {proof ? 'verified locally with a proof' : 'not verified locally'}
      {detail && <span className="block text-gray-400">{detail}</span>}
    </>
  )
  return (
    <Tooltip tip={tip} hint={hint}>
      {children}
    </Tooltip>
  )
}

// A row value: the source it waits for, the reason when it is not known,
// else the value with its mark.
function FactView<T>({ fact, children }: { fact: Fact<T>; children: (value: T) => ReactNode }) {
  if (fact.state === 'pending') return <Loading>loading from {fact.source}</Loading>
  if (fact.state === 'unknown') return <span className="text-gray-400">unknown · {fact.reason}</span>
  return (
    <Marked proof={fact.proof} source={fact.source}>
      {children(fact.value)}
    </Marked>
  )
}

// A value that is not here yet. The pulse says that work is in progress.
function Loading({ children }: { children: ReactNode }) {
  return <span className="animate-pulse text-gray-400">{children}</span>
}

// A link only to a site that the app opens. Any other shows as text.
function MaybeLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (href && linkable(href)) {
    return (
      <ExternalLink href={href} className={LINK}>
        {children} ↗
      </ExternalLink>
    )
  }
  return <span className="text-xs text-gray-500">{children}</span>
}

function SearchLinks({ address }: { address: Hex }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-gray-400">
      search:
      {searchLinks(address).map((search) => (
        <ExternalLink
          key={search.name}
          href={search.url}
          title={`Search the web for this address on ${search.name}`}
          className={LINK}
        >
          {search.name} ↗
        </ExternalLink>
      ))}
    </span>
  )
}

function BlockNotice({ blocked, goPlus }: { blocked: Blocked[]; goPlus: GoPlusResult | null }) {
  if (blocked.length === 0 && !goPlus) return null
  return (
    <Notice tone="coral" title={blocked.length > 0 ? '⚠ On a block list' : '⚠ Flagged by GoPlus'} className="mb-3">
      {blocked.map((hit, index) => (
        <span key={index}>
          {index > 0 && ' · '}
          {hit.of === 'deployer' && 'its deployer: '}
          <Marked proof={hit.proof} source={hit.source}>
            {hit.value}
          </Marked>
        </span>
      ))}
      {goPlus && (
        <span>
          {blocked.length > 0 && ' · '}
          <Marked proof={false} source={goPlusSource(goPlus)}>
            {goPlus.flags.map((flag) => flag.text).join(', ')}
          </Marked>
        </span>
      )}
      <br />
      {blocked.length > 0 ? 'Do not interact with it.' : 'Check the address before you sign.'} Onay does not check these
      claims, so the result of the checks above stays as it is.
    </Notice>
  )
}

function YoungNotice({ young }: { young: Profile['young'] }) {
  if (!young) return null
  return (
    <Notice tone="amber" title="⚠ A young contract" className="mb-3">
      {youngText(young)} A new contract with little use deserves more care. It is a hint, not a verdict: the rows below
      say where each value comes from.
    </Notice>
  )
}

function ListsView({ fact }: { fact: Fact<ListAnswer> }) {
  if (fact.state !== 'known') return <FactView fact={fact}>{() => null}</FactView>
  const { hits, missing, asked } = fact.value
  // The lists that answered, as the source of "not on".
  const none =
    asked.length > 0 ? (
      <Marked proof={false} source={asked.join(', ')}>
        {missing.length > 0 ? 'on none of the loaded lists' : 'not on any list'}
      </Marked>
    ) : (
      'no list answered'
    )
  if (hits.length === 0 && missing.length === 0) return <span className="text-gray-400">{none}</span>
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {hits.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {hits.map((hit, index) => {
            const tone =
              hit.kind === 'block'
                ? 'bg-light-coral-100 text-light-coral-700'
                : 'bg-green-50 text-green-700 hover:bg-green-100'
            const text = `${hit.kind === 'block' ? '⚠' : '✓'} ${hit.list} · ${hit.label}`
            const pill = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`
            return (
              <Marked key={index} proof={false} source={hit.list} hint={false}>
                {hit.link && linkable(hit.link) ? (
                  <ExternalLink href={hit.link} className={pill}>
                    {text} ↗
                  </ExternalLink>
                ) : (
                  <span className={pill}>{text}</span>
                )}
              </Marked>
            )
          })}
        </span>
      )}
      {missing.length > 0 && (
        <span className="text-xs text-gray-400">
          {hits.length === 0 && (
            <>
              {none}
              {' · '}
            </>
          )}
          {missingText(missing)}
        </span>
      )}
    </span>
  )
}

function GoPlusView({ fact }: { fact: GoPlusFact }) {
  if (fact.state === 'off') return <span className="text-gray-400">off · settings</span>
  if (fact.state !== 'known') return <FactView fact={fact}>{() => null}</FactView>
  const result: GoPlusResult = fact.value
  const source = goPlusSource(result)
  return (
    <Marked proof={fact.proof} source={source}>
      {result.flags.length === 0 ? (
        'no flags'
      ) : (
        <span className="text-light-coral-700">{result.flags.map((flag) => flag.text).join(', ')}</span>
      )}
    </Marked>
  )
}

function SecurityRow({ blockscout, goPlus }: { blockscout?: Fact<'ok' | 'scam'>; goPlus: GoPlusFact }) {
  return (
    <Row label="Security providers">
      <span className="flex flex-col items-start">
        {blockscout && (
          <span>
            Blockscout:{' '}
            <FactView fact={blockscout}>
              {(value) =>
                value === 'scam' ? <span className="text-light-coral-700">marked as scam</span> : 'no scam mark'
              }
            </FactView>
          </span>
        )}
        <span>
          GoPlus: <GoPlusView fact={goPlus} />
        </span>
      </span>
    </Row>
  )
}

function Tokens({ fact, more }: { fact: Fact<Holdings>; more: string | null }) {
  if (fact.state !== 'known') return <FactView fact={fact}>{() => null}</FactView>
  const { tokens, checked } = fact.value
  if (tokens.length === 0 && !fact.value.more) {
    return (
      <Marked proof={fact.proof} source={fact.source}>
        none
      </Marked>
    )
  }
  return (
    <span className="inline-flex flex-col items-start">
      {tokens.map((token) => {
        const amount = (value: bigint) =>
          `${amountText(value, token.decimals ?? 0)}${token.decimals === null ? ' units' : ''}`
        const symbol = token.symbol.value ?? short(token.token)
        const detail = `${token.token} · named by ${fact.source} · symbol from ${token.symbol.source}`
        return (
          <span key={token.token}>
            <Marked proof={token.amount.proof} source={token.amount.source} detail={detail}>
              {amount(token.amount.value)} {symbol}
            </Marked>
            {token.claimed !== null && (
              <span className="text-xs text-amber-700">
                {' '}
                <Marked proof={false} source="Blockscout">
                  · Blockscout says {amount(token.claimed)}
                </Marked>
              </span>
            )}
          </span>
        )
      })}
      <span className="text-xs text-gray-500">
        {checked ? 'amounts checked on chain' : 'not each amount read from the chain'}
      </span>
      {fact.value.more && <MaybeLink href={more}>and more on Blockscout</MaybeLink>}
    </span>
  )
}

// The rows of activity that a contract and its deployer share.
function ActivityRows({
  activity,
  explorers,
  address,
  now,
}: {
  activity: Activity
  explorers: ChainExplorers
  address: Hex
  now: number
}) {
  const more = explorers.blockscout ? `${addressLink(explorers.blockscout, address)}?tab=tokens` : null
  return (
    <>
      <Row label="Transactions">
        <FactView fact={activity.transactions}>{(count) => count.toLocaleString('en-US')}</FactView>
      </Row>
      <Row label="First transaction">
        <FactView fact={activity.firstTransaction}>
          {(first) => (first ? `${dateText(first.time)} · ${ageText(first.time, now)}` : 'none')}
        </FactView>
      </Row>
      <Row label="ETH holdings">
        <FactView fact={activity.eth}>{(wei) => `${amountText(wei, 18)} ETH`}</FactView>
      </Row>
      <Row label="Token holdings">
        <Tokens fact={activity.tokens} more={more} />
      </Row>
    </>
  )
}

const KINDS = {
  contract: 'contract',
  account: 'EOA',
  delegated: 'EOA with a delegate',
}

function DeployerSection({
  deployer,
  explorers,
  now,
}: {
  deployer: DeployerProfile
  explorers: ChainExplorers
  now: number
}) {
  const address = deployer.address.state === 'known' ? deployer.address.value : null
  // The deployer is another address: its own box, under the contract.
  return (
    <section className="mt-5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <h4 className="text-sm font-semibold text-gray-800">Deployer Address</h4>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-gray-700">
        <FactView fact={deployer.address}>
          {(value) => <span className="font-mono text-[13px] break-all text-gray-700">{value}</span>}
        </FactView>
        {address && (
          <>
            <span>
              (<FactView fact={deployer.kind}>{(kind) => KINDS[kind]}</FactView>)
            </span>
            {explorers.etherscan && <MaybeLink href={addressLink(explorers.etherscan, address)}>Etherscan</MaybeLink>}
            {explorers.blockscout && (
              <MaybeLink href={addressLink(explorers.blockscout, address)}>Blockscout</MaybeLink>
            )}
          </>
        )}
      </p>
      {address && (
        <>
          {(deployer.name.state !== 'known' || deployer.name.value !== null) && (
            <p className="pb-1 text-sm text-gray-700">
              <FactView fact={deployer.name}>{(name) => name}</FactView>
            </p>
          )}
          <div className="divide-y divide-gray-200">
            <ActivityRows activity={deployer} explorers={explorers} address={address} now={now} />
            <Row label="Found on lists">
              <ListsView fact={deployer.lists} />
            </Row>
          </div>
        </>
      )}
    </section>
  )
}

function DeployedRow({ profile, now }: { profile: Profile; now: number }) {
  const { deployment, deployedAt } = profile
  return (
    <Row label="Deployed">
      <span className="inline-flex flex-col items-start">
        <FactView fact={deployedAt}>{(at) => `${dateText(at)} · ${ageText(at, now)}`}</FactView>
        {deployment.state === 'known' && (
          <span className="text-xs text-gray-500">
            <Marked proof={deployment.proof} source={deployment.source}>
              {deployment.value.block !== null
                ? `block ${deployment.value.block.toLocaleString('en-US')}`
                : `transaction ${short(deployment.value.transactionHash)}`}
            </Marked>
          </span>
        )}
      </span>
    </Row>
  )
}

function SummaryState({ profile, running }: { profile: Profile | AccountProfile | undefined; running: boolean }) {
  const { text, tone } = profile ? summaryState(profile, running) : { text: 'looking up', tone: 'gray' as const }
  const pulse = text === 'looking up' ? ' animate-pulse' : ''
  return <span className={`text-xs font-medium ${TONES[tone]}${pulse}`}>· {text}</span>
}

// The title of a card: the name in bold, then the full address. The name
// comes from Sourcify, else from Blockscout. An account has no name and
// shows its kind instead.
function CardTitle({
  kind,
  name,
  address,
  state,
}: {
  kind?: string
  name: string | null
  address: Hex
  state: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      {kind && <span className="text-xs text-gray-500">{kind}</span>}
      {name && <span className="text-base font-semibold text-gray-800">{name}</span>}
      <span className="font-mono text-sm break-all text-gray-700">{address}</span>
      {state}
    </div>
  )
}

// The line under the title: the name that Blockscout gives, when the
// title does not show it already, and the search links.
function AddressLine({ address, name, title }: { address: Hex; name?: Fact<string | null>; title?: string | null }) {
  const claimed = name?.state === 'known' && name.value !== null && name.value !== title ? name : null
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 pb-2">
      {claimed && (
        <span className="text-xs text-gray-700">
          <Marked proof={claimed.proof} source={claimed.source}>
            {claimed.value}
          </Marked>
        </span>
      )}
      <SearchLinks address={address} />
    </div>
  )
}

// The name of a contract: the one Sourcify verified, else the claim of
// Blockscout.
function nameOf(contract: Contract, profile: Profile | undefined): string | null {
  const verified = claimOf(contract.sourcify)?.name
  if (verified) return verified
  return profile?.name.state === 'known' ? profile.name.value : null
}

function ProfileCard({
  contract,
  profile,
  context,
  explorers,
}: {
  contract: Contract
  profile: Profile | undefined
  context: Context
  explorers: ChainExplorers
}) {
  const running = context.status === 'running'
  const lines = context.lines.filter((line) => line.address === contract.address && line.topic !== 'status')
  const name = nameOf(contract, profile)
  const summary = (
    <CardTitle name={name} address={contract.address} state={<SummaryState profile={profile} running={running} />} />
  )
  return (
    <CollapsibleCard open summary={summary}>
      {!profile ? (
        <p className="text-sm">
          <Loading>looking up</Loading>
        </p>
      ) : (
        <ProfileBody profile={profile} explorers={explorers} title={name} />
      )}
      <CollapsibleLog lines={lines} />
    </CollapsibleCard>
  )
}

function ProfileBody({
  profile,
  explorers,
  title,
}: {
  profile: Profile
  explorers: ChainExplorers
  title: string | null
}) {
  // The ages count from the time the card opened.
  const [now] = useState(() => Date.now())
  return (
    <div className="px-2 pt-1 pb-2">
      <BlockNotice blocked={profile.blocked} goPlus={goPlusFlags(profile)} />
      <YoungNotice young={profile.young} />
      <AddressLine address={profile.address} name={profile.name} title={title} />
      <div className="divide-y divide-gray-100">
        <DeployedRow profile={profile} now={now} />
        <ActivityRows activity={profile} explorers={explorers} address={profile.address} now={now} />
        <Row label="Found on lists">
          <ListsView fact={profile.lists} />
        </Row>
        <SecurityRow blockscout={profile.security.blockscout} goPlus={profile.security.goPlus} />
      </div>
      <DeployerSection deployer={profile.deployer} explorers={explorers} now={now} />
    </div>
  )
}

// An address without code of its own: only the lists and GoPlus know it.
function AccountCard({
  contract,
  account,
  context,
}: {
  contract: Contract
  account: AccountProfile | undefined
  context: Context
}) {
  const lines = context.lines.filter((line) => line.address === contract.address)
  // Without a read of the chain gate, the code of the address is not known.
  const read = contract.helios.status === 'passed'
  const delegated = contract.helios.status === 'passed' && contract.helios.value.code !== '0x'
  const summary = (
    <CardTitle
      kind={delegated ? 'EIP-7702 account' : read ? 'Account' : 'Address'}
      name={null}
      address={contract.address}
      state={<SummaryState profile={account} running={context.status === 'running'} />}
    />
  )
  return (
    <CollapsibleCard open summary={summary}>
      {!account ? (
        <p className="text-sm">
          <Loading>looking up</Loading>
        </p>
      ) : (
        <>
          <BlockNotice blocked={account.blocked} goPlus={goPlusFlags(account)} />
          <AddressLine address={account.address} />
          <div className="divide-y divide-gray-100">
            <Row label="Found on lists">
              <ListsView fact={account.lists} />
            </Row>
            <SecurityRow goPlus={account.goPlus} />
          </div>
        </>
      )}
      <CollapsibleLog lines={lines} />
    </CollapsibleCard>
  )
}

export function ProfileStep({
  step,
  verification,
  context,
}: {
  step: StepInfo
  verification: Verification
  context: Context
}) {
  const profiled = new Set(contractsToProfile(verification))
  const accounts = new Set(accountsToCheck(verification))
  const named = verification.contracts.filter(
    (contract) => profiled.has(contract.address) || accounts.has(contract.address),
  )
  const explorers: ChainExplorers = verification.chain
    ? explorersOf(verification.chain)
    : { etherscan: null, blockscout: null, blockscoutApi: null }
  return (
    <Step
      step={step}
      explainer="Facts about the contract's history and what it holds help you judge it. A contract that was deployed a few days ago and has few transactions deserves more care. Every address the request names is also checked against the block lists. These facts come from explorers and lists; they do not change the result of the checks."
    >
      {named.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
          The request names no contract and no account, so there is no profile.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {named.map((contract) =>
            profiled.has(contract.address) ? (
              <ProfileCard
                key={contract.address}
                contract={contract}
                profile={context.profiles[contract.address]}
                context={context}
                explorers={explorers}
              />
            ) : (
              <AccountCard
                key={contract.address}
                contract={contract}
                account={context.accounts[contract.address]}
                context={context}
              />
            ),
          )}
        </div>
      )}
    </Step>
  )
}
