import { normalizeVin, validVin } from '../vin-core.js';
let serial=0;
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const names={NHTSACampaignNumber:'Campaign',ReportReceivedDate:'Reported',Component:'Component',Summary:'Summary',Consequence:'Consequence',Remedy:'Remedy',Notes:'Notes',odiNumber:'Complaint number',dateComplaintFiled:'Filed',components:'Components',summary:'Owner report',crash:'Crash reported',fire:'Fire reported',numberOfInjuries:'Reported injuries',numberOfDeaths:'Reported deaths',VehicleDescription:'Configuration',OverallRating:'Overall rating',OverallFrontCrashRating:'Front crash',FrontCrashDriversideRating:'Front · driver',FrontCrashPassengersideRating:'Front · passenger',OverallSideCrashRating:'Side crash',SideCrashDriversideRating:'Side · driver',SideCrashPassengersideRating:'Side · passenger',RolloverRating:'Rollover rating',RolloverPossibility:'Rollover probability',fuelType1:'Primary fuel',fuelType2:'Alternate fuel',city08:'City',highway08:'Highway',comb08:'Combined',cityA08:'Alternate fuel · city',highwayA08:'Alternate fuel · highway',combA08:'Alternate fuel · combined',trany:'Transmission',displ:'Displacement (L)',VClass:'Vehicle class'};
function label(key){return names[key]||key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());}
function facts(values){const dl=node('dl',undefined,'research-facts');for(const [key,value]of Object.entries(values)){dl.append(node('dt',label(key)),node('dd',String(value)));}return dl;}
function link(title,url){const a=node('a',title+' ↗','button secondary compact');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';return a;}
const sources=[
  ['NHTSA VIN decoder','https://vpic.nhtsa.dot.gov/decoder/','Free · manufacturer-reported specifications'],
  ['NHTSA recalls','https://www.nhtsa.gov/recalls','Free · enter the VIN to check unrepaired recalls for this vehicle'],
  ['Check theft / salvage · NICB','https://www.nicb.org/vincheck','Free · participating insurers’ theft and salvage records; five checks per IP address per day. Not a complete history report.'],
  ['NMVTIS approved providers','https://vehiclehistory.bja.ojp.gov/nmvtis_vehiclehistory','Title brands, odometer and salvage records · provider fees generally apply'],
  ['CARFAX reports','https://www.carfax.com/vehicle-history-reports/','Paid provider · report coverage and pricing vary'],
  ['AutoCheck reports','https://www.autocheck.com/vehiclehistory/','Paid provider · report coverage and pricing vary'],
  ['FuelEconomy.gov','https://www.fueleconomy.gov/','Free · compare the correct engine and transmission'],
  ['Vehicle OSINT collection','https://github.com/TheBurnsy/Vehicle-OSINT-Collection','External directory of additional vehicle lookup tools; coverage and access vary']
];

export function mountVehicleResearch(root,{api,vin=''}={}) {
  root.classList.add('vehicle-research');
  const id='research-vin-'+(++serial),form=node('form',undefined,'research-form');
  const caption=node('label','VIN');caption.htmlFor=id;
  const input=node('input');input.id=id;input.name='research-vin';input.value=vin;input.maxLength=24;input.autocomplete='off';input.spellcheck=false;input.placeholder='17-character VIN';
  const load=node('button','Research this vehicle','button');load.type='submit';form.append(caption,input,load);
  const message=node('p','','notice');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const results=node('div',undefined,'research-results');
  const external=node('details',undefined,'research-section');external.append(node('summary','Theft, salvage, title and other checks'));
  external.append(node('p','Theft / salvage: Not checked · Title / accident history: Not checked. Open a provider to perform these checks.','small'));
  external.append(node('p','Copy the VIN, then open a provider. These checks run on that provider’s website.','small muted'));
  const copy=node('button','Copy VIN','button secondary compact');copy.type='button';
  copy.addEventListener('click',async()=>{const value=normalizeVin(input.value);if(!validVin(value)){message.textContent='Enter a complete VIN to copy.';return;}try{await navigator.clipboard.writeText(value);message.textContent='VIN copied. Paste it into the provider’s search.';}catch{input.focus();input.select();message.textContent='Select and copy the VIN above.';}});
  external.append(copy);
  const grid=node('div',undefined,'research-links');for(const [title,url,description]of sources){const card=node('div');card.append(link(title,url),node('p',description,'small muted'));grid.append(card);}external.append(grid);
  const disclosure=node('p','Research sends the VIN to NHTSA for specifications. Model year, make and model are used for NHTSA safety data and EPA fuel-economy options. Customer contact details and service notes are not sent.','small muted');
  root.append(form,disclosure,message,results,external);
  let revision=0;
  function section(title,description){const box=node('details',undefined,'research-section');box.append(node('summary',title),node('p',description,'small muted'));results.append(box);return box;}
  function variants(title,description,kind,result){
    const box=section(title,description);
    if(result?.status!=='ready'){box.append(node('p',result?.message||'No report loaded.'));return;}
    if(!result.data.length){box.append(node('p','No matching configurations were returned by this provider.'));return;}
    const selection=node('select');selection.setAttribute('aria-label',title+' configuration');selection.append(new Option('Choose the matching configuration…',''));
    for(const option of result.data)selection.append(new Option(option.description,option.id));
    const output=node('div');box.append(selection,output);let version=0;
    selection.addEventListener('change',async()=>{const chosen=selection.value,versionNow=++version,run=revision;output.replaceChildren();if(!chosen)return;output.append(node('p','Loading configuration…','small'));
      try{const data=await api('/research/'+kind+'/'+encodeURIComponent(chosen));if(version!==versionNow||run!==revision||!box.isConnected)return;output.replaceChildren(facts(data.values));if(kind==='economy')output.append(node('p',data.values.fuelType1==='Electricity'?'EPA estimates in MPGe for electricity. Alternate-fuel figures use the units for that fuel.':'EPA fuel-economy estimates in MPG. Actual mileage varies.','small muted'));else output.append(node('p','NHTSA ratings run from 1 to 5 stars. “Not Rated” means a score is unavailable.','small muted'));}
      catch(error){if(version===versionNow&&run===revision)output.replaceChildren(node('p',error.message,'notice error'));}
    });
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const value=normalizeVin(input.value);const run=++revision;results.replaceChildren();message.classList.remove('error');
    if(!validVin(value)){message.textContent='Enter a complete 17-character VIN (letters I, O and Q are not used).';return;}
    input.value=value;load.disabled=true;message.textContent='Checking vehicle specifications and public data…';
    try{
      const data=await api('/vehicles/'+encodeURIComponent(value)+'/research');if(run!==revision||!root.isConnected)return;
      results.append(node('h3',data.vehicle||'Vehicle specifications'),node('p','Checked '+new Date(data.checkedAt).toLocaleString(),'small muted'));
      const check=data.checksum;results.append(node('p',check.status==='match'?'VIN check digit matches.':'VIN check digit does not match the North American calculation. Verify the VIN; other markets can use different rules.','small'));
      const specs=section('Manufacturer specifications','Source: NHTSA vPIC. Manufacturer-reported data can omit trim, options, or equipment.');specs.append(facts(Object.fromEntries(data.specifications.map(r=>[r.label,r.value]))));
      if(data.warning){message.textContent=data.warning;message.classList.add('error');return;}
      results.append(facts({Recalls:data.recalls.status==='ready'?data.recalls.data.count+' model-level campaigns':'Provider unavailable',Complaints:data.complaints.status==='ready'?data.complaints.data.count+' model-level reports':'Provider unavailable','Theft / salvage':'Not checked · open NICB below','Title / accident history':'Not checked · open a report provider below'}));
      const recalls=section('Recall campaigns', 'Source: NHTSA · campaigns for this model year, make and model. This does not establish whether this individual VIN is affected or already repaired. Use NHTSA’s VIN check below.');
      if(data.recalls.status==='ready'){const report=data.recalls.data;recalls.append(node('p',report.count+' campaigns returned.'));for(const r of report.items){const entry=node('details');entry.append(node('summary',(r.NHTSACampaignNumber||'Campaign')+' · '+(r.Component||'Details')),facts(r));recalls.append(entry);}if(!report.count)recalls.append(node('p','No model-level campaigns returned. Check the VIN with NHTSA before drawing conclusions.'));}else recalls.append(node('p',data.recalls.message));
      const complaints=section('Reported safety complaints','Source: NHTSA · reports from owners of the same model year, make and model. These are reports, not verified diagnoses or this vehicle’s history.');
      if(data.complaints.status==='ready'){const report=data.complaints.data;complaints.append(node('p',report.count+' reports returned; showing up to 20 most recent.'));for(const r of report.items){const entry=node('details');entry.append(node('summary',(r.dateComplaintFiled||'Reported')+' · '+(r.components||'Complaint')),facts(r));complaints.append(entry);}}else complaints.append(node('p',data.complaints.message));
      variants('Safety ratings','Source: NHTSA NCAP · choose the matching body style and drivetrain; ratings are configuration-based.','safety',data.safety);
      variants('Fuel economy','Source: FuelEconomy.gov / EPA · choose the matching engine, transmission and fuel. A VIN alone does not select an exact EPA configuration.','economy',data.economy);
      message.textContent='Research loaded. Open a section to view its source and results.';
    }catch(error){if(run===revision){message.textContent=error.message;message.classList.add('error');}}
    finally{if(run===revision)load.disabled=false;}
  });
  return {run(){form.requestSubmit();},reset(){revision++;input.value=vin;load.disabled=false;message.textContent='';results.replaceChildren();external.open=false;}};
}
