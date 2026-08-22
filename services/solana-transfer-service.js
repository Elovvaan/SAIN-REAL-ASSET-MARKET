import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

const NETWORK = 'SOLANA';
const NATIVE_ASSET = 'SOL';
const LAMPORTS_PER_SOL = 1_000_000_000n;

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positiveAmount(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,9})?$/.test(raw) || Number(raw) <= 0) throw new Error('amount must be a positive SOL amount with no more than 9 decimal places.');
  return raw;
}
function toLamports(value) {
  const [whole, fraction = ''] = positiveAmount(value).split('.');
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt((fraction + '000000000').slice(0, 9));
}
function parseSecretKey(value) {
  const raw = text(value);
  if (!raw) throw new Error('SOLANA_SECRET_KEY is required.');
  let values;
  try {
    values = raw.startsWith('[') ? JSON.parse(raw) : raw.split(',').map((item) => Number(item.trim()));
  } catch {
    throw new Error('SOLANA_SECRET_KEY must be a JSON or comma-separated array of secret-key bytes.');
  }
  if (!Array.isArray(values) || !values.length || values.some((item) => !Number.isInteger(Number(item)) || Number(item) < 0 || Number(item) > 255)) {
    throw new Error('SOLANA_SECRET_KEY must contain valid byte values.');
  }
  return Keypair.fromSecretKey(Uint8Array.from(values.map(Number)));
}

export class SolanaTransferService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.rpcUrl = text(this.environment.SOLANA_RPC_URL);
    this.secretKey = text(this.environment.SOLANA_SECRET_KEY);
    this.connection = null;
    this.signer = null;
  }

  status() {
    const rpcConfigured = Boolean(this.rpcUrl);
    const signerConfigured = Boolean(this.secretKey);
    return {
      network: NETWORK,
      nativeAsset: NATIVE_ASSET,
      rpcConfigured,
      signerConfigured,
      configured: rpcConfigured && signerConfigured,
      ready: false,
      capabilities: ['TRANSFER_NATIVE'],
      assets: [NATIVE_ASSET],
      signingMode: 'LOCAL_KEYPAIR',
    };
  }

  ensure() {
    if (!this.status().configured) {
      const error = new Error('SOLANA_RPC_URL and SOLANA_SECRET_KEY are required.');
      error.code = 'ON_CHAIN_NETWORK_NOT_READY';
      throw error;
    }
    if (!this.connection) this.connection = new Connection(this.rpcUrl, 'confirmed');
    if (!this.signer) this.signer = parseSecretKey(this.secretKey);
    return { connection: this.connection, signer: this.signer };
  }

  async health() {
    const configuration = this.status();
    if (!configuration.configured) return { ...configuration, reachable: false };
    try {
      const { connection, signer } = this.ensure();
      const [version, balance] = await Promise.all([connection.getVersion(), connection.getBalance(signer.publicKey, 'confirmed')]);
      return {
        ...configuration,
        ready: true,
        reachable: true,
        address: signer.publicKey.toBase58(),
        balanceLamports: balance,
        coreVersion: version?.['solana-core'] || null,
      };
    } catch (error) {
      return { ...configuration, ready: false, reachable: false, error: String(error?.message || error) };
    }
  }

  async confirm(transactionId) {
    const { connection } = this.ensure();
    const response = await connection.getSignatureStatuses([transactionId], { searchTransactionHistory: true });
    const status = response?.value?.[0] || null;
    if (!status) return { state: 'PENDING', transactionId };
    if (status.err) return { state: 'FAILED', transactionId, slot: status.slot, error: status.err };
    const confirmed = status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized';
    return { state: confirmed ? 'CONFIRMED' : 'PENDING', transactionId, slot: status.slot, confirmationStatus: status.confirmationStatus || null };
  }

  async send(input = {}) {
    if (upper(input.asset) !== NATIVE_ASSET) throw new Error('Solana adapter currently transfers native SOL only.');
    const destinationAddress = text(input.destinationAddress);
    let destination;
    try { destination = new PublicKey(destinationAddress); }
    catch { throw new Error('destinationAddress is not a valid Solana public key.'); }
    const amount = positiveAmount(input.amount);
    const lamports = toLamports(amount);
    const { connection, signer } = this.ensure();
    const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: destination, lamports }));
    const transactionId = await sendAndConfirmTransaction(connection, transaction, [signer], { commitment: 'confirmed' });
    const confirmation = await this.confirm(transactionId);
    return {
      transferId: input.transferId,
      network: NETWORK,
      asset: NATIVE_ASSET,
      amount,
      fromAddress: signer.publicKey.toBase58(),
      destinationAddress,
      transactionId,
      confirmation,
      state: confirmation.state,
    };
  }
}
