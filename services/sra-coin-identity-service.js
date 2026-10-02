const upper = (value) => String(value ?? '').trim().toUpperCase();
export const SRA_DISCOVERY_RECORD_TYPES = ['COIN_POSITION', 'SRA_COIN_POSITION', 'SRA_INSTRUMENT', 'ON_CHAIN_ASSET', 'ON_CHAIN_USDC_MARKET', 'ON_CHAIN_NATIVE_MARKET', 'ON_CHAIN_MARKET_OFFER'];
export function sraCoinPositions(domain) {
  const positions = new Map();
  for (const type of ['COIN_POSITION', 'SRA_COIN_POSITION']) for (const item of domain.list(type)) {
    const id = item.coinPositionId || item.positionId || item.id;
    const denomination = upper(item.symbol || item.unit || item.denomination?.symbol || item.denomination).replace(/[^A-Z0-9]/g, '');
    if (id && (upper(item.assetIdentity) === 'SRA_COIN' || ['SRA', 'SRAUSD'].includes(denomination))) positions.set(id, item);
  }
  return positions;
}
export function sraCoinAssets(domain) {
  const positions = sraCoinPositions(domain);
  const instruments = new Set(domain.list('SRA_INSTRUMENT').filter((item) => positions.has(item.coinPositionId)).map((item) => item.instrumentId));
  return domain.list('ON_CHAIN_ASSET').filter((item) =>
    item.assetAddress && ['CREATED', 'ISSUED'].includes(upper(item.state)) &&
    (positions.has(item.sourcePositionId || item.coinPositionId) || instruments.has(item.instrumentId)));
}
