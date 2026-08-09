import crypto from 'node:crypto';

const TYPE = 'ON_CHAIN_TRANSFER';

function text(value) { return String(value ?? '').trim(); }
function now() { return new Date().toISOString(); }
function transferId(value) { return text(value) || `OCT-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function normalizeNetwork(value) { return text(value).toUpperCase(); }
function normalizeAsset(value) { return text(value).toUpperCase(); }

export class OnChainTransferService {
  constructor({ domain, adapters = {} } = {}) {
    this.domain = domain;
    this.adapters = new Map(Object.entries(adapters).map(([network, adapter]) => [normalizeNetwork(network), adapter]));
    this.hydrated = false;
  }

  async ensure() {
    if (!this.hydrated) {
      await this.domain?.hydrate?.([TYPE]);
      this.hydrated = true;
    }
  }

  networks() {
    return [...this.adapters.keys()];
  }

  status() {
    return {
      service: 'SRA_ON_CHAIN_TRANSFER',
      interface: ['asset', 'amount', 'destinationAddress', 'network'],
      networks: this.networks().map((network) => ({ network, ...this.adapters.get(network)?.status?.() })),
    };
  }

  get(id) {
    return this.domain?.get?.(TYPE, id) || null;
  }

  list(filters = {}) {
    const network = filters.network ? normalizeNetwork(filters.network) : null;
    const asset = filters.asset ? normalizeAsset(filters.asset) : null;
    return (this.domain?.list?.(TYPE) || []).filter((record) => {
      if (network && record.network !== network) return false;
      if (asset && record.asset !== asset) return false;
      if (filters.state && record.state !== String(filters.state).toUpperCase()) return false;
      return true;
    });
  }

  assetContext(network, asset, input = {}) {
    if (network === 'SOLANA' && asset === 'SRA') {
      const projection = this.domain?.get?.('SRA_COIN_CHAIN_PROJECTION', 'SRA-SOLANA') || null;
      if (!projection?.mintAddress) throw new Error('SRA has not been put on chain yet.');
      return {
        mintAddress: projection.mintAddress,
        sourceTokenAccount: projection.platformTokenAccount || null,
      };
    }
    return {
      mintAddress: text(input.mintAddress) || null,
      sourceTokenAccount: text(input.sourceTokenAccount) || null,
    };
  }

  sameTransfer(record, { network, asset, amount, destinationAddress }) {
    return record.network === network
      && record.asset === asset
      && String(record.amount) === String(amount)
      && record.destinationAddress === destinationAddress;
  }

  async send(input = {}, actorId = null) {
    await this.ensure();
    const id = transferId(input.transferId);
    const network = normalizeNetwork(input.network);
    const asset = normalizeAsset(input.asset);
    const amount = text(input.amount);
    const destinationAddress = text(input.destinationAddress);
    if (!network) throw new Error('network is required.');
    if (!asset) throw new Error('asset is required.');
    if (!amount) throw new Error('amount is required.');
    if (!destinationAddress) throw new Error('destinationAddress is required.');

    const adapter = this.adapters.get(network);
    if (!adapter) {
      const error = new Error(`Unsupported on-chain network: ${network}.`);
      error.code = 'ON_CHAIN_NETWORK_UNSUPPORTED';
      throw error;
    }

    const request = { network, asset, amount, destinationAddress };
    const existing = this.get(id);
    if (existing && !this.sameTransfer(existing, request)) {
      const error = new Error('transferId was already used with different transfer details.');
      error.code = 'ON_CHAIN_TRANSFER_ID_CONFLICT';
      throw error;
    }
    if (existing?.state === 'CONFIRMED') return existing;
    if (existing?.state === 'SUBMITTED' && existing.transactionId && adapter.confirm) {
      const confirmation = await adapter.confirm(existing.transactionId);
      if (confirmation.state === 'CONFIRMED') {
        const confirmed = { ...existing, state: 'CONFIRMED', confirmation, confirmedAt: now(), updatedAt: now() };
        await this.domain.put(TYPE, id, confirmed, { actorId, eventType: 'ON_CHAIN_TRANSFER_CONFIRMED' });
        return confirmed;
      }
      return { ...existing, confirmation };
    }

    const prepared = existing || {
      transferId: id,
      ...request,
      state: 'PREPARED',
      transactionId: null,
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now(),
    };
    if (!existing) await this.domain.put(TYPE, id, prepared, { actorId, eventType: 'ON_CHAIN_TRANSFER_PREPARED' });

    const context = this.assetContext(network, asset, input);
    try {
      const result = await adapter.send({ ...input, ...request, transferId: id, ...context });
      const record = {
        ...prepared,
        fromAddress: result.fromAddress || null,
        transactionId: result.transactionId || result.transactionSignature,
        transactionSignature: result.transactionSignature || result.transactionId,
        state: result.state || 'CONFIRMED',
        confirmation: result.confirmation || null,
        submittedAt: result.submittedAt || now(),
        confirmedAt: result.state === 'CONFIRMED' ? (result.confirmedAt || now()) : null,
        updatedAt: now(),
      };
      await this.domain.put(TYPE, id, record, { actorId, eventType: record.state === 'CONFIRMED' ? 'ON_CHAIN_TRANSFER_CONFIRMED' : 'ON_CHAIN_TRANSFER_SUBMITTED' });
      await this.domain.lifecycle?.({ objectType: TYPE, objectId: id, eventType: record.state === 'CONFIRMED' ? 'ON_CHAIN_TRANSFER_CONFIRMED' : 'ON_CHAIN_TRANSFER_SUBMITTED', actorId, payload: { network, asset, amount, destinationAddress, transactionId: record.transactionId } });
      return record;
    } catch (error) {
      const transactionId = error?.transactionId || error?.transactionSignature || null;
      if (transactionId) {
        const submitted = { ...prepared, transactionId, transactionSignature: transactionId, state: 'SUBMITTED', submittedAt: now(), updatedAt: now() };
        await this.domain.put(TYPE, id, submitted, { actorId, eventType: 'ON_CHAIN_TRANSFER_SUBMITTED' });
      }
      throw error;
    }
  }
}

export { TYPE as ON_CHAIN_TRANSFER_RECORD_TYPE };
