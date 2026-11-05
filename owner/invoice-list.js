import { money } from '../invoice-render.js';

const names = { new:'New', unpaid:'Unpaid', paid:'Paid', void:'Voided' };
const empty = { new:'No new invoices. Create an invoice here or from a service request.', unpaid:'No unpaid invoices.', paid:'No paid invoices yet.', void:'No voided invoices.' };
const node = (tag, text, className = '') => Object.assign(document.createElement(tag), { textContent:text, className });

export function mountInvoiceList({ api, editor }) {
  const $ = id => document.getElementById(id);
  let view = 'new', entries = [], next = null, generation = 0, timer, visible = false;
  function status(message, error = false) {
    $('invoice-list-notice').textContent = message;
    $('invoice-list-notice').classList.toggle('error', error);
  }
  function render() {
    $('invoice-list').replaceChildren(...entries.map(invoice => {
      const card = node('article', '', 'customer invoice-card');
      const top = node('div', '', 'customer-heading');
      const open = node('button', invoice.number || 'New invoice', 'customer-name');
      open.type = 'button'; open.addEventListener('click', () => editor.openSaved(invoice.id));
      top.append(open, node('span', invoice.status, 'badge'));
      const amounts = node('div', '', 'invoice-amounts');
      amounts.append(node('span', 'Total ' + money(invoice.totals.total)), node('strong', 'Balance ' + money(invoice.totals.balance)));
      const bottom = node('div', '', 'customer-bottom');
      const date = new Date(invoice.createdAt);
      bottom.append(node('span', Number.isNaN(date.getTime()) ? invoice.date : date.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }), 'small'));
      const edit = node('button', 'Open invoice', 'button secondary compact');
      edit.type = 'button'; edit.addEventListener('click', () => editor.openSaved(invoice.id)); bottom.append(edit);
      card.append(top, node('h3', invoice.customer?.name || 'Customer not entered'), node('p', invoice.vehicle?.description || 'Vehicle not entered'));
      if (invoice.customer?.phone) card.append(node('p', invoice.customer.phone));
      if (invoice.vehicle?.vin) card.append(node('p', 'VIN ' + invoice.vehicle.vin, 'invoice-vin'));
      card.append(amounts, bottom); return card;
    }));
    $('invoice-empty').hidden = entries.length > 0;
    $('invoice-empty').textContent = $('invoice-search').value.trim() ? 'No ' + names[view].toLowerCase() + ' invoices match your search.' : empty[view];
    $('invoice-more').hidden = !next;
  }
  async function load(older = false) {
    const current = ++generation;
    if (!older) { entries = []; next = null; $('invoice-list').replaceChildren(); }
    $('invoice-empty').hidden = true;
    $('invoice-refresh').disabled = true; $('invoice-more').disabled = true;
    status('Loading invoices…');
    const params = new URLSearchParams({ view, q:$('invoice-search').value.trim() });
    if (older && next) params.set('before', next);
    try {
      const data = await api('/invoices?' + params);
      if (current !== generation) return;
      entries = older ? [...new Map([...entries, ...data.items].map(item => [item.id, item])).values()] : data.items;
      next = data.next;
      for (const [name, count] of Object.entries(data.counts)) $('invoice-filters').querySelector('[data-count="' + name + '"]').textContent = count;
      render(); status('');
    } catch (error) { if (current === generation) status(error.message, true); }
    finally { if (current === generation) { $('invoice-refresh').disabled = false; $('invoice-more').disabled = false; } }
  }
  for (const button of $('invoice-filters').querySelectorAll('[data-view]')) button.addEventListener('click', () => {
    clearTimeout(timer); view = button.dataset.view;
    for (const filter of $('invoice-filters').querySelectorAll('[data-view]')) {
      const selected = filter === button;
      filter.setAttribute('aria-pressed', String(selected)); filter.classList.toggle('secondary', !selected);
    }
    void load();
  });
  $('invoice-search').addEventListener('input', () => { clearTimeout(timer); generation++; timer = setTimeout(() => void load(), 250); });
  $('invoice-refresh').addEventListener('click', () => { clearTimeout(timer); void load(); });
  $('invoice-more').addEventListener('click', () => void load(true));
  $('invoice-create').addEventListener('click', () => editor.create());
  return {
    show() { visible = true; clearTimeout(timer); void load(); },
    hide() { visible = false; clearTimeout(timer); generation++; },
    saved() { if (visible) void load(); },
    reset() {
      this.hide(); entries = []; next = null; $('invoice-list').replaceChildren(); $('invoice-search').value = '';
      $('invoice-empty').hidden = true; $('invoice-more').hidden = true; status('');
      for (const count of $('invoice-filters').querySelectorAll('[data-count]')) count.textContent = '0';
    }
  };
}
