import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createMint,
  createTransferCheckedInstruction,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';

function text(value) { return String(value ?? '').trim(); }
function exactUnits(value, decimals, name = 'amount') {
  const source = text(value);
  if (!/^\d+(?:\.\d+)?$/.test(source)) throw new Error(`${name} must be a positive decimal amount.`);
  const [whole, fraction = ''] = source.split('.');
  if (fraction.length > decimals) throw new Error(`${name} cannot exceed ${decimals} decimal places.`);
  const units = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  if (units <= 0n) throw new Error(`${name} must be greater than zero.`);
  return units;
}
function decimal(units, decimals) {
  const raw = units.toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = decimals ? raw.slice(-decimals).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}
function keypair(value) {
  const raw = text(value);
  if (!raw) throw new Error('SOLANA_PAYER_SECRET_KEY is required.');
  let bytes;
  try {
    bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : Uint8Array.from(Buffer.from(raw, 'base64'));
  } catch {
    throw new Error('SOLANA_PAYER_SECRET_KEY must be a JSON byte array or base64 secret key.');
  }
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  throw new Error('SOLANA_PAYER_SECRET_KEY must contain 32 or 64 bytes.');
}
function publicKey(value, name) {
  try { return new PublicKey(text(value)); }
  catch { throw new Error(`${name} is not a valid Solana address.`); }
}

export class SolanaTransferService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.rpc = text(this.environment.SOLANA_RPC_URL);
    this.cluster = text(this.environment.SOLANA_CLUSTER || 'mainnet-beta');
    this.payer = null;
    this.connection = null;
  }

  status() {
    const rpcConfigured = Boolean(this.rpc);
    const signerConfigured = Boolean(text(this.environment.SOLANA_PAYER_SECRET_KEY));
    return {
      service: 'SRA Solana Adapter',
      network: 'SOLANA',
      cluster: this.cluster,
      rpcConfigured,
      signerConfigured,
      configured: rpcConfigured && signerConfigured,
      ready: rpcConfigured && signerConfigured,
    };
  }

  ensure() {
    const status = this.status();
    if (!status.configured) {
      const error = new Error('Solana RPC and signer are not configured.');
      error.code = 'SOLANA_NOT_READY';
      throw error;
    }
    if (!this.payer) this.payer = keypair(this.environment.SOLANA_PAYER_SECRET_KEY);
    if (!this.connection) this.connection = new Connection(this.rpc, 'confirmed');
    return { payer: this.payer, connection: this.connection };
  }

  async health() {
    const configuration = this.status();
    if (!configuration.configured) return { ...configuration, reachable: false };
    try {
      const { connection } = this.ensure();
      const version = await connection.getVersion();
      return { ...configuration, reachable: true, ready: true, version };
    } catch (error) {
      return { ...configuration, reachable: false, ready: false, error: String(error?.message || error) };
    }
  }

  async wallet() {
    const { payer } = this.ensure();
    return { network: 'SOLANA', cluster: this.cluster, address: payer.publicKey.toBase58() };
  }

  async confirm(transactionId) {
    const { connection } = this.ensure();
    const signature = text(transactionId);
    if (!signature) throw new Error('transactionId is required.');
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (!status) return { state: 'PENDING', transactionId: signature };
    if (status.err) return { state: 'FAILED', transactionId: signature, error: status.err };
    const confirmed = status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized';
    return { state: confirmed ? 'CONFIRMED' : 'PENDING', transactionId: signature, confirmationStatus: status.confirmationStatus || null, slot: status.slot };
  }

  async broadcast(transaction, latestBlockhash) {
    const { connection, payer } = this.ensure();
    transaction.feePayer = payer.publicKey;
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.sign(payer);
    const transactionId = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 });
    try {
      const confirmation = await connection.confirmTransaction({ signature: transactionId, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight }, 'confirmed');
      if (confirmation.value.err) {
        const error = new Error(`Solana transaction ${transactionId} failed on chain.`);
        error.transactionId = transactionId;
        throw error;
      }
      return { transactionId, confirmation: { state: 'CONFIRMED', slot: confirmation.context.slot } };
    } catch (error) {
      error.transactionId = transactionId;
      throw error;
    }
  }

  async sendNative(input) {
    const { connection, payer } = this.ensure();
    const destination = publicKey(input.destinationAddress, 'destinationAddress');
    const units = exactUnits(input.amount, 9);
    if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount is too large for a SOL transfer.');
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: destination, lamports: Number(units) }));
    const sent = await this.broadcast(transaction, latest);
    return {
      transferId: input.transferId,
      network: 'SOLANA',
      asset: 'SOL',
      fromAddress: payer.publicKey.toBase58(),
      destinationAddress: destination.toBase58(),
      amount: text(input.amount),
      transactionId: sent.transactionId,
      transactionSignature: sent.transactionId,
      confirmation: sent.confirmation,
      state: 'CONFIRMED',
    };
  }

  async sendToken(input) {
    const { connection, payer } = this.ensure();
    const owner = publicKey(input.destinationAddress, 'destinationAddress');
    const mint = publicKey(input.mintAddress, 'mintAddress');
    const mintInfo = await getMint(connection, mint, 'confirmed');
    const amountUnits = exactUnits(input.amount, mintInfo.decimals);
    const source = input.sourceTokenAccount
      ? { address: publicKey(input.sourceTokenAccount, 'sourceTokenAccount') }
      : await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
    const destination = await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner);
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction().add(createTransferCheckedInstruction(source.address, mint, destination.address, payer.publicKey, amountUnits, mintInfo.decimals));
    const sent = await this.broadcast(transaction, latest);
    return {
      transferId: input.transferId,
      network: 'SOLANA',
      asset: text(input.asset).toUpperCase(),
      mintAddress: mint.toBase58(),
      fromAddress: payer.publicKey.toBase58(),
      sourceTokenAccount: source.address.toBase58(),
      destinationAddress: owner.toBase58(),
      destinationTokenAccount: destination.address.toBase58(),
      amount: text(input.amount),
      transactionId: sent.transactionId,
      transactionSignature: sent.transactionId,
      confirmation: sent.confirmation,
      state: 'CONFIRMED',
    };
  }

  async send(input = {}) {
    const asset = text(input.asset).toUpperCase();
    if (!asset) throw new Error('asset is required.');
    if (!text(input.destinationAddress)) throw new Error('destinationAddress is required.');
    if (asset === 'SOL') return this.sendNative(input);
    if (!text(input.mintAddress)) throw new Error(`mintAddress is required to transfer ${asset} on Solana.`);
    return this.sendToken(input);
  }

  async createSraMint(input = {}) {
    const { connection, payer } = this.ensure();
    const decimals = Number.isInteger(input.decimals) ? input.decimals : 8;
    const targetUnits = exactUnits(input.authorizedSupply, decimals, 'authorizedSupply');
    if (input.mintAddress) {
      const mint = publicKey(input.mintAddress, 'mintAddress');
      const mintInfo = await getMint(connection, mint, 'confirmed');
      if (mintInfo.decimals !== decimals) throw new Error('SRA mint decimals do not match the requested decimals.');
      const issuedUnits = exactUnits(input.issuedSupply || '0', decimals, 'issuedSupply');
      if (targetUnits < issuedUnits) throw new Error('Platform SRA supply is below on-chain issued supply; mint synchronization cannot reduce supply.');
      if (targetUnits === issuedUnits) return { symbol: 'SRA', mintAddress: mint.toBase58(), platformTokenAccount: input.platformTokenAccount, authorizedSupply: Number(decimal(targetUnits, decimals)), issuedSupply: Number(decimal(issuedUnits, decimals)), decimals, mintedQuantity: 0, state: 'ACTIVE', existing: true, synchronized: true };
      const account = input.platformTokenAccount ? publicKey(input.platformTokenAccount, 'platformTokenAccount') : (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)).address;
      const delta = targetUnits - issuedUnits;
      const transactionSignature = await mintTo(connection, payer, mint, account, payer, delta);
      return { symbol: 'SRA', mintAddress: mint.toBase58(), platformTokenAccount: account.toBase58(), authorizedSupply: Number(decimal(targetUnits, decimals)), issuedSupply: Number(decimal(targetUnits, decimals)), decimals, transactionSignature, mintedQuantity: Number(decimal(delta, decimals)), state: 'ACTIVE', existing: true, synchronized: true };
    }
    const mint = await createMint(connection, payer, payer.publicKey, payer.publicKey, decimals);
    const account = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
    const transactionSignature = await mintTo(connection, payer, mint, account.address, payer, targetUnits);
    return { symbol: 'SRA', mintAddress: mint.toBase58(), platformTokenAccount: account.address.toBase58(), authorizedSupply: Number(decimal(targetUnits, decimals)), issuedSupply: Number(decimal(targetUnits, decimals)), decimals, transactionSignature, mintedQuantity: Number(decimal(targetUnits, decimals)), state: 'ACTIVE', existing: false };
  }

  async sendSra(input = {}) {
    return this.send({ ...input, asset: 'SRA' });
  }
}
