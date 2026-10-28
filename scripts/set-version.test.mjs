import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILES, parseArgs, replaceVersion } from './set-version.mjs'

const [, jsonPattern] = FILES.app[0]
const [, cargoPattern] = FILES.app[2]

test('parseArgs: a target and a version, with or without --check', () => {
  assert.deepEqual(parseArgs(['app', '0.2.0']), { check: false, target: 'app', version: '0.2.0' })
  assert.deepEqual(parseArgs(['--check', 'extension', '1.0.0']), { check: true, target: 'extension', version: '1.0.0' })
})

test('parseArgs: an unknown target, a malformed version, or an extra argument is refused', () => {
  assert.equal(parseArgs(['mock', '0.2.0']), null)
  assert.equal(parseArgs(['app', 'v0.2.0']), null)
  assert.equal(parseArgs(['app', '0.2']), null)
  assert.equal(parseArgs(['app']), null)
  assert.equal(parseArgs(['app', '0.2.0', 'extra']), null)
  assert.equal(parseArgs(['app', '0.2.0', '--check']), null)
})

test('package.json: the first version field is the package version, a dependency named version is untouched', () => {
  const text = '{\n  "name": "app",\n  "version": "0.1.0",\n  "dependencies": {\n    "version": "2.0.0"\n  }\n}\n'
  const { current, text: next } = replaceVersion(text, jsonPattern, '0.2.0')
  assert.equal(current, '0.1.0')
  assert.equal(next, text.replace('"version": "0.1.0"', '"version": "0.2.0"'))
  assert.ok(next.includes('"version": "2.0.0"'))
})

test('Cargo.toml: the workspace version at the start of a line, not one inside a table', () => {
  const text = '[workspace.package]\nversion = "0.1.0"\n\n[workspace.dependencies]\nserde = { version = "1" }\n'
  const { current, text: next } = replaceVersion(text, cargoPattern, '0.2.0')
  assert.equal(current, '0.1.0')
  assert.equal(next, text.replace('version = "0.1.0"', 'version = "0.2.0"'))
})

test('a text without a version field throws', () => {
  assert.throws(() => replaceVersion('{ "name": "app" }\n', jsonPattern, '0.2.0'), /no version field/)
})

test('a version that is already set gives the same text', () => {
  const text = '{ "version": "0.2.0" }\n'
  assert.deepEqual(replaceVersion(text, jsonPattern, '0.2.0'), { current: '0.2.0', text })
})
