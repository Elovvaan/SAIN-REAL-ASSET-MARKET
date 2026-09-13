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
