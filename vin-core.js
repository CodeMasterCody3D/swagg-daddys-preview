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
