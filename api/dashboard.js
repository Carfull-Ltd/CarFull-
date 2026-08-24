const rawUrl = String(process.env.SUPABASE_URL || '').trim();
const baseUrl = rawUrl
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');

const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const adminKey = String(process.env.CARFULL_ADMIN_PASSWORD || '').trim();

async function countRows(table) {
  const url = `${baseUrl}/rest/v1/${table}?select=*&limit=1`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'count=exact',
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Count failed for ${table}:`, response.status, text);
    return 0;
  }

  const range = response.headers.get('content-range') || '';
  const total = range.split('/')[1];

  return total && total !== '*' ? Number(total) : 0;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const suppliedKey = String(req.headers['x-admin-key'] || '').trim();

  if (!adminKey) {
    return res.status(500).json({
      error: 'Dashboard password is not configured'
    });
  }

  if (suppliedKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!baseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Supabase connection is not configured'
    });
  }

  try {
    const [
      totalUsers,
      carsInGarage,
      passportsCreated,
      paidChecks,
      activePremium,
      vehicleSearches
    ] = await Promise.all([
      countRows('profiles'),
      countRows('garage_vehicles'),
      countRows('passports'),
      countRows('paid_checks'),
      countRows('premium_entitlements'),
      countRows('recent_searches')
    ]);

    return res.status(200).json({
      total_users: totalUsers,
      cars_in_garage: carsInGarage,
      passports_created: passportsCreated,
      paid_checks: paidChecks,
      active_premium: activePremium,
      vehicle_searches: vehicleSearches,
      app_opens: 0,
      activity_last_24h: 0
    });
  } catch (error) {
    console.error('Dashboard API error:', error);

    return res.status(500).json({
      error: 'Dashboard connection failed'
    });
  }
}
