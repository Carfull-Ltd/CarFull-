export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const registration=String(req.query?.registration||'').replace(/\s+/g,'').toUpperCase();
  if(!/^[A-Z0-9]{2,8}$/.test(registration)) return res.status(400).json({error:'Enter a valid UK registration.'});
  const apiKey=process.env.DVLA_API_KEY||process.env.DVLA_VES_API_KEY;
  if(!apiKey) return res.status(503).json({error:'DVLA vehicle data is not configured.'});
  try{
    const r=await fetch('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles',{
      method:'POST',
      headers:{'x-api-key':apiKey,'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({registration})
    });
    const text=await r.text(); let data={};
    try{data=text?JSON.parse(text):{}}catch{data={error:'Invalid DVLA response'}}
    res.setHeader('Cache-Control','no-store');
    if(!r.ok) return res.status(r.status).json({error:data?.message||data?.errors?.[0]?.detail||'DVLA lookup failed.'});
    return res.status(200).json({
      registration:data.registration||registration,
      taxStatus:data.taxStatus||null,
      taxDueDate:data.taxDueDate||null,
      dateOfLastV5CIssued:data.dateOfLastV5CIssued||null
    });
  }catch(e){return res.status(502).json({error:'DVLA service could not be reached.'});}
}
