// The transactions of the suite: one JSON file each in transactions/,
// in the shape of `Transaction` in expect.ts. The name of the file is
// the ID of the request. Ethereum mainnet only, and only contracts with
// a descriptor in the ERC-7730 registry. Block numbers and the sizes of
// the registry and the token lists change, so no file names them.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTransaction, type Transaction } from './expect.ts'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'transactions')

export function loadTransactions(dir = DIR): Transaction[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const id = file.slice(0, -'.json'.length)
      return parseTransaction(id, JSON.parse(readFileSync(path.join(dir, file), 'utf8')))
    })
}
