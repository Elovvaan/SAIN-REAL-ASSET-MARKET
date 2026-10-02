import { SRA_DISCOVERY_RECORD_TYPES, sraCoinPositions, sraCoinAssets } from './sra-coin-identity-service.js';
const LIVE = new Set(['LIVE', 'PUBLISHED', 'ACTIVE']);
const PUBLIC_URL = 'https://www.sainrealasset.com';

export class PublicSraCoinDiscoveryService {
  constructor(domain) { this.domain = domain; }

  async initialize() {
    await this.domain.hydrate?.([...SRA_DISCOVERY_RECORD_TYPES, 'MARKETPLACE_LISTING']);
    return this;
  }

  profile() {
    const positionIds = new Set(sraCoinPositions(this.domain).keys());
    const instruments = this.domain.list('SRA_INSTRUMENT').filter((item) => positionIds.has(item.coinPositionId));
    const instrumentIds = new Set(instruments.map((item) => item.instrumentId));
    const listings = this.domain.list('MARKETPLACE_LISTING')
      .filter((item) => instrumentIds.has(item.instrumentId))
      .filter((item) => LIVE.has(String(item.status || item.state || '').toUpperCase()))
      .filter((item) => !item.blockers?.length && item.canonicalization?.state !== 'INVALID_LINKED_FINANCIAL_RECORD')
      .map((item) => ({ listingId:item.listingId, instrumentId:item.instrumentId, state:item.status || item.state, unit:item.unit || 'SRA', quantity:item.quantity ?? null, currency:item.pricing?.currency || item.currency || null, unitPrice:item.pricing?.unitPrice ?? item.unitPrice ?? null }));
    const assets = sraCoinAssets(this.domain)
      .map((item) => {
        const markets = [
          ...this.domain.list('ON_CHAIN_USDC_MARKET').filter((market) => market.assetId === item.assetId).map((market) => ({ pair:'SRA/USDC', state:market.state })),
          ...this.domain.list('ON_CHAIN_NATIVE_MARKET').filter((market) => market.assetId === item.assetId).map((market) => ({ pair:'SRA/XLM', state:market.state })),
        ];
        return { assetId:item.assetId, instrumentId:item.instrumentId, network:item.network, assetCode:item.asset, assetAddress:item.assetAddress, state:item.state, issuedSupply:item.issuedSupply || '0', markets };
      });
    return {
      name:'SRA Coin', symbol:'SRA', identity:'SRA_COIN', issuer:'SAIN Real Asset Market',
      canonicalUrl:`${PUBLIC_URL}/sra-coin.html`, documentationUrl:`${PUBLIC_URL}/api/public/coin/sra`,
      description:'The SRA Coin is a fungible SRA digital financial asset represented by verified positions. Its market listings and on-chain representations are identified separately below.',
      listings, onChainRepresentations:assets,
      marketAccess:{ catalog:'Credentialed agents: /api/agent-market/catalog', publicExchange:`${PUBLIC_URL}/exchange-settled-sra.html` },
    };
  }
}
