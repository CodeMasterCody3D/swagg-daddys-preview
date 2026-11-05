import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedVinVehicle } from '../vin-vehicle.js';
const vin='1HGCM82633A004352';
const good=()=>({complete:true,clean:true,specs:{year:'2003',make:'HONDA',model:'Accord'},vehicle:'2003 HONDA Accord'});
test('scanned VIN needs a clean vehicle with year, make and model',async()=>{
  const result=good();assert.equal(await confirmedVinVehicle(vin,async()=>result),result);
  for(const rejected of [null,{}, {...good(),clean:false},{...good(),clean:'true'},{...good(),complete:false}, {...good(),specs:{year:'2003',make:'HONDA'}},{...good(),specs:{year:'',make:'HONDA',model:'Accord'}}])
    await assert.rejects(confirmedVinVehicle(vin,async()=>rejected),/No confirmed vehicle/);
});
test('a barcode or correct check digit without vehicle data cannot succeed',async()=>{
  await assert.rejects(confirmedVinVehicle(vin,async()=>({vin,verified:true})),/No confirmed vehicle/);
});
test('bad VINs never reach the vehicle service',async()=>{
  let calls=0;await assert.rejects(confirmedVinVehicle('not a VIN',async()=>{calls++;return good();}),/17-character/);assert.equal(calls,0);
});
test('lookup failures stay failures and a subsequent retry can succeed',async()=>{
  await assert.rejects(confirmedVinVehicle(vin,async()=>{throw new Error('offline');}),/offline/);
  assert.equal((await confirmedVinVehicle(vin,async()=>good())).specs.model,'Accord');
});
test('normalization and cancellation signal reach the supplied owner/customer lookup',async()=>{
  const signal=new AbortController().signal;
  await confirmedVinVehicle('1hgcm82633a004352',async(value,options)=>{assert.equal(value,vin);assert.equal(options.signal,signal);return good();},{signal});
});
