import { TreasuryLedgerService } from '../services/treasury-ledger-service.js';
import { RecordedValueRepresentationService } from '../services/recorded-value-representation-service.js';
import { PlatformFundingInstrumentDepositService } from '../services/platform-funding-instrument-deposit-service.js';
import { RECORD_TYPES } from '../services/persistent-domain-service.js';

const INSTRUMENT_TREASURY_ACCOUNTS = [
  { accountId: 'TRSY-1050-INSTRUMENT-USD', code: '1050', name: 'Platform Commercial Instrument — USD', category: 'ASSET', normalSide: 'DEBIT', currency: 'USD' },
  { accountId: 'TRSY-2200-PLATFORM-INSTRUMENT-FUNDING', code: '2200', name: 'Platform Commercial Instrument Funding', category: 'LIABILITY', normalSide: 'CREDIT', currency: 'USD' }
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

function eligibleFundingInstruments(domain) {
  return domain.list(RECORD_TYPES.SRA_INSTRUMENT)
    .filter((instrument) => !['CANCELLED', 'MATURED', 'CLOSED'].includes(String(instrument.state || '').toUpperCase()))
    .map((instrument) => ({
      instrumentId: instrument.instrumentId || instrument.id,
      name: instrument.name || instrument.instrumentName || instrument.instrumentId || instrument.id,
      state: instrument.state || 'UNKNOWN',
      faceValueUsd: Number(instrument.faceValueUsd ?? instrument.principalQuantity ?? instrument.denomination?.principalQuantity ?? 0),
      termMonths: Number(instrument.termMonths || 36),
      coinPositionId: instrument.coinPositionId || null,
      treasuryState: instrument.treasuryState || null,
      deposited: Boolean(instrument.platformTreasuryDepositId),
      platformTreasuryDepositId: instrument.platformTreasuryDepositId || null
    }))
    .filter((instrument) => instrument.instrumentId)
    .sort((left, right) => Number(right.faceValueUsd || 0) - Number(left.faceValueUsd || 0));
}

export async function installTreasuryAdminRoutes({ router, domain, requireAdmin, database = null }) {
  const treasury = new TreasuryLedgerService(domain);
  const recordedValue = new RecordedValueRepresentationService(domain);
  await treasury.initialize();
  await ensureInstrumentTreasuryAccounts(domain);
  const fundingInstrumentDeposits = new PlatformFundingInstrumentDepositService(domain, treasury);

  router.get('/api/admin/treasury', async (req, res) => {
    const session = await requireAdmin(req, res); if (!session) return;
    return res.json({ ...treasury.summary(), fundingInstrumentDeposits: fundingInstrumentDeposits.summary() });
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
    const instruments = eligibleFundingInstruments(domain);
    return res.json({
      instruments,
      eligibleCount: instruments.filter((instrument) => !instrument.deposited).length,
      depositedCount: instruments.filter((instrument) => instrument.deposited).length
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
      if (database?.audit) await database.audit({ actorId: session.id, eventType: 'SRA_PLATFORM_FUNDING_INSTRUMENT_DEPOSIT_APPROVED', objectType: 'SRA_INSTRUMENT', objectId: result.deposit.instrumentId, payload: { depositId: result.deposit.transactionId, faceValueUsd: result.deposit.faceValueUsd, ledgerEntryId: result.deposit.ledgerEntryId } });
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

  return { treasury, recordedValue, fundingInstrumentDeposits };
}
