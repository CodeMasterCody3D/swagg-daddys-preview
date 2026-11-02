import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createApi } from '../server/api.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword, digest, token, SESSION_MS } from '../server/auth.mjs';
import { LensReadError, lensVinResult } from '../server/lens.mjs';

await mkdir('.local-data', { recursive:true });
const env = { ...process.env };
let qa;
try { qa = JSON.parse(await readFile('.openai/qa.json','utf8')); } catch {}
if (qa) { env.OWNER_USERNAME='owner'; env.OWNER_PASSWORD_HASH=await hashPassword(qa.password); }
if (qa?.mockGoogleLens) env.GOOGLE_LENS_ENABLED='true';
const store = localStore('.local-data/inbox.sqlite');
const lensReader = qa?.mockGoogleLens ? async () => {
  const fixture = JSON.parse(await readFile('.openai/qa.json','utf8'));
  if(fixture.lensScenario==='verification')throw new LensReadError('verification');
  return lensVinResult({segments:[{text:fixture.lensScenario==='unreadable'?'UNREADABLE':'1HGCM82633A004352'}]});
} : undefined;
const api = createApi({ store, env, lensReader });
const publicFiles = new Set(['/index.html','/site-config.js','/intake.js','/request-location.js','/media.js','/vin.js','/vin-core.js','/vin-scan.js','/vin-lens.js','/vin-reader.js','/vin-barcode-scale.js','/privacy.html','/owner/index.html','/owner/owner.css','/owner/owner.js']);
publicFiles.add('/owner/vehicle-research.js');
publicFiles.add('/owner/app-updates.js');
publicFiles.add('/owner/app-updates-core.js');
publicFiles.add('/vin-live.js');
publicFiles.add('/vin-camera.js');
publicFiles.add('/owner/manuals.js');
publicFiles.add('/owner/manuals.css');
const types = { '.json':'application/json', '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.wasm':'application/wasm', '.gz':'application/gzip', '.txt':'text/plain' };
const root = resolve('.');
const server = createServer(async (req,res) => {
  try {
    const origin = `http://${req.headers.host}`;
    const url = new URL(req.url, origin);
    // Isolated fixture session for browser layout checks; this route exists only in the local QA server.
    if (qa && url.pathname === '/__qa-inbox') {
      const raw=token();
      await store.put('sessions/'+digest(raw), {csrf:token(),expires:Date.now()+SESSION_MS,authVersion:digest(env.OWNER_PASSWORD_HASH)});
      if (!(await store.keys('requests/')).length) {
        const fixture={id:'1793458800000-00000000-0000-4000-8000-000000000001',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),name:'Example Customer (test)',phone:'205-555-0100',dialNumber:'2055550100',vehicle:'2015 Ford F-150',location:'Example service area',urgency:'Flexible — I can wait',issue:'Vehicle won’t start',details:'Example request for layout verification only.',status:'New',notes:'',media:[],gps:{latitude:33,longitude:-87,accuracy:25}};
        await store.put('requests/'+fixture.id,fixture);
      }
      res.writeHead(302, {'Set-Cookie':`swagg_local_session=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`,'Location':'/__qa.html'});res.end();return;
    }
    if (url.pathname.startsWith('/api/')) {
      const localHeaders = new Headers(req.headers);
      // HTTP-only development translation; production always uses the secure __Host cookie.
      if (localHeaders.has('cookie')) localHeaders.set('cookie', localHeaders.get('cookie').replaceAll('swagg_local_session=', '__Host-swagg_session='));
      const request = new Request(url, { method:req.method, headers:localHeaders, ...(!['GET','HEAD'].includes(req.method) ? { body:Readable.toWeb(req), duplex:'half' } : {}) });
      const response = await api(request, { ip:req.socket.remoteAddress });
      const responseHeaders = new Headers(response.headers);
      if (responseHeaders.has('set-cookie')) responseHeaders.set('set-cookie', responseHeaders.get('set-cookie').replace('__Host-swagg_session=', 'swagg_local_session=').replace('; Secure;', ';'));
      res.writeHead(response.status, Object.fromEntries(responseHeaders)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (qa && url.pathname === '/__qa.html') {
      res.writeHead(200, { 'Content-Type':'text/html', 'Cache-Control':'no-store' });
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Phone QA</title></head><body style="margin:0;background:#24352d;color:white;font:14px Arial;display:flex;gap:20px;padding:20px"><div><p>320 px</p><iframe title="Small phone" src="/owner/" style="width:320px;height:820px;border:0"></iframe></div><div><p>390 px</p><iframe title="Phone" src="/owner/" style="width:390px;height:844px;border:0"></iframe></div><div><p>430 px</p><iframe title="Large phone" src="/owner/" style="width:430px;height:844px;border:0"></iframe></div></body></html>'); return;
    }
    const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    const vendor=/^\/vendor\/(?:tesseract|zxing)\/[a-zA-Z0-9./_-]+$/.test(path) && !path.includes('..');
    const manualData=/^\/manuals-data\/(?:makes|v\/[A-Za-z0-9-]+\/\d{4})\.json$/.test(path);
    if (!vendor && !manualData && !publicFiles.has(path) && !/^\/assets\/[a-z0-9-]+\.webp$/.test(path)) { res.writeHead(404); res.end('Not found'); return; }
    const filename = resolve(root, vendor ? 'public'+path : '.'+path);
    if (!filename.startsWith(root+sep)) { res.writeHead(403); res.end(); return; }
    let data = await readFile(filename);
    if(qa?.mockGoogleLens && path==='/index.html')data=Buffer.from(data.toString().replace('<body>','<body><p style="position:sticky;top:0;z-index:1000;background:#ffe390;color:#171b18;padding:12px;margin:0;font:700 15px Arial" role="note">LOCAL TEST: simulated Google Lens response. No photo is sent to Google.</p>'));
    res.writeHead(200, { 'Content-Type':types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(data);
  } catch { res.writeHead(500); res.end('Local preview error'); }
});
const portArg = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (portArg >= 0 ? process.argv[portArg + 1] : 3000));
server.listen(port,'0.0.0.0',()=>console.log(`Local preview listening on ${port}`));
process.on('SIGTERM',()=>server.close(()=>{store.close();process.exit(0);}));
