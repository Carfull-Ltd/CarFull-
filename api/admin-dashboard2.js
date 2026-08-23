const SUPABASE_URL = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminKey = process.env.ADMIN_DASHBOARD_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const suppliedAdminKey = String(req.headers['x-admin-key'] || '');

  if (!SUPABASE_URL || !serviceKey) {
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
      SUPABASE_URL + '/admin_dashboard_summary?select=*',
      {
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
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

    return res.status(200).json(row);

  } catch (error) {
    console.error('Admin dashboard failed:', error);

    return res.status(500).json({
      error: 'Could not load dashboard'
    });
  }
}
