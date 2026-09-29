import crypto from 'node:crypto';

export const AGENT_MARKET_GRANT_TYPE = 'SRA_AGENT_MARKET_ACCESS_GRANT';
const SCOPES = new Set(['MARKET_READ', 'PROPOSAL_PREPARE']);
const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function safeGrant(grant) {
  if (!grant) return null;
  const { secretHash, ...safe } = grant;
  return safe;
}

export class AgentMarketAccessService {
  constructor(domain, workforce) { this.domain = domain; this.workforce = workforce; }

  list() { return this.domain.list(AGENT_MARKET_GRANT_TYPE).map(safeGrant); }

  async issue(input = {}, actorId) {
    const agentId = String(input.agentId || '').trim();
    const agent = this.workforce.getAgent(agentId);
    if (!agent || agent.state !== 'ACTIVE') throw new Error('An active registered agent is required.');
    const scopes = [...new Set((Array.isArray(input.scopes) ? input.scopes : []).map((scope) => String(scope).toUpperCase()))];
    if (!scopes.length || scopes.some((scope) => !SCOPES.has(scope))) throw new Error('Select MARKET_READ and/or PROPOSAL_PREPARE.');
    if (scopes.includes('PROPOSAL_PREPARE') && !agent.executionClasses?.includes('SAFE_PREPARATION')) throw new Error('Agent has no proposal preparation scope.');
    const expiresAtMs = input.expiresAt ? Date.parse(input.expiresAt) : Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + MAX_LIFETIME_MS) throw new Error('Grant expiry must be within the next 30 days.');
    const grantId = `AMG-${crypto.randomUUID()}`;
    const secret = crypto.randomBytes(32).toString('base64url');
    const token = `sraam.${grantId}.${secret}`;
    const grant = { grantId, agentId, scopes, secretHash:hash(secret), state:'ACTIVE', expiresAt:new Date(expiresAtMs).toISOString(), createdAt:new Date().toISOString(), createdBy:actorId, revokedAt:null, revokedBy:null };
    await this.domain.put(AGENT_MARKET_GRANT_TYPE, grantId, grant, { actorId, eventType:'SRA_AGENT_MARKET_ACCESS_ISSUED' });
    return { grant:safeGrant(grant), token };
  }

  async revoke(grantId, actorId) {
    const current = this.domain.get(AGENT_MARKET_GRANT_TYPE, grantId);
    if (!current) throw new Error('Access grant was not found.');
    if (current.state === 'REVOKED') return safeGrant(current);
    const updated = { ...current, state:'REVOKED', revokedAt:new Date().toISOString(), revokedBy:actorId };
    await this.domain.put(AGENT_MARKET_GRANT_TYPE, grantId, updated, { actorId, eventType:'SRA_AGENT_MARKET_ACCESS_REVOKED' });
    return safeGrant(updated);
  }

  authenticate(header, scope) {
    const match = /^Bearer\s+(sraam\.(AMG-[0-9a-f-]{36})\.([A-Za-z0-9_-]{43}))$/i.exec(String(header || ''));
    if (!match || !SCOPES.has(scope)) return null;
    const grant = this.domain.get(AGENT_MARKET_GRANT_TYPE, match[2]);
    if (!grant || grant.state !== 'ACTIVE' || Date.parse(grant.expiresAt) <= Date.now() || !grant.scopes?.includes(scope)) return null;
    if (this.workforce.getAgent(grant.agentId)?.state !== 'ACTIVE') return null;
    const expected = Buffer.from(grant.secretHash || '', 'hex');
    const actual = Buffer.from(hash(match[3]), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    return safeGrant(grant);
  }
}
