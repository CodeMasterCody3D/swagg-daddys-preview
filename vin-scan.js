import { scannedVins } from './vin-core.js';
const asset = path => new URL('./vendor/'+path,import.meta.url).href;
const loaded = new Map();
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
export function cropCanvas(source,rectangle) {
  const canvas=document.createElement('canvas');
  const r=rectangle || {x:0,y:0,width:source.width,height:source.height};
  const scale=Math.min(3,Math.max(1,1800/r.width),Math.sqrt(4500000/(r.width*r.height)));
  canvas.width=Math.round(r.width*scale)+40;canvas.height=Math.round(r.height*scale)+40;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,r.x,r.y,r.width,r.height,20,20,canvas.width-40,canvas.height-40);return canvas;
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
  progress('Reading VIN barcodes…');
  try {
    await loadScript(asset('zxing/reader.js'));
    window.ZXingWASM.prepareZXingModule({overrides:{locateFile:path=>asset('zxing/'+path)}});
    const results=await window.ZXingWASM.readBarcodes(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),{formats:['Code39','Code128','Code93','PDF417','DataMatrix','QRCode'],tryHarder:true,tryRotate:true,tryInvert:true,maxNumberOfSymbols:8});
    for(const result of results) {
      raw.push('Barcode ('+result.format+'): '+result.text);
      for(const candidate of scannedVins(result.text,{barcode:true}))candidates.set(candidate.vin,{...candidate,method:'barcode'});
    }
  } catch {warnings.push('The barcode reader was unavailable.');}
  return {candidates:[...candidates.values()],rawText:raw.join('\n'),warnings};
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
