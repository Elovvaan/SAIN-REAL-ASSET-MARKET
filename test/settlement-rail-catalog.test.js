import test from 'node:test';
import assert from 'node:assert/strict';
import { SettlementRailGatewayService, SETTLEMENT_RAIL_TYPES } from '../services/settlement-rail-gateway-service.js';

test('bank settlement rails expose ACH, Fedwire, and wire without making one rail mandatory', () => {
  assert.ok(SETTLEMENT_RAIL_TYPES.includes('ACH'));
  assert.ok(SETTLEMENT_RAIL_TYPES.includes('FEDWIRE'));
  assert.ok(SETTLEMENT_RAIL_TYPES.includes('WIRE'));

  const service = new SettlementRailGatewayService({ list: () => [] }, {}, {});
  const rails = service.supportedRails();
  const ach = rails.find((item) => item.rail === 'ACH');
  const fedwire = rails.find((item) => item.rail === 'FEDWIRE');
  const wire = rails.find((item) => item.rail === 'WIRE');

  assert.equal(ach.messageStandard, 'NACHA');
  assert.equal(fedwire.messageStandard, 'ISO_20022');
  assert.equal(wire.messageStandard, 'INSTITUTION_DEFINED');
  assert.equal(ach.executionMode, 'BANK_PARTNER');
  assert.equal(fedwire.executionMode, 'BANK_PARTNER');
});

test('direct Fedwire adapter requires a Federal Reserve account reference', async () => {
  const domain = {
    list: () => [],
    put: async () => {},
    lifecycle: async () => {},
  };
  const service = new SettlementRailGatewayService(domain, {}, {});
  await assert.rejects(
    () => service.registerAdapter({
      institutionId: 'SRA',
      rail: 'FEDWIRE',
      executionMode: 'DIRECT_PARTICIPANT',
      endpointReference: 'FEDLINE-DIRECT',
    }),
    /federalReserveAccountReference is required/
  );
});
