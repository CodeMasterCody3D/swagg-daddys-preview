import { normalizeVin, validVin, decodedVehicle, vinCheckDigit } from '../vin-core.js';

const VPIC='https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/';
const NHTSA='https://api.nhtsa.gov';
const EPA='https://www.fueleconomy.gov/ws/rest';
const clean=(v,max=2000)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:v?[v]:[];
const same=(a,b)=>clean(a).toLowerCase()===clean(b).toLowerCase();
const fields=(row,names)=>Object.fromEntries(names.map(k=>[k,clean(row?.[k])]).filter(([,v])=>v));

// Fixed government endpoints only. A small, short-lived cache avoids repeated upstream
// requests; no customer contact information, notes, or submitted photos are used.
export function createVehicleResearch({fetcher=fetch,now=Date.now}={}) {
  const cache=new Map();
  async function get(url) {
    const existing=cache.get(url);
    if(existing&&existing.until>now())return existing.value;
    const response=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)throw Error('The provider is temporarily unavailable.');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024)throw Error('The provider returned too much data.');chunks.push(value);}}
    finally {await reader.cancel();}
    const data=JSON.parse(Buffer.concat(chunks).toString());
    if(!data||typeof data!=='object')throw Error('The provider returned an unexpected response.');
    if(cache.size>=64)cache.delete(cache.keys().next().value);
    cache.set(url,{until:now()+60*60*1000,value:data});return data;
  }
  async function economyOptions(specs) {
    const params=new URLSearchParams({year:specs.year});
    const makes=await get(EPA+'/vehicle/menu/make?'+params);
    if(!('menuItem' in makes))throw Error('Unexpected fuel-economy response.');
    const make=list(makes.menuItem).find(r=>same(r.text,specs.make));
    if(!make)return [];
    params.set('make',make.value);
    const models=await get(EPA+'/vehicle/menu/model?'+params);
    if(!('menuItem' in models))throw Error('Unexpected fuel-economy response.');
    const model=list(models.menuItem).find(r=>same(r.text,specs.model));
    if(!model)return [];
    params.set('model',model.value);
    const options=await get(EPA+'/vehicle/menu/options?'+params);
    if(!('menuItem' in options))throw Error('Unexpected fuel-economy response.');
    return list(options.menuItem).filter(r=>/^\d{1,8}$/.test(String(r.value))).slice(0,60).map(r=>({id:String(r.value),description:clean(r.text,300)}));
  }
  async function lookup(value) {
    const vin=normalizeVin(value);
    if(!validVin(vin))throw Error('Enter a complete 17-character VIN.');
    const decoded=await get(VPIC+encodeURIComponent(vin)+'?format=json');
    const row=decoded.Results?.[0];
    const vehicle=decodedVehicle(row);
    const result={vin,checkedAt:new Date(now()).toISOString(),...vehicle,checksum:vinCheckDigit(vin),specifications:Object.entries(row||{}).filter(([k,v])=>!['VIN','ErrorText','ErrorCode','AdditionalErrorText'].includes(k)&&clean(v)&&!/^not applicable$/i.test(clean(v))).map(([label,value])=>({label,value:clean(value,500)})),decodeMessage:clean(row?.ErrorText,1000)};
    if(!vehicle.complete||!vehicle.clean)return {...result,warning:'The VIN decoder could not confirm this vehicle. Review the VIN before loading model-based reports.'};
    const s=vehicle.specs,query=new URLSearchParams({make:s.make,model:s.model,modelYear:s.year});
    const tasks={
      recalls:async()=>{const data=await get(NHTSA+'/recalls/recallsByVehicle?'+query);if(!Array.isArray(data.results))throw Error('Unexpected recall response.');return {count:data.results.length,items:data.results.map(r=>fields(r,['NHTSACampaignNumber','ReportReceivedDate','Component','Summary','Consequence','Remedy','Notes'])).slice(0,100)};},
      complaints:async()=>{const data=await get(NHTSA+'/complaints/complaintsByVehicle?'+query);if(!Array.isArray(data.results))throw Error('Unexpected complaint response.');const rows=[...data.results].sort((a,b)=>Date.parse(b.dateComplaintFiled)-Date.parse(a.dateComplaintFiled));return {count:rows.length,items:rows.slice(0,20).map(r=>fields(r,['odiNumber','dateComplaintFiled','components','summary','crash','fire','numberOfInjuries','numberOfDeaths']))};},
      safety:async()=>{const data=await get(NHTSA+'/SafetyRatings/modelyear/'+encodeURIComponent(s.year)+'/make/'+encodeURIComponent(s.make)+'/model/'+encodeURIComponent(s.model)+'?format=json');if(!Array.isArray(data.Results))throw Error('Unexpected safety-rating response.');return data.Results.filter(r=>/^\d{1,8}$/.test(String(r.VehicleId))).slice(0,60).map(r=>({id:String(r.VehicleId),description:clean(r.VehicleDescription,300)}));},
      economy:()=>economyOptions(s)
    };
    await Promise.all(Object.entries(tasks).map(async([key,fn])=>{try{result[key]={status:'ready',data:await fn()};}catch{result[key]={status:'unavailable',message:'This provider could not be reached. You can retry the research or open its website below.'};}}));
    return result;
  }
  async function detail(kind,id) {
    if(!['safety','economy'].includes(kind)||!/^\d{1,8}$/.test(id))throw Error('Choose a listed vehicle configuration.');
    if(kind==='safety') {
      const data=await get(NHTSA+'/SafetyRatings/VehicleId/'+id+'?format=json');const row=data.Results?.[0];
      if(!row)throw Error('No safety rating was returned for this configuration.');
      return {kind,id,values:fields(row,['VehicleDescription','OverallRating','OverallFrontCrashRating','FrontCrashDriversideRating','FrontCrashPassengersideRating','OverallSideCrashRating','SideCrashDriversideRating','SideCrashPassengersideRating','RolloverRating','RolloverPossibility']),source:'NHTSA NCAP'};
    }
    const row=await get(EPA+'/vehicle/'+id);
    if(!row.id)throw Error('No fuel-economy result was returned for this configuration.');
    const values=fields(row,['year','make','model','cylinders','displ','drive','trany','fuelType1','city08','highway08','comb08','fuelType2','cityA08','highwayA08','combA08','atvType','VClass']);
    if(!row.fuelType2)for(const key of ['cityA08','highwayA08','combA08'])delete values[key];
    return {kind,id,values,source:'FuelEconomy.gov / EPA'};
  }
  return {lookup,detail};
}
