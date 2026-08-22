const STRIPE_API='https://api.stripe.com/v1';
const DEFAULT_SUPABASE_URL='https://pgczryadczopajxcmmtj.supabase.co';

async function stripeGet(secret,path){
  const r=await fetch(STRIPE_API+path,{
    headers:{Authorization:'Bearer '+secret}
  });
  const data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||'Stripe request failed');
  return data;
}

function supabaseConfig(){
  return {
    url:process.env.SUPABASE_URL||DEFAULT_SUPABASE_URL,
    key:process.env.SUPABASE_SERVICE_ROLE_KEY||''
  };
}

async function supabaseUpsert(table,onConflict,payload){
  const {url,key}=supabaseConfig();
  if(!key)return {ok:false,reason:'SUPABASE_SERVICE_ROLE_KEY is not configured'};

  const r=await fetch(
    `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method:'POST',
      headers:{
        apikey:key,
        'Content-Type':'application/json',
        Prefer:'resolution=merge-duplicates,return=representation'
      },
      body:JSON.stringify(payload)
    }
  );

  const text=await r.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch(e){data=text}

  if(!r.ok)return {
    ok:false,
    reason:data?.message||data?.hint||data?.details||String(data||'Supabase write failed')
  };

  return {ok:true,data};
}

function isoFromUnix(value,fallbackDays=365){
  const n=Number(value);
  if(Number.isFinite(n)&&n>0)return new Date(n*1000).toISOString();
  return new Date(Date.now()+fallbackDays*86400000).toISOString();
}

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});

  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)return res.status(500).json({
    error:'Stripe is not configured on this deployment'
  });

  const id=String(req.query?.session_id||'');
  if(!id.startsWith('cs_'))
    return res.status(400).json({error:'Invalid session'});

  try{
    const session=await stripeGet(
      secret,
      '/checkout/sessions/'+encodeURIComponent(id)
    );

    const paid=session.payment_status==='paid'
      || (session.mode==='subscription'&&session.status==='complete');

    const type=session.metadata?.type||'';
    const userId=session.metadata?.user_id||session.client_reference_id||'';
    const registration=String(session.metadata?.registration||'')
      .replace(/\s+/g,'')
      .toUpperCase();

    let premiumActivated=false;
    let fullCheckSaved=false;
    let expiresAt=null;
    let persistenceError='';

    if(paid&&type==='premium'&&userId){
      let subscription=null;
      if(session.subscription){
        try{
          subscription=await stripeGet(
            secret,
            '/subscriptions/'+encodeURIComponent(session.subscription)
          );
        }catch(e){}
      }

      expiresAt=isoFromUnix(subscription?.current_period_end,365);

      const saved=await supabaseUpsert(
        'premium_entitlements',
        'user_id',
        {
          user_id:userId,
          expires_at:expiresAt,
          source:'stripe',
          stripe_customer_id:String(session.customer||'')||null,
          stripe_subscription_id:String(session.subscription||'')||null,
          updated_at:new Date().toISOString()
        }
      );

      premiumActivated=saved.ok;
      if(!saved.ok)persistenceError=saved.reason||'Premium entitlement could not be saved';
    }

    if(paid&&type==='full_check'&&userId&&registration){
      const saved=await supabaseUpsert(
        'paid_checks',
        'stripe_session_id',
        {
          user_id:userId,
          registration,
          stripe_session_id:id,
          amount_pence:Number(session.amount_total||599),
          currency:String(session.currency||'gbp'),
          payment_status:'paid',
          paid_at:new Date().toISOString()
        }
      );
      fullCheckSaved=saved.ok;
      if(!saved.ok&&!persistenceError)persistenceError=saved.reason||'Paid check could not be saved';
    }

    return res.status(200).json({
      status:session.status,
      payment_status:session.payment_status,
      mode:session.mode,
      type,
      registration,
      user_id:userId,
      paid,
      premium_activated:premiumActivated,
      full_check_saved:fullCheckSaved,
      expires_at:expiresAt,
      persistence_error:persistenceError
    });
  }catch(e){
    return res.status(500).json({
      error:e.message||'Verification failed'
    });
  }
}
