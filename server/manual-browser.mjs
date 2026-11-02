// Owner-only reader for LEMON manual pages and their images.
// The owner dashboard's CSP only allows same-origin requests and images, so the
// manuals finder (owner/manuals.js) reads LEMON through these helpers instead of
// linking out. Only LEMON paths are accepted; customer details are never sent.

import { decodedVehicle, validVin } from '../vin-core.js';

// Official addresses from https://lemon-manuals.la/about.html, then the
// unaffiliated mirror listed there. All four serve the same directory layout.
export const MANUAL_HOSTS=['https://lemon-manuals.la','https://lemon-manuals.org.ua','https://lemon-manuals.gy','https://lemon.dogeware.me'];
const TIMEOUT_MS=12000,STAGGER_MS=2500,MAX_PAGE=8*1024*1024,MAX_IMAGE=6*1024*1024;
const IMAGE_TYPES=['image/jpeg','image/png','image/gif','image/webp'];

export class ManualError extends Error { constructor(status,message){super(message);this.status=status;} }

// A directory-style LEMON path such as /Honda/2008/Civic%20L4-1.8L/Repair%20and%20Diagnosis/.
// /bundle/ is excluded (robots.txt disallows it; the page links to it instead).
export function validManualPath(path) {
  return typeof path==='string'&&path.length<=1500&&path.startsWith('/')&&!path.startsWith('//')&&!/^\/bundle\//i.test(path)&&!/^\/images\//.test(path)
    &&!path.includes('..')&&!/[\s<>"'\\#?]/.test(path);
}
export function validImagePath(path) {
  return typeof path==='string'&&path.length<=600&&/^\/images\/[A-Za-z0-9%._~\/-]+$/.test(path)&&!path.includes('..');
}
function imageType(bytes) {
  const head=Buffer.from(bytes.subarray(0,12));
  if(head[0]===255&&head[1]===216&&head[2]===255)return 'image/jpeg';
  if(head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(/^GIF8[79]a/.test(head.subarray(0,6).toString()))return 'image/gif';
  if(head.subarray(0,4).toString()==='RIFF'&&head.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return '';
}

// Keep the title, LEMON's announcement and the .main block. Scripts, duplicate
// name="" attributes and icon <img>s (redrawn from data-icon) are removed.
export function trimManualPage(html) {
  const start=html.indexOf('<div class="main">');
  const head=start>=0?html.slice(0,start):html;
  const title=(html.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||'';
  const notice=(head.match(/<div class="other-warning[^"]*">([\s\S]*?)<\/div>/i)||[])[1]||'';
  let end=html.indexOf('<div class="theme-colors footer">');if(end<0)end=html.length;
  const main=(start>=0?html.slice(start,end):'<div class="main"></div>')
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<div class="other-warning[^"]*">[\s\S]*?<\/div>/,'')
    .replace(/\sname=(["'])[^"']*\1/g,'')
    .replace(/\sdata-aht-id=(["'])[^"']*\1/g,'')
    .replace(/\sclass=(["'])li-folder\1/g,'')
    .replace(/<img class=(["'])folder-icon\1 src=(["'])\/icons\/([\w-]+)\.svg\2>/g,'<i data-icon="$3"></i>')
    .replace(/<button id=(["'])(expand|collapse)-all\1>[^<]*<\/button>/g,'');
  return `<!doctype html><title>${title}</title><div class="notice">${notice}</div>${main}`;
}

async function limitedBytes(response,max) {
  const length=Number(response.headers.get('content-length')||0);
  if(length>max){await response.body?.cancel();throw new ManualError(413,'This manual page is too large to open here. Use Open on LEMON.');}
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>max)throw new ManualError(413,'This manual page is too large to open here. Use Open on LEMON.');
  return bytes;
}

export function createManualBrowser({fetcher=fetch,hosts=MANUAL_HOSTS,stagger=STAGGER_MS,timeout=TIMEOUT_MS}={}) {
  let lastGood=null;
  // Ask one address; each `stagger` ms without an answer, also ask the next.
  // The first real answer wins and the others are cancelled. A 404 is an answer.
  async function first(path,max) {
    const order=[lastGood,...hosts.filter(host=>host!==lastGood)].filter(Boolean);
    const stop=new AbortController();
    const tries=order.map((host,index)=>new Promise((resolve,reject)=>{
      setTimeout(async()=>{
        if(stop.signal.aborted)return reject(Error('cancelled'));
        try {
          const response=await fetcher(host+path,{redirect:'error',signal:AbortSignal.any([stop.signal,AbortSignal.timeout(timeout)]),headers:{'User-Agent':'SwaggDaddysOwner/1.0'}});
          if(response.status===404){await response.body?.cancel();return resolve({host,status:404});}
          if(!response.ok){await response.body?.cancel();return reject(Error(host+' '+response.status));}
          resolve({host,status:200,type:response.headers.get('content-type')||'',bytes:await limitedBytes(response,max)});
        }catch(error){reject(error);}
      },index*stagger);
    }));
    try {
      const won=await Promise.any(tries);
      stop.abort();lastGood=won.host;return won;
    }catch(error){
      const tooLarge=error.errors?.find(item=>item instanceof ManualError);
      if(tooLarge)throw tooLarge;
      throw new ManualError(502,'LEMON Manuals is not answering at any of its addresses right now. Try again in a few minutes.');
    }
  }
  return {
    async page(path) {
      if(!validManualPath(path))throw new ManualError(400,'That is not a manual page.');
      const result=await first(path,MAX_PAGE);
      if(result.status===404)throw new ManualError(404,'LEMON does not have this page.');
      return {host:result.host,html:trimManualPage(new TextDecoder().decode(result.bytes))};
    },
    async image(path) {
      if(!validImagePath(path))throw new ManualError(400,'That is not a manual image.');
      const result=await first(path,MAX_IMAGE);
      if(result.status===404)throw new ManualError(404,'Image not found.');
      const type=imageType(result.bytes);
      // SVG and anything unrecognised is refused: it would run on the owner origin.
      if(!IMAGE_TYPES.includes(type))throw new ManualError(415,'Unsupported manual image.');
      return {type,bytes:result.bytes};
    },
    // Year/make/model/engine for the finder's VIN search. Only the VIN goes to NHTSA.
    async vin(vin) {
      if(!validVin(vin))throw new ManualError(400,'Enter a complete 17-character VIN.');
      let response;
      try{response=await fetcher('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/'+encodeURIComponent(vin)+'?format=json',{redirect:'error',signal:AbortSignal.timeout(8000)});}
      catch{throw new ManualError(502,'The NHTSA VIN decoder is not answering. Type the year, make and model instead.');}
      if(!response.ok)throw new ManualError(502,'The NHTSA VIN decoder is not answering. Type the year, make and model instead.');
      const decoded=decodedVehicle((await response.json()).Results?.[0]);
      if(!decoded.complete)throw new ManualError(422,'NHTSA could not identify this VIN. Check it, or type the year, make and model.');
      const {year,make,model,trim,displacement,cylinders,drive}=decoded.specs;
      return {year,make,model,trim,displacement,cylinders,drive,vehicle:decoded.vehicle,clean:decoded.clean};
    }
  };
}
