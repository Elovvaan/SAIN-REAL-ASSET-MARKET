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
function validRoutingNumber(value) {
  const routing = digits(value);
  if (routing.length !== 9) return false;
  const n = [...routing].map(Number);
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0;
}

export class AchSettlementExecutionService {
  constructor({ fetchImpl = globalThis.fetch, environment = process.env } = {}) {
    this.fetch = fetchImpl;
    this.environment = environment;
  }

  configuration() {
    return {
      rail: 'ACH',
      mode: String(this.environment.SRA_SETTLEMENT_EXECUTION_MODE || 'DISABLED').toUpperCase(),
      endpoint: this.environment.SRA_ACH_ENDPOINT || null,
      token: this.environment.SRA_ACH_TOKEN || null,
      apiKey: this.environment.SRA_ACH_API_KEY || null,
      accountId: this.environment.SRA_ACH_ACCOUNT_ID || null,
      timeoutMs: Number(this.environment.SRA_SETTLEMENT_PROVIDER_TIMEOUT_MS || 15000),
    };
  }

  status() {
    const c = this.configuration();
    return {
      rail: 'ACH',
      mode: c.mode,
      ready: c.mode === 'LIVE' && Boolean(c.endpoint) && Boolean(c.token || c.apiKey),
      endpointConfigured: Boolean(c.endpoint),
      credentialConfigured: Boolean(c.token || c.apiKey),
      accountConfigured: Boolean(c.accountId),
      destinationContract: 'US_BANK_ACCOUNT',
      executionContract: 'ACH_ORIGINATION_PROVIDER',
    };
  }

  validateDestination(destination = {}) {
    const routingNumber = digits(destination.routingNumber);
    const accountNumber = digits(destination.accountNumber);
    const accountType = String(destination.accountType || '').trim().toUpperCase();
    if (!validRoutingNumber(routingNumber)) throw new Error('A valid 9-digit ACH routing number is required.');
    if (accountNumber.length < 4 || accountNumber.length > 17) throw new Error('ACH account number must contain 4 to 17 digits.');
    if (!['CHECKING','SAVINGS'].includes(accountType)) throw new Error('ACH account type must be CHECKING or SAVINGS.');
    return {
      type: 'US_BANK_ACCOUNT',
      routingNumber,
      accountNumber,
      accountType,
      bankName: String(destination.bankName || '').trim(),
    };
  }

  async execute(instruction, { actorId = null } = {}) {
    const config = this.configuration();
    if (config.mode !== 'LIVE') throw new Error('Live ACH execution is disabled. Set SRA_SETTLEMENT_EXECUTION_MODE=LIVE only after the ACH connection is configured.');
    if (!config.endpoint || !(config.token || config.apiKey)) throw new Error('ACH provider endpoint and credentials are not configured.');
    if (!instruction || String(instruction.rail || '').toUpperCase() !== 'ACH') throw new Error('ACH executor requires an ACH instruction.');
    if (Number(instruction.amount) <= 0) throw new Error('ACH amount must be greater than zero.');
    const destination = this.validateDestination(instruction.destination);

    const payload = {
      clientTransferId: instruction.instructionId,
      amount: Number(instruction.amount).toFixed(2),
      currency: String(instruction.currency || 'USD').toUpperCase(),
      sourceAccount: instruction.sourceAccountReference || config.accountId,
      ach: {
        routingNumber: destination.routingNumber,
        accountNumber: destination.accountNumber,
        accountType: destination.accountType,
        bankName: destination.bankName || null,
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
      const wrapped = new Error(error?.name === 'AbortError' ? 'ACH provider request timed out.' : `ACH provider request failed: ${error?.message || error}`);
      wrapped.code = 'ACH_PROVIDER_REQUEST_FAILED';
      wrapped.executionEvidence = { rail:'ACH', requestId, requestedAt:now(), payloadHash:digest(payload) };
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }

    const providerReference = body?.id || body?.transferId || body?.transactionId || body?.reference || response.headers.get('x-request-id') || requestId;
    const providerStatus = String(body?.status || (response.ok ? 'ACCEPTED' : 'REJECTED')).toUpperCase();
    const evidence = {
      rail:'ACH', requestId, endpointHost:new URL(config.endpoint).host, httpStatus:response.status,
      providerReference, providerStatus, requestedAt:now(), payloadHash:digest(payload), responseHash:digest(body), response:body,
    };
    if (!response.ok) {
      const error = new Error(`ACH provider rejected the transfer with HTTP ${response.status}.`);
      error.code = 'ACH_PROVIDER_REJECTED';
      error.executionEvidence = evidence;
      throw error;
    }
    return evidence;
  }
}

export { validRoutingNumber };
