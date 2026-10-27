// The pure parts of the end-to-end tests: the WebDriver client over a
// fake transport, and the check of a review against a transaction.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseTransaction, requestOf, textsOf, type Transaction } from '../e2e/expect.ts'
import { loadTransactions } from '../e2e/transactions.ts'
import { check, dump, FORBIDDEN, sectionsOf, type Review, type Sections } from '../e2e/page.ts'
import { Session, waitFor, waitForServer, WebDriverError, type Fetch } from '../e2e/webdriver.ts'

type Call = { url: string; method: string; body: unknown }

// A server that answers each call from a list, and records the calls.
function server(answers: { status?: number; value: unknown }[]): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined })
    const answer = answers.shift() ?? { status: 404, value: { error: 'unknown command', message: 'no answer' } }
    return new Response(JSON.stringify({ value: answer.value }), { status: answer.status ?? 200 })
  }
  return { fetch, calls }
}

test('a session is opened with the capabilities under alwaysMatch, scripted, reloaded, and closed', async () => {
  const { fetch, calls } = server([
    { value: { sessionId: 's1', capabilities: {} } },
    { value: { value: 42 } },
    { value: null },
    { value: null },
  ])
  const session = await Session.open('http://d', { 'tauri:options': { application: '/bin/onay' } }, fetch)
  assert.deepEqual(calls[0], {
    url: 'http://d/session',
    method: 'POST',
    body: { capabilities: { alwaysMatch: { 'tauri:options': { application: '/bin/onay' } } } },
  })

  assert.equal(await session.execute<number>('return arguments[0] + 1', [41]), 42)
  const executed = calls[1]
  assert.equal(executed.url, 'http://d/session/s1/execute/async')
  const body = executed.body as { script: string; args: unknown[] }
  assert.deepEqual(body.args, [41])
  // The script is the body of an async function; the last argument
  // takes the result.
  assert.match(body.script, /arguments\[arguments\.length - 1\]/)
  assert.match(body.script, /return arguments\[0\] \+ 1/)

  await session.refresh()
  assert.equal(calls[2].url, 'http://d/session/s1/refresh')
  await session.close()
  assert.deepEqual([calls[3].url, calls[3].method], ['http://d/session/s1', 'DELETE'])
})

test('a page script that failed is reported with its error', async () => {
  const { fetch } = server([{ value: { sessionId: 's1' } }, { value: { error: 'TypeError: boom' } }])
  const session = await Session.open('http://d', {}, fetch)
  await assert.rejects(session.execute('throw new TypeError("boom")'), /the page script failed: TypeError: boom/)
})

test('an error of the driver keeps its code and message', async () => {
  const { fetch } = server([{ status: 500, value: { error: 'session not created', message: 'no binary' } }])
  await assert.rejects(Session.open('http://d', {}, fetch), (error: unknown) => {
    assert.ok(error instanceof WebDriverError)
    assert.equal(error.code, 'session not created')
    assert.match(error.message, /no binary/)
    return true
  })
})

test('an answer that is not JSON is an error, and a session without an ID too', async () => {
  const broken: Fetch = async () => new Response('<html>', { status: 200 })
  await assert.rejects(Session.open('http://d', {}, broken), /answered HTTP 200/)
  const { fetch } = server([{ value: {} }])
  await assert.rejects(Session.open('http://d', {}, fetch), /no ID/)
})

test('the server is awaited until its status answers, within the time', async () => {
  let asked = 0
  const fetch: Fetch = async () => {
    asked += 1
    if (asked < 3) throw new Error('refused')
    return new Response('{"value":{"ready":true}}')
  }
  const slept: number[] = []
  const sleep = async (ms: number) => {
    slept.push(ms)
  }
  await waitForServer('http://d', 10_000, fetch, sleep)
  assert.equal(asked, 3)
  assert.deepEqual(slept, [200, 200])

  let now = 0
  const clock = async (ms: number) => {
    now += ms
  }
  const never: Fetch = async () => {
    throw new Error('refused')
  }
  const realNow = Date.now
  Date.now = () => realNow() + now
  try {
    await assert.rejects(waitForServer('http://d', 1000, never, clock), /no WebDriver server/)
  } finally {
    Date.now = realNow
  }
})

test('waitFor gives the first value that is not null or false', async () => {
  const values: (number | null | false)[] = [null, false, 0, 7]
  const slept: number[] = []
  const value = await waitFor(
    async () => values.shift() ?? null,
    10_000,
    'a number',
    async (ms) => {
      slept.push(ms)
    },
    50,
  )
  // Zero is a value.
  assert.equal(value, 0)
  assert.deepEqual(slept, [50, 50])
})

const review: Review = {
  steps: {
    1: { title: 'Chain Data Verification', text: '⚠ Chain data is not verified\nRPC endpoint https://rpc' },
    2: { title: 'Transaction Simulation', text: '✓ Simulated on unverified chain state · 1 contract touched' },
    3: { title: 'Source Code Verification', text: 'TetherToken\nSourcify ✓ verified\nLocal verification ✓ reproduced' },
    4: {
      title: 'Clear Signing',
      text: 'Clear Signing ABI-Decoded Raw\nPreview: you trust no auditor yet\nSend 1 USDT',
    },
  },
  done: true,
}

const sections: Sections = sectionsOf(review, {
  decoded: 'transfer(address,uint256)',
  raw: 'to 0xdac1',
  verdict: 'Checks passed, with a warning.',
})

test('the sections are the steps by name, plus the rest', () => {
  assert.deepEqual(Object.keys(sections).sort(), [
    'chain',
    'clearSigning',
    'decoded',
    'raw',
    'simulation',
    'verdict',
    'verification',
  ])
  assert.equal(sections.chain, review.steps[1].text)
  assert.equal(sections.verdict, 'Checks passed, with a warning.')
  // A step that is not there is left out.
  const { 3: _, ...rest } = review.steps
  assert.equal(sectionsOf({ steps: rest, done: true }, {}).verification, undefined)
})

test('a review passes when each section shows its text and none shows a failure', () => {
  const expected = {
    chain: ['⚠ Chain data is not verified'],
    simulation: ['1 contract touched'],
    verification: ['TetherToken', '✓ reproduced'],
    clearSigning: ['Send', '1 USDT', 'Preview'],
    decoded: ['transfer(address,uint256)'],
    verdict: ['Checks passed'],
  }
  assert.deepEqual(check(sections, expected), [])
})

test('a review fails for a missing text, a forbidden text, and a missing section', () => {
  const failing: Sections = {
    ...sections,
    simulation: '⚠ The transaction reverts in simulation',
    clearSigning: 'rendering failed · offline',
    verdict: 'A check failed.',
  }
  delete failing.verification
  assert.deepEqual(check(failing, { simulation: ['✓ Simulated on'], clearSigning: ['Send'] }), [
    'simulation does not show "✓ Simulated on"',
    'simulation shows "⚠ The transaction"',
    'verification is missing',
    'clearSigning does not show "Send"',
    'clearSigning shows "rendering failed"',
    'verdict shows "A check failed"',
  ])
  // The caller can allow a text.
  assert.deepEqual(
    check(
      failing,
      {},
      FORBIDDEN.filter((text) => text !== '⚠ The transaction' && text !== 'A check failed'),
    ),
    ['verification is missing', 'clearSigning shows "rendering failed"'],
  )
})

test('the dump lists each section by name, in order', () => {
  const text = dump(sections)
  assert.match(text, /^--- chain\n⚠ Chain data/)
  assert.match(text, /\n\n--- verdict\nChecks passed/)
})

test('a line with an allowed text may show forbidden text', () => {
  const preview: Sections = {
    ...sections,
    clearSigning: 'ABI-Decoded\nSend\nrendered as a preview · not attested ✕\nfetch failed ✕',
  }
  assert.deepEqual(check(preview, { allow: ['not attested'] }), ['clearSigning shows "✕"'])
  assert.deepEqual(check(preview, { allow: ['not attested', 'fetch failed'] }), [])
})

const transaction: Transaction = {
  id: 'token-send',
  name: 'Token: send 1',
  params: { from: '0xf1', to: '0xc0', data: '0xa9059cbb0001', value: '0x2386f26fc10000' },
  expect: {
    chain: {
      codeBytes: 100,
      creation: { transaction: '0x2f1c5c2b44f771e942a8506148e256f94f1a464babc938ae0690c6e34cd79190', block: 4634748 },
    },
    simulation: { frame: { name: 'Token', selector: '0xa9059cbb' }, messages: 1, touched: 2, accounts: 3, slots: 1 },
    verification: {
      name: 'Token',
      compiler: '0.8.20+commit.a1b2c3d4',
      optimizer: 200,
      files: 2,
      mainFile: 'Token.sol',
      runtime: 'perfect',
      creation: 'partial',
    },
    clearSigning: {
      descriptor: 'registry/token/calldata-token.json',
      owner: 'Token Ltd',
      contractName: 'Token',
      intent: 'Send',
      fields: { Amount: '1 TKN', To: 'name.eth' },
      attested: true,
      token: { symbol: 'TKN', decimals: 18 },
      ens: 'name.eth',
    },
    decoded: {
      function: 'transfer',
      params: { _to: { type: 'address', value: '0xd8dA' }, _value: { type: 'uint256', value: '1' } },
    },
    verdict: 'All checks passed.',
  },
}

test('the request of a transaction is a pasted eth_sendTransaction on mainnet', () => {
  assert.deepEqual(requestOf(transaction), {
    method: 'eth_sendTransaction',
    params: [{ ...transaction.params, chainId: '0x1' }],
    signed: false,
  })
})

test('the texts of a transaction are the facts as the page words them', () => {
  const texts = textsOf(transaction)
  assert.deepEqual(texts.chain, [
    'chain id 1 matches ✓',
    'eth_getCode 0xc0 · 100 bytes',
    'creation transaction 0x2f1c…9190 · block 4,634,748',
    '1/1 contracts verified ✓',
  ])
  assert.deepEqual(texts.simulation, [
    '✓ Simulated on',
    '2 contracts touched',
    'Token',
    '0xa9059cbb',
    '0.01 ETH',
    'executed · 1 message ✓',
    'state read · 3 accounts · 1 storage slot ·',
    'call tree · 2 contracts ✓',
  ])
  assert.deepEqual(texts.verification, [
    'Token',
    'claims match',
    '✓ verified',
    '✓ reproduced',
    'solc 0.8.20+commit.a1b2c3d4 · optimizer 200 runs',
    '2 files · Token.sol',
    'sha256 matches the official list ✓',
    'runtime bytecode compare · exact match ✓',
    'creation bytecode compare · match · the metadata hash differs',
  ])
  assert.deepEqual(texts.clearSigning, [
    'Interacting with Token by Token Ltd',
    'Send',
    'Amount',
    '1 TKN',
    'To',
    'name.eth',
    'ERC-7730 descriptor by Token Ltd from the registry · attested by an auditor you trust',
    'rendered with registry/token/calldata-token.json',
    'TKN · 18 decimals',
    'name.eth · forward record matches',
  ])
  assert.deepEqual(texts.decoded, ['transfer · 0xa9059cbb', '_to address', '0xd8dA', '_value uint256', '1'])
  assert.deepEqual(texts.raw, ['0xf1', '0xc0', '0.01 ETH', '0xa9059cbb0001'])
  assert.deepEqual(texts.verdict, ['You pasted eth_sendTransaction', 'All checks passed.'])
  assert.deepEqual(texts.allow, [])
})

test('a preview without value, parameters, token or name words the texts so', () => {
  const preview: Transaction = {
    ...transaction,
    params: { from: '0xf1', to: '0xc0', data: '0xd0e30db0' },
    expect: {
      ...transaction.expect,
      verification: { ...transaction.expect.verification, optimizer: false },
      clearSigning: {
        descriptor: 'registry/w/w.json',
        owner: 'W',
        contractName: 'W',
        intent: 'Wrap',
        fields: {},
        attested: false,
      },
      decoded: { function: 'deposit', params: {} },
    },
  }
  const texts = textsOf(preview)
  assert.ok(!texts.simulation!.includes('0 ETH'))
  assert.ok(texts.verification!.includes('solc 0.8.20+commit.a1b2c3d4 · optimizer off'))
  assert.deepEqual(texts.clearSigning, [
    'Interacting with W by W',
    'Wrap',
    'ERC-7730 descriptor by W from the registry · attestation not confirmed',
    'rendered with registry/w/w.json · preview',
  ])
  assert.deepEqual(texts.decoded, ['deposit · 0xd0e30db0', 'no parameters'])
  assert.deepEqual(texts.raw, ['0xf1', '0xc0', '0 ETH', '0xd0e30db0'])
  assert.deepEqual(texts.allow, ['not attested by a trusted auditor'])
})

test('a file parses into a transaction with the ID of its name, and a wrong shape names the file', () => {
  const { id: _, ...json } = transaction
  assert.deepEqual(parseTransaction('token-send', json), transaction)
  const wrong = (patch: Record<string, unknown>, message: RegExp) =>
    assert.throws(() => parseTransaction('bad', { ...json, ...patch }), message)
  assert.throws(() => parseTransaction('bad', null), /transactions\/bad\.json: not an object/)
  wrong({ name: '' }, /"name" must be a string/)
  wrong({ params: { ...json.params, to: 'c0' } }, /"params.to" must be hex/)
  wrong({ params: { ...json.params, value: 12 } }, /"params.value" must be hex/)
  wrong({ expect: { ...json.expect, decoded: undefined } }, /"expect.decoded" must be an object/)
  wrong({ expect: { ...json.expect, verdict: 1 } }, /"expect.verdict" must be a string/)
})

test('the files of the suite load, sorted by name', () => {
  const loaded = loadTransactions()
  assert.ok(loaded.length >= 2)
  assert.deepEqual(
    loaded.map((entry) => entry.id),
    [...loaded.map((entry) => entry.id)].sort(),
  )
  for (const entry of loaded) assert.equal(entry.params.to.length, 42)
})
