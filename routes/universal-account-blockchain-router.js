import crypto from 'node:crypto';
import express, { Router } from 'express';
import { AccessService } from '../services/access-service.js';

const BLOCKCHAIN_ACCOUNT = 'BLOCKCHAIN_ACCOUNT';
const FUNDING_INSTRUCTION = 'FUNDING_INSTRUCTION';

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const entry = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`; }
function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}
function address(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error('A valid Base-compatible public address is required.');
  return normalized;
}
function accountIdFor(session) { return `BCA-${session.universalAccountId}`; }
function publicAccount(record) {
  if (!record) return null;
  return {
    blockchainAccountId: record.blockchainAccountId,
    universalAccountId: record.universalAccountId,
    participantId: record.participantId,
    network: record.network,
    asset: record.asset,
    depositAddress: record.depositAddress || null,
    state: record.state,
    custodyModel: record.custodyModel,
    privateKeyStoredBySra: false,
    requestedAt: record.requestedAt || null,
    provisionedAt: record.provisionedAt || null
  };
}
function fundingProjection(record) {
  return {
    fundingInstructionId: record.fundingInstructionId,
    purpose: record.purpose,
    amount: record.amount,
    currency: record.currency,
    rail: record.rail,
    network: record.network,
    asset: record.asset,
    receivingAddress: record.receivingAddress,
    blockchainAccountId: record.blockchainAccountId,
    state: record.state,
    createdAt: record.createdAt,
    confirmedAt: record.confirmedAt || null
  };
}

export async function createUniversalAccountBlockchainRouter(domain, database) {
  await domain.hydrate([BLOCKCHAIN_ACCOUNT]);
  const access = new AccessService({ database });
  await access.initialize();
  const router = Router();
  router.use(express.json({ limit: '256kb' }));

  async function sessionFor(req) { return access.getSession(readCookie(req, 'sra_session')); }
  async function requireSession(req, res) {
    const session = await sessionFor(req);
    if (!session) res.status(401).json({ error: 'Authentication required.' });
    return session;
  }

  router.get('/api/blockchain-accounts/me', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      const record = domain.get(BLOCKCHAIN_ACCOUNT, accountIdFor(session));
      return res.json({ blockchainAccount: publicAccount(record), available: Boolean(record?.depositAddress && record.state === 'ACTIVE') });
    } catch (error) { return res.status(500).json({ error: error.message || 'Blockchain account lookup failed.' }); }
  });

  router.post('/api/blockchain-accounts/me/request', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      const blockchainAccountId = accountIdFor(session);
      const existing = domain.get(BLOCKCHAIN_ACCOUNT, blockchainAccountId);
      if (existing) return res.status(200).json({ blockchainAccount: publicAccount(existing) });
      const createdAt = now();
      const record = {
        blockchainAccountId,
        universalAccountId: session.universalAccountId,
        participantId: session.id,
        network: 'BASE',
        asset: 'USDC',
        state: 'AWAITING_PROVISIONING',
        custodyModel: 'EXTERNALLY_PROVISIONED_DEPOSIT_ADDRESS',
        privateKeyStoredBySra: false,
        requestedAt: createdAt,
        createdAt,
        updatedAt: createdAt
      };
      await domain.put(BLOCKCHAIN_ACCOUNT, blockchainAccountId, record, { actorId: session.id, eventType: 'BLOCKCHAIN_ACCOUNT_REQUESTED' });
      return res.status(201).json({ blockchainAccount: publicAccount(record) });
    } catch (error) { return res.status(400).json({ error: error.message || 'Blockchain account request failed.' }); }
  });

  router.post('/api/blockchain-accounts/admin/:blockchainAccountId/provision', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      if (session.activeCapacity !== 'PLATFORM_ADMIN') return res.status(403).json({ error: 'Platform Administration authorization is required.' });
      const record = domain.get(BLOCKCHAIN_ACCOUNT, req.params.blockchainAccountId);
      if (!record) return res.status(404).json({ error: 'Blockchain account request not found.' });
      const depositAddress = address(req.body?.depositAddress);
      const duplicate = domain.list(BLOCKCHAIN_ACCOUNT).find((entry) => entry.blockchainAccountId !== record.blockchainAccountId && String(entry.depositAddress || '').toLowerCase() === depositAddress);
      if (duplicate) return res.status(409).json({ error: 'That deposit address is already assigned to another Universal Account.' });
      const provisionedAt = now();
      const updated = {
        ...record,
        depositAddress,
        state: 'ACTIVE',
        provisionedBy: session.id,
        provisionedAt,
        updatedAt: provisionedAt
      };
      await domain.put(BLOCKCHAIN_ACCOUNT, record.blockchainAccountId, updated, { actorId: session.id, eventType: 'BLOCKCHAIN_ACCOUNT_PROVISIONED' });
      return res.json({ blockchainAccount: publicAccount(updated) });
    } catch (error) { return res.status(400).json({ error: error.message || 'Blockchain account provisioning failed.' }); }
  });

  router.post('/api/access/funding/crypto-instructions', async (req, res) => {
    try {
      const session = await requireSession(req, res); if (!session) return;
      const requestedAmount = money(req.body?.amount);
      if (requestedAmount <= 0) return res.status(400).json({ error: 'Funding amount must be greater than zero.' });
      const blockchainAccount = domain.get(BLOCKCHAIN_ACCOUNT, accountIdFor(session));
      if (!blockchainAccount || blockchainAccount.state !== 'ACTIVE' || !blockchainAccount.depositAddress) {
        return res.status(409).json({ error: 'A dedicated Base deposit address must be provisioned for this Universal Account first.', blockchainAccount: publicAccount(blockchainAccount) });
      }
      const createdAt = now();
      const record = {
        fundingInstructionId: id('CRYPTO'),
        purpose: 'ASSET_VAULT_FUNDING',
        participantId: session.id,
        accountId: session.universalAccountId,
        blockchainAccountId: blockchainAccount.blockchainAccountId,
        amount: requestedAmount,
        currency: 'USD',
        rail: 'CRYPTO',
        network: 'BASE',
        asset: 'USDC',
        receivingAddress: blockchainAccount.depositAddress,
        destinationType: 'UNIVERSAL_ACCOUNT_DEDICATED_DEPOSIT_ADDRESS',
        state: 'AWAITING_BLOCKCHAIN_TRANSFER',
        createdBy: session.id,
        createdAt,
        updatedAt: createdAt
      };
      await domain.put(FUNDING_INSTRUCTION, record.fundingInstructionId, record, { actorId: session.id, eventType: 'DEDICATED_ADDRESS_CRYPTO_FUNDING_INSTRUCTION_CREATED' });
      return res.status(201).json({ instruction: fundingProjection(record), blockchainAccount: publicAccount(blockchainAccount), balanceCredited: false });
    } catch (error) { return res.status(400).json({ error: error.message || 'Crypto funding instruction could not be created.' }); }
  });

  return router;
}
