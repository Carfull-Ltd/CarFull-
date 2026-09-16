// CarFull — DVLA Vehicle Enquiry Service proxy.
// VES registrations are currently closed, so this route remains dormant
// until a DVLA API key is added to Vercel.

function cleanRegistration(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const registration = cleanRegistration(
    req.body?.registration || req.body?.reg
  );

  if (!registration) {
    return res.status(400).json({ error: 'Registration required' });
  }

  const apiKey =
    process.env.DVLA_API_KEY ||
    process.env.DVLA_VES_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      available: false,
      error: 'DVLA VES not configured'
    });
  }

  try {
    const response = await fetch(
      'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({ registrationNumber: registration })
      }
    );

    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      return res.status(response.status).json({
        available: false,
        error: data?.message || data?.error || 'DVLA lookup failed'
      });
    }

    return res.status(200).json({
      available: true,
      registration,
      taxStatus: data.taxStatus || null,
      taxDueDate: data.taxDueDate || null,
      dateOfLastV5CIssued: data.dateOfLastV5CIssued || null
    });
  } catch (error) {
    console.error('DVLA VES lookup failed', error);

    return res.status(500).json({
      available: false,
      error: 'DVLA lookup failed'
    });
  }
}
