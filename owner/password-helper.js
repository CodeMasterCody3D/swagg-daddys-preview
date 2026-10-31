const helper=document.getElementById('password-helper');
const helperStatus=document.getElementById('helper-status');
const valueField=document.getElementById('protected-value');
const hex=bytes=>[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
helper.addEventListener('submit',async event=>{
  event.preventDefault();
  const password=document.getElementById('new-password');
  const confirm=document.getElementById('confirm-password');
  if(password.value!==confirm.value){helperStatus.textContent='The passwords do not match.';return;}
  if(!helper.reportValidity())return;
  document.getElementById('generate').disabled=true;
  try{
    const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password.value),'PBKDF2',false,['deriveBits']);
    const derived=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:600000,hash:'SHA-256'},key,256));
    valueField.value='pbkdf2:600000:'+salt+':'+hex(derived);
    password.value='';confirm.value='';document.getElementById('helper-result').hidden=false;
    helperStatus.textContent='Protected value created. Copy it into the Netlify setting described below.';
  }catch{helperStatus.textContent='Could not create the value. Use this page over HTTPS in a current browser.';}
  finally{document.getElementById('generate').disabled=false;}
});
document.getElementById('copy-value').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(valueField.value);helperStatus.textContent='Copied. Paste it into OWNER_PASSWORD_HASH in Netlify.';}
  catch{valueField.focus();valueField.select();helperStatus.textContent='Select and copy the protected value.';}
});
