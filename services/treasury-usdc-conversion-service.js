import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';
import { STELLAR_USDC } from './stellar-transfer-service.js';

const TYPE = RECORD_TYPES.TREASURY_USDC_CONVERSION;
const PROFILE_ID = 'SRA_PLATFORM_TREASURY';
const CASH_ACCOUNT_ID = 'TRSY-1000-CASH-USD';
const USDC_ACCOUNT_ID = 'TRSY-1020-USDC-STELLAR';
const ACTIVE = new Set(['AUTHORIZED','PROVIDER_INITIATED','USD_FUNDING_CONFIRMED','USDC_RECEIVED','ON_CHAIN_RECONCILED']);

function now() { return new Date().toISOString(); }
function id() { return `TUC-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function text(value) { return String(value ?? '').trim(); }
function required(value, field) { const result = text(value); if (!result) throw new Error(`${field} is required.`); return result; }
function amount(value) { const result = Number(value); if (!Number.isFinite(result) || result <= 0) throw new Error('amount must be greater than zero.'); return Number(result.toFixed(2)); }

export class TreasuryUsdcConversionService {
  constructor({ domain, treasury, stellar, sep24 } = {}) {
    this.domain = domain;
    this.treasury = treasury;
    this.stellar = stellar;
    this.sep24 = sep24;
  }

  list(filters = {}) {
    return this.domain.list(TYPE).filter((record) => (!filters.profileId || record.profileId === filters.profileId)
      && (!filters.state || record.state === filters.state)).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  get(conversionId) { return this.domain.get(TYPE, conversionId); }

  async save(record, actorId, eventType) {
    const updated = { ...record, updatedAt: now() };
    await this.domain.put(TYPE, updated.conversionId, updated, { actorId, eventType });
    return updated;
  }

  requireState(conversionId, expected) {
    const record = this.get(conversionId);
    if (!record) throw new Error('Treasury USDC Conversion not found.');
    if (record.state !== expected) throw new Error(`Treasury USDC Conversion must be ${expected}, not ${record.state}.`);
    return record;
  }

  async authorize(input = {}, actorId = null) {
    if (input.confirmLiveConversion !== true) throw new Error('Explicit live conversion authorization is required.');
    const profileId = required(input.profileId, 'profileId');
    const profile = this.domain.get(RECORD_TYPES.PLATFORM_TREASURY_PROFILE, profileId);
    if (!profile) throw new Error('Platform Treasury Profile not found.');
    if (profileId !== PROFILE_ID) throw new Error(`USD-to-USDC conversion must use the canonical ${PROFILE_ID} profile.`);
    const requested = amount(input.amount);
    const position = this.treasury.summary();
    const held = this.list({ profileId }).filter((record) => ACTIVE.has(record.state))
      .reduce((sum, record) => sum + Number(record.amountUsd || 0), 0);
    const available = Number((Math.max(0, position.cashBalanceUsd - held)).toFixed(2));
    if (requested > available) throw new Error(`Conversion amount exceeds uncommitted treasury liquidity of ${available} USD.`);
    const provider = required(input.provider, 'provider').toUpperCase();
    const network = text(input.destinationNetwork || 'STELLAR').toUpperCase();
    if (network !== 'STELLAR') throw new Error('Treasury USDC conversion currently supports Stellar only.');
    const configuredDestination = this.stellar.distributionAddress();
    const suppliedDestination = text(input.destinationWallet);
    if (suppliedDestination && suppliedDestination !== configuredDestination) throw new Error('destinationWallet must match the configured SRA Stellar distribution account.');
    const conversionId = input.conversionId || id();
    const timestamp = now();
    return this.save({
      conversionId, profileId, sourceReservePositionId:text(input.sourceReservePositionId) || `TREASURY-POSITION:${profileId}`, sourceCashAccountId:CASH_ACCOUNT_ID,
      amountUsd:requested, expectedUsdc:requested, conversionRate:'1.00', fromCurrency:'USD', toCurrency:'USDC',
      network, issuerAddress:STELLAR_USDC.issuerAddress, destinationWallet:configuredDestination, provider,
      state:'AUTHORIZED', providerTransactionReference:null, providerInteractiveUrl:null, usdFundingReference:null,
      stellarTransactionId:null, receivedUsdc:null, receiptLedger:null, ledgerEntryId:null,
      authorizedBy:actorId, authorizedAt:timestamp, createdAt:timestamp, updatedAt:timestamp,
    }, actorId, 'TREASURY_USDC_CONVERSION_AUTHORIZED');
  }

  async initiate(conversionId, input = {}, actorId = null) {
    const record = this.requireState(conversionId, 'AUTHORIZED');
    let providerTransactionReference = text(input.providerTransactionReference) || null;
    let providerInteractiveUrl = null;
    if (record.provider === 'CONFIGURED_ANCHOR') {
      if (!this.sep24?.status?.().configured) throw new Error('A SEP-24 anchor must be configured before provider initiation.');
      const session = await this.sep24.startInteractive({ kind:'deposit', amount:record.amountUsd });
      providerTransactionReference = session.transactionId;
      providerInteractiveUrl = session.interactiveUrl;
    } else if (!providerTransactionReference) {
      throw new Error('providerTransactionReference is required for a non-anchor conversion provider.');
    }
    return this.save({ ...record, state:'PROVIDER_INITIATED', providerTransactionReference,
      providerInteractiveUrl, initiatedBy:actorId, initiatedAt:now() }, actorId, 'TREASURY_USDC_PROVIDER_INITIATED');
  }

  async confirmUsdFunding(conversionId, input = {}, actorId = null) {
    const record = this.requireState(conversionId, 'PROVIDER_INITIATED');
    const usdFundingReference = required(input.usdFundingReference, 'usdFundingReference');
    return this.save({ ...record, state:'USD_FUNDING_CONFIRMED', usdFundingReference,
      usdFundingConfirmedBy:actorId, usdFundingConfirmedAt:now() }, actorId, 'TREASURY_USD_FUNDING_CONFIRMED');
  }

  async confirmUsdcReceipt(conversionId, input = {}, actorId = null) {
    const record = this.requireState(conversionId, 'USD_FUNDING_CONFIRMED');
    const transactionId = required(input.stellarTransactionId, 'stellarTransactionId');
    const duplicate = this.list().find((item) => item.conversionId !== conversionId && item.stellarTransactionId === transactionId);
    if (duplicate) throw new Error(`Stellar transaction is already bound to conversion ${duplicate.conversionId}.`);
    const verification = await this.stellar.verifyIncomingUsdcPayment(transactionId, {
      destinationAddress:record.destinationWallet, amount:String(record.expectedUsdc),
    });
    if (!verification.verified) throw new Error(`Stellar USDC receipt could not be verified: ${verification.reason}.`);
    return this.save({ ...record, state:'USDC_RECEIVED', stellarTransactionId:transactionId,
      receivedUsdc:Number(verification.amount), receiptLedger:verification.ledger,
      usdcReceivedBy:actorId, usdcReceivedAt:now() }, actorId, 'TREASURY_USDC_RECEIVED');
  }

  async reconcile(conversionId, _input = {}, actorId = null) {
    const record = this.requireState(conversionId, 'USDC_RECEIVED');
    const verification = await this.stellar.verifyIncomingUsdcPayment(record.stellarTransactionId, {
      destinationAddress:record.destinationWallet, amount:String(record.expectedUsdc),
    });
    if (!verification.verified) throw new Error(`Stellar USDC receipt no longer reconciles: ${verification.reason}.`);
    return this.save({ ...record, state:'ON_CHAIN_RECONCILED', reconciledBy:actorId,
      reconciledAt:now() }, actorId, 'TREASURY_USDC_ON_CHAIN_RECONCILED');
  }

  async reclassify(conversionId, _input = {}, actorId = null) {
    const record = this.requireState(conversionId, 'ON_CHAIN_RECONCILED');
    if (this.treasury.summary().cashBalanceUsd < record.amountUsd) throw new Error('Recorded USD cash is below the reconciled conversion amount.');
    const result = await this.treasury.approve({ approval:'APPROVE', journalType:'ASSET_CONVERSION',
      memo:`Reclassify ${record.amountUsd} USD into verified Stellar USDC treasury inventory`,
      reference:record.conversionId, idempotencyKey:`TREASURY-USDC-RECLASSIFY:${record.conversionId}`,
      lines:[
        { accountId:USDC_ACCOUNT_ID, side:'DEBIT', amount:record.amountUsd, currency:'USD' },
        { accountId:CASH_ACCOUNT_ID, side:'CREDIT', amount:record.amountUsd, currency:'USD' },
      ],
    }, actorId);
    return this.save({ ...record, state:'RESERVE_RECLASSIFIED', usdcAssetAccountId:USDC_ACCOUNT_ID,
      ledgerEntryId:result.journal.entryId, reclassifiedBy:actorId, reclassifiedAt:now() }, actorId, 'TREASURY_RESERVE_RECLASSIFIED_TO_USDC');
  }
}
