import crypto from 'node:crypto';

function text(value) { return String(value ?? '').trim(); }

export class SolanaTransferService {
  constructor(options = {}) {
    this.environment = options.environment || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Math.max(1000, Number(this.environment.SOLANA_EXECUTOR_TIMEOUT_MS || 30000));
  }

  endpoint() {
    const explicit = text(this.environment.SOLANA_EXECUTOR_ENDPOINT);
    if (explicit) return explicit.replace(/\/$/, '');
    return text(this.environment.DEX_ORCA_EXECUTOR_ENDPOINT).replace(/\/execute\/?$/, '');
  }

  token() {
    return text(this.environment.SOLANA_EXECUTOR_TOKEN || this.environment.DEX_ORCA_EXECUTOR_TOKEN);
  }

  status() {
    return {
      service: 'SRA Solana Address Transfer',
      network: 'SOLANA',
      endpointConfigured: Boolean(this.endpoint()),
      credentialConfigured: Boolean(this.token()),
      ready: Boolean(this.endpoint() && this.token()),
    };
  }

  async request(path, options = {}) {
    if (!this.status().ready) {
      const error = new Error('Solana executor is not configured.');
      error.code = 'SOLANA_EXECUTOR_NOT_READY';
      throw error;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint()}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token()}`,
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `Solana executor returned HTTP ${response.status}.`);
        error.code = payload.code || 'SOLANA_EXECUTOR_REJECTED';
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async wallet() {
    return this.request('/wallet');
  }

  async send(input = {}) {
    const destinationAddress = text(input.destinationAddress);
    const amount = Number(input.amount);
    if (!destinationAddress) throw new Error('destinationAddress is required.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be greater than zero.');
    const transferId = text(input.transferId) || `SOL-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
    return this.request('/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': transferId },
      body: JSON.stringify({ transferId, destinationAddress, amount, asset: 'SOL' }),
    });
  }
}
