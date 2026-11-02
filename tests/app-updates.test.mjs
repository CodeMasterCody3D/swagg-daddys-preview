import test from 'node:test';
import assert from 'node:assert/strict';
import { apkRelease, compareVersions, installedApp, isOfficialApk } from '../owner/app-updates-core.js';
const url = 'https://github.com/CodeMasterCody3D/swagg-daddys-preview/releases/download/v1.0.4/Swagg-Daddys-Owner-1.0.4.apk';
test('version comparisons handle numeric components, previews, equality, and invalid input', () => {
  assert.equal(compareVersions('1.0.10','1.0.9'),1);
  assert.equal(compareVersions('1.1.0','1.10.0'),-1);
  assert.equal(compareVersions('v1.0.4','1.0.4'),0);
  assert.equal(compareVersions('1.0.4','1.0.4-rc.1'),1);
  assert.equal(compareVersions('1.0.4-rc.10','1.0.4-rc.2'),1);
  assert.equal(compareVersions('latest','1.0.4'),null);
});
test('only the owner app version token identifies an installed app', () => {
  assert.deepEqual(installedApp('Mozilla/5.0 SwaggDaddysOwner/1.0.4 (build:5)'),{version:'1.0.4',build:5});
  for (const agent of ['Mozilla/5.0 Android 16 Chrome/140.0','', 'SwaggDaddysOwner/latest (build:5)']) assert.equal(installedApp(agent),null);
});
test('downloads allow only direct APK assets from the designated repository', () => {
  assert.equal(isOfficialApk(url),true);
  for (const unsafe of [url.replace('https:','http:'), url.replace('github.com','github.com.attacker.example'),
    url.replace('github.com/','user@github.com/'),url.replace('/CodeMasterCody3D/','/other/'),
    url.replace('/download/','/tag/'),url+'?redirect=evil',url+'#fragment',url.replace('/v1.0.4/','/../v1.0.4/'),
    url.replace('.apk','.exe'),url.replace('Swagg-Daddys','../Swagg-Daddys')]) assert.equal(isOfficialApk(unsafe),false,unsafe);
});
test('release lists exclude drafts, missing assets and unsigned builds', () => {
  const release = { tag_name:'v1.0.4', published_at:'2026-11-02T03:00:00Z', assets:[{state:'uploaded',name:'Swagg-Daddys-Owner-1.0.4.apk',size:2800000,browser_download_url:url}] };
  assert.equal(apkRelease(release).version,'1.0.4');
  assert.equal(apkRelease({...release,draft:true}),null);
  assert.equal(apkRelease({...release,assets:[]}),null);
  assert.equal(apkRelease({...release,assets:[{...release.assets[0],name:'unsigned.apk'}]}),null);
  assert.equal(apkRelease({...release,prerelease:true}).preview,true);
});
