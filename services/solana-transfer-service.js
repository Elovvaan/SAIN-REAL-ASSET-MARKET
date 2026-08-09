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
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const NETWORK = 'SOLANA';
const NATIVE_ASSET = 'SOL';
const REPRESENTATION_TYPE = 'ON_CHAIN_PROJECTION';
const U64_MAX = (1n << 64n) - 1n;

function text(value) { return String(value ?? '').trim(); }
function normalize(value) { return text(value).toUpperCase(); }

function exactUnits(value, decimals, name = 'amount', { enforceU64 = true } = {}) {
  const source = text(value);
  if (!/^\d+(?:\.\d+)?$/.test(source)) throw new Error(`${name} must be a positive decimal amount.`);
  const [whole, fraction = ''] = source.split('.');
  if (fraction.length > decimals) throw new Error(`${name} cannot exceed ${decimals} decimal places.`);
  const units = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  if (units <= 0n) throw new Error(`${name} must be greater than zero.`);
  if (enforceU64 && units > U64_MAX) {
    const error = new Error(`${name} exceeds the maximum SPL token amount at ${decimals} decimals.`);
    error.code = 'SOLANA_TOKEN_AMOUNT_U64_OVERFLOW';
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
  try {
    return new PublicKey(text(value));
  } catch {
    throw new Error(`${name} is not a valid destination-network address.`);
  }
}

function tokenProgram(value) {
  const normalized = normalize(value || 'TOKEN_2022');
  if (['TOKEN_2022', 'TOKEN-2022', 'TOKEN2022'].includes(normalized)) return TOKEN_2022_PROGRAM_ID;
  if (['TOKEN', 'SPL_TOKEN', 'ORIGINAL'].includes(normalized)) return TOKEN_PROGRAM_ID;
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
      capabilities: ['ISSUE_TOKEN_REPRESENTATION', 'TRANSFER_NATIVE', 'TRANSFER_TOKEN'],
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

  representation(asset) {
    const normalizedAsset = normalize(asset);
    if (normalizedAsset === NATIVE_ASSET) return { native: true, asset: normalizedAsset };

    const records = this.domain?.list?.(REPRESENTATION_TYPE) || [];
    const record = records.find((candidate) => {
      if (normalize(candidate.network) !== NETWORK) return false;
      if (!text(candidate.mintAddress)) return false;
      if (!['ACTIVE', 'ISSUED'].includes(normalize(candidate.status))) return false;
      const identifiers = [candidate.asset, candidate.symbol, candidate.ticker, candidate.instrumentId, candidate.permanentAssetAccountId, candidate.authoritativeSraRecordId]
        .map(normalize).filter(Boolean);
      return identifiers.includes(normalizedAsset);
    });

    if (!record) {
      const error = new Error(`Asset ${normalizedAsset} has no active on-chain representation on ${NETWORK}.`);
      error.code = 'ON_CHAIN_ASSET_NOT_REPRESENTED';
      throw error;
    }

    return {
      native: false,
      asset: normalizedAsset,
      assetAddress: record.mintAddress,
      sourceAccount: record.platformTokenAccount || record.sourceTokenAccount || null,
      representationId: record.projectionId || record.id || null,
      chainProgram: record.chainProgram || 'TOKEN_2022',
    };
  }

  validateIssuance(projection, input = {}) {
    if (!projection) throw new Error('On-chain projection is required.');
    if (normalize(projection.network) !== NETWORK) throw new Error('Projection is not for Solana.');
    if (normalize(projection.status) !== 'APPROVED') throw new Error(`Projection must be APPROVED before issuance. Current status: ${projection.status}.`);
    if (text(projection.mintAddress)) throw new Error('Projection already has an on-chain mint address.');

    const decimals = decimalsValue(input.decimals ?? projection.decimals);
    const amount = text(input.amount);
    const units = exactUnits(amount, decimals, 'amount');
    const authorizedText = text(projection.authorizedSupplyExact ?? projection.authorizedSupply);
    const authorizedUnits = authorizedText ? exactUnits(authorizedText, decimals, 'authorizedSupply') : 0n;
    if (authorizedUnits > 0n && units > authorizedUnits) throw new Error('Issuance amount exceeds authorized supply.');
    const programId = tokenProgram(projection.chainProgram);
    return { decimals, amount, units, authorizedUnits, programId };
  }

  async issueRepresentation(projection, input = {}) {
    // Validate all amount/program constraints before ensure() or any network RPC creates resources.
    const validated = this.validateIssuance(projection, input);
    const { decimals, amount, units, authorizedUnits, programId } = validated;
    const { connection, payer } = this.ensure();

    const mint = await createMint(connection, payer, payer.publicKey, payer.publicKey, decimals, undefined, { commitment: 'confirmed' }, programId);
    const platformTokenAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, 'confirmed', { commitment: 'confirmed' }, programId);
    const issuanceTransactionId = await mintTo(connection, payer, mint, platformTokenAccount.address, payer, units, [], { commitment: 'confirmed' }, programId);
    const confirmation = await this.confirm(issuanceTransactionId);
    if (confirmation.state === 'FAILED') {
      const error = new Error('Token issuance transaction failed on network.');
      error.transactionId = issuanceTransactionId;
      throw error;
    }

    return {
      network: NETWORK,
      cluster: this.cluster,
      chainProgram: projection.chainProgram || 'TOKEN_2022',
      mintAddress: mint.toBase58(),
      platformTokenAccount: platformTokenAccount.address.toBase58(),
      mintAuthorityAddress: payer.publicKey.toBase58(),
      freezeAuthorityAddress: payer.publicKey.toBase58(),
      decimals,
      issuedSupply: amount,
      issuedSupplyExact: amount,
      issuedSupplyUnits: units.toString(),
      authorizedSupplyUnits: authorizedUnits.toString(),
      issuanceTransactionId,
      confirmation,
      issuedAt: new Date().toISOString(),
    };
  }

  async build(input = {}) {
    const { connection, payer } = this.ensure();
    const destination = publicKey(input.destinationAddress, 'destinationAddress');
    const representation = this.representation(input.asset);
    const latest = await connection.getLatestBlockhash('confirmed');

    if (representation.native) {
      const units = exactUnits(input.amount, 9, 'amount', { enforceU64: false });
      if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount is too large for this network transaction.');
      const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: destination, lamports: Number(units) }));
      return { transaction, latest, destination, representation, fromAddress: payer.publicKey.toBase58() };
    }

    const programId = tokenProgram(representation.chainProgram);
    const mint = publicKey(representation.assetAddress, 'assetAddress');
    const mintInfo = await getMint(connection, mint, 'confirmed', programId);
    const amountUnits = exactUnits(input.amount, mintInfo.decimals);
    const source = representation.sourceAccount
      ? { address: publicKey(representation.sourceAccount, 'sourceAccount') }
      : await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, 'confirmed', { commitment:'confirmed' }, programId);
    const destinationAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, destination, false, 'confirmed', { commitment:'confirmed' }, programId);
    const transaction = new Transaction().add(createTransferCheckedInstruction(source.address, mint, destinationAccount.address, payer.publicKey, amountUnits, mintInfo.decimals, [], programId));

    return { transaction, latest, destination, destinationAccount: destinationAccount.address, sourceAccount: source.address, representation, fromAddress: payer.publicKey.toBase58() };
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

export { tokenProgram, exactUnits, U64_MAX };
