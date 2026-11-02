import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationRequest } from '../request-location.js';
function fixture() {
  let allow, deny, timeout, calls = 0; const states = [];
  const location = createLocationRequest({ geolocation: { getCurrentPosition(ok, error) { calls++; allow=ok; deny=error; } },
    onChange: (state, coords) => states.push({state,coords}), schedule: fn => (timeout=fn), cancel() {} });
  return { location, states, allow:coords=>allow({coords}), deny:()=>deny({code:1}), timeout:()=>timeout(), get calls() { return calls; } };
}
test('submitting requests permission immediately and includes coordinates only after consent', async () => {
  const f=fixture(), result=f.location.request(); assert.equal(f.calls,1); assert.equal(f.states.at(-1).state,'waiting');
  const coords={latitude:33,longitude:-87,accuracy:15}; f.allow(coords); assert.deepEqual(await result,coords);
  assert.deepEqual(await f.location.request(),coords); assert.equal(f.calls,1);
});
test('denial resolves without coordinates and a submit retry does not ask again', async () => {
  const f=fixture(), result=f.location.request(); f.deny(); assert.equal(await result,null);
  assert.equal(await f.location.request(),null); assert.equal(f.calls,1); assert.equal(f.states.at(-1).state,'denied');
});
test('concurrent requests share one permission prompt and explicit retry remains available', async () => {
  const f=fixture(), a=f.location.request(), b=f.location.request(); assert.equal(a,b); f.deny(); await a;
  const next=f.location.request({retry:true}); assert.equal(f.calls,2); f.deny(); await next;
});
test('timeout allows submission and ignores a late grant', async () => {
  const f=fixture(), result=f.location.request(); f.timeout(); assert.equal(await result,null);
  f.allow({latitude:33,longitude:-87,accuracy:5}); assert.equal(f.states.at(-1).state,'timeout');
});
test('new requests reset saved coordinates and invalid coordinates never become shared', async () => {
  const f=fixture(), first=f.location.request(); f.allow({latitude:33,longitude:-87,accuracy:5}); await first; f.location.reset();
  const next=f.location.request(); assert.equal(f.calls,2); f.allow({latitude:100,longitude:-87,accuracy:5}); assert.equal(await next,null);
});
test('unsupported location remains optional', async () => {
  assert.equal(await createLocationRequest({geolocation:null}).request(),null);
});
