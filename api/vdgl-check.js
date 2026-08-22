const STRIPE_API='https://api.stripe.com/v1';
const VDGL_API='https://uk.api.vehicledataglobal.com/r2/lookup';
const SUPABASE_URL='https://pgczryadczopajxcmmtj.supabase.co';
const SUPABASE_PUBLISHABLE='sb_publishable_kuCy88UOJNdQfvn2QMa9Ig_w7FlAQXW';

function cleanReg(value){
  return String(value||'').replace(/\s+/g,'').toUpperCase().slice(0,12);
}
function arr(value){return Array.isArray(value)?value:[]}
function num(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function obj(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function firstDefined(...values){
  for(const v of values){
    if(v!==undefined&&v!==null&&v!=='')return v;
  }
  return null;
}
function money(value){
  const n=num(value);
  return n===null?null:n;
}

async function verifySupabaseUser(token){
  if(!token)throw new Error('Sign in to CarFull first.');
  const r=await fetch(SUPABASE_URL+'/auth/v1/user',{
    headers:{
      apikey:SUPABASE_PUBLISHABLE,
      Authorization:'Bearer '+token
    }
  });
  const data=await r.json();
  if(!r.ok||!data?.id)throw new Error('Could not verify your CarFull account.');
  return data;
}

async function stripeGet(secret,path,params={}){
  const qs=new URLSearchParams();
  for(const [k,v] of Object.entries(params)){
    if(v!==undefined&&v!==null&&v!=='')qs.append(k,String(v));
  }
  const r=await fetch(
    STRIPE_API+path+(qs.toString()?'?'+qs.toString():''),
    {headers:{Authorization:'Bearer '+secret}}
  );
  const data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||'Stripe request failed');
  return data;
}

function errorText(value,fallback='Request failed'){
  if(typeof value==='string'&&value.trim())return value.trim();
  if(value&&typeof value==='object'){
    for(const key of ['message','Message','error','Error','detail','details','hint','StatusMessage','statusMessage']){
      const v=value[key];
      if(typeof v==='string'&&v.trim())return v.trim();
    }
    try{
      const s=JSON.stringify(value);
      if(s&&s!=='{}')return s;
    }catch(e){}
  }
  return fallback;
}

async function hasSavedPaidCheck(userId,registration){
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!serviceKey)return null;
  const url=SUPABASE_URL+'/rest/v1/paid_checks?select=stripe_session_id,registration,payment_status'
    +'&user_id=eq.'+encodeURIComponent(userId)
    +'&registration=eq.'+encodeURIComponent(registration)
    +'&payment_status=eq.paid&limit=1';
  const r=await fetch(url,{
    headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,Accept:'application/json'}
  });
  if(!r.ok)return null;
  const rows=await r.json();
  return Array.isArray(rows)&&rows.length?rows[0]:null;
}

async function hasPaidFullCheck(secret,userId,registration){
  // First use CarFull's durable paid-check record.
  const saved=await hasSavedPaidCheck(userId,registration);
  if(saved)return saved;

  // Backward-compatible recovery for purchases made before paid_checks was
  // persisted. Page through Stripe sessions instead of checking only 100.
  let startingAfter='';
  for(let page=0;page<20;page++){
    const params={limit:'100'};
    if(startingAfter)params.starting_after=startingAfter;
    const sessions=await stripeGet(secret,'/checkout/sessions',params);
    const list=Array.isArray(sessions.data)?sessions.data:[];
    const match=list.find(s=>{
      const type=String(s?.metadata?.type||'');
      const uid=String(s?.metadata?.user_id||s?.client_reference_id||'');
      const reg=cleanReg(s?.metadata?.registration||'');
      const paid=s?.payment_status==='paid'||(s?.mode==='payment'&&s?.status==='complete');
      return type==='full_check'&&uid===String(userId)&&reg===registration&&paid;
    });
    if(match)return match;
    if(!sessions.has_more||!list.length)break;
    startingAfter=String(list[list.length-1]?.id||'');
    if(!startingAfter)break;
  }
  return null;
}

function normaliseVdgl(raw,registration){
  const root=obj(raw);
  const results=obj(root.Results||root.results||root.Result||root.result||root);

  const finance=obj(results.FinanceDetails||results.financeDetails);
  const financeRecords=arr(finance.FinanceRecordList||finance.financeRecordList);

  const pnc=obj(
    results.PncDetails||results.PNCDetails||
    results.PncCheck||results.PNCCheck||
    results.pncDetails||results.pncCheck
  );

  const miaftr=obj(results.MiaftrDetails||results.MIAFTRDetails||results.miaftrDetails);
  const writeOffs=arr(
    miaftr.WriteOffRecordList||
    miaftr.WriteoffRecordList||
    miaftr.writeOffRecordList||
    miaftr.writeoffRecordList
  );

  const mileage=obj(results.MileageCheckDetails||results.mileageCheckDetails);
  const mileageRows=arr(mileage.MileageResultList||mileage.mileageResultList);

  const vehicle=obj(results.VehicleDetails||results.vehicleDetails);
  const ident=obj(vehicle.VehicleIdentification||vehicle.vehicleIdentification);
  const status=obj(vehicle.VehicleStatus||vehicle.vehicleStatus);
  const history=obj(vehicle.VehicleHistory||vehicle.vehicleHistory);
  const keepers=arr(history.KeeperChangeList||history.keeperChangeList);
  const plates=arr(history.PlateChangeList||history.plateChangeList);

  const model=obj(results.ModelDetails||results.modelDetails);
  const valuation=obj(results.ValuationDetails||results.valuationDetails);
  const figures=obj(valuation.ValuationFigures||valuation.valuationFigures);

  const financeAvailable=Object.keys(finance).length>0;
  const pncAvailable=Object.keys(pnc).length>0;
  const miaftrAvailable=Object.keys(miaftr).length>0;
  const mileageAvailable=Object.keys(mileage).length>0;
  const vehicleAvailable=Object.keys(vehicle).length>0;

  const currentStolen=firstDefined(pnc.IsStolen,pnc.isStolen);
  const mileageAnomaly=firstDefined(
    mileage.MileageAnomalyDetected,
    mileage.mileageAnomalyDetected
  );

  const categories=[...new Set(writeOffs.map(x=>String(
    firstDefined(x?.Category,x?.category,'')
  ).trim()).filter(Boolean))];

  const theftHistory=writeOffs.some(x=>{
    const literal=String(firstDefined(x?.TheftIndicatorLiteral,x?.theftIndicatorLiteral,'')).toUpperCase();
    return literal && !literal.includes('NOT STOLEN');
  });

  let previousKeepers=null;
  const keeperNumbers=keepers.map(x=>num(
    firstDefined(x?.NumberOfPreviousKeepers,x?.numberOfPreviousKeepers)
  )).filter(x=>x!==null);
  if(keeperNumbers.length)previousKeepers=Math.max(...keeperNumbers);

  const valuationCandidates=[
    money(figures.PrivateClean||figures.privateClean),
    money(figures.PrivateAverage||figures.privateAverage),
    money(figures.DealerForecourt||figures.dealerForecourt)
  ].filter(x=>x!==null);

  let valuationText=null;
  if(valuationCandidates.length>=2){
    const low=Math.min(...valuationCandidates);
    const high=Math.max(...valuationCandidates);
    valuationText=`£${Math.round(low).toLocaleString('en-GB')}–£${Math.round(high).toLocaleString('en-GB')}`;
  }else if(valuationCandidates.length===1){
    valuationText=`£${Math.round(valuationCandidates[0]).toLocaleString('en-GB')}`;
  }

  const make=firstDefined(
    ident.DvlaMake,ident.dvlaMake,
    model.Make,model.make
  );
  const vehicleModel=firstDefined(
    ident.DvlaModel,ident.dvlaModel,
    model.Model,model.model
  );
  const year=firstDefined(
    ident.YearOfManufacture,ident.yearOfManufacture,
    model.YearOfManufacture,model.yearOfManufacture
  );

  const imported=firstDefined(status.IsImported,status.isImported);
  const exported=firstDefined(status.IsExported,status.isExported);
  const scrapped=firstDefined(status.IsScrapped,status.isScrapped);

  const majorConcern=
    financeRecords.length>0||
    currentStolen===true||
    writeOffs.length>0||
    mileageAnomaly===true||
    scrapped===true;

  return {
    registration,
    provider:'Vehicle Data Global',
    packageName:'VDICheck',
    generatedAt:new Date().toISOString(),
    summary:majorConcern
      ? 'One or more provenance items need attention'
      : 'No major provenance concerns found',
    vehicle:{
      make:make||null,
      model:vehicleModel||null,
      year:year||null
    },
    finance:{
      available:financeAvailable,
      clear:financeAvailable?financeRecords.length===0:null,
      count:financeRecords.length
    },
    stolen:{
      available:pncAvailable||miaftrAvailable,
      current:pncAvailable?(currentStolen===true):null,
      previous:theftHistory
    },
    writeOff:{
      available:miaftrAvailable,
      clear:miaftrAvailable?writeOffs.length===0:null,
      count:writeOffs.length,
      categories
    },
    mileage:{
      available:mileageAvailable,
      consistent:mileageAvailable?(mileageAnomaly!==true):null,
      anomaly:mileageAvailable?(mileageAnomaly===true):null,
      records:mileageRows.length,
      latest:mileageRows.length?{
        mileage:num(mileageRows[0]?.Mileage||mileageRows[0]?.mileage),
        date:firstDefined(mileageRows[0]?.DateRecorded,mileageRows[0]?.dateRecorded)
      }:null
    },
    vehicleStatus:{
      available:vehicleAvailable,
      imported:vehicleAvailable?(imported===true):null,
      exported:vehicleAvailable?(exported===true):null,
      scrapped:vehicleAvailable?(scrapped===true):null
    },
    history:{
      previousKeepers,
      registrationChanges:vehicleAvailable?plates.length:null,
      insuranceCategories:categories
    },
    valuation:{
      supplied:valuationText!==null,
      display:valuationText
    }
  };
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});

  const stripeSecret=process.env.STRIPE_SECRET_KEY||'';
  const vdglKey=process.env.VDGL_API_KEY||'';
  if(!stripeSecret)return res.status(500).json({error:'Stripe is not configured'});
  if(!vdglKey)return res.status(500).json({error:'Vehicle Data Global is not configured'});

  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const registration=cleanReg(body.registration);
    if(!registration)return res.status(400).json({error:'Registration required'});

    const auth=String(req.headers.authorization||'');
    const token=auth.startsWith('Bearer ')?auth.slice(7):'';
    const user=await verifySupabaseUser(token);

    const paid=await hasPaidFullCheck(stripeSecret,user.id,registration);
    if(!paid)return res.status(403).json({
      error:'No paid Full Check was found for this registration on your CarFull account.'
    });

    const qs=new URLSearchParams({
      ApiKey:vdglKey,
      PackageName:'VDICheck',
      Vrm:registration
    });

    const response=await fetch(VDGL_API+'?'+qs.toString(),{
      method:'GET',
      headers:{Accept:'application/json'}
    });

    const text=await response.text();
    let raw=null;
    try{raw=text?JSON.parse(text):{}}catch(e){raw={rawText:text}}

    if(!response.ok){
      const message=
        raw?.ResponseInformation?.StatusMessage||
        raw?.responseInformation?.statusMessage||
        raw?.Message||raw?.message||
        raw?.error||
        `Vehicle Data Global returned ${response.status}`;
      return res.status(response.status).json({error:errorText(message,`Vehicle Data Global returned ${response.status}`)});
    }

    // Some VDGL responses report failure inside a 200 response.
    const responseInfo=obj(raw?.ResponseInformation||raw?.responseInformation);
    const statusCode=num(responseInfo.StatusCode||responseInfo.statusCode);
    if(statusCode!==null&&statusCode!==0){
      return res.status(502).json({
        error:errorText(
          responseInfo.StatusMessage||
          responseInfo.statusMessage,
          'Vehicle Data Global could not complete this lookup.'
        )
      });
    }

    const report=normaliseVdgl(raw,registration);
    return res.status(200).json({ok:true,report});
  }catch(e){
    console.error('VDGL Full Check failed',e);
    return res.status(500).json({error:e?.message||'Could not run Full Check'});
  }
}
