import { cropCanvas } from './vin-scan.js';
import { validVin } from './vin-core.js';

export async function sendGoogleVinPhoto(blob, { api = '/api', fetchImpl = globalThis.fetch, signal } = {}) {
  if (!blob?.size || blob.size > 2 * 1024 * 1024) throw new Error('The VIN photo is too large. Crop it and retry.');
  const body = new FormData();
  body.set('google_consent','yes'); body.set('photo',blob,'vin-photo.jpg');
  const response = await fetchImpl(api + '/vin/photo', {method:'POST',body,credentials:'omit',signal});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Google Lens is unavailable. Choose a clear VIN barcode photo or type the VIN.');
  if (!Array.isArray(result.candidates) || result.candidates.length > 10 || result.candidates.some(item => !validVin(item?.vin))) throw new Error('Google returned an unexpected result. Check the photo or type the VIN.');
  return { candidates:result.candidates, rawText:result.candidates.map(item=>item.vin).join('\n'), warnings:Array.isArray(result.warnings)?result.warnings.filter(value=>typeof value==='string').slice(0,3):[] };
}

export async function scanWithGoogle(source, { rectangle = null, api = '/api', progress = () => {} } = {}) {
  progress('Preparing the selected VIN photo for Google…');
  const cropped = cropCanvas(source,rectangle), canvas = document.createElement('canvas');
  const scale = Math.min(1,1200/Math.max(cropped.width,cropped.height));
  canvas.width = Math.max(1,Math.round(cropped.width*scale)); canvas.height = Math.max(1,Math.round(cropped.height*scale));
  canvas.getContext('2d').drawImage(cropped,0,0,canvas.width,canvas.height);
  const blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
  if (!blob) throw new Error('This photo could not be prepared. Choose another photo or type the VIN.');
  progress('Google is reading the VIN photo…');
  return sendGoogleVinPhoto(blob,{api,signal:AbortSignal.timeout(20000)});
}
