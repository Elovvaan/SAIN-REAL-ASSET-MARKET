import crypto from 'node:crypto';

export const AGENT_MARKET_PROPOSAL_TYPE = 'SRA_AGENT_MARKET_PROPOSAL';
const LIVE = new Set(['LIVE', 'PUBLISHED', 'ACTIVE']);
const text = (value, name) => {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
};
const positive = (value, name) => {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${name} must be positive.`);
  return result;
};
const digest = (terms) => crypto.createHash('sha256').update(JSON.stringify(terms)).digest('hex');

export class AgentMarketProposalService {
  constructor(domain, workforce) { this.domain = domain; this.workforce = workforce; }

  catalog() {
    return this.domain.list('MARKETPLACE_LISTING')
      .filter((item) => LIVE.has(String(item.status || item.state || '').toUpperCase()) || LIVE.has(String(item.state || '').toUpperCase()))
      .filter((item) => !item.blockers?.length && item.canonicalization?.state !== 'INVALID_LINKED_FINANCIAL_RECORD')
      .map((item) => ({
        listingId: item.listingId, instrumentId: item.instrumentId, assetId: item.assetId || null,
        title: item.title, unit: item.unit, quantity: item.quantity,
        pricing: { currency: item.pricing?.currency || null, unitPrice: item.pricing?.unitPrice ?? null, method: item.pricing?.method || null },
        access: { minimumOrder: item.access?.minimumOrder ?? null, maximumOrder: item.access?.maximumOrder ?? null },
        state: item.state, status: item.status, updatedAt: item.updatedAt,
      }));
  }

  list() { return this.domain.list(AGENT_MARKET_PROPOSAL_TYPE); }
  get(id) { return this.domain.get(AGENT_MARKET_PROPOSAL_TYPE, id); }

  async prepare(input, actorId) {
    const agentId = text(input.agentId, 'agentId');
    const agent = this.workforce.getAgent(agentId);
    if (!agent || agent.state !== 'ACTIVE' || !agent.executionClasses?.includes('SAFE_PREPARATION')) throw new Error('Active agent with preparation scope is required.');
    const listingId = text(input.listingId, 'listingId');
    const listing = this.catalog().find((item) => item.listingId === listingId);
    if (!listing) throw new Error('Live verified listing was not found.');
    const quantity = positive(input.quantity, 'quantity');
    if (quantity > Number(listing.quantity) || (listing.access.minimumOrder != null && quantity < Number(listing.access.minimumOrder)) || (listing.access.maximumOrder != null && quantity > Number(listing.access.maximumOrder))) throw new Error('Quantity is outside available listing limits.');
    const terms = Object.freeze({
      listingId, instrumentId: listing.instrumentId, assetId: listing.assetId,
      quantity, unit: listing.unit, recipientId: text(input.recipientId, 'recipientId'),
      settlementRoute: text(input.settlementRoute, 'settlementRoute').toUpperCase(),
      considerationUnit: text(input.considerationUnit, 'considerationUnit').toUpperCase(),
      limitPrice: positive(input.limitPrice, 'limitPrice'),
      maximumFees: Number(input.maximumFees),
      expiresAt: text(input.expiresAt, 'expiresAt'),
    });
    if (!Number.isFinite(terms.maximumFees) || terms.maximumFees < 0) throw new Error('maximumFees must be zero or greater.');
    if (!Number.isFinite(Date.parse(terms.expiresAt)) || Date.parse(terms.expiresAt) <= Date.now()) throw new Error('expiresAt must be a future date.');
    const timestamp = new Date().toISOString();
    const proposal = {
      proposalId: `AMP-${crypto.randomUUID()}`, agentId, terms, termsHash: digest(terms),
      listingUpdatedAt: listing.updatedAt || null, state: 'PREPARED', executionAuthorized: false,
      createdBy: agentId, requestedBy: actorId, createdAt: timestamp, updatedAt: timestamp, reviewedBy: null,
    };
    await this.domain.put(AGENT_MARKET_PROPOSAL_TYPE, proposal.proposalId, proposal, { actorId, eventType: 'SRA_AGENT_MARKET_PROPOSAL_PREPARED' });
    return proposal;
  }

  async review(proposalId, input, actorId) {
    const current = this.get(proposalId);
    if (!current) throw new Error('Proposal was not found.');
    if (current.state !== 'PREPARED') throw new Error('Proposal has already been reviewed.');
    if (current.createdBy === actorId || current.agentId === actorId) throw new Error('Proposal creator cannot approve the proposal.');
    const decision = text(input.decision, 'decision').toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('Review decision must be APPROVE or REJECT.');
    if (input.termsHash !== current.termsHash) throw new Error('Exact proposal terms hash is required.');
    if (Date.parse(current.terms.expiresAt) <= Date.now()) throw new Error('Proposal has expired.');
    if (decision === 'APPROVE') {
      const listing = this.catalog().find((item) => item.listingId === current.terms.listingId);
      if (!listing || listing.updatedAt !== current.listingUpdatedAt || Number(listing.quantity) < current.terms.quantity) throw new Error('Listing changed; prepare a new proposal.');
      if (this.workforce.getAgent(current.agentId)?.state !== 'ACTIVE') throw new Error('Agent is paused or unavailable.');
    }
    const reviewed = { ...current, state: decision === 'APPROVE' ? 'APPROVED_FOR_HANDOFF' : 'REJECTED', executionAuthorized: false, reviewedBy: actorId, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await this.domain.put(AGENT_MARKET_PROPOSAL_TYPE, proposalId, reviewed, { actorId, eventType: `SRA_AGENT_MARKET_PROPOSAL_${reviewed.state}` });
    return reviewed;
  }
}
