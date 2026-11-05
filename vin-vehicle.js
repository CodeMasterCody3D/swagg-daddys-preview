import { normalizeVin, validVin, decodedVehicle } from './vin-core.js';

export async function lookupVinVehicle(vin,{signal}={}) {
  const response=await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/'+encodeURIComponent(vin)+'?format=json',{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('Vehicle lookup is temporarily unavailable.');
  return decodedVehicle((await response.json()).Results?.[0]);
}
// Reader/check-digit success alone is insufficient. Require clean year, make and model.
export async function confirmedVinVehicle(value,lookup=lookupVinVehicle,options={}) {
  const vin=normalizeVin(value);
  if(!validVin(vin))throw new Error('A complete 17-character VIN could not be read.');
  const decoded=await lookup(vin,options);
  const specs=decoded?.specs;
  if(decoded?.clean!==true||!decoded?.complete||!specs?.year||!specs?.make||!specs?.model)
    throw new Error('No confirmed vehicle details were found. Retake the photo or check the VIN.');
  return decoded;
}
