import crypto from 'node:crypto';

const ROLE_LABELS = {
  ASSET_OWNER: 'Asset Owner',
  CAPITAL_PARTICIPANT: 'Capital Participant',
  SERVICE_PARTICIPANT: 'Service Participant',
  INSTITUTIONAL_OPERATOR: 'Institutional Operator'
};

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 180) : '';
}

function clean(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export class AccessService {
  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.seedDemoUsers();
  }

  seedDemoUsers() {
    this.createUser({ displayName: 'North District Owner', email: 'owner@sra.demo', password: 'Owner123!', roles: ['ASSET_OWNER'] });
    this.createUser({ displayName: 'Marketplace Capital', email: 'capital@sra.demo', password: 'Capital123!', roles: ['CAPITAL_PARTICIPANT'] });
    this.createUser({ displayName: 'SRA Institutional Operations', email: 'operations@sra.demo', password: 'Operations123!', roles: ['INSTITUTIONAL_OPERATOR', 'ASSET_OWNER'] });
  }

  createUser({ displayName, email, password, roles = ['ASSET_OWNER'] }) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password || password.length < 8) throw new Error('A valid email and password of at least 8 characters are required.');
    if (this.users.has(normalizedEmail)) throw new Error('An account already exists for that email.');
    const credentials = hashPassword(password);
    const user = {
      id: `USR-${crypto.randomUUID().split('-')[0].toUpperCase()}`,
      displayName: clean(displayName, 120) || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      credentials,
      roles: [...new Set(roles.filter((role) => ROLE_LABELS[role]))],
      createdAt: new Date().toISOString()
    };
    if (!user.roles.length) user.roles = ['ASSET_OWNER'];
    this.users.set(normalizedEmail, user);
    return user;
  }

  sanitizeUser(user, activeRole = user.roles[0]) {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      roles: user.roles.map((id) => ({ id, label: ROLE_LABELS[id] })),
      activeRole,
      shell: activeRole === 'INSTITUTIONAL_OPERATOR' ? 'INSTITUTIONAL' : 'PARTICIPANT'
    };
  }

  signup(input = {}) {
    const user = this.createUser({
      displayName: input.displayName,
      email: input.email,
      password: input.password,
      roles: ['ASSET_OWNER']
    });
    return this.startSession(user);
  }

  signin(input = {}) {
    const user = this.users.get(normalizeEmail(input.email));
    if (!user || !verifyPassword(String(input.password || ''), user.credentials)) throw new Error('Email or password is incorrect.');
    return this.startSession(user);
  }

  startSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      token,
      userId: user.id,
      email: user.email,
      activeRole: user.roles[0],
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 12
    };
    this.sessions.set(token, session);
    return { token, session: this.sanitizeUser(user, session.activeRole) };
  }

  getSession(token) {
    const session = token ? this.sessions.get(token) : null;
    if (!session || session.expiresAt < Date.now()) {
      if (token) this.sessions.delete(token);
      return null;
    }
    const user = this.users.get(session.email);
    return user ? this.sanitizeUser(user, session.activeRole) : null;
  }

  switchRole(token, role) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('Session not found.');
    const user = this.users.get(session.email);
    if (!user || !user.roles.includes(role)) throw new Error('That role is not available for this participant.');
    session.activeRole = role;
    return this.sanitizeUser(user, role);
  }

  signout(token) {
    if (token) this.sessions.delete(token);
  }
}
