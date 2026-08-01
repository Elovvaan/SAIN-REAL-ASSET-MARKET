import crypto from 'node:crypto';

const CONTRIBUTION_MEDIA = [
  'USD',
  'BANK_TRANSFER',
  'STABLE_DIGITAL_ASSET',
  'CRYPTOCURRENCY',
  'VERIFIED_ASSET',
  'TRUE_BILL',
  'SERVICE',
  'EQUIPMENT',
  'MATERIAL',
  'CONTRACT_RIGHT',
  'PAYMENT_RIGHT',
  'FUTURE_PRODUCTION',
  'COMPLETION_CAPACITY',
  'SRA_POSITION'
];

const POSITION_STATES = ['DRAFT','PROPOSED','VERIFIED','ASSIGNED','DEPLOYED','RECONCILING','SETTLED','DISCHARGED','CLOSED'];

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

export class CreativeFinanceService {
  constructor(marketplace) {
    this.marketplace = marketplace;
    this.positions = new Map();
    this.structures = new Map();
    this.seed();
  }

  seed() {
    const seedPosition = {
      positionId: 'TP-0014-A',
      projectId: 'SRA-RE-0014',
      sourceType: 'PAYMENT_RIGHT',
      holderId: 'PARTICIPANT-SEED',
      previousHolderId: null,
      statedValue: 45000,
      verifiedValue: 45000,
      retainedValue: 0,
      transferableValue: 45000,
      assignedValue: 0,
      state: 'VERIFIED',
      custodyReference: 'CUSTODY-SEED-0014',
      settlementRouting: 'PROJECT_SETTLEMENT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.positions.set(seedPosition.positionId, seedPosition);
  }

  listContributionMedia() {
    return CONTRIBUTION_MEDIA;
  }

  listPositions(projectId = '') {
    return [...this.positions.values()].filter((position) => !projectId || position.projectId === projectId);
  }

  createPosition(input = {}, actor = {}) {
    const sourceType = clean(input.sourceType, 64).toUpperCase();
    if (!CONTRIBUTION_MEDIA.includes(sourceType)) throw new Error('Unsupported contribution medium.');
    const projectId = clean(input.projectId, 80);
    if (!this.marketplace.projects.some((project) => project.id === projectId)) throw new Error('Project not found.');
    const statedValue = money(input.statedValue);
    if (!statedValue) throw new Error('A positive stated value is required.');
    const now = new Date().toISOString();
    const position = {
      positionId: makeId('TP'),
      projectId,
      sourceType,
      holderId: clean(actor.userId || input.holderId, 120) || 'UNASSIGNED_HOLDER',
      previousHolderId: null,
      statedValue,
      verifiedValue: money(input.verifiedValue),
      retainedValue: 0,
      transferableValue: money(input.verifiedValue) || statedValue,
      assignedValue: 0,
      state: input.verifiedValue ? 'VERIFIED' : 'PROPOSED',
      custodyReference: clean(input.custodyReference, 120) || null,
      settlementRouting: clean(input.settlementRouting, 120) || 'PROJECT_SETTLEMENT',
      termsReference: clean(input.termsReference, 120) || null,
      createdAt: now,
      updatedAt: now
    };
    this.positions.set(position.positionId, position);
    return position;
  }

  assignPosition(positionId, input = {}, actor = {}) {
    const position = this.positions.get(positionId);
    if (!position) throw new Error('Transferable position not found.');
    const amount = money(input.amount);
    if (!amount || amount > position.transferableValue) throw new Error('Assignment amount exceeds the transferable position.');
    const assigneeId = clean(input.assigneeId, 120);
    if (!assigneeId) throw new Error('An assignee is required.');
    const now = new Date().toISOString();
    const child = {
      ...position,
      positionId: makeId('TP'),
      holderId: assigneeId,
      previousHolderId: position.holderId,
      statedValue: amount,
      verifiedValue: Math.min(position.verifiedValue || amount, amount),
      retainedValue: 0,
      transferableValue: amount,
      assignedValue: 0,
      state: 'ASSIGNED',
      custodyReference: clean(input.custodyReference, 120) || position.custodyReference,
      settlementRouting: clean(input.settlementRouting, 120) || position.settlementRouting,
      assignmentReference: clean(input.assignmentReference, 120) || makeId('ASSIGN'),
      assignedBy: clean(actor.userId, 120) || position.holderId,
      createdAt: now,
      updatedAt: now
    };
    position.assignedValue = money(position.assignedValue + amount);
    position.retainedValue = money(position.transferableValue - amount);
    position.transferableValue = position.retainedValue;
    position.updatedAt = now;
    if (!position.transferableValue) position.state = 'ASSIGNED';
    this.positions.set(child.positionId, child);
    return { sourcePosition: position, assignedPosition: child };
  }

  buildStructure(input = {}, actor = {}) {
    const project = this.marketplace.projects.find((item) => item.id === clean(input.projectId, 80));
    if (!project) throw new Error('Project not found.');
    const target = money(input.target || project.fundingTarget);
    const projectNeed = money(input.projectNeed || target);
    const selectedIds = Array.isArray(input.positionIds) ? input.positionIds.slice(0, 20) : [];
    const selectedPositions = selectedIds.map((id) => this.positions.get(id)).filter(Boolean);
    const externalContributions = Array.isArray(input.contributions) ? input.contributions.slice(0, 20).map((item) => ({
      medium: clean(item.medium, 64).toUpperCase(),
      amount: money(item.amount),
      reference: clean(item.reference, 120) || null
    })).filter((item) => CONTRIBUTION_MEDIA.includes(item.medium) && item.amount > 0) : [];
    const positionValue = selectedPositions.reduce((total, position) => total + money(position.transferableValue), 0);
    const contributionValue = externalContributions.reduce((total, item) => total + item.amount, 0);
    const availableValue = money(positionValue + contributionValue);
    const gap = money(Math.max(projectNeed - availableValue, 0));
    const now = new Date().toISOString();
    const structure = {
      structureId: makeId('CF'),
      projectId: project.id,
      createdBy: clean(actor.userId, 120) || 'SANE',
      projectNeed,
      availableValue,
      remainingGap: gap,
      selectedPositions: selectedPositions.map((position) => ({
        positionId: position.positionId,
        sourceType: position.sourceType,
        amount: position.transferableValue,
        holderId: position.holderId
      })),
      contributions: externalContributions,
      executionState: gap === 0 ? 'READY_FOR_REVIEW' : 'GAP_REMAINS',
      sequence: [
        'VERIFY_INPUT_POSITIONS',
        'CONFIRM_TRANSFERABILITY',
        'ASSEMBLE_CONTRIBUTIONS',
        'AUTHORIZE_EXECUTION',
        'DEPLOY_TO_PROJECT',
        'RECONCILE_OPENING_AND_MOVEMENTS',
        'SETTLE',
        'DISCHARGE_WHERE_APPLICABLE'
      ],
      reconciliation: {
        openingNeed: projectNeed,
        transfers: positionValue,
        contributions: contributionValue,
        credits: 0,
        setoff: 0,
        settled: 0,
        remaining: gap
      },
      createdAt: now,
      updatedAt: now
    };
    this.structures.set(structure.structureId, structure);
    return structure;
  }

  reconcile(structureId, input = {}) {
    const structure = this.structures.get(structureId);
    if (!structure) throw new Error('Creative finance structure not found.');
    const credits = money(input.credits);
    const setoff = money(input.setoff);
    const settled = money(input.settled);
    const totalApplied = money(structure.reconciliation.transfers + structure.reconciliation.contributions + credits + setoff + settled);
    const remaining = money(Math.max(structure.reconciliation.openingNeed - totalApplied, 0));
    structure.reconciliation = {
      ...structure.reconciliation,
      credits,
      setoff,
      settled,
      remaining
    };
    structure.executionState = remaining === 0 ? 'RECONCILED' : 'RECONCILIATION_OPEN';
    structure.updatedAt = new Date().toISOString();
    return structure;
  }

  settle(structureId) {
    const structure = this.structures.get(structureId);
    if (!structure) throw new Error('Creative finance structure not found.');
    if (structure.reconciliation.remaining > 0) throw new Error('Structure must reconcile before settlement.');
    structure.executionState = 'SETTLED';
    structure.settledAt = new Date().toISOString();
    structure.updatedAt = structure.settledAt;
    return structure;
  }

  discharge(structureId, input = {}) {
    const structure = this.structures.get(structureId);
    if (!structure) throw new Error('Creative finance structure not found.');
    if (structure.executionState !== 'SETTLED') throw new Error('Settlement must be recorded before discharge.');
    structure.executionState = 'DISCHARGED';
    structure.dischargeRecord = {
      dischargeId: makeId('DR'),
      method: clean(input.method, 80) || 'SETTLEMENT_AND_RECONCILIATION',
      filingReference: clean(input.filingReference, 120) || null,
      remainingBalance: structure.reconciliation.remaining,
      recordedAt: new Date().toISOString()
    };
    structure.updatedAt = structure.dischargeRecord.recordedAt;
    return structure;
  }
}

export { CONTRIBUTION_MEDIA, POSITION_STATES };
