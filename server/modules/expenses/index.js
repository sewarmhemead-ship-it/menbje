/**
 * Expense Management (المصاريف): Salaries, Rent, Utilities, etc. Linked to General Ledger.
 */

import { store, getNextId } from '../../config/store.js';
import * as journal from '../../accounting/journal.js';

const { accounts, expenseRecords } = store;
const CASH_SYP = '1010';

/**
 * Record an expense: Dr expense account (e.g. 5400 Salaries, 5500 Rent, 5600 Utilities) Cr Cash.
 */
export function recordExpense({ accountId, amountSYP, memo = '', date = null, createdBy = 'user' }) {
  if (!accountId || amountSYP == null || amountSYP <= 0) {
    return { success: false, error: 'accountId and positive amountSYP required' };
  }
  if (!accounts.has(accountId)) return { success: false, error: 'Account not found' };
  const acc = accounts.get(accountId);
  if (acc.type !== 'expense') return { success: false, error: 'Account must be an expense account' };
  if (!accounts.has(CASH_SYP)) return { success: false, error: 'Cash account 1010 not found' };

  const r = journal.postDoubleEntry(accountId, CASH_SYP, Number(amountSYP), {
    refType: 'expense',
    refId: null,
    memo: memo || acc.name,
    createdBy,
  });
  if (!r.success) return r;

  const record = {
    id: getNextId('expenseRecords'),
    date: date || new Date().toISOString(),
    accountId,
    accountName: acc.name,
    amountSYP: Number(amountSYP),
    memo,
    entryId: r.entry.id,
    createdBy,
  };
  expenseRecords.push(record);
  return { success: true, record, entry: r.entry };
}

export function listExpenses(filters = {}) {
  let list = [...expenseRecords];
  if (filters.accountId) list = list.filter((e) => e.accountId === filters.accountId);
  if (filters.fromDate) list = list.filter((e) => e.date >= filters.fromDate);
  if (filters.toDate) list = list.filter((e) => e.date <= filters.toDate);
  return list.reverse();
}
