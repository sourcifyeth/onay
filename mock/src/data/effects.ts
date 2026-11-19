/**
 * Mock data for the effects preview of the simulation step (issue #34). The card shows what the
 * transaction does to your assets: what you send, what you receive, and what you allow others to
 * spend. The run finds the tokens from the contracts whose storage it wrote, and measures each
 * change with balanceOf and allowance before and after. The state changes and the events are the
 * raw result of the run, for the advanced view. The storage slots are real: keccak256 of the keys
 * and the slots of the real layouts of USDC (FiatTokenV2_2), WETH9, a Uniswap V2 pair and BAYC
 * (OpenZeppelin 3 ERC721).
 */

/** one step of the path to a storage variable, as the storage layout describes it */
export type Segment =
  /** a state variable of the contract */
  | { name: string }
  /** a member of a struct, or the length of a dynamic array */
  | { member: string }
  /** the key of a mapping, recovered from the keccak256 inputs of the run; the type is from the layout */
  | { key: string; type: string }
  /** the element of an array */
  | { index: number }

/** one written slot; values are raw: decimal for integers, 0x hex for addresses and bytes */
export interface StorageRow {
  /** null: the storage layout names no variable at this slot */
  path: Segment[] | null
  /** the Solidity type from the layout */
  type: string
  before: string
  after: string
  slot: string
  /** how the slot follows from the layout and the keys */
  derivation: string
}

export interface ContractChanges {
  address: string
  name: string
  rows: StorageRow[]
}

/** the native balance of one account, in wei */
export interface BalanceChange {
  address: string
  before: string
  after: string
}

export interface EventRow {
  contract: string
  name: string
  /** name, ABI type, raw value */
  args: [string, string, string][]
}

export type Asset = { kind: 'native' } | { kind: 'erc20'; token: string } | { kind: 'nft'; token: string; id: string }

/** one asset of yours that the run changes: balanceOf (or the ETH balance) after, minus before */
export interface AssetChange {
  asset: Asset
  /** signed, raw: negative for what you send */
  delta: string
  /** the other account, only when the call of the request is itself the transfer */
  counterparty?: string
}

/** a right over your assets that the run gives to a spender */
export interface Permission {
  token: string
  spender: string
  /** amount: an ERC-20 allowance. all: every NFT of the collection. one: one NFT. */
  kind: 'amount' | 'all' | 'one'
  /** the allowance before and after, raw; for all and one: '0' or '1' */
  before: string
  after: string
  /** the NFT, for kind one */
  id?: string
  /** your balance of the token after the run, raw */
  balance?: string
}

/** what the token says about itself, and what Onay knows about the token */
export interface TokenInfo {
  /** symbol(), name() and decimals(): the token's own claims */
  ticker: string
  name: string
  decimals: number
  /** the Sourcify gate reproduced the code of the token */
  verified: boolean
  /** the token list of yours that holds it: a claim of the publisher of the list */
  list?: string
  /** dollars for one whole token, from the price source: a claim. Absent: the source has no price. */
  price?: number
}

/** ok: the source answered. off: turned off in the settings. error: the source did not answer. */
export type Prices = 'ok' | 'off' | { error: string }

/** the price source: a free API with no key. It learns which tokens the request moves. */
export const PRICE_SOURCE = 'DefiLlama'

export type Outcome =
  | { kind: 'done' }
  | { kind: 'running' }
  | { kind: 'reverted'; reason: string; where: string }
  | { kind: 'failed'; reason: string }

export interface Effects {
  /** the block whose state the first run used */
  block: number
  outcome: Outcome
  /** names for addresses: your own, ENS names, verified contract names, the address book */
  labels: Record<string, string>
  tokens: Record<string, TokenInfo>
  assets: AssetChange[]
  permissions: Permission[]
  /** gas used times the gas price of the request, in wei */
  fee: string
  prices: Prices
  /** dollars for one ETH, from the price source */
  ethPrice?: number
  warnings: { title: string; text: string }[]
  /** the advanced view: the raw result of the run */
  balances: BalanceChange[]
  storage: ContractChanges[]
  /** slots that the run wrote and then set back to their old value */
  restored: string[]
  events: EventRow[]
}

const YOU = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'
const ALICE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const BOB = '0x41f28389f545521bdcbd88a75e0a6b45c4fa9a03'
const PAIR = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'
const BAYC = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
const MARKET = '0x00000000000000adc04c56bf30ac9d3c0aaf14dc'
const GOVERNOR = '0x323a76393544d5ecca80cd6ef2a560c6a395b7e3'
const REWARDS = '0x5b1869d9a4c187f2eaa108f3062412ecf0526b24'
const DRAINER = '0x6d2e03b7effeae98bd302a9f836d0d6ab0002766'
const FAKE_USDC = '0x3c9e1a7f5b20d84c6f01de92b7a45c318e6f2b91'
const SHIBX = '0x8a3d77e9d6968b780564936d15b09805827c21fa'
const SELLER = '0x2f71129b240080c638ac8d993bff52169e3551c3'
const ZERO = '0x0000000000000000000000000000000000000000'

const BLOCK = 25_904_112
const MAX_UINT = ((1n << 256n) - 1n).toString()
const FEE = '2140000000000000'

const labels: Record<string, string> = {
  [YOU]: 'you',
  [ALICE]: 'alice.eth',
  [PAIR]: 'ExamplePair',
  [PERMIT2]: 'Permit2',
  [ROUTER]: 'ExampleRouter',
  [WETH]: 'WETH9',
  [USDC]: 'USDC',
  [BAYC]: 'BoredApeYachtClub',
  [MARKET]: 'ExampleMarket',
  [GOVERNOR]: 'ExampleGovernor',
}

const DEFAULT_LIST = 'Uniswap Labs Default'

const tokens: Record<string, TokenInfo> = {
  [USDC]: { ticker: 'USDC', name: 'USD Coin', decimals: 6, verified: true, list: DEFAULT_LIST, price: 0.99975 },
  [WETH]: { ticker: 'WETH', name: 'Wrapped Ether', decimals: 18, verified: true, list: DEFAULT_LIST, price: 1989.29 },
  [BAYC]: { ticker: 'BAYC', name: 'BoredApeYachtClub', decimals: 0, verified: true },
  [FAKE_USDC]: { ticker: 'USDC', name: 'USD Coin', decimals: 6, verified: false },
  [SHIBX]: { ticker: 'SHIBX', name: 'Shiba X', decimals: 18, verified: false },
}

const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`
const addressWord = (address: string) => `0x${address.slice(2).padStart(64, '0')}`

const base = {
  block: BLOCK,
  outcome: { kind: 'done' } as Outcome,
  labels,
  tokens,
  assets: [] as AssetChange[],
  permissions: [] as Permission[],
  fee: FEE,
  prices: 'ok' as Prices,
  ethPrice: 1991.18,
  warnings: [] as Effects['warnings'],
  balances: [] as BalanceChange[],
  storage: [] as ContractChanges[],
  restored: [] as string[],
  events: [] as EventRow[],
}

/** your ETH balance: 3.2 ETH before, then the value and the fee go */
const yourEth = (value: bigint): BalanceChange => ({
  address: YOU,
  before: '3200000000000000000',
  after: (3_200_000_000_000_000_000n - value - BigInt(FEE)).toString(),
})

const usdcBalance = (holder: string, before: bigint, after: bigint, slot: string): StorageRow => ({
  path: [{ name: 'balanceAndBlacklistStates' }, { key: holder, type: 'address' }],
  type: 'uint256',
  before: before.toString(),
  after: after.toString(),
  slot,
  derivation: `keccak256(${holder} . 9)`,
})

const YOUR_USDC_SLOT = '0x3b990ce11dc2a5a37f328d5a2df46cf5f5d7e1fc283a61249637b83912e51dde'
const USDC_NAME = 'USDC (FiatTokenProxy)'

const P0 = 2_953_104_558_208_271_044_016_612_493_187_705_398_452_118_402n
const P1 = 8_610_227_004_917_552_310_086_442_908_336_904_113n

const swapStorage: ContractChanges[] = [
  {
    address: USDC,
    name: USDC_NAME,
    rows: [
      usdcBalance(YOU, 1_250_000_000n, 5_121_500_834n, YOUR_USDC_SLOT),
      usdcBalance(
        PAIR,
        41_213_577_512_345n,
        41_209_706_011_511n,
        '0x28c0947f463362aab09a2d7896ccc847fb7e52633a16b978fb2caf3db1a9b8f8',
      ),
    ],
  },
  {
    address: WETH,
    name: 'WETH9',
    rows: [
      {
        path: [{ name: 'balanceOf' }, { key: PAIR, type: 'address' }],
        type: 'uint256',
        before: '10612441700000000000000',
        after: '10613441700000000000000',
        slot: '0xb374801ace2c02f5db0425ab5920a2b7ed1d5a00abbcd395fda7530ba1d666c0',
        derivation: `keccak256(${PAIR} . 3)`,
      },
    ],
  },
  {
    address: PAIR,
    name: 'ExamplePair',
    rows: [
      {
        path: [{ name: 'reserve0' }],
        type: 'uint112',
        before: '41213577512345',
        after: '41209706011511',
        slot: '0x8',
        derivation: 'slot 8 · offset 0 · 14 bytes, shared with reserve1 and blockTimestampLast',
      },
      {
        path: [{ name: 'reserve1' }],
        type: 'uint112',
        before: '10612441700000000000000',
        after: '10613441700000000000000',
        slot: '0x8',
        derivation: 'slot 8 · offset 14 · 14 bytes',
      },
      {
        path: [{ name: 'blockTimestampLast' }],
        type: 'uint32',
        before: '1788459612',
        after: '1788459720',
        slot: '0x8',
        derivation: 'slot 8 · offset 28 · 4 bytes',
      },
      {
        path: [{ name: 'price0CumulativeLast' }],
        type: 'uint256',
        before: P0.toString(),
        after: (P0 + 144_123_908_447_201_356_932_817_400_917_284_555_132n).toString(),
        slot: '0x9',
        derivation: 'slot 9',
      },
      {
        path: [{ name: 'price1CumulativeLast' }],
        type: 'uint256',
        before: P1.toString(),
        after: (P1 + 8_517_330_016_284_211_096_409_662n).toString(),
        slot: '0xa',
        derivation: 'slot 10',
      },
    ],
  },
]

const swapEvents: EventRow[] = [
  {
    contract: 'WETH9',
    name: 'Deposit',
    args: [
      ['dst', 'address', ROUTER],
      ['wad', 'uint256', '1000000000000000000'],
    ],
  },
  {
    contract: 'WETH9',
    name: 'Transfer',
    args: [
      ['src', 'address', ROUTER],
      ['dst', 'address', PAIR],
      ['wad', 'uint256', '1000000000000000000'],
    ],
  },
  {
    contract: 'USDC',
    name: 'Transfer',
    args: [
      ['from', 'address', PAIR],
      ['to', 'address', YOU],
      ['value', 'uint256', '3871500834'],
    ],
  },
  {
    contract: 'ExamplePair',
    name: 'Sync',
    args: [
      ['reserve0', 'uint112', '41209706011511'],
      ['reserve1', 'uint112', '10613441700000000000000'],
    ],
  },
  {
    contract: 'ExamplePair',
    name: 'Swap',
    args: [
      ['sender', 'address', ROUTER],
      ['amount0In', 'uint256', '0'],
      ['amount1In', 'uint256', '1000000000000000000'],
      ['amount0Out', 'uint256', '3871500834'],
      ['amount1Out', 'uint256', '0'],
      ['to', 'address', YOU],
    ],
  },
]

const ONE_ETH = 1_000_000_000_000_000_000n

export const swapEffects: Effects = {
  ...base,
  assets: [
    { asset: { kind: 'native' }, delta: (-ONE_ETH).toString() },
    { asset: { kind: 'erc20', token: USDC }, delta: '3871500834' },
  ],
  balances: [
    yourEth(ONE_ETH),
    { address: WETH, before: '2912004530000000000000000', after: '2912005530000000000000000' },
  ],
  storage: swapStorage,
  restored: [
    'ExamplePair · unlocked: 1 → 0 → 1',
    'WETH9 · balanceOf[ExampleRouter]: 0 → 1,000,000,000,000,000,000 → 0',
  ],
  events: swapEvents,
}

/** a plain transfer of USDC from you to alice.eth */
export function usdcTransferEffects(amount: bigint): Effects {
  return {
    ...base,
    assets: [{ asset: { kind: 'erc20', token: USDC }, delta: (-amount).toString(), counterparty: ALICE }],
    balances: [yourEth(0n)],
    storage: [
      {
        address: USDC,
        name: USDC_NAME,
        rows: [
          usdcBalance(YOU, 1_250_000_000n, 1_250_000_000n - amount, YOUR_USDC_SLOT),
          usdcBalance(
            ALICE,
            12_000_000n,
            12_000_000n + amount,
            '0x1f21a62c4538bacf2aabeca410f0fe63151869f172e03c0e00357ba26a341eff',
          ),
        ],
      },
    ],
    events: [
      {
        contract: 'USDC',
        name: 'Transfer',
        args: [
          ['from', 'address', YOU],
          ['to', 'address', ALICE],
          ['value', 'uint256', amount.toString()],
        ],
      },
    ],
  }
}

const HALF_ETH = ONE_ETH / 2n

export const ethTransferEffects: Effects = {
  ...base,
  fee: '441000000000000',
  assets: [{ asset: { kind: 'native' }, delta: (-HALF_ETH).toString(), counterparty: BOB }],
  balances: [
    { address: YOU, before: '3200000000000000000', after: '2699559000000000000' },
    { address: BOB, before: '81200000000000000', after: '581200000000000000' },
  ],
}

const allowanceRow = (spender: string, after: string): StorageRow => ({
  path: [{ name: 'allowed' }, { key: YOU, type: 'address' }, { key: spender, type: 'address' }],
  type: 'uint256',
  before: '0',
  after,
  slot: '0xb10dd4fa44a5fb5594a47e291cc213aa0e20096996933a0e4ca7e0945e3ef70c',
  derivation: `keccak256(${spender} . keccak256(${YOU} . 10))`,
})

export const approveEffects: Effects = {
  ...base,
  permissions: [{ token: USDC, spender: PERMIT2, kind: 'amount', before: '0', after: MAX_UINT, balance: '1250000000' }],
  balances: [yourEth(0n)],
  storage: [{ address: USDC, name: USDC_NAME, rows: [allowanceRow(PERMIT2, MAX_UINT)] }],
  events: [
    {
      contract: 'USDC',
      name: 'Approval',
      args: [
        ['owner', 'address', YOU],
        ['spender', 'address', PERMIT2],
        ['value', 'uint256', MAX_UINT],
      ],
    },
  ],
}

const holderTokens = (holder: string): Segment[] => [
  { name: '_holderTokens' },
  { key: holder, type: 'address' },
  { member: '_inner' },
]

export const nftEffects: Effects = {
  ...base,
  assets: [{ asset: { kind: 'nft', token: BAYC, id: '3941' }, delta: '-1', counterparty: ALICE }],
  balances: [yourEth(0n)],
  storage: [
    {
      address: BAYC,
      name: 'BoredApeYachtClub',
      rows: [
        {
          path: [...holderTokens(YOU), { member: '_values' }, { member: 'length' }],
          type: 'uint256',
          before: '3',
          after: '2',
          slot: '0xf481cd796efe196d554625fd038f95ee436af5bbe16dc8ed48ba1e584ede60f3',
          derivation: `keccak256(${YOU} . 1)`,
        },
        {
          path: [...holderTokens(YOU), { member: '_values' }, { index: 0 }],
          type: 'bytes32',
          before: word(3941n),
          after: word(512n),
          slot: '0x03c44c870b66016ac1cfed654f657e31e3e7e71490577eb10a40f28ec70c767f',
          derivation: `keccak256(keccak256(${YOU} . 1)) + 0`,
        },
        {
          path: [...holderTokens(YOU), { member: '_values' }, { index: 2 }],
          type: 'bytes32',
          before: word(512n),
          after: word(0n),
          slot: '0x03c44c870b66016ac1cfed654f657e31e3e7e71490577eb10a40f28ec70c7681',
          derivation: `keccak256(keccak256(${YOU} . 1)) + 2`,
        },
        {
          path: [...holderTokens(YOU), { member: '_indexes' }, { key: word(512n), type: 'bytes32' }],
          type: 'uint256',
          before: '3',
          after: '1',
          slot: '0x2283cc83535cb6ea7d500a2e6fa20380c2332dea974de982dc7bbf3d40830f7b',
          derivation: `keccak256(${word(512n)} . keccak256(${YOU} . 1) + 1)`,
        },
        {
          path: [...holderTokens(YOU), { member: '_indexes' }, { key: word(3941n), type: 'bytes32' }],
          type: 'uint256',
          before: '1',
          after: '0',
          slot: '0x360748ed19528a53a260a129098ff4ba83ef08907718bc1b036627c8ce6f1e87',
          derivation: `keccak256(${word(3941n)} . keccak256(${YOU} . 1) + 1)`,
        },
        {
          path: [...holderTokens(ALICE), { member: '_values' }, { member: 'length' }],
          type: 'uint256',
          before: '1',
          after: '2',
          slot: '0xb931be0b3d1fb06daf0d92e2b8dfe49ead9172e102b3af1e07a10cc29003beb2',
          derivation: `keccak256(${ALICE} . 1)`,
        },
        {
          path: [...holderTokens(ALICE), { member: '_values' }, { index: 1 }],
          type: 'bytes32',
          before: word(0n),
          after: word(3941n),
          slot: '0x2e5e333bf528a04126a200be9e3e9436f6f56f2dcda97c4ad96fd5bcfb690dc9',
          derivation: `keccak256(keccak256(${ALICE} . 1)) + 1`,
        },
        {
          path: [...holderTokens(ALICE), { member: '_indexes' }, { key: word(3941n), type: 'bytes32' }],
          type: 'uint256',
          before: '0',
          after: '2',
          slot: '0xf2c5e36671d8293edd10152e5bfa5db0432feba039790ca9dd9f26c7e178be42',
          derivation: `keccak256(${word(3941n)} . keccak256(${ALICE} . 1) + 1)`,
        },
        {
          path: [
            { name: '_tokenOwners' },
            { member: '_inner' },
            { member: '_entries' },
            { index: 3941 },
            { member: '_value' },
          ],
          type: 'bytes32',
          before: addressWord(YOU),
          after: addressWord(ALICE),
          slot: '0x405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb7999',
          derivation: 'keccak256(2) + 2 × 3941 + 1 · each entry takes 2 slots, _value is the second',
        },
      ],
    },
  ],
  events: [
    {
      contract: 'BoredApeYachtClub',
      name: 'Approval',
      args: [
        ['owner', 'address', YOU],
        ['approved', 'address', ZERO],
        ['tokenId', 'uint256', '3941'],
      ],
    },
    {
      contract: 'BoredApeYachtClub',
      name: 'Transfer',
      args: [
        ['from', 'address', YOU],
        ['to', 'address', ALICE],
        ['tokenId', 'uint256', '3941'],
      ],
    },
  ],
}

export const revertEffects: Effects = {
  ...base,
  outcome: { kind: 'reverted', reason: 'Router: INSUFFICIENT_OUTPUT', where: 'ExampleRouter' },
}

/* the cases below have no request in the mock: the page of the simulation step shows them */

const PRICE = 44_000_000_000_000_000n

const purchaseEffects: Effects = {
  ...base,
  fee: '3980000000000000',
  assets: [
    { asset: { kind: 'native' }, delta: (-PRICE).toString() },
    { asset: { kind: 'nft', token: BAYC, id: '2757' }, delta: '1' },
  ],
  balances: [
    yourEth(PRICE),
    { address: SELLER, before: '912000000000000000', after: '954900000000000000' },
    { address: MARKET, before: '0', after: '1100000000000000' },
  ],
  storage: [
    {
      address: BAYC,
      name: 'BoredApeYachtClub',
      rows: [
        {
          path: [
            { name: '_tokenOwners' },
            { member: '_inner' },
            { member: '_entries' },
            { index: 2757 },
            { member: '_value' },
          ],
          type: 'bytes32',
          before: addressWord(SELLER),
          after: addressWord(YOU),
          slot: '0x405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb705a',
          derivation: 'keccak256(2) + 2 × 2757 + 1',
        },
      ],
    },
    {
      address: MARKET,
      name: 'ExampleMarket',
      rows: [
        {
          path: [{ name: '_orderStatus' }, { key: word(0x51c3n << 200n), type: 'bytes32' }],
          type: 'uint256',
          before: '0',
          after: '1',
          slot: '0x8d1108e10bcb7c27dddfc02ed9d693a074039d026cf4ea4240b40f7d581ac802',
          derivation: 'keccak256(orderHash . 1)',
        },
      ],
    },
  ],
  events: [
    {
      contract: 'BoredApeYachtClub',
      name: 'Transfer',
      args: [
        ['from', 'address', SELLER],
        ['to', 'address', YOU],
        ['tokenId', 'uint256', '2757'],
      ],
    },
    {
      contract: 'ExampleMarket',
      name: 'OrderFulfilled',
      args: [
        ['offerer', 'address', SELLER],
        ['recipient', 'address', YOU],
      ],
    },
  ],
}

const PROPOSAL = 29869795646732068004798516302146892294228731133327210892747948610417217569076n

const voteEffects: Effects = {
  ...base,
  fee: '1310000000000000',
  balances: [yourEth(0n)],
  storage: [
    {
      address: GOVERNOR,
      name: 'ExampleGovernor',
      rows: [
        {
          path: [
            { name: '_proposalVotes' },
            { key: PROPOSAL.toString(), type: 'uint256' },
            { member: 'hasVoted' },
            { key: YOU, type: 'address' },
          ],
          type: 'bool',
          before: 'false',
          after: 'true',
          slot: '0xb3f999697e5551250906566ac54b77be094974fd38051769f0cc22ca36e50592',
          derivation: `keccak256(${YOU} . keccak256(proposalId . 2) + 3)`,
        },
        {
          path: [{ name: '_proposalVotes' }, { key: PROPOSAL.toString(), type: 'uint256' }, { member: 'forVotes' }],
          type: 'uint256',
          before: '1396758455623187220621672',
          after: '1404230999547515018699429',
          slot: '0xbaee6b494d7ecca664eea6fc1a945b69e66c684276fae37c66630ed8de5fdf30',
          derivation: 'keccak256(proposalId . 2) + 1',
        },
      ],
    },
  ],
  events: [
    {
      contract: 'ExampleGovernor',
      name: 'VoteCast',
      args: [
        ['voter', 'address', YOU],
        ['proposalId', 'uint256', PROPOSAL.toString()],
        ['support', 'uint8', '1'],
        ['weight', 'uint256', '7472543924327798077757'],
      ],
    },
  ],
}

/** the request calls claim() on a contract with no sources; the run gives all your apes away */
const hiddenApprovalEffects: Effects = {
  ...base,
  labels: { ...labels, [REWARDS]: 'unverified contract' },
  permissions: [{ token: BAYC, spender: DRAINER, kind: 'all', before: '0', after: '1', balance: '3' }],
  balances: [yourEth(0n)],
  storage: [
    {
      address: BAYC,
      name: 'BoredApeYachtClub',
      rows: [
        {
          path: [{ name: '_operatorApprovals' }, { key: YOU, type: 'address' }, { key: DRAINER, type: 'address' }],
          type: 'bool',
          before: 'false',
          after: 'true',
          slot: '0x7c2a8f0ce0b1b6a0b0b5f1d7dfb3a4d1c1b1f0c6a3e3e2f7a1c8f5d2e4b6a901',
          derivation: `keccak256(${DRAINER} . keccak256(${YOU} . 5))`,
        },
      ],
    },
  ],
  events: [
    {
      contract: 'BoredApeYachtClub',
      name: 'ApprovalForAll',
      args: [
        ['owner', 'address', YOU],
        ['operator', 'address', DRAINER],
        ['approved', 'bool', 'true'],
      ],
    },
  ],
}

/** a contract that names itself USDC emits a Transfer to you, and changes no balance */
const fakeEventEffects: Effects = {
  ...base,
  warnings: [
    {
      title: 'An event says that you receive 5,000 USDC, but your balance does not change',
      text: `The contract ${FAKE_USDC.slice(0, 6)}…${FAKE_USDC.slice(-4)} emitted the event. It is not the USDC of your token list, and its sources are not verified. Its balanceOf gives the same answer for you before and after.`,
    },
  ],
  balances: [yourEth(0n)],
  storage: [
    {
      address: FAKE_USDC,
      name: 'unverified contract',
      rows: [
        {
          path: null,
          type: 'uint256',
          before: '0',
          after: '1',
          slot: '0x0000000000000000000000000000000000000000000000000000000000000004',
          derivation: 'no storage layout: the contract is not verified',
        },
      ],
    },
  ],
  events: [
    {
      contract: 'unverified contract',
      name: 'Transfer',
      args: [
        ['from', 'address', ZERO],
        ['to', 'address', YOU],
        ['value', 'uint256', '5000000000'],
      ],
    },
  ],
}

/** the swap, but the token that arrives has no verified sources and is on no list */
const unknownTokenEffects: Effects = {
  ...swapEffects,
  assets: [
    { asset: { kind: 'native' }, delta: (-ONE_ETH).toString() },
    { asset: { kind: 'erc20', token: SHIBX }, delta: '48211350000000000000000000' },
  ],
  storage: [
    {
      address: SHIBX,
      name: 'unverified contract',
      rows: [
        {
          path: null,
          type: 'uint256',
          before: '0',
          after: '48211350000000000000000000',
          slot: '0x1a7b4a2c6f1c5d6f8e0b3a9d2c4e6f8a0b1c3d5e7f9a1b3c5d7e9f0a2b4c6d8e',
          derivation: 'no storage layout: the contract is not verified',
        },
      ],
    },
    ...swapStorage.slice(1),
  ],
  events: swapEvents.filter((event) => event.contract !== 'USDC'),
}

export interface EffectsCase {
  id: string
  label: string
  /** what the request does, and what to look at */
  note: string
  effects: Effects
  rpc?: boolean
}

export const effectsCases: EffectsCase[] = [
  { id: 'swap', label: 'swap', note: 'Swap 1 ETH for USDC on a router.', effects: swapEffects },
  {
    id: 'transfer',
    label: 'ERC-20 transfer',
    note: 'Send 250 USDC to alice.eth. The call is the transfer, so the row names the receiver.',
    effects: usdcTransferEffects(250_000_000n),
  },
  { id: 'eth', label: 'ETH transfer', note: 'Send 0.5 ETH to an account.', effects: ethTransferEffects },
  {
    id: 'approve',
    label: 'approve · unlimited',
    note: 'Approve Permit2 for USDC. No asset moves: the allowance is the effect.',
    effects: approveEffects,
  },
  { id: 'nft', label: 'NFT transfer', note: 'Send one ape to alice.eth.', effects: nftEffects },
  { id: 'purchase', label: 'NFT purchase', note: 'Buy an ape for 0.044 ETH on a market.', effects: purchaseEffects },
  {
    id: 'vote',
    label: 'DAO vote',
    note: 'Vote on a proposal. No asset moves and no allowance changes, but the governor writes storage.',
    effects: voteEffects,
  },
  {
    id: 'hidden-approval',
    label: 'claim · hidden approval',
    note: 'The site says "claim your reward". The call goes to a contract with no sources, and the run sets an approval for all your apes.',
    effects: hiddenApprovalEffects,
  },
  {
    id: 'fake-event',
    label: 'fake Transfer event',
    note: 'A contract emits a Transfer event that names you. No balance changes.',
    effects: fakeEventEffects,
  },
  {
    id: 'unknown-token',
    label: 'swap · unknown token',
    note: 'The token that arrives has no verified sources and is on none of your token lists.',
    effects: unknownTokenEffects,
  },
  {
    id: 'rpc',
    label: 'RPC mode',
    note: 'The same transfer on a chain in RPC mode: the state has no proof.',
    effects: usdcTransferEffects(100_000_000n),
    rpc: true,
  },
  {
    id: 'prices-failed',
    label: 'prices not fetched',
    note: 'The swap, but the price source did not answer. The amounts stay: they come from the local run.',
    effects: { ...swapEffects, prices: { error: 'no answer in 5 s' } },
  },
  {
    id: 'prices-off',
    label: 'prices off',
    note: 'The swap, with dollar values turned off in the settings. No request goes to the price source.',
    effects: { ...swapEffects, prices: 'off' },
  },
  { id: 'revert', label: 'reverts', note: 'The swap reverts in the run.', effects: revertEffects },
  {
    id: 'nothing',
    label: 'no change',
    note: 'A call that writes nothing.',
    effects: { ...base, fee: '462000000000000' },
  },
  {
    id: 'failed',
    label: 'could not simulate',
    note: 'The run did not end.',
    effects: { ...base, outcome: { kind: 'failed', reason: 'the simulation did not finish in 180 s' } },
  },
  {
    id: 'running',
    label: 'running',
    note: 'The run is not done yet.',
    effects: { ...base, outcome: { kind: 'running' } },
  },
]
