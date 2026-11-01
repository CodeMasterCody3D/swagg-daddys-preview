import { scanVinLiveFrame } from './vin-scan.js';
import { normalizeVin, validVin } from './vin-core.js';

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

// One local decode at a time. Stop invalidates pending permission/play/decode work,
// so a late camera grant or barcode result cannot reopen the camera or overwrite a VIN.
export function createLiveVinScanner({video,getMedia=constraints=>navigator.mediaDevices.getUserMedia(constraints),readFrame=scanVinLiveFrame,capture=captureVinFrame,schedule=setTimeout,cancel=clearTimeout,onStatus=()=>{},onMatch=()=>{},onError=()=>{},onFrame=()=>{}}) {
  let generation=0,stream=null,task=null,running=false,lastVin='',hits=0,frames=0;
  const release=value=>{for(const track of value?.getTracks()||[])track.stop();};
  function stop(){generation++;running=false;if(task!==null)cancel(task);task=null;release(stream);stream=null;video.pause();video.srcObject=null;lastVin='';hits=0;}
  async function start(){
    stop();const run=generation;running=true;frames=0;onStatus('Allow camera access to start the live VIN scan.');
    try{
      const acquired=await getMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
      if(!running||run!==generation){release(acquired);return;}
      stream=acquired;for(const track of stream.getTracks())track.addEventListener?.('ended',()=>{if(run===generation&&running){stop();onError(Error('The camera stopped. Tap Live scan VIN to try again.'));}},{once:true});
      video.srcObject=stream;await video.play();
      if(!running||run!==generation)return;
      onStatus('Aim at the whole VIN barcode and hold steady. Scanning automatically…');
      async function tick(){
        task=null;if(!running||run!==generation)return;
        try{
          if(video.readyState>=2&&video.videoWidth&&video.videoHeight){
            // A fine barcode may only decode on an enhanced pass. Keep that pass
            // for confirmation instead of returning to raw frames and resetting it.
            const enhance=++frames%4===0||hits>0;
            const result=await readFrame(capture(video),{enhance});
            if(!running||run!==generation)return;
            onFrame(result,{frames,enhance});
            if(result.diagnostics?.status==='unavailable')throw Error('The barcode reader could not start. Choose a VIN photo or enter the VIN.');
            const vins=[...new Set((result.candidates||[]).map(c=>normalizeVin(c.vin)).filter(validVin))];
            if(vins.length===1){hits=vins[0]===lastVin?hits+1:1;lastVin=vins[0];onStatus('Barcode found. Hold steady to confirm…');if(hits>=2){const vin=lastVin;stop();onMatch(vin,result);return;}}
            else {hits=0;lastVin='';onStatus(vins.length>1?'More than one VIN is visible. Aim at one barcode.':'Aim at the whole VIN barcode and hold steady. Scanning automatically…');}
          }
        }catch(error){if(run===generation){stop();onError(error);}return;}
        if(running&&run===generation)task=schedule(tick,250);
      }
      task=schedule(tick,0);
    }catch(error){if(run===generation){stop();onError(error);}}
  }
  return {start,stop,get active(){return running;},capture:()=>capture(video)};
}
