import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.mjs';
import { configured, digest, hashPassword, ownerAccounts } from '../server/auth.mjs';
import { localStore } from '../server/local-store.mjs';
import { createPushService } from '../server/push.mjs';

const origin = 'https://swaggdaddys.com';
const primaryPassword = 'primary-test-password';
const teamPassword = 'shared-team-test-password';
const primaryHash = await hashPassword(primaryPassword);
const alexHash = await hashPassword(teamPassword);
const jordanHash = await hashPassword(teamPassword);
const accounts = [{ username:'Alex', passwordHash:alexHash }, { username:'Jordan', passwordHash:jordanHash }];
const configuration = entries => ({ OWNER_USERNAME:'owner', OWNER_PASSWORD_HASH:primaryHash, OWNER_ACCOUNTS_JSON:JSON.stringify(entries) });
function request(path, { method='GET', body, cookie, csrf } = {}) {
  const headers = { Origin:origin };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body) headers['Content-Type'] = 'application/json';
  return new Request(origin + '/api' + path, { method, headers, body:body ? JSON.stringify(body) : undefined });
}
async function login(api, username, password=teamPassword) {
  const response = await api(request('/login', { method:'POST', body:{username,password} }), {ip:username});
  assert.equal(response.status, 200);
  const body = await response.json();
  return { cookie:response.headers.get('set-cookie').split(';')[0], csrf:body.csrf, username:body.username };
}

test('additional logins share owner tools with independent identities; primary access still works', async () => {
  const store=localStore(), env=configuration(accounts), api=createApi({store,env});
  try {
    for (const [input, expected, password] of [['owner','owner',primaryPassword],[' alex ','Alex',teamPassword],['JORDAN','Jordan',teamPassword]]) {
      const auth=await login(api,input,password);
      assert.equal(auth.username,expected);
      const session=await (await api(request('/session',auth))).json();
      assert.equal(session.username,expected);
      assert.equal((await api(request('/requests',auth))).status,200);
      assert.equal((await api(request('/logout',{method:'POST',cookie:auth.cookie,body:{}}))).status,403);
    }
    for (const [username,password] of [['Nobody',teamPassword],['Alex',primaryPassword],['owner',teamPassword]]) {
      assert.equal((await api(request('/login',{method:'POST',body:{username,password}}),{ip:'wrong-'+username})).status,401);
    }
  } finally { store.close(); }
});

test('rotation and removal revoke only the affected account sessions', async () => {
  const store=localStore(), env=configuration(accounts), api=createApi({store,env});
  try {
    const primary=await login(api,'owner',primaryPassword), alex=await login(api,'Alex'), jordan=await login(api,'Jordan');
    const rotated=createApi({store,env:configuration([{...accounts[0],passwordHash:await hashPassword('rotated-account-test-password')},accounts[1]])});
    assert.equal((await rotated(request('/session',alex))).status,401);
    for (const auth of [primary,jordan]) assert.equal((await rotated(request('/session',auth))).status,200);
    const removed=createApi({store,env:configuration([])});
    assert.equal((await removed(request('/session',jordan))).status,401);
    assert.equal((await removed(request('/session',primary))).status,200);
    assert.equal((await removed(request('/login',{method:'POST',body:{username:'Jordan',password:teamPassword}}))).status,401);
  } finally { store.close(); }
});

test('existing sessions without an account name remain valid when accounts are added', async () => {
  const store=localStore(), api=createApi({store,env:configuration([])});
  try {
    const primary=await login(api,'owner',primaryPassword);
    const key=(await store.keys('sessions/'))[0], entry=await store.get(key);
    const {username,...legacy}=entry.value;
    await store.put(key,legacy,entry.etag);
    const updated=createApi({store,env:configuration(accounts)});
    assert.equal((await updated(request('/session',primary))).status,200);
  } finally { store.close(); }
});

test('malformed accounts and duplicate usernames cannot replace the original login', () => {
  for (const value of ['broken JSON','{}','null',JSON.stringify([{username:'owner',passwordHash:alexHash},{username:'bad',passwordHash:'plaintext'},null])]) {
    const env={...configuration([]),OWNER_ACCOUNTS_JSON:value};
    assert.equal(configured(env),true);
    assert.deepEqual(ownerAccounts(env),[{username:'owner',passwordHash:primaryHash}]);
  }
  assert.equal(configured({OWNER_ACCOUNTS_JSON:'broken JSON'}),false);
});

test('signing out one account leaves other sessions and notification devices active', async () => {
  const store=localStore(), env=configuration(accounts), sent=[];
  const notifications=createPushService({store,env,sender:{ready:true,send:async value=>{sent.push(value);return 'sent';}}});
  const api=createApi({store,env,notifications});
  try {
    const alex=await login(api,'Alex'), jordan=await login(api,'Jordan');
    for (const [name,auth] of [['Alex',alex],['Jordan',jordan]]) {
      const body={id:('device-'+name).padEnd(25,'_'),token:('token-'+name).padEnd(30,'_')};
      assert.equal((await api(request('/notifications/device',{...auth,method:'POST',body}))).status,200);
    }
    assert.equal((await api(request('/logout',{...alex,method:'POST',body:{}}))).status,200);
    assert.equal((await api(request('/session',alex))).status,401);
    assert.equal((await api(request('/session',jordan))).status,200);
    await notifications.notify();
    assert.deepEqual(sent,[('token-Jordan').padEnd(30,'_')]);
  } finally { store.close(); }
});

test('account removal revokes only its push devices; legacy primary registrations survive', async () => {
  const store=localStore(), env=configuration(accounts), sent=[];
  const sender={ready:true,send:async value=>{sent.push(value);return 'sent';}};
  try {
    const push=createPushService({store,env,sender});
    await push.register('device-alex'.padEnd(25,'_'),'token-alex'.padEnd(30,'_'),{key:'sessions/a',username:'Alex',authVersion:digest(alexHash)});
    await push.register('device-jordan'.padEnd(25,'_'),'token-jordan'.padEnd(30,'_'),{key:'sessions/b',username:'Jordan',authVersion:digest(jordanHash)});
    await store.put('push-devices/legacy',{token:'legacy-owner-token',sessionKey:'sessions/old',authVersion:digest(primaryHash),expires:Date.now()+60000});
    await createPushService({store,env:configuration([accounts[1]]),sender}).notify();
    assert.deepEqual(sent.sort(),['legacy-owner-token','token-jordan'.padEnd(30,'_')].sort());
    assert.equal(await store.get('push-devices/'+'device-alex'.padEnd(25,'_')),null);
  } finally { store.close(); }
});
