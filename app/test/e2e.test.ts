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
    chain: '⚠ Chain data is not verified\nRPC endpoint https://rpc',
    simulation: '✓ Simulated on unverified chain state · 1 contract touched',
    verification: 'TetherToken\nSourcify ✓ verified\nLocal verification ✓ reproduced',
    clearSigning: 'Clear Signing ABI-Decoded Raw\nPreview: you trust no auditor yet\nSend 1 USDT',
    compare:
      '⚠ Onay found warnings in this request\nStep 1, Chain Data Verification: the chain data comes from an RPC endpoint, without proof\nNetwork 1 · Ethereum mainnet',
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
    'compare',
    'decoded',
    'raw',
    'simulation',
    'verdict',
    'verification',
  ])
  assert.equal(sections.chain, review.steps.chain)
  assert.equal(sections.verdict, 'Checks passed, with a warning.')
  // A step that is not there is left out.
  const { verification: _, ...rest } = review.steps
  assert.equal(sectionsOf({ steps: rest, done: true }, {}).verification, undefined)
})

test('a review passes when each section shows its text and none shows a failure', () => {
  const expected = {
    chain: ['⚠ Chain data is not verified'],
    simulation: ['1 contract touched'],
    verification: ['TetherToken', '✓ reproduced'],
    clearSigning: ['Send', '1 USDT', 'Preview'],
    decoded: ['transfer(address,uint256)'],
    compare: ['Step 1, Chain Data Verification'],
    verdict: ['Checks passed'],
    allow: ['without proof'],
  }
  assert.deepEqual(check(sections, expected), [])
  // A finding of the compare step that is not allowed is a problem, and
  // so is the reason of `fail`, with the notice of the page after it.
  const unverified =
    'Step 3, Source Code Verification: 0x02db…2c2c is called on the way and has no verified source code'
  const found = { ...sections, compare: `${sections.compare}\n${unverified}` }
  assert.deepEqual(check(found, expected), [`the review found: ${unverified}`])
  const none = {
    ...sections,
    clearSigning:
      'No Clear Signing\nNo ERC-7730 descriptor is registered for this contract, so there is no reviewed description.',
  }
  assert.deepEqual(check(none, { ...expected, clearSigning: [], fail: 'no descriptor' }), [
    'no descriptor · No ERC-7730 descriptor is registered for this contract',
  ])
})

test('a review fails for a missing text, a forbidden text, and a missing section', () => {
  const failing: Sections = {
    ...sections,
    simulation: '⚠ The transaction reverts in simulation',
    clearSigning: 'rendering failed · offline',
    verdict: 'A check failed.',
  }
  delete failing.verification
  assert.deepEqual(
    check(failing, { simulation: ['✓ Simulated on'], clearSigning: ['Send'], allow: ['without proof'] }),
    [
      'simulation does not show "✓ Simulated on"',
      'simulation shows "⚠ The transaction"',
      'verification is missing',
      'clearSigning does not show "Send"',
      'clearSigning shows "rendering failed"',
      'verdict shows "A check failed"',
    ],
  )
  // The caller can allow a text.
  assert.deepEqual(
    check(
      failing,
      { allow: ['without proof'] },
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
  assert.deepEqual(check(preview, { allow: ['not attested', 'without proof'] }), ['clearSigning shows "✕"'])
  assert.deepEqual(check(preview, { allow: ['not attested', 'fetch failed', 'without proof'] }), [])
})

const transaction: Transaction = {
  id: 'token-send',
  name: 'Token: send 1',
  params: {
    from: '0xf977814e90da44bfa03b6295a0616a897441acec',
    to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    data: '0xa9059cbb0001',
    value: '0x2386f26fc10000',
  },
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
      mainFile: 'contracts/Token.sol',
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
    compare: { digest: '0xd1ge57' },
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
  const texts = textsOf(transaction, 'helios')
  assert.deepEqual(texts.chain, [
    '✓ Chain data verified by Helios',
    'chain id 1 matches ✓',
    'eth_getCode 0xdac17f958d2ee523a2206206994597c13d831ec7 · 100 bytes',
    'creation transaction 0x2f1c…9190 · block 4,634,748',
    '2/2 contracts verified ✓',
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
    'Runtime bytecode\n✓ exact match',
    'Creation bytecode\n✓ match · the metadata hash differs',
    'solc 0.8.20+commit.a1b2c3d4 · optimizer 200 runs',
    '2 files · contracts/\u200bToken.sol',
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
  assert.deepEqual(texts.raw, [
    '0xf977814e90da44bfa03b6295a0616a897441acec',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    '0.01 ETH',
    '0xa9059cbb0001',
  ])
  // Helios proved the chain and an auditor attested the descriptor: no
  // warning. The addresses carry their checksum.
  assert.deepEqual(texts.compare, [
    'Check that your wallet shows the same values.',
    'Ethereum mainnet',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '0.01 ETH',
    'transfer · 0xa9059cbb',
    '0xd1ge57',
    '0xF977814e90dA44bFA03b6295A0616a897441aceC',
  ])
  assert.deepEqual(texts.verdict, ['You pasted eth_sendTransaction', 'All checks passed.'])
  assert.deepEqual(texts.allow, [])
})

test('a preview without value, parameters, token or name words the texts so', () => {
  const preview: Transaction = {
    ...transaction,
    params: { ...transaction.params, data: '0xd0e30db0', value: undefined },
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
  const texts = textsOf(preview, 'rpc')
  assert.equal(texts.chain![0], '⚠ Chain data is not verified')
  assert.ok(!texts.simulation!.includes('0 ETH'))
  assert.ok(texts.verification!.includes('solc 0.8.20+commit.a1b2c3d4 · optimizer off'))
  assert.deepEqual(texts.clearSigning, [
    'Interacting with W by W',
    'Wrap',
    'ERC-7730 descriptor by W from the registry · attestation not confirmed',
    'rendered with registry/w/w.json · preview',
  ])
  assert.deepEqual(texts.decoded, ['deposit · 0xd0e30db0', 'no parameters'])
  assert.deepEqual(texts.raw!.slice(2), ['0 ETH', '0xd0e30db0'])
  // The RPC endpoint and the preview are the two warnings.
  assert.deepEqual(texts.compare!.slice(0, 3), [
    '⚠ Onay found warnings in this request',
    'Step 1, Chain Data Verification: the chain data comes from an RPC endpoint, without proof',
    'Step 4, Clear Signing: the descriptor is a preview, since you trust no auditor yet',
  ])
  assert.deepEqual(texts.verdict, ['You pasted eth_sendTransaction', 'All checks passed.'])
  assert.deepEqual(texts.allow, [
    'Step 1, Chain Data Verification: the chain data comes from an RPC endpoint, without proof',
    'Step 4, Clear Signing: the descriptor is a preview, since you trust no auditor yet',
    'not attested by a trusted auditor',
  ])
  assert.equal(texts.fail, undefined)
})

test('a contract without a descriptor expects the notice of the registry, and no preview warning', () => {
  const texts = textsOf({ ...transaction, expect: { ...transaction.expect, clearSigning: null } }, 'rpc')
  assert.deepEqual(texts.clearSigning, ['No ERC-7730 descriptor is registered for this contract'])
  assert.deepEqual(texts.compare!.slice(0, 3), [
    '⚠ Onay found warnings in this request',
    'Step 1, Chain Data Verification: the chain data comes from an RPC endpoint, without proof',
    'Ethereum mainnet',
  ])
  assert.deepEqual(texts.allow, [
    'Step 1, Chain Data Verification: the chain data comes from an RPC endpoint, without proof',
    'not rendered · No descriptor found',
  ])
  assert.equal(texts.fail, 'no ERC-7730 descriptor in the registry for this contract')
  assert.deepEqual(check({ ...sections, compare: 'x' }, texts).slice(0, 1), [texts.fail])
})

test('a contract that another contract created has no creation block and no creation compare', () => {
  const internal: Transaction = {
    ...transaction,
    expect: {
      ...transaction.expect,
      chain: { ...transaction.expect.chain, creation: { ...transaction.expect.chain.creation, block: null } },
      verification: { ...transaction.expect.verification, creation: null },
    },
  }
  const texts = textsOf(internal, 'helios')
  assert.ok(texts.chain!.includes('creation transaction 0x2f1c…9190 · not read · created by another contract'))
  assert.ok(texts.verification!.includes('claims exact match'))
  assert.ok(texts.verification!.includes('Creation bytecode\nnot compared · created by another contract'))
  const none = {
    ...internal,
    expect: { ...internal.expect, verification: { ...internal.expect.verification, creation: 'none' as const } },
  }
  assert.ok(textsOf(none, 'helios').verification!.includes('claims match'))
  assert.ok(
    textsOf(none, 'helios').verification!.includes(
      'Creation bytecode\nnot compared · the input of the transaction is not the recompiled creation bytecode',
    ),
  )
})

test('a file parses into a transaction with the ID of its name, and a wrong shape names the file', () => {
  const { id: _, ...json } = transaction
  assert.deepEqual(parseTransaction('token-send', json), transaction)
  const wrong = (patch: Record<string, unknown>, message: RegExp) =>
    assert.throws(() => parseTransaction('bad', { ...json, ...patch }), message)
  assert.throws(() => parseTransaction('bad', null), /transactions\/bad\.json: not an object/)
  wrong({ name: '' }, /"name" must be a string/)
  wrong({ params: { ...json.params, to: 'dac1' } }, /"params.to" must be hex/)
  wrong({ params: { ...json.params, value: 12 } }, /"params.value" must be hex/)
  wrong({ expect: { ...json.expect, decoded: undefined } }, /"expect.decoded" must be an object/)
  wrong({ expect: { ...json.expect, clearSigning: 'none' } }, /"expect.clearSigning" must be an object or null/)
  assert.equal(
    parseTransaction('none', { ...json, expect: { ...json.expect, clearSigning: null } }).expect.clearSigning,
    null,
  )
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
