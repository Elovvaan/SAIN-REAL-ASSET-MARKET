import crypto from 'node:crypto';

const MAGIC = Buffer.from('SRAE1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';

function decodeKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : null;
}

function parseKeyring(env = process.env) {
  const keys = new Map();
  const encodedKeyring = String(env.SRA_DATA_ENCRYPTION_KEYS || '').trim();
  if (encodedKeyring) {
    let parsed;
    try { parsed = JSON.parse(encodedKeyring); }
    catch { throw new Error('SRA_DATA_ENCRYPTION_KEYS must be a JSON object of key IDs to 32-byte base64 or 64-character hex keys.'); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('SRA_DATA_ENCRYPTION_KEYS must be a JSON object.');
    for (const [keyId, value] of Object.entries(parsed)) {
      const normalizedId = String(keyId || '').trim();
      const key = decodeKey(value);
      if (!normalizedId || Buffer.byteLength(normalizedId, 'utf8') > 255 || !key) throw new Error(`Invalid SRA data encryption key entry: ${normalizedId || '<empty>'}.`);
      keys.set(normalizedId, key);
    }
  }
  const single = decodeKey(env.SRA_DATA_ENCRYPTION_KEY);
  if (single) keys.set(String(env.SRA_DATA_ENCRYPTION_KEY_ID || 'primary').trim() || 'primary', single);
  else if (String(env.SRA_DATA_ENCRYPTION_KEY || '').trim()) throw new Error('SRA_DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return keys;
}

export class DataEncryptionService {
  constructor({ env = process.env } = {}) {
    this.keys = parseKeyring(env);
    this.activeKeyId = String(env.SRA_DATA_ENCRYPTION_ACTIVE_KEY_ID || env.SRA_DATA_ENCRYPTION_KEY_ID || '').trim();
    if (!this.activeKeyId && this.keys.size === 1) this.activeKeyId = this.keys.keys().next().value;
    if (this.keys.size && !this.activeKeyId) throw new Error('SRA_DATA_ENCRYPTION_ACTIVE_KEY_ID is required when multiple encryption keys are configured.');
    if (this.activeKeyId && !this.keys.has(this.activeKeyId)) throw new Error(`Active SRA data encryption key ${this.activeKeyId} is not configured.`);
  }

  configured() { return Boolean(this.activeKeyId && this.keys.has(this.activeKeyId)); }
  status() { return { configured: this.configured(), algorithm: 'AES-256-GCM', version: 1, activeKeyId: this.activeKeyId || null, availableKeyIds: [...this.keys.keys()] }; }
  isEncrypted(value) { const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || ''); return buffer.length > MAGIC.length && buffer.subarray(0, MAGIC.length).equals(MAGIC); }

  encrypt(value, { context = '' } = {}) {
    if (!this.configured()) throw new Error('SRA application data encryption is not configured.');
    const plaintext = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
    const keyIdBytes = Buffer.from(this.activeKeyId, 'utf8');
    if (keyIdBytes.length > 255) throw new Error('SRA data encryption key ID is too long.');
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.keys.get(this.activeKeyId), iv, { authTagLength: TAG_BYTES });
    if (context) cipher.setAAD(Buffer.from(String(context), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([MAGIC, Buffer.from([keyIdBytes.length]), keyIdBytes, iv, tag, ciphertext]);
  }

  decrypt(value, { context = '', allowPlaintext = false } = {}) {
    const envelope = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
    if (!this.isEncrypted(envelope)) {
      if (allowPlaintext) return envelope;
      throw new Error('SRA encrypted data envelope is required.');
    }
    let offset = MAGIC.length;
    const keyIdLength = envelope[offset]; offset += 1;
    const minimum = MAGIC.length + 1 + keyIdLength + IV_BYTES + TAG_BYTES;
    if (!keyIdLength || envelope.length < minimum) throw new Error('SRA encrypted data envelope is malformed.');
    const keyId = envelope.subarray(offset, offset + keyIdLength).toString('utf8'); offset += keyIdLength;
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`SRA data encryption key ${keyId} is unavailable.`);
    const iv = envelope.subarray(offset, offset + IV_BYTES); offset += IV_BYTES;
    const tag = envelope.subarray(offset, offset + TAG_BYTES); offset += TAG_BYTES;
    const ciphertext = envelope.subarray(offset);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    if (context) decipher.setAAD(Buffer.from(String(context), 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  protectionMetadata() {
    return this.configured() ? { encrypted: true, algorithm: 'AES-256-GCM', version: 1, keyId: this.activeKeyId } : { encrypted: false, algorithm: null, version: null, keyId: null };
  }
}
