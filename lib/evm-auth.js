'use strict';

const {
  JsonRpcProvider,
  Contract,
  getAddress,
  isAddress,
  verifyMessage
} = require('ethers');

const ROBINHOOD_CHAIN_ID = 4663n;
const FROGINAL_EVM_COLLECTION =
  (process.env.FROGINAL_EVM_NFT_CONTRACT_ADDRESS || '0x646C988463aa175956F59CC1f9Efa137CD0A9d7b').trim();

const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)'
];

function normalizeEvmAddress(value) {
  if (typeof value !== 'string' || !isAddress(value.trim())) return null;
  try { return getAddress(value.trim()).toLowerCase(); } catch { return null; }
}

function verifyEvmWalletSignature(wallet, message, signature) {
  try {
    const normalized = normalizeEvmAddress(wallet);
    if (!normalized || typeof message !== 'string' || typeof signature !== 'string') return false;
    const recovered = verifyMessage(message, signature);
    return normalizeEvmAddress(recovered) === normalized;
  } catch { return false; }
}

async function findRobinhoodFroginal(wallet) {
  const normalized = normalizeEvmAddress(wallet);
  if (!normalized) throw new Error('Invalid Robinhood Chain wallet address.');
  if (!normalizeEvmAddress(FROGINAL_EVM_COLLECTION)) {
    throw new Error('FROGINAL_EVM_NFT_CONTRACT_ADDRESS is not a valid contract address.');
  }
  const rpcUrl = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error('The configured RPC is not Robinhood Chain mainnet (4663).');
  }
  const code = await provider.getCode(FROGINAL_EVM_COLLECTION);
  if (!code || code === '0x') throw new Error('The configured FROGINAL DOGS contract has no deployed code on Robinhood Chain.');
  const contract = new Contract(FROGINAL_EVM_COLLECTION, ERC721_ABI, provider);
  const balance = await contract.balanceOf(normalized);
  if (balance <= 0n) return null;
  return {
    chain: 'robinhood',
    wallet_address: normalized,
    contract_address: normalizeEvmAddress(FROGINAL_EVM_COLLECTION),
    balance: balance.toString()
  };
}

module.exports = {
  ROBINHOOD_CHAIN_ID,
  FROGINAL_EVM_COLLECTION,
  normalizeEvmAddress,
  verifyEvmWalletSignature,
  findRobinhoodFroginal
};
