// The verification of each signing request, started once and kept: a
// render never starts it again. The run itself is in run.ts; this module
// gives it the real chain and the real gates.

import { chainById } from '../chains.ts'
import type { SigningRequest } from '../messages.ts'
import { chainReaderFor, chainReady, creationReaderFor, heliosGateFor } from './helios.ts'
import { startVerification, type Deps, type VerificationStore } from './run.ts'
import { simulationGateFor } from './simulation.ts'
import { solcFor } from './solc.ts'
import { sourcifyGateFor } from './sourcify.ts'

export type { Status, TimedLine, Verification, VerificationStore } from './run.ts'

const stores = new Map<string, VerificationStore>()

// One compiler for the app: it keeps the downloaded builds.
const solc = solcFor(fetch)

const deps: Deps = {
  chainById,
  chainReady,
  gatesFor(chain) {
    const read = chainReaderFor(chain)
    return {
      helios: heliosGateFor(chain, read),
      sourcify: (log) => sourcifyGateFor(chain.id, fetch, solc, creationReaderFor(chain, read, log)),
      simulation: simulationGateFor(chain, read),
    }
  },
  now: () => performance.now(),
}

export function requestKey(request: SigningRequest): string {
  return `${request.connection}:${request.id}`
}

export function verificationFor(request: SigningRequest): VerificationStore {
  const key = requestKey(request)
  let store = stores.get(key)
  if (!store) {
    store = startVerification(request, deps)
    stores.set(key, store)
  }
  return store
}

export function forgetVerification(request: SigningRequest) {
  stores.delete(requestKey(request))
}
