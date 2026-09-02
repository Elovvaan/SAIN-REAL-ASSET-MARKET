import * as StellarSdk from '@stellar/stellar-sdk';

const NETWORK = 'STELLAR';
const NATIVE_ASSET = 'XLM';
const ASSET_TYPE = 'ON_CHAIN_ASSET';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function amount(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw) || Number(raw) <= 0) {
    throw new Error('amount must be a positive Stellar amount with no more than 7 decimal places.');
  }
  return raw;
}
function assetCode(value) {
  const code = upper(value);
  if (!/^[A-Z0-9]{1,12}$/.test(code)) throw new Error('Stellar asset code must be 1 to 12 letters or numbers.');
  return code;
}
function keypair(secret, name) {
  const raw = text(secret);
  if (!raw) throw new Error(`${name} is required.`);
  try { return StellarSdk.Keypair.fromSecret(raw); }
  catch { throw new Error(`${name} is not a valid Stellar secret key.`); }
}
function networkPassphrase(environment) {
  const explicit = text(environment.STELLAR_NETWORK_PASSPHRASE);
  if (explicit) return explicit;
  const name = upper(environment.STELLAR_NETWORK || 'PUBLIC');
  if (name === 'PUBLIC' || name === 'MAINNET') return StellarSdk.Networks.PUBLIC;
  if (name === 'TESTNET') return StellarSdk.Networks.TESTNET;
  throw new Error('STELLAR_NETWORK must be PUBLIC, MAINNET, or TESTNET, or STELLAR_NETWORK_PASSPHRASE must be set.');
}
function horizonUrl(environment) {
  const explicit = text(environment.STELLAR_HORIZON_URL);
  if (explicit) return explicit;
  const name = upper(environment.STELLAR_NETWORK || 'PUBLIC');
  return name === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org';
}
function accountHealthError(role, address, error) {
  const status = error?.response?.status;
  if (status === 404) return `${role} account ${address} was not found on the configured Stellar network.`;
  return `${role} account ${address} could not be loaded from Horizon: ${String(error?.message || error)}.`;
}

export class StellarTransferService {
  constructor(options = {}) {
    this.domain = options.domain || null;
    this.environment = options.environment || process.env;
    this.horizonUrl = horizonUrl(this.environment);
    this.passphrase = networkPassphrase(this.environment);
    this.server = null;
    this.issuer = null;
    this.distributor = null;
  }

  status() {
    const issuerConfigured = Boolean(text(this.environment.STELLAR_ISSUER_SECRET));
    const distributorConfigured = Boolean(text(this.environment.STELLAR_DISTRIBUTOR_SECRET));
    return {
      network: NETWORK,
      horizonUrl: this.horizonUrl,
      networkConfigured: Boolean(this.passphrase),
      issuerConfigured,
      distributorConfigured,
      configured: issuerConfigured && distributorConfigured && Boolean(this.horizonUrl) && Boolean(this.passphrase),
      ready: issuerConfigured && distributorConfigured && Boolean(this.horizonUrl) && Boolean(this.passphrase),
      capabilities: ['CREATE_ASSET', 'ISSUE_ASSET', 'TRANSFER_NATIVE', 'TRANSFER_ASSET', 'CREATE_DEX_OFFER'],
    };
  }

  ensure() {
    if (!this.status().configured) {
      const error = new Error('Stellar issuer and distributor signers are not configured.');
      error.code = 'ON_CHAIN_NETWORK_NOT_READY';
      throw error;
    }
    if (!this.server) this.server = new StellarSdk.Horizon.Server(this.horizonUrl);
    if (!this.issuer) this.issuer = keypair(this.environment.STELLAR_ISSUER_SECRET, 'STELLAR_ISSUER_SECRET');
    if (!this.distributor) this.distributor = keypair(this.environment.STELLAR_DISTRIBUTOR_SECRET, 'STELLAR_DISTRIBUTOR_SECRET');
    return { server: this.server, issuer: this.issuer, distributor: this.distributor };
  }

  async health() {
    const configuration = this.status();
    if (!configuration.configured) return { ...configuration, reachable: false };
    try {
      const { server, issuer, distributor } = this.ensure();
      const issuerAddress = issuer.publicKey();
      const distributorAddress = distributor.publicKey();
      const [issuerResult, distributorResult] = await Promise.allSettled([
        server.loadAccount(issuerAddress),
        server.loadAccount(distributorAddress),
      ]);
      const issuerReachable = issuerResult.status === 'fulfilled';
      const distributorReachable = distributorResult.status === 'fulfilled';
      const errors = [];
      if (!issuerReachable) errors.push(accountHealthError('Issuer', issuerAddress, issuerResult.reason));
      if (!distributorReachable) errors.push(accountHealthError('Distributor', distributorAddress, distributorResult.reason));
      const ready = issuerReachable && distributorReachable;
      return {
        ...configuration,
        reachable: ready,
        ready,
        issuanceReady: ready,
        issuerAddress,
        distributorAddress,
        issuerReachable,
        distributorReachable,
        error: errors.length ? errors.join(' ') : undefined,
      };
    } catch (error) {
      return { ...configuration, reachable: false, ready: false, error: String(error?.message || error) };
    }
  }

  assetRecord(asset) {
    const normalized = upper(asset);
    if (normalized === NATIVE_ASSET) return { native: true, asset: NATIVE_ASSET };
    const record = (this.domain?.list?.(ASSET_TYPE) || []).find((candidate) => {
      if (upper(candidate.network) !== NETWORK) return false;
      return [candidate.asset, candidate.symbol, candidate.instrumentId, candidate.assetId, candidate.assetAddress]
        .map(upper).filter(Boolean).includes(normalized);
    });
    if (!record) {
      const error = new Error(`Asset ${normalized} has not been created on ${NETWORK}.`);
      error.code = 'ON_CHAIN_ASSET_NOT_CREATED';
      throw error;
    }
    return record;
  }

  async createAsset(input = {}) {
    const { issuer, distributor } = this.ensure();
    const code = assetCode(input.asset || input.symbol);
    const asset = new StellarSdk.Asset(code, issuer.publicKey());
    return {
      network: NETWORK,
      asset: code,
      symbol: code,
      assetAddress: `${asset.code}:${asset.issuer}`,
      issuerAddress: issuer.publicKey(),
      distributionAddress: distributor.publicKey(),
      decimals: 7,
      transactionId: null,
      state: 'CREATED',
    };
  }

  async ensureDistributorTrustline(asset) {
    const { server, distributor } = this.ensure();
    const account = await server.loadAccount(distributor.publicKey());
    const exists = account.balances.some((balance) => balance.asset_type !== 'native'
      && balance.asset_code === asset.code
      && balance.asset_issuer === asset.issuer);
    if (exists) return null;

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.passphrase,
    }).addOperation(StellarSdk.Operation.changeTrust({ asset }))
      .setTimeout(100)
      .build();
    tx.sign(distributor);
    const result = await server.submitTransaction(tx);
    return result.hash;
  }

  stellarAsset(record) {
    const [code, issuer] = text(record.assetAddress).split(':');
    if (!code || !issuer) throw new Error('Stellar asset address must be CODE:ISSUER.');
    return new StellarSdk.Asset(code, issuer);
  }

  async issueAsset(record, input = {}) {
    const { server, issuer, distributor } = this.ensure();
    const stellarAsset = this.stellarAsset(record);
    if (stellarAsset.issuer !== issuer.publicKey()) {
      const error = new Error('Configured Stellar issuer is not the issuer for this asset.');
      error.code = 'ON_CHAIN_ISSUER_MISMATCH';
      throw error;
    }
    const issueAmount = amount(input.amount);
    const trustlineTransactionId = await this.ensureDistributorTrustline(stellarAsset);
    const issuerAccount = await server.loadAccount(issuer.publicKey());
    const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.passphrase,
    }).addOperation(StellarSdk.Operation.payment({
      destination: distributor.publicKey(),
      asset: stellarAsset,
      amount: issueAmount,
    })).setTimeout(100).build();
    tx.sign(issuer);
    const result = await server.submitTransaction(tx);
    return {
      network: NETWORK,
      assetAddress: record.assetAddress,
      sourceAccount: distributor.publicKey(),
      destinationAddress: distributor.publicKey(),
      amount: issueAmount,
      trustlineTransactionId,
      transactionId: result.hash,
      confirmation: { state: 'CONFIRMED', transactionId: result.hash, ledger: result.ledger },
      state: 'CONFIRMED',
    };
  }

  async createOffer(record, input = {}) {
    const { server, distributor } = this.ensure();
    const selling = this.stellarAsset(record);
    const sellAmount = amount(input.sellAmount);
    const buyAmountXlm = amount(input.buyAmountXlm ?? input.buyAmountNative);
    const price = Number(buyAmountXlm) / Number(sellAmount);
    if (!Number.isFinite(price) || price <= 0) throw new Error('The SRA/XLM offer price must be greater than zero.');
    const account = await server.loadAccount(distributor.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.passphrase,
    }).addOperation(StellarSdk.Operation.manageSellOffer({
      selling,
      buying: StellarSdk.Asset.native(),
      amount: sellAmount,
      price: price.toFixed(7),
    })).setTimeout(100).build();
    tx.sign(distributor);
    const result = await server.submitTransaction(tx);
    return {
      network: NETWORK,
      market: `${record.asset || record.symbol}/XLM`,
      side: 'SELL_SRA_ASSET_FOR_XLM',
      sellAmount,
      buyAmountXlm,
      priceXlmPerUnit: price.toFixed(7),
      transactionId: result.hash,
      confirmation: { state: 'CONFIRMED', transactionId: result.hash, ledger: result.ledger },
      state: 'CONFIRMED',
    };
  }

  async destinationCanReceive(destination, stellarAsset) {
    const { server } = this.ensure();
    const account = await server.loadAccount(destination);
    return account.balances.some((balance) => balance.asset_type !== 'native'
      && balance.asset_code === stellarAsset.code
      && balance.asset_issuer === stellarAsset.issuer);
  }

  async build(input = {}) {
    const { server, distributor } = this.ensure();
    const destination = text(input.destinationAddress);
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(destination)) throw new Error('destinationAddress is not a valid Stellar account address.');
    const transferAmount = amount(input.amount);
    const record = this.assetRecord(input.asset);
    const source = await server.loadAccount(distributor.publicKey());
    const stellarAsset = record.native ? StellarSdk.Asset.native() : this.stellarAsset(record);

    if (!record.native && !(await this.destinationCanReceive(destination, stellarAsset))) {
      const error = new Error('Destination Stellar account does not have a trustline for this asset.');
      error.code = 'STELLAR_DESTINATION_TRUSTLINE_REQUIRED';
      throw error;
    }

    const transaction = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.passphrase,
    }).addOperation(StellarSdk.Operation.payment({
      destination,
      asset: stellarAsset,
      amount: transferAmount,
    })).setTimeout(100).build();

    return { transaction, destination, fromAddress: distributor.publicKey(), record };
  }

  sign(prepared) {
    const { distributor } = this.ensure();
    prepared.transaction.sign(distributor);
    return prepared;
  }

  async broadcast(prepared) {
    const { server } = this.ensure();
    const result = await server.submitTransaction(prepared.transaction);
    return { ...prepared, transactionId: result.hash, ledger: result.ledger };
  }

  async confirm(transactionId) {
    const { server } = this.ensure();
    const hash = text(transactionId);
    if (!hash) throw new Error('transactionId is required.');
    try {
      const tx = await server.transactions().transaction(hash).call();
      return { state: tx.successful ? 'CONFIRMED' : 'FAILED', transactionId: hash, ledger: tx.ledger };
    } catch (error) {
      if (error?.response?.status === 404) return { state: 'PENDING', transactionId: hash };
      throw error;
    }
  }

  async send(input = {}) {
    const prepared = await this.build(input);
    const signed = this.sign(prepared);
    const submitted = await this.broadcast(signed);
    const confirmation = await this.confirm(submitted.transactionId);
    return {
      transferId: input.transferId,
      network: NETWORK,
      asset: upper(input.asset),
      amount: text(input.amount),
      fromAddress: submitted.fromAddress,
      destinationAddress: submitted.destination,
      transactionId: submitted.transactionId,
      confirmation,
      state: confirmation.state,
    };
  }
}
