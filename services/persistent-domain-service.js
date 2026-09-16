import crypto from 'node:crypto';

const RECORD_TYPES = Object.freeze({
  LIFECYCLE_EVENT: 'LIFECYCLE_EVENT',
});

function copy(value) { return value == null ? value : structuredClone(value); }
function recordId(record) { return record?.id || record?.recordId || record?.opportunityId || record?.instrumentId || record?.positionId || record?.listingId || record?.participantId || record?.accountId || record?.transactionId || record?.eventId || record?.exportPackageId || record?.settlementInstructionId || record?.workOrderId || record?.compensationId || record?.chargeId || record?.conversionId || record?.cctpTransferId || record?.proposalId || null; }

export class PersistentDomainService {
  constructor(database) {
    this.database = database;
    this.cache = new Map();
    this.typeIndex = new Map();
    this.hydratedTypes = new Set();
    this.hydrationByType = new Map();
    this.writeChains = new Map();
  }

  key(type, id) { return `${type}:${id}`; }

  cacheRecord(type, id, payload) {
    const record = copy(payload);
    this.cache.set(this.key(type, id), record);
    if (!this.typeIndex.has(type)) this.typeIndex.set(type, new Map());
    this.typeIndex.get(type).set(id, record);
  }

  removeCachedRecord(type, id) {
    this.cache.delete(this.key(type, id));
    this.typeIndex.get(type)?.delete(id);
  }

  async loadTypes(requestedTypes = []) {
    const types = [...new Set(requestedTypes.filter(Boolean))];
    if (!types.length) return;
    if (typeof this.database.listRecordsByTypes === 'function') {
      const rows = await this.database.listRecordsByTypes(types);
      for (const row of rows) this.cacheRecord(row.record_type, row.record_id || recordId(row.payload), row.payload);
      return;
    }
    for (const type of types) {
      const records = await this.database.listRecords(type);
      for (const record of records) {
        const id = recordId(record);
        if (id) this.cacheRecord(type, id, record);
      }
    }
  }

  async hydrate(types = []) {
    const requested = [...new Set(types.filter(Boolean))];
    const unloaded = requested.filter((type) => !this.hydratedTypes.has(type) && !this.hydrationByType.has(type));
    if (unloaded.length) {
      const operation = this.loadTypes(unloaded);
      for (const type of unloaded) this.hydrationByType.set(type, operation);
      operation.then(() => {
        for (const type of unloaded) {
          this.hydratedTypes.add(type);
          if (this.hydrationByType.get(type) === operation) this.hydrationByType.delete(type);
        }
      }).catch(() => {
        for (const type of unloaded) if (this.hydrationByType.get(type) === operation) this.hydrationByType.delete(type);
      });
    }
    const pending = [...new Set(requested.map((type) => this.hydrationByType.get(type)).filter(Boolean))];
    if (pending.length) await Promise.all(pending);
    return this;
  }

  async hydrateRecord(type, id) {
    const existing = this.get(type, id);
    if (existing) return existing;
    if (typeof this.database.getRecord !== 'function') {
      await this.hydrate([type]);
      return this.get(type, id);
    }
    const record = await this.database.getRecord(type, id);
    if (record) this.cacheRecord(type, id, record);
    return this.get(type, id);
  }

  async seed(type, records = []) {
    await this.hydrate([type]);
    const existing = this.list(type);
    if (existing.length) return existing;
    for (const record of records) {
      const id = recordId(record);
      if (!id) throw new Error(`Cannot seed ${type} without an identifier.`);
      await this.put(type, id, record, { audit: false });
    }
    return this.list(type);
  }

  async coordinateWrites(keys, task) {
    const coordinatedKeys = [...new Set(keys)].sort();
    const priors = coordinatedKeys.map((cacheKey) => this.writeChains.get(cacheKey) || Promise.resolve());
    const operation = Promise.all(priors.map((prior) => prior.catch(() => {}))).then(task);
    const tail = operation.catch(() => {});
    for (const cacheKey of coordinatedKeys) this.writeChains.set(cacheKey, tail);
    try { return await operation; }
    finally {
      for (const cacheKey of coordinatedKeys) if (this.writeChains.get(cacheKey) === tail) this.writeChains.delete(cacheKey);
    }
  }

  async put(type, id, payload, options = {}) {
    const record = copy(payload);
    const cacheKey = this.key(type, id);
    return this.coordinateWrites([cacheKey], async () => {
      const previous = this.cache.get(cacheKey);
      try {
        await this.database.putRecord(type, id, record);
        if (options.audit !== false) await this.database.audit({ actorId: options.actorId || null, eventType: options.eventType || 'DOMAIN_RECORD_UPSERTED', objectType: type, objectId: id, payload: options.auditPayload === undefined ? { state: record.state || record.status || null } : copy(options.auditPayload) });
        this.cacheRecord(type, id, record);
        return copy(record);
      } catch (error) {
        if (previous === undefined) this.removeCachedRecord(type, id);
        else this.cacheRecord(type, id, previous);
        throw error;
      }
    });
  }

  async atomicPut(changes = []) {
    if (!Array.isArray(changes) || !changes.length) return [];
    const prepared = changes.map((change) => {
      if (!change?.type || !change?.id) throw new Error('Atomic domain changes require type and id.');
      return { type: change.type, id: change.id, payload: copy(change.payload), actorId: change.actorId || null, eventType: change.eventType || 'DOMAIN_RECORD_UPSERTED', audit: change.audit !== false, auditPayload: change.auditPayload === undefined ? { state: change.payload?.state || change.payload?.status || null } : copy(change.auditPayload) };
    });
    const cacheKeys = prepared.map((change) => this.key(change.type, change.id));
    return this.coordinateWrites(cacheKeys, async () => {
      if (!this.database.pool) {
        const previous = prepared.map((change) => ({ type: change.type, id: change.id, key: this.key(change.type, change.id), value: this.cache.get(this.key(change.type, change.id)) }));
        try {
          for (const change of prepared) {
            await this.database.putRecord(change.type, change.id, change.payload);
            if (change.audit) await this.database.audit({ actorId: change.actorId, eventType: change.eventType, objectType: change.type, objectId: change.id, payload: change.auditPayload });
          }
          for (const change of prepared) this.cacheRecord(change.type, change.id, change.payload);
        } catch (error) {
          for (const item of previous) {
            if (item.value === undefined) this.removeCachedRecord(item.type, item.id);
            else this.cacheRecord(item.type, item.id, item.value);
          }
          throw error;
        }
        return prepared.map((change) => copy(change.payload));
      }
      const client = await this.database.pool.connect();
      try {
        await client.query('BEGIN');
        for (const change of prepared) {
          await client.query(`INSERT INTO sra_domain_records (record_type, record_id, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (record_type, record_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`, [change.type, change.id, JSON.stringify(change.payload)]);
          if (change.audit) await client.query('INSERT INTO sra_audit_events (actor_id, event_type, object_type, object_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)', [change.actorId, change.eventType, change.type, change.id, JSON.stringify(change.auditPayload)]);
        }
        await client.query('COMMIT');
        for (const change of prepared) this.cacheRecord(change.type, change.id, change.payload);
        return prepared.map((change) => copy(change.payload));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    });
  }

  get(type, id) { return copy(this.typeIndex.get(type)?.get(id) || this.cache.get(this.key(type, id)) || null); }

  list(type) {
    const indexed = this.typeIndex.get(type);
    if (indexed) return [...indexed.values()].map((value) => copy(value));
    const prefix = `${type}:`;
    const records = [...this.cache.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
    if (records.length) {
      const rebuilt = new Map();
      for (const record of records) { const id = recordId(record); if (id) rebuilt.set(id, record); }
      if (rebuilt.size) this.typeIndex.set(type, rebuilt);
    }
    return records.map((value) => copy(value));
  }

  async lifecycle(input) {
    const event = { id: `LE-${crypto.randomUUID().split('-')[0].toUpperCase()}`, objectType: input.objectType, objectId: input.objectId, eventType: input.eventType, actorId: input.actorId || null, payload: copy(input.payload || {}), occurredAt: new Date().toISOString() };
    await this.put(RECORD_TYPES.LIFECYCLE_EVENT, event.id, event, { audit: false });
    await this.database.audit({ actorId: event.actorId, eventType: event.eventType, objectType: event.objectType, objectId: event.objectId, payload: event.payload });
    return event;
  }

  snapshot() {
    const counts = {};
    for (const type of Object.values(RECORD_TYPES)) counts[type] = this.typeIndex.get(type)?.size || 0;
    return { counts };
  }
}