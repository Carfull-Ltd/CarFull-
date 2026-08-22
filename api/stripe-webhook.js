import crypto from 'node:crypto';

export const config={api:{bodyParser:false}};

const DEFAULT_SUPABASE_URL='https://pgczryadczopajxcmmtj.supabase.co';

async function readRaw(req){
  const chunks=[];
  for await (const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseStripeSignature(header){
  const out={};
  for(const part of String(header||'').split(',')){
    const [k,v]=part.split('=');
    if(k&&v){
      if(!out[k])out[k]=[];
      out[k].push(v);
    }
  }
  return out;
}

function verifySignature(raw,header,secret){
  const parsed=parseStripeSignature(header);
  const timestamp=parsed.t?.[0];
  const signatures=parsed.v1||[];
  if(!timestamp||!signatures.length)return false;

  const payload=timestamp+'.'+raw.toString('utf8');
  const expected=crypto
    .createHmac('sha256',secret)
    .update(payload,'utf8')
    .digest('hex');

  const expectedBuf=Buffer.from(expected,'utf8');
  return signatures.some(sig=>{
    const sigBuf=Buffer.from(sig,'utf8');
    return sigBuf.length===expectedBuf.length
      && crypto.timingSafeEqual(sigBuf,expectedBuf);
  });
}

async function sbUpsert(payload){
  const url=process.env.SUPABASE_URL||DEFAULT_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!key)throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  const r=await fetch(
    `${url}/rest/v1/premium_entitlements?on_conflict=user_id`,
    {
      method:'POST',
      headers:{
        apikey:key,        'Content-Type':'application/json',
        Prefer:'resolution=merge-duplicates'
      },
      body:JSON.stringify(payload)
    }
  );

  if(!r.ok){
    const text=await r.text();
    console.error('SUPABASE_UPSERT_FAILED', {
      status:r.status,
      statusText:r.statusText,
      response:text,
      payload
    });
    throw new Error(`Supabase entitlement update failed (${r.status}): ${text||r.statusText}`);
  }

  console.log('SUPABASE_UPSERT_OK', {
    user_id:payload?.user_id||null,
    source:payload?.source||null,
    stripe_customer_id:payload?.stripe_customer_id||null,
    stripe_subscription_id:payload?.stripe_subscription_id||null
  });
}

function expiryIso(subscription){
  const end=Number(subscription?.current_period_end||0);
  return end>0
    ? new Date(end*1000).toISOString()
    : new Date(Date.now()+365*86400000).toISOString();
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).send('Method not allowed');

  const webhookSecret=process.env.STRIPE_WEBHOOK_SECRET;
  if(!webhookSecret)return res.status(500).send('Stripe webhook not configured');

  try{
    const raw=await readRaw(req);
    if(!verifySignature(raw,req.headers['stripe-signature'],webhookSecret))
      return res.status(400).send('Invalid Stripe signature');

    const event=JSON.parse(raw.toString('utf8')||'{}');
    const object=event?.data?.object||{};

    console.log('STRIPE_WEBHOOK_EVENT', {
      type:event?.type||null,
      event_id:event?.id||null,
      object_id:object?.id||null,
      metadata:object?.metadata||null,
      nested_user_id:object?.parent?.subscription_details?.metadata?.user_id||null
    });

    if(event.type==='checkout.session.completed'){
      const type=object.metadata?.type||'';
      const userId=object.metadata?.user_id||object.client_reference_id||'';
      const paid=object.payment_status==='paid'||(object.mode==='subscription'&&object.status==='complete');
      if(type==='premium'&&paid&&userId){
        await sbUpsert({
          user_id:userId,
          expires_at:new Date(Date.now()+365*86400000).toISOString(),
          source:'stripe',
          stripe_customer_id:String(object.customer||'')||null,
          stripe_subscription_id:String(object.subscription||'')||null,
          updated_at:new Date().toISOString()
        });
      }
    }

    if(event.type==='customer.subscription.updated'
      || event.type==='customer.subscription.created'){
      const userId=object.metadata?.user_id||'';
      if(userId){
        const active=['active','trialing','past_due'].includes(String(object.status||''));
        await sbUpsert({
          user_id:userId,
          expires_at:active
            ? expiryIso(object)
            : new Date(0).toISOString(),
          source:'stripe',
          stripe_customer_id:String(object.customer||'')||null,
          stripe_subscription_id:String(object.id||'')||null,
          updated_at:new Date().toISOString()
        });
      }
    }


    if(event.type==='invoice.paid'){
      const userId=
        object?.parent?.subscription_details?.metadata?.user_id
        || object?.lines?.data?.[0]?.metadata?.user_id
        || '';
      const subId=
        object?.parent?.subscription_details?.subscription
        || object?.subscription
        || object?.lines?.data?.[0]?.subscription
        || '';
      const customerId=String(object?.customer||'')||null;

      if(userId){
        let expiresAt=new Date(Date.now()+365*86400000).toISOString();

        // Prefer the actual Stripe subscription period end if present in the invoice.
        const periodEnd=
          Number(object?.lines?.data?.[0]?.period?.end||0)
          || Number(object?.period_end||0);

        if(periodEnd>0){
          expiresAt=new Date(periodEnd*1000).toISOString();
        }

        await sbUpsert({
          user_id:userId,
          expires_at:expiresAt,
          source:'stripe',
          stripe_customer_id:customerId,
          stripe_subscription_id:String(subId||'')||null,
          updated_at:new Date().toISOString()
        });
      }
    }

    if(event.type==='customer.subscription.deleted'){
      const userId=object.metadata?.user_id||'';
      if(userId){
        await sbUpsert({
          user_id:userId,
          expires_at:new Date(0).toISOString(),
          source:'stripe',
          stripe_customer_id:String(object.customer||'')||null,
          stripe_subscription_id:String(object.id||'')||null,
          updated_at:new Date().toISOString()
        });
      }
    }

    return res.status(200).json({received:true});
  }catch(e){
    console.error('STRIPE_WEBHOOK_FATAL', {
      message:e?.message||String(e),
      stack:e?.stack||null
    });
    return res.status(500).json({
      ok:false,
      error:e?.message||'Webhook failed'
    });
  }
}
