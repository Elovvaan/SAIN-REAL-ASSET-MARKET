import crypto from 'node:crypto';

const TYPES = Object.freeze({
  DEFINITION: 'STABLE_SETTLEMENT_ASSET',
  RESERVE: 'STABLE_SETTLEMENT_RESERVE_ENTRY',
  SUPPLY: 'STABLE_SETTLEMENT_SUPPLY_EVENT',
  REPRESENTATION: 'STABLE_SETTLEMENT_NETWORK_REPRESENTATION',
});

const now = () => new Date().toISOString();
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const uid = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;

function positiveAmount(value, field = 'amount') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(amount.toFixed(2));
}

export class StableSettlementAssetService {
  constructor(domain) {
    this.domain = domain;
    this.hydrated = false;
  }

  async ensure() {
    if (!this.hydrated) {
      await this.domain.hydrate(Object.values(TYPES));
      this.hydrated = true;
    }
  }

  definitionId(assetCode) { return `STABLE-${upper(assetCode)}`; }

  get(assetCode) {
    return this.domain.get(TYPES.DEFINITION, this.definitionId(assetCode));
  }

  list() {
    return this.domain.list(TYPES.DEFINITION);
  }

  reserveEntries(assetCode) {
    const code = upper(assetCode);
    return this.domain.list(TYPES.RESERVE).filter((entry) => entry.assetCode === code);
  }

  supplyEvents(assetCode) {
    const code = upper(assetCode);
    return this.domain.list(TYPES.SUPPLY).filter((entry) => entry.assetCode === code);
  }

  representations(assetCode) {
    const code = upper(assetCode);
    return this.domain.list(TYPES.REPRESENTATION).filter((entry) => entry.assetCode === code);
  }

  reserveBalance(assetCode) {
    return Number(this.reserveEntries(assetCode).reduce((sum, entry) => sum + (entry.direction === 'CREDIT' ? entry.amount : -entry.amount), 0).toFixed(2));
  }

  circulatingSupply(assetCode) {
    return Number(this.supplyEvents(assetCode).reduce((sum, entry) => sum + (entry.action === 'ISSUE' ? entry.amount : -entry.amount), 0).toFixed(2));
  }

  status(assetCode) {
    const definition = this.get(assetCode);
    if (!definition) return null;
    const reserveBalance = this.reserveBalance(assetCode);
    const circulatingSupply = this.circulatingSupply(assetCode);
    return {
      definition,
      reserveBalance,
      circulatingSupply,
      availableToIssue: Math.max(0, Number((reserveBalance - circulatingSupply).toFixed(2))),
      fullyReserved: reserveBalance >= circulatingSupply,
      representations: this.representations(assetCode),
    };
  }

  async define(input = {}, actorId = null) {
    await this.ensure();
    const assetCode = upper(input.assetCode || 'SRA_USD');
    if (!/^[A-Z0-9_]{2,24}$/.test(assetCode)) throw new Error('assetCode must contain 2-24 letters, numbers, or underscores.');
    const existing = this.get(assetCode);
    if (existing) return existing;
    const currency = upper(input.currency || 'USD');
    const unitValue = Number(input.unitValue ?? 1);
    if (!Number.isFinite(unitValue) || unitValue <= 0) throw new Error('unitValue must be greater than zero.');
    const timestamp = now();
    const id = this.definitionId(assetCode);
    const record = {
      id,
      stableSettlementAssetId: id,
      assetCode,
      displayName: text(input.displayName) || 'SRA USD Stablecoin',
      currency,
      unitValue,
      reservePolicy: upper(input.reservePolicy || 'FULL_RESERVE'),
      settlementPurpose: 'STABLE_VALUE_SETTLEMENT',
      state: upper(input.state || 'ACTIVE'),
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.domain.put(TYPES.DEFINITION, id, record, { actorId, eventType: 'STABLE_SETTLEMENT_ASSET_DEFINED' });
    await this.domain.lifecycle?.({ objectType: TYPES.DEFINITION, objectId: id, eventType: 'STABLE_SETTLEMENT_ASSET_DEFINED', actorId, payload: { assetCode, currency, reservePolicy: record.reservePolicy } });
    return record;
  }

  async recordReserve(assetCode, input = {}, actorId = null) {
    await this.ensure();
    const code = upper(assetCode);
    const definition = this.get(code);
    if (!definition) throw new Error('Stable settlement asset not found.');
    const direction = upper(input.direction || 'CREDIT');
    if (!['CREDIT', 'DEBIT'].includes(direction)) throw new Error('direction must be CREDIT or DEBIT.');
    const amount = positiveAmount(input.amount);
    if (direction === 'DEBIT' && amount > this.reserveBalance(code) - this.circulatingSupply(code)) throw new Error('Reserve debit would reduce reserves below circulating supply.');
    const id = text(input.reserveEntryId) || uid('SSR');
    const record = {
      id,
      reserveEntryId: id,
      assetCode: code,
      direction,
      amount,
      currency: definition.currency,
      reserveAsset: upper(input.reserveAsset || definition.currency),
      reserveAccountReference: text(input.reserveAccountReference) || null,
      externalReference: text(input.externalReference) || null,
      evidenceReference: text(input.evidenceReference) || null,
      recordedBy: actorId,
      recordedAt: now(),
    };
    await this.domain.put(TYPES.RESERVE, id, record, { actorId, eventType: `STABLE_SETTLEMENT_RESERVE_${direction}` });
    return { entry: record, status: this.status(code) };
  }

  async registerRepresentation(assetCode, input = {}, actorId = null) {
    await this.ensure();
    const code = upper(assetCode);
    if (!this.get(code)) throw new Error('Stable settlement asset not found.');
    const network = upper(input.network);
    if (!network) throw new Error('network is required.');
    const existing = this.representations(code).find((item) => item.network === network);
    if (existing) return existing;
    const id = text(input.representationId) || `SSN-${code}-${network}`;
    const record = {
      id,
      representationId: id,
      assetCode: code,
      network,
      onChainAssetId: text(input.onChainAssetId) || null,
      networkAssetCode: text(input.networkAssetCode) || code,
      assetAddress: text(input.assetAddress) || null,
      issuerAddress: text(input.issuerAddress) || null,
      decimals: input.decimals == null ? null : Number(input.decimals),
      state: upper(input.state || 'ACTIVE'),
      registeredBy: actorId,
      registeredAt: now(),
    };
    await this.domain.put(TYPES.REPRESENTATION, id, record, { actorId, eventType: 'STABLE_SETTLEMENT_NETWORK_REPRESENTATION_REGISTERED' });
    return record;
  }

  async issue(assetCode, input = {}, actorId = null) {
    await this.ensure();
    const code = upper(assetCode);
    const definition = this.get(code);
    if (!definition || definition.state !== 'ACTIVE') throw new Error('Active stable settlement asset not found.');
    const amount = positiveAmount(input.amount);
    const reserveBalance = this.reserveBalance(code);
    const supply = this.circulatingSupply(code);
    if (definition.reservePolicy === 'FULL_RESERVE' && supply + amount > reserveBalance) throw new Error('Stable settlement issuance exceeds recorded reserves.');
    const network = upper(input.network) || null;
    if (network && !this.representations(code).some((item) => item.network === network && item.state === 'ACTIVE')) throw new Error(`No active ${network} representation is registered for ${code}.`);
    const id = text(input.supplyEventId) || uid('SSI');
    const record = {
      id,
      supplyEventId: id,
      assetCode: code,
      action: 'ISSUE',
      amount,
      network,
      destinationAddress: text(input.destinationAddress) || null,
      transactionId: text(input.transactionId) || null,
      settlementReference: text(input.settlementReference) || null,
      recordedBy: actorId,
      recordedAt: now(),
    };
    await this.domain.put(TYPES.SUPPLY, id, record, { actorId, eventType: 'STABLE_SETTLEMENT_ASSET_ISSUED' });
    return { event: record, status: this.status(code) };
  }

  async redeem(assetCode, input = {}, actorId = null) {
    await this.ensure();
    const code = upper(assetCode);
    if (!this.get(code)) throw new Error('Stable settlement asset not found.');
    const amount = positiveAmount(input.amount);
    if (amount > this.circulatingSupply(code)) throw new Error('Redemption exceeds circulating supply.');
    const id = text(input.supplyEventId) || uid('SSRDM');
    const record = {
      id,
      supplyEventId: id,
      assetCode: code,
      action: 'REDEEM',
      amount,
      network: upper(input.network) || null,
      sourceAddress: text(input.sourceAddress) || null,
      transactionId: text(input.transactionId) || null,
      settlementReference: text(input.settlementReference) || null,
      recordedBy: actorId,
      recordedAt: now(),
    };
    await this.domain.put(TYPES.SUPPLY, id, record, { actorId, eventType: 'STABLE_SETTLEMENT_ASSET_REDEEMED' });
    return { event: record, status: this.status(code) };
  }
}

export { TYPES as STABLE_SETTLEMENT_RECORD_TYPES };
