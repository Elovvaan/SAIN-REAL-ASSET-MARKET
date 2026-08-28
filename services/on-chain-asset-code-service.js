function text(value) {
  return String(value ?? '').trim();
}

function compactInstrumentId(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function stableSuffix(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

export function generateOnChainAssetCode(instrumentId) {
  const compact = compactInstrumentId(instrumentId);
  if (!compact) return '';
  if (compact.length <= 12) return compact;
  return `${compact.slice(0, 6)}${stableSuffix(compact)}`;
}

export function resolveOnChainAssetCode({ instrumentId, instrument, requestedAsset } = {}) {
  const explicit = text(requestedAsset).toUpperCase();
  if (explicit) return explicit;

  const stored = text(instrument?.assetCode || instrument?.symbol || instrument?.ticker).toUpperCase();
  if (stored) return stored;

  return generateOnChainAssetCode(instrumentId || instrument?.instrumentId || instrument?.id);
}

export function isValidOnChainAssetCode(assetCode) {
  return /^[A-Z0-9]{1,12}$/.test(text(assetCode).toUpperCase());
}
