import type { ReactNode } from 'react'
import { BLOCKSCOUT, ETHERSCAN } from '../data/explorers'
import {
  getContractInfo,
  type Deployer,
  type Holding,
  type MockContract,
  type MockRequest,
} from '../data/mockRequest'
import { Step } from './Step'

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5">
      <span className="w-28 shrink-0 text-sm text-gray-500">{label}</span>
      <span className="min-w-0 text-sm text-gray-800">{children}</span>
    </div>
  )
}

const muted = (text: string) => <span className="text-gray-400"> · {text}</span>

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function Tokens({ tokens }: { tokens: Holding[] }) {
  if (tokens.length === 0) return <span className="text-gray-400">none</span>
  return (
    <>
      {tokens.map((t) => (
        <p key={t.symbol}>
          {t.amount} {t.symbol}
          {t.usd && muted(t.usd)}
        </p>
      ))}
    </>
  )
}

const link = 'text-xs text-cerulean-blue-600 hover:underline'

// the address in quotes, so the engines match it exactly; GitHub finds it in protocol repos
function searches(address: string): { name: string; url: string }[] {
  const quoted = encodeURIComponent(`"${address}"`)
  return [
    { name: 'Google', url: `https://www.google.com/search?q=${quoted}` },
    { name: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${quoted}` },
    { name: 'GitHub', url: `https://github.com/search?q=${address}&type=code` },
    { name: 'X', url: `https://x.com/search?q=${address}&f=live` },
  ]
}

function WebSearchLinks({ address }: { address: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-gray-400">
      search:
      {searches(address).map((s) => (
        <a
          key={s.name}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          title={`Search the web for this address on ${s.name}`}
          className={link}
        >
          {s.name} ↗
        </a>
      ))}
    </span>
  )
}

function DeployerSection({ deployer, chainId }: { deployer: Deployer; chainId: number }) {
  const etherscan = ETHERSCAN[chainId]
  const blockscout = BLOCKSCOUT[chainId]
  return (
    <div className="py-1.5">
      <p className="text-sm text-gray-500">Deployer</p>
      <div className="mt-1 border-l-2 border-cerulean-blue-200 pl-3">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-all font-mono text-[13px] text-gray-700">{deployer.address}</span>
          <span className="text-xs text-gray-500">
            {deployer.name ? `${deployer.name} · ` : ''}
            {deployer.kind === 'contract' ? 'factory contract' : 'account'}
          </span>
        </p>
        <p className="flex gap-3 pb-1">
          {etherscan && (
            <a
              href={`${etherscan}/address/${deployer.address}`}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              Etherscan ↗
            </a>
          )}
          {blockscout && (
            <a
              href={`${blockscout}/address/${deployer.address}`}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              Blockscout ↗
            </a>
          )}
        </p>
        <Row label="First transaction">
          {formatDate(deployer.firstTxAt)} · {age(deployer.firstTxAt)}
        </Row>
        <Row label="Transactions">{deployer.txCount.toLocaleString('en-US')}</Row>
        <Row label="ETH holdings">
          {deployer.ethBalance}
          {deployer.ethUsd && muted(deployer.ethUsd)}
        </Row>
        <Row label="Token holdings">
          <Tokens tokens={deployer.tokens} />
        </Row>
      </div>
    </div>
  )
}

// placeholder facts, to be refined: which facts to show, and where they come from
function ContractProfile({ contract, chainId }: { contract: MockContract; chainId: number }) {
  const info = getContractInfo(contract.address)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="flex flex-wrap items-baseline gap-x-2 pb-2">
        <span className="text-xs text-gray-500">Contract</span>
        <span className="break-all font-mono text-[13px] text-gray-700">{contract.address}</span>
        <span className="text-xs text-gray-500">{contract.name}</span>
        <WebSearchLinks address={contract.address} />
      </p>
      {!info ? (
        <p className="text-sm text-gray-400">No profile data for this address.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          <Row label="Deployed">
            {formatDate(info.deployedAt)} · {age(info.deployedAt)}
          </Row>
          <DeployerSection deployer={info.deployer} chainId={chainId} />
          <Row label="Transactions">{info.txCount.toLocaleString('en-US')}</Row>
          <Row label="ETH holdings">
            {info.ethBalance}
            {info.ethUsd && muted(info.ethUsd)}
          </Row>
          <Row label="Token holdings">
            <Tokens tokens={info.tokens} />
          </Row>
          <Row label="Found on lists">
            {info.lists.length === 0 ? (
              <span className="text-gray-400">not on any list</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {info.lists.map((l) => (
                  <a
                    key={l.name}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-100"
                  >
                    ✓ {l.name}
                    {l.url && ' ↗'}
                  </a>
                ))}
              </span>
            )}
          </Row>
        </div>
      )}
    </div>
  )
}

export function ProfileStep({ request }: { request: MockRequest }) {
  // the contracts the request calls directly, as in the source code step
  const targets = request.contracts.filter(
    (c, i, all) => c.depth === 0 && all.findIndex((o) => o.address === c.address) === i,
  )
  return (
    <Step
      number={3}
      title="Contract Profile"
      explainer="Facts about the contract's history and what it holds help you judge it. A contract that was deployed a few days ago and has few transactions deserves more care."
    >
      {targets.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
          The recipient is not a contract, so there is no contract profile.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {targets.map((c) => (
            <ContractProfile key={c.address} contract={c} chainId={request.chainId} />
          ))}
        </div>
      )}
    </Step>
  )
}
