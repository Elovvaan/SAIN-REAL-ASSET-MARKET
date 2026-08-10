import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  MINT_SIZE,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getMinimumBalanceForRentExemptMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const NETWORK = 'SOLANA';
const NATIVE_ASSET = 'SOL';
const ASSET_TYPE = 'ON_CHAIN_ASSET';
const U64_MAX = (1n << 64n) - 1n;

function text(value) { return String(value ?? '').trim(); }
function normalize(value) { return text(value).toUpperCase(); }

function exactUnits(value, decimals, name = 'amount') {
  const source = text(value);
  if (!/^\d+(?:\.\d+)?$/.test(source)) throw new Error(`${name} must be a positive decimal amount.`);
  const [whole, fraction = ''] = source.split('.');
  if (fraction.length > decimals) throw new Error(`${name} cannot exceed ${decimals} decimal places.`);
  const units = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  if (units <= 0n) throw new Error(`${name} must be greater than zero.`);
  if (units > U64_MAX) {
    const error = new Error(`${name} exceeds the maximum token amount at ${decimals} decimals.`);
    error.code = 'ON_CHAIN_TOKEN_AMOUNT_U64_OVERFLOW';
    throw error;
  }
  return units;
}

function decimalsValue(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) throw new Error('decimals must be an integer from 0 to 255.');
  return parsed;
}

function keypair(value) {
  const raw = text(value);
  if (!raw) throw new Error('Network signer secret key is required.');
  let bytes;
  try {
    bytes = raw.startsWith('[')
      ? Uint8Array.from(JSON.parse(raw))
      : Uint8Array.from(Buffer.from(raw, 'base64'));
  } catch {
    throw new Error('Network signer secret key must be a JSON byte array or base64 secret key.');
  }
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  throw new Error('Network signer secret key must contain 32 or 64 bytes.');
}

function publicKey(value, name) {
  try { return new PublicKey(text(value)); }
  catch { throw new Error(`${name} is not a valid destination-network address.`); }
}

function tokenProgram(value) {
  const raw = text(value);
  const normalized = normalize(raw || 'TOKEN');
  if ([normalize(TOKEN_PROGRAM_ID.toBase58()), 'TOKEN', 'SPL_TOKEN', 'ORIGINAL', 'LEGACY'].includes(normalized)) return TOKEN_PROGRAM_ID;
  if ([normalize(TOKEN_2022_PROGRAM_ID.toBase58()), 'TOKEN_2022', 'TOKEN-2022', 'TOKEN2022', 'TOKEN22'].includes(normalized)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported Solana token program: ${value}.`);
}

export class SolanaTransferService {
  constructor(options = {}) {
    this.domain = options.domain || null;
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
      network: NETWORK,
      cluster: this.cluster,
      rpcConfigured,
      signerConfigured,
      configured: rpcConfigured && signerConfigured,
      ready: rpcConfigured && signerConfigured,
      capabilities: ['CREATE_ASSET', 'ISSUE_ASSET', 'TRANSFER_NATIVE', 'TRANSFER_ASSET'],
    };
  }

  ensure() {
    const status = this.status();
    if (!status.configured) {
      const error = new Error('Network RPC and signer are not configured.');
      error.code = 'ON_CHAIN_NETWORK_NOT_READY';
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

  assetRecord(asset) {
    const normalizedAsset = normalize(asset);
    if (normalizedAsset === NATIVE_ASSET) return { native: true, asset: NATIVE_ASSET };
    const record = (this.domain?.list?.(ASSET_TYPE) || []).find((candidate) => {
      if (normalize(candidate.network) !== NETWORK) return false;
      const identifiers = [candidate.asset, candidate.symbol, candidate.instrumentId, candidate.assetId, candidate.assetAddress, candidate.mintAddress]
        .map(normalize).filter(Boolean);
      return identifiers.includes(normalizedAsset);
    });
    if (!record) {
      const error = new Error(`Asset ${normalizedAsset} has not been created on ${NETWORK}.`);
      error.code = 'ON_CHAIN_ASSET_NOT_CREATED';
      throw error;
    }
    return record;
  }

  async createAsset(input = {}) {
    const decimals = decimalsValue(input.decimals ?? 9);
    const { connection, payer } = this.ensure();
    const programId = tokenProgram(input.tokenProgram || this.environment.SOLANA_TOKEN_PROGRAM || 'TOKEN');
    const mint = Keypair.generate();
    const rent = await getMinimumBalanceForRentExemptMint(connection);
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId,
      }),
      createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, payer.publicKey, programId),
    );
    transaction.sign(payer, mint);
    const transactionId = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 });
    const confirmation = await this.confirm(transactionId);
    if (confirmation.state === 'FAILED') {
      const error = new Error('Asset creation transaction failed on network.');
      error.code = 'ON_CHAIN_ASSET_CREATE_FAILED';
      error.transactionId = transactionId;
      throw error;
    }
    return {
      network: NETWORK,
      cluster: this.cluster,
      assetAddress: mint.publicKey.toBase58(),
      mintAddress: mint.publicKey.toBase58(),
      decimals,
      tokenProgram: programId.toBase58(),
      authorityAddress: payer.publicKey.toBase58(),
      transactionId,
      confirmation,
      state: confirmation.state,
    };
  }

  async issueAsset(assetRecord, input = {}) {
    if (!assetRecord?.assetAddress && !assetRecord?.mintAddress) throw new Error('On-chain asset address is required.');
    const { connection, payer } = this.ensure();
    const mint = publicKey(assetRecord.assetAddress || assetRecord.mintAddress, 'assetAddress');
    const programId = tokenProgram(assetRecord.tokenProgram || this.environment.SOLANA_TOKEN_PROGRAM || 'TOKEN');
    const mintInfo = await getMint(connection, mint, 'confirmed', programId);
    if (!mintInfo.mintAuthority || !mintInfo.mintAuthority.equals(payer.publicKey)) {
      const error = new Error('Configured signer is not the mint authority for this asset.');
      error.code = 'ON_CHAIN_MINT_AUTHORITY_MISMATCH';
      throw error;
    }
    const amount = text(input.amount);
    const units = exactUnits(amount, mintInfo.decimals);
    const destination = input.destinationAddress ? publicKey(input.destinationAddress, 'destinationAddress') : payer.publicKey;
    const destinationAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      destination,
      false,
      'confirmed',
      { commitment: 'confirmed' },
      programId,
    );
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(
      createMintToInstruction(mint, destinationAccount.address, payer.publicKey, units, [], programId),
    );
    transaction.sign(payer);
    const transactionId = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 });
    const confirmation = await this.confirm(transactionId);
    if (confirmation.state === 'FAILED') {
      const error = new Error('Asset issuance transaction failed on network.');
      error.code = 'ON_CHAIN_ASSET_ISSUE_FAILED';
      error.transactionId = transactionId;
      throw error;
    }
    return {
      network: NETWORK,
      assetAddress: mint.toBase58(),
      destinationAddress: destination.toBase58(),
      sourceAccount: destinationAccount.address.toBase58(),
      amount,
      transactionId,
      confirmation,
      state: confirmation.state,
    };
  }

  async build(input = {}) {
    const { connection, payer } = this.ensure();
    const destination = publicKey(input.destinationAddress, 'destinationAddress');
    const record = this.assetRecord(input.asset);
    const latest = await connection.getLatestBlockhash('confirmed');

    if (record.native) {
      const units = exactUnits(input.amount, 9);
      if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount is too large for this network transaction.');
      const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: destination, lamports: Number(units) }));
      return { transaction, latest, destination, record, fromAddress: payer.publicKey.toBase58() };
    }

    const programId = tokenProgram(record.tokenProgram || this.environment.SOLANA_TOKEN_PROGRAM || 'TOKEN');
    const mint = publicKey(record.assetAddress || record.mintAddress, 'assetAddress');
    const mintInfo = await getMint(connection, mint, 'confirmed', programId);
    const amountUnits = exactUnits(input.amount, mintInfo.decimals);
    const source = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, 'confirmed', { commitment:'confirmed' }, programId);
    const destinationAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, destination, false, 'confirmed', { commitment:'confirmed' }, programId);
    const transaction = new Transaction().add(
      createTransferCheckedInstruction(source.address, mint, destinationAccount.address, payer.publicKey, amountUnits, mintInfo.decimals, [], programId),
    );
    return { transaction, latest, destination, destinationAccount: destinationAccount.address, sourceAccount: source.address, record, fromAddress: payer.publicKey.toBase58() };
  }

  sign(prepared) {
    const { payer } = this.ensure();
    prepared.transaction.feePayer = payer.publicKey;
    prepared.transaction.recentBlockhash = prepared.latest.blockhash;
    prepared.transaction.sign(payer);
    return prepared;
  }

  async broadcast(prepared) {
    const { connection } = this.ensure();
    const transactionId = await connection.sendRawTransaction(prepared.transaction.serialize(), { skipPreflight: false, maxRetries: 3 });
    return { ...prepared, transactionId };
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

  async send(input = {}) {
    const prepared = await this.build(input);
    const signed = this.sign(prepared);
    const submitted = await this.broadcast(signed);
    const confirmation = await this.confirm(submitted.transactionId);
    return {
      transferId: input.transferId,
      network: NETWORK,
      asset: normalize(input.asset),
      amount: text(input.amount),
      fromAddress: submitted.fromAddress,
      destinationAddress: submitted.destination.toBase58(),
      transactionId: submitted.transactionId,
      confirmation,
      state: confirmation.state,
    };
  }
}

export { exactUnits, tokenProgram, U64_MAX };
