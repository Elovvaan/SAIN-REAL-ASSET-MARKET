import { Client, Wallet, isValidClassicAddress, xrpToDrops } from 'xrpl';

const NETWORK = 'XRPL';
const NATIVE_ASSET = 'XRP';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positiveAmount(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) throw new Error('amount must be a positive XRP amount with no more than 6 decimal places.');
  return raw;
}

export class XrplTransferService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.rpcUrl = text(this.environment.XRPL_RPC_URL);
    this.secret = text(this.environment.XRPL_SECRET);
    this.client = null;
    this.wallet = null;
  }

  status() {
    const rpcConfigured = Boolean(this.rpcUrl);
    const signerConfigured = Boolean(this.secret);
    return {
      network: NETWORK,
      nativeAsset: NATIVE_ASSET,
      rpcConfigured,
      signerConfigured,
      configured: rpcConfigured && signerConfigured,
      ready: false,
      capabilities: ['TRANSFER_NATIVE'],
      assets: [NATIVE_ASSET],
      signingMode: 'LOCAL_XRPL_WALLET',
    };
  }

  async ensure() {
    if (!this.status().configured) {
      const error = new Error('XRPL_RPC_URL and XRPL_SECRET are required.');
      error.code = 'ON_CHAIN_NETWORK_NOT_READY';
      throw error;
    }
    if (!this.client) this.client = new Client(this.rpcUrl);
    if (!this.client.isConnected()) await this.client.connect();
    if (!this.wallet) this.wallet = Wallet.fromSeed(this.secret);
    return { client: this.client, wallet: this.wallet };
  }

  async health() {
    const configuration = this.status();
    if (!configuration.configured) return { ...configuration, reachable: false };
    try {
      const { client, wallet } = await this.ensure();
      const response = await client.request({ command: 'account_info', account: wallet.address, ledger_index: 'validated' });
      return {
        ...configuration,
        ready: true,
        reachable: true,
        address: wallet.address,
        validatedLedgerIndex: response?.result?.ledger_index ?? null,
      };
    } catch (error) {
      return { ...configuration, ready: false, reachable: false, error: String(error?.message || error) };
    }
  }

  async send(input = {}) {
    if (upper(input.asset) !== NATIVE_ASSET) throw new Error('XRPL adapter currently transfers native XRP only.');
    const destinationAddress = text(input.destinationAddress);
    if (!isValidClassicAddress(destinationAddress)) throw new Error('destinationAddress is not a valid XRP Ledger classic address.');
    const amount = positiveAmount(input.amount);
    const { client, wallet } = await this.ensure();
    const prepared = await client.autofill({
      TransactionType: 'Payment',
      Account: wallet.address,
      Destination: destinationAddress,
      Amount: xrpToDrops(amount),
    });
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    const transactionResult = result?.result?.meta?.TransactionResult || result?.result?.meta?.transaction_result || null;
    const validated = Boolean(result?.result?.validated);
    const state = validated && transactionResult === 'tesSUCCESS' ? 'CONFIRMED' : 'FAILED';
    return {
      transferId: input.transferId,
      network: NETWORK,
      asset: NATIVE_ASSET,
      amount,
      fromAddress: wallet.address,
      destinationAddress,
      transactionId: signed.hash,
      confirmation: {
        state,
        transactionId: signed.hash,
        validated,
        ledgerIndex: result?.result?.ledger_index ?? null,
        transactionResult,
      },
      state,
    };
  }
}
