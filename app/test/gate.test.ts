import assert from 'node:assert/strict'
import { test } from 'node:test'

import { errorText, runGate, type Gate, type GateState, type LogLine } from '../src/gates/gate.ts'

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

test('errorText takes the message of an Error and the text of anything else', () => {
  assert.equal(errorText(new Error('boom')), 'boom')
  assert.equal(errorText('a string from a Tauri command'), 'a string from a Tauri command')
  assert.equal(errorText(42), '42')
})
