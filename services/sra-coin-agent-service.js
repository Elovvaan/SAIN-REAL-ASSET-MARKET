const POSITION_TYPES = ['COIN_POSITION', 'SRA_COIN_POSITION'];
const TRANSACTION_TYPE = 'SRA_TRANSACTION';

function first(...values) { return values.find((value) => value !== undefined && value !== null && value !== '') ?? null; }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function recordId(record) { return first(record?.coinPositionId, record?.positionId, record?.id); }
function participantId(record) { return first(record?.participantId, record?.ownerParticipantId, record?.ownerId, record?.accountHolderId); }
function instrumentId(record) { return first(record?.instrumentId, record?.sraInstrumentId, record?.linkedInstrumentId); }
function stateOf(record) { return String(first(record?.state, record?.status, 'UNKNOWN')).toUpperCase(); }
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

  relatedTransactions(positionId, instrument) {
    return this.domain.list(TRANSACTION_TYPE).filter((record) => {
      const ids = [record.positionId, record.buyerPositionId, record.sellerPositionId, record.pendingBuyerPositionId];
      return ids.includes(positionId) || (instrument && record.instrumentId === instrument);
    });
  }

  explain(positionId) {
    const { type, record: position } = this.resolvePosition(positionId);
    const id = recordId(position);
    const owner = participantId(position);
    const instrument = instrumentId(position);
    const linkedInstrument = instrument ? this.domain.get('SRA_INSTRUMENT', instrument) : null;
    const ownership = this.domain.list('OWNERSHIP_RECOGNITION').find((item) => item.positionId === id || (owner && instrument && participantId(item) === owner && instrumentId(item) === instrument)) || null;
    const listings = this.domain.list('MARKETPLACE_LISTING').filter((item) => item.instrumentId === instrument);
    const transactions = this.relatedTransactions(id, instrument);
    const activeReservation = transactions.find((item) => item.transactionType === 'PRE_ALLOCATION_RESERVATION'
      && (item.positionReservation?.positionId === id || item.sellerPositionId === id)
      && item.positionReservation?.state === 'HELD') || null;
    const allocation = transactions.find((item) => item.transactionType === 'POSITION_ALLOCATION_APPROVAL'
      && ['ALLOCATION_APPROVED_PENDING_SETTLEMENT', 'SETTLED'].includes(item.state)) || null;
    const settlement = transactions.find((item) => item.transactionType === 'ATOMIC_ORDER_SETTLEMENT'
      && (item.buyerPositionId === id || item.sellerPositionId === id)) || null;
    const exportPackage = this.domain.list('EXPORT_PACKAGE').find((item) => item.positionId === id) || null;
    const transferInstruction = transactions.find((item) => item.transactionType === 'EXTERNAL_TRANSFER_INSTRUCTION' && item.positionId === id) || null;
    const execution = transactions.find((item) => item.transactionType === 'EXTERNAL_TRANSFER_EXECUTION_AUTHORIZATION' && item.positionId === id) || null;
    const result = transactions.find((item) => item.transactionType === 'EXTERNAL_TRANSFER_RESULT' && item.positionId === id) || null;
    const blockers = [];
    if (!instrument) blockers.push('NO_LINKED_INSTRUMENT');
    if (instrument && !linkedInstrument) blockers.push('LINKED_INSTRUMENT_NOT_FOUND');
    if (!owner) blockers.push('NO_RECOGNIZED_PARTICIPANT');
    if (restricted(position)) blockers.push('POSITION_RESTRICTED');
    if (linkedInstrument && restricted(linkedInstrument)) blockers.push('INSTRUMENT_RESTRICTED');

    const currentState = result?.result === 'COMPLETED' ? 'EXTERNALLY_HELD'
      : transferInstruction ? transferInstruction.state
      : exportPackage ? exportPackage.state
      : settlement ? settlement.state
      : allocation ? allocation.state
      : activeReservation ? 'RESERVED'
      : stateOf(position);

    let nextAction = 'INSPECT_POSITION';
    let approvalRequired = false;
    if (blockers.length) nextAction = 'RESOLVE_BLOCKERS';
    else if (result?.result === 'FAILED') nextAction = 'REVIEW_FAILED_EXTERNAL_TRANSFER';
    else if (execution && !result) { nextAction = 'RECONCILE_EXTERNAL_RESULT'; approvalRequired = true; }
    else if (transferInstruction && transferInstruction.executionState === 'NOT_AUTHORIZED') { nextAction = 'AUTHORIZE_EXTERNAL_EXECUTION'; approvalRequired = true; }
    else if (exportPackage && !transferInstruction) { nextAction = 'VERIFY_TRANSFER_DESTINATION'; approvalRequired = true; }
    else if (settlement && !exportPackage) { nextAction = 'REVIEW_EXPORT_ELIGIBILITY'; approvalRequired = true; }
    else if (allocation && !settlement) { nextAction = 'AUTHORIZE_SETTLEMENT'; approvalRequired = true; }
    else if (activeReservation && !allocation) { nextAction = 'APPROVE_ALLOCATION'; approvalRequired = true; }
    else if (listings.some((item) => item.status === 'LIVE')) nextAction = 'AVAILABLE_FOR_GOVERNED_MARKET_PARTICIPATION';
    else if (listings.some((item) => item.state === 'READY_FOR_PUBLICATION_APPROVAL')) { nextAction = 'AUTHORIZE_PUBLICATION'; approvalRequired = true; }
    else if (instrument) nextAction = 'APPLY_OR_REVIEW_MARKET_READINESS_POLICY';

    const quantity = number(first(position.availableQuantity, position.quantity, position.balance));
    const reservedQuantity = activeReservation ? number(first(activeReservation.positionReservation?.quantity, activeReservation.quantity)) : 0;
    const externallyTransferred = number(first(position.externallyTransferredQuantity, position.externalQuantity));

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
      marketplaceState: listings.some((item) => item.status === 'LIVE') ? 'LIVE'
        : listings.some((item) => item.state === 'READY_FOR_PUBLICATION_APPROVAL') ? 'READY_FOR_PUBLICATION_APPROVAL'
        : listings.length ? listings[0].state || listings[0].status : 'NOT_LISTED',
      lineage: {
        observationId: first(position.observationId, position.sourceObservationId, linkedInstrument?.observationId),
        recognitionId: first(position.recognitionId, position.recognitionRecordId, linkedInstrument?.recognitionId),
        financialRecordId: first(position.financialRecordId, linkedInstrument?.financialRecordId),
        instrumentId: instrument,
        listingIds: listings.map((item) => first(item.listingId, item.id)).filter(Boolean),
        reservationId: first(activeReservation?.reservationId, activeReservation?.transactionId),
        allocationId: first(allocation?.allocationId, allocation?.transactionId),
        settlementId: first(settlement?.settlementId, settlement?.transactionId),
        exportPackageId: exportPackage?.exportPackageId || null,
        transferInstructionId: first(transferInstruction?.transferInstructionId, transferInstruction?.transactionId),
        executionAuthorizationId: first(execution?.executionAuthorizationId, execution?.transactionId),
        externalResultId: first(result?.transferResultId, result?.transactionId),
      },
      blockers,
      nextEligibleAction: nextAction,
      humanApprovalRequired: approvalRequired,
      capabilities: [
        'EXPLAIN_ORIGIN', 'EXPLAIN_CURRENT_STATE', 'TRACE_LINEAGE', 'REPORT_RESTRICTIONS',
        'IDENTIFY_NEXT_ACTION', 'PREPARE_GOVERNED_ACTION',
      ],
      prohibitedActions: [
        'SELF_APPROVE', 'MOVE_VALUE_WITHOUT_AUTHORIZATION', 'CHANGE_OWNERSHIP_WITHOUT_SETTLEMENT',
        'CREATE_UNVERIFIED_VALUE', 'BYPASS_POLICY',
      ],
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
    return this.positions()
      .filter(({ record }) => !owner || participantId(record) === owner)
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
