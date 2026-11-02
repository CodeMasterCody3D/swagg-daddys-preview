import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePoint, mileageQuote, drivingMiles, straightMiles } from '../server/route.mjs';
import { createApi } from '../server/api.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword } from '../server/auth.mjs';

test('mileage: first 30 driving miles included, $2.00 per mile after, fee matches the miles shown', () => {
  assert.deepEqual(mileageQuote(12.04), { miles:12, overMiles:0, feeCents:0 });
  assert.deepEqual(mileageQuote(30.04), { miles:30, overMiles:0, feeCents:0 });
  assert.deepEqual(mileageQuote(57.51), { miles:57.5, overMiles:27.5, feeCents:5500 });
});

test('only well-formed coordinates are accepted', () => {
  assert.deepEqual(parsePoint('33.5186,-86.8104'), { lat:33.5186, lng:-86.8104 });
  for (const bad of ['', '91,0', '0,181', '33.5;-86.8', '1e2,3', '33.5,-86.8,1', 'x,y']) assert.equal(parsePoint(bad), null, bad);
});

test('driving distance comes from OSRM; if it fails, an estimate is labeled as such', async () => {
  const from = { lat:33.5186, lng:-86.8104 }, to = { lat:33.2098, lng:-87.5692 };
  const urls = [];
  const ok = await drivingMiles(from, to, { fetcher:async url => { urls.push(url); return Response.json({ code:'Ok', routes:[{ distance:92540 }] }); } });
  assert.equal(ok.source, 'driving'); assert.equal(ok.miles, 57.5);
  assert.match(urls[0], /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/-86\.8104,33\.5186;-87\.5692,33\.2098\?/);
  const down = await drivingMiles(from, to, { fetcher:async () => { throw new TypeError('offline'); } });
  assert.equal(down.source, 'estimate');
  assert.ok(Math.abs(down.miles - Math.round(straightMiles(from, to) * 1.25 * 10) / 10) < 1e-9);
});

test('the route lookup needs an owner session and both points', async () => {
  const password = 'test-only-long-password', origin = 'https://swaggdaddys.com';
  const env = { OWNER_PASSWORD_HASH:await hashPassword(password), OWNER_USERNAME:'owner' };
  const calls = [];
  const store = localStore(); const api = createApi({ store, env, routeMiles:async (a, b) => { calls.push([a, b]); return { miles:40, overMiles:10, feeCents:2000, source:'driving' }; } });
  const get = (path, cookie) => api(new Request(origin + '/api' + path, { headers:cookie ? { Cookie:cookie } : {} }), { ip:'route-test' });
  try {
    assert.equal((await get('/route?from=33.5,-86.8&to=33.2,-87.5')).status, 401); assert.equal(calls.length, 0);
    const login = await api(new Request(origin + '/api/login', { method:'POST', headers:{ Origin:origin, 'Content-Type':'application/json' }, body:JSON.stringify({ username:'owner', password }) }), { ip:'route-test' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await get('/route?from=33.5,-86.8', cookie)).status, 400);
    const quote = await (await get('/route?from=33.5,-86.8&to=33.2,-87.5', cookie)).json();
    assert.equal(quote.feeCents, 2000); assert.deepEqual(calls[0], [{ lat:33.5, lng:-86.8 }, { lat:33.2, lng:-87.5 }]);
  } finally { store.close(); }
});
