function text(value) { return String(value || '').trim(); }
function positive(value, field) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be greater than zero.`); return number; }

export class ExternalDexExecutorService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Math.max(1000, Number(this.environment.DEX_ORCA_EXECUTOR_TIMEOUT_MS || 15000));
  }

  status() {
    const endpoint = text(this.environment.DEX_ORCA_EXECUTOR_ENDPOINT);
    const credential = text(this.environment.DEX_ORCA_EXECUTOR_TOKEN);
    const mode = text(this.environment.DEX_ORCA_EXECUTION_MODE || 'DISABLED').toUpperCase();
    return {
      service: 'External Orca Executor Bridge',
      venue: 'ORCA_WHIRLPOOLS',
      network: 'SOLANA',
      executionMode: mode,
      endpointConfigured: Boolean(endpoint),
      credentialConfigured: Boolean(credential),
      ready: mode === 'LIVE' && Boolean(endpoint) && Boolean(credential),
      contract: 'SRA_DEX_EXECUTOR_V1',
    };
  }

  executionRequest(dexExport, input = {}) {
    if (!dexExport || dexExport.state !== 'READY_FOR_EXTERNAL_DEX') throw new Error('DEX export must be ready before live execution.');
    if (dexExport.venue !== 'ORCA_WHIRLPOOLS' || dexExport.network !== 'SOLANA') throw new Error('Only the Orca Whirlpools Solana executor is supported.');
    return {
      contract: 'SRA_DEX_EXECUTOR_V1',
      action: text(input.action || 'CREATE_POOL_AND_SEED_LIQUIDITY').toUpperCase(),
      venue: dexExport.venue,
      network: dexExport.network,
      dexExportId: dexExport.dexExportId,
      sourceExportPackageId: dexExport.sourceExportPackageId,
      projectionId: dexExport.projectionId,
      instrumentId: dexExport.instrumentId,
      pair: dexExport.pair,
      baseMintAddress: dexExport.baseMintAddress,
      quoteMintAddress: dexExport.quoteMintAddress,
      baseLiquidityQuantity: positive(input.baseLiquidityQuantity ?? dexExport.quantity, 'baseLiquidityQuantity'),
      quoteLiquidityQuantity: positive(input.quoteLiquidityQuantity, 'quoteLiquidityQuantity'),
      initialMarketPrice: positive(input.initialMarketPrice, 'initialMarketPrice'),
      tickSpacing: Math.max(1, Number.parseInt(input.tickSpacing || 64, 10)),
      liquidityStrategy: text(input.liquidityStrategy || 'FULL_RANGE').toUpperCase(),
      maxSlippageBps: Math.max(0, Number.parseInt(input.maxSlippageBps || 100, 10)),
      recordedValueReference: dexExport.recordedValueReference || null,
      marketPricePolicy: 'EXTERNAL_MARKET_PRICE_IS_OBSERVATIONAL_ONLY',
    };
  }

  async execute(dexExport, input = {}) {
    const status = this.status();
    if (!status.ready) {
      const error = new Error('External Orca executor is not configured for LIVE execution.');
      error.code = 'DEX_EXECUTOR_NOT_READY';
      error.executorStatus = status;
      throw error;
    }
    if (typeof this.fetchImpl !== 'function') throw new Error('Fetch implementation is unavailable for external DEX execution.');
    const request = this.executionRequest(dexExport, input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(text(this.environment.DEX_ORCA_EXECUTOR_ENDPOINT), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${text(this.environment.DEX_ORCA_EXECUTOR_TOKEN)}`,
          'Idempotency-Key': dexExport.dexExportId,
          'X-SRA-DEX-Contract': 'SRA_DEX_EXECUTOR_V1',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || payload.message || `External Orca executor returned HTTP ${response.status}.`);
        error.code = 'DEX_EXECUTOR_REJECTED';
        error.statusCode = response.status;
        throw error;
      }
      const connectorReference = text(payload.connectorReference || payload.executionId || payload.requestId);
      if (!connectorReference) throw new Error('External Orca executor did not return a connector reference.');
      return {
        connectorReference,
        state: text(payload.state || 'SUBMITTED').toUpperCase(),
        transactionSignature: text(payload.transactionSignature) || null,
        poolAddress: text(payload.poolAddress || payload.externalMarketAddress) || null,
        executedQuantity: payload.executedQuantity == null ? null : Number(payload.executedQuantity),
        observedMarketPrice: payload.observedMarketPrice == null ? null : Number(payload.observedMarketPrice),
        raw: payload,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
