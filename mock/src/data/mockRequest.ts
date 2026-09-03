export interface TxField {
  name: string
  value: string
}

/** a piece of the extrapolated intent sentence; value parts were generated from the calldata */
export interface IntentPart {
  text: string
  value?: boolean
}

export interface MockContract {
  /** call-tree depth: 0 = entry point, children are 1 level deeper */
  depth: number
  address: string
  name: string
  matchType: 'exact match' | 'match'
  functionSignature: string
  functionSource: string
  sources: string[]
  compilerSettings: TxField[]
}

export interface MockRequest {
  method: string
  origin: string
  via: string
  chain: string
  chainMode: 'helios' | 'rpc'
  /** ERC-7730 descriptor intent (the operation) */
  operation: string
  /** extrapolated human-readable sentence */
  intent: IntentPart[]
  /** ERC-7730 formatted fields: labels from the descriptor, values resolved */
  fields: TxField[]
  /** raw transaction data as received */
  raw: TxField[]
  calldata: string
  /** contracts touched by the transaction, as a call tree flattened depth-first */
  contracts: MockContract[]
}

export const mockRequest: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainMode: 'helios',
  operation: 'Swap',
  intent: [
    { text: 'Swap ' },
    { text: '1 ETH', value: true },
    { text: ' for at least ' },
    { text: '3,845 USDC', value: true },
    { text: ' on ' },
    { text: 'ExampleRouter 0x7a25…488d', value: true },
    { text: ', deadline ' },
    { text: '20 minutes', value: true },
    { text: '.' },
  ],
  fields: [
    { name: 'Amount to Send', value: '1 ETH' },
    { name: 'Minimum to Receive', value: '3,845 USDC' },
    { name: 'Beneficiary', value: 'you.eth (0x9f21…c04e)' },
    { name: 'Deadline', value: 'Sep 1, 2026, 18:42 (in 20 minutes)' },
  ],
  raw: [
    { name: 'chainId', value: '1' },
    { name: 'from', value: '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e' },
    { name: 'to', value: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' },
    { name: 'value', value: '0xde0b6b3a7640000 (1 ETH)' },
    { name: 'selector', value: '0x7ff36ab5 (swapExactETHForTokens)' },
  ],
  calldata:
    '0x7ff36ab5' +
    '00000000000000000000000000000000000000000000000000000000e5387e40' +
    '0000000000000000000000000000000000000000000000000000000000000080' +
    '0000000000000000000000009f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e' +
    '0000000000000000000000000000000000000000000000000000000068b63f5a' +
    '0000000000000000000000000000000000000000000000000000000000000002' +
    '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' +
    '000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  contracts: [
    {
      depth: 0,
      address: '0x7a25…488d',
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
      sources: [
        'contracts/ExampleRouter.sol',
        'contracts/interfaces/IERC20.sol',
        'lib/SafeTransfer.sol',
      ],
      compilerSettings: [
        { name: 'solc', value: '0.8.24+commit.e11b9ed9' },
        { name: 'optimizer', value: 'enabled, 200 runs' },
        { name: 'evmVersion', value: 'cancun' },
        { name: 'metadata', value: 'ipfs' },
      ],
    },
    {
      depth: 1,
      address: '0xc02a…6cc2',
      name: 'WETH9',
      matchType: 'match',
      functionSignature: 'deposit()',
      functionSource: `function deposit() public payable {
    balanceOf[msg.sender] += msg.value;
    emit Deposit(msg.sender, msg.value);
}`,
      sources: ['contracts/WETH9.sol'],
      compilerSettings: [
        { name: 'solc', value: '0.4.19+commit.c4cbbb05' },
        { name: 'optimizer', value: 'disabled' },
        { name: 'evmVersion', value: 'byzantium' },
        { name: 'metadata', value: 'swarm' },
      ],
    },
    {
      depth: 1,
      address: '0xb4e1…6c9c',
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
      compilerSettings: [
        { name: 'solc', value: '0.8.24+commit.e11b9ed9' },
        { name: 'optimizer', value: 'enabled, 999999 runs' },
        { name: 'evmVersion', value: 'cancun' },
        { name: 'metadata', value: 'ipfs' },
      ],
    },
  ],
}
