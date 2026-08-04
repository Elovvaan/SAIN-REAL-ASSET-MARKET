import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../routes/universal-account-blockchain-router.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('Universal Accounts can request a dedicated Base address record', () => {
  assert.match(router, /\/api\/blockchain-accounts\/me\/request/);
  assert.match(router, /AWAITING_PROVISIONING/);
  assert.match(router, /EXTERNALLY_PROVISIONED_DEPOSIT_ADDRESS/);
  assert.match(router, /privateKeyStoredBySra: false/);
});

test('only Platform Administration can provision a unique address', () => {
  assert.match(router, /activeCapacity !== 'PLATFORM_ADMIN'/);
  assert.match(router, /already assigned to another Universal Account/);
  assert.match(router, /state: 'ACTIVE'/);
});

test('crypto funding instructions use the participant dedicated address', () => {
  assert.match(router, /blockchainAccount\.depositAddress/);
  assert.match(router, /UNIVERSAL_ACCOUNT_DEDICATED_DEPOSIT_ADDRESS/);
  assert.match(router, /DEDICATED_ADDRESS_CRYPTO_FUNDING_INSTRUCTION_CREATED/);
  assert.doesNotMatch(router, /SRA_BASE_USDC_RECEIVING_ADDRESS/);
});

test('server routes dedicated address requests before the existing platform router', () => {
  assert.match(server, /createUniversalAccountBlockchainRouter/);
  assert.match(server, /req\.path\.startsWith\('\/api\/blockchain-accounts'\)/);
  assert.match(server, /req\.path === '\/api\/access\/funding\/crypto-instructions'/);
});
