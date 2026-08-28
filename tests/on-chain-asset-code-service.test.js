import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOnChainAssetCode, isValidOnChainAssetCode, resolveOnChainAssetCode } from '../services/on-chain-asset-code-service.js';

test('uses the compact SRA instrument id when it already fits the network limit', () => {
  assert.equal(generateOnChainAssetCode('LFA-7634C662'), 'LFA7634C662');
  assert.equal(generateOnChainAssetCode('SI-100'), 'SI100');
});

test('produces a deterministic 12-character code for long instrument ids', () => {
  const first = generateOnChainAssetCode('SRA-INSTRUMENT-LONG-000001');
  const second = generateOnChainAssetCode('SRA-INSTRUMENT-LONG-000001');
  assert.equal(first, second);
  assert.equal(first, 'SRAINSNHCO97');
  assert.match(first, /^[A-Z0-9]{12}$/);
});

test('prefers an explicitly requested code, then a stored instrument code, then generation', () => {
  assert.equal(resolveOnChainAssetCode({ instrumentId:'LFA-7634C662', instrument:{ assetCode:'stored1' }, requestedAsset:'manual9' }), 'MANUAL9');
  assert.equal(resolveOnChainAssetCode({ instrumentId:'LFA-7634C662', instrument:{ assetCode:'stored1' } }), 'STORED1');
  assert.equal(resolveOnChainAssetCode({ instrumentId:'LFA-7634C662', instrument:{} }), 'LFA7634C662');
});

test('validates network asset codes as one to twelve letters or numbers', () => {
  assert.equal(isValidOnChainAssetCode('LFA7634C662'), true);
  assert.equal(isValidOnChainAssetCode('ABC123'), true);
  assert.equal(isValidOnChainAssetCode('ABC-123'), false);
  assert.equal(isValidOnChainAssetCode('ABCDEFGHIJKLM'), false);
  assert.equal(isValidOnChainAssetCode(''), false);
});
