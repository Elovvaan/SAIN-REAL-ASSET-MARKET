import crypto from 'node:crypto';

const CAPACITY_LABELS = {
  UNIVERSAL: 'Universal Account',
  ASSET_PROVIDER: 'Asset Provider',
  MARKET_PROFESSIONAL: 'Market Professional',
  INSTITUTIONAL_OPERATOR: 'Institutional Operator',
  PLATFORM_ADMIN: 'Platform Administration'
};

function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 180) : ''; }
function clean(value, max = 160) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function verifyPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
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
    const selected = [...new Set(['UNIVERSAL', ...capacities].filter((id) => CAPACITY_LABELS[id]))];
    const user = {
      id: `USR-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      universalAccountId: `UA-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      displayName: clean(displayName, 120) || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      credentials: hashPassword(password),
      capacities: selected,
      createdAt: new Date().toISOString()
    };
    this.users.set(normalizedEmail, user);
    return user;
  }

  sanitizeUser(user, activeCapacity = user.capacities[0]) {
    return {
      id: user.id,
      universalAccountId: user.universalAccountId,
      displayName: user.displayName,
      email: user.email,
      roles: user.capacities.map((id) => ({ id, label: CAPACITY_LABELS[id] })),
      capacities: user.capacities.map((id) => ({ id, label: CAPACITY_LABELS[id] })),
      activeRole: activeCapacity,
      activeCapacity,
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
    if (!user || !user.capacities.includes(capacity)) throw new Error('That account capacity is not available for this identity.');
    session.activeCapacity = capacity;
    return this.sanitizeUser(user, capacity);
  }

  addCapacity(token, capacity) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('Session not found.');
    if (!['ASSET_PROVIDER','MARKET_PROFESSIONAL'].includes(capacity)) throw new Error('That capacity requires institutional authorization.');
    const user = this.users.get(session.email);
    if (!user.capacities.includes(capacity)) user.capacities.push(capacity);
    session.activeCapacity = capacity;
    return this.sanitizeUser(user, capacity);
  }

  signout(token) { if (token) this.sessions.delete(token); }
}
