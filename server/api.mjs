import { normalizeVin, validVin, specFields } from '../vin-core.js';
import { randomUUID } from 'node:crypto';
import { configured, cookieValue, digest, sessionCookie, SESSION_MS, token, verifyPassword } from './auth.mjs';

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_MEDIA_BYTES + 65536;
const STATUSES = ['New', 'Contacted', 'Scheduled', 'In progress', 'Completed', 'Cancelled'];
const idPattern = /^\d{13}-[0-9a-f-]{36}$/;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (value, max, required = true) => {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) fail(400, 'Please check the form fields.');
  return value.trim();
};
const customerText = (value,max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const safeName = value => value.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 100) || 'attachment';
const publicRecord = r => r; // Returned only after session authorization; never on public submission.

async function limitedBody(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) fail(413, 'Files are too large. Keep all attachments under 4 MB combined.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); fail(413, 'Files are too large. Keep all attachments under 4 MB combined.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request, max = 16384) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON is required.');
  try { return JSON.parse(Buffer.from(await limitedBody(request, max)).toString()); }
  catch (error) { if (error instanceof HttpError) throw error; fail(400, 'Invalid JSON.'); }
}

function validMedia(bytes, mime) {
  const head = Buffer.from(bytes);
  if (mime === 'image/jpeg') return head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/gif') return /^GIF8[79]a/.test(head.subarray(0, 6).toString());
  if (mime === 'image/webp') return head.subarray(0,4).toString() === 'RIFF' && head.subarray(8,12).toString() === 'WEBP';
  if (mime === 'video/mp4' || mime === 'video/quicktime') return head.subarray(4,8).toString() === 'ftyp';
  if (mime === 'video/webm') return head.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  return false;
}

// The adapter uses conditional writes, so rate limits and owner edits are safe across function instances.
export function createApi({ store, env = process.env, now = Date.now }) {
  async function throttle(key, limit, windowMs) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await store.get('limits/' + key);
      const active = entry && entry.value.until > now();
      const value = active ? { ...entry.value } : { count: 0, until: now() + windowMs };
      if (value.count >= limit) fail(429, 'Too many attempts. Please try again in 15 minutes.');
      value.count++;
      if (await store.put('limits/' + key, value, entry?.etag)) return;
    }
    fail(429, 'Please wait a moment and try again.');
  }
  async function session(request) {
    const raw = cookieValue(request);
    if (!/^[a-f0-9]{64}$/.test(raw)) fail(401, 'Please sign in.');
    const key = 'sessions/' + digest(raw);
    const entry = await store.get(key);
    if (!entry) fail(401, 'Please sign in.');
    if (entry.value.expires <= now() || entry.value.authVersion !== digest(env.OWNER_PASSWORD_HASH)) {
      await store.remove(key); fail(401, 'Your session has expired. Please sign in again.');
    }
    return { ...entry.value, key };
  }
  function sameOrigin(request) {
    if (request.headers.get('origin') !== new URL(request.url).origin) fail(403, 'Please open the owner dashboard on its secure host.');
  }

  return async function handle(request, context = {}) {
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api/, '') || '/';
    const origin = request.headers.get('origin');
    const allowedPublic = [url.origin, ...(env.PUBLIC_SITE_ORIGINS || 'https://codemastercody3d.github.io,https://swaggdaddys.com,https://www.swaggdaddys.com').split(',').map(v => v.trim())];
    const publicIntake = route === '/requests' && ['POST','OPTIONS'].includes(request.method);
    const publicHealth = route === '/health' && ['GET','OPTIONS'].includes(request.method);
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', 'Referrer-Policy': 'no-referrer' });
    if ((publicIntake || publicHealth) && allowedPublic.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
    const json = (value, status = 200, extra = {}) => {
      const h = new Headers(headers); h.set('Content-Type', 'application/json');
      for (const [key,value] of Object.entries(extra)) h.set(key, value);
      return new Response(JSON.stringify(value), { status, headers: h });
    };
    try {
      if (request.method === 'OPTIONS') {
        if ((!publicIntake && !publicHealth) || !allowedPublic.includes(origin)) fail(403, 'Origin not allowed.');
        headers.set('Access-Control-Allow-Methods', publicHealth ? 'GET, OPTIONS' : 'POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');
        return new Response(null, { status: 204, headers });
      }
      if (route === '/health' && request.method === 'GET') return json({ ready: configured(env) });
      if (!configured(env)) fail(503, 'Owner access has not been activated yet. Please call or text 205-492-8772.');

      if (route === '/login' && request.method === 'POST') {
        sameOrigin(request);
        await throttle('login-' + digest(context.ip || 'unknown'), 8, 15 * 60 * 1000);
        const body = await jsonBody(request, 2048);
        const username = text(body?.username, 100);
        const password = body?.password;
        if (typeof password !== 'string' || !password || password.length > 256) fail(400, 'Enter your password.');
        const correct = await verifyPassword(password, env.OWNER_PASSWORD_HASH);
        if (!correct || username !== (env.OWNER_USERNAME || 'owner')) fail(401, 'Username or password is incorrect.');
        const raw = token(); const csrf = token();
        // Re-login replaces the session in this browser instead of leaving it usable.
        const previous = cookieValue(request);
        if (/^[a-f0-9]{64}$/.test(previous)) await store.remove('sessions/' + digest(previous));
        await store.put('sessions/' + digest(raw), { csrf, expires: now() + SESSION_MS, authVersion: digest(env.OWNER_PASSWORD_HASH) });
        return json({ csrf, username }, 200, { 'Set-Cookie': sessionCookie(raw) });
      }

      if (publicIntake && request.method === 'POST') {
        if (!origin || !allowedPublic.includes(origin)) fail(403, 'Origin not allowed.');
        await throttle('intake-' + digest(context.ip || 'unknown'), 5, 15 * 60 * 1000);
        if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) fail(415, 'A service request form is required.');
        const bytes = await limitedBody(request, MAX_BODY_BYTES);
        let form;
        try { form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('content-type') }, body: bytes }).formData(); }
        catch { fail(400, 'The form could not be read.'); }
        if (form.get('website')) return json({ received: true }, 202); // Honeypot; no customer data is stored.
        const record = {
          id: `${now()}-${randomUUID()}`, createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(),
          name: customerText(form.get('name'),100) || 'Name not provided', phone: customerText(form.get('phone'),80), vehicle: customerText(form.get('vehicle'),160) || 'Vehicle details not provided',
          location: customerText(form.get('location'),120) || 'Location not provided', urgency: customerText(form.get('urgency'),80) || 'Not specified', issue: customerText(form.get('issue'),160) || 'Service request',
          details: customerText(form.get('details'),2000), status: 'New', notes: '', media: []
        };
        record.vinSubmitted = customerText(form.get('vin'),80);
        const candidateVin = normalizeVin(record.vinSubmitted);
        record.vin = validVin(candidateVin) ? candidateVin : '';
        record.vehicleSpecs = {};
        if (record.vin && form.get('vin_specs')) {
          try {
            const specs = JSON.parse(customerText(form.get('vin_specs'),2048));
            if (specs && typeof specs === 'object' && !Array.isArray(specs)) for (const key of Object.keys(specFields)) {
              const value=customerText(specs[key],120);if(value)record.vehicleSpecs[key]=value;
            }
          } catch { /* Uncertain vehicle details never block a service request. */ }
        }
        const digits=record.phone.replace(/\D/g,'');
        record.dialNumber = digits.length>=7 && digits.length<=15 && /^[+\d\s().-]+$/.test(record.phone) ? (record.phone.startsWith('+')?'+':'')+digits : '';
        if (form.get('location_consent') !== 'yes') fail(400, 'Please accept the service request disclosure.');
        record.consentAt = record.createdAt;
        const lat = form.get('latitude'); const lng = form.get('longitude');
        if (lat || lng) {
          const latitude = Number(lat), longitude = Number(lng), accuracy = Number(form.get('location_accuracy'));
          if (lat && lng && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude)<=90 && Math.abs(longitude)<=180 && Number.isFinite(accuracy) && accuracy>=0) record.gps={latitude,longitude,accuracy};
        }
        const files = form.getAll('issue_media').filter(f => typeof f !== 'string' && f.size > 0);
        if (files.length > 3 || files.reduce((sum,f) => sum + f.size, 0) > MAX_MEDIA_BYTES) fail(413, 'Choose up to 3 files, under 4 MB combined.');
        if (files.filter(f => f.type.startsWith('video/')).length > 1) fail(400, 'Choose at most one video.');
        const uploads = [];
        for (const file of files) {
          const data = await file.arrayBuffer();
          if (!validMedia(data, file.type)) fail(415, 'Use JPG, PNG, GIF, WebP, MP4, MOV, or WebM files.');
          const id = randomUUID();
          record.media.push({ id, name: safeName(file.name), type: file.type, size: file.size });
          uploads.push({ key: `media/${record.id}/${id}`, data });
        }
        const saved = [];
        try {
          for (const upload of uploads) { await store.putBytes(upload.key, upload.data); saved.push(upload.key); }
          await store.put('requests/' + record.id, record);
        } catch (error) {
          await Promise.allSettled(saved.map(key => store.remove(key))); throw error;
        }
        return json({ received: true, reference: record.id }, 201);
      }

      const auth = await session(request);
      if (route === '/session' && request.method === 'GET') return json({ username: env.OWNER_USERNAME || 'owner', csrf: auth.csrf });
      if (['POST','PATCH','DELETE','PUT'].includes(request.method)) {
        sameOrigin(request);
        if (request.headers.get('x-csrf-token') !== auth.csrf) fail(403, 'Please reload the dashboard and try again.');
      }
      if (route === '/logout' && request.method === 'POST') {
        await store.remove(auth.key);
        return json({ signedOut: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
      }
      if (route === '/requests' && request.method === 'GET') {
        const before = url.searchParams.get('before');
        if (before && !idPattern.test(before)) fail(400, 'Invalid page.');
        const trash = url.searchParams.get('view') === 'trash';
        const keys = (await store.keys('requests/')).sort().reverse().filter(key => !before || key < 'requests/' + before);
        const matches = [];
        for (const key of keys) {
          const entry = await store.get(key);
          if (entry && Boolean(entry.value.deletedAt) === trash) {
            matches.push({ ...publicRecord(entry.value), revision:entry.etag });
            if (matches.length === 51) break;
          }
        }
        return json({ items:matches.slice(0,50), next:matches.length>50 ? matches[49].id : null, statuses:STATUSES });
      }
      const historyMatch = route.match(/^\/vehicles\/([A-HJ-NPR-Z0-9]{17})\/history$/);
      if (historyMatch && request.method === 'GET') {
        const before = url.searchParams.get('before');
        if (before && !idPattern.test(before)) fail(400, 'Invalid page.');
        const keys = (await store.keys('requests/')).sort().reverse().filter(key => !before || key < 'requests/' + before);
        const matches = [];
        for (const key of keys) {
          const entry = await store.get(key);
          if (entry?.value.vin === historyMatch[1] && !entry.value.deletedAt) { matches.push(entry.value); if (matches.length === 51) break; }
        }
        return json({items:matches.slice(0,50),next:matches.length>50 ? matches[49].id : null});
      }
      const match = route.match(/^\/requests\/([^/]+)(?:\/media\/([a-f0-9-]{36})|\/(restore))?$/);
      if (!match || !idPattern.test(match[1])) fail(404, 'Not found.');
      const key = 'requests/' + match[1];
      const entry = await store.get(key);
      if (!entry) fail(404, 'Request not found.');
      if (match[2] && request.method === 'GET') {
        const file = entry.value.media.find(f => f.id === match[2]);
        if (!file) fail(404, 'Attachment not found.');
        const data = await store.getBytes(`media/${match[1]}/${match[2]}`);
        if (!data) fail(404, 'Attachment not found.');
        headers.set('Content-Type', file.type);
        headers.set('Content-Disposition', `attachment; filename="${file.name}"`);
        headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
        return new Response(data, { headers });
      }
      if (!match[2] && !match[3] && request.method === 'GET') return json({ ...entry.value, revision: entry.etag });
      if (!match[2] && !match[3] && request.method === 'PATCH') {
        const body = await jsonBody(request);
        if (!body || typeof body !== 'object') fail(400, 'Invalid update.');
        if (entry.value.deletedAt) fail(409, 'Restore this request before editing it.');
        if (!STATUSES.includes(body.status)) fail(400, 'Choose a valid status.');
        const notes = text(body.notes ?? '', 4000, false);
        if (body.revision !== entry.etag) fail(409, 'This request changed. Reload it before saving.');
        const record = { ...entry.value, status: body.status, notes, updatedAt: new Date(now()).toISOString() };
        if (body.status === 'Completed' && entry.value.status !== 'Completed') record.completedAt = record.updatedAt;
        if (!await store.put(key, record, entry.etag)) fail(409, 'This request changed. Reload it before saving.');
        const latest = await store.get(key);
        return json({ ...latest.value, revision: latest.etag });
      }
      if ((!match[2] && !match[3] && request.method === 'DELETE') || (match[3] === 'restore' && request.method === 'POST')) {
        const body = await jsonBody(request,2048);
        if (body?.revision !== entry.etag) fail(409, 'This request changed. Reload it before trying again.');
        const restoring = match[3] === 'restore';
        if (restoring !== Boolean(entry.value.deletedAt)) fail(409, restoring ? 'This request is already active.' : 'This request is already in Trash.');
        const record = { ...entry.value, updatedAt:new Date(now()).toISOString() };
        if (restoring) delete record.deletedAt;
        else record.deletedAt = record.updatedAt;
        if (!await store.put(key,record,entry.etag)) fail(409, 'This request changed. Reload it before trying again.');
        return json({ ...record, revision:(await store.get(key)).etag });
      }
      fail(405, 'Method not allowed.');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Do not log the request, credentials, GPS, customer fields, or upload contents.
      console.error('Owner inbox operation failed:', error?.name || 'Error');
      return json({ error: 'The service is temporarily unavailable. Please try again or call 205-492-8772.' }, 503);
    }
  };
}
