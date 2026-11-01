import { vinCandidates } from '../vin-core.js';

export const MAX_LENS_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export class LensReadError extends Error {
  constructor(code = 'unavailable') { super(code); this.name = 'LensReadError'; this.code = code; }
}

async function responseBytes(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new LensReadError();
  const reader = response.body?.getReader();
  if (!reader) throw new LensReadError();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new LensReadError();
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

// One request, a fixed host, a truthful client identifier, and no automatic recovery
// from verification or rate limits. No browser cookies or user accounts are used.
export function lensTransport(fetchImpl = globalThis.fetch) {
  let used = false;
  return async (url, init = {}) => {
    const target = new URL(url);
    if (used || target.origin !== 'https://lensfrontend-pa.googleapis.com' || target.pathname !== '/v1/crupload') throw new LensReadError();
    used = true;
    const headers = new Headers(init.headers);
    headers.set('User-Agent', 'SwaggDaddys-VIN-Reader/preview');
    headers.delete('cookie');
    try {
      const response = await fetchImpl(target.href, { ...init, headers, redirect:'manual', signal:AbortSignal.timeout(12000) });
      const bytes = await responseBytes(response);
      const type = response.headers.get('content-type') || '';
      const isText = /text\/|html|json/i.test(type);
      const message = isText ? bytes.subarray(0,16384).toString('utf8') : '';
      if (/captcha|unusual traffic|verify (?:that )?you|automated quer/i.test(message) || /\/sorry\//.test(response.headers.get('location') || '')) throw new LensReadError('verification');
      if (response.status === 429) throw new LensReadError('busy');
      if (!response.ok || !/protobuf|octet-stream/i.test(type)) throw new LensReadError();
      return new Response(bytes, { status:response.status, headers:response.headers });
    } catch (error) {
      if (error instanceof LensReadError) throw error;
      throw new LensReadError();
    }
  };
}

export function lensVinResult(result) {
  if (!result || !Array.isArray(result.segments) || result.segments.length > 1000) throw new LensReadError();
  const lines = result.segments.map(item => typeof item?.text === 'string' ? item.text.slice(0,1000) : '');
  const values = [...new Set(lines.flatMap(line => vinCandidates(line)).filter(vin => /\d/.test(vin)))];
  // Never guess one VIN when the provider returned too many alternatives.
  if (values.length > 10) return { candidates:[], rawText:'', warnings:['Several VIN-like values were found. Crop the image to one VIN and retry.'] };
  return { candidates:values.map(vin => ({vin,corrected:false,method:'google-lens'})), rawText:values.join('\n'), warnings:[] };
}

export async function readGoogleVinPhoto(bytes, { fetchImpl = globalThis.fetch, loadLens = () => import('chrome-lens-ocr') } = {}) {
  if (!bytes?.byteLength || bytes.byteLength > MAX_LENS_PHOTO_BYTES) throw new LensReadError();
  try {
    const { default:sharp } = await import('sharp');
    const metadata = await sharp(Buffer.from(bytes),{limitInputPixels:12000000}).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 12000000) throw new LensReadError();
    const { default:Lens } = await loadLens();
    const lens = new Lens({ userAgent:'SwaggDaddys-VIN-Reader/preview' }, lensTransport(fetchImpl));
    return lensVinResult(await lens.scanByBuffer(Buffer.from(bytes)));
  } catch (error) {
    if (error instanceof LensReadError) throw error;
    // Upstream errors may contain photo bytes, cookies or page contents. Never relay them.
    throw new LensReadError();
  }
}
