import crypto from 'node:crypto';
import { ensurePlatformAdministrator } from './admin-bootstrap-service.js';

const CAPACITY_DEFINITIONS = {
  UNIVERSAL: { label: 'Universal Account', tier: 'FREE', feeBasis: 'No account fee. Participation-specific terms may still apply.', activation: 'AUTOMATIC', selfService: false },
  ASSET_PROVIDER: { label: 'Asset Provider', tier: 'PAID', feeBasis: 'V4V intake, verification, listing, and project-related fees.', activation: 'APPLICATION', selfService: true },
  MARKET_PROFESSIONAL: { label: 'Market Professional', tier: 'PAID', feeBasis: 'Professional subscription, credential review, matching, and transaction fees.', activation: 'APPLICATION', selfService: true },
  INSTITUTIONAL_OPERATOR: { label: 'Institutional Operator', tier: 'AGREEMENT', feeBasis: 'Institutional agreement and authorization.', activation: 'INSTITUTIONAL_APPROVAL', selfService: false },
  PLATFORM_ADMIN: { label: 'Platform Administration', tier: 'INTERNAL', feeBasis: 'Internal platform authorization only.', activation: 'INTERNAL_AUTHORIZATION', selfService: false }
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
    records[id] = { id, state: activeCapacities.includes(id) ? 'ACTIVE' : 'NOT_ADDED', appliedAt: null, activatedAt: activeCapacities.includes(id) ? new Date().toISOString() : null, updatedAt: new Date().toISOString() };
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
      return { id, label: definition.label, tier: definition.tier, feeBasis: definition.feeBasis, activation: definition.activation, selfService: definition.selfService, state: record.state, appliedAt: record.appliedAt || null, activatedAt: record.activatedAt || null, updatedAt: record.updatedAt || null };
    });
  }

  sanitizeUser(user, activeCapacity = user.capacities[0]) {
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
      accountTier: 'FREE',
      shell: ['INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'].includes(activeCapacity) ? 'INSTITUTIONAL' : 'PARTICIPANT'
    };
  }

  async signup(input = {}) { return this.startSession(await this.createUser({ displayName: input.displayName, email: input.email, password: input.password, capacities: ['UNIVERSAL'] })); }

  async signin(input = {}) {
    const user = this.users.get(normalizeEmail(input.email));
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
    const runtime = tokenHash ? RUNTIME_SESSIONS.get(tokenHash) : null;
    const session = tokenHash ? (this.sessions.get(tokenHash) || runtime?.session || null) : null;
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      if (tokenHash) {
        this.sessions.delete(tokenHash);
        RUNTIME_SESSIONS.delete(tokenHash);
        if (this.database) await this.database.deleteSession(tokenHash);
      }
      return null;
    }
    const user = this.users.get(session.email) || runtime?.user || null;
    if (!user) return null;
    this.sessions.set(tokenHash, session);
    this.users.set(user.email, user);
    RUNTIME_SESSIONS.set(tokenHash, { session, user });
    return this.sanitizeUser(user, session.activeCapacity);
  }

  async switchRole(token, capacity) {
    const tokenHash = hashToken(token || '');
    const session = this.sessions.get(tokenHash) || RUNTIME_SESSIONS.get(tokenHash)?.session;
    if (!session) throw new Error('Session not found.');
    const user = this.users.get(session.email) || RUNTIME_SESSIONS.get(tokenHash)?.user;
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
    const session = this.sessions.get(tokenHash);
    if (!session) throw new Error('Session not found.');
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition || !definition.selfService) throw new Error('That capacity requires institutional or internal authorization.');
    const user = this.users.get(session.email);
    const record = user.capabilityRecords[capacity];
    if (!record || !CAPACITY_STATES.includes(record.state)) throw new Error('Capacity record unavailable.');
    if (record.state !== 'ACTIVE') {
      const now = new Date().toISOString();
      record.state = record.state === 'NOT_ADDED' ? 'APPLICATION_STARTED' : record.state;
      record.appliedAt = record.appliedAt || now;
      record.updatedAt = now;
      if (this.database) {
        await this.database.putUser(user.email, user);
        await this.database.audit({ actorId: user.id, eventType: 'CAPACITY_APPLICATION_STARTED', objectType: 'CAPACITY', objectId: capacity });
      }
    }
    return this.sanitizeUser(user, session.activeCapacity);
  }

  async activateCapacity(token, capacity) {
    const tokenHash = hashToken(token || '');
    const session = this.sessions.get(tokenHash) || RUNTIME_SESSIONS.get(tokenHash)?.session;
    if (!session) throw new Error('Session not found.');
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition || !definition.selfService) throw new Error('That capacity requires institutional authorization.');
    const user = this.users.get(session.email) || RUNTIME_SESSIONS.get(tokenHash)?.user;
    const record = user.capabilityRecords[capacity];
    const now = new Date().toISOString();
    if (!user.capacities.includes(capacity)) user.capacities.push(capacity);
    record.state = 'ACTIVE';
    record.appliedAt = record.appliedAt || now;
    record.activatedAt = now;
    record.updatedAt = now;
    session.activeCapacity = capacity;
    this.sessions.set(tokenHash, session);
    this.users.set(user.email, user);
    RUNTIME_SESSIONS.set(tokenHash, { session, user });
    if (this.database) {
      await this.database.putUser(user.email, user);
      await this.database.putSession(tokenHash, session);
      await this.database.audit({ actorId: user.id, eventType: 'CAPACITY_ACTIVATED', objectType: 'CAPACITY', objectId: capacity });
    }
    return this.sanitizeUser(user, capacity);
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
