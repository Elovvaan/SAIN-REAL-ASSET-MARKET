import crypto from 'node:crypto';

const ACTIVE_MARKET_STATES = new Set(['ACTIVE','CONFIRMED','READY','TWO_SIDED','LIVE']);
const BLOCKED_POSITION_STATES = new Set(['FROZEN','RESTRICTED','RETIRED','EXTERNALLY_TRANSFERRED']);
const number = (...values) => { for (const value of values) if (Number.isFinite(Number(value))) return Number(value); return 0; };
const upper = (value) => String(value || '').trim().toUpperCase();
const idOf = (record, fallback = '') => record?.assetId || record?.coinPositionId || record?.positionId || record?.instrumentId || record?.id || fallback;

export const CAPITAL_ACTIVATION_POLICY = Object.freeze({
  authorityLevel: 'RECOMMEND_AND_PREPARE_ONLY',
  verifiedAssetsOnly: true,
  administratorApprovalRequired: true,
  automaticExecution: false,
  leverageCap: 0,
  reserveFloorPercent: 40,
  singleAssetAllocationCapPercent: 20,
  externalMarkets: 'OBSERVE_ONLY_UNTIL_VENUE_AND_MANDATE_ARE_AUTHORIZED',
});

export class CapitalActivationAgentService {
  constructor(domain) { this.domain = domain; }

  snapshot() {
    const assets = this.domain.list('ON_CHAIN_ASSET');
    const positions = [...this.domain.list('COIN_POSITION'), ...this.domain.list('SRA_COIN_POSITION')];
    const markets = this.domain.list('ON_CHAIN_USDC_MARKET');
    const readiness = this.domain.list('ON_CHAIN_USDC_MARKET_READINESS');
    const offers = this.domain.list('ON_CHAIN_MARKET_OFFER');
    const reservations = this.domain.list('POSITION_RESERVATION');
    const queue = [];
    const represented = new Set();

    for (const asset of assets) {
      const assetId = idOf(asset);
      const instrumentId = asset.instrumentId || null;
      const position = positions.find((item) => item.coinPositionId === asset.sourceCoinPositionId || item.positionId === asset.sourceCoinPositionId || (instrumentId && item.instrumentId === instrumentId));
      if (position) represented.add(idOf(position));
      const issued = number(asset.issuedSupply, asset.totalIssuedSupply, asset.lastIssuedAmount);
      const available = number(asset.walletBalance, asset.distributionBalance, position?.externalizedQuantity, issued);
      const market = markets.find((item) => item.assetId === assetId || (instrumentId && item.instrumentId === instrumentId));
      const offer = offers.find((item) => item.assetId === assetId || (instrumentId && item.instrumentId === instrumentId));
      const ready = readiness.find((item) => item.assetId === assetId || (instrumentId && item.instrumentId === instrumentId));
      const reserved = reservations.some((item) => (item.positionId === idOf(position) || item.instrumentId === instrumentId) && !['RELEASED','CANCELLED','SETTLED'].includes(upper(item.state || item.status)));
      const marketLive = ACTIVE_MARKET_STATES.has(upper(market?.state || market?.confirmation?.state || offer?.state));
      let classification = 'DORMANT'; let action = 'ISSUE_APPROVED_SUPPLY'; let reason = 'The representation exists, but no issued units are available to activate.';
      if (reserved) { classification = 'RESERVED'; action = 'MONITOR_SETTLEMENT'; reason = 'Units are committed to an open reservation or settlement workflow.'; }
      else if (marketLive) { classification = 'DEPLOYABLE'; action = 'MONITOR_AND_REBALANCE'; reason = 'Issued inventory has an active market route.'; }
      else if (issued > 0 && ready) { classification = 'LIQUIDITY_BLOCKED'; action = 'FUND_COUNTER_ASSET_AND_ACTIVATE_MARKET'; reason = 'Issued inventory is present, but the SRAUSD/USDC market still needs counter-asset liquidity or confirmation.'; }
      else if (issued > 0) { classification = 'MARKET_READY'; action = 'PREPARE_SRAUSD_USDC_MARKET'; reason = 'Issued inventory is online and can be prepared for a governed market activation.'; }
      queue.push({ assetId, instrumentId, coinPositionId:idOf(position) || null, network:upper(asset.network) || 'UNKNOWN', symbol:asset.asset || asset.assetCode || asset.symbol || 'SRA', availableAmount:available, issuedAmount:issued, classification, recommendedAction:action, reason, executionAuthorized:false });
    }

    for (const position of positions) {
      if (represented.has(idOf(position))) continue;
      const available = number(position.availableQuantity, position.quantity);
      const blocked = BLOCKED_POSITION_STATES.has(upper(position.state || position.status)) || position.frozen || position.complianceHold || position.transferRestricted;
      queue.push({ assetId:null, instrumentId:position.instrumentId || position.sourceInstrumentId || null, coinPositionId:idOf(position), network:null, symbol:position.symbol || position.unit || 'SRA', availableAmount:available, issuedAmount:0, classification:blocked ? 'RESERVED' : 'DORMANT', recommendedAction:blocked ? 'RESOLVE_POSITION_RESTRICTION' : 'PREPARE_ON_CHAIN_REPRESENTATION', reason:blocked ? 'This position is restricted and cannot be allocated.' : 'This verified platform position has not been represented on chain.', executionAuthorized:false });
    }

    const counts = queue.reduce((result, item) => ({ ...result, [item.classification]:(result[item.classification] || 0) + 1 }), {});
    return {
      agentId:'SRA-CAPITAL-ACTIVATION-AGENT', state:queue.some((item) => item.classification === 'LIQUIDITY_BLOCKED') ? 'ACTION_REQUIRED' : 'CURRENT', generatedAt:new Date().toISOString(), policy:CAPITAL_ACTIVATION_POLICY,
      summary:{ totalAssets:queue.length, deployable:counts.DEPLOYABLE || 0, marketReady:counts.MARKET_READY || 0, liquidityBlocked:counts.LIQUIDITY_BLOCKED || 0, dormant:counts.DORMANT || 0, reserved:counts.RESERVED || 0, availableUnits:queue.reduce((sum,item)=>sum+item.availableAmount,0) },
      queue,
      externalMarketBoundary:{ state:'OBSERVATION_ONLY', supportedUniverse:['PUBLIC_EQUITIES','DIGITAL_ASSETS','VERIFIED_DEFI'], executionRequirements:['AUTHORIZED_VENUE_CONNECTION','APPROVED_CAPITAL_MANDATE','INSTRUMENT_VERIFICATION','ADMINISTRATOR_APPROVAL'] },
    };
  }

  async prepareProposal(subjectId, input = {}, actorId = 'SRA_AGENT_OS') {
    const item = this.snapshot().queue.find((entry) => [entry.assetId,entry.coinPositionId,entry.instrumentId].filter(Boolean).includes(subjectId));
    if (!item) throw new Error('Capital activation subject was not found.');
    if (item.classification === 'RESERVED') throw new Error('Reserved or restricted capital cannot be prepared for allocation.');
    const amount = number(input.amount, item.availableAmount);
    if (amount <= 0 || amount > item.availableAmount) throw new Error('Proposal amount must be positive and cannot exceed available inventory.');
    const proposalId = `CAP-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const proposal = { proposalId, agentId:'SRA-CAPITAL-ACTIVATION-AGENT', subjectId, assetId:item.assetId, coinPositionId:item.coinPositionId, instrumentId:item.instrumentId, amount, unit:item.symbol, strategy:upper(input.strategy || item.recommendedAction), state:'PREPARED', executionAuthorized:false, administratorApprovalRequired:true, policy:CAPITAL_ACTIVATION_POLICY, rationale:item.reason, createdAt:timestamp, updatedAt:timestamp };
    await this.domain.put('CAPITAL_ACTIVATION_PROPOSAL', proposalId, proposal, { actorId, eventType:'CAPITAL_ACTIVATION_PROPOSAL_PREPARED' });
    return proposal;
  }
}
