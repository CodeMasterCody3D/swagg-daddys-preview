import test from 'node:test';
import assert from 'node:assert/strict';
import { readVinPhoto } from '../vin-reader.js';

const vin='1HGCM82633A004352';
const result=(values=[],warnings=[])=>({candidates:values.map(value=>({vin:value,corrected:false})),rawText:values.join('\n'),warnings});
const unexpected=async()=>assert.fail('This reader must not be called');

test('a complete barcode fills the result without waiting for Google or sending the photo',async()=>{
  const barcode=result([vin]);
  const answer=await readVinPhoto({}, {googleAvailable:new Promise(()=>{})},{barcode:async()=>barcode,google:unexpected,text:unexpected});
  assert.equal(answer,barcode);
});

test('a photo without a VIN barcode automatically reaches Google with the same crop',async()=>{
  const calls=[],photo={},rectangle={x:10,y:20,width:200,height:40},messages=[];
  const answer=await readVinPhoto(photo,{googleAvailable:Promise.resolve(true),rectangle,api:'/api',progress:message=>messages.push(message)},{
    barcode:async(source,options)=>{calls.push('barcode');assert.equal(source,photo);assert.equal(options.rectangle,rectangle);return result();},
    google:async(source,options)=>{calls.push('google');assert.equal(source,photo);assert.equal(options.rectangle,rectangle);assert.equal(options.api,'/api');return result([vin]);},
    text:unexpected
  });
  assert.deepEqual(calls,['barcode','google']);assert.equal(answer.candidates[0].vin,vin);
  assert.ok(messages.some(message=>message.includes('Switching to Google Lens')));
});

test('multiple barcode VINs remain review choices without sending the image to Google',async()=>{
  const barcode=result([vin,'5YJ3E1EA7KF317000']);
  const answer=await readVinPhoto({}, {googleAvailable:true},{barcode:async()=>barcode,google:unexpected,text:unexpected});
  assert.equal(answer,barcode);assert.equal(answer.candidates.length,2);
});

test('when Google is disabled a barcode miss uses local text recognition',async()=>{
  const calls=[];
  const answer=await readVinPhoto({}, {googleAvailable:Promise.resolve(false)},{
    barcode:async()=>{calls.push('barcode');return result();},google:unexpected,
    text:async()=>{calls.push('text');return result([vin]);}
  });
  assert.deepEqual(calls,['barcode','text']);assert.equal(answer.candidates[0].vin,vin);
});

test('an unavailable barcode reader can fall through to Google and preserves its warning',async()=>{
  const answer=await readVinPhoto({}, {googleAvailable:true},{barcode:async()=>result([],['The barcode reader was unavailable.']),google:async()=>result([vin]),text:unexpected});
  assert.equal(answer.candidates[0].vin,vin);assert.match(answer.warnings[0],/barcode reader/);
});

test('Google verification errors stop after one attempt without a hidden retry',async()=>{
  let calls=0;
  await assert.rejects(readVinPhoto({}, {googleAvailable:true},{barcode:async()=>result(),google:async()=>{calls++;throw new Error('Google requires verification.');},text:unexpected}),/requires verification/);
  assert.equal(calls,1);
});

test('barcode diagnostics survive both successful and failed Google fallback',async()=>{
  const diagnostics={version:'cubic-2',status:'unavailable',passes:[],symbols:[],error:'Barcode engine could not start.'};
  const barcode=async()=>({...result(),diagnostics});
  const answer=await readVinPhoto({}, {googleAvailable:true},{barcode,google:async()=>result([vin]),text:unexpected});
  assert.deepEqual(answer.barcodeCheck,diagnostics);
  await assert.rejects(readVinPhoto({}, {googleAvailable:true},{barcode,google:async()=>{throw new Error('Google unavailable');},text:unexpected}),error=>error.barcodeCheck===diagnostics);
});
