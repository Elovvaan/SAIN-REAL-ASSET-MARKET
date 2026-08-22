import test from 'node:test';
import assert from 'node:assert/strict';
import { BitcoinTransferService } from '../services/bitcoin-transfer-service.js';
import { EthereumTransferService } from '../services/ethereum-transfer-service.js';
import { XrplTransferService } from '../services/xrpl-transfer-service.js';
import { SolanaTransferService } from '../services/solana-transfer-service.js';

test('native network adapters expose the shared transfer capability without pretending issuance support', () => {
  const adapters = [
    new BitcoinTransferService({ environment: {} }),
    new EthereumTransferService({ environment: {} }),
    new XrplTransferService({ environment: {} }),
    new SolanaTransferService({ environment: {} }),
  ];
  const expected = [
    ['BITCOIN', 'BTC'],
    ['ETHEREUM', 'ETH'],
    ['XRPL', 'XRP'],
    ['SOLANA', 'SOL'],
  ];

  adapters.forEach((adapter, index) => {
    const status = adapter.status();
    assert.equal(status.network, expected[index][0]);
    assert.equal(status.nativeAsset, expected[index][1]);
    assert.deepEqual(status.capabilities, ['TRANSFER_NATIVE']);
    assert.deepEqual(status.assets, [expected[index][1]]);
    assert.equal(status.configured, false);
    assert.equal(status.ready, false);
    assert.equal(status.capabilities.includes('CREATE_ASSET'), false);
    assert.equal(status.capabilities.includes('ISSUE_ASSET'), false);
  });
});

test('unconfigured native network health reports not ready instead of attempting execution', async () => {
  const adapters = [
    new BitcoinTransferService({ environment: {} }),
    new EthereumTransferService({ environment: {} }),
    new XrplTransferService({ environment: {} }),
    new SolanaTransferService({ environment: {} }),
  ];
  for (const adapter of adapters) {
    const health = await adapter.health();
    assert.equal(health.ready, false);
    assert.equal(health.reachable, false);
  }
});
