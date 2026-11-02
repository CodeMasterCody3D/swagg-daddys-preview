// Owner Tools: repair-manual finder for LEMON Manuals (lemon-manuals.la).
// Make -> year -> model come from ../manuals-data/ (built from the LEMON torrent's
// index files by scripts/manuals-index.mjs), so they work even while LEMON is down.
// Manual pages and images are read through the owner-authenticated
// /api/manuals/* routes, because this page's CSP allows only same-origin requests.
// The location hash mirrors LEMON paths: #manuals/Honda/2008/Civic%20L4-1.8L/
// is lemon-manuals.la/Honda/2008/Civic%20L4-1.8L/, so Android Back steps back.

const PREFIX='#manuals';
const DB_INFO={
  CHARM:['Most detailed','From a set of 2013 DVDs. Usually the most detailed for the years it covers; some images are missing or cut off.'],
  LEMON:['Newest bulletins','Collected in late 2025, so it has newer service bulletins. Less detailed for older vehicles.']
};
const MAKES=['Acura','Alfa Romeo','American Motors','Audi','Austin','BMW','Buick','Cadillac','Checker','Chevrolet','Chrysler','Daewoo','Daihatsu','Dodge and Ram','Eagle','Fiat','Ford','Freightliner','GMC','General Motors','Genesis','Geo','Honda','Hummer','Hyundai','Infiniti','International','Isuzu','Jaguar','Jeep','Kia','Lancia','Land Rover','Lexus','Lincoln','MG','Mazda','Mercedes Benz','Mercury','Merkur','Mini','Mitsubishi','Nissan-Datsun','Oldsmobile','Opel','Peugeot','Plymouth','Pontiac','Porsche','Renault','Rivian','SRT','Saab','Saturn','Scion','Smart','Sterling','Subaru','Suzuki','Tesla','Toyota','Triumph','UD','VinFast','Volkswagen','Volvo','Workhorse','Yugo','ZAP'];
const POPULAR=['Chevrolet','Ford','Toyota','Honda','Nissan-Datsun','Dodge and Ram','Jeep','GMC','Hyundai','Kia','Subaru','Volkswagen'];
// What people (and NHTSA) call a make -> LEMON's directory name.
const MAKE_ALIASES={chevy:'Chevrolet',chev:'Chevrolet',vw:'Volkswagen',volkswagon:'Volkswagen',mercedes:'Mercedes Benz',benz:'Mercedes Benz',mercedesbenz:'Mercedes Benz',nissan:'Nissan-Datsun',datsun:'Nissan-Datsun',dodge:'Dodge and Ram',ram:'Dodge and Ram',alfa:'Alfa Romeo',amc:'American Motors',gm:'General Motors',caddy:'Cadillac',olds:'Oldsmobile',landrover:'Land Rover',rangerover:'Land Rover',minicooper:'Mini'};
// A model alone ("civic 2008") is enough to know the make.
const MODEL_MAKES={
  Honda:'civic accord crv pilot odyssey fit element ridgeline hrv insight prelude s2000 passport',
  Toyota:'camry corolla tacoma tundra rav4 4runner highlander prius sienna avalon sequoia yaris matrix fjcruiser',
  Ford:'f150 f250 f350 mustang explorer escape ranger focus fusion expedition edge taurus bronco econoline transit windstar crownvictoria',
  Chevrolet:'silverado tahoe suburban malibu impala camaro cruze equinox colorado corvette s10 blazer trailblazer cavalier traverse avalanche astro express',
  GMC:'sierra yukon acadia canyon envoy savana jimmy',
  'Nissan-Datsun':'altima sentra maxima rogue frontier pathfinder titan xterra murano versa armada',
  Jeep:'wrangler cherokee grandcherokee liberty compass patriot renegade gladiator',
  'Dodge and Ram':'charger challenger durango caravan grandcaravan dakota neon journey 1500 2500 3500',
  Hyundai:'elantra sonata santafe tucson accent kona',Kia:'optima sorento soul forte sportage rio telluride',
  Subaru:'outback forester impreza legacy crosstrek wrx',Volkswagen:'jetta passat golf beetle tiguan',
  Mazda:'mazda3 mazda6 miata mx5 cx5 cx9 tribute',Chrysler:'pacifica townandcountry sebring',
  Buick:'lesabre enclave lacrosse century regal',Pontiac:'grandam grandprix firebird vibe g6'
};
const TOPICS=[['Trouble codes','dtc'],['Wiring','wiring'],['Torque','torque'],['Fluids','fluid'],['Brakes','brake'],['Spark plugs','spark plug'],['Timing','timing'],['Bulletins','bulletin'],['Recalls','recall'],['Battery','battery'],['Maintenance','maintenance'],['A/C','air conditioning']];
const ICONS={wrench:'wrench','tools-and-equipment':'wrench',diagrams:'bolt','wiring-diagrams':'bolt',fluids:'drop','technical-service-bulletins':'alert',locations:'pin','labor-times':'clock',download:'down','quick-lookups':'search',tire:'car'};
const LEMON_ORIGINS=['https://lemon-manuals.la','https://lemon-manuals.org.ua','https://lemon-manuals.gy','https://lemon.dogeware.me'];

const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc=s=>encodeURIComponent(s);
// LEMON escapes !'()* too; matching it keeps routes identical to LEMON's own links.
const lemonEnc=s=>enc(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const dec=s=>{try{return decodeURIComponent(s);}catch{return s;}};
const icon=(name,cls='mf-icon')=>`<svg class="${cls}" aria-hidden="true"><use href="#mf-i-${name}"/></svg>`;
const tokens=q=>q.toLowerCase().split(/[\s,/]+/).filter(Boolean);
const slug=make=>make.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>String(a+i));
function highlight(text,toks){let out=esc(text);for(const t of toks){if(t.length<2)continue;out=out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'ig'),'<mark>$1</mark>');}return out;}
function store(key,val){try{if(val===undefined)return JSON.parse(localStorage.getItem(key)||'null');localStorage.setItem(key,JSON.stringify(val));}catch{return null;}}

function findMake(word,next){
  const pair=next?norm(word+next):'';
  for(const w of [pair,norm(word)]){
    if(!w)continue;
    if(MAKE_ALIASES[w])return {make:MAKE_ALIASES[w],used:w===pair?2:1};
    const m=MAKES.find(m=>norm(m)===w||(w.length>2&&norm(m.split(/[ -]/)[0])===w));
    if(m)return {make:m,used:w===pair?2:1};
  }
  return null;
}
export function parseVehicle(q){
  const words=q.trim().split(/[\s,]+/).filter(Boolean);
  let year=null,make=null;const rest=[];
  for(let i=0;i<words.length;i++){
    const w=words[i];
    if(!year&&/^(19[6-9]\d|20[0-2]\d)$/.test(w)){year=w;continue;}
    if(!year&&/^'?\d{2}$/.test(w)){const n=+w.replace("'",'');year=String(n>30?1900+n:2000+n);continue;}
    if(!make){const f=findMake(w,words[i+1]);if(f){make=f.make;i+=f.used-1;continue;}}
    rest.push(w);
  }
  if(!make&&rest.length){
    const joined=norm(rest.join(''));
    outer:for(const [mk,list]of Object.entries(MODEL_MAKES))for(const model of list.split(' '))if(joined.startsWith(model)||rest.some(r=>norm(r)===model)){make=mk;break outer;}
  }
  return {year,make,model:rest.join(' ')};
}
export function lemonMake(name){const words=String(name||'').split(/\s+/);return findMake(words[0]||'',words[1])?.make||null;}
const isVin=s=>/^[A-HJ-NPR-Z0-9]{17}$/i.test(s.trim());

// LEMON listing <ul> -> [{label,icon,children}|{label,icon,link}|{heading}|{desc}|{text}]
function parseTree(ul,resolve,basePath){
  const out=[];
  for(const el of ul.children){
    if(el.tagName==='H3'){out.push({heading:el.textContent.trim()});continue;}
    if(el.tagName==='DIV'){const t=el.textContent.trim();if(t)out.push({desc:t});continue;}
    if(el.tagName!=='LI')continue;
    const a=el.querySelector(':scope > a'),sub=el.querySelector(':scope > ul');
    const i=el.querySelector(':scope > i[data-icon]');
    const label=(a?a.textContent:el.childNodes[0]?.textContent||'').trim();
    const link=a?.getAttribute('href')?resolve(a.getAttribute('href'),basePath):null;
    if(sub)out.push({label,icon:i?.dataset.icon||'',children:parseTree(sub,resolve,basePath)});
    else if(link)out.push({label,icon:i?.dataset.icon||'',link});
    else if(label)out.push({text:label});
  }
  return out;
}
function flatten(nodes,trail=[],out=[],seen=new Set()){
  for(const n of nodes){
    if(n.children)flatten(n.children,trail.concat(n.label),out,seen);
    else if(n.link){const key=n.link.route||n.link.ext;if(seen.has(key))continue;seen.add(key);out.push({label:n.label,trail,link:n.link,hay:(trail.join(' ')+' '+n.label).toLowerCase()});}
  }
  return out;
}
function searchFlat(flat,q,limit=150){
  const toks=tokens(q);if(!toks.length)return [];
  const hits=[];
  for(const f of flat){if(!toks.every(t=>f.hay.includes(t)))continue;hits.push([toks.filter(t=>f.label.toLowerCase().includes(t)).length*10-f.trail.length,f]);}
  return hits.sort((a,b)=>b[0]-a[0]).slice(0,limit).map(h=>h[1]);
}
// "CR-V 2WD L4-2.4L" and "CR-V 4WD L4-2.4L" -> one "CR-V" card with two rows.
function mergeLeaves(cards){
  const folders=cards.filter(c=>!c.leaf).map(c=>c.name).sort((a,b)=>b.length-a.length);
  const byName=new Map(cards.filter(c=>!c.leaf).map(c=>[c.name,c]));
  const out=cards.filter(c=>!c.leaf);
  for(const c of cards.filter(c=>c.leaf)){
    const label=c.name;
    let base=folders.find(f=>label.startsWith(f+' '));
    if(!base)base=label.replace(/\s+(?:(?:2WD|4WD|AWD|FWD|RWD)\s+)?(?:[VLHW]\d{1,2}-[\d.]+L|\d\.\dL).*$/,'').replace(/,.*$/,'').trim()||label;
    const short=label.startsWith(base+' ')?label.slice(base.length+1):label===base?'All engines':label;
    if(!byName.has(base)){const card={name:base,items:[]};byName.set(base,card);out.push(card);}
    byName.get(base).items.push({label,short,link:c.items[0].link});
  }
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}

// Whitelist cleaner for LEMON content shown inline. Runs inside the inert
// DOMParser document, before anything is imported into this page.
const KEEP=new Set('P DIV SPAN BR B STRONG I EM U TABLE THEAD TBODY TFOOT TR TD TH CAPTION COLGROUP COL UL OL LI H1 H2 H3 H4 H5 H6 IMG A PRE CODE SUP SUB HR DL DT DD SMALL BLOCKQUOTE CENTER FONT'.split(' '));
const DROP=new Set('SCRIPT STYLE IFRAME FRAME OBJECT EMBED FORM INPUT BUTTON SELECT TEXTAREA LINK META SVG MATH TEMPLATE NOSCRIPT BASE AUDIO VIDEO SOURCE'.split(' '));
const ATTRS=new Set(['href','src','alt','colspan','rowspan','title']);

const SPRITE=`<svg width="0" height="0" class="mf-sprite" aria-hidden="true">
<symbol id="mf-i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></symbol>
<symbol id="mf-i-car" viewBox="0 0 24 24"><path d="M5 17h14M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4h-2.5M5.5 17H3v-4h18"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></symbol>
<symbol id="mf-i-wrench" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0 5 5L13 18l-3 3-4-4 3-3 6.7-6.7a4 4 0 0 1-1-1z"/></symbol>
<symbol id="mf-i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
<symbol id="mf-i-bolt" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></symbol>
<symbol id="mf-i-down" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/></symbol>
<symbol id="mf-i-folder" viewBox="0 0 24 24"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></symbol>
<symbol id="mf-i-page" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/></symbol>
<symbol id="mf-i-alert" viewBox="0 0 24 24"><path d="M12 3 2 20h20zM12 10v4M12 17v.5"/></symbol>
<symbol id="mf-i-drop" viewBox="0 0 24 24"><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/></symbol>
<symbol id="mf-i-pin" viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></symbol>
<symbol id="mf-i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></symbol>
<symbol id="mf-i-scan" viewBox="0 0 24 24"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M7 12h10"/></symbol></svg>`;

export function mountManuals(root,{api,apiBase,dataBase='../manuals-data/',onShow=()=>{},onUnauthorized=()=>{}}){
  root.classList.add('mf');
  root.innerHTML=SPRITE+`
    <form class="mf-search" role="search" autocomplete="off">
      ${icon('search')}
      <label class="mf-sr" for="mf-q">Year, make and model, or a 17-character VIN</label>
      <input id="mf-q" name="q" placeholder="2008 Honda Civic · or a VIN" enterkeyhint="search" spellcheck="false">
      <button class="button compact" type="submit">Find</button>
    </form>
    <div class="mf-suggest" role="listbox" hidden></div>
    <p class="mf-hint small muted">Try <button type="button" data-try="2008 Honda Civic">2008 Honda Civic</button>, <button type="button" data-try="f150 2015">f150 2015</button> or a customer's VIN.</p>
    <div class="mf-garage" hidden><span class="mf-garage-label">Recent</span><div class="mf-garage-list"></div></div>
    <ol class="mf-steps" aria-label="Progress"><li data-step="0"><span>01</span>Make</li><li data-step="1"><span>02</span>Year</li><li data-step="2"><span>03</span>Model</li><li data-step="3"><span>04</span>Manual</li></ol>
    <div class="mf-panel">
      <div class="mf-bar"><nav class="mf-crumbs" aria-label="Manual location"></nav><a class="mf-lemon" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open on LEMON ${icon('ext')}</a></div>
      <p class="mf-notice" hidden></p>
      <div class="mf-view" aria-live="polite"></div>
    </div>
    <p class="small muted mf-credit">Manuals are LEMON's free community archive (lemon-manuals.la), read through your owner login. Customer details are never sent. Confirm specs before you torque anything.</p>`;
  const $=s=>root.querySelector(s);
  const form=$('.mf-search'),input=$('#mf-q'),suggest=$('.mf-suggest'),hint=$('.mf-hint');
  const view=$('.mf-view'),crumbs=$('.mf-crumbs'),lemonLink=$('.mf-lemon'),noticeEl=$('.mf-notice');
  let lemonBase=LEMON_ORIGINS[0],renderId=0,slowTimer,sel=-1,options=[];
  const lemonUrl=path=>lemonBase+path;

  // ---- data ----
  const dataCache=new Map();
  function data(file){
    if(!dataCache.has(file))dataCache.set(file,fetch(dataBase+file,{credentials:'same-origin'}).then(r=>r.ok?r.json():null).catch(()=>null));
    return dataCache.get(file);
  }
  const pageCache=new Map();
  function lemon(path){
    if(pageCache.has(path))return pageCache.get(path);
    const p=(async()=>{
      let response;
      try{response=await fetch(apiBase+'/manuals/page?path='+enc(path),{credentials:'same-origin',signal:AbortSignal.timeout(30000)});}
      catch{throw Object.assign(new Error('LEMON Manuals is slow or down right now. Try again in a few minutes.'),{status:504});}
      if(response.status===401){onUnauthorized();throw Object.assign(new Error('Please sign in again.'),{status:401});}
      if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(new Error(body.error||'This manual page could not be loaded.'),{status:response.status});}
      const host=response.headers.get('x-lemon-host');if(LEMON_ORIGINS.includes(host))lemonBase=host;
      const doc=new DOMParser().parseFromString(await response.text(),'text/html');
      const main=doc.querySelector('.main');if(!main)throw Object.assign(new Error('This manual page could not be read.'),{status:502});
      return {doc,main,notice:doc.querySelector('.notice')?.textContent.trim()||''};
    })();
    pageCache.set(path,p);p.catch(()=>pageCache.delete(path));
    if(pageCache.size>40)pageCache.delete(pageCache.keys().next().value);
    return p;
  }
  // LEMON href -> {route} for pages shown here, or {ext} for links that open outside.
  function resolve(href,basePath){
    let u;try{u=new URL(href,LEMON_ORIGINS[0]+basePath);}catch{return null;}
    if(u.protocol!=='https:'&&u.protocol!=='http:')return null;
    if(!LEMON_ORIGINS.includes(u.origin))return {ext:u.href};
    if(/^\/bundle\//.test(u.pathname))return {ext:lemonUrl(u.pathname)};
    if(/^\/images\//.test(u.pathname)||/\.(html|svg|png|jpe?g|gif|pdf)$/i.test(u.pathname))return {ext:lemonUrl(u.pathname)};
    return {route:u.pathname.endsWith('/')?u.pathname:u.pathname+'/'};
  }
  const linkAttrs=r=>r.route?`href="${esc(PREFIX+r.route)}"`:`href="${esc(r.ext)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"`;
  function clean(rootEl,basePath){
    for(const el of [...rootEl.querySelectorAll('*')].reverse()){
      if(DROP.has(el.tagName)){el.remove();continue;}
      if(!KEEP.has(el.tagName)){el.replaceWith(...el.childNodes);continue;}
      for(const a of [...el.attributes])if(!ATTRS.has(a.name))el.removeAttribute(a.name);
      if(el.tagName==='A'){
        const raw=el.getAttribute('href');const r=raw&&!raw.startsWith('#')?resolve(raw,basePath):null;
        el.removeAttribute('href');
        if(r?.route)el.setAttribute('href',PREFIX+r.route);
        else if(r?.ext){el.setAttribute('href',r.ext);el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');}
      }
      if(el.tagName==='IMG'){
        // Images come through /api/manuals/image (img-src is 'self' only).
        let u=null;try{u=new URL(el.getAttribute('src')||'',LEMON_ORIGINS[0]+basePath);}catch{}
        if(u&&LEMON_ORIGINS.includes(u.origin)&&u.pathname.startsWith('/images/')){el.setAttribute('src',apiBase+'/manuals/image?path='+enc(u.pathname));el.setAttribute('loading','lazy');}
        else el.remove();
      }
    }
  }

  // ---- hero search ----
  const go=route=>{suggest.hidden=true;location.hash=PREFIX+route;};
  function vehicleRoute({make,year,model,engine}){
    if(!make)return null;
    const qs=new URLSearchParams();if(model)qs.set('q',model);if(engine)qs.set('e',engine);
    const s=qs.toString()?'?'+qs:'';
    return year?`/${lemonEnc(make)}/${year}/${s}`:`/${lemonEnc(make)}/${s}`;
  }
  function buildSuggestions(){
    const q=input.value.trim();options=[];
    if(!q){suggest.hidden=true;return;}
    if(isVin(q))options.push({html:`${icon('scan')} Decode VIN <b>${esc(q.toUpperCase())}</b>`,small:'NHTSA',run:()=>submit()});
    else{
      const v=parseVehicle(q);
      if(v.make)options.push({html:`${icon('car')} <b>${esc([v.year,v.make,v.model].filter(Boolean).join(' '))}</b>`,small:v.year?'Models':'Pick a year',run:()=>go(vehicleRoute(v))});
      const n=norm(q);
      for(const m of MAKES)if(norm(m).startsWith(n)&&m!==v.make&&options.length<5)options.push({html:`${icon('folder')} ${esc(m)}`,small:'Make',run:()=>go(`/${lemonEnc(m)}/`)});
    }
    sel=-1;
    suggest.innerHTML=options.map((o,i)=>`<button type="button" role="option" data-i="${i}">${o.html}<small>${o.small}</small></button>`).join('');
    suggest.hidden=!options.length;
  }
  async function decodeVin(vin){
    const v=await api('/manuals/vin/'+enc(vin.trim().toUpperCase()));
    const make=lemonMake(v.make);
    const disp=Number(v.displacement)>0?Number(v.displacement).toFixed(1):'';
    return {make,rawMake:v.make,year:v.year,model:v.model||'',engine:disp,desc:[v.year,v.make,v.model,v.trim,disp&&disp+'L'].filter(Boolean).join(' ')};
  }
  async function submit(){
    const q=input.value.trim();if(!q){input.focus();return;}
    if(isVin(q)){
      hint.textContent='Decoding VIN…';
      try{
        const v=await decodeVin(q);
        hint.innerHTML=`VIN: <b>${esc(v.desc)}</b>${v.make?'':` · LEMON has no make called “${esc(v.rawMake)}”. Pick it from the list.`}`;
        go(vehicleRoute(v)||'/');
      }catch(error){hint.textContent=error.message||'That VIN could not be decoded. Type the year, make and model.';}
      return;
    }
    const v=parseVehicle(q);
    if(v.make)return go(vehicleRoute(v));
    go('/?q='+enc(q));
  }
  form.addEventListener('submit',e=>{e.preventDefault();sel>=0&&options[sel]?options[sel].run():submit();});
  input.addEventListener('input',buildSuggestions);
  input.addEventListener('keydown',e=>{
    if(suggest.hidden)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();sel=(sel+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;[...suggest.children].forEach((b,i)=>b.setAttribute('aria-selected',i===sel));}
    else if(e.key==='Escape')suggest.hidden=true;
  });
  suggest.addEventListener('click',e=>{const b=e.target.closest('button');if(b)options[+b.dataset.i].run();});
  root.addEventListener('click',e=>{if(!e.target.closest('.mf-search,.mf-suggest'))suggest.hidden=true;});
  hint.addEventListener('click',e=>{const b=e.target.closest('[data-try]');if(b){input.value=b.dataset.try;submit();}});

  // ---- recent vehicles ----
  const GARAGE='owner-manuals-recent';
  function remember(segs){
    const path='/'+segs.slice(0,3).join('/')+'/',label=`${dec(segs[1])} ${dec(segs[0])} ${dec(segs[2])}`;
    const list=(store(GARAGE)||[]).filter(g=>g.path!==path);list.unshift({path,label});store(GARAGE,list.slice(0,6));drawGarage();
  }
  function drawGarage(){
    const list=store(GARAGE)||[];
    $('.mf-garage').hidden=!list.length;
    $('.mf-garage-list').innerHTML=list.map((g,i)=>`<a class="mf-chip" href="${esc(PREFIX+g.path)}">${icon('car','mf-icon mf-icon-sm')}${esc(g.label)}<span class="mf-x" data-del="${i}" title="Remove" role="button">×</span></a>`).join('');
  }
  $('.mf-garage-list').addEventListener('click',e=>{
    const d=e.target.closest('[data-del]');if(!d)return;e.preventDefault();
    const list=store(GARAGE)||[];list.splice(+d.dataset.del,1);store(GARAGE,list);drawGarage();
  });

  // ---- panel ----
  function parseHash(){
    const h=location.hash;
    if(!h.startsWith(PREFIX))return null;
    const [p,qs]=h.slice(PREFIX.length).split('?');
    const path=p.startsWith('/')?p:'/'+p;
    return {path:path.endsWith('/')?path:path+'/',params:new URLSearchParams(qs||'')};
  }
  function setParam(key,val){
    const r=parseHash()||{path:'/',params:new URLSearchParams()};
    val?r.params.set(key,val):r.params.delete(key);
    const s=r.params.toString();
    history.replaceState(history.state,'',PREFIX+r.path+(s?'?'+s:''));
  }
  function frame(segs){
    const names=['Manuals'].concat(segs.map(dec));
    const parts=names.map((n,i)=>i===names.length-1?`<strong>${esc(n)}</strong>`:`<a href="${esc(PREFIX+'/'+segs.slice(0,i).join('/')+(i?'/':''))}">${esc(n)}</a>`);
    if(parts.length>5)parts.splice(2,parts.length-4,'<span>…</span>');
    crumbs.innerHTML=parts.join('<span class="mf-sep">›</span>');
    const step=Math.min(segs.length,3);
    root.querySelectorAll('.mf-steps li').forEach(li=>{const s=+li.dataset.step;li.className=s<step?'done':s===step?'now':'';});
    lemonLink.href=lemonUrl('/'+segs.join('/')+(segs.length?'/':''));
  }
  function loading(msg){
    view.innerHTML=`<div class="mf-loading"><span class="mf-spin"></span><span>${esc(msg)}</span></div>`;
    clearTimeout(slowTimer);const line=view.querySelector('.mf-loading span:last-child');
    slowTimer=setTimeout(()=>{if(line.isConnected)line.textContent=msg+' LEMON is slow right now; trying its other addresses…';},5000);
  }
  function showNotice(text){noticeEl.hidden=!text;noticeEl.textContent=text;}
  function failCard(error,path){
    view.innerHTML=`<div class="mf-err"><p>${esc(error.message||'This page could not be loaded.')}</p><div class="mf-row"><a class="button compact" href="${esc(lemonUrl(path))}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open on LEMON ↗</a>${error.status===404||error.status===401?'':'<button class="button secondary compact" type="button" data-retry>Try again</button>'}</div></div>`;
    view.querySelector('[data-retry]')?.addEventListener('click',route);
  }
  const filterBox=(cls,placeholder,value)=>`<label class="mf-filter">${icon('search')}<span class="mf-sr">${esc(placeholder)}</span><input class="${cls}" placeholder="${esc(placeholder)}" value="${esc(value||'')}" autocomplete="off" spellcheck="false"></label>`;
  const head=(eyebrow,title,sub,extra='')=>`<div class="mf-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h3>${esc(title)}</h3>${sub?`<p class="small muted">${sub}</p>`:''}</div>${extra}</div>`;
  const topics=()=>`<div class="mf-topics">${TOPICS.map(([l,t])=>`<button class="mf-chip" type="button" data-t="${esc(t)}">${esc(l)}</button>`).join('')}</div>`;
  function resultsHtml(hits,q,total){
    const toks=tokens(q);
    if(!hits.length)return `<p class="mf-count">No pages match “${esc(q)}”. Try a shorter word, like “brake”.</p>`;
    return `<p class="mf-count">${hits.length>=150?'Top 150':hits.length} of ${total.toLocaleString()} pages match.</p><ul class="mf-results">`+
      hits.map(h=>`<li><a ${linkAttrs(h.link)}><small>${highlight(h.trail.join(' › '),toks)}</small><span>${highlight(h.label,toks)}</span></a></li>`).join('')+'</ul>';
  }

  // Step 1: makes
  function renderMakes(params){
    const tile=m=>`<a class="mf-make" href="${esc(PREFIX+'/'+lemonEnc(m)+'/')}"><b>${esc(m.replace(/[^A-Za-z]/g,'').slice(0,2))}</b><span>${esc(m)}</span></a>`;
    view.innerHTML=head('Step 01','Which make?','',filterBox('mf-mk','Filter makes',params.get('q')))+'<div class="mf-mk-out"></div>';
    const out=view.querySelector('.mf-mk-out'),box=view.querySelector('.mf-mk');
    const draw=()=>{
      const n=norm(box.value);
      if(!n){out.innerHTML=`<p class="mf-subhead">Most common</p><div class="mf-makes">${POPULAR.map(tile).join('')}</div><p class="mf-subhead">All makes A–Z</p><div class="mf-makes">${MAKES.map(tile).join('')}</div>`;return;}
      const list=MAKES.filter(m=>norm(m).includes(n)||m===MAKE_ALIASES[n]);
      out.innerHTML=list.length?`<div class="mf-makes">${list.map(tile).join('')}</div>`:`<p class="mf-empty">No make matches “${esc(box.value)}”.</p>`;
    };
    box.addEventListener('input',()=>{draw();setParam('q',box.value);});draw();
  }
  // Step 2: years
  async function renderYears(segs,params,id){
    const make=dec(segs[0]),carry=params.toString()?'?'+params:'';
    const draw=years=>{
      const byDecade={};for(const y of years)(byDecade[y.slice(0,3)+'0s']||=[]).push(y);
      view.innerHTML=head('Step 02',`Which year ${make}?`,params.get('q')?`Next: models matching “${esc(params.get('q'))}”.`:'',filterBox('mf-yr','Type a year',''))+
        Object.entries(byDecade).reverse().map(([d,ys])=>`<div class="mf-decade"><h4>${d}</h4><div>${ys.reverse().map(y=>`<a class="mf-chip" href="${esc(PREFIX+'/'+segs[0]+'/'+y+'/'+carry)}">${y}</a>`).join('')}</div></div>`).join('');
      const box=view.querySelector('.mf-yr');
      box.addEventListener('input',()=>{const v=box.value.trim();view.querySelectorAll('.mf-decade .mf-chip').forEach(c=>c.hidden=Boolean(v)&&!c.textContent.includes(v));view.querySelectorAll('.mf-decade').forEach(d=>d.hidden=![...d.querySelectorAll('.mf-chip')].some(c=>!c.hidden));});
      box.addEventListener('keydown',e=>{if(e.key==='Enter')view.querySelector('.mf-decade .mf-chip:not([hidden])')?.click();});
    };
    const known=(await data('makes.json'))?.[make];
    if(id!==renderId)return;
    if(known)return draw(Object.keys(known));
    loading(`Loading ${make} years…`);
    try{const {main,notice}=await lemon(`/${segs[0]}/`);if(id!==renderId)return;showNotice(notice);draw([...main.querySelectorAll('a')].map(a=>a.textContent.trim()).filter(t=>/^\d{4}$/.test(t)));}
    catch(error){if(id===renderId)error.status===404?draw(range(1960,2025)):failCard(error,`/${segs[0]}/`);}
  }
  // Step 3: models, one card per base model, per database
  async function renderModels(segs,params,id){
    const make=dec(segs[0]),year=dec(segs[1]),path=`/${segs[0]}/${segs[1]}/`;
    loading(`Loading ${year} ${make} models…`);
    let nodes;
    const local=await data(`v/${slug(make)}/${year}.json`);
    if(id!==renderId)return;
    if(local){
      nodes=[];
      for(const db of ['CHARM','LEMON']){
        if(!local[db])continue;
        nodes.push({heading:db},{desc:DB_INFO[db][1]});
        for(const [model,engines]of Object.entries(local[db])){
          const row=e=>({label:e||'All engines',link:{route:`/${lemonEnc(make)}/${year}/${lemonEnc([model,e].filter(Boolean).join(' '))}/`}});
          if(engines.length>1)nodes.push({label:model,children:engines.map(row)});
          else nodes.push({label:[model,engines[0]].filter(Boolean).join(' '),link:row(engines[0]).link});
        }
      }
    }else{
      try{const page=await lemon(path);if(id!==renderId)return;showNotice(page.notice);const ul=page.main.querySelector(':scope > ul');nodes=ul?parseTree(ul,resolve,path):[];}
      catch(error){if(id===renderId)failCard(error,path);return;}
    }
    const dbs=[];let cur=null;
    for(const n of nodes){
      if(n.heading){cur={name:n.heading.replace(/^Database:\s*/i,''),desc:'',cards:[]};dbs.push(cur);continue;}
      if(!cur){cur={name:'',desc:'',cards:[]};dbs.push(cur);}
      if(n.desc){cur.desc=n.desc;continue;}
      if(n.children)cur.cards.push({name:n.label,items:n.children.filter(c=>c.link).map(c=>({label:c.label,link:c.link}))});
      else if(n.link)cur.cards.push({name:n.label,items:[{label:n.label,link:n.link}],leaf:true});
    }
    for(const db of dbs)db.cards=mergeLeaves(db.cards);
    const engine=params.get('e')||'';
    const engRe=engine?new RegExp(`(^|[^\\d.])${engine.replace('.','\\.')}(L|\\b)`):null;
    view.innerHTML=head('Step 03',`${year} ${make}: pick the model`,`Manuals are split by engine and trim.${engine?` Rows with a <b>${esc(engine)}L</b> engine are highlighted.`:''}`,filterBox('mf-md','Filter, e.g. civic',params.get('q')))+'<div class="mf-md-out"></div>';
    const out=view.querySelector('.mf-md-out'),box=view.querySelector('.mf-md');
    const draw=()=>{
      const toks=tokens(box.value).map(norm).filter(Boolean);let shown=0;
      out.innerHTML=dbs.map(db=>{
        const cards=db.cards.filter(c=>toks.every(t=>norm(c.name+' '+c.items.map(i=>i.label).join(' ')).includes(t)));
        shown+=cards.length;if(!cards.length)return '';
        return `<div class="mf-db"><div class="mf-dbhead"><h4>${esc(db.name||'Models')}</h4>${DB_INFO[db.name]?`<span class="badge">${DB_INFO[db.name][0]}</span>`:''}${db.desc?`<p class="small muted">${esc(db.desc)}</p>`:''}</div><div class="mf-models">`+
          cards.map(c=>{
            const items=c.items.slice().sort((a,b)=>(engRe?.test(b.label)||0)-(engRe?.test(a.label)||0));
            return `<div class="mf-model"><h5>${icon('car')}${esc(c.name)}</h5><ul>${items.map(i=>`<li><a ${linkAttrs(i.link)} class="${engRe?.test(i.label)?'match':''}">${esc(i.short||i.label)}<span class="mf-go">›</span></a></li>`).join('')}</ul></div>`;
          }).join('')+'</div></div>';
      }).join('');
      if(!shown){out.innerHTML=`<p class="mf-empty">Nothing matches “${esc(box.value)}” for ${esc(year)} ${esc(make)}. <button class="mf-link" type="button" data-clear>Show all models</button></p>`;out.querySelector('[data-clear]').addEventListener('click',()=>{box.value='';draw();setParam('q','');});}
    };
    box.addEventListener('input',()=>{draw();setParam('q',box.value);});draw();
  }
  // Step 4: one vehicle -> "what are you working on?" plus its sections
  async function renderModelHome(segs,params,id){
    const path='/'+segs.join('/')+'/',title=`${dec(segs[1])} ${dec(segs[0])} ${dec(segs[2])}`;
    remember(segs);loading(`Opening the ${title} manual…`);
    let page;try{page=await lemon(path);}catch(error){if(id===renderId)failCard(error,path);return;}
    if(id!==renderId)return;
    showNotice(page.notice);lemonLink.href=lemonUrl(path);
    const lists=page.main.querySelectorAll(':scope > ul');
    const sections=lists[0]?parseTree(lists[0],resolve,path).filter(n=>n.link):[];
    const twins=lists[1]?[...lists[1].querySelectorAll('li')].map(li=>li.textContent.trim()):[];
    const intro=[...page.main.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean)[0]||'';
    const indexSrc=sections.find(s=>/one page/i.test(s.label))||sections.find(s=>/^repair/i.test(s.label));
    const tiles=sections.filter(s=>!/one page/i.test(s.label));
    const info=s=>/download/i.test(s.label)?['down','Download .zip','Whole manual for offline use. Opens on LEMON.']
      :/labor/i.test(s.label)?['clock','Labor times','How long each job should take.']
      :/parts/i.test(s.label)?['clock','Parts & labor','Part numbers and labor times.']
      :/repair/i.test(s.label)?['wrench','Repair & diagnosis','Procedures, specs, wiring, trouble codes, bulletins.']:['page',s.label,''];
    view.innerHTML=head('Step 04',title,esc(intro))+
      `<div class="mf-filter mf-filter-wide">${icon('search')}<label class="mf-sr" for="mf-ms">Search this manual</label><input id="mf-ms" placeholder="What are you working on? brake pads, P0420…" value="${esc(params.get('s')||'')}" autocomplete="off" spellcheck="false"></div>`+
      topics()+'<div class="mf-ms-out"></div><p class="mf-subhead">Or open a section</p>'+
      `<div class="mf-tiles">${tiles.map((s,i)=>{const [ic,h,p]=info(s);return `<a class="mf-tile" ${linkAttrs(s.link)}><span class="mf-index">${s.link.ext?'↗':String(i+1).padStart(2,'0')+' /'}</span>${icon(ic)}<strong>${esc(h)}</strong><span class="small muted">${esc(p)}</span></a>`;}).join('')}</div>`+
      (twins.length?`<p class="small muted mf-note">Also covers: ${twins.map(t=>`<b>${esc(t)}</b>`).join(', ')}.</p>`:'');
    const box=view.querySelector('#mf-ms'),out=view.querySelector('.mf-ms-out');
    let flat=null,loadingIdx=null;
    const ensureIndex=()=>loadingIdx||=(async()=>{
      if(!indexSrc?.link.route){flat=[];return;}
      out.innerHTML='<div class="mf-loading"><span class="mf-spin"></span>Loading this manual’s full index (one time, a few seconds)…</div>';
      const p=await lemon(indexSrc.link.route);const ul=p.main.querySelector(':scope > ul');
      flat=ul?flatten(parseTree(ul,resolve,indexSrc.link.route)):[];
    })();
    const draw=async()=>{
      const q=box.value.trim();
      view.querySelectorAll('.mf-topics .mf-chip').forEach(c=>c.classList.toggle('on',c.dataset.t===q));
      setParam('s',q);if(!q){out.innerHTML='';return;}
      try{await ensureIndex();}catch{out.innerHTML='<p class="mf-count">The search index could not be loaded. Open “Repair & diagnosis” below instead.</p>';loadingIdx=null;return;}
      if(box.value.trim()!==q)return;
      out.innerHTML=resultsHtml(searchFlat(flat,q),q,flat.length);
    };
    let t;box.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(draw,160);});
    view.querySelector('.mf-topics').addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(b){box.value=b.dataset.t;draw();}});
    if(box.value)draw();
  }
  // Step 5+: listings become a searchable tree; content pages are cleaned and shown here.
  async function renderPage(segs,params,id){
    const path='/'+segs.join('/')+'/';loading('Loading…');
    let page;try{page=await lemon(path);}catch(error){if(id===renderId)failCard(error,path);return;}
    if(id!==renderId)return;
    showNotice(page.notice);lemonLink.href=lemonUrl(path);
    // Work on a copy: the cached page must stay intact for the next visit.
    const main=page.main.cloneNode(true),h1=main.querySelector('h1'),title=h1?h1.textContent.trim():dec(segs[segs.length-1]);
    const vehicle=`${dec(segs[1])} ${dec(segs[0])} ${dec(segs[2])}`;
    const ul=main.querySelector(':scope > ul');
    const loose=[...main.childNodes].filter(n=>n.nodeName!=='UL'&&n.nodeName!=='H1').map(n=>n.textContent).join(' ').trim();
    if(ul&&ul.querySelector('a[href]')&&loose.length<600){
      const nodes=parseTree(ul,resolve,path),flat=flatten(nodes);
      view.innerHTML=head(vehicle,title,esc(loose),filterBox('mf-tf',`Search ${flat.length.toLocaleString()} pages here`,params.get('s')))+(segs.length===4?topics():'')+'<div class="mf-tf-out"></div><ul class="mf-tree"></ul>';
      const tree=view.querySelector('.mf-tree');fillTree(tree,nodes);
      const box=view.querySelector('.mf-tf'),out=view.querySelector('.mf-tf-out');
      const draw=()=>{const q=box.value.trim();setParam('s',q);view.querySelectorAll('.mf-topics .mf-chip').forEach(c=>c.classList.toggle('on',c.dataset.t===q));out.innerHTML=q?resultsHtml(searchFlat(flat,q),q,flat.length):'';tree.hidden=Boolean(q);};
      box.addEventListener('input',draw);
      view.querySelector('.mf-topics')?.addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(b){box.value=b.dataset.t;draw();}});
      if(box.value)draw();
      return;
    }
    h1?.remove();clean(main,path);
    view.innerHTML=head(vehicle,title,'',`<a class="button secondary compact" href="${esc(lemonUrl(path))}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Original ↗</a>`);
    const doc=document.createElement('div');doc.className='mf-doc';
    for(const n of [...main.childNodes])doc.append(document.importNode(n,true));
    view.append(doc);
  }
  function fillTree(ul,nodes){
    for(const n of nodes){
      const li=document.createElement('li');
      if(n.heading)li.innerHTML=`<p class="mf-subhead">${esc(n.heading)}</p>`;
      else if(n.children){
        li.innerHTML=`<button type="button" aria-expanded="false">${icon(ICONS[n.icon]||'folder')}<b>${esc(n.label)}</b><span class="mf-chev">›</span></button>`;
        li.firstChild.addEventListener('click',()=>{
          let sub=li.querySelector(':scope > ul');
          if(!sub){sub=document.createElement('ul');fillTree(sub,n.children);li.append(sub);}else sub.hidden=!sub.hidden;
          li.classList.toggle('open',!sub.hidden);li.firstChild.setAttribute('aria-expanded',String(!sub.hidden));
        });
      }else if(n.link)li.innerHTML=`<a ${linkAttrs(n.link)}>${icon(ICONS[n.icon]||(n.link.ext?'ext':'page'))}${esc(n.label)}</a>`;
      else if(n.text||n.desc)li.innerHTML=`<p class="mf-count">${esc(n.text||n.desc)}</p>`;
      else continue;
      ul.append(li);
    }
  }

  // ---- router ----
  let shown=false;
  function route(){
    const r=parseHash();
    if(!r){if(!shown){shown=true;frame([]);renderMakes(new URLSearchParams());}return;}
    onShow();
    const segs=r.path.split('/').filter(Boolean),id=++renderId;
    showNotice('');frame(segs);
    if(shown)$('.mf-steps').scrollIntoView({behavior:'smooth',block:'start'});
    shown=true;
    if(segs.length===0)return renderMakes(r.params);
    if(segs.length===1)return renderYears(segs,r.params,id);
    if(segs.length===2)return renderModels(segs,r.params,id);
    if(segs.length===3)return renderModelHome(segs,r.params,id);
    return renderPage(segs,r.params,id);
  }
  window.addEventListener('hashchange',route);
  drawGarage();route();

  return {
    // Jump straight to a saved request's vehicle: make/year with the model filter
    // and the VIN's engine size highlighted.
    // Falls back to reading the typed vehicle text ("2015 Ford F-150") when the
    // request has no decoded VIN specifications.
    openVehicle({year,make,model,displacement,text}={}){
      if(!make&&text)({year,make,model}=parseVehicle(text));
      const m=lemonMake(make)||(MAKES.includes(make)?make:null);
      const disp=Number(displacement)>0?Number(displacement).toFixed(1):'';
      location.hash=PREFIX+(m&&/^\d{4}$/.test(String(year))?vehicleRoute({make:m,year:String(year),model:model||'',engine:disp}):m?vehicleRoute({make:m}):'/');
    },
    reset(){pageCache.clear();input.value='';hint.innerHTML='';showNotice('');if(parseHash())history.replaceState(history.state,'',location.pathname+location.search);shown=false;route();}
  };
}
