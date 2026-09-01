import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const NATIVE_ASSET_ID = 'SRA-USD';
const FINANCING_TYPE = 'LOAN_FINANCING_AUTHORIZATION';
const timestamp = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const quantity = (value, field = 'amount') => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be greater than zero.`);
  return Number(parsed.toFixed(8));
};

function accountId(universalAccountId) { return `DVA-${text(universalAccountId)}`; }
function positionId(directValueAccountId, canonicalAssetId, network = 'NATIVE') {
  return `AVP-${crypto.createHash('sha256').update(`${directValueAccountId}|${canonicalAssetId}|${upper(network)}`).digest('hex').slice(0, 16).toUpperCase()}`;
}

export class DirectValueAccountService {
  constructor(domain) { this.domain = domain; }

  async initialize(actorId = 'SRA_ACCOUNT_SYSTEM') {
    const existing = this.domain.get(RECORD_TYPES.CANONICAL_ASSET, NATIVE_ASSET_ID);
    if (!existing) {
      const createdAt = timestamp();
      await this.domain.put(RECORD_TYPES.CANONICAL_ASSET, NATIVE_ASSET_ID, {
        id: NATIVE_ASSET_ID,
        canonicalAssetId: NATIVE_ASSET_ID,
        displayName: 'SRA/USD',
        symbol: 'SRAUSD',
        assetClass: 'NATIVE_SETTLEMENT_VALUE',
        native: true,
        denomination: 'USD',
        decimals: 2,
        state: 'ACTIVE',
        issuanceAuthority: 'AUTHORIZED_SRA_TRANSACTION',
        treasuryDependency: 'NONE',
        createdAt,
        updatedAt: createdAt,
      }, { actorId, eventType: 'CANONICAL_NATIVE_ASSET_DEFINED' });
    }
    return this.domain.get(RECORD_TYPES.CANONICAL_ASSET, NATIVE_ASSET_ID);
  }

  async ensureAccount({ participantId, universalAccountId, displayName = null }, actorId = participantId) {
    if (!text(participantId) || !text(universalAccountId)) throw new Error('participantId and universalAccountId are required.');
    const id = accountId(universalAccountId);
    const existing = this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, id);
    if (existing) {
      if (existing.participantId !== text(participantId)) throw new Error('Universal Account is already bound to a different participant.');
      return existing;
    }
    const createdAt = timestamp();
    const record = {
      id,
      directValueAccountId: id,
      participantId: text(participantId),
      universalAccountId: text(universalAccountId),
      displayName: text(displayName) || null,
      ownership: 'PARTICIPANT',
      accountModel: 'DIRECT_MULTI_ASSET',
      participantAssetsFundOrigination: false,
      rehypothecationAuthorized: false,
      state: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
    };
    await this.domain.put(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, id, record, { actorId, eventType: 'DIRECT_VALUE_ACCOUNT_OPENED' });
    return record;
  }

  getAccountByUniversalId(universalAccountId) { return this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, accountId(universalAccountId)); }
  getPosition(directValueAccountId, canonicalAssetId, network = 'NATIVE') { return this.domain.get(RECORD_TYPES.ACCOUNT_ASSET_POSITION, positionId(directValueAccountId, canonicalAssetId, network)); }
  positions(directValueAccountId) { return this.domain.list(RECORD_TYPES.ACCOUNT_ASSET_POSITION).filter((item) => item.directValueAccountId === directValueAccountId); }
  movements(directValueAccountId) { return this.domain.list(RECORD_TYPES.ASSET_MOVEMENT).filter((item) => item.directValueAccountId === directValueAccountId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); }

  snapshot(directValueAccountId) {
    const account = this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, directValueAccountId);
    if (!account) throw new Error('Direct Value Account not found.');
    return {
      account,
      positions: this.positions(directValueAccountId),
      movements: this.movements(directValueAccountId).slice(0, 100),
      separations: {
        participantAssets: 'PARTICIPANT_OWNED',
        origination: 'INDEPENDENT_AUTHORIZED_TRANSACTION_SYSTEM',
        institutionalReceipts: 'SRA_GROWTH_TREASURY',
      },
    };
  }

  asset(canonicalAssetId) { return this.domain.get(RECORD_TYPES.CANONICAL_ASSET, upper(canonicalAssetId)); }

  async defineExternalAsset(input = {}, actorId = null) {
    const network = upper(input.network);
    const symbol = upper(input.symbol);
    const requestedId = upper(input.canonicalAssetId);
    const known = requestedId ? this.asset(requestedId) : null;
    if (known) return known;
    const assetAddress = text(input.assetAddress || input.issuerAddress || input.mintAddress);
    if (!network || !symbol) throw new Error('network and symbol are required.');
    const id = requestedId || `${network}-${symbol}`;
    const existing = this.asset(id);
    if (existing) return existing;
    const createdAt = timestamp();
    const record = {
      id,
      canonicalAssetId: id,
      displayName: text(input.displayName) || symbol,
      symbol,
      assetClass: upper(input.assetClass || 'EXTERNAL_DIGITAL_ASSET'),
      native: false,
      originNetwork: network,
      assetAddress: assetAddress || null,
      decimals: input.decimals == null ? null : Number(input.decimals),
      state: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
    };
    await this.domain.put(RECORD_TYPES.CANONICAL_ASSET, id, record, { actorId, eventType: 'EXTERNAL_CANONICAL_ASSET_DEFINED' });
    return record;
  }

  async setPosition({ directValueAccountId, canonicalAssetId, network = 'NATIVE', available, restricted = 0, custodyModel, custodyReference = null }, actorId, eventType) {
    const id = positionId(directValueAccountId, canonicalAssetId, network);
    const current = this.domain.get(RECORD_TYPES.ACCOUNT_ASSET_POSITION, id);
    const updatedAt = timestamp();
    const record = {
      id,
      positionId: id,
      directValueAccountId,
      canonicalAssetId: upper(canonicalAssetId),
      network: upper(network),
      available: Number(Number(available).toFixed(8)),
      restricted: Number(Number(restricted).toFixed(8)),
      total: Number((Number(available) + Number(restricted)).toFixed(8)),
      custodyModel,
      custodyReference,
      state: 'ACTIVE',
      createdAt: current?.createdAt || updatedAt,
      updatedAt,
    };
    await this.domain.put(RECORD_TYPES.ACCOUNT_ASSET_POSITION, id, record, { actorId, eventType });
    return record;
  }

  async recordMovement(input, actorId, eventType) {
    const id = text(input.movementId) || uid('AVM');
    const existing = this.domain.get(RECORD_TYPES.ASSET_MOVEMENT, id);
    if (existing) return existing;
    const record = { id, movementId: id, ...input, movementId: id, createdAt: timestamp() };
    await this.domain.put(RECORD_TYPES.ASSET_MOVEMENT, id, record, { actorId, eventType });
    return record;
  }

  async creditAuthorizedFunding(input = {}, actorId = null) {
    const financing = this.domain.get(RECORD_TYPES.SRA_TRANSACTION, text(input.financingTransactionId));
    if (!financing || financing.transactionType !== FINANCING_TYPE || financing.state !== 'POSTED') throw new Error('Posted governed financing authorization not found.');
    const existing = this.domain.list(RECORD_TYPES.ASSET_MOVEMENT).find((item) => item.kind === 'AUTHORIZED_FUNDING_CREDIT' && item.financingTransactionId === financing.transactionId);
    if (existing) return { created: false, movement: existing, position: this.getPosition(existing.directValueAccountId, NATIVE_ASSET_ID) };
    const directAccount = await this.ensureAccount({ participantId: financing.borrowerParticipantId, universalAccountId: text(input.universalAccountId), displayName: input.displayName }, actorId);
    const amount = quantity(input.amount ?? financing.amount);
    if (amount > Number(financing.amount)) throw new Error('Native funding credit cannot exceed the authorized financing amount.');
    const current = this.getPosition(directAccount.directValueAccountId, NATIVE_ASSET_ID);
    const position = await this.setPosition({ directValueAccountId: directAccount.directValueAccountId, canonicalAssetId: NATIVE_ASSET_ID, available: Number(current?.available || 0) + amount, restricted: Number(current?.restricted || 0), custodyModel: 'SRA_NATIVE_ACCOUNT_LEDGER' }, actorId, 'AUTHORIZED_FUNDING_VALUE_CREDITED');
    const movement = await this.recordMovement({ kind: 'AUTHORIZED_FUNDING_CREDIT', directValueAccountId: directAccount.directValueAccountId, canonicalAssetId: NATIVE_ASSET_ID, network: 'NATIVE', direction: 'CREDIT', amount, financingTransactionId: financing.transactionId, obligationAmount: financing.amount, state: 'COMPLETED' }, actorId, 'AUTHORIZED_FUNDING_VALUE_CREDITED');
    return { created: true, account: directAccount, position, movement };
  }

  async recordExternalDeposit(input = {}, actorId = null) {
    const account = this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, text(input.directValueAccountId));
    if (!account) throw new Error('Direct Value Account not found.');
    if (!text(input.transactionId) || !text(input.custodyReference)) throw new Error('Confirmed transactionId and custodyReference are required.');
    const duplicate = this.domain.list(RECORD_TYPES.ASSET_MOVEMENT).find((item) => item.kind === 'EXTERNAL_ASSET_DEPOSIT' && item.network === upper(input.network) && item.transactionId === text(input.transactionId));
    if (duplicate) return { created: false, movement: duplicate, position: this.getPosition(account.directValueAccountId, duplicate.canonicalAssetId, duplicate.network) };
    const asset = await this.defineExternalAsset(input, actorId);
    const amount = quantity(input.amount);
    const current = this.getPosition(account.directValueAccountId, asset.canonicalAssetId, input.network);
    const position = await this.setPosition({ directValueAccountId: account.directValueAccountId, canonicalAssetId: asset.canonicalAssetId, network: input.network, available: Number(current?.available || 0) + amount, restricted: Number(current?.restricted || 0), custodyModel: 'SRA_RECORDED_EXTERNAL_CUSTODY', custodyReference: input.custodyReference }, actorId, 'EXTERNAL_ASSET_DEPOSIT_CONFIRMED');
    const movement = await this.recordMovement({ kind: 'EXTERNAL_ASSET_DEPOSIT', directValueAccountId: account.directValueAccountId, canonicalAssetId: asset.canonicalAssetId, network: upper(input.network), direction: 'CREDIT', amount, transactionId: text(input.transactionId), sourceAddress: text(input.sourceAddress) || null, custodyReference: text(input.custodyReference), state: 'CONFIRMED' }, actorId, 'EXTERNAL_ASSET_DEPOSIT_CONFIRMED');
    return { created: true, asset, position, movement };
  }

  async registerRailRepresentation(input = {}, actorId = null) {
    const asset = this.asset(input.canonicalAssetId);
    if (!asset) throw new Error('Canonical asset not found.');
    const network = upper(input.network);
    if (!network || network === 'NATIVE') throw new Error('A public network is required.');
    const id = `ARR-${asset.canonicalAssetId}-${network}`;
    const existing = this.domain.get(RECORD_TYPES.ASSET_RAIL_REPRESENTATION, id);
    if (existing) return existing;
    if (!text(input.networkAssetIdentifier)) throw new Error('networkAssetIdentifier is required.');
    const createdAt = timestamp();
    const record = {
      id, representationId: id, canonicalAssetId: asset.canonicalAssetId, network,
      networkAssetCode: upper(input.networkAssetCode || asset.symbol), networkAssetIdentifier: text(input.networkAssetIdentifier),
      movementModel: upper(input.movementModel || 'LOCK_AND_RELEASE'), state: 'ACTIVE', registeredBy: actorId, createdAt, updatedAt: createdAt,
    };
    await this.domain.put(RECORD_TYPES.ASSET_RAIL_REPRESENTATION, id, record, { actorId, eventType: 'ASSET_RAIL_REPRESENTATION_REGISTERED' });
    return record;
  }

  async recordConfirmedRailMovement(input = {}, actorId = null) {
    const account = this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, text(input.directValueAccountId));
    if (!account) throw new Error('Direct Value Account not found.');
    const direction = upper(input.direction);
    if (!['OUTBOUND', 'INBOUND'].includes(direction)) throw new Error('direction must be OUTBOUND or INBOUND.');
    const canonicalAssetId = upper(input.canonicalAssetId);
    const asset = this.asset(canonicalAssetId);
    if (!asset) throw new Error('Canonical asset not found.');
    if (!asset.native) throw new Error('Canonical rail movement applies to native SRA assets; use external deposit or withdrawal custody flow for external assets.');
    const publicNetwork = upper(input.publicNetwork);
    const representation = this.domain.get(RECORD_TYPES.ASSET_RAIL_REPRESENTATION, `ARR-${canonicalAssetId}-${publicNetwork}`);
    if (!representation || representation.state !== 'ACTIVE') throw new Error('Active public-rail representation not found.');
    if (!text(input.transactionId)) throw new Error('A confirmed transactionId is required.');
    const duplicate = this.domain.list(RECORD_TYPES.ASSET_MOVEMENT).find((item) => item.kind === 'PUBLIC_RAIL_MOVEMENT' && item.publicNetwork === publicNetwork && item.transactionId === text(input.transactionId));
    if (duplicate) return { created: false, movement: duplicate };
    const amount = quantity(input.amount);
    const native = this.getPosition(account.directValueAccountId, canonicalAssetId, 'NATIVE');
    const rail = this.getPosition(account.directValueAccountId, canonicalAssetId, publicNetwork);
    let nativeAvailable = Number(native?.available || 0);
    let railAvailable = Number(rail?.available || 0);
    if (direction === 'OUTBOUND') {
      if (nativeAvailable < amount) throw new Error('Available native balance is insufficient.');
      nativeAvailable -= amount;
      if (input.heldInSraCustody === true) railAvailable += amount;
    } else {
      if (input.heldInSraCustody === true) {
        if (railAvailable < amount) throw new Error('Available public-rail custody balance is insufficient.');
        railAvailable -= amount;
      }
      nativeAvailable += amount;
    }
    const updatedAt = timestamp();
    const nativeId = positionId(account.directValueAccountId, canonicalAssetId, 'NATIVE');
    const nativePosition = { id: nativeId, positionId: nativeId, directValueAccountId: account.directValueAccountId, canonicalAssetId, network: 'NATIVE', available: Number(nativeAvailable.toFixed(8)), restricted: Number(native?.restricted || 0), total: Number((nativeAvailable + Number(native?.restricted || 0)).toFixed(8)), custodyModel: 'SRA_NATIVE_ACCOUNT_LEDGER', custodyReference: null, state: 'ACTIVE', createdAt: native?.createdAt || updatedAt, updatedAt };
    const changes = [{ type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: nativeId, payload: nativePosition, actorId, eventType: `PUBLIC_RAIL_${direction}_NATIVE_POSITION_UPDATED` }];
    let railPosition = rail;
    if (input.heldInSraCustody === true) {
      const railId = positionId(account.directValueAccountId, canonicalAssetId, publicNetwork);
      railPosition = { id: railId, positionId: railId, directValueAccountId: account.directValueAccountId, canonicalAssetId, network: publicNetwork, available: Number(railAvailable.toFixed(8)), restricted: Number(rail?.restricted || 0), total: Number((railAvailable + Number(rail?.restricted || 0)).toFixed(8)), custodyModel: 'SRA_RECORDED_EXTERNAL_CUSTODY', custodyReference: text(input.custodyReference) || rail?.custodyReference || null, state: 'ACTIVE', createdAt: rail?.createdAt || updatedAt, updatedAt };
      changes.push({ type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: railId, payload: railPosition, actorId, eventType: `PUBLIC_RAIL_${direction}_CUSTODY_POSITION_UPDATED` });
    }
    await this.domain.atomicPut(changes);
    const movement = await this.recordMovement({ kind: 'PUBLIC_RAIL_MOVEMENT', directValueAccountId: account.directValueAccountId, canonicalAssetId, direction, amount, publicNetwork, representationId: representation.representationId, transactionId: text(input.transactionId), destinationAddress: text(input.destinationAddress) || null, sourceAddress: text(input.sourceAddress) || null, heldInSraCustody: input.heldInSraCustody === true, state: 'CONFIRMED' }, actorId, `PUBLIC_RAIL_${direction}_CONFIRMED`);
    return { created: true, movement, nativePosition, railPosition };
  }

  async convert(input = {}, actorId = null) {
    const account = this.domain.get(RECORD_TYPES.DIRECT_VALUE_ACCOUNT, text(input.directValueAccountId));
    if (!account) throw new Error('Direct Value Account not found.');
    if (!text(input.executionReference)) throw new Error('A completed external or internal executionReference is required.');
    const fromAssetId = upper(input.fromAssetId);
    const toNetwork = upper(input.toNetwork || 'NATIVE');
    const toAsset = await this.defineExternalAsset({ ...input, network: toNetwork, symbol: input.toSymbol, canonicalAssetId: input.toAssetId }, actorId);
    const fromAmount = quantity(input.fromAmount, 'fromAmount');
    const toAmount = quantity(input.toAmount, 'toAmount');
    const fromNetwork = upper(input.fromNetwork || 'NATIVE');
    const source = this.getPosition(account.directValueAccountId, fromAssetId, fromNetwork);
    if (!source || source.available < fromAmount) throw new Error('Available source-asset balance is insufficient.');
    const existing = this.domain.list(RECORD_TYPES.ASSET_CONVERSION).find((item) => item.executionReference === text(input.executionReference));
    if (existing) return { created: false, conversion: existing };
    const target = this.getPosition(account.directValueAccountId, toAsset.canonicalAssetId, toNetwork);
    const conversionId = uid('AVX');
    const convertedAt = timestamp();
    const sourcePosition = { ...source, available: Number((source.available - fromAmount).toFixed(8)), total: Number((source.total - fromAmount).toFixed(8)), updatedAt: convertedAt };
    const targetId = positionId(account.directValueAccountId, toAsset.canonicalAssetId, toNetwork);
    const targetPosition = {
      id: targetId, positionId: targetId, directValueAccountId: account.directValueAccountId, canonicalAssetId: toAsset.canonicalAssetId, network: toNetwork,
      available: Number((Number(target?.available || 0) + toAmount).toFixed(8)), restricted: Number(target?.restricted || 0), total: Number((Number(target?.total || 0) + toAmount).toFixed(8)),
      custodyModel: text(input.custodyModel) || 'SRA_RECORDED_EXTERNAL_CUSTODY', custodyReference: text(input.custodyReference) || null, state: 'ACTIVE', createdAt: target?.createdAt || convertedAt, updatedAt: convertedAt,
    };
    const conversion = {
      id: conversionId, conversionId, directValueAccountId: account.directValueAccountId, fromAssetId, fromNetwork, fromAmount,
      toAssetId: toAsset.canonicalAssetId, toNetwork, toAmount, executedRate: Number((toAmount / fromAmount).toFixed(12)), executionReference: text(input.executionReference),
      pricingSource: text(input.pricingSource) || null, state: 'COMPLETED', executedBy: actorId, executedAt: convertedAt, createdAt: convertedAt,
    };
    await this.domain.atomicPut([
      { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: source.positionId, payload: sourcePosition, actorId, eventType: 'ASSET_CONVERSION_SOURCE_DEBITED' },
      { type: RECORD_TYPES.ACCOUNT_ASSET_POSITION, id: targetId, payload: targetPosition, actorId, eventType: 'ASSET_CONVERSION_TARGET_CREDITED' },
      { type: RECORD_TYPES.ASSET_CONVERSION, id: conversionId, payload: conversion, actorId, eventType: 'ASSET_CONVERSION_COMPLETED' },
    ]);
    await this.recordMovement({ kind: 'ASSET_CONVERSION', directValueAccountId: account.directValueAccountId, canonicalAssetId: fromAssetId, network: fromNetwork, direction: 'DEBIT', amount: fromAmount, counterAssetId: toAsset.canonicalAssetId, counterAmount: toAmount, executionReference: conversion.executionReference, state: 'COMPLETED' }, actorId, 'ASSET_CONVERSION_COMPLETED');
    return { created: true, conversion, sourcePosition, targetPosition };
  }

  async recordRepayment(input = {}, actorId = null) {
    const financing = this.domain.get(RECORD_TYPES.SRA_TRANSACTION, text(input.financingTransactionId));
    if (!financing || financing.transactionType !== FINANCING_TYPE) throw new Error('Governed financing transaction not found.');
    if (!text(input.settlementReference)) throw new Error('A confirmed settlementReference is required.');
    const duplicate = this.domain.list(RECORD_TYPES.INSTITUTIONAL_RECEIPT).find((item) => item.settlementReference === text(input.settlementReference));
    if (duplicate) return { created: false, receipt: duplicate };
    const prior = this.domain.list(RECORD_TYPES.INSTITUTIONAL_RECEIPT).filter((item) => item.financingTransactionId === financing.transactionId).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const amount = quantity(input.amount);
    const remainingBefore = Math.max(0, Number(financing.amount) - prior);
    if (amount > remainingBefore) throw new Error('Repayment exceeds the remaining obligation amount.');
    const receiptId = uid('ISR');
    const receivedAt = timestamp();
    const receipt = {
      id: receiptId, receiptId, financingTransactionId: financing.transactionId, participantId: financing.borrowerParticipantId, amount,
      assetId: upper(input.assetId || NATIVE_ASSET_ID), network: upper(input.network || 'NATIVE'), settlementReference: text(input.settlementReference),
      remainingBefore, remainingAfter: Number((remainingBefore - amount).toFixed(8)), institutionalUse: 'PLATFORM_OPERATION_AND_GROWTH',
      originationFundingUse: 'PROHIBITED_BY_ACCOUNT_ARCHITECTURE', state: 'RECEIVED', receivedBy: actorId, receivedAt, createdAt: receivedAt,
    };
    await this.domain.put(RECORD_TYPES.INSTITUTIONAL_RECEIPT, receiptId, receipt, { actorId, eventType: 'REPAYMENT_INSTITUTIONAL_RECEIPT_RECORDED' });
    return { created: true, receipt };
  }

  async releaseObligation(input = {}, actorId = null) {
    const financing = this.domain.get(RECORD_TYPES.SRA_TRANSACTION, text(input.financingTransactionId));
    if (!financing || financing.transactionType !== FINANCING_TYPE) throw new Error('Governed financing transaction not found.');
    if (upper(input.authorization) !== 'APPROVE_RELEASE') throw new Error('Explicit APPROVE_RELEASE authority is required.');
    if (!text(input.decisionRationale)) throw new Error('decisionRationale is required.');
    const existing = this.domain.list(RECORD_TYPES.OBLIGATION_RELEASE).find((item) => item.financingTransactionId === financing.transactionId && item.state === 'RELEASED');
    if (existing) return { created: false, release: existing };
    const receipts = this.domain.list(RECORD_TYPES.INSTITUTIONAL_RECEIPT).filter((item) => item.financingTransactionId === financing.transactionId);
    const repaidAmount = Number(receipts.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(8));
    const releasedAmount = Number((Number(financing.amount) - repaidAmount).toFixed(8));
    if (releasedAmount <= 0) throw new Error('No remaining obligation amount is available for release.');
    const releaseId = uid('OBR');
    const releasedAt = timestamp();
    const release = {
      id: releaseId, releaseId, financingTransactionId: financing.transactionId, participantId: financing.borrowerParticipantId,
      originalAmount: financing.amount, repaidAmount, releasedAmount, resolutionState: 'AUTHORIZED_FORGIVENESS', state: 'RELEASED',
      decisionRationale: text(input.decisionRationale), collateralResolutionReference: text(input.collateralResolutionReference) || null,
      informationReportingState: 'DETERMINATION_REQUIRED', informationReportingForm: '1099-C_WHEN_APPLICABLE',
      authorizedBy: actorId, releasedAt, createdAt: releasedAt,
    };
    await this.domain.put(RECORD_TYPES.OBLIGATION_RELEASE, releaseId, release, { actorId, eventType: 'OBLIGATION_RELEASE_AUTHORIZED' });
    return { created: true, release };
  }
}

export { NATIVE_ASSET_ID as SRA_USD_CANONICAL_ASSET_ID };
