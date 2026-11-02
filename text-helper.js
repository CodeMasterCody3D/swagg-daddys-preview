// "Text me" helper: opens the request form as a full-screen pop-up. The customer
// fills in what they know (VIN scan, photos, location all work as usual) and taps
// Send text message: the request is saved to the owner inbox when the backend is
// on, then the phone's messaging app opens with the details typed out to Swagg
// Daddys. Photos cannot ride along in an sms: link, so the text says they were
// sent with the online request.
import { requestServiceLocation } from './request-location.js';

export const SHOP_NUMBER='+12054928772';

// iOS reads the body after "&", Android and others after "?".
export function smsLink(body,{ios=/iPad|iPhone|iPod/.test(globalThis.navigator?.userAgent||'')}={}) {
  return 'sms:'+SHOP_NUMBER+(ios?'&':'?')+'body='+encodeURIComponent(body);
}

// The text the customer sends. Empty answers are left out.
export function textMessage({name,vehicle,vin,location,latitude,longitude,urgency,issue,details,photos=0,reference}={}) {
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const gps=Number.isFinite(Number.parseFloat(latitude))&&Number.isFinite(Number.parseFloat(longitude))&&clean(latitude)&&clean(longitude)
    ?'https://maps.google.com/?q='+Number(latitude).toFixed(6)+','+Number(longitude).toFixed(6):'';
  const lines=['Hi Swagg Daddys! I need a mobile mechanic.'];
  const add=(label,value)=>{if(clean(value))lines.push(label+': '+clean(value));};
  add('Name',name);add('Vehicle',vehicle);add('VIN',vin);
  add('Location',[clean(location),gps].filter(Boolean).join(' — '));
  add('How soon',urgency);add('Problem',issue);add('Details',details);
  // The saved request's id is too long for a text; saying it was sent is enough
  // for the owner to find it (it arrives with the same name, phone and vehicle).
  if(photos>0)lines.push(`Photos: ${photos} sent with my online request.`);
  else if(reference)lines.push('I also sent this request online.');
  return lines.join('\n');
}

export function mountTextHelper({form,dialog,openers}) {
  const field=id=>form.elements.namedItem(id);
  const submit=form.querySelector('button[type="submit"]');
  const status=dialog.querySelector('.text-helper-status');
  const again=dialog.querySelector('.text-helper-again');
  const home=document.createComment('service-form home');
  // The live preview sits just above the submit button while in text mode.
  const preview=document.createElement('div');preview.className='field full text-preview';
  preview.innerHTML='<label for="text-preview-body">Your text message <span>(you can edit it here or in your messaging app)</span></label><textarea id="text-preview-body" rows="7" maxlength="1500"></textarea>';
  const box=preview.querySelector('textarea');
  let edited=false,submitLabel='',sent=false;
  const photoCount=()=>document.getElementById('media')?.files?.length||0;
  const values=(extra={})=>({name:field('name')?.value,vehicle:field('vehicle')?.value,vin:field('vin')?.value,location:field('location')?.value,latitude:field('latitude')?.value,longitude:field('longitude')?.value,urgency:field('urgency')?.value,issue:field('issue')?.value,details:field('details')?.value,photos:photoCount(),...extra});
  const refresh=()=>{if(!edited)box.value=textMessage(values());};
  box.addEventListener('input',()=>{edited=true;});
  form.addEventListener('input',()=>{if(form.dataset.mode==='text')refresh();});
  form.addEventListener('change',()=>{if(form.dataset.mode==='text')refresh();});

  function open(event){
    event?.preventDefault();
    if(form.dataset.mode==='text')return;
    form.before(home);dialog.querySelector('.text-helper-body').append(form);
    form.dataset.mode='text';submitLabel=submit.textContent;submit.textContent='Send text message';
    submit.before(preview);edited=false;sent=false;refresh();
    status.textContent='';again.hidden=true;
    dialog.hidden=false;dialog.showModal();document.documentElement.classList.add('text-helper-open');
    dialog.querySelector('.text-helper-body').scrollTop=0;
  }
  function close(){
    if(form.dataset.mode!=='text')return;
    delete form.dataset.mode;preview.remove();
    submit.textContent=window.SWAGG_INTAKE_ACTIVE?'Send service request':submitLabel;
    home.replaceWith(form);
    if(dialog.open)dialog.close();dialog.hidden=true;document.documentElement.classList.remove('text-helper-open');
    if(sent){form.reset();refresh();}
  }
  for(const button of openers)button.addEventListener('click',open);
  dialog.querySelector('.text-helper-close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});

  // Runs before intake.js's submit handler and replaces it in text mode.
  form.addEventListener('submit',async event=>{
    if(form.dataset.mode!=='text')return;
    event.preventDefault();event.stopImmediatePropagation();
    if(submit.disabled||!form.reportValidity())return;
    submit.disabled=true;again.hidden=true;
    let reference='',saveNote='';
    try {
      status.textContent='Checking your location (optional — you can decline)…';
      try{await requestServiceLocation();}catch{}
      refresh();
      if(typeof window.SWAGG_SEND_REQUEST==='function') {
        status.textContent='Saving your request for the mechanic…';
        try{
          const saved=await window.SWAGG_SEND_REQUEST({note:'Customer also sent this request as a text message.'});
          reference=saved.reference||'';
        }catch(error){saveNote=' The online copy could not be saved ('+(error.message||'connection problem')+'), but your text still goes straight to the mechanic.';}
      }
      const body=edited?box.value:textMessage(values({reference}));box.value=body;
      const link=smsLink(body);again.href=link;again.hidden=false;sent=true;
      status.textContent=(reference?'Request saved. ':'')+'Your messaging app is opening with the text ready — just tap Send.'+saveNote+' If it didn’t open, tap the button below.';
      window.location.href=link;
    } finally { submit.disabled=false; }
  },true);
  return {open,close};
}
