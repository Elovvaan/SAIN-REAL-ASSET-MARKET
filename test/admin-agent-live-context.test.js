import test from 'node:test';
import assert from 'node:assert/strict';
import { SraAgentService } from '../services/sra-agent-service.js';

function createDomain() {
  return {
    snapshot() {
      return {
        TREASURY_CRYPTO_WALLET: 0,
        TREASURY_CRYPTO_ACTIVITY: 0,
        COIN_ACCOUNT: 0,
        COIN_POSITION: 0,
        SRA_TRANSACTION: 0
      };
    },
    get() { return null; }
  };
}

test('admin-supplied Coinbase status is preserved in the agent prompt', async () => {
  let captured = null;
  const client = {
    responses: {
      async create(payload) {
        captured = payload;
        return { id: 'resp-test', output_text: 'Coinbase connector is connected.' };
      }
    }
  };

  const service = new SraAgentService({
    persistentDomain: createDomain(),
    marketplace: null,
    client
  });

  const context = {
    privateAdministration: true,
    summary: {
      connectors: {
        coinbasePublicMarket: {
          provider: 'COINBASE',
          enabled: true,
          state: 'CONNECTED',
          products: ['BTC-USD'],
          receivedTrades: 41,
          recordedTrades: 40,
          lastTradeAt: '2026-08-04T22:00:00.000Z',
          lastError: null
        }
      },
      platform: {
        treasuryWallets: 0,
        coinPositions: 0,
        transactions: 0
      }
    }
  };

  const result = await service.chat({
    message: 'Is Coinbase connected?',
    scope: { operatingTier: 'PLATFORM_ADMIN' },
    context
  });

  const supplied = captured.input[0].content[1].text;
  assert.match(supplied, /liveAdministrativeContext/);
  assert.match(supplied, /coinbasePublicMarket/);
  assert.match(supplied, /CONNECTED/);
  assert.match(supplied, /recordedTrades/);
  assert.equal(result.liveContextIncluded, true);
});

test('agent instructions prohibit inferring connector absence from zero treasury records', () => {
  const service = new SraAgentService({
    persistentDomain: createDomain(),
    marketplace: null,
    client: { responses: { create: async () => ({ id: 'unused', output_text: '' }) } }
  });

  const instructions = service.instructions();
  assert.match(instructions, /Public market-data connectors, treasury wallets, settlement-rail adapters, Coin Accounts, Coin Positions, and SRA Transactions are separate/);
  assert.match(instructions, /Never infer that a public market-data connector is absent or disconnected merely because treasury wallets/);
  assert.match(instructions, /use the specific live connector record for connector status/);
});
