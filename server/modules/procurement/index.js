/**
 * Procurement Module (المشتريات): Purchase Invoice & Purchase Return.
 * All post to central journalEntriesList and stockMovements.
 */

import { store, getNextId } from '../../config/store.js';
import * as journal from '../../accounting/journal.js';
import * as fifo from '../../inventory/fifo.js';
import * as fractioning from '../fractioning/engine.js';
import { recordStockMovement } from '../../inventory/stockMovement.js';
import * as multiCurrency from '../multiCurrency/index.js'; // same level as procurement

const { accounts, inventoryByProduct, purchaseInvoices, purchaseReturns } = store;

const INVENTORY = '1100';
const CASH_SYP = '1010';
const CREDITORS = '2010';

function getInventoryKey(productId, unitId) {
  return `${productId}:${unitId}`;
}

function getValuationAtTx(amountSYP) {
  const rates = multiCurrency.getRates();
  return {
    amountUSDAtTx: rates.SYP != null && rates.SYP !== 0 ? amountSYP * rates.SYP : null,
    amountGoldAtTx: rates.GOLD != null && rates.GOLD !== 0 ? amountSYP * rates.GOLD : null,
  };
}

/**
 * Purchase Invoice (فاتورة مشتريات): INCREASE stock, update supplier/cash.
 * items: [{ productId, unitId, quantity, unitCostSYP }]
 * payWithCash: true = Dr Inventory Cr Cash; false = Dr Inventory Cr Creditors (supplier balance).
 */
export function postPurchaseInvoice({ items = [], supplierId = null, payWithCash = false, memo = '', invoiceDate, dueDate, createdBy = 'user' }) {
  if (!items.length) return { success: false, error: 'items required' };
  let totalSYP = 0;
  const movements = [];
  const invoiceId = 'pinv-' + Date.now();
  const docDate = invoiceDate && /^\d{4}-\d{2}-\d{2}/.test(String(invoiceDate).trim()) ? new Date(invoiceDate.trim()).toISOString() : new Date().toISOString();

  for (const line of items) {
    const { productId, unitId, quantity, unitCostSYP } = line;
    const u = unitId || 'piece';
    const qty = Number(quantity) || 0;
    const cost = Number(unitCostSYP) || 0;
    if (!productId || qty <= 0) return { success: false, error: 'Invalid line: productId and positive quantity required' };
    totalSYP += qty * cost;

    fifo.receiveLot(productId, u, qty, cost);
    const mov = recordStockMovement(productId, u, qty, 'in', 'purchase', invoiceId);
    movements.push(mov);
  }

  const creditAccountId = payWithCash ? CASH_SYP : CREDITORS;
  if (!accounts.has(creditAccountId)) return { success: false, error: 'Account not found' };
  const v = getValuationAtTx(totalSYP);
  const r = journal.postDoubleEntry(INVENTORY, creditAccountId, totalSYP, {
    refType: 'purchase_invoice',
    refId: invoiceId,
    memo: memo || 'فاتورة مشتريات',
    amountUSDAtTx: v.amountUSDAtTx,
    amountGoldAtTx: v.amountGoldAtTx,
    createdBy,
  });
  if (!r.success) return r;

  const doc = {
    id: invoiceId,
    date: docDate,
    items,
    totalSYP,
    supplierId,
    payWithCash,
    memo: memo != null ? String(memo).trim() : '',
    dueDate: dueDate && /^\d{4}-\d{2}-\d{2}/.test(String(dueDate).trim()) ? String(dueDate).trim() : null,
    entryIds: [r.entry.id],
    movements: movements.map((m) => m.id),
    createdBy,
  };
  purchaseInvoices.push(doc);
  return { success: true, invoice: doc, entry: r.entry, movements };
}

/**
 * Purchase Return (مرتجع مشتريات): DECREASE stock (FIFO), Dr Creditors (or Cash) Cr Inventory.
 * items: [{ productId, unitId, quantity, unitCostSYP }] (cost for journal amount).
 */
export function postPurchaseReturn({ items = [], supplierId = null, receiveCash = false, memo = '', createdBy = 'user' }) {
  if (!items.length) return { success: false, error: 'items required' };
  let totalSYP = 0;

  for (const line of items) {
    const { productId, unitId, quantity, unitCostSYP } = line;
    const u = unitId || 'piece';
    const qty = Number(quantity) || 0;
    const cost = Number(unitCostSYP) || 0;
    if (!productId || qty <= 0) return { success: false, error: 'Invalid line' };
    const inv = fractioning.getEffectiveInventory(productId, u);
    const available = inv?.quantity ?? 0;
    if (available < qty) return { success: false, error: 'Insufficient stock to return', productId, unitId: u, required: qty, available };
    totalSYP += qty * cost;
  }

  const returnId = 'pret-' + Date.now();
  const movements = [];
  for (const line of items) {
    const { productId, unitId, quantity } = line;
    const u = unitId || 'piece';
    const qty = Number(quantity) || 0;
    const consumed = fifo.consumeFIFO(productId, u, qty);
    if (consumed.consumed < qty) return { success: false, error: consumed.error || 'Insufficient FIFO to return', productId, unitId: u };
    const mov = recordStockMovement(productId, u, qty, 'out', 'purchase_return', returnId);
    movements.push(mov);
  }

  const debitAccountId = receiveCash ? CASH_SYP : CREDITORS;
  if (!accounts.has(debitAccountId)) return { success: false, error: 'Account not found' };
  const v = getValuationAtTx(totalSYP);
  const r = journal.postDoubleEntry(debitAccountId, INVENTORY, totalSYP, {
    refType: 'purchase_return',
    refId: returnId,
    memo: memo || 'مرتجع مشتريات',
    amountUSDAtTx: v.amountUSDAtTx,
    amountGoldAtTx: v.amountGoldAtTx,
    createdBy,
  });
  if (!r.success) return r;

  const doc = {
    id: returnId,
    date: new Date().toISOString(),
    items,
    totalSYP,
    supplierId,
    receiveCash,
    entryIds: [r.entry.id],
    movements: movements.map((m) => m.id),
    createdBy,
  };
  purchaseReturns.push(doc);
  return { success: true, return: doc, entry: r.entry, movements };
}

export function listPurchaseInvoices(filters = {}) {
  let list = [...purchaseInvoices];
  if (filters.supplierId) list = list.filter((p) => p.supplierId === filters.supplierId);
  if (filters.fromDate) list = list.filter((p) => p.date >= filters.fromDate);
  if (filters.toDate) list = list.filter((p) => p.date <= filters.toDate);
  return list.reverse();
}

export function listPurchaseReturns(filters = {}) {
  let list = [...purchaseReturns];
  if (filters.supplierId) list = list.filter((p) => p.supplierId === filters.supplierId);
  if (filters.fromDate) list = list.filter((p) => p.date >= filters.fromDate);
  if (filters.toDate) list = list.filter((p) => p.date <= filters.toDate);
  return list.reverse();
}
