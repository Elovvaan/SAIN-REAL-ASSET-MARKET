import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const PUBLIC_NETWORK = 'Public Global Stellar Network ; September 2015';
const TEST_NETWORK = 'Test SDF Network ; September 2015';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function safeEqual(left, right) {
  const a = Buffer.from(text(left));
  const b = Buffer.from(text(right));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function eventId(input) {
  const stable = text(input?.id || input?.transaction?.id || input?.transaction_id || input?.transactionId);
  return stable ? `ANCHOR-${stable}` : `ANCHOR-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

export class SraAnchorPlatformService {
  constructor({ domain, environment = process.env } = {}) {
    this.domain = domain;
    this.environment = environment;
  }

  configuration() {
    const mode = upper(this.environment.SRA_ANCHOR_MODE || 'TESTNET');
    if (!['TESTNET', 'PRODUCTION'].includes(mode)) throw new Error('SRA_ANCHOR_MODE must be TESTNET or PRODUCTION.');
    const publicUrl = text(this.environment.SRA_ANCHOR_PUBLIC_URL || (mode === 'TESTNET' ? 'http://localhost:8080' : ''));
    const homeDomain = text(this.environment.SRA_ANCHOR_HOME_DOMAIN || 'www.sainrealasset.com').toLowerCase();
    const signingKey = text(this.environment.SRA_ANCHOR_SIGNING_KEY || this.environment.STELLAR_ISSUER_PUBLIC_KEY);
    const distributionAccount = text(this.environment.STELLAR_DISTRIBUTOR_PUBLIC_KEY);
    const usdcIssuer = text(this.environment.SRA_ANCHOR_USDC_ISSUER);
    const callbackKeyConfigured = Boolean(text(this.environment.SRA_ANCHOR_CALLBACK_API_KEY));
    const ready = Boolean(publicUrl && homeDomain && signingKey && distributionAccount && usdcIssuer && callbackKeyConfigured);
    return {
      provider: 'SRA_ANCHOR_PLATFORM',
      implementation: 'STELLAR_ANCHOR_PLATFORM',
      mode,
      networkPassphrase: mode === 'PRODUCTION' ? PUBLIC_NETWORK : TEST_NETWORK,
      publicUrl,
      homeDomain,
      signingKey,
      distributionAccount,
      usdcIssuer,
      callbackAuthentication: 'X-Api-Key',
      callbackKeyConfigured,
      ready,
      standards: ['SEP-1', 'SEP-10', 'SEP-12', 'SEP-24'],
    };
  }

  status() {
    const configuration = this.configuration();
    const events = this.domain.list(RECORD_TYPES.SRA_ANCHOR_EVENT);
    return {
      ...configuration,
      signingKey: configuration.signingKey ? 'CONFIGURED' : 'NOT_CONFIGURED',
      distributionAccount: configuration.distributionAccount || null,
      usdcIssuer: configuration.usdcIssuer || null,
      recordedEvents: events.length,
      lastEventAt: events.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0]?.receivedAt || null,
    };
  }

  stellarToml() {
    const config = this.configuration();
    if (!config.signingKey) throw new Error('SRA_ANCHOR_SIGNING_KEY is required to publish stellar.toml.');
    if (!config.distributionAccount) throw new Error('STELLAR_DISTRIBUTOR_PUBLIC_KEY is required to publish stellar.toml.');
    if (!config.usdcIssuer) throw new Error('SRA_ANCHOR_USDC_ISSUER is required to publish stellar.toml.');
    if (!config.publicUrl.startsWith('https://') && config.mode === 'PRODUCTION') throw new Error('Production SRA Anchor Platform requires an HTTPS public URL.');
    return [
      `NETWORK_PASSPHRASE="${config.networkPassphrase}"`,
      `SIGNING_KEY="${config.signingKey}"`,
      `WEB_AUTH_ENDPOINT="${config.publicUrl}/auth"`,
      `TRANSFER_SERVER_SEP0024="${config.publicUrl}/sep24"`,
      `KYC_SERVER="${config.publicUrl}/sep12"`,
      `ACCOUNTS=["${config.distributionAccount}"]`,
      '',
      '[[CURRENCIES]]',
      'code="USDC"',
      `issuer="${config.usdcIssuer}"`,
      `status="${config.mode === 'PRODUCTION' ? 'live' : 'test'}"`,
      'is_asset_anchored=true',
      'anchor_asset_type="fiat"',
      'anchor_asset="USD"',
      '',
    ].join('\n');
  }

  authorizeCallback(apiKey) {
    const configured = text(this.environment.SRA_ANCHOR_CALLBACK_API_KEY);
    if (!configured || !safeEqual(apiKey, configured)) {
      const error = new Error('Valid SRA Anchor Platform callback authentication is required.');
      error.statusCode = 401;
      throw error;
    }
  }

  async recordEvent(payload = {}, actorId = 'STELLAR_ANCHOR_PLATFORM') {
    const id = eventId(payload);
    const existing = this.domain.get(RECORD_TYPES.SRA_ANCHOR_EVENT, id);
    if (existing) return existing;
    const transaction = payload.transaction || payload;
    const record = {
      anchorEventId: id,
      provider: 'SRA_ANCHOR_PLATFORM',
      eventType: text(payload.type || payload.event_type || transaction.kind || 'TRANSACTION_UPDATE'),
      anchorTransactionId: text(transaction.id || payload.transaction_id || payload.transactionId) || null,
      sep: text(payload.sep || transaction.sep) || null,
      kind: text(transaction.kind) || null,
      status: text(transaction.status || payload.status) || null,
      stellarTransactionId: text(transaction.stellar_transaction_id || transaction.stellarTransactionId) || null,
      amountIn: text(transaction.amount_in || transaction.amountIn) || null,
      amountOut: text(transaction.amount_out || transaction.amountOut) || null,
      assetIn: text(transaction.asset_in || transaction.assetIn) || null,
      assetOut: text(transaction.asset_out || transaction.assetOut) || null,
      sourceAccount: text(transaction.from || transaction.source_account) || null,
      destinationAccount: text(transaction.to || transaction.destination_account) || null,
      rawHash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      state: 'RECORDED',
      receivedAt: new Date().toISOString(),
    };
    await this.domain.put(RECORD_TYPES.SRA_ANCHOR_EVENT, id, record, { actorId, eventType: 'SRA_ANCHOR_EVENT_RECORDED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.SRA_ANCHOR_EVENT, objectId: id, eventType: 'SRA_ANCHOR_EVENT_RECORDED', actorId, payload: { anchorTransactionId: record.anchorTransactionId, status: record.status, rawHash: record.rawHash } });
    return record;
  }

  listEvents() {
    return this.domain.list(RECORD_TYPES.SRA_ANCHOR_EVENT).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  }
}
