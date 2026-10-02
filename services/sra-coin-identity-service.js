import * as StellarSdk from '@stellar/stellar-sdk';
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


export function configuredStellarAssets(environment = process.env) {
  return String(environment.SRA_STELLAR_PUBLIC_ASSETS || '').split(',').map((value) => value.trim()).filter(Boolean).map((address) => {
    const [code, issuer, extra] = address.split(':');
    if (extra || !/^[A-Z0-9]{1,12}$/.test(code || '') || !StellarSdk.StrKey.isValidEd25519PublicKey(issuer || '')) throw new Error('SRA_STELLAR_PUBLIC_ASSETS must contain Stellar code:issuer identities.');
    return {code,issuer,assetAddress:address};
  });
}

export async function readConfiguredStellarAssets(environment = process.env, fetchImpl = globalThis.fetch) {
  const horizon = String(environment.STELLAR_HORIZON_URL || (upper(environment.STELLAR_NETWORK) === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org')).replace(/\/$/, '');
  const results = await Promise.allSettled(configuredStellarAssets(environment).map(async (asset) => {
    const query = new URLSearchParams({asset_code:asset.code,asset_issuer:asset.issuer});
    const response = await fetchImpl(`${horizon}/assets?${query}`, {signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Stellar asset verification is temporarily unavailable.');
    const data = await response.json();
    const record = data._embedded?.records?.find((item) => item.asset_code === asset.code && item.asset_issuer === asset.issuer);
    if (!record) return null;
    const supply = Object.values(record.balances || {}).reduce((total, value) => total + Number(value || 0), 0)
      + Number(record.claimable_balances_amount || 0) + Number(record.liquidity_pools_amount || 0) + Number(record.contracts_amount || 0);
    if (!(supply > 0)) return null;
    return {assetId:`PUBLIC-STELLAR-${asset.code}-${asset.issuer}`,instrumentId:null,network:'STELLAR',asset:asset.code,assetAddress:asset.assetAddress,state:'ISSUED',issuedSupply:supply.toFixed(7),identitySource:'CONFIGURED_LEDGER_IDENTITY',verifiedAt:new Date().toISOString()};
  }));
  return results.filter((item) => item.status === 'fulfilled' && item.value).map((item) => item.value);
}


export async function hydrateSraIdentityRecords(domain, extraTypes = []) {
  await domain.hydrate?.(['ON_CHAIN_ASSET', 'SRA_INSTRUMENT', ...extraTypes]);
  if (!domain.hydrateRecord) {
    await domain.hydrate?.(['COIN_POSITION', 'SRA_COIN_POSITION']);
    return;
  }
  const ids = new Set([
    ...domain.list('ON_CHAIN_ASSET').map((item) => item.sourcePositionId || item.coinPositionId),
    ...domain.list('SRA_INSTRUMENT').map((item) => item.coinPositionId),
  ].filter(Boolean));
  if (domain.database?.listRecordsByIds && domain.cacheRecord) {
    for (const type of ['COIN_POSITION', 'SRA_COIN_POSITION']) {
      const missing = [...ids].filter((id) => !domain.get('COIN_POSITION', id) && !domain.get('SRA_COIN_POSITION', id));
      for (let offset = 0; offset < missing.length; offset += 500) {
        const records = await domain.database.listRecordsByIds(type, missing.slice(offset, offset + 500));
        for (const position of records) {
          const id = position.coinPositionId || position.positionId || position.id;
          if (id) domain.cacheRecord(type, id, position);
        }
      }
    }
    return;
  }
  for (const id of ids) {
    const position = await domain.hydrateRecord('COIN_POSITION', id);
    if (!position) await domain.hydrateRecord('SRA_COIN_POSITION', id);
  }
}
