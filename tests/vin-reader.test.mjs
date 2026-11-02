import test from 'node:test';
import assert from 'node:assert/strict';
import { readVinPhoto } from '../vin-reader.js';

const vin='1HGCM82633A004352';
const result=(values=[],warnings=[])=>({candidates:values.map(value=>({vin:value,corrected:false})),rawText:values.join('\n'),warnings});
const never=()=>new Promise(()=>{});
const onlyReal=async value=>value===vin;   // stands in for the NHTSA check

test('a complete barcode wins immediately, without waiting for Lens or printed text',async()=>{
  const barcode=result([vin]);
  const answer=await readVinPhoto({}, {googleAvailable:never(),verify:onlyReal},{barcode:async()=>barcode,google:never,text:never});
  assert.equal(answer,barcode);
});

test('all three readers start together and get the same photo and crop; a Lens VIN with a good check digit wins',async()=>{
  const calls=[],photo={},rectangle={x:10,y:20,width:200,height:40},messages=[];
  const answer=await readVinPhoto(photo,{googleAvailable:Promise.resolve(true),rectangle,api:'/api',verify:onlyReal,progress:message=>messages.push(message)},{
    barcode:async(source,options)=>{calls.push('barcode');assert.equal(source,photo);assert.equal(options.rectangle,rectangle);return result();},
    google:async(source,options)=>{calls.push('google');assert.equal(source,photo);assert.equal(options.rectangle,rectangle);assert.equal(options.api,'/api');return result([vin]);},
    text:async(source,options)=>{calls.push('text');assert.equal(source,photo);assert.equal(options.rectangle,rectangle);return never();}
  });
  assert.deepEqual(calls.sort(),['barcode','google','text']);assert.equal(answer.candidates[0].vin,vin);
  assert.ok(messages.some(message=>message.includes('Google Lens')));
});

test('whichever reader lands first wins: fast confirmed printed text beats a slow Lens',async()=>{
  const answer=await readVinPhoto({}, {googleAvailable:true,verify:onlyReal},{barcode:async()=>result(),google:never,text:async()=>result([vin])});
  assert.equal(answer.candidates[0].vin,vin);
});

test('multiple barcode VINs remain review choices',async()=>{
  const barcode=result([vin,'5YJ3E1EA7KF317000']);
  const answer=await readVinPhoto({}, {googleAvailable:true,verify:onlyReal},{barcode:async()=>barcode,google:never,text:never});
  assert.equal(answer,barcode);assert.equal(answer.candidates.length,2);
});

test('printed text needs NHTSA to confirm the VIN; a misread C-as-0 is fixed only when the fix is a real car',async()=>{
  const fixed=await readVinPhoto({}, {googleAvailable:false,verify:onlyReal},{barcode:async()=>result(),google:never,text:async()=>result(['1HG0M82633A004352'])});
  assert.deepEqual(fixed.candidates,[{vin,corrected:true,verified:true}]);
  // Nothing verifies (e.g. NHTSA offline): the text reading comes back for the customer to review, unchanged.
  const unverified=await readVinPhoto({}, {googleAvailable:false,verify:async()=>false},{barcode:async()=>result(),google:never,text:async()=>result([vin])});
  assert.equal(unverified.candidates[0].vin,vin);assert.equal(unverified.candidates[0].verified,undefined);
});

test('an unavailable barcode reader still lets Lens answer and keeps its warning',async()=>{
  const answer=await readVinPhoto({}, {googleAvailable:true,verify:onlyReal},{barcode:async()=>result([],['The barcode reader was unavailable.']),google:async()=>result([vin]),text:async()=>result()});
  assert.equal(answer.candidates[0].vin,vin);assert.match(answer.warnings[0],/barcode reader/);
});

test('a Lens verification error is reported once (no hidden retry) when no other reader finds a VIN',async()=>{
  let calls=0;
  await assert.rejects(readVinPhoto({}, {googleAvailable:true,verify:onlyReal},{barcode:async()=>result(),google:async()=>{calls++;throw new Error('Google requires verification.');},text:async()=>result()}),/requires verification/);
  assert.equal(calls,1);
});

test('barcode diagnostics survive both successful and failed Lens reads',async()=>{
  const diagnostics={version:'cubic-2',status:'unavailable',passes:[],symbols:[],error:'Barcode engine could not start.'};
  const barcode=async()=>({...result(),diagnostics});
  const answer=await readVinPhoto({}, {googleAvailable:true,verify:onlyReal},{barcode,google:async()=>result([vin]),text:never});
  assert.deepEqual(answer.barcodeCheck,diagnostics);
  await assert.rejects(readVinPhoto({}, {googleAvailable:true,verify:onlyReal},{barcode,google:async()=>{throw new Error('Google unavailable');},text:async()=>result()}),error=>error.barcodeCheck===diagnostics);
});
