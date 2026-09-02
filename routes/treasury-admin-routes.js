import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { RecordedValueRepresentationService } from '../services/recorded-value-representation-service.js';
import { CoinPositionLifecycleReadService } from '../services/coin-position-lifecycle-read-service.js';
import { TreasuryFinancingCapacityService } from '../services/treasury-financing-capacity-service.js';
import {
  PlatformFundingInstrumentDepositService,
  CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
  CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD
} from '../services/platform-funding-instrument-deposit-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

const INSTRUMENT_TREASURY_ACCOUNTS = [
  { accountId: 'TRSY-1050-INSTRUMENT-USD', code: '1050', name: 'Platform Commercial Instrument — USD', category: 'ASSET', normalSide: 'DEBIT', currency: 'USD' },
  { accountId: 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING', code: '2200', name: 'Legacy Platform Instrument Funding', category: 'LIABILITY', normalSide: 'CREDIT', currency: 'USD' }
];

async function ensureInstrumentTreasuryAccounts(domain) {
  const createdAt = new Date().toISOString();
  const changes = INSTRUMENT_TREASURY_ACCOUNTS
    .filter((definition) => !domain.get(RECORD_TYPES.LEDGER_ACCOUNT, definition.accountId))
    .map((definition) => ({
      type: RECORD_TYPES.LEDGER_ACCOUNT,
      id: definition.accountId,
      actorId: 'SRA_TREASURY_SYSTEM',
      eventType: 'TREASURY_LEDGER_ACCOUNT_OPENED',
      payload: { ...definition, treasuryProfileId: 'SRA_PLATFORM_TREASURY', state: 'ACTIVE', balance: 0, totalDebits: 0, totalCredits: 0, createdAt, updatedAt: createdAt }
    }));
  if (changes.length) await domain.atomicPut(changes);
}

async function ensureCanonicalPlatformFundingInstrument(domain) {
  const existing = domain.get(RECORD_TYPES.SRA_INSTRUMENT, CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID);
  if (existing) return existing;
  const createdAt = new Date().toISOString();
  const instrument = {
    id: CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
    instrumentId: CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
    instrumentCode: 'SRA-PFI-18000000-36M',
    name: 'SRA Platform Commercial Funding Instrument',
    instrumentName: 'SRA Platform Commercial Funding Instrument',
    instrumentType: 'COMMERCIAL_INSTRUMENT',
    instrumentPurpose: 'PLATFORM_SELF_FINANCING',
    issuer: 'SRA_PLATFORM',
    ownerId: 'SRA_PLATFORM',
    currency: 'USD',
    denomination: { currency: 'USD', principalQuantity: CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD },
    principalQuantity: CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD,
    faceValueUsd: CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD,
    representedSraQuantity: CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD,
    nativeMarketPair: 'SRA/USD',
    parReference: '1 SRA = 1 USD',
    termMonths: 36,
    state: 'ISSUED',
    status: 'AVAILABLE_FOR_TREASURY_DEPOSIT',
    treasuryState: 'AWAITING_DEPOSIT',
    financingState: 'AWAITING_TREASURY_RECOGNITION',
    source: 'SRA_PLATFORM_THREE_YEAR_FINANCING_PLAN',
    createdAt,
    updatedAt: createdAt
  };
  await domain.put(RECORD_TYPES.SRA_INSTRUMENT, CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID, instrument, {
    actorId: 'SRA_TREASURY_SYSTEM',
    eventType: 'CANONICAL_PLATFORM_FUNDING_INSTRUMENT_REGISTERED'
  });
  return instrument;
}

function eligibleFundingInstruments(domain) {
  return domain.list(RECORD_TYPES.SRA_INSTRUMENT)
    .filter((instrument) => instrument.instrumentId === CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID && instrument.instrumentPurpose === 'PLATFORM_SELF_FINANCING')
    .map((instrument) => ({
      instrumentId: instrument.instrumentId || instrument.id,
      name: instrument.name || instrument.instrumentName || instrument.instrumentId || instrument.id,
      state: instrument.state || 'UNKNOWN',
      status: instrument.status || null,
      faceValueUsd: Number(instrument.faceValueUsd ?? instrument.principalQuantity ?? instrument.denomination?.principalQuantity ?? 0),
      termMonths: Number(instrument.termMonths || 36),
      coinPositionId: instrument.coinPositionId || null,
      treasuryState: instrument.treasuryState || null,
      financingState: instrument.financingState || null,
      deposited: Boolean(instrument.platformTreasuryDepositId),
      platformTreasuryDepositId: instrument.platformTreasuryDepositId || null,
      instrumentPurpose: instrument.instrumentPurpose
    }));
}

export async function installTreasuryAdminRoutes({ router, domain, requireAdmin, database = null }) {
  const treasury = new TreasuryLedgerService(domain);
  const recordedValue = new RecordedValueRepresentationService(domain);
  await domain.hydrate(['SRA_COIN_CHAIN_PROJECTION']);
  const coinPositionLifecycle = new CoinPositionLifecycleReadService(domain);
  const financingCapacity = new TreasuryFinancingCapacityService(domain);
  await treasury.initialize();
  await ensureInstrumentTreasuryAccounts(domain);
  await ensureCanonicalPlatformFundingInstrument(domain);
  const fundingInstrumentDeposits = new PlatformFundingInstrumentDepositService(domain, treasury);
  await fundingInstrumentDeposits.ensureCoinPosition();

  router.get('/api/admin/treasury', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    const fundingSummary = fundingInstrumentDeposits.summary();
    const capacity = financingCapacity.summary();
    return res.json({
      ...treasury.summary(),
      commercialInstrumentUsd: fundingSummary.depositedInstrumentValueUsd,
      totalFundingCapacityUsd: capacity.totalFundingCapacityUsd,
      committedFinancingUsd: capacity.committedFinancingUsd,
      deployedFinancingUsd: capacity.deployedFinancingUsd,
      usedFinancingCapacityUsd: capacity.usedFinancingCapacityUsd,
      availableFinancingCapacityUsd: capacity.availableFinancingCapacityUsd,
      financingCapacity: capacity,
      sraRepresentedAtParUsd: fundingSummary.representedSraQuantity,
      fundingInstrumentDeposits: fundingSummary
    });
  });

  router.get('/api/admin/treasury/financing-capacity', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(financingCapacity.summary());
  });

  router.post('/api/admin/treasury/journals/preview', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(treasury.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_JOURNAL_PREVIEW_FAILED' }); }
  });
  router.post('/api/admin/treasury/journals/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const result = await treasury.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_TREASURY_BALANCED_JOURNAL_APPROVED', objectType: 'LEDGER_ENTRY', objectId: result.journal.entryId, payload: { totalDebits: result.journal.totalDebits, totalCredits: result.journal.totalCredits, currency: result.journal.currency } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_TREASURY_JOURNAL_APPROVAL_FAILED' }); }
  });

  router.get('/api/admin/treasury/funding-instrument-deposits', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(fundingInstrumentDeposits.summary());
  });
  router.get('/api/admin/treasury/funding-instrument-deposits/eligible-instruments', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    await ensureCanonicalPlatformFundingInstrument(domain);
    const instruments = eligibleFundingInstruments(domain);
    return res.json({
      instruments,
      eligibleCount: instruments.filter((instrument) => !instrument.deposited).length,
      depositedCount: instruments.filter((instrument) => instrument.deposited).length,
      canonicalInstrumentId: CANONICAL_PLATFORM_FUNDING_INSTRUMENT_ID,
      canonicalFaceValueUsd: CANONICAL_PLATFORM_FUNDING_FACE_VALUE_USD
    });
  });
  router.post('/api/admin/treasury/funding-instrument-deposits/preview', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try { return res.json(fundingInstrumentDeposits.preview(req.body || {})); }
    catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_PREVIEW_FAILED' }); }
  });
  router.post('/api/admin/treasury/funding-instrument-deposits/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const result = await fundingInstrumentDeposits.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_APPROVED', objectType: 'SRA_INSTRUMENT', objectId: result.deposit.instrumentId, payload: { depositId: result.deposit.transactionId, faceValueUsd: result.deposit.faceValueUsd, ledgerEntryId: result.deposit.ledgerEntryId, sourceLedgerEntryId: result.deposit.sourceLedgerEntryId || null, supersededLegacyDepositCount: result.deposit.supersededLegacyDepositCount || 0 } });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_FAILED' }); }
  });

  router.get('/api/admin/recorded-value-representation', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(recordedValue.preview());
  });
  router.post('/api/admin/recorded-value-representation/approve', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    try {
      const result = await recordedValue.approve(req.body || {}, session.id);
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_RECORDED_VALUE_REPRESENTATION_CORRECTION_APPROVED', objectType: 'COIN_POSITION', objectId: 'BATCH', payload: { correctedPositionCount: result.correctedPositionCount, failedPositionCount: result.failedPositionCount } });
      return res.json(result);
    } catch (error) { return res.status(422).json({ error: error.message, code: 'SRA_RECORDED_VALUE_REPRESENTATION_CORRECTION_FAILED' }); }
  });

  router.get('/api/admin/coin-position-lifecycle', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json(coinPositionLifecycle.read());
  });

  return { treasury, recordedValue, coinPositionLifecycle, fundingInstrumentDeposits, financingCapacity };
}
