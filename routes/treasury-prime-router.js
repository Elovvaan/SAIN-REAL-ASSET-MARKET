import express from 'express';

export function createTreasuryPrimeRouter() {
  const router = express.Router();

  router.post('/ping', async (_req, res) => {
    const keyId = String(process.env.TREASURY_PRIME_ID || '').trim();
    const secretKey = String(process.env.TREASURY_PRIME_SECRET_KEY || '').trim();
    const baseUrl = String(process.env.TREASURY_PRIME_URL || 'https://api.sandbox.treasuryprime.com').replace(/\/$/, '');

    if (!keyId || !secretKey) {
      return res.status(503).json({ ok: false, error: 'Treasury Prime credentials are not configured.' });
    }

    try {
      const authorization = Buffer.from(`${keyId}:${secretKey}`, 'utf8').toString('base64');
      const response = await fetch(`${baseUrl}/ping`, {
        method: 'GET',
        headers: { Authorization: `Basic ${authorization}`, Accept: 'application/json' },
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }

      if (!response.ok) {
        return res.status(502).json({ ok: false, status: response.status, error: `Treasury Prime authentication failed (HTTP ${response.status}).` });
      }

      return res.json({
        ok: true,
        environment: baseUrl.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION',
        apiVersion: payload.api_version ?? null,
        version: payload.version ?? null,
        providerTime: payload.time ?? null,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(502).json({ ok: false, error: `Treasury Prime connection failed: ${error?.message || error}` });
    }
  });

  return router;
}
