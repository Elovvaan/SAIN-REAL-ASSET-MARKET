import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CoinbasePublicMarketService } from '../services/coinbase-public-market-service.js';

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  open() { this.readyState = FakeWebSocket.OPEN; this.emit('open'); }
  message(payload) { this.emit('message', Buffer.from(JSON.stringify(payload))); }
  close() { this.readyState = 3; this.emit('close', 1000, 'closed'); }
}
FakeWebSocket.instances = [];

function quietLogger() { return { info() {}, error() {} }; }

async function waitForAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('subscribes to public market trades and heartbeats without a client key or JWT', () => {
  FakeWebSocket.instances = [];
  const service = new CoinbasePublicMarketService({
    observationLayerService: { observe: async () => ({ created: true }) },
    WebSocketImpl: FakeWebSocket,
    environment: { COINBASE_PUBLIC_MARKET_ENABLED: 'true', COINBASE_PUBLIC_MARKET_PRODUCTS: 'BTC-USD,ETH-USD' },
    logger: quietLogger()
  });
  service.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.deepEqual(socket.sent, [
    { type: 'subscribe', product_ids: ['BTC-USD', 'ETH-USD'], channel: 'market_trades' },
    { type: 'subscribe', channel: 'heartbeats' }
  ]);
  assert.equal(JSON.stringify(socket.sent).includes('jwt'), false);
  assert.equal(service.status().authenticationRequired, false);
  service.stop();
});

test('records Coinbase trades as SRA market observations with source lineage', async () => {
  FakeWebSocket.instances = [];
  const calls = [];
  const service = new CoinbasePublicMarketService({
    observationLayerService: { observe: async (input, actor) => { calls.push({ input, actor }); return { created: true }; } },
    WebSocketImpl: FakeWebSocket,
    environment: { COINBASE_PUBLIC_MARKET_ENABLED: 'true', COINBASE_PUBLIC_MARKET_PRODUCTS: 'BTC-USD' },
    logger: quietLogger()
  });
  service.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    channel: 'market_trades',
    timestamp: '2026-08-04T20:00:00Z',
    sequence_num: 44,
    events: [{
      type: 'update',
      trades: [{ trade_id: '9001', product_id: 'BTC-USD', price: '60000', size: '0.01', side: 'BUY', time: '2026-08-04T19:59:59Z' }]
    }]
  });
  await waitForAsyncWork();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor, 'COINBASE_PUBLIC_MARKET_TRADES');
  assert.equal(calls[0].input.sourceMarket, 'COINBASE');
  assert.equal(calls[0].input.sourceRecordId, 'BTC-USD:9001');
  assert.equal(calls[0].input.sourceRecordType, 'MARKET_TRADE');
  assert.equal(calls[0].input.rawValues.notional, 600);
  assert.equal(calls[0].input.rawPayload.trade_id, '9001');
  assert.equal(service.status().recordedTrades, 1);
  service.stop();
});

test('remains disabled until the Railway connector flag is explicitly enabled', () => {
  FakeWebSocket.instances = [];
  const service = new CoinbasePublicMarketService({
    observationLayerService: { observe: async () => ({ created: true }) },
    WebSocketImpl: FakeWebSocket,
    environment: {},
    logger: quietLogger()
  });
  service.start();
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(service.status().state, 'DISABLED');
});
