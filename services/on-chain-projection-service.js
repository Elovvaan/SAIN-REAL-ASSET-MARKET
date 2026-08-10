import crypto from 'node:crypto';
import { InstrumentRepresentationApprovalService, INSTRUMENT_REPRESENTATION_APPROVAL_TYPE } from './instrument-representation-approval-service.js';

const TYPES = Object.freeze({
  PROJECTION: 'ON_CHAIN_PROJECTION',
  WALLET: 'PARTICIPANT_CHAIN_WALLET',
  CHAIN_EVENT: 'ON_CHAIN_EVENT',
  RECONCILIATION: 'ON_CHAIN_RECONCILIATION',
});

const ACTIVE_INSTRUMENT_STATES = new Set(['ISSUED', 'ACTIVE']);
const ELIGIBLE_WALLET_STATES = new Set(['APPROVED', 'ACTIVE']);

function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function now() { return new Date().toISOString(); }
function text(value) { return String(value ?? '').trim(); }
function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload?.[field] == null || payload?.[field] === '');
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
}
function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function authorizedSupplySourceOf(instrument = {}, coinPosition = null) {
  return instrument.authorizedSupply
    ?? instrument.authorizedAmount
    ?? instrument.quantity
    ?? instrument.faceAmount
    ?? instrument.faceValue
    ?? instrument.faceValueUsd
    ?? instrument.principalQuantity
    ?? instrument.representedSraQuantity
    ?? instrument.amount
    ?? instrument.amountUsd
    ?? coinPosition?.quantity
    ?? null;
}
function authorizedSupplyOf(instrument = {}, coinPosition = null) {
  const source = authorizedSupplySourceOf(instrument, coinPosition);
  return source == null ? 0 : Number(source);
}
function positiveDecimal(value) {
  const source = text(value);
  return /^\d+(?:\.\d+)?$/.test(source) && !/^0+(?:\.0+)?$/.test(source);
}
function assetCodeOf(instrument = {}, coinPosition = null) {
  return instrument.assetCode
    || instrument.platformAssetCode
    || instrument.symbol
    || instrument.ticker
    || coinPosition?.assetCode
    || coinPosition?.symbol
    || coinPosition?.ticker
    || null;
}
function linkedCoinPositionOf(domain, instrument = {}, representationApproval = null) {
  const instrumentId = instrument.instrumentId || instrument.id || null;
  const candidateIds = [instrument.coinPositionId, ...(representationApproval?.linkedCoinPositionIds || [])].filter(Boolean);
  for (const coinPositionId of candidateIds) {
    const position = domain.get('COIN_POSITION', coinPositionId);
    if (position) return position;
  }
  return domain.list('COIN_POSITION').find((position) => {
    if (instrumentId && [position.instrumentId, position.sraInstrumentId, position.linkedInstrumentId].includes(instrumentId)) return true;
    return Boolean(instrument.financialRecordId && position.financialRecordId === instrument.financialRecordId);
  }) || null;
}
function issuerIdOf(instrument = {}, coinPosition = null) {
  return instrument.issuerParticipantId
    || instrument.issuerId
    || instrument.issuer
    || coinPosition?.issuerParticipantId
    || coinPosition?.issuerId
    || coinPosition?.ownerId
    || null;
}
function verifiedValueReferenceOf(instrument = {}, coinPosition = null) {
  return instrument.verifiedValuePackageId
    || instrument.verifiedValuePackageIds?.[0]
    || instrument.financialRecordId
    || instrument.recognitionId
    || coinPosition?.verifiedValuePackageId
    || coinPosition?.verifiedValuePackageIds?.[0]
    || coinPosition?.financialRecordId
    || coinPosition?.recognitionId
    || null;
}

export class OnChainProjectionService {
  constructor(persistentDomain, options = {}) {
    this.domain = persistentDomain;
    this.representationApprovals = new InstrumentRepresentationApprovalService(persistentDomain);
    this.network = options.network || 'SOLANA';
    this.cluster = options.cluster || process.env.SOLANA_CLUSTER || 'devnet';
    this.program = options.program || process.env.SOLANA_TOKEN_PROGRAM || 'TOKEN_2022';
  }

  async initialize() {
    await this.domain.hydrate([...Object.values(TYPES), INSTRUMENT_REPRESENTATION_APPROVAL_TYPE]);
    return this.status();
  }

  status() {
    return {
      service: 'SRA On-Chain Projection Layer',
      authorityModel: 'SRA_AUTHORITATIVE_CONTROLLED_REPRESENTATION',
      network: this.network,
      cluster: this.cluster,
      program: this.program,
      projections: this.domain.list(TYPES.PROJECTION).length,
      wallets: this.domain.list(TYPES.WALLET).length,
      chainEvents: this.domain.list(TYPES.CHAIN_EVENT).length,
      reconciliations: this.domain.list(TYPES.RECONCILIATION).length,
    };
  }

  listProjections(filters = {}) {
    return this.domain.list(TYPES.PROJECTION).filter((record) => {
      if (filters.status && record.status !== filters.status) return false;
      if (filters.instrumentId && record.instrumentId !== filters.instrumentId) return false;
      if (filters.network && record.network !== filters.network) return false;
      return true;
    });
  }

  getProjection(projectionId) { return this.domain.get(TYPES.PROJECTION, projectionId); }

  authorizedSupplyExactFor(instrumentId) {
    const instrument = this.domain.get('SRA_INSTRUMENT', instrumentId);
    if (!instrument) return '';
    const representationApproval = this.representationApprovals.get(instrumentId);
    const coinPosition = linkedCoinPositionOf(this.domain, instrument, representationApproval);
    const source = authorizedSupplySourceOf(instrument, coinPosition);
    return source == null ? '' : text(source);
  }

  listWallets(filters = {}) {
    return this.domain.list(TYPES.WALLET).filter((wallet) => {
      if (filters.participantId && wallet.participantId !== filters.participantId) return false;
      if (filters.status && wallet.status !== filters.status) return false;
      return true;
    });
  }

  async registerWallet(input, actorId = null) {
    requireFields(input, ['participantId', 'walletAddress']);
    const duplicate = this.domain.list(TYPES.WALLET).find((wallet) => wallet.network === this.network && wallet.walletAddress === input.walletAddress);
    if (duplicate) throw new Error('Wallet address is already registered.');
    const wallet = {
      walletId: input.walletId || id('WAL'),
      participantId: input.participantId,
      network: this.network,
      cluster: input.cluster || this.cluster,
      walletAddress: input.walletAddress,
      walletRole: input.walletRole || 'PARTICIPANT',
      custodyType: input.custodyType || 'SELF_CUSTODY',
      verificationMethod: input.verificationMethod || 'PENDING',
      eligibilityStatus: input.eligibilityStatus || 'PENDING_REVIEW',
      permittedProjectionClasses: input.permittedProjectionClasses || ['CONTROLLED_REPRESENTATION'],
      permittedInstrumentTypes: input.permittedInstrumentTypes || [],
      jurisdictionalContext: input.jurisdictionalContext || null,
      status: input.status || 'PENDING_REVIEW',
      evidenceReferences: input.evidenceReferences || [],
      createdAt: now(), updatedAt: now(),
    };
    await this.domain.put(TYPES.WALLET, wallet.walletId, wallet, { actorId, eventType: 'PARTICIPANT_CHAIN_WALLET_REGISTERED' });
    await this.domain.lifecycle({ objectType: TYPES.WALLET, objectId: wallet.walletId, eventType: 'CHAIN_WALLET_REGISTERED', actorId, payload: { participantId: wallet.participantId, network: wallet.network, status: wallet.status } });
    return wallet;
  }

  async approveWallet(walletId, input = {}, actorId = null) {
    const wallet = this.domain.get(TYPES.WALLET, walletId);
    if (!wallet) throw new Error('Wallet not found.');
    const updated = { ...wallet, verificationMethod: input.verificationMethod || wallet.verificationMethod || 'MANUAL_REVIEW', eligibilityStatus: 'ELIGIBLE', status: 'APPROVED', approvedBy: actorId, approvedAt: now(), updatedAt: now() };
    await this.domain.put(TYPES.WALLET, walletId, updated, { actorId, eventType: 'PARTICIPANT_CHAIN_WALLET_APPROVED' });
    return updated;
  }

  evaluateInstrument(instrumentId) {
    const instrument = this.domain.get('SRA_INSTRUMENT', instrumentId);
    if (!instrument) return { eligible: false, instrumentId, blockers: ['INSTRUMENT_NOT_FOUND'], warnings: [] };
    const blockers = [];
    const warnings = [];
    const state = String(instrument.state || instrument.status || '').toUpperCase();
    const representationApproval = this.representationApprovals.get(instrumentId);
    const coinPosition = linkedCoinPositionOf(this.domain, instrument, representationApproval);
    const issuerId = issuerIdOf(instrument, coinPosition);
    const verifiedValueReference = verifiedValueReferenceOf(instrument, coinPosition);
    const authorizedSupplySource = authorizedSupplySourceOf(instrument, coinPosition);
    if (!ACTIVE_INSTRUMENT_STATES.has(state)) blockers.push('INSTRUMENT_NOT_ISSUED_OR_ACTIVE');
    if (representationApproval?.state !== 'APPROVED') blockers.push('INSTRUMENT_REPRESENTATION_APPROVAL_REQUIRED');
    if (!issuerId) blockers.push('ISSUER_ID_MISSING');
    if (!verifiedValueReference) blockers.push('VERIFIED_VALUE_PACKAGE_MISSING');
    if (!positiveDecimal(authorizedSupplySource)) blockers.push('AUTHORIZED_SUPPLY_OR_AMOUNT_MISSING');
    if (!instrument.purpose && !instrument.instrumentPurpose) warnings.push('INSTRUMENT_PURPOSE_NOT_EXPLICIT');
    if (!instrument.transferabilityStatus && !instrument.transferable) warnings.push('TRANSFERABILITY_RULE_NOT_EXPLICIT');
    if (!instrument.unitDefinition && !instrument.denomination) warnings.push('UNIT_DEFINITION_NOT_EXPLICIT');
    if (!instrument.governingRecordDigest && !instrument.governingDocumentId) warnings.push('GOVERNING_RECORD_DIGEST_NOT_SET');
    return {
      eligible: blockers.length === 0,
      instrumentId,
      state,
      blockers,
      warnings,
      representationApproval: copy(representationApproval),
      instrument: copy(instrument),
      coinPosition: copy(coinPosition),
      resolvedLineage: {
        issuerId,
        verifiedValueReference,
        authorizedSupplySource: authorizedSupplySource == null ? null : text(authorizedSupplySource),
        coinPositionId: coinPosition?.coinPositionId || coinPosition?.positionId || coinPosition?.id || null,
      },
    };
  }

  async createProjection(input, actorId = null) {
    requireFields(input, ['instrumentId']);
    const assessment = this.evaluateInstrument(input.instrumentId);
    if (!assessment.eligible) {
      const error = new Error(`Instrument is not projection-eligible: ${assessment.blockers.join(', ')}`);
      error.code = 'PROJECTION_INELIGIBLE';
      error.assessment = assessment;
      throw error;
    }
    const instrument = assessment.instrument;
    const coinPositionId = input.coinPositionId || assessment.resolvedLineage?.coinPositionId || instrument.coinPositionId || assessment.representationApproval?.linkedCoinPositionIds?.[0] || null;
    const coinPosition = assessment.coinPosition || (coinPositionId ? this.domain.get('COIN_POSITION', coinPositionId) : null);
    const sourceSupply = input.authorizedSupplyExact ?? input.authorizedSupply ?? assessment.resolvedLineage?.authorizedSupplySource ?? authorizedSupplySourceOf(instrument, coinPosition);
    const authorizedSupplyExact = text(sourceSupply);
    if (!positiveDecimal(authorizedSupplyExact)) throw new Error('Authorized supply must be a positive decimal amount.');
    const authorizedSupply = Number(authorizedSupplyExact);
    const asset = input.asset || assetCodeOf(instrument, coinPosition) || input.instrumentId;
    const projection = {
      projectionId: input.projectionId || id('OCP'),
      projectionClass: 'CONTROLLED_REPRESENTATION',
      network: this.network,
      cluster: input.cluster || this.cluster,
      chainProgram: input.chainProgram || this.program,
      mintAddress: null,
      authoritativeSraRecordType: 'SRA_INSTRUMENT',
      authoritativeSraRecordId: instrument.instrumentId || instrument.id || input.instrumentId,
      instrumentId: input.instrumentId,
      coinPositionId,
      asset,
      symbol: input.symbol || coinPosition?.symbol || instrument.symbol || asset,
      ticker: input.ticker || coinPosition?.ticker || instrument.ticker || null,
      issuerParticipantId: assessment.resolvedLineage?.issuerId || issuerIdOf(instrument, coinPosition),
      verifiedValuePackageId: input.verifiedValuePackageId || assessment.resolvedLineage?.verifiedValueReference || verifiedValueReferenceOf(instrument, coinPosition),
      permanentAssetAccountId: input.permanentAssetAccountId || instrument.assetId || coinPosition?.coinPositionId || null,
      participationPositionId: input.participationPositionId || null,
      authorizedSupply,
      authorizedSupplyExact,
      issuedSupply: 0,
      issuedSupplyExact: '0',
      circulatingSupply: 0,
      retiredSupply: 0,
      decimals: input.decimals ?? null,
      unitDefinition: input.unitDefinition || instrument.unitDefinition || 'ONE_UNIT_EQUALS_ONE_AUTHORIZED_INSTRUMENT_UNIT',
      denomination: input.denomination || instrument.denomination || null,
      currencyOrValueReference: input.currencyOrValueReference || instrument.currency || 'USD',
      issueDate: instrument.issueDate || instrument.issuedAt || null,
      maturityDate: instrument.maturityDate || null,
      transferabilityStatus: input.transferabilityStatus || instrument.transferabilityStatus || 'RESTRICTED',
      settlementStatus: 'NOT_AVAILABLE',
      status: 'DRAFT',
      issuanceState: 'NOT_STARTED',
      pendingIssuance: null,
      metadataUri: input.metadataUri || null,
      metadataDigest: input.metadataDigest || null,
      governingRecordDigest: input.governingRecordDigest || instrument.governingRecordDigest || null,
      eligibilityPolicyId: input.eligibilityPolicyId || 'SRA-OCP-ELIGIBILITY-V1',
      transferPolicyId: input.transferPolicyId || 'SRA-OCP-TRANSFER-V1',
      reconciliationPolicyId: input.reconciliationPolicyId || 'SRA-OCP-RECONCILIATION-V1',
      representationApprovalId: assessment.representationApproval.approvalId || assessment.representationApproval.id,
      createdBy: actorId,
      approvedBy: null,
      approvalEventId: null,
      createdAt: now(), updatedAt: now(), activatedAt: null, suspendedAt: null, retiredAt: null, lastReconciledAt: null,
      history: [],
    };
    await this.domain.put(TYPES.PROJECTION, projection.projectionId, projection, { actorId, eventType: 'ON_CHAIN_PROJECTION_CREATED' });
    return projection;
  }

  async approveProjection(projectionId, actorId = null) {
    const projection = this.getProjection(projectionId);
    if (!projection) throw new Error('Projection not found.');
    if (projection.status !== 'DRAFT' && projection.status !== 'UNDER_REVIEW') throw new Error(`Projection cannot be approved from ${projection.status}.`);
    const approval = await this.domain.lifecycle({ objectType: TYPES.PROJECTION, objectId: projectionId, eventType: 'ON_CHAIN_PROJECTION_APPROVED', actorId, payload: { instrumentId: projection.instrumentId, authorizedSupply: projection.authorizedSupplyExact || projection.authorizedSupply } });
    const updated = { ...projection, status: 'APPROVED', approvedBy: actorId, approvalEventId: approval.id, updatedAt: now() };
    await this.domain.put(TYPES.PROJECTION, projectionId, updated, { actorId, eventType: 'ON_CHAIN_PROJECTION_APPROVED' });
    return updated;
  }

  async recordIssuancePending(projectionId, pendingIssuance, actorId = null) {
    const projection = this.getProjection(projectionId);
    if (!projection) throw new Error('Projection not found.');
    if (projection.mintAddress) return projection;
    requireFields(pendingIssuance, ['mintAddress', 'platformTokenAccount', 'serializedTransactionBase64']);
    const occurredAt = now();
    const updated = {
      ...projection,
      cluster: pendingIssuance.cluster || projection.cluster,
      decimals: pendingIssuance.decimals ?? projection.decimals,
      issuanceState: 'PENDING_NETWORK',
      pendingIssuance: copy(pendingIssuance),
      updatedAt: occurredAt,
      history: [...(projection.history || []), {
        eventType: 'ON_CHAIN_REPRESENTATION_ISSUANCE_PREPARED', actorId, occurredAt,
        mintAddress: pendingIssuance.mintAddress,
      }],
    };
    await this.domain.put(TYPES.PROJECTION, projectionId, updated, { actorId, eventType: 'ON_CHAIN_REPRESENTATION_ISSUANCE_PREPARED' });
    return updated;
  }

  async recordIssuance(projectionId, issuance, actorId = null) {
    const projection = this.getProjection(projectionId);
    if (!projection) throw new Error('Projection not found.');
    if (projection.mintAddress && projection.status === 'ACTIVE') return projection;
    if (!['APPROVED', 'ACTIVE'].includes(projection.status)) throw new Error(`Projection cannot be issued from ${projection.status}.`);
    requireFields(issuance, ['mintAddress', 'platformTokenAccount', 'issuanceTransactionId']);
    const issuedSupplyExact = text(issuance.issuedSupplyExact ?? issuance.issuedSupply);
    const issuedUnits = BigInt(text(issuance.issuedSupplyUnits));
    const authorizedUnits = BigInt(text(issuance.authorizedSupplyUnits));
    if (issuedUnits <= 0n) throw new Error('issuedSupply must be greater than zero.');
    if (issuedUnits > authorizedUnits) throw new Error('Issued supply exceeds authorized supply.');
    const issuedSupply = Number(issuedSupplyExact);
    const occurredAt = issuance.issuedAt || now();
    const updated = {
      ...projection,
      cluster: issuance.cluster || projection.cluster,
      mintAddress: issuance.mintAddress,
      platformTokenAccount: issuance.platformTokenAccount,
      mintAuthorityAddress: issuance.mintAuthorityAddress || null,
      freezeAuthorityAddress: issuance.freezeAuthorityAddress || null,
      decimals: issuance.decimals,
      issuedSupply,
      issuedSupplyExact,
      issuedSupplyUnits: text(issuance.issuedSupplyUnits),
      authorizedSupplyUnits: text(issuance.authorizedSupplyUnits),
      issuanceTransactionId: issuance.issuanceTransactionId,
      issuanceConfirmation: issuance.confirmation || null,
      issuanceState: 'CONFIRMED',
      pendingIssuance: null,
      status: 'ACTIVE',
      settlementStatus: 'AVAILABLE',
      activatedAt: projection.activatedAt || occurredAt,
      issuedAt: occurredAt,
      updatedAt: occurredAt,
      history: [...(projection.history || []), { eventType: 'ON_CHAIN_REPRESENTATION_ISSUED', actorId, occurredAt, transactionId: issuance.issuanceTransactionId, mintAddress: issuance.mintAddress, issuedSupply: issuedSupplyExact }],
    };
    await this.domain.put(TYPES.PROJECTION, projectionId, updated, { actorId, eventType: 'ON_CHAIN_REPRESENTATION_ISSUED' });
    await this.domain.lifecycle({ objectType: TYPES.PROJECTION, objectId: projectionId, eventType: 'ON_CHAIN_REPRESENTATION_ISSUED', actorId, payload: { instrumentId: projection.instrumentId, asset: projection.asset, network: projection.network, mintAddress: issuance.mintAddress, issuedSupply: issuedSupplyExact, transactionId: issuance.issuanceTransactionId } });
    return updated;
  }

  async recordChainEvent(input, actorId = null) {
    requireFields(input, ['projectionId', 'eventType', 'transactionSignature']);
    const existing = this.domain.list(TYPES.CHAIN_EVENT).find((event) => event.transactionSignature === input.transactionSignature && event.eventType === input.eventType);
    if (existing) return existing;
    const event = { eventId: input.eventId || id('OCE'), projectionId: input.projectionId, network: this.network, cluster: this.cluster, eventType: input.eventType, transactionSignature: input.transactionSignature, mintAddress: input.mintAddress || null, senderWalletId: input.senderWalletId || null, senderAddress: input.senderAddress || null, recipientWalletId: input.recipientWalletId || null, recipientAddress: input.recipientAddress || null, quantity: Number(input.quantity || 0), observedAt: input.observedAt || now(), confirmationStatus: input.confirmationStatus || 'CONFIRMED', reconciliationStatus: 'PENDING', raw: input.raw || null, createdAt: now() };
    await this.domain.put(TYPES.CHAIN_EVENT, event.eventId, event, { actorId, eventType: 'ON_CHAIN_EVENT_OBSERVED' });
    return event;
  }

  async reconcileEvent(eventId, actorId = null) {
    const event = this.domain.get(TYPES.CHAIN_EVENT, eventId);
    if (!event) throw new Error('Chain event not found.');
    const projection = this.getProjection(event.projectionId);
    const checks = [];
    const errors = [];
    checks.push({ name: 'PROJECTION_EXISTS', passed: Boolean(projection) });
    if (!projection) errors.push('PROJECTION_NOT_FOUND');
    if (projection) {
      const mintMatches = !event.mintAddress || event.mintAddress === projection.mintAddress;
      checks.push({ name: 'MINT_MATCH', passed: mintMatches });
      if (!mintMatches) errors.push('MINT_MISMATCH');
      let supplyValid = true;
      try {
        if (projection.issuedSupplyUnits != null && projection.authorizedSupplyUnits != null) {
          supplyValid = BigInt(projection.issuedSupplyUnits) <= BigInt(projection.authorizedSupplyUnits);
        } else {
          supplyValid = Number(projection.issuedSupply) <= Number(projection.authorizedSupply);
        }
      } catch { supplyValid = false; }
      checks.push({ name: 'SUPPLY_WITHIN_AUTHORIZATION', passed: supplyValid });
      if (!supplyValid) errors.push('SUPPLY_VARIANCE');
    }
    if (event.recipientWalletId) {
      const wallet = this.domain.get(TYPES.WALLET, event.recipientWalletId);
      const eligible = Boolean(wallet && ELIGIBLE_WALLET_STATES.has(wallet.status));
      checks.push({ name: 'RECIPIENT_WALLET_ELIGIBLE', passed: eligible });
      if (!eligible) errors.push('RECIPIENT_WALLET_INELIGIBLE');
    }
    const outcome = errors.length ? 'RECONCILIATION_EXCEPTION' : 'MATCHED';
    const reconciliation = { reconciliationId: id('OCR'), eventId, projectionId: event.projectionId, instrumentId: projection?.instrumentId || null, outcome, checks, errors, reconciledBy: actorId, reconciledAt: now() };
    await this.domain.put(TYPES.RECONCILIATION, reconciliation.reconciliationId, reconciliation, { actorId, eventType: 'ON_CHAIN_EVENT_RECONCILED' });
    await this.domain.put(TYPES.CHAIN_EVENT, eventId, { ...event, reconciliationStatus: outcome, reconciliationId: reconciliation.reconciliationId }, { actorId, eventType: 'ON_CHAIN_EVENT_RECONCILIATION_UPDATED' });
    if (projection) {
      const projectionUpdate = { ...projection, status: errors.length ? 'RECONCILIATION_EXCEPTION' : projection.status, lastReconciledAt: reconciliation.reconciledAt, updatedAt: now() };
      await this.domain.put(TYPES.PROJECTION, projection.projectionId, projectionUpdate, { actorId, eventType: errors.length ? 'ON_CHAIN_PROJECTION_EXCEPTION' : 'ON_CHAIN_PROJECTION_RECONCILED' });
    }
    await this.domain.lifecycle({ objectType: TYPES.PROJECTION, objectId: event.projectionId, eventType: errors.length ? 'ON_CHAIN_RECONCILIATION_EXCEPTION' : 'ON_CHAIN_RECONCILIATION_MATCHED', actorId, payload: { eventId, reconciliationId: reconciliation.reconciliationId, errors } });
    return reconciliation;
  }

  listChainEvents(projectionId = null) { return this.domain.list(TYPES.CHAIN_EVENT).filter((event) => !projectionId || event.projectionId === projectionId); }
  listReconciliations(projectionId = null) { return this.domain.list(TYPES.RECONCILIATION).filter((record) => !projectionId || record.projectionId === projectionId); }
}

export { TYPES as ON_CHAIN_RECORD_TYPES, authorizedSupplyOf, authorizedSupplySourceOf };
