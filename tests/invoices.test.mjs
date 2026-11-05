import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanInvoice, draftInvoice, mileageFee, totals, DEFAULTS } from '../server/invoices.mjs';
import { renderInvoice } from '../invoice-render.js';
import { createApi } from '../server/api.mjs';
import { localStore } from '../server/local-store.mjs';
import { hashPassword } from '../server/auth.mjs';

const origin = 'https://swaggdaddys.com', password = 'test-only-long-password';
const env = { OWNER_PASSWORD_HASH:await hashPassword(password), OWNER_USERNAME:'owner' };

test('totals: labor + parts + fees − discount, sales tax on parts only, balance after payment', () => {
  const inv = cleanInvoice({
    labor:[{ description:'Replace starter', hours:'1.5', rate:'90' }],
    parts:[{ description:'Starter', partNumber:'ST-1', qty:'1', unit:'189.99' }, { description:'Bolt', qty:'2', unit:'1.25' }],
    fees:[{ description:'Diagnostic fee', amount:'65' }, { description:'', amount:'' }],
    discount:'10', taxRate:'10', paid:'100'
  });
  assert.equal(inv.labor[0].amount, 13500); assert.equal(inv.parts[0].amount, 18999); assert.equal(inv.parts[1].amount, 250);
  assert.equal(inv.fees.length, 1, 'blank lines are dropped');
  assert.deepEqual(inv.totals, { labor:13500, parts:19249, fees:6500, subtotal:39249, discount:1000, tax:1925, total:40174, paid:10000, balance:30174 });
});

test('mileage: first 30 driving miles included, $2 per mile after', () => {
  assert.equal(mileageFee(12), 0); assert.equal(mileageFee(30), 0); assert.equal(mileageFee(42.5), 2500); assert.equal(mileageFee('x'), 0);
});

test('cleaning bounds every number and drops unknown fields; a draft starts from the request', () => {
  const inv = cleanInvoice({ status:'Hacked', taxRate:'99', discount:'-5', labor:[{ description:'x'.repeat(500), hours:'9999', rate:'1e9' }], admin:true, totals:{ total:1 } });
  assert.equal(inv.status, 'Draft'); assert.equal(inv.taxRate, 20); assert.equal(inv.discount, 0); assert.equal(inv.admin, undefined);
  assert.equal(inv.labor[0].description.length, 200); assert.equal(inv.labor[0].hours, 200); assert.equal(inv.labor[0].rate, 100000);
  assert.notEqual(inv.totals.total, 1, 'totals are always recomputed');
  const draft = draftInvoice({ name:'Jordan', phone:'205-555-0100', location:'Hoover', vehicle:'2008 Honda Civic', vin:'1HGCM82633A004352', issue:'Vehicle won’t start', details:'Clicks' });
  assert.equal(draft.customer.name, 'Jordan'); assert.equal(draft.vehicle.description, '2008 Honda Civic');
  assert.deepEqual(draft.fees, [{ description:'Diagnostic fee (includes travel within 30 miles)', amount:DEFAULTS.diagnosticFee }]);
  assert.equal(draft.taxRate, 10); assert.equal(draft.totals.total, 6500);
});

test('the invoice document escapes customer text and shows the business contact details', () => {
  const html = renderInvoice({ ...cleanInvoice({ customer:{ name:'<img src=x onerror=alert(1)>' }, workPerformed:'<script>x</script>' }), number:'SD-2026-0001' });
  assert.ok(!html.includes('<img src=x')); assert.ok(!html.includes('<script>'));
  for (const text of ['admin@swaggdaddys.com', '205-492-8772', 'SD-2026-0001', 'Balance due']) assert.ok(html.includes(text), text);
});

test('owner-only editing with CSRF, sequential numbers, private customer link, void hides it', async () => {
  const store = localStore(); const api = createApi({ store, env, notifications:{ ready:false, notify:async()=>{}, schedule:async()=>{}, checked:async()=>{}, register:async()=>{}, remove:async()=>{}, signOut:async()=>{} } });
  const req = (path, { method = 'GET', body, cookie, csrf } = {}) => api(new Request(origin + '/api' + path, { method,
    headers:{ ...(method !== 'GET' ? { Origin:origin } : {}), ...(cookie ? { Cookie:cookie } : {}), ...(csrf ? { 'X-CSRF-Token':csrf } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined }), { ip:'invoice-test' });
  try {
    const id = '1793458800000-00000000-0000-4000-8000-0000000000aa';
    await store.put('requests/' + id, { id, name:'Jordan', phone:'205-555-0100', vehicle:'2008 Honda Civic', location:'Hoover', status:'New', media:[] });
    assert.equal((await req('/requests/' + id + '/invoice')).status, 401);
    const login = await req('/login', { method:'POST', body:{ username:'owner', password } });
    const cookie = login.headers.get('set-cookie').split(';')[0], { csrf } = await login.json();
    const draft = await (await req('/requests/' + id + '/invoice', { cookie })).json();
    assert.equal(draft.saved, false); assert.equal(draft.token, undefined);
    assert.equal((await req('/requests/' + id + '/invoice', { method:'PUT', cookie, body:{ ...draft, fees:[{ description:'Diag', amount:65 }] } })).status, 403, 'CSRF required');
    const saved = await (await req('/requests/' + id + '/invoice', { method:'PUT', cookie, csrf, body:{ ...draft, fees:[{ description:'Diag', amount:65 }] } })).json();
    assert.match(saved.number, /^SD-\d{4}-0001$/); assert.match(saved.token, /^[a-f0-9]{32}$/); assert.equal(saved.totals.total, 6500);
    assert.equal((await req('/requests/' + id + '/invoice', { method:'PUT', cookie, csrf, body:{ ...saved, revision:'stale' } })).status, 409);
    const view = await req('/invoice/' + saved.token);
    assert.equal(view.status, 200); const shown = await view.json();
    assert.equal(shown.number, saved.number); assert.equal(shown.token, undefined); assert.equal(shown.business.email, 'admin@swaggdaddys.com');
    assert.equal((await req('/invoice/' + 'f'.repeat(32))).status, 404);
    const resaved = await (await req('/requests/' + id + '/invoice', { method:'PUT', cookie, csrf, body:{ ...saved, status:'Void' } })).json();
    assert.equal(resaved.number, saved.number, 'number is kept on edits');
    assert.equal((await req('/invoice/' + saved.token)).status, 404, 'a voided invoice link stops working');
  } finally { store.close(); }
});

test('invoice section lists existing and standalone invoices by payment state, with search and pagination', async () => {
  const { createInvoices } = await import('../server/invoices.mjs');
  const store = localStore(); let clock = Date.UTC(2026, 10, 5);
  const invoices = createInvoices({ store, now:() => clock++ });
  try {
    const draft = await invoices.save({ id:'1793458800000-00000000-0000-4000-8000-0000000000aa' }, { customer:{name:'Jordan'}, status:'Draft', fees:[{description:'Diagnostic',amount:65}] });
    const unpaid = await invoices.create({ customer:{name:'Casey'}, status:'Sent', fees:[{description:'Diagnostic',amount:65}], paid:20 });
    await invoices.create({ customer:{name:'Paid customer'}, status:'Paid', fees:[{description:'Diagnostic',amount:65}], paid:65 });
    await invoices.create({ customer:{name:'Settled customer'}, status:'Sent', fees:[{description:'Diagnostic',amount:65}], paid:65 });
    await invoices.create({ customer:{name:'Voided customer'}, status:'Void' });
    assert.deepEqual((await invoices.list()).counts, {new:1, unpaid:1, paid:2, void:1});
    const listed = await invoices.list({view:'unpaid',query:'CASEY'});
    assert.equal(listed.items[0].id, unpaid.invoice.id);
    assert.equal(listed.items[0].totals.balance, 4500);
    assert.equal(listed.items[0].token, undefined, 'private invoice links are not in list summaries');
    assert.equal(listed.items[0].revision, undefined);
    assert.equal((await invoices.list({query:draft.invoice.number})).items[0].id, draft.invoice.id);
    assert.equal((await invoices.list({view:'paid'})).items.length, 2);
    for(let i=0;i<32;i++) await invoices.create({customer:{name:'Draft '+i}});
    const page = await invoices.list();
    assert.equal(page.items.length, 30); assert.ok(page.next);
    const rest = await invoices.list({before:page.next});
    assert.equal(rest.items.length, 3); assert.equal(rest.next, null);
    assert.equal(new Set([...page.items,...rest.items].map(i=>i.id)).size,33);
  } finally { store.close(); }
});

test('direct invoice API requires owner authentication and CSRF, supports new invoices and status changes without requests', async () => {
  const store=localStore(), api=createApi({store,env});
  const req=(path,{method='GET',cookie,csrf,body}={})=>api(new Request(origin+'/api'+path,{method,
    headers:{...(method!=='GET'?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined}),{ip:'direct-invoice-test'});
  try {
    for(const path of ['/invoices','/invoices/new']) assert.equal((await req(path)).status,401);
    const login=await req('/login',{method:'POST',body:{username:'owner',password}});
    const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();
    const draft=await(await req('/invoices/new',{cookie})).json(); assert.equal(draft.saved,false);
    assert.equal((await req('/invoices',{method:'POST',cookie,body:draft})).status,403);
    const created=await req('/invoices',{method:'POST',cookie,csrf,body:{...draft,customer:{name:'Standalone customer'},fees:[{description:'Repair',amount:100}]}});
    assert.equal(created.status,201); const invoice=await created.json();
    assert.equal((await store.keys('requests/')).length,0,'standalone invoices do not create fake service requests');
    assert.equal((await req('/invoices/'+invoice.id)).status,401);
    assert.equal((await req('/invoices/'+invoice.id,{method:'PUT',cookie,body:invoice})).status,403);
    assert.equal((await req('/invoices/'+invoice.id,{cookie})).status,200);
    const sent=await(await req('/invoices/'+invoice.id,{method:'PUT',cookie,csrf,body:{...invoice,status:'Sent',fees:[{description:'Repair',amount:100}]}})).json();
    assert.equal((await(await req('/invoices?view=new',{cookie})).json()).items.length,0);
    assert.equal((await(await req('/invoices?view=unpaid',{cookie})).json()).items[0].id,invoice.id);
    assert.equal((await req('/invoices/'+invoice.id,{method:'PUT',cookie,csrf,body:invoice})).status,409);
    const paid=await req('/invoices/'+invoice.id,{method:'PUT',cookie,csrf,body:{...sent,status:'Paid',paid:100,fees:[{description:'Repair',amount:100}]}});
    assert.equal(paid.status,200);
    assert.equal((await(await req('/invoices?view=paid',{cookie})).json()).items[0].totals.balance,0);
    assert.equal((await req('/invoices?view=wrong',{cookie})).status,400);
    assert.equal((await req('/invoices?before=bad',{cookie})).status,400);
    assert.equal((await req('/invoices/1793458800000-00000000-0000-4000-8000-0000000000ff',{cookie})).status,404);
    await store.put('requests/'+invoice.id,{id:invoice.id,deletedAt:new Date().toISOString()});
    assert.equal((await req('/invoices/'+invoice.id,{cookie})).status,200,'invoices remain accessible when their request is in Trash');
  } finally {store.close();}
});
