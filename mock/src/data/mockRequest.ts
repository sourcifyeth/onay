export interface TxField {
  name: string
  value: string
  /**
   * Present when the descriptor field format is "calldata": the value is itself a call,
   * rendered with its own ERC-7730 descriptor (embeddedCalldata in the library). Recursive.
   */
  embedded?: {
    callee: string
    calleeName: string
    intent: string
    fields: TxField[]
  }
}

/** a piece of the interpolated intent sentence; value parts were generated from the calldata */
export interface IntentPart {
  text: string
  value?: boolean
}

export interface DecodedParam {
  name: string
  type: string
  value: string
}

/** calldata decoded against the ABI of the verified contract */
export interface DecodedCalldata {
  selector: string
  /** full signature with parameter names */
  signature: string
  params: DecodedParam[]
}

/**
 * ERC-7730 rendering, mirroring the DisplayModel of @ethereum-sourcify/clear-signing:
 * intent (the operation), fields, interpolatedIntent. Absent when nothing can render it.
 */
export interface ClearSigning {
  /** the descriptor intent, e.g. "Swap" */
  intent: string
  /** full sentence with formatted field values interpolated in */
  interpolatedIntent: IntentPart[]
  /** formatted fields: labels from the descriptor, values resolved */
  fields: TxField[]
  /** where this rendering came from, shown as a small provenance line */
  provenance?: { text: string; url?: string }
  warnings?: string[]
}

/** one call of an EIP-5792 batch, formatted independently */
export interface BatchCall {
  intent: string
  interpolatedIntent: IntentPart[]
  fields: TxField[]
  raw: TxField[]
  calldata: string
}

export interface MockContract {
  /** call-tree depth: 0 = entry point, children are 1 level deeper */
  depth: number
  address: string
  name: string
  matchType: 'exact match' | 'match' | 'no match'
  /** a full signature, or a bare name (e.g. an EIP-712 primary type) rendered without parentheses */
  functionSignature: string
  functionSource: string
  sources: string[]
}

export interface MockRequest {
  method: string
  origin: string
  via: string
  chain: string
  chainId: number
  chainMode: 'helios' | 'rpc'
  /** how the verification run ends */
  outcome: 'verified' | 'unverified' | 'reverted'
  revertReason?: string
  clearSigning?: ClearSigning
  /** raw transaction data as received */
  raw: TxField[]
  /** empty string for typed-data and batch requests */
  calldata: string
  /** ERC-8213 digest shown after confirm; absent for empty calldata and batches */
  digest?: { label: 'Calldata Digest' | 'EIP-712 Digest'; value: string }
  decoded?: DecodedCalldata
  /** present for eth_signTypedData_v4 requests */
  typedData?: { json: string; digests: TxField[] }
  /** present for wallet_sendCalls (EIP-5792) requests */
  batch?: { interpolatedIntent: IntentPart[]; calls: BatchCall[] }
  /** contracts touched by the transaction, as a call tree flattened depth-first */
  contracts: MockContract[]
}

export interface Scenario {
  id: string
  label: string
  request: MockRequest
}

const YOU = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'
const ALICE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const ROUTER = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const PAIR = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
const BAYC = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'

const REGISTRY_URL = 'https://github.com/ethereum/clear-signing-erc7730-registry'

const routerContract: MockContract = {
  depth: 0,
  address: ROUTER,
  name: 'ExampleRouter',
  matchType: 'exact match',
  functionSignature: 'swapExactETHForTokens(uint256, address[], address, uint256)',
  functionSource: `function swapExactETHForTokens(
    uint256 amountOutMin,
    address[] calldata path,
    address to,
    uint256 deadline
) external payable ensure(deadline) returns (uint256[] memory amounts) {
    // the request's entry point
    require(path[0] == WETH, "Router: INVALID_PATH");
    amounts = _getAmountsOut(msg.value, path);
    require(amounts[amounts.length - 1] >= amountOutMin, "Router: INSUFFICIENT_OUTPUT");
    IWETH(WETH).deposit{value: amounts[0]}();
    _swap(amounts, path, to);
}`,
  sources: ['contracts/ExampleRouter.sol', 'contracts/interfaces/IERC20.sol', 'lib/SafeTransfer.sol'],
}

const routerTokensContract: MockContract = {
  depth: 0,
  address: ROUTER,
  name: 'ExampleRouter',
  matchType: 'exact match',
  functionSignature: 'swapExactTokensForTokens(uint256, uint256, address[], address, uint256)',
  functionSource: `function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata path,
    address to,
    uint256 deadline
) external ensure(deadline) returns (uint256[] memory amounts) {
    amounts = _getAmountsOut(amountIn, path);
    require(amounts[amounts.length - 1] >= amountOutMin, "Router: INSUFFICIENT_OUTPUT");
    _safeTransferFrom(path[0], msg.sender, pairFor(path[0], path[1]), amounts[0]);
    _swap(amounts, path, to);
}`,
  sources: ['contracts/ExampleRouter.sol', 'contracts/interfaces/IERC20.sol', 'lib/SafeTransfer.sol'],
}

const wethContract: MockContract = {
  depth: 1,
  address: WETH,
  name: 'WETH9',
  matchType: 'match',
  functionSignature: 'deposit()',
  functionSource: `function deposit() public payable {
    balanceOf[msg.sender] += msg.value;
    emit Deposit(msg.sender, msg.value);
}`,
  sources: ['contracts/WETH9.sol'],
}

const pairContract: MockContract = {
  depth: 1,
  address: PAIR,
  name: 'ExamplePair (WETH/USDC)',
  matchType: 'exact match',
  functionSignature: 'swap(uint256, uint256, address, bytes)',
  functionSource: `function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external lock {
    require(amount0Out > 0 || amount1Out > 0, "Pair: INSUFFICIENT_OUTPUT_AMOUNT");
    (uint112 reserve0, uint112 reserve1, ) = getReserves();
    require(amount0Out < reserve0 && amount1Out < reserve1, "Pair: INSUFFICIENT_LIQUIDITY");
    if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
    if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);
    _update(balance0, balance1, reserve0, reserve1);
    emit Swap(msg.sender, amount0Out, amount1Out, to);
}`,
  sources: ['contracts/ExamplePair.sol', 'contracts/interfaces/IERC20.sol'],
}

const usdcSources = [
  'contracts/FiatTokenV2_2.sol',
  'contracts/FiatTokenV2.sol',
  'contracts/AbstractFiatTokenV2.sol',
]

const usdcTransferContract: MockContract = {
  depth: 0,
  address: USDC,
  name: 'FiatTokenV2_2 (USDC)',
  matchType: 'exact match',
  functionSignature: 'transfer(address, uint256)',
  functionSource: `function transfer(address to, uint256 value)
    external
    override
    whenNotPaused
    notBlacklisted(msg.sender)
    notBlacklisted(to)
    returns (bool)
{
    _transfer(msg.sender, to, value);
    return true;
}`,
  sources: usdcSources,
}

const swapCalldata =
  '0x7ff36ab5' +
  '00000000000000000000000000000000000000000000000000000000e5387e40' +
  '0000000000000000000000000000000000000000000000000000000000000080' +
  '0000000000000000000000009f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e' +
  '000000000000000000000000000000000000000000000000000000006a99bf78' +
  '0000000000000000000000000000000000000000000000000000000000000002' +
  '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' +
  '000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

export const mockRequest: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  clearSigning: {
    intent: 'Swap',
    interpolatedIntent: [
      { text: 'Swap ' },
      { text: '1 ETH', value: true },
      { text: ' for at least ' },
      { text: '3,845.68 USDC', value: true },
      { text: ' on ' },
      { text: 'ExampleRouter 0x7a25…488d', value: true },
      { text: ', deadline ' },
      { text: '20 minutes', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Amount to Send', value: '1 ETH' },
      { name: 'Minimum to Receive', value: '3,845.68 USDC' },
      { name: 'Beneficiary', value: 'you.eth (0x9f21…c04e)' },
      { name: 'Deadline', value: 'Sep 3, 2026, 18:42 UTC (in 20 minutes)' },
    ],
    provenance: { text: 'ERC-7730 descriptor by Example DEX, from the registry', url: REGISTRY_URL },
  },
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: ROUTER },
    { name: 'value', value: '0xde0b6b3a7640000 (1 ETH)' },
  ],
  calldata: swapCalldata,
  digest: {
    label: 'Calldata Digest',
    value: '0x8c1f27c3e5a9440d9b1a6f0e2d7c885e31b49a07d2c65f18e90b3a4d5c6e7f21',
  },
  decoded: {
    selector: '0x7ff36ab5',
    signature: 'swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
    params: [
      { name: 'amountOutMin', type: 'uint256', value: '3845684800 (3,845.68 USDC)' },
      { name: 'path', type: 'address[]', value: `[${WETH} (WETH), ${USDC} (USDC)]` },
      { name: 'to', type: 'address', value: `${YOU} (you.eth)` },
      { name: 'deadline', type: 'uint256', value: '1788460920 (Sep 3, 2026, 18:42 UTC)' },
    ],
  },
  contracts: [routerContract, wethContract, pairContract],
}

const tokenTransfer: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  clearSigning: {
    intent: 'Send',
    interpolatedIntent: [
      { text: 'Send ' },
      { text: '250 USDC', value: true },
      { text: ' to ' },
      { text: 'alice.eth 0xd8dA…6045', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Amount', value: '250 USDC' },
      { name: 'To', value: 'alice.eth (0xd8dA…6045)' },
    ],
    provenance: { text: 'ERC-7730 descriptor by Circle, from the registry', url: REGISTRY_URL },
  },
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: USDC },
    { name: 'value', value: '0x0' },
  ],
  calldata:
    '0xa9059cbb' +
    '000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045' +
    '000000000000000000000000000000000000000000000000000000000ee6b280',
  digest: {
    label: 'Calldata Digest',
    value: '0x4d7a91be08c6f1352e9d0aa8437cbb160f5e6d924a81c37059f2ed8ba0c15e83',
  },
  decoded: {
    selector: '0xa9059cbb',
    signature: 'transfer(address to, uint256 value)',
    params: [
      { name: 'to', type: 'address', value: `${ALICE} (alice.eth)` },
      { name: 'value', type: 'uint256', value: '250000000 (250 USDC)' },
    ],
  },
  contracts: [usdcTransferContract],
}

const ethTransfer: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  clearSigning: {
    intent: 'Send',
    interpolatedIntent: [
      { text: 'Send ' },
      { text: '0.5 ETH', value: true },
      { text: ' to ' },
      { text: 'bob.eth 0x41f2…9a03', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Amount', value: '0.5 ETH' },
      { name: 'To', value: 'bob.eth (0x41f2…9a03)' },
    ],
    provenance: { text: 'plain value transfer, rendered natively' },
  },
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: '0x41f28389f545521bdcbd88a75e0a6b45c4fa9a03' },
    { name: 'value', value: '0x6f05b59d3b20000 (0.5 ETH)' },
  ],
  calldata: '0x',
  contracts: [],
}

const approveUnlimited: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  clearSigning: {
    intent: 'Approve',
    interpolatedIntent: [
      { text: 'Approve ' },
      { text: 'unlimited', value: true },
      { text: ' ' },
      { text: 'USDC', value: true },
      { text: ' spending for ' },
      { text: 'Permit2 0x0000…8ba3', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Amount', value: 'Unlimited USDC' },
      { name: 'Spender', value: 'Permit2 (0x0000…8ba3)' },
    ],
    provenance: { text: 'ERC-7730 descriptor by Circle, from the registry', url: REGISTRY_URL },
    warnings: [
      'The approval is unlimited: until revoked, the spender can move any amount of your USDC at any time.',
    ],
  },
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: USDC },
    { name: 'value', value: '0x0' },
  ],
  calldata:
    '0x095ea7b3' +
    '000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba3' +
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  digest: {
    label: 'Calldata Digest',
    value: '0x71bd05c8a2e64f90d3187cbe5a42d6f10e98a3c47b52d80f6c1e9ba34d07f2c5',
  },
  decoded: {
    selector: '0x095ea7b3',
    signature: 'approve(address spender, uint256 value)',
    params: [
      { name: 'spender', type: 'address', value: `${PERMIT2} (Permit2)` },
      { name: 'value', type: 'uint256', value: '2^256 - 1 (unlimited)' },
    ],
  },
  contracts: [
    {
      depth: 0,
      address: USDC,
      name: 'FiatTokenV2_2 (USDC)',
      matchType: 'exact match',
      functionSignature: 'approve(address, uint256)',
      functionSource: `function approve(address spender, uint256 value)
    external
    override
    whenNotPaused
    notBlacklisted(msg.sender)
    notBlacklisted(spender)
    returns (bool)
{
    _approve(msg.sender, spender, value);
    return true;
}`,
      sources: usdcSources,
    },
  ],
}

const permitTypedData: MockRequest = {
  method: 'eth_signTypedData_v4',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  clearSigning: {
    intent: 'Permit',
    interpolatedIntent: [
      { text: 'Permit ' },
      { text: 'Uniswap Universal Router 0x66a9…a8af', value: true },
      { text: ' to spend up to ' },
      { text: '1,000 USDC', value: true },
      { text: ' until ' },
      { text: 'Oct 3, 2026', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Amount allowance', value: '1,000 USDC' },
      { name: 'Spender', value: 'Uniswap Universal Router (0x66a9…a8af)' },
      { name: 'Expiration', value: 'Oct 3, 2026 (in 30 days)' },
      { name: 'Signature deadline', value: 'Sep 3, 2026, 19:32 UTC (in 50 minutes)' },
    ],
    provenance: { text: 'ERC-7730 descriptor by Uniswap, from the registry', url: REGISTRY_URL },
  },
  raw: [
    { name: 'signer', value: YOU },
    { name: 'verifying contract', value: `${PERMIT2} (Permit2)` },
    { name: 'chainId', value: '1' },
    { name: 'primaryType', value: 'PermitSingle' },
  ],
  calldata: '',
  digest: {
    label: 'EIP-712 Digest',
    value: '0xf30a72e5c18d94b6a05c3ef8217db4906ea1f5c3708bd2e94a6d015f8c2ab7e4',
  },
  typedData: {
    json: `{
  "domain": {
    "name": "Permit2",
    "chainId": 1,
    "verifyingContract": "${PERMIT2}"
  },
  "primaryType": "PermitSingle",
  "message": {
    "details": {
      "token": "${USDC}",
      "amount": "1000000000",
      "expiration": 1791052920,
      "nonce": 0
    },
    "spender": "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
    "sigDeadline": 1788463920
  }
}`,
    digests: [
      { name: 'EIP-712 Digest', value: '0xf30a72e5c18d94b6a05c3ef8217db4906ea1f5c3708bd2e94a6d015f8c2ab7e4' },
      { name: 'Domain Hash', value: '0x866a5aba21966af95d6c7ab78eb2b2fc913915c28be3b9aa07cc04ff903e3f28' },
      { name: 'Message Hash', value: '0x4c1d92b850e3a7f6031ac2e97fdcd85e01b46a839f2ce7014d05b8a3e6f92d10' },
    ],
  },
  contracts: [
    {
      depth: 0,
      address: PERMIT2,
      name: 'Permit2',
      matchType: 'exact match',
      functionSignature: 'PermitSingle',
      functionSource: `struct PermitSingle {
    // the permission details: token, amount, expiration, nonce
    PermitDetails details;
    // who is allowed to spend
    address spender;
    // deadline for this signature itself
    uint256 sigDeadline;
}

struct PermitDetails {
    address token;
    uint160 amount;
    uint48 expiration;
    uint48 nonce;
}`,
      sources: ['contracts/Permit2.sol', 'contracts/AllowanceTransfer.sol', 'contracts/interfaces/IAllowanceTransfer.sol'],
    },
  ],
}

const batchRequest: MockRequest = {
  method: 'wallet_sendCalls',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'calls', value: '2' },
  ],
  calldata: '',
  batch: {
    interpolatedIntent: [
      { text: 'Approve ' },
      { text: '500 USDC', value: true },
      { text: ' for ' },
      { text: 'ExampleRouter 0x7a25…488d', value: true },
      { text: ' and Swap ' },
      { text: '500 USDC', value: true },
      { text: ' for at least ' },
      { text: '0.1285 ETH', value: true },
      { text: '.' },
    ],
    calls: [
      {
        intent: 'Approve',
        interpolatedIntent: [
          { text: 'Approve ' },
          { text: '500 USDC', value: true },
          { text: ' for ' },
          { text: 'ExampleRouter 0x7a25…488d', value: true },
          { text: '.' },
        ],
        fields: [
          { name: 'Amount', value: '500 USDC' },
          { name: 'Spender', value: 'ExampleRouter (0x7a25…488d)' },
        ],
        raw: [
          { name: 'to', value: USDC },
          { name: 'value', value: '0x0' },
        ],
        calldata:
          '0x095ea7b3' +
          '0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d' +
          '000000000000000000000000000000000000000000000000000000001dcd6500',
      },
      {
        intent: 'Swap',
        interpolatedIntent: [
          { text: 'Swap ' },
          { text: '500 USDC', value: true },
          { text: ' for at least ' },
          { text: '0.1285 ETH', value: true },
          { text: ' on ' },
          { text: 'ExampleRouter 0x7a25…488d', value: true },
          { text: '.' },
        ],
        fields: [
          { name: 'Amount to Send', value: '500 USDC' },
          { name: 'Minimum to Receive', value: '0.1285 ETH' },
          { name: 'Beneficiary', value: 'you.eth (0x9f21…c04e)' },
          { name: 'Deadline', value: 'Sep 3, 2026, 18:42 UTC (in 20 minutes)' },
        ],
        raw: [
          { name: 'to', value: ROUTER },
          { name: 'value', value: '0x0' },
        ],
        calldata:
          '0x38ed1739' +
          '000000000000000000000000000000000000000000000000000000001dcd6500' +
          '00000000000000000000000000000000000000000000000001c88611b5a34000' +
          '00000000000000000000000000000000000000000000000000000000000000a0' +
          '0000000000000000000000009f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e' +
          '000000000000000000000000000000000000000000000000000000006a99bf78' +
          '0000000000000000000000000000000000000000000000000000000000000002' +
          '000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' +
          '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      },
    ],
  },
  contracts: [
    {
      ...usdcTransferContract,
      functionSignature: 'approve(address, uint256)',
      functionSource: `function approve(address spender, uint256 value)
    external
    override
    whenNotPaused
    notBlacklisted(msg.sender)
    notBlacklisted(spender)
    returns (bool)
{
    _approve(msg.sender, spender, value);
    return true;
}`,
    },
    routerTokensContract,
    pairContract,
  ],
}

const SAFE = '0x4f8b2dc71a3ce63bd21e50e8f0c6a4de19b5d2e7'
const MULTISEND = '0x40a2accbd92bca938b02010e17a5b8929b49130d'

const safeNested: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'app.safe.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  clearSigning: {
    intent: 'Execute Safe transaction',
    interpolatedIntent: [
      { text: 'Execute a ' },
      { text: 'multi-send of 2 calls', value: true },
      { text: ' from your Safe ' },
      { text: '0x4f8b…d2e7', value: true },
      { text: ': Approve ' },
      { text: '500 USDC', value: true },
      { text: ' for ' },
      { text: 'ExampleRouter', value: true },
      { text: ' and Swap ' },
      { text: '500 USDC', value: true },
      { text: ' for at least ' },
      { text: '0.1285 ETH', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Safe', value: 'your Safe (0x4f8b…d2e7)' },
      { name: 'Operation', value: 'delegatecall' },
      {
        name: 'Data',
        value: '0x8d80ff0a… (466 bytes)',
        embedded: {
          callee: MULTISEND,
          calleeName: 'MultiSendCallOnly',
          intent: 'Multisend',
          fields: [
            {
              name: 'Call 1',
              value: '0x095ea7b3… (68 bytes)',
              embedded: {
                callee: USDC,
                calleeName: 'USDC',
                intent: 'Approve',
                fields: [
                  { name: 'Amount', value: '500 USDC' },
                  { name: 'Spender', value: 'ExampleRouter (0x7a25…488d)' },
                ],
              },
            },
            {
              name: 'Call 2',
              value: '0x38ed1739… (260 bytes)',
              embedded: {
                callee: ROUTER,
                calleeName: 'ExampleRouter',
                intent: 'Swap',
                fields: [
                  { name: 'Amount to Send', value: '500 USDC' },
                  { name: 'Minimum to Receive', value: '0.1285 ETH' },
                  { name: 'Beneficiary', value: 'your Safe (0x4f8b…d2e7)' },
                  { name: 'Deadline', value: 'Sep 3, 2026, 18:42 UTC (in 20 minutes)' },
                ],
              },
            },
          ],
        },
      },
    ],
    provenance: { text: 'ERC-7730 descriptors by Safe, Circle and Example DEX, from the registry', url: REGISTRY_URL },
  },
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: SAFE },
    { name: 'value', value: '0x0' },
  ],
  calldata:
    '0x6a761202' +
    '00000000000000000000000040a2accbd92bca938b02010e17a5b8929b49130d' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000140' +
    '0000000000000000000000000000000000000000000000000000000000000001' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000000001d2' +
    '8d80ff0a00a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48095ea7b3000000' +
    '7a250d5630b4cf539739df2c5dacb4c659f2488d38ed17390000000000000000',
  digest: {
    label: 'Calldata Digest',
    value: '0x5e93ab107f4c28d6be0a5f31c7d49e82f60d1b5a83c72e94015dfa68b3c40e97',
  },
  decoded: {
    selector: '0x6a761202',
    signature:
      'execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)',
    params: [
      { name: 'to', type: 'address', value: `${MULTISEND} (MultiSendCallOnly)` },
      { name: 'value', type: 'uint256', value: '0' },
      { name: 'data', type: 'bytes', value: '0x8d80ff0a… (466 bytes, the multiSend payload)' },
      { name: 'operation', type: 'uint8', value: '1 (delegatecall)' },
      { name: 'safeTxGas', type: 'uint256', value: '0' },
      { name: 'baseGas', type: 'uint256', value: '0' },
      { name: 'gasPrice', type: 'uint256', value: '0' },
      { name: 'gasToken', type: 'address', value: '0x0000000000000000000000000000000000000000' },
      { name: 'refundReceiver', type: 'address', value: '0x0000000000000000000000000000000000000000' },
      { name: 'signatures', type: 'bytes', value: '0x9c41f7e0… (65 bytes, 1 signature)' },
    ],
  },
  contracts: [
    {
      depth: 0,
      address: SAFE,
      name: 'GnosisSafe (v1.3.0)',
      matchType: 'match',
      functionSignature: 'execTransaction(address, uint256, bytes, uint8, uint256, uint256, uint256, address, address, bytes)',
      functionSource: `function execTransaction(
    address to,
    uint256 value,
    bytes calldata data,
    Enum.Operation operation,
    uint256 safeTxGas,
    uint256 baseGas,
    uint256 gasPrice,
    address gasToken,
    address payable refundReceiver,
    bytes memory signatures
) public payable virtual returns (bool success) {
    bytes32 txHash;
    {
        bytes memory txHashData = encodeTransactionData(
            to, value, data, operation, safeTxGas,
            baseGas, gasPrice, gasToken, refundReceiver, nonce
        );
        nonce++;
        txHash = keccak256(txHashData);
        checkSignatures(txHash, txHashData, signatures);
    }
    success = execute(to, value, data, operation, gasleft() - 2500);
    require(success || safeTxGas != 0 || gasPrice != 0, "GS013");
}`,
      sources: ['contracts/GnosisSafe.sol', 'contracts/base/Executor.sol', 'contracts/common/Enum.sol'],
    },
    {
      depth: 1,
      address: MULTISEND,
      name: 'MultiSendCallOnly',
      matchType: 'exact match',
      functionSignature: 'multiSend(bytes)',
      functionSource: `function multiSend(bytes memory transactions) public payable {
    assembly {
        let length := mload(transactions)
        let i := 0x20
        for { } lt(i, length) { } {
            let operation := shr(0xf8, mload(add(transactions, i)))
            let to := shr(0x60, mload(add(transactions, add(i, 0x01))))
            let value := mload(add(transactions, add(i, 0x15)))
            let dataLength := mload(add(transactions, add(i, 0x35)))
            let data := add(transactions, add(i, 0x55))
            // call only: delegatecall not allowed here
            let success := call(gas(), to, value, data, dataLength, 0, 0)
            if eq(success, 0) { revert(0, 0) }
            i := add(i, add(0x55, dataLength))
        }
    }
}`,
      sources: ['contracts/libraries/MultiSendCallOnly.sol'],
    },
    {
      ...usdcTransferContract,
      depth: 2,
      functionSignature: 'approve(address, uint256)',
      functionSource: `function approve(address spender, uint256 value)
    external
    override
    whenNotPaused
    notBlacklisted(msg.sender)
    notBlacklisted(spender)
    returns (bool)
{
    _approve(msg.sender, spender, value);
    return true;
}`,
    },
    { ...routerTokensContract, depth: 2 },
    { ...pairContract, depth: 3 },
  ],
}

const nftTransfer: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'market.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  clearSigning: {
    intent: 'Send NFT',
    interpolatedIntent: [
      { text: 'Send ' },
      { text: 'BAYC #3941', value: true },
      { text: ' to ' },
      { text: 'alice.eth 0xd8dA…6045', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Collection', value: 'Bored Ape Yacht Club (BAYC)' },
      { name: 'Token ID', value: '#3941' },
      { name: 'To', value: 'alice.eth (0xd8dA…6045)' },
    ],
    provenance: {
      text: 'no registry descriptor: rendered from the standard ERC-721 template, this collection is in your trusted token list',
    },
  },
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: BAYC },
    { name: 'value', value: '0x0' },
  ],
  calldata:
    '0x42842e0e' +
    '0000000000000000000000009f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e' +
    '000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045' +
    '0000000000000000000000000000000000000000000000000000000000000f65',
  digest: {
    label: 'Calldata Digest',
    value: '0x2f80cd47a1e6b53d98e02c7fa45b1d68390ce5a274f8b6e01dca9385f47e60b9',
  },
  decoded: {
    selector: '0x42842e0e',
    signature: 'safeTransferFrom(address from, address to, uint256 tokenId)',
    params: [
      { name: 'from', type: 'address', value: `${YOU} (you.eth)` },
      { name: 'to', type: 'address', value: `${ALICE} (alice.eth)` },
      { name: 'tokenId', type: 'uint256', value: '3941' },
    ],
  },
  contracts: [
    {
      depth: 0,
      address: BAYC,
      name: 'BoredApeYachtClub',
      matchType: 'exact match',
      functionSignature: 'safeTransferFrom(address, address, uint256)',
      functionSource: `function safeTransferFrom(address from, address to, uint256 tokenId) public virtual override {
    safeTransferFrom(from, to, tokenId, "");
}`,
      sources: ['contracts/BoredApeYachtClub.sol', 'lib/ERC721.sol'],
    },
  ],
}

const noDescriptor: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'yield.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'verified',
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: '0x3c9e1a7f5b20d84c6f01de92b7a45c318e6f2b91' },
    { name: 'value', value: '0x0' },
  ],
  calldata:
    '0x6e553f65' +
    '0000000000000000000000000000000000000000000000878678326eac900000' +
    '0000000000000000000000009f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e',
  digest: {
    label: 'Calldata Digest',
    value: '0xe2b60d9a4f81c5372a90fe1b86d4c0e5931cab7845d21f60be3a97d08c54f1a6',
  },
  decoded: {
    selector: '0x6e553f65',
    signature: 'deposit(uint256 assets, address receiver)',
    params: [
      { name: 'assets', type: 'uint256', value: '2500000000000000000000 (2,500 DAI)' },
      { name: 'receiver', type: 'address', value: `${YOU} (you.eth)` },
    ],
  },
  contracts: [
    {
      depth: 0,
      address: '0x3c9e1a7f5b20d84c6f01de92b7a45c318e6f2b91',
      name: 'YieldVault',
      matchType: 'exact match',
      functionSignature: 'deposit(uint256, address)',
      functionSource: `function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
    require(assets <= maxDeposit(receiver), "Vault: DEPOSIT_LIMIT");
    shares = previewDeposit(assets);
    _deposit(msg.sender, receiver, assets, shares);
}`,
      sources: ['contracts/YieldVault.sol', 'lib/ERC4626.sol'],
    },
  ],
}

const unverified: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'farm.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainId: 1,
  chainMode: 'helios',
  outcome: 'unverified',
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: YOU },
    { name: 'to', value: '0x5b1869d9a4c187f2eaa108f3062412ecf0526b24' },
    { name: 'value', value: '0x0' },
  ],
  calldata:
    '0x6e553f65' +
    '0000000000000000000000000000000000000000000000878678326eac900000' +
    '0000000000000000000000009f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e',
  digest: {
    label: 'Calldata Digest',
    value: '0xa15f3cd07be49821f6d05a3e97c2b48d10e6f7a2c39b85d4e01c6faa2d987b30',
  },
  decoded: {
    selector: '0x6e553f65',
    signature: 'deposit(uint256, address)',
    params: [
      { name: 'arg0', type: 'uint256', value: '2500000000000000000000' },
      { name: 'arg1', type: 'address', value: YOU },
    ],
  },
  contracts: [
    {
      depth: 0,
      address: '0x5b1869d9a4c187f2eaa108f3062412ecf0526b24',
      name: 'Unknown contract',
      matchType: 'no match',
      functionSignature: 'deposit(uint256, address)',
      functionSource: '',
      sources: [],
    },
  ],
}

const rpcMode: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Arbitrum One',
  chainId: 42161,
  chainMode: 'rpc',
  outcome: 'verified',
  clearSigning: {
    intent: 'Send',
    interpolatedIntent: [
      { text: 'Send ' },
      { text: '100 USDC', value: true },
      { text: ' to ' },
      { text: 'alice.eth 0xd8dA…6045', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Amount', value: '100 USDC' },
      { name: 'To', value: 'alice.eth (0xd8dA…6045)' },
    ],
    provenance: { text: 'ERC-7730 descriptor by Circle, from the registry', url: REGISTRY_URL },
  },
  raw: [
    { name: 'chainId', value: '42161' },
    { name: 'from', value: YOU },
    { name: 'to', value: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
    { name: 'value', value: '0x0' },
  ],
  calldata:
    '0xa9059cbb' +
    '000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045' +
    '0000000000000000000000000000000000000000000000000000000005f5e100',
  digest: {
    label: 'Calldata Digest',
    value: '0x39c8e14fa6027bd5c31e98d04b7f2ae8560d1c9f74ab30e2d685f19c04b7da52',
  },
  decoded: {
    selector: '0xa9059cbb',
    signature: 'transfer(address to, uint256 value)',
    params: [
      { name: 'to', type: 'address', value: `${ALICE} (alice.eth)` },
      { name: 'value', type: 'uint256', value: '100000000 (100 USDC)' },
    ],
  },
  contracts: [
    {
      ...usdcTransferContract,
      address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    },
  ],
}

const reverting: MockRequest = {
  ...mockRequest,
  outcome: 'reverted',
  revertReason: 'Router: INSUFFICIENT_OUTPUT',
  clearSigning: {
    ...mockRequest.clearSigning!,
    interpolatedIntent: [
      { text: 'Swap ' },
      { text: '1 ETH', value: true },
      { text: ' for at least ' },
      { text: '4,150 USDC', value: true },
      { text: ' on ' },
      { text: 'ExampleRouter 0x7a25…488d', value: true },
      { text: ', deadline ' },
      { text: '20 minutes', value: true },
      { text: '.' },
    ],
    fields: [
      { name: 'Amount to Send', value: '1 ETH' },
      { name: 'Minimum to Receive', value: '4,150 USDC' },
      { name: 'Beneficiary', value: 'you.eth (0x9f21…c04e)' },
      { name: 'Deadline', value: 'Sep 3, 2026, 18:42 UTC (in 20 minutes)' },
    ],
  },
  calldata: swapCalldata.replace('e5387e40', 'f75bf980'),
  digest: {
    label: 'Calldata Digest',
    value: '0xd6428a90c17ef3b5a20d84fe961c3d07b5ae82f4109c6db3574fe0a2c891b64d',
  },
  decoded: {
    ...mockRequest.decoded!,
    params: mockRequest.decoded!.params.map((p) =>
      p.name === 'amountOutMin' ? { ...p, value: '4150000000 (4,150 USDC)' } : p,
    ),
  },
  contracts: [routerContract, wethContract],
}

export const scenarios: Scenario[] = [
  { id: 'swap', label: 'swap · nested calls', request: mockRequest },
  { id: 'token-transfer', label: 'ERC-20 transfer', request: tokenTransfer },
  { id: 'eth-transfer', label: 'plain ETH transfer', request: ethTransfer },
  { id: 'approve', label: 'approve · unlimited', request: approveUnlimited },
  { id: 'permit', label: 'permit · EIP-712 signature', request: permitTypedData },
  { id: 'batch', label: 'batch · EIP-5792', request: batchRequest },
  { id: 'safe-nested', label: 'Safe · nested calldata', request: safeNested },
  { id: 'nft-transfer', label: 'NFT transfer · token template', request: nftTransfer },
  { id: 'no-descriptor', label: 'no clear signing descriptor', request: noDescriptor },
  { id: 'unverified', label: 'contract not verified', request: unverified },
  { id: 'rpc-mode', label: 'RPC mode chain', request: rpcMode },
  { id: 'revert', label: 'simulation reverts', request: reverting },
]

/**
 * Facts about a contract address, independent of the call being made. Placeholder shape, to be
 * refined: where each value comes from (an indexer, an explorer API, a local label list) and how
 * much of it can be verified is still open.
 */
export interface ContractInfo {
  /** ISO date of the deployment transaction */
  deployedAt: string
  deployBlock: number
  /** all transactions ever sent to this address */
  txCount: number
  /** safelists that include this address on this chain; placeholder names and links */
  lists: SafeList[]
  /** whether the block explorers show verified source code for this address */
  explorers: { etherscan: boolean; blockscout: boolean }
  /** native balance held by the contract, formatted */
  ethBalance: string
  ethUsd?: string
  /** ERC-20 balances held by the contract, largest first */
  tokens: Holding[]
  /** the account that sent the deployment transaction */
  deployer: Deployer
}

export interface SafeList {
  name: string
  url?: string
}

export interface Holding {
  symbol: string
  amount: string
  usd?: string
}

export interface Deployer {
  address: string
  /** an externally owned account, or a factory contract that deploys others */
  kind: 'account' | 'contract'
  name?: string
  /** ISO date of the deployer's first transaction */
  firstTxAt: string
  txCount: number
  ethBalance: string
  ethUsd?: string
  tokens: Holding[]
}

// mock safelists: each one is a list of addresses that a project or curator publishes
const LISTS = {
  exampleDex: {
    name: 'Example DEX deployments',
    url: 'https://github.com/Uniswap/contracts/tree/main/deployments',
  },
  erc7730: {
    name: 'ERC-7730 registry',
    url: 'https://github.com/LedgerHQ/clear-signing-erc7730-registry',
  },
  uniswapTokens: {
    name: 'Uniswap default token list',
    url: 'https://tokens.uniswap.org',
  },
  coingecko: {
    name: 'CoinGecko token list',
    url: 'https://tokens.coingecko.com/uniswap/all.json',
  },
  superchain: {
    name: 'Superchain token list',
    url: 'https://static.optimism.io/optimism.tokenlist.json',
  },
  circle: {
    name: 'Circle USDC addresses',
    url: 'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  },
  uniswapDeployments: {
    name: 'Uniswap deployments',
    url: 'https://github.com/Uniswap/contracts/tree/main/deployments',
  },
  safe: {
    name: 'Safe deployments',
    url: 'https://github.com/safe-global/safe-deployments',
  },
  arbitrum: {
    name: 'Arbitrum token list',
    url: 'https://tokenlist.arbitrum.io/ArbTokenLists/arbed_coingecko.json',
  },
} satisfies Record<string, SafeList>

const contractInfo: Record<string, ContractInfo> = {
  [ROUTER]: {
    deployedAt: '2020-06-05',
    deployBlock: 10207858,
    txCount: 214_381_902,
    lists: [LISTS.exampleDex, LISTS.erc7730],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0.0213 ETH',
    ethUsd: '$56',
    tokens: [
      { symbol: 'USDC', amount: '14.02', usd: '$14' },
      { symbol: 'DAI', amount: '3.51', usd: '$4' },
    ],
    deployer: {
      address: '0x9c33eacc2f50e39940d3afaf2c7b8246b681a374',
      kind: 'account',
      name: 'Example DEX: Deployer',
      firstTxAt: '2018-10-30',
      txCount: 1_284,
      ethBalance: '3.21 ETH',
      ethUsd: '$8,480',
      tokens: [],
    },
  },
  [WETH]: {
    deployedAt: '2017-12-18',
    deployBlock: 4719568,
    txCount: 18_904_117,
    lists: [LISTS.uniswapTokens, LISTS.coingecko, LISTS.superchain],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '2,914,387 ETH',
    ethUsd: '$7.7B',
    tokens: [
      { symbol: 'USDT', amount: '1,204.5', usd: '$1.2K' },
      { symbol: 'USDC', amount: '310', usd: '$310' },
    ],
    deployer: {
      address: '0x4f26ffbe5f04ed43630fdc30a87638d53d0b0876',
      kind: 'account',
      firstTxAt: '2017-12-11',
      txCount: 52,
      ethBalance: '0.91 ETH',
      ethUsd: '$2,400',
      tokens: [],
    },
  },
  [USDC]: {
    deployedAt: '2018-08-03',
    deployBlock: 6082465,
    txCount: 162_550_483,
    lists: [LISTS.circle, LISTS.uniswapTokens, LISTS.coingecko, LISTS.superchain, LISTS.erc7730],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0.84 ETH',
    ethUsd: '$2.2K',
    tokens: [
      { symbol: 'USDC', amount: '318,402.11', usd: '$318K' },
      { symbol: 'USDT', amount: '41,200', usd: '$41K' },
      { symbol: 'WETH', amount: '2.1', usd: '$5.6K' },
    ],
    deployer: {
      address: '0x95ba4cf87d6723ad9c0db21737d862be80e93911',
      kind: 'account',
      name: 'Circle: Deployer',
      firstTxAt: '2018-07-30',
      txCount: 2_431,
      ethBalance: '12.5 ETH',
      ethUsd: '$33,010',
      tokens: [{ symbol: 'USDC', amount: '1,000', usd: '$1,000' }],
    },
  },
  [PAIR]: {
    deployedAt: '2020-05-05',
    deployBlock: 10008355,
    txCount: 3_412_096,
    lists: [],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0 ETH',
    tokens: [
      { symbol: 'WETH', amount: '18,420.3', usd: '$48.9M' },
      { symbol: 'USDC', amount: '48,871,204', usd: '$48.9M' },
    ],
    deployer: {
      address: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',
      kind: 'contract',
      name: 'ExampleFactory',
      firstTxAt: '2020-05-04',
      txCount: 390_112,
      ethBalance: '0 ETH',
      tokens: [],
    },
  },
  [PERMIT2]: {
    deployedAt: '2022-11-17',
    deployBlock: 15986406,
    txCount: 9_873_310,
    lists: [LISTS.uniswapDeployments, LISTS.erc7730],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0 ETH',
    tokens: [
      { symbol: 'USDC', amount: '102.5', usd: '$103' },
    ],
    deployer: {
      address: '0x6c7e2f4a0b8d1e3c5f9a7b2d4e6c8a0f1b3d5e7a',
      kind: 'account',
      name: 'Uniswap Labs: Deployer',
      firstTxAt: '2019-02-14',
      txCount: 8_902,
      ethBalance: '7.44 ETH',
      ethUsd: '$19,650',
      tokens: [],
    },
  },
  [BAYC]: {
    deployedAt: '2021-04-22',
    deployBlock: 12287507,
    txCount: 1_204_558,
    lists: [],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0.5 ETH',
    ethUsd: '$1.3K',
    tokens: [
      { symbol: 'ApeCoin', amount: '1,004', usd: '$720' },
    ],
    deployer: {
      address: '0xaba7161a7fb69c88e16ed9f455ce62b791ee4d03',
      kind: 'account',
      firstTxAt: '2021-04-20',
      txCount: 1_905,
      ethBalance: '4.1 ETH',
      ethUsd: '$10,830',
      tokens: [],
    },
  },
  [SAFE]: {
    deployedAt: '2024-02-14',
    deployBlock: 19226471,
    txCount: 312,
    lists: [LISTS.safe],
    explorers: { etherscan: true, blockscout: false },
    ethBalance: '412.6 ETH',
    ethUsd: '$1.1M',
    tokens: [
      { symbol: 'USDC', amount: '2,450,000', usd: '$2.45M' },
      { symbol: 'WETH', amount: '150', usd: '$398K' },
    ],
    deployer: {
      address: '0xa6b71e26c5e0845f74c812102ca7114b6a896ab2',
      kind: 'contract',
      name: 'Safe: Proxy Factory 1.3.0',
      firstTxAt: '2021-05-12',
      txCount: 4_872_331,
      ethBalance: '0 ETH',
      tokens: [],
    },
  },
  [MULTISEND]: {
    deployedAt: '2021-07-08',
    deployBlock: 12788245,
    txCount: 2_096_774,
    lists: [LISTS.safe],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0 ETH',
    tokens: [],
    deployer: {
      address: '0x1aa7451dd11b8cb16ac089ed7fe05efa00100a6a',
      kind: 'account',
      name: 'Safe: Deployer',
      firstTxAt: '2020-03-02',
      txCount: 3_310,
      ethBalance: '1.02 ETH',
      ethUsd: '$2,690',
      tokens: [],
    },
  },
  '0x3c9e1a7f5b20d84c6f01de92b7a45c318e6f2b91': {
    deployedAt: '2025-03-11',
    deployBlock: 22021833,
    txCount: 48_220,
    lists: [],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0 ETH',
    tokens: [
      { symbol: 'USDC', amount: '12,804,330', usd: '$12.8M' },
    ],
    deployer: {
      address: '0x8e1d0b3f5a7c9e2d4f6b8a0c1e3d5f7a9b2c4d6e',
      kind: 'account',
      firstTxAt: '2025-03-01',
      txCount: 211,
      ethBalance: '1.8 ETH',
      ethUsd: '$4,750',
      tokens: [{ symbol: 'USDC', amount: '5,000', usd: '$5,000' }],
    },
  },
  // deliberately young and quiet, holding ETH taken from victims: the unverified scenario
  '0x5b1869d9a4c187f2eaa108f3062412ecf0526b24': {
    deployedAt: '2026-09-22',
    deployBlock: 23419702,
    txCount: 14,
    lists: [],
    explorers: { etherscan: false, blockscout: false },
    ethBalance: '38.2 ETH',
    ethUsd: '$101K',
    tokens: [],
    deployer: {
      // a fresh account made only to deploy this contract
      address: '0xf3a7c01e9d25b86c4e0f1a2b3c4d5e6f7a8b9c0d',
      kind: 'account',
      firstTxAt: '2026-09-21',
      txCount: 3,
      ethBalance: '0.04 ETH',
      ethUsd: '$106',
      tokens: [],
    },
  },
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': {
    deployedAt: '2022-10-31',
    deployBlock: 36123,
    txCount: 87_310_442,
    lists: [LISTS.circle, LISTS.arbitrum, LISTS.uniswapTokens],
    explorers: { etherscan: true, blockscout: true },
    ethBalance: '0.012 ETH',
    ethUsd: '$32',
    tokens: [
      { symbol: 'USDC', amount: '9,811.4', usd: '$9.8K' },
      { symbol: 'ARB', amount: '640', usd: '$390' },
    ],
    deployer: {
      address: '0x95ba4cf87d6723ad9c0db21737d862be80e93911',
      kind: 'account',
      name: 'Circle: Deployer',
      firstTxAt: '2022-10-28',
      txCount: 614,
      ethBalance: '2.3 ETH',
      ethUsd: '$6,070',
      tokens: [],
    },
  },
}

export function getContractInfo(address: string): ContractInfo | undefined {
  return contractInfo[address.toLowerCase()]
}
