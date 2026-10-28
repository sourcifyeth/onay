// The errors of Helios in words that name the endpoint at fault and point
// to the settings. No platform calls in here, so the tests run it as it is.

import type { ChainConfig } from '../chainList.ts'

// Helios asks the execution endpoint for a proof at its own head block.
// Some endpoints serve proofs for their newest block only, or need a key
// for older blocks. Both errors come from the endpoint, so say so. The
// consensus endpoint is at fault when it answers 404 to the bootstrap: it
// serves no light-client data, whatever its message says about the
// checkpoint.
export function explainHeliosError(message: string, chain: ChainConfig): string {
  const execution = hostOf(chain.executionRpc)
  if (/proof window/i.test(message)) {
    return `${execution} serves proofs for its newest block only, and Helios is a few blocks behind it. Choose an execution endpoint that serves eth_getProof for recent blocks, in the settings.`
  }
  if (/archive/i.test(message)) {
    return `${execution} needs a key for this block. Choose another execution endpoint in the settings.`
  }
  if (/could not fetch bootstrap/i.test(message) && /\b404\b|NOT_FOUND/i.test(message)) {
    const consensus = chain.consensusRpc ? hostOf(chain.consensusRpc) : 'the consensus endpoint'
    return `${consensus} answered 404 to the light-client bootstrap: it serves no light-client data for this checkpoint. Choose a consensus endpoint with the beacon light client API, in the settings.`
  }
  return message
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
