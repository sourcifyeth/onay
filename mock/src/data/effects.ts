/**
 * Mock data for the effects preview of the simulation step (issue #34). It holds only what a
 * generic run gives for any transaction: the ETH balance of each changed account, each written
 * storage slot with its name from the storage layout, and the decoded events. The card knows no
 * token standard: a storage layout descriptor (ERC-8317) can add labels and formats, as data. The storage slots are real: keccak256
 * of the keys and the slots of the real layouts of USDC (FiatTokenV2_2), WETH9, a Uniswap V2 pair
 * and BAYC (OpenZeppelin 3 ERC721).
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
  /** the value that another simulator got for this slot at the same block, when it differs */
  other?: { source: string; after: string }
}

/** an ERC-7730 formatter, as ERC-8317 uses it for the keys and the values of a variable */
export interface Formatter {
  format: 'raw' | 'addressName' | 'tokenAmount' | 'nftName' | 'date'
  params?: { token?: string; threshold?: string; message?: string; collection?: string; encoding?: 'timestamp' }
}

/** the display annotations of one ERC-8317 storage entry */
export interface Display extends Partial<Formatter> {
  /** may hold {key[N]} and {index[N]} */
  label?: string
  description?: string
  /** keyFormats[N] formats {key[N]}; null leaves a key as it is */
  keyFormats?: (Formatter | null)[]
}

/** one ERC-8317 storage entry; members holds the displays of its struct members by member path */
export interface DescriptorEntry {
  label: string
  slot: string
  offset: number
  type: string
  display?: Display
  members?: Record<string, Display>
}

/** an ERC-8317 storage layout descriptor, and where Onay found it */
export interface StorageDescriptor {
  file: string
  /** the auditors you trust that attested it (ERC-8176); empty: it shows as a preview */
  attestedBy: string[]
  /** Onay checks label, slot, offset and type of each entry against the layout of its recompile */
  storage: DescriptorEntry[]
}

export interface ContractChanges {
  address: string
  name: string
  /** where the variable names come from */
  layout: string
  descriptor?: StorageDescriptor
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

export type SourceState =
  | { kind: 'same' }
  | { kind: 'differs'; count: number }
  /** seconds it had already run when the review opened */
  | { kind: 'running'; since: number }
  | { kind: 'failed'; reason: string }
  | { kind: 'off' }
  /** the source answered for another block, so nothing was compared */
  | { kind: 'other-block'; block: number }
  /** the source gives no state diff, only its own verdict */
  | { kind: 'verdict'; text: string }

export interface CrossSource {
  name: string
  /** the icon of the service */
  icon: string
  /** the backend and the methods */
  via: string
  state: SourceState
  /** which parts of the result the comparison covers */
  compared?: string
  /** what the source received from Onay */
  received?: string
  link?: { text: string; url: string }
}

export interface Effects {
  /** the block whose state the first run used */
  block: number
  notice?: { title: string; text: string }
  /** names for addresses: your own, ENS names, verified contract names, the address book */
  labels: Record<string, string>
  /** symbol() and decimals() of each token that a tokenAmount format names: the token's own claims */
  tokens?: Record<string, { ticker: string; decimals: number }>
  balances: BalanceChange[]
  storage: ContractChanges[]
  /** slots that the run wrote and then set back to their old value */
  restored: string[]
  events: EventRow[]
  sources: CrossSource[]
}

const YOU = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'
const ALICE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const PAIR = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'
const BAYC = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
const ZERO = '0x0000000000000000000000000000000000000000'

const BLOCK = 25_904_112
const MAX_UINT = ((1n << 256n) - 1n).toString()

const labels: Record<string, string> = {
  [YOU]: 'you',
  [ALICE]: 'alice.eth',
  [PAIR]: 'ExamplePair',
  [PERMIT2]: 'Permit2',
  [ROUTER]: 'ExampleRouter',
  [WETH]: 'WETH9',
  [USDC]: 'USDC',
  [BAYC]: 'BoredApeYachtClub',
}

const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`
const addressWord = (address: string) => `0x${address.slice(2).padStart(64, '0')}`

const blocksec: CrossSource = {
  name: 'BlockSec Phalcon',
  icon: 'sources/blocksec.ico',
  via: 'simulation API · your key',
  state: { kind: 'same' },
  compared: 'revert, calls, events',
  received: 'sender, calldata, value, gas',
  link: { text: 'Open in Phalcon Explorer ↗', url: 'https://app.blocksec.com/explorer' },
}

const tenderly: CrossSource = {
  name: 'Tenderly',
  icon: 'sources/tenderly.ico',
  via: 'simulation API · your key',
  state: { kind: 'same' },
  compared: 'storage, ETH balances, revert',
  received: 'sender, calldata, value',
  link: { text: 'Open in Tenderly ↗', url: 'https://dashboard.tenderly.co' },
}

const blockaid: CrossSource = {
  name: 'Blockaid',
  icon: 'sources/blockaid.svg',
  via: 'scan API · your key',
  state: { kind: 'off' },
  received: 'sender, calldata, value, site',
}

const usdcDescriptor: StorageDescriptor = {
  file: 'registry/example/storage-FiatTokenV2_2.json',
  attestedBy: [],
  storage: [
    {
      label: 'balanceAndBlacklistStates',
      slot: '9',
      offset: 0,
      type: 't_mapping(t_address,t_uint256)',
      display: {
        label: 'Balance of {key[0]}',
        keyFormats: [{ format: 'addressName' }],
        format: 'tokenAmount',
        params: { token: USDC },
      },
    },
    {
      label: 'allowed',
      slot: '10',
      offset: 0,
      type: 't_mapping(t_address,t_mapping(t_address,t_uint256))',
      display: {
        label: 'Allowance of {key[1]} granted by {key[0]}',
        keyFormats: [{ format: 'addressName' }, { format: 'addressName' }],
        format: 'tokenAmount',
        params: {
          token: USDC,
          threshold: '0x8000000000000000000000000000000000000000000000000000000000000000',
          message: 'Unlimited',
        },
      },
    },
  ],
}

const wethDescriptor: StorageDescriptor = {
  file: 'registry/example/storage-WETH9.json',
  attestedBy: ['ExampleAudits'],
  storage: [
    {
      label: 'balanceOf',
      slot: '3',
      offset: 0,
      type: 't_mapping(t_address,t_uint256)',
      display: {
        label: 'Balance of {key[0]}',
        keyFormats: [{ format: 'addressName' }],
        format: 'tokenAmount',
        params: { token: WETH },
      },
    },
  ],
}

// a file for this one pair: ERC-8317 cannot point to token0 and token1 in storage
const pairDescriptor: StorageDescriptor = {
  file: 'registry/example/storage-ExamplePair-usdc-weth.json',
  attestedBy: ['ExampleAudits'],
  storage: [
    {
      label: 'reserve0',
      slot: '8',
      offset: 0,
      type: 't_uint112',
      display: { label: 'USDC reserve', format: 'tokenAmount', params: { token: USDC } },
    },
    {
      label: 'reserve1',
      slot: '8',
      offset: 14,
      type: 't_uint112',
      display: { label: 'WETH reserve', format: 'tokenAmount', params: { token: WETH } },
    },
    {
      label: 'blockTimestampLast',
      slot: '8',
      offset: 28,
      type: 't_uint32',
      display: { label: 'Last update', format: 'date', params: { encoding: 'timestamp' } },
    },
    { label: 'price0CumulativeLast', slot: '9', offset: 0, type: 't_uint256', display: { label: 'Price sum 0' } },
    { label: 'price1CumulativeLast', slot: '10', offset: 0, type: 't_uint256', display: { label: 'Price sum 1' } },
  ],
}

const ape = { format: 'nftName', params: { collection: BAYC } } as const

const baycDescriptor: StorageDescriptor = {
  file: 'registry/example/storage-BoredApeYachtClub.json',
  attestedBy: [],
  storage: [
    {
      label: '_holderTokens',
      slot: '1',
      offset: 0,
      type: 't_mapping(t_address,t_struct(UintSet))',
      display: { label: 'Apes of {key[0]}', keyFormats: [{ format: 'addressName' }] },
      members: {
        '_inner._values.length': { label: 'count' },
        '_inner._values': { label: 'item {index[0]}', ...ape },
        '_inner._indexes': { label: 'position of {key[1]}', keyFormats: [null, ape] },
      },
    },
    {
      label: '_tokenOwners',
      slot: '2',
      offset: 0,
      type: 't_struct(UintToAddressMap)',
      display: { label: 'Owners' },
      members: {
        '_inner._entries': { label: 'entry {index[0]}' },
        '_inner._entries._value': { label: 'owner', format: 'addressName' },
      },
    },
  ],
}

const tokens = {
  [USDC]: { ticker: 'USDC', decimals: 6 },
  [WETH]: { ticker: 'WETH', decimals: 18 },
  [BAYC]: { ticker: 'BAYC', decimals: 0 },
}

const P0 = 2_953_104_558_208_271_044_016_612_493_187_705_398_452_118_402n
const P1 = 8_610_227_004_917_552_310_086_442_908_336_904_113n

const swapStorage: ContractChanges[] = [
  {
    address: USDC,
    name: 'USDC (FiatTokenProxy)',
    layout: 'storage of the proxy, named with the layout of its implementation FiatTokenV2_2 0x4350…02dd',
    descriptor: usdcDescriptor,
    rows: [
      {
        path: [{ name: 'balanceAndBlacklistStates' }, { key: YOU, type: 'address' }],
        type: 'uint256',
        before: '1250000000',
        after: '5121500834',
        slot: '0x3b990ce11dc2a5a37f328d5a2df46cf5f5d7e1fc283a61249637b83912e51dde',
        derivation: `keccak256(${YOU} . 9)`,
      },
      {
        path: [{ name: 'balanceAndBlacklistStates' }, { key: PAIR, type: 'address' }],
        type: 'uint256',
        before: '41213577512345',
        after: '41209706011511',
        slot: '0x28c0947f463362aab09a2d7896ccc847fb7e52633a16b978fb2caf3db1a9b8f8',
        derivation: `keccak256(${PAIR} . 9)`,
      },
    ],
  },
  {
    address: WETH,
    name: 'WETH9',
    layout: 'named with the layout of WETH9',
    descriptor: wethDescriptor,
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
    layout: 'named with the layout of ExamplePair',
    descriptor: pairDescriptor,
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

export const swapEffects: Effects = {
  block: BLOCK,
  labels,
  tokens,
  balances: [
    { address: YOU, before: '3200000000000000000', after: '2200000000000000000' },
    { address: WETH, before: '2912004530000000000000000', after: '2912005530000000000000000' },
  ],
  storage: swapStorage,
  restored: [
    'ExamplePair · unlocked: 1 → 0 → 1',
    'WETH9 · balanceOf[ExampleRouter]: 0 → 1,000,000,000,000,000,000 → 0',
  ],
  events: swapEvents,
  sources: [tenderly, blocksec, { ...blockaid, state: { kind: 'verdict', text: 'Benign' } }],
}

export const swapDisagreeEffects: Effects = {
  ...swapEffects,
  notice: {
    title: 'The simulators disagree',
    text: 'Tenderly gets another USDC balance for you. Do not sign until you know why.',
  },
  storage: swapStorage.map((contract) =>
    contract.address !== USDC
      ? contract
      : {
          ...contract,
          rows: contract.rows.map((row, i) =>
            i === 0 ? { ...row, other: { source: 'Tenderly', after: '4354180000' } } : row,
          ),
        },
  ),
  sources: [
    { ...tenderly, state: { kind: 'differs', count: 1 } },
    blocksec,
    { ...blockaid, state: { kind: 'running', since: 4 } },
  ],
}

export const approveEffects: Effects = {
  block: BLOCK,
  labels,
  tokens,
  balances: [],
  storage: [
    {
      address: USDC,
      name: 'USDC (FiatTokenProxy)',
      layout: 'storage of the proxy, named with the layout of its implementation FiatTokenV2_2 0x4350…02dd',
      descriptor: usdcDescriptor,
      rows: [
        {
          path: [{ name: 'allowed' }, { key: YOU, type: 'address' }, { key: PERMIT2, type: 'address' }],
          type: 'uint256',
          before: '0',
          after: MAX_UINT,
          slot: '0xb10dd4fa44a5fb5594a47e291cc213aa0e20096996933a0e4ca7e0945e3ef70c',
          derivation: `keccak256(${PERMIT2} . keccak256(${YOU} . 10))`,
        },
      ],
    },
  ],
  restored: [],
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
  sources: [
    { ...tenderly, state: { kind: 'other-block', block: BLOCK - 3 } },
    blocksec,
    { ...blockaid, state: { kind: 'verdict', text: 'Benign' } },
  ],
}

const holderTokens = (holder: string): Segment[] => [
  { name: '_holderTokens' },
  { key: holder, type: 'address' },
  { member: '_inner' },
]

export const nftEffects: Effects = {
  block: BLOCK,
  labels,
  tokens,
  balances: [],
  storage: [
    {
      address: BAYC,
      name: 'BoredApeYachtClub',
      layout: 'named with the layout of BoredApeYachtClub',
      descriptor: baycDescriptor,
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
  restored: [],
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
  sources: [{ ...tenderly, state: { kind: 'failed', reason: 'no answer in 10 s' } }, blocksec, blockaid],
}
