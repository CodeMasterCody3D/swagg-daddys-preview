import { normalizeVin, validVin, vinCandidates, decodedVehicle } from './vin-core.js';

const $ = id => document.getElementById(id);
const input = $('vin'), status = $('vin-status'), lookup = $('vin-lookup');
let timer, revision = 0, abort, recognized = '', scanBusy = false;
const libraries = new Map();
function loadScript(url) {
  if (!libraries.has(url)) libraries.set(url, new Promise((resolve,reject) => {
    const script = document.createElement('script'); script.src=url; script.crossOrigin='anonymous';
    script.onload=resolve; script.onerror=() => { libraries.delete(url); script.remove(); reject(new Error('Scanner could not load. Check your connection or type the VIN.')); };
    document.head.append(script);
  }));
  return libraries.get(url);
}
function clearDecode() {
  revision++; abort?.abort(); lookup.disabled=false; $('vin-specs').value=''; $('vin-details').textContent='';
  // Clear only the auto-filled value; preserve customer-entered corrections.
  if ($('vehicle').value === $('vehicle').dataset.vinValue) $('vehicle').value='';
  delete $('vehicle').dataset.vinValue;
  $('request-result').hidden=true;
}
input.addEventListener('input', () => {
  clearTimeout(timer); clearDecode(); input.value=normalizeVin(input.value); input.setCustomValidity('');
  status.textContent = input.value ? 'Enter all 17 VIN characters. You can also enter vehicle details manually.' : '';
  if (validVin(input.value)) timer=setTimeout(decode,600);
});
async function decode() {
  clearTimeout(timer);
  const vin=normalizeVin(input.value); input.value=vin;
  if (!validVin(vin)) { status.textContent='Check the 17-character VIN. VINs do not use I, O, or Q. You can leave it blank and enter the vehicle manually.'; return; }
  const current=++revision, previousVehicle=$('vehicle').value;
  abort?.abort(); abort=new AbortController(); lookup.disabled=true;
  status.textContent='Looking up vehicle details…';
  const timeout=setTimeout(() => abort?.abort(),15000);
  try {
    const response=await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/'+encodeURIComponent(vin)+'?format=json', {signal:abort.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if (!response.ok) throw new Error('VIN lookup is temporarily unavailable. Enter the vehicle manually.');
    const body=await response.json();
    if (current!==revision || vin!==input.value) return;
    const decoded=decodedVehicle(body.Results?.[0]);
    if (!decoded.complete || !decoded.clean) { status.textContent='The decoder returned incomplete or flagged information. Check the VIN and enter or correct your vehicle manually.'; return; }
    $('vin-specs').value=JSON.stringify(decoded.specs);
    $('vin-details').textContent=Object.entries(decoded.specs).map(([key,value])=>key+': '+value).join(' · ');
    if ($('vehicle').value===previousVehicle) { $('vehicle').value=decoded.vehicle; $('vehicle').dataset.vinValue=decoded.vehicle; }
    $('request-result').hidden=true;
    status.textContent='Vehicle details found. Please review and correct them before sending.';
  } catch(error) {
    if (current===revision) status.textContent=error.name==='AbortError'?'Lookup timed out. Try again or enter the vehicle manually.':error.message;
  } finally { clearTimeout(timeout); if (current===revision) lookup.disabled=false; }
}
lookup.addEventListener('click',decode);
// Native camera picker works without a persistent camera stream or microphone access.
$('vin-photo-button').addEventListener('click',()=> $('vin-photo').click());
$('vin-photo').addEventListener('change', async event => {
  const file=event.target.files[0]; if (!file || scanBusy) return;
  $('vin-candidate').hidden=true; recognized='';
  if (file.size>20*1024*1024 || !file.type.startsWith('image/')) { status.textContent='Choose a clear photo under 20 MB, or type the VIN.'; event.target.value=''; return; }
  scanBusy=true; $('vin-photo-button').disabled=true;
  const url=URL.createObjectURL(file); let worker;
  try {
    status.textContent='Reading the barcode in your photo…';
    let candidates=[];
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js');
      const result=await new window.ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(url);
      candidates=vinCandidates(result.getText());
    } catch { /* A photo of printed VIN text may not contain a readable barcode. */ }
    if (!candidates.length) {
      status.textContent='Reading the printed VIN. The first scan may take a moment…';
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js');
      worker=await window.Tesseract.createWorker('eng');
      await worker.setParameters({tessedit_char_whitelist:'ABCDEFGHJKLMNPRSTUVWXYZ0123456789 :*-\n'});
      const result=await worker.recognize(file); candidates=vinCandidates(result.data.text);
    }
    if (candidates.length!==1) throw new Error(candidates.length?'More than one VIN was found. Take a closer photo of one VIN, or type it.':'No clear VIN found. Take a closer, well-lit photo of the VIN text or barcode, or type it.');
    recognized=candidates[0]; $('vin-recognized').textContent=recognized; $('vin-candidate').hidden=false;
    status.textContent='Compare the recognized VIN with the vehicle label, then choose Use this VIN.';
  } catch(error) { status.textContent=error.message || 'The photo could not be read. Please type the VIN.'; }
  finally { try { await worker?.terminate(); } catch {} URL.revokeObjectURL(url); event.target.value=''; scanBusy=false; $('vin-photo-button').disabled=false; }
});
$('vin-use').addEventListener('click',()=> { clearDecode(); input.value=recognized; $('vin-candidate').hidden=true; void decode(); });
$('service-form').addEventListener('reset',()=> { clearTimeout(timer); clearDecode(); input.setCustomValidity(''); status.textContent=''; $('vin-candidate').hidden=true; lookup.disabled=false; });
