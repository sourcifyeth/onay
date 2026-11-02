// The errors of Helios in words that name the endpoint at fault and point
// to the settings. No platform calls in here, so the tests run it as it is.

import type { ChainConfig } from '../chainList.ts'
import { hostOf } from '../url.ts'

// An error of a chain read. Helios asks the execution endpoint for a proof
// at its own head block. Some endpoints serve proofs for their newest block
// only, or need a key for older blocks. Both errors come from the
// execution endpoint, so say so.
export function explainProofError(message: string, chain: ChainConfig): string {
  const execution = hostOf(chain.executionRpc)
  if (/proof window/i.test(message)) {
    return `${execution} serves proofs for its newest block only, and Helios is a few blocks behind it. Choose an execution endpoint that serves eth_getProof for recent blocks, in the settings.`
  }
  if (/archive/i.test(message)) {
    return `${execution} needs a key for this block. Choose another execution endpoint in the settings.`
  }
  return message
}

// An error of the sync. The bootstrap comes from the consensus endpoint.
// A 404 there means that it serves no light-client data, whatever its
// message says about the checkpoint. Any other failure keeps the message
// of Helios, for diagnosis.
export function explainSyncError(message: string, chain: ChainConfig): string {
  if (!/could not fetch bootstrap/i.test(message)) return message
  const consensus = chain.consensusRpc ? hostOf(chain.consensusRpc) : 'the consensus endpoint'
  if (/status: 404\b/.test(message)) {
    return `${consensus} answered 404 to the light-client bootstrap: it serves no light-client data for this checkpoint. Choose a consensus endpoint with the beacon light client API, in the settings.`
  }
  return `${consensus} did not serve the light-client bootstrap. Check the consensus endpoint in the settings. Helios says: ${message}`
}
