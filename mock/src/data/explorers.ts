// explorer hosts per chain; a chain missing here has no link for that explorer
export const ETHERSCAN: Record<number, string> = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  10: 'https://optimistic.etherscan.io',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  59144: 'https://lineascan.build',
}

export const BLOCKSCOUT: Record<number, string> = {
  1: 'https://eth.blockscout.com',
  11155111: 'https://eth-sepolia.blockscout.com',
  10: 'https://optimism.blockscout.com',
  8453: 'https://base.blockscout.com',
  42161: 'https://arbitrum.blockscout.com',
}
