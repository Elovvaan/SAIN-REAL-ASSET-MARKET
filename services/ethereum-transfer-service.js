import { JsonRpcProvider, Wallet, isAddress, parseEther } from 'ethers';

const NETWORK = 'ETHEREUM';
const NATIVE_ASSET = 'ETH';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positiveAmount(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,18})?$/.test(raw) || Number(raw) <= 0) throw new Error('amount must be a positive ETH amount with no more than 18 decimal places.');
  return raw;
}

export class EthereumTransferService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.rpcUrl = text(this.environment.ETHEREUM_RPC_URL);
    this.privateKey = text(this.environment.ETHEREUM_PRIVATE_KEY);
    this.expectedChainId = text(this.environment.ETHEREUM_CHAIN_ID);
    this.provider = null;
    this.wallet = null;
  }

  status() {
    const rpcConfigured = Boolean(this.rpcUrl);
    const signerConfigured = Boolean(this.privateKey);
    return {
      network: NETWORK,
      nativeAsset: NATIVE_ASSET,
      rpcConfigured,
      signerConfigured,
      configured: rpcConfigured && signerConfigured,
      ready: false,
      capabilities: ['TRANSFER_NATIVE'],
      assets: [NATIVE_ASSET],
      signingMode: 'LOCAL_PRIVATE_KEY',
    };
  }

  ensure() {
    if (!this.status().configured) {
      const error = new Error('ETHEREUM_RPC_URL and ETHEREUM_PRIVATE_KEY are required.');
      error.code = 'ON_CHAIN_NETWORK_NOT_READY';
      throw error;
    }
    if (!this.provider) this.provider = new JsonRpcProvider(this.rpcUrl);
    if (!this.wallet) this.wallet = new Wallet(this.privateKey, this.provider);
    return { provider: this.provider, wallet: this.wallet };
  }

  async health() {
    const configuration = this.status();
    if (!configuration.configured) return { ...configuration, reachable: false };
    try {
      const { provider, wallet } = this.ensure();
      const network = await provider.getNetwork();
      const chainId = network.chainId.toString();
      if (this.expectedChainId && this.expectedChainId !== chainId) {
        return { ...configuration, ready: false, reachable: true, chainId, error: `Configured Ethereum chain ID ${this.expectedChainId} does not match RPC chain ID ${chainId}.` };
      }
      const address = await wallet.getAddress();
      await provider.getBalance(address);
      return { ...configuration, ready: true, reachable: true, chainId, address };
    } catch (error) {
      return { ...configuration, ready: false, reachable: false, error: String(error?.message || error) };
    }
  }

  async send(input = {}) {
    if (upper(input.asset) !== NATIVE_ASSET) throw new Error('Ethereum adapter currently transfers native ETH only.');
    const destinationAddress = text(input.destinationAddress);
    if (!isAddress(destinationAddress)) throw new Error('destinationAddress is not a valid Ethereum address.');
    const amount = positiveAmount(input.amount);
    const { wallet } = this.ensure();
    const response = await wallet.sendTransaction({ to: destinationAddress, value: parseEther(amount) });
    const receipt = await response.wait(1);
    const state = receipt?.status === 1 ? 'CONFIRMED' : 'FAILED';
    return {
      transferId: input.transferId,
      network: NETWORK,
      asset: NATIVE_ASSET,
      amount,
      fromAddress: await wallet.getAddress(),
      destinationAddress,
      transactionId: response.hash,
      confirmation: { state, transactionId: response.hash, blockNumber: receipt?.blockNumber ?? null },
      state,
    };
  }
}
