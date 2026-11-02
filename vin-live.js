import { scanVinLiveFrame, createLiveVinTextReader, prepareVinBarcodeReader } from './vin-scan.js';
import { normalizeVin, validVin, vinCheckDigit } from './vin-core.js';
import { createVinVerifier, resolveVin } from './vin-repair.js';

export function cameraErrorMessage(error) {
  if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return 'Camera access was not allowed. Enable camera access for this website, choose a VIN photo, or enter the VIN.';
  if(error?.name==='NotFoundError'||error?.name==='DevicesNotFoundError')return 'No camera was found. Choose a VIN photo or enter the VIN.';
  if(error?.name==='NotReadableError')return 'The camera is busy or could not start. Close other camera apps and try again, or choose a VIN photo.';
  return error?.message||'Live scanning could not start. Choose a VIN photo or enter the VIN.';
}
export function captureVinFrame(video,makeCanvas=()=>document.createElement('canvas')) {
  if(!video.videoWidth||!video.videoHeight||video.readyState<2)throw Error('Wait for the camera picture before reading a frame.');
  const scale=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
  const canvas=makeCanvas();canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  canvas.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0,canvas.width,canvas.height);return canvas;
}
export function frameSharpness({data,width,height}) {
  if(width<3||height<3)return 0;
  const grey=new Float32Array(width*height);for(let i=0;i<grey.length;i++)grey[i]=data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114;
  let sum=0,squares=0,count=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x,edge=4*grey[i]-grey[i-1]-grey[i+1]-grey[i-width]-grey[i+width];sum+=edge;squares+=edge*edge;count++;}
  return Math.max(0,squares/count-(sum/count)**2);
}
export function scoreVinFrame(frame) {
  const probe=document.createElement('canvas');probe.width=240;probe.height=120;
  const ctx=probe.getContext('2d',{willReadFrequently:true});ctx.drawImage(frame,frame.width*.2,frame.height*.2,frame.width*.6,frame.height*.6,0,0,240,120);
  return frameSharpness(ctx.getImageData(0,0,240,120));
}

// One local decode at a time. Stop invalidates pending permission/play/decode work,
// so a late camera grant or barcode result cannot reopen the camera or overwrite a VIN.
export function createLiveVinScanner({video,getMedia=constraints=>navigator.mediaDevices.getUserMedia(constraints),prepare=prepareVinBarcodeReader,readFrame=scanVinLiveFrame,makeTextReader=createLiveVinTextReader,textAfterMisses=1,verify=createVinVerifier(),lens=null,lensAfterMs=4000,lensSchedule=setTimeout,lensCancel=clearTimeout,capture=captureVinFrame,score=scoreVinFrame,samplesPerRead=3,sampleIntervalMs=100,schedule=setTimeout,cancel=clearTimeout,onStatus=()=>{},onMatch=()=>{},onError=()=>{},onFrame=()=>{},onSample=()=>{},onStarted=()=>{},region=()=>null}) {
  let lensTimer=null,lensUsed=false,textBusy=false,readings=[],textSeen=new Map(),generation=0,stream=null,task=null,running=false,lastVin='',hits=0,frames=0,samples=0,totalSamples=0,best=null,bestScore=-1,idle=0,misses=0,textReader=null,textAttempts=0,textUnavailable=false,lastVideoTime=null;
  const release=value=>{for(const track of value?.getTracks()||[])track.stop();};
  function closeText(){const previous=textReader;textReader=null;try{Promise.resolve(previous?.close()).catch(()=>{});}catch{}}
  function stop(){generation++;running=false;if(task!==null)cancel(task);task=null;if(lensTimer!==null)lensCancel(lensTimer);lensTimer=null;textBusy=false;readings=[];textSeen=new Map();release(stream);stream=null;video.pause();video.srcObject=null;lastVin='';hits=0;best=null;bestScore=-1;samples=0;idle=0;misses=0;lastVideoTime=null;closeText();}
  async function start(){
    stop();const run=generation;running=true;frames=0;totalSamples=0;textAttempts=0;textUnavailable=false;lensUsed=false;onStatus('Allow camera access to start the live VIN scan.');
    // Do not put the engine download after camera permission or the first sample.
    // Warm-up failure is handled by the normal reader path, not an unhandled promise.
    try{Promise.resolve(prepare()).catch(()=>{});}catch{}
    try{
      const acquired=await getMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
      if(!running||run!==generation){release(acquired);return;}
      stream=acquired;for(const track of stream.getTracks())track.addEventListener?.('ended',()=>{if(run===generation&&running){stop();onError(Error('The camera stopped. Tap Live scan VIN to try again.'));}},{once:true});
      video.srcObject=stream;await video.play();
      if(!running||run!==generation)return;
      onStarted(stream);
      const live=()=>running&&run===generation;
      const accept=(vin,method,corrected,extra={})=>{if(!live())return;stop();onMatch(vin,{candidates:[{vin,method,corrected}],...extra});};
      // A text or Lens reading becomes the VIN when it can be trusted: Lens with a correct
      // check digit; text when NHTSA confirms it, or when two reads agree exactly (works
      // offline). Readings from several frames are combined and lookalike characters
      // (C/0, S/5, B/8...) repaired, but a repair is only used if NHTSA confirms it.
      function consider(candidates,method,extra){
        const vins=[...new Set((candidates||[]).map(c=>normalizeVin(c.vin)).filter(Boolean))];
        if(!vins.length||!live())return;
        const exact=(candidates||[]).filter(c=>!c.corrected&&vinCheckDigit(normalizeVin(c.vin)).status==='match').map(c=>normalizeVin(c.vin));
        if(new Set(exact).size>1)return; // two different VINs in one reading: never guess
        if(method==='lens'&&exact.length)return accept(exact[0],method,false,extra);
        if(exact.length){const seen=(textSeen.get(exact[0])||0)+1;textSeen.set(exact[0],seen);if(seen>=2)return accept(exact[0],method,false,extra);}
        readings=[...readings,...vins].slice(-8);
        const snapshot=readings;
        void (async()=>{
          if(exact.length&&await verify(exact[0]).catch(()=>false))return accept(exact[0],method,false,extra);
          const fixed=await resolveVin(snapshot,verify).catch(()=>null);
          if(fixed)accept(fixed.vin,method,fixed.repaired,extra);
        })();
      }
      function readText(frame,barcodeCheck){
        textBusy=true;onStatus('Reading the printed VIN too, while the barcode scan continues…');
        try{textReader??=makeTextReader();}catch{textBusy=false;textUnavailable=true;return;}
        textAttempts++;
        Promise.resolve().then(()=>textReader.read(frame)).then(text=>{if(live())consider(text.candidates,'text',{rawText:text.rawText,barcodeCheck});},
          ()=>{if(!live())return;textUnavailable=true;closeText();})
          .finally(()=>{if(live())textBusy=false;});
      }
      // If the on-phone readers haven't found it after a few seconds, Google Lens reads one frame.
      if(lens)lensTimer=lensSchedule(()=>{
        lensTimer=null;if(!live()||lensUsed)return;lensUsed=true;
        let frame;try{frame=capture(video);}catch{return;}
        onStatus('Still looking — Google Lens is reading this frame too…');
        Promise.resolve().then(()=>lens(frame)).then(result=>{if(live()&&result)consider(result.candidates,'lens',{lens:true});}).catch(()=>{});
      },lensAfterMs);
      onStatus('Aim at the whole VIN barcode and hold steady. Scanning automatically…');
      async function tick(){
        task=null;if(!running||run!==generation)return;
        try{
          const fresh=!Number.isFinite(video.currentTime)||video.currentTime!==lastVideoTime;
          if(video.readyState>=2&&video.videoWidth&&video.videoHeight&&fresh){
            lastVideoTime=video.currentTime;
            idle=0;const sample=capture(video),quality=score(sample);samples++;totalSamples++;
            if(quality>=bestScore){best=sample;bestScore=quality;}
            onSample({samples:totalSamples,attempts:frames,textAttempts,width:video.videoWidth,height:video.videoHeight});
            // Read the first available frame immediately. Confirm a candidate on
            // the next fresh frame; collect a short sharpness burst after a miss.
            const needed=frames===0||lastVin?1:samplesPerRead;
            if(samples<needed){task=schedule(tick,sampleIntervalMs);return;}
            const selected=best,selectedScore=bestScore;best=null;bestScore=-1;samples=0;frames++;
            const enhance=true;let result=await readFrame(selected,{enhance,region:region()});
            if(!running||run!==generation)return;
            if(result.diagnostics?.status==='unavailable')throw Error('The barcode reader could not start. Choose a VIN photo or enter the VIN.');
            if(result.candidates?.length)misses=0;
            // Printed text runs alongside the barcode reader (it never pauses it).
            else if(++misses>=textAfterMisses&&!textUnavailable&&!textBusy)readText(selected,result.diagnostics);
            onFrame(result,{frames,enhance,samples:totalSamples,sharpness:selectedScore,textAttempts});
            const vins=[...new Set((result.candidates||[]).map(c=>normalizeVin(c.vin)).filter(validVin))];
            if(vins.length===1){hits=vins[0]===lastVin?hits+1:1;lastVin=vins[0];onStatus(result.candidates[0]?.method==='text'?'Printed VIN found. Hold steady to confirm…':'Barcode found. Hold steady to confirm…');if(hits>=2){const vin=lastVin;stop();onMatch(vin,result);return;}}
            else {hits=0;lastVin='';onStatus(vins.length>1?'More than one VIN is visible. Aim at one barcode.':'Aim at the whole VIN barcode and hold steady. Scanning automatically…');}
          }else if((idle+=sampleIntervalMs)>=10000)throw Error('The camera is not delivering video frames. Stop and restart the camera, or choose a VIN photo.');
        }catch(error){if(run===generation){stop();onError(error);}return;}
        if(running&&run===generation)task=schedule(tick,sampleIntervalMs);
      }
      task=schedule(tick,0);
    }catch(error){if(run===generation){stop();onError(error);}}
  }
  return {start,stop,get active(){return running;},get stream(){return stream;},capture:()=>capture(video)};
}
