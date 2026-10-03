function cookie(req, name) {
  const value = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
}

// Pricing administration and payer financial records use server-side identities.
export function billingAuthorization(accessService) {
  return async (req, res, next) => {
    try {
      const session = await accessService.getSession(cookie(req, 'sra_admin_session') || cookie(req, 'sra_session'));
      if (!session) return res.status(401).json({ error: 'Administrator sign-in is required.' });
      if (session.activeCapacity !== 'PLATFORM_ADMIN' || !session.capacities?.some(capacity => (capacity.id || capacity) === 'PLATFORM_ADMIN')) {
        return res.status(403).json({ error: 'Platform administrator access is required.' });
      }
      req.billingActorId = session.id;
      res.set('Cache-Control', 'no-store');
      return next();
    } catch (error) { return next(error); }
  };
}
