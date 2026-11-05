import { photoCanvas } from './vin-scan.js';
import { readVinPhoto } from './vin-reader.js';
import { scanWithGoogle } from './vin-lens.js';
import { createLiveVinScanner, cameraErrorMessage } from './vin-live.js';
import { createCameraControls } from './vin-camera.js';
import { normalizeVin, validVin } from './vin-core.js';
import { lookupVinVehicle, confirmedVinVehicle } from './vin-vehicle.js';

export function mountVinScanner(root=document,{lookupVehicle=lookupVinVehicle,onConfirmed=()=>{},createScanner=createLiveVinScanner,readPhotoImpl=readVinPhoto}={}) {
const $ = id => root.querySelector('#'+id);
const form=root.querySelector('#service-form');
const setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('vin-error',error);};
const input = $('vin'), status = $('vin-status'), lookup = $('vin-lookup');
const scanSource=$('vin-scan-source');
// The wrapper uses Android’s image picker; live Take photo still captures the camera.
if(navigator.userAgent.includes('SwaggDaddysOwner/'))$('vin-camera-fallback').textContent='Choose VIN photo';
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
let liveScanner, cameraSession=0;
const verifiedVehicles=new Map();
async function vehicleLookup(vin,options={}) {
  if(verifiedVehicles.has(vin))return verifiedVehicles.get(vin);
  const decoded=await confirmedVinVehicle(vin,lookupVehicle,options);
  if(verifiedVehicles.size>=20)verifiedVehicles.delete(verifiedVehicles.keys().next().value);
  verifiedVehicles.set(vin,decoded);return decoded;
}
const verify=vin=>vehicleLookup(vin,{signal:AbortSignal.timeout(10000)}).then(()=>true,()=>false);
// Pinch/zoom button, flashlight and guide-box region for the live camera.
const cameraControls=createCameraControls({root:$('vin-live-tools'),video:$('vin-live-video'),guide:root.querySelector('.vin-live-guide'),zoomButton:$('vin-live-zoom'),torchButton:$('vin-live-torch'),onMessage:message=>{$('vin-live-status').textContent=message;}});
function liveUi(open){
  const panel=$('vin-live-tools');panel.hidden=!open;cameraControls.lockPage(open);if(!open)cameraControls.detach();
  document.documentElement.classList.toggle('vin-scanner-open',open);
  if(open&&!panel.open)panel.showModal();else if(!open&&panel.open)panel.close();
  $('vin-photo-button').setAttribute('aria-expanded',String(open));$('vin-photo-button').disabled=open&&Boolean(liveScanner?.active);$('vin-live-capture').disabled=!liveScanner?.active;
}
function stopLive(message=''){cameraSession++;liveScanner?.stop();liveUi(false);if(message){restoreVinStatus();status.textContent=message;}}
let lensApi='/api';
if(location.hostname.endsWith('github.io')) {
  try {const endpoint=new URL(window.SWAGG_CONFIG?.backendOrigin);if(endpoint.protocol==='https:')lensApi=endpoint.origin+'/api';}catch{}
}
const lensReady=fetch(lensApi+'/health',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():{}).then(health=>{
  const available=health.googleLens===true;
  if(!available)$('vin-reader-note').textContent='Google Lens is unavailable right now; the barcode and printed-text readers still work.';
  return available;
}).catch(()=>{
  $('vin-reader-note').textContent='Google Lens is unavailable right now; the barcode and printed-text readers still work.';
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
  status.classList.remove('vin-error');
  status.textContent = input.value ? 'Enter all 17 VIN characters. You can also enter vehicle details manually.' : '';
  if (validVin(input.value)) timer=setTimeout(decode,600);
});
async function decode(scanned=false) {
  restoreVinStatus();
  clearTimeout(timer);
  const vin=normalizeVin(input.value); input.value=vin;
  if (!validVin(vin)) { status.textContent='Check the 17-character VIN. VINs do not use I, O, or Q. You can leave it blank and enter the vehicle manually.'; return; }
  const current=++revision, previousVehicle=$('vehicle').value;
  abort?.abort(); abort=new AbortController(); lookup.disabled=true;
  setStatus('Looking up vehicle details…');
  const timeout=setTimeout(() => abort?.abort(),15000);
  try {
    const decoded=await vehicleLookup(vin,{signal:abort.signal});
    if (current!==revision || vin!==input.value) return;
    $('vin-specs').value=JSON.stringify(decoded.specs);
    $('vin-details').textContent=Object.entries(decoded.specs).map(([key,value])=>key+': '+value).join(' · ');
    if ($('vehicle').value===previousVehicle) { $('vehicle').value=decoded.vehicle; $('vehicle').dataset.vinValue=decoded.vehicle; }
    $('request-result').hidden=true;
    setStatus('Vehicle details found. Please review them.');
    return decoded;
  } catch(error) {
    if (current===revision) setStatus((scanned?'Try again. ':'')+(error.name==='AbortError'?'Vehicle lookup timed out.':error.message),scanned);
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
  const current=++scanId;scanBusy=true;$('vin-candidate').hidden=true;setStatus('Reading VIN photo…');
  $('vin-retry-status').append(status);
  for(const id of ['vin-photo-button','vin-upload-button','vin-retry','vin-clear-photo'])$(id).disabled=true;
  try {
    const progress=text=>{if(current===scanId)setStatus(text);};
    const result=await readPhotoImpl(sourcePhoto,{rectangle:crop,api:lensApi,progress,googleAvailable:lensReady,verify});
    if(current!==scanId)return;
    showBarcodeCheck(result.barcodeCheck||result.diagnostics);
    if(result.candidates.length===1 && validVin(result.candidates[0].vin)){await applyScannedVin(result.candidates[0].vin,result.candidates[0].method);return;}
    suggestions=result.candidates;$('vin-suggestions').replaceChildren(...suggestions.map((candidate,i)=>new Option(candidate.vin+(candidate.corrected?' — check characters':''),String(i))));
    $('vin-suggestions').hidden=suggestions.length<2;
    $('vin-raw-text').textContent=result.rawText || 'No readable text was returned.';
    $('vin-read-details').open=!suggestions.length;
    $('vin-candidate').hidden=false;reviewCandidate(suggestions[0]);
    setStatus(suggestions.length?'Try again. A vehicle has not been confirmed. Review the characters below before using it.':result.rawText?'Try again. Text was read, but a complete VIN was not identified. Select the VIN area to retry, or take another photo.':'Try again. No VIN was detected. Take a clearer photo or select the VIN area and retry.',true);
    if(result.warnings.length)status.textContent+=' '+result.warnings.join(' ');
  } catch(error) {if(current===scanId){showBarcodeCheck(error.barcodeCheck);setStatus('Try again. '+(error.message || 'The scanner could not finish. Take another photo or retry the selected area.'),true);}}
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
  } catch(error){setStatus('Try again. '+error.message,true);}
  finally {scanBusy=false;for(const id of ['vin-photo-button','vin-upload-button','vin-retry','vin-clear-photo'])$(id).disabled=false;}
}
liveScanner=createScanner({video:$('vin-live-video'),verify,lens:frame=>lensReady.then(ok=>ok?scanWithGoogle(frame,{api:lensApi}):null),onStarted:stream=>cameraControls.attach(stream),region:()=>cameraControls.region(),onSample:info=>{$('vin-live-progress').textContent='Camera: '+info.width+' × '+info.height+' · Frames sampled: '+info.samples+' · Barcode attempts: '+info.attempts+' · Local text checks: '+info.textAttempts;},onFrame:(result,{frames,samples,textAttempts})=>{if(result.diagnostics)showBarcodeCheck({...result.diagnostics,liveFrames:frames});$('vin-live-progress').textContent='Frames sampled: '+samples+' · Barcode attempts: '+frames+' · Local text checks: '+textAttempts;},onStatus:message=>setLiveStatus(message),onMatch:async(vin,result)=>{const run=cameraSession;setLiveStatus('Checking vehicle details…');$('vin-live-capture').disabled=true;showBarcodeCheck({...result.diagnostics,liveFrames:barcodeCheck?.liveFrames});const ok=await applyScannedVin(vin,{text:'live-text',lens:'google-lens'}[result.candidates?.[0]?.method]||'live-barcode');if(!ok&&run===cameraSession){liveUi(true);setLiveStatus(status.textContent,true);$('vin-live-retry').hidden=false;}},onError:error=>{liveUi(true);$('vin-photo-button').disabled=false;$('vin-live-capture').disabled=true;setLiveStatus('Try again. '+cameraErrorMessage(error),true);$('vin-live-retry').hidden=false;}});
function setLiveStatus(message,error=false){$('vin-live-status').textContent=message;$('vin-live-status').classList.toggle('vin-error',error);}
async function open(){
  if(scanBusy)return;
  clearPhoto();setStatus('');setLiveStatus('Opening camera…');$('vin-live-retry').hidden=true;scanSource.textContent='';showBarcodeCheck();$('vin-live-progress').textContent='Waiting for camera frames. Barcode first; local text checks start if needed.';liveUi(true);
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('vin-live-status').textContent='This browser cannot show an in-page camera here. Use the phone camera button below, choose a photo, or open this website in your phone’s browser.';return;}
  $('vin-photo-button').disabled=true;$('vin-live-capture').disabled=true;
  await liveScanner.start();if(liveScanner.active)$('vin-live-capture').disabled=false;
}
$('vin-photo-button').addEventListener('click',open);
$('vin-live-retry').addEventListener('click',open);
function cancelScan(message='Camera stopped.'){scanId++;revision++;abort?.abort();stopLive(message);}
$('vin-live-tools').addEventListener('cancel',event=>{event.preventDefault();cancelScan();});
$('vin-live-tools').addEventListener('close',()=>{if(!$('vin-live-tools').open)stopLive();});
$('vin-live-stop').addEventListener('click',()=>cancelScan('Camera stopped. You can start a new live scan or choose a VIN photo.'));
$('vin-camera-fallback').addEventListener('click',()=>{stopLive();$('vin-photo').click();});
$('vin-live-capture').addEventListener('click',async()=>{
  if(scanBusy||!liveScanner.active)return;
  try{const frame=liveScanner.capture();stopLive();sourcePhoto=frame;crop=null;drawPhoto();$('vin-photo-tools').hidden=false;$('vin-crop-status').textContent='Photo captured from the live camera. Drag around the VIN if a retry is needed.';await readPhoto();}
  catch(error){$('vin-live-status').textContent=cameraErrorMessage(error);}
});
$('vin-upload-button').addEventListener('click',()=>{stopLive();$('vin-upload').click();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&$('vin-live-tools').open)cancelScan('Camera stopped while the page was away. Tap Live scan VIN to start again.');});
window.addEventListener('pagehide',()=>cancelScan(''));
form?.addEventListener('submit',()=>cancelScan(''));
$('vin-photo').addEventListener('change',selectPhoto);$('vin-upload').addEventListener('change',selectPhoto);
$('vin-retry').addEventListener('click',readPhoto);
function clearPhoto(){restoreVinStatus();scanId++;sourcePhoto=null;crop=null;cropStart=null;preview.width=1;preview.height=1;$('vin-photo-tools').hidden=true;$('vin-candidate').hidden=true;$('vin-raw-text').textContent='';$('vin-recognized').value='';suggestions=[];}
$('vin-clear-photo').addEventListener('click',()=>{clearPhoto();scanSource.textContent='';showBarcodeCheck();status.textContent='Photo cleared. You can take another photo or type your VIN.';});
async function applyScannedVin(value,method='') {
  // Keep the photo and retry controls until the decoder confirms a vehicle.

  clearTimeout(timer);
  const vin=normalizeVin(value);
  clearDecode();input.value=vin;
  if(!validVin(vin)){setStatus('Try again. Read all 17 VIN characters.',true);return false;}
  const decoded=await decode(true);
  if(!decoded)return false;
  stopLive();clearPhoto();
  scanSource.textContent=method==='live-text'?'VIN read from the printed label. Please check every character.':method==='live-barcode'?'VIN read from the barcode.':method==='barcode'?'VIN read from the barcode.':method==='google-lens'?(barcodeCheck?.status==='unavailable'?'Google Lens used because the barcode reader could not run.':'VIN read by Google Lens after the barcode checks.'):method==='text'?'VIN read from the printed label. Please check every character.':'';
  input.scrollIntoView({block:'center',behavior:'auto'});
  onConfirmed(decoded,vin);
  return true;
}
$('vin-use').addEventListener('click',()=>{const value=$('vin-recognized').value;applyScannedVin(value,suggestions.find(candidate=>candidate.vin===normalizeVin(value))?.method);});
form?.addEventListener('reset',()=>{stopLive();clearTimeout(timer);clearDecode();clearPhoto();scanSource.textContent='';showBarcodeCheck();input.setCustomValidity('');status.textContent='';lookup.disabled=false;});

return {open,stop(){clearTimeout(timer);cancelScan('');}};
}
