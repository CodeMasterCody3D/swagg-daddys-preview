// Owner invoice editor. Opens from a request; fill in labor, parts and fees and the
// invoice preview updates as you type. Save stores it (server recomputes totals),
// Text invoice opens the phone's messages with the customer's private invoice link.
import { renderInvoice, money } from '../invoice-render.js';

const PAYMENT_METHODS = ['Cash','Card','Zelle','Cash App','Venmo','Check'];
const RATE_KEY = 'invoice-labor-rate';
const FREE_MILES = 30, PER_MILE = 200;
const toCents = value => { const n = Number.parseFloat(String(value ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const toQty = value => { const n = Number.parseFloat(String(value ?? '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
const dollars = c => c ? (c / 100).toFixed(2) : '';
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { return null; } }

// Same arithmetic as server/invoices.mjs, for the live preview only.
export function previewTotals(inv) {
  const sum = list => list.reduce((s, r) => s + r.amount, 0);
  const labor = sum(inv.labor), parts = sum(inv.parts), fees = sum(inv.fees), subtotal = labor + parts + fees;
  const discount = Math.min(inv.discount, subtotal), tax = Math.round(parts * inv.taxRate / 100), total = subtotal - discount + tax;
  return { labor, parts, fees, subtotal, discount, tax, total, paid:Math.min(inv.paid, total), balance:Math.max(0, total - inv.paid) };
}
export function mileageRow(miles) {
  const m = Number(miles);
  if (!Number.isFinite(m) || m <= 0) return null;
  const over = Math.max(0, m - FREE_MILES);
  return { description:`Mileage: ${Math.round(m * 10) / 10} mi (first ${FREE_MILES} included, $${(PER_MILE / 100).toFixed(2)}/mi after)`, amount:Math.round(over * PER_MILE) };
}
export function invoiceText(invoice, link) {
  const first = (invoice.customer?.name || '').split(/\s+/)[0];
  const t = invoice.totals || {};
  return [`Hi${first ? ' ' + first : ''}, here's your invoice ${invoice.number || ''} from Swagg Daddys Mobile Mechanics:`.replace(/\s+:/, ':'), link,
    `Total: ${money(t.total)}${t.balance !== t.total ? ` · Balance due: ${money(t.balance)}` : ''}`,
    'Questions? Call or text 205-492-8772. Thank you!'].join('\n');
}
const smsTo = (number, body) => 'sms:' + number + (/iPad|iPhone|iPod/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(body);

export function mountInvoiceEditor({ api }) {
  const dialog = el('dialog', { className:'invoice-dialog', id:'invoice-dialog' });
  dialog.setAttribute('aria-labelledby', 'invoice-title');
  document.body.append(dialog);
  let request = null, invoice = null;
  const milesByRequest = new Map(); // filled by the request screen's "Miles from my location"

  const field = (label, input, cls = '') => { const id = 'inv-' + Math.random().toString(36).slice(2, 9); input.id = id; return el('div', { className:'inv-field ' + cls }, el('label', { htmlFor:id, textContent:label }), input); };
  const input = (value = '', props = {}) => el('input', { value, autocomplete:'off', ...props });
  const area = (value = '', rows = 3) => el('textarea', { value, rows });
  // `list` is read-only as a property; it has to be set as an attribute.
  const withList = (control, id) => { control.setAttribute('list', id); return control; };

  function lineEditor(title, columns, rows, blank, addLabel) {
    const box = el('section', { className:'inv-lines' }, el('h3', { textContent:title }));
    const list = el('div', { className:'inv-line-list' });
    const draw = () => {
      list.replaceChildren(...rows.map((row, index) => {
        const line = el('div', { className:'inv-line' });
        for (const [key, label, props] of columns) {
          const control = input(row[key] ?? '', { placeholder:label, ...props });
          control.setAttribute('aria-label', label);
          control.addEventListener('input', () => { row[key] = control.value; update(); });
          line.append(control);
        }
        const remove = el('button', { type:'button', className:'inv-remove', textContent:'✕' });
        remove.setAttribute('aria-label', 'Remove line');
        remove.addEventListener('click', () => { rows.splice(index, 1); draw(); update(); });
        line.append(remove);
        return line;
      }));
    };
    const add = el('button', { type:'button', className:'button secondary compact', textContent:addLabel });
    add.addEventListener('click', () => { rows.push(blank()); draw(); update(); list.lastElementChild?.querySelector('input')?.focus(); });
    box.append(list, add);
    draw();
    return { box, draw };
  }

  // Editable copy: money as dollar strings while editing.
  let form;
  function toForm(inv) {
    return {
      status:inv.status, date:inv.date, customer:{ ...inv.customer }, vehicle:{ ...inv.vehicle }, concern:inv.concern || '',
      labor:inv.labor.map(r => ({ description:r.description, hours:String(r.hours || ''), rate:dollars(r.rate) })),
      parts:inv.parts.map(r => ({ description:r.description, partNumber:r.partNumber || '', qty:String(r.qty || ''), unit:dollars(r.unit) })),
      fees:inv.fees.map(r => ({ description:r.description, amount:dollars(r.amount) })),
      discount:dollars(inv.discount), taxRate:String(inv.taxRate ?? 10), paid:dollars(inv.paid), paymentMethod:inv.paymentMethod || '',
      workPerformed:inv.workPerformed || '', recommendations:inv.recommendations || '', terms:inv.terms || ''
    };
  }
  function fromForm() {
    const inv = {
      ...form, number:invoice.number,
      labor:form.labor.map(r => { const hours = toQty(r.hours), rate = toCents(r.rate); return { description:r.description.trim(), hours, rate, amount:Math.round(hours * rate) }; }).filter(r => r.description || r.amount),
      parts:form.parts.map(r => { const qty = toQty(r.qty), unit = toCents(r.unit); return { description:r.description.trim(), partNumber:r.partNumber.trim(), qty, unit, amount:Math.round(qty * unit) }; }).filter(r => r.description || r.amount),
      fees:form.fees.map(r => ({ description:r.description.trim(), amount:toCents(r.amount) })).filter(r => r.description || r.amount),
      discount:toCents(form.discount), taxRate:Math.min(20, Math.max(0, Number.parseFloat(form.taxRate) || 0)), paid:toCents(form.paid)
    };
    return { ...inv, totals:previewTotals(inv) };
  }
  // What the server expects: dollars for money fields.
  const payload = () => {
    const inv = fromForm();
    return { ...inv, revision:invoice.revision,
      labor:inv.labor.map(r => ({ ...r, rate:r.rate / 100 })), parts:inv.parts.map(r => ({ ...r, unit:r.unit / 100 })),
      fees:inv.fees.map(r => ({ ...r, amount:r.amount / 100 })), discount:inv.discount / 100, paid:inv.paid / 100 };
  };

  let preview, totalLine, statusLine, textButton, linkRow;
  function update() {
    const inv = fromForm();
    preview.innerHTML = renderInvoice(inv);
    totalLine.textContent = 'Total ' + money(inv.totals.total) + ' · Balance due ' + money(inv.totals.balance);
  }
  const link = () => invoice?.token ? location.origin + '/invoice.html?t=' + invoice.token : '';

  async function save(message = 'Invoice saved.') {
    statusLine.textContent = 'Saving…';
    const rate = form.labor.find(r => r.rate)?.rate; if (rate) store(RATE_KEY, rate);
    try {
      invoice = await api('/requests/' + encodeURIComponent(request.id) + '/invoice', { method:'PUT', body:JSON.stringify(payload()) });
      form.status = invoice.status; build(); statusLine.textContent = message;
      return true;
    } catch (error) { statusLine.textContent = error.message; return false; }
  }

  function build() {
    form ||= toForm(invoice);
    const b = el('div', { className:'inv-editor' });
    const top = el('div', { className:'dialog-top' }, el('p', { className:'eyebrow', textContent:'INVOICE ' + (invoice.number || '· NEW') }));
    const close = el('button', { type:'button', className:'close', textContent:'×' }); close.setAttribute('aria-label', 'Close invoice');
    close.addEventListener('click', () => dialog.close()); top.append(close);
    b.append(top, el('h2', { id:'invoice-title', textContent:'Invoice for ' + (form.customer.name || 'customer') }));

    const bind = (obj, key, control) => { control.addEventListener('input', () => { obj[key] = control.value; update(); }); return control; };
    const status = bind(form, 'status', el('select', {}, ...['Draft','Sent','Paid','Void'].map(s => el('option', { value:s, textContent:s, selected:form.status === s }))));
    const grid = el('div', { className:'inv-grid' },
      field('Status', status), field('Date', bind(form, 'date', input(form.date, { type:'date' }))),
      field('Customer name', bind(form.customer, 'name', input(form.customer.name))), field('Phone', bind(form.customer, 'phone', input(form.customer.phone, { type:'tel' }))),
      field('Email (optional)', bind(form.customer, 'email', input(form.customer.email, { type:'email' }))), field('Service address', bind(form.customer, 'address', input(form.customer.address))),
      field('Vehicle', bind(form.vehicle, 'description', input(form.vehicle.description))), field('VIN', bind(form.vehicle, 'vin', input(form.vehicle.vin))),
      field('Odometer (miles)', bind(form.vehicle, 'odometer', input(form.vehicle.odometer, { inputMode:'numeric' }))),
      field('Customer concern', bind(form, 'concern', area(form.concern, 2)), 'wide'),
      field('Work performed', bind(form, 'workPerformed', area(form.workPerformed, 3)), 'wide'));

    const lastRate = store(RATE_KEY) || '';
    const labor = lineEditor('Labor', [['description','Description'],['hours','Hours',{ inputMode:'decimal', className:'n' }],['rate','Rate $/hr',{ inputMode:'decimal', className:'n' }]], form.labor, () => ({ description:'', hours:'', rate:lastRate }), '+ Add labor');
    const parts = lineEditor('Parts', [['description','Part'],['partNumber','Part no.',{ className:'n' }],['qty','Qty',{ inputMode:'decimal', className:'n' }],['unit','Unit $',{ inputMode:'decimal', className:'n' }]], form.parts, () => ({ description:'', partNumber:'', qty:'1', unit:'' }), '+ Add part');
    const fees = lineEditor('Fees', [['description','Fee'],['amount','Amount $',{ inputMode:'decimal', className:'n' }]], form.fees, () => ({ description:'', amount:'' }), '+ Add fee');
    // Mileage: driving miles from where the mechanic started; first 30 are free, $2/mi after.
    const miles = input(milesByRequest.get(request.id) ?? '', { inputMode:'decimal', placeholder:'Driving miles' });
    const addMiles = el('button', { type:'button', className:'button secondary compact', textContent:'Add mileage fee' });
    addMiles.addEventListener('click', () => {
      const row = mileageRow(miles.value); if (!row) return;
      // One mileage line per invoice: replace any earlier one in place.
      const kept = form.fees.filter(f => !f.description.startsWith('Mileage:'));
      form.fees.splice(0, form.fees.length, ...kept, { description:row.description, amount:dollars(row.amount) || '0.00' });
      fees.draw(); update();
    });
    fees.box.append(el('div', { className:'inv-miles' }, field('Mileage', miles), addMiles));

    const methods = el('datalist', { id:'inv-methods' }, ...PAYMENT_METHODS.map(m => el('option', { value:m })));
    const totalsGrid = el('div', { className:'inv-grid' },
      field('Discount $', bind(form, 'discount', input(form.discount, { inputMode:'decimal' }))), field('Sales tax % (parts only)', bind(form, 'taxRate', input(form.taxRate, { inputMode:'decimal' }))),
      field('Amount paid $', bind(form, 'paid', input(form.paid, { inputMode:'decimal' }))), field('Payment method', bind(form, 'paymentMethod', withList(input(form.paymentMethod), 'inv-methods'))),
      field('Recommended service', bind(form, 'recommendations', area(form.recommendations, 2)), 'wide'), field('Terms', bind(form, 'terms', area(form.terms, 3)), 'wide'), methods);

    totalLine = el('p', { className:'inv-total-line' });
    statusLine = el('p', { className:'small muted inv-status-line' }); statusLine.setAttribute('role', 'status');
    const saveButton = el('button', { type:'button', className:'button', textContent:'Save invoice' });
    saveButton.addEventListener('click', () => void save());
    textButton = el('button', { type:'button', className:'button secondary', textContent:'Text invoice to customer' });
    textButton.addEventListener('click', async () => {
      if (form.status === 'Draft') form.status = 'Sent';
      if (!await save('Invoice saved and marked Sent. Your messages app is opening…')) return;
      const number = (form.customer.phone || request.dialNumber || '').replace(/[^+\d]/g, '');
      if (number.replace(/\D/g, '').length < 7) { statusLine.textContent = 'Add the customer’s phone number to text the invoice.'; return; }
      location.href = smsTo(number, invoiceText(invoice, link()));
    });
    linkRow = el('p', { className:'small muted' });
    if (link()) {
      const open = el('a', { href:link(), target:'_blank', rel:'noopener', textContent:'Open customer invoice page' });
      const copy = el('button', { type:'button', className:'button secondary compact', textContent:'Copy link' });
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link()); statusLine.textContent = 'Invoice link copied.'; } catch { statusLine.textContent = link(); } });
      linkRow.append(open, ' ', copy);
    }
    const actions = el('div', { className:'inv-actions' }, totalLine, el('div', { className:'inv-buttons' }, saveButton, textButton), statusLine, linkRow);
    preview = el('div', { className:'inv-preview' });
    b.append(grid, labor.box, parts.box, fees.box, totalsGrid, actions, el('h3', { className:'inv-preview-title', textContent:'Preview' }), preview);
    dialog.replaceChildren(b);
    update();
  }

  return {
    setMiles(id, value) { milesByRequest.set(id, String(value)); },
    async open(item) {
      request = item; form = null;
      dialog.replaceChildren(el('p', { className:'notice', textContent:'Loading invoice…' }));
      if (!dialog.open) dialog.showModal();
      try { invoice = await api('/requests/' + encodeURIComponent(item.id) + '/invoice'); build(); }
      catch (error) { dialog.replaceChildren(el('p', { className:'notice error', textContent:error.message })); }
    }
  };
}
