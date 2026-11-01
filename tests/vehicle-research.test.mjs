import test from 'node:test';
import assert from 'node:assert/strict';
import {createVehicleResearch} from '../server/vehicle-research.mjs';
import {vinCheckDigit} from '../vin-core.js';
import {createApi} from '../server/api.mjs';
import {localStore} from '../server/local-store.mjs';
import {hashPassword} from '../server/auth.mjs';
const vin='1HGCV2F62JA012802';
function fixture({failed='',decodeError='0'}={}){
  const calls=[];
  return {calls,fetcher:async url=>{
    calls.push(url);const u=new URL(url);
    if(failed&&url.includes(failed))return new Response('unavailable',{status:503});
    if(u.hostname==='vpic.nhtsa.dot.gov')return Response.json({Results:[{ErrorCode:decodeError,ModelYear:'2018',Make:'HONDA',Model:'Accord',EngineCylinders:'4',DisplacementL:'2.0',PlantCity:'MARYSVILLE'}]});
    if(u.pathname.includes('recallsByVehicle'))return Response.json({results:[{NHTSACampaignNumber:'TEST-ONLY',Component:'Example component',Summary:'Test campaign',Remedy:'Example remedy'}]});
    if(u.pathname.includes('complaintsByVehicle'))return Response.json({results:[{odiNumber:'TEST-ONLY',dateComplaintFiled:'10/01/2026',summary:'Example owner report',vin:'Do not forward'}]});
    if(u.pathname.includes('/SafetyRatings/modelyear/'))return Response.json({Results:[{VehicleId:100,VehicleDescription:'Example sedan FWD'},{VehicleId:101,VehicleDescription:'Example sedan hybrid'}]});
    if(u.pathname.includes('/SafetyRatings/VehicleId/'))return Response.json({Results:[{VehicleDescription:'Example sedan FWD',OverallRating:'5',VehiclePicture:'https://untrusted.invalid/picture'}]});
    if(u.pathname.endsWith('/menu/make'))return Response.json({menuItem:[{text:'Honda',value:'Honda'}]});
    if(u.pathname.endsWith('/menu/model')){assert.equal(u.searchParams.get('make'),'Honda');return Response.json({menuItem:{text:'Accord',value:'Accord'}});}
    if(u.pathname.endsWith('/menu/options'))return Response.json({menuItem:[{text:'2.0 L Automatic',value:'200'},{text:'1.5 L Manual',value:'201'}]});
    if(u.pathname.endsWith('/vehicle/200'))return Response.json({id:200,year:'2018',make:'Honda',model:'Accord',city08:23,highway08:34,comb08:27,fuelType1:'Regular Gasoline'});
    throw Error('Unexpected URL: '+url);
  }};
}
test('VIN checksum distinguishes a valid reading, changed digit and malformed input',()=>{
  assert.equal(vinCheckDigit(vin).status,'match');assert.equal(vinCheckDigit('1HGCV2F62JA012803').status,'mismatch');assert.equal(vinCheckDigit('bad').status,'invalid');
});
test('research decodes first, preserves configurations and caches government requests',async()=>{
  const {fetcher,calls}=fixture();const client=createVehicleResearch({fetcher,now:()=>0});const result=await client.lookup(vin);
  assert.equal(result.vehicle,'2018 HONDA Accord');assert.equal(result.recalls.data.count,1);assert.equal(result.complaints.data.count,1);
  assert.equal(result.safety.data.length,2);assert.equal(result.economy.data.length,2);assert.equal(result.complaints.data.items[0].vin,undefined);
  assert.ok(result.specifications.some(r=>r.label==='PlantCity'));
  assert.ok(calls.filter(url=>!url.includes('vpic.nhtsa.dot.gov')).every(url=>!url.includes(vin)));
  assert.ok(calls.every(url=>['vpic.nhtsa.dot.gov','api.nhtsa.gov','www.fueleconomy.gov'].includes(new URL(url).hostname)));
  const before=calls.length;await client.lookup(vin);assert.equal(calls.length,before);
});
test('failed provider stays unavailable while other reports survive',async()=>{
  const {fetcher}=fixture({failed:'recallsByVehicle'});const result=await createVehicleResearch({fetcher}).lookup(vin);
  assert.equal(result.recalls.status,'unavailable');assert.equal(result.recalls.data,undefined);assert.equal(result.complaints.status,'ready');assert.equal(result.safety.status,'ready');
});
test('flagged decode stops model reports; invalid VIN makes no request',async()=>{
  const {fetcher,calls}=fixture({decodeError:'1'});const client=createVehicleResearch({fetcher});const result=await client.lookup(vin);
  assert.ok(result.warning);assert.equal(result.recalls,undefined);assert.equal(calls.length,1);await assert.rejects(()=>client.lookup('../bad'));assert.equal(calls.length,1);
});
test('selected safety and EPA options use fixed destinations and omit untrusted URLs',async()=>{
  const {fetcher,calls}=fixture();const client=createVehicleResearch({fetcher});
  assert.equal((await client.detail('safety','100')).values.OverallRating,'5');
  assert.equal((await client.detail('economy','200')).values.comb08,'27');
  await assert.rejects(()=>client.detail('economy','https://evil.invalid'));await assert.rejects(()=>client.detail('arbitrary','200'));assert.equal(calls.length,2);
});
test('research requires owner sign-in and returns no-store responses',async()=>{
  const store=localStore();const password='test-only-research-password';let lookedUp='';
  const research={lookup:async value=>{lookedUp=value;return {vin:value};},detail:async(kind,id)=>({kind,id})};
  const api=createApi({store,env:{OWNER_PASSWORD_HASH:await hashPassword(password)},research});
  const request=(path,cookie)=>new Request('https://swaggdaddys.com/api'+path,{headers:cookie?{Cookie:cookie}:{}});
  try{
    for(const path of ['/vehicles/'+vin+'/research','/research/safety/100','/research/economy/200'])assert.equal((await api(request(path))).status,401);
    assert.equal(lookedUp,'');
    const login=await api(new Request('https://swaggdaddys.com/api/login',{method:'POST',headers:{Origin:'https://swaggdaddys.com','Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})}));
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const response=await api(request('/vehicles/'+vin+'/research',cookie));assert.equal(response.status,200);assert.equal((await response.json()).vin,vin);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(lookedUp,vin);
    assert.equal((await api(request('/research/safety/100',cookie))).status,200);
  }finally{store.close();}
});
