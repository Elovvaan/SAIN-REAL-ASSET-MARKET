export function buildSraCoreOperationalBrief(status = {}) {
  const latest = status.latestCycle || null;
  const results = Array.isArray(latest?.results) ? latest.results : [];
  const failed = results.filter((item) => item.state === 'FAILED');
  const completed = results.filter((item) => item.state === 'COMPLETED');
  const outputs = Object.fromEntries(results.map((item) => [item.engine, item.output || null]));
  const market = outputs.MARKET_ENGINE || {};
  const recognition = outputs.RECOGNITION_ENGINE || {};
  const value = outputs.VERIFIED_VALUE_ENGINE || {};
  const instruments = outputs.INSTRUMENT_ENGINE || {};
  const relationships = outputs.RELATIONSHIP_ENGINE || {};
  const hybrid = outputs.HYBRID_REFERENCE_ENGINE || {};

  const movement = {
    observations: Number(recognition.recordsObserved || 0),
    recognitions: Number(recognition.recognitionRecords || 0),
    financialRecords: Number(value.financialRecords || 0),
    coinPositions: Number(value.coinPositions || 0),
    instruments: Number(instruments.instruments || 0),
    marketplaceListings: Number(market.listings || 0),
    liveListings: Number(market.live || 0),
    preparedListings: Number(market.prepared || 0),
    relationships: Number(relationships.relationships || 0),
    hybridMarkets: Number(hybrid.marketDefinitions || 0),
    hybridReferences: Number(hybrid.referenceObservations || 0),
  };

  let state = 'WAITING_FOR_FIRST_CYCLE';
  if (latest) state = failed.length ? 'ATTENTION_REQUIRED' : status.running ? 'OPERATING' : 'HEALTHY';

  const attention = [];
  if (!latest) attention.push('No completed core-services cycle is available yet.');
  for (const item of failed) attention.push(`${item.engine}: ${item.error || 'Engine cycle failed.'}`);
  if (movement.preparedListings > 0) attention.push(`${movement.preparedListings.toLocaleString()} marketplace listings remain prepared and are not live.`);

  const reply = !latest
    ? 'SRA Core Services are waiting for the first completed operating cycle.'
    : failed.length
      ? `The latest SRA operating cycle completed with ${failed.length} engine failure${failed.length === 1 ? '' : 's'}. ${completed.length} engines completed successfully.`
      : `SRA Core Services completed the latest cycle successfully across ${completed.length} engines. The platform currently records ${movement.observations.toLocaleString()} observations, ${movement.coinPositions.toLocaleString()} Coin Positions, ${movement.instruments.toLocaleString()} instruments, and ${movement.liveListings.toLocaleString()} live listings.`;

  return {
    state,
    reply,
    heartbeat: {
      schedulerState: status.state || 'UNKNOWN',
      runningNow: Boolean(status.running),
      intervalMs: Number(status.intervalMs || 0),
      cycleCount: Number(status.cycleCount || 0),
      activePolicyCount: Number(status.activePolicyCount || 0),
      latestCycleId: latest?.cycleId || null,
      latestTrigger: latest?.trigger || null,
      latestState: latest?.state || null,
      startedAt: latest?.startedAt || null,
      completedAt: latest?.completedAt || null,
      completedEngines: Number(latest?.completedEngines || 0),
      failedEngines: Number(latest?.failedEngines || 0),
    },
    movement,
    engines: results.map((item) => ({
      name: item.engine,
      state: item.state,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      output: item.output || null,
      error: item.error || null,
    })),
    attention,
    nextAction: failed.length
      ? 'Review the failed engine output before relying on that portion of the platform state.'
      : movement.preparedListings > 0
        ? 'Review the prepared marketplace backlog and apply the approved authorization policy when appropriate.'
        : 'No core-services intervention is currently required.',
  };
}
