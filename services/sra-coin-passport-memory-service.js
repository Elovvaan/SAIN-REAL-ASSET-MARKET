const TRANSACTION_TYPE = 'SRA_TRANSACTION';

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function idOf(record) {
  return first(
    record?.transactionId,
    record?.orderIntentId,
    record?.matchReviewId,
    record?.reservationId,
    record?.allocationId,
    record?.settlementId,
    record?.transferInstructionId,
    record?.executionAuthorizationId,
    record?.transferResultId,
    record?.exportPackageId,
    record?.listingId,
    record?.id,
  );
}

function timeOf(record) {
  return first(record?.completedAt, record?.settledAt, record?.approvedAt, record?.updatedAt, record?.createdAt);
}

function participantId(record) {
  return first(record?.participantId, record?.ownerParticipantId, record?.ownerId, record?.accountHolderId);
}

function instrumentId(record) {
  return first(record?.instrumentId, record?.sraInstrumentId, record?.linkedInstrumentId);
}

function stateOf(record) {
  return String(first(record?.state, record?.status, 'UNKNOWN')).toUpperCase();
}

function event(type, record, detail, positionId) {
  return {
    eventId: `${type}:${idOf(record) || positionId}`,
    eventType: type,
    recordId: idOf(record),
    state: stateOf(record),
    occurredAt: timeOf(record),
    detail,
  };
}

export class SraCoinPassportMemoryService {
  constructor(domain, coinAgentService) {
    this.domain = domain;
    this.coinAgentService = coinAgentService;
  }

  related(positionId, agent) {
    const transactions = this.domain.list(TRANSACTION_TYPE);
    const instrument = agent.instrumentId;
    const lineage = agent.lineage || {};
    const reservationIds = new Set([lineage.reservationId].filter(Boolean));
    const allocationIds = new Set([lineage.allocationId].filter(Boolean));
    const settlementIds = new Set([lineage.settlementId].filter(Boolean));
    const exportIds = new Set([lineage.exportPackageId].filter(Boolean));
    const instructionIds = new Set([lineage.transferInstructionId].filter(Boolean));

    const relatedTransactions = transactions.filter((record) => {
      if (record.positionId === positionId || record.buyerPositionId === positionId || record.sellerPositionId === positionId) return true;
      if (record.positionReservation?.positionId === positionId) return true;
      if (reservationIds.has(record.reservationId)) return true;
      if (allocationIds.has(record.allocationId)) return true;
      if (settlementIds.has(record.settlementId)) return true;
      if (exportIds.has(record.exportPackageId)) return true;
      if (instructionIds.has(record.transferInstructionId)) return true;
      return Boolean(instrument && instrumentId(record) === instrument);
    });

    return {
      transactions: relatedTransactions,
      listings: this.domain.list('MARKETPLACE_LISTING').filter((record) => instrument && instrumentId(record) === instrument),
      ownership: this.domain.list('OWNERSHIP_RECOGNITION').filter((record) => record.positionId === positionId
        || (agent.participantId && instrument && participantId(record) === agent.participantId && instrumentId(record) === instrument)),
      exports: this.domain.list('EXPORT_PACKAGE').filter((record) => record.positionId === positionId
        || settlementIds.has(record.settlementId) || exportIds.has(record.exportPackageId)),
    };
  }

  passport(positionId) {
    const agent = this.coinAgentService.explain(positionId);
    const related = this.related(positionId, agent);
    const parentPositionId = first(agent.parentPositionId, agent.lineage?.parentPositionId);
    const childPositionIds = this.coinAgentService.positions()
      .map(({ record }) => record)
      .filter((record) => first(record.parentPositionId, record.sourcePositionId) === agent.positionId)
      .map((record) => first(record.coinPositionId, record.positionId, record.id))
      .filter(Boolean);

    return {
      passportType: 'SRA_COIN_AGENT_PASSPORT',
      assetName: 'SRA Coin',
      assetSymbol: 'SRA',
      nativeMarketPair: 'SRA/USD',
      parReference: { baseAsset: 'SRA Coin', baseSymbol: 'SRA', quoteCurrency: 'USD', rate: 1 },
      denomination: agent.denomination,
      agentId: agent.agentId,
      positionId: agent.positionId,
      generation: Number(agent.generation || (parentPositionId ? 2 : 1)),
      parentPositionId: parentPositionId || null,
      childPositionIds,
      quantity: agent.quantity,
      availableQuantity: agent.availableQuantity,
      reservedQuantity: agent.reservedQuantity,
      externallyTransferredQuantity: agent.externallyTransferredQuantity,
      participantId: agent.participantId,
      instrumentId: agent.instrumentId,
      ownershipState: agent.ownershipState,
      currentState: agent.currentState,
      marketplaceState: agent.marketplaceState,
      lineage: agent.lineage,
      permissions: agent.capabilities,
      prohibitedActions: agent.prohibitedActions,
      restrictions: agent.blockers,
      nextEligibleAction: agent.nextEligibleAction,
      humanApprovalRequired: agent.humanApprovalRequired,
      recordCoverage: {
        marketplaceListings: related.listings.length,
        lifecycleTransactions: related.transactions.length,
        ownershipRecognitions: related.ownership.length,
        exportPackages: related.exports.length,
      },
      authorityBoundary: 'EXPLAIN_AND_PREPARE_ONLY',
      generatedAt: new Date().toISOString(),
    };
  }

  memory(positionId) {
    const agent = this.coinAgentService.explain(positionId);
    const related = this.related(positionId, agent);
    const events = [];

    events.push({
      eventId: `COIN_POSITION:${agent.positionId}`,
      eventType: 'SRA_COIN_POSITION_RECOGNIZED',
      recordId: agent.positionId,
      state: agent.currentState,
      occurredAt: null,
      detail: `SRA Coin Position ${agent.positionId} represents ${agent.quantity} ${agent.denomination}. Its native market is SRA/USD at the platform par reference of 1 SRA to 1 USD.`,
    });

    for (const listing of related.listings) {
      events.push(event('MARKETPLACE_LISTING', listing, `Listing ${idOf(listing)} entered ${stateOf(listing)}.`, agent.positionId));
    }
    for (const ownership of related.ownership) {
      events.push(event('OWNERSHIP_RECOGNITION', ownership, `Ownership was recorded for ${participantId(ownership) || agent.participantId || 'the controlling participant'}.`, agent.positionId));
    }
    for (const record of related.transactions) {
      const type = String(record.transactionType || 'SRA_TRANSACTION').toUpperCase();
      events.push(event(type, record, `${type.replaceAll('_', ' ')} reached ${stateOf(record)}.`, agent.positionId));
    }
    for (const pkg of related.exports) {
      events.push(event('EXPORT_PACKAGE', pkg, `Export package ${idOf(pkg)} reached ${stateOf(pkg)}.`, agent.positionId));
    }

    const deduped = [...new Map(events.map((entry) => [entry.eventId, entry])).values()]
      .sort((a, b) => String(a.occurredAt || '').localeCompare(String(b.occurredAt || '')));

    const counts = deduped.reduce((result, entry) => {
      result[entry.eventType] = (result[entry.eventType] || 0) + 1;
      return result;
    }, {});

    return {
      memoryType: 'SRA_COIN_AGENT_MEMORY',
      assetName: 'SRA Coin',
      assetSymbol: 'SRA',
      nativeMarketPair: 'SRA/USD',
      agentId: agent.agentId,
      positionId: agent.positionId,
      authoritativeSource: 'DERIVED_FROM_CANONICAL_PLATFORM_RECORDS',
      eventCount: deduped.length,
      participationCounts: counts,
      latestEvent: deduped.at(-1) || null,
      events: deduped,
      memoryBoundary: 'MEMORY_EXPLAINS_HISTORY_BUT_DOES_NOT_OVERRIDE_FINANCIAL_RECORDS',
      generatedAt: new Date().toISOString(),
    };
  }

  inspect(positionId) {
    return {
      passport: this.passport(positionId),
      memory: this.memory(positionId),
    };
  }
}
