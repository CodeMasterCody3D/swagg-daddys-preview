import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveVinScanner,captureVinFrame,cameraErrorMessage} from '../vin-live.js';
import {readVinPhoto} from '../vin-reader.js';
const vin='1HGCV2F62JA012802';
const candidate=()=>({candidates:[{vin}],diagnostics:{status:'read'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(options={}){
  const queue=[],matches=[],errors=[];let stopped=0,calls=0,constraints;
  const stream={getTracks:()=>[{stop(){stopped++;}}]};
  const video={readyState:2,videoWidth:1920,videoHeight:1080,srcObject:null,async play(){},pause(){}};
  const controller=createLiveVinScanner({video,getMedia:async c=>{constraints=c;return stream;},readFrame:async()=>{calls++;return candidate();},capture:()=>({frame:true}),schedule:fn=>{queue.push(fn);return fn;},cancel:fn=>{const index=queue.indexOf(fn);if(index>=0)queue.splice(index,1);},onMatch:(v,r)=>matches.push({vin:v,result:r}),onError:e=>errors.push(e),...options});
  return {controller,video,stream,queue,matches,errors,get stopped(){return stopped;},get calls(){return calls;},get constraints(){return constraints;},async tick(){const fn=queue.shift();assert.ok(fn,'scheduled frame exists');await fn();}};
}
test('live camera requests rear video only, confirms two frames, then releases camera and fills once',async()=>{
  const f=fixture();await f.controller.start();assert.equal(f.constraints.audio,false);assert.equal(f.constraints.video.facingMode.ideal,'environment');
  await f.tick();assert.equal(f.matches.length,0);await f.tick();assert.equal(f.matches[0].vin,vin);assert.equal(f.matches.length,1);assert.equal(f.stopped,1);assert.equal(f.video.srcObject,null);assert.equal(f.controller.active,false);assert.equal(f.queue.length,0);
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
