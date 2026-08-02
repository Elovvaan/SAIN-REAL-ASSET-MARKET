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

CREATE INDEX IF NOT EXISTS sra_sessions_expires_at_idx ON sra_sessions (expires_at);
CREATE INDEX IF NOT EXISTS sra_domain_records_type_idx ON sra_domain_records (record_type);
CREATE INDEX IF NOT EXISTS sra_audit_events_object_idx ON sra_audit_events (object_type, object_id);
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
      audit: []
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

  async audit({ actorId = null, eventType, objectType = null, objectId = null, payload = {} }) {
    const event = { actorId, eventType, objectType, objectId, payload, occurredAt: new Date().toISOString() };
    if (!this.pool) { this.memory.audit.push(clone(event)); return event; }
    await this.pool.query(
      'INSERT INTO sra_audit_events (actor_id, event_type, object_type, object_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [actorId, eventType, objectType, objectId, JSON.stringify(payload)]
    );
    return event;
  }
}
