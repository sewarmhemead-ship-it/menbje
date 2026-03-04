/**
 * Debt Ledger – records receivables with SYP and Gold at tx (for revaluation).
 * Every debt posts: Dr Debtors, Cr Revenue (or Cash if loan).
 */

import { store, getNextId } from '../config/store.js';
import { postDebtJournal } from './transactions.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';

const { debtLedger } = store;

export function recordDebt(amountSYP, opts = {}) {
  const { debtorId, dueDate, memo, isLoan, createdBy } = opts;
  const result = postDebtJournal(amountSYP, {
    refId: null,
    memo: memo || 'Debt / Receivable',
    isLoan: !!isLoan,
    createdBy: createdBy || 'api',
  });
  if (!result.success) return result;

  const rates = multiCurrency.getRates();
  const id = getNextId('debtLedger');
  const entry = {
    id,
    journalEntryId: result.entry?.id,
    debtorId: debtorId || null,
    amountSYP: Number(amountSYP),
    amountGoldAtTx: rates.GOLD != null && rates.GOLD !== 0 ? amountSYP * rates.GOLD : null,
    dueDate: dueDate || null,
    memo,
    createdAt: new Date().toISOString(),
  };
  debtLedger.push(entry);
  return { success: true, entry, journalEntry: result.entry };
}

export function listDebt(filters = {}) {
  let list = [...debtLedger];
  if (filters.debtorId) list = list.filter((e) => e.debtorId === filters.debtorId);
  return list;
}
