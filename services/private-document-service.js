import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const allowedMimeTypes = new Set([
  'application/pdf','image/jpeg','image/png','image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword','text/plain'
]);

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

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
  constructor({ root = process.env.SRA_PRIVATE_DOCUMENT_ROOT || '/tmp/sra-private-documents', database = null } = {}) {
    this.root = root;
    this.database = database;
    this.records = new Map();
    this.ready = false;
  }

  async initialize() {
    if (this.ready) return;
    await fs.mkdir(this.root, { recursive: true });
    if (this.database) {
      const records = await this.database.listDocuments();
      records.forEach((record) => this.records.set(record.id, record));
    }
    this.ready = true;
  }

  validateFile(file) {
    if (!file) return 'A document file is required.';
    if (!allowedMimeTypes.has(file.mimetype)) return 'Unsupported document type.';
    if (file.size > 15 * 1024 * 1024) return 'Each document must be 15 MB or smaller.';
    return null;
  }

  async store({ file, documentType = 'OTHER', uploaderId = null, retentionPolicy = 'PRIVATE_EVIDENCE', retentionReferenceId = null }) {
    const validationError = this.validateFile(file);
    if (validationError) return { ok: false, error: validationError };
    await this.initialize();
    const id = createId();
    const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const storedName = `${id}${safeExtension(file.originalname)}`;
    const storagePath = path.join(this.root, storedName);
    await fs.writeFile(storagePath, file.buffer, { flag: 'wx' });
    const uploadedAt = new Date().toISOString();
    const record = {
      id, documentType, originalName: file.originalname, mimeType: file.mimetype,
      size: file.size, sha256: digest, storageClass: 'PRIVATE_EVIDENCE',
      accessState: 'RESTRICTED', uploaderId, uploadedAt,
      reviewState: 'SUBMITTED', public: false, storagePath,
      contentBase64: this.database ? file.buffer.toString('base64') : null,
      ...retentionMetadata({ uploadedAt, retentionPolicy, retentionReferenceId }),
    };
    this.records.set(id, record);
    if (this.database) {
      await this.database.putDocument(id, record);
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
        }
      });
    }
    return { ok: true, document: this.toPublicMetadata(record) };
  }

  get(id) { return this.records.get(id) || null; }

  async read(id) {
    const record = this.get(id);
    if (!record) return null;
    if (record.contentBase64) return Buffer.from(record.contentBase64, 'base64');
    try { return await fs.readFile(record.storagePath); } catch { return null; }
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
      await this.database.putDocument(id, updated);
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
