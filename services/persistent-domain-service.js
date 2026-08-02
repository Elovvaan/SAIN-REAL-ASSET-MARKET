import crypto from 'node:crypto';

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export const RECORD_TYPES = Object.freeze({
  PARTICIPANT: 'PARTICIPANT',
  ASSET_ACCOUNT: 'ASSET_ACCOUNT',
  PROJECT_ACCOUNT: 'PROJECT_ACCOUNT',
  ONBOARDING_APPLICATION: 'ONBOARDING_APPLICATION',
  EVIDENCE_PACKAGE: 'EVIDENCE_PACKAGE',
  INSTITUTIONAL_REVIEW: 'INSTITUTIONAL_REVIEW',
  V4V_PACKAGE: 'V4V_PACKAGE',
  PARTICIPATION_POSITION: 'PARTICIPATION_POSITION',
  TRANSFERABLE_POSITION: 'TRANSFERABLE_POSITION',
  CREATIVE_FINANCE_STRUCTURE: 'CREATIVE_FINANCE_STRUCTURE',
  VERIFIED_VALUE_RECORD: 'VERIFIED_VALUE_RECORD',
  MARKET_SIGNAL: 'MARKET_SIGNAL',
  VERIFIED_MARKET_EVENT: 'VERIFIED_MARKET_EVENT',
  MARKET_CIRCULATION_EVENT: 'MARKET_CIRCULATION_EVENT',
  PROTECTION_INSTRUMENT: 'PROTECTION_INSTRUMENT',
  EDX_CONNECTOR_DEFINITION: 'EDX_CONNECTOR_DEFINITION',
  EDX_ENTERPRISE_CONNECTION: 'EDX_ENTERPRISE_CONNECTION',
  EDX_EXTRACTION_POLICY: 'EDX_EXTRACTION_POLICY',
  EDX_EXTRACTION_REQUEST: 'EDX_EXTRACTION_REQUEST',
  EDX_EXTRACTION_RESULT: 'EDX_EXTRACTION_RESULT',
  EDX_NORMALIZED_RECORD: 'EDX_NORMALIZED_RECORD',
  EDX_VERIFIED_SNAPSHOT: 'EDX_VERIFIED_SNAPSHOT',
  EDX_VERIFIED_VALUE_PACKAGE: 'EDX_VERIFIED_VALUE_PACKAGE',
  EDX_PUBLICATION_DECISION: 'EDX_PUBLICATION_DECISION',
  EDX_MARKETPLACE_PROJECTION: 'EDX_MARKETPLACE_PROJECTION',
  EDX_INTELLIGENCE_REPORT: 'EDX_INTELLIGENCE_REPORT',
  EDX_SDK_CLIENT: 'EDX_SDK_CLIENT',
  EDX_WEBHOOK_SUBSCRIPTION: 'EDX_WEBHOOK_SUBSCRIPTION',
  EDX_EVENT_STREAM_SUBSCRIPTION: 'EDX_EVENT_STREAM_SUBSCRIPTION',
  EDX_OUTBOUND_EVENT: 'EDX_OUTBOUND_EVENT',
  LIFECYCLE_EVENT: 'LIFECYCLE_EVENT'
});

function recordId(record) {
  return record?.id || record?.applicationId || record?.evidencePackageId || record?.institutionalReviewId || record?.assetId || record?.projectId || record?.packageId || record?.positionId || record?.structureId || record?.signalId || record?.eventId || record?.instrumentId || record?.connectorDefinitionId || record?.connectionId || record?.policyId || record?.extractionRequestId || record?.extractionResultId || record?.normalizedRecordId || record?.snapshotId || record?.valuePackageId || record?.publicationDecisionId || record?.projectionId || record?.intelligenceReportId || record?.sdkClientId || record?.webhookSubscriptionId || record?.eventStreamSubscriptionId || record?.outboundEventId || null;
}

export class PersistentDomainService {
  constructor(database) {
    this.database = database;
    this.cache = new Map();
  }

  key(type, id) {
    return `${type}:${id}`;
  }

  async hydrate(types = Object.values(RECORD_TYPES)) {
    for (const type of types) {
      const records = await this.database.listRecords(type);
      for (const record of records) {
        const id = recordId(record);
        if (id) this.cache.set(this.key(type, id), copy(record));
      }
    }
    return this.snapshot();
  }

  async seed(type, records = []) {
    const existing = this.list(type);
    if (existing.length) return existing;
    for (const record of records) {
      const id = recordId(record);
      if (!id) throw new Error(`Cannot seed ${type} without an identifier.`);
      await this.put(type, id, record, { audit: false });
    }
    return this.list(type);
  }

  async put(type, id, payload, options = {}) {
    const record = copy(payload);
    this.cache.set(this.key(type, id), record);
    await this.database.putRecord(type, id, record);
    if (options.audit !== false) {
      await this.database.audit({
        actorId: options.actorId || null,
        eventType: options.eventType || 'DOMAIN_RECORD_UPSERTED',
        objectType: type,
        objectId: id,
        payload: { state: record.state || record.status || null }
      });
    }
    return copy(record);
  }

  get(type, id) {
    return copy(this.cache.get(this.key(type, id)) || null);
  }

  list(type) {
    const prefix = `${type}:`;
    return [...this.cache.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => copy(value));
  }

  async lifecycle(input) {
    const event = {
      id: `LE-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      objectType: input.objectType,
      objectId: input.objectId,
      eventType: input.eventType,
      actorId: input.actorId || null,
      payload: copy(input.payload || {}),
      occurredAt: new Date().toISOString()
    };
    await this.put(RECORD_TYPES.LIFECYCLE_EVENT, event.id, event, { audit: false });
    await this.database.audit({
      actorId: event.actorId,
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      payload: event.payload
    });
    return event;
  }

  snapshot() {
    const counts = {};
    for (const type of Object.values(RECORD_TYPES)) counts[type] = this.list(type).length;
    return { counts };
  }
}
