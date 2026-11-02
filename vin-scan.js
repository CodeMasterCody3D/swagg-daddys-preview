import { scannedVins, vinCheckDigit } from './vin-core.js';
import { scaleBarcodePixels } from './vin-barcode-scale.js';
const asset = path => new URL('./vendor/'+path,import.meta.url).href;
const loaded = new Map();
let zxingReady;
async function barcodeEngine(){
  if(!zxingReady)zxingReady=(async()=>{await loadScript(asset('zxing/reader.js'));await window.ZXingWASM.prepareZXingModule({overrides:{locateFile:path=>asset('zxing/'+path)},fireImmediately:true});return window.ZXingWASM;})().catch(error=>{zxingReady=null;throw error;});
  return zxingReady;
}
// Start the existing local engine while the camera permission/preview opens.
// A failed warm-up remains retryable when the first actual frame is read.
export function prepareVinBarcodeReader(){return barcodeEngine();}
function loadScript(url) {
  if (!loaded.has(url)) loaded.set(url,new Promise((resolve,reject)=>{
    const script=document.createElement('script'); script.src=url;
    const timeout=setTimeout(()=>{loaded.delete(url);script.remove();reject(new Error('The photo reader could not load. Check your connection and retry.'));},30000);
    script.onload=()=>{clearTimeout(timeout);resolve();};
    script.onerror=()=>{clearTimeout(timeout);loaded.delete(url);script.remove();reject(new Error('The photo reader could not load. Check your connection and retry.'));};
    document.head.append(script);
  }));
  return loaded.get(url);
}
export async function photoCanvas(file) {
  const url=URL.createObjectURL(file), image=new Image();
  try {
    image.src=url; await image.decode();
    const scale=Math.min(1,2600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas'); canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas;
  } catch {throw new Error('This image could not be opened. Choose a JPG or PNG photo, or enter the VIN manually.');}
  finally {URL.revokeObjectURL(url);}
}
export function cropCanvas(source,rectangle,{highQuality=false}={}) {
  const canvas=document.createElement('canvas');
  const r=rectangle || {x:0,y:0,width:source.width,height:source.height};
  const scale=Math.min(3,Math.max(1,1800/r.width),Math.sqrt(4500000/(r.width*r.height)));
  canvas.width=Math.round(r.width*scale)+40;canvas.height=Math.round(r.height*scale)+40;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(highQuality) {
    const original=document.createElement('canvas');original.width=Math.max(1,Math.round(r.width));original.height=Math.max(1,Math.round(r.height));
    const originalContext=original.getContext('2d',{willReadFrequently:true});originalContext.drawImage(source,r.x,r.y,r.width,r.height,0,0,original.width,original.height);
    const pixels=scaleBarcodePixels(originalContext.getImageData(0,0,original.width,original.height),canvas.width-40,canvas.height-40);
    ctx.putImageData(new ImageData(pixels.data,pixels.width,pixels.height),20,20);
  } else ctx.drawImage(source,r.x,r.y,r.width,r.height,20,20,canvas.width-40,canvas.height-40);
  return canvas;
}
function enhanced(source) {
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);let total=0;
  for(let i=0;i<pixels.data.length;i+=4) total+=pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114;
  const invert=total/(pixels.data.length/4)<115;
  for(let i=0;i<pixels.data.length;i+=4) {
    let grey=pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114;if(invert)grey=255-grey;
    grey=Math.max(0,Math.min(255,(grey-128)*1.65+128));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=grey;
  }
  ctx.putImageData(pixels,0,0);return canvas;
}
export async function scanVinBarcodes(source,{rectangle=null,progress=()=>{}}={}) {
  const canvas=cropCanvas(source,rectangle), raw=[], warnings=[], candidates=new Map();
  const diagnostics={version:'cubic-2',width:source.width,height:source.height,passes:[],symbols:[],status:'no-vin'};
  let stage='script';
  progress('Reading VIN barcodes…');
  try {
    await loadScript(asset('zxing/reader.js'));
    stage='engine';
    const engine=await barcodeEngine();
    const attempts=[{label:'Standard scaling',image:canvas},{label:'Cubic scaling',rectangle,highQuality:true}];
    // A long door-label barcode often spans almost the entire picture. Keep
    // both ends and their quiet zones when isolating the horizontal band.
    if(!rectangle)attempts.push({label:'Wide barcode band',rectangle:{x:0,y:source.height*.15,width:source.width,height:source.height*.7},highQuality:true});
    if(!rectangle)for(const fraction of [.6,.4])attempts.push({label:'Center crop '+Math.round(fraction*100)+'%',rectangle:{x:source.width*(1-fraction)/2,y:source.height*.2,width:source.width*fraction,height:source.height*.6},highQuality:true});
    for(let pass=0;pass<attempts.length;pass++) {
      const attempt=attempts[pass];stage='decode';diagnostics.passes.push(attempt.label);
      if(pass)progress('Retrying VIN barcodes — '+attempt.label.toLowerCase()+'…');
      const image=attempt.image||cropCanvas(source,attempt.rectangle,{highQuality:attempt.highQuality});
      const results=await engine.readBarcodes(image.getContext('2d').getImageData(0,0,image.width,image.height),{formats:['Code39','Code128','Code93','PDF417','DataMatrix','QRCode'],tryHarder:true,tryRotate:true,tryInvert:true,maxNumberOfSymbols:8});
      for(const result of results) {
        diagnostics.symbols.push({format:result.format,text:result.text.slice(0,160)});
        raw.push('Barcode ('+result.format+'): '+result.text);
        for(const candidate of scannedVins(result.text,{barcode:true}))candidates.set(candidate.vin,{...candidate,method:'barcode'});
      }
      // A nearby inventory barcode (for example "VB") must not prevent the
      // enhanced pass from finding the vehicle's separate VIN barcode.
      if(candidates.size)break;
    }
  } catch {
    diagnostics.status='unavailable';diagnostics.error=stage==='script'?'Barcode reader script could not load.':stage==='engine'?'Barcode engine could not start.':'Barcode image decoding failed.';
    warnings.push(diagnostics.error);
  }
  if(candidates.size)diagnostics.status='read';
  return {candidates:[...candidates.values()],rawText:[...new Set(raw)].join('\n'),warnings,diagnostics};
}

const LIVE_OPTIONS={formats:['Code39','Code128','Code93','PDF417','DataMatrix','QRCode'],tryHarder:true,tryRotate:true,tryInvert:true,maxNumberOfSymbols:8};
// `region` is the on-screen guide box as fractions of the frame. It is read first,
// at native pixels: on a 1920x1080 frame this was 2-3x faster than the whole frame
// and found a small barcode the whole-frame read missed (the engine downsizes large
// images). A miss continues with the whole frame and then the enhanced passes.
export async function scanVinLiveFrame(source,{enhance=false,region=null}={}) {
  const engine=await barcodeEngine();
  const context=source.getContext('2d',{willReadFrequently:true}),passes=[],symbols=[];
  const candidates=new Map();
  const collect=found=>{for(const symbol of found){symbols.push(symbol);for(const candidate of scannedVins(symbol.text,{barcode:true}))candidates.set(candidate.vin,{...candidate,method:'barcode'});}};
  const box=guideBox(source,region);
  if(box){passes.push('Guide box');collect(await engine.readBarcodes(context.getImageData(box.x,box.y,box.width,box.height),LIVE_OPTIONS));}
  if(!candidates.size){passes.push('Live camera frame');collect(await engine.readBarcodes(context.getImageData(0,0,source.width,source.height),LIVE_OPTIONS));}
  if(!candidates.size&&enhance)return scanVinBarcodes(source);
  return {candidates:[...candidates.values()],warnings:[],diagnostics:{version:'live-2',width:source.width,height:source.height,passes,symbols:symbols.map(s=>({format:s.format,text:s.text.slice(0,160)})),status:candidates.size?'read':'no-vin'}};
}
// Guide fractions -> whole-pixel rectangle inside the frame, or null if unusable.
export function guideBox(source,region) {
  if(!region||![region.x,region.y,region.width,region.height].every(Number.isFinite))return null;
  const x=Math.max(0,Math.floor(region.x*source.width)),y=Math.max(0,Math.floor(region.y*source.height));
  const width=Math.min(source.width-x,Math.ceil(region.width*source.width)),height=Math.min(source.height-y,Math.ceil(region.height*source.height));
  return width>=40&&height>=20&&width*height<source.width*source.height*.9?{x,y,width,height}:null;
}

// Live text is a local fallback, never a Google request. Reuse one worker for
// the camera session and keep native camera pixels: enlarging these frames can
// erase fine text detail as well as invent edges around a filmed phone screen.
export function createLiveVinTextReader() {
  let ready=null,closed=false;
  async function worker() {
    if(closed)throw new Error('Text reader stopped.');
    if(!ready)ready=(async()=>{
      await loadScript(asset('tesseract/tesseract.min.js'));
      return window.Tesseract.createWorker('eng',1,{workerPath:asset('tesseract/worker.min.js'),corePath:asset('tesseract/core'),langPath:asset('tesseract/lang'),gzip:true});
    })();
    const value=await ready;if(closed)throw new Error('Text reader stopped.');return value;
  }
  return {
    async read(source) {
      const reader=await worker(),found=new Map(),raw=[];
      const image=document.createElement('canvas');
      const scale=Math.min(1,1280/Math.max(source.width,source.height));
      image.width=Math.max(1,Math.round(source.width*scale));image.height=Math.max(1,Math.round(source.height*scale));
      image.getContext('2d').drawImage(source,0,0,image.width,image.height);
      for(const mode of ['3','6']) {
        if(closed)throw new Error('Text reader stopped.');
        await reader.setParameters({tessedit_pageseg_mode:mode,preserve_interword_spaces:'1',user_defined_dpi:'300'});
        const result=await reader.recognize(image);
        if(closed)throw new Error('Text reader stopped.');
        raw.push(result.data.text);
        for(const candidate of scannedVins(result.data.text)) {
          if(!candidate.corrected&&vinCheckDigit(candidate.vin).status==='match')found.set(candidate.vin,{...candidate,method:'text'});
        }
      }
      return {candidates:[...found.values()],rawText:raw.join('\n'),warnings:[]};
    },
    async close() {
      if(closed)return;closed=true;
      if(ready)try{await (await ready).terminate();}catch{}
    }
  };
}

export async function scanVinText(source,{rectangle=null,progress=()=>{}}={}) {
  const canvas=cropCanvas(source,rectangle), raw=[], warnings=[];let worker;
  try {
    progress('Reading printed VIN text…');
    await loadScript(asset('tesseract/tesseract.min.js'));
    worker=await window.Tesseract.createWorker('eng',1,{workerPath:asset('tesseract/worker.min.js'),corePath:asset('tesseract/core'),langPath:asset('tesseract/lang'),gzip:true},{load_system_dawg:'0',load_freq_dawg:'0'});
    const candidates=new Map();
    const passes=[{image:canvas,mode:rectangle?'7':'11'},{image:enhanced(canvas),mode:rectangle?'13':'6'},{image:enhanced(canvas),mode:'11'}];
    for(let i=0;i<passes.length;i++) {
      progress('Reading printed VIN text — attempt '+(i+1)+' of '+passes.length+'…');
      await worker.setParameters({tessedit_pageseg_mode:passes[i].mode,preserve_interword_spaces:'1',user_defined_dpi:'300'});
      const result=await worker.recognize(passes[i].image,{rotateAuto:true});
      if(result.data.text.trim())raw.push(result.data.text.trim());
      for(const candidate of scannedVins(result.data.text)) {
        const previous=candidates.get(candidate.vin);
        if(!previous || (previous.corrected && !candidate.corrected)) candidates.set(candidate.vin,{...candidate,method:'text'});
      }
      if([...candidates.values()].some(candidate=>!candidate.corrected))break;
    }
    return {candidates:[...candidates.values()],rawText:[...new Set(raw)].join('\n\n'),warnings};
  } finally {await worker?.terminate();}
}

export async function scanVinPhoto(source,options={}) {
  const barcode=await scanVinBarcodes(source,options);
  if(barcode.candidates.length)return barcode;
  const text=await scanVinText(source,options);
  return {...text,warnings:[...barcode.warnings,...text.warnings]};
}
