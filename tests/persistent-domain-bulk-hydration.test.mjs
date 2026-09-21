import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseService } from '../services/database-service.js';
import { PersistentDomainService } from '../services/persistent-domain-service.js';

test('memory database returns requested record types through the bulk-read contract', async () => {
  const database = new DatabaseService();
  await database.putRecord('ASSET_ACCOUNT', 'A-0', { assetId: 'A-0' });
  await database.putRecord('PROJECT_ACCOUNT', 'P-0', { projectId: 'P-0' });

  const records = await database.listRecordsByTypes(['ASSET_ACCOUNT']);

  assert.deepEqual(records, [{ recordType: 'ASSET_ACCOUNT', payload: { assetId: 'A-0' } }]);
});

test('memory database summarizes record counts, states, and recent samples', async () => {
  const database = new DatabaseService();
  await database.putRecord('SRA_INSTRUMENT', 'I-1', { instrumentId:'I-1', state:'ISSUED' });
  await database.putRecord('SRA_INSTRUMENT', 'I-2', { instrumentId:'I-2', state:'REVIEW_REQUIRED' });
  await database.putRecord('COIN_POSITION', 'C-1', { coinPositionId:'C-1', state:'ACTIVE' });

  const summary = await database.summarizeRecords(['SRA_INSTRUMENT','COIN_POSITION'], { sampleLimit:1 });

  assert.equal(summary.counts.SRA_INSTRUMENT, 2);
  assert.deepEqual(summary.states.SRA_INSTRUMENT, { ISSUED:1, REVIEW_REQUIRED:1 });
  assert.equal(summary.samples.SRA_INSTRUMENT[0].instrumentId, 'I-2');
  assert.equal(summary.counts.COIN_POSITION, 1);
});

test('persistent domain hydrates requested record types with one database read', async () => {
  const calls = [];
  const database = {
    async listRecordsByTypes(types) {
      calls.push(types);
      return [
        { recordType: 'ASSET_ACCOUNT', payload: { assetId: 'A-1', name: 'Asset One' } },
        { recordType: 'PROJECT_ACCOUNT', payload: { projectId: 'P-1', title: 'Project One' } },
      ];
    },
  };
  const domain = new PersistentDomainService(database);

  await domain.hydrate(['ASSET_ACCOUNT', 'PROJECT_ACCOUNT', 'ASSET_ACCOUNT']);

  assert.deepEqual(calls, [['ASSET_ACCOUNT', 'PROJECT_ACCOUNT']]);
  assert.equal(domain.get('ASSET_ACCOUNT', 'A-1').name, 'Asset One');
  assert.equal(domain.get('PROJECT_ACCOUNT', 'P-1').title, 'Project One');
});

test('persistent domain retains compatibility with record-by-record database adapters', async () => {
  const calls = [];
  const database = {
    async listRecords(type) {
      calls.push(type);
      return type === 'ASSET_ACCOUNT' ? [{ assetId: 'A-2', name: 'Asset Two' }] : [];
    },
  };
  const domain = new PersistentDomainService(database);

  await domain.hydrate(['ASSET_ACCOUNT', 'PROJECT_ACCOUNT']);

  assert.deepEqual(calls, ['ASSET_ACCOUNT', 'PROJECT_ACCOUNT']);
  assert.equal(domain.get('ASSET_ACCOUNT', 'A-2').name, 'Asset Two');
});

test('persistent domain hydrates each record type once across repeated and overlapping lazy services', async () => {
  const calls = [];
  const database = {
    async listRecordsByTypes(types) {
      calls.push(types);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [];
    },
  };
  const domain = new PersistentDomainService(database);

  await Promise.all([
    domain.hydrate(['FUNDING_OPPORTUNITY', 'PARTICIPANT']),
    domain.hydrate(['PARTICIPANT', 'FINANCING_CLOSING']),
  ]);
  await domain.hydrate(['FUNDING_OPPORTUNITY', 'PARTICIPANT', 'FINANCING_CLOSING']);

  assert.equal(calls.flat().filter((type) => type === 'FUNDING_OPPORTUNITY').length, 1);
  assert.equal(calls.flat().filter((type) => type === 'PARTICIPANT').length, 1);
  assert.equal(calls.flat().filter((type) => type === 'FINANCING_CLOSING').length, 1);
});

test('failed hydration remains retryable', async () => {
  let attempts = 0;
  const domain = new PersistentDomainService({
    async listRecordsByTypes() {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary database failure');
      return [];
    },
  });

  await assert.rejects(domain.hydrate(['FUNDING_OPPORTUNITY']), /temporary database failure/);
  await domain.hydrate(['FUNDING_OPPORTUNITY']);
  assert.equal(attempts, 2);
});
