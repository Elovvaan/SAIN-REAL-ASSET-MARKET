import pg from 'pg';

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sra_users (
  email TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sra_sessions (
  token_hash TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sra_private_documents (
  document_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sra_domain_records (
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (record_type, record_id)
);

CREATE TABLE IF NOT EXISTS sra_audit_events (
  event_id BIGSERIAL PRIMARY KEY,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sra_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  actor_id TEXT,
  resource_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PROCESSING', 'COMPLETED')),
  response_status INTEGER,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sra_operation_locks (
  resource_key TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sra_sessions_expires_at_idx ON sra_sessions (expires_at);
CREATE INDEX IF NOT EXISTS sra_domain_records_type_idx ON sra_domain_records (record_type);
CREATE INDEX IF NOT EXISTS sra_audit_events_object_idx ON sra_audit_events (object_type, object_id);
CREATE INDEX IF NOT EXISTS sra_audit_events_occurred_idx ON sra_audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS sra_audit_events_type_idx ON sra_audit_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sra_idempotency_expires_idx ON sra_idempotency_keys (expires_at);
CREATE INDEX IF NOT EXISTS sra_operation_locks_expires_idx ON sra_operation_locks (expires_at);
`;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class DatabaseService {
  constructor({ connectionString = process.env.DATABASE_URL } = {}) {
    this.connectionString = connectionString || '';
    this.pool = null;
    this.mode = this.connectionString ? 'POSTGRES' : 'MEMORY_FALLBACK';
    this.memory = {
      users: new Map(),
      sessions: new Map(),
      documents: new Map(),
      records: new Map(),
      audit: [],
      idempotency: new Map(),
      operationLocks: new Map(),
    };
  }

  async initialize() {
    if (!this.connectionString) return { mode: this.mode, ready: true };
    this.pool = new Pool({
      connectionString: this.connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.SRA_DB_POOL_SIZE) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    await this.pool.query(SCHEMA);
    await this.pool.query('DELETE FROM sra_sessions WHERE expires_at < NOW()');
    await this.pool.query('DELETE FROM sra_operation_locks WHERE expires_at < NOW()');
    await this.pool.query('DELETE FROM sra_idempotency_keys WHERE expires_at < NOW()');
    return { mode: this.mode, ready: true };
  }

  async health() {
    if (!this.pool) return { mode: this.mode, ready: true, persistent: false };
    const result = await this.pool.query('SELECT NOW() AS now');
    return { mode: this.mode, ready: true, persistent: true, databaseTime: result.rows[0].now };
  }

  async listUsers() {
    if (!this.pool) return [...this.memory.users.values()].map(clone);
    const result = await this.pool.query('SELECT payload FROM sra_users ORDER BY created_at');
    return result.rows.map((row) => row.payload);
  }

  async putUser(email, payload) {
    if (!this.pool) { this.memory.users.set(email, clone(payload)); return; }
    await this.pool.query(
      `INSERT INTO sra_users (email, payload) VALUES ($1, $2::jsonb)
       ON CONFLICT (email) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [email, JSON.stringify(payload)]
    );
  }

  async listSessions() {
    if (!this.pool) return [...this.memory.sessions.values()].map(clone);
    const result = await this.pool.query('SELECT payload FROM sra_sessions WHERE expires_at >= NOW()');
    return result.rows.map((row) => row.payload);
  }

  async putSession(tokenHash, payload) {
    if (!this.pool) { this.memory.sessions.set(tokenHash, clone(payload)); return; }
    await this.pool.query(
      `INSERT INTO sra_sessions (token_hash, payload, expires_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (token_hash) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
      [tokenHash, JSON.stringify(payload), new Date(payload.expiresAt)]
    );
  }

  async deleteSession(tokenHash) {
    if (!this.pool) { this.memory.sessions.delete(tokenHash); return; }
    await this.pool.query('DELETE FROM sra_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async listDocuments() {
    if (!this.pool) return [...this.memory.documents.values()].map(clone);
    const result = await this.pool.query('SELECT payload FROM sra_private_documents ORDER BY created_at');
    return result.rows.map((row) => row.payload);
  }

  async putDocument(documentId, payload) {
    if (!this.pool) { this.memory.documents.set(documentId, clone(payload)); return; }
    await this.pool.query(
      `INSERT INTO sra_private_documents (document_id, payload) VALUES ($1, $2::jsonb)
       ON CONFLICT (document_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [documentId, JSON.stringify(payload)]
    );
  }

  async putRecord(recordType, recordId, payload) {
    const key = `${recordType}:${recordId}`;
    if (!this.pool) { this.memory.records.set(key, clone(payload)); return; }
    await this.pool.query(
      `INSERT INTO sra_domain_records (record_type, record_id, payload) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (record_type, record_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [recordType, recordId, JSON.stringify(payload)]
    );
  }

  async listRecords(recordType) {
    if (!this.pool) {
      return [...this.memory.records.entries()]
        .filter(([key]) => key.startsWith(`${recordType}:`))
        .map(([, value]) => clone(value));
    }
    const result = await this.pool.query('SELECT payload FROM sra_domain_records WHERE record_type = $1 ORDER BY created_at', [recordType]);
    return result.rows.map((row) => row.payload);
  }

  async claimIdempotency({ key, fingerprint, actorId = null, resourceKey, ttlMs }) {
    const expiresAt = new Date(Date.now() + ttlMs);
    if (!this.pool) {
      const now = Date.now();
      for (const [storedKey, entry] of this.memory.idempotency.entries()) if (new Date(entry.expiresAt).getTime() <= now) this.memory.idempotency.delete(storedKey);
      for (const [storedKey, entry] of this.memory.operationLocks.entries()) if (new Date(entry.expiresAt).getTime() <= now) this.memory.operationLocks.delete(storedKey);
      const existing = this.memory.idempotency.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { state: 'CONFLICT' };
        if (existing.state === 'COMPLETED') return { state: 'REPLAY', statusCode: existing.responseStatus, body: clone(existing.responseBody) };
        return { state: 'IN_PROGRESS' };
      }
      const lock = this.memory.operationLocks.get(resourceKey);
      if (lock) return { state: 'RESOURCE_BUSY', resourceKey };
      this.memory.operationLocks.set(resourceKey, { key, actorId, expiresAt: expiresAt.toISOString() });
      this.memory.idempotency.set(key, { key, fingerprint, actorId, resourceKey, state: 'PROCESSING', expiresAt: expiresAt.toISOString() });
      return { state: 'CLAIMED' };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM sra_operation_locks WHERE expires_at < NOW()');
      await client.query('DELETE FROM sra_idempotency_keys WHERE expires_at < NOW()');
      const existing = await client.query(
        'SELECT fingerprint, state, response_status, response_body FROM sra_idempotency_keys WHERE idempotency_key = $1 FOR UPDATE',
        [key]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        const row = existing.rows[0];
        if (row.fingerprint !== fingerprint) return { state: 'CONFLICT' };
        if (row.state === 'COMPLETED') return { state: 'REPLAY', statusCode: row.response_status, body: row.response_body };
        return { state: 'IN_PROGRESS' };
      }
      const lock = await client.query(
        `INSERT INTO sra_operation_locks (resource_key, idempotency_key, actor_id, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (resource_key) DO NOTHING
         RETURNING resource_key`,
        [resourceKey, key, actorId, expiresAt]
      );
      if (!lock.rowCount) {
        await client.query('ROLLBACK');
        return { state: 'RESOURCE_BUSY', resourceKey };
      }
      await client.query(
        `INSERT INTO sra_idempotency_keys (idempotency_key, fingerprint, actor_id, resource_key, state, expires_at)
         VALUES ($1, $2, $3, $4, 'PROCESSING', $5)`,
        [key, fingerprint, actorId, resourceKey, expiresAt]
      );
      await client.query('COMMIT');
      return { state: 'CLAIMED' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error?.code === '23505') return { state: 'IN_PROGRESS' };
      throw error;
    } finally {
      client.release();
    }
  }

  async completeIdempotency({ key, fingerprint, statusCode, body }) {
    if (!this.pool) {
      const entry = this.memory.idempotency.get(key);
      if (!entry || entry.fingerprint !== fingerprint) return false;
      entry.state = 'COMPLETED';
      entry.responseStatus = statusCode;
      entry.responseBody = clone(body);
      this.memory.operationLocks.delete(entry.resourceKey);
      return true;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE sra_idempotency_keys
         SET state = 'COMPLETED', response_status = $3, response_body = $4::jsonb, updated_at = NOW()
         WHERE idempotency_key = $1 AND fingerprint = $2 AND state = 'PROCESSING'
         RETURNING resource_key`,
        [key, fingerprint, statusCode, JSON.stringify(body)]
      );
      if (result.rows[0]) await client.query('DELETE FROM sra_operation_locks WHERE resource_key = $1 AND idempotency_key = $2', [result.rows[0].resource_key, key]);
      await client.query('COMMIT');
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseIdempotency(key) {
    if (!this.pool) {
      const entry = this.memory.idempotency.get(key);
      if (entry) this.memory.operationLocks.delete(entry.resourceKey);
      this.memory.idempotency.delete(key);
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query("DELETE FROM sra_idempotency_keys WHERE idempotency_key = $1 AND state = 'PROCESSING' RETURNING resource_key", [key]);
      if (result.rows[0]) await client.query('DELETE FROM sra_operation_locks WHERE resource_key = $1 AND idempotency_key = $2', [result.rows[0].resource_key, key]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async audit({ actorId = null, eventType, objectType = null, objectId = null, payload = {} }) {
    const event = { actorId, eventType, objectType, objectId, payload, occurredAt: new Date().toISOString() };
    if (!this.pool) { this.memory.audit.push(clone(event)); return event; }
    const result = await this.pool.query(
      'INSERT INTO sra_audit_events (actor_id, event_type, object_type, object_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING event_id, occurred_at',
      [actorId, eventType, objectType, objectId, JSON.stringify(payload)]
    );
    return { ...event, eventId: result.rows[0].event_id, occurredAt: result.rows[0].occurred_at };
  }

  async listAuditEvents({ actorId = null, eventType = null, objectType = null, objectId = null, since = null, limit = 100 } = {}) {
    const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    if (!this.pool) {
      return this.memory.audit
        .filter((event) => !actorId || event.actorId === actorId)
        .filter((event) => !eventType || event.eventType === eventType)
        .filter((event) => !objectType || event.objectType === objectType)
        .filter((event) => !objectId || event.objectId === objectId)
        .filter((event) => !since || new Date(event.occurredAt) >= new Date(since))
        .slice(-boundedLimit)
        .reverse()
        .map(clone);
    }
    const where = [];
    const values = [];
    const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
    if (actorId) add('actor_id = ?', actorId);
    if (eventType) add('event_type = ?', eventType);
    if (objectType) add('object_type = ?', objectType);
    if (objectId) add('object_id = ?', objectId);
    if (since) add('occurred_at >= ?', new Date(since));
    values.push(boundedLimit);
    const result = await this.pool.query(
      `SELECT event_id, actor_id, event_type, object_type, object_id, payload, occurred_at
       FROM sra_audit_events
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY occurred_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      actorId: row.actor_id,
      eventType: row.event_type,
      objectType: row.object_type,
      objectId: row.object_id,
      payload: row.payload,
      occurredAt: row.occurred_at,
    }));
  }

  async auditSummary({ since = null } = {}) {
    const events = await this.listAuditEvents({ since, limit: 500 });
    const byType = {};
    const byActor = {};
    for (const event of events) {
      byType[event.eventType] = (byType[event.eventType] || 0) + 1;
      const actor = event.actorId || 'SYSTEM';
      byActor[actor] = (byActor[actor] || 0) + 1;
    }
    return { total: events.length, byType, byActor, newest: events[0]?.occurredAt || null, oldest: events.at(-1)?.occurredAt || null };
  }
}
