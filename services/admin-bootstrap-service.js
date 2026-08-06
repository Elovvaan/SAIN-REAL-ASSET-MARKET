export async function ensurePlatformAdministrator(access, { database = null } = {}) {
  const email = String(process.env.SRA_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SRA_ADMIN_PASSWORD || '');
  const displayName = String(process.env.SRA_ADMIN_NAME || 'Platform Administrator').trim();

  const configured = Boolean(email && password);
  if (!configured) return { configured: false, created: false, administrator: null };
  if (password.length < 12) throw new Error('SRA_ADMIN_PASSWORD must contain at least 12 characters.');

  const users = database ? await database.listUsers() : [...access.users.values()];
  const administrators = users.filter((user) => Array.isArray(user.capacities) && user.capacities.includes('PLATFORM_ADMIN'));
  if (administrators.length) {
    const matched = administrators.find((user) => String(user.email || '').toLowerCase() === email) || administrators[0];
    return { configured: true, created: false, administrator: matched };
  }

  const existing = users.find((user) => String(user.email || '').toLowerCase() === email);
  if (existing) {
    if (!existing.capacities.includes('PLATFORM_ADMIN')) existing.capacities.push('PLATFORM_ADMIN');
    if (existing.capabilityRecords?.PLATFORM_ADMIN) {
      existing.capabilityRecords.PLATFORM_ADMIN.state = 'ACTIVE';
      existing.capabilityRecords.PLATFORM_ADMIN.activatedAt ||= new Date().toISOString();
      existing.capabilityRecords.PLATFORM_ADMIN.updatedAt = new Date().toISOString();
    }
    access.users.set(email, existing);
    if (database) await database.putUser(email, existing);
    return { configured: true, created: false, administrator: existing };
  }

  const administrator = await access.createUser({
    displayName,
    email,
    password,
    capacities: ['UNIVERSAL', 'PLATFORM_ADMIN']
  });
  if (database?.audit) {
    await database.audit({
      actorId: administrator.id,
      eventType: 'PLATFORM_ADMINISTRATOR_BOOTSTRAPPED_FROM_ENVIRONMENT',
      objectType: 'PLATFORM_ADMIN',
      objectId: administrator.id,
      payload: { email: administrator.email, source: 'RAILWAY_SECRET_ENVIRONMENT' }
    });
  }
  return { configured: true, created: true, administrator };
}
