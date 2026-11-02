export const RELEASES_API = 'https://api.github.com/repos/CodeMasterCody3D/swagg-daddys-preview/releases';
const ASSET_PATH = /^\/CodeMasterCody3D\/swagg-daddys-preview\/releases\/download\/[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.apk$/;

export function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(value || '');
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  return numbers.every(Number.isSafeInteger) ? { numbers, preview: match[4] || '' } : null;
}

export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return Math.sign(a.numbers[i] - b.numbers[i]);
  if (a.preview === b.preview) return 0;
  if (!a.preview) return 1;
  if (!b.preview) return -1;
  const x = a.preview.split('.'), y = b.preview.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] === y[i]) continue;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    if (nx && ny) return BigInt(x[i]) > BigInt(y[i]) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

export function installedApp(userAgent) {
  const match = /(?:^| )SwaggDaddysOwner\/([0-9A-Za-z.-]+) \(build:(\d+)\)(?: |$)/.exec(userAgent || '');
  if (!match || !versionParts(match[1]) || !Number.isSafeInteger(Number(match[2]))) return null;
  return { version: match[1], build: Number(match[2]) };
}

export function isOfficialApk(value) {
  try {
    const url = new URL(value);
    return value === url.href && url.protocol === 'https:' && url.hostname === 'github.com'
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && ASSET_PATH.test(url.pathname) && !url.pathname.includes('..');
  } catch { return false; }
}

export function apkRelease(release) {
  if (!release || release.draft || !versionParts(release.tag_name)) return null;
  const assets = (Array.isArray(release.assets) ? release.assets : []).filter(asset =>
    asset.state === 'uploaded' && isOfficialApk(asset.browser_download_url)
    && !/(?:unsigned|debug|test)/i.test(asset.name || '')
    && Number.isSafeInteger(asset.size) && asset.size > 0);
  if (!assets.length) return null;
  return { version: release.tag_name.replace(/^v/, ''), preview: Boolean(release.prerelease) || Boolean(versionParts(release.tag_name).preview),
    date: release.published_at, assets: assets.map(asset => ({ name: asset.name, url: asset.browser_download_url, size: asset.size })) };
}
