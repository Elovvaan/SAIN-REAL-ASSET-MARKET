const NETWORK = 'BITCOIN';
const NATIVE_ASSET = 'BTC';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positiveAmount(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,8})?$/.test(raw) || Number(raw) <= 0) throw new Error('amount must be a positive BTC amount with no more than 8 decimal places.');
  return raw;
}

export class BitcoinTransferService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.rpcUrl = text(this.environment.BITCOIN_RPC_URL);
    this.rpcUser = text(this.environment.BITCOIN_RPC_USER);
    this.rpcPassword = text(this.environment.BITCOIN_RPC_PASSWORD);
    this.wallet = text(this.environment.BITCOIN_WALLET);
  }

  walletRpcUrl() {
    if (!this.wallet) return this.rpcUrl;
    return `${this.rpcUrl.replace(/\/$/, '')}/wallet/${encodeURIComponent(this.wallet)}`;
  }

  status() {
    const rpcConfigured = Boolean(this.rpcUrl);
    const authenticationConfigured = Boolean(this.rpcUser && this.rpcPassword);
    return {
      network: NETWORK,
      nativeAsset: NATIVE_ASSET,
      rpcConfigured,
      authenticationConfigured,
      walletConfigured: Boolean(this.wallet),
      configured: rpcConfigured && authenticationConfigured,
      ready: false,
      capabilities: ['TRANSFER_NATIVE'],
      assets: [NATIVE_ASSET],
      signingMode: 'BITCOIN_CORE_WALLET',
    };
  }

  async rpc(method, params = [], { wallet = false } = {}) {
    if (!this.status().configured) {
      const error = new Error('Bitcoin Core RPC URL, user, and password are required.');
      error.code = 'ON_CHAIN_NETWORK_NOT_READY';
      throw error;
    }
    const response = await fetch(wallet ? this.walletRpcUrl() : this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.rpcUser}:${this.rpcPassword}`).toString('base64')}`,
      },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'sra', method, params }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      const message = payload?.error?.message || `Bitcoin Core RPC ${method} failed with HTTP ${response.status}.`;
      const error = new Error(message);
      error.code = 'BITCOIN_RPC_ERROR';
      throw error;
    }
    return payload.result;
  }

  async health() {
    const configuration = this.status();
    if (!configuration.configured) return { ...configuration, reachable: false };
    try {
      const chain = await this.rpc('getblockchaininfo');
      const wallet = await this.rpc('getwalletinfo', [], { wallet: true });
      return {
        ...configuration,
        ready: true,
        reachable: true,
        chain: chain?.chain || null,
        blocks: chain?.blocks ?? null,
        walletName: wallet?.walletname || this.wallet || null,
      };
    } catch (error) {
      return { ...configuration, ready: false, reachable: false, error: String(error?.message || error) };
    }
  }

  async confirm(transactionId) {
    try {
      const tx = await this.rpc('gettransaction', [transactionId], { wallet: true });
      const confirmations = Number(tx?.confirmations || 0);
      return { state: confirmations > 0 ? 'CONFIRMED' : 'PENDING', transactionId, confirmations };
    } catch {
      return { state: 'PENDING', transactionId };
    }
  }

  async send(input = {}) {
    if (upper(input.asset) !== NATIVE_ASSET) throw new Error('Bitcoin adapter currently transfers native BTC only.');
    const destinationAddress = text(input.destinationAddress);
    if (!destinationAddress) throw new Error('destinationAddress is required.');
    const amount = positiveAmount(input.amount);
    const transactionId = await this.rpc('sendtoaddress', [destinationAddress, amount], { wallet: true });
    const confirmation = await this.confirm(transactionId);
    return {
      transferId: input.transferId,
      network: NETWORK,
      asset: NATIVE_ASSET,
      amount,
      fromAddress: null,
      destinationAddress,
      transactionId,
      confirmation,
      state: confirmation.state,
    };
  }
}
