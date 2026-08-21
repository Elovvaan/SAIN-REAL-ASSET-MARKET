import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateDocumentService } from '../services/private-document-service.js';

const service = new PrivateDocumentService();
const file = (mimetype, size = 1024) => ({ mimetype, size });

test('private document validation accepts financing intake spreadsheet formats', () => {
  for (const mimetype of [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]) assert.equal(service.validateFile(file(mimetype)), null, mimetype);
});

test('private document validation accepts image MIME types advertised by the participant form', () => {
  for (const mimetype of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/avif']) {
    assert.equal(service.validateFile(file(mimetype)), null, mimetype);
  }
});

test('private document validation still rejects unrelated MIME types and oversized files', () => {
  assert.equal(service.validateFile(file('application/x-msdownload')), 'Unsupported document type.');
  assert.equal(service.validateFile(file('application/pdf', 15 * 1024 * 1024 + 1)), 'Each document must be 15 MB or smaller.');
});
