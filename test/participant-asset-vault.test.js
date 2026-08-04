import test from 'node:test';
import assert from 'node:assert/strict';
import { participantVault } from '../routes/access-router.js';

const session = {
  id: 'USR-ONE',
  universalAccountId: 'UA-ONE',
  displayName: 'Vault Owner',
  activeCapacity: 'UNIVERSAL'
};

test('participant vault remains zero without participant-linked transactions', () => {
  const vault = participantVault(session, [
    { transactionId: 'TX-OTHER', participantId: 'USR-OTHER', amount: 500, state: 'COMPLETED' }
  ]);
  assert.equal(vault.recordedBalance, 0);
  assert.equal(vault.transactionCount, 0);
  assert.equal(vault.ownership, 'PARTICIPANT');
  assert.equal(vault.platformRole, 'INFRASTRUCTURE');
});

test('participant vault calculates completed directional activity only', () => {
  const vault = participantVault(session, [
    { transactionId: 'TX-IN', toAccountId: 'UA-ONE', amount: 1000, state: 'SETTLED', verified: true },
    { transactionId: 'TX-OUT', fromAccountId: 'UA-ONE', amount: 250, state: 'POSTED', verified: false },
    { transactionId: 'TX-PENDING', toAccountId: 'UA-ONE', amount: 400, state: 'PENDING', verified: false },
    { transactionId: 'TX-RECORDED', participantId: 'USR-ONE', amount: 900, state: 'RECORDED', verified: false }
  ]);
  assert.equal(vault.recordedBalance, 750);
  assert.equal(vault.incomingTotal, 1000);
  assert.equal(vault.outgoingTotal, 250);
  assert.equal(vault.transactionCount, 4);
  assert.equal(vault.completedTransactionCount, 2);
  assert.equal(vault.pendingTransactionCount, 1);
  assert.equal(vault.verifiedTransactionCount, 1);
  assert.equal(vault.transactions.find((item) => item.transactionId === 'TX-RECORDED').direction, 'RECORDED');
});

test('internal movement does not change participant recorded balance', () => {
  const vault = participantVault(session, [
    { transactionId: 'TX-INTERNAL', fromAccountId: 'UA-ONE', toAccountId: 'USR-ONE', amount: 300, state: 'COMPLETED' }
  ]);
  assert.equal(vault.recordedBalance, 0);
  assert.equal(vault.transactions[0].direction, 'INTERNAL');
});
