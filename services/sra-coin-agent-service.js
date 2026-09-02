const POSITION_TYPES = ['COIN_POSITION', 'SRA_COIN_POSITION'];
const TRANSACTION_TYPE = 'SRA_TRANSACTION';

function first(...values) { return values.find((value) => value !== undefined && value !== null && value !== '') ?? null; }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function recordId(record) { return first(record?.coinPositionId, record?.positionId, record?.id); }
function participantId(record) { return first(record?.participantId, record?.ownerParticipantId, record?.ownerId, record?.accountHolderId); }
function instrumentId(record) { return first(record?.instrumentId, record?.sraInstrumentId, record?.linkedInstrumentId); }
function stateOf(record) { return String(first(record?.state, record?.status, 'UNKNOWN')).toUpperCase(); }
function idOf(record, ...fields) { return first(...fields.map((field) => record?.[field]), record?.transactionId, record?.id); }
function restricted(record) {
  return Boolean(record?.frozen || record?.complianceHold || record?.transferRestricted || record?.exportRestricted
    || record?.externalTransferRestricted || record?.disputeState === 'OPEN' || stateOf(record) === 'FROZEN');
}

export class SraCoinAgentService {
  constructor(domain) { this.domain = domain; }

  resolvePosition(positionId) {
    const id = String(positionId || '').trim();
    if (!id) throw new Error('positionId is required.');
    for (const type of POSITION_TYPES) {
      const record = this.domain.get(type, id);
      if (record) return { type, record };
      const persisted = this.domain.list(type).find((item) => String(recordId(item) || '').trim() === id);
      if (persisted) return { type, record: persisted };
    }
    throw new Error('SRA Coin Position was not found.');
  }

  positions() {
    const seen = new Set();
    const records = [];
    for (const type of POSITION_TYPES) {
      for (const record of this.domain.list(type)) {
        const id = recordId(record);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        records.push({ type, record });
      }
    }
    return records;
  }

  transactions() { return this.domain.list(TRANSACTION_TYPE); }

  explain(positionId) {
    const { type, record: position } = this.resolvePosition(positionId);
    const id = recordId(position);
    const owner = participantId(position);
    const directInstrumentId = instrumentId(position);
    const tx = this.transactions();
    const linkedInstrument = directInstrumentId ? this.domain.get('SRA_INSTRUMENT', directInstrumentId) : this.domain.list('SRA_INSTRUMENT').find((item) => item.coinPositionId === id) || null;
    const instrument = directInstrumentId || linkedInstrument?.instrumentId || null;
    const observation = position.observationId ? this.domain.get('MARKET_OBSERVATION', position.observationId) : null;
    const onChainAssets = this.domain.list('ON_CHAIN_ASSET').filter((item) => item.sourcePositionId === id || item.coinPositionId === id || (instrument && item.instrumentId === instrument));
    const ownership = this.domain.list('OWNERSHIP_RECOGNITION').find((item) => item.positionId === id
      || (owner && instrument && participantId(item) === owner && instrumentId(item) === instrument)) || null;
    const listings = this.domain.list('MARKETPLACE_LISTING').filter((item) => item.instrumentId === instrument);

    const reservations = tx.filter((item) => item.transactionType === 'PRE_ALLOCATION_RESERVATION'
      && (item.positionReservation?.positionId === id || item.sellerPositionId === id));
    const activeReservation = reservations.find((item) => item.positionReservation?.state === 'HELD') || null;
    const reservationIds = new Set(reservations.map((item) => idOf(item, 'reservationId')).filter(Boolean));

    const allocations = tx.filter((item) => item.transactionType === 'POSITION_ALLOCATION_APPROVAL'
      && (item.pendingBuyerPositionId === id || item.buyerPositionId === id || reservationIds.has(item.reservationId)));
    const allocation = allocations.find((item) => ['ALLOCATION_APPROVED_PENDING_SETTLEMENT', 'SETTLED'].includes(item.state)) || null;
    const allocationIds = new Set(allocations.map((item) => idOf(item, 'allocationId')).filter(Boolean));

    const settlements = tx.filter((item) => item.transactionType === 'ATOMIC_ORDER_SETTLEMENT'
      && (item.buyerPositionId === id || reservationIds.has(item.reservationId) || allocationIds.has(item.allocationId)));
    const settlement = settlements.find((item) => item.state === 'SETTLED') || settlements[0] || null;

    const exportPackage = this.domain.list('EXPORT_PACKAGE').find((item) => item.positionId === id
      || (settlement && item.settlementId === idOf(settlement, 'settlementId'))) || null;
    const transferInstruction = tx.find((item) => item.transactionType === 'EXTERNAL_TRANSFER_INSTRUCTION'
      && (item.positionId === id || (exportPackage && item.exportPackageId === exportPackage.exportPackageId))) || null;
    const execution = tx.find((item) => item.transactionType === 'EXTERNAL_TRANSFER_EXECUTION_AUTHORIZATION'
      && transferInstruction && item.transferInstructionId === idOf(transferInstruction, 'transferInstructionId')) || null;
    const result = transferInstruction ? tx.find((item) => item.transactionType === 'EXTERNAL_TRANSFER_RESULT'
      && (item.transferInstructionId === idOf(transferInstruction, 'transferInstructionId')
        || item.transferResultId === transferInstruction.transferResultId
        || item.transactionId === transferInstruction.transferResultId)) || null : null;

    const blockers = [];
    if (instrument && !linkedInstrument) blockers.push('LINKED_INSTRUMENT_NOT_FOUND');
    if (!owner) blockers.push('NO_RECOGNIZED_PARTICIPANT');
    if (restricted(position)) blockers.push('POSITION_RESTRICTED');
    if (linkedInstrument && restricted(linkedInstrument)) blockers.push('INSTRUMENT_RESTRICTED');

    const currentState = result?.result === 'COMPLETED' ? 'EXTERNALLY_HELD'
      : result?.result === 'FAILED' ? 'EXTERNAL_TRANSFER_FAILED'
      : transferInstruction ? transferInstruction.state
      : exportPackage ? exportPackage.state
      : settlement ? settlement.state
      : allocation ? allocation.state
      : activeReservation ? 'RESERVED'
      : stateOf(position);

    const readyForPublication = listings.some((item) => item.status === 'READY_FOR_PUBLICATION_APPROVAL'
      || item.state === 'READY_FOR_PUBLICATION_APPROVAL');
    const live = listings.some((item) => item.status === 'LIVE' || item.state === 'LIVE' || item.state === 'PUBLISHED');

    let nextAction = 'INSPECT_POSITION';
    let approvalRequired = false;
    if (blockers.length) nextAction = 'RESOLVE_BLOCKERS';
    else if (result?.result === 'FAILED') nextAction = 'REVIEW_FAILED_EXTERNAL_TRANSFER';
    else if (result?.result === 'COMPLETED') nextAction = 'MONITOR_EXTERNAL_HOLDING';
    else if (execution && !result) { nextAction = 'RECONCILE_EXTERNAL_RESULT'; approvalRequired = true; }
    else if (transferInstruction && transferInstruction.executionState === 'NOT_AUTHORIZED') { nextAction = 'AUTHORIZE_EXTERNAL_EXECUTION'; approvalRequired = true; }
    else if (exportPackage && !transferInstruction) { nextAction = 'VERIFY_TRANSFER_DESTINATION'; approvalRequired = true; }
    else if (settlement && !exportPackage) { nextAction = 'REVIEW_EXPORT_ELIGIBILITY'; approvalRequired = true; }
    else if (allocation && !settlement) { nextAction = 'AUTHORIZE_SETTLEMENT'; approvalRequired = true; }
    else if (activeReservation && !allocation) { nextAction = 'APPROVE_ALLOCATION'; approvalRequired = true; }
    else if (live) nextAction = 'AVAILABLE_FOR_GOVERNED_MARKET_PARTICIPATION';
    else if (readyForPublication) { nextAction = 'AUTHORIZE_PUBLICATION'; approvalRequired = true; }
    else if (onChainAssets.some((item) => item.state === 'ISSUED')) nextAction = 'MONITOR_ON_CHAIN_REPRESENTATION';
    else if (onChainAssets.length) { nextAction = 'PREPARE_ON_CHAIN_ISSUANCE'; approvalRequired = true; }
    else if (instrument) { nextAction = 'PREPARE_INSTRUMENT_REPRESENTATION'; approvalRequired = true; }
    else { nextAction = 'PREPARE_DIRECT_COIN_REPRESENTATION'; approvalRequired = true; }

    const quantity = number(first(position.availableQuantity, position.quantity, position.balance));
    const reservedQuantity = activeReservation ? number(first(activeReservation.positionReservation?.quantity, activeReservation.quantity)) : 0;
    const externallyTransferred = number(first(position.externalizedQuantity, position.externallyTransferredQuantity, position.externalQuantity));

    return {
      agentType: 'SRA_COIN_POSITION_AGENT',
      agentId: `COIN-AGENT-${id}`,
      readOnly: true,
      positionType: type,
      positionId: id,
      denomination: String(first(position.unit, position.symbol, position.denomination?.symbol, 'SRA')).toUpperCase(),
      quantity,
      availableQuantity: Math.max(0, number(first(position.availableQuantity, quantity))),
      reservedQuantity,
      externallyTransferredQuantity: externallyTransferred,
      participantId: owner,
      instrumentId: instrument,
      currentState,
      ownershipState: ownership?.state || null,
      marketplaceState: live ? 'LIVE' : readyForPublication ? 'READY_FOR_PUBLICATION_APPROVAL'
        : listings.length ? first(listings[0].status, listings[0].state) : 'NOT_LISTED',
      lineage: {
        observationId: first(position.observationId, position.sourceObservationId, linkedInstrument?.observationId),
        recognitionId: first(position.recognitionId, position.recognitionRecordId, linkedInstrument?.recognitionId),
        financialRecordId: first(position.financialRecordId, linkedInstrument?.financialRecordId),
        instrumentId: instrument,
        listingIds: listings.map((item) => first(item.listingId, item.id)).filter(Boolean),
        reservationId: idOf(activeReservation, 'reservationId'),
        allocationId: idOf(allocation, 'allocationId'),
        settlementId: idOf(settlement, 'settlementId'),
        exportPackageId: exportPackage?.exportPackageId || null,
        transferInstructionId: idOf(transferInstruction, 'transferInstructionId'),
        executionAuthorizationId: idOf(execution, 'executionAuthorizationId'),
        externalResultId: idOf(result, 'transferResultId'),
      },
      sourceClass: observation?.sourceMarket === 'COINBASE' ? 'COINBASE_RECOGNIZED_MARKET_TRANSACTION' : instrument ? 'INSTRUMENT_LINKED_POSITION' : 'RECOGNIZED_FINANCIAL_RECORD_POSITION',
      onChainRepresentations: onChainAssets.map((item) => ({ assetId:item.assetId, network:item.network, asset:item.asset, state:item.state, issuedSupply:item.issuedSupply })),
      blockers,
      nextEligibleAction: nextAction,
      humanApprovalRequired: approvalRequired,
      capabilities: ['EXPLAIN_ORIGIN', 'EXPLAIN_CURRENT_STATE', 'TRACE_LINEAGE', 'REPORT_RESTRICTIONS', 'IDENTIFY_NEXT_ACTION', 'PREPARE_GOVERNED_ACTION', 'PREPARE_INSTRUMENT_HANDOFF', 'PREPARE_ON_CHAIN_REPRESENTATION'],
      prohibitedActions: ['SELF_APPROVE', 'MOVE_VALUE_WITHOUT_AUTHORIZATION', 'CHANGE_OWNERSHIP_WITHOUT_SETTLEMENT', 'CREATE_UNVERIFIED_VALUE', 'BYPASS_POLICY'],
      explanation: this.summarize({ id, quantity, currentState, instrument, owner, blockers, nextAction, approvalRequired }),
      generatedAt: new Date().toISOString(),
    };
  }

  summarize(context) {
    const ownerText = context.owner ? ` It is controlled by ${context.owner}.` : ' No controlling participant is currently resolved.';
    const instrumentText = context.instrument ? ` It is linked to instrument ${context.instrument}.` : ' It is not linked to an instrument.';
    const blockerText = context.blockers.length ? ` Blockers: ${context.blockers.join(', ')}.` : '';
    const approvalText = context.approvalRequired ? ' The next action requires human approval.' : '';
    return `Coin Position ${context.id} represents ${context.quantity} SRA and is currently ${context.currentState}.${ownerText}${instrumentText}${blockerText} Next eligible action: ${context.nextAction}.${approvalText}`;
  }

  list({ participantId: owner = null, limit = 100 } = {}) {
    return this.positions().filter(({ record }) => !owner || participantId(record) === owner)
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)))
      .map(({ record }) => this.explain(recordId(record)));
  }

  status() {
    const agents = this.list({ limit: 500 });
    return {
      coinAgentCount: agents.length,
      requiringHumanApproval: agents.filter((item) => item.humanApprovalRequired).length,
      blocked: agents.filter((item) => item.blockers.length).length,
      externallyHeld: agents.filter((item) => item.currentState === 'EXTERNALLY_HELD').length,
      agentBoundary: 'EXPLAIN_AND_PREPARE_ONLY',
    };
  }
}
