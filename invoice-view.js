// Customer invoice page: /invoice.html?t=<token> (the link the owner texts).
import { renderInvoice } from './invoice-render.js';
const root = document.getElementById('invoice');
const token = new URLSearchParams(location.search).get('t') || '';
const say = message => { root.innerHTML = ''; const p = document.createElement('p'); p.className = 'message'; p.textContent = message; root.append(p); };
(async () => {
  if (!/^[a-f0-9]{32}$/.test(token)) return say('This invoice link is incomplete. Please use the link from your text message, or call 205-492-8772.');
  try {
    const response = await fetch('/api/invoice/' + token, { cache:'no-store', credentials:'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return say(data.error || 'This invoice could not be loaded. Please call or text 205-492-8772.');
    root.innerHTML = renderInvoice(data, { business:data.business });
    document.title = 'Invoice ' + (data.number || '') + ' · Swagg Daddys Mobile Mechanics';
    const print = document.getElementById('print'); print.hidden = false; print.addEventListener('click', () => window.print());
  } catch { say('Please check your connection and reload, or call 205-492-8772.'); }
})();
