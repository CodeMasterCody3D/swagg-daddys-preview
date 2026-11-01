(async () => {
  const form = document.getElementById('service-form');
  const media = document.getElementById('media');
  const submit = form.querySelector('button[type="submit"]');
  const status = document.getElementById('submission-status');
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
    if (!form.reportValidity()) return;
    const files = [...media.files];
    if (files.length > 3 || files.reduce((sum,file)=>sum+file.size,0) > 4*1024*1024) { status.textContent='Choose up to 3 files, under 4 MB combined.'; return; }
    submit.disabled=true; status.textContent='Sending your request…';
    try {
      const response = await fetch(api + '/requests', { method:'POST', body:new FormData(form), credentials:'omit' });
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.received) throw new Error(data.error || 'Your request could not be sent. Please call or text 205-492-8772.');
      form.reset(); document.getElementById('media-box').hidden=false; document.getElementById('file-list').textContent='No files selected.';
      for (const id of ['latitude','longitude','accuracy']) document.getElementById(id).value='';
      document.getElementById('location-status').textContent=''; document.getElementById('request-result').hidden=true;
      status.textContent='Request received. Swagg Daddys will contact you about availability and pricing. Your appointment is not confirmed yet.';
    } catch(error) { status.textContent=error.message; }
    finally { submit.disabled=false; }
  });
})();
