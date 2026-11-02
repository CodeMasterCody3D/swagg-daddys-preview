// A one-shot permission request. A refusal never triggers another location source.
export function createLocationRequest({ geolocation, onChange = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
  let pending, complete, value = null, attempted = false, generation = 0;
  function request({ retry = false } = {}) {
    if (pending) return pending;
    if (attempted && !retry) return Promise.resolve(value);
    attempted = true; value = null;
    if (!geolocation) { onChange('unavailable', null); return Promise.resolve(null); }
    const run = ++generation;
    let resolve, timer;
    pending = new Promise(done => { resolve = done; });
    const result = pending;
    const finish = (status, coords = null) => {
      if (run !== generation || !pending) return;
      cancel(timer); value = coords; pending = null; complete = null;
      onChange(status, coords); resolve(coords);
    };
    complete = finish;
    onChange('waiting', null);
    // Bound the permission wait as well as the device's GPS acquisition timeout.
    timer = schedule(() => finish('timeout'), 15000);
    try {
      geolocation.getCurrentPosition(position => {
        const { latitude, longitude, accuracy } = position.coords || {};
        if (![latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) { finish('unavailable'); return; }
        finish('shared', { latitude, longitude, accuracy });
      }, error => finish(error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    } catch { finish('unavailable'); }
    return result;
  }
  function reset() {
    complete?.('idle'); generation++; attempted = false; value = null;
    onChange('idle', null);
  }
  return { request, reset };
}

let serviceLocation;
function locationController() {
  if (serviceLocation) return serviceLocation;
  serviceLocation = createLocationRequest({ geolocation: navigator.geolocation, onChange(state, coords) {
    for (const [id, key] of [['latitude', 'latitude'], ['longitude', 'longitude'], ['accuracy', 'accuracy']])
      document.getElementById(id).value = coords ? (key === 'accuracy' ? Math.round(coords[key]) : coords[key].toFixed(6)) : '';
    document.getElementById('location-status').textContent = {
      idle: 'Location has not been shared.', waiting: 'Your browser may ask to share your location. You can allow or decline.',
      denied: 'Location permission was declined. Your request can still send with the city / area you entered.',
      timeout: 'Location took too long. Your request can still send with the city / area you entered.',
      unavailable: 'Location is unavailable. Your request can still send with the city / area you entered.',
      shared: coords ? `Location added (accurate to about ${Math.round(coords.accuracy)} meters).` : ''
    }[state];
  } });
  document.getElementById('service-form').addEventListener('reset', () => serviceLocation.reset());
  return serviceLocation;
}
export function requestServiceLocation(options) { return locationController().request(options); }
