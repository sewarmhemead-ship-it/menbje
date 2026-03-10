/**
 * Double-Entry Journal Engine.
 * Every transaction produces at least one Debit and one Credit of equal amount (in base currency SYP).
 * Each line stores: amount in SYP, amount in USD at tx time, amount in Gold at tx time (for valuation).
 */

import { store, getNextId } from '../config/store.js';
import { logEntryDelete as auditLogEntryDelete } from '../audit/actionLog.js';

const { accounts } = store;

const BASE_CURRENCY = 'SYP';

const BALANCE_TOLERANCE = 0.01;

/**
 * صمام أمان التوازن المالي: يتأكد أن مجموع المدين يساوي مجموع الدائن (مع سماح بفرق تقريب برمجي).
 * @param {Array<{ debit?: number, credit?: number }>} lines - مصفوفة أسطر كل منها debit و/أو credit
 * @returns {boolean} - true إذا |مجموع المدين - مجموع الدائن| < 0.01
 */
export function ensureBalance(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const total = lines.reduce((sum, line) => sum + (Number(line.debit) || 0) - (Number(line.credit) || 0), 0);
  return Math.abs(total) < BALANCE_TOLERANCE;
}

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
 * قيد مركب: عدة أسطر (مدين/دائن) في قيد واحد. يتطلب أن مجموع المدين = مجموع الدائن.
 * يُستخدم من مسار الفاتورة (POST /sales/invoice) بعد خصم المخزون عبر التجزئة/FIFO: مدين صندوق أو زبون،
 * دائن إيرادات، مدين COGS، دائن مخزون. مرر amountUSDAtTx لضمان دقة تقارير valuation (أرباح/خسائر الصرف).
 * @param {Array<{ accountId: string, debit: number, credit: number, memo?: string }>} lines
 * @param {Object} opts - { refType, refId, memo, createdBy, amountUSDAtTx? }
 * @returns {{ success: boolean, entry?: object, error?: string }}
 */
export function postCompoundEntry(lines, opts = {}) {
  const { refType = null, refId = null, memo = '', createdBy = 'system', amountUSDAtTx = null } = opts;
  if (!Array.isArray(lines) || lines.length < 2) {
    return { success: false, error: 'يجب إرسال مصفوفة من سطرين على الأقل' };
  }
  const normalized = lines.map((l) => ({
    accountId: l.accountId,
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    memo: l.memo != null ? String(l.memo) : '',
  }));
  if (!ensureBalance(normalized)) {
    const sumDr = normalized.reduce((s, l) => s + l.debit, 0);
    const sumCr = normalized.reduce((s, l) => s + l.credit, 0);
    return { success: false, error: 'القيد غير متوازن: مجموع المدين ' + sumDr + ' ≠ مجموع الدائن ' + sumCr };
  }
  for (const l of normalized) {
    if (!l.accountId || (!l.debit && !l.credit)) continue;
    if (!accounts.has(l.accountId)) {
      return { success: false, error: 'الحساب غير موجود: ' + l.accountId };
    }
  }
  const id = getNextId('journalEntries');
  const at = new Date().toISOString();
  const entry = {
    id,
    date: at,
    compoundLines: normalized,
    refType: refType || null,
    refId: refId || null,
    memo,
    createdBy,
    createdAt: at,
    deleted: false,
  };
  if (amountUSDAtTx != null) entry.amountUSDAtTx = Number(amountUSDAtTx);
  if (!store.journalEntriesList) store.journalEntriesList = [];
  store.journalEntriesList.push(entry);
  return { success: true, entry };
}

/**
 * Get balance of an account (debits - credits) in SYP. Optionally up to a date.
 * Handles both simple (debitAccountId/creditAccountId) and compound (compoundLines) entries.
 */
export function getAccountBalance(accountId, asOfDate = null) {
  const list = store.journalEntriesList || [];
  let debit = 0;
  let credit = 0;
  for (const e of list) {
    if (e.deleted) continue;
    if (asOfDate && e.date > asOfDate) continue;
    if (e.compoundLines) {
      for (const line of e.compoundLines) {
        if (line.accountId === accountId) {
          debit += line.debit || 0;
          credit += line.credit || 0;
        }
      }
    } else {
      if (e.debitAccountId === accountId) debit += e.amountSYP || 0;
      if (e.creditAccountId === accountId) credit += e.amountSYP || 0;
    }
  }
  return { debit, credit, balance: debit - credit };
}

/**
 * جلب الرصيد الموسّع لتدعم تقارير العملة المزدوجة (SYP، USD وقت القيد، ذهب وقت القيد).
 * يُستخدم لتقارير القيمة التاريخية بالدولار والذهب.
 * @param {string} accountId - معرّف الحساب
 * @param {Object} filters - { asOfDate?, fromDate?, toDate? }
 * @returns {{ syp, usd, gold, debit, credit, balance }}
 */
export function getAccountBalanceExtended(accountId, filters = {}) {
  const list = store.journalEntriesList || [];
  const asOfDate = filters.asOfDate ?? null;
  const fromDate = filters.fromDate ?? null;
  const toDate = filters.toDate ?? null;

  let debit = 0;
  let credit = 0;
  let totals = { syp: 0, usd: 0, gold: 0 };

  for (const e of list) {
    if (e.deleted) continue;
    if (asOfDate && e.date > asOfDate) continue;
    if (fromDate && e.date < fromDate) continue;
    if (toDate && e.date > toDate) continue;

    if (e.compoundLines) {
      const totalEntrySYP = e.compoundLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) || 1;
      const amountUSDAtTx = e.amountUSDAtTx != null ? Number(e.amountUSDAtTx) : null;
      const amountGoldAtTx = e.amountGoldAtTx != null ? Number(e.amountGoldAtTx) : null;

      for (const line of e.compoundLines) {
        if (line.accountId !== accountId) continue;
        const lineDebit = Number(line.debit) || 0;
        const lineCredit = Number(line.credit) || 0;
        const lineNet = lineDebit - lineCredit;
        const lineAmount = Math.abs(lineNet);
        debit += lineDebit;
        credit += lineCredit;
        totals.syp += lineNet;

        if (amountUSDAtTx != null && lineAmount > 0) {
          const ratio = lineAmount / totalEntrySYP;
          totals.usd += (lineNet > 0 ? 1 : -1) * amountUSDAtTx * ratio;
        }
        if (amountGoldAtTx != null && lineAmount > 0) {
          const ratio = lineAmount / totalEntrySYP;
          totals.gold += (lineNet > 0 ? 1 : -1) * amountGoldAtTx * ratio;
        }
      }
    } else {
      const amt = Number(e.amountSYP) || 0;
      const usd = e.amountUSDAtTx != null ? Number(e.amountUSDAtTx) : null;
      const gold = e.amountGoldAtTx != null ? Number(e.amountGoldAtTx) : null;

      if (e.debitAccountId === accountId) {
        debit += amt;
        totals.syp += amt;
        if (usd != null) totals.usd += usd;
        if (gold != null) totals.gold += gold;
      }
      if (e.creditAccountId === accountId) {
        credit += amt;
        totals.syp -= amt;
        if (usd != null) totals.usd -= usd;
        if (gold != null) totals.gold -= gold;
      }
    }
  }

  return {
    debit,
    credit,
    balance: debit - credit,
    syp: totals.syp,
    usd: totals.usd,
    gold: totals.gold,
  };
}

/**
 * List journal entries (paginated / filtered by refType or account).
 */
export function listJournalEntries(filters = {}) {
  const list = (store.journalEntriesList || []).filter((e) => !e.deleted);
  let out = [...list].reverse();
  if (filters.refType) out = out.filter((e) => e.refType === filters.refType);
  if (filters.accountId) {
    out = out.filter((e) => {
      if (e.compoundLines) return e.compoundLines.some((l) => l.accountId === filters.accountId);
      return e.debitAccountId === filters.accountId || e.creditAccountId === filters.accountId;
    });
  }
  if (filters.fromDate) out = out.filter((e) => e.date >= filters.fromDate);
  if (filters.toDate) out = out.filter((e) => e.date <= filters.toDate);
  return out.slice(0, filters.limit ?? 100);
}

/**
 * Get a single journal entry by id (for audit drill-down).
 */
export function getJournalEntryById(entryId) {
  const list = store.journalEntriesList || [];
  return list.find((e) => e.id === entryId) || null;
}

/**
 * Last activity date for an account (max date of journal entries touching this account).
 */
export function getAccountLastActivityDate(accountId) {
  const list = (store.journalEntriesList || []).filter((e) => !e.deleted);
  let maxDate = null;
  for (const e of list) {
    let touches = false;
    if (e.compoundLines) touches = e.compoundLines.some((l) => l.accountId === accountId);
    else touches = e.debitAccountId === accountId || e.creditAccountId === accountId;
    if (touches && e.date) {
      if (!maxDate || e.date > maxDate) maxDate = e.date;
    }
  }
  return maxDate;
}

const LOCK_HOURS = 24;

/**
 * Mark an entry as deleted (soft delete). Logs to audit trail.
 * القيد لا يُحذف فعلياً؛ يُعلّم بـ deleted: true. تقارير المحاسبة والتقييم (valuation) تستبعد
 * تلقائياً أي قيد له deleted === true، فلا يُحتسب في ميزان المراجعة ولا في تقرير أرباح/خسائر الصرف.
 * قفل زمني: لا يمكن حذف قيد مضى على إنشائه أكثر من 24 ساعة (ACTION_LOCKED).
 */
export function deleteJournalEntry(entryId, reasonCode, deletedBy = 'system') {
  const list = store.journalEntriesList || [];
  const entry = list.find((e) => e.id === entryId);
  if (!entry) return { success: false, error: 'Entry not found' };
  const entryTime = new Date(entry.createdAt || entry.date).getTime();
  const now = Date.now();
  if (now - entryTime > LOCK_HOURS * 60 * 60 * 1000) {
    return { success: false, error: 'ACTION_LOCKED: لا يمكن تعديل البيانات التاريخية', code: 'ACTION_LOCKED' };
  }
  const snapshot = { ...entry, compoundLines: entry.compoundLines ? [...entry.compoundLines] : undefined };
  auditLogEntryDelete(entryId, reasonCode, deletedBy, snapshot);
  entry.deleted = true;
  entry.deletedAt = new Date().toISOString();
  entry.deletedBy = deletedBy;
  entry.deleteReasonCode = reasonCode;
  return { success: true };
}
