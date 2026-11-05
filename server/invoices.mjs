// Customer invoices. One invoice per service request, kept in `invoices/<request id>`.
// The owner edits it in the dashboard; the customer sees it through a private link
// (/invoice.html?t=<token>) that the owner texts them. Money is stored in cents and
// every total is recomputed here, so the page cannot send a wrong total.
import { randomBytes, randomUUID } from 'node:crypto';

export const BUSINESS = {
  name:'Swagg Daddys Mobile Mechanics', phone:'205-492-8772', email:'admin@swaggdaddys.com', website:'swaggdaddys.com'
};
export const DEFAULTS = {
  diagnosticFee:6500, freeMiles:30, perMile:200, taxRate:10,
  terms:'Payment is due when the work is completed unless agreed otherwise. Parts carry the manufacturer’s warranty; customer-supplied parts are not covered. Recommended work listed on this invoice was not performed unless it appears in the work completed.'
};
export const STATUSES = ['Draft','Sent','Paid','Void'];
export function invoiceGroup(invoice) {
  if (invoice.status === 'Void') return 'void';
  if (invoice.status === 'Draft') return 'new';
  if (invoice.status === 'Paid' || (invoice.totals.total > 0 && invoice.totals.balance === 0)) return 'paid';
  return 'unpaid';
}
const tokenPattern = /^[a-f0-9]{32}$/;

const str = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max) : '';
const cents = (value, max = 10_000_000_00) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(/[$,\s]/g,''));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n * 100)) : 0;
};
const quantity = (value, max = 10000) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n * 100) / 100) : 0;
};
const rows = (list, limit, map) => (Array.isArray(list) ? list : []).slice(0, limit).map(map).filter(row => row.description || row.amount);

// Mileage fee: the first 30 driving miles are included; each mile after is $2.
export function mileageFee(miles, { freeMiles = DEFAULTS.freeMiles, perMile = DEFAULTS.perMile } = {}) {
  const m = Number(miles);
  if (!Number.isFinite(m) || m <= freeMiles) return 0;
  return Math.round((m - freeMiles) * perMile);
}

export function totals(invoice) {
  const labor = invoice.labor.reduce((sum, row) => sum + row.amount, 0);
  const parts = invoice.parts.reduce((sum, row) => sum + row.amount, 0);
  const fees = invoice.fees.reduce((sum, row) => sum + row.amount, 0);
  const subtotal = labor + parts + fees;
  const discount = Math.min(invoice.discount, subtotal);
  // Sales tax on parts only; repair labor and fees are listed separately and not taxed.
  const tax = Math.round(parts * invoice.taxRate / 100);
  const total = subtotal - discount + tax;
  return { labor, parts, fees, subtotal, discount, tax, total, paid:Math.min(invoice.paid, total), balance:Math.max(0, total - invoice.paid) };
}

// A starting invoice built from the customer's request.
export function draftInvoice(request, now = Date.now()) {
  const specs = request.vehicleSpecs || {};
  return finish({
    status:'Draft', date:new Date(now).toISOString().slice(0,10),
    customer:{ name:request.name && request.name !== 'Name not provided' ? request.name : '', phone:request.phone || '', email:'', address:request.location && request.location !== 'Location not provided' ? request.location : '' },
    vehicle:{ description:[specs.year, specs.make, specs.model, specs.trim].filter(Boolean).join(' ') || (request.vehicle !== 'Vehicle details not provided' ? request.vehicle || '' : ''), vin:request.vin || '', odometer:'' },
    concern:[request.issue, request.details].filter(v => v && v !== 'Service request').join(' — ').slice(0, 1000),
    labor:[], parts:[], fees:[{ description:'Diagnostic fee (includes travel within 30 miles)', amount:DEFAULTS.diagnosticFee }],
    discount:0, taxRate:DEFAULTS.taxRate, paid:0, paymentMethod:'', workPerformed:'', recommendations:'', terms:DEFAULTS.terms
  });
}

function finish(invoice) { return { ...invoice, totals:totals(invoice) }; }

// Owner input -> stored invoice. Unknown fields are dropped and every number is bounded.
export function cleanInvoice(input = {}, previous = {}) {
  const c = input.customer || {}, v = input.vehicle || {};
  return finish({
    number:previous.number, token:previous.token, createdAt:previous.createdAt,
    status:STATUSES.includes(input.status) ? input.status : 'Draft',
    date:/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : new Date().toISOString().slice(0,10),
    customer:{ name:str(c.name,100), phone:str(c.phone,40), email:str(c.email,120), address:str(c.address,200) },
    vehicle:{ description:str(v.description,160), vin:str(v.vin,24).toUpperCase(), odometer:str(v.odometer,20) },
    concern:str(input.concern,1000),
    labor:rows(input.labor, 30, row => { const hours = quantity(row.hours, 200), rate = cents(row.rate, 100000); return { description:str(row.description,200), hours, rate, amount:Math.round(hours * rate) }; }),
    parts:rows(input.parts, 50, row => { const qty = quantity(row.qty, 1000), unit = cents(row.unit, 10000000); return { description:str(row.description,200), partNumber:str(row.partNumber,60), qty, unit, amount:Math.round(qty * unit) }; }),
    fees:rows(input.fees, 10, row => ({ description:str(row.description,200), amount:cents(row.amount, 10000000) })),
    discount:cents(input.discount, 10000000), taxRate:Math.min(20, Math.max(0, Math.round(Number(input.taxRate || 0) * 1000) / 1000 || 0)),
    paid:cents(input.paid, 100000000), paymentMethod:str(input.paymentMethod,60),
    workPerformed:str(input.workPerformed,3000), recommendations:str(input.recommendations,2000), terms:str(input.terms,2000)
  });
}

export function createInvoices({ store, now = Date.now }) {
  async function nextNumber() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await store.get('invoice-counter');
      const year = new Date(now()).getFullYear();
      const next = entry?.value.year === year ? entry.value.next : 1;
      if (await store.put('invoice-counter', { year, next:next + 1 }, entry?.etag)) return `SD-${year}-${String(next).padStart(4,'0')}`;
    }
    throw new Error('Invoice number unavailable');
  }
  const service = {
    async list({ view = 'new', query = '', before = '' } = {}) {
      const keys = await store.keys('invoices/');
      const saved = [];
      // Bound concurrent storage reads; existing request invoices need no migration.
      for (let offset = 0; offset < keys.length; offset += 20) {
        const entries = await Promise.all(keys.slice(offset, offset + 20).map(async key => {
          const entry = await store.get(key);
          if (!entry) return null;
          const invoice = entry.value;
          return { id:key.slice('invoices/'.length), number:invoice.number, status:invoice.status,
            date:invoice.date, createdAt:invoice.createdAt, updatedAt:invoice.updatedAt,
            customer:invoice.customer, vehicle:invoice.vehicle, totals:totals(invoice) };
        }));
        saved.push(...entries.filter(Boolean));
      }
      const counts = { new:0, unpaid:0, paid:0, void:0 };
      for (const invoice of saved) counts[invoiceGroup(invoice)]++;
      const matches = saved.filter(invoice => invoiceGroup(invoice) === view &&
        (!query || [invoice.number, invoice.customer?.name, invoice.customer?.phone, invoice.vehicle?.description, invoice.vehicle?.vin].join(' ').toLowerCase().includes(query.toLowerCase())))
        .sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id));
      const offset = before ? matches.findIndex(invoice => invoice.id === before) + 1 : 0;
      const items = matches.slice(offset, offset + 30);
      return { items, counts, next:offset + items.length < matches.length ? items.at(-1).id : null };
    },
    async read(id) {
      const entry = await store.get('invoices/' + id);
      return entry ? { ...entry.value, id, revision:entry.etag, saved:true } : null;
    },
    draft() { return { ...draftInvoice({}, now()), saved:false }; },
    async create(input) {
      return service.save({ id:String(now()) + '-' + randomUUID() }, input);
    },
    async get(request) {
      const entry = await store.get('invoices/' + request.id);
      return entry ? { ...entry.value, revision:entry.etag, saved:true } : { ...draftInvoice(request, now()), saved:false };
    },
    async save(request, input) {
      const key = 'invoices/' + request.id, entry = await store.get(key);
      if (entry && input.revision !== entry.etag) return { conflict:true };
      const previous = entry?.value || {};
      const invoice = cleanInvoice(input, previous);
      invoice.number ||= await nextNumber();
      invoice.createdAt ||= new Date(now()).toISOString();
      invoice.updatedAt = new Date(now()).toISOString();
      if (!invoice.token) { invoice.token = randomBytes(16).toString('hex'); await store.put('invoice-tokens/' + invoice.token, { id:request.id }); }
      if (!await store.put(key, invoice, entry?.etag)) return { conflict:true };
      return { invoice:{ ...invoice, id:request.id, revision:(await store.get(key)).etag, saved:true } };
    },
    // The customer's view: no internal ids, just the invoice and the business details.
    async byToken(token) {
      if (!tokenPattern.test(token || '')) return null;
      const link = await store.get('invoice-tokens/' + token);
      const entry = link && await store.get('invoices/' + link.value.id);
      if (!entry || entry.value.token !== token || entry.value.status === 'Void') return null;
      const { token:_, revision:__, ...invoice } = entry.value;
      return { ...invoice, business:BUSINESS };
    }
  };
  return service;
}
