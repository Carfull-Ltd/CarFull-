import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';

const CONFIG = {
  iosPublicSdkKey: 'appl_NzMFFZVGEJUNaMKxCsHTMhXgvtC',
  entitlement: 'carfull_pro',
  offerings: {
    membership: 'carfull_premium',
    standardCheck: 'carfull_check',
    proCheck: 'carfull_pro_check'
  },
  packageIds: {
    membership: '$rc_annual',
    standardCheck: 'carfull_check',
    proCheck: 'carfull_pro_check'
  }
};

let configured = false;
let identifiedUserId = null;

function isNativeIOS(){ return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'; }
function entitlementFrom(info){ return info?.entitlements?.active?.[CONFIG.entitlement] || null; }
function statusFrom(info){
  const ent = entitlementFrom(info);
  return { active: !!ent, expiresAt: ent?.expirationDate || null, source: 'revenuecat' };
}
async function configure(){
  if(!isNativeIOS()) return false;
  if(configured) return true;
  if(!CONFIG.iosPublicSdkKey || CONFIG.iosPublicSdkKey.startsWith('REPLACE_')) {
    throw new Error('RevenueCat iOS public SDK key has not been added to this build.');
  }
  await Purchases.configure({ apiKey: CONFIG.iosPublicSdkKey });
  configured = true;
  return true;
}
async function identify(userId){
  if(!isNativeIOS() || !userId) return null;
  await configure();
  if(identifiedUserId !== userId){
    const result = await Purchases.logIn({ appUserID: String(userId) });
    identifiedUserId = String(userId);
    return statusFrom(result.customerInfo);
  }
  return getStatus();
}
async function getStatus(){
  if(!isNativeIOS()) return null;
  await configure();
  const info = await Purchases.getCustomerInfo();
  return statusFrom(info);
}
async function getPackage(offeringId, packageId){
  await configure();
  const offerings = await Purchases.getOfferings();
  const offering = offerings?.all?.[offeringId];
  if(!offering) throw new Error(`RevenueCat offering not found: ${offeringId}`);
  const pkg = offering.availablePackages?.find(p => p.identifier === packageId)
    || offering.availablePackages?.[0];
  if(!pkg) throw new Error(`No purchasable package found in ${offeringId}`);
  return pkg;
}
async function purchaseMembership(){
  const pkg = await getPackage(CONFIG.offerings.membership, CONFIG.packageIds.membership);
  const result = await Purchases.purchasePackage({ aPackage: pkg });
  return statusFrom(result.customerInfo);
}
async function purchaseCheck(isPro){
  const offeringId = isPro ? CONFIG.offerings.proCheck : CONFIG.offerings.standardCheck;
  const packageId = isPro ? CONFIG.packageIds.proCheck : CONFIG.packageIds.standardCheck;
  const pkg = await getPackage(offeringId, packageId);
  const result = await Purchases.purchasePackage({ aPackage: pkg });
  return { purchased: true, productIdentifier: result.productIdentifier || pkg.product?.identifier || null };
}
async function restore(){
  await configure();
  const info = await Purchases.restorePurchases();
  return statusFrom(info);
}

window.CarFullNativePurchases = { isNativeIOS, identify, getStatus, purchaseMembership, purchaseCheck, restore, CONFIG };
