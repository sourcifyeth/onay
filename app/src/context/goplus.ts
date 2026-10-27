// What GoPlus claims about an address: the risk flags of its address
// security API, with the sources that GoPlus names. GoPlus is a closed
// service, so each answer is a claim, not checked here. The settings
// turn it off. This module takes `fetch` as a parameter, so the tests run
// it as it is.

import type { Fetch } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'
import { fetchJson, record, type Lookup } from './explorers.ts'

export const GOPLUS_API = 'https://api.gopluslabs.io/api/v1/address_security'

export type GoPlusFlag = { id: string; text: string }

export type GoPlusResult = {
  flags: GoPlusFlag[]
  // The sources that GoPlus names for its answer, such as SlowMist.
  // 'GoPlus' when it names none.
  sources: string[]
}

// The risk flags in words. `contract_address` says only that the address
// has code, and `data_source` is not a flag.
export const FLAGS: Record<string, string> = {
  cybercrime: 'cybercrime',
  money_laundering: 'money laundering',
  financial_crime: 'financial crime',
  darkweb_transactions: 'darkweb transactions',
  phishing_activities: 'phishing',
  stealing_attack: 'stealing attack',
  blackmail_activities: 'blackmail',
  sanctioned: 'sanctioned',
  mixer: 'mixer',
  fake_kyc: 'fake KYC',
  fake_token: 'fake token',
  fake_standard_interface: 'fake standard interface',
  honeypot_related_address: 'related to a honeypot',
  malicious_mining_activities: 'malicious mining',
  gas_abuse: 'gas abuse',
  reinit: 'redeployed at the same address',
  blacklist_doubt: 'suspected, on a block list',
}

export const goPlusUrl = (chainId: number, address: Hex) => `${GOPLUS_API}/${address}?chain_id=${chainId}`

// A flag with a value other than "0" or "1" is left out.
export function parseGoPlus(body: unknown): GoPlusResult {
  const answer = record(body)
  if (!answer) throw new Error('an answer that does not read')
  if (answer.code !== 1) {
    const message = typeof answer.message === 'string' ? answer.message.slice(0, 120) : 'no message'
    throw new Error(`GoPlus says ${message}`)
  }
  const result = record(answer.result)
  if (!result) throw new Error('an answer without a result')
  const flags: GoPlusFlag[] = []
  for (const [id, text] of Object.entries(FLAGS)) if (result[id] === '1') flags.push({ id, text })
  const created = result.number_of_malicious_contracts_created
  if (typeof created === 'string' && /^[1-9][0-9]{0,8}$/.test(created)) {
    flags.push({ id: 'number_of_malicious_contracts_created', text: `created ${created} malicious contracts` })
  }
  const named =
    typeof result.data_source === 'string'
      ? result.data_source
          .split(',')
          .map((source) => source.trim().slice(0, 40))
          .filter((source) => source !== '')
      : []
  return { flags, sources: named.length > 0 ? named : ['GoPlus'] }
}

// One lookup. The run asks only when the switch in the settings is on.
export async function addressSecurity(chainId: number, address: Hex, fetch: Fetch): Promise<Lookup<GoPlusResult>> {
  const answer = await fetchJson(goPlusUrl(chainId, address), fetch)
  if (!answer.ok) return answer
  if (answer.status !== 200) return { ok: false, reason: `HTTP ${answer.status}` }
  if (answer.body === undefined) return { ok: false, reason: 'an answer that is not JSON' }
  try {
    return { ok: true, value: parseGoPlus(answer.body) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export function goPlusText(result: GoPlusResult): string {
  if (result.flags.length === 0) return 'no flags'
  return `${result.flags.map((flag) => flag.text).join(', ')} · according to ${result.sources.join(', ')}`
}
