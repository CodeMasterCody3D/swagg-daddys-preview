import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVinScanner,captureVinFrame,cameraErrorMessage,frameSharpness} from '../vin-live.js';
import {readVinPhoto} from '../vin-reader.js';
const vin='1HGCV2F62JA012802';
const candidate=()=>({candidates:[{vin}],diagnostics:{status:'read'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(options={}){
  const queue=[],matches=[],errors=[],delays=[];let stopped=0,calls=0,constraints;
  const stream={getTracks:()=>[{stop(){stopped++;}}]};
  const video={readyState:2,videoWidth:1920,videoHeight:1080,srcObject:null,async play(){},pause(){}};
  const controller=createLiveVinScanner({video,getMedia:async c=>{constraints=c;return stream;},prepare:async()=>{},readFrame:async()=>{calls++;return candidate();},capture:()=>({frame:true}),score:()=>1,samplesPerRead:1,schedule:(fn,delay)=>{queue.push(fn);delays.push(delay);return fn;},cancel:fn=>{const index=queue.indexOf(fn);if(index>=0)queue.splice(index,1);},onMatch:(v,r)=>matches.push({vin:v,result:r}),onError:e=>errors.push(e),...options});
  return {controller,video,stream,queue,matches,errors,delays,get stopped(){return stopped;},get calls(){return calls;},get constraints(){return constraints;},async tick(){const fn=queue.shift();assert.ok(fn,'scheduled frame exists');await fn();}};
}
test('live camera requests rear video only, confirms two frames, then releases camera and fills once',async()=>{
  const f=fixture();await f.controller.start();assert.equal(f.constraints.audio,false);assert.equal(f.constraints.video.facingMode.ideal,'environment');
  await f.tick();assert.equal(f.matches.length,0);await f.tick();assert.equal(f.matches[0].vin,vin);assert.equal(f.matches.length,1);assert.equal(f.stopped,1);assert.equal(f.video.srcObject,null);assert.equal(f.controller.active,false);assert.equal(f.queue.length,0);
});
test('a VIN that requires enhanced scanning can confirm on the next frame without Google',async()=>{
  const passes=[];
  const f=fixture({readFrame:async(_frame,{enhance})=>{passes.push(enhance);return enhance?candidate():{candidates:[],diagnostics:{status:'no-vin'}};}});
  await f.controller.start();for(let i=0;i<2;i++)await f.tick();
  assert.deepEqual(passes,[true,true]);
  assert.equal(f.matches.length,1);assert.equal(f.matches[0].vin,vin);assert.equal(f.stopped,1);
});
test('first frame reads immediately; after a miss a 300 ms burst chooses the sharpest sample',async()=>{
  const samples=[{quality:1},{quality:5},{quality:20},{quality:3}],selected=[];
  const f=fixture({samplesPerRead:3,capture:()=>samples.shift(),score:frame=>frame.quality,readFrame:async frame=>{selected.push(frame);return {candidates:[]};}});
  await f.controller.start();assert.equal(f.delays[0],0);await f.tick();assert.equal(selected.length,1);
  await f.tick();await f.tick();assert.equal(selected.length,1);await f.tick();
  assert.equal(selected.length,2);assert.equal(selected[1].quality,20);assert.deepEqual(f.delays.slice(1,4),[100,100,100]);f.controller.stop();
});
test('a candidate confirms on the next fresh frame without waiting for another sampling burst',async()=>{
  const f=fixture({samplesPerRead:3});await f.controller.start();await f.tick();assert.equal(f.matches.length,0);
  assert.equal(f.delays.at(-1),100);await f.tick();assert.equal(f.matches.length,1);assert.equal(f.calls,2);
});
test('a repeated video timestamp cannot count as a second confirming camera frame',async()=>{
  const f=fixture();f.video.currentTime=1;await f.controller.start();await f.tick();await f.tick();
  assert.equal(f.calls,1);assert.equal(f.matches.length,0);f.video.currentTime=1.1;await f.tick();assert.equal(f.matches.length,1);
});
test('engine preparation overlaps camera permission and does not delay camera startup',async()=>{
  const warm=deferred(),permission=deferred();const events=[];
  const f=fixture({prepare:()=>{events.push('prepare');return warm.promise;},getMedia:()=>{events.push('camera');return permission.promise;}});
  const start=f.controller.start();assert.deepEqual(events,['prepare','camera']);permission.resolve(f.stream);await start;
  assert.equal(f.controller.active,true);f.controller.stop();warm.resolve();
});
test('sharpness ranks a crisp edge above a smoothed edge, without accepting a VIN from sharpness alone',()=>{
  const pixels=smooth=>{const width=24,height=12,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=smooth?Math.min(255,Math.max(0,(x-7)*28)):(x<12?0:255);const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}return {width,height,data};};
  assert.ok(frameSharpness(pixels(false))>frameSharpness(pixels(true)));assert.equal(frameSharpness({width:4,height:4,data:new Uint8ClampedArray(64)}),0);
});
test('a camera that never delivers frames stops with an explicit error',async()=>{
  const f=fixture();f.video.readyState=0;await f.controller.start();for(let i=0;i<100;i++)await f.tick();
  assert.match(f.errors[0].message,/not delivering video frames/);assert.equal(f.controller.active,false);assert.equal(f.stopped,1);
});
test('closing during permission prevents a late grant reopening the camera',async()=>{
  const permission=deferred();const f=fixture({getMedia:()=>permission.promise});const started=f.controller.start();f.controller.stop();permission.resolve(f.stream);await started;
  assert.equal(f.video.srcObject,null);assert.equal(f.stopped,1);assert.equal(f.queue.length,0);assert.equal(f.matches.length,0);
});
test('closing during decode ignores a late VIN and never schedules another frame',async()=>{
  const decode=deferred();const f=fixture({readFrame:()=>decode.promise});await f.controller.start();const tick=f.tick();f.controller.stop();decode.resolve(candidate());await tick;
  assert.equal(f.matches.length,0);assert.equal(f.queue.length,0);assert.equal(f.stopped,1);
});
test('barcode misses, invalid VINs, and multiple VINs cannot become an automatic match',async()=>{
  const results=[candidate(),{candidates:[]},candidate(),{candidates:[{vin},{vin:'1HGCP26869A143139'}]},candidate(),{candidates:[{vin:'not-a-vin'}]},candidate(),candidate()];
  const f=fixture({readFrame:async()=>results.shift()});await f.controller.start();for(let i=0;i<7;i++){await f.tick();assert.equal(f.matches.length,0);}await f.tick();assert.equal(f.matches.length,1);
});
test('decode failure stops the camera and reports an error; permission denial remains recoverable',async()=>{
  const f=fixture({readFrame:async()=>{throw Error('Reader failed');}});await f.controller.start();await f.tick();assert.equal(f.stopped,1);assert.equal(f.errors.length,1);assert.equal(f.controller.active,false);
  const denied=fixture({getMedia:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'});}});await denied.controller.start();assert.match(cameraErrorMessage(denied.errors[0]),/not allowed/);assert.equal(denied.queue.length,0);
});
test('Take photo captures the displayed frame at bounded size without uploading it',()=>{
  let drawn;const canvas={getContext:()=>({drawImage:(...args)=>{drawn=args;}})};
  const video={readyState:2,videoWidth:3840,videoHeight:2160};const frame=captureVinFrame(video,()=>canvas);
  assert.equal(frame.width,1920);assert.equal(frame.height,1080);assert.equal(drawn[0],video);
  assert.throws(()=>captureVinFrame({...video,readyState:0},()=>canvas),/Wait for the camera/);
});
test('a captured camera frame without a barcode follows the existing Google Lens handoff',async()=>{
  const canvas={getContext:()=>({drawImage(){}})};const frame=captureVinFrame({readyState:2,videoWidth:1280,videoHeight:720},()=>canvas);const calls=[];
  const result=await readVinPhoto(frame,{googleAvailable:true,api:'/api'},{barcode:async source=>{assert.equal(source,frame);calls.push('barcode');return {candidates:[],warnings:[]};},google:async source=>{assert.equal(source,frame);calls.push('google');return {...candidate(),warnings:[]};},text:async()=>assert.fail('Google is available')});
  assert.deepEqual(calls,['barcode','google']);assert.equal(result.candidates[0].vin,vin);
});

test('live scan tries barcodes first, then confirms exact local text twice without a Google call',async()=>{
  const events=[];let closed=0;
  const f=fixture({readFrame:async()=>{events.push('barcode');return {candidates:[],diagnostics:{status:'no-vin'}};},makeTextReader:()=>({read:async()=>{events.push('text');return {candidates:[{vin,corrected:false}]};},close(){closed++;}})});
  await f.controller.start();await f.tick();await f.tick();assert.deepEqual(events,['barcode','barcode']);
  await f.tick();assert.equal(f.matches.length,0);await f.tick();
  assert.deepEqual(events,['barcode','barcode','barcode','text','barcode','text']);
  assert.equal(f.matches[0].vin,vin);assert.equal(f.matches[0].result.candidates[0].method,'text');assert.equal(f.matches[0].result.barcodeCheck.status,'no-vin');assert.equal(closed,1);assert.equal(f.stopped,1);
});

test('corrected, checksum-invalid and ambiguous printed VINs never auto-fill',async()=>{
  const results=[{candidates:[{vin,corrected:true}]},{candidates:[{vin:'1HGCV2F62JA012803',corrected:false}]},{candidates:[{vin,corrected:false},{vin:'5J6YH287X8L000133',corrected:false}]}];
  const f=fixture({textAfterMisses:1,readFrame:async()=>({candidates:[],diagnostics:{status:'no-vin'}}),makeTextReader:()=>({read:async()=>results.shift(),close(){}})});
  await f.controller.start();for(let i=0;i<3;i++){await f.tick();assert.equal(f.matches.length,0);}f.controller.stop();
});

test('a local OCR failure leaves barcode scanning usable and does not repeatedly restart OCR',async()=>{
  let textCalls=0,closed=0,barcodes=0;
  const f=fixture({textAfterMisses:1,readFrame:async()=>++barcodes>=3?candidate():{candidates:[],diagnostics:{status:'no-vin'}},makeTextReader:()=>({read:async()=>{textCalls++;throw Error('Worker unavailable');},close(){closed++;}})});
  await f.controller.start();for(let i=0;i<4;i++)await f.tick();
  assert.equal(textCalls,1);assert.equal(closed,1);assert.equal(f.errors.length,0);assert.equal(f.matches[0].vin,vin);
});

test('stopping during local OCR closes its worker and suppresses a late match',async()=>{
  const text=deferred();let closed=0;
  const f=fixture({textAfterMisses:1,readFrame:async()=>({candidates:[],diagnostics:{status:'no-vin'}}),makeTextReader:()=>({read:()=>text.promise,close(){closed++;}})});
  await f.controller.start();const tick=f.tick();await Promise.resolve();f.controller.stop();text.resolve({candidates:[{vin,corrected:false}]});await tick;
  assert.equal(closed,1);assert.equal(f.matches.length,0);assert.equal(f.queue.length,0);assert.equal(f.errors.length,0);
});

test('readable barcodes never load the live text worker',async()=>{
  const f=fixture({makeTextReader:()=>assert.fail('Text worker must remain lazy')});
  await f.controller.start();await f.tick();await f.tick();assert.equal(f.matches[0].vin,vin);
});
