import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualBrowser, trimManualPage, validManualPath, validImagePath, ManualError } from '../server/manual-browser.mjs';
import { createApi } from '../server/api.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword } from '../server/auth.mjs';

const page='<html><head><title>Civic</title></head><body><div class="other-warning other-announcement">Slow server</div><div class="main"><h1>Honda: 2008: Civic L4-1.8L</h1><script>alert(1)</script><ul><li><img class=\'folder-icon\' src=\'/icons/wrench.svg\'><a href=\'Repair%20and%20Diagnosis/\' name=\'x\'>Repair and Diagnosis</a></ul></div><div class="theme-colors footer">footer</div></body></html>';
const PNG=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const hosts=['https://a.test','https://b.test'];

test('only LEMON directory and image paths are accepted; bundles, traversal and other hosts are not',()=>{
  for(const ok of ['/','/Honda/2008/','/Honda/2008/Civic%20L4-1.8L/Repair%20and%20Diagnosis/'])assert.ok(validManualPath(ok),ok);
  for(const bad of ['','Honda/','//evil.test/','/bundle/Honda/2008/x/','/images/a/','/Honda/../x/','/a b/','/a?x=1','/a#b','/a\\b'])assert.equal(validManualPath(bad),false,bad);
  assert.ok(validImagePath('/images/IMP03Q313/asian160/884199255/'));
  for(const bad of ['/Honda/','/images/../x','/images/<x>','//images/x'])assert.equal(validImagePath(bad),false,bad);
});

test('trimmed pages keep the manual tree and notice but drop scripts, footer and icon images',()=>{
  const html=trimManualPage(page);
  assert.match(html,/<title>Civic<\/title>/);assert.match(html,/<div class="notice">Slow server<\/div>/);
  assert.match(html,/<i data-icon="wrench"><\/i>/);assert.match(html,/Repair and Diagnosis/);
  for(const gone of ['<script','footer','folder-icon',"name='x'"])assert.ok(!html.includes(gone),gone);
});

test('a dead address falls through to the next one, which is then tried first',async()=>{
  const calls=[];
  const fetcher=async url=>{calls.push(url);if(url.startsWith(hosts[0]))throw new TypeError('fetch failed');return new Response(page);};
  const browser=createManualBrowser({fetcher,hosts,stagger:5});
  const first=await browser.page('/Honda/2008/');
  assert.equal(first.host,hosts[1]);assert.match(first.html,/Honda: 2008/);
  calls.length=0;await browser.page('/Toyota/');
  assert.equal(calls[0],hosts[1]+'/Toyota/');
});

test('404 is reported as missing and every address failing is a clear 502',async()=>{
  const missing=createManualBrowser({fetcher:async()=>new Response('no',{status:404}),hosts,stagger:5});
  await assert.rejects(missing.page('/Nope/'),e=>e instanceof ManualError&&e.status===404);
  const down=createManualBrowser({fetcher:async()=>new Response('busy',{status:503}),hosts,stagger:5});
  await assert.rejects(down.page('/Honda/'),e=>e instanceof ManualError&&e.status===502);
});

test('images are passed through only when their bytes are PNG, JPEG, GIF or WebP',async()=>{
  const png=createManualBrowser({fetcher:async()=>new Response(PNG,{headers:{'content-type':'image/png'}}),hosts,stagger:5});
  assert.equal((await png.image('/images/a/1/')).type,'image/png');
  const svg=createManualBrowser({fetcher:async()=>new Response('<svg onload="alert(1)"/>',{headers:{'content-type':'image/png'}}),hosts,stagger:5});
  await assert.rejects(svg.image('/images/a/1/'),e=>e.status===415);
  await assert.rejects(png.image('/Honda/'),e=>e.status===400);
});

test('manual routes require an owner session and never forward to LEMON without one',async()=>{
  const password='test-only-long-password';
  const env={OWNER_PASSWORD_HASH:await hashPassword(password),OWNER_USERNAME:'owner'};
  const calls=[];
  const manualBrowser=createManualBrowser({fetcher:async url=>{calls.push(url);return url.includes('/images/')?new Response(PNG):new Response(page);},hosts,stagger:5});
  const store=localStore();const api=createApi({store,env,manualBrowser});
  const origin='https://swaggdaddys.com';
  const get=(path,cookie)=>api(new Request(origin+'/api'+path,{headers:cookie?{Cookie:cookie}:{}}));
  try {
    for(const path of ['/manuals/page?path=%2FHonda%2F','/manuals/image?path=%2Fimages%2Fa%2F','/manuals/vin/1HGCM82633A004352'])assert.equal((await get(path)).status,401,path);
    assert.equal(calls.length,0);
    const login=await api(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})}),{ip:'manual-test'});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const ok=await get('/manuals/page?path='+encodeURIComponent('/Honda/2008/'),cookie);
    assert.equal(ok.status,200);assert.equal(ok.headers.get('x-lemon-host'),hosts[0]);assert.match(await ok.text(),/Honda: 2008/);
    const image=await get('/manuals/image?path='+encodeURIComponent('/images/a/1/'),cookie);
    assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
    assert.equal((await get('/manuals/page?path='+encodeURIComponent('/bundle/Honda/'),cookie)).status,400);
  } finally { store.close(); }
});
