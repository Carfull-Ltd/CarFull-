// CarFull server-side DVSA MOT History API proxy.
// Secrets are read only from Vercel Environment Variables and are never sent to the browser.

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing environment variable: ${name}`);
    err.code = 'DVSA_NOT_CONFIGURED';
    throw err;
  }
  return value;
}

const STABLE_DVSA_UPSTREAM = 'https://carfullv6122dvsalive.vercel.app';

function hasLocalDvsaConfig() {
  return Boolean(
    process.env.DVSA_CLIENT_ID &&
    process.env.DVSA_CLIENT_SECRET &&
    process.env.DVSA_API_KEY &&
    process.env.DVSA_SCOPE_URL &&
    process.env.DVSA_TOKEN_URL
  );
}

async function proxyStableDvsa(registration, res) {
  const upstream = `${STABLE_DVSA_UPSTREAM}/api/vehicle?registration=${encodeURIComponent(registration)}`;
  const response = await fetch(upstream, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  let body = {};
  try { body = await response.json(); } catch (_) {
    body = { code: 'UPSTREAM_ERROR', message: 'Vehicle lookup is temporarily unavailable.' };
  }

  // Never cache vehicle responses at this compatibility proxy.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(response.status).json(body);
}

async function getAccessToken() {
  // Keep a 60-second safety margin so a token cannot expire mid-request.
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;

  const tokenUrl = requiredEnv('DVSA_TOKEN_URL');
  const clientId = requiredEnv('DVSA_CLIENT_ID');
  const clientSecret = requiredEnv('DVSA_CLIENT_SECRET');
  const scope = requiredEnv('DVSA_SCOPE_URL');

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });

  let data = {};
  try { data = await response.json(); } catch (_) {}

  if (!response.ok || !data.access_token) {
    console.error('DVSA token request failed', response.status, data?.error || data?.error_description || 'Unknown error');
    const err = new Error('DVSA authentication failed. Please check the CarFull DVSA credentials.');
    err.code = 'DVSA_AUTH_FAILED';
    err.status = 502;
    throw err;
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in || 3600) * 1000);
  return cachedToken;
}

function cleanRegistration(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
  }

  const registration = cleanRegistration(req.query?.registration);
  if (!registration || registration.length < 2 || registration.length > 8) {
    return res.status(400).json({ code: 'INVALID_REGISTRATION', message: 'Enter a valid UK registration.' });
  }

  try {
    // Vercel Drop may create a new project without carrying environment
    // variables across. When that happens, use CarFull's stable DVSA gateway
    // which already holds the credentials server-side. Secrets remain private.
    if (!hasLocalDvsaConfig()) {
      return await proxyStableDvsa(registration, res);
    }

    const apiKey = requiredEnv('DVSA_API_KEY');
    const token = await getAccessToken();
    const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    let data = {};
    try { data = await response.json(); } catch (_) {}

    if (!response.ok) {
      const dvsaCode = data?.code || data?.errorCode || '';
      const dvsaMessage = data?.message || data?.error || 'DVSA vehicle lookup failed.';
      console.error('DVSA vehicle request failed', response.status, dvsaCode, dvsaMessage);

      if (response.status === 404 || dvsaCode === 'MOTH-NF-01') {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'No vehicle was found for that registration.' });
      }
      if (response.status === 429) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: 'Vehicle lookup is busy. Please try again shortly.' });
      }
      if (response.status === 401 || response.status === 403) {
        // Force a fresh token on the next request.
        cachedToken = null;
        cachedTokenExpiresAt = 0;
        return res.status(502).json({ code: 'DVSA_AUTH_FAILED', message: 'DVSA authentication was rejected.' });
      }
      return res.status(502).json({ code: dvsaCode || 'DVSA_ERROR', message: dvsaMessage });
    }

    // The current endpoint normally returns one vehicle object. This also safely
    // handles an array-shaped response should DVSA return one.
    const vehicle = Array.isArray(data) ? data[0] : (data?.vehicle || data);
    if (!vehicle || typeof vehicle !== 'object') {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'No vehicle was found for that registration.' });
    }

    return res.status(200).json({ vehicle });
  } catch (error) {
    console.error('CarFull DVSA proxy error', error?.code || '', error?.message || error);
    return res.status(error?.status || 500).json({
      code: error?.code || 'SERVER_ERROR',
      message: error?.code === 'DVSA_NOT_CONFIGURED'
        ? 'CarFull DVSA connection is not configured.'
        : (error?.message || 'Vehicle lookup is temporarily unavailable.')
    });
  }
}
