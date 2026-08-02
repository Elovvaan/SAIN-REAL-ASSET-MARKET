import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const VISIBILITY_LEVELS = new Set(['PRIVATE', 'INTERNAL', 'INSTITUTIONAL', 'MARKETPLACE', 'PUBLIC']);
const POLICY_STATES = new Set(['DRAFT', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED']);
const AGGREGATION_LEVELS = new Set(['RAW_APPROVED_FIELDS', 'TRANSACTION_SUMMARY', 'DAILY_SUMMARY', 'WEEKLY_SUMMARY', 'MONTHLY_SUMMARY', 'CUSTOM_SUMMARY']);
const RECIPIENT_CLASSES = new Set(['COMPANY_ONLY', 'APPROVED_COMPANY_STAFF', 'SRA_INSTITUTIONAL_REVIEW', 'NAMED_INSTITUTION', 'APPROVED_MARKETPLACE_PARTICIPANTS', 'PUBLIC_PROJECTION']);

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

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function optionalObject(value, field) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function assertEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new Error(`Unsupported ${field}: ${value}.`);
}

function validateRetentionDays(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error('retentionDays must be a non-negative integer.');
  return number;
}

function validateDateRange(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('timeRange must be an object.');
  const start = value.start ? new Date(value.start) : null;
  const end = value.end ? new Date(value.end) : null;
  if (start && Number.isNaN(start.getTime())) throw new Error('timeRange.start is invalid.');
  if (end && Number.isNaN(end.getTime())) throw new Error('timeRange.end is invalid.');
  if (start && end && start > end) throw new Error('timeRange.start must be before timeRange.end.');
  return { start: value.start || null, end: value.end || null };
}

export class EdxPermissionService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  listPolicies(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_EXTRACTION_POLICY).filter((policy) => {
      if (filters.enterpriseId && policy.enterpriseId !== filters.enterpriseId) return false;
      if (filters.connectionId && policy.connectionId !== filters.connectionId) return false;
      if (filters.state && policy.state !== filters.state) return false;
      if (filters.visibility && policy.visibility !== filters.visibility) return false;
      return true;
    });
  }

  getPolicy(policyId) {
    return this.domain.get(RECORD_TYPES.EDX_EXTRACTION_POLICY, policyId);
  }

  async createPolicy(input, actorId = null) {
    const connectionId = requiredString(input.connectionId, 'connectionId');
    const connection = this.domain.get(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, connectionId);
    if (!connection) throw new Error('Enterprise connection not found.');
    if (!['CONNECTED', 'ACTIVE', 'DEGRADED', 'SUSPENDED'].includes(connection.state)) {
      throw new Error(`Connection state ${connection.state} cannot receive an extraction policy.`);
    }

    const recordCategory = requiredString(input.recordCategory, 'recordCategory');
    if (!connection.approvedRecordCategories.includes(recordCategory)) {
      throw new Error('Record category is not approved on the enterprise connection.');
    }

    const visibility = requiredString(input.visibility || 'PRIVATE', 'visibility').toUpperCase();
    const aggregationLevel = requiredString(input.aggregationLevel || 'DAILY_SUMMARY', 'aggregationLevel').toUpperCase();
    const recipientClass = requiredString(input.recipientClass || 'COMPANY_ONLY', 'recipientClass').toUpperCase();
    assertEnum(visibility, VISIBILITY_LEVELS, 'visibility');
    assertEnum(aggregationLevel, AGGREGATION_LEVELS, 'aggregation level');
    assertEnum(recipientClass, RECIPIENT_CLASSES, 'recipient class');

    if (visibility === 'PUBLIC' && recipientClass !== 'PUBLIC_PROJECTION') {
      throw new Error('PUBLIC visibility requires PUBLIC_PROJECTION recipient class.');
    }
    if (visibility === 'MARKETPLACE' && recipientClass !== 'APPROVED_MARKETPLACE_PARTICIPANTS') {
      throw new Error('MARKETPLACE visibility requires APPROVED_MARKETPLACE_PARTICIPANTS recipient class.');
    }

    const permittedFields = uniqueStrings(input.permittedFields);
    const excludedFields = uniqueStrings(input.excludedFields);
    const overlap = permittedFields.filter((field) => excludedFields.includes(field));
    if (overlap.length) throw new Error(`Fields cannot be both permitted and excluded: ${overlap.join(', ')}.`);
    if (!permittedFields.length && aggregationLevel === 'RAW_APPROVED_FIELDS') {
      throw new Error('RAW_APPROVED_FIELDS requires at least one permitted field.');
    }

    const policyId = input.policyId || id('EDX-EP');
    if (this.getPolicy(policyId)) throw new Error('Extraction policy already exists.');

    const timestamp = now();
    const record = {
      policyId,
      enterpriseId: connection.enterpriseId,
      connectionId,
      recordCategory,
      permittedFields,
      excludedFields,
      aggregationLevel,
      timeRange: validateDateRange(input.timeRange),
      extractionFrequency: input.extractionFrequency || connection.refreshSchedule || 'MANUAL',
      purpose: requiredString(input.purpose, 'purpose'),
      recipientClass,
      namedRecipientId: input.namedRecipientId || null,
      visibility,
      retentionDays: validateRetentionDays(input.retentionDays),
      revocationBehavior: input.revocationBehavior || 'STOP_FUTURE_EXTRACTION_RETAIN_AUTHORIZED_HISTORY',
      conditions: optionalObject(input.conditions, 'conditions'),
      state: 'DRAFT',
      approvedBy: null,
      approvedAt: null,
      revokedBy: null,
      revokedAt: null,
      revocationReason: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    if (recipientClass === 'NAMED_INSTITUTION' && !record.namedRecipientId) {
      throw new Error('namedRecipientId is required for NAMED_INSTITUTION recipient class.');
    }

    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_POLICY, policyId, record, {
      actorId,
      eventType: 'EDX_POLICY_CREATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_EXTRACTION_POLICY,
      objectId: policyId,
      eventType: 'EDX_POLICY_CREATED',
      actorId,
      payload: { connectionId, recordCategory, visibility, recipientClass }
    });
    return record;
  }

  async updatePolicy(policyId, input, actorId = null) {
    const current = this.getPolicy(policyId);
    if (!current) throw new Error('Extraction policy not found.');
    if (['REVOKED', 'ARCHIVED'].includes(current.state)) throw new Error(`Cannot edit a ${current.state.toLowerCase()} policy.`);

    const permittedFields = input.permittedFields == null ? current.permittedFields : uniqueStrings(input.permittedFields);
    const excludedFields = input.excludedFields == null ? current.excludedFields : uniqueStrings(input.excludedFields);
    const overlap = permittedFields.filter((field) => excludedFields.includes(field));
    if (overlap.length) throw new Error(`Fields cannot be both permitted and excluded: ${overlap.join(', ')}.`);

    const visibility = (input.visibility || current.visibility).toUpperCase();
    const aggregationLevel = (input.aggregationLevel || current.aggregationLevel).toUpperCase();
    const recipientClass = (input.recipientClass || current.recipientClass).toUpperCase();
    assertEnum(visibility, VISIBILITY_LEVELS, 'visibility');
    assertEnum(aggregationLevel, AGGREGATION_LEVELS, 'aggregation level');
    assertEnum(recipientClass, RECIPIENT_CLASSES, 'recipient class');

    if (visibility === 'PUBLIC' && recipientClass !== 'PUBLIC_PROJECTION') {
      throw new Error('PUBLIC visibility requires PUBLIC_PROJECTION recipient class.');
    }
    if (visibility === 'MARKETPLACE' && recipientClass !== 'APPROVED_MARKETPLACE_PARTICIPANTS') {
      throw new Error('MARKETPLACE visibility requires APPROVED_MARKETPLACE_PARTICIPANTS recipient class.');
    }

    const updated = {
      ...current,
      permittedFields,
      excludedFields,
      aggregationLevel,
      timeRange: input.timeRange == null ? current.timeRange : validateDateRange(input.timeRange),
      extractionFrequency: input.extractionFrequency ?? current.extractionFrequency,
      purpose: input.purpose ?? current.purpose,
      recipientClass,
      namedRecipientId: input.namedRecipientId ?? current.namedRecipientId,
      visibility,
      retentionDays: input.retentionDays == null ? current.retentionDays : validateRetentionDays(input.retentionDays),
      revocationBehavior: input.revocationBehavior ?? current.revocationBehavior,
      conditions: input.conditions == null ? current.conditions : optionalObject(input.conditions, 'conditions'),
      state: current.state === 'ACTIVE' ? 'DRAFT' : current.state,
      approvedBy: current.state === 'ACTIVE' ? null : current.approvedBy,
      approvedAt: current.state === 'ACTIVE' ? null : current.approvedAt,
      updatedAt: now()
    };

    if (recipientClass === 'NAMED_INSTITUTION' && !updated.namedRecipientId) {
      throw new Error('namedRecipientId is required for NAMED_INSTITUTION recipient class.');
    }

    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_POLICY, policyId, updated, {
      actorId,
      eventType: 'EDX_POLICY_UPDATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_EXTRACTION_POLICY,
      objectId: policyId,
      eventType: 'EDX_POLICY_UPDATED',
      actorId,
      payload: { visibility, recipientClass, state: updated.state }
    });
    return updated;
  }

  async transitionPolicy(policyId, targetState, input = {}, actorId = null) {
    const current = this.getPolicy(policyId);
    if (!current) throw new Error('Extraction policy not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    assertEnum(state, POLICY_STATES, 'policy state');

    const allowed = {
      DRAFT: ['ACTIVE', 'ARCHIVED'],
      ACTIVE: ['SUSPENDED', 'REVOKED'],
      SUSPENDED: ['ACTIVE', 'REVOKED', 'ARCHIVED'],
      REVOKED: ['ARCHIVED'],
      ARCHIVED: []
    };
    if (!allowed[current.state].includes(state)) throw new Error(`Invalid policy transition: ${current.state} -> ${state}.`);

    if (state === 'ACTIVE') {
      const connection = this.domain.get(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, current.connectionId);
      if (!connection || !['CONNECTED', 'ACTIVE', 'DEGRADED'].includes(connection.state)) {
        throw new Error('Policy cannot activate unless its connection is connected, active, or degraded.');
      }
      if (!current.purpose || !current.recordCategory) throw new Error('Policy is incomplete.');
    }

    const timestamp = now();
    const updated = {
      ...current,
      state,
      approvedBy: state === 'ACTIVE' ? actorId : current.approvedBy,
      approvedAt: state === 'ACTIVE' ? timestamp : current.approvedAt,
      revokedBy: state === 'REVOKED' ? actorId : current.revokedBy,
      revokedAt: state === 'REVOKED' ? timestamp : current.revokedAt,
      revocationReason: state === 'REVOKED' ? input.reason || 'COMPANY_REVOKED' : current.revocationReason,
      updatedAt: timestamp
    };

    await this.domain.put(RECORD_TYPES.EDX_EXTRACTION_POLICY, policyId, updated, {
      actorId,
      eventType: `EDX_POLICY_${state}`
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_EXTRACTION_POLICY,
      objectId: policyId,
      eventType: `EDX_POLICY_${state}`,
      actorId,
      payload: { previousState: current.state, state, reason: input.reason || null }
    });
    return updated;
  }

  evaluatePolicy(policyId, context = {}) {
    const policy = this.getPolicy(policyId);
    if (!policy) throw new Error('Extraction policy not found.');
    if (policy.state !== 'ACTIVE') return { allowed: false, reason: `POLICY_${policy.state}` };

    const connection = this.domain.get(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, policy.connectionId);
    if (!connection || !['CONNECTED', 'ACTIVE', 'DEGRADED'].includes(connection.state)) {
      return { allowed: false, reason: 'CONNECTION_NOT_AVAILABLE' };
    }
    if (context.enterpriseId && context.enterpriseId !== policy.enterpriseId) {
      return { allowed: false, reason: 'ENTERPRISE_MISMATCH' };
    }
    if (context.recordCategory && context.recordCategory !== policy.recordCategory) {
      return { allowed: false, reason: 'RECORD_CATEGORY_MISMATCH' };
    }
    if (context.visibility && context.visibility !== policy.visibility) {
      return { allowed: false, reason: 'VISIBILITY_MISMATCH' };
    }

    return {
      allowed: true,
      policyId: policy.policyId,
      enterpriseId: policy.enterpriseId,
      connectionId: policy.connectionId,
      recordCategory: policy.recordCategory,
      permittedFields: policy.permittedFields,
      excludedFields: policy.excludedFields,
      aggregationLevel: policy.aggregationLevel,
      purpose: policy.purpose,
      recipientClass: policy.recipientClass,
      namedRecipientId: policy.namedRecipientId,
      visibility: policy.visibility,
      retentionDays: policy.retentionDays,
      revocationBehavior: policy.revocationBehavior,
      conditions: policy.conditions
    };
  }
}

export const EDX_VISIBILITY_LEVELS = Object.freeze([...VISIBILITY_LEVELS]);
export const EDX_POLICY_STATES = Object.freeze([...POLICY_STATES]);
