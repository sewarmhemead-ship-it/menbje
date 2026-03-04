/**
 * Double-Entry Journal Engine.
 * Every transaction produces at least one Debit and one Credit of equal amount (in base currency SYP).
 * Each line stores: amount in SYP, amount in USD at tx time, amount in Gold at tx time (for valuation).
 */

import { store, getNextId } from '../config/store.js';
import { logEntryDelete as auditLogEntryDelete } from '../audit/actionLog.js';

const { accounts } = store;

const BASE_CURRENCY = 'SYP';

/**
 * Post a double-entry: one debit and one credit. Amount in SYP (base).
 * valuation: { amountSYP, amountUSDAtTx, amountGoldAtTx } for reporting.
 */
export function postDoubleEntry(
  debitAccountId,
  creditAccountId,
  amountSYP,
  opts = {}
) {
  const {
    refType = null,
    refId = null,
    memo = '',
    amountUSDAtTx = null,
    amountGoldAtTx = null,
    createdBy = 'system',
  } = opts;

  if (!debitAccountId || !creditAccountId || amountSYP == null || amountSYP <= 0) {
    return { success: false, error: 'Invalid debit, credit, or amount' };
  }
  if (!accounts.has(debitAccountId) || !accounts.has(creditAccountId)) {
    return { success: false, error: 'Account not found' };
  }

  const id = getNextId('journalEntries');
  const at = new Date().toISOString();

  const entry = {
    id,
    date: at,
    debitAccountId,
    creditAccountId,
    amountSYP: Number(amountSYP),
    amountUSDAtTx: amountUSDAtTx != null ? Number(amountUSDAtTx) : null,
    amountGoldAtTx: amountGoldAtTx != null ? Number(amountGoldAtTx) : null,
    refType: refType || null,
    refId: refId || null,
    memo,
    createdBy,
    createdAt: at,
    deleted: false,
  };

  if (!store.journalEntriesList) store.journalEntriesList = [];
  store.journalEntriesList.push(entry);

  return { success: true, entry };
}

/**
 * Get balance of an account (debits - credits) in SYP. Optionally up to a date.
 */
export function getAccountBalance(accountId, asOfDate = null) {
  const list = store.journalEntriesList || [];
  let debit = 0;
  let credit = 0;
  for (const e of list) {
    if (e.deleted) continue;
    if (asOfDate && e.date > asOfDate) continue;
    if (e.debitAccountId === accountId) debit += e.amountSYP;
    if (e.creditAccountId === accountId) credit += e.amountSYP;
  }
  return { debit, credit, balance: debit - credit };
}

/**
 * List journal entries (paginated / filtered by refType or account).
 */
export function listJournalEntries(filters = {}) {
  const list = (store.journalEntriesList || []).filter((e) => !e.deleted);
  let out = [...list].reverse();
  if (filters.refType) out = out.filter((e) => e.refType === filters.refType);
  if (filters.accountId)
    out = out.filter(
      (e) => e.debitAccountId === filters.accountId || e.creditAccountId === filters.accountId
    );
  if (filters.fromDate) out = out.filter((e) => e.date >= filters.fromDate);
  if (filters.toDate) out = out.filter((e) => e.date <= filters.toDate);
  return out.slice(0, filters.limit ?? 100);
}

/**
 * Mark an entry as deleted (soft delete). Logs to audit trail.
 */
export function deleteJournalEntry(entryId, reasonCode, deletedBy = 'system') {
  const list = store.journalEntriesList || [];
  const entry = list.find((e) => e.id === entryId);
  if (!entry) return { success: false, error: 'Entry not found' };
  auditLogEntryDelete(entryId, reasonCode, deletedBy);
  entry.deleted = true;
  entry.deletedAt = new Date().toISOString();
  entry.deletedBy = deletedBy;
  entry.deleteReasonCode = reasonCode;
  return { success: true };
}
