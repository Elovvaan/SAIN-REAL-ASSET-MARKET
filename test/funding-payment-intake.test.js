import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingProjection, participantVault } from '../routes/access-router.js';
import { PersistentMarketplaceService } from '../services/persistent-marketplace-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

const session = { id: 'USR-ONE', universalAccountId: 'UA-ONE', displayName: 'Owner', activeCapacity: 'UNIVERSAL' };

function domainWith(records = {}) {
  return { list(type) { return records[type] || []; } };
}

test('funding instructions do not imply credited balance', () => {
  const projection = fundingProjection({
    fundingInstructionId: 'FUND-1', purpose: 'ASSET_VAULT_FUNDING', amount: 500,
    currency: 'USD', rail: 'ACH', state: 'AWAITING_EXTERNAL_TRANSFER', createdAt: '2026-08-04T00:00:00Z'
  });
  assert.equal(projection.state, 'AWAITING_EXTERNAL_TRANSFER');
  assert.equal(projection.amount, 500);
  assert.equal(projection.confirmedAt, null);
});

test('confirmed vault funding increases the participant recorded balance', () => {
  const marketplace = new PersistentMarketplaceService(domainWith({
    [RECORD_TYPES.VERIFIED_MARKET_EVENT]: [{
      eventId: 'VME-FUND', eventType: 'PARTICIPANT_FUNDS_CONFIRMED', participantId: 'USR-ONE',
      fromAccountId: 'EXTERNAL_SOURCE', toAccountId: 'UA-ONE', amount: 1000, currency: 'USD',
      state: 'VERIFIED', verifiedAt: '2026-08-04T00:00:00Z', occurredAt: '2026-08-04T00:00:00Z'
    }]
  }));
  const vault = participantVault(session, marketplace.transactions);
  assert.equal(vault.recordedBalance, 1000);
  assert.equal(vault.incomingTotal, 1000);
});

test('direct external fee payment is recorded but does not reduce Asset Vault balance', () => {
  const marketplace = new PersistentMarketplaceService(domainWith({
    [RECORD_TYPES.VERIFIED_MARKET_EVENT]: [{
      eventId: 'VME-FEE', eventType: 'PLATFORM_FEE_PAYMENT_CONFIRMED', participantId: 'USR-ONE',
      fromAccountId: 'UA-ONE', toAccountId: 'GL-CASH-OPERATING', amount: 75, currency: 'USD',
      state: 'VERIFIED', verifiedAt: '2026-08-04T00:00:00Z', occurredAt: '2026-08-04T00:00:00Z'
    }]
  }));
  const vault = participantVault(session, marketplace.transactions);
  assert.equal(vault.recordedBalance, 0);
  assert.equal(vault.outgoingTotal, 0);
  assert.equal(vault.transactionCount, 1);
});
