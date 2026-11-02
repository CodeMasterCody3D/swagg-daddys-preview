import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createPushService, fcmSender, notificationPreview, isUrgent, REMINDER_MS } from '../server/push.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword } from '../server/auth.mjs';

const env={OWNER_PASSWORD_HASH:await hashPassword('notification-test-password')};
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
  const body=JSON.parse(calls[1].options.body);assert.deepEqual(Object.keys(body.message.data).sort(),['customerName','eventId','priority','reminder','requestSummary','type']);assert.equal(body.message.data.priority,'normal');assert.equal(body.message.data.reminder,'0');
  assert.equal(body.message.data.customerName,'Jordan');assert.equal(body.message.data.requestSummary,'Car will not start.');
  assert.deepEqual(Object.keys(JSON.parse(calls[2].options.body).message.data).sort(),['eventId','priority','reminder','type']);
  assert.equal(body.message.android.ttl,'86400s');assert.equal(body.message.token,token);
});
test('notification previews use the customer message, fall back to the issue, and bound Unicode safely',()=>{
  assert.deepEqual(notificationPreview({name:'  Jordan\nSmith ',details:' Car\nwill not\tstart. ',issue:'Other',phone:'private'}),{customerName:'Jordan Smith',requestSummary:'Car will not start.'});
  assert.deepEqual(notificationPreview({details:' ',issue:'Warning light'}),{customerName:'Customer',requestSummary:'Warning light'});
  const result=notificationPreview({name:'🚗'.repeat(100),details:'🚗'.repeat(200)});
  assert.equal([...result.customerName].length,80);assert.equal([...result.requestSummary].length,160);
  assert.ok(result.requestSummary.endsWith('…'));assert.equal(notificationPreview({name:'Jordan\u202eSmith'}).customerName,'Jordan Smith');
});

test('stranded and urgent requests are urgent; older "Urgent — vehicle is stranded" requests still are',()=>{
  for(const urgency of ['Stranded — I can’t drive it / stuck on the road','Urgent — need help today','Urgent — vehicle is stranded'])assert.ok(isUrgent(urgency),urgency);
  for(const urgency of ['Soon — needs attention','Flexible — I can wait','Not specified','',null])assert.equal(isUrgent(urgency),false,String(urgency));
});
test('unopened requests repeat: urgent every 15 minutes with the urgent sound, others hourly, until checked',async()=>{
  const store=localStore();let time=1_000_000;const sent=[];
  const sender={ready:true,send:async(t,id,preview,options)=>{sent.push({id,preview,...options});return 'sent';}};
  const push=createPushService({store,env,sender,now:()=>time});
  const urgent={id:'1000000000000-00000000-0000-4000-8000-000000000001',status:'New',name:'Stuck driver',urgency:'Stranded — I can’t drive it / stuck on the road',details:'Flat on I-65'};
  const normal={id:'1000000000000-00000000-0000-4000-8000-000000000002',status:'New',name:'Oil change',urgency:'Flexible — I can wait',details:'Whenever'};
  try{
    await push.register(device,token,{key:'sessions/a'});
    for(const request of [urgent,normal]){await store.put('requests/'+request.id,request);await push.notify(undefined,request);await push.schedule(request);}
    assert.deepEqual(sent.map(s=>[s.preview.customerName,s.priority,s.reminder]),[['Stuck driver','urgent',false],['Oil change','normal',false]]);
    sent.length=0;
    time+=REMINDER_MS.urgent-1;await push.remind();assert.equal(sent.length,0,'nothing before 15 minutes');
    time+=1;await push.remind();
    assert.deepEqual(sent.map(s=>[s.preview.customerName,s.priority,s.reminder]),[['Stuck driver','urgent',true]]);
    await push.remind();assert.equal(sent.length,1,'a second run in the same minute does not double-send');
    time+=REMINDER_MS.urgent;await push.remind();assert.equal(sent.length,2);
    time=1_000_000+REMINDER_MS.normal;await push.remind();
    assert.deepEqual(sent.slice(2).map(s=>[s.preview.customerName,s.priority]).sort(),[['Oil change','normal'],['Stuck driver','urgent']]);
    // Opened (checked) stops the urgent one; a status change stops the other.
    await push.checked(urgent.id);const saved=await store.get('requests/'+normal.id);assert.ok(await store.put('requests/'+normal.id,{...normal,status:'Contacted'},saved.etag));
    sent.length=0;time+=REMINDER_MS.normal*2;await push.remind();
    assert.equal(sent.length,0);assert.equal((await store.keys('push-reminders/')).length,0);
  }finally{store.close();}
});
test('reminders stop for trashed requests and after a week',async()=>{
  const store=localStore();let time=5_000_000;let sends=0;
  const push=createPushService({store,env,sender:{ready:true,send:async()=>{sends++;return 'sent';}},now:()=>time});
  try{
    await push.register(device,token,{key:'sessions/a'});
    const trashed={id:'1000000000000-00000000-0000-4000-8000-000000000003',status:'New',urgency:'Urgent — need help today'};
    const old={id:'1000000000000-00000000-0000-4000-8000-000000000004',status:'New',urgency:'Soon — needs attention'};
    await store.put('requests/'+trashed.id,{...trashed,deletedAt:'2026-11-02T00:00:00.000Z'});await store.put('requests/'+old.id,old);
    await push.schedule(trashed);await push.schedule(old);
    time+=8*86400000;await push.remind();
    assert.equal(sends,0);assert.equal((await store.keys('push-reminders/')).length,0);
  }finally{store.close();}
});
