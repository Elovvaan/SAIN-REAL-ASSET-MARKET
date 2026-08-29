import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DataEncryptionService } from '../services/data-encryption-service.js';
import { PrivateDocumentService } from '../services/private-document-service.js';

const KEY_ONE = Buffer.alloc(32, 0x11).toString('base64');
const KEY_TWO = Buffer.alloc(32, 0x22).toString('base64');

function encryptedService(keyId = 'v1', key = KEY_ONE) {
  return new DataEncryptionService({ env: { SRA_DATA_ENCRYPTION_KEY: key, SRA_DATA_ENCRYPTION_KEY_ID: keyId } });
}

test('AES-256-GCM envelope round-trips and is non-deterministic', () => {
  const service = encryptedService();
  const plaintext = Buffer.from('private financing evidence');
  const first = service.encrypt(plaintext, { context: 'PRIVATE_DOCUMENT_BODY:DOC-1' });
  const second = service.encrypt(plaintext, { context: 'PRIVATE_DOCUMENT_BODY:DOC-1' });
  assert.equal(service.isEncrypted(first), true);
  assert.notDeepEqual(first, second);
  assert.deepEqual(service.decrypt(first, { context: 'PRIVATE_DOCUMENT_BODY:DOC-1' }), plaintext);
  assert.deepEqual(service.status(), { configured: true, algorithm: 'AES-256-GCM', version: 1, activeKeyId: 'v1', availableKeyIds: ['v1'] });
});

test('authenticated encryption rejects tampering and ciphertext moved to another document context', () => {
  const service = encryptedService();
  const encrypted = service.encrypt(Buffer.from('confidential'), { context: 'PRIVATE_DOCUMENT_BODY:DOC-A' });
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => service.decrypt(tampered, { context: 'PRIVATE_DOCUMENT_BODY:DOC-A' }));
  assert.throws(() => service.decrypt(encrypted, { context: 'PRIVATE_DOCUMENT_BODY:DOC-B' }));
});

test('keyring keeps old keys available while a new key becomes active', () => {
  const oldService = encryptedService('v1', KEY_ONE);
  const oldCiphertext = oldService.encrypt(Buffer.from('historical body'), { context: 'PRIVATE_DOCUMENT_BODY:DOC-9' });
  const rotated = new DataEncryptionService({
    env: {
      SRA_DATA_ENCRYPTION_KEYS: JSON.stringify({ v1: KEY_ONE, v2: KEY_TWO }),
      SRA_DATA_ENCRYPTION_ACTIVE_KEY_ID: 'v2',
    },
  });
  assert.equal(rotated.status().activeKeyId, 'v2');
  assert.equal(rotated.decrypt(oldCiphertext, { context: 'PRIVATE_DOCUMENT_BODY:DOC-9' }).toString(), 'historical body');
  const newCiphertext = rotated.encrypt(Buffer.from('new body'), { context: 'PRIVATE_DOCUMENT_BODY:DOC-10' });
  assert.equal(rotated.decrypt(newCiphertext, { context: 'PRIVATE_DOCUMENT_BODY:DOC-10' }).toString(), 'new body');
});

test('private document filesystem body is ciphertext while service reads original bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sra-encryption-test-'));
  try {
    const service = new PrivateDocumentService({
      root,
      encryptionService: encryptedService(),
      extractionService: { async extract() { return { status: 'NOT_APPLICABLE', facts: null }; } },
    });
    const original = Buffer.from('bank package private body');
    const result = await service.store({
      file: { buffer: original, originalname: 'package.txt', mimetype: 'text/plain', size: original.length },
      documentType: 'FUNDING_PACKAGE',
      uploaderId: 'USR-TEST',
    });
    assert.equal(result.ok, true);
    assert.equal(result.document.bodyProtection.encrypted, true);
    assert.equal(result.document.bodyProtection.algorithm, 'AES-256-GCM');
    const record = service.get(result.document.id);
    const stored = await fs.readFile(record.storagePath);
    assert.equal(stored.includes(original), false);
    assert.equal(stored.subarray(0, 5).toString('ascii'), 'SRAE1');
    assert.deepEqual(await service.read(result.document.id), original);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unconfigured encryption service preserves legacy plaintext compatibility', () => {
  const service = new DataEncryptionService({ env: {} });
  assert.equal(service.configured(), false);
  assert.equal(service.isEncrypted(Buffer.from('legacy')), false);
  assert.deepEqual(service.decrypt(Buffer.from('legacy'), { allowPlaintext: true }), Buffer.from('legacy'));
});
