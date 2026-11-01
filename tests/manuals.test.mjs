import test from 'node:test';
import assert from 'node:assert/strict';
import { findManuals, manualResponse } from '../server/manuals.mjs';

const vin='1HGCM82633A004352';
const specs={year:'2003',make:'HONDA',model:'Accord',cylinders:'6',displacement:'2.998832712'};
const root='<a href="/Honda/">Honda</a><a href="https://untrusted.example/Honda/">Ignore</a>';
const year='<a href="/Honda/2003/Accord%20L4-2.4L/">L4</a><a href="/Honda/2003/Accord%20V6-3.0L/">V6</a><a href="https://evil.example/manual">Wrong host</a>';
function source({page=year,decode=true,missing=false}={}) {
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(url.startsWith('https://vpic.nhtsa.dot.gov/'))return Response.json({Results:[{ErrorCode:decode?'0':'1',ModelYear:'2003',Make:'HONDA',Model:'Accord',EngineCylinders:'6',DisplacementL:'3.0'}]});
    if(url==='https://charm.li/')return new Response(root);
    if(url==='https://charm.li/Honda/2003/')return new Response(page,{status:missing?404:200});
    throw Error('Unexpected destination: '+url);
  };
  return {calls,fetcher};
}
test('VIN-derived engine identifies the exact listed CHARM manual without sending the VIN to CHARM',async()=>{
  const {fetcher,calls}=source();
  const result=await findManuals({vin,vehicleSpecs:specs},{fetcher});
  assert.equal(result.target,'https://charm.li/Honda/2003/Accord%20V6-3.0L/');
  assert.ok(calls.filter(url=>url.startsWith('https://charm.li/')).every(url=>!url.includes(vin)));
  const response=manualResponse(result);
  assert.equal(response.status,303);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('older request with only VIN obtains decoder metadata before selecting manual',async()=>{
  const {fetcher,calls}=source();const result=await findManuals({vin},{fetcher});
  assert.equal(result.target,'https://charm.li/Honda/2003/Accord%20V6-3.0L/');
  assert.equal(calls.filter(url=>url.startsWith('https://vpic.nhtsa.dot.gov/')).length,1);
});
test('missing engine details and multiple matching engines remain choices instead of guessing',async()=>{
  const {fetcher}=source();const result=await findManuals({vehicleSpecs:{year:'2003',make:'Honda',model:'Accord'}},{fetcher});
  assert.equal(result.target,undefined);assert.equal(result.options.length,2);
  const variant=source({page:year+'<a href="/Honda/2003/Accord%20V6-3.0L%20Special/">Special</a>'});
  const ambiguous=await findManuals({vin,vehicleSpecs:specs},{fetcher:variant.fetcher});
  assert.equal(ambiguous.target,undefined);assert.equal(ambiguous.options.length,2);
});
test('VIN decode overrides conflicting submitted specifications and distinct model variants are not auto-selected',async()=>{
  const {fetcher}=source();const result=await findManuals({vin,vehicleSpecs:{...specs,cylinders:'4',displacement:'2.4'}},{fetcher});
  assert.equal(result.target,'https://charm.li/Honda/2003/Accord%20V6-3.0L/');
  const variant=source({page:'<a href="/Honda/2003/Accord%20Hybrid%20V6-3.0L/">Hybrid</a>'});
  const ambiguous=await findManuals({vin,vehicleSpecs:specs},{fetcher:variant.fetcher});assert.equal(ambiguous.target,undefined);
});
test('unavailable year, mismatched engines, and incomplete decoder results provide honest browse fallback',async()=>{
  const missing=source({missing:true});const result=await findManuals({vin,vehicleSpecs:specs},{fetcher:missing.fetcher});
  assert.equal(result.target,undefined);assert.equal(result.browseUrl,'https://charm.li/Honda/');
  const {fetcher}=source();const wrong=await findManuals({vehicleSpecs:{...specs,displacement:'5.7',cylinders:'8'}},{fetcher});assert.equal(wrong.options.length,0);
  const bad=source({decode:false});const incomplete=await findManuals({vin},{fetcher:bad.fetcher});assert.equal(incomplete.target,undefined);
});
test('manual selection escapes customer values and never embeds a submitted VIN in outside links',async()=>{
  const response=manualResponse({vehicle:'<script>alert(1)</script>',message:'Choose',specs:{},options:[],browseUrl:'https://charm.li/'});
  const html=await response.text();assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
  assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
});
test('temporary directory failures retry once and are distinguished from missing manual years',async()=>{
  const original=source();let attempts=0;
  const recover=async(url,options)=>{
    if(url==='https://charm.li/Honda/2003/'&&attempts++===0)return new Response('unavailable',{status:502});
    return original.fetcher(url,options);
  };
  assert.equal((await findManuals({vin},{fetcher:recover})).target,'https://charm.li/Honda/2003/Accord%20V6-3.0L/');assert.equal(attempts,2);
  const offline=async(url,options)=>url.includes('charm.li/Honda/2003/')?new Response('offline',{status:503}):original.fetcher(url,options);
  const result=await findManuals({vin},{fetcher:offline});assert.equal(result.target,undefined);assert.match(result.message,/could not be reached/);
});
