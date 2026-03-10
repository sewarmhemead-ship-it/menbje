/**
 * Multi-Currency 'Ghost' Layer.
 * Every transaction stores: amountSYP, amountUSD/Gold at tx time.
 * Real-time valuation and Exchange Gain/Loss report.
 * القيود المحذوفة (deleted: true) لا تُحتسب في أي تقرير صادر عن هذا الموديول.
 */

import { store } from '../config/store.js';
import * as multiCurrency from '../modules/multiCurrency/index.js';

const { journalEntriesList, exchangeRates, inventoryByProduct } = store;

/**
 * Get current valuation of an amount in SYP to USD (and optionally gold).
 */
export function getCurrentValuation(amountSYP) {
  const rates = multiCurrency.getRates();
  const sypPerUsd = rates.SYP != null && rates.SYP !== 0 ? 1 / rates.SYP : null;
  const usd = sypPerUsd != null ? amountSYP * rates.SYP : null;
  return { amountSYP, amountUSD: usd, rateUsed: rates.SYP };
}

/**
 * سعر 1 USD بالليرة (كم ليرة تعادل دولاراً واحداً).
 * نستخدمه لتحويل "فرق الربح/الخسارة بالدولار" إلى ليرة. التخزين في النظام: rates.SYP = قيمة 1 ليرة
 * بالدولار (USD per SYP)، لذا oneUsdInSYP = 1/rates.SYP. استخدام الضرب (فرق USD × oneUsdInSYP)
 * بدل القسمة (فرق USD / rates.SYP) يضمن دقة الحساب ويتجنب أرقاماً فلكية إذا اُستخدم السعر بمعنى خاطئ.
 * @returns {number|null} ليرة تعادل 1 USD، أو null إذا السعر غير متوفر.
 */
function getOneUsdInSYP() {
  const rates = multiCurrency.getRates();
  const sypRate = rates.SYP;
  if (sypRate == null || sypRate === 0) return null;
  return 1 / sypRate;
}

/**
 * Re-value a past transaction at current rates.
 * أرباح/خسائر الصرف بالليرة = (القيمة الحالية بالدولار − القيمة وقت القيد بالدولار) × oneUsdInSYP.
 * نستخدم الضرب في oneUsdInSYP (وليس القسمة على rates.SYP) لتحويل فرق الدولار إلى ليرة بشكل صريح
 * وتفادي ثغرات حسابية عند خلط معنى السعر (USD per SYP vs SYP per USD).
 * @param {Object} entry - { amountSYP, amountUSDAtTx }
 * @returns {{ amountSYP, amountUSDAtTx, amountUSDNow, unrealizedGainLossSYP }}
 */
export function revalueAtCurrent(entry) {
  const amountSYP = entry.amountSYP || 0;
  const usdAtTx = entry.amountUSDAtTx;
  const rates = multiCurrency.getRates();
  const sypRate = rates.SYP;
  const usdNow = sypRate != null && sypRate !== 0 ? amountSYP * sypRate : null;
  const oneUsdInSYP = getOneUsdInSYP();
  const gainLossSYP =
    usdAtTx != null && usdNow != null && oneUsdInSYP != null
      ? (usdNow - usdAtTx) * oneUsdInSYP
      : null;
  return {
    amountSYP,
    amountUSDAtTx: usdAtTx,
    amountUSDNow: usdNow,
    unrealizedGainLossSYP: gainLossSYP,
  };
}

/**
 * استخراج المبلغ الإجمالي بالليرة من قيد مركب (مجموع المدين = مجموع الدائن).
 */
function getCompoundEntryAmountSYP(entry) {
  if (!entry.compoundLines || !entry.compoundLines.length) return 0;
  return entry.compoundLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
}

/**
 * يُرجع true إذا كان القيد قد يساهم في تقرير أرباح/خسائر الصرف (لديه قيمة USD وقت القيد).
 * استخدام هذه الدالة للفلترة المسبقة يقلل الجهد عند عدد قيود كبير (مئات الآلاف):
 * بدل المرور على كل القيود واستدعاء revalueAtCurrent، نمر فقط على القيود المرتبطة بعملة أجنبية.
 * @param {Object} entry - قيد من journalEntriesList
 * @returns {boolean}
 */
function entryHasFxRelevance(entry) {
  if (entry.deleted) return false;
  if (entry.compoundLines) return entry.amountUSDAtTx != null;
  return (entry.amountSYP != null && entry.amountSYP !== 0) && entry.amountUSDAtTx != null;
}

/**
 * Exchange Gain/Loss report: sum of (current USD value - tx USD value) for all journal lines in period.
 * Positive = gain (we hold assets that appreciated in USD terms).
 * يدعم القيود البسيطة والمركبة. القيود المحذوفة (deleted: true) لا تُحتسب.
 *
 * أداء: للحد من الجهد عند حجم كبير من القيود، يُفضّل فلترة مسبقة بالاعتماد على entryHasFxRelevance
 * ثم تطبيق fromDate/toDate على النتيجة، بدل المرور على كل القيود.
 */
export function getExchangeGainLossReport(fromDate, toDate) {
  const fullList = (journalEntriesList || []).filter((e) => !e.deleted);
  const list = fullList.filter(entryHasFxRelevance);
  let totalGainLossSYP = 0;
  const details = [];

  for (const e of list) {
    if (fromDate && e.date < fromDate) continue;
    if (toDate && e.date > toDate) continue;

    let amountSYP, amountUSDAtTx;
    if (e.compoundLines) {
      amountSYP = getCompoundEntryAmountSYP(e);
      amountUSDAtTx = e.amountUSDAtTx ?? null;
    } else {
      amountSYP = e.amountSYP || 0;
      amountUSDAtTx = e.amountUSDAtTx ?? null;
    }

    const v = revalueAtCurrent({ amountSYP, amountUSDAtTx });
    if (v.unrealizedGainLossSYP != null) {
      totalGainLossSYP += v.unrealizedGainLossSYP;
      details.push({
        entryId: e.id,
        date: e.date,
        amountSYP,
        amountUSDAtTx,
        amountUSDNow: v.amountUSDNow,
        gainLossSYP: v.unrealizedGainLossSYP,
        compound: !!e.compoundLines,
      });
    }
  }

  const sypRate = multiCurrency.getRates().SYP;
  return {
    fromDate: fromDate || null,
    toDate: toDate || null,
    totalGainLossSYP,
    totalGainLossUSD: sypRate != null && sypRate !== 0 ? totalGainLossSYP * sypRate : null,
    details,
  };
}

/**
 * مراقبة ثبات القيمة الدولارية عند التجزئة (كسر الكرتونة).
 * مخزن "القطع المفتوحة" يحفظ totalCostSYP؛ عند سعر صرف واحد تكون القيمة USD = totalCostSYP * rate.
 * يساعد في ضمان عدم وجود تسرب مالي من أخطاء التقريب عند التجزئة.
 *
 * لماذا الضرب في oneUsdInSYP في مكان آخر (revalueAtCurrent): تحويل فرق الربح/الخسارة من USD إلى SYP
 * يتم بضرب الفرق بـ "كم ليرة تعادل 1 دولار" (oneUsdInSYP) وليس بالقسمة على rates.SYP، لأن rates.SYP
 * مخزّن كـ "قيمة 1 ليرة بالدولار". القسمة على عدد صغير جداً قد تعطي أرقاماً فلكية؛ الضرب في المعكوس
 * يبقى الحساب واضحاً ودقيقاً.
 *
 * @returns {{ totalCostSYP: number, totalUSDAtCurrentRate: number|null, rateUsed: number|null, rows: Array, note: string }}
 */
export function getOpenSubUnitsValuation() {
  const rate = multiCurrency.getRates().SYP;
  let totalCostSYP = 0;
  const rows = [];

  for (const [key, inv] of inventoryByProduct || []) {
    const totalCost = inv.totalCostSYP != null ? Number(inv.totalCostSYP) : 0;
    if (totalCost <= 0) continue;
    const qty = (inv.quantity || 0) - (inv.reserved || 0);
    if (qty <= 0) continue;
    const usdAtRate = rate != null && rate !== 0 ? totalCost * rate : null;
    totalCostSYP += totalCost;
    rows.push({
      key,
      productId: inv.productId,
      unitId: inv.unitId,
      quantity: qty,
      totalCostSYP: totalCost,
      costPerUnitSYP: qty > 0 ? totalCost / qty : 0,
      usdAtCurrentRate: usdAtRate,
    });
  }

  return {
    totalCostSYP,
    totalUSDAtCurrentRate: rate != null && rate !== 0 ? totalCostSYP * rate : null,
    rateUsed: rate,
    rows,
    note: 'عند كسر كرتونة تُحفظ التكلفة بالليرة (totalCostSYP)؛ القيمة USD عند نفس السعر ثابتة. مراقبة costPerUnit مقابل قاعدة التجزئة تكشف أخطاء التقريب.',
  };
}
