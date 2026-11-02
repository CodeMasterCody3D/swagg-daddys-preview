import { RELEASES_API, apkRelease, compareVersions, installedApp } from './app-updates-core.js';

export function mountAppUpdates() {
  const $ = id => document.getElementById(id);
  const dialog = $('app-updates-dialog'), installed = installedApp(navigator.userAgent);
  let signedIn = false, controller, generation = 0, lastCheck = 0, page = 1, loading = false;
  const seen = new Set();
  function text(id, value) { $(id).textContent = value; }
  async function request(suffix) {
    const response = await fetch(RELEASES_API + suffix, { credentials: 'omit', referrerPolicy: 'no-referrer',
      cache: 'no-cache', signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429
      ? 'GitHub is limiting update checks. Try again in a few minutes.' : 'Could not check GitHub. Check your connection and try again.');
    return response.json();
  }
  async function check(force = false) {
    if (!signedIn || (!force && Date.now() - lastCheck < 300000)) return;
    lastCheck = Date.now();
    const run = generation;
    try {
      const latest = apkRelease(await request('/latest'));
      if (!signedIn || run !== generation) return;
      const newer = installed && latest && !latest.preview && compareVersions(latest.version, installed.version) === 1;
      $('app-update-badge').hidden = !newer;
      text('app-update-badge', newer ? 'Update available · ' + latest.version : '');
      text('app-latest-status', !latest ? 'No APK releases have been published yet.' : newer
        ? 'Version ' + latest.version + ' is available. Download it below to update.'
        : installed ? 'Latest release: ' + latest.version + '. Your app does not need an update.'
        : 'Latest release: ' + latest.version + '.');
    } catch (error) {
      if (run === generation && signedIn && error.name !== 'AbortError') text('app-latest-status', error.message);
    }
  }
  function releaseCard(release) {
    const card = document.createElement('article'); card.className = 'apk-release';
    const info = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = 'Version ' + release.version + (release.preview ? ' · Preview' : '')
      + (installed && compareVersions(release.version, installed.version) === 0 ? ' · Installed' : '');
    const date = document.createElement('p'); date.className = 'small muted';
    const published = new Date(release.date);
    date.textContent = Number.isNaN(published.getTime()) ? '' : published.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    info.append(heading, date); card.append(info);
    for (const asset of release.assets) {
      const link = document.createElement('a'); link.className = 'button secondary compact';
      link.href = asset.url; link.download = asset.name; link.referrerPolicy = 'no-referrer'; link.rel = 'noreferrer';
      link.textContent = 'Download APK · ' + (asset.size / 1048576).toFixed(1) + ' MB';
      link.setAttribute('aria-label', 'Download version ' + release.version + ' APK');
      card.append(link);
    }
    if (installed && compareVersions(release.version, installed.version) === -1) {
      const note = document.createElement('p'); note.className = 'small muted';
      note.textContent = 'Older version. Android normally blocks installing it over a newer app.'; card.append(note);
    }
    return card;
  }
  async function loadPage(reset = false) {
    if (!signedIn || loading) return;
    if (reset) { page = 1; seen.clear(); $('app-release-list').replaceChildren(); }
    loading = true; $('app-updates-retry').disabled = true; $('app-releases-more').disabled = true;
    text('app-releases-status', 'Loading APK versions…');
    const run = generation;
    try {
      const releases = await request('?per_page=30&page=' + page);
      if (!signedIn || run !== generation) return;
      if (!Array.isArray(releases)) throw new Error('The release list is unavailable. Try again.');
      for (const raw of releases) {
        const release = apkRelease(raw);
        if (!release || seen.has(release.version)) continue;
        seen.add(release.version); $('app-release-list').append(releaseCard(release));
      }
      page++; $('app-releases-more').hidden = releases.length < 30;
      text('app-releases-status', seen.size ? '' : 'No downloadable APK versions have been published yet.');
    } catch (error) {
      if (run === generation && signedIn && error.name !== 'AbortError') text('app-releases-status', error.message);
    } finally {
      if (run === generation) { loading = false; $('app-updates-retry').disabled = false; $('app-releases-more').disabled = false; }
    }
  }
  function open() {
    if (!signedIn) return;
    if (!dialog.open) dialog.showModal();
    void check(); if (!seen.size) void loadPage(true);
  }
  $('app-updates-open').addEventListener('click', open);
  $('app-updates-close').addEventListener('click', () => dialog.close());
  $('app-updates-retry').addEventListener('click', () => { void check(true); void loadPage(true); });
  $('app-releases-more').addEventListener('click', () => loadPage());
  dialog.addEventListener('close', () => {
    if (location.hash === '#updates') history.replaceState(null, '', location.pathname + location.search);
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#updates') open(); });
  window.addEventListener('focus', () => check());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  return { setSignedIn(value) {
    if (value === signedIn) return;
    signedIn = value; generation++; controller?.abort(); controller = new AbortController();
    $('owner-app-actions').hidden = !value; loading = false; lastCheck = 0;
    if (!value) { dialog.close(); seen.clear(); $('app-release-list').replaceChildren(); $('app-update-badge').hidden = true; return; }
    text('app-installed-version', installed ? 'Installed on this phone: ' + installed.version + ' (build ' + installed.build + ')'
      : 'This browser cannot report the app installed on your phone. Open Updates inside the owner app to check its version.');
    void check(); if (location.hash === '#updates') open();
  } };
}
