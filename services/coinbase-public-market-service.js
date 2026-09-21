import WebSocket from 'ws';

const DEFAULT_ENDPOINT = 'wss://advanced-trade-ws.coinbase.com';
const DEFAULT_PRODUCTS = ['BTC-USD', 'XLM-USD', 'XRP-USD'];
const CONNECTOR_ID = 'COINBASE_PUBLIC_MARKET_TRADES';

function now() { return new Date().toISOString(); }
function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function productList(value) {
  const products = String(value || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
  return products.length ? [...new Set(products)] : DEFAULT_PRODUCTS;
}
function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class CoinbasePublicMarketService {
  constructor({ observationLayerService, transactionAssetPipeline = null, WebSocketImpl = WebSocket, environment = process.env, logger = console } = {}) {
    if (!observationLayerService?.observe) throw new Error('observationLayerService is required.');
    this.observations = observationLayerService;
    this.transactionAssetPipeline = transactionAssetPipeline;
    this.WebSocketImpl = WebSocketImpl;
    this.environment = environment;
    this.logger = logger;
    this.enabled = String(environment.COINBASE_PUBLIC_MARKET_ENABLED || '').toLowerCase() === 'true';
    this.endpoint = environment.COINBASE_PUBLIC_MARKET_WS_URL || DEFAULT_ENDPOINT;
    this.products = productList(environment.COINBASE_PUBLIC_MARKET_PRODUCTS);
    this.maxTradesPerMinute = positiveInteger(environment.COINBASE_PUBLIC_MARKET_MAX_TRADES_PER_MINUTE, 60);
    this.flushIntervalMs = positiveInteger(environment.COINBASE_PUBLIC_MARKET_FLUSH_INTERVAL_MS, 60000);
    this.reconnectBaseMs = positiveInteger(environment.COINBASE_PUBLIC_MARKET_RECONNECT_MS, 1000);
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.closedByService = false;
    this.minuteStartedAt = Date.now();
    this.tradesThisMinute = 0;
    this.flowBuckets = new Map();
    this.flushTimer = null;
    this.flushQueue = Promise.resolve();
    this.state = this.enabled ? 'IDLE' : 'DISABLED';
    this.connectedAt = null;
    this.lastMessageAt = null;
    this.lastTradeAt = null;
    this.lastHeartbeatAt = null;
    this.lastError = null;
    this.receivedTrades = 0;
    this.recordedTrades = 0;
    this.duplicateTrades = 0;
    this.throttledTrades = 0;
    this.pipelineProcessedTrades = 0;
    this.pipelineFailedTrades = 0;
    this.lastPipelineError = null;
  }

  status() {
    return {
      connectorId: CONNECTOR_ID,
      provider: 'COINBASE',
      feed: 'ADVANCED_TRADE_PUBLIC_MARKET_DATA',
      channel: 'market_trades',
      authenticationRequired: false,
      enabled: this.enabled,
      state: this.state,
      endpoint: this.endpoint,
      products: this.products,
      maxTradesPerMinute: this.maxTradesPerMinute,
      flushIntervalMs: this.flushIntervalMs,
      pendingMarketFlows: this.flowBuckets.size,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastTradeAt: this.lastTradeAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError,
      receivedTrades: this.receivedTrades,
      recordedTrades: this.recordedTrades,
      duplicateTrades: this.duplicateTrades,
      throttledTrades: this.throttledTrades,
      pipelineProcessedTrades: this.pipelineProcessedTrades,
      pipelineFailedTrades: this.pipelineFailedTrades,
      lastPipelineError: this.lastPipelineError,
      transactionAssetPipeline: this.transactionAssetPipeline?.status?.() || null,
      reconnectAttempt: this.reconnectAttempt,
      generatedAt: now()
    };
  }

  start() {
    if (!this.enabled) return this.status();
    if (this.socket && [this.WebSocketImpl.OPEN, this.WebSocketImpl.CONNECTING].includes(this.socket.readyState)) return this.status();
    this.closedByService = false;
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flushMarketFlows(), this.flushIntervalMs);
      this.flushTimer.unref?.();
    }
    this.connect();
    return this.status();
  }

  stop() {
    this.closedByService = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (this.socket) {
      try { this.socket.close(1000, 'SRA connector stopped'); } catch {}
    }
    this.socket = null;
    this.state = this.enabled ? 'STOPPED' : 'DISABLED';
    return this.status();
  }

  connect() {
    this.state = 'CONNECTING';
    this.lastError = null;
    const socket = new this.WebSocketImpl(this.endpoint);
    this.socket = socket;

    socket.on('open', () => {
      this.state = 'CONNECTED';
      this.connectedAt = now();
      this.reconnectAttempt = 0;
      socket.send(JSON.stringify({ type: 'subscribe', product_ids: this.products, channel: 'market_trades' }));
      socket.send(JSON.stringify({ type: 'subscribe', channel: 'heartbeats' }));
      this.logger.info?.(`Coinbase public market connector subscribed to ${this.products.join(', ')}.`);
    });

    socket.on('message', (payload) => {
      try { this.handleMessage(payload); } catch (error) { this.captureError(error); }
    });

    socket.on('error', (error) => this.captureError(error));

    socket.on('close', (code, reason) => {
      this.socket = null;
      if (this.closedByService) return;
      this.state = 'RECONNECTING';
      this.lastError = { message: `WebSocket closed (${code}): ${String(reason || '')}`, at: now() };
      this.scheduleReconnect();
    });
  }

  captureError(error) {
    this.state = this.socket ? 'DEGRADED' : this.state;
    this.lastError = { name: error?.name || 'Error', message: error?.message || String(error), at: now() };
    this.logger.error?.('Coinbase public market connector error:', error);
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectAttempt += 1;
    const delay = Math.min(30000, this.reconnectBaseMs * (2 ** Math.min(this.reconnectAttempt - 1, 5)));
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  allowTrade() {
    const current = Date.now();
    if (current - this.minuteStartedAt >= 60000) {
      this.minuteStartedAt = current;
      this.tradesThisMinute = 0;
    }
    if (this.tradesThisMinute >= this.maxTradesPerMinute) {
      this.throttledTrades += 1;
      return false;
    }
    this.tradesThisMinute += 1;
    return true;
  }

  handleMessage(payload) {
    this.lastMessageAt = now();
    let message;
    try { message = JSON.parse(payload.toString()); } catch { return; }
    if (message.channel === 'heartbeats') {
      this.lastHeartbeatAt = message.timestamp || now();
      return;
    }
    if (message.channel !== 'market_trades' || !Array.isArray(message.events)) return;

    for (const event of message.events) {
      for (const trade of event.trades || []) {
        this.receivedTrades += 1;
        if (!this.allowTrade()) continue;
        this.collectTrade(trade, message, event.type || null);
      }
    }
  }

  collectTrade(trade, envelope, eventType) {
    const tradeId = String(trade.trade_id || '').trim();
    const productId = String(trade.product_id || '').trim().toUpperCase();
    const price = finiteNumber(trade.price);
    const size = finiteNumber(trade.size);
    if (!tradeId || !productId || price == null || size == null || price <= 0 || size <= 0) return;
    const at = trade.time || envelope.timestamp || now();
    const bucket = this.flowBuckets.get(productId) || {
      productId, tradeCount: 0, nativeQuantity: 0, notional: 0, lowPrice: price, highPrice: price,
      firstTradeId: tradeId, lastTradeId: tradeId, firstTradeAt: at, lastTradeAt: at,
      buyCount: 0, sellCount: 0, eventType, lastSequenceNumber: null
    };
    bucket.tradeCount += 1;
    bucket.nativeQuantity += size;
    bucket.notional += price * size;
    bucket.lowPrice = Math.min(bucket.lowPrice, price);
    bucket.highPrice = Math.max(bucket.highPrice, price);
    bucket.lastPrice = price;
    bucket.lastTradeId = tradeId;
    bucket.lastTradeAt = at;
    bucket.lastSequenceNumber = envelope.sequence_num ?? bucket.lastSequenceNumber;
    if (String(trade.side || '').toUpperCase() === 'BUY') bucket.buyCount += 1;
    if (String(trade.side || '').toUpperCase() === 'SELL') bucket.sellCount += 1;
    this.flowBuckets.set(productId, bucket);
    this.lastTradeAt = at;
  }

  async flushMarketFlows() {
    this.flushQueue = this.flushQueue.then(async () => {
      const buckets = [...this.flowBuckets.values()];
      this.flowBuckets.clear();
      for (const bucket of buckets) await this.recordMarketFlow(bucket);
    }).catch((error) => this.captureError(error));
    return this.flushQueue;
  }

  async processAssetPipeline(observation) {
    if (!this.transactionAssetPipeline?.processObservation || !observation) return;
    try {
      const result = await this.transactionAssetPipeline.processObservation(observation);
      if (result?.processed) this.pipelineProcessedTrades += 1;
      this.lastPipelineError = null;
    } catch (error) {
      this.pipelineFailedTrades += 1;
      this.lastPipelineError = { message: error?.message || String(error), observationId: observation.observationId, at: now() };
      this.logger.error?.('Coinbase trade recorded but downstream SRA asset pipeline failed:', error);
    }
  }

  async recordMarketFlow(bucket) {
    const { productId, firstTradeId, lastTradeId, tradeCount } = bucket;
    const notional = Number(bucket.notional.toFixed(8));
    const size = Number(bucket.nativeQuantity.toFixed(8));
    const price = Number((notional / size).toFixed(8));
    const result = await this.observations.observe({
      sourceMarket: 'COINBASE',
      sourceRecordId: `${productId}:${firstTradeId}:${lastTradeId}`,
      sourceRecordType: 'MARKET_FLOW',
      sourceTimestamp: bucket.lastTradeAt,
      connectorId: CONNECTOR_ID,
      category: 'CRYPTO_MARKET_TRANSACTION',
      rawValues: {
        tradeId: lastTradeId,
        firstTradeId,
        lastTradeId,
        tradeCount,
        productId,
        price,
        size,
        notional,
        lowPrice: bucket.lowPrice,
        highPrice: bucket.highPrice,
        lastPrice: bucket.lastPrice,
        buyCount: bucket.buyCount,
        sellCount: bucket.sellCount,
        windowStartedAt: bucket.firstTradeAt,
        windowEndedAt: bucket.lastTradeAt,
        eventType: bucket.eventType,
        sequenceNumber: bucket.lastSequenceNumber
      },
      rawPayload: { ...bucket, nativeQuantity: size, notional, vwap: price },
      sourceReference: `coinbase:advanced-trade:market_flow:${productId}:${firstTradeId}:${lastTradeId}`
    }, CONNECTOR_ID);
    if (result.created) {
      this.recordedTrades += tradeCount;
      await this.processAssetPipeline(result.observation);
    } else {
      this.duplicateTrades += 1;
    }
  }
}

export const COINBASE_PUBLIC_MARKET_CONNECTOR_ID = CONNECTOR_ID;
