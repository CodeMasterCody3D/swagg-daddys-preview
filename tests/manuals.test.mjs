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
    if(url==='https://lemon-manuals.la/')return new Response(root);
    if(url==='https://lemon-manuals.la/Honda/2003/')return new Response(page,{status:missing?404:200});
    throw Error('Unexpected destination: '+url);
  };
  return {calls,fetcher};
}
test('VIN-derived engine identifies the exact listed LEMON manual without sending the VIN to LEMON',async()=>{
  const {fetcher,calls}=source();
  const result=await findManuals({vin,vehicleSpecs:specs},{fetcher});
  assert.equal(result.target,'https://lemon-manuals.la/Honda/2003/Accord%20V6-3.0L/');
  assert.ok(calls.filter(url=>url.startsWith('https://lemon-manuals.la/')).every(url=>!url.includes(vin)));
  const response=manualResponse(result);
  assert.equal(response.status,303);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('older request with only VIN obtains decoder metadata before selecting manual',async()=>{
  const {fetcher,calls}=source();const result=await findManuals({vin},{fetcher});
  assert.equal(result.target,'https://lemon-manuals.la/Honda/2003/Accord%20V6-3.0L/');
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
  assert.equal(result.target,'https://lemon-manuals.la/Honda/2003/Accord%20V6-3.0L/');
  const variant=source({page:'<a href="/Honda/2003/Accord%20Hybrid%20V6-3.0L/">Hybrid</a>'});
  const ambiguous=await findManuals({vin,vehicleSpecs:specs},{fetcher:variant.fetcher});assert.equal(ambiguous.target,undefined);
});
test('unavailable year, mismatched engines, and incomplete decoder results provide honest browse fallback',async()=>{
  const missing=source({missing:true});const result=await findManuals({vin,vehicleSpecs:specs},{fetcher:missing.fetcher});
  assert.equal(result.target,undefined);assert.equal(result.browseUrl,'https://lemon-manuals.la/Honda/');
  const {fetcher}=source();const wrong=await findManuals({vehicleSpecs:{...specs,displacement:'5.7',cylinders:'8'}},{fetcher});assert.equal(wrong.options.length,0);
  const bad=source({decode:false});const incomplete=await findManuals({vin},{fetcher:bad.fetcher});assert.equal(incomplete.target,undefined);
});
test('manual selection escapes customer values and never embeds a submitted VIN in outside links',async()=>{
  const response=manualResponse({vehicle:'<script>alert(1)</script>',message:'Choose',specs:{},options:[],browseUrl:'https://lemon-manuals.la/'});
  const html=await response.text();assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
  assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
});
test('temporary directory failures retry once and are distinguished from missing manual years',async()=>{
  const original=source();let attempts=0;
  const recover=async(url,options)=>{
    if(url==='https://lemon-manuals.la/Honda/2003/'&&attempts++===0)return new Response('unavailable',{status:502});
    return original.fetcher(url,options);
  };
  assert.equal((await findManuals({vin},{fetcher:recover})).target,'https://lemon-manuals.la/Honda/2003/Accord%20V6-3.0L/');assert.equal(attempts,2);
  const offline=async(url,options)=>url.includes('lemon-manuals.la/Honda/2003/')?new Response('offline',{status:503}):original.fetcher(url,options);
  const result=await findManuals({vin},{fetcher:offline});assert.equal(result.target,undefined);assert.match(result.message,/could not be reached/);
  const html=await manualResponse(result).text();
  assert.match(html,/href="https:\/\/charm\.li\/" rel="noreferrer">Open CHARM backup manuals/);
  assert.match(html,/Browse vehicle manuals on LEMON/);
  assert.ok(!html.includes(vin));
});
test('newer LEMON engine and drivetrain listings remain choices when trim is unverified',async()=>{
  const entries=['F-150 King Ranch, 3.0L Eng VIN 1, 4WD','F-150 King Ranch, 3.0L Eng VIN 1, RWD','F-150 King Ranch, 5.0L Eng VIN 5, 4WD','F-250 Super Duty King Ranch, 3.0L Eng VIN 1, 4WD'];
  const html=entries.map(label=>'<a href="/Ford/2018/'+encodeURIComponent(label)+'/">'+label+'</a>').join('');
  const fetcher=async url=>{
    assert.equal(url,'https://lemon-manuals.la/Ford/2018/');
    return new Response(html);
  };
  const vehicleSpecs={year:'2018',make:'Ford',model:'F-150',displacement:'3.0',cylinders:'6',drive:'4WD/4x4'};
  const result=await findManuals({vehicleSpecs},{fetcher});
  assert.equal(result.options.length,1);
  assert.equal(result.options[0].label,entries[0]);
  assert.equal(result.target,undefined);
  const rear=await findManuals({vehicleSpecs:{...vehicleSpecs,drive:'Rear-Wheel Drive (RWD)'}},{fetcher});
  assert.deepEqual(rear.options.map(option=>option.label),[entries[1]]);
});
test('LEMON makes added beyond the legacy collection can return current model-year manuals',async()=>{
  const fetcher=async url=>{
    assert.equal(url,'https://lemon-manuals.la/Tesla/2025/');
    return new Response('<a href="/Tesla/2025/Model%20Y%20Long%20Range/">Long Range</a>');
  };
  const result=await findManuals({vehicleSpecs:{year:'2025',make:'TESLA',model:'Model Y'}},{fetcher});
  assert.equal(result.options.length,1);
  assert.equal(result.options[0].url,'https://lemon-manuals.la/Tesla/2025/Model%20Y%20Long%20Range/');
  assert.equal(result.target,undefined);
});
test('manual matches use only LEMON directory links, keeping other hosts out of automatic redirects',async()=>{
  const external='<a href="https://charm.li/Honda/2003/Accord%20V6-3.0L/">Old source</a><a href="https://lemon-manuals.la.evil.example/Honda/2003/Accord%20V6-3.0L/">Wrong host</a><a href="https://user@lemon-manuals.la/Honda/2003/Accord%20V6-3.0L/">Credentials</a>';
  const {fetcher}=source({page:external+year});
  const result=await findManuals({vin},{fetcher});
  assert.equal(result.options.length,1);
  assert.equal(result.target,'https://lemon-manuals.la/Honda/2003/Accord%20V6-3.0L/');
});
