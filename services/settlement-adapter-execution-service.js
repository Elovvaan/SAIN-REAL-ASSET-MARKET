import crypto from 'node:crypto';

const LIVE_RAILS = new Set(['ACH', 'FEDWIRE', 'WIRE', 'COINBASE']);
const EXECUTABLE_STATES = new Set(['READY', 'EXCEPTION']);

function now() { return new Date().toISOString(); }
function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
function envName(rail, suffix) {
  return `SRA_${rail === 'WIRE' ? 'FEDWIRE' : rail}_${suffix}`;
}
function safeJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return { raw: String(value) }; }
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class SettlementAdapterExecutionService {
  constructor({ fetchImpl = globalThis.fetch, environment = process.env } = {}) {
    this.fetch = fetchImpl;
    this.environment = environment;
  }

  configuration(rail) {
    const normalizedRail = required(rail, 'rail').toUpperCase();
    if (!LIVE_RAILS.has(normalizedRail)) throw new Error(`Unsupported live settlement rail: ${normalizedRail}.`);
    const prefixRail = normalizedRail === 'WIRE' ? 'FEDWIRE' : normalizedRail;
    const endpoint = this.environment[envName(prefixRail, 'ENDPOINT')] || null;
    const token = this.environment[envName(prefixRail, 'TOKEN')] || null;
    const apiKey = this.environment[envName(prefixRail, 'API_KEY')] || null;
    const accountId = this.environment[envName(prefixRail, 'ACCOUNT_ID')] || null;
    return {
      rail: normalizedRail,
      mode: String(this.environment.SRA_SETTLEMENT_EXECUTION_MODE || 'DISABLED').toUpperCase(),
      endpointConfigured: Boolean(endpoint),
      credentialConfigured: Boolean(token || apiKey),
      accountConfigured: Boolean(accountId),
      endpoint,
      token,
      apiKey,
      accountId,
      timeoutMs: Number(this.environment.SRA_SETTLEMENT_PROVIDER_TIMEOUT_MS || 15000)
    };
  }

  status() {
    const rails = ['ACH', 'FEDWIRE', 'COINBASE'].map((rail) => {
      const config = this.configuration(rail);
      return {
        rail,
        mode: config.mode,
        ready: config.mode === 'LIVE' && config.endpointConfigured && config.credentialConfigured,
        endpointConfigured: config.endpointConfigured,
        credentialConfigured: config.credentialConfigured,
        accountConfigured: config.accountConfigured
      };
    });
    return { service: 'SRA_EXPORT_AND_SETTLEMENT_EXECUTION', rails, liveExecutionEnabled: rails.some((item) => item.ready) };
  }

  assertCanExecute(instruction, confirmation) {
    if (!instruction) throw new Error('Settlement Rail Instruction not found.');
    if (!EXECUTABLE_STATES.has(instruction.state)) throw new Error(`Instruction must be READY or EXCEPTION before execution. Current state: ${instruction.state}.`);
    if (!LIVE_RAILS.has(String(instruction.rail || '').toUpperCase())) throw new Error(`Instruction rail ${instruction.rail} does not have a live adapter.`);
    if (Number(instruction.amount) <= 0) throw new Error('Instruction amount must be greater than zero.');
    if (!instruction.currency) throw new Error('Instruction currency is required.');
    if (!instruction.receivingAccountReference && !instruction.transientDestination) throw new Error('Receiving account or wallet reference is required.');
    const expected = `EXECUTE ${Number(instruction.amount).toFixed(2)} ${String(instruction.currency).toUpperCase()} VIA ${String(instruction.rail).toUpperCase()}`;
    if (confirmation !== expected) {
      const error = new Error(`Live execution confirmation must exactly equal: ${expected}`);
      error.code = 'LIVE_EXECUTION_CONFIRMATION_REQUIRED';
      throw error;
    }
    return expected;
  }

  providerPayload(instruction, config) {
    const destination = instruction.transientDestination || instruction.receivingAccountReference;
    const common = {
      clientTransferId: instruction.instructionId,
      amount: Number(instruction.amount).toFixed(2),
      currency: String(instruction.currency).toUpperCase(),
      sourceAccount: instruction.senderAccountReference || config.accountId,
      destination,
      receivingInstitution: instruction.receivingInstitutionReference || null,
      purpose: instruction.purpose || 'SRA_SETTLEMENT',
      remittanceReference: instruction.remittanceReference || instruction.settlementId,
      requestedExecutionDate: instruction.requestedExecutionDate || null,
      metadata: {
        settlementId: instruction.settlementId,
        settlementPackageId: instruction.settlementPackageId || null,
        commitmentId: instruction.commitmentId || null,
        messageHash: instruction.messageHash || null
      }
    };
    if (String(instruction.rail).toUpperCase() === 'COINBASE') {
      return { ...common, asset: String(instruction.currency).toUpperCase(), walletAddress: instruction.receivingAccountReference };
    }
    return common;
  }

  async execute(instruction, { confirmation, actorId = null } = {}) {
    this.assertCanExecute(instruction, confirmation);
    const rail = String(instruction.rail).toUpperCase();
    const config = this.configuration(rail);
    if (config.mode !== 'LIVE') throw new Error('Live settlement execution is disabled. Set SRA_SETTLEMENT_EXECUTION_MODE=LIVE only after provider credentials and destination controls are configured.');
    if (!config.endpointConfigured || !config.credentialConfigured) throw new Error(`${rail} provider endpoint and credentials are not configured.`);

    const payload = this.providerPayload(instruction, config);
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': instruction.instructionId,
      'x-sra-request-id': requestId,
      'x-sra-actor-id': actorId || 'system'
    };
    if (config.token) headers.authorization = `Bearer ${config.token}`;
    if (config.apiKey) headers['x-api-key'] = config.apiKey;

    let response;
    let body;
    try {
      response = await this.fetch(config.endpoint, {
        method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal
      });
      body = safeJson(await response.text());
    } catch (error) {
      const wrapped = new Error(error?.name === 'AbortError' ? `${rail} provider request timed out.` : `${rail} provider request failed: ${error?.message || error}`);
      wrapped.code = 'SETTLEMENT_PROVIDER_REQUEST_FAILED';
      wrapped.executionEvidence = { rail, requestId, requestedAt: now(), payloadHash: digest(payload) };
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }

    const providerReference = body?.id || body?.transferId || body?.transactionId || body?.reference || response.headers.get('x-request-id') || requestId;
    const providerStatus = String(body?.status || (response.ok ? 'ACCEPTED' : 'REJECTED')).toUpperCase();
    const evidence = {
      rail,
      requestId,
      endpointHost: new URL(config.endpoint).host,
      httpStatus: response.status,
      providerReference,
      providerStatus,
      requestedAt: now(),
      payloadHash: digest(payload),
      responseHash: digest(body),
      response: body
    };
    if (!response.ok) {
      const error = new Error(`${rail} provider rejected the transfer with HTTP ${response.status}.`);
      error.code = 'SETTLEMENT_PROVIDER_REJECTED';
      error.executionEvidence = evidence;
      throw error;
    }
    return evidence;
  }
}
