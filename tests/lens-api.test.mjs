import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.mjs';
import { LensReadError, MAX_LENS_PHOTO_BYTES } from '../server/lens.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword } from '../server/auth.mjs';

const origin='https://swaggdaddys.com';
const env={OWNER_PASSWORD_HASH:await hashPassword('fictional-test-password'),GOOGLE_LENS_ENABLED:'true'};
const vin='1HGCM82633A004352';
const result={candidates:[{vin,corrected:false,method:'google-lens'}],rawText:vin,warnings:[]};
const bytes=Buffer.from([255,216,255,224,0,16,74,70,73,70,255,217]);
function request({source=origin,consent='yes',photo=new Blob([bytes],{type:'image/jpeg'}),extra=false}={}) {
  const form=new FormData();form.set('google_consent',consent);
  if(photo)form.set('photo',photo,'private-name.jpg');
  if(extra)form.append('photo',photo,'second.jpg');
  return new Request(origin+'/api/vin/photo',{method:'POST',headers:{Origin:source},body:form});
}

test('photo endpoint returns candidates without a login and saves no image, VIN or request',async()=>{
  const store=localStore();let calls=0;
  try {
    const api=createApi({store,env,lensReader:async data=>{calls++;assert.deepEqual(Buffer.from(data),bytes);return result;}});
    const response=await api(request(),{ip:'fixture-customer'});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.equal(calls,1);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await store.keys('requests/'),[]);assert.deepEqual(await store.keys('media/'),[]);
    const health=await(await api(new Request(origin+'/api/health'))).json();assert.equal(health.googleLens,true);
  } finally {store.close();}
});

test('enabled Lens recognition works independently of owner-login configuration',async()=>{
  const store=localStore();let calls=0;
  try {
    const api=createApi({store,env:{GOOGLE_LENS_ENABLED:'true'},lensReader:async()=>{calls++;return result;}});
    const health=await(await api(new Request(origin+'/api/health'))).json();
    assert.deepEqual(health,{ready:false,googleLens:true});
    const response=await api(request(),{ip:'preview-without-owner'});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),result);assert.equal(calls,1);
    assert.equal((await api(new Request(origin+'/api/requests'))).status,503);
  } finally {store.close();}
});

test('disabled feature, missing consent, foreign origins and spoofed images do not call Google',async()=>{
  const cases=[
    [{env:{...env,GOOGLE_LENS_ENABLED:'false'}},{},503],
    [{},{consent:''},400], [{},{source:'https://evil.example'},403],
    [{},{photo:new Blob(['<html>not a photo</html>'],{type:'image/jpeg'})},415],
    [{},{photo:null},400], [{},{extra:true},400],
    [{},{photo:new Blob([new Uint8Array(MAX_LENS_PHOTO_BYTES+1)],{type:'image/jpeg'})},413],
  ];
  for(const [options,values,status] of cases) {
    const store=localStore();let calls=0;
    try {
      const api=createApi({store,env,...options,lensReader:async()=>{calls++;return result;}});
      assert.equal((await api(request(values),{ip:'rejected-fixture'})).status,status);assert.equal(calls,0);
    } finally {store.close();}
  }
});

test('persistent throttling caps repeated image requests',async()=>{
  const store=localStore();let calls=0;
  try {
    const api=createApi({store,env,lensReader:async()=>{calls++;return result;}});
    for(let i=0;i<5;i++)assert.equal((await api(request(),{ip:'same-fixture'})).status,200);
    assert.equal((await api(request(),{ip:'same-fixture'})).status,429);assert.equal(calls,5);
  } finally {store.close();}
});

test('verification failures return a safe recoverable error without upstream contents',async()=>{
  const store=localStore();
  try {
    const api=createApi({store,env,lensReader:async()=>{throw new LensReadError('verification');}});
    const response=await api(request());assert.equal(response.status,503);
    const body=await response.json();assert.equal(body.code,'verification');assert.match(body.error,/barcode photo/);
    const unexpected=createApi({store,env,lensReader:async()=>{throw new Error('private upstream body and cookie');}});
    const error=await(await unexpected(request(),{ip:'other-fixture'})).json();assert.doesNotMatch(JSON.stringify(error),/private|cookie/);
  } finally {store.close();}
});

test('only approved form origins receive photo endpoint CORS access',async()=>{
  const store=localStore();try{
    const api=createApi({store,env});
    for(const source of [origin,'https://codemastercody3d.github.io']) {
      const response=await api(new Request(origin+'/api/vin/photo',{method:'OPTIONS',headers:{Origin:source}}));
      assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),source);
    }
    const response=await api(new Request(origin+'/api/vin/photo',{method:'OPTIONS',headers:{Origin:'https://evil.example'}}));
    assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }finally{store.close();}
});
