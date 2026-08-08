import crypto from 'node:crypto';
import { Pool } from 'pg';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

function text(value) { return String(value ?? '').trim(); }
function required(value, field) { const out = text(value); if (!out) throw new Error(`${field} is required.`); return out; }
function positive(value, field) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be greater than zero.`); return n; }
function integer(value, field, fallback) { const n = Number.parseInt(value ?? fallback, 10); if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} must be a positive integer.`); return n; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function parseSecretKey(value) {
  const raw = required(value, 'SOLANA_PAYER_SECRET_KEY');
  let bytes;
  if (raw.startsWith('[')) bytes = Uint8Array.from(JSON.parse(raw));
  else bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
  if (![32,64].includes(bytes.length)) throw new Error('SOLANA_PAYER_SECRET_KEY must decode to 32 or 64 bytes.');
  return bytes;
}

function signerFromSecret(value) {
  const bytes = parseSecretKey(value);
  return bytes.length === 32 ? Keypair.fromSeed(bytes) : Keypair.fromSecretKey(bytes);
}

function decimalToBaseUnits(value, decimals) {
  const source = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(source)) throw new Error(`Invalid decimal token quantity: ${source}.`);
  const [whole, fraction = ''] = source.split('.');
  if (fraction.length > decimals) throw new Error(`Token quantity ${source} exceeds mint precision of ${decimals} decimals.`);
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}

async function rpcCall(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ jsonrpc:'2.0', id:crypto.randomUUID(), method, params }) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Solana RPC ${method} failed with HTTP ${response.status}.`);
  return payload.result;
}

async function mintDecimals(rpcUrl, mint) {
  const result = await rpcCall(rpcUrl, 'getTokenSupply', [mint, { commitment:'confirmed' }]);
  const decimals = Number(result?.value?.decimals);
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Could not determine decimals for mint ${mint}.`);
  return decimals;
}

async function accountExists(rpcUrl, address) {
  const result = await rpcCall(rpcUrl, 'getAccountInfo', [address, { commitment:'confirmed', encoding:'base64' }]);
  return Boolean(result?.value);
}

export class OrcaExecutorWorker {
  constructor(env = process.env) {
    this.env = env;
    this.rpcUrl = text(env.SOLANA_RPC_URL);
    this.cluster = text(env.SOLANA_CLUSTER || 'devnet').toLowerCase();
    this.apiToken = text(env.SOLANA_EXECUTOR_TOKEN || env.DEX_ORCA_EXECUTOR_TOKEN || env.EXECUTOR_API_TOKEN);
    this.databaseUrl = text(env.DATABASE_URL || env.EXECUTOR_DATABASE_URL);
    const sslMode = text(env.PGSSLMODE).toLowerCase();
    this.pool = this.databaseUrl ? new Pool({ connectionString:this.databaseUrl, ...(sslMode === 'require' ? { ssl:{ rejectUnauthorized:false } } : {}) }) : null;
    this.sdk = null;
    this.ready = false;
  }

  async initialize() {
    if (!this.rpcUrl) throw new Error('SOLANA_RPC_URL is required.');
    if (!this.apiToken) throw new Error('SOLANA_EXECUTOR_TOKEN or DEX_ORCA_EXECUTOR_TOKEN is required.');
    if (!this.pool) throw new Error('DATABASE_URL or EXECUTOR_DATABASE_URL is required for durable idempotency.');
    if (!['devnet','mainnet'].includes(this.cluster)) throw new Error('SOLANA_CLUSTER must be devnet or mainnet.');
    parseSecretKey(this.env.SOLANA_PAYER_SECRET_KEY);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sra_dex_executor_requests (idempotency_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, state TEXT NOT NULL, pool_address TEXT, pool_signature TEXT, position_mint TEXT, liquidity_signature TEXT, response_json JSONB, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sra_solana_transfers (transfer_id TEXT PRIMARY KEY, destination_address TEXT NOT NULL, amount_sol NUMERIC NOT NULL, transaction_signature TEXT, state TEXT NOT NULL, response_json JSONB, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    this.ready = true;
    return this.status();
  }

  platformWallet() {
    const signer = signerFromSecret(this.env.SOLANA_PAYER_SECRET_KEY);
    return { network:'SOLANA', cluster:this.cluster, address:signer.publicKey.toBase58(), asset:'SOL' };
  }

  status() {
    return { service:'SRA Solana Executor Worker', contract:'SRA_DEX_EXECUTOR_V1', venue:'ORCA_WHIRLPOOLS', network:'SOLANA', cluster:this.cluster, platformAddress:text(this.env.SOLANA_PAYER_SECRET_KEY) ? this.platformWallet().address : null, rpcConfigured:Boolean(this.rpcUrl), credentialConfigured:Boolean(this.apiToken), signerConfigured:Boolean(text(this.env.SOLANA_PAYER_SECRET_KEY)), durableIdempotencyConfigured:Boolean(this.pool), ready:this.ready };
  }

  authenticate(authorization) {
    const expected = `Bearer ${this.apiToken}`;
    const provided = text(authorization);
    const a = Buffer.from(expected); const b = Buffer.from(provided);
    return a.length === b.length && crypto.timingSafeEqual(a,b);
  }

  async transferSol(input = {}, idempotencyKey) {
    if (!this.ready) throw new Error('Executor worker is not initialized.');
    const transferId = required(input.transferId, 'transferId');
    if (idempotencyKey !== transferId) throw new Error('Idempotency-Key must equal transferId.');
    if (text(input.asset || 'SOL').toUpperCase() !== 'SOL') throw new Error('Direct transfer currently supports SOL only.');
    const amount = positive(input.amount, 'amount');
    const destinationAddress = required(input.destinationAddress, 'destinationAddress');
    let destination;
    try { destination = new PublicKey(destinationAddress); } catch { throw new Error('destinationAddress is not a valid Solana address.'); }
    const existing = (await this.pool.query('SELECT * FROM sra_solana_transfers WHERE transfer_id=$1', [transferId])).rows[0];
    if (existing?.state === 'CONFIRMED' && existing.response_json) return existing.response_json;
    if (existing && (existing.destination_address !== destinationAddress || Number(existing.amount_sol) !== amount)) throw new Error('transferId was already used with different transfer details.');
    if (!existing) await this.pool.query(`INSERT INTO sra_solana_transfers(transfer_id,destination_address,amount_sol,state) VALUES($1,$2,$3,'PREPARED')`, [transferId,destinationAddress,amount]);
    const signer = signerFromSecret(this.env.SOLANA_PAYER_SECRET_KEY);
    const lamports = Math.round(amount * LAMPORTS_PER_SOL);
    if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error('amount cannot be represented safely in lamports.');
    const connection = new Connection(this.rpcUrl, 'confirmed');
    try {
      const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey:signer.publicKey, toPubkey:destination, lamports }));
      const signature = await sendAndConfirmTransaction(connection, transaction, [signer], { commitment:'confirmed' });
      const response = { transferId, network:'SOLANA', cluster:this.cluster, asset:'SOL', fromAddress:signer.publicKey.toBase58(), destinationAddress, amount, transactionSignature:signature, state:'CONFIRMED', confirmedAt:new Date().toISOString() };
      await this.pool.query(`UPDATE sra_solana_transfers SET transaction_signature=$2,state='CONFIRMED',response_json=$3,last_error=NULL,updated_at=NOW() WHERE transfer_id=$1`, [transferId,signature,response]);
      return response;
    } catch (error) {
      await this.pool.query(`UPDATE sra_solana_transfers SET state='FAILED',last_error=$2,updated_at=NOW() WHERE transfer_id=$1`, [transferId,String(error?.message || error)]).catch(()=>{});
      throw error;
    }
  }

  validate(input = {}, idempotencyKey) {
    if (required(input.contract,'contract') !== 'SRA_DEX_EXECUTOR_V1') throw new Error('Unsupported executor contract.');
    if (required(input.venue,'venue') !== 'ORCA_WHIRLPOOLS') throw new Error('Unsupported venue.');
    if (required(input.network,'network') !== 'SOLANA') throw new Error('Unsupported network.');
    if (required(input.action,'action') !== 'CREATE_POOL_AND_SEED_LIQUIDITY') throw new Error('Unsupported executor action.');
    const dexExportId = required(input.dexExportId,'dexExportId');
    if (idempotencyKey !== dexExportId) throw new Error('Idempotency-Key must equal dexExportId.');
    return { contract:'SRA_DEX_EXECUTOR_V1', action:'CREATE_POOL_AND_SEED_LIQUIDITY', venue:'ORCA_WHIRLPOOLS', network:'SOLANA', dexExportId, sourceExportPackageId:required(input.sourceExportPackageId,'sourceExportPackageId'), projectionId:required(input.projectionId,'projectionId'), instrumentId:required(input.instrumentId,'instrumentId'), pair:required(input.pair,'pair'), baseMintAddress:required(input.baseMintAddress,'baseMintAddress'), quoteMintAddress:required(input.quoteMintAddress,'quoteMintAddress'), baseLiquidityQuantity:positive(input.baseLiquidityQuantity,'baseLiquidityQuantity'), quoteLiquidityQuantity:positive(input.quoteLiquidityQuantity,'quoteLiquidityQuantity'), initialMarketPrice:positive(input.initialMarketPrice,'initialMarketPrice'), tickSpacing:integer(input.tickSpacing,'tickSpacing',64), liquidityStrategy:text(input.liquidityStrategy || 'FULL_RANGE').toUpperCase(), maxSlippageBps:integer(input.maxSlippageBps,'maxSlippageBps',100), recordedValueReference:input.recordedValueReference || null, marketPricePolicy:'EXTERNAL_MARKET_PRICE_IS_OBSERVATIONAL_ONLY' };
  }

  async loadSdk() {
    if (this.sdk) return this.sdk;
    const whirlpools = await import('@orca-so/whirlpools');
    const kit = await import('@solana/kit');
    await whirlpools.setPayerFromBytes(parseSecretKey(this.env.SOLANA_PAYER_SECRET_KEY));
    await whirlpools.setRpc(this.rpcUrl, { pollIntervalMs:500, resendOnPoll:false });
    this.sdk = { ...whirlpools, address:kit.address };
    return this.sdk;
  }

  deployment(sdk) { return this.cluster === 'mainnet' ? sdk.WhirlpoolDeployment.mainnet : sdk.WhirlpoolDeployment.devnet; }

  async execute(input, idempotencyKey) {
    if (!this.ready) throw new Error('Executor worker is not initialized.');
    const request = this.validate(input, idempotencyKey);
    if (request.liquidityStrategy !== 'FULL_RANGE') throw new Error('The first executor version supports FULL_RANGE liquidity only.');
    const requestHash = sha256(request);
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [idempotencyKey]);
      let row = (await client.query('SELECT * FROM sra_dex_executor_requests WHERE idempotency_key=$1', [idempotencyKey])).rows[0];
      if (row && row.request_hash !== requestHash) throw new Error('Idempotency key was previously used with a different request.');
      if (row?.state === 'COMPLETED' && row.response_json) return row.response_json;
      const isRecovery = Boolean(row);
      if (!row) row = (await client.query(`INSERT INTO sra_dex_executor_requests(idempotency_key,request_hash,state) VALUES($1,$2,'STARTED') RETURNING *`, [idempotencyKey,requestHash])).rows[0];
      const sdk = await this.loadSdk(); const deployment = this.deployment(sdk);
      const base = sdk.address(request.baseMintAddress); const quote = sdk.address(request.quoteMintAddress); const ordered = sdk.orderMints(base, quote); const tokenA = ordered[0]; const tokenB = ordered[1];
      const baseIsA = String(tokenA) === request.baseMintAddress; const initialPrice = baseIsA ? request.initialMarketPrice : 1 / request.initialMarketPrice;
      const [baseDecimals, quoteDecimals] = await Promise.all([mintDecimals(this.rpcUrl, request.baseMintAddress),mintDecimals(this.rpcUrl, request.quoteMintAddress)]);
      const baseRaw = decimalToBaseUnits(request.baseLiquidityQuantity, baseDecimals); const quoteRaw = decimalToBaseUnits(request.quoteLiquidityQuantity, quoteDecimals); const tokenMaxA = baseIsA ? baseRaw : quoteRaw; const tokenMaxB = baseIsA ? quoteRaw : baseRaw;
      const preparedPool = await sdk.createConcentratedLiquidityPool(tokenA, tokenB, request.tickSpacing, { initialPrice, whirlpoolDeployment:deployment }); const poolAddress = String(preparedPool.poolAddress);
      if (!row.pool_address) { await client.query(`UPDATE sra_dex_executor_requests SET pool_address=$2,state='POOL_PREPARED',updated_at=NOW() WHERE idempotency_key=$1`, [idempotencyKey,poolAddress]); row.pool_address = poolAddress; }
      else if (row.pool_address !== poolAddress) throw new Error('Recovered pool address does not match the deterministic Orca pool address.');
      let poolSignature = row.pool_signature; const exists = await accountExists(this.rpcUrl, poolAddress);
      if (!exists) { poolSignature = String(await preparedPool.callback()); await client.query(`UPDATE sra_dex_executor_requests SET pool_signature=$2,state='POOL_CREATED',updated_at=NOW() WHERE idempotency_key=$1`, [idempotencyKey,poolSignature]); }
      else if (!isRecovery && !row.pool_signature) throw new Error('The Orca pool already exists and was not created by this executor request.');
      row = (await client.query('SELECT * FROM sra_dex_executor_requests WHERE idempotency_key=$1', [idempotencyKey])).rows[0]; let liquiditySignature = row.liquidity_signature; let positionMint = row.position_mint;
      if (!liquiditySignature) { const position = await sdk.openFullRangePosition(sdk.address(poolAddress), { tokenMaxA, tokenMaxB }, { slippageToleranceBps:request.maxSlippageBps, whirlpoolDeployment:deployment }); positionMint = String(position.positionMint || position.positionAddress || ''); await client.query(`UPDATE sra_dex_executor_requests SET position_mint=$2,state='LIQUIDITY_PREPARED',updated_at=NOW() WHERE idempotency_key=$1`, [idempotencyKey,positionMint || null]); liquiditySignature = String(await position.callback()); await client.query(`UPDATE sra_dex_executor_requests SET liquidity_signature=$2,state='LIQUIDITY_SEEDED',updated_at=NOW() WHERE idempotency_key=$1`, [idempotencyKey,liquiditySignature]); }
      const response = { connectorReference:`ORCA:${idempotencyKey}`, executionId:idempotencyKey, state:'CONFIRMED', transactionSignature:liquiditySignature || poolSignature, poolAddress, positionMint:positionMint || null, poolCreationSignature:poolSignature || null, liquiditySignature:liquiditySignature || null, executedQuantity:request.baseLiquidityQuantity, observedMarketPrice:request.initialMarketPrice, observedMarketPriceSource:'POOL_INITIALIZATION_INPUT', priceReferenceOnly:true, recordedValueReference:request.recordedValueReference, cluster:this.cluster };
      await client.query(`UPDATE sra_dex_executor_requests SET state='COMPLETED',response_json=$2,last_error=NULL,updated_at=NOW() WHERE idempotency_key=$1`, [idempotencyKey,response]); return response;
    } catch (error) { await client.query(`UPDATE sra_dex_executor_requests SET last_error=$2,updated_at=NOW() WHERE idempotency_key=$1`, [idempotencyKey,String(error?.message || error)]).catch(()=>{}); throw error; }
    finally { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [idempotencyKey]).catch(()=>{}); client.release(); }
  }

  async close() { await this.pool?.end(); }
}
