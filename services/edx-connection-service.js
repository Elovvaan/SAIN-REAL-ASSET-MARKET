import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const CONNECTION_STATES = new Set([
  'DRAFT',
  'AUTHORIZATION_PENDING',
  'CONNECTED',
  'ACTIVE',
  'DEGRADED',
  'SUSPENDED',
  'REVOKED',
  'ARCHIVED'
]);

const CONNECTOR_TYPES = new Set([
  'ACCOUNTING',
  'BANKING_TREASURY',
  'POINT_OF_SALE',
  'SALES_COMMERCE',
  'INVENTORY',
  'PRODUCTION',
  'ERP',
  'CRM',
  'CONTRACTS_WORK_ORDERS',
  'PAYROLL_SUMMARY',
  'ASSET_REGISTER',
  'PROJECT_MANAGEMENT',
  'CUSTOM_API',
  'STRUCTURED_FILE_IMPORT'
]);

const AUTH_METHODS = new Set(['OAUTH2', 'API_KEY_REFERENCE', 'SERVICE_ACCOUNT_REFERENCE', 'SIGNED_FILE', 'NONE']);
const EXTRACTION_MODES = new Set(['MANUAL', 'SCHEDULED', 'EVENT_DRIVEN']);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function optionalObject(value, field) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function assertConnectorType(value) {
  if (!CONNECTOR_TYPES.has(value)) throw new Error(`Unsupported connector type: ${value}.`);
}

function assertAuthMethod(value) {
  if (!AUTH_METHODS.has(value)) throw new Error(`Unsupported authentication method: ${value}.`);
}

function assertExtractionModes(values) {
  for (const value of values) {
    if (!EXTRACTION_MODES.has(value)) throw new Error(`Unsupported extraction mode: ${value}.`);
  }
}

export class EdxConnectionService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  listConnectorDefinitions() {
    return this.domain.list(RECORD_TYPES.EDX_CONNECTOR_DEFINITION);
  }

  getConnectorDefinition(connectorDefinitionId) {
    return this.domain.get(RECORD_TYPES.EDX_CONNECTOR_DEFINITION, connectorDefinitionId);
  }

  async createConnectorDefinition(input, actorId = null) {
    const connectorType = requiredString(input.connectorType, 'connectorType').toUpperCase();
    const authenticationMethod = requiredString(input.authenticationMethod, 'authenticationMethod').toUpperCase();
    assertConnectorType(connectorType);
    assertAuthMethod(authenticationMethod);

    const extractionModes = uniqueStrings(input.extractionModes || ['MANUAL']).map((value) => value.toUpperCase());
    assertExtractionModes(extractionModes);

    const connectorDefinitionId = input.connectorDefinitionId || id('EDX-CD');
    if (this.getConnectorDefinition(connectorDefinitionId)) throw new Error('Connector definition already exists.');

    const timestamp = now();
    const record = {
      connectorDefinitionId,
      name: requiredString(input.name, 'name'),
      connectorType,
      provider: requiredString(input.provider || input.name, 'provider'),
      version: requiredString(input.version || '1.0.0', 'version'),
      authenticationMethod,
      supportedRecordCategories: uniqueStrings(input.supportedRecordCategories),
      extractionModes,
      supportedRefreshSchedules: uniqueStrings(input.supportedRefreshSchedules || ['MANUAL']),
      fieldLevelMinimization: input.fieldLevelMinimization !== false,
      sourceTimestampBehavior: input.sourceTimestampBehavior || 'SOURCE_PROVIDED_OR_EXTRACTION_TIME',
      dataRetentionBehavior: input.dataRetentionBehavior || 'REFERENCE_FIRST',
      revocationMethod: input.revocationMethod || 'DISABLE_CONNECTION_AND_REVOKE_CREDENTIAL_REFERENCE',
      configurationSchema: optionalObject(input.configurationSchema, 'configurationSchema'),
      status: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.domain.put(RECORD_TYPES.EDX_CONNECTOR_DEFINITION, connectorDefinitionId, record, {
      actorId,
      eventType: 'EDX_CONNECTOR_DEFINITION_CREATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_CONNECTOR_DEFINITION,
      objectId: connectorDefinitionId,
      eventType: 'EDX_CONNECTOR_DEFINITION_CREATED',
      actorId,
      payload: { connectorType, provider: record.provider, version: record.version }
    });
    return record;
  }

  listConnections(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION).filter((connection) => {
      if (filters.enterpriseId && connection.enterpriseId !== filters.enterpriseId) return false;
      if (filters.state && connection.state !== filters.state) return false;
      if (filters.connectorDefinitionId && connection.connectorDefinitionId !== filters.connectorDefinitionId) return false;
      return true;
    });
  }

  getConnection(connectionId) {
    return this.domain.get(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, connectionId);
  }

  async createConnection(input, actorId = null) {
    const enterpriseId = requiredString(input.enterpriseId, 'enterpriseId');
    const connectorDefinitionId = requiredString(input.connectorDefinitionId, 'connectorDefinitionId');
    const connector = this.getConnectorDefinition(connectorDefinitionId);
    if (!connector || connector.status !== 'ACTIVE') throw new Error('Active connector definition not found.');

    const connectionId = input.connectionId || id('EDX-EC');
    if (this.getConnection(connectionId)) throw new Error('Enterprise connection already exists.');

    const approvedRecordCategories = uniqueStrings(input.approvedRecordCategories);
    const unsupported = approvedRecordCategories.filter((category) => !connector.supportedRecordCategories.includes(category));
    if (unsupported.length) throw new Error(`Unsupported record categories: ${unsupported.join(', ')}.`);

    const timestamp = now();
    const record = {
      connectionId,
      enterpriseId,
      connectorDefinitionId,
      sourceSystemIdentifier: requiredString(input.sourceSystemIdentifier, 'sourceSystemIdentifier'),
      displayName: input.displayName || connector.name,
      state: 'DRAFT',
      credentialReference: input.credentialReference || null,
      approvedScopes: uniqueStrings(input.approvedScopes),
      approvedRecordCategories,
      approvedFieldRules: optionalObject(input.approvedFieldRules, 'approvedFieldRules'),
      refreshSchedule: input.refreshSchedule || 'MANUAL',
      configuration: optionalObject(input.configuration, 'configuration'),
      lastSuccessfulExtractionAt: null,
      lastFailedExtractionAt: null,
      revocation: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.domain.put(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, connectionId, record, {
      actorId,
      eventType: 'EDX_CONNECTION_CREATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_ENTERPRISE_CONNECTION,
      objectId: connectionId,
      eventType: 'EDX_CONNECTION_CREATED',
      actorId,
      payload: { enterpriseId, connectorDefinitionId, state: record.state }
    });
    return record;
  }

  async updateConnection(connectionId, input, actorId = null) {
    const current = this.getConnection(connectionId);
    if (!current) throw new Error('Enterprise connection not found.');
    if (['REVOKED', 'ARCHIVED'].includes(current.state)) throw new Error(`Cannot edit a ${current.state.toLowerCase()} connection.`);

    const connector = this.getConnectorDefinition(current.connectorDefinitionId);
    const approvedRecordCategories = input.approvedRecordCategories == null
      ? current.approvedRecordCategories
      : uniqueStrings(input.approvedRecordCategories);
    const unsupported = approvedRecordCategories.filter((category) => !connector.supportedRecordCategories.includes(category));
    if (unsupported.length) throw new Error(`Unsupported record categories: ${unsupported.join(', ')}.`);

    const updated = {
      ...current,
      displayName: input.displayName ?? current.displayName,
      credentialReference: input.credentialReference ?? current.credentialReference,
      approvedScopes: input.approvedScopes == null ? current.approvedScopes : uniqueStrings(input.approvedScopes),
      approvedRecordCategories,
      approvedFieldRules: input.approvedFieldRules == null ? current.approvedFieldRules : optionalObject(input.approvedFieldRules, 'approvedFieldRules'),
      refreshSchedule: input.refreshSchedule ?? current.refreshSchedule,
      configuration: input.configuration == null ? current.configuration : optionalObject(input.configuration, 'configuration'),
      updatedAt: now()
    };

    await this.domain.put(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, connectionId, updated, {
      actorId,
      eventType: 'EDX_CONNECTION_UPDATED'
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_ENTERPRISE_CONNECTION,
      objectId: connectionId,
      eventType: 'EDX_CONNECTION_UPDATED',
      actorId,
      payload: { approvedScopes: updated.approvedScopes, approvedRecordCategories: updated.approvedRecordCategories }
    });
    return updated;
  }

  async transitionConnection(connectionId, targetState, input = {}, actorId = null) {
    const current = this.getConnection(connectionId);
    if (!current) throw new Error('Enterprise connection not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    if (!CONNECTION_STATES.has(state)) throw new Error(`Unsupported connection state: ${state}.`);

    const allowed = {
      DRAFT: ['AUTHORIZATION_PENDING', 'ARCHIVED'],
      AUTHORIZATION_PENDING: ['CONNECTED', 'SUSPENDED', 'REVOKED'],
      CONNECTED: ['ACTIVE', 'DEGRADED', 'SUSPENDED', 'REVOKED'],
      ACTIVE: ['DEGRADED', 'SUSPENDED', 'REVOKED'],
      DEGRADED: ['ACTIVE', 'SUSPENDED', 'REVOKED'],
      SUSPENDED: ['AUTHORIZATION_PENDING', 'CONNECTED', 'ACTIVE', 'REVOKED', 'ARCHIVED'],
      REVOKED: ['ARCHIVED'],
      ARCHIVED: []
    };
    if (!allowed[current.state].includes(state)) throw new Error(`Invalid connection transition: ${current.state} -> ${state}.`);

    if (state === 'CONNECTED' && !current.credentialReference && input.credentialReference == null) {
      throw new Error('credentialReference is required before connection authorization can complete.');
    }

    const timestamp = now();
    const updated = {
      ...current,
      credentialReference: input.credentialReference ?? current.credentialReference,
      state,
      authorizationReference: input.authorizationReference ?? current.authorizationReference ?? null,
      revocation: state === 'REVOKED' ? {
        reason: input.reason || 'COMPANY_REVOKED',
        revokedBy: actorId,
        revokedAt: timestamp
      } : current.revocation,
      updatedAt: timestamp
    };

    await this.domain.put(RECORD_TYPES.EDX_ENTERPRISE_CONNECTION, connectionId, updated, {
      actorId,
      eventType: `EDX_CONNECTION_${state}`
    });
    await this.domain.lifecycle({
      objectType: RECORD_TYPES.EDX_ENTERPRISE_CONNECTION,
      objectId: connectionId,
      eventType: `EDX_CONNECTION_${state}`,
      actorId,
      payload: { previousState: current.state, state, reason: input.reason || null }
    });
    return updated;
  }
}

export const EDX_CONNECTION_STATES = Object.freeze([...CONNECTION_STATES]);
export const EDX_CONNECTOR_TYPES = Object.freeze([...CONNECTOR_TYPES]);
