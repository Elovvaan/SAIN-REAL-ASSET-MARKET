import crypto from 'node:crypto';

const TYPE = 'ON_CHAIN_TRANSFER';

function text(value) { return String(value ?? '').trim(); }
function now() { return new Date().toISOString(); }
function normalizeNetwork(value) { return text(value).toUpperCase(); }
function normalizeAsset(value) { return text(value).toUpperCase(); }
function transferId(value) { return text(value) || `OCT-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }

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

  status() {
    return {
      service: 'SRA_ON_CHAIN_TRANSFER',
      interface: ['asset', 'amount', 'destinationAddress', 'network'],
      networks: [...this.adapters.entries()].map(([network, adapter]) => ({ network, ...adapter.status?.() })),
    };
  }

  get(id) { return this.domain?.get?.(TYPE, id) || null; }

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

  normalizeRequest(input = {}) {
    const request = {
      network: normalizeNetwork(input.network),
      asset: normalizeAsset(input.asset),
      amount: text(input.amount),
      destinationAddress: text(input.destinationAddress),
    };
    if (!request.network) throw new Error('network is required.');
    if (!request.asset) throw new Error('asset is required.');
    if (!request.amount) throw new Error('amount is required.');
    if (!request.destinationAddress) throw new Error('destinationAddress is required.');
    return request;
  }

  adapterFor(network) {
    const adapter = this.adapters.get(network);
    if (!adapter) {
      const error = new Error(`Unsupported on-chain network: ${network}.`);
      error.code = 'ON_CHAIN_NETWORK_UNSUPPORTED';
      throw error;
    }
    if (typeof adapter.send !== 'function') {
      const error = new Error(`On-chain adapter for ${network} cannot send transactions.`);
      error.code = 'ON_CHAIN_ADAPTER_INVALID';
      throw error;
    }
    return adapter;
  }

  async send(input = {}, actorId = null) {
    await this.ensure();
    const id = transferId(input.transferId);
    const request = this.normalizeRequest(input);
    const adapter = this.adapterFor(request.network);
    const existing = this.get(id);
    if (existing) return existing;

    try {
      const result = await adapter.send({ ...request, transferId: id });
      const transactionId = text(result?.transactionId || result?.transactionSignature);
      if (!transactionId) throw new Error('On-chain adapter did not return a transaction ID.');
      const state = String(result?.state || 'SUBMITTED').toUpperCase();
      const record = {
        transferId: id,
        ...request,
        fromAddress: result?.fromAddress || null,
        transactionId,
        state,
        confirmation: result?.confirmation || null,
        createdBy: actorId,
        submittedAt: now(),
        confirmedAt: state === 'CONFIRMED' ? now() : null,
        createdAt: now(),
        updatedAt: now(),
      };
      await this.domain.put(TYPE, id, record, { actorId, eventType: `ON_CHAIN_TRANSFER_${state}` });
      await this.domain.lifecycle?.({
        objectType: TYPE,
        objectId: id,
        eventType: `ON_CHAIN_TRANSFER_${state}`,
        actorId,
        payload: { ...request, transactionId },
      });
      return record;
    } catch (error) {
      const transactionId = text(error?.transactionId || error?.transactionSignature);
      if (transactionId) {
        const record = {
          transferId: id,
          ...request,
          transactionId,
          state: 'SUBMITTED',
          createdBy: actorId,
          submittedAt: now(),
          createdAt: now(),
          updatedAt: now(),
        };
        await this.domain.put(TYPE, id, record, { actorId, eventType: 'ON_CHAIN_TRANSFER_SUBMITTED' });
      }
      throw error;
    }
  }

  async reconcile(id, actorId = null) {
    await this.ensure();
    const existing = this.get(id);
    if (!existing) throw new Error('On-chain transfer not found.');
    if (['CONFIRMED', 'FAILED'].includes(existing.state)) return existing;
    const adapter = this.adapterFor(existing.network);
    if (typeof adapter.confirm !== 'function') {
      const error = new Error(`On-chain adapter for ${existing.network} cannot reconcile submitted transactions.`);
      error.code = 'ON_CHAIN_RECONCILIATION_UNSUPPORTED';
      throw error;
    }
    const confirmation = await adapter.confirm(existing.transactionId);
    const state = String(confirmation?.state || 'SUBMITTED').toUpperCase();
    const updated = {
      ...existing,
      state,
      confirmation,
      confirmedAt: state === 'CONFIRMED' ? now() : existing.confirmedAt,
      updatedAt: now(),
    };
    await this.domain.put(TYPE, id, updated, { actorId, eventType: `ON_CHAIN_TRANSFER_${state}` });
    return updated;
  }
}

export { TYPE as ON_CHAIN_TRANSFER_RECORD_TYPE };
