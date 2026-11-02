import { mountAppUpdates } from './app-updates.js';
import { mountVehicleResearch } from './vehicle-research.js';
import { mountManuals } from './manuals.js';
import { mountInvoiceEditor } from './invoice.js';
const $ = id => document.getElementById(id);
let csrf = '', items = [], next = null, active = null, statuses = [], objectUrls = [];
const github = location.hostname.endsWith('github.io');
const backend = window.SWAGG_CONFIG?.backendOrigin || '';
const configuredOrigin = (() => { try { const u = new URL(backend); return u.protocol === 'https:' ? u.origin : ''; } catch { return ''; } })();
const apiBase = github ? (configuredOrigin ? configuredOrigin + '/api' : null) : '/api';
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function show(id) { ['signin','inbox','unavailable'].forEach(name => $(name).hidden = name !== id); appUpdates.setSignedIn(id === 'inbox'); }
function clearMedia() { objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls = []; $('attachments').replaceChildren(); }
function signedOut() { csrf = ''; items = []; active = null; next = null; clearMedia(); researchTools.reset(); manuals.reset(); ownerSection(false); $('cards').replaceChildren(); $('customer-dialog').close(); $('password').value = ''; show('signin'); }
async function api(path, options = {}) {
  const response = await fetch(apiBase + path, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { ...(options.body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401) signedOut(); throw new Error(data.error || 'The request could not be completed.'); }
  return data;
}
function el(tag, value, className) { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; }
const appUpdates = mountAppUpdates();
const researchTools=mountVehicleResearch($('vehicle-research'),{api});
function ownerSection(tools=false){$('owner-tools').hidden=!tools;$('requests-view').hidden=tools;for(const [id,selected]of [['tools-tab',tools],['requests-tab',!tools]]){$(id).setAttribute('aria-pressed',String(selected));$(id).classList.toggle('secondary',!selected);}}
const invoices=mountInvoiceEditor({api});
const manuals=mountManuals($('manual-finder'),{api,apiBase,onShow:()=>ownerSection(true),onUnauthorized:()=>signedOut()});
// Opens the Tools finder at this request's vehicle (make/year, model filtered, VIN engine highlighted).
function openManuals(item){$('customer-dialog').close();ownerSection(true);manuals.openVehicle({...(item.vehicleSpecs||{}),text:item.vehicle||''});}
$('tools-tab').addEventListener('click',()=>ownerSection(true));$('requests-tab').addEventListener('click',()=>ownerSection(false));
function contactLink(number, kind = 'tel') { return `${kind}:${number.replace(/[^+0-9]/g, '')}`; }
function shortDate(date) { return new Date(date).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
function requestVin(item) {
  const box=el('div',undefined,'vin-summary');box.append(el('strong','VIN'));
  const value=item.vin || item.vinSubmitted || '';
  if(value&&/^[A-HJ-NPR-Z0-9]{17}$/.test(item.vin || '')) {
    const link=el('button',value,'vin-value');link.type='button';link.title='Open this vehicle’s repair manual';link.addEventListener('click',()=>openManuals(item));
    box.append(link,el('span','Tap VIN to open this vehicle’s repair manual.','small muted'));
  }else box.append(el('span',value || 'Not included in this saved request','vin-value'));
  if(item.vinSubmitted&&item.vinSubmitted!==item.vin&&item.vin)box.append(el('span','As entered: '+item.vinSubmitted,'small muted'));
  return box;
}
function jobTools(item) {
  const panel=el('details',undefined,'job-tools');
  panel.append(el('summary','Tool planning for this vehicle'));
  panel.append(el('p','Suggested basic hand tools: ratchets, extensions, socket and combination-wrench sets matched to the fasteners, screwdrivers, pliers, and a torque wrench covering the repair’s specified torque range.','small'));
  const work=[item.issue,item.details,item.notes].join(' ').toLowerCase();
  if(/\boil\b|\bfilter\b/.test(work))panel.append(el('p','For an oil service, check the procedure for a drain pan, funnel, oil-filter tool, drain-plug size and torque.','small'));
  if(/\bbrake|\bcaliper/.test(work))panel.append(el('p','For brake work, check the procedure for piston-retraction tools, caliper fastener sizes, lifting/support equipment and torque specifications.','small'));
  if(/\btransmission|\bgearbox|\bclutch/.test(work))panel.append(el('p','For transmission or clutch work, check the exact operation for support equipment, a transmission jack, adapters and manufacturer special tools.','small'));
  panel.append(el('p','Exact socket sizes and special tools have not been verified for this job. Use the matching vehicle manual and select the specific repair procedure.','small muted'));
  const manual=el('button','Open this vehicle’s repair manual','button secondary compact');
  manual.type='button';manual.addEventListener('click',()=>openManuals(item));panel.append(manual);
  return panel;
}
function render() {
  const query = $('search').value.trim().toLowerCase(); const filter = $('status-filter').value;
  const visible = items.filter(item => (!filter || item.status === filter) && (!query || [item.name,item.phone,item.vehicle,item.vin,item.vinSubmitted,item.location].join(' ').toLowerCase().includes(query)));
  $('cards').replaceChildren();
  for (const customer of visible) {
    const card = el('article', undefined, 'customer'); const top = el('div', undefined, 'customer-heading');
    const name = el('button', customer.name, 'customer-name'); name.type='button'; name.addEventListener('click', () => openCustomer(customer.id)); top.append(name);
    top.append(el('span', customer.status, 'badge')); card.append(top, el('p', customer.vehicle), el('p', customer.issue));
    card.append(requestVin(customer));
    const phone = el(customer.dialNumber?'a':'p', customer.phone || 'Phone not provided', 'phone'); if(customer.dialNumber)phone.href = contactLink(customer.dialNumber); phone.setAttribute('aria-label', `Call ${customer.name} at ${customer.phone}`); card.append(phone);
    const urgent = /^(Urgent|Stranded)/.test(customer.urgency); card.append(el('span', customer.urgency.split(' — ')[0], 'badge' + (urgent ? ' urgent' : '')));
    const bottom = el('div', undefined, 'customer-bottom'); bottom.append(el('span', shortDate(customer.createdAt), 'small'));
    const view = el('button', 'View request', 'button secondary compact'); view.addEventListener('click', () => openCustomer(customer.id)); bottom.append(view); card.append(bottom); $('cards').append(card);
  }
  $('empty').hidden = visible.length > 0; $('empty').textContent = items.length ? 'No requests match your search.' : 'No requests yet. New service requests will appear here.';
  $('count').textContent = '(' + items.length + (next ? '+' : '') + ')'; $('load-more').hidden = !next;
  $('stats').hidden=$('inbox-view').value==='trash';
  $('inbox-title').textContent=$('inbox-view').value==='trash'?'Trash':'Service requests';
  if (!items.length && $('inbox-view').value==='trash') $('empty').textContent='Trash is empty.';
  $('stats').replaceChildren();
  for (const [label,value] of [['New', items.filter(i => i.status === 'New').length], ['Active', items.filter(i => ['Contacted','Scheduled','In progress'].includes(i.status)).length], ['Completed', items.filter(i => i.status === 'Completed').length]]) {
    const stat = el('div', undefined, 'stat'); stat.append(el('strong', String(value)), el('span', label + (next ? ' · loaded' : ''))); $('stats').append(stat);
  }
}
async function load(older = false) {
  $('refresh').disabled = true; $('load-more').disabled = true; $('inbox-view').disabled=true;
  try {
    const params=new URLSearchParams({view:$('inbox-view').value}); if (older && next) params.set('before',next);
    const data = await api('/requests?'+params);
    items = older ? [...new Map([...items,...data.items].map(i => [i.id,i])).values()] : data.items; next = data.next;
    if (!statuses.length) { statuses = data.statuses; for (const status of statuses) { $('status-filter').append(new Option(status, status)); $('job-status').append(new Option(status, status)); } }
    show('inbox'); render(); notice('');
  } catch (error) { notice(error.message, true); }
  finally { $('refresh').disabled = false; $('load-more').disabled = false; $('inbox-view').disabled=false; }
}
function fact(label, value) { const row = el('div', undefined, 'fact'); row.append(el('strong', label), typeof value === 'string' ? el('p', value) : value); $('customer-facts').append(row); }
async function openCustomer(id) {
  notice('Loading customer…');
  try {
    const item = await api('/requests/' + id); active = item; clearMedia(); $('customer-facts').replaceChildren();let vehicleReport;
    $('customer-title').textContent = item.name; $('customer-vehicle').textContent = item.vehicle;
    $('call-customer').hidden=!item.dialNumber;$('text-customer').hidden=!item.dialNumber;
    $('call-customer').href = contactLink(item.dialNumber || ''); $('call-customer').textContent = 'Call ' + item.phone;
    $('text-customer').href = contactLink(item.dialNumber || '', 'sms');
    $('customer-facts').append(requestVin(item));
    fact('Contact information (as entered)',item.phone || 'No phone number provided');
    fact('Requested', shortDate(item.createdAt)); fact('Urgency', item.urgency); fact('Issue', item.issue); fact('Location', item.location);
    fact('Customer details', item.details || 'No additional details.');
    if (item.gps) { fact('Shared GPS coordinates',[item.gps.latitude,item.gps.longitude].join(', ')+' · Accuracy: '+item.gps.accuracy+' meters');const map = el('a', 'Open vehicle location in Maps'); map.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(item.gps.latitude + ',' + item.gps.longitude); map.target='_blank'; map.rel='noopener noreferrer'; fact('Vehicle location', map); }
    if (item.vin) {
      const research=el('details',undefined,'job-tools');research.open=true;research.append(el('summary','Vehicle background report'));
      const researchBody=el('div');research.append(researchBody);vehicleReport=mountVehicleResearch(researchBody,{api,vin:item.vin});fact('Vehicle research',research);
      if (item.vehicleSpecs) fact('Vehicle specifications (customer supplied)', Object.entries(item.vehicleSpecs).map(([key,value]) => key+': '+value).join(' · ') || 'Not supplied');
      const history = el('div'); const button=el('button','View history for this VIN','button secondary compact'); button.type='button'; history.append(button); fact('Vehicle history',history);
      let cursor=null, started=false;
      const loadHistory=async () => {
        button.disabled=true;
        try {
          const result=await api('/vehicles/'+encodeURIComponent(item.vin)+'/history'+(cursor?'?before='+encodeURIComponent(cursor):''));
          if (active?.id!==item.id) return;
          if (!started) { history.append(el('p','Requests and work recorded by Swagg Daddys. Completed jobs are marked below.')); started=true; }
          for (const visit of result.items) {
            const row=el('div',undefined,'fact');
            row.append(el('strong',shortDate(visit.createdAt)+' · '+visit.status+(visit.id===item.id?' · Current request':'')),el('p',visit.issue),el('p',visit.notes || 'No service notes recorded.'));
            if (visit.completedAt) row.append(el('p','Marked completed: '+shortDate(visit.completedAt)));
            const open=el('button','Open request','button secondary compact'); open.type='button'; open.addEventListener('click',()=>openCustomer(visit.id)); row.append(open); history.append(row);
          }
          if (!result.items.length) history.append(el('p','No saved history for this VIN.'));
          cursor=result.next; button.hidden=!cursor; button.textContent='Load older history';
        } catch(error) { $('detail-notice').textContent=error.message; }
        finally { button.disabled=false; }
      };
      button.addEventListener('click',loadHistory);void loadHistory();
    }
    fact('Tools and repair references',jobTools(item));
    if(!item.deletedAt){const invoiceButton=el('button','Create or edit invoice','button secondary compact');invoiceButton.type='button';invoiceButton.addEventListener('click',()=>invoices.open(item));fact('Invoice',invoiceButton);}
    if(item.consentAt)fact('Service request disclosure accepted',shortDate(item.consentAt));
    $('update-form').hidden=Boolean(item.deletedAt); $('delete-request').hidden=Boolean(item.deletedAt); $('restore-request').hidden=!item.deletedAt; $('delete-confirmation').hidden=true;
    if (item.deletedAt) fact('Moved to Trash',shortDate(item.deletedAt));
    $('job-status').value = item.status; $('owner-notes').value = item.notes || ''; $('detail-notice').textContent = ''; $('detail-notice').classList.remove('error');
    $('customer-dialog').showModal(); notice('');vehicleReport?.run();
    // Opening the request counts as checked: the server stops its repeat alerts.
    if (!item.deletedAt) api('/requests/' + encodeURIComponent(item.id) + '/seen', { method:'POST', body:'{}' }).catch(() => {});
    for (const file of item.media) {
      const box = el('div', undefined, 'attachment'); const button = el('button', 'Load ' + file.name, 'button secondary compact'); box.append(button); $('attachments').append(box);
      const loadAttachment = async () => {
        button.disabled = true;
        button.textContent = 'Loading ' + file.name + '…';
        try {
          const response = await fetch(apiBase + '/requests/' + item.id + '/media/' + file.id, { credentials:'same-origin', cache:'no-store' });
          if (response.status === 401) { signedOut(); throw new Error('Please sign in again.'); }
          if (!response.ok) throw new Error('Attachment could not be loaded.');
          const blob = await response.blob();
          if (active?.id !== item.id || !$('customer-dialog').open || !box.isConnected) return;
          const url = URL.createObjectURL(blob); objectUrls.push(url);
          const link = el('a', 'Download ' + file.name); link.href = url; link.download = file.name; box.replaceChildren(link);
          const media = el(file.type.startsWith('image/') ? 'img' : 'video'); media.src=url;
          if (media.tagName === 'VIDEO') { media.controls = true; media.playsInline = true; } else { media.alt = file.name; media.loading = 'eager'; }
          box.append(media);
        } catch (error) {
          if (active?.id !== item.id || !box.isConnected) return;
          button.disabled = false; button.textContent = 'Retry loading attachment'; $('detail-notice').textContent = error.message;
        }
      };
      button.addEventListener('click', loadAttachment);
      if (file.type.startsWith('image/')) void loadAttachment();
    }
  } catch (error) { notice(error.message, true); }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('sign-in-button').disabled = true; notice('Signing in…');
  try { const data = await api('/login', { method:'POST', body:JSON.stringify({ username:$('username').value, password:$('password').value }) }); csrf = data.csrf; $('password').value = ''; await load(); }
  catch (error) { notice(error.message, true); }
  finally { $('sign-in-button').disabled = false; }
});
$('sign-out').addEventListener('click', async () => { try { await api('/logout', { method:'POST', body:'{}' }); signedOut(); notice('Signed out.'); } catch (error) { notice(error.message, true); } });
$('refresh').addEventListener('click', () => load()); $('load-more').addEventListener('click', () => load(true));
$('inbox-view').addEventListener('change',()=>{items=[];next=null;void load();});
$('search').addEventListener('input', render); $('status-filter').addEventListener('change', render);
$('close-detail').addEventListener('click', () => $('customer-dialog').close());
$('customer-dialog').addEventListener('close', () => { clearMedia(); active = null; $('customer-facts').replaceChildren(); $('owner-notes').value = ''; });
$('update-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!active) return; $('save-job').disabled = true;
  try {
    const updated = await api('/requests/' + active.id, { method:'PATCH', body:JSON.stringify({ status:$('job-status').value, notes:$('owner-notes').value, revision:active.revision }) });
    active = updated; items = items.map(i => i.id === updated.id ? updated : i); render(); $('detail-notice').textContent='Changes saved.'; $('detail-notice').classList.remove('error');
  } catch (error) { $('detail-notice').textContent=error.message; $('detail-notice').classList.add('error'); }
  finally { $('save-job').disabled=false; }
});
$('delete-request').addEventListener('click',()=>{ $('delete-confirmation').hidden=false; $('confirm-delete').focus(); });
$('cancel-delete').addEventListener('click',()=>{ $('delete-confirmation').hidden=true; $('delete-request').focus(); });
async function moveRequest(restoring=false) {
  if (!active) return;
  const item=active; const button=$(restoring?'restore-request':'confirm-delete'); button.disabled=true;
  $('close-detail').disabled=true;
  try {
    await api('/requests/'+item.id+(restoring?'/restore':''),{method:restoring?'POST':'DELETE',body:JSON.stringify({revision:item.revision})});
    $('customer-dialog').close(); await load();
    notice(restoring?'Request restored to the active inbox and VIN history.':'Request moved to Trash. Choose Trash to restore it.');
  } catch(error) { $('detail-notice').textContent=error.message; $('detail-notice').classList.add('error'); }
  finally { button.disabled=false; $('close-detail').disabled=false; }
}
$('confirm-delete').addEventListener('click',()=>moveRequest(false));
$('restore-request').addEventListener('click',()=>moveRequest(true));
async function init() {
  // Keep owner authentication same-origin: avoids cross-site cookies in Android WebView.
  if (github && configuredOrigin) { location.replace(configuredOrigin + '/owner/'); return; }
  if (!apiBase) { show('unavailable'); notice('Secure hosting is not connected yet.'); return; }
  try {
    const health = await api('/health');
    if (!health.ready) { show('unavailable'); notice('Owner sign-in has not been activated yet.'); return; }
    try { const auth = await api('/session'); csrf=auth.csrf; await load(); }
    catch (error) { show('signin'); notice(error.message === 'Please sign in.' ? '' : error.message); }
  } catch { show('unavailable'); notice('Secure hosting is not connected yet.'); }
}
init();
