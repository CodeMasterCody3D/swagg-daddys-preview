// The invoice document, shared by the customer's page (invoice.html) and the owner's
// live preview (owner/invoice.js). Takes the invoice as stored (money in cents) and
// returns escaped HTML. Styles live in invoice.css.
export const BUSINESS = { name:'Swagg Daddys Mobile Mechanics', phone:'205-492-8772', email:'admin@swaggdaddys.com', website:'swaggdaddys.com' };

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export const money = c => (c < 0 ? '−' : '') + '$' + (Math.abs(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
const qty = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits:2 });
const nl = text => esc(text).replace(/\n/g, '<br>');
function longDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y ? new Date(y, m - 1, d).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
}

function table(title, head, rows) {
  if (!rows.length) return '';
  return `<section class="inv-block"><h3>${title}</h3><table class="inv-table"><thead><tr>${head.map(([label, cls]) => `<th class="${cls || ''}">${label}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></section>`;
}

export function renderInvoice(invoice, { business = BUSINESS, logo = '/assets/swagg-daddys-logo-transparent.webp' } = {}) {
  const t = invoice.totals || {};
  const c = invoice.customer || {}, v = invoice.vehicle || {};
  const status = invoice.status === 'Paid' || (t.total > 0 && t.balance === 0) ? 'Paid' : invoice.status === 'Draft' ? 'Draft' : 'Due';
  const labor = (invoice.labor || []).map(r => `<tr><td>${esc(r.description)}</td><td class="num">${qty(r.hours)}</td><td class="num">${money(r.rate)}</td><td class="num">${money(r.amount)}</td></tr>`);
  const parts = (invoice.parts || []).map(r => `<tr><td>${esc(r.description)}</td><td>${esc(r.partNumber)}</td><td class="num">${qty(r.qty)}</td><td class="num">${money(r.unit)}</td><td class="num">${money(r.amount)}</td></tr>`);
  const fees = (invoice.fees || []).map(r => `<tr><td>${esc(r.description)}</td><td class="num">${money(r.amount)}</td></tr>`);
  const line = (label, value, cls = '') => `<tr class="${cls}"><th>${label}</th><td class="num">${value}</td></tr>`;
  const info = (label, value) => value ? `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>` : '';
  return `<article class="inv inv-${status.toLowerCase()}">
  <header class="inv-head">
    <div class="inv-brand"><img src="${esc(logo)}" alt="" width="132" height="90"><div><strong>${esc(business.name)}</strong><span>Mobile auto repair · We come to you</span>
      <span>${esc(business.phone)}</span><span>${esc(business.email)}</span><span>${esc(business.website)}</span></div></div>
    <div class="inv-title"><h1>Invoice</h1><dl>
      ${info('Invoice no.', invoice.number || 'Not saved yet')}${info('Date', longDate(invoice.date))}${info('Payment due', status === 'Paid' ? 'Paid in full' : 'Upon completion')}
    </dl><span class="inv-status">${status}</span></div>
  </header>
  <section class="inv-parties">
    <div><h3>Bill to</h3><p><strong>${esc(c.name || 'Customer')}</strong>${c.phone ? '<br>' + esc(c.phone) : ''}${c.email ? '<br>' + esc(c.email) : ''}${c.address ? '<br>' + esc(c.address) : ''}</p></div>
    <div><h3>Vehicle</h3><p><strong>${esc(v.description || 'Vehicle')}</strong>${v.vin ? '<br>VIN ' + esc(v.vin) : ''}${v.odometer ? '<br>Odometer ' + esc(v.odometer) + ' mi' : ''}</p></div>
  </section>
  ${invoice.concern ? `<section class="inv-block"><h3>Customer concern</h3><p>${nl(invoice.concern)}</p></section>` : ''}
  ${invoice.workPerformed ? `<section class="inv-block"><h3>Work performed</h3><p>${nl(invoice.workPerformed)}</p></section>` : ''}
  ${table('Labor', [['Description'], ['Hours','num'], ['Rate','num'], ['Amount','num']], labor)}
  ${table('Parts', [['Description'], ['Part no.'], ['Qty','num'], ['Unit price','num'], ['Amount','num']], parts)}
  ${table('Fees', [['Description'], ['Amount','num']], fees)}
  <section class="inv-sum">
    <div class="inv-pay">${invoice.paymentMethod || t.paid ? `<h3>Payment</h3><p>${invoice.paymentMethod ? esc(invoice.paymentMethod) + '<br>' : ''}${t.paid ? 'Received ' + money(t.paid) : ''}</p>` : ''}</div>
    <table class="inv-totals"><tbody>
      ${t.labor ? line('Labor', money(t.labor)) : ''}${t.parts ? line('Parts', money(t.parts)) : ''}${t.fees ? line('Fees', money(t.fees)) : ''}
      ${line('Subtotal', money(t.subtotal))}
      ${t.discount ? line('Discount', '−' + money(t.discount)) : ''}
      ${line(`Sales tax (${qty(invoice.taxRate)}% on parts)`, money(t.tax))}
      ${line('Total', money(t.total), 'inv-total')}
      ${t.paid ? line('Paid', '−' + money(t.paid)) : ''}
      ${line('Balance due', money(t.balance), 'inv-balance')}
    </tbody></table>
  </section>
  ${invoice.recommendations ? `<section class="inv-block"><h3>Recommended service</h3><p>${nl(invoice.recommendations)}</p></section>` : ''}
  ${invoice.terms ? `<section class="inv-block inv-terms"><h3>Terms</h3><p>${nl(invoice.terms)}</p></section>` : ''}
  <section class="inv-sign"><div><span></span>Customer signature</div><div><span></span>Date</div></section>
  <footer class="inv-foot">Thank you for choosing ${esc(business.name)}. Questions about this invoice? Call or text ${esc(business.phone)} or email ${esc(business.email)}.</footer>
</article>`;
}
