import crypto from 'node:crypto';
import { AchSettlementPacketService } from './ach-settlement-packet-service.js';
import { TransactionParticipationGatewayService } from './transaction-participation-gateway-service.js';

function now() {
  return new Date().toISOString();
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

const PREPARATION_ACTIONS = new Set([
  'INCLUDE_DOCUMENT',
  'INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS',
  'FLAG_DO_NOT_INFER',
  'LEAVE_BLANK_AND_FLAG',
]);

const PROTECTED_ACTIONS = new Set([
  'APPROVE_FINANCING',
  'DECLINE_FINANCING',
  'CHANGE_APPROVED_TERMS',
  'AUTHORIZE_SETTLEMENT',
  'EXECUTE_SETTLEMENT',
  'AUTHORIZE_EXTERNAL_EXECUTION',
  'EXECUTE_EXTERNAL_TRANSFER',
  'ISSUE_INSTRUMENT',
  'TRANSFER_OWNERSHIP',
]);

export class GovernedActionExecutionService {
  constructor(domain, options = {}) {
    if (!domain) throw new Error('Governed action execution requires the SRA domain store.');
    this.domain = domain;
    this.packetService = options.packetService || new AchSettlementPacketService(domain);
    this.participationGateway = options.participationGateway || new TransactionParticipationGatewayService(domain);
    this.executors = new Map();
    this.registerDefaultExecutors();
  }

  records(type) {
    return typeof this.domain.list === 'function' ? this.domain.list(type) : [];
  }

  async persist(type, id, record) {
    if (typeof this.domain.put === 'function') return await this.domain.put(type, id, record);
    if (typeof this.domain.create === 'function') return await this.domain.create(type, record);
    if (typeof this.domain.set === 'function') return await this.domain.set(type, id, record);
    throw new Error('SRA domain store does not expose a supported persistence method.');
  }

  register(action, executor) {
    if (!action || typeof executor !== 'function') throw new Error('action and executor are required.');
    this.executors.set(String(action).toUpperCase(), executor);
    return this;
  }

  async persistGeneratedDocument({ bytes, documentType, exportPackageId, agentId }) {
    const documents = this.packetService?.documents;
    if (!documents || typeof documents.store !== 'function') {
      throw new Error('Generated document persistence is not available.');
    }
    const pkg = this.domain.get('EXPORT_PACKAGE', exportPackageId);
    const filenameByType = {
      FUNDING_SETTLEMENT: `SRA-Funding-Package-${exportPackageId}.pdf`,
      DEALER_PROCESSING_INSTRUCTIONS: `SRA-Dealer-Processing-Instructions-${exportPackageId}.pdf`,
      SERVICING_PAYMENT_INSTRUCTIONS: `SRA-Servicing-Payment-Instructions-${exportPackageId}.pdf`,
    };
    const stored = await documents.store({
      file: {
        buffer: bytes,
        size: bytes.length,
        mimetype: 'application/pdf',
        originalname: filenameByType[documentType] || `SRA-${documentType}-${exportPackageId}.pdf`,
      },
      documentType: `GENERATED_${documentType}`,
      uploaderId: agentId || 'SRA-EXPORT-AGENT',
      retentionPolicy: 'FINANCING_TRANSACTION_RECORD',
      retentionReferenceId: pkg?.opportunityId || exportPackageId,
    });
    if (!stored?.ok || !stored.document?.id) {
      throw new Error(stored?.error || 'Generated document could not be persisted.');
    }
    return stored.document;
  }

  registerDefaultExecutors() {
    this.register('INCLUDE_DOCUMENT', async ({ step, exportPackageId, agentId }) => {
      const documentType = String(step.documentType || '').toUpperCase();
      if (!documentType) throw new Error('INCLUDE_DOCUMENT requires documentType.');

      if (documentType === 'FUNDING_SETTLEMENT') {
        const bytes = await this.packetService.renderFundingPackage(exportPackageId);
        const document = await this.persistGeneratedDocument({ bytes, documentType, exportPackageId, agentId });
        const pkg = this.domain.get('EXPORT_PACKAGE', exportPackageId);
        const participation = await this.participationGateway.createWindow(exportPackageId, {
          recipientName: pkg?.beneficiaryName || null,
          createdBy: agentId || 'SRA-EXPORT-AGENT',
        });
        return {
          status: 'COMPLETED',
          externalReference: document.id,
          data: {
            documentType,
            exportPackageId,
            documentId: document.id,
            documentSha256: document.sha256 || null,
            byteLength: bytes.length,
            generated: true,
            retrievable: true,
            participationWindow: participation.window,
            participationAccessCode: participation.accessCode,
            participationAccessCodeIssued: Boolean(participation.accessCode),
          },
        };
      }
      if (documentType === 'DEALER_PROCESSING_INSTRUCTIONS') {
        const bytes = await this.packetService.renderDealerProcessingInstructions(exportPackageId);
        const document = await this.persistGeneratedDocument({ bytes, documentType, exportPackageId, agentId });
        return {
          status: 'COMPLETED',
          externalReference: document.id,
          data: {
            documentType,
            exportPackageId,
            documentId: document.id,
            documentSha256: document.sha256 || null,
            byteLength: bytes.length,
            generated: true,
            retrievable: true,
          },
        };
      }
      if (documentType === 'SERVICING_PAYMENT_INSTRUCTIONS') {
        const bytes = await this.packetService.renderServicingInstructions(exportPackageId);
        const document = await this.persistGeneratedDocument({ bytes, documentType, exportPackageId, agentId });
        return {
          status: 'COMPLETED',
          externalReference: document.id,
          data: {
            documentType,
            exportPackageId,
            documentId: document.id,
            documentSha256: document.sha256 || null,
            byteLength: bytes.length,
            generated: true,
            retrievable: true,
          },
        };
      }

      throw new Error(`No existing SRA document generator is registered for ${documentType}.`);
    });

    this.register('INCLUDE_RECIPIENT_PROCESSING_INSTRUCTIONS', async ({ step, exportPackageId }) => ({
      status: 'COMPLETED',
      externalReference: `recipient-processing-policy:${exportPackageId}`,
      data: {
        exportPackageId,
        fields: step.fields || [],
        instructionApplied: true,
      },
    }));

    this.register('FLAG_DO_NOT_INFER', async ({ step, exportPackageId }) => ({
      status: 'COMPLETED_POLICY',
      externalReference: `context-flag:${exportPackageId}:${step.id}`,
      data: {
        exportPackageId,
        fields: step.fields || [],
        inferenceBlocked: true,
      },
    }));

    this.register('LEAVE_BLANK_AND_FLAG', async ({ step, exportPackageId }) => ({
      status: 'COMPLETED_POLICY',
      externalReference: `servicing-flag:${exportPackageId}:${step.id}`,
      data: {
        exportPackageId,
        fields: step.fields || [],
        leftBlank: true,
        inferenceBlocked: true,
      },
    }));
  }

  plan(planId) {
    return this.records('ACTION_PLAN').find((record) => record.planId === planId || record.id === planId) || null;
  }

  decision(decisionId) {
    return this.records('AGENT_DECISION').find((record) => record.decisionId === decisionId || record.id === decisionId) || null;
  }

  resultId(planId, stepId) {
    return `AR-${planId}-${stepId}`;
  }

  existingResult(planId, stepId) {
    const resultId = this.resultId(planId, stepId);
    return this.records('ACTION_RESULT').find((record) => record.resultId === resultId || record.id === resultId) || null;
  }

  classifyStep(step = {}) {
    const action = String(step.action || '').toUpperCase();
    if (!action) return { action, executionClass: 'INVALID', authorityRequired: true, reason: 'ACTION_MISSING' };
    if (PROTECTED_ACTIONS.has(action)) {
      return { action, executionClass: 'PROTECTED', authorityRequired: true, reason: 'RESERVED_AUTHORITY' };
    }
    if (PREPARATION_ACTIONS.has(action) || this.executors.has(action)) {
      return { action, executionClass: 'SAFE_PREPARATION', authorityRequired: false, reason: null };
    }
    return { action, executionClass: 'UNMAPPED', authorityRequired: true, reason: 'NO_REGISTERED_EXECUTOR' };
  }

  sourceSnapshot(exportPackageId) {
    const pkg = exportPackageId ? this.domain.get('EXPORT_PACKAGE', exportPackageId) : null;
    const closing = pkg?.closingId ? this.domain.get('FINANCING_CLOSING', pkg.closingId) : null;
    const opportunity = pkg?.opportunityId ? this.domain.get('FUNDING_OPPORTUNITY', pkg.opportunityId) : null;
    return { pkg, closing, opportunity };
  }

  stepFingerprint({ plan, step, exportPackageId, classification = null }) {
    const resolvedClassification = classification || this.classifyStep(step);
    return fingerprint({
      planId: plan?.planId || null,
      sourceDecisionId: plan?.sourceDecisionId || null,
      step,
      classification: resolvedClassification,
      source: this.sourceSnapshot(exportPackageId),
    });
  }

  resultIsCurrent({ plan, step, exportPackageId, result = null }) {
    const existing = result || this.existingResult(plan.planId, step.id);
    if (!existing) return false;
    const classification = this.classifyStep(step);
    const currentFingerprint = this.stepFingerprint({ plan, step, exportPackageId, classification });
    if (existing.data?.inputFingerprint !== currentFingerprint) return false;

    if (['COMPLETED', 'COMPLETED_POLICY'].includes(existing.status)) {
      return classification.authorityRequired === false;
    }
    if (existing.status === 'AWAITING_AUTHORITY') {
      return classification.authorityRequired === true
        && existing.data?.authorityReason === classification.reason
        && existing.data?.executionClass === classification.executionClass;
    }
    return false;
  }

  summarizePlan(plan, exportPackageId) {
    if (!plan) return {
      status: 'READY', expectedCount: 0, resultCount: 0, completedCount: 0,
      awaitingAuthorityCount: 0, failedCount: 0, pendingCount: 0,
    };
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const currentResults = [];
    let pendingCount = 0;
    for (const step of steps) {
      const result = this.existingResult(plan.planId, step.id);
      if (result && this.resultIsCurrent({ plan, step, exportPackageId, result })) currentResults.push(result);
      else if (result?.status === 'FAILED') {
        const classification = this.classifyStep(step);
        const currentFingerprint = this.stepFingerprint({ plan, step, exportPackageId, classification });
        if (result.data?.inputFingerprint === currentFingerprint) currentResults.push(result);
        else pendingCount += 1;
      } else {
        pendingCount += 1;
      }
    }
    const completed = currentResults.filter((record) => ['COMPLETED', 'COMPLETED_POLICY'].includes(record.status));
    const awaiting = currentResults.filter((record) => record.status === 'AWAITING_AUTHORITY');
    const failed = currentResults.filter((record) => record.status === 'FAILED');
    const status = String(plan.status || '').toUpperCase() !== 'READY'
      ? 'BLOCKED_CONTEXT_REQUIRED'
      : failed.length
        ? 'FAILED'
        : awaiting.length
          ? 'AWAITING_AUTHORITY'
          : steps.length > 0 && pendingCount === 0 && completed.length === steps.length
            ? 'COMPLETED'
            : 'READY';
    return {
      status,
      expectedCount: steps.length,
      resultCount: currentResults.length,
      completedCount: completed.length,
      awaitingAuthorityCount: awaiting.length,
      failedCount: failed.length,
      pendingCount,
    };
  }

  async persistResult(record) {
    const existing = this.existingResult(record.planId, record.planStepId);
    if (existing && sameJson(existing, record)) return existing;
    return await this.persist('ACTION_RESULT', record.resultId, record);
  }

  async executeStep({ plan, decision, step, exportPackageId, agentId }) {
    const classification = this.classifyStep(step);
    const resultId = this.resultId(plan.planId, step.id);
    const existing = this.existingResult(plan.planId, step.id);
    const inputFingerprint = this.stepFingerprint({ plan, step, exportPackageId, classification });

    if (existing && this.resultIsCurrent({ plan, step, exportPackageId, result: existing })) {
      return existing;
    }

    if (classification.authorityRequired) {
      return await this.persistResult({
        id: resultId,
        resultId,
        action: classification.action || step.action || 'UNKNOWN_ACTION',
        planId: plan.planId,
        planStepId: step.id,
        agentId,
        transactionId: plan.transactionId || null,
        status: 'AWAITING_AUTHORITY',
        externalReference: null,
        data: {
          executionClass: classification.executionClass,
          authorityRequired: true,
          authorityReason: classification.reason,
          sourceDecisionId: decision?.decisionId || plan.sourceDecisionId || null,
          exportPackageId,
          inputFingerprint,
        },
        error: null,
        completedAt: null,
        updatedAt: now(),
      });
    }

    const executor = this.executors.get(classification.action);
    try {
      const outcome = await executor({ plan, decision, step, exportPackageId, agentId });
      return await this.persistResult({
        id: resultId,
        resultId,
        action: classification.action,
        planId: plan.planId,
        planStepId: step.id,
        agentId,
        transactionId: plan.transactionId || null,
        status: outcome?.status || 'COMPLETED',
        externalReference: outcome?.externalReference || null,
        data: {
          executionClass: classification.executionClass,
          authorityRequired: false,
          sourceDecisionId: decision?.decisionId || plan.sourceDecisionId || null,
          exportPackageId,
          inputFingerprint,
          ...(outcome?.data || {}),
        },
        error: null,
        completedAt: now(),
        updatedAt: now(),
      });
    } catch (error) {
      return await this.persistResult({
        id: resultId,
        resultId,
        action: classification.action,
        planId: plan.planId,
        planStepId: step.id,
        agentId,
        transactionId: plan.transactionId || null,
        status: 'FAILED',
        externalReference: null,
        data: {
          executionClass: classification.executionClass,
          authorityRequired: false,
          sourceDecisionId: decision?.decisionId || plan.sourceDecisionId || null,
          exportPackageId,
          inputFingerprint,
        },
        error: error?.message || String(error),
        completedAt: now(),
        updatedAt: now(),
      });
    }
  }

  async executePlan(planId, options = {}) {
    const plan = this.plan(planId);
    if (!plan) throw new Error('Action plan was not found.');
    if (String(plan.status || '').toUpperCase() !== 'READY') {
      return {
        planId,
        status: 'BLOCKED',
        reason: `Action plan is ${plan.status || 'UNKNOWN'} and is not executable.`,
        results: [],
      };
    }

    const decision = plan.sourceDecisionId ? this.decision(plan.sourceDecisionId) : null;
    const exportPackageId = options.exportPackageId
      || String(plan.planId || '').replace(/^AP-CONTEXT-/, '')
      || null;
    const agentId = options.agentId || plan.createdByAgentId || decision?.agentId || 'SRA-AGENT';

    const results = [];
    for (const step of plan.steps || []) {
      results.push(await this.executeStep({ plan, decision, step, exportPackageId, agentId }));
    }

    const failed = results.filter((result) => result.status === 'FAILED');
    const awaitingAuthority = results.filter((result) => result.status === 'AWAITING_AUTHORITY');
    const completed = results.filter((result) => ['COMPLETED', 'COMPLETED_POLICY'].includes(result.status));
    const expectedCount = Array.isArray(plan.steps) ? plan.steps.length : 0;

    return {
      planId: plan.planId,
      transactionId: plan.transactionId || null,
      agentId,
      status: failed.length
        ? 'FAILED'
        : awaitingAuthority.length
          ? 'AWAITING_AUTHORITY'
          : expectedCount > 0 && completed.length === expectedCount
            ? 'COMPLETED'
            : 'READY',
      expectedCount,
      completedCount: completed.length,
      awaitingAuthorityCount: awaitingAuthority.length,
      failedCount: failed.length,
      pendingCount: Math.max(0, expectedCount - results.length),
      results,
    };
  }
}
