import { AchSettlementPacketService } from './ach-settlement-packet-service.js';
import { TransactionParticipationGatewayService } from './transaction-participation-gateway-service.js';

function now() {
  return new Date().toISOString();
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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

  registerDefaultExecutors() {
    this.register('INCLUDE_DOCUMENT', async ({ step, exportPackageId }) => {
      const documentType = String(step.documentType || '').toUpperCase();
      if (!documentType) throw new Error('INCLUDE_DOCUMENT requires documentType.');

      if (documentType === 'FUNDING_SETTLEMENT') {
        const bytes = await this.packetService.renderFundingPackage(exportPackageId);
        const pkg = this.domain.get('EXPORT_PACKAGE', exportPackageId);
        const participation = await this.participationGateway.createWindow(exportPackageId, {
          recipientName: pkg?.beneficiaryName || null,
          createdBy: 'SRA-EXPORT-AGENT',
        });
        return {
          status: 'COMPLETED',
          externalReference: `funding-package:${exportPackageId}`,
          data: {
            documentType,
            exportPackageId,
            byteLength: bytes.length,
            generated: true,
            participationWindow: participation.window,
            participationAccessCode: participation.accessCode,
            participationAccessCodeIssued: Boolean(participation.accessCode),
          },
        };
      }
      if (documentType === 'DEALER_PROCESSING_INSTRUCTIONS') {
        const bytes = await this.packetService.renderDealerProcessingInstructions(exportPackageId);
        return {
          status: 'COMPLETED',
          externalReference: `dealer-processing-instructions:${exportPackageId}`,
          data: { documentType, exportPackageId, byteLength: bytes.length, generated: true },
        };
      }
      if (documentType === 'SERVICING_PAYMENT_INSTRUCTIONS') {
        const bytes = await this.packetService.renderServicingInstructions(exportPackageId);
        return {
          status: 'COMPLETED',
          externalReference: `servicing-payment-instructions:${exportPackageId}`,
          data: { documentType, exportPackageId, byteLength: bytes.length, generated: true },
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

  async persistResult(record) {
    const existing = this.existingResult(record.planId, record.planStepId);
    if (existing && sameJson(existing, record)) return existing;
    return await this.persist('ACTION_RESULT', record.resultId, record);
  }

  async executeStep({ plan, decision, step, exportPackageId, agentId }) {
    const classification = this.classifyStep(step);
    const resultId = this.resultId(plan.planId, step.id);
    const existing = this.existingResult(plan.planId, step.id);

    if (existing && ['COMPLETED', 'COMPLETED_POLICY', 'AWAITING_AUTHORITY'].includes(existing.status)) {
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

    return {
      planId: plan.planId,
      transactionId: plan.transactionId || null,
      agentId,
      status: failed.length
        ? 'FAILED'
        : awaitingAuthority.length
          ? 'AWAITING_AUTHORITY'
          : 'COMPLETED',
      completedCount: completed.length,
      awaitingAuthorityCount: awaitingAuthority.length,
      failedCount: failed.length,
      results,
    };
  }
}
