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
    this.adapters = new Map(
      Object.entries(adapters).map(([network, adapter]) => [normalizeNetwork(network), adapter]),
    );
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
      networks: this.networks().map((network) => ({
        network,
        ...this.adapters.get(network)?.status?.(),
      })),
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

  sameTransfer(record, request) {
    return record.network === request.network
      && record.asset === request.asset
      && String(record.amount) === String(request.amount)
      && record.destinationAddress === request.destinationAddress;
  }

  async prepare(input = {}, actorId = null) {
    await this.ensure();
    const id = transferId(input.transferId);
    const request = this.normalizeRequest(input);
    this.adapterFor(request.network);

    const existing = this.get(id);
    if (existing && !this.sameTransfer(existing, request)) {
      const error = new Error('transferId was already used with different transfer details.');
      error.code = 'ON_CHAIN_TRANSFER_ID_CONFLICT';
      throw error;
    }
    if (existing) return existing;

    const prepared = {
      transferId: id,
      ...request,
      state: 'PREPARED',
      transactionId: null,
      createdBy: actorId,
      createdAt: now(),
      updatedAt: now(),
    };
    await this.domain.put(TYPE, id, prepared, {
      actorId,
      eventType: 'ON_CHAIN_TRANSFER_PREPARED',
    });
    return prepared;
  }

  async confirmExisting(existing, adapter, actorId) {
    if (!existing?.transactionId || typeof adapter.confirm !== 'function') return existing;

    const confirmation = await adapter.confirm(existing.transactionId);
    const state = String(confirmation?.state || 'PENDING').toUpperCase();
    if (state === existing.state) return { ...existing, confirmation };

    const updated = {
      ...existing,
      state,
      confirmation,
      confirmedAt: state === 'CONFIRMED' ? now() : existing.confirmedAt || null,
      updatedAt: now(),
    };
    await this.domain.put(TYPE, existing.transferId, updated, {
      actorId,
      eventType: `ON_CHAIN_TRANSFER_${state}`,
    });
    return updated;
  }

  async send(input = {}, actorId = null) {
    const prepared = await this.prepare(input, actorId);
    const request = {
      network: prepared.network,
      asset: prepared.asset,
      amount: prepared.amount,
      destinationAddress: prepared.destinationAddress,
    };
    const adapter = this.adapterFor(request.network);

    if (prepared.state === 'CONFIRMED') return prepared;
    if (prepared.transactionId) return this.confirmExisting(prepared, adapter, actorId);

    try {
      // Network-specific construction, signing, broadcasting, and asset resolution
      // belong inside the adapter. The generic interface passes only the transfer intent.
      const result = await adapter.send({ ...request, transferId: prepared.transferId });
      const transactionId = text(result?.transactionId || result?.transactionSignature);
      if (!transactionId) throw new Error('On-chain adapter did not return a transaction ID.');

      const state = String(result?.state || 'SUBMITTED').toUpperCase();
      const record = {
        ...prepared,
        fromAddress: result?.fromAddress || null,
        transactionId,
        state,
        confirmation: result?.confirmation || null,
        submittedAt: result?.submittedAt || now(),
        confirmedAt: state === 'CONFIRMED' ? (result?.confirmedAt || now()) : null,
        updatedAt: now(),
      };

      await this.domain.put(TYPE, prepared.transferId, record, {
        actorId,
        eventType: `ON_CHAIN_TRANSFER_${state}`,
      });
      await this.domain.lifecycle?.({
        objectType: TYPE,
        objectId: prepared.transferId,
        eventType: `ON_CHAIN_TRANSFER_${state}`,
        actorId,
        payload: { ...request, transactionId },
      });
      return record;
    } catch (error) {
      const transactionId = text(error?.transactionId || error?.transactionSignature);
      if (transactionId) {
        const submitted = {
          ...prepared,
          transactionId,
          state: 'SUBMITTED',
          submittedAt: now(),
          updatedAt: now(),
        };
        await this.domain.put(TYPE, prepared.transferId, submitted, {
          actorId,
          eventType: 'ON_CHAIN_TRANSFER_SUBMITTED',
        });
      }
      throw error;
    }
  }
}

export { TYPE as ON_CHAIN_TRANSFER_RECORD_TYPE };
