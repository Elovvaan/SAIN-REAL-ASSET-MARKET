import * as StellarSdk from '@stellar/stellar-sdk';

const NETWORK = 'STELLAR';
const NATIVE_ASSET = 'XLM';
const ASSET_TYPE = 'ON_CHAIN_ASSET';
const STELLAR_USDC_ISSUERS = Object.freeze({
  PUBLIC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  TESTNET: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
});
export function stellarUsdcIssuer(environment = process.env, passphrase = networkPassphrase(environment)) {
  const network = passphrase === StellarSdk.Networks.TESTNET ? 'TESTNET' : 'PUBLIC';
  return text(environment.STELLAR_USDC_ISSUER || STELLAR_USDC_ISSUERS[network]);
}
export const STELLAR_USDC = Object.freeze({
  network: NETWORK,
  asset: 'USDC',
  symbol: 'USDC',
  issuerAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  assetAddress: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  decimals: 7,
  externalIssuer: true,
});

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function amount(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw) || Number(raw) <= 0) {
    throw new Error('amount must be a positive Stellar amount with no more than 7 decimal places.');
  }
  return raw;
}
function amountSubunits(value) {
  const [whole, fraction=''] = amount(value).split('.');
  return BigInt(whole) * 10_000_000n + BigInt((fraction + '0000000').slice(0, 7));
}
function subunitsAmount(value) {
  const whole = value / 10_000_000n;
  const fraction = String(value % 10_000_000n).padStart(7, '0');
  return `${whole}.${fraction}`;
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

function horizonAsset(asset) {
  if (asset.asset_type === 'native') return StellarSdk.Asset.native();
  return new StellarSdk.Asset(asset.asset_code, asset.asset_issuer);
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
      publicNetwork: this.passphrase === StellarSdk.Networks.PUBLIC,
      issuerConfigured,
      distributorConfigured,
      configured: issuerConfigured && distributorConfigured && Boolean(this.horizonUrl) && Boolean(this.passphrase),
      ready: issuerConfigured && distributorConfigured && Boolean(this.horizonUrl) && Boolean(this.passphrase),
      capabilities: ['CREATE_ASSET', 'ISSUE_ASSET', 'TRANSFER_NATIVE', 'TRANSFER_ASSET', 'CREATE_DEX_OFFER', 'SWAP_FOR_USDC'],
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

  distributionAddress() { return this.ensure().distributor.publicKey(); }

  usdcRecord() {
    const network = this.passphrase === StellarSdk.Networks.TESTNET ? 'TESTNET' : 'PUBLIC';
    const issuerAddress = stellarUsdcIssuer(this.environment, this.passphrase);
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(issuerAddress)) throw new Error('STELLAR_USDC_ISSUER is not a valid Stellar issuer address.');
    return { ...STELLAR_USDC, issuerAddress, assetAddress:`USDC:${issuerAddress}`, networkEnvironment:network };
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
    const usdc = this.usdcRecord();
    if ([usdc.asset, usdc.assetAddress].map(upper).includes(normalized)) return usdc;
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

  async assetBalance(asset = 'USDC') {
    const { server, distributor } = this.ensure();
    const record = this.assetRecord(asset);
    const account = await server.loadAccount(distributor.publicKey());
    if (record.native) {
      const native = account.balances.find((balance) => balance.asset_type === 'native');
      return { asset: NATIVE_ASSET, balance: text(native?.balance || '0'), account: distributor.publicKey() };
    }
    const stellarAsset = this.stellarAsset(record);
    const balance = account.balances.find((candidate) => candidate.asset_type !== 'native'
      && candidate.asset_code === stellarAsset.code && candidate.asset_issuer === stellarAsset.issuer);
    return { asset: stellarAsset.code, issuerAddress: stellarAsset.issuer, balance: text(balance?.balance || '0'), account: distributor.publicKey(), trustline: Boolean(balance) };
  }

  async recipientStatus(destination, asset = 'USDC') {
    const address = text(destination);
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) return { address, exists: false, canReceive: false, error: 'Invalid Stellar account address.' };
    const { server } = this.ensure();
    const record = this.assetRecord(asset);
    try {
      const account = await server.loadAccount(address);
      const stellarAsset = record.native ? StellarSdk.Asset.native() : this.stellarAsset(record);
      const canReceive = record.native || account.balances.some((balance) => balance.asset_type !== 'native'
        && balance.asset_code === stellarAsset.code && balance.asset_issuer === stellarAsset.issuer);
      return { address, exists: true, canReceive, trustline: canReceive, asset: record.asset, issuerAddress: record.issuerAddress || null };
    } catch (error) {
      if (error?.response?.status === 404) return { address, exists: false, canReceive: false, error: 'Stellar account was not found on the configured network.' };
      throw error;
    }
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

  async quoteUsdcSwap(record, input = {}) {
    const { server, distributor } = this.ensure();
    const selling = this.stellarAsset(record);
    const sendAmount = amount(input.sellAmount);
    const slippageBps = Number(input.slippageBps ?? 100);
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) throw new Error('slippageBps must be an integer from 0 to 5000.');
    const usdcRecord = this.usdcRecord();
    const buying = this.stellarAsset(usdcRecord);
    const sourceBalance = await this.assetBalance(record.assetAddress);
    if (Number(sendAmount) > Number(sourceBalance.balance || 0)) throw new Error(`Swap exceeds the live distribution balance of ${sourceBalance.balance || 0} ${record.asset || record.symbol}.`);
    const response = await server.strictSendPaths(selling, sendAmount, [buying]).call();
    const paths = response?.records || [];
    if (!paths.length) {
      const error = new Error(`No live ${record.asset || record.symbol}/USDC order-book path is currently available on Stellar.`);
      error.code = 'STELLAR_USDC_LIQUIDITY_UNAVAILABLE';
      throw error;
    }
    const best = [...paths].sort((a,b)=>amountSubunits(a.destination_amount) > amountSubunits(b.destination_amount) ? -1 : 1)[0];
    const expectedUsdc = amount(best.destination_amount);
    const minimumUnits = amountSubunits(expectedUsdc) * BigInt(10000 - slippageBps) / 10000n;
    if (minimumUnits <= 0n) throw new Error('Live SRAUSD/USDC quote is too small to execute at Stellar precision.');
    const minimumUsdc = subunitsAmount(minimumUnits);
    return {
      network:NETWORK, market:`${record.asset || record.symbol}/USDC`, side:'SELL_SRA_ASSET_FOR_USDC',
      sourceAccount:distributor.publicKey(), sellAmount:sendAmount, expectedUsdc, minimumUsdc,
      slippageBps, path:(best.path || []).map((item)=>({ assetType:item.asset_type, assetCode:item.asset_code || 'XLM', issuerAddress:item.asset_issuer || null })),
      quotedAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60_000).toISOString(), state:'QUOTED',
    };
  }

  async executeUsdcSwap(record, quote) {
    if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new Error('SRAUSD/USDC quote has expired. Request a new quote.');
    const { server, distributor } = this.ensure();
    const selling = this.stellarAsset(record);
    const buying = this.stellarAsset(this.usdcRecord());
    const trustlineTransactionId = await this.ensureDistributorTrustline(buying);
    const account = await server.loadAccount(distributor.publicKey());
    const path = (quote.path || []).map((item)=>horizonAsset({ asset_type:item.assetType, asset_code:item.assetCode, asset_issuer:item.issuerAddress }));
    const tx = new StellarSdk.TransactionBuilder(account, { fee:StellarSdk.BASE_FEE, networkPassphrase:this.passphrase })
      .addOperation(StellarSdk.Operation.pathPaymentStrictSend({
        sendAsset:selling, sendAmount:amount(quote.sellAmount), destination:distributor.publicKey(),
        destAsset:buying, destMin:amount(quote.minimumUsdc), path,
      })).setTimeout(100).build();
    tx.sign(distributor);
    const result = await server.submitTransaction(tx);
    return {
      network:NETWORK, market:quote.market, side:quote.side, sellAmount:quote.sellAmount,
      quotedUsdc:quote.expectedUsdc, minimumUsdc:quote.minimumUsdc, sourceAccount:distributor.publicKey(),
      destinationAccount:distributor.publicKey(), trustlineTransactionId, transactionId:result.hash,
      confirmation:{ state:'CONFIRMED', transactionId:result.hash, ledger:result.ledger }, state:'CONFIRMED',
    };
  }

  async reconcileUsdcSwap(_record, swap) {
    const { server } = this.ensure();
    const response = await server.operations().forTransaction(swap.transactionId).call();
    const operation = (response?.records || []).find((item)=>item.type === 'path_payment_strict_send');
    if (!operation) throw new Error('Confirmed Stellar SRAUSD/USDC path-payment operation was not found.');
    return {
      actualSraSold:text(operation.source_amount || swap.sellAmount), actualUsdcReceived:text(operation.amount),
      marketState:'FILLED', state:'RECONCILED', reconciledAt:new Date().toISOString(),
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

    if (record.externalIssuer) {
      const balance = await this.assetBalance(record.asset);
      if (!balance.trustline) {
        const error = new Error(`The SRA Stellar distribution account does not have a trustline for ${record.asset}.`);
        error.code = 'STELLAR_SOURCE_TRUSTLINE_REQUIRED';
        throw error;
      }
      if (Number(balance.balance) < Number(transferAmount)) {
        const error = new Error(`USDC settlement exceeds the live treasury balance of ${balance.balance} USDC.`);
        error.code = 'STELLAR_USDC_INSUFFICIENT_BALANCE';
        throw error;
      }
    }

    if (!record.native && !(await this.destinationCanReceive(destination, stellarAsset))) {
      const error = new Error('Destination Stellar account does not have a trustline for this asset.');
      error.code = 'STELLAR_DESTINATION_TRUSTLINE_REQUIRED';
      throw error;
    }

    const builder = new StellarSdk.TransactionBuilder(source, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.passphrase,
    }).addOperation(StellarSdk.Operation.payment({
      destination,
      asset: stellarAsset,
      amount: transferAmount,
    }));
    const memo = text(input.memo);
    if (memo) {
      if (Buffer.byteLength(memo, 'utf8') > 28) throw new Error('Stellar text memo must not exceed 28 bytes.');
      builder.addMemo(StellarSdk.Memo.text(memo));
    }
    const transaction = builder.setTimeout(100).build();

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

  async verifyIncomingUsdcPayment(transactionId, expected = {}) {
    const { server, distributor } = this.ensure();
    const hash = text(transactionId);
    if (!hash) throw new Error('transactionId is required.');
    const confirmation = await this.confirm(hash);
    if (confirmation.state !== 'CONFIRMED') return { verified:false, reason:`TRANSACTION_${confirmation.state}`, transactionId:hash };
    const destination = text(expected.destinationAddress || distributor.publicKey());
    if (destination !== distributor.publicKey()) return { verified:false, reason:'DESTINATION_NOT_SRA_DISTRIBUTION_ACCOUNT', transactionId:hash };
    const page = await server.payments().forTransaction(hash).call();
    const payment = (page.records || []).find((record) => record.type === 'payment'
      && record.to === destination
      && record.asset_code === STELLAR_USDC.asset
      && record.asset_issuer === STELLAR_USDC.issuerAddress
      && (!text(expected.amount) || Number(record.amount) === Number(expected.amount)));
    if (!payment) return { verified:false, reason:'EXPECTED_CIRCLE_USDC_PAYMENT_NOT_FOUND', transactionId:hash, ledger:confirmation.ledger };
    return { verified:true, state:'CONFIRMED', transactionId:hash, ledger:confirmation.ledger,
      sourceAddress:payment.from, destinationAddress:payment.to, amount:text(payment.amount),
      asset:STELLAR_USDC.asset, issuerAddress:STELLAR_USDC.issuerAddress };
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
      memo: text(input.memo) || null,
      transactionId: submitted.transactionId,
      confirmation,
      state: confirmation.state,
    };
  }
}
