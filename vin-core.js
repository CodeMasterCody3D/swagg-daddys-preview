export const normalizeVin = value => String(value || '').toUpperCase().replace(/[\s*\-]/g, '');
export const validVin = value => /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
export function vinCandidates(value) {
  const candidates = new Set();
  // Keep lines separate so surrounding label text cannot become part of a VIN.
  for (const line of String(value).toUpperCase().split(/[\r\n]+/)) {
    const clean = line.replace(/\bVIN\s*[:#]?\s*/g, '').replace(/[\s*\-]/g, ' ');
    for (const token of clean.match(/[A-HJ-NPR-Z0-9]+/g) || []) if (validVin(token)) candidates.add(token);
    const compact = normalizeVin(line.replace(/^\s*VIN\s*[:#]?\s*/,'').trim());
    if (validVin(compact)) candidates.add(compact);
  }
  return [...candidates];
}
// OCR suggestions are never submitted until the customer reviews and confirms them.
export function scannedVins(value, { barcode = false } = {}) {
  const found = new Map();
  const add = (raw, corrected = false) => {
    const vin = normalizeVin(raw);
    if (validVin(vin) && /[0-9]/.test(vin) && !found.has(vin)) found.set(vin,{vin,corrected});
  };
  for (const vin of vinCandidates(value)) add(vin);
  const lines = String(value).toUpperCase().split(/[\r\n]+/);
  for (let line of lines) {
    line = line.replace(/\b(?:VIN|VEHICLE IDENTIFICATION NUMBER)\s*[:#=]?\s*/g,' ');
    const tokens = line.match(/[A-Z0-9]+/g) || [];
    for (let i=0;i<tokens.length;i++) {
      let joined='';
      for (let j=i;j<tokens.length && joined.length<17;j++) {
        joined+=tokens[j];
        if (joined.length!==17 || !/[0-9]/.test(joined)) continue;
        if (validVin(joined)) add(joined);
        else if (!barcode && /^[A-Z0-9]{17}$/.test(joined) && /[IOQ]/.test(joined)) add(joined.replace(/[OQ]/g,'0').replace(/I/g,'1'),true);
      }
      // Automotive data identifiers can precede the VIN inside a barcode.
      if (barcode && /^(?:I|17V)[A-HJ-NPR-Z0-9]{17}$/.test(tokens[i])) add(tokens[i].replace(/^(?:17V|I)/,''));
    }
  }
  // Exact readings take priority over character substitutions, without hiding alternatives.
  return [...found.values()].sort((a,b)=>Number(a.corrected)-Number(b.corrected));
}
export const specFields = {
  year:'ModelYear', make:'Make', model:'Model', trim:'Trim',
  engine:'EngineModel', cylinders:'EngineCylinders', displacement:'DisplacementL',
  fuel:'FuelTypePrimary', transmission:'TransmissionStyle', drive:'DriveType', body:'BodyClass'
};
export function decodedVehicle(row) {
  const specs = {};
  for (const [key, field] of Object.entries(specFields)) {
    const value = String(row?.[field] || '').trim();
    if (value && !/^(not applicable|not available|unknown)$/i.test(value)) specs[key] = value.slice(0,120);
  }
  const complete = Boolean(specs.year && specs.make && specs.model);
  const clean = String(row?.ErrorCode) === '0';
  return { specs, vehicle:[specs.year,specs.make,specs.model,specs.trim].filter(Boolean).join(' '), complete, clean };
}
