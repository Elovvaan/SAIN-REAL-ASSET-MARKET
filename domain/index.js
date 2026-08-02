export class DomainEntity {
  constructor({ id, status = 'ACTIVE', ownerId = null, version = 1, metadata = {} }) {
    if (!id) throw new Error('DomainEntity requires an id.');
    const now = new Date().toISOString();
    this.id = id; this.status = status; this.ownerId = ownerId; this.version = version;
    this.createdAt = now; this.updatedAt = now; this.hash = null; this.signature = null;
    this.permissions = []; this.metadata = metadata;
  }
  touch() { this.updatedAt = new Date().toISOString(); this.version += 1; }
}

export class Participant extends DomainEntity {
  constructor({ id, displayName, type = 'PERSON', roles = [], organizations = [], wallets = [], credentials = [], ...base }) {
    super({ id, ...base }); this.displayName = displayName; this.type = type; this.roles = roles;
    this.organizations = organizations; this.wallets = wallets; this.credentials = credentials; this.history = [];
  }
}

export class LifecycleRecord extends DomainEntity {
  constructor({ id, assetId, events = [], ...base }) { super({ id, ...base }); this.assetId = assetId; this.events = events; }
  append(event) { const entry = { id: `${this.id}-EV-${this.events.length + 1}`, recordedAt: new Date().toISOString(), ...event }; this.events.push(entry); this.touch(); return entry; }
}

export class AssetAccount extends DomainEntity {
  constructor({ id, name, classification, region, lifecycleRecordId, verifiedValuePackageIds = [], projectIds = [], trueBillIds = [], completionIds = [], custodyRecordIds = [], dischargeRecordIds = [], ...base }) {
    super({ id, ...base }); this.name = name; this.classification = classification; this.region = region;
    this.lifecycleRecordId = lifecycleRecordId; this.verifiedValuePackageIds = verifiedValuePackageIds;
    this.projectIds = projectIds; this.trueBillIds = trueBillIds; this.completionIds = completionIds;
    this.custodyRecordIds = custodyRecordIds; this.dischargeRecordIds = dischargeRecordIds;
  }
}

export class VerifiedValuePackage extends DomainEntity {
  constructor({ id, assetId, measurements, score, value, rulesetVersion, frozenAt = new Date().toISOString(), proof = {}, ...base }) {
    super({ id, status: 'FROZEN', ...base }); this.assetId = assetId; this.measurements = measurements;
    this.score = score; this.value = value; this.rulesetVersion = rulesetVersion; this.frozenAt = frozenAt; this.proof = proof;
  }
}

export class TrueBill extends DomainEntity {
  constructor({ id, assetId, projectId, verifiedValuePackageId, purpose, faceValue, holderId = null, controllerId = null, state = 'DRAFT', settlement = null, ...base }) {
    super({ id, status: state, ...base }); this.assetId = assetId; this.projectId = projectId;
    this.verifiedValuePackageId = verifiedValuePackageId; this.purpose = purpose; this.faceValue = faceValue;
    this.holderId = holderId; this.controllerId = controllerId; this.state = state; this.history = []; this.settlement = settlement;
  }
  transition(nextState, note) { this.history.push({ from: this.state, to: nextState, note, at: new Date().toISOString() }); this.state = nextState; this.status = nextState; this.touch(); }
}

export class MarketplaceProject extends DomainEntity {
  constructor({ id, assetId, title, stage = 'DRAFT', participantIds = [], milestones = [], poolIds = [], verifiedValuePackageIds = [], trueBillIds = [], completionId = null, ...base }) {
    super({ id, status: stage, ...base }); this.assetId = assetId; this.title = title; this.stage = stage;
    this.participantIds = participantIds; this.milestones = milestones; this.poolIds = poolIds;
    this.verifiedValuePackageIds = verifiedValuePackageIds; this.trueBillIds = trueBillIds; this.completionId = completionId;
  }
}

export const PARTICIPATION_POSITION_STATES = Object.freeze([
  'AUTHORIZED',
  'PENDING_RECEIPT',
  'CONTRIBUTION_V4V_REQUIRED',
  'RECEIVED',
  'DEPLOYED',
  'ACTIVE',
  'OUTCOME_COMPLETED',
  'SETTLEMENT_AVAILABLE',
  'HELD',
  'TRANSFER_PENDING',
  'REDEPLOYMENT_PENDING',
  'SETTLEMENT_PENDING',
  'CROSS_PLATFORM_ROUTING_PENDING',
  'TRANSFERRED',
  'REDEPLOYED',
  'SETTLED',
  'ROUTED_EXTERNALLY',
  'RECONCILED',
  'CLOSED',
]);

export const SETTLEMENT_ACTIONS = Object.freeze([
  'SETTLE_NOW',
  'HOLD_POSITION',
  'TRANSFER_POSITION',
  'REDEPLOY_IN_SRA',
  'ROUTE_CROSS_PLATFORM',
]);

export class ParticipationPosition extends DomainEntity {
  constructor({
    id,
    projectId,
    assetId,
    participantId,
    contributionType,
    contributionMedium,
    statedValue = 0,
    verifiedValue = 0,
    transferableValue = 0,
    retainedValue = 0,
    state = 'AUTHORIZED',
    settlementAvailableAt = null,
    settlementInstructionIds = [],
    history = [],
    ...base
  }) {
    if (!PARTICIPATION_POSITION_STATES.includes(state)) {
      throw new Error(`Unsupported participation position state: ${state}`);
    }
    super({ id, status: state, ownerId: participantId, ...base });
    this.projectId = projectId;
    this.assetId = assetId;
    this.participantId = participantId;
    this.contributionType = contributionType;
    this.contributionMedium = contributionMedium;
    this.statedValue = statedValue;
    this.verifiedValue = verifiedValue;
    this.transferableValue = transferableValue;
    this.retainedValue = retainedValue;
    this.state = state;
    this.settlementAvailableAt = settlementAvailableAt;
    this.settlementInstructionIds = settlementInstructionIds;
    this.history = history;
  }

  transition(nextState, note = null, evidenceIds = []) {
    if (!PARTICIPATION_POSITION_STATES.includes(nextState)) {
      throw new Error(`Unsupported participation position state: ${nextState}`);
    }
    const event = {
      from: this.state,
      to: nextState,
      note,
      evidenceIds: [...evidenceIds],
      at: new Date().toISOString(),
    };
    this.history.push(event);
    this.state = nextState;
    this.status = nextState;
    if (nextState === 'SETTLEMENT_AVAILABLE' && !this.settlementAvailableAt) {
      this.settlementAvailableAt = event.at;
    }
    this.touch();
    return event;
  }

  addSettlementInstruction(instructionId) {
    if (!instructionId) throw new Error('Settlement instruction id is required.');
    if (!this.settlementInstructionIds.includes(instructionId)) {
      this.settlementInstructionIds.push(instructionId);
      this.touch();
    }
  }
}

export class SettlementInstruction extends DomainEntity {
  constructor({
    id,
    participantId,
    positionId,
    positionVersion,
    projectId,
    assetId,
    action,
    availableAmount = 0,
    currency = null,
    nonCashState = null,
    settlementMedium = null,
    destinationPlatform = null,
    destinationReference = null,
    authorizationReference,
    restrictions = [],
    conditions = [],
    state = 'DRAFT',
    evidenceIds = [],
    reconciliationEventId = null,
    ...base
  }) {
    if (!SETTLEMENT_ACTIONS.includes(action)) {
      throw new Error(`Unsupported settlement action: ${action}`);
    }
    super({ id, status: state, ownerId: participantId, ...base });
    this.participantId = participantId;
    this.positionId = positionId;
    this.positionVersion = positionVersion;
    this.projectId = projectId;
    this.assetId = assetId;
    this.action = action;
    this.availableAmount = availableAmount;
    this.currency = currency;
    this.nonCashState = nonCashState;
    this.settlementMedium = settlementMedium;
    this.destinationPlatform = destinationPlatform;
    this.destinationReference = destinationReference;
    this.authorizationReference = authorizationReference;
    this.restrictions = restrictions;
    this.conditions = conditions;
    this.state = state;
    this.evidenceIds = evidenceIds;
    this.reconciliationEventId = reconciliationEventId;
    this.history = [];
  }

  transition(nextState, note = null, evidenceIds = []) {
    const event = {
      from: this.state,
      to: nextState,
      note,
      evidenceIds: [...evidenceIds],
      at: new Date().toISOString(),
    };
    this.history.push(event);
    this.evidenceIds.push(...evidenceIds.filter((id) => !this.evidenceIds.includes(id)));
    this.state = nextState;
    this.status = nextState;
    this.touch();
    return event;
  }

  reconcile(reconciliationEventId, evidenceIds = []) {
    if (!reconciliationEventId) throw new Error('Reconciliation event id is required.');
    this.reconciliationEventId = reconciliationEventId;
    return this.transition('RECONCILED', 'Settlement instruction reconciled.', evidenceIds);
  }
}

export class Completion extends DomainEntity {
  constructor({ id, projectId, gap = 0, coverage = 0, health = 0, projectedGain = 0, platformReturn = 0, participantId = null, result = null, state = 'MONITORING', ...base }) {
    super({ id, status: state, ...base }); this.projectId = projectId; this.gap = gap; this.coverage = coverage;
    this.health = health; this.projectedGain = projectedGain; this.platformReturn = platformReturn;
    this.participantId = participantId; this.result = result; this.state = state;
  }
}

export class CustodyRecord extends DomainEntity {
  constructor({ id, filingNumber, assetId, evidencePackageId = null, documentIds = [], custodyType = 'DIGITAL', custodyStatus = 'HELD', storageLocation = null, accessClass = 'RESTRICTED', collateralState = 'NOT_DESIGNATED', collateralScheduleId = null, chainOfCustody = [], ...base }) {
    super({ id, status: custodyStatus, ...base }); this.filingNumber = filingNumber; this.assetId = assetId;
    this.evidencePackageId = evidencePackageId; this.documentIds = documentIds; this.custodyType = custodyType;
    this.custodyStatus = custodyStatus; this.storageLocation = storageLocation; this.accessClass = accessClass;
    this.collateralState = collateralState; this.collateralScheduleId = collateralScheduleId; this.chainOfCustody = chainOfCustody;
  }
  recordEvent(action, actorId, details = {}) { const event = { position: this.chainOfCustody.length + 1, action, actorId, at: new Date().toISOString(), details }; this.chainOfCustody.push(event); this.touch(); return event; }
}

export class DischargeRecord extends DomainEntity {
  constructor({ id, filingNumber, assetId, projectId = null, instrumentIds = [], positionType, openingAmount = 0, method = 'SETTLEMENT', valueApplied = 0, setoffApplied = 0, releasedAmount = 0, remainingAmount = 0, settlementRecordIds = [], verifiedValuePackageIds = [], state = 'DRAFT', ...base }) {
    super({ id, status: state, ...base }); this.filingNumber = filingNumber; this.assetId = assetId;
    this.projectId = projectId; this.instrumentIds = instrumentIds; this.positionType = positionType;
    this.openingAmount = openingAmount; this.method = method; this.valueApplied = valueApplied;
    this.setoffApplied = setoffApplied; this.releasedAmount = releasedAmount; this.remainingAmount = remainingAmount;
    this.dischargedAmount = Math.max(0, openingAmount - remainingAmount); this.settlementRecordIds = settlementRecordIds;
    this.verifiedValuePackageIds = verifiedValuePackageIds; this.state = state; this.postedAt = null;
  }
  post() { this.state = 'DISCHARGED'; this.status = 'DISCHARGED'; this.postedAt = new Date().toISOString(); this.touch(); }
}
