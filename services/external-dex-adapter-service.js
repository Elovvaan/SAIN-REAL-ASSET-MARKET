import crypto from 'node:crypto';

const TYPES = Object.freeze({
  EXPORT: 'DEX_EXTERNAL_EXPORT',
  CONFIRMATION: 'DEX_EXTERNAL_CONFIRMATION',
});

const SUPPORTED_VENUES = Object.freeze({
  ORCA_WHIRLPOOLS: {
    venue: 'ORCA_WHIRLPOOLS',
    network: 'SOLANA',
    executionModel: 'EXTERNAL_CONNECTOR',
    marketModel: 'CONCENTRATED_LIQUIDITY_AMM',
  },
});

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function required(value, field) { const text = String(value || '').trim(); if (!text) throw new Error(`${field} is required.`); return text; }
function positive(value, field) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`); return number; }
function simulatedMint(value) { return /^SIM-/i.test(String(value || '')); }

export class ExternalDexAdapterService {
  constructor(domain, onChainProjectionService) {
    this.domain = domain;
    this.onChain = onChainProjectionService;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await this.domain.hydrate(Object.values(TYPES));
    this.initialized = true;
  }

  venues() { return Object.values(SUPPORTED_VENUES); }

  async status() {
    await this.initialize();
    const exports = this.domain.list(TYPES.EXPORT);
    const confirmations = this.domain.list(TYPES.CONFIRMATION);
    return {
      service: 'SRA External DEX Adapter',
      boundary: 'EXTERNAL_EXECUTION_ONLY',
      authoritativeValueSource: 'SRA_INTERNAL_RECORDS',
      marketPricePolicy: 'EXTERNAL_PRICE_DOES_NOT_REWRITE_RECORDED_VALUE',
      supportedVenues: this.venues(),
      preparedExports: exports.filter((item) => item.state === 'READY_FOR_EXTERNAL_DEX').length,
      submittedExports: exports.filter((item) => item.state === 'SUBMITTED_TO_EXTERNAL_DEX').length,
      confirmedExports: exports.filter((item) => item.state === 'EXTERNALLY_CONFIRMED').length,
      confirmations: confirmations.length,
    };
  }

  async listExports(filters = {}) {
    await this.initialize();
    return this.domain.list(TYPES.EXPORT).filter((record) => {
      if (filters.state && record.state !== filters.state) return false;
      if (filters.venue && record.venue !== filters.venue) return false;
      if (filters.exportPackageId && record.sourceExportPackageId !== filters.exportPackageId) return false;
      return true;
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getExport(dexExportId) {
    await this.initialize();
    return this.domain.get(TYPES.EXPORT, dexExportId);
  }

  source(exportPackageId) {
    const exportPackage = this.domain.get('EXPORT_PACKAGE', exportPackageId);
    if (!exportPackage) throw new Error('SRA export package was not found.');
    const projection = this.onChain.listProjections({ instrumentId: exportPackage.instrumentId, network: 'SOLANA' })
      .find((item) => item.status === 'ACTIVE');
    return { exportPackage, projection };
  }

  preview(input = {}) {
    const exportPackageId = required(input.exportPackageId, 'exportPackageId');
    const venue = required(input.venue || 'ORCA_WHIRLPOOLS', 'venue').toUpperCase();
    const definition = SUPPORTED_VENUES[venue];
    if (!definition) throw new Error(`Unsupported external DEX venue: ${venue}.`);
    const { exportPackage, projection } = this.source(exportPackageId);
    const blockers = [];
    if (exportPackage.state !== 'READY_FOR_EXPORT') blockers.push('SOURCE_EXPORT_PACKAGE_NOT_READY');
    if (!projection) blockers.push('ACTIVE_SOLANA_PROJECTION_REQUIRED');
    if (projection && !projection.mintAddress) blockers.push('SOLANA_MINT_REQUIRED');
    if (projection && simulatedMint(projection.mintAddress)) blockers.push('REAL_SOLANA_MINT_REQUIRED');
    if (projection && projection.instrumentId !== exportPackage.instrumentId) blockers.push('PROJECTION_INSTRUMENT_MISMATCH');
    if (!input.quoteMintAddress) blockers.push('QUOTE_MINT_ADDRESS_REQUIRED');
    if (!input.quoteSymbol) blockers.push('QUOTE_SYMBOL_REQUIRED');

    return {
      action: 'EXTERNAL_DEX_EXPORT_PREVIEW',
      readOnly: true,
      venue,
      network: definition.network,
      sourceExportPackageId: exportPackage.exportPackageId,
      instrumentId: exportPackage.instrumentId,
      participantId: exportPackage.participantId,
      quantity: Number(exportPackage.quantity || 0),
      baseSymbol: projection?.denomination?.symbol || exportPackage.unit || 'SRA_ASSET',
      baseMintAddress: projection?.mintAddress || null,
      quoteSymbol: String(input.quoteSymbol || '').toUpperCase() || null,
      quoteMintAddress: input.quoteMintAddress || null,
      recordedValueReference: exportPackage.snapshots?.instrument?.financialRecordId || exportPackage.snapshots?.instrument?.verifiedValuePackageId || null,
      marketPrice: null,
      eligibilityState: blockers.length ? 'BLOCKED' : 'ELIGIBLE_FOR_DEX_EXPORT',
      blockers,
      effect: 'Prepare a connector handoff for an externally executed DEX market action.',
      doesNot: ['CREATE_LIQUIDITY_INSIDE_SRA', 'EXECUTE_AMM_PRICING_INSIDE_SRA', 'REWRITE_RECORDED_VALUE', 'MOVE_VALUE_WITHOUT_EXTERNAL_CONFIRMATION'],
    };
  }

  async prepare(input = {}, actorId = null) {
    await this.initialize();
    if (String(input.approval || '').toUpperCase() !== 'APPROVE') throw new Error('Explicit DEX export approval is required.');
    const preview = this.preview(input);
    if (preview.blockers.length) {
      const error = new Error(`DEX export is blocked: ${preview.blockers.join(', ')}.`);
      error.code = 'DEX_EXPORT_INELIGIBLE';
      error.assessment = preview;
      throw error;
    }
    const existing = this.domain.list(TYPES.EXPORT).find((item) => item.sourceExportPackageId === preview.sourceExportPackageId && item.venue === preview.venue && !['CANCELLED','FAILED'].includes(item.state));
    if (existing) return existing;
    const timestamp = now();
    const record = {
      dexExportId: id('DEX-EXP'),
      sourceExportPackageId: preview.sourceExportPackageId,
      instrumentId: preview.instrumentId,
      participantId: preview.participantId,
      projectionId: this.source(preview.sourceExportPackageId).projection.projectionId,
      network: preview.network,
      venue: preview.venue,
      executionModel: 'EXTERNAL_CONNECTOR',
      quantity: positive(preview.quantity, 'quantity'),
      baseSymbol: preview.baseSymbol,
      baseMintAddress: preview.baseMintAddress,
      quoteSymbol: preview.quoteSymbol,
      quoteMintAddress: preview.quoteMintAddress,
      pair: `${preview.baseSymbol}/${preview.quoteSymbol}`,
      marketPrice: null,
      recordedValueReference: preview.recordedValueReference,
      state: 'READY_FOR_EXTERNAL_DEX',
      externalExecutionState: 'NOT_SUBMITTED',
      handoff: {
        venue: preview.venue,
        network: preview.network,
        baseMintAddress: preview.baseMintAddress,
        quoteMintAddress: preview.quoteMintAddress,
        quantity: preview.quantity,
        pair: `${preview.baseSymbol}/${preview.quoteSymbol}`,
        sourceExportPackageId: preview.sourceExportPackageId,
      },
      approvedBy: actorId,
      approvedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [{ state: 'READY_FOR_EXTERNAL_DEX', actorId, occurredAt: timestamp }],
    };
    await this.domain.put(TYPES.EXPORT, record.dexExportId, record, { actorId, eventType: 'DEX_EXTERNAL_EXPORT_PREPARED' });
    await this.domain.lifecycle({ objectType: TYPES.EXPORT, objectId: record.dexExportId, eventType: 'DEX_EXTERNAL_EXPORT_PREPARED', actorId, payload: { sourceExportPackageId: record.sourceExportPackageId, venue: record.venue, pair: record.pair, quantity: record.quantity } });
    return record;
  }

  async markSubmitted(dexExportId, input = {}, actorId = null) {
    await this.initialize();
    const current = await this.getExport(dexExportId);
    if (!current) throw new Error('DEX export was not found.');
    if (current.state !== 'READY_FOR_EXTERNAL_DEX') throw new Error(`DEX export cannot be submitted from ${current.state}.`);
    const timestamp = now();
    const updated = {
      ...current,
      state: 'SUBMITTED_TO_EXTERNAL_DEX',
      externalExecutionState: 'SUBMITTED',
      connectorReference: required(input.connectorReference, 'connectorReference'),
      submittedAt: timestamp,
      updatedAt: timestamp,
      history: [...(current.history || []), { state: 'SUBMITTED_TO_EXTERNAL_DEX', actorId, occurredAt: timestamp }],
    };
    await this.domain.put(TYPES.EXPORT, dexExportId, updated, { actorId, eventType: 'DEX_EXTERNAL_EXPORT_SUBMITTED' });
    return updated;
  }

  async confirm(dexExportId, input = {}, actorId = null) {
    await this.initialize();
    const current = await this.getExport(dexExportId);
    if (!current) throw new Error('DEX export was not found.');
    if (!['READY_FOR_EXTERNAL_DEX','SUBMITTED_TO_EXTERNAL_DEX'].includes(current.state)) throw new Error(`DEX export cannot be confirmed from ${current.state}.`);
    const transactionSignature = required(input.transactionSignature, 'transactionSignature');
    const externalMarketAddress = required(input.externalMarketAddress || input.poolAddress, 'externalMarketAddress');
    const timestamp = now();
    const confirmation = {
      dexConfirmationId: id('DEX-CFM'),
      dexExportId,
      sourceExportPackageId: current.sourceExportPackageId,
      venue: current.venue,
      network: current.network,
      pair: current.pair,
      transactionSignature,
      externalMarketAddress,
      poolAddress: input.poolAddress || null,
      executedQuantity: positive(input.executedQuantity ?? current.quantity, 'executedQuantity'),
      observedMarketPrice: Number.isFinite(Number(input.observedMarketPrice)) ? Number(input.observedMarketPrice) : null,
      priceReferenceOnly: true,
      state: 'CONFIRMED',
      confirmedBy: actorId,
      confirmedAt: timestamp,
      createdAt: timestamp,
    };
    const updated = {
      ...current,
      state: 'EXTERNALLY_CONFIRMED',
      externalExecutionState: 'CONFIRMED',
      dexConfirmationId: confirmation.dexConfirmationId,
      transactionSignature,
      externalMarketAddress,
      observedMarketPrice: confirmation.observedMarketPrice,
      confirmedAt: timestamp,
      updatedAt: timestamp,
      history: [...(current.history || []), { state: 'EXTERNALLY_CONFIRMED', actorId, occurredAt: timestamp }],
    };
    await this.domain.atomicPut([
      { type: TYPES.CONFIRMATION, id: confirmation.dexConfirmationId, payload: confirmation, actorId, eventType: 'DEX_EXTERNAL_CONFIRMATION_RECORDED' },
      { type: TYPES.EXPORT, id: dexExportId, payload: updated, actorId, eventType: 'DEX_EXTERNAL_EXPORT_CONFIRMED' },
    ]);
    await this.onChain.recordChainEvent({
      projectionId: current.projectionId,
      eventType: 'EXTERNAL_DEX_MARKET_CONFIRMATION',
      transactionSignature,
      mintAddress: current.baseMintAddress,
      quantity: confirmation.executedQuantity,
      confirmationStatus: 'CONFIRMED',
      raw: { venue: current.venue, pair: current.pair, externalMarketAddress, observedMarketPrice: confirmation.observedMarketPrice },
    }, actorId);
    return { export: updated, confirmation };
  }
}

export { TYPES as EXTERNAL_DEX_RECORD_TYPES, SUPPORTED_VENUES as EXTERNAL_DEX_VENUES };
