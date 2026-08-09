import crypto from 'node:crypto';

function now() { return new Date().toISOString(); }
function safeJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return { raw: String(value) }; }
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function digits(value) { return String(value || '').replace(/\D/g, ''); }

export class WireSettlementExecutionService {
  constructor({ fetchImpl = globalThis.fetch, environment = process.env } = {}) {
    this.fetch = fetchImpl;
    this.environment = environment;
  }

  configuration() {
    return {
      rail: 'WIRE',
      mode: String(this.environment.SRA_SETTLEMENT_EXECUTION_MODE || 'DISABLED').toUpperCase(),
      endpoint: this.environment.SRA_FEDWIRE_ENDPOINT || null,
      token: this.environment.SRA_FEDWIRE_TOKEN || null,
      apiKey: this.environment.SRA_FEDWIRE_API_KEY || null,
      accountId: this.environment.SRA_FEDWIRE_ACCOUNT_ID || null,
      deliveryChannel: String(this.environment.SRA_WIRE_DELIVERY_CHANNEL || 'PROVIDER_API').toUpperCase(),
      timeoutMs: Number(this.environment.SRA_SETTLEMENT_PROVIDER_TIMEOUT_MS || 15000),
    };
  }

  status() {
    const c = this.configuration();
    const apiConfigured = c.deliveryChannel === 'PROVIDER_API' && Boolean(c.endpoint) && Boolean(c.token || c.apiKey);
    return {
      rail: 'WIRE',
      mode: c.mode,
      deliveryChannel: c.deliveryChannel,
      ready: c.mode === 'LIVE' && apiConfigured,
      endpointConfigured: Boolean(c.endpoint),
      credentialConfigured: Boolean(c.token || c.apiKey),
      accountConfigured: Boolean(c.accountId),
      destinationContract: 'WIRE_BENEFICIARY',
      executionContract: 'WIRE_ORIGINATION_CHANNEL',
    };
  }

  validateDestination(destination = {}) {
    const routingNumber = digits(destination.routingNumber);
    const accountNumber = String(destination.accountNumber || '').trim();
    const beneficiaryName = String(destination.beneficiaryName || '').trim();
    const bankName = String(destination.bankName || '').trim();
    if (routingNumber.length !== 9) throw new Error('Wire routing number must contain 9 digits.');
    if (!accountNumber) throw new Error('Beneficiary account number is required.');
    if (!beneficiaryName) throw new Error('Beneficiary name is required.');
    if (!bankName) throw new Error('Receiving bank is required.');
    return {
      type: 'WIRE_BENEFICIARY',
      routingNumber,
      accountNumber,
      beneficiaryName,
      bankName,
      beneficiaryAddress: String(destination.beneficiaryAddress || '').trim() || null,
      bankAddress: String(destination.bankAddress || '').trim() || null,
      furtherCredit: String(destination.furtherCredit || '').trim() || null,
    };
  }

  async execute(instruction, { actorId = null } = {}) {
    const config = this.configuration();
    if (config.mode !== 'LIVE') throw new Error('Live wire execution is disabled. Set SRA_SETTLEMENT_EXECUTION_MODE=LIVE only after the wire connection is configured.');
    if (config.deliveryChannel !== 'PROVIDER_API') throw new Error(`Wire delivery channel ${config.deliveryChannel} is not implemented by the API adapter.`);
    if (!config.endpoint || !(config.token || config.apiKey)) throw new Error('Wire provider endpoint and credentials are not configured.');
    if (!instruction || String(instruction.rail || '').toUpperCase() !== 'WIRE') throw new Error('Wire executor requires a wire instruction.');
    if (Number(instruction.amount) <= 0) throw new Error('Wire amount must be greater than zero.');
    const destination = this.validateDestination(instruction.destination);

    const payload = {
      clientTransferId: instruction.instructionId,
      amount: Number(instruction.amount).toFixed(2),
      currency: String(instruction.currency || 'USD').toUpperCase(),
      sourceAccount: instruction.sourceAccountReference || config.accountId,
      wire: {
        beneficiaryName: destination.beneficiaryName,
        beneficiaryAccountNumber: destination.accountNumber,
        receivingBankName: destination.bankName,
        receivingBankRoutingNumber: destination.routingNumber,
        beneficiaryAddress: destination.beneficiaryAddress,
        receivingBankAddress: destination.bankAddress,
        furtherCredit: destination.furtherCredit,
      },
      remittanceReference: instruction.remittanceReference || instruction.instructionId,
      requestedExecutionDate: instruction.requestedExecutionDate || null,
    };

    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': instruction.instructionId,
      'x-sra-request-id': requestId,
      'x-sra-actor-id': actorId || 'system',
    };
    if (config.token) headers.authorization = `Bearer ${config.token}`;
    if (config.apiKey) headers['x-api-key'] = config.apiKey;

    let response;
    let body;
    try {
      response = await this.fetch(config.endpoint, { method:'POST', headers, body:JSON.stringify(payload), signal:controller.signal });
      body = safeJson(await response.text());
    } catch (error) {
      const wrapped = new Error(error?.name === 'AbortError' ? 'Wire provider request timed out.' : `Wire provider request failed: ${error?.message || error}`);
      wrapped.code = 'WIRE_PROVIDER_REQUEST_FAILED';
      wrapped.executionEvidence = { rail:'WIRE', requestId, requestedAt:now(), payloadHash:digest(payload) };
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }

    const providerReference = body?.id || body?.wireId || body?.transferId || body?.transactionId || body?.reference || response.headers.get('x-request-id') || requestId;
    const providerStatus = String(body?.status || (response.ok ? 'ACCEPTED' : 'REJECTED')).toUpperCase();
    const evidence = {
      rail:'WIRE', requestId, endpointHost:new URL(config.endpoint).host, httpStatus:response.status,
      providerReference, providerStatus, requestedAt:now(), payloadHash:digest(payload), responseHash:digest(body), response:body,
    };
    if (!response.ok) {
      const error = new Error(`Wire provider rejected the transfer with HTTP ${response.status}.`);
      error.code = 'WIRE_PROVIDER_REJECTED';
      error.executionEvidence = evidence;
      throw error;
    }
    return evidence;
  }
}
