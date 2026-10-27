// The whole app over WebDriver: tauri-driver starts the window, the test
// feeds each transaction through the command of the e2e build and reads the
// review as a user would. It needs the e2e build (`pnpm build:e2e`),
// tauri-driver, and WebKitWebDriver on Linux; README.md has the setup.
// The run reads the real chain, Sourcify, and the registry.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ChainConfig } from '../src/chains.ts'
import {
  chainExpectation,
  check,
  CLICK,
  DISMISS_FIRST_REQUEST,
  dump,
  INJECT,
  OPEN_CARDS,
  PAGE_READY,
  READ_FIRST_REQUEST,
  READ_REVIEW,
  sectionsOf,
  SEED_SETTINGS,
  type Review,
} from './page.ts'
import { requestOf, textsOf } from './expect.ts'
import { loadTransactions } from './transactions.ts'
import { Session, waitFor, waitForServer } from './webdriver.ts'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { env } = process
const MODE = env.ONAY_E2E_MODE === 'helios' ? 'helios' : 'rpc'
const PORT = Number(env.ONAY_E2E_PORT ?? 4444)
const SERVER = `http://127.0.0.1:${PORT}`
// A review downloads a compiler build and simulates on chain state read
// over the network.
const REVIEW_TIMEOUT = 10 * 60_000

// The built-in chains of src/chains.ts. The page keeps a built-in chain
// that the settings do not name, so each one is named here, in RPC mode:
// a Helios client on a chain the transactions do not use would only spend the
// quota of its endpoint.
const CHAINS: ChainConfig[] = [
  {
    id: 1,
    name: 'Ethereum mainnet',
    mode: MODE,
    executionRpc: env.ONAY_E2E_RPC || 'https://eth.drpc.org',
    consensusRpc: 'https://ethereum-beacon-api.publicnode.com',
  },
  { id: 11155111, name: 'Sepolia', mode: 'rpc', executionRpc: 'https://sepolia.gateway.tenderly.co' },
  { id: 560048, name: 'Hoodi', mode: 'rpc', executionRpc: 'https://hoodi.drpc.org' },
  { id: 42161, name: 'Arbitrum One', mode: 'rpc', executionRpc: 'https://arb1.arbitrum.io/rpc' },
]
// The Helios chains among them: the first load starts them all.
const DEFAULT_HELIOS_CHAINS = [1, 11155111, 560048]

let dir: string
let driver: ChildProcess
let session: Session

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'onay-e2e-'))
  driver = spawn(env.ONAY_E2E_DRIVER ?? 'tauri-driver', ['--port', String(PORT), '--native-port', String(PORT + 1)], {
    env: {
      ...env,
      ONAY_E2E_DIR: dir,
      // WebKitGTK draws through the GPU process, which has no GPU on a
      // virtual display.
      WEBKIT_DISABLE_COMPOSITING_MODE: env.WEBKIT_DISABLE_COMPOSITING_MODE ?? '1',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitForServer(SERVER, 10_000)
  session = await Session.open(SERVER, {
    'tauri:options': { application: env.ONAY_E2E_APP ?? path.join(APP_DIR, 'target/debug/onay') },
  })
  await waitFor(() => session.execute<boolean>(PAGE_READY), 30_000, 'the page')
  await session.execute(SEED_SETTINGS, [CHAINS, [], DEFAULT_HELIOS_CHAINS])
  await session.refresh()
  await waitFor(() => session.execute<boolean>(PAGE_READY), 30_000, 'the page after the reload')
})

after(async () => {
  await session?.close().catch(() => {})
  // tauri-driver ends the native driver on an interrupt.
  driver?.kill('SIGINT')
  await rm(dir, { recursive: true, force: true })
})

for (const transaction of loadTransactions()) {
  test(transaction.name, { timeout: REVIEW_TIMEOUT + 60_000 }, async () => {
    await session.execute(INJECT, [requestOf(transaction)])
    const review = await waitFor(
      async () => {
        await session.execute(OPEN_CARDS)
        const review = await session.execute<Review>(READ_REVIEW)
        return review.done && review
      },
      REVIEW_TIMEOUT,
      `the review of "${transaction.name}"`,
    )
    // The other two tabs of the last step, then the entry on the list
    // with its verdict. The entry goes, so the list is empty for the
    // next transaction.
    const tab = async (label: string) => {
      await session.execute(CLICK, [label])
      return (await session.execute<Review>(READ_REVIEW)).steps[4]?.text
    }
    const decoded = await tab('ABI-Decoded')
    const raw = await tab('Raw')
    await session.execute(CLICK, ['← all requests'])
    const verdict = (await session.execute<string | null>(READ_FIRST_REQUEST)) ?? undefined
    const sections = sectionsOf(review, { decoded, raw, verdict })
    await session.execute(DISMISS_FIRST_REQUEST)
    // The text the test read, to write the expectations of a new transaction.
    if (env.ONAY_E2E_DUMP) console.log(`\n${dump(sections)}\n`)
    const texts = textsOf(transaction)
    const problems = check(sections, { ...texts, chain: [chainExpectation(MODE), ...texts.chain!] })
    assert.deepEqual(problems, [], `${transaction.name}\n${problems.join('\n')}\n\n${dump(sections)}`)
  })
}
