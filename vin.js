import { photoCanvas } from './vin-scan.js';
import { readVinPhoto } from './vin-reader.js';
import { createLiveVinScanner, cameraErrorMessage } from './vin-live.js';
import { normalizeVin, validVin, decodedVehicle } from './vin-core.js';

const $ = id => document.getElementById(id);
const input = $('vin'), status = $('vin-status'), lookup = $('vin-lookup');
const scanSource=$('vin-scan-source');
let barcodeCheck;
function showBarcodeCheck(check) {
  barcodeCheck=check;
  $('vin-barcode-check').hidden=!check;
  $('vin-barcode-details').textContent=check?[
    'Reader check: '+check.version,
    'Photo: '+check.width+' × '+check.height,
    ...(check.liveFrames?['Barcode attempts: '+check.liveFrames]:[]),
    'Passes: '+(check.passes.join(' → ')||'none completed'),
    ...check.symbols.map(symbol=>symbol.format+': '+symbol.text),
    'Result: '+(check.status==='read'?'VIN barcode decoded':check.status==='unavailable'?'Barcode reader could not run':'No complete VIN barcode decoded'),
    check.error||''
  ].filter(Boolean).join('\n'):'';
}
let timer, revision = 0, abort, scanBusy = false;
let liveScanner;
function liveUi(open){$('vin-live-tools').hidden=!open;$('vin-photo-button').setAttribute('aria-expanded',String(open));$('vin-photo-button').disabled=open&&Boolean(liveScanner?.active);$('vin-live-capture').disabled=!liveScanner?.active;}
function stopLive(message=''){liveScanner?.stop();liveUi(false);if(message){restoreVinStatus();status.textContent=message;}}
let lensApi='/api';
if(location.hostname.endsWith('github.io')) {
  try {const endpoint=new URL(window.SWAGG_CONFIG?.backendOrigin);if(endpoint.protocol==='https:')lensApi=endpoint.origin+'/api';}catch{}
}
const lensReady=fetch(lensApi+'/health',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():{}).then(health=>{
  const available=health.googleLens===true;
  if(!available)$('vin-reader-note').textContent='VIN barcodes and printed text are read on your device. Google Lens is unavailable right now.';
  return available;
}).catch(()=>{
  $('vin-reader-note').textContent='VIN barcodes and printed text are read on your device. Google Lens is unavailable right now.';
  return false;
});
function restoreVinStatus(){ $('vin-photo-tools').before(status); }
function clearDecode() {
  revision++; abort?.abort(); lookup.disabled=false; $('vin-specs').value=''; $('vin-details').textContent='';
  // Clear only the auto-filled value; preserve customer-entered corrections.
  if ($('vehicle').value === $('vehicle').dataset.vinValue) $('vehicle').value='';
  delete $('vehicle').dataset.vinValue;
  $('request-result').hidden=true;
}
input.addEventListener('input', () => {
  stopLive();
  scanSource.textContent='';
  showBarcodeCheck();
  clearTimeout(timer); clearDecode(); input.value=normalizeVin(input.value); input.setCustomValidity('');
  status.textContent = input.value ? 'Enter all 17 VIN characters. You can also enter vehicle details manually.' : '';
  if (validVin(input.value)) timer=setTimeout(decode,600);
});
async function decode() {
  restoreVinStatus();
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
lookup.addEventListener('click',()=>{stopLive();void decode();});
// Camera capture and existing photos share the barcode-first reader.
let sourcePhoto=null, crop=null, cropStart=null, scanId=0;
const preview=$('vin-photo-preview');
function drawPhoto() {
  if(!sourcePhoto)return;
  const scale=Math.min(1,680/sourcePhoto.width,380/sourcePhoto.height);
  preview.width=Math.round(sourcePhoto.width*scale);preview.height=Math.round(sourcePhoto.height*scale);
  const ctx=preview.getContext('2d');ctx.drawImage(sourcePhoto,0,0,preview.width,preview.height);
  if(crop) {ctx.strokeStyle='#47edbd';ctx.lineWidth=3;ctx.strokeRect(crop.x*scale,crop.y*scale,crop.width*scale,crop.height*scale);}
}
function point(event) {
  const rect=preview.getBoundingClientRect();
  return {x:Math.max(0,Math.min(sourcePhoto.width,(event.clientX-rect.left)/rect.width*sourcePhoto.width)),y:Math.max(0,Math.min(sourcePhoto.height,(event.clientY-rect.top)/rect.height*sourcePhoto.height))};
}
preview.addEventListener('pointerdown',event=>{if(!sourcePhoto||scanBusy)return;preview.setPointerCapture(event.pointerId);cropStart=point(event);crop=null;});
preview.addEventListener('pointermove',event=>{if(!cropStart)return;const end=point(event);crop={x:Math.min(cropStart.x,end.x),y:Math.min(cropStart.y,end.y),width:Math.abs(cropStart.x-end.x),height:Math.abs(cropStart.y-end.y)};drawPhoto();});
function finishCrop(){if(!cropStart)return;cropStart=null;if(!crop||crop.width<25||crop.height<10)crop=null;drawPhoto();$('vin-crop-status').textContent=crop?'VIN area selected. Tap Retry selected area.':'Full photo selected.';}
preview.addEventListener('pointerup',finishCrop);preview.addEventListener('pointercancel',finishCrop);
function reviewCandidate(candidate) {
  $('vin-recognized').value=candidate?.vin || '';
  $('vin-review-note').textContent=candidate?.corrected?'Possible character mix-up: O/Q was changed to 0 or I to 1 in this suggestion. Check every character against your photo.':'Compare every character with the photo. Correct the text before choosing Use this VIN.';
}
let suggestions=[];
$('vin-suggestions').addEventListener('change',()=>reviewCandidate(suggestions[Number($('vin-suggestions').value)]));
async function readPhoto() {
  if(!sourcePhoto||scanBusy)return;
  scanSource.textContent='';
  showBarcodeCheck();
  const current=++scanId;scanBusy=true;$('vin-candidate').hidden=true;
  $('vin-retry-status').append(status);
  for(const id of ['vin-photo-button','vin-upload-button','vin-retry','vin-clear-photo'])$(id).disabled=true;
  try {
    const progress=text=>{if(current===scanId)status.textContent=text;};
    const result=await readVinPhoto(sourcePhoto,{rectangle:crop,api:lensApi,progress,googleAvailable:lensReady});
    if(current!==scanId)return;
    showBarcodeCheck(result.barcodeCheck||result.diagnostics);
    if(result.candidates.length===1 && validVin(result.candidates[0].vin)){applyScannedVin(result.candidates[0].vin,result.candidates[0].method);return;}
    suggestions=result.candidates;$('vin-suggestions').replaceChildren(...suggestions.map((candidate,i)=>new Option(candidate.vin+(candidate.corrected?' — check characters':''),String(i))));
    $('vin-suggestions').hidden=suggestions.length<2;
    $('vin-raw-text').textContent=result.rawText || 'No readable text was returned.';
    $('vin-read-details').open=!suggestions.length;
    $('vin-candidate').hidden=false;reviewCandidate(suggestions[0]);
    status.textContent=suggestions.length?'VIN reading ready. Review the characters below before using it.':result.rawText?'Text was read, but a complete VIN was not identified. Select the VIN area to retry, or enter/correct the scanned VIN below.':'No text was detected. Select the VIN area in the photo to retry, or type the VIN below.';
    if(result.warnings.length)status.textContent+=' '+result.warnings.join(' ');
  } catch(error) {if(current===scanId){showBarcodeCheck(error.barcodeCheck);status.textContent=error.message || 'The scanner could not finish. Try selecting the VIN area or enter it manually.';}}
  finally {scanBusy=false;for(const id of ['vin-photo-button','vin-upload-button','vin-retry','vin-clear-photo'])$(id).disabled=false;}
}
async function selectPhoto(event) {
  const file=event.target.files[0];if(!file||scanBusy)return;
  stopLive();
  restoreVinStatus();
  event.target.value='';
  if(file.size>25*1024*1024||!file.type.startsWith('image/')){status.textContent='Choose a photo under 25 MB, or enter the VIN manually.';return;}
  const current=++scanId;scanBusy=true;
  for(const id of ['vin-photo-button','vin-upload-button','vin-retry','vin-clear-photo'])$(id).disabled=true;
  try {
    const nextPhoto=await photoCanvas(file);if(current!==scanId)return;
    sourcePhoto=nextPhoto;crop=null;drawPhoto();$('vin-photo-tools').hidden=false;$('vin-crop-status').textContent='Full photo selected. Drag around the VIN if a retry is needed.';scanBusy=false;await readPhoto();
  } catch(error){status.textContent=error.message;}
  finally {scanBusy=false;for(const id of ['vin-photo-button','vin-upload-button','vin-retry','vin-clear-photo'])$(id).disabled=false;}
}
liveScanner=createLiveVinScanner({video:$('vin-live-video'),onSample:info=>{$('vin-live-progress').textContent='Camera: '+info.width+' × '+info.height+' · Frames sampled: '+info.samples+' · Barcode attempts: '+info.attempts;},onFrame:(result,{frames,samples})=>{if(result.diagnostics)showBarcodeCheck({...result.diagnostics,liveFrames:frames});$('vin-live-progress').textContent='Frames sampled: '+samples+' · Barcode attempts: '+frames+' · Local barcode scan every ~1.5 seconds.';},onStatus:message=>{if($('vin-live-status').textContent!==message)$('vin-live-status').textContent=message;},onMatch:(vin,result)=>{liveUi(false);showBarcodeCheck({...result.diagnostics,liveFrames:barcodeCheck?.liveFrames});applyScannedVin(vin,'live-barcode');},onError:error=>{liveUi(true);$('vin-photo-button').disabled=false;$('vin-live-capture').disabled=true;$('vin-live-status').textContent=cameraErrorMessage(error);}});
$('vin-photo-button').addEventListener('click',async()=>{
  if(scanBusy)return;
  clearPhoto();scanSource.textContent='';showBarcodeCheck();$('vin-live-progress').textContent='Waiting for camera frames. Barcode check about every 1.5 seconds.';liveUi(true);
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('vin-live-status').textContent='This browser cannot show an in-page camera here. Use the phone camera button below, choose a photo, or open this website in your phone’s browser.';return;}
  $('vin-photo-button').disabled=true;$('vin-live-capture').disabled=true;
  await liveScanner.start();if(liveScanner.active)$('vin-live-capture').disabled=false;
});
$('vin-live-stop').addEventListener('click',()=>stopLive('Camera stopped. You can start a new live scan or choose a VIN photo.'));
$('vin-camera-fallback').addEventListener('click',()=>{stopLive();$('vin-photo').click();});
$('vin-live-capture').addEventListener('click',async()=>{
  if(scanBusy||!liveScanner.active)return;
  try{const frame=liveScanner.capture();stopLive();sourcePhoto=frame;crop=null;drawPhoto();$('vin-photo-tools').hidden=false;$('vin-crop-status').textContent='Photo captured from the live camera. Drag around the VIN if a retry is needed.';await readPhoto();}
  catch(error){$('vin-live-status').textContent=cameraErrorMessage(error);}
});
$('vin-upload-button').addEventListener('click',()=>{stopLive();$('vin-upload').click();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&liveScanner.active)stopLive('Camera stopped while the page was away. Tap Live scan VIN to start again.');});
window.addEventListener('pagehide',()=>stopLive());
$('service-form').addEventListener('submit',()=>stopLive());
$('vin-photo').addEventListener('change',selectPhoto);$('vin-upload').addEventListener('change',selectPhoto);
$('vin-retry').addEventListener('click',readPhoto);
function clearPhoto(){restoreVinStatus();scanId++;sourcePhoto=null;crop=null;cropStart=null;preview.width=1;preview.height=1;$('vin-photo-tools').hidden=true;$('vin-candidate').hidden=true;$('vin-raw-text').textContent='';$('vin-recognized').value='';suggestions=[];}
$('vin-clear-photo').addEventListener('click',()=>{clearPhoto();scanSource.textContent='';showBarcodeCheck();status.textContent='Photo cleared. You can take another photo or type your VIN.';});
function applyScannedVin(value,method='') {
  stopLive();
  clearTimeout(timer);
  const vin=normalizeVin(value);
  clearDecode();input.value=vin;clearPhoto();
  scanSource.textContent=method==='live-barcode'?'VIN read from the live barcode scan on your device.':method==='barcode'?'VIN read from the barcode on your device.':method==='google-lens'?(barcodeCheck?.status==='unavailable'?'Google Lens used because the barcode reader could not run.':'VIN read by Google Lens after the barcode checks.'):method==='text'?'VIN read from printed text on your device.':'';
  if(validVin(vin))void decode();
  else status.textContent='VIN kept as entered. You can enter vehicle details manually or send the request as it is.';
}
$('vin-use').addEventListener('click',()=>{const value=$('vin-recognized').value;applyScannedVin(value,suggestions.find(candidate=>candidate.vin===normalizeVin(value))?.method);});
$('service-form').addEventListener('reset',()=>{stopLive();clearTimeout(timer);clearDecode();clearPhoto();scanSource.textContent='';showBarcodeCheck();input.setCustomValidity('');status.textContent='';lookup.disabled=false;});
