import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const WALLET = RECORD_TYPES.SRA_BTC_TREASURY_WALLET;
const TRADE = RECORD_TYPES.SRA_BTC_TREASURY_TRADE;
const LIVE = new Set(['LIVE', 'PUBLISHED', 'ACTIVE']);
const text = (value) => String(value ?? '').trim();
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
function required(value, field) { const result = text(value); if (!result) throw new Error(`${field} is required.`); return result; }
function amount(value, field, decimals) {
  const raw = text(value);
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(raw) || Number(raw) <= 0) throw new Error(`${field} must be positive with no more than ${decimals} decimal places.`);
  return raw;
}
function satoshis(value) {
  const raw = amount(value, 'BTC amount', 8);
  const [whole, fractional = ''] = raw.split('.');
  return BigInt(whole) * 100000000n + BigInt((fractional + '00000000').slice(0, 8));
}
function mainnetAddress(address) {
  if (!/^(?:bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address)) throw new Error('A Bitcoin mainnet receiving address is required.');
  return address;
}

export class SraBtcTreasuryRouteService {
  constructor({ domain, bitcoin }) { this.domain = domain; this.bitcoin = bitcoin; }

  async initialize() {
    await this.domain.hydrate?.([WALLET, TRADE, RECORD_TYPES.COIN_POSITION, RECORD_TYPES.SRA_INSTRUMENT, RECORD_TYPES.MARKETPLACE_LISTING]);
    return this;
  }

  wallets() { return this.domain.list(WALLET); }
  trades() { return this.domain.list(TRADE); }
  eligibleListings() {
    const positions = new Set(this.domain.list(RECORD_TYPES.COIN_POSITION).filter((p) => p.assetIdentity === 'SRA_COIN' && p.symbol === 'SRA').map((p) => p.coinPositionId));
    const instruments = new Set(this.domain.list(RECORD_TYPES.SRA_INSTRUMENT).filter((i) => positions.has(i.coinPositionId)).map((i) => i.instrumentId));
    return this.domain.list(RECORD_TYPES.MARKETPLACE_LISTING)
      .filter((listing) => instruments.has(listing.instrumentId) && (listing.sellerId || listing.sourceOwnerId) === 'SRA_PLATFORM')
      .filter((listing) => LIVE.has(String(listing.status || listing.state || '').toUpperCase()) && !listing.blockers?.length)
      .map((listing) => ({ listingId:listing.listingId, instrumentId:listing.instrumentId, availableQuantity:listing.quantity ?? null }));
  }

  status() {
    const wallets = this.wallets();
    return { pair:'SRA/BTC', purpose:'SRA_TREASURY_RETENTION', network:'BITCOIN',
      walletRegistered:wallets.some((item) => item.state === 'ACTIVE'), bitcoinRpcConfigured:this.bitcoin.status().configured,
      tradeExecution:'AWAITING_MARKET_CONNECTOR', marketLiquidityConnected:false, minimumBtcDeposit:'0',
      route:{ type:'MARKET_SWAP', source:'SRA', target:'NATIVE_BTC',
        stages:['SRA_MARKET_LIQUIDITY','CROSS_NETWORK_BTC_DELIVERY','TREASURY_RECEIPT'],
        quoteAvailable:false, executionAvailable:false },
      wallets, eligibleListings:this.eligibleListings(), trades:this.trades() };
  }

  async registerWallet(input, actorId) {
    const address = mainnetAddress(required(input.address, 'address'));
    if (this.wallets().some((item) => item.address === address && item.state !== 'RETIRED')) throw new Error('This BTC treasury address is already registered.');
    let networkValidated = false;
    if (this.bitcoin.status().configured) {
      try {
        const validation = await this.bitcoin.validateReceivingAddress(address);
        if (!validation.valid) throw new Error('Bitcoin Core rejected this receiving address.');
        networkValidated = true;
      } catch (error) {
        if (/rejected this receiving address/.test(error.message)) throw error;
      }
    }
    const record = { walletId:id('BTCW'), label:required(input.label, 'label'), network:'BITCOIN', asset:'BTC', address,
      control:'SRA_ADMIN_DECLARED_EXTERNAL_WALLET', networkValidated, privateKeyStored:false, recoveryPhraseStored:false,
      state:'ACTIVE', createdBy:actorId, createdAt:now(), updatedAt:now() };
    await this.domain.put(WALLET, record.walletId, record, { actorId, eventType:'SRA_BTC_TREASURY_ADDRESS_REGISTERED' });
    return record;
  }

  async validateWallet(walletId, actorId) {
    const wallet = this.domain.get(WALLET, walletId);
    if (!wallet || wallet.state !== 'ACTIVE') throw new Error('Active BTC treasury wallet not found.');
    const validation = await this.bitcoin.validateReceivingAddress(wallet.address);
    if (!validation.valid) throw new Error('Bitcoin Core rejected this receiving address.');
    const updated = { ...wallet, networkValidated:true, validatedAt:now(), updatedAt:now() };
    await this.domain.put(WALLET, walletId, updated, { actorId, eventType:'SRA_BTC_TREASURY_ADDRESS_NETWORK_VALIDATED' });
    return updated;
  }

  async retireWallet(walletId, actorId) {
    const wallet = this.domain.get(WALLET, walletId);
    if (!wallet || wallet.state !== 'ACTIVE') throw new Error('Active BTC treasury wallet not found.');
    const updated = { ...wallet, state:'RETIRED', retiredBy:actorId, retiredAt:now(), updatedAt:now() };
    await this.domain.put(WALLET, walletId, updated, { actorId, eventType:'SRA_BTC_TREASURY_ADDRESS_RETIRED' });
    return updated;
  }

  async prepareTrade(input, actorId) {
    const wallet = this.domain.get(WALLET, required(input.walletId, 'walletId'));
    if (!wallet || wallet.state !== 'ACTIVE') throw new Error('Active SRA BTC treasury wallet not found.');
    const listing = this.eligibleListings().find((item) => item.listingId === required(input.listingId, 'listingId'));
    if (!listing) throw new Error('Live SRA-owned coin listing not found.');
    const sraQuantity = amount(input.sraQuantity, 'sraQuantity', 8);
    const minimumBtc = amount(input.minimumBtc ?? input.btcAmount, 'minimumBtc', 8);
    if (listing.availableQuantity != null && Number(sraQuantity) > Number(listing.availableQuantity)) throw new Error('SRA quantity exceeds the listing.');
    const expiresAt = required(input.expiresAt, 'expiresAt');
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new Error('expiresAt must be a future date.');
    const record = { id:id('BTCT'), pair:'SRA/BTC', routeType:'MARKET_SWAP', listingId:listing.listingId, instrumentId:listing.instrumentId,
      walletId:wallet.walletId, destinationAddress:wallet.address,
      sraQuantity, minimumBtc, expiresAt, marketQuoteId:null, marketExecutionId:null,
      state:'AWAITING_MARKET_QUOTE', executionAuthorized:false,
      sraDeliveryVerified:false, btcReceiptVerified:false, createdBy:actorId, createdAt:now(), updatedAt:now() };
    await this.domain.put(TRADE, record.id, record, { actorId, eventType:'SRA_BTC_TREASURY_TRADE_PREPARED' });
    return record;
  }

  async verifyBtcReceipt(tradeId, transactionId, actorId) {
    const trade = this.domain.get(TRADE, tradeId);
    if (!trade || !['MARKET_EXECUTED_AWAITING_BTC', 'BTC_RECEIPT_PENDING'].includes(trade.state) || !trade.marketExecutionId) throw new Error('A verified market execution is required before attributing BTC receipt to a swap.');
    const txid = required(transactionId, 'transactionId').toLowerCase();
    if (this.trades().some((item) => item.id !== trade.id && item.btcTransactionId === txid)) throw new Error('This Bitcoin transaction is already linked to another trade.');
    const evidence = await this.bitcoin.inspectIncoming(txid, trade.destinationAddress);
    const received = evidence.outputs.reduce((sum, output) => sum + satoshis(output.amount), 0n);
    if (received < satoshis(trade.minimumBtc)) throw new Error('Bitcoin transaction does not pay the minimum amount to the SRA treasury address.');
    const verified = evidence.confirmations >= 3;
    const updated = { ...trade, btcTransactionId:txid, btcConfirmations:evidence.confirmations,
      btcOutputIndexes:evidence.outputs.map((output) => output.vout), btcReceiptVerified:verified,
      state:verified ? (Date.parse(trade.expiresAt) <= Date.now() ? 'BTC_RECEIPT_EXCEPTION' : 'BTC_RECEIPT_VERIFIED_AWAITING_SRA_DELIVERY') : 'BTC_RECEIPT_PENDING',
      executionAuthorized:false, updatedAt:now() };
    await this.domain.put(TRADE, trade.id, updated, { actorId, eventType:verified ? 'SRA_BTC_TREASURY_RECEIPT_VERIFIED' : 'SRA_BTC_TREASURY_RECEIPT_PENDING' });
    return updated;
  }
}
