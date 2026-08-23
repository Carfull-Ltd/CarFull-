const rawSupabaseUrl = process.env.SUPABASE_URL || '';

const SUPABASE_REST_URL = rawSupabaseUrl.endsWith('/rest/v1')
  ? rawSupabaseUrl
  : rawSupabaseUrl.replace(/\/$/, '') + '/rest/v1';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const adminKey = process.env.ADMIN_DASHBOARD_KEY || '';
  const suppliedAdminKey = String(req.headers['x-admin-key'] || '');

  if (!rawSupabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Dashboard database access is not configured'
    });
  }

  if (!adminKey) {
    return res.status(500).json({
      error: 'Dashboard security is not configured'
    });
  }

  if (suppliedAdminKey !== adminKey) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  try {
    const response = await fetch(
      SUPABASE_REST_URL + '/admin_dashboard_summary?select=*',
      {
        headers: {
          apikey: serviceKey,
          Accept: 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Dashboard Supabase error:', data);
      return res.status(500).json({
        error: 'Could not load dashboard data'
      });
    }

    const row = Array.isArray(data) && data.length ? data[0] : {};

    return res.status(200).json({
      total_users: Number(row.total_users || 0),
      cars_in_garage: Number(row.cars_in_garage || 0),
      passports_created: Number(row.passports_created || 0),
      paid_checks: Number(row.paid_checks || 0),
      active_premium: Number(row.active_premium || 0),
      vehicle_searches: Number(row.vehicle_searches || 0),
      app_opens: Number(row.app_opens || 0),
      activity_last_24h: Number(row.activity_last_24h || 0),
      garage_adds: Number(row.garage_adds || 0),
      passport_events: Number(row.passport_events || 0)
    });

  } catch (error) {
    console.error('Admin dashboard failed:', error);

    return res.status(500).json({
      error: 'Could not load dashboard'
    });
  }
}
