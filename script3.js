
let premiumActive=false;
let premiumExpiresAt=null;
let premiumSource=null;

let recentSearches=[];

const car=null;
let screen='home',myDrive=[],passports=[],checkedCar=null,checkTab='summary',driveCar=null,openMenuReg=null,scoreOpen=false,scoreVehicle=null,expandedMotKey=null;
let sb=null,currentUser=null,backendReady=false,backendMessage='Connecting…',passwordRecoveryMode=(location.hash.includes('type=recovery')||location.search.includes('type=recovery')||location.search.includes('reset=1'));
const A=document.getElementById('app');


async function trackEvent(eventName, metadata={}){
  try{
    if(!sb || !currentUser)return;
    await sb.from('analytics_events').insert({
      user_id:currentUser.id,
      event_name:eventName,
      registration:metadata.registration||null,
      source:'carfull-webapp',
      metadata
    });
  }catch(e){ console.warn('Analytics event failed',eventName,e) }
}

async function forgotPassword(){
  if(!sb)return alert('CarFull is still connecting.');
  const email=document.getElementById('authEmail')?.value.trim();
  if(!email)return alert('Enter your email address first.');
  const {error}=await sb.auth.resetPasswordForEmail(email,{
    redirectTo:window.location.origin+'/?reset=1&type=recovery'
  });
  if(error){
    const msg=(error.message||'').toLowerCase();
    if(msg.includes('rate limit')) return alert('Too many reset emails have been requested. Please wait a few minutes, then try again.');
    return alert(error.message);
  }
  alert('Password reset email sent ✓\n\nOpen the link in the email to choose a new password.');
}

async function resendConfirmation(){
  if(!sb)return alert('CarFull is still connecting.');
  const email=document.getElementById('authEmail')?.value.trim();
  if(!email)return alert('Enter your email address first.');
  const {error}=await sb.auth.resend({
    type:'signup',
    email,
    options:{emailRedirectTo:window.location.origin}
  });
  if(error)return alert(error.message);
  alert('Confirmation email sent again ✓');
}

function passwordReset(){return wrap(`${title('Reset password')}
<section class="card">
  <div class="liveBadge">SECURE ACCOUNT</div>
  <h2>Create a new password</h2>
  <p class="muted">Choose a new password for your CarFull account.</p>
  <div class="authField"><label>NEW PASSWORD</label><input id="newPassword" class="input" type="password" autocomplete="new-password" placeholder="Minimum 8 characters"></div>
  <div class="authField"><label>CONFIRM PASSWORD</label><input id="confirmNewPassword" class="input" type="password" autocomplete="new-password" placeholder="Enter it again"></div>
  <button class="btn" style="margin-top:14px" onclick="saveNewPassword()">Update password</button>
</section>`,'account')}

async function saveNewPassword(){
  const password=document.getElementById('newPassword')?.value||'';
  const confirm=document.getElementById('confirmNewPassword')?.value||'';
  if(password.length<8)return alert('Use at least 8 characters.');
  if(password!==confirm)return alert('Passwords do not match.');
  const {error}=await sb.auth.updateUser({password});
  if(error)return alert(error.message);
  passwordRecoveryMode=false;
  try{history.replaceState({},document.title,location.pathname)}catch(e){}
  await trackEvent('password_reset_completed');
  alert('Password updated ✓');
  screen='account'; render();
}


function isPremium(){
  return premiumActive && premiumExpiresAt && new Date(premiumExpiresAt).getTime() > Date.now();
}
function garageLimit(){ return isPremium()?5:1; }
function passportLimit(){ return isPremium()?5:1; }

function formatPremiumExpiry(){
  if(!premiumExpiresAt)return '';
  try{return new Date(premiumExpiresAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});}
  catch(e){return premiumExpiresAt}
}


async function loadGarage(force=false){
  return withLoadLock('garage',async()=>{
    if(!sb||!currentUser){myDrive=[];return}
    const previousByReg=new Map((myDrive||[]).map(v=>[cleanReg(v.reg),v]));
    const {data,error}=await sb
      .from('garage_vehicles')
      .select('*')
      .eq('user_id',currentUser.id)
      .order('created_at',{ascending:true});
    if(error){console.warn('Garage load failed',error);return}

    myDrive=(data||[])
      .filter(v=>!isLegacyDemoVehicle(v))
      .map(v=>{
        const reg=(v.registration||v.reg||'').toUpperCase();
        const previous=previousByReg.get(cleanReg(reg))||{};
        return {
          ...previous,
          ...v,
          reg,
          make:v.make||previous.make||'',
          model:v.model||previous.model||'',
          year:v.year||previous.year||'',
          colour:v.colour||previous.colour||'',
          fuel_type:v.fuel_type||previous.fuel_type||'',
          engine_size:v.engine_size||previous.engine_size||'',
          mot_expiry:v.mot_expiry||previous.mot_expiry||'',
          score:Number.isFinite(Number(v.score))?Number(v.score):(Number.isFinite(Number(previous.score))?Number(previous.score):null),
          dbid:v.id
        };
      });
  },force)
}

async function loadPremium(force=false){
  return withLoadLock('premium',async()=>{
    premiumActive=false;premiumExpiresAt=null;premiumSource=null;
    if(!currentUser)return;

    // CarFull Pro can come from either source:
    // 1) existing CarFull/Supabase entitlements (including promo codes), or
    // 2) Apple/RevenueCat subscription entitlement.
    // Never let an inactive RevenueCat result hide an existing CarFull Pro account.
    let accountEntitlement=null;
    if(sb){
      try{
        const {data,error}=await sb.from('premium_entitlements').select('expires_at,source').eq('user_id',currentUser.id).maybeSingle();
        if(!error && data && new Date(data.expires_at).getTime()>Date.now()) accountEntitlement=data;
        else if(error) console.warn('CarFull Pro account entitlement load failed',error);
      }catch(e){console.warn('CarFull Pro account entitlement load failed',e)}
    }

    let appleStatus=null;
    if(isNativeIOSBuild()){
      try{ appleStatus=await nativePurchases().identify(currentUser.id); }
      catch(e){ console.warn('CarFull Pro RevenueCat load failed',e); }
    }

    const accountExpiry=accountEntitlement?.expires_at||null;
    const appleExpiry=appleStatus?.active ? (appleStatus.expiresAt||null) : null;
    if(accountEntitlement || appleStatus?.active){
      premiumActive=true;
      if(accountExpiry && appleExpiry){
        premiumExpiresAt=new Date(accountExpiry).getTime()>=new Date(appleExpiry).getTime()?accountExpiry:appleExpiry;
      }else premiumExpiresAt=accountExpiry||appleExpiry||new Date(Date.now()+365*86400000).toISOString();
      premiumSource=appleStatus?.active?'revenuecat':(accountEntitlement?.source||'carfull_pro');
    }
  },force)
}
async function applyPromoCode(){
  if(!currentUser)return requireAccount('Sign in to redeem a CarFull Pro code.');
  const el=document.getElementById('promoInput');
  const code=(el?el.value:'').trim().toUpperCase();
  if(!code)return alert('Enter your CarFull Pro code.');
  const {data,error}=await sb.rpc('redeem_premium_code',{p_code:code});
  if(error)return alert(error.message||'That CarFull Pro code could not be redeemed.');
  if(!data?.ok)return alert(data?.message||'That CarFull Pro code is not recognised.');
  invalidateCache('premium');
  await loadPremium(true);
  await trackEvent('premium_code_redeemed',{code_label:data.label||'promo'});
  alert(`CarFull Pro unlocked ✓\n\nActive until ${formatPremiumExpiry()}.`);
  go('redeemPremium');
}



function isLegacyDemoVehicle(v){
  const r=cleanReg(v?.reg||'');
  return r==='AB'+'12CDE';
}
function purgeLegacyDemoState(){
  try{
    for(const k of Object.keys(localStorage)){
      const raw=localStorage.getItem(k)||'';
      if(k.startsWith('carfull_recent_')){
        try{
          const items=JSON.parse(raw||'[]');
          if(Array.isArray(items)){
            const cleaned=items.filter(x=>cleanReg(x?.reg||x?.registration||'')!=='AB12CDE');
            if(cleaned.length!==items.length)localStorage.setItem(k,JSON.stringify(cleaned.slice(0,10)));
          }
        }catch(e){}
        continue;
      }
      const compact=raw.replace(/\s+/g,'').toUpperCase();
      if(compact.includes('AB'+'12CDE')) localStorage.removeItem(k);
    }
  }catch(e){}
}
purgeLegacyDemoState();


async function purgeKnownGhostPassport(){
  // L77WTW may now be a genuine live registration, so never purge it.
  return;
}

async function hydrateAccountVehicleData(){
  if(!sb || !currentUser)return;

  try{
    const {data:gRows,error:gErr}=await sb
      .from('garage_vehicles')
      .select('*')
      .eq('user_id',currentUser.id)
      .order('created_at',{ascending:true});

    if(!gErr){
      myDrive=(gRows||[])
        .filter(v=>!isLegacyDemoVehicle(v))
        .map(v=>({
          ...v,
          reg:(v.registration||v.reg||'').toUpperCase(),
          make:v.make||'',
          model:v.model||'',
          year:v.year||'',
          colour:v.colour||'',
          fuel_type:v.fuel_type||'',
          engine_size:v.engine_size||'',
          mot_expiry:v.mot_expiry||'',
          score:Number.isFinite(Number(v.score))?Number(v.score):null,
          dbid:v.id
        }));
    }

    const {data:pRows,error:pErr}=await sb
      .from('passports')
      .select('*')
      .eq('user_id',currentUser.id)
      .order('created_at',{ascending:true});

    if(!pErr){
      passports=(pRows||[])
        .filter(v=>!isLegacyDemoVehicle(v))
        .map(v=>({...v,reg:(v.registration||v.reg||'').toUpperCase()}));
    }

    render();
  }catch(e){
    console.warn('Account vehicle hydration failed',e);
  }
}

function cleanReg(reg){return (reg||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();}
function displayReg(reg){
  const r=cleanReg(reg);
  if(r.length===7)return r.slice(0,4)+' '+r.slice(4);
  return r;
}
function yearFromVehicle(v){
  const d=v.registrationDate||v.firstUsedDate||v.manufactureDate||'';
  return d ? String(d).slice(0,4) : '';
}
function latestMot(v){return Array.isArray(v.motTests)&&v.motTests.length?v.motTests[0]:null;}

function motDateValue(test){
  const raw=test?.completedDate||test?.testDate||'';
  const n=Date.parse(raw);
  return Number.isFinite(n)?n:0;
}
function normalisedMileage(test){
  const n=Number(test?.odometerValue);
  if(!Number.isFinite(n))return null;
  const u=String(test?.odometerUnit||'').toLowerCase();
  if(u.includes('km'))return Math.round(n*0.621371);
  return n;
}
function defectSeverity(type){
  const t=String(type||'').toUpperCase();
  if(t.includes('DANGEROUS'))return 4;
  if(t.includes('MAJOR'))return 3;
  if(t.includes('MINOR'))return 2;
  if(t.includes('ADVIS'))return 1;
  return 0;
}
function passportEvidenceForReg(reg){
  const pp=passports.find(p=>cleanReg(p.reg)===cleanReg(reg));
  if(!pp)return {records:0,evidence:0,bonus:0};
  const records=(passportRecords[pp.id]||[]);
  const evidence=Object.values(passportEvidence||{}).flat().filter(e=>e.passport_id===pp.id);
  // Passport can strengthen confidence, but never dominate official MOT data.
  const bonus=Math.min(10, Math.min(6,records.length) + Math.min(4,evidence.length));
  return {records:records.length,evidence:evidence.length,bonus};
}
function calculateCarFullScore(v){
 const tests=Array.isArray(v?.motTests)?[...v.motTests]:[];
 const oldest=[...tests].sort((a,b)=>motDateValue(a)-motDateValue(b));
 const newest=[...tests].sort((a,b)=>motDateValue(b)-motDateValue(a));
 const latest=newest[0]||{}, now=Date.now();

 // v6.37: deliberately tougher. A valid MOT and tidy mileage are basic requirements,
 // not enough on their own to make an older car score in the 80s.
 let current=5;
 const expiry=latest.expiryDate?Date.parse(latest.expiryDate+'T23:59:59'):0;
 const pass=String(latest.testResult||'').toUpperCase()==='PASSED';
 if(pass&&expiry>now)current=20; else if(pass)current=8; else if(tests.length)current=0;

 let mileage=5;
 const ms=oldest.map(t=>normalisedMileage(t)).filter(x=>x!==null);
 if(ms.length>=2){
   let rev=0,big=0;
   for(let i=1;i<ms.length;i++){
     const d=ms[i]-ms[i-1];
     if(d<-250)rev++;
     if(d<-1500)big++;
   }
   mileage=Math.max(0,15-rev*6-big*6);
 }else if(ms.length===1)mileage=7;

 const recent=newest.slice(0,3);
 let rp=0;
 recent.forEach((t,i)=>{
   const w=i===0?1:i===1?.75:.5;
   if(String(t.testResult||'').toUpperCase()==='FAILED')rp+=8*w;
   (t.defects||[]).forEach(d=>{
     const sev=defectSeverity(d.type);
     rp+=(sev===4?8:sev===3?5:sev===2?2.5:sev===1?1.25:0)*w;
   });
 });
 const recentCondition=Math.max(0,Math.round(30-Math.min(30,rp)));

 const completed=tests.filter(t=>t.testResult);
 const failures=completed.filter(t=>String(t.testResult).toUpperCase()==='FAILED').length;
 let historicDefectLoad=0;
 newest.slice(0,5).forEach(t=>(t.defects||[]).forEach(d=>{
   const sev=defectSeverity(d.type);
   historicDefectLoad+=sev===4?4:sev===3?2.5:sev===2?1:sev===1?.5:0;
 }));
 let longTerm=completed.length>=3
   ?Math.max(2,20-Math.round((failures/completed.length)*25)-Math.min(6,Math.round(historicDefectLoad/4)))
   :(completed.length?9:6);

 let ap=0;
 (latest.defects||[]).forEach(d=>{
   const sev=defectSeverity(d.type);
   ap+=sev===4?8:sev===3?6:sev===2?3:sev===1?2:0;
 });
 const buckets={};
 newest.slice(0,5).forEach(t=>(t.defects||[]).forEach(d=>{
   const key=String(d.text||'').toLowerCase().replace(/\b(nearside|offside|front|rear|left|right|upper|lower)\b/g,'').replace(/\s+/g,' ').trim().split(' ').slice(0,5).join(' ');
   if(key)buckets[key]=(buckets[key]||0)+1;
 }));
 const repeated=Object.values(buckets).filter(n=>n>=2).length;
 const advisory=Math.max(0,15-Math.min(15,ap+Math.min(9,repeated*3)));

 const score=Math.max(0,Math.min(100,Math.round(current+mileage+recentCondition+longTerm+advisory)));
 const strengths=[],issues=[];
 if(current>=18)strengths.push('Current MOT status is healthy');else issues.push('Current MOT status needs attention');
 if(mileage>=14)strengths.push('Recorded mileage is consistent');else if(mileage<9)issues.push('Recorded mileage needs checking');
 if(recentCondition>=25)strengths.push('Strong recent MOT condition');else issues.push('Recent MOT records contain defects or failures');
 if(longTerm>=16)strengths.push('Strong long-term MOT pattern');else if(completed.length>=3)issues.push('Long-term MOT pattern includes failures or recurring defects');
 if(advisory>=13)strengths.push('No significant current/repeated advisory pattern');else issues.push('Current or repeated MOT issues affect the score');

 const label=score>=88?'Excellent':score>=75?'Good':score>=62?'Fair':score>=48?'Caution':'Poor';
 const confidence=tests.length>=6?'High':tests.length>=2?'Medium':'Low';
 return {score,label,confidence,parts:{
   current:{score:current,max:20,label:'Current MOT status'},
   mileage:{score:mileage,max:15,label:'Mileage consistency'},
   recent:{score:recentCondition,max:30,label:'Recent MOT condition'},
   longTerm:{score:longTerm,max:20,label:'Long-term MOT pattern'},
   advisory:{score:advisory,max:15,label:'Advisories & defects'}
 },strengths,issues};
}
function applyCarFullScore(v){
  if(!v)return v;
  const detail=calculateCarFullScore(v);
  v.score=detail.score;
  v.scoreDetail=detail;
  return v;
}

function vehicleFromDvsa(v){
  const mot=latestMot(v)||{};
  const out={
    reg:displayReg(v.registration),
    make:v.make||'Vehicle',
    model:v.model||'',
    year:yearFromVehicle(v),
    colour:v.primaryColour||'',
    fuel_type:v.fuelType||'',
    engine_size:v.engineSize ? `${v.engineSize} cc` : '',
    mot_expiry:mot.expiryDate||'',
    mot_result:mot.testResult||'',
    mileage:mot.odometerValue||'',
    mileage_unit:mot.odometerUnit||'',
    recall:v.hasOutstandingRecall||'',
    motTests:Array.isArray(v.motTests)?v.motTests:[],
    source:'DVSA'
  };
  return applyCarFullScore(out);
}
function carfullApiUrl(path){
  const p=String(path||'');
  if(!isNativeIOSBuild()) return p;
  const base=String(window.CARFULL_API_ORIGIN||'').replace(/\/$/,'');
  if(!base) throw new Error('CarFull native API origin is not configured.');
  return base + (p.startsWith('/') ? p : '/'+p);
}
async function carfullFetch(path,options={}){
  const url=carfullApiUrl(path);
  if(!isNativeIOSBuild()) return fetch(url,options);
  const bridge=nativePurchases();
  if(!bridge?.apiRequest) throw new Error('CarFull native network bridge is unavailable.');
  const native=await bridge.apiRequest({
    url,
    method:options.method||'GET',
    headers:options.headers||{},
    body:options.body??null
  });
  const status=Number(native?.status||0);
  const data=native?.data;
  return {
    ok:status>=200&&status<300,
    status,
    headers:native?.headers||{},
    async json(){
      if(typeof data==='string'){try{return JSON.parse(data)}catch(e){return {message:data}}}
      return data??{};
    },
    async text(){return typeof data==='string'?data:JSON.stringify(data??{});}
  };
}
async function lookupVehicle(reg){
  const r=cleanReg(reg);
  if(!r)throw new Error('Enter a UK registration.');
  const res=await carfullFetch('/api/vehicle?registration='+encodeURIComponent(r),{headers:{'Accept':'application/json'}});
  let body={};
  try{body=await res.json()}catch(e){}
  if(!res.ok){
    const rawError=body?.message??body?.error;
    const errorMessage=typeof rawError==='string'
      ? rawError
      : (rawError&&typeof rawError==='object'
          ? (rawError.message||rawError.error||rawError.detail||rawError.description||'')
          : '');
    const err=new Error(errorMessage||'Vehicle lookup failed.');
    err.code=body?.code||rawError?.code||res.status;
    throw err;
  }
  return vehicleFromDvsa(body.vehicle||body);
}
function recentLocalKey(){return currentUser?`carfull_recent_${currentUser.id}`:'carfull_recent_guest'}
function readLocalRecent(){
  try{return JSON.parse(localStorage.getItem(recentLocalKey())||'[]')}catch(e){return []}
}
function writeLocalRecent(items){
  try{localStorage.setItem(recentLocalKey(),JSON.stringify((items||[]).slice(0,10)))}catch(e){}
}
function recentLocalKey(){return currentUser?`carfull_recent_${currentUser.id}`:'carfull_recent_guest'}
function readLocalRecent(){
  try{return JSON.parse(localStorage.getItem(recentLocalKey())||'[]')}catch(e){return []}
}
function writeLocalRecent(items){
  try{localStorage.setItem(recentLocalKey(),JSON.stringify((items||[]).slice(0,10)))}catch(e){}
}
async function loadRecentSearches(force=false){
  return withLoadLock('recent',async()=>{
    if(!currentUser){recentSearches=[];return;}

    let remote=[];
    if(sb){
      try{
        const {data,error}=await sb.rpc('carfull_get_recent_searches');
        if(error){
          console.warn('Recent searches RPC load failed',error);
        }else if(Array.isArray(data)){
          remote=data.map(x=>({
            reg:displayReg(x.registration),
            make:x.make||'Vehicle',
            model:x.model||'',
            year:x.year||''
          })).filter(x=>cleanReg(x.reg)&&!isLegacyDemoVehicle(x));
        }
      }catch(e){
        console.warn('Recent searches RPC load failed',e);
      }
    }

    if(remote.length){
      recentSearches=remote.slice(0,10);
      writeLocalRecent(recentSearches);
      return;
    }

    // Fallback only: useful if Supabase is temporarily unavailable.
    recentSearches=readLocalRecent()
      .filter(x=>!isLegacyDemoVehicle(x))
      .slice(0,10);
  },force)
}

async function saveRecentSearch(v){
  if(!v)return;
  const reg=cleanReg(v.reg);
  if(!reg || isLegacyDemoVehicle({reg}))return;

  const item={
    reg:displayReg(reg),
    make:v.make||'Vehicle',
    model:v.model||'',
    year:v.year||''
  };

  // Update the screen instantly.
  recentSearches=[item,...recentSearches.filter(x=>cleanReg(x.reg)!==reg)].slice(0,10);
  writeLocalRecent(recentSearches);

  if(!sb||!currentUser)return;

  try{
    const {error}=await sb.rpc('carfull_save_recent_search',{
      p_registration:reg,
      p_make:v.make||null,
      p_model:v.model||null,
      p_year:v.year?Number(v.year):null
    });

    if(error){
      console.warn('Recent search RPC save failed',error);
      return;
    }

    invalidateCache('recent');
  }catch(e){
    console.warn('Recent search RPC save failed',e);
  }
}

function lookupErrorMessage(err){
  if(err?.code==='DVSA_NOT_CONFIGURED')return 'Vehicle lookup is temporarily unavailable. Please try again shortly.';
  if(err?.code===404||err?.code==='NOT_FOUND')return 'No DVSA vehicle was found for that registration.';
  return err?.message||'Vehicle lookup is temporarily unavailable.';
}

function showVehicleLookupLoading(reg){
  const overlay=document.getElementById('vehicleLookupOverlay');
  const regEl=document.getElementById('vehicleLookupReg');
  if(regEl)regEl.textContent=displayReg(reg||'');
  if(overlay)overlay.classList.add('show');
}
function hideVehicleLookupLoading(){
  const overlay=document.getElementById('vehicleLookupOverlay');
  if(overlay)overlay.classList.remove('show');
}

async function performVehicleLookup(reg,target='vehicleResult'){
  showVehicleLookupLoading(reg);
  try{
    const v=await lookupVehicle(reg);
    checkedCar=v;
    checkTab='summary';
    await saveRecentSearch(v);
    await trackEvent('vehicle_lookup',{registration:cleanReg(v.reg),source:'dvsa'});
    hideVehicleLookupLoading();
    go(target);
  }catch(err){
    hideVehicleLookupLoading();
    alert(lookupErrorMessage(err));
  }
}


let passportRecords = {};
let activePassportId = null;

async function loadPassports(force=false){
  return withLoadLock('passports',async()=>{
    const previousActivePassportId=activePassportId;
    passports=[];passportRecords={};
    if(!sb||!currentUser){activePassportId=null;return}
    const {data,error}=await sb.from('passports').select('id,garage_vehicle_id,registration,make,model,year,current_keeper_id,status,is_public,created_at').eq('current_keeper_id',currentUser.id).order('created_at',{ascending:true});
    if(error){console.warn('Passport load failed',error);return}
    passports=(data||[]).filter(x=>cleanReg(x.registration)!=='L77WTW').map(x=>({id:x.id,garage_vehicle_id:x.garage_vehicle_id,reg:displayReg(x.registration),make:x.make||'Vehicle',model:x.model||'',year:x.year||'',status:x.status||'active',is_public:!!x.is_public,is_public:!!x.is_public,current_keeper_id:x.current_keeper_id||null}));
    activePassportId=passports.some(p=>p.id===previousActivePassportId)?previousActivePassportId:null;
    if(!passports.length)return;
    const ids=passports.map(x=>x.id);
    const {data:records,error:recordsError}=await sb.from('passport_records').select('id,passport_id,user_id,record_type,record_date,mileage,title,description,provider,cost,created_at').in('passport_id',ids).order('record_date',{ascending:false}).order('created_at',{ascending:false});
    if(recordsError){console.warn('Passport records load failed',recordsError);return}
    for(const rec of (records||[])){if(!passportRecords[rec.passport_id])passportRecords[rec.passport_id]=[];passportRecords[rec.passport_id].push(rec)}
  },force)
}

function passportForVehicle(v){
  if(!v) return null;
  return passports.find(p =>
    (v.dbid && p.garage_vehicle_id === v.dbid) ||
    cleanReg(p.reg) === cleanReg(v.reg)
  ) || null;
}

async function openOrCreateGarageHistory(reg){
  const clean=cleanReg(reg);
  const v=myDrive.find(x=>cleanReg(x.reg)===clean);
  if(!v)return alert('That car is not in My Garage.');
  driveCar=v;
  if(currentUser){
    try{await loadPassports(true)}catch(e){}
  }
  const existing=passportForVehicle(v);
  if(existing){activePassportId=existing.id;go('passportDetail');return}
  return createPassportByReg(reg);
}

async function handleGaragePhotoClick(key){
  if(!currentUser)return requireAccount('Sign in to add a Garage photo.');
  if(!isPremium()){
    try{await loadPremium(true)}catch(e){}
  }
  if(!isPremium()){go('premium');return}
  const input=document.getElementById('garagePhoto-'+key);
  if(input)input.click();
}

async function createPassportByReg(reg){
  if(!currentUser)return requireAccount('Sign in to create a Passport.');
  const v=myDrive.find(x=>cleanReg(x.reg)===cleanReg(reg));if(!v)return alert('That car is not in My Garage.');
  const existing=passportForVehicle(v);if(existing){activePassportId=existing.id;driveCar=v;return go('passportDetail')}
  if(passports.length>=passportLimit()){if(isPremium())return alert('Your CarFull Pro car history allowance is full (5 cars).');return go('passportUpgrade')}
  const restore=setBusy(currentActionButton(),'Creating…');
  try{
    const {data,error}=await sb.from('passports').insert({current_keeper_id:currentUser.id,garage_vehicle_id:v.dbid||null,registration:cleanReg(v.reg),make:v.make||null,model:v.model||null,year:v.year||null,status:'active'}).select('id').single();
    if(error){
      if(String(error.code)==='23505'){invalidateCache('passports');await loadPassports(true);const nowExisting=passportForVehicle(v);if(nowExisting){activePassportId=nowExisting.id;driveCar=v;return go('passportDetail')}}
      return alert('Could not create Passport: '+error.message)
    }
    await trackEvent('passport_created',{registration:cleanReg(v.reg)});invalidateCache('passports','evidence');await loadPassports(true);activePassportId=data.id;driveCar=v;go('passportDetail');
  }finally{restore()}
}

function currentPassport(){
  return passports.find(p => p.id === activePassportId) || passportForVehicle(driveCar) || null;
}

async function openGarageHistory(reg){
  const clean=cleanReg(reg);
  let v=myDrive.find(x=>cleanReg(x.reg)===clean)||driveCar||null;
  if(v)driveCar=v;
  let pp=v?passportForVehicle(v):passports.find(p=>cleanReg(p.reg)===clean);
  if(!pp && currentUser){
    try{await loadPassports(true);pp=v?passportForVehicle(v):passports.find(p=>cleanReg(p.reg)===clean)}catch(e){}
  }
  if(!pp){alert('Car history could not be opened. Please try again.');return}
  activePassportId=pp.id;
  go('passportDetail');
}

function passportRecordIcon(type){
  const t = String(type || '').toLowerCase();
  if(t.includes('story')) return '▣';
  if(t.includes('service')) return '🛠️';
  if(t.includes('tyre')) return '🛞';
  if(t.includes('brake')) return '🛑';
  if(t.includes('repair')) return '🔧';
  if(t.includes('mot')) return '📋';
  if(t.includes('mod')) return '⚙️';
  return '🔩';
}


function selectHistoryEvidence(input){
  pendingHistoryEvidenceFile=input?.files?.[0]||null;
  const nameEl=document.getElementById('historyEvidenceName');
  if(nameEl){
    nameEl.textContent=pendingHistoryEvidenceFile
      ? `✓ ${pendingHistoryEvidenceFile.name||'Photo selected'} — kept private`
      : 'No photo or document selected.';
  }
}

async function uploadPrivateHistoryEvidence(pp,recordId,file,evidenceType='invoice'){
  if(!file||!pp||!recordId)return;
  const blob=await compressEvidenceImage(file);
  const path=`${currentUser.id}/${pp.id}/${recordId}/${Date.now()}.jpg`;
  const {error:uploadError}=await sb.storage.from('passport-evidence').upload(
    path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:'3600'}
  );
  if(uploadError)throw uploadError;
  const {error:metaError}=await sb.from('passport_evidence').insert({
    passport_id:pp.id,
    record_id:recordId,
    user_id:currentUser.id,
    evidence_type:evidenceType||'invoice',
    object_path:path,
    verification_status:'owner_uploaded'
  });
  if(metaError){
    try{await sb.storage.from('passport-evidence').remove([path])}catch(e){}
    throw metaError;
  }
}

async function savePassportRecord(){
  const pp = currentPassport();
  if(!pp) return alert('Car History not selected.');

  const title = (document.getElementById('recordTitle')?.value || '').trim();
  if(!title) return alert('Give this history record a title.');

  const mileage = document.getElementById('recordMileage')?.value || '';
  const cost = document.getElementById('recordCost')?.value || '';
  const button=currentActionButton();
  const restore=setBusy(button,pendingHistoryEvidenceFile?'Saving history & photo…':'Saving history…');

  try{
    const {data,error} = await sb.from('passport_records').insert({
      passport_id: pp.id,
      user_id: currentUser.id,
      record_type: document.getElementById('recordType')?.value || 'Maintenance',
      record_date: document.getElementById('recordDate')?.value || null,
      mileage: mileage ? Number(mileage) : null,
      title,
      description: (document.getElementById('recordDescription')?.value || '').trim() || null,
      provider: (document.getElementById('recordProvider')?.value || '').trim() || null,
      cost: cost ? Number(cost) : null
    }).select('id').single();

    if(error) return alert('Could not save Car History record: ' + error.message);

    if(pendingHistoryEvidenceFile){
      try{
        await uploadPrivateHistoryEvidence(
          pp,
          data.id,
          pendingHistoryEvidenceFile,
          pendingHistoryEvidenceType
        );
      }catch(e){
        alert('The history record was saved, but the private photo could not be uploaded: '+(e.message||e));
      }
    }

    const keepId = pp.id;
    pendingHistoryEvidenceFile=null;
    pendingHistoryEvidenceType='invoice';
    await trackEvent('passport_record_added',{passport_id:pp.id});
    invalidateCache('passports','evidence');
    await loadPassports(true);
    await loadPassportEvidence(true);
    activePassportId = keepId;
    go('passportDetail');
  }finally{
    restore();
  }
}

async function deletePassportRecord(id){
  if(!confirm('Delete this car history record?')) return;
  const {error} = await sb.from('passport_records').delete().eq('id',id);
  if(error) return alert(error.message);

  const keepId = activePassportId;
  await loadPassports();
  activePassportId = keepId;
  go('passportDetail');
}


async function refreshCarFullAccountData(){
  if(!currentUser)return;
  await Promise.allSettled([
    loadGarage(true),
    loadPremium(true),
    loadRecentSearches(true),
    loadPassports(true)
  ]);
}

function scheduleAccountRefresh(delay=450){
  if(!currentUser)return;
  setTimeout(async()=>{
    await refreshCarFullAccountData();
    render();
  },delay);
}


let passportEvidence = {};
let evidenceRecordId = null;
let pendingEvidenceFile = null;
let pendingEvidenceType = 'invoice';
let pendingHistoryEvidenceFile = null;
let pendingHistoryEvidenceType = 'invoice';
let pendingStoryFile = null;
let pendingStoryPrivacy = 'Private';
const garagePhotoUrls={};
const garagePhotoChecked={};
let garagePhotoLoading=false;

async function loadPassportEvidence(force=false){
  return withLoadLock('evidence',async()=>{
    passportEvidence={};if(!sb||!currentUser||!passports.length)return;
    const ids=passports.map(p=>p.id);
    const {data,error}=await sb.from('passport_evidence').select('id,passport_id,record_id,evidence_type,object_path,verification_status,created_at').in('passport_id',ids).order('created_at',{ascending:false});
    if(error){console.warn('Evidence load failed',error);return}
    for(const ev of (data||[])){if(!passportEvidence[ev.record_id])passportEvidence[ev.record_id]=[];passportEvidence[ev.record_id].push(ev)}
  },force)
}
function evidenceForRecord(id){return passportEvidence[id]||[];}
function evidenceLabel(ev){
  if(ev.verification_status==='independently_verified')return 'Independently verified';
  if(ev.verification_status==='carfull_extracted')return 'CarFull extracted';
  return 'Owner uploaded';
}
async function compressEvidenceImage(file){
  if(!file)throw new Error('Choose an image first.');
  if(!String(file.type||'').startsWith('image/'))throw new Error('Choose an image file.');
  const bmp=await createImageBitmap(file);
  const maxSide=1800;
  const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bmp.width*scale));
  canvas.height=Math.max(1,Math.round(bmp.height*scale));
  canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.78));
  if(!blob)throw new Error('Could not prepare image.');
  if(blob.size>5*1024*1024)throw new Error('Image is too large after compression.');
  return blob;
}
function selectEvidenceFile(input){
  pendingEvidenceFile=input?.files?.[0]||null;
  render();
}
function garagePhotoPath(v){
  if(!currentUser||!v)return '';
  return `${currentUser.id}/garage/${cleanReg(v.reg)}.jpg`;
}
async function loadGaragePhotos(){
  if(!sb||!currentUser||garagePhotoLoading)return;
  const pending=(myDrive||[]).filter(v=>!garagePhotoChecked[cleanReg(v.reg)]);
  if(!pending.length)return;
  garagePhotoLoading=true;
  let changed=false;
  try{
    for(const v of pending){
      const key=cleanReg(v.reg);garagePhotoChecked[key]=true;
      try{
        const {data,error}=await sb.storage.from('passport-evidence').createSignedUrl(garagePhotoPath(v),3600);
        if(!error&&data?.signedUrl){garagePhotoUrls[key]=data.signedUrl;changed=true}
      }catch(e){}
    }
  }finally{
    garagePhotoLoading=false;
    if(changed&&(screen==='drive'||screen==='vehicle'))render();
  }
}
async function chooseGaragePhoto(reg,input){
  const file=input?.files?.[0]||null;
  if(input)input.value='';
  if(!currentUser)return requireAccount('Sign in to add a Garage photo.');
  if(!isPremium()){
    try{await loadPremium(true)}catch(e){}
  }
  if(!isPremium()){go('premium');return}
  if(!file||!sb)return;
  const v=(myDrive||[]).find(x=>cleanReg(x.reg)===cleanReg(reg));
  if(!v)return alert('Car not found in your Garage.');
  const restore=setBusy(currentActionButton(),'Saving photo…');
  try{
    const blob=await compressEvidenceImage(file);
    const path=garagePhotoPath(v);
    const {error}=await sb.storage.from('passport-evidence').upload(path,blob,{contentType:'image/jpeg',upsert:true,cacheControl:'3600'});
    if(error)throw error;
    const {data,error:urlError}=await sb.storage.from('passport-evidence').createSignedUrl(path,3600);
    if(urlError)throw urlError;
    garagePhotoUrls[cleanReg(v.reg)]=data.signedUrl;
    garagePhotoChecked[cleanReg(v.reg)]=true;
    await trackEvent('garage_photo_added',{registration:cleanReg(v.reg)});
    if(screen==='drive'||screen==='vehicle')render();
  }catch(err){alert('Could not save car photo: '+(err.message||err))}
  finally{restore()}
}
async function saveEvidence(){
  const pp=currentPassport();if(!pp||!evidenceRecordId)return alert('History record not selected.');if(!pendingEvidenceFile)return alert('Take or choose a photo first.');
  const restore=setBusy(currentActionButton(),'Saving…');
  try{
    const blob=await compressEvidenceImage(pendingEvidenceFile);const path=`${currentUser.id}/${pp.id}/${evidenceRecordId}/${Date.now()}.jpg`;
    const {error:uploadError}=await sb.storage.from('passport-evidence').upload(path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:'3600'});if(uploadError)throw uploadError;
    const {error:metaError}=await sb.from('passport_evidence').insert({passport_id:pp.id,record_id:evidenceRecordId,user_id:currentUser.id,evidence_type:pendingEvidenceType,object_path:path,verification_status:'owner_uploaded'});
    if(metaError){try{await sb.storage.from('passport-evidence').remove([path])}catch(e){}throw metaError}
    pendingEvidenceFile=null;invalidateCache('evidence');await loadPassportEvidence(true);go('passportDetail');
  }catch(err){alert('Could not save evidence: '+(err.message||err))}finally{restore()}
}
async function viewEvidence(id){
  let ev=null;
  for(const items of Object.values(passportEvidence)){
    const hit=items.find(x=>x.id===id);
    if(hit){ev=hit;break;}
  }
  if(!ev)return alert('Evidence not found.');
  const {data,error}=await sb.storage.from('passport-evidence').createSignedUrl(ev.object_path,60);
  if(error||!data?.signedUrl)return alert('Could not open private evidence.');
  window.open(data.signedUrl,'_blank','noopener');
}
function evidenceUpload(){
  const pp=currentPassport();
  if(!pp)return passport();
  const record=(passportRecords[pp.id]||[]).find(r=>r.id===evidenceRecordId);
  if(!record)return passportDetail();
  return wrap(`${title('Add Evidence')}
  <section class="card">
    <div class="passportBadge">PRIVATE PASSPORT EVIDENCE</div>
    <h2>${record.title}</h2>
    <div class="muted">${[record.record_date,record.mileage?Number(record.mileage).toLocaleString()+' miles':''].filter(Boolean).join(' • ')}</div>
  </section>
  <section class="card">
    <label>EVIDENCE TYPE</label>
    <select class="input" onchange="pendingEvidenceType=this.value">
      <option value="invoice" ${pendingEvidenceType==='invoice'?'selected':''}>Invoice / receipt</option>
      <option value="service_stamp" ${pendingEvidenceType==='service_stamp'?'selected':''}>Service-book stamp</option>
      <option value="other" ${pendingEvidenceType==='other'?'selected':''}>Other supporting image</option>
    </select>
    <input id="evidencePicker" type="file" accept="image/*" capture="environment" style="display:none" onchange="selectEvidenceFile(this)">
    <button class="btn secondary" style="margin-top:12px" onclick="document.getElementById('evidencePicker').click()">Photograph / choose evidence</button>
    ${pendingEvidenceFile?`<div class="codeStatus" style="margin-top:12px"><b>Evidence selected ✓</b><div class="muted">${pendingEvidenceFile.name||'Photo ready'} • compressed before upload</div></div>`:''}
    <p class="muted" style="margin-top:14px">The image stays private to your account and is labelled <b>Owner uploaded</b>. CarFull does not treat a scanned document as independently verified.</p>
    <button class="btn" style="margin-top:12px" onclick="saveEvidence()">Save private evidence</button>
    <button class="btn secondary" style="margin-top:10px" onclick="go('passportDetail')">Cancel</button>
  </section>`,'passport')
}


let loadLocks={garage:null,premium:null,recent:null,passports:null,evidence:null};
let lastLoadedAt={garage:0,premium:0,recent:0,passports:0,evidence:0};
const CACHE_MS={garage:15000,premium:30000,recent:15000,passports:15000,evidence:15000};
function isFresh(key){return Date.now()-(lastLoadedAt[key]||0)<(CACHE_MS[key]||0)}
function invalidateCache(...keys){for(const key of keys)lastLoadedAt[key]=0}
async function withLoadLock(key,fn,force=false){
  if(!force&&isFresh(key))return;
  if(loadLocks[key])return loadLocks[key];
  loadLocks[key]=(async()=>{try{await fn();lastLoadedAt[key]=Date.now()}finally{loadLocks[key]=null}})();
  return loadLocks[key];
}
function setBusy(button,text='Working…'){
  if(!button)return ()=>{};
  const oldText=button.textContent,oldDisabled=button.disabled;
  button.disabled=true;button.textContent=text;
  return ()=>{button.disabled=oldDisabled;button.textContent=oldText};
}
function currentActionButton(){return document.activeElement&&document.activeElement.tagName==='BUTTON'?document.activeElement:null}
async function loadAccountDataFast(force=false){
  if(!currentUser){myDrive=[];passports=[];passportRecords={};passportEvidence={};recentSearches=[];premiumActive=false;premiumExpiresAt=null;premiumSource=null;return}
  await Promise.allSettled([loadGarage(force),loadPremium(force),loadRecentSearches(force)]);
  await loadPassports(force);
  await loadPassportEvidence(force);
}



let activeFullCheckReport=null;

function fullCheckStorageKey(){
  return 'carfull-paid-reports-'+(currentUser?.id||'guest');
}
function readSavedFullChecks(){
  if(!currentUser)return [];
  try{
    const rows=JSON.parse(localStorage.getItem(fullCheckStorageKey())||'[]');
    return Array.isArray(rows)?rows:[];
  }catch(e){return []}
}
function saveFullCheckLocally(report){
  if(!currentUser||!report?.registration)return;
  const key=fullCheckStorageKey();
  const rows=readSavedFullChecks()
    .filter(x=>cleanReg(x?.registration)!==cleanReg(report.registration));
  rows.unshift(report);
  try{localStorage.setItem(key,JSON.stringify(rows.slice(0,20)))}catch(e){}
}
function openSavedFullCheck(reg){
  const report=readSavedFullChecks()
    .find(x=>cleanReg(x?.registration)===cleanReg(reg));
  if(!report)return;
  activeFullCheckReport=report;
  const current=checkedCar||car||{};
  checkedCar={
    ...current,
    reg:report.registration,
    make:report.vehicle?.make||current.make||'',
    model:report.vehicle?.model||current.model||'',
    year:report.vehicle?.year||current.year||''
  };
  go('fullCheckReport');
}
async function runRealFullCheck(reg){
  if(!currentUser||!sb)throw new Error('Sign in to view your paid report.');
  const sessionResult=await sb.auth.getSession();
  const token=sessionResult?.data?.session?.access_token||'';
  if(!token)throw new Error('Your CarFull session has expired. Sign in again.');

  const clean=cleanReg(reg);
  let response;
  try{
    response=await carfullFetch('/api/vdgl-check',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'Authorization':'Bearer '+token
      },
      body:JSON.stringify({registration:clean})
    });
  }catch(e){
    throw new Error('Paid-check service could not be reached.');
  }

  const raw=await response.text();
  let data={};
  try{ data=raw ? JSON.parse(raw) : {}; }
  catch(e){ throw new Error('Paid-check API returned an invalid response.'); }

  if(!response.ok){
    const err=data?.error||data?.message;
    let message='';
    if(typeof err==='string')message=err;
    else if(err&&typeof err==='object'){
      message=err.message||err.Message||err.detail||err.details||err.hint||'';
      if(!message){try{message=JSON.stringify(err)}catch(e){}}
    }
    throw new Error(message||('Paid-check API error '+response.status));
  }
  if(!data?.report)throw new Error('Your payment was found but no report was returned.');

  activeFullCheckReport=data.report;
  saveFullCheckLocally(data.report);

  const current=checkedCar||car||{};
  checkedCar={
    ...current,
    reg:data.report.registration,
    make:data.report.vehicle?.make||current.make||'',
    model:data.report.vehicle?.model||current.model||'',
    year:data.report.vehicle?.year||current.year||''
  };
  screen='fullCheckReport';
  render();
}
async function recoverPaidFullCheck(){
  const reg=cleanReg(document.getElementById('recoverCheckReg')?.value||'');
  if(!reg)return alert('Enter the registration from your paid check.');

  const saved=readSavedFullChecks().find(x=>cleanReg(x?.registration)===reg);
  if(saved){ openSavedFullCheck(reg); return; }

  const btn=currentActionButton();
  const restore=setBusy(btn,'Loading report…');
  try{
    await runRealFullCheck(reg);
  }catch(e){
    alert('Could not load this paid report: '+(e?.message||e));
  }finally{restore()}
}
function reportState(value,yes='Yes',no='Clear ✓'){
  if(value===null||value===undefined)return 'Not supplied';
  return value?yes:no;
}
function reportStatusClass(clear){
  return clear===true?'resultClear':clear===false?'resultWarn':'';
}

function nativePurchases(){return window.CarFullNativePurchases||null}
function isNativeIOSBuild(){try{return !!nativePurchases()?.isNativeIOS?.()}catch(e){return false}}
async function syncCarFullProFromRevenueCat(){
  if(!isNativeIOSBuild()||!currentUser)return false;
  try{
    const status=await nativePurchases().identify(currentUser.id);
    if(status){
      premiumActive=!!status.active;
      premiumExpiresAt=status.expiresAt||null;
      premiumSource='revenuecat';
      return premiumActive;
    }
  }catch(e){console.warn('CarFull Pro sync failed',e)}
  return false;
}
async function buyCarFullProNative(){
  if(!currentUser){alert('Please sign in to continue.');return go('account')}
  const btn=currentActionButton(); const restore=setBusy(btn,'Opening Apple purchase…');
  try{
    await nativePurchases().identify(currentUser.id);
    const status=await nativePurchases().purchaseMembership();
    premiumActive=!!status?.active; premiumExpiresAt=status?.expiresAt||null; premiumSource='revenuecat';
    if(!premiumActive)throw new Error('Apple completed the purchase but CarFull Pro is not active yet.');
    render(); setTimeout(()=>alert('CarFull Pro is active ✓'),80);
  }catch(e){
    const msg=e?.message||String(e); if(!/cancel/i.test(msg))alert('Could not complete purchase: '+msg);
  }finally{restore()}
}
async function buyFullCheckNative(reg=''){
  if(!currentUser){alert('Please sign in to continue.');return go('account')}
  const clean=String(reg||(checkedCar?checkedCar.reg:'')||'').replace(/\s+/g,'').toUpperCase();
  if(!clean)return alert('Enter a registration first.');
  const btn=currentActionButton(); const restore=setBusy(btn,'Opening Apple purchase…');
  try{
    await nativePurchases().identify(currentUser.id);
    await nativePurchases().purchaseCheck(isPremium());
    const sessionResult=await sb.auth.getSession();
    const token=sessionResult?.data?.session?.access_token||'';
    const claim=await carfullFetch('/api/claim-revenuecat-check',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({registration:clean})});
    const claimData=await claim.json();
    if(!claim.ok)throw new Error(claimData?.error||'Could not verify your Apple purchase.');
    await runRealFullCheck(clean);
  }catch(e){
    const msg=e?.message||String(e); if(!/cancel/i.test(msg))alert('Could not complete purchase: '+msg);
  }finally{restore()}
}
async function restoreCarFullPro(){
  if(!isNativeIOSBuild())return alert('Restore Purchases is available in the CarFull iPhone app.');
  if(!currentUser)return go('account');
  try{
    await nativePurchases().identify(currentUser.id);
    const status=await nativePurchases().restore();
    premiumActive=!!status?.active; premiumExpiresAt=status?.expiresAt||null; premiumSource='revenuecat'; render();
    alert(premiumActive?'CarFull Pro restored ✓':'No active CarFull Pro purchase was found for this Apple ID.');
  }catch(e){alert('Could not restore purchases: '+(e?.message||e))}
}
async function startStripeCheckout(type,registration=''){
  if(!currentUser){alert('Please sign in to continue.');return go('account')}
  const reg=String(registration||(checkedCar?checkedCar.reg:'')||'')
    .replace(/\s+/g,'').toUpperCase();
  try{
    const r=await carfullFetch('/api/create-checkout',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        type,
        registration:reg,
        userId:currentUser.id,
        email:currentUser.email||'',
        isPremium:type==='full_check' ? isPremium() : false
      })
    });
    const data=await r.json();
    if(!r.ok||!data.url)throw new Error(data.error||'Could not open checkout');
    window.location.assign(data.url);
  }catch(e){
    const msg=e?.message||String(e);
    if(msg.includes('Stripe is not configured')){
      alert('Stripe needs connecting to this Vercel deployment. Add STRIPE_SECRET_KEY to this project, then redeploy.');
    }else{
      alert('Could not start payment: '+msg);
    }
  }
}
function buyFullCheck(reg=''){return isNativeIOSBuild()?buyFullCheckNative(reg):startStripeCheckout('full_check',reg)}
function buyPremium(){return isNativeIOSBuild()?buyCarFullProNative():startStripeCheckout('premium')}

async function handleStripeReturn(){
  const q=new URLSearchParams(window.location.search||'');
  const state=q.get('stripe');
  if(!state)return;

  const requestedType=q.get('type')||'';
  const sessionId=q.get('session_id')||'';

  try{history.replaceState({},'',window.location.pathname)}catch(e){}

  if(state==='cancelled'){
    setTimeout(()=>alert('Payment cancelled — nothing was charged.'),50);
    return;
  }

  if(state!=='success'||!sessionId)return;

  try{
    const r=await fetch(
      carfullApiUrl('/api/verify-checkout?session_id='+encodeURIComponent(sessionId))
    );
    const data=await r.json();

    if(!r.ok)throw new Error(data.error||'Could not verify payment');
    if(!data.paid)
      return alert('Stripe checkout completed, but payment is still processing.');

    const type=data.type||requestedType;

    if(type==='premium'){
      if(data.premium_activated){
        premiumActive=true;
        premiumExpiresAt=data.expires_at||new Date(Date.now()+365*86400000).toISOString();
        premiumSource='stripe';
        invalidateCache('premium');
        try{await loadPremium(true)}catch(e){}
        screen='premium';
        render();
        setTimeout(()=>alert('CarFull Pro is active ✓\\n\\nWelcome to CarFull Pro.'),80);
      }else{
        const extra=data.persistence_error
          ? '\\n\\n'+data.persistence_error
          : '';
        alert(
          'Stripe payment was successful, but CarFull could not activate CarFull Pro automatically.'
          +extra+
          '\\n\\nYour Stripe payment is safe. Check the Vercel Supabase service-role setting before taking another payment.'
        );
      }
      return;
    }

    if(type==='full_check'){
      const reg=String(data.registration||'').trim();
      if(reg){
        try{
          await runRealFullCheck(reg);
        }catch(e){
          activeFullCheckReport=null;
          alert(
            'Payment successful ✓\\n\\nYour Full Check is paid and saved to your account, '
            +'but Vehicle Data Global could not return the report right now.\\n\\n'
            +(e?.message||e)
          );
          screen='myChecks';
          render();
        }
      }else{
        alert('Payment successful ✓\\n\\nYour Full Check has been paid for.');
      }
      return;
    }

    alert('Payment successful ✓');
  }catch(e){
    alert(
      'Payment return received, but CarFull could not verify it automatically. '
      +'If Stripe charged you, the Stripe receipt remains the payment record.\\n\\n'
      +(e?.message||e)
    );
  }
}

async function initBackend(){
  try{
    sb=window.supabase.createClient('https://pgczryadczopajxcmmtj.supabase.co','sb_publishable_kuCy88UOJNdQfvn2QMa9Ig_w7FlAQXW',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'carfull-auth-session'}});

    // IMPORTANT: subscribe before getSession(). Recovery links can establish a
    // Supabase session immediately; registering later can miss PASSWORD_RECOVERY.
    sb.auth.onAuthStateChange((event,session)=>{
      currentUser=session?.user||null;
      if(currentUser)hydrateAccountVehicleData();

      if(event==='PASSWORD_RECOVERY'){
        passwordRecoveryMode=true;
        screen='passwordReset';
        backendReady=true; backendMessage='';
        render();
        try{window.scrollTo(0,0)}catch(e){}
        return;
      }

      if(event==='SIGNED_IN'){
        // A reset link intentionally signs in a temporary recovery session.
        // If the URL marks this as recovery, keep the user on the reset screen.
        if(passwordRecoveryMode){
          screen='passwordReset';
          backendReady=true; backendMessage='';
          render();
          try{window.scrollTo(0,0)}catch(e){}
          return;
        }
        globalCommunityStoriesLoaded=false;
        globalCommunityStoriesLoading=false;
        globalCommunityStoriesError='';
        globalCommunityStoryRows=[];
        storyOwnerProfilesLoaded=false;
        storyInteractionsLoaded=false;
        if(screen==='account'){screen='home';render();try{window.scrollTo(0,0)}catch(e){}}
        setTimeout(async()=>{
          await loadAccountDataFast(true);
          await loadGlobalCommunityStories(true);
          render();
        },0);
        return;
      }

      if(event==='SIGNED_OUT'){
        invalidateCache('garage','premium','recent','passports','evidence');
        myDrive=[];passports=[];passportRecords={};passportEvidence={};recentSearches=[];premiumActive=false;premiumExpiresAt=null;premiumSource=null;
        if(screen!=='account')screen='account';
        render();
      }
    });

    const {data:{session},error:sessionError}=await sb.auth.getSession();
    if(sessionError)throw sessionError;
    currentUser=session?.user||null;
    communityProfileLoaded=false;storyOwnerProfilesLoaded=false;storyInteractionsLoaded=false;
    if(currentUser)hydrateAccountVehicleData();
    backendReady=true;backendMessage='';

    if(passwordRecoveryMode && currentUser) screen='passwordReset';

    loadGlobalCommunityStories(true).then(()=>{if(screen==='stories')render()}).catch(()=>{});
    render();
    if(currentUser && !passwordRecoveryMode){
      await purgeKnownGhostPassport();
      await loadAccountDataFast(true);
      await loadRecentSearches(true);
      render();
      try{await trackEvent('app_open',{screen:'launch'})}catch(e){}
    }
  }catch(e){
    console.error('Backend init failed',e);
    backendReady=false;
    backendMessage=e?.message||'Could not connect to CarFull.';
    render();
  }
}
function requireAccount(message='Create a free account to save this to CarFull.'){
  if(currentUser)return true;
  alert(message);
  go('account');
  return false;
}

async function signUpCarFull(){
  if(!backendReady||!sb)return alert(backendMessage||'Backend not ready');
  const email=document.getElementById('authEmail')?.value.trim();
  const password=document.getElementById('authPassword')?.value||'';
  if(!email||password.length<8)return alert('Enter your email and a password of at least 8 characters.');
  const {data,error}=await sb.auth.signUp({email,password});
  if(error)return alert(error.message);
  if(data.session){
    currentUser=data.user;
  if(currentUser)hydrateAccountVehicleData(); await loadGarage(); await trackEvent('account_created'); alert('CarFull account created ✓'); go('account');
  }else{
    alert('Account created ✓\n\nCheck your email to confirm your CarFull account, then sign in.');
  }
}

async function signInCarFull(){
  if(!backendReady||!sb)return alert(backendMessage||'Backend not ready');
  const email=document.getElementById('authEmail')?.value.trim();
  const password=document.getElementById('authPassword')?.value||'';
  if(!email||!password)return alert('Enter your email and password.');
  const button=document.querySelector('button[onclick="signInCarFull()"]');
  const restore=setBusy(button,'Signing in…');
  try{
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)return alert(error.message);
    currentUser=data.user||data.session?.user||currentUser;screen='home';render();try{window.scrollTo(0,0)}catch(e){}
    setTimeout(async()=>{try{await trackEvent('login')}catch(e){}},0);
  }catch(err){alert(err.message||'Sign in failed. Please try again.')}finally{restore()}
}

async function signOutCarFull(){
  try{
    if(sb){
      try{ await trackEvent('logout'); }catch(e){}
      const {error}=await sb.auth.signOut({scope:'local'});
      if(error)throw error;
    }
  }catch(err){
    console.warn('Sign out warning',err);
  }finally{
    currentUser=null;
    communityProfile=null;
    communityProfileLoaded=false;storyOwnerProfilesLoaded=false;storyInteractionsLoaded=false;
    myDrive=[];
    driveCar=null;
    checkedCar=null;
    passwordRecoveryMode=false;
    premiumActive=false; premiumExpiresAt=null; premiumSource=null;
    screen='account';
    render();
    try{ window.scrollTo(0,0); }catch(e){}
  }
}

function carfullNavIcon(name){
 const icons={
  home:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2"></circle><path d="M15.4 15.4 20 20"></path></svg>`,
  drive:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 14.8 5.7 9.9c.3-1 1.2-1.7 2.2-1.7h8.2c1 0 1.9.7 2.2 1.7l1.5 4.9"></path><path d="M3.4 15.1h17.2v3.1c0 .8-.6 1.4-1.4 1.4h-1.1v-1.5H5.9v1.5H4.8c-.8 0-1.4-.6-1.4-1.4z"></path><circle cx="7.1" cy="15.8" r="1"></circle><circle cx="16.9" cy="15.8" r="1"></circle></svg>`,
  stories:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h3l1.4-2h8.2l1.4 2h3A1.5 1.5 0 0 1 22 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5V9a1.5 1.5 0 0 1 1.5-1.5Z"></path><circle cx="12" cy="13.5" r="4"></circle></svg>`,
  account:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.4"></circle><path d="M5.5 19.5c.5-3.3 3-5.3 6.5-5.3s6 2 6.5 5.3"></path></svg>`
 };
 return icons[name]||'';
}
function nav(active){
 const a=active==='passport'?'drive':active;
 return `<div class="nav navFour">
   <div class="${a==='home'?'active':''}" onclick="go('home')">${carfullNavIcon('home')}<small>Check</small></div>
   <div class="${a==='drive'?'active':''}" onclick="go('drive')">${carfullNavIcon('drive')}<small>Garage</small></div>
   <div class="${a==='stories'?'active':''}" onclick="go('stories')">${carfullNavIcon('stories')}<small>Spotted</small></div>
   <div class="${a==='account'?'active':''}" onclick="go('account')">${carfullNavIcon('account')}<small>Account</small></div>
 </div>`
}
function wrap(x,n){return `<main class="app"><div class="top"><div></div><div><div class="brand"><span class="carfullWord"><span class="brandCar">Car</span><span class="brandFull">Full</span></span></div><div class="tag">Every car has a story.</div></div><div class="bell" onclick="go('alerts')" style="cursor:pointer">●</div></div>${x}</main>${nav(n)}`}
function title(t){return `<div class="screenTitle"><button class="back" onclick="go('home')">‹</button><h2>${t}</h2></div>`}
function vc(v){
 const key=cleanReg(v.reg),photo=garagePhotoUrls[key]||'';
 const photoHtml=photo
   ? `<div class="garageSimplePhoto"><img src="${photo}" alt="${cfTitleCase(v.make)} ${v.model||''}"></div>`
   : `<div class="garageSimplePhoto garageSimplePhotoEmpty">${(cfTitleCase(v.make)||'C').slice(0,1)}</div>`;
 const mot=v.mot_expiry?`MOT ${formatDate(v.mot_expiry)}`:'MOT details';
 return `<button class="garageSimpleCar" onclick="openDriveVehicle('${v.reg}')">
   ${photoHtml}
   <div class="garageSimpleBody">
     <div class="garageSimpleName">${cfTitleCase(v.make)} ${v.model||''}</div>
     <div class="garageSimpleMeta"><span class="garageSimpleReg">${v.reg}</span>${v.year?`<span>${v.year}</span>`:''}</div>
     <div class="garageSimpleBottom"><span>${mot}</span>${Number.isFinite(Number(v.score))?`<span>CarFull ${Number(v.score)}/100</span>`:''}</div>
   </div>
   <span class="garageSimpleChevron">›</span>
 </button>`
}

function home(){return wrap(`<div class="checkCenter"><div class="hero"><h1 style="font-size:29px;margin-bottom:5px">Check any car.<br><span style="color:var(--green)">Know the full story.</span></span></h1><p class="muted">Enter a UK registration to get started.</p></div><section class="card" style="padding:16px"><label class="label">UK REGISTRATION</label><div class="ukPlateWrap"><div class="ukPlateBadge"><span class="ukFlag">🇬🇧</span><span>UK</span></div><input id="homeReg" class="input" placeholder="" style="text-align:center"></div><button class="btn" style="margin-top:12px" onclick="homeCheck()">Check this car</button><div class="recentBtnRow"><button class="btn secondary" onclick="go('recentSearchHistory')">Recent Searches</button></div></section></div>`,'home')}

async function homeCheck(){
 let r=document.getElementById('homeReg')?.value.trim();
 if(!r)return;
 await performVehicleLookup(r,'vehicleResult');
}

function drive(){
 if(currentUser && !garagePhotoLoading)setTimeout(loadGaragePhotos,0);
 if(currentUser && !carFollowDataLoading && !storyInteractionsLoaded)setTimeout(ensureCarFollowData,0);
 if(currentUser && (!isFresh('premium') || !isFresh('passports')) && !window.__garageAccountRefreshPending){
   window.__garageAccountRefreshPending=true;
   setTimeout(async()=>{
     try{await Promise.allSettled([loadPremium(),loadPassports()])}finally{
       window.__garageAccountRefreshPending=false;
       if(screen==='drive')render();
     }
   },0);
 }
 if(!currentUser)return wrap(`<div class="garageSimpleHead"><h1>Garage</h1></div><section class="garageSimpleEmpty"><b>Your cars live here.</b><p>Sign in to add your first car.</p><button class="btn" onclick="go('account')">Sign in / Create account</button></section>`,'drive');
 const visibleDrive=myDrive.filter(v=>!isLegacyDemoVehicle(v));
 return wrap(`<div class="garageSimpleHead"><div><h1>Garage</h1><p>${visibleDrive.length}/${garageLimit()} cars</p></div><button class="garageAddRound" onclick="go('addDrive')" aria-label="Add car">＋</button></div>
 ${visibleDrive.length?`<div class="garageSimpleList">${visibleDrive.map(vc).join('')}</div>`:`<section class="garageSimpleEmpty"><b>Add your first car</b><p>Enter a registration and CarFull will do the rest.</p><button class="btn" onclick="go('addDrive')">Add a car</button></section>`}`,'drive')
}

function addDrive(){
 if(!currentUser){requireAccount();return account()}
 return wrap(`${title('Add to Garage')}<section class="card"><div class="liveBadge">SAVES TO CARFULL</div><label>UK registration</label><input id="r" class="input" placeholder=""><p class="muted">CarFull will look up the registration through the secure DVSA connection before saving it to your Garage.</p><button class="btn" onclick="add()">Add to Garage</button></section>`,'drive')
}

async function add(){
 if(!requireAccount())return;
 let r=document.getElementById('r')?.value.trim();
 if(!r)return;
 const clean=cleanReg(r);
 const existing=myDrive.find(v=>cleanReg(v.reg)===clean);
 if(!existing && myDrive.filter(v=>!isLegacyDemoVehicle(v)).length>=garageLimit())return alert(isPremium()?'Your CarFull Pro Garage is full (5 cars).':'Your free Garage includes 1 car. CarFull Pro unlocks up to 5 cars.');
 let v;
 try{v=await lookupVehicle(clean);}catch(err){return alert(lookupErrorMessage(err));}
 const payload={user_id:currentUser.id,registration:cleanReg(v.reg),make:v.make,model:v.model||null,year:v.year||null,colour:v.colour||null,fuel_type:v.fuel_type||null,engine_size:v.engine_size||null,mot_expiry:v.mot_expiry||null,score:v.score};
 const updateFields={registration:payload.registration,make:payload.make,model:payload.model,year:payload.year,colour:payload.colour,fuel_type:payload.fuel_type,engine_size:payload.engine_size,mot_expiry:payload.mot_expiry,score:payload.score};
 if(existing?.dbid){
   const {error}=await sb.from('garage_vehicles').update(updateFields).eq('id',existing.dbid).eq('user_id',currentUser.id);
   if(error)return alert('Could not refresh Garage car: '+error.message);
   await saveRecentSearch(v);invalidateCache('garage');await loadGarage(true);await trackEvent('garage_vehicle_refreshed',{registration:cleanReg(v.reg),source:'dvsa_lookup'});go('drive');return;
 }
 let {error}=await sb.from('garage_vehicles').insert(payload);
 if(error && (error.code==='23505' || /duplicate key|unique constraint/i.test(String(error.message||'')))){
   const {data:row,error:findError}=await sb.from('garage_vehicles').select('id').eq('user_id',currentUser.id).eq('registration',payload.registration).maybeSingle();
   if(findError)return alert('Could not refresh Garage car: '+findError.message);
   if(row?.id){
     const {error:updateError}=await sb.from('garage_vehicles').update(updateFields).eq('id',row.id).eq('user_id',currentUser.id);
     if(updateError)return alert('Could not refresh Garage car: '+updateError.message);
     error=null;
   }
 }
 if(error)return alert('Could not save Garage car: '+error.message);
 await saveRecentSearch(v);invalidateCache('garage');await loadGarage(true);await trackEvent('garage_vehicle_added',{registration:cleanReg(v.reg),source:'dvsa_lookup'});go('drive');
}

async function openDriveVehicle(reg){
  openMenuReg=null;
  const saved=myDrive.find(v=>cleanReg(v.reg)===cleanReg(reg));
  if(!saved)return;
  driveCar=saved;
  go('vehicle');

  // Refresh from DVSA so Garage details and score stay live.
  try{
    const live=await lookupVehicle(reg);
    driveCar={...saved,...live,dbid:saved.dbid};
    const i=myDrive.findIndex(v=>cleanReg(v.reg)===cleanReg(reg));
    if(i>=0)myDrive[i]=driveCar;

    if(sb&&currentUser){
      await sb.from('garage_vehicles').update({
        make:driveCar.make||null,
        model:driveCar.model||null,
        year:driveCar.year||null,
        colour:driveCar.colour||null,
        fuel_type:driveCar.fuel_type||null,
        engine_size:driveCar.engine_size||null,
        mot_expiry:driveCar.mot_expiry||null,
        score:driveCar.score
      }).eq('id',saved.dbid).eq('user_id',currentUser.id);
    }
    render();
  }catch(e){
    console.warn('Garage live refresh failed',e);
  }
}

function toggleDriveMenu(e,reg){e.stopPropagation();openMenuReg=openMenuReg===reg?null:reg;render()}
function removeFromDriveMenu(e,reg){e.stopPropagation();openMenuReg=null;removeFromDrive(reg)}

async function removeFromDrive(reg){
 if(!requireAccount())return;
 const target=cleanReg(reg);
 const v=myDrive.find(x=>cleanReg(x.reg)===target);
 if(!v)return;
 const hasPassport=passports.some(x=>cleanReg(x.reg)===target);
 const msg=hasPassport
   ? `Remove ${displayReg(target)} from Garage?\n\nIts CarFull Passport will stay active and its history will not be deleted.`
   : `Remove ${displayReg(target)} from Garage?`;
 if(!confirm(msg))return;

 // Remove by database ID wherever possible. Registration formatting can contain spaces.
 let q=sb.from('garage_vehicles').delete().eq('user_id',currentUser.id);
 q=v.dbid?q.eq('id',v.dbid):q.eq('registration',target);
 const {error}=await q;
 if(error)return alert('Could not remove car: '+error.message);

 myDrive=myDrive.filter(x=>cleanReg(x.reg)!==target);
 invalidateCache('garage');
 await loadGarage(true);
 await trackEvent('garage_vehicle_removed',{registration:target});
 driveCar=null;
 go('drive');
}
function vehicle(){
 if(currentUser && !garagePhotoLoading)setTimeout(loadGaragePhotos,0);
 if(currentUser && !carFollowDataLoading && !storyInteractionsLoaded)setTimeout(ensureCarFollowData,0);
 let v=driveCar||myDrive[0]||null;
 if(!v)return wrap(`${title('Vehicle Details')}<section class="card empty"><b>No vehicle selected</b></section>`,'drive');
 let hasPassport=passports.some(p=>cleanReg(p.reg)===cleanReg(v.reg));
 const tests=Array.isArray(v.motTests)?v.motTests.slice(0,5):[];
 const sd=v.scoreDetail||calculateCarFullScore(v);

 return wrap(`${title(v.reg)}
 <section class="card cleanGarageVehicle">
   ${garagePhotoUrls[cleanReg(v.reg)]?`<div class="garagePhotoWrap"><img src="${garagePhotoUrls[cleanReg(v.reg)]}" alt="${cfTitleCase(v.make)} ${v.model||''}"></div>`:''}
   <div>
     <div class="reg">${v.reg}</div>
     <span class="vehicleName">${cfTitleCase(v.make)} ${v.model||''}</span>
     <div class="muted">${[v.year,cfTitleCase(v.fuel_type),cfTitleCase(v.colour)].filter(Boolean).join(' • ')}</div>
     <div class="garageSocialMeta">${garageFollowerHtml(v)}</div>
     <div class="pill">Saved to My Garage</div>
     <button class="btn secondary compactBtn" style="margin-top:9px" onclick="${hasPassport?"openGarageHistory('${v.reg}')":"createPassportByReg('"+v.reg+"')"}">${hasPassport?'Open History':'Start Car History'}</button>
   </div>
   <div class="score" onclick="event.stopPropagation();openScoreByReg(\'${v.reg}\')"><div><b>${Number.isFinite(Number(v.score))?v.score:'—'}</b><small>/100</small></div></div>
 </section>
 <section class="card">
   <b>CarFull Score</b>
   <div class="valueLine"><span>${sd.label}</span><b>${sd.score} / 100</b></div>
   <p class="muted">Calculated only from this car's DVSA MOT and mileage history.</p>
   <button class="btn secondary" onclick="openScoreByReg(\'${v.reg}\')">Why this score?</button>
 </section>
 <section class="card">
   <b>Latest MOT history</b>
   ${tests.length?tests.map(t=>`<div class="motRow"><b>${cfDate(String(t.completedDate||'').slice(0,10))||'Date unavailable'} — <span class="${String(t.testResult||'').toUpperCase()==='PASSED'?'pass':'fail'}">${t.testResult||'RESULT'}</span></b><div class="muted">${cfMileage(t.odometerValue,t.odometerUnit)}${t.expiryDate?' • Expires '+cfDate(t.expiryDate):''}</div></div>`).join(''):'<p class="muted">Open this car while online to refresh its live DVSA MOT history.</p>'}
 </section>
 ${hasPassport
   ? `<section class="card"><div class="passportBadge">✓ Car History active</div><p class="muted">Car History is separate and never changes the CarFull Score.</p><button class="btn secondary" onclick="openGarageHistory('${v.reg}')">View Car History</button></section>`
   : `<button class="btn secondary" onclick="createPassportByReg('${v.reg}')">Start this car’s history</button>`
 }
 <button class="dangerBtn" style="margin-top:14px" onclick="removeFromDrive('${v.reg}')">Remove from Garage</button>
 <p class="notice">This only removes the registration from Garage. Any Car History is kept.</p>
 `,'drive')
}


function cfTitleCase(value){
  const s=String(value||'').trim();
  if(!s)return '';
  if(/[a-z]/.test(s))return s;
  return s.toLowerCase().replace(/\b([a-z])/g,m=>m.toUpperCase());
}
function cfDate(value){
  if(!value)return '';
  const d=new Date(value+'T00:00:00');
  if(Number.isNaN(d.getTime()))return value;
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
function cfMileage(value,unit){
  const n=Number(value);
  if(!Number.isFinite(n))return '—';
  const u=String(unit||'').toLowerCase();
  return `${n.toLocaleString('en-GB')} ${u==='mi'||u==='miles'?'miles':(unit||'')}`.trim();
}

function vehicleResult(){
 let v=checkedCar;
 if(!v)return wrap(`${title('Vehicle Details')}<section class="card empty"><b>No vehicle selected</b><p class="muted">Search a UK registration first.</p></section>`,'home');
 const mot=v.motTests?.[0]||{};
 const motValid=(mot.testResult||'').toUpperCase()==='PASSED' || !!mot.expiryDate;
 return wrap(`${title('Vehicle Details')}
 <section class="card liveVehicleHero"><div class="vehicleIdentity"><div class="reg">${v.reg}</div><span class="vehicleName">${cfTitleCase(v.make)} ${v.model||''}</span><div class="muted vehicleMeta">${[v.year,cfTitleCase(v.fuel_type),cfTitleCase(v.colour)].filter(Boolean).join(' • ')}</div></div><div class="score" onclick="openScoreByReg(\'${v.reg}\')"><div><b>${v.score}</b><small>/100</small></div></div></section>
 <div class="heroStatus">
   <div class="box"><small>MOT STATUS</small><b class="${motValid?'pass':'fail'}">${motValid?'✓ Valid':'Check history'}</b><div class="muted">${mot.expiryDate?'Until '+cfDate(mot.expiryDate):'See MOT records'}</div></div>
   <div class="box"><small>DATA SOURCE</small><b class="pass">DVSA</b><div class="muted">Official MOT history</div></div>
 </div>
 <div class="specStrip">
   <div><small>YEAR</small><b>${v.year||'—'}</b></div>
   <div><small>FUEL</small><b>${cfTitleCase(v.fuel_type)||'—'}</b></div>
   <div><small>ENGINE</small><b>${v.engine_size||'—'}</b></div>
   <div><small>COLOUR</small><b>${cfTitleCase(v.colour)||'—'}</b></div>
 </div>
 <section class="card glanceCard"><strong>At a glance</strong>
   <div class="valueLine"><span>Latest recorded mileage</span><b>${cfMileage(v.mileage,v.mileage_unit)}</b></div>
   <div class="valueLine"><span>MOT tests found</span><b>${v.motTests?.length||0}</b></div>
   <div class="valueLine"><span>Outstanding recall</span><b>${v.recall&&String(v.recall).toLowerCase()!=='unknown'?v.recall:'Not supplied'}</b></div>
 </section>
 <section class="card fullCheckHero">
   <div class="passportBadge">CARFULL FULL CHECK</div>
   <h2 style="margin:8px 0">Want the full story?</h2>
   <p class="muted">Check finance, stolen status, insurance write-off, mileage and other available provenance data before you buy.</p>
   <div class="valueLine"><span>Full CarFull Check</span><b>${currentFullCheckPrice()}</b></div>
   ${isPremium()?'<div class="muted" style="margin-top:5px">CarFull Pro Price • You save £2</div>':'<div class="muted" style="margin-top:5px">CarFull Pro members pay £7.99</div>'}
   <button class="btn" style="margin-top:12px" onclick="buyFullCheck('${cleanReg(v.reg)}')">Get Full Check — ${currentFullCheckPrice()}</button>
   <p class="muted" style="margin-top:10px">${isNativeIOSBuild()?'Payment is handled securely by Apple.':'Secure checkout by Stripe.'}</p>
 </section>
 <div class="actionStack"><button class="btn secondary" onclick="addCheckedToDrive()">+ Add to Garage</button></div>
 <section class="card"><b>Vehicle history</b><p class="muted">View the MOT records returned for this registration.</p><button class="btn secondary" onclick="checkTab='mot';go('result')">View MOT history</button></section>`,'home')
}

function startBuyingCheck(){checkTab='summary';go('result')}

function check(){return wrap(`${title('CarFull Check')}<section class="card"><h3>Thinking of buying a car?</h3><p class="muted">Check any registration without adding it to My Drive.</p><input id="c" class="input" placeholder=""><button class="btn" onclick="runCheck()">Check this car</button></section>`,'check')}
async function runCheck(){
 let r=document.getElementById('c')?.value.trim();
 if(!r)return;
 await performVehicleLookup(r,'result');
}

function motStatusMeta(t){
  const result=String(t?.testResult||'').toUpperCase();
  const defects=Array.isArray(t?.defects)?t.defects:[];
  const serious=defects.filter(d=>['MAJOR','DANGEROUS'].includes(String(d.type||'').toUpperCase())).length;
  const advisories=defects.filter(d=>String(d.type||'').toUpperCase().includes('ADVIS')).length;
  if(result!=='PASSED')return {cls:'motFail',label:'FAIL',note:serious?`${serious} major/dangerous defect${serious===1?'':'s'}`:'Test failed'};
  if(advisories)return {cls:'motAdvisory',label:'PASS + ADVISORY',note:`${advisories} advisory${advisories===1?'':'ies'}`};
  return {cls:'motPass',label:'PASS',note:'No advisories recorded'};
}
function motKey(t,i){
  return `${String(t.completedDate||'')}-${String(t.odometerValue||'')}-${i}`;
}
function toggleMotCard(key,el){
  if(!el)return;
  const details=el.querySelector('.sleekMotDetails');
  if(!details)return;

  const open=details.hidden;
  details.hidden=!open;
  el.classList.toggle('motOpen',open);

  const arrow=el.querySelector('.motArrow');
  if(arrow)arrow.textContent=open?'▲':'▼';
}
function motCardMeta(t){
  const result=String(t.testResult||'').toUpperCase();
  const defects=Array.isArray(t.defects)?t.defects:[];
  const serious=defects.filter(d=>['MAJOR','DANGEROUS'].includes(String(d.type||'').toUpperCase()));
  const advisory=defects.filter(d=>{
    const x=String(d.type||'').toUpperCase();
    return x.includes('ADVIS')||x==='MINOR';
  });

  if(result==='FAILED'){
    return {
      cls:'motFail',
      label:'FAIL',
      note: serious.length?`${serious.length} major/dangerous defect${serious.length===1?'':'s'}`:`${defects.length||1} defect${defects.length===1?'':'s'}`,
      details:defects
    };
  }
  if(advisory.length){
    return {
      cls:'motAdvisory',
      label:'PASS + ADVISORY',
      note:`${advisory.length} advisor${advisory.length===1?'y':'ies'}`,
      details:advisory
    };
  }
  return {cls:'motPass',label:'PASS',note:'',details:[]};
}
function motHistoryTimeline(v){
  const tests=Array.isArray(v?.motTests)?v.motTests:[];
  if(!tests.length)return `<section class="card"><b>MOT & mileage history</b><p class="muted">No MOT tests were returned by DVSA.</p></section>`;

  return `<section class="card sleekMotSection">
    <div class="sleekMotHeader">
      <div>
        <h3 style="margin:0">MOT & mileage history</h3>
        <p class="muted" style="margin:6px 0 0">Full DVSA timeline • tap advisories and fails for details.</p>
      </div>
      <span class="muted">${tests.length} tests</span>
    </div>

    <div class="sleekMotList">
      ${tests.map((t,i)=>{
        const m=motCardMeta(t);
        const key=motKey(t,i);
        const canOpen=m.details.length>0;
                return `<div class="sleekMotCard ${m.cls} ${canOpen?'motExpandable':''}" data-mot-key="${key.replace(/"/g,'&quot;')}" ${canOpen?`onclick="toggleMotCard('${key.replace(/'/g,"\\'")}',this)"`:''}>
          <div class="sleekMotTop">
            <b>${m.label}</b>
            <span>${cfDate(String(t.completedDate||'').slice(0,10))||'Date unavailable'}</span>
          </div>
          <strong>${cfMileage(t.odometerValue,t.odometerUnit)}</strong>
          ${m.note?`<small>${m.note}${canOpen?` <span class="motArrow">▼</span>`:''}</small>`:''}
          ${canOpen?`<div class="sleekMotDetails" hidden>
            ${m.details.map(d=>{
              const sev=String(d.type||'ADVISORY').toUpperCase();
              return `<div class="sleekMotDetail ${['MAJOR','DANGEROUS'].includes(sev)?'serious':''}">
                <b>${sev}</b>
                <span>${d.text||'DVSA item recorded'}</span>
              </div>`;
            }).join('')}
          </div>`:''}
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function sellerQuestions(v){
  const advisories=(v.motTests||[]).flatMap(t=>(t.defects||[]).filter(d=>defectSeverity(d.type)>=1)).slice(0,3);
  return `<section class="card"><h3 style="margin-top:0">Ask the seller</h3><p class="muted">Useful questions based on this car's DVSA history.</p>
    ${advisories.length?advisories.map((d,i)=>`<div class="question"><b class="warn">${i+1}. Was this MOT item dealt with?</b><span class="muted">${d.text||'Previous MOT defect/advisory'}</span></div>`).join(''):`<div class="question"><b>1. Can you show me the service history?</b><span class="muted">DVSA MOT data does not prove routine servicing.</span></div>`}
    <div class="question"><b>${advisories.length+1}. Is there supporting maintenance evidence?</b><span class="muted">Receipts and maintenance records help confirm work outside the MOT history.</span></div>
  </section>`;
}
function result(){
 let v=checkedCar;
 if(!v)return wrap(`${title('CarFull Check')}<section class="card empty"><b>No vehicle selected</b><p class="muted">Run a registration check first.</p></section>`,'check');

 const latest=v.motTests?.[0]||{};
 const latestPassed=String(latest.testResult||'').toUpperCase()==='PASSED';

 return wrap(`${title('CarFull Check')}
 ${vc(v)}
 <div class="statusGrid">
   <div class="statusTile"><small>MOT STATUS</small><b class="${latestPassed?'pass':'fail'}">${latestPassed?'Valid':'Check MOT'}</b><div class="muted">${latest.expiryDate?'Until '+cfDate(latest.expiryDate):'Latest DVSA record'}</div></div>
   <div class="statusTile"><small>LATEST MILEAGE</small><b>${cfMileage(v.mileage,v.mileage_unit)}</b><div class="muted">DVSA recorded</div></div>
 </div>
 
 <section class="card fullCheckHero">
   <div class="passportBadge">CARFULL FULL CHECK</div>
   <h2 style="margin:8px 0">Want the full story?</h2>
   <p class="muted">Check finance, stolen status, insurance write-off, mileage and other available provenance data before you buy.</p>
   <div class="valueLine"><span>Full CarFull Check</span><b>${currentFullCheckPrice()}</b></div>
   ${isPremium()?'<div class="muted" style="margin-top:5px">CarFull Pro Price • You save £2</div>':'<div class="muted" style="margin-top:5px">CarFull Pro members pay £7.99</div>'}
   <button class="btn" style="margin-top:12px" onclick="buyFullCheck('${cleanReg(v.reg)}')">Get Full Check — ${currentFullCheckPrice()}</button>
   <p class="muted" style="margin-top:10px">${isNativeIOSBuild()?'Payment is handled securely by Apple.':'Secure checkout by Stripe.'}</p>
 </section>
 ${motHistoryTimeline(v)}
 ${sellerQuestions(v)}
 <button class="btn secondary" onclick="addCheckedToDrive()">Add to Garage</button>`,'check')
}

function passport(){return wrap(`${title('Car History')}
<div class="muted" style="text-align:center;margin:-4px 0 14px">The life of each car.</div>
<section class="card">
  <h2 style="margin-top:0">Your Car Histories</h2>
  <p class="muted">Real vehicle histories saved to your CarFull account. Raw receipts and personal owner evidence stay private by default.</p>
</section>
<section class="card passportFound">
  <div class="passportBadge">CARFULL HISTORY</div>
  <h3>Permanent history for the cars that matter.</h3>
  <div class="pill">${passports.length} of ${passportLimit()} ${isPremium()?'CarFull Pro':'free'} car histor${passportLimit()===1?'y':'ies'} active</div>
  <div class="sectionTitle"><span>Your Car Histories</span><span class="count">${passports.length}/${passportLimit()}</span></div>
  ${passports.length
    ? passports.map(pp => `<section class="card" style="cursor:pointer" onclick="activePassportId='${pp.id}';go('passportDetail')">
        <div class="reg">${pp.reg}</div>
        <b>${pp.make} ${pp.model}</b>
        <div class="muted">${pp.year || ''} • ${(passportRecords[pp.id] || []).filter(r=>String(r.record_type||'').toLowerCase()!=='story').length} history record${(passportRecords[pp.id] || []).filter(r=>String(r.record_type||'').toLowerCase()!=='story').length===1?'':'s'}</div>
      </section>`).join('')
    : '<section class="card empty"><b>No car histories yet</b><p class="muted">Choose a car from My Garage when you are ready.</p></section>'}
  <button class="btn" style="margin-top:14px" onclick="${passports.length>=passportLimit()?"go('passportUpgrade')":"go('drive')"}">+ Add Car History</button>
</section>`,'passport')}
function activate(){go('drive')}
function activateForDrive(reg){return createPassportByReg(reg)}

async function setPassportVisibility(passportId,makePublic){
  if(!sb||!currentUser)return requireAccount('Sign in to change History privacy.');
  const pp=passports.find(x=>String(x.id)===String(passportId));
  if(!pp)return alert('Passport not found.');
  const restore=setBusy(currentActionButton(),makePublic?'Making viewable…':'Making private…');
  try{
    const {error}=await sb
      .from('passports')
      .update({is_public:!!makePublic})
      .eq('id',passportId)
      .eq('current_keeper_id',currentUser.id);
    if(error)throw error;
    pp.is_public=!!makePublic;
    invalidateCache('passports');
    await loadPassports(true);
    activePassportId=passportId;
    await trackEvent('passport_visibility_changed',{passport_id:passportId,is_public:!!makePublic});
    render();
  }catch(err){
    alert('Could not change History privacy: '+(err.message||err));
  }finally{restore()}
}

function passportDetail(){
  const pp = currentPassport();
  if(!pp) return passport();
  activePassportId = pp.id;
  const records = passportRecords[pp.id] || [];
  const historyRecords = records.filter(r=>String(r.record_type||'').toLowerCase()!=='story');
  const storyRecords = records.filter(r=>String(r.record_type||'').toLowerCase()==='story');

  return wrap(`${title('Car History')}
  <section class="card">
    <div class="passportBadge">CARFULL HISTORY</div>
    <div class="reg">${pp.reg}</div>
    <h2>${pp.make} ${pp.model}</h2>
    <div class="muted">${pp.year || ''}</div>
  </section>
  <section class="card">
    <b>Permanent vehicle history</b>
    <div class="valueLine"><span>History records</span><b>${historyRecords.length}</b></div>
    <div class="valueLine"><span>Stories</span><b>${storyRecords.length}</b></div>
    <div class="valueLine"><span>Evidence privacy</span><b class="pass">Private by default</b></div>
  </section>
  <section class="card passportVisibilityCard">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px">
      <div style="flex:1">
        <b>History visibility</b>
        <div style="font-size:20px;font-weight:900;margin-top:7px">${pp.is_public?'Viewable':'Private'}</div>
        <p class="muted" style="margin:7px 0 0">${pp.is_public
          ? 'CarFull Pro members can view this car’s shared history. Your receipts, uploaded evidence and personal details stay private.'
          : 'Only you can view this car history. Stories you choose to share can still appear in Stories.'}</p>
      </div>
      <label style="position:relative;display:inline-block;width:58px;height:34px;flex:0 0 auto;margin-top:2px">
        <input aria-label="History visibility" type="checkbox" ${pp.is_public?'checked':''}
          onchange="setPassportVisibility('${pp.id}',this.checked)"
          style="opacity:0;width:0;height:0">
        <span style="position:absolute;cursor:pointer;inset:0;background:${pp.is_public?'#69d84f':'#2b312e'};border:1px solid ${pp.is_public?'#69d84f':'#46504b'};border-radius:999px;transition:.2s"></span>
        <span style="position:absolute;top:4px;left:${pp.is_public?'28px':'4px'};width:26px;height:26px;background:white;border-radius:50%;transition:.2s;pointer-events:none"></span>
      </label>
    </div>
  </section>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 18px">
    <button class="btn" style="margin:0" onclick="go('addMaintenance')">+ Add history record</button>
    <button class="btn secondary" style="margin:0" onclick="go('addCarStory')">+ Add story</button>
  </div>
  <p class="muted" style="text-align:center;margin:-4px 8px 20px">History is for maintenance and repairs. Stories are the photos, memories and moments from this car’s life.</p>
  <div class="sectionTitle"><span>History timeline</span><span>${historyRecords.length}</span></div>
  ${historyRecords.length
    ? historyRecords.map(r => `<section class="card">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="font-size:28px">${passportRecordIcon(r.record_type)}</div>
          <div style="flex:1">
            <b>${r.title}</b>
            <div class="muted">${[r.record_type,r.record_date,r.mileage?Number(r.mileage).toLocaleString()+' miles':''].filter(Boolean).join(' • ')}</div>
            ${r.provider?`<div class="muted">${r.provider}</div>`:''}
            ${r.description?`<p>${r.description}</p>`:''}
            ${r.cost!==null&&r.cost!==undefined?`<div class="valueLine"><span>Recorded cost</span><b>£${Number(r.cost).toFixed(2)}</b></div>`:''}
            ${evidenceForRecord(r.id).length?evidenceForRecord(r.id).map(ev=>`<div class="valueLine" style="margin-top:8px"><span>${String(r.record_type||'').toLowerCase()==='story'?'📷 Story photo':(ev.evidence_type==='service_stamp'?'📘 Service stamp':'📄 Evidence')}</span><b>${evidenceLabel(ev)}</b></div><button class="btn secondary compactBtn" onclick="viewEvidence('${ev.id}')">${String(r.record_type||'').toLowerCase()==='story'?'View photo':'View evidence'}</button>`).join(''):''}<button class="btn secondary compactBtn" onclick="evidenceRecordId='${r.id}';pendingEvidenceFile=null;pendingEvidenceType='invoice';go('evidenceUpload')">+ Add evidence</button><button class="btn secondary compactBtn" onclick="deletePassportRecord('${r.id}')">Delete record</button>
          </div>
        </div>
      </section>`).join('')
    : '<section class="card empty"><b>No history records yet</b><p class="muted">Add a service, repair, cambelt, brakes, tyres or another event from this car’s life.</p></section>'}
  <div class="sectionTitle"><span>Car Stories</span><span>${storyRecords.length}</span></div>
  ${storyRecords.length?storyRecords.map(r=>`<section class="card"><b>${r.title}</b><div class="muted">${r.record_date||''} • ${r.provider==='Community'?'Community':'Private'}</div>${r.description?`<p>${r.description}</p>`:''}${evidenceForRecord(r.id).length?`<button class="btn secondary compactBtn" onclick="viewEvidence('${evidenceForRecord(r.id)[0].id}')">View photo</button>`:''}</section>`).join(''):'<section class="card empty"><b>No Stories yet</b><p class="muted">Photos and memories you add to this car will appear here.</p></section>'}
  <section class="card">
    <b>History privacy</b>
    <p class="muted">Structured vehicle history can later follow the car. Raw receipts and personal owner information will not automatically transfer.</p>
  </section>`,'passport')
}
function addMaintenance(){
  const pp = currentPassport();
  if(!pp) return passport();
  pendingHistoryEvidenceFile=null;
  pendingHistoryEvidenceType='invoice';

  return wrap(`${title('Add History Record')}
  <section class="card">
    <div class="passportBadge">CARFULL HISTORY</div>
    <div class="reg">${pp.reg}</div>
    <b>${pp.make} ${pp.model}</b>
  </section>
  <section class="card">
    <label>TYPE</label>
    <select id="recordType" class="input">
      <option>Service</option>
      <option>Repair</option>
      <option>Cambelt / timing belt</option>
      <option>Brakes</option>
      <option>Tyres</option>
      <option>MOT related</option>
      <option>Modification</option>
      <option>Maintenance</option>
      <option>Other</option>
    </select>
    <label>DATE</label><input id="recordDate" class="input" type="date">
    <label>MILEAGE</label><input id="recordMileage" class="input" type="number" inputmode="numeric" placeholder="e.g. 72413">
    <label>TITLE</label><input id="recordTitle" class="input" placeholder="e.g. Full service and cambelt">
    <label>DESCRIPTION</label><textarea id="recordDescription" class="input" rows="4" placeholder="What work was carried out?"></textarea>
    <label>GARAGE / PROVIDER</label><input id="recordProvider" class="input" placeholder="Optional">
    <label>COST</label><input id="recordCost" class="input" type="number" inputmode="decimal" step="0.01" placeholder="Optional">

    <div class="historyEvidenceBox">
      <label>PRIVATE PHOTO / DOCUMENT</label>
      <p class="muted" style="margin:5px 0 10px">Add a receipt, invoice, service-book stamp or photo. Other users can see the history entry, but never this uploaded image.</p>
      <select class="input" onchange="pendingHistoryEvidenceType=this.value">
        <option value="invoice">Invoice / receipt</option>
        <option value="service_stamp">Service-book stamp</option>
        <option value="other">Other photo</option>
      </select>
      <input id="historyEvidencePicker" type="file" accept="image/*" capture="environment" style="display:none" onchange="selectHistoryEvidence(this)">
      <button class="btn secondary" type="button" onclick="document.getElementById('historyEvidencePicker').click()">＋ Add photo / document</button>
      <div id="historyEvidenceName" class="muted" style="margin-top:9px">No photo or document selected.</div>
    </div>

    <p class="muted">The service/repair details become part of the car’s visible history when you share it. Uploaded evidence stays private to you.</p>
    <button class="btn" onclick="savePassportRecord()">Save to Car History</button>
  </section>`,'passport')
}

function scanServiceStamp(){return wrap(`${title('Service book stamp')}
<section class="card"><span class="aiBadge">SERVICE BOOK EVIDENCE</span><h3>Check the details</h3><p class="muted">CarFull will use the photographed stamp to help prepare this service record.</p>
<div class="extractRow"><span>Date</span><b>18 June 2021</b></div>
<div class="extractRow"><span>Mileage</span><b>48,214 miles</b></div>
<div class="extractRow"><span>Service type</span><b>Full service</b></div>
<div class="extractRow"><span>Garage</span><b>Dealer / garage stamp</b></div>
<div class="extractRow"><span>Evidence</span><b>Service book stamp ✓</b></div>
<button class="btn" style="margin-top:16px" onclick="confirmMaintenance()">Looks right — add to Passport</button>
<button class="btn secondary" style="margin-top:10px" onclick="alert('In the real app you can correct the date, mileage, service type or garage before saving.')">Edit details</button>
</section>`,'passport')}

function scanInvoice(){return wrap(`${title('Invoice found')}
<section class="card"><span class="aiBadge">CARFULL READ THIS</span><h3>Check the details</h3><p class="muted">We found the following information on your invoice.</p>
<div class="extractRow"><span>Date</span><b>12 May 2025</b></div>
<div class="extractRow"><span>Mileage</span><b>64,218 miles</b></div>
<div class="extractRow"><span>Garage</span><b>ABC Garage</b></div>
<div class="extractRow"><span>Work</span><b>Full service<br>Front brake pads</b></div>
<div class="extractRow"><span>Evidence</span><b>Original invoice ✓</b></div>
<button class="btn" style="margin-top:16px" onclick="confirmMaintenance()">Looks right — add to Passport</button>
<button class="btn secondary" style="margin-top:10px" onclick="alert('In the real app you can correct anything CarFull reads incorrectly.')">Edit details</button></section>`,'passport')}

function confirmMaintenance(){alert('Service / maintenance record added to the Passport ✓');go('passportDetail')}



function addCarStory(){const pp=currentPassport(); return wrap(`${title('Add Car Story')}
<section class="card"><div class="passportBadge">CARFULL STORY</div>${pp?`<div class="reg">${pp.reg}</div><b>${pp.make} ${pp.model}</b>`:''}<h2>Add to this car's story</h2><p class="muted">Add a photo, memory, road trip, show, collection day or another moment from this car's life.</p>
<label class="label">STORY</label><textarea id="storyText" class="input" style="min-height:110px;text-align:center" placeholder="What happened with the car?"></textarea>
<label class="label" style="margin-top:16px">PHOTO</label><input id="storyPicker" type="file" accept="image/*" style="display:none" onchange="selectStoryFile(this)"><button class="btn secondary" onclick="document.getElementById('storyPicker').click()">Choose photo</button>
${pendingStoryFile?`<div class="codeStatus" style="margin-top:10px"><b>Photo selected ✓</b><div class="muted">${pendingStoryFile.name||'Photo ready'}</div></div>`:''}
<h3 style="margin-top:22px">Who can see this?</h3>
<div class="privacyGrid">
<div class="privacyChoice ${pendingStoryPrivacy==='Private'?'selected':''}" onclick="selectStoryPrivacy(this,'Private')"><b>Private</b><small>Only you can see this story.</small></div>
<div class="privacyChoice ${pendingStoryPrivacy==='Community'?'selected':''}" onclick="selectStoryPrivacy(this,'Community')"><b>Community</b><small>Share this Story to the CarFull Stories feed. Personal details are never shared.</small></div>
</div>
<button class="btn" style="margin-top:18px" onclick="saveCarStory()">Add to Car Story</button></section>`,'passport')}
function selectStoryFile(input){pendingStoryFile=input?.files?.[0]||null;render()}
function selectStoryPrivacy(el,value){pendingStoryPrivacy=value;document.querySelectorAll('.privacyChoice').forEach(x=>x.classList.remove('selected'));el.classList.add('selected')}
async function saveCarStory(){
 const pp=currentPassport();const t=document.getElementById('storyText');const text=(t?.value||'').trim();if(!pp)return alert('Passport not selected.');if(!text)return alert('Add your story first.');
 if(pendingStoryPrivacy==='Community' && !(await ensureCommunityUsername()))return;
 const restore=setBusy(currentActionButton(),'Saving…');
 try{
   const title=text.length>54?text.slice(0,51)+'…':text;
   const {data:rec,error}=await sb.from('passport_records').insert({passport_id:pp.id,user_id:currentUser.id,record_type:'Story',record_date:new Date().toISOString().slice(0,10),title,description:text,provider:pendingStoryPrivacy}).select('id').single();
   if(error)throw error;
   if(pendingStoryFile){
     const blob=await compressEvidenceImage(pendingStoryFile);const path=`${currentUser.id}/${pp.id}/${rec.id}/story-${Date.now()}.jpg`;
     const {error:uploadError}=await sb.storage.from('passport-evidence').upload(path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:'3600'});if(uploadError)throw uploadError;
     const {error:metaError}=await sb.from('passport_evidence').insert({passport_id:pp.id,record_id:rec.id,user_id:currentUser.id,evidence_type:'other',object_path:path,verification_status:'owner_uploaded'});
     if(metaError){
       try{await sb.storage.from('passport-evidence').remove([path])}catch(e){}
       try{await sb.from('passport_records').delete().eq('id',rec.id).eq('user_id',currentUser.id)}catch(e){}
       throw metaError;
     }
   }
   const keep=pp.id;const publishedToCommunity=pendingStoryPrivacy==='Community';pendingStoryFile=null;pendingStoryPrivacy='Private';invalidateCache('passports','evidence');await loadPassports(true);await loadPassportEvidence(true);activePassportId=keep;go(publishedToCommunity?'stories':'passportDetail');
 }catch(err){alert('Could not save Car Story: '+(err.message||err))}finally{restore()}
}

function storyPrivacy(){return wrap(`${title('Car Story privacy')}<section class="card"><h2>Who can see this story?</h2><p class="muted">Choose the visibility for this Car Story post. Personal details are never shared with other members.</p><div class="privacyGrid"><div class="privacyChoice selected" onclick="selectPrivacy(this)"><b>Private</b><small>Only you can see this story.</small></div><div class="privacyChoice" onclick="selectPrivacy(this)"><b>Passport</b><small>Visible to members viewing this car's history.</small></div></div><button class="btn" style="margin-top:16px" onclick="alert('Car Story privacy saved ✓');go('passportDetail')">Save privacy</button></section><p class="notice">Keeper names, addresses, phone numbers, email addresses and other personal details are never shown to history viewers.</p>`,'passport')}
function selectPrivacy(el){document.querySelectorAll('.privacyChoice').forEach(x=>x.classList.remove('selected'));el.classList.add('selected')}

function viewPassport(){
  if(isPremium()){
    return wrap(`${title('Car History')}
    <section class="card">
      <div class="liveBadge">CARFULL PRO ACCESS ✓</div>
      <h2>Vauxhall VX220</h2>
      <p class="muted">14 history records • Service evidence available • Transferable vehicle history</p>
      <div class="valueLine"><span>CarFull Pro access</span><b class="pass">Included ✓</b></div>
      <p class="muted">The full public Passport data backend will be connected as Passport development continues.</p>
      <button class="btn secondary" onclick="go('stories')">Back to Stories</button>
    </section>`,'passport');
  }
  return wrap(`${title('Car History')}
  <section class="card"><h2>Vauxhall VX220</h2><p class="muted">14 history records • Service evidence available • Transferable vehicle history</p></section>
  <section class="card premiumCard">
    <div class="upgradeIcon">🔒</div>
    <h2>View this car history with CarFull Pro</h2>
    <p class="muted">Your own car history is always free to view. Viewing other vehicles' histories is included with CarFull Pro.</p>
    <div class="premiumPrice">£9.99 <span class="muted" style="font-size:14px;font-weight:700">/ year</span></div>
    <button class="btn" onclick="go('premium')">Unlock with CarFull Pro</button>
  </section>`,'passport');
}

function toggleLike(btn){let liked=btn.classList.toggle('liked');btn.innerHTML=liked?'❤️ <span>Liked</span>':'♡ <span>Like</span>'}
function communityStoryCards(){
  const rows=[];
  for(const pp of passports||[]){
    for(const r of (passportRecords[pp.id]||[])){
      if(String(r.record_type||'').toLowerCase()==='story' && String(r.provider||'').toLowerCase()==='community'){
        const ev=evidenceForRecord(r.id)[0];
        rows.push({pp,r,ev});
      }
    }
  }
  rows.sort((a,b)=>String(b.r.created_at||b.r.record_date||'').localeCompare(String(a.r.created_at||a.r.record_date||'')));
  return rows.map(({pp,r,ev})=>`<section class="card storyCard">
    <div class="storyMeta">${r.record_date||''}</div>
    <h3>${pp.make} ${pp.model}</h3>
    <div class="muted">${pp.reg}${pp.year?' • '+pp.year:''}</div>
    <p>${r.description||r.title||''}</p>
    <div class="storyActions">
      ${ev?`<button class="btn secondary compactBtn" onclick="viewEvidence('${ev.id}')">View photo</button>`:''}
      <button class="btn secondary compactBtn" onclick="openStoryCar('${pp.id}')">More from this car</button>
    </div>
  </section>`).join('');
}

const storyPhotoUrls={};

const storyInteractionState={};
let communityProfileLoaded=false,storyOwnerProfilesLoaded=false,storyInteractionsLoaded=false;

let globalCommunityStoryRows=[];
let globalCommunityStoriesLoaded=false;
let globalCommunityStoriesLoading=false;
let globalCommunityStoriesError='';
let activeStoryCarPassportId=null;
let publicPassportData=null;
let publicPassportRecords=[];

let communityProfile=null;
const storyOwnerProfiles={};

function normaliseUsername(value){
  return String(value||'').trim().replace(/[^A-Za-z0-9_]/g,'').slice(0,20);
}
function usernameInitial(name){
  const n=normaliseUsername(name)||'C';
  return n.charAt(0).toUpperCase();
}
function profileForUserId(userId){
  if(currentUser && String(userId||'')===String(currentUser.id||'') && communityProfile)return communityProfile;
  return storyOwnerProfiles[userId]||{username:'CarFullUser'};
}

async function loadCommunityProfile(){
  communityProfileLoaded=true;
  communityProfile=null;
  if(!sb||!currentUser)return;
  try{
    const {data,error}=await sb
      .from('community_profiles')
      .select('user_id,username')
      .eq('user_id',currentUser.id)
      .maybeSingle();
    if(error){console.warn('Community profile load failed',error);return}
    if(data?.username)communityProfile=data;
  }catch(e){console.warn('Community profile load failed',e)}
}

async function ensureCommunityUsername(){
  if(!currentUser)return false;
  if(communityProfile?.username)return true;
  screen='communityUsername';
  render();
  return false;
}

async function saveCommunityUsername(){
  if(!currentUser)return go('account');
  const input=document.getElementById('communityUsernameInput');
  const username=normaliseUsername(input?.value);
  if(username.length<3)return alert('Choose a username with at least 3 letters or numbers.');

  try{
    const payload={user_id:currentUser.id,username};
    const {data,error}=await sb
      .from('community_profiles')
      .upsert(payload,{onConflict:'user_id'})
      .select('user_id,username')
      .single();

    if(error){
      const msg=String(error.message||'');
      if(msg.toLowerCase().includes('duplicate')||String(error.code||'')==='23505'){
        return alert('That username is already taken. Try another.');
      }
      return alert('Could not save username: '+msg);
    }

    communityProfile=data;
    go('stories');
  }catch(e){
    alert('Could not save username: '+(e.message||e));
  }
}

function communityUsername(){
  const current=communityProfile?.username||'';
  return wrap(`${title('Community username')}
    <section class="card" style="text-align:center">
      <div class="communityAvatar large">${usernameInitial(current||'C')}</div>
      <h2>Choose your public username</h2>
      <p class="muted">This is what other CarFull users will see on Stories and comments. Your email and real name stay private.</p>
      <input id="communityUsernameInput" class="input" maxlength="20" placeholder="e.g. WillT" value="${current}">
      <button class="btn" style="margin-top:12px" onclick="saveCommunityUsername()">Save username</button>
      <p class="subtle">3–20 letters, numbers or underscores.</p>
    </section>
  `,'account');
}

async function loadStoryOwnerProfiles(){
  storyOwnerProfilesLoaded=true;
  if(!sb)return;
  const rows=communityStoryRows();
  const storyUserIds=rows.map(x=>x.r.user_id).filter(Boolean);
  const commentUserIds=Object.values(storyInteractionState||{}).flatMap(x=>(x.comments||[]).map(c=>c.user_id)).filter(Boolean);
  const ids=[...new Set([...storyUserIds,...commentUserIds])];
  if(!ids.length)return;
  try{
    const {data,error}=await sb.from('community_profiles').select('user_id,username').in('user_id',ids);
    if(error){console.warn('Story profile load failed',error);return}
    for(const row of (data||[]))storyOwnerProfiles[row.user_id]=row;
  }catch(e){console.warn('Story profile load failed',e)}
}


async function loadStoryInteractions(){
  storyInteractionsLoaded=true;
  if(!sb||!currentUser)return;
  const rows=communityStoryRows();
  const ids=rows.map(x=>x.r.id).filter(Boolean);
  if(!ids.length)return;
  try{
    const [{data:likes,error:likeErr},{data:comments,error:commentErr}]=await Promise.all([
      sb.from('story_likes').select('story_id,user_id').in('story_id',ids),
      sb.from('story_comments').select('id,story_id,user_id,body,created_at').in('story_id',ids).order('created_at',{ascending:true})
    ]);
    if(!likeErr){
      for(const id of ids){
        const mine=(likes||[]).some(x=>String(x.story_id||'')===String(id||'')&&String(x.user_id||'')===String(currentUser.id||''));
        const count=(likes||[]).filter(x=>x.story_id===id).length;
        storyInteractionState[id]={...(storyInteractionState[id]||{}),liked:mine,likeCount:count};
      }
    }
    if(!commentErr){
      rebuildCarFollowState(comments||[]);
      for(const id of ids){
        const list=(comments||[]).filter(x=>x.story_id===id && !isFollowMarker(x.body));
        storyInteractionState[id]={...(storyInteractionState[id]||{}),comments:list,commentCount:list.length};
      }
      storyOwnerProfilesLoaded=false;
    }
  }catch(e){console.warn('Story interaction load failed',e)}
}

async function toggleStoryLike(storyId,btn){
  if(!currentUser)return go('account');
  const st=storyInteractionState[storyId]||{};
  try{
    if(st.liked){
      const {error}=await sb.from('story_likes').delete().eq('story_id',storyId).eq('user_id',currentUser.id);
      if(error)throw error;
      st.liked=false;st.likeCount=Math.max(0,(st.likeCount||1)-1);
    }else{
      const {error}=await sb.from('story_likes').insert({story_id:storyId,user_id:currentUser.id});
      if(error && String(error.code||'')!=='23505')throw error;
      st.liked=true;st.likeCount=(st.likeCount||0)+1;
    }
    storyInteractionState[storyId]=st;
    if(btn){
      btn.classList.toggle('active',!!st.liked);
      const n=btn.querySelector('.count');if(n)n.textContent=st.likeCount||0;
    }
  }catch(e){alert('Could not update like: '+(e.message||e))}
}

async function openStoryComments(storyId){
  if(!currentUser)return go('account');
  if(!isPremium()){go('premium');return}
  if(!(await ensureCommunityUsername()))return;
  const card=document.querySelector(`[data-story-id="${storyId}"]`);
  const pane=card?.querySelector('.storyCommentsPane');
  if(!pane)return;
  pane.hidden=!pane.hidden;
  if(!pane.hidden){
    const input=pane.querySelector('input');
    if(input)setTimeout(()=>input.focus(),50);
  }
}

async function submitStoryComment(storyId,el){
  if(!currentUser)return go('account');
  if(!(await ensureCommunityUsername()))return;
  if(!isPremium()){screen='premium';render();return;}
  const pane=el.closest('.storyCommentsPane');
  const input=pane?.querySelector('input');
  const text=(input?.value||'').trim();
  if(!text)return;
  try{
    const {data,error}=await sb.from('story_comments').insert({
      story_id:storyId,user_id:currentUser.id,body:text,created_at:new Date().toISOString()
    }).select('id,story_id,user_id,body,created_at').single();
    if(error)throw error;
    const st=storyInteractionState[storyId]||{};
    st.comments=[...(st.comments||[]),data];
    st.commentCount=st.comments.length;
    storyInteractionState[storyId]=st;
    input.value='';
    render();
  }catch(e){alert('Could not add comment: '+(e.message||e))}
}


async function cfModerationDeleteComment(storyId,commentId){
  if(!currentUser)return;
  const st=storyInteractionState[storyId]||{};
  const comment=(st.comments||[]).find(c=>String(c.id||'')===String(commentId||''));
  const story=communityStoryRows().find(x=>String(x.r.id||'')===String(storyId||''));
  const isOwnComment=!!(comment && String(comment.user_id||'')===String(currentUser.id||''));
  const isStoryOwner=!!(comment && story && String(story.r.user_id||'')===String(currentUser.id||''));
  if(!isOwnComment && !isStoryOwner){cfModerationToast('You cannot remove this comment.');return;}
  try{
    const {error}=await sb.from('story_comments').delete().eq('id',commentId);
    if(error)throw error;
    st.comments=(st.comments||[]).filter(c=>String(c.id||'')!==String(commentId||''));
    st.commentCount=st.comments.length;
    storyInteractionState[storyId]=st;
    cfModerationClose();
    render();
    setTimeout(()=>cfModerationToast(isOwnComment?'Comment deleted':'Comment removed from your Story'),40);
  }catch(e){cfModerationToast('Could not remove comment. Please try again.')}
}

function cfModerationClose(){document.getElementById('cfModerationOverlay')?.remove()}
function cfModerationEscape(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function cfModerationSheet(title,html){
  cfModerationClose();
  const ov=document.createElement('div');
  ov.id='cfModerationOverlay';ov.className='cfModOverlay';
  ov.innerHTML=`<div class="cfModSheet" role="dialog" aria-modal="true"><div class="cfModHandle"></div>${title?`<div class="cfModTitle">${cfModerationEscape(title)}</div>`:''}${html}</div>`;
  ov.addEventListener('click',e=>{if(e.target===ov)cfModerationClose()});
  document.body.appendChild(ov);
}
function cfModerationToast(message){
  document.querySelector('.cfModToast')?.remove();
  const t=document.createElement('div');t.className='cfModToast';t.textContent=message;document.body.appendChild(t);
  setTimeout(()=>t.remove(),2200);
}
function cfConfirmSheet(title,text,confirmLabel,onConfirm,danger=true){
  window.cfModerationConfirmAction=()=>{cfModerationClose();onConfirm?.()};
  cfModerationSheet(title,`<div class="cfModText">${cfModerationEscape(text)}</div><button class="cfModAction ${danger?'cfModActionDanger':'cfModActionGreen'}" onclick="window.cfModerationConfirmAction()">${cfModerationEscape(confirmLabel)}<span>›</span></button><button class="cfModAction cfModActionMuted" onclick="cfModerationClose()">Cancel</button>`);
}

async function deleteStoryComment(storyId,commentId,btn){
  if(!currentUser)return;
  const st=storyInteractionState[storyId]||{};
  const comment=(st.comments||[]).find(c=>String(c.id||'')===String(commentId||''));
  const story=communityStoryRows().find(x=>String(x.r.id||'')===String(storyId||''));
  const isOwnComment=!!(comment && String(comment.user_id||'')===String(currentUser.id||''));
  const isStoryOwner=!!(comment && story && String(story.r.user_id||'')===String(currentUser.id||''));
  if(!isOwnComment && !isStoryOwner){cfModerationToast('You cannot remove this comment.');return;}
  cfConfirmSheet(isOwnComment?'Delete comment?':'Remove comment?',isOwnComment?'This will permanently delete your comment.':'This comment will be removed from your Story.',isOwnComment?'Delete comment':'Remove comment',()=>cfModerationDeleteComment(storyId,commentId),true);
}

async function cfSubmitCommentReport(storyId,commentId,reason){
  try{
    const marker=`[CARFULL_REPORT_COMMENT:${commentId}] ${String(reason).trim().slice(0,160)}`;
    const {error}=await sb.from('story_comments').insert({story_id:storyId,user_id:currentUser.id,body:marker,created_at:new Date().toISOString()});
    if(error)throw error;
    cfModerationClose();cfModerationToast('Comment reported. Thank you.');
  }catch(e){cfModerationToast('Could not send report. Please try again.')}
}
function reportStoryComment(storyId,commentId,userId,username){
  if(!currentUser)return go('account');
  if(String(userId)===String(currentUser.id)){cfModerationToast('You cannot report your own comment.');return;}
  const reasons=['Spam','Harassment','Inappropriate content','Misleading','Other'];
  window.cfModerationReasonAction=(reason)=>cfSubmitCommentReport(storyId,commentId,reason);
  cfModerationSheet('Report comment',`<div class="cfModText">Why are you reporting this comment?</div><div class="cfReasonGrid">${reasons.map(r=>`<button class="cfReasonBtn" onclick="window.cfModerationReasonAction('${r.replace(/'/g,"\'")}')">${r}</button>`).join('')}</div><button class="cfModAction cfModActionMuted" onclick="cfModerationClose()">Cancel</button>`);
}

function commentSafetyMenu(storyId,commentId,userId,username,isStoryOwner,isOwnComment){
  if(!currentUser)return go('account');
  const who='@'+(username||'CarFullUser');
  if(isOwnComment){
    cfModerationSheet('Your comment',`<button class="cfModAction cfModActionDanger" onclick="deleteStoryComment('${storyId}','${commentId}')">Delete comment<span>›</span></button><button class="cfModAction cfModActionMuted" onclick="cfModerationClose()">Cancel</button>`);
    return;
  }
  let rows='';
  if(isStoryOwner)rows+=`<button class="cfModAction cfModActionDanger" onclick="deleteStoryComment('${storyId}','${commentId}')">Remove comment<span>›</span></button>`;
  rows+=`<button class="cfModAction" onclick="reportStoryComment('${storyId}','${commentId}','${userId}','${String(username||'CarFullUser').replace(/'/g,"\'")}')">Report comment<span>›</span></button>`;
  rows+=`<button class="cfModAction" onclick="cfBlockAccountSheet('${userId}','${String(username||'Account').replace(/'/g,"\'")}')">Block account<span>›</span></button>`;
  rows+=`<button class="cfModAction cfModActionMuted" onclick="cfModerationClose()">Cancel</button>`;
  cfModerationSheet(who,rows);
}

function storyCommentsHtml(storyId,storyOwnerId){
  const st=storyInteractionState[storyId]||{};
  const comments=(st.comments||[]).filter(c=>!String(c.body||'').startsWith('[CARFULL_REPORT') && !isBlockedUser(c.user_id));
  return `<div class="storyCommentsPane" hidden>
    <div class="storyCommentsList">
      ${comments.length?comments.map(c=>{
        const prof=profileForUserId(c.user_id);
        const isOwnComment=!!(currentUser && String(currentUser.id||'')===String(c.user_id||''));
        const isStoryOwner=!!(currentUser && String(currentUser.id||'')===String(storyOwnerId||''));
        return `<div class="storyComment">
          <div class="storyCommentHead">
            <div class="communityAvatar">${usernameInitial(prof.username)}</div>
            <b>${prof.username||'CarFullUser'}</b>
            ${currentUser?`<button class="commentMenuBtn" aria-label="Comment options" onclick="commentSafetyMenu('${storyId}','${c.id}','${c.user_id}','${String(prof.username||'CarFullUser').replace(/'/g,"\\'")}',${isStoryOwner},${isOwnComment})">•••</button>`:''}
          </div>
          <span>${c.body||c.comment||''}</span>
        </div>`;
      }).join(''):'<div class="muted">No comments yet.</div>'}
    </div>
    <div class="storyCommentComposer">
      <input class="input" maxlength="280" placeholder="Add a comment…">
      <button class="btn compactBtn" onclick="submitStoryComment('${storyId}',this)">Post</button>
    </div>
  </div>`;
}


async function loadGlobalCommunityStories(force=false){
  if(!sb)return;
  if(globalCommunityStoriesLoading)return;
  if(globalCommunityStoriesLoaded&&!force)return;

  globalCommunityStoriesLoading=true;
  globalCommunityStoriesError='';

  try{
    const {data:records,error:recordsError}=await sb
      .from('passport_records')
      .select('id,passport_id,user_id,record_type,record_date,mileage,title,description,provider,cost,created_at')
      .eq('record_type','Story')
      .eq('provider','Community')
      .order('created_at',{ascending:false});
    if(recordsError)throw recordsError;

    const storyRecords=records||[];
    if(!storyRecords.length){
      globalCommunityStoryRows=[];
      globalCommunityStoriesLoaded=true;
      return;
    }

    const passportIds=[...new Set(storyRecords.map(r=>r.passport_id).filter(Boolean))];
    const recordIds=storyRecords.map(r=>r.id).filter(Boolean);

    const [{data:pps,error:ppError},{data:evidence,error:evError}]=await Promise.all([
      sb.from('passports')
        .select('id,registration,make,model,year,status,current_keeper_id,is_public')
        .in('id',passportIds),
      sb.from('passport_evidence')
        .select('id,passport_id,record_id,evidence_type,object_path,verification_status,created_at')
        .in('record_id',recordIds)
        .order('created_at',{ascending:false})
    ]);
    if(ppError)throw ppError;
    if(evError)throw evError;

    const ppMap={};
    for(const x of (pps||[])){
      ppMap[x.id]={
        id:x.id,
        reg:displayReg(x.registration||''),
        make:x.make||'Vehicle',
        model:x.model||'',
        year:x.year||'',
        status:x.status||'active',
        current_keeper_id:x.current_keeper_id||null,
        is_public:!!x.is_public
      };
    }

    const evMap={};
    for(const ev of (evidence||[])){
      if(!evMap[ev.record_id])evMap[ev.record_id]=[];
      evMap[ev.record_id].push(ev);
    }

    globalCommunityStoryRows=storyRecords
      .map(r=>({pp:ppMap[r.passport_id],r,ev:(evMap[r.id]||[])[0]||null}))
      .filter(x=>x.pp);

    globalCommunityStoriesLoaded=true;
    storyOwnerProfilesLoaded=false;
    storyInteractionsLoaded=false;
  }catch(e){
    console.warn('Community Stories load failed',e);
    globalCommunityStoryRows=[];
    globalCommunityStoriesLoaded=true;
    globalCommunityStoriesError=e?.message||'Could not load Stories.';
  }finally{
    globalCommunityStoriesLoading=false;
  }
}

async function loadCommunityStoryPhotos(){
  if(!sb)return;
  const rows=communityStoryRows();
  for(const {ev} of rows){
    if(!ev || !ev.object_path || storyPhotoUrls[ev.id])continue;
    try{
      const {data,error}=await sb.storage.from('passport-evidence').createSignedUrl(ev.object_path,3600);
      if(!error && data?.signedUrl)storyPhotoUrls[ev.id]=data.signedUrl;
    }catch(e){}
  }
}

function communityStoryRows(){
  if(globalCommunityStoriesLoaded)return globalCommunityStoryRows;

  const rows=[];
  for(const pp of (passports||[])){
    for(const r of (passportRecords[pp.id]||[])){
      if(String(r.record_type||'').toLowerCase()==='story' &&
         String(r.provider||'').toLowerCase()==='community'){
        rows.push({pp,r,ev:evidenceForRecord(r.id)[0]||null});
      }
    }
  }
  rows.sort((a,b)=>
    String(b.r.created_at||b.r.record_date||'').localeCompare(
      String(a.r.created_at||a.r.record_date||'')
    )
  );
  return rows;
}

function storyCircleLabel(pp){
  const model=String(pp?.model||pp?.make||'Car').trim();
  const words=model.split(/\s+/).filter(Boolean);
  return (words.length===1?words[0].slice(0,4):words.map(w=>w[0]).join('').slice(0,4)).toUpperCase();
}

function liveStoryTiles(){
  const rows=communityStoryRows().slice(0,3);
  if(!rows.length)return '';
  return `<div class="liveStoryTiles">${rows.map(({pp,ev})=>{
    const url=ev?storyPhotoUrls[ev.id]:null;
    return `<button class="liveStoryTile" onclick="activePassportId='${pp.id}';go('passportDetail')">
      <div class="liveStoryBubble"${url?` style="background-image:url('${url.replace(/'/g,'%27')}')"`:''}>${url?'':storyCircleLabel(pp)}</div>
      <span>${pp.model||pp.make||'Story'}</span>
    </button>`;
  }).join('')}</div>`;
}


function openStoryPassport(passportId,storyOwnerId){
  if(!currentUser){go('account');return}
  const own=String(storyOwnerId||'')===String(currentUser.id||'');
  if(!own && !isPremium()){go('premium');return}
  activePassportId=passportId;
  go('passportDetail');
}



async function openViewablePassport(passportId){
  if(!currentUser){go('account');return}
  try{
    const {data:pp,error:ppErr}=await sb
      .from('passports')
      .select('id,registration,make,model,year,is_public,current_keeper_id')
      .eq('id',passportId)
      .eq('is_public',true)
      .maybeSingle();

    if(ppErr)throw ppErr;
    if(!pp)return alert('This Passport is private.');

    const {data:records,error:rErr}=await sb
      .from('passport_records')
      .select('id,passport_id,record_type,record_date,mileage,title,description,provider,cost,created_at')
      .eq('passport_id',passportId)
      .neq('record_type','Story')
      .order('record_date',{ascending:false})
      .order('created_at',{ascending:false});

    if(rErr)throw rErr;

    publicPassportData={
      id:pp.id,
      reg:displayReg(pp.registration||''),
      make:pp.make||'Vehicle',
      model:pp.model||'',
      year:pp.year||''
    };
    publicPassportRecords=records||[];
    go('publicPassport');
  }catch(err){
    alert('Could not open Passport: '+(err.message||err));
  }
}

function publicPassport(){
  const pp=publicPassportData;
  if(!pp)return wrap(`${title('Car History')}
    <section class="card empty"><b>Passport unavailable</b><p class="muted">This Passport is not currently viewable.</p></section>`,'stories');

  return wrap(`${title('Car History')}
    <section class="card">
      <div class="passportBadge">VIEWABLE PASSPORT</div>
      <div class="reg">${pp.reg}</div>
      <h2>${pp.make} ${pp.model}</h2>
      <div class="muted">${pp.year||''}</div>
    </section>

    <section class="card">
      <b>Vehicle history shared by the owner</b>
      <p class="muted">Read-only history. Receipts, uploaded evidence and personal details remain private.</p>
      <div class="valueLine"><span>History records</span><b>${publicPassportRecords.length}</b></div>
    </section>

    <div class="sectionTitle"><span>History timeline</span><span>${publicPassportRecords.length}</span></div>
    ${publicPassportRecords.length
      ? publicPassportRecords.map(r=>`<section class="card">
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="font-size:28px">${passportRecordIcon(r.record_type)}</div>
            <div style="flex:1">
              <b>${r.title||r.record_type||'History record'}</b>
              <div class="muted">${[r.record_type,r.record_date,r.mileage?Number(r.mileage).toLocaleString()+' miles':''].filter(Boolean).join(' • ')}</div>
              ${r.provider?`<div class="muted">${r.provider}</div>`:''}
              ${r.description?`<p>${r.description}</p>`:''}
              ${r.cost!==null&&r.cost!==undefined?`<div class="valueLine"><span>Recorded cost</span><b>£${Number(r.cost).toFixed(2)}</b></div>`:''}
            </div>
          </div>
        </section>`).join('')
      : `<section class="card empty"><b>No shared history yet</b><p class="muted">The owner has made this car history viewable, but has not added any history records yet.</p></section>`}
  `,'stories');
}

function openStoryCar(passportId){
  activeStoryCarPassportId=passportId;
  go('storyCar');
}

function storyCar(){
  const rows=communityStoryRows().filter(x=>String(x.pp.id)===String(activeStoryCarPassportId));
  if(!rows.length){
    return wrap(`${title('Car profile')}<section class="card empty"><b>No Stories found</b><p class="muted">There are no public Stories available for this car.</p><button class="btn secondary" onclick="go('stories')">Back to Stories</button></section>`,'stories');
  }

  const pp=rows[0].pp;
  const ownerProfile=profileForUserId(rows[0].r.user_id);
  const followers=Number(carFollowInfo(pp.id).count||0);

  if(sb){
    const missing=rows.some(({ev})=>ev&&ev.object_path&&!storyPhotoUrls[ev.id]);
    if(missing && !window.__storyCarPhotoLoadPending){
      window.__storyCarPhotoLoadPending=true;
      loadCommunityStoryPhotos().finally(()=>{
        window.__storyCarPhotoLoadPending=false;
        if(screen==='storyCar')render();
      });
    }
  }

  const grid=rows.map(({r,ev})=>{
    const url=ev?storyPhotoUrls[ev.id]:null;
    const social=storyInteractionState[r.id]||{};
    return `<button class="carProfileGridItem" onclick="openStoryComments('${r.id}')">
      ${url?`<img src="${url}" alt="${pp.make||'Car'} ${pp.model||''}">`:`<div class="carProfileGridEmpty">${storyCircleLabel(pp)}</div>`}
      <span>♡ ${Number(social.likeCount||0)} &nbsp; ◯ ${Number(social.commentCount||0)}</span>
    </button>`;
  }).join('');

  return wrap(`<div class="carProfilePage">
    <div class="carProfileTop"><button class="carProfileBack" onclick="go('stories')">‹</button><b>${pp.make||''} ${pp.model||''}</b></div>
    <section class="carProfileHero">
      <div class="carProfileAvatar">${storyCircleLabel(pp)}</div>
      <div class="carProfileIdentity">
        <h1>${pp.make||''} ${pp.model||''}</h1>
        <div>${pp.year||''}${pp.reg?' • '+pp.reg:''}</div>
        <small>Owned by @${ownerProfile.username||'CarFullUser'}</small>
      </div>
      <div class="carProfileStats"><b>${followers.toLocaleString()}</b><span>${followers===1?'follower':'followers'}</span><b>${rows.length}</b><span>${rows.length===1?'story':'stories'}</span></div>
      <div class="carProfileActions">
        ${currentUser&&String(rows[0].r.user_id||'')===String(currentUser.id||'')
          ? `<button class="carProfileFollow following" disabled>Your car</button>`
          : `<button class="carProfileFollow ${carFollowInfo(pp.id).following?'following':''}" onclick="toggleCarFollow('${pp.id}','${rows[0].r.id}',this);setTimeout(render,250)">${carFollowInfo(pp.id).following?'Following':'Follow car'}</button>`}
        ${pp.is_public?`<button class="carProfileHistory" onclick="openViewablePassport('${pp.id}')">View History</button>`:`<button class="carProfileHistory" disabled>History private</button>`}
      </div>
    </section>
    <div class="carProfileGrid">${grid}</div>
  </div>`,'stories');
}
const CARFULL_BLOCKED_USERS_KEY='carfull_blocked_users_v1';
function blockedUserIds(){try{return new Set(JSON.parse(localStorage.getItem(CARFULL_BLOCKED_USERS_KEY)||'[]').map(String))}catch(e){return new Set()}}
function isBlockedUser(userId){return blockedUserIds().has(String(userId||''))}
function cfBlockAccountSheet(userId,username){
  if(!currentUser)return go('account');
  if(String(userId)===String(currentUser.id)){cfModerationToast('You cannot block your own account.');return;}
  cfConfirmSheet('Block account?',`@${username||'Account'} will no longer be able to interact with your content, and their Stories and comments will be hidden from you.`,'Block account',()=>blockStoryUser(userId,username),true);
}
function blockStoryUser(userId,username){
  if(!currentUser)return go('account');
  if(String(userId)===String(currentUser.id)){cfModerationToast('You cannot block your own account.');return;}
  const set=blockedUserIds();set.add(String(userId));localStorage.setItem(CARFULL_BLOCKED_USERS_KEY,JSON.stringify([...set]));
  cfModerationClose();render();setTimeout(()=>cfModerationToast(`@${username||'Account'} blocked`),40);
}
async function cfSubmitStoryReport(storyId,reason){
  try{
    const marker=`[CARFULL_REPORT] ${String(reason).trim().slice(0,180)}`;
    const {error}=await sb.from('story_comments').insert({story_id:storyId,user_id:currentUser.id,body:marker,created_at:new Date().toISOString()});
    if(error)throw error;
    cfModerationClose();cfModerationToast('Story reported. Thank you.');
  }catch(e){console.warn('Story report failed',e);cfModerationToast('Could not send report. Please try again.')}
}
function reportStory(storyId,userId,username){
  if(!currentUser)return go('account');
  if(String(userId)===String(currentUser.id)){cfModerationToast('You cannot report your own Story.');return;}
  const reasons=['Spam','Harassment','Unsafe content','Inappropriate content','Misleading','Other'];
  window.cfStoryReasonAction=(reason)=>cfSubmitStoryReport(storyId,reason);
  cfModerationSheet('Report Story',`<div class="cfModText">Why are you reporting this Story?</div><div class="cfReasonGrid">${reasons.map(r=>`<button class="cfReasonBtn" onclick="window.cfStoryReasonAction('${r.replace(/'/g,"\'")}')">${r}</button>`).join('')}</div><button class="cfModAction cfModActionMuted" onclick="cfModerationClose()">Cancel</button>`);
}
function storySafetyMenu(storyId,userId,username){
  if(!currentUser)return go('account');
  if(String(userId)===String(currentUser.id))return;
  cfModerationSheet('Story options',`<button class="cfModAction" onclick="reportStory('${storyId}','${userId}','${String(username||'Account').replace(/'/g,"\'")}')">Report Story<span>›</span></button><button class="cfModAction cfModActionMuted" onclick="cfModerationClose()">Cancel</button>`);
}

function spottedCommentPreview(storyId){
  const st=storyInteractionState[storyId]||{};
  const comments=(st.comments||[]).filter(c=>!String(c.body||'').startsWith('[CARFULL_REPORT') && !isFollowMarker(c.body) && !isBlockedUser(c.user_id));
  if(!comments.length)return '';
  const shown=comments.slice(-2);
  return `<div class="spottedCommentPreview">
    ${comments.length>2?`<button class="spottedViewComments" onclick="openStoryComments('${storyId}')">View all ${comments.length} comments</button>`:''}
    ${shown.map(c=>{const prof=profileForUserId(c.user_id);return `<div class="spottedCommentRow"><b>${prof.username||'CarFullUser'}</b><span>${c.body||c.comment||''}</span></div>`}).join('')}
  </div>`;
}

function liveCommunityStories(){
  const rows=communityStoryRows();
  if(!rows.length)return `<section class="spottedEmpty"><b>No posts yet</b><p class="muted">The first cars shared with CarFull will appear here.</p><button class="btn" onclick="startStoryFromFeed()">Share a car</button></section>`;
  return `<div class="storiesFeed spottedFeed">${rows.map(({pp,r,ev})=>{
    const url=ev?storyPhotoUrls[ev.id]:null;
    const social=storyInteractionState[r.id]||{};
    const profile=profileForUserId(r.user_id);
    const user=profile.username||'CarFullUser';
    const caption=r.description||r.title||'';
    const likes=Number(social.likeCount||0), comments=Number(social.commentCount||0);
    const mine=currentUser&&String(r.user_id||'')===String(currentUser.id||'');
    return `<article class="liveStoryCard spottedPost" data-story-id="${r.id}">
      <div class="spottedPostHead">
        <div class="communityAvatar">${usernameInitial(user)}</div>
        <div class="spottedPostWho"><b>${user}</b><span>${[pp.make||'',pp.model||'',pp.year||''].filter(Boolean).join(' · ')}</span></div>
        <button class="storySafetyBtn" onclick="storySafetyMenu('${r.id}','${r.user_id}','${user}')" aria-label="Post options">•••</button>
      </div>
      ${caption?`<p class="spottedCaption">${caption}</p>`:''}
      ${url?`<img class="liveStoryImage spottedImage" src="${url}" alt="${pp.make||'Car'} ${pp.model||''}">`:`<div class="liveStoryImage liveStoryImageEmpty">Photo loading…</div>`}
      <div class="spottedPostBody">
        ${(likes||comments)?`<div class="spottedCounts">${likes?`<span>${likes} ${likes===1?'like':'likes'}</span>`:'<span></span>'}${comments?`<button onclick="openStoryComments('${r.id}')">${comments} ${comments===1?'comment':'comments'}</button>`:''}</div>`:''}
        <div class="spottedActions">
          <button class="spottedAction ${social.liked?'active':''}" onclick="toggleStoryLike('${r.id}',this)" data-like-text="1">Like</button>
          <button class="spottedAction" onclick="openStoryComments('${r.id}')">Comment${!isPremium()?' · CarFull Pro':''}</button>
        </div>
        ${spottedCommentPreview(r.id)}
        ${storyCommentsHtml(r.id,r.user_id)}
        <div class="spottedDate">${r.record_date||''}</div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function stories(){
  if(currentUser && !carFollowDataLoading && !storyInteractionsLoaded)setTimeout(ensureCarFollowData,0);
  if(sb && !globalCommunityStoriesLoaded && !globalCommunityStoriesLoading){loadGlobalCommunityStories().finally(()=>{if(screen==='stories')render()})}
  const rows=communityStoryRows();
  if(rows.length && sb){
    if(currentUser && !communityProfileLoaded && !window.__communityProfileLoadPending){window.__communityProfileLoadPending=true;loadCommunityProfile().finally(()=>{window.__communityProfileLoadPending=false;if(screen==='stories')render()})}
    if(!storyOwnerProfilesLoaded && !window.__storyOwnerProfileLoadPending){window.__storyOwnerProfileLoadPending=true;loadStoryOwnerProfiles().finally(()=>{window.__storyOwnerProfileLoadPending=false;if(screen==='stories')render()})}
    const missing=rows.some(({ev})=>ev&&ev.object_path&&!storyPhotoUrls[ev.id]);
    if(missing&&!window.__storyPhotoLoadPending){window.__storyPhotoLoadPending=true;loadCommunityStoryPhotos().finally(()=>{window.__storyPhotoLoadPending=false;if(screen==='stories')render()})}
    if(currentUser&&!storyInteractionsLoaded&&!window.__storyInteractionLoadPending){window.__storyInteractionLoadPending=true;loadStoryInteractions().finally(()=>{window.__storyInteractionLoadPending=false;if(screen==='stories')render()})}
  }
  const feed=(!globalCommunityStoriesLoaded&&!rows.length)?`<section class="spottedEmpty"><b>Loading Spotted…</b><p class="muted">Fetching the latest posts.</p></section>`:globalCommunityStoriesError?`<section class="spottedEmpty"><b>Could not load Spotted</b><p class="muted">${globalCommunityStoriesError}</p><button class="btn secondary" onclick="globalCommunityStoriesLoaded=false;globalCommunityStoriesError='';render()">Try again</button></section>`:liveCommunityStories();
  return wrap(`<div class="storiesPage spottedPage"><div class="storiesTopbar spottedTopbar"><h1>Spotted</h1><button class="storiesNewBtn" onclick="startStoryFromFeed()" aria-label="Share a car">＋</button></div>${feed}</div>`,'stories');
}




function render(){A.innerHTML=({home,drive,addDrive,vehicle,vehicleResult,check,result,recentSearchHistory,passport,passportUpgrade,passportDetail,evidenceUpload,addMaintenance,scanInvoice,scanServiceStamp,addCarStory,storyPrivacy,viewPassport,stories,storyPicker,storyCar,publicPassport,communityUsername,alerts,fullCheckOffer,fullCheckCheckout,fullCheckReport,myChecks,redeemPremium,premium,passwordReset,privacyControls,deleteAccount,account,more}[screen]||home)()+scoreSheet()}render();initBackend();
