import { validVin, decodedVehicle } from '../vin-core.js';

const ROOT='https://charm.li/';
const normalized=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const words=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,' ').replace(/\s+/g,' ').trim();
const aliases={RAM:'DODGEANDRAM',DODGE:'DODGEANDRAM',MERCEDESBENZ:'MERCEDESBENZ',VW:'VOLKSWAGEN',NISSAN:'NISSANDATSUN'};
const cache=new Map();
function links(html,base) {
  const result=[];
  for(const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url=new URL(match[1].replaceAll('&amp;','&'),base);
      if(url.origin!==new URL(ROOT).origin || url.username || url.password)continue;
      result.push({url:url.href,path:url.pathname,label:match[2].replace(/<[^>]*>/g,'').trim()});
    }catch{/* Ignore malformed external markup. */}
  }
  return result;
}
async function page(url,fetcher) {
  if(fetcher===fetch&&cache.get(url)?.until>Date.now())return cache.get(url).html;
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(6000),headers:{Accept:'text/html'}});
  if(!response.ok)throw new Error('Manual directory unavailable');
  const html=await response.text();if(html.length>2*1024*1024)throw new Error('Manual directory too large');
  if(fetcher===fetch){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(url,{html,until:Date.now()+900000});}
  return html;
}
export async function findManuals(record,{fetcher=fetch}={}) {
  let specs=record.vehicleSpecs || {};
  // Decode older requests that saved a VIN without saved specifications.
  if((!specs.year||!specs.make||!specs.model)&&validVin(record.vin)) {
    const response=await fetcher('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/'+encodeURIComponent(record.vin)+'?format=json',{redirect:'error',signal:AbortSignal.timeout(6000)});
    if(response.ok){const decoded=decodedVehicle((await response.json()).Results?.[0]);if(decoded.complete&&decoded.clean)specs=decoded.specs;}
  }
  const vehicle=[specs.year,specs.make,specs.model].filter(Boolean).join(' ') || record.vehicle || 'Vehicle';
  const result={vehicle,specs,options:[],browseUrl:ROOT};
  if(!specs.make||!specs.model||!/^\d{4}$/.test(String(specs.year)))return {...result,message:'Vehicle specifications are incomplete. Browse CHARM to select the car manually.'};
  const makes=links(await page(ROOT,fetcher),ROOT).filter(link=>/^\/[^/]+\/$/.test(link.path));
  const makeName=aliases[normalized(specs.make)]||normalized(specs.make);
  const make=makes.find(link=>normalized(decodeURIComponent(link.path.split('/')[1]))===makeName);
  if(!make)return {...result,message:'CHARM does not list a matching make. No manual was selected.'};
  result.browseUrl=make.url;
  const yearUrl=make.url+String(specs.year)+'/';
  let yearHtml;
  try{yearHtml=await page(yearUrl,fetcher);result.browseUrl=yearUrl;}
  catch{return {...result,message:'A manual directory for this model year was not available on CHARM.'};}
  const yearPath=new URL(yearUrl).pathname;
  const modelWords=words(specs.model);
  let options=links(yearHtml,yearUrl).filter(link=>{
    if(!link.path.startsWith(yearPath)||!/^\/[^/]+\/\d{4}\/[^/]+\/$/.test(link.path))return false;
    const title=decodeURIComponent(link.path.slice(yearPath.length,-1));
    return words(title)===modelWords || words(title).startsWith(modelWords+' ');
  }).map(link=>({...link,label:decodeURIComponent(link.path.slice(yearPath.length,-1))}));
  // Only narrow to an engine when the decoded fields actually specify it.
  if(/^\d+$/.test(String(specs.cylinders||'')))options=options.filter(option=>{
    const match=option.label.match(/\b[LVWHIR](\d{1,2})(?:-|\b)/i);return !match||match[1]===String(specs.cylinders);
  });
  if(Number(specs.displacement)>0)options=options.filter(option=>{
    const match=option.label.match(/\b(\d+(?:\.\d+)?)L\b/i);
    return !match||Math.abs(Number(match[1])-Number(specs.displacement))<=0.15;
  });
  const drive=String(specs.drive||'');
  if(/4x2|2WD/i.test(drive))options=options.filter(option=>!/\b4WD\b|\bAWD\b/i.test(option.label));
  if(/4WD|4x4/i.test(drive))options=options.filter(option=>!/\b2WD\b/i.test(option.label));
  options=[...new Map(options.map(option=>[option.url,option])).values()];
  result.options=options;
  // A known engine size and cylinder count must support an automatic match.
  if(options.length===1&&Number(specs.displacement)>0&&Number(specs.cylinders)>0) {
    const label=options[0].label;
    if(label.match(/\b[LVWHIR]\d{1,2}(?:-|\b)/i)&&label.match(/\b\d+(?:\.\d+)?L\b/i))result.target=options[0].url;
  }
  result.message=options.length?'Choose the manual matching the vehicle’s engine and configuration.':'No matching manual was found for these specifications. Browse the model-year directory to check other names.';
  return result;
}

const escape=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function manualResponse(result) {
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(result.target)return new Response(null,{status:303,headers:{...headers,Location:result.target}});
  headers['Content-Type']='text/html; charset=utf-8';
  headers['Content-Security-Policy']="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
  const options=result.options.map(option=>'<li><a href="'+escape(option.url)+'" rel="noreferrer">'+escape(option.label)+'</a></li>').join('');
  return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vehicle repair manuals · Swagg Daddys</title><style>body{margin:32px auto;padding:0 20px;max-width:680px;background:#090e0b;color:#f0f5f1;font:18px/1.6 Arial}a{color:#47edbd}li{margin:18px 0}h1{line-height:1.2}p{overflow-wrap:anywhere}</style><h1>'+escape(result.vehicle)+'</h1><p>'+escape(result.message)+'</p><p>Decoded engine: '+escape([result.specs.cylinders&&result.specs.cylinders+' cylinders',result.specs.displacement&&Number(result.specs.displacement).toFixed(1)+' L',result.specs.engine,result.specs.drive].filter(Boolean).join(' · ')||'Not supplied')+'</p><ul>'+options+'</ul><p><a href="'+escape(result.browseUrl)+'" rel="noreferrer">Browse vehicle manuals on CHARM</a></p><p><a href="/owner/">Back to the owner inbox</a></p></html>',{headers});
}
