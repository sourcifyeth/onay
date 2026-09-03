export interface TxField {
  name: string
  value: string
}

export interface MockRequest {
  method: string
  origin: string
  via: string
  chain: string
  chainMode: 'helios' | 'rpc'
  contractName: string
  contractAddress: string
  functionSignature: string
  sources: string[]
  matchLabel: string
  compilerSettings: TxField[]
  intent: string
  fields: TxField[]
}

export const mockRequest: MockRequest = {
  method: 'eth_sendTransaction',
  origin: 'dapp.example',
  via: 'browser extension',
  chain: 'Ethereum mainnet',
  chainMode: 'helios',
  contractName: 'ExampleRouter',
  contractAddress: '0x7a25…488d',
  functionSignature: 'swapExactETHForTokens(uint256, address[], address, uint256)',
  sources: [
    'contracts/ExampleRouter.sol',
    'contracts/interfaces/IERC20.sol',
    'lib/SafeTransfer.sol',
  ],
  matchLabel: 'exact match',
  compilerSettings: [
    { name: 'solc', value: '0.8.24+commit.e11b9ed9' },
    { name: 'optimizer', value: 'enabled, 200 runs' },
    { name: 'evmVersion', value: 'cancun' },
    { name: 'metadata', value: 'ipfs' },
  ],
  intent: 'Swap 1 ETH for at least 3,845 USDC on ExampleRouter 0x7a25…488d, deadline 20 minutes.',
  fields: [
    { name: 'function', value: 'swapExactETHForTokens' },
    { name: 'to', value: '0x7a25…488d (ExampleRouter)' },
    { name: 'value', value: '1 ETH' },
    { name: 'amountOutMin', value: '3,845 USDC' },
    { name: 'path', value: 'WETH → USDC' },
    { name: 'deadline', value: 'now + 20 minutes' },
    { name: 'chain', value: 'Ethereum mainnet' },
  ],
}
