import test from 'node:test';
import assert from 'node:assert/strict';
import { netlifyStore } from '../server/netlify-store.mjs';

test('trusted runtime deployment context preserves production storage and isolates every preview', () => {
  const stores=[]; const openStore=options=>{stores.push(options);return {};};
  netlifyStore({deploy:{context:'production',id:'prod-1'}},openStore);
  netlifyStore({deploy:{context:'production',id:'prod-2'}},openStore);
  netlifyStore({deploy:{context:'deploy-preview',id:'preview-1'}},openStore);
  netlifyStore({deploy:{context:'deploy-preview',id:'preview-2'}},openStore);
  assert.equal(stores[0].name,stores[1].name);
  assert.notEqual(stores[0].name,stores[2].name);
  assert.notEqual(stores[2].name,stores[3].name);
  assert.ok(stores.every(s=>s.consistency==='strong'));
  assert.throws(()=>netlifyStore({},openStore),/Missing trusted deployment context/);
});
