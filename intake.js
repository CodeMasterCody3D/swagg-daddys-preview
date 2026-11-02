import { requestServiceLocation } from './request-location.js';
(async () => {
  const form = document.getElementById('service-form');
  const media = document.getElementById('media');
  const submit = form.querySelector('button[type="submit"]');
  const status = document.getElementById('submission-status');
  function showStatus(message,error=false) {
    status.classList.toggle('submission-error',error);
    status.setAttribute('role',error?'alert':'status');status.setAttribute('aria-live',error?'assertive':'polite');
    status.textContent=error?'Request not sent. '+message:message;
    if(error){status.scrollIntoView({block:'center',behavior:'smooth'});status.focus({preventScroll:true});}
  }
  form.addEventListener('invalid',event=>{
    event.preventDefault();
    showStatus(event.target.id==='location-consent'?'Please check the service request disclosure above, then press Send service request again.':event.target.validationMessage || 'Please review the highlighted field and try again.',true);
  },true);
  form.addEventListener('input',()=>{if(status.classList.contains('submission-error'))showStatus('');});

  const isGithub = location.hostname.endsWith('github.io');
  let backend = '';
  try { const url = new URL(window.SWAGG_CONFIG?.backendOrigin); if (url.protocol === 'https:') backend = url.origin; } catch {}
  const enabled = !window.SWAGG_PREVIEW && (!isGithub || Boolean(backend));
  const api = isGithub && backend ? backend + '/api' : '/api';
  if (!enabled) return; // Existing copy-message preview stays usable until the backend origin is set.
  try {
    const response = await fetch(api + '/health', { cache:'no-store', credentials:'omit' });
    const health = await response.json();
    if (!response.ok || !health.ready) return;
  } catch { return; } // Keep prepare/copy mode until the backend is actually available.
  window.SWAGG_INTAKE_ACTIVE = true;
  submit.textContent = 'Send service request';
  document.getElementById('intake-disclosure').textContent = 'Your request, shared GPS coordinates, and selected files are sent privately to Swagg Daddys. Sending a request does not book an appointment.';
  const booking = [...document.querySelectorAll('.faq details')].find(item => item.querySelector('summary')?.textContent === 'Does this request book an appointment?');
  if (booking) booking.querySelector('p').textContent = 'No. Your request is sent to the mechanic for review. An appointment is booked only after you confirm the date, location, work, and price together.';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    submit.disabled=true; media.disabled=true; showStatus('Preparing your request…');
    try {
      showStatus('Waiting for location permission. You can decline and still send your request.');
      await requestServiceLocation();
      showStatus('Preparing your request…');
      const prepared=await (window.SWAGG_MEDIA_READY || Promise.resolve({files:[...media.files],warnings:[]}));
      const body=new FormData(form);body.delete('issue_media');for(const file of prepared.files)body.append('issue_media',file,file.name);
      showStatus('Sending your request…');
      const response = await fetch(api + '/requests', { method:'POST', body, credentials:'omit' });
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.received) throw new Error(data.error || 'Your request could not be sent. Please call or text 205-492-8772.');
      form.reset(); document.getElementById('media-box').hidden=false; document.getElementById('file-list').textContent='No files selected.';
      for (const id of ['latitude','longitude','accuracy']) document.getElementById(id).value='';
      document.getElementById('location-status').textContent=''; document.getElementById('request-result').hidden=true;
      showStatus('Request received. Swagg Daddys will review your details. Your appointment is not confirmed yet.'+(prepared.warnings.length?' '+prepared.warnings.join(' '):''));
    } catch(error) { showStatus(error instanceof TypeError?'Please check your connection and try again, or call/text 205-492-8772.':error.message,true); }
    finally { submit.disabled=false;media.disabled=false; }
  });
})();
