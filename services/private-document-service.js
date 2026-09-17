import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DataEncryptionService } from './data-encryption-service.js';
import { TransactionDocumentExtractionService } from './transaction-document-extraction-service.js';
import { TransactionFactsMappingService } from './transaction-facts-mapping-service.js';

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg','image/png','image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/csv','application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const extractableMimeTypes = new Set(['application/pdf','image/jpeg','image/png','image/webp']);

function createId() { return `DOC-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function safeExtension(originalName = '') {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return ext.slice(0, 10);
}
function retentionMetadata({ uploadedAt, retentionPolicy = 'PRIVATE_EVIDENCE', retentionReferenceId = null } = {}) {
  const reviewAt = new Date(new Date(uploadedAt).getTime() + TWO_YEARS_MS).toISOString();
  return {
    retentionPolicy,
    retentionReferenceId,
    retentionReviewAt: reviewAt,
    dispositionState: 'RETAIN',
    legalHold: false,
    lastUsedAt: uploadedAt,
  };
}

export class PrivateDocumentService {
  constructor({ root = process.env.SRA_PRIVATE_DOCUMENT_ROOT || '/tmp/sra-private-documents', database = null, extractionService = null, encryptionService = null } = {}) {
    this.root = root;
    this.database = database;
    this.extractionService = extractionService || new TransactionDocumentExtractionService();
    this.encryption = encryptionService || new DataEncryptionService();
    this.records = new Map();
    this.storageReady = false;
    this.storageInitialization = null;
    this.ready = false;
    this.initialization = null;
  }

  bodyContext(documentId) { return `PRIVATE_DOCUMENT_BODY:${documentId}`; }
  protectBody(documentId, content) { return this.encryption.configured() ? this.encryption.encrypt(content, { context: this.bodyContext(documentId) }) : Buffer.from(content); }
  unprotectBody(documentId, content) { return this.encryption.isEncrypted(content) ? this.encryption.decrypt(content, { context: this.bodyContext(documentId) }) : Buffer.from(content); }

  async migrateDatabaseBodies() {
    if (!this.database?.pool || !this.encryption.configured()) return { migrated: 0 };
    const result = await this.database.pool.query('SELECT document_id, content FROM sra_private_document_bodies ORDER BY created_at');
    let migrated = 0;
    for (const row of result.rows) {
      if (this.encryption.isEncrypted(row.content)) continue;
      const protectedBody = this.protectBody(row.document_id, row.content);
      const protection = this.encryption.protectionMetadata();
      const client = await this.database.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE sra_private_document_bodies SET content = $2, updated_at = NOW() WHERE document_id = $1', [row.document_id, protectedBody]);
        await client.query(
          `UPDATE sra_private_documents
           SET payload = jsonb_set(payload, '{bodyProtection}', $2::jsonb, true), updated_at = NOW()
           WHERE document_id = $1`,
          [row.document_id, JSON.stringify(protection)]
        );
        await client.query('COMMIT');
        migrated += 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    if (migrated && this.database?.audit) {
      await this.database.audit({ eventType: 'PRIVATE_DOCUMENT_BODIES_ENCRYPTED', objectType: 'PRIVATE_DOCUMENT_STORAGE', objectId: this.encryption.status().activeKeyId, payload: { migrated, protection: this.encryption.protectionMetadata() } });
    }
    return { migrated };
  }

  async ensureStorageReady() {
    if (this.storageReady) return;
    if (!this.storageInitialization) {
      this.storageInitialization = (async () => {
        await fs.mkdir(this.root, { recursive: true });
        if (this.database?.pool) {
          await this.database.pool.query(`
            CREATE TABLE IF NOT EXISTS sra_private_document_bodies (
              document_id TEXT PRIMARY KEY,
              content BYTEA NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `);
        }
        this.storageReady = true;
      })().catch((error) => {
        this.storageInitialization = null;
        throw error;
      });
    }
    await this.storageInitialization;
  }

  async initialize() {
    if (this.ready) return;
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      await this.ensureStorageReady();
      if (this.database?.pool) {
      await this.database.pool.query(`
        INSERT INTO sra_private_document_bodies (document_id, content)
        SELECT document_id, decode(payload->>'contentBase64', 'base64')
        FROM sra_private_documents
        WHERE payload ? 'contentBase64' AND COALESCE(payload->>'contentBase64', '') <> ''
        ON CONFLICT (document_id) DO NOTHING
      `);
      await this.database.pool.query(`
        UPDATE sra_private_documents
        SET payload = payload - 'contentBase64', updated_at = NOW()
        WHERE payload ? 'contentBase64'
      `);
      await this.migrateDatabaseBodies();
      const result = await this.database.pool.query("SELECT payload - 'contentBase64' AS payload FROM sra_private_documents ORDER BY created_at");
      result.rows.forEach((row) => this.records.set(row.payload.id, row.payload));
      } else if (this.database) {
        const records = await this.database.listDocuments();
        records.forEach((record) => {
          const { contentBase64, ...metadata } = record;
          this.records.set(metadata.id, metadata);
        });
      }
      this.ready = true;
    })().catch((error) => {
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  validateFile(file) {
    if (!file) return 'A document file is required.';
    const mimetype = String(file.mimetype || '').toLowerCase();
    const supported = allowedMimeTypes.has(mimetype) || mimetype.startsWith('image/');
    if (!supported) return 'Unsupported document type.';
    if (file.size > 15 * 1024 * 1024) return 'Each document must be 15 MB or smaller.';
    return null;
  }

  async store({ file, documentType = 'OTHER', uploaderId = null, retentionPolicy = 'PRIVATE_EVIDENCE', retentionReferenceId = null, deferExtraction = false }) {
    const validationError = this.validateFile(file);
    if (validationError) return { ok: false, error: validationError };
    // A new upload only needs its storage target. Historical metadata loading and
    // body migration stay outside the request path so large document sets cannot
    // occupy the database pool before this file is accepted.
    await this.ensureStorageReady();
    const id = createId();
    const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const protectedBody = this.protectBody(id, file.buffer);
    const storedName = `${id}${safeExtension(file.originalname)}`;
    const storagePath = path.join(this.root, storedName);
    await fs.writeFile(storagePath, protectedBody, { flag: 'wx' });
    const uploadedAt = new Date().toISOString();
    let extraction = { status: extractableMimeTypes.has(String(file.mimetype || '').toLowerCase()) ? 'PENDING' : 'NOT_APPLICABLE', documentId: id, sha256: digest, facts: null };
    if (!deferExtraction && extractableMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      try {
        extraction = await this.extractionService.extract({
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname,
          documentId: id,
          sha256: digest,
        });
      } catch (error) {
        extraction = { status: 'EXTRACTION_ERROR', documentId: id, sha256: digest, facts: null, error: error.message, attemptedAt: new Date().toISOString() };
      }
    }
    const record = {
      id, documentType, originalName: file.originalname, mimeType: file.mimetype,
      size: file.size, sha256: digest, storageClass: 'PRIVATE_EVIDENCE',
      accessState: 'RESTRICTED', uploaderId, uploadedAt,
      reviewState: 'SUBMITTED', public: false, storagePath,
      bodyProtection: this.encryption.protectionMetadata(),
      extraction,
      ...retentionMetadata({ uploadedAt, retentionPolicy, retentionReferenceId }),
    };
    if (this.database?.pool) {
      const client = await this.database.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO sra_private_document_bodies (document_id, content) VALUES ($1, $2)
           ON CONFLICT (document_id) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
          [id, protectedBody]
        );
        const persisted = { ...record };
        delete persisted.storagePath;
        await client.query(
          `INSERT INTO sra_private_documents (document_id, payload) VALUES ($1, $2::jsonb)
           ON CONFLICT (document_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [id, JSON.stringify(persisted)]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } else if (this.database) {
      await this.database.putDocument(id, record);
    }
    this.records.set(id, record);

    let mapping = null;
    const domain = this.database?.persistentDomain || null;
    if (domain && retentionReferenceId && extraction.status === 'EXTRACTED' && domain.get('FUNDING_OPPORTUNITY', retentionReferenceId)) {
      mapping = await new TransactionFactsMappingService(domain).applyToOpportunity(retentionReferenceId, this.toPublicMetadata(record), uploaderId);
    }

    if (this.database) {
      await this.database.audit({
        actorId: uploaderId,
        eventType: 'PRIVATE_DOCUMENT_STORED',
        objectType: 'PRIVATE_DOCUMENT',
        objectId: id,
        payload: {
          sha256: digest,
          documentType,
          size: file.size,
          retentionPolicy: record.retentionPolicy,
          retentionReferenceId: record.retentionReferenceId,
          retentionReviewAt: record.retentionReviewAt,
          extractionStatus: extraction.status,
          extractedTransactionType: extraction.facts?.transactionType || null,
          transactionFactsMapped: Boolean(mapping?.mapped),
          bodyProtection: record.bodyProtection,
        }
      });
    }
    return { ok: true, document: this.toPublicMetadata(record), mapping };
  }

  async processExtraction(id, { retentionReferenceId = null, uploaderId = null } = {}) {
    const current = this.get(id);
    if (!current) throw new Error('Private document was not found.');
    if (current.extraction?.status !== 'PENDING') return { document: this.toPublicMetadata(current), mapping: null };

    const buffer = await this.read(id);
    if (!buffer) throw new Error('Private document body was not found.');
    let extraction;
    try {
      extraction = await this.extractionService.extract({
        buffer,
        mimeType: current.mimeType,
        filename: current.originalName,
        documentId: id,
        sha256: current.sha256,
      });
    } catch (error) {
      extraction = { status: 'EXTRACTION_ERROR', documentId: id, sha256: current.sha256, facts: null, error: error.message, attemptedAt: new Date().toISOString() };
    }

    const updated = { ...current, extraction };
    this.records.set(id, updated);
    if (this.database?.pool) {
      const persisted = { ...updated };
      delete persisted.storagePath;
      await this.database.pool.query(
        `UPDATE sra_private_documents SET payload = $2::jsonb, updated_at = NOW() WHERE document_id = $1`,
        [id, JSON.stringify(persisted)]
      );
    } else if (this.database) {
      await this.database.putDocument(id, updated);
    }

    let mapping = null;
    const domain = this.database?.persistentDomain || null;
    const opportunityId = retentionReferenceId || current.retentionReferenceId || null;
    if (domain && opportunityId && extraction.status === 'EXTRACTED' && domain.get('FUNDING_OPPORTUNITY', opportunityId)) {
      mapping = await new TransactionFactsMappingService(domain).applyToOpportunity(opportunityId, this.toPublicMetadata(updated), uploaderId);
    }
    if (this.database?.audit) {
      await this.database.audit({
        actorId: uploaderId,
        eventType: 'PRIVATE_DOCUMENT_EXTRACTION_COMPLETED',
        objectType: 'PRIVATE_DOCUMENT',
        objectId: id,
        payload: { extractionStatus: extraction.status, transactionFactsMapped: Boolean(mapping?.mapped), retentionReferenceId: opportunityId },
      });
    }
    return { document: this.toPublicMetadata(updated), mapping };
  }

  get(id) { return this.records.get(id) || null; }

  async read(id) {
    const record = this.get(id);
    if (!record) return null;
    if (this.database?.pool) {
      const result = await this.database.pool.query('SELECT content FROM sra_private_document_bodies WHERE document_id = $1', [id]);
      if (result.rows[0]?.content) {
        const stored = result.rows[0].content;
        if (!this.encryption.isEncrypted(stored) && this.encryption.configured()) {
          const protectedBody = this.protectBody(id, stored);
          await this.database.pool.query('UPDATE sra_private_document_bodies SET content = $2, updated_at = NOW() WHERE document_id = $1', [id, protectedBody]);
          return Buffer.from(stored);
        }
        return this.unprotectBody(id, stored);
      }
    }
    try {
      const stored = await fs.readFile(record.storagePath);
      if (!this.encryption.isEncrypted(stored) && this.encryption.configured()) await fs.writeFile(record.storagePath, this.protectBody(id, stored));
      return this.unprotectBody(id, stored);
    } catch { return null; }
  }

  async markUsed(id, actorId = null) {
    const record = this.get(id);
    if (!record) return null;
    const lastUsedAt = new Date().toISOString();
    const updated = {
      ...record,
      lastUsedAt,
      retentionReviewAt: new Date(new Date(lastUsedAt).getTime() + TWO_YEARS_MS).toISOString(),
    };
    this.records.set(id, updated);
    if (this.database) {
      const persisted = { ...updated };
      delete persisted.storagePath;
      await this.database.putDocument(id, persisted);
      await this.database.audit({ actorId, eventType: 'PRIVATE_DOCUMENT_ACCESSED', objectType: 'PRIVATE_DOCUMENT', objectId: id, payload: { retentionReviewAt: updated.retentionReviewAt } });
    }
    return this.toPublicMetadata(updated);
  }

  toPublicMetadata(record) {
    if (!record) return null;
    const { storagePath, contentBase64, ...metadata } = record;
    return metadata;
  }
  listMetadata() { return [...this.records.values()].map((record) => this.toPublicMetadata(record)); }
}
