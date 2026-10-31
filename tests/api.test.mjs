import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi, MAX_MEDIA_BYTES } from '../server/api.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword, SESSION_MS } from '../server/auth.mjs';

const origin = 'https://swaggdaddys.com';
const password = 'test-only-long-password';
const passwordHash = await hashPassword(password);
const env = { OWNER_PASSWORD_HASH:passwordHash, OWNER_USERNAME:'owner' };
const fixture = (overrides = {}) => ({ name:'Test customer', phone:'(205) 555-0100', vehicle:'2015 Ford F-150', location:'Test service area', urgency:'Flexible — I can wait', issue:'Vehicle won’t start', details:'Test request only.', location_consent:'yes', ...overrides });
const jpeg = () => new Blob([Buffer.from([255,216,255,224,0,16,74,70,73,70,255,217])], { type:'image/jpeg' });
function form(values = fixture(), file) { const data = new FormData(); for (const [key,value] of Object.entries(values)) data.set(key, value); if (file) data.append('issue_media',file,'test.jpg'); return data; }
function request(path, { method = 'GET', body, cookie, csrf, origin:customOrigin = origin } = {}) {
  const headers = {};
  if (method !== 'GET') headers.Origin = customOrigin;
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body && !(body instanceof FormData) && !(body instanceof Blob)) { headers['Content-Type']='application/json'; body = JSON.stringify(body); }
  return new Request(origin + '/api' + path, { method, headers, body });
}
async function login(api, overrides = {}) {
  const response = await api(request('/login',{ method:'POST', body:{ username:'owner', password }, ...overrides }), { ip:'owner-test' });
  assert.equal(response.status, 200);
  return { cookie:response.headers.get('set-cookie').split(';')[0], csrf:(await response.json()).csrf, header:response.headers.get('set-cookie') };
}
test('customer request persists across process adapters; owner can view, call number, edit, and retrieve protected media', async () => {
  const dir = await mkdtemp(join(tmpdir(),'swagg-')); const filename = join(dir,'inbox.sqlite');
  let store = localStore(filename); let api = createApi({ store, env });
  try {
    const response = await api(request('/requests',{ method:'POST', body:form(fixture({ latitude:'33.0',longitude:'-87.0',location_accuracy:'20' }),jpeg()) }),{ip:'customer'});
    assert.equal(response.status,201); const saved = await response.json(); assert.equal(saved.received,true); assert.equal(saved.name,undefined);
    store.close(); store = localStore(filename); api = createApi({ store, env });
    const auth = await login(api);
    assert.match(auth.header,/HttpOnly; Secure; SameSite=Strict/);
    const list = await api(request('/requests',auth)); assert.equal(list.status,200);
    const record = (await list.json()).items[0]; assert.equal(record.name,'Test customer'); assert.equal(record.dialNumber,'2055550100'); assert.equal(record.gps.latitude,33);
    const detail = await api(request('/requests/'+saved.reference,auth)); assert.equal(detail.status,200);
    const mediaPath = '/requests/'+record.id+'/media/'+record.media[0].id;
    assert.equal((await api(request(mediaPath))).status,401);
    const media = await api(request(mediaPath,auth)); assert.equal(media.status,200); assert.equal(media.headers.get('cache-control'),'no-store'); assert.equal(media.headers.get('content-type'),'image/jpeg'); assert.equal((await media.arrayBuffer()).byteLength,12);
    const patch = { status:'Scheduled',notes:'Call before arrival.',revision:record.revision };
    const update = await api(request('/requests/'+record.id,{ ...auth,method:'PATCH',body:patch })); assert.equal(update.status,200);
    const updated = await update.json(); assert.equal(updated.status,'Scheduled'); assert.equal(updated.notes,'Call before arrival.');
    assert.equal((await api(request('/requests/'+record.id,{ ...auth,method:'PATCH',body:patch }))).status,409);
  } finally { store.close(); await rm(dir,{recursive:true,force:true}); }
});
test('unauthenticated and forged sessions cannot read customer data or update requests', async () => {
  const store=localStore(); const api=createApi({store,env});
  try {
    for (const path of ['/requests','/session','/requests/0000000000000-00000000-0000-0000-0000-000000000000']) assert.equal((await api(request(path))).status,401);
    assert.equal((await api(request('/requests',{cookie:'__Host-swagg_session='+'a'.repeat(64)}))).status,401);
    assert.equal((await api(request('/login',{method:'POST',body:{username:'owner',password:'wrong-password'}}),{ip:'bad'})).status,401);
    assert.equal((await api(request('/login',{method:'POST',origin:'https://evil.example',body:{username:'owner',password}}))).status,403);
    const auth=await login(api);
    assert.equal((await api(request('/logout',{cookie:auth.cookie,method:'POST',body:{}}))).status,403);
    assert.equal((await api(request('/logout',{...auth,method:'POST',origin:'https://codemastercody3d.github.io',body:{}}))).status,403);
    assert.equal((await api(request('/logout',{...auth,method:'POST',body:{}}))).status,200);
    assert.equal((await api(request('/requests',auth))).status,401);
  } finally { store.close(); }
});
test('sessions expire and password rotation invalidates existing sessions', async () => {
  const store=localStore(); let time=Date.now(); const api=createApi({store,env,now:()=>time});
  try {
    const auth=await login(api); time+=SESSION_MS+1; assert.equal((await api(request('/session',auth))).status,401);
    const fresh=await login(api); const rotated=createApi({store,env:{...env,OWNER_PASSWORD_HASH:await hashPassword('a-different-test-password')}});
    assert.equal((await rotated(request('/session',fresh))).status,401);
  } finally { store.close(); }
});
test('invalid requests, missing consent, spoofed files, and excessive uploads are rejected without saved records', async () => {
  const cases=[
    [fixture({phone:'javascript:alert(1)'}),null,400], [fixture({location_consent:''}),null,400],
    [fixture({latitude:'100',longitude:'10',location_accuracy:'5'}),null,400], [fixture({urgency:'invented'}),null,400],
    [fixture(),new Blob(['<script>bad</script>'],{type:'image/jpeg'}),415],
    [fixture(),new Blob([new Uint8Array(MAX_MEDIA_BYTES+1)],{type:'video/mp4'}),413]
  ];
  for(const [values,file,status] of cases){
    const store=localStore();const api=createApi({store,env});
    try { const response=await api(request('/requests',{method:'POST',body:form(values,file)}),{ip:'test'}); assert.equal(response.status,status,await response.text());assert.deepEqual(await store.keys('requests/'),[]);assert.deepEqual(await store.keys('media/'),[]); }
    finally { store.close(); }
  }
});
test('public GitHub origin can submit but cannot read owner records; missing setup fails closed', async () => {
  const store=localStore();const api=createApi({store,env});
  try{
    const response=await api(request('/requests',{method:'POST',origin:'https://codemastercody3d.github.io',body:form()}),{ip:'public'});
    assert.equal(response.status,201);assert.equal(response.headers.get('access-control-allow-origin'),'https://codemastercody3d.github.io');assert.equal(response.headers.get('access-control-allow-credentials'),null);
    const read=await api(request('/requests'));assert.equal(read.status,401);assert.equal(read.headers.get('access-control-allow-origin'),null);
    assert.equal((await api(request('/requests',{method:'POST',origin:'https://evil.example',body:form()}))).status,403);
    const unconfigured=createApi({store,env:{}});assert.equal((await unconfigured(request('/requests',{method:'POST',body:form()}))).status,503);
  }finally{store.close();}
});
test('login throttle and intake throttle survive independent handler instances', async()=>{
  const store=localStore();
  try{
    for(let i=0;i<9;i++){
      const api=createApi({store,env}); const res=await api(request('/login',{method:'POST',body:{username:'owner',password:'wrong-password'}}),{ip:'brute-force'});
      assert.equal(res.status,i<8?401:429);
    }
    for(let i=0;i<6;i++){
      const api=createApi({store,env}); const res=await api(request('/requests',{method:'POST',body:form()}),{ip:'intake-flood'});
      assert.equal(res.status,i<5?201:429);
    }
  }finally{store.close();}
});
test('attachment write failure cleans stored media and never reports success', async()=>{
  const base=localStore();let writes=0;
  const store={...base,async putBytes(key,bytes){writes++;if(writes===2)throw new Error('test storage failure');return base.putBytes(key,bytes);}};
  const api=createApi({store,env});const data=form(fixture(),jpeg());data.append('issue_media',jpeg(),'second.jpg');
  try{assert.equal((await api(request('/requests',{method:'POST',body:data}),{ip:'failure'})).status,503);assert.deepEqual(await base.keys('requests/'),[]);assert.deepEqual(await base.keys('media/'),[]);}finally{base.close();}
});
