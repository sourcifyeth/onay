import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getEventListeners } from 'node:events'

import { errorText, runGate, withDeadline, type Gate, type GateState, type LogLine } from '../src/gates/gate.ts'

function collect() {
  const states: GateState<string>[] = []
  const lines: LogLine[] = []
  return {
    states,
    lines,
    report: (state: GateState<string>) => states.push(state),
    log: (line: LogLine) => lines.push(line),
  }
}

test('a gate that passes: running, then passed with its value', async () => {
  const gate: Gate<number, string> = {
    source: 'rpc',
    async run(input, log) {
      log({ source: 'rpc', text: `read ${input}`, ok: true })
      return `value ${input}`
    },
  }
  const { states, lines, report, log } = collect()
  assert.equal(await runGate(gate, 7, log, report), 'value 7')
  assert.deepEqual(states, [{ status: 'running' }, { status: 'passed', value: 'value 7' }])
  assert.deepEqual(lines, [{ source: 'rpc', text: 'read 7', ok: true }])
})

test('a gate that fails: running, then failed with the reason, and the reason in the log', async () => {
  const gate: Gate<number, string> = {
    source: 'helios',
    async run() {
      throw new Error('no proof')
    },
  }
  const { states, lines, report, log } = collect()
  assert.equal(await runGate(gate, 7, log, report), null)
  assert.deepEqual(states, [{ status: 'running' }, { status: 'failed', reason: 'no proof' }])
  assert.deepEqual(lines, [{ source: 'helios', text: 'no proof', ok: false }])
})

test('a gate that fails with a cause: the cause is in the failed state', async () => {
  const gate: Gate<number, string> = {
    source: 'sourcify',
    async run() {
      throw new Error('not reproduced', { cause: { kind: 'not reproduced' } })
    },
  }
  const { states, report, log } = collect()
  await runGate(gate, 7, log, report)
  assert.deepEqual(states[1], { status: 'failed', reason: 'not reproduced', cause: { kind: 'not reproduced' } })
})

test('errorText takes the message of an Error and the text of anything else', () => {
  assert.equal(errorText(new Error('boom')), 'boom')
  assert.equal(errorText('a string from a Tauri command'), 'a string from a Tauri command')
  assert.equal(errorText(42), '42')
})

test('withDeadline: a call after the abort, or one that hangs past it, rejects with the text', async () => {
  const abort = new AbortController()
  const hanging = withDeadline(() => new Promise<string>(() => {}), abort.signal, 'too late')
  const pending = hanging()
  abort.abort()
  await assert.rejects(pending, /too late/)
  await assert.rejects(hanging(), /too late/)
})

test('withDeadline: a call that ends in time keeps its result, and leaves no listener behind', async () => {
  const abort = new AbortController()
  const read = withDeadline(async (n: number) => n * 2, abort.signal, 'too late')
  assert.equal(await read(21), 42)
  await assert.rejects(
    withDeadline(() => Promise.reject(new Error('HTTP 429')), abort.signal, 'too late')(),
    /HTTP 429/,
  )
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
})
