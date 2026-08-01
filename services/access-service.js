import crypto from 'node:crypto';

const CAPACITY_DEFINITIONS = {
  UNIVERSAL: {
    label: 'Universal Account',
    tier: 'FREE',
    feeBasis: 'No account fee. Participation-specific terms may still apply.',
    activation: 'AUTOMATIC',
    selfService: false
  },
  ASSET_PROVIDER: {
    label: 'Asset Provider',
    tier: 'PAID',
    feeBasis: 'V4V intake, verification, listing, and project-related fees.',
    activation: 'APPLICATION',
    selfService: true
  },
  MARKET_PROFESSIONAL: {
    label: 'Market Professional',
    tier: 'PAID',
    feeBasis: 'Professional subscription, credential review, matching, and transaction fees.',
    activation: 'APPLICATION',
    selfService: true
  },
  INSTITUTIONAL_OPERATOR: {
    label: 'Institutional Operator',
    tier: 'AGREEMENT',
    feeBasis: 'Institutional agreement and authorization.',
    activation: 'INSTITUTIONAL_APPROVAL',
    selfService: false
  },
  PLATFORM_ADMIN: {
    label: 'Platform Administration',
    tier: 'INTERNAL',
    feeBasis: 'Internal platform authorization only.',
    activation: 'INTERNAL_AUTHORIZATION',
    selfService: false
  }
};

const CAPACITY_STATES = ['NOT_ADDED','APPLICATION_STARTED','INFORMATION_REQUIRED','UNDER_REVIEW','ACTIVE','SUSPENDED','CLOSED'];

function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 180) : ''; }
function clean(value, max = 160) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function verifyPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function buildCapacityState(activeCapacities = []) {
  const records = {};
  Object.keys(CAPACITY_DEFINITIONS).forEach((id) => {
    records[id] = {
      id,
      state: activeCapacities.includes(id) ? 'ACTIVE' : 'NOT_ADDED',
      appliedAt: null,
      activatedAt: activeCapacities.includes(id) ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString()
    };
  });
  records.UNIVERSAL.state = 'ACTIVE';
  return records;
}

export class AccessService {
  constructor() { this.users = new Map(); this.sessions = new Map(); this.seedDemoUsers(); }

  seedDemoUsers() {
    this.createUser({ displayName: 'Universal Market User', email: 'user@sra.demo', password: 'User123!', capacities: ['UNIVERSAL'] });
    this.createUser({ displayName: 'North District Owner', email: 'owner@sra.demo', password: 'Owner123!', capacities: ['UNIVERSAL','ASSET_PROVIDER'] });
    this.createUser({ displayName: 'Marketplace Professional', email: 'capital@sra.demo', password: 'Capital123!', capacities: ['UNIVERSAL','MARKET_PROFESSIONAL'] });
    this.createUser({ displayName: 'SRA Institutional Operations', email: 'operations@sra.demo', password: 'Operations123!', capacities: ['UNIVERSAL','ASSET_PROVIDER','INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'] });
  }

  createUser({ displayName, email, password, capacities = ['UNIVERSAL'] }) {
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
    return user;
  }

  capabilityProjection(user) {
    return Object.values(CAPACITY_DEFINITIONS).map((definition) => {
      const id = Object.keys(CAPACITY_DEFINITIONS).find((key) => CAPACITY_DEFINITIONS[key] === definition);
      const record = user.capabilityRecords[id] || { id, state: 'NOT_ADDED' };
      return {
        id,
        label: definition.label,
        tier: definition.tier,
        feeBasis: definition.feeBasis,
        activation: definition.activation,
        selfService: definition.selfService,
        state: record.state,
        appliedAt: record.appliedAt || null,
        activatedAt: record.activatedAt || null,
        updatedAt: record.updatedAt || null
      };
    });
  }

  sanitizeUser(user, activeCapacity = user.capacities[0]) {
    const capabilities = this.capabilityProjection(user);
    return {
      id: user.id,
      universalAccountId: user.universalAccountId,
      displayName: user.displayName,
      email: user.email,
      roles: user.capacities.map((id) => ({ id, label: CAPACITY_DEFINITIONS[id].label })),
      capacities: user.capacities.map((id) => ({ id, label: CAPACITY_DEFINITIONS[id].label })),
      capabilities,
      activeRole: activeCapacity,
      activeCapacity,
      accountTier: 'FREE',
      shell: ['INSTITUTIONAL_OPERATOR','PLATFORM_ADMIN'].includes(activeCapacity) ? 'INSTITUTIONAL' : 'PARTICIPANT'
    };
  }

  signup(input = {}) {
    return this.startSession(this.createUser({ displayName: input.displayName, email: input.email, password: input.password, capacities: ['UNIVERSAL'] }));
  }

  signin(input = {}) {
    const user = this.users.get(normalizeEmail(input.email));
    if (!user || !verifyPassword(String(input.password || ''), user.credentials)) throw new Error('Email or password is incorrect.');
    return this.startSession(user);
  }

  startSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const session = { token, userId: user.id, email: user.email, activeCapacity: user.capacities[0], createdAt: new Date().toISOString(), expiresAt: Date.now() + 1000 * 60 * 60 * 12 };
    this.sessions.set(token, session);
    return { token, session: this.sanitizeUser(user, session.activeCapacity) };
  }

  getSession(token) {
    const session = token ? this.sessions.get(token) : null;
    if (!session || session.expiresAt < Date.now()) { if (token) this.sessions.delete(token); return null; }
    const user = this.users.get(session.email);
    return user ? this.sanitizeUser(user, session.activeCapacity) : null;
  }

  switchRole(token, capacity) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('Session not found.');
    const user = this.users.get(session.email);
    if (!user || !user.capacities.includes(capacity)) throw new Error('That account capacity is not active for this identity.');
    session.activeCapacity = capacity;
    return this.sanitizeUser(user, capacity);
  }

  applyForCapacity(token, capacity) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('Session not found.');
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition || !definition.selfService) throw new Error('That capacity requires institutional or internal authorization.');
    const user = this.users.get(session.email);
    const record = user.capabilityRecords[capacity];
    if (!record || !CAPACITY_STATES.includes(record.state)) throw new Error('Capacity record unavailable.');
    if (record.state === 'ACTIVE') return this.sanitizeUser(user, session.activeCapacity);
    const now = new Date().toISOString();
    record.state = record.state === 'NOT_ADDED' ? 'APPLICATION_STARTED' : record.state;
    record.appliedAt = record.appliedAt || now;
    record.updatedAt = now;
    return this.sanitizeUser(user, session.activeCapacity);
  }

  activateCapacity(token, capacity) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('Session not found.');
    const definition = CAPACITY_DEFINITIONS[capacity];
    if (!definition || !definition.selfService) throw new Error('That capacity requires institutional authorization.');
    const user = this.users.get(session.email);
    const record = user.capabilityRecords[capacity];
    const now = new Date().toISOString();
    if (!user.capacities.includes(capacity)) user.capacities.push(capacity);
    record.state = 'ACTIVE';
    record.appliedAt = record.appliedAt || now;
    record.activatedAt = now;
    record.updatedAt = now;
    session.activeCapacity = capacity;
    return this.sanitizeUser(user, capacity);
  }

  signout(token) { if (token) this.sessions.delete(token); }
}

export { CAPACITY_DEFINITIONS, CAPACITY_STATES };
