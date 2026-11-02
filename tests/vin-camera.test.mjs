import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFeatures, pinchZoom, nextZoomStep, guideRegion } from '../vin-camera.js';
import { createLiveVinScanner } from '../vin-live.js';

test('camera zoom, flashlight and continuous focus are used only when the track reports them',()=>{
  const full=cameraFeatures({getCapabilities:()=>({zoom:{min:1,max:8,step:0.1},torch:true,focusMode:['manual','continuous']})});
  assert.deepEqual(full,{zoom:{min:1,max:8,step:0.1},torch:true,focus:true});
  const none=cameraFeatures({getCapabilities:()=>({zoom:{min:1,max:1}})});
  assert.deepEqual(none,{zoom:null,torch:false,focus:false});
  assert.deepEqual(cameraFeatures({}),{zoom:null,torch:false,focus:false});
  assert.deepEqual(cameraFeatures({getCapabilities(){throw Error('unsupported');}}),{zoom:null,torch:false,focus:false});
});

test('pinching scales zoom by finger distance, in steps, within the camera range',()=>{
  const range={min:1,max:4,step:0.1};
  assert.equal(pinchZoom(1,100,200,range),2);
  assert.equal(pinchZoom(2,200,100,range),1);
  assert.equal(pinchZoom(3,100,300,range),4);
  assert.equal(pinchZoom(1,100,50,range),1);
  assert.equal(pinchZoom(1.5,0,80,range),1.5);
  assert.equal(nextZoomStep(1,range),2);assert.equal(nextZoomStep(2,range),3);assert.equal(nextZoomStep(3,range),1);
  assert.equal(nextZoomStep(1,{min:1,max:2}),2);assert.equal(nextZoomStep(2,{min:1,max:2}),1);
});

test('the on-screen guide box maps to the matching part of a cropped (object-fit: cover) camera frame',()=>{
  // Portrait phone 400x800 showing a 1920x1080 landscape stream: the sides are cropped.
  const video={left:0,top:0,width:400,height:800},guide={left:28,top:312,width:344,height:176};
  const region=guideRegion(video,{width:1920,height:1080},guide,0);
  const scale=800/1080,shown=1920*scale,offset=(400-shown)/2;
  assert.ok(Math.abs(region.x-(28-offset)/shown)<1e-9);assert.ok(Math.abs(region.width-344/shown)<1e-9);
  assert.ok(Math.abs(region.y-312/800)<1e-9);assert.ok(Math.abs(region.height-176/800)<1e-9);
  // A 2x digital zoom (scaled element) covers half as much of the frame.
  const zoomed=guideRegion({left:-200,top:-400,width:800,height:1600},{width:1920,height:1080},guide,0);
  assert.ok(Math.abs(zoomed.width-region.width/2)<1e-9);
  // Margins never leave the frame; missing sizes give no region.
  const wide=guideRegion(video,{width:1920,height:1080},{left:-50,top:0,width:500,height:800});
  assert.ok(wide.x>=0&&wide.y>=0&&wide.x+wide.width<=1&&wide.y+wide.height<=1);
  assert.equal(guideRegion(video,{width:0,height:0},guide),null);
});

test('the live scanner hands the guide region to every read and reports the started stream',async()=>{
  const regions=[],started=[],queue=[];
  const stream={getTracks:()=>[{stop(){}}]};
  const video={readyState:2,videoWidth:1920,videoHeight:1080,currentTime:0,srcObject:null,async play(){},pause(){}};
  const region={x:.1,y:.3,width:.8,height:.4};
  const scanner=createLiveVinScanner({video,getMedia:async()=>stream,prepare:async()=>{},capture:()=>({}),score:()=>1,samplesPerRead:1,
    readFrame:async(_frame,options)=>{regions.push(options.region);return {candidates:[],diagnostics:{status:'no-vin'}};},
    region:()=>region,onStarted:s=>started.push(s),schedule:fn=>{queue.push(fn);return queue.length;},cancel:()=>{}});
  await scanner.start();
  assert.deepEqual(started,[stream]);assert.equal(scanner.stream,stream);
  await queue.shift()();video.currentTime=1;await queue.shift()();
  assert.deepEqual(regions,[region,region]);
  scanner.stop();assert.equal(scanner.stream,null);
});
