import crypto from 'node:crypto';
import { RECORD_TYPES } from './persistent-domain-service.js';

const CLIENT_STATES = new Set(['ACTIVE', 'SUSPENDED', 'REVOKED']);
const SUBSCRIPTION_STATES = new Set(['ACTIVE', 'PAUSED', 'REVOKED']);
const EVENT_TYPES = new Set([
  'EDX.EXTRACTION.COMPLETED',
  'EDX.NORMALIZATION.COMPLETED',
  'EDX.SNAPSHOT.COMPLETE',
  'EDX.VALUE_PACKAGE.ACTIVE',
  'EDX.PUBLICATION.APPROVED',
  'EDX.MARKETPLACE.PUBLISHED',
  'EDX.INTELLIGENCE.READY'
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

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function ensureUrl(value, field) {
  const url = new URL(requiredString(value, field));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`${field} must use HTTP or HTTPS.`);
  return url.toString();
}

function validateEventTypes(values) {
  const eventTypes = uniqueStrings(values).map((value) => value.toUpperCase());
  const unsupported = eventTypes.filter((value) => !EVENT_TYPES.has(value));
  if (unsupported.length) throw new Error(`Unsupported event types: ${unsupported.join(', ')}.`);
  return eventTypes;
}

export class EdxEnterpriseSdkService {
  constructor(persistentDomain) {
    this.domain = persistentDomain;
  }

  schemas() {
    return {
      version: '1.0.0',
      records: {
        normalizedRecord: {
          required: ['normalizedRecordId', 'enterpriseId', 'category', 'schemaVersion', 'verificationState', 'sourceSystemIdentifier'],
          valueFields: ['value', 'amount', 'total', 'quantity', 'metricValue'],
          categories: [
            'DAILY_GROSS_REVENUE', 'DAILY_NET_REVENUE', 'DAILY_EXPENSE', 'CASH_POSITION',
            'RECEIVABLE_BALANCE', 'PAYABLE_BALANCE', 'INVENTORY_VALUE', 'INVENTORY_MOVEMENT',
            'PRODUCTION_OUTPUT', 'COMPLETED_ORDER_COUNT', 'COMPLETED_ORDER_VALUE',
            'ACTIVE_CONTRACT_VALUE', 'COMPLETED_CONTRACT_VALUE', 'ASSET_ADDITION',
            'ASSET_DISPOSITION', 'PROJECT_MILESTONE', 'LABOR_COST_SUMMARY',
            'BANK_SETTLEMENT_SUMMARY', 'CUSTOM_APPROVED_METRIC'
          ]
        },
        verifiedSnapshot: {
          required: ['snapshotId', 'enterpriseId', 'snapshotDate', 'state', 'verificationStatus', 'metrics'],
          metrics: ['revenue', 'expenses', 'assets', 'inventory', 'production', 'growthPercent', 'cashPosition', 'verifiedValue']
        },
        verifiedValuePackage: {
          required: ['valuePackageId', 'enterpriseId', 'snapshotId', 'version', 'state', 'visibility', 'supportedUses']
        },
        outboundEvent: {
          required: ['outboundEventId', 'enterpriseId', 'eventType', 'occurredAt', 'payload']
        }
      }
    };
  }

  milestones() {
    const counts = this.domain.snapshot().counts;
    const count = (type) => counts[type] || 0;
    return {
      generatedAt: now(),
      milestones: [
        { milestone: 1, name: 'EDX architecture approved', status: 'COMPLETE', evidence: 'Phase 1 architecture and master architecture integration merged.' },
        { milestone: 2, name: 'First connector working', status: count(RECORD_TYPES.EDX_EXTRACTION_RESULT) > 0 ? 'COMPLETE' : 'IMPLEMENTED_AWAITING_LIVE_RUN', evidence: 'Custom API and structured payload extraction contracts exist; completion requires a persisted live extraction result.' },
        { milestone: 3, name: 'Permission engine complete', status: 'COMPLETE', evidence: 'Persistent extraction policies and machine-readable authorization evaluation are active.' },
        { milestone: 4, name: 'Verified Snapshot generated automatically', status: count(RECORD_TYPES.EDX_VERIFIED_SNAPSHOT) > 0 ? 'COMPLETE' : 'IMPLEMENTED_AWAITING_LIVE_RUN', evidence: 'Automatic Verified Snapshot engine is active; completion requires a persisted snapshot.' },
        { milestone: 5, name: 'Verified Value Package created from live business data', status: count(RECORD_TYPES.EDX_VERIFIED_VALUE_PACKAGE) > 0 ? 'COMPLETE' : 'IMPLEMENTED_AWAITING_LIVE_RUN', evidence: 'VVP generation is active; completion requires a package generated from a live snapshot.' },
        { milestone: 6, name: 'Marketplace publishing operational', status: 'COMPLETE', evidence: 'Company-controlled publication decisions, approval, execution, and projections are active.' },
        { milestone: 7, name: 'Sane guiding businesses through the entire workflow', status: 'COMPLETE', evidence: 'Sane EDX publication review and company-choice guidance are active.' }
      ]
    };
  }

  listClients(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_SDK_CLIENT).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    });
  }

  getClient(sdkClientId) {
    return this.domain.get(RECORD_TYPES.EDX_SDK_CLIENT, sdkClientId);
  }

  async createClient(input, actorId = null) {
    const enterpriseId = requiredString(input.enterpriseId, 'enterpriseId');
    const scopes = uniqueStrings(input.scopes);
    if (!scopes.length) throw new Error('At least one SDK scope is required.');
    const sdkClientId = input.sdkClientId || id('EDX-SDK');
    if (this.getClient(sdkClientId)) throw new Error('SDK client already exists.');
    const clientSecret = generateSecret();
    const timestamp = now();
    const record = {
      sdkClientId,
      enterpriseId,
      name: requiredString(input.name, 'name'),
      state: 'ACTIVE',
      authenticationMethod: 'CLIENT_SECRET_SHA256',
      clientSecretHash: hash(clientSecret),
      scopes,
      allowedOrigins: uniqueStrings(input.allowedOrigins),
      rateLimitPerMinute: Number.isInteger(input.rateLimitPerMinute) ? input.rateLimitPerMinute : 120,
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastAuthenticatedAt: null,
      revokedAt: null
    };
    await this.domain.put(RECORD_TYPES.EDX_SDK_CLIENT, sdkClientId, record, { actorId, eventType: 'EDX_SDK_CLIENT_CREATED' });
    await this.domain.lifecycle({ objectType: RECORD_TYPES.EDX_SDK_CLIENT, objectId: sdkClientId, eventType: 'EDX_SDK_CLIENT_CREATED', actorId, payload: { enterpriseId, scopes } });
    return { client: { ...record, clientSecretHash: undefined }, clientSecret };
  }

  authenticate(input) {
    const sdkClientId = requiredString(input.sdkClientId, 'sdkClientId');
    const clientSecret = requiredString(input.clientSecret, 'clientSecret');
    const client = this.getClient(sdkClientId);
    if (!client || client.state !== 'ACTIVE') return { authenticated: false, reason: 'CLIENT_NOT_ACTIVE' };
    const authenticated = crypto.timingSafeEqual(Buffer.from(client.clientSecretHash), Buffer.from(hash(clientSecret)));
    return authenticated
      ? { authenticated: true, sdkClientId, enterpriseId: client.enterpriseId, scopes: client.scopes }
      : { authenticated: false, reason: 'INVALID_CREDENTIALS' };
  }

  async transitionClient(sdkClientId, targetState, actorId = null) {
    const client = this.getClient(sdkClientId);
    if (!client) throw new Error('SDK client not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    if (!CLIENT_STATES.has(state)) throw new Error(`Unsupported SDK client state: ${state}.`);
    const updated = { ...client, state, updatedAt: now(), revokedAt: state === 'REVOKED' ? now() : client.revokedAt };
    await this.domain.put(RECORD_TYPES.EDX_SDK_CLIENT, sdkClientId, updated, { actorId, eventType: `EDX_SDK_CLIENT_${state}` });
    return updated;
  }

  listWebhooks(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_WEBHOOK_SUBSCRIPTION).filter((record) => {
      if (filters.enterpriseId && record.enterpriseId !== filters.enterpriseId) return false;
      if (filters.state && record.state !== filters.state) return false;
      return true;
    });
  }

  async createWebhook(input, actorId = null) {
    const sdkClientId = requiredString(input.sdkClientId, 'sdkClientId');
    const client = this.getClient(sdkClientId);
    if (!client || client.state !== 'ACTIVE') throw new Error('Active SDK client not found.');
    const signingSecret = generateSecret();
    const webhookSubscriptionId = input.webhookSubscriptionId || id('EDX-WH');
    const record = {
      webhookSubscriptionId,
      sdkClientId,
      enterpriseId: client.enterpriseId,
      endpointUrl: ensureUrl(input.endpointUrl, 'endpointUrl'),
      eventTypes: validateEventTypes(input.eventTypes),
      state: 'ACTIVE',
      signingAlgorithm: 'HMAC_SHA256',
      signingSecretHash: hash(signingSecret),
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now(),
      lastDeliveryAt: null
    };
    if (!record.eventTypes.length) throw new Error('At least one webhook event type is required.');
    await this.domain.put(RECORD_TYPES.EDX_WEBHOOK_SUBSCRIPTION, webhookSubscriptionId, record, { actorId, eventType: 'EDX_WEBHOOK_CREATED' });
    return { subscription: { ...record, signingSecretHash: undefined }, signingSecret };
  }

  async createEventStream(input, actorId = null) {
    const sdkClientId = requiredString(input.sdkClientId, 'sdkClientId');
    const client = this.getClient(sdkClientId);
    if (!client || client.state !== 'ACTIVE') throw new Error('Active SDK client not found.');
    const eventStreamSubscriptionId = input.eventStreamSubscriptionId || id('EDX-ES');
    const record = {
      eventStreamSubscriptionId,
      sdkClientId,
      enterpriseId: client.enterpriseId,
      eventTypes: validateEventTypes(input.eventTypes),
      protocol: input.protocol || 'SERVER_SENT_EVENTS',
      state: 'ACTIVE',
      cursor: null,
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now()
    };
    if (!record.eventTypes.length) throw new Error('At least one event-stream event type is required.');
    await this.domain.put(RECORD_TYPES.EDX_EVENT_STREAM_SUBSCRIPTION, eventStreamSubscriptionId, record, { actorId, eventType: 'EDX_EVENT_STREAM_CREATED' });
    return record;
  }

  async transitionSubscription(type, subscriptionId, targetState, actorId = null) {
    const record = this.domain.get(type, subscriptionId);
    if (!record) throw new Error('Subscription not found.');
    const state = requiredString(targetState, 'state').toUpperCase();
    if (!SUBSCRIPTION_STATES.has(state)) throw new Error(`Unsupported subscription state: ${state}.`);
    const updated = { ...record, state, updatedAt: now(), revokedAt: state === 'REVOKED' ? now() : record.revokedAt || null };
    await this.domain.put(type, subscriptionId, updated, { actorId, eventType: `EDX_SUBSCRIPTION_${state}` });
    return updated;
  }

  async emitEvent(input, actorId = null) {
    const eventType = requiredString(input.eventType, 'eventType').toUpperCase();
    if (!EVENT_TYPES.has(eventType)) throw new Error(`Unsupported event type: ${eventType}.`);
    const enterpriseId = requiredString(input.enterpriseId, 'enterpriseId');
    const outboundEventId = input.outboundEventId || id('EDX-OE');
    const event = {
      outboundEventId,
      enterpriseId,
      eventType,
      subjectType: input.subjectType || null,
      subjectId: input.subjectId || null,
      schemaVersion: '1.0.0',
      payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
      occurredAt: now(),
      state: 'AVAILABLE'
    };
    await this.domain.put(RECORD_TYPES.EDX_OUTBOUND_EVENT, outboundEventId, event, { actorId, eventType: 'EDX_OUTBOUND_EVENT_CREATED' });
    return event;
  }

  listEvents(filters = {}) {
    return this.domain.list(RECORD_TYPES.EDX_OUTBOUND_EVENT).filter((event) => {
      if (filters.enterpriseId && event.enterpriseId !== filters.enterpriseId) return false;
      if (filters.eventType && event.eventType !== filters.eventType) return false;
      if (filters.after && new Date(event.occurredAt) <= new Date(filters.after)) return false;
      return true;
    }).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  }
}

export const EDX_SDK_EVENT_TYPES = Object.freeze([...EVENT_TYPES]);
