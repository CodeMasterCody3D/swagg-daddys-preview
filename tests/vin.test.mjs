import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVin, validVin, vinCandidates, decodedVehicle } from '../vin-core.js';

test('VIN normalization and photo extraction preserve characters without guessing OCR substitutions',()=>{
  const vin='1HGCM82633A004352';
  assert.equal(normalizeVin(' 1hgcm82633a004352 '),vin);
  assert.equal(validVin(vin),true);
  for (const bad of ['',vin.slice(1),vin+'2','1HGCM82633AOO4352','1HGCM82633AI04352']) assert.equal(validVin(bad),false);
  assert.deepEqual(vinCandidates('VIN: '+vin+'\nGVWR 4200 LB'),[vin]);
  assert.deepEqual(vinCandidates('*'+vin+'*'),[vin]);
  assert.deepEqual(vinCandidates('1HG CM82633A004352'),[vin]);
  assert.deepEqual(vinCandidates('VIN: '+vin+'\nVIN: 5YJSA1E26HF000337'),[vin,'5YJSA1E26HF000337']);
  assert.deepEqual(vinCandidates('VIN: 1HGCM82633AOO4352'),[]);
});
test('only complete unflagged decoder results qualify for automatic fill',()=>{
  const row={ModelYear:'2003',Make:'HONDA',Model:'Accord',EngineCylinders:'4',DisplacementL:'2.4',TransmissionStyle:'Not Applicable',ErrorCode:'0'};
  const decoded=decodedVehicle(row);
  assert.equal(decoded.vehicle,'2003 HONDA Accord'); assert.equal(decoded.complete,true); assert.equal(decoded.clean,true);
  assert.equal(decoded.specs.cylinders,'4'); assert.equal(decoded.specs.transmission,undefined);
  assert.equal(decodedVehicle({...row,ErrorCode:'1,14'}).clean,false);
  assert.equal(decodedVehicle({...row,Make:''}).complete,false);
  assert.equal(decodedVehicle(undefined).complete,false);
});

test('scanned VIN text supports label punctuation and split OCR words, with explicit correction flags',async()=>{
  const {scannedVins}=await import('../vin-core.js');const vin='1HGCM82633A004352';
  assert.deepEqual(scannedVins('VIN #: 1HG CM82633 A004352  MODEL ACCORD'),[{vin,corrected:false}]);
  assert.deepEqual(scannedVins('VIN: 1HGCM82633AOO4352'),[{vin,corrected:true}]);
  assert.deepEqual(scannedVins('VIN: 1HGCM82633AOO4352',{barcode:true}),[]);
  assert.deepEqual(scannedVins('I'+vin,{barcode:true}),[{vin,corrected:false}]);
  assert.deepEqual(scannedVins('17V'+vin,{barcode:true}),[{vin,corrected:false}]);
  assert.deepEqual(scannedVins('VIN: 12345678'),[]);
  assert.deepEqual(scannedVins('IDENTIFICATIONXYZ'),[]);
  assert.deepEqual(scannedVins('VIN: '+vin+'\nVIN: '+vin),[{vin,corrected:false}]);
});
