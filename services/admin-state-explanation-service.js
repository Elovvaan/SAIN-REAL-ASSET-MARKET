import { scanProductLifecycleProgress } from './product-lifecycle-progress-service.js';

const TYPES = Object.freeze({
  PRODUCT_DEFINITION: 'SRA_PRODUCT_DEFINITION',
  INSTRUMENT: 'SRA_INSTRUMENT',
  LISTING: 'MARKETPLACE_LISTING',
  PARTICIPATION: 'PARTICIPATION_POSITION',
  COMMITMENT: 'FUNDING_MARKETPLACE_COMMITMENT',
  ALLOCATION: 'FUNDING_MARKETPLACE_POSITION',
  SETTLEMENT: 'SRA_SETTLEMENT_RECORD',
  OWNERSHIP: 'OWNERSHIP_RECOGNITION',
  EXPORT: 'EXPORT_PACKAGE',
});

const STAGE_LABELS = Object.freeze({
  instrument: 'instrument issuance',
  listing: 'marketplace listing',
  participation: 'participation',
  commitment: 'commitment',
  allocation: 'allocation',
  settlement: 'settlement',
  ownershipRecognition: 'ownership recognition',
  exportPackage: 'ready-for-export package',
});

const PROTECTED_STAGES = new Set([
  'instrument', 'listing', 'allocation', 'settlement', 'ownershipRecognition', 'exportPackage',
]);

function value(record, fields = []) {
  for (const field of fields) if (record?.[field] != null && record[field] !== '') return record[field];
  return null;
}

function instrumentReference(question) {
  const explicit = question.match(/(?:instrument id|instrument|asset id|asset)\s*:\s*([^\s,]+)/i)?.[1];
  if (explicit) return explicit;
  return question.match(/\bINS-[A-Z0-9-]+\b/i)?.[0] || '';
}

function approvalReference(question) {
  const explicit = question.match(/(?:approval id|approval request id|approval)\s*:\s*([^\s,]+)/i)?.[1];
  if (explicit) return explicit;
  return question.match(/\bAPR-[A-Z0-9-]+\b/i)?.[0] || '';
}

function inferQuestion(question) {
  const normalized = String(question || '').toLowerCase();
  if (/what would happen.*if i approved|simulate.*approval|approval impact/.test(normalized)) return 'APPROVAL_IMPACT';
  if (/what approval.*waiting on me|pending approvals?|approval queue|what needs my approval/.test(normalized)) return 'PENDING_APPROVALS';
  if (/(lifecycle|life cycle|history|timeline)/.test(normalized) && /(asset|instrument|ins-)/.test(normalized)) return 'ASSET_LIFECYCLE';
  if (/(relationships?|connected|linked|associations?)/.test(normalized) && /(asset|instrument|ins-|this)/.test(normalized)) return 'ASSET_RELATIONSHIPS';
  if (/why.*(asset|instrument|this).*(exportable|export|transferable|transfer)|exportability|export readiness/.test(normalized)) return 'ASSET_EXPORTABILITY';
  return 'NONE';
}

function allProductCodes(domain) {
  const configured = domain.list(TYPES.PRODUCT_DEFINITION)
    .filter((record) => String(record?.state || '').toUpperCase() === 'ACTIVE')
    .map((record) => String(record?.productCode || '').trim().toUpperCase())
    .filter(Boolean);
  const families = domain.list(TYPES.INSTRUMENT)
    .map((record) => String(record?.instrumentFamily || record?.instrumentType || '').trim().toUpperCase())
    .filter(Boolean);
  return [...new Set([...configured, ...families])];
}

function chainForInstrument(domain, reference) {
  const normalized = String(reference || '').trim().toUpperCase();
  if (!normalized) throw new Error('SRA_ADMIN_ASSET_REFERENCE_REQUIRED');
  for (const productCode of allProductCodes(domain)) {
    const progress = scanProductLifecycleProgress(domain, productCode);
    const chain = progress.chains.find((item) => String(item.instrumentId || '').toUpperCase() === normalized);
    if (chain) return { progress, chain };
  }
  throw new Error('SRA_ADMIN_ASSET_NOT_FOUND');
}

function stageRecord(domain, stage, id) {
  if (!id) return null;
  const type = {
    instrument: TYPES.INSTRUMENT,
    listing: TYPES.LISTING,
    participation: TYPES.PARTICIPATION,
    commitment: TYPES.COMMITMENT,
    allocation: TYPES.ALLOCATION,
    settlement: TYPES.SETTLEMENT,
    ownershipRecognition: TYPES.OWNERSHIP,
    exportPackage: TYPES.EXPORT,
  }[stage];
  return type ? domain.list(type).find((record) => String(value(record, [
    'instrumentId', 'listingId', 'positionId', 'commitmentId', 'allocationPositionId',
    'settlementRecordId', 'settlementId', 'ownershipRecognitionId', 'exportPackageId', 'id',
  ])) === String(id)) || null : null;
}

function lifecycleRows(domain, chain) {
  return Object.entries(chain.stages).map(([stage, summary], index) => ({
    sequence: index + 1,
    stage,
    label: STAGE_LABELS[stage] || stage,
    state: summary?.state || 'NOT_RECORDED',
    recordId: summary?.id || null,
    record: summary?.id ? stageRecord(domain, stage, summary.id) : null,
  }));
}

function relationshipRows(domain, chain) {
  const rows = [];
  const instrument = stageRecord(domain, 'instrument', chain.stages.instrument?.id);
  if (instrument) {
    for (const [field, relationship, targetKind] of [
      ['financialRecordId', 'RECOGNIZED_FROM', 'FINANCIAL_RECORD'],
      ['recognitionAssessmentId', 'SUPPORTED_BY', 'RECOGNITION_ASSESSMENT'],
      ['coinPositionId', 'VALUE_POSITION', 'COIN_POSITION'],
      ['issuerId', 'ISSUED_BY', 'PARTICIPANT'],
      ['ownerId', 'OWNED_BY', 'PARTICIPANT'],
      ['accountId', 'HELD_IN', 'SRA_ACCOUNT'],
    ]) {
      if (instrument[field]) rows.push({ relationship, targetKind, targetReference: instrument[field], source: TYPES.INSTRUMENT });
    }
  }
  for (const [stage, summary] of Object.entries(chain.stages)) {
    if (!summary?.id || stage === 'instrument') continue;
    rows.push({
      relationship: `HAS_${stage.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
      targetKind: stage.toUpperCase(),
      targetReference: summary.id,
      status: summary.state || null,
      source: {
        listing: TYPES.LISTING,
        participation: TYPES.PARTICIPATION,
        commitment: TYPES.COMMITMENT,
        allocation: TYPES.ALLOCATION,
        settlement: TYPES.SETTLEMENT,
        ownershipRecognition: TYPES.OWNERSHIP,
        exportPackage: TYPES.EXPORT,
      }[stage],
    });
  }
  return rows;
}

function blockersFor(chain) {
  if (chain.readyForExport) return [];
  const blockers = [];
  for (const [stage, summary] of Object.entries(chain.stages)) {
    if (!summary) {
      blockers.push({
        code: `MISSING_${stage.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
        message: `${STAGE_LABELS[stage] || stage} has not been recorded.`,
        source: 'SRA lifecycle chain',
      });
      break;
    }
  }
  if (chain.firstMissing && PROTECTED_STAGES.has(chain.firstMissing)) {
    blockers.push({
      code: 'ADMIN_APPROVAL_REQUIRED',
      message: `${STAGE_LABELS[chain.firstMissing] || chain.firstMissing} is a protected state change requiring explicit administrator approval.`,
      source: 'SRA human-in-the-loop authority boundary',
    });
  }
  return blockers;
}

function pendingApprovals(domain) {
  const pending = [];
  for (const productCode of allProductCodes(domain)) {
    const progress = scanProductLifecycleProgress(domain, productCode);
    for (const chain of progress.chains) {
      if (!chain.firstMissing || !PROTECTED_STAGES.has(chain.firstMissing)) continue;
      pending.push({
        approvalId: `APR-${chain.instrumentId}-${chain.firstMissing}`.toUpperCase(),
        productCode,
        instrumentId: chain.instrumentId,
        stage: chain.firstMissing,
        label: `Approve ${STAGE_LABELS[chain.firstMissing] || chain.firstMissing}`,
        requiredAuthority: 'PLATFORM_ADMIN',
        status: 'PENDING',
      });
    }
  }
  return pending;
}

function explanationBase(kind, subject, summary, status) {
  return {
    intent: kind,
    questionKind: kind,
    subject,
    answer: summary,
    summary,
    status,
    facts: [],
    blockers: [],
    lifecycle: [],
    relationships: [],
    pendingActions: [],
    simulation: null,
    references: [],
  };
}

export function explainSraAdministrativeState(domain, question) {
  const kind = inferQuestion(question);
  if (kind === 'NONE') return null;

  if (kind === 'PENDING_APPROVALS') {
    const pending = pendingApprovals(domain);
    return {
      ...explanationBase(kind, { kind: 'APPROVAL_QUEUE', reference: 'SRA_ADMIN_APPROVAL_QUEUE' },
        pending.length ? `SRA identified ${pending.length} protected lifecycle action${pending.length === 1 ? '' : 's'} waiting at an administrator approval boundary.` : 'SRA did not identify a currently reachable protected lifecycle action waiting for administrator approval.',
        pending.length ? 'APPROVAL_REQUIRED' : 'NO_PENDING_APPROVAL'),
      pendingActions: pending,
      references: pending.map((item) => ({ stage: item.stage, recordId: item.instrumentId, state: item.status })),
    };
  }

  if (kind === 'APPROVAL_IMPACT') {
    const reference = approvalReference(question);
    const pending = pendingApprovals(domain);
    const approval = reference
      ? pending.find((item) => item.approvalId.toUpperCase() === reference.toUpperCase())
      : pending.length === 1 ? pending[0] : null;
    if (!approval) throw new Error(reference ? 'SRA_ADMIN_APPROVAL_NOT_FOUND' : 'SRA_ADMIN_APPROVAL_REFERENCE_REQUIRED');
    const { chain } = chainForInstrument(domain, approval.instrumentId);
    return {
      ...explanationBase(kind, { kind: 'APPROVAL', reference: approval.approvalId, title: approval.label },
        `Approving ${approval.approvalId} would authorize preparation of the ${STAGE_LABELS[approval.stage] || approval.stage} step for ${approval.instrumentId}. It would not itself create the downstream record, move value, settle, recognize ownership, or export the instrument.`,
        'READ_ONLY_SIMULATION'),
      pendingActions: [approval],
      lifecycle: lifecycleRows(domain, chain),
      simulation: {
        readOnly: true,
        approvalId: approval.approvalId,
        currentState: 'PENDING',
        proposedDecision: 'APPROVED',
        predictedChanges: [
          { record: 'SRA approval boundary', field: 'approvalStatus', from: 'PENDING', to: 'APPROVED', basis: 'Explicit administrator decision' },
          { record: approval.instrumentId, field: 'authorizedNextStage', from: null, to: approval.stage, basis: 'Protected lifecycle stage becomes authorized for a separate governed operation' },
        ],
        unchangedUntilSeparateExecution: [
          'Instrument record', 'Marketplace listing', 'Participation position', 'Commitment',
          'Allocation position', 'Settlement record', 'Ownership recognition', 'Export package',
        ],
        limitations: ['This response performs no approval and no write operation.', 'A separate governed command must create the authorized lifecycle record.'],
      },
      references: [{ stage: approval.stage, recordId: approval.instrumentId, state: 'PENDING' }],
    };
  }

  const reference = instrumentReference(question);
  const { progress, chain } = chainForInstrument(domain, reference);
  const lifecycle = lifecycleRows(domain, chain);
  const relationships = relationshipRows(domain, chain);
  const blockers = blockersFor(chain);
  const subject = { kind: 'ASSET', reference: chain.instrumentId, title: `${progress.productCode} instrument` };

  if (kind === 'ASSET_LIFECYCLE') {
    return {
      ...explanationBase(kind, subject,
        `${chain.instrumentId} has completed ${chain.completedStages.length} of ${Object.keys(chain.stages).length} SRA lifecycle stages. ${chain.firstMissing ? `The first missing stage is ${STAGE_LABELS[chain.firstMissing] || chain.firstMissing}.` : 'The complete internal lifecycle is recorded.'}`,
        chain.readyForExport ? 'READY_FOR_EXPORT' : 'IN_PROGRESS'),
      lifecycle,
      blockers,
      references: lifecycle.filter((item) => item.recordId).map((item) => ({ stage: item.stage, recordId: item.recordId, state: item.state })),
    };
  }

  if (kind === 'ASSET_RELATIONSHIPS') {
    return {
      ...explanationBase(kind, subject,
        `SRA found ${relationships.length} recorded relationship${relationships.length === 1 ? '' : 's'} connected to ${chain.instrumentId}.`,
        'AVAILABLE'),
      relationships,
      lifecycle,
      references: relationships.map((item) => ({ stage: item.relationship, recordId: item.targetReference, state: item.status || null })),
    };
  }

  return {
    ...explanationBase(kind, subject,
      chain.readyForExport
        ? `${chain.instrumentId} is internally ready for export because every required SRA lifecycle stage, including ownership recognition and an export package, is recorded.`
        : `${chain.instrumentId} is not exportable because ${blockers.map((item) => item.message).join(' ')}`,
      chain.readyForExport ? 'READY_FOR_EXPORT' : 'BLOCKED'),
    facts: [
      { label: 'Product', value: progress.productCode, source: 'SRA product lifecycle scanner' },
      { label: 'Completed stages', value: chain.completedStages, source: 'SRA lifecycle records' },
      { label: 'First missing stage', value: chain.firstMissing, source: 'SRA lifecycle records' },
      { label: 'Export package recorded', value: Boolean(chain.stages.exportPackage), source: TYPES.EXPORT },
    ],
    blockers,
    lifecycle,
    relationships,
    references: lifecycle.filter((item) => item.recordId).map((item) => ({ stage: item.stage, recordId: item.recordId, state: item.state })),
  };
}
