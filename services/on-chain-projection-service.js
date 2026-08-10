const TYPE = 'ON_CHAIN_ASSET';

function text(value) { return String(value ?? '').trim(); }
function upper(value) { return text(value).toUpperCase(); }
function now() { return new Date().toISOString(); }

export class OnChainProjectionService {
  constructor(domain) {
    this.domain = domain;
  }

  async initialize() {
    await this.domain.hydrate?.([TYPE]);
    return this.status();
  }

  status() {
    return {
      service: 'SRA_ON_CHAIN_ASSETS',
      structure: ['CREATE', 'ISSUE', 'TRANSFER'],
      assets: this.domain.list(TYPE).length,
    };
  }

  listAssets(filters = {}) {
    const network = filters.network ? upper(filters.network) : null;
    const asset = filters.asset ? upper(filters.asset) : null;
    const instrumentId = text(filters.instrumentId);
    return this.domain.list(TYPE).filter((record) => {
      if (network && record.network !== network) return false;
      if (asset && upper(record.asset) !== asset) return false;
      if (instrumentId && record.instrumentId !== instrumentId) return false;
      return true;
    });
  }

  getAsset(assetId) {
    return this.domain.get(TYPE, assetId) || null;
  }

  findAsset({ asset, instrumentId, network } = {}) {
    const normalizedAsset = upper(asset);
    const normalizedNetwork = upper(network);
    const normalizedInstrumentId = text(instrumentId);
    return this.domain.list(TYPE).find((record) => {
      if (normalizedNetwork && record.network !== normalizedNetwork) return false;
      if (normalizedInstrumentId && record.instrumentId === normalizedInstrumentId) return true;
      if (!normalizedAsset) return false;
      return [record.asset, record.symbol, record.instrumentId, record.assetAddress, record.mintAddress]
        .map(upper)
        .filter(Boolean)
        .includes(normalizedAsset);
    }) || null;
  }

  async recordCreated(input = {}, actorId = null) {
    const assetId = text(input.assetId);
    const network = upper(input.network);
    const asset = text(input.asset);
    const assetAddress = text(input.assetAddress || input.mintAddress);
    if (!assetId) throw new Error('assetId is required.');
    if (!network) throw new Error('network is required.');
    if (!asset) throw new Error('asset is required.');
    if (!assetAddress) throw new Error('assetAddress is required.');

    const existing = this.getAsset(assetId);
    if (existing) return existing;

    const createdAt = now();
    const record = {
      assetId,
      network,
      asset,
      instrumentId: text(input.instrumentId) || null,
      symbol: text(input.symbol) || asset,
      assetAddress,
      mintAddress: assetAddress,
      sourceAccount: text(input.sourceAccount) || null,
      decimals: Number(input.decimals ?? 0),
      tokenProgram: text(input.tokenProgram) || null,
      createdTransactionId: text(input.transactionId) || null,
      issuedSupply: '0',
      state: 'CREATED',
      createdBy: actorId,
      createdAt,
      updatedAt: createdAt,
    };
    await this.domain.put(TYPE, assetId, record, { actorId, eventType: 'ON_CHAIN_ASSET_CREATED' });
    return record;
  }

  async recordIssued(assetId, issuance = {}, actorId = null) {
    const existing = this.getAsset(assetId);
    if (!existing) throw new Error('On-chain asset not found.');
    const amount = text(issuance.amount);
    const previous = Number(existing.issuedSupply || 0);
    const added = Number(amount || 0);
    const updated = {
      ...existing,
      sourceAccount: text(issuance.sourceAccount) || existing.sourceAccount || null,
      issuedSupply: String(previous + added),
      lastIssueTransactionId: text(issuance.transactionId) || null,
      lastIssuedAmount: amount || null,
      state: 'ISSUED',
      updatedAt: now(),
    };
    await this.domain.put(TYPE, assetId, updated, { actorId, eventType: 'ON_CHAIN_ASSET_ISSUED' });
    return updated;
  }

  // Compatibility reads for older external connectors. These are aliases over the
  // direct on-chain asset record; they do not restore projection eligibility or gates.
  listProjections(filters = {}) {
    return this.listAssets(filters).map((record) => ({
      ...record,
      projectionId: record.assetId,
      status: record.state === 'ISSUED' ? 'ACTIVE' : record.state,
      mintAddress: record.assetAddress,
      chainProgram: record.tokenProgram,
    }));
  }

  getProjection(assetId) {
    const record = this.getAsset(assetId);
    if (!record) return null;
    return {
      ...record,
      projectionId: record.assetId,
      status: record.state === 'ISSUED' ? 'ACTIVE' : record.state,
      mintAddress: record.assetAddress,
      chainProgram: record.tokenProgram,
    };
  }

  async recordChainEvent(input = {}, actorId = null) {
    return this.domain.lifecycle?.({
      objectType: TYPE,
      objectId: text(input.projectionId || input.assetId),
      eventType: text(input.eventType) || 'ON_CHAIN_EVENT_RECORDED',
      actorId,
      payload: { ...input },
    });
  }
}

export { TYPE as ON_CHAIN_ASSET_RECORD_TYPE };
