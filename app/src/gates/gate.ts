// A gate checks one contract and gives one result. The review of a request
// opens only when each gate passed for each contract in it.

export type GateState<T> =
  | { status: 'waiting' }
  | { status: 'running' }
  | { status: 'passed'; value: T }
  | { status: 'failed'; reason: string }

// Where a line comes from. The page shows the lines of each gate under
// its own header.
export type Source = 'browser' | 'helios'

export type LogLine = {
  source: Source
  text: string
  // True shows a check mark, false a cross.
  ok?: boolean
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
    report({ status: 'failed', reason })
    return null
  }
}

// Tauri commands reject with a string.
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
