const rawSupabaseUrl = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminKey = process.env.ADMIN_DASHBOARD_KEY || '';

export default async function handler(req, res) {

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  // Check dashboard password
  const suppliedKey = String(req.headers['x-admin-key'] || '');

  if (!adminKey) {
    return res.status(500).json({
      error: 'Dashboard password is not configured'
    });
  }

  if (suppliedKey !== adminKey) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  // Check Supabase configuration
  if (!rawSupabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Supabase connection is not configured'
    });
  }

  const baseUrl = rawSupabaseUrl.replace(/\/$/, '');

  try {

    const response = await fetch(
      `${baseUrl}/rest/v1/admin_dashboard_summary?select=*`,
      {
        method: 'GET',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Accept': 'application/json'
        }
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error(
        'Dashboard Supabase error:',
        response.status,
        text
      );

      return res.status(500).json({
        error: `Supabase error ${response.status}`
      });
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: 'Supabase returned invalid data'
      });
    }

    const row =
      Array.isArray(data) && data.length > 0
        ? data[0]
        : {};

    return res.status(200).json({

      total_users:
        Number(row.total_users || 0),

      cars_in_garage:
        Number(row.cars_in_garage || 0),

      passports_created:
        Number(row.passports_created || 0),

      paid_checks:
        Number(row.paid_checks || 0),

      active_premium:
        Number(row.active_premium || 0),

      vehicle_searches:
        Number(row.vehicle_searches || 0),

      app_opens:
        Number(row.app_opens || 0),

      activity_last_24h:
        Number(row.activity_last_24h || 0)

    });

  } catch (error) {

    console.error('Dashboard API error:', error);

    return res.status(500).json({
      error: 'Dashboard connection failed'
    });

  }
}
