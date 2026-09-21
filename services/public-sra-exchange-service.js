import crypto from 'node:crypto';
import * as StellarSdk from '@stellar/stellar-sdk';
import { stellarUsdcIssuer } from './stellar-transfer-service.js';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function stellarAmount(value, name = 'amount') {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw) || Number(raw) <= 0) throw new Error(`${name} must be a positive Stellar amount with no more than 7 decimal places.`);
  return raw;
}
function units(value) {
  const [whole, fraction = ''] = stellarAmount(value).split('.');
  return BigInt(whole) * 10_000_000n + BigInt((fraction + '0000000').slice(0, 7));
}
function amountFromUnits(value) {
  const whole = value / 10_000_000n;
  const fraction = String(value % 10_000_000n).padStart(7, '0');
  return `${whole}.${fraction}`;
}
function networkPassphrase(environment) {
  const explicit = text(environment.STELLAR_NETWORK_PASSPHRASE);
  if (explicit) return explicit;
  return upper(environment.STELLAR_NETWORK || 'PUBLIC') === 'TESTNET' ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
}
function horizonUrl(environment) {
  return text(environment.STELLAR_HORIZON_URL) || (networkPassphrase(environment) === StellarSdk.Networks.TESTNET ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
}
function assetFromAddress(address) {
  if (text(address).toLowerCase() === 'native:xlm') return StellarSdk.Asset.native();
  const [code, issuer] = text(address).split(':');
  if (!code || !StellarSdk.StrKey.isValidEd25519PublicKey(issuer)) throw new Error('The on-chain asset address is not available for exchange.');
  return new StellarSdk.Asset(code, issuer);
}
function sameAsset(left, right) {
  if (left?.isNative?.() || right?.isNative?.()) return Boolean(left?.isNative?.() && right?.isNative?.());
  return left?.code === right?.code && left?.issuer === right?.issuer;
}
function assetAddress(asset) { return asset.isNative() ? 'native:XLM' : `${asset.code}:${asset.issuer}`; }
function publicError(message, code) {
  return Object.assign(new Error(message), { code });
}

export class PublicSraExchangeService {
  constructor({ domain, environment = process.env, server = null } = {}) {
    this.domain = domain;
    this.environment = environment;
    this.passphrase = networkPassphrase(environment);
    this.horizonUrl = horizonUrl(environment);
    this.server = server || new StellarSdk.Horizon.Server(this.horizonUrl);
  }

  usdc() {
    return new StellarSdk.Asset('USDC', stellarUsdcIssuer(this.environment, this.passphrase));
  }

  routeRecords() {
    const marketTypes = [
      { recordType:'ON_CHAIN_USDC_MARKET', receiveAsset:'USDC' },
      { recordType:'ON_CHAIN_NATIVE_MARKET', receiveAsset:'XLM' },
    ];
    const assets = this.domain.list('ON_CHAIN_ASSET')
      .filter((asset) => upper(asset.network) === 'STELLAR' && Number(asset.issuedSupply || 0) > 0)
    return assets.flatMap((asset) => marketTypes.map(({ recordType, receiveAsset }) => {
      const market = this.domain.list(recordType).filter((item) => item.assetId === asset.assetId)
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0] || null;
      const state = upper(market?.state);
      return {
          routeId: `STELLAR:${receiveAsset}:${asset.assetId}`,
          assetId: asset.assetId,
          instrumentId: asset.instrumentId || null,
          asset: asset.asset || asset.symbol,
          assetAddress: asset.assetAddress,
          network: 'STELLAR',
          receiveAsset,
          pair: `SRA/${receiveAsset}`,
          issuedSupply: String(asset.issuedSupply),
          marketId: market?.marketId || null,
          marketState: state || 'NOT_ACTIVE',
          available: Boolean(market && ['ACTIVE', 'TWO_SIDED'].includes(state)),
      };
    }));
  }

  marketRecords() { return this.routeRecords().filter((route) => route.receiveAsset === 'USDC'); }

  status() {
    const routes = this.routeRecords();
    const usdc = this.usdc();
    return {
      network: 'STELLAR',
      networkEnvironment: this.passphrase === StellarSdk.Networks.TESTNET ? 'TESTNET' : 'PUBLIC',
      pair: 'SRA/USDC',
      usdcAssetAddress: `${usdc.code}:${usdc.issuer}`,
      accountRequired: false,
      walletControlsExchange: true,
      networks: [{ network:'STELLAR', label:'Stellar', addressPrefix:'G', walletConnector:'FREIGHTER_OR_SIGNED_XDR', available:routes.some((item)=>item.available) }],
      routes,
      availableRoutes: routes.filter((item) => item.available),
      markets: routes.filter((item) => item.receiveAsset === 'USDC'),
      availableMarkets: routes.filter((item) => item.receiveAsset === 'USDC' && item.available),
    };
  }

  resolveRoute({ assetId, network = 'STELLAR', receiveAsset = 'USDC' } = {}) {
    const route = this.routeRecords().find((item) => item.assetId === text(assetId) && item.network === upper(network) && item.receiveAsset === upper(receiveAsset));
    if (!route) throw publicError('The selected SRA exchange route was not found.', 'PUBLIC_EXCHANGE_ROUTE_NOT_FOUND');
    if (!route.available) throw publicError(`The ${route.pair} market for this asset is not active yet.`, 'PUBLIC_EXCHANGE_MARKET_NOT_ACTIVE');
    return route;
  }

  async quote({ quoteId, assetId, network = 'STELLAR', receiveAsset = 'USDC', sourceAddress, sellAmount, slippageBps = 100 } = {}) {
    const holder = text(sourceAddress);
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(holder)) throw publicError('Enter or connect the Stellar wallet holding the settled SRA.', 'PUBLIC_EXCHANGE_WALLET_INVALID');
    const sendAmount = stellarAmount(sellAmount, 'sellAmount');
    const slippage = Number(slippageBps);
    if (!Number.isInteger(slippage) || slippage < 0 || slippage > 5000) throw new Error('slippageBps must be an integer from 0 to 5000.');
    const market = this.resolveRoute({ assetId, network, receiveAsset });
    const selling = assetFromAddress(market.assetAddress);
    const buying = market.receiveAsset === 'XLM' ? StellarSdk.Asset.native() : this.usdc();
    let account;
    try { account = await this.server.loadAccount(holder); }
    catch (error) {
      if (error?.response?.status === 404) throw publicError('The connected Stellar wallet is not active on this network.', 'PUBLIC_EXCHANGE_WALLET_NOT_ACTIVE');
      throw error;
    }
    const balance = account.balances.find((item) => item.asset_type !== 'native' && item.asset_code === selling.code && item.asset_issuer === selling.issuer);
    if (!balance || Number(balance.balance || 0) < Number(sendAmount)) throw publicError(`The connected wallet does not hold ${sendAmount} ${selling.code} available for this exchange.`, 'PUBLIC_EXCHANGE_SRA_BALANCE_LOW');
    const receiveTrustline = buying.isNative() || account.balances.some((item) => item.asset_type !== 'native' && item.asset_code === buying.code && item.asset_issuer === buying.issuer);
    if (!receiveTrustline) throw publicError(`The connected wallet needs its ${market.receiveAsset} trustline before receiving ${market.receiveAsset}.`, 'PUBLIC_EXCHANGE_RECEIVE_TRUSTLINE_REQUIRED');
    const paths = (await this.server.strictSendPaths(selling, sendAmount, [buying]).call())?.records || [];
    if (!paths.length) throw publicError(`No live ${market.pair} exchange path is available for this amount right now.`, 'PUBLIC_EXCHANGE_PATH_UNAVAILABLE');
    const best = [...paths].sort((a, b) => units(a.destination_amount) > units(b.destination_amount) ? -1 : 1)[0];
    const expectedReceiveAmount = stellarAmount(best.destination_amount);
    const minimumUnits = units(expectedReceiveAmount) * BigInt(10000 - slippage) / 10000n;
    if (minimumUnits <= 0n) throw new Error('The quoted amount is below Stellar precision.');
    const minimumUsdc = amountFromUnits(minimumUnits);
    const path = (best.path || []).map((item) => item.asset_type === 'native' ? StellarSdk.Asset.native() : new StellarSdk.Asset(item.asset_code, item.asset_issuer));
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const transaction = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase: this.passphrase })
      .addOperation(StellarSdk.Operation.pathPaymentStrictSend({ sendAsset: selling, sendAmount, destination: holder, destAsset: buying, destMin: minimumUsdc, path }))
      .setTimeout(60)
      .build();
    return {
      quoteId,
      assetId: market.assetId,
      marketId: market.marketId,
      routeId: market.routeId,
      pair: market.pair,
      network: 'STELLAR',
      receiveAsset: market.receiveAsset,
      networkPassphrase: this.passphrase,
      sourceAddress: holder,
      destinationAddress: holder,
      sellAssetAddress: market.assetAddress,
      receiveAssetAddress: assetAddress(buying),
      sellAmount: sendAmount,
      expectedReceiveAmount,
      minimumReceiveAmount: minimumUsdc,
      expectedUsdc: market.receiveAsset === 'USDC' ? expectedReceiveAmount : null,
      minimumUsdc: market.receiveAsset === 'USDC' ? minimumUsdc : null,
      slippageBps: slippage,
      unsignedXdr: transaction.toXDR(),
      transactionHash: transaction.hash().toString('hex'),
      quotedAt: new Date().toISOString(),
      expiresAt,
      state: 'AWAITING_WALLET_SIGNATURE',
    };
  }

  verifySignedTransaction(quote, signedXdr) {
    if (new Date(quote.expiresAt).getTime() <= Date.now()) throw publicError('This quote has expired. Request a new quote.', 'PUBLIC_EXCHANGE_QUOTE_EXPIRED');
    let transaction;
    try { transaction = StellarSdk.TransactionBuilder.fromXDR(text(signedXdr), this.passphrase); }
    catch { throw publicError('The signed Stellar transaction could not be read.', 'PUBLIC_EXCHANGE_SIGNED_XDR_INVALID'); }
    if (transaction.source !== quote.sourceAddress || transaction.hash().toString('hex') !== quote.transactionHash) throw publicError('The signed transaction does not match this wallet exchange quote.', 'PUBLIC_EXCHANGE_TRANSACTION_MISMATCH');
    if (transaction.operations.length !== 1 || transaction.operations[0].type !== 'pathPaymentStrictSend') throw publicError('The signed transaction does not match the SRA/USDC exchange operation.', 'PUBLIC_EXCHANGE_OPERATION_MISMATCH');
    const operation = transaction.operations[0];
    const selling = assetFromAddress(quote.sellAssetAddress);
    const buying = assetFromAddress(quote.receiveAssetAddress);
    if (!sameAsset(operation.sendAsset, selling) || !sameAsset(operation.destAsset, buying) || units(operation.sendAmount) !== units(quote.sellAmount) || units(operation.destMin) !== units(quote.minimumReceiveAmount || quote.minimumUsdc) || operation.destination !== quote.destinationAddress) throw publicError(`The signed transaction terms do not match the quoted ${quote.pair || 'SRA exchange'}.`, 'PUBLIC_EXCHANGE_TERMS_MISMATCH');
    const hash = transaction.hash();
    const publicKey = StellarSdk.Keypair.fromPublicKey(quote.sourceAddress);
    const signedByHolder = transaction.signatures.some((signature) => publicKey.verify(hash, signature.signature()));
    if (!signedByHolder) throw publicError('The wallet holding the SRA has not signed this exchange.', 'PUBLIC_EXCHANGE_HOLDER_SIGNATURE_REQUIRED');
    return transaction;
  }

  async submit(quote, signedXdr) {
    const transaction = this.verifySignedTransaction(quote, signedXdr);
    const result = await this.server.submitTransaction(transaction);
    return {
      exchangeId: `PHX-${result.hash || crypto.randomUUID()}`,
      quoteId: quote.quoteId,
      assetId: quote.assetId,
      marketId: quote.marketId,
      network: 'STELLAR',
      sourceAddress: quote.sourceAddress,
      destinationAddress: quote.destinationAddress,
      sellAssetAddress: quote.sellAssetAddress,
      receiveAssetAddress: quote.receiveAssetAddress,
      receiveAsset: quote.receiveAsset,
      pair: quote.pair,
      sellAmount: quote.sellAmount,
      quotedReceiveAmount: quote.expectedReceiveAmount,
      minimumReceiveAmount: quote.minimumReceiveAmount,
      quotedUsdc: quote.expectedUsdc,
      minimumUsdc: quote.minimumUsdc,
      transactionId: result.hash,
      ledger: result.ledger || null,
      state: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
    };
  }
}
