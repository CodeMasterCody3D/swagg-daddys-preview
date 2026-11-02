// Driving miles from the owner's current location to the customer's shared GPS,
// for the mileage fee (first 30 miles included, $2/mile after). Uses the free
// OpenStreetMap routing service (OSRM); if it is down, a clearly labeled estimate
// (straight-line distance x 1.25 for roads) is returned instead.
export const FREE_MILES = 30, PER_MILE_CENTS = 200;
const METERS_PER_MILE = 1609.344;

export function parsePoint(value) {
  const match = /^(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)$/.exec(String(value || '').trim());
  if (!match) return null;
  const lat = Number(match[1]), lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
export function straightMiles(a, b) {
  const rad = d => d * Math.PI / 180, r = 3958.7613;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
export function mileageQuote(miles) {
  // Round to a tenth of a mile first, so the fee matches the miles shown (and the invoice line).
  const shown = Math.round(miles * 10) / 10, over = Math.max(0, Math.round((shown - FREE_MILES) * 10) / 10);
  return { miles:shown, overMiles:over, feeCents:Math.round(over * PER_MILE_CENTS) };
}

export async function drivingMiles(from, to, { fetcher = fetch } = {}) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false`;
  try {
    const response = await fetcher(url, { redirect:'error', signal:AbortSignal.timeout(8000), headers:{ 'User-Agent':'SwaggDaddysOwner/1.0 (+https://swaggdaddys.com)' } });
    const data = await response.json();
    const meters = data?.routes?.[0]?.distance;
    if (response.ok && data.code === 'Ok' && Number.isFinite(meters)) return { ...mileageQuote(meters / METERS_PER_MILE), source:'driving' };
  } catch { /* fall through to the estimate */ }
  return { ...mileageQuote(straightMiles(from, to) * 1.25), source:'estimate' };
}
