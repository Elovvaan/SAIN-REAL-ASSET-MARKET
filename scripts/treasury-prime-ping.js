const baseUrl = String(process.env.TREASURY_PRIME_URL || 'https://api.sandbox.treasuryprime.com').replace(/\/$/, '');
const keyId = String(process.env.TREASURY_PRIME_ID || '').trim();
const secretKey = String(process.env.TREASURY_PRIME_SECRET_KEY || '').trim();

if (!keyId || !secretKey) {
  console.error('Treasury Prime credentials are not configured. Expected TREASURY_PRIME_ID and TREASURY_PRIME_SECRET_KEY.');
  process.exit(1);
}

const authorization = Buffer.from(`${keyId}:${secretKey}`, 'utf8').toString('base64');

try {
  const response = await fetch(`${baseUrl}/ping`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${authorization}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    console.error(`Treasury Prime ping failed with HTTP ${response.status}.`);
    if (payload?.error) console.error(payload.error);
    process.exit(1);
  }

  console.log('Treasury Prime sandbox authentication succeeded.');
  console.log(JSON.stringify({
    api_version: payload?.api_version ?? null,
    version: payload?.version ?? null,
    time: payload?.time ?? null,
  }, null, 2));
} catch (error) {
  console.error(`Treasury Prime ping failed: ${error?.message || error}`);
  process.exit(1);
}
