import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createPushService, fcmSender, notificationPreview } from '../server/push.mjs';
import { localStore } from '../server/local-store.mjs';

const env={OWNER_PASSWORD_HASH:'test-hash'};
const device='12345678-1234-1234-1234-123456789012',token='test_token_for_notification_123456';
test('delivery persists retry state across service instances and removes successful outbox entries',async()=>{
  const store=localStore();let fail=true;const sent=[];
  const sender={ready:true,send:async(t,id,preview)=>{if(fail)throw Error('offline');sent.push({t,id,preview});return 'sent';}};
  try{
    let push=createPushService({store,env,sender});await push.register(device,token,{key:'sessions/a'});await push.notify(undefined,{name:'Jordan',details:'Car will not start.',phone:'555-0100',gps:{latitude:1,longitude:2}});
    assert.equal((await store.keys('push-outbox/')).length,1);assert.equal(sent.length,0);
    fail=false;push=createPushService({store,env,sender});await push.drain();
    assert.equal(sent.length,1);assert.equal(sent[0].t,token);assert.equal((await store.keys('push-outbox/')).length,0);
    assert.deepEqual(sent[0].preview,{customerName:'Jordan',requestSummary:'Car will not start.'});
    await push.drain();assert.equal(sent.length,1);
  }finally{store.close();}
});
test('signout, password changes, expired devices, and invalid FCM tokens revoke delivery',async()=>{
  for(const reason of ['logout','password','expired','unregistered']) {
    const store=localStore();let time=100000;let sends=0;
    const sender={ready:true,send:async()=>{sends++;return 'unregistered';}};
    try{
      let push=createPushService({store,env,sender,now:()=>time});await push.register(device,token,{key:'sessions/a'});
      if(reason==='logout')await push.signOut({key:'sessions/a'});
      if(reason==='password')push=createPushService({store,env:{OWNER_PASSWORD_HASH:'rotated'},sender,now:()=>time});
      if(reason==='expired')time+=91*86400000;
      await push.notify();assert.equal(sends,reason==='unregistered'?1:0,reason);assert.equal((await store.keys('push-devices/')).length,0);
    }finally{store.close();}
  }
});
test('FCM signs OAuth requests and sends only the bounded customer preview with event data',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const account={project_id:'test-project',client_email:'push@test-project.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})};
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-access',expires_in:3600});
    return Response.json({name:'projects/test-project/messages/1'});
  };
  const sender=fcmSender({FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(account)},fetcher,()=>1700000000000);
  await sender.send(token,'11111111-1111-1111-1111-111111111111',{customerName:'Jordan',requestSummary:'Car will not start.',phone:'555-0100',gps:'private'});await sender.send(token,'22222222-2222-2222-2222-222222222222');
  assert.equal(calls.length,3);const assertion=calls[0].options.body.get('assertion');const parts=assertion.split('.');
  assert.ok(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')));
  const body=JSON.parse(calls[1].options.body);assert.deepEqual(Object.keys(body.message.data).sort(),['customerName','eventId','requestSummary','type']);
  assert.equal(body.message.data.customerName,'Jordan');assert.equal(body.message.data.requestSummary,'Car will not start.');
  assert.deepEqual(Object.keys(JSON.parse(calls[2].options.body).message.data).sort(),['eventId','type']);
  assert.equal(body.message.android.ttl,'86400s');assert.equal(body.message.token,token);
});
test('notification previews use the customer message, fall back to the issue, and bound Unicode safely',()=>{
  assert.deepEqual(notificationPreview({name:'  Jordan\nSmith ',details:' Car\nwill not\tstart. ',issue:'Other',phone:'private'}),{customerName:'Jordan Smith',requestSummary:'Car will not start.'});
  assert.deepEqual(notificationPreview({details:' ',issue:'Warning light'}),{customerName:'Customer',requestSummary:'Warning light'});
  const result=notificationPreview({name:'🚗'.repeat(100),details:'🚗'.repeat(200)});
  assert.equal([...result.customerName].length,80);assert.equal([...result.requestSummary].length,160);
  assert.ok(result.requestSummary.endsWith('…'));assert.equal(notificationPreview({name:'Jordan\u202eSmith'}).customerName,'Jordan Smith');
});
