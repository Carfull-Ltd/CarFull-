const STRIPE_API='https://api.stripe.com/v1';
async function stripeGet(secret,path,params={}){
  const qs=new URLSearchParams();
  for(const [k,v] of Object.entries(params)){
    if(v!==undefined&&v!==null&&v!=='')qs.append(k,String(v));
  }
  const r=await fetch(STRIPE_API+path+(qs.toString()?'?'+qs.toString():''),
    {headers:{Authorization:'Bearer '+secret}});
  const data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||'Stripe request failed');
  return data;
}

async function resolveProductPrice(secret,type){
  const config = type==='premium'
    ? {
        names:['Premium CarFull','CarFull Premium'],
        amount:999,
        currency:'gbp',
        recurring:true
      }
    : {
        names:['CarFull Full Check','Full CarFull Check'],
        amount:599,
        currency:'gbp',
        recurring:false
      };

  const products=await stripeGet(secret,'/products',{active:'true',limit:'100'});
  const product=(products.data||[]).find(p =>
    config.names.some(n=>String(p.name||'').trim().toLowerCase()===n.toLowerCase())
  );
  if(!product)throw new Error(type==='premium'
    ? 'Stripe Premium product not found'
    : 'Stripe Full Check product not found');

  const prices=await stripeGet(secret,'/prices',{
    active:'true',
    product:product.id,
    limit:'100'
  });

  const list=prices.data||[];
  const exact=list.find(x =>
    String(x.currency||'').toLowerCase()===config.currency &&
    Number(x.unit_amount)===config.amount &&
    (config.recurring
      ? x.type==='recurring' && x.recurring?.interval==='year'
      : x.type==='one_time')
  );

  const fallback=list.find(x =>
    config.recurring
      ? x.type==='recurring' && x.recurring?.interval==='year'
      : x.type==='one_time'
  );

  const price=exact||fallback;
  if(!price)throw new Error(type==='premium'
    ? 'No active yearly Premium price found in Stripe'
    : 'No active Full Check price found in Stripe');

  return price.id;
}

function formEncode(obj){
  const p=new URLSearchParams();
  for(const [k,v] of Object.entries(obj)){
    if(v!==undefined&&v!==null&&v!=='')p.append(k,String(v));
  }
  return p.toString();
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});

  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)return res.status(500).json({
    error:'Stripe is not configured on this deployment'
  });

  try{
    const body=typeof req.body==='string'
      ? JSON.parse(req.body||'{}')
      : (req.body||{});

    const type=String(body.type||'');
    const registration=String(body.registration||'')
      .replace(/\s+/g,'')
      .toUpperCase()
      .slice(0,12);
    const userId=String(body.userId||'').slice(0,100);
    const email=String(body.email||'').slice(0,200);

    if(!['full_check','premium'].includes(type))
      return res.status(400).json({error:'Invalid checkout type'});

    if(!userId)
      return res.status(400).json({error:'Signed-in CarFull account required'});

    if(type==='full_check'&&!registration)
      return res.status(400).json({error:'Registration required'});

    const premium=type==='premium';
    let price;

    if(type==='full_check'){
      const activePremium=body.isPremium===true || String(body.isPremium||'').toLowerCase()==='true';
      const standardPrice=process.env.STRIPE_FULL_CHECK_PRICE_ID||'';
      const premiumPrice=process.env.STRIPE_PREMIUM_CHECK_PRICE_ID||'';

      if(activePremium){
        if(!premiumPrice)throw new Error('Premium Full Check price is not configured');
        price=premiumPrice;
      }else{
        if(!standardPrice)throw new Error('Standard Full Check price is not configured');
        price=standardPrice;
      }
    }else{
      price=await resolveProductPrice(secret,'premium');
    }

    const proto=String(req.headers['x-forwarded-proto']||'https')
      .split(',')[0].trim();
    const origin=proto+'://'+req.headers.host;

    const fields={
      mode:premium?'subscription':'payment',
      'line_items[0][price]':price,
      'line_items[0][quantity]':'1',
      success_url:origin+'/?stripe=success&type='+encodeURIComponent(type)
        +'&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:origin+'/?stripe=cancelled&type='+encodeURIComponent(type),
      client_reference_id:userId,
      customer_email:email||undefined,
      'metadata[type]':type,
      'metadata[user_id]':userId,
      'metadata[registration]':registration||''
    };

    if(premium){
      fields['subscription_data[metadata][type]']='premium';
      fields['subscription_data[metadata][user_id]']=userId;
    }

    const r=await fetch(STRIPE_API+'/checkout/sessions',{
      method:'POST',
      headers:{
        Authorization:'Bearer '+secret,
        'Content-Type':'application/x-www-form-urlencoded'
      },
      body:formEncode(fields)
    });

    const data=await r.json();
    if(!r.ok)return res.status(r.status).json({
      error:data?.error?.message||'Stripe checkout failed'
    });

    return res.status(200).json({url:data.url,id:data.id});
  }catch(e){
    return res.status(500).json({error:e.message||'Checkout failed'});
  }
}
