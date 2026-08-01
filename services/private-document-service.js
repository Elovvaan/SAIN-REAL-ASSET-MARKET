import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain'
]);

function createId() {
  return `DOC-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

function safeExtension(originalName = '') {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return ext.slice(0, 10);
}

export class PrivateDocumentService {
  constructor({ root = process.env.SRA_PRIVATE_DOCUMENT_ROOT || '/tmp/sra-private-documents' } = {}) {
    this.root = root;
    this.records = new Map();
  }

  async initialize() {
    await fs.mkdir(this.root, { recursive: true });
  }

  validateFile(file) {
    if (!file) return 'A document file is required.';
    if (!allowedMimeTypes.has(file.mimetype)) return 'Unsupported document type.';
    if (file.size > 15 * 1024 * 1024) return 'Each document must be 15 MB or smaller.';
    return null;
  }

  async store({ file, documentType = 'OTHER', uploaderId = null }) {
    const validationError = this.validateFile(file);
    if (validationError) return { ok: false, error: validationError };

    await this.initialize();
    const id = createId();
    const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const storedName = `${id}${safeExtension(file.originalname)}`;
    const storagePath = path.join(this.root, storedName);
    await fs.writeFile(storagePath, file.buffer, { flag: 'wx' });

    const record = {
      id,
      documentType,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      sha256: digest,
      storageClass: 'PRIVATE_EVIDENCE',
      accessState: 'RESTRICTED',
      uploaderId,
      uploadedAt: new Date().toISOString(),
      reviewState: 'SUBMITTED',
      public: false,
      storagePath
    };

    this.records.set(id, record);
    return { ok: true, document: this.toPublicMetadata(record) };
  }

  get(id) {
    return this.records.get(id) || null;
  }

  toPublicMetadata(record) {
    if (!record) return null;
    const { storagePath, ...metadata } = record;
    return metadata;
  }

  listMetadata() {
    return [...this.records.values()].map((record) => this.toPublicMetadata(record));
  }
}
