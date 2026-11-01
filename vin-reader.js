import { scanVinBarcodes, scanVinText } from './vin-scan.js';
import { scanWithGoogle } from './vin-lens.js';

// A complete barcode VIN always wins. Only a barcode miss can send the image
// to Google; keep ambiguous barcode candidates available for customer review.
export async function readVinPhoto(source,{googleAvailable=false,...options}={},readers={}) {
  const readBarcodes=readers.barcode || scanVinBarcodes;
  const readGoogle=readers.google || scanWithGoogle;
  const readText=readers.text || scanVinText;
  const barcode=await readBarcodes(source,options);
  if(barcode.candidates.length)return barcode;
  const useGoogle=await googleAvailable;
  options.progress?.(useGoogle?'No complete VIN barcode found. Switching to Google Lens…':'No complete VIN barcode found. Reading printed text on your device…');
  try {
    const result=await (useGoogle?readGoogle(source,options):readText(source,options));
    return {...result,warnings:[...barcode.warnings,...result.warnings],barcodeCheck:barcode.diagnostics};
  } catch(error) {
    if(error&&typeof error==='object')error.barcodeCheck=barcode.diagnostics;
    throw error;
  }
}
