// Fixing VINs that a text reader (or Lens) got slightly wrong, e.g. a C read as 0.
// A fix is only offered when the VIN's own check digit (position 9) works out; the
// caller then confirms it with NHTSA ("does this VIN land a real car?") before using it.
import { normalizeVin, validVin, vinCheckDigit, decodedVehicle } from './vin-core.js';

// Characters printed VIN labels and OCR commonly confuse. VINs never use I, O or Q.
const LOOKALIKE = {
  '0':['D','C','U','8'], D:['0'], C:['0','G'], G:['6','C'], '6':['G','8'], '1':['7','L','T'], '7':['1','T'], L:['1'], T:['1','7'],
  '2':['Z'], Z:['2'], '5':['S','6'], S:['5','8'], '8':['B','3','6','0','S'], B:['8'], '3':['8'], U:['V','0'], V:['U','Y'], Y:['V'],
  E:['F'], F:['E'], M:['N'], N:['M','H'], H:['N'], '4':['A'], A:['4'], K:['X'], X:['K'], P:['R'], R:['P']
};
// Rules every 17-character VIN follows (49 CFR 565): position 9 is the check digit
// (0-9 or X), position 10 (model year) is never U, Z or 0, positions 14-17 are digits.
function allowed(c, i) {
  if (!/[A-HJ-NPR-Z0-9]/.test(c)) return false;
  if (i === 8) return /[0-9X]/.test(c);
  if (i === 9) return !/[UZ0]/.test(c);
  if (i >= 13) return /[0-9]/.test(c);
  return true;
}
const fixImpossible = raw => [...String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[OQ]/g, '0').replace(/I/g, '1')];

// VINs within `maxChanges` lookalike swaps of `raw` that pass the check digit, fewest swaps first.
export function repairVin(raw, { maxChanges = 2, limit = 20 } = {}) {
  const chars = fixImpossible(raw);
  if (chars.length !== 17) return [];
  // Characters that break a fixed rule must change; others may.
  const options = chars.map((c, i) => [c, ...(LOOKALIKE[c] || [])].filter(x => allowed(x, i)));
  // `cost` ranks likelier mix-ups first: earlier entries in LOOKALIKE are commoner.
  const found = new Map();
  const visit = (i, changes, cost, out) => {
    if (found.size >= 400) return;
    if (i === 17) { const vin = out.join(''); if (validVin(vin) && vinCheckDigit(vin).status === 'match' && !found.has(vin)) found.set(vin, { changes, cost }); return; }
    for (const [k, c] of options[i].entries()) {
      const changed = c !== chars[i];
      if (changed && changes >= maxChanges) continue;
      out.push(c); visit(i + 1, changes + (changed ? 1 : 0), cost + (changed ? k : 0), out); out.pop();
    }
  };
  visit(0, 0, 0, []);
  return [...found.entries()].sort((a, b) => a[1].changes - b[1].changes || a[1].cost - b[1].cost).slice(0, limit).map(([vin, { changes }]) => ({ vin, changes }));
}

// Several imperfect readings of the same label -> one reading, character by character.
export function consensusVin(readings) {
  const clean = readings.map(fixImpossible).filter(r => r.length === 17);
  if (clean.length < 2) return null;
  return Array.from({ length:17 }, (_, i) => {
    const counts = new Map();
    for (const r of clean) counts.set(r[i], (counts.get(r[i]) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }).join('');
}

// NHTSA check: a VIN "lands a car" when the decoder returns year, make and model with no error.
const verified = new Map();
export function createVinVerifier({ fetcher = globalThis.fetch } = {}) {
  return async function verify(value) {
    const vin = normalizeVin(value);
    if (!validVin(vin) || vinCheckDigit(vin).status !== 'match') return false;
    if (!verified.has(vin)) verified.set(vin, (async () => {
      try {
        const response = await fetcher('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/' + encodeURIComponent(vin) + '?format=json', { credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(8000) });
        if (!response.ok) return false;
        const decoded = decodedVehicle((await response.json()).Results?.[0]);
        return decoded.complete && decoded.clean;
      } catch { verified.delete(vin); return false; }
    })());
    return verified.get(vin);
  };
}

// Best VIN from a set of uncertain readings, confirmed by `verify` (NHTSA). Order:
// the frame-by-frame consensus, then each reading as read, then likely repairs of
// those. Up to `maxChecks` are checked at once; the first in that order to verify wins.
export async function resolveVin(readings, verify, { maxChecks = 12 } = {}) {
  const asRead = readings.map(raw => ({ raw, vin:fixImpossible(raw).join('') })).filter(r => r.vin.length === 17);
  const together = consensusVin(readings);
  const bases = [...(together ? [{ vin:together, repaired:readings.length > 1 }] : []), ...asRead.map(r => ({ vin:r.vin, repaired:r.vin !== normalizeVin(r.raw) }))];
  const ordered = [], seen = new Set();
  const push = item => { if (!seen.has(item.vin)) { seen.add(item.vin); ordered.push(item); } };
  for (const base of bases) if (vinCheckDigit(base.vin).status === 'match') push(base);
  for (const base of bases) for (const fix of repairVin(base.vin)) push({ vin:fix.vin, repaired:base.repaired || fix.changes > 0 });
  const batch = ordered.slice(0, maxChecks);
  const results = await Promise.all(batch.map(item => verify(item.vin).catch(() => false)));
  const index = results.findIndex(Boolean);
  return index >= 0 ? batch[index] : null;
}
