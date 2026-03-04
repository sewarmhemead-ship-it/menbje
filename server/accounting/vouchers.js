/**
 * السندات: سند قبض، سند دفع، سند قيد، سند تحويل عملات.
 * Each voucher posts one or more double-entry lines (journal).
 */

import { store, getNextId } from '../config/store.js';
import * as journal from './journal.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';

const { accounts, vouchers } = store;

const CASH_SYP = '1010';
const CASH_USD = '1020';
const GOLD_RESERVE = '1030';

function getValuationAtTx(amountSYP) {
  const rates = multiCurrency.getRates();
  return {
    amountUSDAtTx: rates.SYP != null && rates.SYP !== 0 ? amountSYP * rates.SYP : null,
    amountGoldAtTx: rates.GOLD != null && rates.GOLD !== 0 ? amountSYP * rates.GOLD : null,
  };
}

/**
 * سند قبض: زيادة الصندوق (أو البنك) وخصم من المدينين أو إيراد.
 * debitAccountId = صندوق (1010/1020), creditAccountId = عميل أو إيراد.
 */
export function postReceiptVoucher({ cashAccountId = CASH_SYP, creditAccountId, amountSYP, memo = '', createdBy = 'user' }) {
  if (!amountSYP || amountSYP <= 0) return { success: false, error: 'المبلغ غير صالح' };
  if (!accounts.has(cashAccountId) || !accounts.has(creditAccountId))
    return { success: false, error: 'الحساب غير موجود' };

  const v = getValuationAtTx(amountSYP);
  const r = journal.postDoubleEntry(cashAccountId, creditAccountId, amountSYP, {
    refType: 'voucher_receipt',
    memo,
    amountUSDAtTx: v.amountUSDAtTx,
    amountGoldAtTx: v.amountGoldAtTx,
    createdBy,
  });
  if (!r.success) return r;

  const id = getNextId('vouchers');
  const doc = {
    id,
    type: 'receipt',
    date: new Date().toISOString(),
    amountSYP: Number(amountSYP),
    debitAccountId: cashAccountId,
    creditAccountId,
    memo,
    entryIds: [r.entry.id],
    createdBy,
  };
  vouchers.push(doc);
  return { success: true, voucher: doc, entry: r.entry };
}

/**
 * سند دفع: خصم من الصندوق وزيادة دائن (مورد أو مصروف).
 */
export function postPaymentVoucher({ creditAccountId = CASH_SYP, debitAccountId, amountSYP, memo = '', createdBy = 'user' }) {
  if (!amountSYP || amountSYP <= 0) return { success: false, error: 'المبلغ غير صالح' };
  if (!accounts.has(debitAccountId) || !accounts.has(creditAccountId))
    return { success: false, error: 'الحساب غير موجود' };

  const v = getValuationAtTx(amountSYP);
  const r = journal.postDoubleEntry(debitAccountId, creditAccountId, amountSYP, {
    refType: 'voucher_payment',
    memo,
    amountUSDAtTx: v.amountUSDAtTx,
    amountGoldAtTx: v.amountGoldAtTx,
    createdBy,
  });
  if (!r.success) return r;

  const id = getNextId('vouchers');
  const doc = {
    id,
    type: 'payment',
    date: new Date().toISOString(),
    amountSYP: Number(amountSYP),
    debitAccountId,
    creditAccountId,
    memo,
    entryIds: [r.entry.id],
    createdBy,
  };
  vouchers.push(doc);
  return { success: true, voucher: doc, entry: r.entry };
}

/**
 * سند قيد: قيد مركب (عدة مدين ودائن) يجب أن يتوازن.
 * lines: [{ accountId, debit, credit, memo }] — كل مبلغ إما مدين أو دائن.
 */
export function postJournalVoucher({ lines = [], date = null, createdBy = 'user' }) {
  let totalDebit = 0, totalCredit = 0;
  const valid = lines.filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
  for (const l of valid) {
    const d = Number(l.debit) || 0;
    const c = Number(l.credit) || 0;
    if (d && c) return { success: false, error: 'السطر يجب أن يكون إما مدين أو دائن فقط' };
    totalDebit += d;
    totalCredit += c;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    return { success: false, error: 'القيد غير متوازن. مدين = ' + totalDebit + '، دائن = ' + totalCredit };

  const at = date || new Date().toISOString();
  const debits = valid.filter((l) => (Number(l.debit) || 0) > 0).map((l) => ({ accountId: l.accountId, amount: Number(l.debit), memo: l.memo || '' }));
  const credits = valid.filter((l) => (Number(l.credit) || 0) > 0).map((l) => ({ accountId: l.accountId, amount: Number(l.credit), memo: l.memo || '' }));
  if (debits.length === 0 || credits.length === 0) return { success: false, error: 'يجب وجود مدين ودائن' };

  const entries = [];
  let i = 0, j = 0;
  let dRem = debits[i]?.amount || 0, cRem = credits[j]?.amount || 0;
  let dAcc = debits[i]?.accountId, cAcc = credits[j]?.accountId;
  while (dRem > 0.01 || cRem > 0.01) {
    const amt = Math.min(dRem, cRem);
    if (amt <= 0) break;
    const r = journal.postDoubleEntry(dAcc, cAcc, amt, {
      refType: 'voucher_journal',
      memo: debits[i]?.memo || credits[j]?.memo || '',
      createdBy,
    });
    if (!r.success) return r;
    entries.push(r.entry);
    dRem -= amt;
    cRem -= amt;
    if (dRem < 0.01 && i < debits.length - 1) { i++; dRem = debits[i].amount; dAcc = debits[i].accountId; }
    if (cRem < 0.01 && j < credits.length - 1) { j++; cRem = credits[j].amount; cAcc = credits[j].accountId; }
  }

  const id = getNextId('vouchers');
  const doc = {
    id,
    type: 'journal',
    date: at,
    amountSYP: totalDebit,
    lines: valid,
    entryIds: entries.map((e) => e.id),
    createdBy,
  };
  vouchers.push(doc);
  return { success: true, voucher: doc, entries };
}

/**
 * سند تحويل عملات: صرف من عملة إلى أخرى (مثلاً SYP → USD).
 * fromAccountId: الحساب الذي ينقص (مثلاً صندوق ل.س)، toAccountId: الذي يزيد (صندوق دولار).
 * amountInFromCurrency: المبلغ بالعملة المصدر. rateToSYP: سعر وحدة العملة المصدر بالل.س (مثلاً 1 USD = 15000 SYP → 15000).
 */
export function postTransferVoucher({ fromAccountId, toAccountId, amountInFromCurrency, rateToSYP, memo = '', createdBy = 'user' }) {
  if (!fromAccountId || !toAccountId || !amountInFromCurrency || amountInFromCurrency <= 0 || !rateToSYP || rateToSYP <= 0)
    return { success: false, error: 'بيانات التحويل غير مكتملة' };
  const amountSYP = amountInFromCurrency * rateToSYP;
  if (!accounts.has(fromAccountId) || !accounts.has(toAccountId))
    return { success: false, error: 'الحساب غير موجود' };

  const v = getValuationAtTx(amountSYP);
  const r = journal.postDoubleEntry(toAccountId, fromAccountId, amountSYP, {
    refType: 'voucher_transfer',
    memo: memo || 'تحويل عملات',
    amountUSDAtTx: v.amountUSDAtTx,
    amountGoldAtTx: v.amountGoldAtTx,
    createdBy,
  });
  if (!r.success) return r;

  const id = getNextId('vouchers');
  const doc = {
    id,
    type: 'transfer',
    date: new Date().toISOString(),
    amountSYP,
    amountInFromCurrency,
    rateToSYP,
    fromAccountId,
    toAccountId,
    memo,
    entryIds: [r.entry.id],
    createdBy,
  };
  vouchers.push(doc);
  return { success: true, voucher: doc, entry: r.entry };
}

export function listVouchers(filters = {}) {
  let list = [...vouchers];
  if (filters.type) list = list.filter((v) => v.type === filters.type);
  if (filters.fromDate) list = list.filter((v) => v.date >= filters.fromDate);
  if (filters.toDate) list = list.filter((v) => v.date <= filters.toDate);
  return list.reverse();
}
