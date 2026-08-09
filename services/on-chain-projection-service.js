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

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload?.[field] == null || payload?.[field] === '');
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}`);
}

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

  getProjection(projectionId) {
    return this.domain.get(TYPES.PROJECTION, projectionId);
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
      createdAt: now(),
      updatedAt: now(),
    };

    await this.domain.put(TYPES.WALLET, wallet.walletId, wallet, {
      actorId,
      eventType: 'PARTICIPANT_CHAIN_WALLET_REGISTERED',
    });
    await this.domain.lifecycle({
      objectType: TYPES.WALLET,
      objectId: wallet.walletId,
      eventType: 'CHAIN_WALLET_REGISTERED',
      actorId,
      payload: { participantId: wallet.participantId, network: wallet.network, status: wallet.status },
    });
    return wallet;
  }

  async approveWallet(walletId, input = {}, actorId = null) {
    const wallet = this.domain.get(TYPES.WALLET, walletId);
    if (!wallet) throw new Error('Wallet not found.');
    const updated = {
      ...wallet,
      verificationMethod: input.verificationMethod || wallet.verificationMethod || 'MANUAL_REVIEW',
      eligibilityStatus: 'ELIGIBLE',
      status: 'APPROVED',
      approvedBy: actorId,
      approvedAt: now(),
      updatedAt: now(),
    };
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
    if (!ACTIVE_INSTRUMENT_STATES.has(state)) blockers.push('INSTRUMENT_NOT_ISSUED_OR_ACTIVE');
    if (representationApproval?.state !== 'APPROVED') blockers.push('INSTRUMENT_REPRESENTATION_APPROVAL_REQUIRED');
    if (!instrument.issuerId && !instrument.issuerParticipantId) blockers.push('ISSUER_ID_MISSING');
    if (!instrument.verifiedValuePackageId && !(instrument.verifiedValuePackageIds || []).length) blockers.push('VERIFIED_VALUE_PACKAGE_MISSING');
    if (Number(instrument.authorizedSupply ?? instrument.authorizedAmount ?? instrument.faceValue ?? 0) <= 0) blockers.push('AUTHORIZED_SUPPLY_OR_AMOUNT_MISSING');
    if (!instrument.purpose) warnings.push('INSTRUMENT_PURPOSE_NOT_EXPLICIT');
    if (!instrument.transferabilityStatus && !instrument.transferable) warnings.push('TRANSFERABILITY_RULE_NOT_EXPLICIT');
    if (!instrument.unitDefinition && !instrument.denomination) warnings.push('UNIT_DEFINITION_NOT_EXPLICIT');
    if (!instrument.governingRecordDigest && !instrument.governingDocumentId) warnings.push('GOVERNING_RECORD_DIGEST_NOT_SET');

    return { eligible: blockers.length === 0, instrumentId, state, blockers, warnings, representationApproval: copy(representationApproval), instrument: copy(instrument) };
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
    const authorizedSupply = Number(input.authorizedSupply ?? instrument.authorizedSupply ?? instrument.authorizedAmount ?? instrument.faceValue);
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
      issuerParticipantId: instrument.issuerParticipantId || instrument.issuerId,
      verifiedValuePackageId: input.verifiedValuePackageId || instrument.verifiedValuePackageId || instrument.verifiedValuePackageIds?.[0],
      permanentAssetAccountId: input.permanentAssetAccountId || instrument.assetId || null,
      participationPositionId: input.participationPositionId || null,
      authorizedSupply,
      issuedSupply: 0,
      circulatingSupply: 0,
      retiredSupply: 0,
      unitDefinition: input.unitDefinition || instrument.unitDefinition || 'ONE_UNIT_EQUALS_ONE_AUTHORIZED_INSTRUMENT_UNIT',
      denomination: input.denomination || instrument.denomination || null,
      currencyOrValueReference: input.currencyOrValueReference || instrument.currency || 'USD',
      issueDate: instrument.issueDate || null,
      maturityDate: instrument.maturityDate || null,
      transferabilityStatus: input.transferabilityStatus || instrument.transferabilityStatus || 'RESTRICTED',
      settlementStatus: 'NOT_AVAILABLE',
      status: 'DRAFT',
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
      createdAt: now(),
      updatedAt: now(),
      activatedAt: null,
      suspendedAt: null,
      retiredAt: null,
      lastReconciledAt: null,
      history: [],
    };

    await this.domain.put(TYPES.PROJECTION, projection.projectionId, projection, { actorId, eventType: 'ON_CHAIN_PROJECTION_CREATED' });
    return projection;
  }

  async approveProjection(projectionId, actorId = null) {
    const projection = this.getProjection(projectionId);
    if (!projection) throw new Error('Projection not found.');
    if (projection.status !== 'DRAFT' && projection.status !== 'UNDER_REVIEW') throw new Error(`Projection cannot be approved from ${projection.status}.`);
    const approval = await this.domain.lifecycle({
      objectType: TYPES.PROJECTION,
      objectId: projectionId,
      eventType: 'ON_CHAIN_PROJECTION_APPROVED',
      actorId,
      payload: { instrumentId: projection.instrumentId, authorizedSupply: projection.authorizedSupply },
    });
    const updated = { ...projection, status: 'APPROVED', approvedBy: actorId, approvalEventId: approval.id, updatedAt: now() };
    await this.domain.put(TYPES.PROJECTION, projectionId, updated, { actorId, eventType: 'ON_CHAIN_PROJECTION_APPROVED' });
    return updated;
  }

  async recordChainEvent(input, actorId = null) {
    requireFields(input, ['projectionId', 'eventType', 'transactionSignature']);
    const existing = this.domain.list(TYPES.CHAIN_EVENT).find((event) => event.transactionSignature === input.transactionSignature && event.eventType === input.eventType);
    if (existing) return existing;
    const event = {
      eventId: input.eventId || id('OCE'),
      projectionId: input.projectionId,
      network: this.network,
      cluster: this.cluster,
      eventType: input.eventType,
      transactionSignature: input.transactionSignature,
      mintAddress: input.mintAddress || null,
      senderWalletId: input.senderWalletId || null,
      senderAddress: input.senderAddress || null,
      recipientWalletId: input.recipientWalletId || null,
      recipientAddress: input.recipientAddress || null,
      quantity: Number(input.quantity || 0),
      observedAt: input.observedAt || now(),
      confirmationStatus: input.confirmationStatus || 'CONFIRMED',
      reconciliationStatus: 'PENDING',
      raw: input.raw || null,
      createdAt: now(),
    };
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
      const supplyValid = projection.issuedSupply <= projection.authorizedSupply;
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
    const reconciliation = {
      reconciliationId: id('OCR'),
      eventId,
      projectionId: event.projectionId,
      instrumentId: projection?.instrumentId || null,
      outcome,
      checks,
      errors,
      reconciledBy: actorId,
      reconciledAt: now(),
    };
    await this.domain.put(TYPES.RECONCILIATION, reconciliation.reconciliationId, reconciliation, { actorId, eventType: 'ON_CHAIN_EVENT_RECONCILED' });
    await this.domain.put(TYPES.CHAIN_EVENT, eventId, { ...event, reconciliationStatus: outcome, reconciliationId: reconciliation.reconciliationId }, { actorId, eventType: 'ON_CHAIN_EVENT_RECONCILIATION_UPDATED' });
    if (projection) {
      const projectionUpdate = {
        ...projection,
        status: errors.length ? 'RECONCILIATION_EXCEPTION' : projection.status,
        lastReconciledAt: reconciliation.reconciledAt,
        updatedAt: now(),
      };
      await this.domain.put(TYPES.PROJECTION, projection.projectionId, projectionUpdate, { actorId, eventType: errors.length ? 'ON_CHAIN_PROJECTION_EXCEPTION' : 'ON_CHAIN_PROJECTION_RECONCILED' });
    }
    await this.domain.lifecycle({
      objectType: TYPES.PROJECTION,
      objectId: event.projectionId,
      eventType: errors.length ? 'ON_CHAIN_RECONCILIATION_EXCEPTION' : 'ON_CHAIN_RECONCILIATION_MATCHED',
      actorId,
      payload: { eventId, reconciliationId: reconciliation.reconciliationId, errors },
    });
    return reconciliation;
  }

  listChainEvents(projectionId = null) {
    return this.domain.list(TYPES.CHAIN_EVENT).filter((event) => !projectionId || event.projectionId === projectionId);
  }

  listReconciliations(projectionId = null) {
    return this.domain.list(TYPES.RECONCILIATION).filter((record) => !projectionId || record.projectionId === projectionId);
  }
}

export { TYPES as ON_CHAIN_RECORD_TYPES };
