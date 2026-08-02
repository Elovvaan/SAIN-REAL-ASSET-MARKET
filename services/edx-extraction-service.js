import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const REQUEST_STATES = new Set([
  'REQUESTED',
  'APPROVED',
  'QUEUED',
  'EXTRACTING',
  'FILTERING',
  'COMPLETED',
  'REJECTED',
  'AUTHORIZATION_EXPIRED',
  'SOURCE_UNAVAILABLE',
  'VALIDATION_FAILED',
  'CANCELLED'
]);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureRows(value) {
  if (!Array.isArray(value)) throw new Error('sourceRecords must be an array.');
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Each source record must be an object.');
  }
  return value;
}

function redactRow(row, permittedFields, excludedFields) {
  const output = {};
  const sourceFields = Object.keys(row);
  const fields = permittedFields.length ? permittedFields : sourceFields;
  for (const field of fields) {
    if (excludedFields.includes(field)) continue;
    if (Object.prototype.hasOwnProperty.call(row, field)) output[field] = clone(row[field]);
  }
  return output;
}

export class EdxExtractionService {
  constructor(persistentDomain, permissionService) {
    this.domain = persistentDomain;
    this.permissionService = permissionService;
  }

  listRequests(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_EXTRACTION_REQUEST).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.connectionId && record.connectionId !== filters.connectionId) return false;
      if (filters.policyId && record.policyId !== filters.policyId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    });
  }

  getRequest(extractionRequestId) {
    return this.domain.get(RECORD_TYPES.EDX_EXTRACTION_REQUEST, extractionRequestId);
  }

  listResults(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_EXTRACTION_RESULT).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.connectionId && record.connectionId !== filters.connectionId) return false;
      if (filters.policyId && record.policyId !== filters.policyId) return false;
      if (filters.extractionRequestId && record.extractionRequestId !== filters.extractionRequestId) return false;
      return true;
    });
  }

  getResult(extractionResultId) {
    return this.domain.get(RECORD_TYPES.EDX_EXTRACTION_RESULT, extractionResultId);
  }

  async createRequest(input, actorId = null) {
    const policyId = requiredString(input.policyId, 'policyId');
    const policyEvaluation = this.permissionService.evaluatePolicy(policyId, {
      enterpriseId: input.enterpriseId,
      recordCategory: input.recordCategory,
      visibility: input.visibility
    });
    if (!policyEvaluation.allowed) throw new Error(`Extraction is not authorized: ${policyEvaluation.reason}.`);

    const connection = this.domain.get(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, policyEvaluation.connectionId);
    if (!connection) throw new Error('Enterprise connection not found.');

    const extractionRequestId = input.extractionRequestId || id('EDX-ERQ');
    if (this.getRequest(extractionRequestId)) throw new Error('Extraction request already exists.');

    const timestamp = now();
    const request = {
      extractionRequestId,
      enterpriseId: policyEvaluation.enterpriseId,
      connectionId: policyEvaluation.connectionId,
      policyId,
      connectorDefinitionId: connection.connectorDefinitionId,
      sourceSystemIdentifier: connection.sourceSystemIdentifier,
      requestedRecordCategory: policyEvaluation.recordCategory,
      requestedTimeRange: input.requestedTimeRange || null,
      purpose: policyEvaluation.purpose,
      visibility: policyEvaluation.visibility,
      recipientClass: policyEvaluation.recipientClass,
      requestedBy: actorId,
      companyApprovalReference: input.companyApprovalReference || null,
      state: 'REQUESTED',
      sourceRecordCount: 0,
      approvedRecordCount: 0,
      rejectedRecordCount: 0,
      error: null,
      requestedAt: timestamp,
      approvedAt: null,
      queuedAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: timestamp
    };

    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_REQUEST, extractionRequestId, request, {
      actorId,
      eventType: 'EDX_EXTRACTION_REQUESTED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_EXTRACTION_REQUEST,
      objectId: extractionRequestId,
      eventType: 'EDX_EXTRACTION_REQUESTED',
      actorId,
      payload: { policyId, connectionId: request.connectionId, recordCategory: request.requestedRecordCategory }
    });
    return request;
  }

  async transitionRequest(extractionRequestId, targetState, input = {}, actorId = null) {
    const current = this.getRequest(extractionRequestId);
    if (!current) throw new Error('Extraction request not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    if (!REQUEST_STATES.has(state)) throw new Error(`Unsupported extraction request state: ${state}.`);

    const allowed = {
      REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED', 'AUTHORIZATION_EXPIRED'],
      APPROVED: ['QUEUED', 'CANCELLED', 'AUTHORIZATION_EXPIRED'],
      QUEUED: ['EXTRACTING', 'CANCELLED', 'SOURCE_UNAVAILABLE', 'AUTHORIZATION_EXPIRED'],
      EXTRACTING: ['FILTERING', 'SOURCE_UNAVAILABLE', 'VALIDATION_FAILED', 'CANCELLED'],
      FILTERING: ['COMPLETED', 'VALIDATION_FAILED', 'CANCELLED'],
      COMPLETED: [],
      REJECTED: [],
      AUTHORIZATION_EXPIRED: [],
      SOURCE_UNAVAILABLE: [],
      VALIDATION_FAILED: [],
      CANCELLED: []
    };
    if (!allowed[current.state].includes(state)) throw new Error(`Invalid extraction transition: ${current.state} -> ${state}.`);

    if (state === 'APPROVED' && !input.companyApprovalReference && !current.companyApprovalReference) {
      throw new Error('companyApprovalReference is required before approval.');
    }

    const timestamp = now();
    const failed = ['REJECTED', 'AUTHORIZATION_EXPIRED', 'SOURCE_UNAVAILABLE', 'VALIDATION_FAILED', 'CANCELLED'].includes(state);
    const updated = {
      ...current,
      state,
      companyApprovalReference: input.companyApprovalReference || current.companyApprovalReference,
      error: failed ? input.error || input.reason || state : null,
      approvedAt: state === 'APPROVED' ? timestamp : current.approvedAt,
      queuedAt: state === 'QUEUED' ? timestamp : current.queuedAt,
      startedAt: state === 'EXTRACTING' ? timestamp : current.startedAt,
      completedAt: state === 'COMPLETED' ? timestamp : current.completedAt,
      failedAt: failed ? timestamp : current.failedAt,
      updatedAt: timestamp
    };

    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_REQUEST, extractionRequestId, updated, {
      actorId,
      eventType: `EDX_EXTRACTION_${state}`
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_EXTRACTION_REQUEST,
      objectId: extractionRequestId,
      eventType: `EDX_EXTRACTION_${state}`,
      actorId,
      payload: { previousState: current.state, state, error: updated.error }
    });
    return updated;
  }

  async executeRequest(extractionRequestId, input, actorId = null) {
    let request = this.getRequest(extractionRequestId);
    if (!request) throw new Error('Extraction request not found.');
    if (!['APPROVED', 'QUEUED'].includes(request.state)) {
      throw new Error('Extraction request must be approved or queued before execution.');
    }

    const evaluation = this.permissionService.evaluatePolicy(request.policyId, {
      enterpriseId: request.enterpriseId,
      recordCategory: request.requestedRecordCategory,
      visibility: request.visibility
    });
    if (!evaluation.allowed) {
      await this.transitionRequest(extractionRequestId, 'AUTHORIZATION_EXPIRED', { reason: evaluation.reason }, actorId);
      throw new Error(`Extraction authorization is no longer valid: ${evaluation.reason}.`);
    }

    if (request.state === 'APPROVED') request = await this.transitionRequest(extractionRequestId, 'QUEUED', {}, actorId);
    request = await this.transitionRequest(extractionRequestId, 'EXTRACTING', {}, actorId);

    const sourceRecords = ensureRows(input.sourceRecords || []);
    request = {
      ...request,
      sourceRecordCount: sourceRecords.length,
      sourcePayloadReference: input.sourcePayloadReference || null,
      sourceTimestamp: input.sourceTimestamp || null,
      updatedAt: now()
    };
    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_REQUEST, extractionRequestId, request, {
      actorId,
      eventType: 'EDX_EXTRACTION_SOURCE_RECEIVED'
    });

    request = await this.transitionRequest(extractionRequestId, 'FILTERING', {}, actorId);

    const filteredRecords = sourceRecords.map((row, index) => ({
      sourceRowIndex: index,
      fields: redactRow(row, evaluation.permittedFields, evaluation.excludedFields)
    }));
    const approvedRecords = filteredRecords.filter((row) => Object.keys(row.fields).length > 0);
    const rejectedRecordCount = filteredRecords.length - approvedRecords.length;

    const extractionResultId = id('EDX-ERS');
    const result = {
      extractionResultId,
      extractionRequestId,
      enterpriseId: request.enterpriseId,
      connectionId: request.connectionId,
      policyId: request.policyId,
      recordCategory: request.requestedRecordCategory,
      aggregationLevel: evaluation.aggregationLevel,
      purpose: evaluation.purpose,
      visibility: evaluation.visibility,
      recipientClass: evaluation.recipientClass,
      permittedFields: evaluation.permittedFields,
      excludedFields: evaluation.excludedFields,
      sourcePayloadReference: request.sourcePayloadReference,
      sourceTimestamp: request.sourceTimestamp,
      extractedAt: now(),
      sourceRecordCount: sourceRecords.length,
      approvedRecordCount: approvedRecords.length,
      rejectedRecordCount,
      records: approvedRecords,
      state: 'IMMUTABLE_FILTERED_RESULT'
    };

    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_RESULT, extractionResultId, result, {
      actorId,
      eventType: 'EDX_EXTRACTION_RESULT_CREATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_EXTRACTION_RESULT,
      objectId: extractionResultId,
      eventType: 'EDX_EXTRACTION_RESULT_CREATED',
      actorId,
      payload: {
        extractionRequestId,
        sourceRecordCount: result.sourceRecordCount,
        approvedRecordCount: result.approvedRecordCount,
        rejectedRecordCount: result.rejectedRecordCount
      }
    });

    request = {
      ...this.getRequest(extractionRequestId),
      extractionResultId,
      approvedRecordCount: approvedRecords.length,
      rejectedRecordCount,
      updatedAt: now()
    };
    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_REQUEST, extractionRequestId, request, {
      actorId,
      eventType: 'EDX_EXTRACTION_RESULT_LINKED'
    });
    await this.transitionRequest(extractionRequestId, 'COMPLETED', {}, actorId);

    return {
      request: this.getRequest(extractionRequestId),
      result
    };
  }
}

export const EDX_EXTRACTION_REQUEST_STATES = Object.freeze([...REQUEST_STATES]);
