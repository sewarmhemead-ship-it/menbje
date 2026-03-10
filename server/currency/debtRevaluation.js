/**
 * إعادة تقييم الديون (حساب 1200) عند تحديث سعر الصرف.
 * يجلب القيود التي تحتوي amountUSDAtTx وتمس المدينين، يحسب الفارق، ويرحّل قيد تعديل (REVALUATION).
 * يسجّل العملية في actionLog للتدقيق.
 */

import { store, getNextId } from '../config/store.js';
import * as journal from '../accounting/journal.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';
import { log, REASON_CODES } from '../audit/actionLog.js';

const { journalEntriesList, accounts } = store;

const DEBTORS = '1200';
const REVALUATION_GAIN = '4120';
const EXCHANGE_LOSS = '5200';

const TOLERANCE = 0.01;

function round2(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Number(Number(value).toFixed(2));
}

/**
 * استخراج صافي مساهمة قيد في حساب 1200 (مدين - دائن).
 */
function getEntry1200Net(entry) {
  let net = 0;
  if (entry.compoundLines) {
    for (const line of entry.compoundLines) {
      if (line.accountId === DEBTORS) net += (line.debit || 0) - (line.credit || 0);
    }
  } else {
    if (entry.debitAccountId === DEBTORS) net += entry.amountSYP || 0;
    if (entry.creditAccountId === DEBTORS) net -= entry.amountSYP || 0;
  }
  return net;
}

/**
 * هل القيد يمس 1200 وله قيمة دولار وقت القيد؟
 */
function entryTouches1200WithUSD(entry) {
  if (entry.deleted) return false;
  const has1200 = entry.compoundLines
    ? entry.compoundLines.some((l) => l.accountId === DEBTORS)
    : entry.debitAccountId === DEBTORS || entry.creditAccountId === DEBTORS;
  if (!has1200) return false;
  return entry.amountUSDAtTx != null && entry.amountUSDAtTx !== 0;
}

/**
 * تشغيل إعادة التقييم: جلب الديون ذات amountUSDAtTx، حساب الفارق عند السعر الحالي، وترحيل قيد التعديل.
 * @param {string} newRateOneUsdInSYP - سعر 1 USD بالليرة (اختياري؛ إن لم يُمرَّر يُؤخذ من exchangeRates الحالي).
 * @param {string} userId - للمراجعة
 * @returns {{ success: boolean, entry?: object, adjustmentAmount?: number, error?: string }}
 */
export function runDebtRevaluation(newRateOneUsdInSYP = null, userId = 'system') {
  const list = (journalEntriesList || []).filter(entryTouches1200WithUSD);
  if (list.length === 0) {
    return { success: true, revalued: false, message: 'لا توجد ديون مرتبطة بعملة أجنبية لإعادة التقييم' };
  }

  let balanceAttributableToUSD = 0;
  let totalUSDAtTx = 0;

  for (const e of list) {
    balanceAttributableToUSD += getEntry1200Net(e);
    const usd = e.amountUSDAtTx != null ? Number(e.amountUSDAtTx) : 0;
    totalUSDAtTx += usd;
  }

  const rates = multiCurrency.getRates();
  const oneUsdInSYP = newRateOneUsdInSYP != null
    ? Number(newRateOneUsdInSYP)
    : (rates.SYP != null && rates.SYP !== 0 ? 1 / rates.SYP : null);

  if (oneUsdInSYP == null || oneUsdInSYP <= 0) {
    return { success: false, error: 'سعر الصرف (1 USD بالليرة) غير متوفر' };
  }

  const targetSYPValue = round2(totalUSDAtTx * oneUsdInSYP);
  const adjustmentAmount = round2(targetSYPValue - balanceAttributableToUSD);

  if (Math.abs(adjustmentAmount) < TOLERANCE) {
    return { success: true, revalued: false, message: 'لا يوجد فرق يستدعي قيد تعديل', adjustmentAmount: 0 };
  }

  if (!accounts.has(DEBTORS)) return { success: false, error: 'حساب المدينين (1200) غير موجود' };
  if (!accounts.has(REVALUATION_GAIN)) return { success: false, error: 'حساب أرباح فرق العملة (4120) غير موجود' };
  if (!accounts.has(EXCHANGE_LOSS)) return { success: false, error: 'حساب خسائر الصرف (5200) غير موجود' };

  const rateLabel = String(oneUsdInSYP);
  const memo = 'تعديل رصيد آلي بناءً على سعر صرف ' + rateLabel;

  let result;
  if (adjustmentAmount > 0) {
    result = journal.postDoubleEntry(DEBTORS, REVALUATION_GAIN, adjustmentAmount, {
      refType: 'REVALUATION',
      refId: 'reval-' + Date.now(),
      memo,
      createdBy: userId,
    });
  } else {
    result = journal.postDoubleEntry(EXCHANGE_LOSS, DEBTORS, Math.abs(adjustmentAmount), {
      refType: 'REVALUATION',
      refId: 'reval-' + Date.now(),
      memo,
      createdBy: userId,
    });
  }

  if (!result.success) return result;

  log('REVALUATION', {
    entityType: 'Debtors',
    entityId: DEBTORS,
    oldValue: balanceAttributableToUSD,
    newValue: targetSYPValue,
    reasonCode: REASON_CODES.REVALUATION,
    userId,
    memo: memo + ' | الفرق: ' + adjustmentAmount,
  });

  return {
    success: true,
    revalued: true,
    entry: result.entry,
    adjustmentAmount,
    previousBalanceSYP: balanceAttributableToUSD,
    totalUSDAtTx,
    targetSYPValue,
    oneUsdInSYP,
  };
}
