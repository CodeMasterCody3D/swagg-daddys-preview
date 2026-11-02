import { scanVinBarcodes, scanVinText } from './vin-scan.js';
import { scanWithGoogle } from './vin-lens.js';
import { normalizeVin, vinCheckDigit } from './vin-core.js';
import { createVinVerifier, resolveVin } from './vin-repair.js';

// Barcode, Google Lens and printed-text reading all start at once; the first usable
// VIN wins. A barcode VIN is used as soon as it is read. A Lens VIN with a correct
// check digit is used straight away. Printed text (and any reading that needs a
// character fixed, such as C read as 0) is used only once NHTSA confirms the VIN
// belongs to a real vehicle. If nothing qualifies, the readers' results are returned
// in the old order (Lens, then text, then barcode) for the customer to review.
export async function readVinPhoto(source,{googleAvailable=false,verify=createVinVerifier(),...options}={},readers={}) {
  const readBarcodes=readers.barcode || scanVinBarcodes;
  const readGoogle=readers.google || scanWithGoogle;
  const readText=readers.text || scanVinText;
  return new Promise((resolve,reject)=>{
    let settled=false,pending=3,barcode=null,google=null,text=null,googleError=null,textError=null;
    const merge=result=>({...result,warnings:[...(barcode?.warnings||[]),...(result.warnings||[])],...(barcode&&result!==barcode?{barcodeCheck:barcode.diagnostics}:{})});
    const win=result=>{if(!settled){settled=true;resolve(result===barcode?barcode:merge(result));}};
    const finished=()=>{
      if(--pending>0||settled)return;
      if(google?.candidates?.length)return win(google);
      if(text?.candidates?.length)return win(text);
      if(googleError){if(barcode)googleError.barcodeCheck=barcode.diagnostics;settled=true;return reject(googleError);}
      if(text)return win(text);
      if(barcode)return win(barcode);
      settled=true;reject(textError||new Error('The VIN could not be read from this photo. Try a clearer photo or type the VIN.'));
    };
    // A reader result becomes the answer if its VIN is trustworthy, or can be fixed and confirmed.
    async function consider(result,{trustCheckDigit}){
      const vins=(result?.candidates||[]).map(c=>normalizeVin(c.vin)).filter(Boolean);
      if(!vins.length||settled)return;
      const exact=vins.find(v=>vinCheckDigit(v).status==='match');
      if(exact&&(trustCheckDigit||await verify(exact).catch(()=>false)))return win({...result,candidates:[{...result.candidates.find(c=>normalizeVin(c.vin)===exact),vin:exact}]});
      if(settled)return;
      const fixed=await resolveVin(vins,verify).catch(()=>null);
      if(fixed)win({...result,candidates:[{vin:fixed.vin,corrected:fixed.repaired,verified:true}]});
    }
    Promise.resolve().then(()=>readBarcodes(source,options)).then(result=>{
      barcode=result;
      if(result.candidates.length)return win(result);
      options.progress?.('No complete VIN barcode yet. Google Lens and printed-text reading are already working on it…');
    },error=>{barcode={candidates:[],warnings:[error.message||'The barcode reader was unavailable.'],diagnostics:error.diagnostics};}).finally(finished);
    Promise.resolve(googleAvailable).then(use=>use?readGoogle(source,options):null)
      .then(async result=>{google=result;if(result)await consider(result,{trustCheckDigit:true});},error=>{googleError=error;})
      .finally(finished);
    Promise.resolve().then(()=>readText(source,options))
      .then(async result=>{text=result;await consider(result,{trustCheckDigit:false});},error=>{textError=error;})
      .finally(finished);
  });
}
