// A gate checks one contract and gives one result. The review of a request
// opens only when each gate passed for each contract in it.

import type { RequestSource } from '../messages.ts'

export type GateState<T> =
  | { status: 'waiting' }
  | { status: 'running' }
  | { status: 'passed'; value: T }
  // The cause is what the gate attached to its error, for the review.
  | { status: 'failed'; reason: string; cause?: unknown }
  // The gate has nothing to check, for example a transfer to an account
  // with no code. The contract can still pass.
  | { status: 'skipped'; reason: string }

// Where a line comes from: the source of the request (the browser or a
// paste), or a gate. The page shows the lines of each gate under its own
// header. 'evm' is the simulation, 'erc7730' the Clear Signing,
// 'explorer' the block explorers, 'lists' the address lists.
export type Source = RequestSource | 'helios' | 'rpc' | 'evm' | 'sourcify' | 'solc' | 'erc7730' | 'explorer' | 'lists'

export type LogLine = {
  source: Source
  text: string
  // True shows a check mark, false a cross.
  ok?: boolean
  // True: checked on this machine, shown with the local icon. False:
  // taken from a third party, shown with the cloud icon.
  proof?: boolean
}

export type Log = (line: LogLine) => void

export type Gate<In, Out> = {
  source: Source
  // Rejects if the check fails. Logs each check that it makes.
  run(input: In, log: Log): Promise<Out>
}

// Runs a gate and reports each change of its state. Returns the result, or
// null if the gate failed.
export async function runGate<In, Out>(
  gate: Gate<In, Out>,
  input: In,
  log: Log,
  report: (state: GateState<Out>) => void,
): Promise<Out | null> {
  report({ status: 'running' })
  try {
    const value = await gate.run(input, log)
    report({ status: 'passed', value })
    return value
  } catch (error) {
    const reason = errorText(error)
    log({ source: gate.source, text: reason, ok: false })
    const cause = error instanceof Error ? error.cause : undefined
    report(cause === undefined ? { status: 'failed', reason } : { status: 'failed', reason, cause })
    return null
  }
}

// A call that fails once the signal aborts: a call after that, or one
// that hangs past it, rejects with the text.
export function withDeadline<Args extends unknown[], Out>(
  call: (...args: Args) => Promise<Out>,
  signal: AbortSignal,
  text: string,
): (...args: Args) => Promise<Out> {
  return (...args) =>
    new Promise((resolve, reject) => {
      const fail = () => reject(new Error(text))
      if (signal.aborted) return fail()
      signal.addEventListener('abort', fail, { once: true })
      call(...args)
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', fail))
    })
}

// Tauri commands reject with a string.
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// What a gate needs from the network. Given as a parameter, so a test can
// give a fake.
export type Fetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>
