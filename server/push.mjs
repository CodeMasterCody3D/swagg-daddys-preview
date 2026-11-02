import { sign, randomUUID } from 'node:crypto';
import { digest, ownerAccount } from './auth.mjs';

const DAY = 86400000;
const MINUTE = 60000;
// Unopened requests keep alerting the owner until he opens them (or changes their
// status). Stranded/urgent: every 15 minutes, with a three-ring sound on the
// phone. Everything else: every hour, normal sound. Reminders stop after a week.
export const REMINDER_MS = { urgent:15*MINUTE, normal:60*MINUTE };
const REMINDER_LIMIT = 7*DAY;
export const isUrgent = urgency => /^\s*(stranded|urgent)\b/i.test(typeof urgency === 'string' ? urgency : '');
const devicePattern = /^[A-Za-z0-9_-]{20,80}$/;
export const validDeviceId = value => typeof value === 'string' && devicePattern.test(value);
const tokenValid = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{20,4096}$/.test(value);

function previewText(value, limit) {
  const clean = (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  const characters = [...clean];
  return characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : clean;
}
export function notificationPreview(request = {}) {
  return { customerName: previewText(request.name, 80) || 'Customer',
    requestSummary: previewText(request.details, 160) || previewText(request.issue, 160) || 'Tap to view the service request.' };
}

// Only public Android client options leave the server, after owner authentication.
// The service-account credentials are never included in this result.
export function clientNotificationConfig(env) {
  try {
    const config = JSON.parse(env.FIREBASE_ANDROID_CONFIG_JSON || 'null');
    const client = config?.client?.find(c => c.client_info?.android_client_info?.package_name === 'com.swaggdaddysmobile');
    const result = { appId:client?.client_info?.mobilesdk_app_id, apiKey:client?.api_key?.[0]?.current_key,
      senderId:String(config?.project_info?.project_number || ''), projectId:config?.project_info?.project_id };
    if (!/^1:\d+:android:[a-f0-9]+$/.test(result.appId || '') || !/^AIza[\w-]{35}$/.test(result.apiKey || '')
      || !/^\d+$/.test(result.senderId) || !/^[a-z][a-z0-9-]{4,62}$/.test(result.projectId || '')
      || !result.appId.startsWith('1:' + result.senderId + ':')) return null;
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || 'null');
    if (account?.project_id && account.project_id !== result.projectId) return null;
    return result;
  } catch { return null; }
}

export function fcmSender(env, fetcher = fetch, now = Date.now) {
  let account;
  try {
    const a = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || 'null');
    if (a?.project_id && /^[a-z0-9-]+$/.test(a.project_id) && a.client_email && a.private_key) account = a;
  } catch { /* No credentials means push stays disabled. */ }
  let access;
  async function accessToken() {
    if (access?.expires > now() + 60000) return access.token;
    const seconds = Math.floor(now() / 1000);
    const b64 = object => Buffer.from(JSON.stringify(object)).toString('base64url');
    const unsigned = b64({ alg:'RS256', typ:'JWT' }) + '.' + b64({ iss:account.client_email, scope:'https://www.googleapis.com/auth/firebase.messaging', aud:'https://oauth2.googleapis.com/token', iat:seconds, exp:seconds+3600 });
    const assertion = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
    const response = await fetcher('https://oauth2.googleapis.com/token', { method:'POST', signal:AbortSignal.timeout(5000), body:new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    const body = await response.json();
    if (!response.ok || !body.access_token) throw new Error('Push authorization failed');
    access = { token:body.access_token, expires:now()+Math.min(Number(body.expires_in)||3600,3600)*1000 };
    return access.token;
  }
  return {
    ready:Boolean(account),
    async send(token, eventId, preview, { priority = 'normal', reminder = false } = {}) {
      const bearer = await accessToken();
      // The app picks the three-ring urgent channel from `priority`.
      const data = { type:'service_request', eventId, priority: priority === 'urgent' ? 'urgent' : 'normal', reminder: reminder ? '1' : '0' };
      if (preview) {
        data.customerName = previewText(preview.customerName, 80) || 'Customer';
        data.requestSummary = previewText(preview.requestSummary, 160) || 'Tap to view the service request.';
      }
      const response = await fetcher('https://fcm.googleapis.com/v1/projects/'+account.project_id+'/messages:send', {
        method:'POST', signal:AbortSignal.timeout(5000), headers:{ Authorization:'Bearer '+bearer, 'Content-Type':'application/json' },
        body:JSON.stringify({ message:{ token, data, android:{ priority:'HIGH', ttl:'86400s', collapse_key:'owner-inbox' } } })
      });
      if (response.ok) return 'sent';
      const body = await response.json().catch(()=>({}));
      if (body.error?.details?.some(d=>d.errorCode==='UNREGISTERED')) return 'unregistered';
      if (response.status===401) access=null;
      throw new Error('Push delivery failed');
    }
  };
}

export function createPushService({ store, env, now = Date.now, sender = fcmSender(env) }) {
  const authVersion = username => {
    const account = ownerAccount(env, username ?? (env.OWNER_USERNAME || 'owner'));
    return account ? digest(account.passwordHash) : null;
  };
  async function register(id, token, auth) {
    if (!validDeviceId(id) || !tokenValid(token)) throw new Error('Invalid notification device');
    const username = auth.username ?? (env.OWNER_USERNAME || 'owner');
    const version = authVersion(username);
    if (!version || (auth.authVersion && auth.authVersion !== version)) throw new Error('Please sign in again to enable notifications');
    const key='push-devices/'+id;
    for(let attempt=0;attempt<3;attempt++) {
      const old=await store.get(key);
      if (!old && (await store.keys('push-devices/')).length>=10) throw new Error('Remove an old notification device before adding another');
      if(await store.put(key,{ token, username, sessionKey:auth.key, authVersion:version, expires:now()+90*DAY },old?.etag))return;
    }
    throw new Error('Please retry notification setup');
  }
  async function remove(id) { if(validDeviceId(id))await store.remove('push-devices/'+id); }
  async function signOut(auth) {
    for(const key of await store.keys('push-devices/')) {
      const device=await store.get(key);
      if(device?.value.sessionKey===auth.key)await store.remove(key);
    }
  }
  async function drain(selectedKeys) {
    if(!sender.ready)return;
    // Bounded work per invocation. Pending events survive process restarts.
    for(const key of selectedKeys || (await store.keys('push-outbox/')).sort().slice(0,4)) {
      let event=await store.get(key);if(!event)continue;
      if(event.value.expires<=now()){await store.remove(key);continue;}
      const pending=[];
      await Promise.all(event.value.devices.map(async deviceKey=>{
        const entry=await store.get(deviceKey);if(!entry)return;
        const device=entry.value;
        const version = authVersion(device.username);
        if(!version || device.expires<=now() || device.authVersion!==version){await store.remove(deviceKey);return;}
        try { if(await sender.send(device.token,event.value.id,event.value.preview,{priority:event.value.priority,reminder:event.value.reminder})==='unregistered')await store.remove(deviceKey); }
        catch { pending.push(deviceKey); }
      }));
      if(!pending.length)await store.remove(key);
      else await store.put(key,{...event.value,devices:pending},event.etag);
    }
  }
  async function notify(waitUntil, request, { reminder = false } = {}) {
    if(!sender.ready)return;
    const devices=(await store.keys('push-devices/')).slice(0,10);
    if(!devices.length)return;
    const id=randomUUID();
    const key='push-outbox/'+String(now())+'-'+id;
    const priority=isUrgent(request?.urgency)?'urgent':'normal';
    await store.put(key,{id,devices,expires:now()+DAY,priority,reminder,...(request ? {preview:notificationPreview(request)} : {})});
    // Persist first, then let Netlify finish delivery after the intake response.
    // The scheduled retry can recover if this process exits before delivery.
    const delivery = drain([key]).catch(() => {});
    if (waitUntil) waitUntil(delivery); else await delivery;
  }
  // Called when a request is saved. The scheduled function calls remind().
  async function schedule(request) {
    if(!sender.ready||!request?.id)return;
    const urgent=isUrgent(request.urgency);
    await store.put('push-reminders/'+request.id,{id:request.id,urgent,next:now()+(urgent?REMINDER_MS.urgent:REMINDER_MS.normal),until:now()+REMINDER_LIMIT});
  }
  // The owner opened the request, changed its status, or trashed it.
  async function checked(id) { await store.remove('push-reminders/'+id); }
  async function remind(waitUntil) {
    if(!sender.ready)return;
    // Bounded work per run; anything not reached is picked up on the next run.
    let sent=0;
    for(const key of (await store.keys('push-reminders/')).sort()) {
      if(sent>=10)break;
      const entry=await store.get(key);if(!entry)continue;
      const reminder=entry.value;
      if(reminder.next>now())continue;
      const request=(await store.get('requests/'+reminder.id))?.value;
      if(!request||request.deletedAt||(request.status&&request.status!=='New')||reminder.until<=now()){await store.remove(key);continue;}
      // Move the next time forward before sending, so an overlapping run cannot double-send.
      if(!await store.put(key,{...reminder,next:now()+(reminder.urgent?REMINDER_MS.urgent:REMINDER_MS.normal)},entry.etag))continue;
      await notify(waitUntil,request,{reminder:true});sent++;
    }
  }
  return { ready:sender.ready,register,remove,signOut,notify,drain,schedule,checked,remind };
}
