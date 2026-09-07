import crypto from 'node:crypto';
import { ensurePlatformAdministrator } from './admin-bootstrap-service.js';

const CAPACITY_DEFINITIONS = {
  UNIVERSAL: {
    label: 'Universal Account',
    tier: 'FREE',
    feeBasis: 'No account fee. Participation-specific terms may still apply.',
    activation: 'AUTOMATIC',
    selfService: false,
    activationGate: 'AUTOMATIC',
    upgradeFlow: ['ACCOUNT_CREATED', 'ACTIVE'],
    feeTrigger: null
  },
  ASSET_PROVIDER: {
    label: 'Asset Provider',
    tier: 'PAID',
    feeBasis: 'V4V intake, verification, listing, and project-related fees.',
    activation: 'APPLICATION',
    selfService: true,
    activationGate: 'FEE_SCHEDULE_SETTLEMENT_AND_REVIEW',
    upgradeFlow: ['APPLICATION', 'FEE_SCHEDULE', 'PAYMENT_SETTLEMENT', 'REVIEW', 'ACTIVE'],
    feeTrigger: 'ASSET_PROVIDER_CAPABILITY_ACTIVATION'
  },
  MARKET_PROFESSIONAL: {
    label: 'Market Professional',
    tier: 'PAID',
    feeBasis: 'Professional subscription, credential review, matching, and transaction fees.',
    activation: 'APPLICATION',
    selfService: true,
    activationGate: 'FEE_SCHEDULE_SETTLEMENT_AND_REVIEW',
    upgradeFlow: ['APPLICATION', 'FEE_SCHEDULE', 'PAYMENT_SETTLEMENT', 'REVIEW', 'ACTIVE'],
    feeTrigger: 'MARKET_PROFESSIONAL_CAPABILITY_ACTIVATION'
  },
  INSTITUTIONAL_OPERATOR: {
    label: 'Institutional Operator',
    tier: 'AGREEMENT',
    feeBasis: 'Institutional agreement and authorization.',
    activation: 'INSTITUTIONAL_APPROVAL',
    selfService: false,
    activationGate: 'INSTITUTIONAL_AGREEMENT_AND_APPROVAL',
    upgradeFlow: ['AGREEMENT', 'INSTITUTIONAL_REVIEW', 'APPROVAL', 'ACTIVE'],
    feeTrigger: null
  },
  PLATFORM_ADMIN: {
    label: 'Platform Administration',
    tier: 'INTERNAL',
    feeBasis: 'Internal platform authorization only.',
    activation: 'INTERNAL_AUTHORIZATION',
    selfService: false,
    activationGate: 'INTERNAL_AUTHORIZATION',
    upgradeFlow: ['INTERNAL_AUTHORIZATION', 'ACTIVE'],
    feeTrigger: null
  }
};

const CAPACITY_STATES = ['NOT_ADDED','APPLICATION_STARTED','INFORMATION_REQUIRED','UNDER_REVIEW','ACTIVE','SUSPENDED','CLOSED'];
const RUNTIME_SESSIONS = new Map();

function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 180) : ''; }
function clean(value, max = 160) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function verifyPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function buildCapacityState(activeCapacities = []) {
  const records = {};
  Object.keys(CAPACITY_DEFINITIONS).forEach((id) => {
    records[id] = {
      id,
      state: activeCapacities.includes(id) ? 'ACTIVE' : 'NOT_ADDED',
      appliedAt: null,
      activatedAt: activeCapacities.includes(id) ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
      feeScheduleId: null,
      invoiceId: null,
      feeTotal: null,
      feeCurrency: null,
      billingState: null,
      reviewState: null,
      paymentSettledAt: null,
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null
    };
  });
  records.UNIVERSAL.state = 'ACTIVE';
  return records;
}

export class AccessService {
  constructor({ database = null } = {}) {
    this.database = database;
    this.users = new Map();
    this.sessions = new Map();
  }

  async initialize() {
    const persistedUsers = this.database ? await this.database.listUsers() : [];
    const persistedSessions = this.database ? await this.database.listSessions() : [];
    persistedUsers.forEach((user) => this.users.set(user.email, user));
    persistedSessions.forEach((session) => this.sessions.set(session.tokenHash, session));
    await ensurePlatformAdministrator(this, { database: this.database });
    if (!this.users.size && process.env.NODE_ENV !== 'production') await this.seedDemoUsers();
  }

  async refreshPersistedUsers() {
    if (!this.database) return [...this.users.values()];
    const users = await this.database.listUsers();
    users.forEach((user) => this.users.set(user.email, user));
    return users;
  }

  async getUserById(userId) {
    let user = [...this.users.values()].find((candidate) => candidate.id === userId || candidate.universalAccountId === userId) || null;
    if (!user && this.database) {
      const users = await this.refreshPersistedUsers();
      user = users.find((candidate) => candidate.id === userId || candidate.universalAccountId === userId) || null;
    }
    return user;
  }

  async listUsersCurrent() {
    if (this.database) await this.refreshPersistedUsers();
    return [...this.users.values()];
  }

  async seedDemoUsers() {
    await this.createUser({ displayName: 'Universal Market User', email: 'user@sra.demo', password: 'User123!', capacities: ['UNIVERSAL'] });
    await this.createUser({ displayName: 'North District Owner', email: 'owner@sra.demo', password: 'Owner123!', capacities: ['UNIVERSAL','ASSET_PROVIDER'] });
    await this.createUser({ displayName: 'Marketplace Professional', email: 'capital@sra.demo', password: 'Capital123!', capacities: ['UNIVERSAL','MARKET_PROFESSIONAL'] });
    await this.createUser({ displayName: 'SRA Institutional Operations', email: 'operations@sra.demo', password: 'Operations123!', capacities: ['UNIVERSAL','ASSET_PROVIDER','INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'] });
  }

  async createUser({ displayName, email, password, capacities = ['UNIVERSAL'] }) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password || password.length < 8) throw new Error('A valid email and password of at least 8 characters are required.');
    if (this.users.has(normalizedEmail)) throw new Error('An account already exists for that email.');
    const selected = [...new Set(['UNIVERSAL', ...capacities].filter((id) => CAPACITY_DEFINITIONS[id]))];
    const now = new Date().toISOString();
    const user = {
      id: `USR-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      universalAccountId: `UA-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      displayName: clean(displayName, 120) || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      credentials: hashPassword(password),
      capacities: selected,
      capabilityRecords: buildCapacityState(selected),
      createdAt: now
    };
    user.capabilityRecords.UNIVERSAL.activatedAt = now;
    this.users.set(normalizedEmail, user);
    if (this.database) {
      await this.database.putUser(normalizedEmail, user);
      await this.database.audit({ actorId: user.id, eventType: 'UNIVERSAL_ACCOUNT_CREATED', objectType: 'UNIVERSAL_ACCOUNT', objectId: user.universalAccountId });
    }
    return user;
  }

  capabilityProjection(user) {
    return Object.entries(CAPACITY_DEFINITIONS).map(([id, definition]) => {
      const record = user.capabilityRecords[id] || { id, state: 'NOT_ADDED' };
      return {
        id,
        label: definition.label,
        tier: definition.tier,
        feeBasis: definition.feeBasis,
        activation: definition.activation,
        activationGate: definition.activationGate,
        upgradeFlow: [...definition.upgradeFlow],
        feeTrigger: definition.feeTrigger,
        selfService: definition.selfService,
        state: record.state,
        appliedAt: record.appliedAt || null,
        activatedAt: record.activatedAt || null,
        updatedAt: record.updatedAt || null,
        feeScheduleId: record.feeScheduleId || null,
        invoiceId: record.invoiceId || null,
        feeTotal: record.feeTotal == null ? null : Number(record.feeTotal),
        feeCurrency: record.feeCurrency || null,
        billingState: record.billingState || null,
        reviewState: record.reviewState || null,
        paymentSettledAt: record.paymentSettledAt || null,
        reviewedAt: record.reviewedAt || null,
        reviewedBy: record.reviewedBy || null,
        reviewNotes: record.reviewNotes || null
      };
    });
  }

  sanitizeUser(user, activeCapacity = user.capacities[0]) {
    const activeDefinition = CAPACITY_DEFINITIONS[activeCapacity] || CAPACITY_DEFINITIONS.UNIVERSAL;
    return {
      id: user.id,
      universalAccountId: user.universalAccountId,
      displayName: user.displayName,
      email: user.email,
      roles: user.capacities.map((id) => ({ id, label: CAPACITY_DEFINITIONS[id].label })),
      capacities: user.capacities.map((id) => ({ id, label: CAPACITY_DEFINITIONS[id].label })),
      capabilities: this.capabilityProjection(user),
      activeRole: activeCapacity,
      activeCapacity,
      accountTier: activeDefinition.tier,
      shell: ['INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'].includes(activeCapacity) ? 'INSTITUTIONAL' : 'PARTICIPANT'
    };
  }

  async signup(input = {}) { return this.startSession(await this.createUser({ displayName: input.displayName, email: input.email, password: input.password, capacities: ['UNIVERSAL'] })); }

  async signin(input = {}) {
    const user = this.users.get(normalizeEmail(input.email)) || (this.database ? (await this.refreshPersistedUsers()).find((candidate) => candidate.email === normalizeEmail(input.email)) : null);
    if (!user || !verifyPassword(String(input.password || ''), user.credentials)) throw new Error('Email or password is incorrect.');
    return this.startSession(user);
  }

  async startSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const session = { tokenHash, userId: user.id, email: user.email, activeCapacity: user.capacities[0], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString() };
    this.sessions.set(tokenHash, session);
    RUNTIME_SESSIONS.set(tokenHash, { session, user });
    if (this.database) {
      await this.database.putSession(tokenHash, session);
      await this.database.audit({ actorId: user.id, eventType: 'SESSION_STARTED', objectType: 'SESSION', objectId: tokenHash.slice(0, 16) });
    }
    return { token, session: this.sanitizeUser(user, session.activeCapacity) };
  }

  async getSession(token) {
    const tokenHash = token ? hashToken(token) : '';
    let runtime = tokenHash ? RUNTIME_SESSIONS.get(tokenHash) : null;
    let session = tokenHash ? (this.sessions.get(tokenHash) || runtime?.session || null) : null;
    if (!session && tokenHash && this.database) {
      const persistedSessions = await this.database.listSessions();
      session = persistedSessions.find((candidate) => candidate.tokenHash === tokenHash) || null;
      if (session) this.sessions.set(tokenHash, session);
    }
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      if (tokenHash) {
        this.sessions.delete(tokenHash);
        RUNTIME_SESSIONS.delete(tokenHash);
        if (this.database) await this.database.deleteSession(tokenHash);
      }
      return null;
    }
    let user = this.users.get(session.email) || runtime?.user || null;
    if ((!user || this.database) && this.database) {
      const users = await this.refreshPersistedUsers();
      user = users.find((candidate) => candidate.email === session.email) || user;
    }
    if (!user) return null;
    this.sessions.set(tokenHash, session);
    this.users.set(user.email, user);
    runtime = { session, user };
    RUNTIME_SESSIONS.set(tokenHash, runtime);
    return this.sanitizeUser(user, session.activeCapacity);
  }

  async switchRole(token, capacity) {
    const tokenHash = hashToken(token || '');
    let session = this.sessions.get(tokenHash) || RUNTIME_SESSIONS.get(tokenHash)?.session;
    if (!session && this.database) {
      const sessions = await this.database.listSessions();
      session = sessions.find((candidate) => candidate.tokenHash === tokenHash) || null;
      if (session) this.sessions.set(tokenHash, session);
    }
    if (!session) throw new Error('Session not found.');
    const user = this.users.get(session.email) || RUNTIME_SESSIONS.get(tokenHash)?.user || (await this.getUserById(session.userId));
    if (!user || !user.capacities.includes(capacity)) throw new Error('That account capacity is not active for this identity.');
    session.activeCapacity = capacity;
    this.sessions.set(tokenHash, session);
    this.users.set(user.email, user);
    RUNTIME_SESSIONS.set(tokenHash, { session, user });
    if (this.database) {
      await this.database.putSession(tokenHash, session);
      await this.database.audit({ actorId: user.id, eventType: 'OPERATING_TIER_CHANGED', objectType: 'USER', objectId: user.id, payload: { activeCapacity: capacity } });
    }
    return this.sanitizeUser(user, capacity);
  }

  async applyForCapacity(token, capacity) {
    const tokenHash = hashToken(token || '');
    let session = this.sessions.get(tokenHash) || RUNTIME_SESSIONS.get(tokenHash)?.session;
    if (!session && this.database) {
      const sessions = await this.database.listSessions();
      session = sessions.find((candidate) => candidate.tokenHash === tokenHash) || null;
      if (session) this.sessions.set(tokenHash, session);
    }
    if (!session) throw new Error('Session not found.');
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition || !definition.selfService) throw new Error('That capacity requires institutional or internal authorization.');
    const user = this.users.get(session.email) || RUNTIME_SESSIONS.get(tokenHash)?.user || (await this.getUserById(session.userId));
    const record = user?.capabilityRecords?.[capacity];
    if (!user || !record || !CAPACITY_STATES.includes(record.state)) throw new Error('Capacity record unavailable.');
    if (record.state !== 'ACTIVE') {
      const now = new Date().toISOString();
      if (record.state === 'NOT_ADDED') record.state = 'APPLICATION_STARTED';
      record.appliedAt = record.appliedAt || now;
      record.reviewState = record.reviewState || 'NOT_STARTED';
      record.updatedAt = now;
      this.users.set(user.email, user);
      RUNTIME_SESSIONS.set(tokenHash, { session, user });
      if (this.database) {
        await this.database.putUser(user.email, user);
        await this.database.audit({ actorId: user.id, eventType: 'CAPACITY_APPLICATION_STARTED', objectType: 'CAPACITY', objectId: capacity, payload: { tier: definition.tier, activationGate: definition.activationGate } });
      }
    }
    return this.sanitizeUser(user, session.activeCapacity);
  }

  async updateCapacityProgress(userId, capacity, patch = {}, actorId = null, eventType = 'CAPACITY_PROGRESS_UPDATED') {
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition) throw new Error('Capacity definition unavailable.');
    const user = await this.getUserById(userId);
    const record = user?.capabilityRecords?.[capacity];
    if (!user || !record) throw new Error('Capacity record unavailable.');
    if (patch.state && !CAPACITY_STATES.includes(patch.state)) throw new Error('Unsupported capacity state.');
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    this.users.set(user.email, user);
    if (this.database) {
      await this.database.putUser(user.email, user);
      await this.database.audit({ actorId: actorId || user.id, eventType, objectType: 'CAPACITY', objectId: capacity, payload: { participantId: user.id, state: record.state, invoiceId: record.invoiceId || null, billingState: record.billingState || null, reviewState: record.reviewState || null } });
    }
    return this.sanitizeUser(user, 'UNIVERSAL');
  }

  async reviewCapacity(userId, capacity, input = {}, actorId = null) {
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition || definition.tier !== 'PAID') throw new Error('Only paid self-service capabilities use this review path.');
    const user = await this.getUserById(userId);
    const record = user?.capabilityRecords?.[capacity];
    if (!user || !record) throw new Error('Capacity record unavailable.');
    if (record.state !== 'UNDER_REVIEW') throw new Error('Capacity must be under review before a final review decision can be recorded.');
    if (input.invoiceId && record.invoiceId !== input.invoiceId) throw new Error('Review invoice does not match the capability application.');
    const decision = String(input.decision || '').toUpperCase();
    const reviewedAt = new Date().toISOString();
    if (decision === 'APPROVE') {
      if (record.billingState !== 'PAID') throw new Error('Paid capability cannot be activated before fee settlement is confirmed.');
      if (!user.capacities.includes(capacity)) user.capacities.push(capacity);
      Object.assign(record, {
        state: 'ACTIVE',
        reviewState: 'APPROVED',
        reviewNotes: clean(input.notes, 1000) || null,
        reviewedBy: actorId,
        reviewedAt,
        activatedAt: reviewedAt,
        updatedAt: reviewedAt
      });
    } else if (decision === 'RETURN') {
      Object.assign(record, {
        state: 'INFORMATION_REQUIRED',
        reviewState: 'INFORMATION_REQUIRED',
        reviewNotes: clean(input.notes, 1000) || null,
        reviewedBy: actorId,
        reviewedAt,
        updatedAt: reviewedAt
      });
    } else {
      throw new Error('Review decision must be APPROVE or RETURN.');
    }
    this.users.set(user.email, user);
    if (this.database) {
      await this.database.putUser(user.email, user);
      await this.database.audit({ actorId, eventType: decision === 'APPROVE' ? 'CAPACITY_REVIEW_APPROVED' : 'CAPACITY_REVIEW_RETURNED', objectType: 'CAPACITY', objectId: capacity, payload: { participantId: user.id, invoiceId: record.invoiceId || null, state: record.state, reviewState: record.reviewState } });
    }
    return this.sanitizeUser(user, decision === 'APPROVE' ? capacity : 'UNIVERSAL');
  }

  async activateCapacity(token, capacity) {
    const tokenHash = hashToken(token || '');
    let session = this.sessions.get(tokenHash) || RUNTIME_SESSIONS.get(tokenHash)?.session;
    if (!session && this.database) {
      const sessions = await this.database.listSessions();
      session = sessions.find((candidate) => candidate.tokenHash === tokenHash) || null;
      if (session) this.sessions.set(tokenHash, session);
    }
    if (!session) throw new Error('Session not found.');
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition) throw new Error('Capacity definition unavailable.');
    const user = this.users.get(session.email) || RUNTIME_SESSIONS.get(tokenHash)?.user || (await this.getUserById(session.userId));
    const record = user?.capabilityRecords?.[capacity];
    if (!user || !record) throw new Error('Capacity record unavailable.');
    if (record.state === 'ACTIVE') return this.sanitizeUser(user, session.activeCapacity);
    if (definition.tier === 'PAID') {
      throw new Error('Paid operating tiers cannot be activated from the participant browser. The applicable SRA fee schedule must be presented and settled, required review must be completed, and activation must then be recorded by an authorized platform workflow.');
    }
    throw new Error('That operating tier requires its authorized approval workflow before activation.');
  }

  async signout(token) {
    const tokenHash = token ? hashToken(token) : '';
    if (tokenHash) {
      const session = this.sessions.get(tokenHash) || RUNTIME_SESSIONS.get(tokenHash)?.session;
      this.sessions.delete(tokenHash);
      RUNTIME_SESSIONS.delete(tokenHash);
      if (this.database) {
        await this.database.deleteSession(tokenHash);
        await this.database.audit({ actorId: session?.userId || null, eventType: 'SESSION_ENDED', objectType: 'SESSION', objectId: tokenHash.slice(0, 16) });
      }
    }
  }
}

export { CAPACITY_DEFINITIONS, CAPACITY_STATES };
