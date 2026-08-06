import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessService } from '../services/access-service.js';

function memoryDatabase() {
  const users = new Map();
  const sessions = new Map();
  return {
    async listUsers() { return [...users.values()]; },
    async putUser(email, payload) { users.set(email, structuredClone(payload)); },
    async listSessions() { return [...sessions.values()]; },
    async putSession(tokenHash, payload) { sessions.set(tokenHash, structuredClone(payload)); },
    async deleteSession(tokenHash) { sessions.delete(tokenHash); },
    async audit() {},
    users
  };
}

async function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await fn(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('creates stable platform administrator from Railway secrets when no user exists', async () => {
  await withEnv({
    NODE_ENV: 'production',
    SRA_ADMIN_EMAIL: 'admin@example.com',
    SRA_ADMIN_PASSWORD: 'StablePassword123!',
    SRA_ADMIN_NAME: 'Stable Administrator'
  }, async () => {
    const database = memoryDatabase();
    const access = new AccessService({ database });
    await access.initialize();
    const users = await database.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].email, 'admin@example.com');
    assert.equal(users[0].displayName, 'Stable Administrator');
    assert.ok(users[0].capacities.includes('PLATFORM_ADMIN'));
    assert.notEqual(users[0].credentials.hash, 'StablePassword123!');
    const signedIn = await access.signin({ email: 'admin@example.com', password: 'StablePassword123!' });
    assert.equal(signedIn.session.email, 'admin@example.com');
  });
});

test('reuses persisted administrator instead of recreating it', async () => {
  await withEnv({
    NODE_ENV: 'production',
    SRA_ADMIN_EMAIL: 'admin@example.com',
    SRA_ADMIN_PASSWORD: 'StablePassword123!',
    SRA_ADMIN_NAME: 'Stable Administrator'
  }, async () => {
    const database = memoryDatabase();
    const first = new AccessService({ database });
    await first.initialize();
    const original = (await database.listUsers())[0];
    const second = new AccessService({ database });
    await second.initialize();
    const users = await database.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].id, original.id);
  });
});

test('requires a strong Railway bootstrap password', async () => {
  await withEnv({
    NODE_ENV: 'production',
    SRA_ADMIN_EMAIL: 'admin@example.com',
    SRA_ADMIN_PASSWORD: 'short',
    SRA_ADMIN_NAME: 'Stable Administrator'
  }, async () => {
    const access = new AccessService({ database: memoryDatabase() });
    await assert.rejects(() => access.initialize(), /at least 12 characters/);
  });
});
